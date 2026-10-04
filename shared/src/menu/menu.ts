/**
 * Container menus (vanilla AbstractContainerMenu and its subclasses): slots, the carried item
 * and the exact click semantics of doClick (PICKUP, QUICK_MOVE, SWAP, CLONE, THROW,
 * QUICK_CRAFT, PICKUP_ALL), shared by the server (authoritative) and the client (prediction).
 */
import { isEmpty, maxStackSize, type Inventory, type ItemStack } from '../item/stack';
import { ITEMS_BY_ID } from '../data';
import {
  CompoundContainer, InventoryContainer, ResultContainer, SimpleContainer, copyStack, equipmentSlotFor, isSame, isStackable,
  itemId, sameItemSameTags, splitStack, type Container,
} from './container';
import { craftingRemainder, craftingResult } from './recipes';
import { grindstoneOutput } from '../game/enchantments';
import { isFuel, cookingRecipe } from './smelting';
import { stonecutterRecipes, type StonecutterRecipe } from './stonecutting';
import { COOKING_TYPE, type FurnaceKind } from './furnace';

export const enum ClickType {
  PICKUP = 0,
  QUICK_MOVE = 1,
  SWAP = 2,
  CLONE = 3,
  THROW = 4,
  QUICK_CRAFT = 5,
  PICKUP_ALL = 6,
}

/** The clicked slot id for "outside the window" (drop the carried stack). */
export const SLOT_OUTSIDE = -999;

export type MenuType = 'inventory' | 'crafting' | 'generic_9x3' | 'generic_9x6' | 'generic_3x3' | 'hopper' | 'furnace' | 'blast_furnace' | 'smoker' | 'stonecutter' | 'smithing' | 'grindstone' | 'enchantment' | 'brewing_stand';

export interface MenuPlayer {
  readonly inventory: Inventory;
  /** abilities.instabuild */
  readonly creative: boolean;
  /** Player.drop(stack, false, includeThrowerName): tossed from the eyes */
  drop(stack: ItemStack): void;
}

// ------------------------------------------------------------------ slots
export class Slot {
  /** index in the menu */
  index = 0;
  constructor(
    readonly container: Container,
    readonly slot: number,
    public x: number,
    public y: number,
  ) {}
  getItem(): ItemStack | null {
    return this.container.getItem(this.slot);
  }
  hasItem(): boolean {
    return !isEmpty(this.getItem());
  }
  set(s: ItemStack | null): void {
    this.container.setItem(this.slot, isEmpty(s) ? null : s);
    this.setChanged();
  }
  setChanged(): void {
    this.container.setChanged();
  }
  mayPlace(_s: ItemStack): boolean {
    return true;
  }
  mayPickup(_p: MenuPlayer): boolean {
    return true;
  }
  getMaxStackSize(): number {
    return this.container.maxStackSize();
  }
  getMaxStackSizeFor(s: ItemStack): number {
    return Math.min(this.getMaxStackSize(), maxStackSize(s.id));
  }
  remove(n: number): ItemStack | null {
    return this.container.removeItem(this.slot, n);
  }
  onTake(_p: MenuPlayer, _s: ItemStack): void {
    this.setChanged();
  }
  /** Slot.onQuickCraft(newStack, oldStack) */
  onQuickCraft(newStack: ItemStack, oldStack: ItemStack): void {
    const n = oldStack.count - newStack.count;
    if (n > 0) this.onQuickCraftAmount(oldStack, n);
  }
  protected onQuickCraftAmount(_s: ItemStack, _n: number): void {}
  onSwapCraft(_n: number): void {}
  allowModification(p: MenuPlayer): boolean {
    const it = this.getItem();
    return this.mayPickup(p) && (it === null || this.mayPlace(it));
  }
  tryRemove(count: number, decrement: number, p: MenuPlayer): ItemStack | null {
    if (!this.mayPickup(p)) return null;
    const it = this.getItem();
    if (!this.allowModification(p) && it && decrement < it.count) return null;
    count = Math.min(count, decrement);
    const out = this.remove(count);
    if (isEmpty(out)) return null;
    if (!this.hasItem()) this.set(null);
    return out;
  }
  safeTake(count: number, decrement: number, p: MenuPlayer): ItemStack | null {
    const s = this.tryRemove(count, decrement, p);
    if (s) this.onTake(p, s);
    return s;
  }
  /** Returns what is left of `stack` (the same object, shrunk, or null). */
  safeInsert(stack: ItemStack, n = stack.count): ItemStack | null {
    if (!isEmpty(stack) && this.mayPlace(stack)) {
      const cur = this.getItem();
      const i = Math.min(Math.min(n, stack.count), this.getMaxStackSizeFor(stack) - (cur?.count ?? 0));
      if (!cur) {
        if (i > 0) this.set(splitStack(stack, i));
      } else if (sameItemSameTags(cur, stack) && i > 0) {
        stack.count -= i;
        cur.count += i;
        this.set(cur);
      }
    }
    return isEmpty(stack) ? null : stack;
  }
}

