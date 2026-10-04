/**
 * Saved toolbars (vanilla HotbarManager / hotbar.nbt): nine saved hotbars for creative mode,
 * saved with C + number and restored with X + number, kept in the browser's local storage.
 */
import type { ItemStack } from '@shared/item/stack';

const KEY = 'blockcraft.hotbars';

export type SavedHotbar = (ItemStack | null)[];

let cache: SavedHotbar[] | null = null;

export function savedHotbars(): SavedHotbar[] {
  if (cache) return cache;
  let rows: SavedHotbar[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) rows = JSON.parse(raw) as SavedHotbar[];
  } catch {
    rows = [];
  }
  cache = Array.from({ length: 9 }, (_, i) => Array.from({ length: 9 }, (_, j) => rows[i]?.[j] ?? null));
  return cache;
}

export function saveHotbar(row: number, items: SavedHotbar): void {
  const all = savedHotbars();
  all[row] = items.map((s) => (s && s.count > 0 ? { id: s.id, count: s.count, damage: s.damage } : null));
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage unavailable (private window): kept for this session only
  }
}

export function isEmptyHotbar(row: SavedHotbar): boolean {
  return row.every((s) => !s);
}
