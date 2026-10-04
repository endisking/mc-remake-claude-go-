/**
 * Pure block-behaviour rules shared by the server (and tests): crop growth speed, grass survival,
 * leaf distance, farmland moisture, falling-block freedom, concrete powder solidifying and the
 * sapling → configured tree choice. Numbers and formulas follow the 1.17.1 block classes.
 */
import { blockNameOf, getProp } from '../world/blockstate';
import { FLUID, FLUID_LEVEL, FULL_COLLISION, IS_AIR, LIGHT_FILTER, LIGHT_FACE_OCCLUSION, USE_SHAPE_LIGHT } from '../world/blockinfo';
import type { StateGetter } from '../world/raycast';
import { MATERIAL_SOLID } from '../world/blockprops';

/** The random source the rules draw from (JavaRandom-compatible). */
export interface Rand {
  nextInt(n: number): number;
  nextFloat(): number;
  nextBoolean(): boolean;
}

// ------------------------------------------------------------------ crops
export const CROP_MAX_AGE: Record<string, number> = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };

/** CropBlock.getGrowthSpeed (also used by stems): farmland under and around, halved by crowding. */
export function growthSpeed(w: StateGetter, x: number, y: number, z: number, block: string): number {
  let f = 1;
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      let g = 0;
      const s = w.getState(x + i, y - 1, z + j);
      if (blockNameOf(s) === 'farmland') {
        g = 1;
        if ((getProp(s, 'moisture') as number) > 0) g = 3;
      }
      if (i !== 0 || j !== 0) g /= 4;
      f += g;
    }
  const is = (dx: number, dz: number) => blockNameOf(w.getState(x + dx, y, z + dz)) === block;
  const ew = is(-1, 0) || is(1, 0);
  const ns = is(0, -1) || is(0, 1);
  if (ew && ns) f /= 2;
  else if (is(-1, -1) || is(1, -1) || is(1, 1) || is(-1, 1)) f /= 2;
  return f;
}

/** CropBlock.randomTick chance: 1 in (int)(25 / speed) + 1. */
export function growthChanceDenominator(speed: number): number {
  return Math.trunc(Math.fround(25 / Math.fround(speed))) + 1;
}

/** CropBlock.getBonemealAgeIncrease: Mth.nextInt(2, 5); beetroots divide it by 3. */
export function bonemealAgeIncrease(block: string, r: Rand): number {
  const n = 2 + r.nextInt(4);
  return block === 'beetroots' ? Math.trunc(n / 3) : n;
}

// ------------------------------------------------------------------ grass / mycelium
/**
 * SpreadingSnowyDirtBlock.canBeGrass: a single snow layer is fine, a full fluid above kills it,
 * otherwise the block above must not block light into the top face (opaque cubes, bottom slabs...).
 */
export function canBeGrass(w: StateGetter, x: number, y: number, z: number): boolean {
  const above = w.getState(x, y + 1, z);
  const n = blockNameOf(above);
  if (n === 'snow' && getProp(above, 'layers') === 1) return true;
  if (FLUID[above] !== 0 && (FLUID_LEVEL[above] === 0 || FLUID_LEVEL[above]! >= 8)) return false;
  if (LIGHT_FILTER[above]! >= 15) return false;
  // getLightBlockInto: the shape of the block above covers our top face
  if (USE_SHAPE_LIGHT[above] === 1 && (LIGHT_FACE_OCCLUSION[above]! & (1 << 0)) !== 0) return false;
  return true;
}

/** SpreadingSnowyDirtBlock.canPropagate: canBeGrass and no water above. */
export function canPropagateGrass(w: StateGetter, x: number, y: number, z: number): boolean {
  return canBeGrass(w, x, y, z) && FLUID[w.getState(x, y + 1, z)] !== 1;
}

// ------------------------------------------------------------------ leaves
/** BlockTags.LOGS (1.17.1): logs, wood, stems and hyphae, stripped or not. */
export function isLog(n: string): boolean {
  return /_log$|_wood$|_hyphae$|^(stripped_)?(crimson|warped)_stem$/.test(n);
}

/** BlockTags.FLOWERS (1.17.1) */
const FLOWERS_TAG = new Set([
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
  'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'peony', 'rose_bush', 'flowering_azalea_leaves', 'flowering_azalea',
]);

/** LeavesBlock.getDistanceAt */
export function distanceAt(s: number): number {
  if (isLog(blockNameOf(s))) return 0;
  if (blockNameOf(s).endsWith('_leaves')) return getProp(s, 'distance') as number;
  return 7;
}

/** LeavesBlock.updateDistance: 1 + the smallest neighbour distance, capped at 7. */
export function leavesDistance(w: StateGetter, x: number, y: number, z: number): number {
  let d = 7;
  const N = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]] as const;
  for (const [dx, dy, dz] of N) {
    d = Math.min(d, distanceAt(w.getState(x + dx, y + dy, z + dz)) + 1);
    if (d === 1) break;
  }
  return d;
}

/** LeavesBlock.isRandomlyTicking / decaying: distance 7 and not player-placed. */
export function leavesDecaying(s: number): boolean {
  return getProp(s, 'distance') === 7 && getProp(s, 'persistent') === false;
}

// ------------------------------------------------------------------ farmland
/** FarmBlock.isNearWater: water anywhere in x±4, y..y+1, z±4. */
export function farmlandNearWater(w: StateGetter, x: number, y: number, z: number): boolean {
  for (let dx = -4; dx <= 4; dx++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = -4; dz <= 4; dz++) if (FLUID[w.getState(x + dx, y + dy, z + dz)] === 1) return true;
  return false;
}