/** Crafting result slot (vanilla ResultSlot): taking consumes the grid, leaving remainders. */
export class ResultSlot extends Slot {
  removeCount = 0;
  constructor(
    private readonly craftSlots: SimpleContainer,
    result: Container,
    x: number,
    y: number,
  ) {
    super(result, 0, x, y);
  }
  override mayPlace(): boolean {
    return false;
  }
  override remove(n: number): ItemStack | null {
    const it = this.getItem();
    if (it) this.removeCount += Math.min(n, it.count);
    return super.remove(n);
  }
  protected override onQuickCraftAmount(_s: ItemStack, n: number): void {
    this.removeCount += n;
    this.removeCount = 0;
  }
  override onSwapCraft(n: number): void {
    this.removeCount += n;
  }
  override onTake(p: MenuPlayer, _s: ItemStack): void {
    this.removeCount = 0;
    const grid = this.craftSlots;
    for (let i = 0; i < grid.size(); i++) {
      let st = grid.getItem(i);
      const remId = st ? craftingRemainder(st.id) : 0;
      let rem: ItemStack | null = remId ? { id: remId, count: 1, damage: 0 } : null;
      if (st) {
        grid.removeItem(i, 1);
        st = grid.getItem(i);
      }
      if (rem) {
        if (!st) grid.setItem(i, rem);
        else if (isSame(st, rem)) {
          rem.count += st.count;
          grid.setItem(i, rem);
        } else {
          const left = p.inventory.add(rem);
          if (left > 0) {
            rem = { ...rem, count: left };
            p.drop(rem);
          }
        }
      }
    }
  }
}

/** Furnace output (vanilla FurnaceResultSlot): taking it pays out the smelting experience. */
export class FurnaceResultSlot extends Slot {
  removeCount = 0;
  constructor(
    container: Container,
    x: number,
    y: number,
    private readonly award: ((p: MenuPlayer) => void) | null,
  ) {
    super(container, 2, x, y);
  }
  override mayPlace(): boolean {
    return false;
  }
  override remove(n: number): ItemStack | null {
    const it = this.getItem();
    if (it) this.removeCount += Math.min(n, it.count);
    return super.remove(n);
  }
  override onTake(p: MenuPlayer, s: ItemStack): void {
    this.checkTakeAchievements(p);
    super.onTake(p, s);
  }
  protected override onQuickCraftAmount(_s: ItemStack, n: number): void {
    this.removeCount += n;
  }
  /** called from quickMoveStack via onQuickCraft as well */
  override onQuickCraft(newStack: ItemStack, oldStack: ItemStack): void {
    super.onQuickCraft(newStack, oldStack);
  }
  checkTakeAchievements(p: MenuPlayer): void {
    this.award?.(p);
    this.removeCount = 0;
  }
}

class FurnaceFuelSlot extends Slot {
  override mayPlace(s: ItemStack): boolean {
    return isFuel(s.id) || s.id === itemId('bucket');
  }
  override getMaxStackSizeFor(s: ItemStack): number {
    return s.id === itemId('bucket') ? 1 : super.getMaxStackSizeFor(s);
  }
}

class ArmorSlot extends Slot {
  constructor(container: Container, slot: number, x: number, y: number, readonly part: 'head' | 'chest' | 'legs' | 'feet') {
    super(container, slot, x, y);
  }
  override getMaxStackSize(): number {
    return 1;
  }
  override mayPlace(s: ItemStack): boolean {
    return equipmentSlotFor(s.id) === this.part;
  }
}

// ------------------------------------------------------------------ menus
export abstract class Menu {
  readonly slots: Slot[] = [];
  carried: ItemStack | null = null;
  /** ContainerData values (furnace progress) */
  data: number[] = [];
  private quickcraftStatus = 0;
  private quickcraftType = -1;
  private readonly quickcraftSlots = new Set<Slot>();
  /** image size for the screen */
  imageWidth = 176;
  imageHeight = 166;

  constructor(
    readonly type: MenuType,
    readonly containerId: number,
  ) {}

  protected addSlot(s: Slot): Slot {
    s.index = this.slots.length;
    this.slots.push(s);
    return s;
  }

