/** Derived block behaviour flags (vanilla BlockBehaviour.Properties predicates). */
import { FULL_COLLISION } from './blockinfo';
import { blockNameOf } from './blockstate';

/**
 * isSuffocating / isViewBlocking: full collision cubes, except glass and leaves which opt out
 * (isSuffocating(never), isViewBlocking(never)).
 */
export function isSuffocating(state: number): boolean {
  if (FULL_COLLISION[state] !== 1) return false;
  const n = blockNameOf(state);
  return !(n === 'glass' || n === 'tinted_glass' || n.endsWith('_stained_glass') || n.endsWith('_leaves'));
}

export const isViewBlocking = isSuffocating;

/**
 * Blocks whose BlockState.use consumes a right click (so nothing is placed against them unless
 * sneaking with an item in hand). Grows as block interactions are implemented.
 */
export function isInteractive(state: number): boolean {
  return blockNameOf(state).endsWith('_bed');
}

const MENU_PROVIDERS = new Set([
  'crafting_table', 'chest', 'trapped_chest', 'furnace', 'blast_furnace', 'smoker', 'dispenser', 'dropper', 'hopper',
  'brewing_stand', 'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil', 'beacon', 'barrel', 'loom',
  'cartography_table', 'grindstone', 'stonecutter', 'smithing_table', 'lectern', 'shulker_box',
]);

/**
 * BlockState.getMenuProvider != null: blocks that open a container screen (spectators see the
 * outline and crosshair only on these).
 */
export function hasMenuProvider(state: number): boolean {
  const n = blockNameOf(state);
  return MENU_PROVIDERS.has(n) || n.endsWith('_shulker_box');
}