/** BlockTags.MAINTAINS_FARMLAND (1.17.1: crops and stems). */
export function maintainsFarmland(s: number): boolean {
  const n = blockNameOf(s);
  return n in CROP_MAX_AGE || n === 'melon_stem' || n === 'pumpkin_stem' || n === 'attached_melon_stem' || n === 'attached_pumpkin_stem';
}

/** FarmBlock.canSurvive: nothing solid on top (fence gates and moving pistons are fine). */
export function farmlandSurvives(w: StateGetter, x: number, y: number, z: number): boolean {
  const above = w.getState(x, y + 1, z);
  const n = blockNameOf(above);
  if (n.endsWith('_fence_gate') || n === 'moving_piston') return true;
  return !materialSolid(above);
}

/** FarmBlock.fallOn: trample chance for a fall distance (nextFloat() < distance − 0.5). */
export function trampleChance(fallDistance: number): number {
  return Math.max(0, Math.min(1, fallDistance - 0.5));
}

// ------------------------------------------------------------------ falling blocks
export const GRAVITY_BLOCKS = new Set(['sand', 'red_sand', 'gravel', 'anvil', 'chipped_anvil', 'damaged_anvil', 'dragon_egg']);
export function isGravityBlock(name: string): boolean {
  return GRAVITY_BLOCKS.has(name) || name.endsWith('_concrete_powder');
}

const REPLACEABLE_MATERIAL = new Set([
  'air', 'cave_air', 'void_air', 'water', 'lava', 'bubble_column', 'grass', 'fern', 'dead_bush', 'vine', 'glow_lichen', 'tall_grass',
  'large_fern', 'seagrass', 'tall_seagrass', 'fire', 'soul_fire', 'structure_void', 'light', 'crimson_roots', 'warped_roots',
  'nether_sprouts', 'hanging_roots', 'snow',
]);

/** FallingBlock.isFree: air, fire, liquids and replaceable materials (any snow layer). */
export function fallingIsFree(s: number): boolean {
  return IS_AIR[s] === 1 || (FLUID[s] !== 0 && !waterloggable(s)) || REPLACEABLE_MATERIAL.has(blockNameOf(s));
}
function waterloggable(s: number): boolean {
  return getProp(s, 'waterlogged') !== undefined;
}

/** ConcretePowderBlock.touchesLiquid: water next to it (not below) through a non-sturdy face. */
export function touchesWater(w: StateGetter, x: number, y: number, z: number): boolean {
  const N = [[0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]] as const;
  for (const [dx, dy, dz] of N) {
    const s = w.getState(x + dx, y + dy, z + dz);
    if (FLUID[s] === 1 && FULL_COLLISION[s] !== 1) return true;
  }
  return false;
}

export function concreteOf(powder: string): string {
  return powder.replace('_concrete_powder', '_concrete');
}

// ------------------------------------------------------------------ saplings
/** The tree a sapling grows (AbstractTreeGrower subclasses); `mega` = part of a 2×2. */
export function treeForSapling(sapling: string, r: Rand, hasFlowers: boolean, mega: boolean): string | null {
  switch (sapling) {
    case 'oak_sapling':
      if (r.nextInt(10) === 0) return hasFlowers ? 'fancy_oak_bees_005' : 'fancy_oak';
      return hasFlowers ? 'oak_bees_005' : 'oak';
    case 'birch_sapling':
      return hasFlowers ? 'birch_bees_005' : 'birch';
    case 'spruce_sapling':
      return mega ? (r.nextBoolean() ? 'mega_spruce' : 'mega_pine') : 'spruce';
    case 'jungle_sapling':
      return mega ? 'mega_jungle_tree' : 'jungle_tree_no_vine';
    case 'acacia_sapling':
      return 'acacia';
    case 'dark_oak_sapling':
      return mega ? 'dark_oak' : null;
    case 'azalea':
    case 'flowering_azalea':
      return 'azalea_tree';
  }
  return null;
}

/** Saplings with a 2×2 (mega) variant (AbstractMegaTreeGrower). */
export const MEGA_SAPLINGS = new Set(['spruce_sapling', 'jungle_sapling', 'dark_oak_sapling']);

/** AbstractTreeGrower.hasFlowers: a flower in x±2, y−1..y+1, z±2. */
export function hasFlowersNear(w: StateGetter, x: number, y: number, z: number): boolean {
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -1; dy <= 1; dy++) for (let dz = -2; dz <= 2; dz++) if (FLOWERS_TAG.has(blockNameOf(w.getState(x + dx, y + dy, z + dz)))) return true;
  return false;
}

/** AbstractMegaTreeGrower: the north-west corner offset of a 2×2 the sapling belongs to, if any. */
export function megaOffset(w: StateGetter, x: number, y: number, z: number, sapling: string): [number, number] | null {
  const is = (dx: number, dz: number) => blockNameOf(w.getState(x + dx, y, z + dz)) === sapling;
  for (let i = 0; i >= -1; i--)
    for (let j = 0; j >= -1; j--) if (is(i, j) && is(i + 1, j) && is(i, j + 1) && is(i + 1, j + 1)) return [i, j];
  return null;
}

// ------------------------------------------------------------------ misc
export function materialSolid(s: number): boolean {
  return MATERIAL_SOLID[s] === 1;
}