  /** Player inventory rows at (8, y) and the hotbar at (8, y + 58). */
  protected addPlayerInventory(inv: Container, y: number): void {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 9; j++) this.addSlot(new Slot(inv, j + i * 9 + 9, 8 + j * 18, y + i * 18));
    for (let i = 0; i < 9; i++) this.addSlot(new Slot(inv, i, 8 + i * 18, y + 58));
  }

  abstract quickMoveStack(p: MenuPlayer, index: number): ItemStack | null;

  canTakeItemForPickAll(_s: ItemStack, _slot: Slot): boolean {
    return true;
  }
  canDragTo(_slot: Slot): boolean {
    return true;
  }
  stillValid(_p: MenuPlayer): boolean {
    return true;
  }

  /** AbstractContainerMenu.clickMenuButton (stonecutter recipe buttons…); true if handled. */
  clickMenuButton(_p: MenuPlayer, _id: number): boolean {
    return false;
  }

  /** AbstractContainerMenu.removed: the carried stack goes back into the inventory. */
  removed(p: MenuPlayer): void {
    const c = this.carried;
    if (!isEmpty(c)) placeBack(p, c);
    this.carried = null;
  }

  /** AbstractContainerMenu.moveItemStackTo. */
  moveItemStackTo(stack: ItemStack, start: number, end: number, reverse: boolean): boolean {
    let flag = false;
    let i = reverse ? end - 1 : start;
    const max = maxStackSize(stack.id);
    if (isStackable(stack)) {
      while (stack.count > 0) {
        if (reverse ? i < start : i >= end) break;
        const slot = this.slots[i]!;
        const it = slot.getItem();
        if (it && sameItemSameTags(stack, it)) {
          const j = it.count + stack.count;
          if (j <= max) {
            stack.count = 0;
            it.count = j;
            slot.setChanged();
            flag = true;
          } else if (it.count < max) {
            stack.count -= max - it.count;
            it.count = max;
            slot.setChanged();
            flag = true;
          }
        }
        i += reverse ? -1 : 1;
      }
    }
    if (stack.count > 0) {
      i = reverse ? end - 1 : start;
      for (;;) {
        if (reverse ? i < start : i >= end) break;
        const slot = this.slots[i]!;
        if (!slot.hasItem() && slot.mayPlace(stack)) {
          slot.set(splitStack(stack, stack.count > slot.getMaxStackSize() ? slot.getMaxStackSize() : stack.count));
          slot.setChanged();
          flag = true;
          break;
        }
        i += reverse ? -1 : 1;
      }
    }
    return flag;
  }

  /** The common tail of quickMoveStack implementations. */
  protected finishQuickMove(slot: Slot, moved: ItemStack, original: ItemStack, p: MenuPlayer, checkSame = true): ItemStack | null {
    if (moved.count <= 0) slot.set(null);
    else slot.setChanged();
    if (checkSame && moved.count === original.count) return null;
    slot.onTake(p, moved);
    return original;
  }

  clicked(slotId: number, button: number, type: ClickType, p: MenuPlayer): void {
    if (slotId !== SLOT_OUTSIDE && slotId !== -1 && (slotId < 0 || slotId >= this.slots.length)) return;
    this.doClick(slotId, button, type, p);
  }

  private resetQuickCraft(): void {
    this.quickcraftStatus = 0;
    this.quickcraftSlots.clear();
  }

  get isQuickCrafting(): boolean {
    return this.quickcraftStatus !== 0;
  }

  get dragSlots(): ReadonlySet<Slot> {
    return this.quickcraftSlots;
  }

  get dragType(): number {
    return this.quickcraftType;
  }

  private doClick(slotId: number, button: number, type: ClickType, p: MenuPlayer): void {
    const inv = p.inventory;
    if (type === ClickType.QUICK_CRAFT) {
      const prev = this.quickcraftStatus;
      this.quickcraftStatus = button & 3;
      if ((prev !== 1 || this.quickcraftStatus !== 2) && prev !== this.quickcraftStatus) this.resetQuickCraft();
      else if (isEmpty(this.carried)) this.resetQuickCraft();
      else if (this.quickcraftStatus === 0) {
        this.quickcraftType = (button >> 2) & 3;
        if (this.quickcraftType === 0 || this.quickcraftType === 1 || (this.quickcraftType === 2 && p.creative)) {
          this.quickcraftStatus = 1;
          this.quickcraftSlots.clear();
        } else this.resetQuickCraft();
      } else if (this.quickcraftStatus === 1) {
        const slot = this.slots[slotId];
        const it = this.carried!;
        if (slot && canItemQuickReplace(slot, it, true) && slot.mayPlace(it) && (this.quickcraftType === 2 || it.count > this.quickcraftSlots.size) && this.canDragTo(slot)) {
          this.quickcraftSlots.add(slot);
        }
      } else if (this.quickcraftStatus === 2) {
        if (this.quickcraftSlots.size > 0) {
          if (this.quickcraftSlots.size === 1) {
            const l = this.quickcraftSlots.values().next().value!.index;
            const t = this.quickcraftType;
            this.resetQuickCraft();
            this.doClick(l, t, ClickType.PICKUP, p);
            return;
          }
          const base = copyStack(this.carried)!;
          let left = this.carried!.count;
          for (const slot of this.quickcraftSlots) {
            const c = this.carried!;
            if (canItemQuickReplace(slot, c, true) && slot.mayPlace(c) && (this.quickcraftType === 2 || c.count >= this.quickcraftSlots.size) && this.canDragTo(slot)) {
              const st = copyStack(base)!;
              const j = slot.getItem()?.count ?? 0;
              quickCraftSlotCount(this.quickcraftSlots.size, this.quickcraftType, st, j);
              const k = Math.min(maxStackSize(st.id), slot.getMaxStackSizeFor(st));
              if (st.count > k) st.count = k;
              left -= st.count - j;
              slot.set(st);
            }
          }
          base.count = left;
          this.carried = isEmpty(base) ? null : base;
        }
        this.resetQuickCraft();
      } else this.resetQuickCraft();
    } else if (this.quickcraftStatus !== 0) {
      this.resetQuickCraft();
    } else if ((type === ClickType.PICKUP || type === ClickType.QUICK_MOVE) && (button === 0 || button === 1)) {
      const primary = button === 0;
      if (slotId === SLOT_OUTSIDE) {
        const c = this.carried;
        if (!isEmpty(c)) {
          if (primary) {
            p.drop(c);
            this.carried = null;
          } else {
            p.drop(splitStack(c, 1)!);
            if (c.count <= 0) this.carried = null;
          }
        }
      } else if (type === ClickType.QUICK_MOVE) {
        if (slotId < 0) return;
        const slot = this.slots[slotId]!;
        if (!slot.mayPickup(p)) return;
        for (let moved = this.quickMoveStack(p, slotId), guard = 0; !isEmpty(moved) && isSame(slot.getItem(), moved) && guard < 1000; moved = this.quickMoveStack(p, slotId), guard++);
      } else {
        if (slotId < 0) return;
        const slot = this.slots[slotId]!;
        const it = slot.getItem();
        const c = this.carried;
        if (!it) {
          if (!isEmpty(c)) this.carried = slot.safeInsert(c, primary ? c.count : 1);
        } else if (slot.mayPickup(p)) {
          if (isEmpty(c)) {
            const n = primary ? it.count : Math.floor((it.count + 1) / 2);
            const taken = slot.tryRemove(n, Number.MAX_SAFE_INTEGER, p);
            if (taken) {
              this.carried = taken;
              slot.onTake(p, taken);
            }
          } else if (slot.mayPlace(c)) {
            if (sameItemSameTags(it, c)) this.carried = slot.safeInsert(c, primary ? c.count : 1);
            else if (c.count <= slot.getMaxStackSizeFor(c)) {
              slot.set(c);
              this.carried = it;
            }
          } else if (sameItemSameTags(it, c)) {
            const taken = slot.tryRemove(it.count, maxStackSize(c.id) - c.count, p);
            if (taken) {
              c.count += taken.count;
              slot.onTake(p, taken);
            }
          }
        }
        slot.setChanged();
      }
    } else if (type === ClickType.SWAP) {
      if (slotId < 0 || !(button >= 0 && button < 9) && button !== 40) return;
      const slot = this.slots[slotId]!;
      const hot = inv.get(button);
      const it = slot.getItem();
      if (!isEmpty(hot) || it) {
        if (isEmpty(hot)) {
          if (slot.mayPickup(p)) {
            inv.set(button, it);
            slot.onSwapCraft(it!.count);
            slot.set(null);
            slot.onTake(p, it!);
          }
        } else if (!it) {
          if (slot.mayPlace(hot)) {
            const l = slot.getMaxStackSizeFor(hot);
            if (hot.count > l) slot.set(splitStack(hot, l));
            else {
              slot.set(hot);
              inv.set(button, null);
            }
          }
        } else if (slot.mayPickup(p) && slot.mayPlace(hot)) {
          const l = slot.getMaxStackSizeFor(hot);
          if (hot.count > l) {
            slot.set(splitStack(hot, l));
            slot.onTake(p, it);
            const left = inv.add(it);
            if (left > 0) p.drop({ ...it, count: left });
          } else {
            slot.set(hot);
            inv.set(button, it);
            slot.onTake(p, it);
          }
        }
      }
    } else if (type === ClickType.CLONE && p.creative && isEmpty(this.carried) && slotId >= 0) {
      const it = this.slots[slotId]!.getItem();
      if (it) this.carried = { id: it.id, count: maxStackSize(it.id), damage: it.damage };
    } else if (type === ClickType.THROW && isEmpty(this.carried) && slotId >= 0) {
      const slot = this.slots[slotId]!;
      const n = button === 0 ? 1 : slot.getItem()?.count ?? 0;
      const st = slot.safeTake(n, Number.MAX_SAFE_INTEGER, p);
      if (st) p.drop(st);
    } else if (type === ClickType.PICKUP_ALL && slotId >= 0) {
      const slot = this.slots[slotId]!;
      const c = this.carried;
      if (!isEmpty(c) && (!slot.hasItem() || !slot.mayPickup(p))) {
        const k1 = button === 0 ? 0 : this.slots.length - 1;
        const step = button === 0 ? 1 : -1;
        const max = maxStackSize(c.id);
        for (let pass = 0; pass < 2; pass++) {
          for (let k = k1; k >= 0 && k < this.slots.length && c.count < max; k += step) {
            const s8 = this.slots[k]!;
            const it = s8.getItem();
            if (it && canItemQuickReplace(s8, c, true) && s8.mayPickup(p) && this.canTakeItemForPickAll(c, s8)) {
              if (pass !== 0 || it.count !== maxStackSize(it.id)) {
                const taken = s8.safeTake(it.count, max - c.count, p);
                if (taken) c.count += taken.count;
              }
            }
          }
        }
      }
    }
  }
}

