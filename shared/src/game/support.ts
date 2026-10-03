/** Block survival rules (vanilla Block.canSurvive) for blocks that need support. */
import { blockNameOf, getProp } from '../world/blockstate';
import { FULL_COLLISION } from '../world/blockinfo';
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
    return plantSurvives(name, below) && blockNameOf(world.getState(x, y + 1, z)) === name;
  }
  if (name.endsWith('_door')) {
    if (getProp(state, 'half') === 'upper') return blockNameOf(below) === name;
    return sturdy(below) && blockNameOf(world.getState(x, y + 1, z)) === name;
  }
  if (name === 'wheat' || name === 'carrots' || name === 'potatoes' || name === 'beetroots') return belowName === 'farmland';
  if (name === 'snow') return sturdy(below) && belowName !== 'ice' && belowName !== 'packed_ice' && belowName !== 'barrier';
  if (name.endsWith('_carpet') || name === 'moss_carpet') return belowName !== 'air' && belowName !== 'cave_air' && belowName !== 'void_air';
  if (name.endsWith('_pressure_plate') || name.endsWith('rail') || name === 'redstone_wire' || name === 'repeater' || name === 'comparator') return sturdy(below) || isFenceLike(belowName);
  if (name === 'sugar_cane') return belowName === 'sugar_cane' || ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'sand', 'red_sand'].includes(belowName);
  if (name === 'cactus') return belowName === 'cactus' || belowName === 'sand' || belowName === 'red_sand';
  if (name === 'brown_mushroom' || name === 'red_mushroom') return sturdy(below);
  return true;
}
