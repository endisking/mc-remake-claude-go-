/** Block survival rules (vanilla Block.canSurvive) for blocks that need support. */
import { blockNameOf, getProp } from '../world/blockstate';
import { FULL_COLLISION, FLUID } from '../world/blockinfo';
import { MATERIAL_SOLID } from '../world/blockprops';
import type { StateGetter } from '../world/raycast';
import { plantSurvives, DIRS, DX, DY, DZ } from './placement';

const sturdy = (s: number) => FULL_COLLISION[s] === 1;
const isFenceLike = (n: string) => n.endsWith('_fence') || (n.endsWith('_wall') && !n.includes('torch') && !n.includes('sign') && !n.includes('banner'));

const FLOWERS_AND_PLANTS = new Set([
  'grass', 'fern', 'dead_bush', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
  'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'oak_sapling', 'spruce_sapling', 'birch_sapling',
  'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling',
]);
const TALL_PLANTS = new Set(['tall_grass', 'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony']);

export function canSurvive(world: StateGetter, x: number, y: number, z: number, state: number): boolean {
  const name = blockNameOf(state);
  const below = world.getState(x, y - 1, z);
  const belowName = blockNameOf(below);
  if (name === 'torch' || name === 'soul_torch' || name === 'redstone_torch') return sturdy(below) || isFenceLike(belowName);
  if (name === 'wall_torch' || name === 'soul_wall_torch' || name === 'redstone_wall_torch' || name === 'ladder') {
    const f = DIRS.indexOf(getProp(state, 'facing') as (typeof DIRS)[number]);
    return sturdy(world.getState(x - DX[f]!, y - DY[f]!, z - DZ[f]!));
  }
  if (name.endsWith('_button') || name === 'lever') {
    const face = getProp(state, 'face');
    if (face === 'floor') return sturdy(below);
    if (face === 'ceiling') return sturdy(world.getState(x, y + 1, z));
    const f = DIRS.indexOf(getProp(state, 'facing') as (typeof DIRS)[number]);
    return sturdy(world.getState(x - DX[f]!, y, z - DZ[f]!));
  }
  if (FLOWERS_AND_PLANTS.has(name)) return plantSurvives(name, below);
  if (TALL_PLANTS.has(name)) {
    if (getProp(state, 'half') === 'upper') return blockNameOf(below) === name;
    // DoublePlantBlock.canSurvive: the lower half only needs its soil (a missing top is updateShape's job)
    return plantSurvives(name, below);
  }
  if (name.endsWith('_door')) {
    if (getProp(state, 'half') === 'upper') return blockNameOf(below) === name;
    return sturdy(below);
  }
  if (name === 'wheat' || name === 'carrots' || name === 'potatoes' || name === 'beetroots') {
    // CropBlock.canSurvive: raw brightness ≥ 8 (or open sky) where light is known
    const lit = world as Partial<{ getLight(x: number, y: number, z: number): number }>;
    if (lit.getLight) {
      const l = lit.getLight(x, y, z);
      if (Math.max(l >> 4, l & 15) < 8) return false;
    }
    return belowName === 'farmland';
  }
  if (name === 'snow') return sturdy(below) && belowName !== 'ice' && belowName !== 'packed_ice' && belowName !== 'barrier';
  if (name.endsWith('_carpet') || name === 'moss_carpet') return belowName !== 'air' && belowName !== 'cave_air' && belowName !== 'void_air';
  if (name.endsWith('_pressure_plate') || name.endsWith('rail') || name === 'redstone_wire' || name === 'repeater' || name === 'comparator') return sturdy(below) || isFenceLike(belowName);
  if (name === 'sugar_cane') {
    // SugarCaneBlock.canSurvive: on cane, or on dirt/sand next to water (or frosted ice)
    if (belowName === 'sugar_cane') return true;
    if (!['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mycelium', 'sand', 'red_sand'].includes(belowName)) return false;
    for (let d = 2; d < 6; d++) {
      const n = world.getState(x + DX[d]!, y - 1, z + DZ[d]!);
      if (FLUID[n] === 1 || blockNameOf(n) === 'frosted_ice') return true;
    }
    return false;
  }
  if (name === 'cactus') {
    // CactusBlock.canSurvive: nothing solid (or lava) beside it, no liquid above
    for (let d = 2; d < 6; d++) {
      const n = world.getState(x + DX[d]!, y, z + DZ[d]!);
      if (MATERIAL_SOLID[n] === 1 || FLUID[n] === 2) return false;
    }
    if (FLUID[world.getState(x, y + 1, z)] !== 0) return false;
    return belowName === 'cactus' || belowName === 'sand' || belowName === 'red_sand';
  }
  if (name === 'nether_wart') return belowName === 'soul_sand';
  if (name === 'sweet_berry_bush') return ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mycelium', 'farmland'].includes(belowName);
  if (name === 'cocoa') {
    const f = DIRS.indexOf(getProp(state, 'facing') as (typeof DIRS)[number]);
    return /^(stripped_)?jungle_(log|wood)$/.test(blockNameOf(world.getState(x + DX[f]!, y, z + DZ[f]!)));
  }
  if (name === 'melon_stem' || name === 'pumpkin_stem' || name === 'attached_melon_stem' || name === 'attached_pumpkin_stem') return belowName === 'farmland';
  if (name.endsWith('_wall_sign')) {
    const f = DIRS.indexOf(getProp(state, 'facing') as (typeof DIRS)[number]);
    return MATERIAL_SOLID[world.getState(x - DX[f]!, y, z - DZ[f]!)] === 1;
  }
  if (name.endsWith('_sign')) return MATERIAL_SOLID[below] === 1;
  if (name === 'brown_mushroom' || name === 'red_mushroom') return sturdy(below);
  return true;
}