/** AbstractContainerMenu.canItemQuickReplace */
export function canItemQuickReplace(slot: Slot | null, stack: ItemStack | null, stackSizeMatters: boolean): boolean {
  const empty = !slot || !slot.hasItem();
  if (!empty && stack && sameItemSameTags(stack, slot!.getItem())) {
    return slot!.getItem()!.count + (stackSizeMatters ? 0 : stack.count) <= maxStackSize(stack.id);
  }
  return empty;
}

/** AbstractContainerMenu.getQuickCraftSlotCount */
export function quickCraftSlotCount(slots: number, type: number, stack: ItemStack, slotCount: number): void {
  if (type === 0) stack.count = Math.floor(stack.count / slots);
  else if (type === 1) stack.count = 1;
  else if (type === 2) stack.count = maxStackSize(stack.id);
  stack.count += slotCount;
}

/** Inventory.placeItemBackInInventory: into the inventory, the rest dropped. */
export function placeBack(p: MenuPlayer, s: ItemStack): void {
  const left = p.inventory.add(s);
  if (left > 0) p.drop({ id: s.id, count: left, damage: s.damage });
}

// ------------------------------------------------------------------ crafting
abstract class CraftingMenuBase extends Menu {
  readonly craftSlots: SimpleContainer;
  readonly resultSlots = new ResultContainer();
  constructor(type: MenuType, id: number, readonly gridWidth: number) {
    super(type, id);
    this.craftSlots = new SimpleContainer(gridWidth * gridWidth);
    this.craftSlots.onChange = () => this.slotsChanged();
  }
  /** CraftingMenu.slotChangedCraftingGrid */
  slotsChanged(): void {
    const r = craftingResult({ width: this.gridWidth, height: this.gridWidth, items: this.craftSlots.items });
    this.resultSlots.items[0] = r;
  }
  override canTakeItemForPickAll(_s: ItemStack, slot: Slot): boolean {
    return slot.container !== this.resultSlots;
  }
  override canDragTo(slot: Slot): boolean {
    return slot.container !== this.resultSlots;
  }
  /** clearContainer: the grid goes back to the player when the menu closes. */
  override removed(p: MenuPlayer): void {
    super.removed(p);
    for (let i = 0; i < this.craftSlots.size(); i++) {
      const s = this.craftSlots.items[i];
      this.craftSlots.items[i] = null;
      if (!isEmpty(s)) placeBack(p, s);
    }
    this.resultSlots.items[0] = null;
  }
}

