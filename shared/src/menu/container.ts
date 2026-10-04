/**
 * Containers (vanilla Container / SimpleContainer / CompoundContainer) and ItemStack helpers
 * used by the menu system. Empty stacks are `null`; a stack whose count reaches 0 is empty.
 */
import { ITEMS_BY_ID, ITEMS_BY_NAME } from '../data';
import { isEmpty, maxStackSize, tagsEqual, type Inventory, type ItemStack } from '../item/stack';

export function copyStack(s: ItemStack | null | undefined): ItemStack | null {
  if (isEmpty(s)) return null;
  const c: ItemStack = { id: s.id, count: s.count, damage: s.damage };
  if (s.tag) c.tag = JSON.parse(JSON.stringify(s.tag)) as ItemStack['tag'];
  return c;
}

/** ItemStack.split: take up to n off `s` (mutating it) and return them. */
export function splitStack(s: ItemStack, n: number): ItemStack | null {
  const k = Math.min(n, s.count);
  if (k <= 0) return null;
  s.count -= k;
  const out: ItemStack = { id: s.id, count: k, damage: s.damage };
  if (s.tag) out.tag = JSON.parse(JSON.stringify(s.tag)) as ItemStack['tag'];
  return out;
}

/** ItemStack.isSameItemSameTags (our stacks carry no tags beyond damage). */
export function sameItemSameTags(a: ItemStack | null, b: ItemStack | null): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  return a.id === b.id && a.damage === b.damage && tagsEqual(a.tag, b.tag);
}

/** ItemStack.isSame: same item, and same damage for damageable items. */
export function isSame(a: ItemStack | null, b: ItemStack | null): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  if (a.id !== b.id) return false;
  return maxDamage(a.id) > 0 ? a.damage === b.damage : true;
}

export function maxDamage(id: number): number {
  return ITEMS_BY_ID[id]?.maxDurability ?? 0;
}

/** ItemStack.isStackable: max stack > 1 and not a damaged damageable item. */
export function isStackable(s: ItemStack): boolean {
  return maxStackSize(s.id) > 1 && !(maxDamage(s.id) > 0 && s.damage > 0);
}

export function itemId(name: string): number {
  return ITEMS_BY_NAME.get(name)?.id ?? 0;
}

/** Mob.getEquipmentSlotForItem: 'head' | 'chest' | 'legs' | 'feet' | 'offhand' | 'mainhand'. */
export function equipmentSlotFor(id: number): 'head' | 'chest' | 'legs' | 'feet' | 'offhand' | 'mainhand' {
  const n = ITEMS_BY_ID[id]?.name ?? '';
  if (n === 'shield') return 'offhand';
  if (n.endsWith('_helmet') || n === 'carved_pumpkin' || n === 'turtle_helmet' || n.endsWith('_head') || n.endsWith('_skull')) return 'head';
  if (n.endsWith('_chestplate') || n === 'elytra') return 'chest';
  if (n.endsWith('_leggings')) return 'legs';
  if (n.endsWith('_boots')) return 'feet';
  return 'mainhand';
}

export interface Container {
  size(): number;
  getItem(i: number): ItemStack | null;
  setItem(i: number, s: ItemStack | null): void;
  /** Container.removeItem: split up to n off the slot. */
  removeItem(i: number, n: number): ItemStack | null;
  maxStackSize(): number;
  setChanged(): void;
  /** Container.stillValid */
  stillValid?(): boolean;
  startOpen?(): void;
  stopOpen?(): void;
}

/** SimpleContainer backed by an array (block entity item lists use this). */
export class SimpleContainer implements Container {
  onChange: (() => void) | null = null;
  readonly items: (ItemStack | null)[];
  constructor(sizeOrItems: number | (ItemStack | null)[]) {
    this.items = typeof sizeOrItems === 'number' ? new Array(sizeOrItems).fill(null) : sizeOrItems;
  }
  size(): number {
    return this.items.length;
  }
  getItem(i: number): ItemStack | null {
    const s = this.items[i];
    if (isEmpty(s)) {
      if (s) this.items[i] = null;
      return null;
    }
    return s;
  }
  setItem(i: number, s: ItemStack | null): void {
    this.items[i] = isEmpty(s) ? null : s;
    this.setChanged();
  }
  removeItem(i: number, n: number): ItemStack | null {
    const s = this.getItem(i);
    if (!s || n <= 0) return null;
    const out = splitStack(s, n);
    if (s.count <= 0) this.items[i] = null;
    this.setChanged();
    return out;
  }
  maxStackSize(): number {
    return 64;
  }
  setChanged(): void {
    this.onChange?.();
  }
  clear(): void {
    this.items.fill(null);
  }
}

/** ResultContainer: one slot; removeItem takes the whole stack (ContainerHelper.takeItem). */
export class ResultContainer extends SimpleContainer {
  constructor() {
    super(1);
  }
  override removeItem(i: number): ItemStack | null {
    const s = this.getItem(i);
    this.items[i] = null;
    return s;
  }
}

/** The player Inventory as a Container (vanilla Inventory slot numbering 0–40). */
export class InventoryContainer implements Container {
  onChange: ((slot: number) => void) | null = null;
  constructor(readonly inv: Inventory) {}
  size(): number {
    return 41;
  }
  getItem(i: number): ItemStack | null {
    const s = this.inv.slots[i];
    if (isEmpty(s)) {
      if (s) this.inv.slots[i] = null;
      return null;
    }
    return s;
  }
  setItem(i: number, s: ItemStack | null): void {
    this.inv.set(i, s);
    this.onChange?.(i);
  }
  removeItem(i: number, n: number): ItemStack | null {
    const s = this.getItem(i);
    if (!s || n <= 0) return null;
    const out = splitStack(s, n);
    if (s.count <= 0) this.inv.slots[i] = null;
    this.onChange?.(i);
    return out;
  }
  maxStackSize(): number {
    return 64;
  }
  setChanged(): void {
    this.onChange?.(-1);
  }
}

/** CompoundContainer: two containers seen as one (double chests: first = top rows). */
export class CompoundContainer implements Container {
  constructor(
    readonly first: Container,
    readonly second: Container,
  ) {}
  size(): number {
    return this.first.size() + this.second.size();
  }
  private at(i: number): [Container, number] {
    const n = this.first.size();
    return i >= n ? [this.second, i - n] : [this.first, i];
  }
  getItem(i: number): ItemStack | null {
    const [c, j] = this.at(i);
    return c.getItem(j);
  }
  setItem(i: number, s: ItemStack | null): void {
    const [c, j] = this.at(i);
    c.setItem(j, s);
  }
  removeItem(i: number, n: number): ItemStack | null {
    const [c, j] = this.at(i);
    return c.removeItem(j, n);
  }
  maxStackSize(): number {
    return this.first.maxStackSize();
  }
  setChanged(): void {
    this.first.setChanged();
    this.second.setChanged();
  }
  stillValid(): boolean {
    return (this.first.stillValid?.() ?? true) && (this.second.stillValid?.() ?? true);
  }
}
