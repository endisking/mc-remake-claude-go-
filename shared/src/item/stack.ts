/** Item stacks and the player inventory layout (vanilla Inventory slot numbering). */
import { ITEMS_BY_ID, ITEMS_BY_NAME, AIR_ITEM_ID } from '../data';

export interface ItemStack {
  /** item id (minecraft-data 1.17.1 numbering) */
  id: number;
  count: number;
  /** damage taken (durability used) */
  damage: number;
}

export const AIR_ITEM = AIR_ITEM_ID;

export function stack(name: string, count = 1): ItemStack {
  if (name === 'air') return { id: AIR_ITEM, count: 0, damage: 0 };
  const it = ITEMS_BY_NAME.get(name);
  if (!it) throw new Error(`unknown item ${name}`);
  return { id: it.id, count, damage: 0 };
}

export function isEmpty(s: ItemStack | null | undefined): s is null | undefined {
  return !s || s.count <= 0 || s.id === AIR_ITEM;
}

export function maxStackSize(id: number): number {
  return ITEMS_BY_ID[id]?.stackSize ?? 64;
}

export function itemName(id: number): string {
  return ITEMS_BY_ID[id]?.name ?? 'air';
}

export function sameItem(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && a.damage === b.damage;
}

/**
 * Player inventory: slots 0–8 hotbar, 9–35 main, 36–39 armor (boots, legs, chest, head),
 * 40 offhand.
 */
export class Inventory {
  readonly slots: (ItemStack | null)[] = new Array(41).fill(null);
  selected = 0;

  get selectedStack(): ItemStack | null {
    return this.slots[this.selected] ?? null;
  }

  get(i: number): ItemStack | null {
    return this.slots[i] ?? null;
  }

  set(i: number, s: ItemStack | null): void {
    this.slots[i] = isEmpty(s) ? null : s;
  }

  /** Add a stack, filling matching stacks first, then empty slots (hotbar first). Returns the leftover count. */
  add(s: ItemStack): number {
    let left = s.count;
    const max = maxStackSize(s.id);
    // vanilla getSlotWithRemainingSpace: the selected slot first, then 0..35
    const order = [this.selected, ...Array.from({ length: 36 }, (_, i) => i).filter((i) => i !== this.selected)];
    for (const i of order) {
      if (left <= 0) break;
      const cur = this.slots[i];
      if (cur && sameItem(cur, s) && cur.count < max) {
        const n = Math.min(left, max - cur.count);
        cur.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { id: s.id, count: n, damage: s.damage };
        left -= n;
      }
    }
    return left;
  }

  /** Find a slot holding this item (hotbar first), or -1. */
  find(id: number): number {
    for (let i = 0; i < 36; i++) if (this.slots[i]?.id === id) return i;
    return -1;
  }
}