/** InventoryMenu: 0 result, 1–4 grid, 5–8 armour (head→feet), 9–35 main, 36–44 hotbar, 45 off hand. */
export class InventoryMenu extends CraftingMenuBase {
  constructor(readonly inv: Container) {
    super('inventory', 0, 2);
    this.addSlot(new ResultSlot(this.craftSlots, this.resultSlots, 154, 28));
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) this.addSlot(new Slot(this.craftSlots, j + i * 2, 98 + j * 18, 18 + i * 18));
    const parts = ['head', 'chest', 'legs', 'feet'] as const;
    for (let k = 0; k < 4; k++) this.addSlot(new ArmorSlot(inv, 39 - k, 8, 8 + k * 18, parts[k]!));
    this.addPlayerInventory(inv, 84);
    this.addSlot(new Slot(inv, 40, 77, 62));
  }

  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    const eq = equipmentSlotFor(st.id);
    const armorIdx = eq === 'head' ? 5 : eq === 'chest' ? 6 : eq === 'legs' ? 7 : eq === 'feet' ? 8 : -1;
    if (index === 0) {
      if (!this.moveItemStackTo(st, 9, 45, true)) return null;
      slot.onQuickCraft(st, orig);
    } else if (index >= 1 && index < 5) {
      if (!this.moveItemStackTo(st, 9, 45, false)) return null;
    } else if (index >= 5 && index < 9) {
      if (!this.moveItemStackTo(st, 9, 45, false)) return null;
    } else if (armorIdx >= 0 && !this.slots[armorIdx]!.hasItem()) {
      if (!this.moveItemStackTo(st, armorIdx, armorIdx + 1, false)) return null;
    } else if (eq === 'offhand' && !this.slots[45]!.hasItem()) {
      if (!this.moveItemStackTo(st, 45, 46, false)) return null;
    } else if (index >= 9 && index < 36) {
      if (!this.moveItemStackTo(st, 36, 45, false)) return null;
    } else if (index >= 36 && index < 45) {
      if (!this.moveItemStackTo(st, 9, 36, false)) return null;
    } else if (!this.moveItemStackTo(st, 9, 45, false)) return null;
    const r = this.finishQuickMove(slot, st, orig, p);
    if (r && index === 0 && st.count > 0) p.drop(st);
    return r;
  }
}

/** CraftingMenu (crafting table): 0 result, 1–9 grid, 10–36 main, 37–45 hotbar. */
export class CraftingMenu extends CraftingMenuBase {
  constructor(id: number, inv: Container, private readonly valid: () => boolean = () => true) {
    super('crafting', id, 3);
    this.addSlot(new ResultSlot(this.craftSlots, this.resultSlots, 124, 35));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.addSlot(new Slot(this.craftSlots, j + i * 3, 30 + j * 18, 17 + i * 18));
    this.addPlayerInventory(inv, 84);
  }
  override stillValid(): boolean {
    return this.valid();
  }
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if (index === 0) {
      if (!this.moveItemStackTo(st, 10, 46, true)) return null;
      slot.onQuickCraft(st, orig);
    } else if (index >= 10 && index < 46) {
      if (!this.moveItemStackTo(st, 1, 10, false)) {
        if (index < 37) {
          if (!this.moveItemStackTo(st, 37, 46, false)) return null;
        } else if (!this.moveItemStackTo(st, 10, 37, false)) return null;
      }
    } else if (!this.moveItemStackTo(st, 10, 46, false)) return null;
    const r = this.finishQuickMove(slot, st, orig, p);
    if (r && index === 0 && st.count > 0) p.drop(st);
    return r;
  }
}

/** ChestMenu: rows×9 container slots, then the player inventory. */
export class ChestMenu extends Menu {
  readonly rows: number;
  constructor(id: number, inv: Container, readonly container: Container, rows: 3 | 6) {
    super(rows === 6 ? 'generic_9x6' : 'generic_9x3', id);
    this.rows = rows;
    this.imageHeight = 114 + rows * 18;
    const k = (rows - 4) * 18;
    for (let j = 0; j < rows; j++) for (let l = 0; l < 9; l++) this.addSlot(new Slot(container, l + j * 9, 8 + l * 18, 18 + j * 18));
    this.addPlayerInventory(inv, 103 + k);
    container.startOpen?.();
  }
  override stillValid(): boolean {
    return this.container.stillValid?.() ?? true;
  }
  quickMoveStack(_p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    const n = this.rows * 9;
    if (index < n) {
      if (!this.moveItemStackTo(st, n, this.slots.length, true)) return null;
    } else if (!this.moveItemStackTo(st, 0, n, false)) return null;
    if (st.count <= 0) slot.set(null);
    else slot.setChanged();
    return orig;
  }
  override removed(p: MenuPlayer): void {
    super.removed(p);
    this.container.stopOpen?.();
  }
}

/** ShulkerBoxSlot: shulker boxes don't go inside shulker boxes. */
class ShulkerBoxSlot extends Slot {
  override mayPlace(s: ItemStack): boolean {
    return !(ITEMS_BY_ID[s.id]?.name ?? '').endsWith('shulker_box');
  }
}

