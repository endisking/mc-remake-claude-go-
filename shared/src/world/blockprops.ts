/** Derived block behaviour flags (vanilla BlockBehaviour.Properties predicates). */
import { FULL_COLLISION, COLLISION_SHAPE_ID } from './blockinfo';
import { BLOCK_STATE_COUNT } from '../data';
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
  const n = blockNameOf(state);
  return n.endsWith('_bed') || OPENABLE_CONTAINERS.has(n);
}

/** Container blocks whose menus are implemented (server Containers.useBlock). */
const OPENABLE_CONTAINERS = new Set(['crafting_table', 'chest', 'trapped_chest', 'ender_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker', 'dispenser', 'dropper', 'hopper']);

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

// Blocks with a collision shape whose vanilla Material is noCollider (plant, decoration, cloth
// decoration, top snow): they don't block motion for heightmaps
function noColliderMaterial(n: string): boolean {
  return n.endsWith('_carpet') || n === 'lily_pad' || n === 'scaffolding' || n === 'snow' || n === 'end_rod' || n === 'flower_pot' ||
    n.startsWith('potted_') || n === 'candle' || n.endsWith('_candle') || n === 'ladder' || n === 'repeater' || n === 'comparator' ||
    n === 'sea_pickle' || n.endsWith('_skull') || n.endsWith('_head') || n === 'big_dripleaf' || n === 'azalea' || n === 'flowering_azalea' ||
    n === 'cocoa' || n === 'chorus_plant' || n === 'chorus_flower';
}

/** Material.blocksMotion per state (heightmaps MOTION_BLOCKING / OCEAN_FLOOR). */
export const MATERIAL_BLOCKS_MOTION = new Uint8Array(BLOCK_STATE_COUNT);
/** Material.isSolid per state (cave column scans, some feature checks). */
export const MATERIAL_SOLID = new Uint8Array(BLOCK_STATE_COUNT);
for (let s = 0; s < BLOCK_STATE_COUNT; s++) {
  const n = blockNameOf(s);
  const motion = (COLLISION_SHAPE_ID[s] !== 0 && !noColliderMaterial(n)) || n === 'powder_snow';
  MATERIAL_BLOCKS_MOTION[s] = motion ? 1 : 0;
  MATERIAL_SOLID[s] = motion && n !== 'powder_snow' ? 1 : 0;
}