/** ShulkerBoxMenu: the chest layout with ShulkerBoxSlots. */
export class ShulkerBoxMenu extends ChestMenu {
  constructor(id: number, inv: Container, container: Container) {
    super(id, inv, container, 3);
    for (let i = 0; i < 27; i++) {
      const old = this.slots[i]!;
      const s = new ShulkerBoxSlot(container, i, old.x, old.y);
      s.index = i;
      this.slots[i] = s;
    }
  }
}

/** DispenserMenu (dispenser, dropper): 3×3 container slots, then the player inventory. */
export class DispenserMenu extends Menu {
  constructor(id: number, inv: Container, readonly container: Container) {
    super('generic_3x3', id);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) this.addSlot(new Slot(container, j + i * 3, 62 + j * 18, 17 + i * 18));
    this.addPlayerInventory(inv, 84);
  }
  override stillValid(): boolean {
    return this.container.stillValid?.() ?? true;
  }
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if (index < 9) {
      if (!this.moveItemStackTo(st, 9, 45, true)) return null;
    } else if (!this.moveItemStackTo(st, 0, 9, false)) return null;
    return this.finishQuickMove(slot, st, orig, p);
  }
}

/** HopperMenu: 5 container slots, then the player inventory. */
export class HopperMenu extends Menu {
  constructor(id: number, inv: Container, readonly container: Container) {
    super('hopper', id);
    this.imageHeight = 133;
    for (let j = 0; j < 5; j++) this.addSlot(new Slot(container, j, 44 + j * 18, 20));
    this.addPlayerInventory(inv, 51);
  }
  override stillValid(): boolean {
    return this.container.stillValid?.() ?? true;
  }
  quickMoveStack(_p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if (index < 5) {
      if (!this.moveItemStackTo(st, 5, this.slots.length, true)) return null;
    } else if (!this.moveItemStackTo(st, 0, 5, false)) return null;
    if (st.count <= 0) slot.set(null);
    else slot.setChanged();
    return orig;
  }
}

/** AbstractFurnaceMenu: 0 ingredient, 1 fuel, 2 result, 3–29 main, 30–38 hotbar; data = lit/cook progress. */
export class FurnaceMenu extends Menu {
  constructor(
    type: FurnaceKind,
    id: number,
    inv: Container,
    readonly container: Container,
    award: ((p: MenuPlayer) => void) | null = null,
  ) {
    super(type, id);
    this.data = [0, 0, 0, 0];
    this.addSlot(new Slot(container, 0, 56, 17));
    this.addSlot(new FurnaceFuelSlot(container, 1, 56, 53));
    this.addSlot(new FurnaceResultSlot(container, 116, 35, award));
    this.addPlayerInventory(inv, 84);
  }
  override stillValid(): boolean {
    return this.container.stillValid?.() ?? true;
  }
  canSmelt(s: ItemStack): boolean {
    return cookingRecipe(COOKING_TYPE[this.type as FurnaceKind], s.id) !== null;
  }
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if (index === 2) {
      if (!this.moveItemStackTo(st, 3, 39, true)) return null;
      slot.onQuickCraft(st, orig);
    } else if (index !== 1 && index !== 0) {
      if (this.canSmelt(st)) {
        if (!this.moveItemStackTo(st, 0, 1, false)) return null;
      } else if (isFuel(st.id)) {
        if (!this.moveItemStackTo(st, 1, 2, false)) return null;
      } else if (index >= 3 && index < 30) {
        if (!this.moveItemStackTo(st, 30, 39, false)) return null;
      } else if (index >= 30 && index < 39 && !this.moveItemStackTo(st, 3, 30, false)) return null;
    } else if (!this.moveItemStackTo(st, 3, 39, false)) return null;
    return this.finishQuickMove(slot, st, orig, p);
  }
  /** AbstractFurnaceMenu.getBurnProgress (0..24 arrow pixels) */
  burnProgress(): number {
    const i = this.data[2]!, j = this.data[3]!;
    return j !== 0 && i !== 0 ? Math.floor((i * 24) / j) : 0;
  }
  /** getLitProgress (0..13 flame pixels) */
  litProgress(): number {
    let i = this.data[1]!;
    if (i === 0) i = 200;
    return Math.floor((this.data[0]! * 13) / i);
  }
  isLit(): boolean {
    return this.data[0]! > 0;
  }
}

/** StonecutterMenu: 0 input, 1 result, 2–28 main, 29–37 hotbar; data[0] = selected recipe. */
export class StonecutterMenu extends Menu {
  readonly input = new SimpleContainer(1);
  readonly result = new ResultContainer();
  recipes: StonecutterRecipe[] = [];
  private lastInput = 0;
  /** played when a result is taken (UI_STONECUTTER_TAKE_RESULT), set by the server */
  onTakeSound: (() => void) | null = null;
  constructor(id: number, inv: Container, private readonly valid: () => boolean = () => true) {
    super('stonecutter', id);
    this.data = [-1];
    this.input.onChange = () => this.slotsChanged();
    this.addSlot(new Slot(this.input, 0, 20, 33));
    const menu = this;
    this.addSlot(
      new (class extends Slot {
        override mayPlace(): boolean {
          return false;
        }
        override onTake(p: MenuPlayer, st: ItemStack): void {
          menu.input.removeItem(0, 1);
          if (menu.input.getItem(0)) menu.setupResultSlot();
          menu.onTakeSound?.();
          super.onTake(p, st);
        }
      })(this.result, 0, 143, 33),
    );
    this.addPlayerInventory(inv, 84);
  }
  get selectedRecipeIndex(): number {
    return this.data[0]!;
  }
  override stillValid(): boolean {
    return this.valid();
  }
  private isValidRecipeIndex(i: number): boolean {
    return i >= 0 && i < this.recipes.length;
  }
  override clickMenuButton(_p: MenuPlayer, id: number): boolean {
    if (this.isValidRecipeIndex(id)) {
      this.data[0] = id;
      this.setupResultSlot();
    }
    return true;
  }
  /** slotsChanged: a different input item lists its recipes and clears the selection */
  private slotsChanged(): void {
    const it = this.input.getItem(0);
    const id = it?.id ?? 0;
    if (id !== this.lastInput) {
      this.lastInput = id;
      this.recipes = id ? stonecutterRecipes(id) : [];
      this.data[0] = -1;
      this.result.items[0] = null;
    }
  }
  /** Re-sync recipes after the input slot was set from outside (client mirror). */
  refreshRecipes(): void {
    const id = this.input.getItem(0)?.id ?? 0;
    this.lastInput = id;
    this.recipes = id ? stonecutterRecipes(id) : [];
  }
  setupResultSlot(): void {
    const r = this.recipes[this.data[0]!];
    this.result.items[0] = r && this.input.getItem(0) ? { id: r.result, count: r.count, damage: 0 } : null;
  }
  override canTakeItemForPickAll(_s: ItemStack, slot: Slot): boolean {
    return slot.container !== this.result;
  }
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if (index === 1) {
      if (!this.moveItemStackTo(st, 2, 38, true)) return null;
      slot.onQuickCraft(st, orig);
    } else if (index === 0) {
      if (!this.moveItemStackTo(st, 2, 38, false)) return null;
    } else if (stonecutterRecipes(st.id).length) {
      if (!this.moveItemStackTo(st, 0, 1, false)) return null;
    } else if (index >= 2 && index < 29) {
      if (!this.moveItemStackTo(st, 29, 38, false)) return null;
    } else if (index >= 29 && index < 38 && !this.moveItemStackTo(st, 2, 29, false)) return null;
    if (st.count <= 0) slot.set(null);
    slot.setChanged();
    if (st.count === orig.count) return null;
    slot.onTake(p, st);
    return orig;
  }
  /** removed: the result vanishes, the input goes back to the player */
  override removed(p: MenuPlayer): void {
    super.removed(p);
    this.result.items[0] = null;
    const it = this.input.items[0];
    this.input.items[0] = null;
    if (!isEmpty(it)) placeBack(p, it);
  }
}

const NETHERITE_UPGRADES = ['sword', 'shovel', 'pickaxe', 'axe', 'hoe', 'helmet', 'chestplate', 'leggings', 'boots'];

/** UpgradeRecipe (smithing): a diamond item + a netherite ingot → the netherite item, damage kept. */
export function smithingResult(base: ItemStack | null, addition: ItemStack | null): ItemStack | null {
  if (isEmpty(base) || isEmpty(addition) || addition.id !== itemId('netherite_ingot')) return null;
  const n = ITEMS_BY_ID[base.id]?.name ?? '';
  const m = /^diamond_(\w+)$/.exec(n);
  if (!m || !NETHERITE_UPGRADES.includes(m[1]!)) return null;
  const out = itemId(`netherite_${m[1]}`);
  return out ? { id: out, count: 1, damage: base.damage } : null;
}

/** SmithingMenu (ItemCombinerMenu): 0 base, 1 addition, 2 result, 3–29 main, 30–38 hotbar. */
export class SmithingMenu extends Menu {
  readonly inputs = new SimpleContainer(2);
  readonly result = new ResultContainer();
  /** SMITHING_TABLE_USE at the table, set by the server */
  onUse: (() => void) | null = null;
  constructor(id: number, inv: Container, private readonly valid: () => boolean = () => true) {
    super('smithing', id);
    this.inputs.onChange = () => this.createResult();
    this.addSlot(new Slot(this.inputs, 0, 27, 47));
    this.addSlot(new Slot(this.inputs, 1, 76, 47));
    const menu = this;
    this.addSlot(
      new (class extends Slot {
        override mayPlace(): boolean {
          return false;
        }
        override mayPickup(): boolean {
          return menu.result.items[0] !== null;
        }
        override onTake(p: MenuPlayer, st: ItemStack): void {
          // SmithingMenu.onTake: one of each input is used up
          menu.inputs.removeItem(0, 1);
          menu.inputs.removeItem(1, 1);
          menu.onUse?.();
          super.onTake(p, st);
        }
      })(this.result, 0, 134, 47),
    );
    this.addPlayerInventory(inv, 84);
  }
  override stillValid(): boolean {
    return this.valid();
  }
  createResult(): void {
    this.result.items[0] = smithingResult(this.inputs.getItem(0), this.inputs.getItem(1));
  }
  /** hasRecipeError: inputs present but nothing to make (the red cross over the arrow) */
  hasRecipeError(): boolean {
    return (!!this.inputs.getItem(0) || !!this.inputs.getItem(1)) && !this.result.items[0];
  }
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    if (index === 2) {
      if (!this.moveItemStackTo(st, 3, 39, true)) return null;
      slot.onQuickCraft(st, orig);
    } else if (index === 0 || index === 1) {
      if (!this.moveItemStackTo(st, 3, 39, false)) return null;
    } else if (index >= 3 && index < 39) {
      const i = st.id === itemId('netherite_ingot') ? 1 : 0;
      if (!this.moveItemStackTo(st, i, 2, false)) return null;
    }
    if (st.count <= 0) slot.set(null);
    else slot.setChanged();
    if (st.count === orig.count) return null;
    slot.onTake(p, st);
    return orig;
  }
  override removed(p: MenuPlayer): void {
    super.removed(p);
    this.result.items[0] = null;
    for (let i = 0; i < 2; i++) {
      const it = this.inputs.items[i];
      this.inputs.items[i] = null;
      if (!isEmpty(it)) placeBack(p, it);
    }
  }
}

/**
 * GrindstoneMenu.createResult for items without enchantments (stacks carry no enchantment data
 * yet): two of the same damageable item combine with a 5% bonus; one item alone gives nothing.
 */
export function grindstoneResult(a: ItemStack | null, b: ItemStack | null): ItemStack | null {
  // GrindstoneMenu.createResult: repair, strip non-curse enchantments (Phase 7: enchantments.ts)
  return grindstoneOutput(a, b);
}

class GrindstoneInputSlot extends Slot {
  override mayPlace(s: ItemStack): boolean {
    // isDamageableItem || enchanted book || enchanted
    return (ITEMS_BY_ID[s.id]?.maxDurability ?? 0) > 0 || ITEMS_BY_ID[s.id]?.name === 'enchanted_book' || (s.tag?.Enchantments?.length ?? 0) > 0;
  }
}

/** GrindstoneMenu: 0 input, 1 additional, 2 result, 3–29 main, 30–38 hotbar. */
export class GrindstoneMenu extends Menu {
  readonly inputs = new SimpleContainer(2);
  readonly result = new ResultContainer();
  onUse: (() => void) | null = null;
  /** GrindstoneMenu result taken: XP from the inputs' enchantments (set by the server) */
  onExperience: ((a: ItemStack | null, b: ItemStack | null) => void) | null = null;
  constructor(id: number, inv: Container, private readonly valid: () => boolean = () => true) {
    super('grindstone', id);
    this.inputs.onChange = () => (this.result.items[0] = grindstoneResult(this.inputs.getItem(0), this.inputs.getItem(1)));
    this.addSlot(new GrindstoneInputSlot(this.inputs, 0, 49, 19));
    this.addSlot(new GrindstoneInputSlot(this.inputs, 1, 49, 40));
    const menu = this;
    this.addSlot(
      new (class extends Slot {
        override mayPlace(): boolean {
          return false;
        }
        override onTake(p: MenuPlayer, st: ItemStack): void {
          menu.onExperience?.(menu.inputs.getItem(0), menu.inputs.getItem(1));
          menu.inputs.setItem(0, null);
          menu.inputs.setItem(1, null);
          menu.onUse?.();
          super.onTake(p, st);
        }
      })(this.result, 0, 129, 34),
    );
    this.addPlayerInventory(inv, 84);
  }
  override stillValid(): boolean {
    return this.valid();
  }
  quickMoveStack(p: MenuPlayer, index: number): ItemStack | null {
    const slot = this.slots[index];
    const st = slot?.getItem();
    if (!slot || !st) return null;
    const orig = copyStack(st)!;
    const a = this.inputs.getItem(0), b = this.inputs.getItem(1);
    if (index === 2) {
      if (!this.moveItemStackTo(st, 3, 39, true)) return null;
      slot.onQuickCraft(st, orig);
    } else if (index !== 0 && index !== 1) {
      if (a && b) {
        if (index >= 3 && index < 30) {
          if (!this.moveItemStackTo(st, 30, 39, false)) return null;
        } else if (index >= 30 && index < 39 && !this.moveItemStackTo(st, 3, 30, false)) return null;
      } else if (!this.moveItemStackTo(st, 0, 2, false)) return null;
    } else if (!this.moveItemStackTo(st, 3, 39, false)) return null;
    return this.finishQuickMove(slot, st, orig, p);
  }
  override removed(p: MenuPlayer): void {
    super.removed(p);
    this.result.items[0] = null;
    for (let i = 0; i < 2; i++) {
      const it = this.inputs.items[i];
      this.inputs.items[i] = null;
      if (!isEmpty(it)) placeBack(p, it);
    }
  }
}

/** Menu with mirror containers (client prediction for server-opened windows). */
/** Client mirrors for menus defined in other modules (enchanting, brewing): registered at import. */
export const CLIENT_MENU_FACTORIES = new Map<string, (id: number, inv: Container) => Menu>();

export function createClientMenu(type: MenuType, id: number, inv: Container): Menu {
  const extra = CLIENT_MENU_FACTORIES.get(type);
  if (extra) return extra(id, inv);
  switch (type) {
    case 'inventory':
      return new InventoryMenu(inv);
    case 'crafting':
      return new CraftingMenu(id, inv);
    case 'generic_9x3':
      return new ChestMenu(id, inv, new SimpleContainer(27), 3);
    case 'generic_9x6':
      return new ChestMenu(id, inv, new SimpleContainer(54), 6);
    case 'generic_3x3':
      return new DispenserMenu(id, inv, new SimpleContainer(9));
    case 'hopper':
      return new HopperMenu(id, inv, new SimpleContainer(5));
    case 'furnace':
    case 'blast_furnace':
    case 'smoker':
      return new FurnaceMenu(type, id, inv, new SimpleContainer(3));
    case 'stonecutter':
      return new StonecutterMenu(id, inv);
    case 'smithing':
      return new SmithingMenu(id, inv);
    case 'grindstone':
      return new GrindstoneMenu(id, inv);
    case 'enchantment':
    case 'brewing_stand':
      throw new Error(`menu module for ${type} not loaded`);
  }
}

export { InventoryContainer, CompoundContainer, SimpleContainer };
