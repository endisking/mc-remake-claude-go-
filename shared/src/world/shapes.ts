/**
 * Outline ("selection") shapes per block state, in block units. Defaults to the collision
 * shape; blocks without collision but still selectable get their vanilla outline here.
 */
import { BLOCKS, COLLISION_SHAPES, BLOCK_STATE_COUNT } from '../data';
import { COLLISION_SHAPE_ID, FLUID } from './blockinfo';
import { STATE_TO_BLOCK, getProp } from './blockstate';

export type Box = [number, number, number, number, number, number];

const px = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box => [x0 / 16, y0 / 16, z0 / 16, x1 / 16, y1 / 16, z1 / 16];

const FULL: Box[] = [[0, 0, 0, 1, 1, 1]];
const EMPTY: Box[] = [];

function byName(name: string, s: number): Box[] | null {
  if (name === 'grass' || name === 'fern' || name === 'dead_bush') return [px(2, 0, 2, 14, 13, 14)];
  if (name.endsWith('_sapling') || name === 'azalea' || name === 'flowering_azalea') return name.endsWith('_sapling') ? [px(2, 0, 2, 14, 12, 14)] : null;
  if (['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose'].includes(name)) return [px(5, 0, 5, 11, 10, 11)];
  if (name === 'brown_mushroom' || name === 'red_mushroom') return [px(5, 0, 5, 11, 6, 11)];
  if (name === 'crimson_fungus' || name === 'warped_fungus') return [px(4, 0, 4, 12, 9, 12)];
  if (name === 'crimson_roots' || name === 'warped_roots' || name === 'nether_sprouts') return name === 'nether_sprouts' ? [px(0, 0, 0, 16, 3, 16)] : [px(2, 0, 2, 14, 13, 14)];
  if (name === 'torch' || name === 'soul_torch' || name === 'redstone_torch') return [px(6, 0, 6, 10, 10, 10)];
  if (name === 'wall_torch' || name === 'soul_wall_torch' || name === 'redstone_wall_torch') {
    switch (getProp(s, 'facing')) {
      case 'north': return [px(5.5, 3, 11, 10.5, 13, 16)];
      case 'south': return [px(5.5, 3, 0, 10.5, 13, 5)];
      case 'west': return [px(11, 3, 5.5, 16, 13, 10.5)];
      default: return [px(0, 3, 5.5, 5, 13, 10.5)];
    }
  }
  if (name === 'tall_grass' || name === 'large_fern' || name === 'sunflower' || name === 'lilac' || name === 'rose_bush' || name === 'peony') return FULL;
  if (name === 'sugar_cane') return [px(2, 0, 2, 14, 16, 14)];
  if (name === 'wheat' || name === 'carrots' || name === 'potatoes') {
    const age = getProp(s, 'age') as number;
    return [px(0, 0, 0, 16, name === 'wheat' ? 2 + age * 2 : [2, 3, 4, 5, 6, 7, 8, 9][age]!, 16)];
  }
  if (name === 'beetroots') return [px(0, 0, 0, 16, [2, 4, 6, 8][getProp(s, 'age') as number]!, 16)];
  if (name === 'snow') return [px(0, 0, 0, 16, (getProp(s, 'layers') as number) * 2, 16)];
  if (name === 'fire' || name === 'soul_fire') return [px(0, 0, 0, 16, 1, 16)];
  if (name === 'redstone_wire') return [px(0, 0, 0, 16, 1, 16)];
  if (name.endsWith('rail')) {
    const shape = String(getProp(s, 'shape'));
    return shape.startsWith('ascending') ? [px(0, 0, 0, 16, 8, 16)] : [px(0, 0, 0, 16, 2, 16)];
  }
  if (name === 'cobweb' || name === 'structure_void' || name === 'light') return name === 'cobweb' ? FULL : EMPTY;
  if (name === 'tripwire') return [px(0, 1, 0, 16, 2.5, 16)];
  if (name === 'seagrass' || name === 'tall_seagrass') return [px(2, 0, 2, 14, 12, 14)];
  if (name === 'kelp' || name === 'kelp_plant') return [px(0, 0, 0, 16, 16, 16)];
  if (name === 'lily_pad') return [px(1, 0, 1, 15, 1.5, 15)];
  if (name === 'nether_wart') return [px(0, 0, 0, 16, [5, 8, 11, 14][getProp(s, 'age') as number]!, 16)];
  if (name === 'sweet_berry_bush') return getProp(s, 'age') === 0 ? [px(3, 0, 3, 13, 8, 13)] : [px(1, 0, 1, 15, 16, 15)];
  if (name === 'vine' || name === 'glow_lichen') return FULL;
  if (name === 'ladder') {
    switch (getProp(s, 'facing')) {
      case 'north': return [px(0, 0, 13, 16, 16, 16)];
      case 'south': return [px(0, 0, 0, 16, 16, 3)];
      case 'west': return [px(13, 0, 0, 16, 16, 16)];
      default: return [px(0, 0, 0, 3, 16, 16)];
    }
  }
  return null;
}

/** Per-state outline boxes (computed lazily). */
const cache: (Box[] | undefined)[] = new Array(BLOCK_STATE_COUNT);

export function outlineBoxes(state: number): Box[] {
  let b = cache[state];
  if (b) return b;
  const block = BLOCKS[STATE_TO_BLOCK[state]!]!;
  if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') b = EMPTY;
  else if (block.name === 'water' || block.name === 'lava' || block.name === 'bubble_column') b = EMPTY;
  else {
    b = byName(block.name, state) ?? undefined;
    if (!b) {
      const shape = COLLISION_SHAPES[COLLISION_SHAPE_ID[state]!] ?? [];
      b = shape.length ? (shape as Box[]) : block.boundingBox === 'empty' && FLUID[state] === 0 ? [px(0, 0, 0, 16, 16, 16)] : FULL;
    }
  }
  cache[state] = b;
  return b;
}

export function collisionBoxes(state: number): Box[] {
  return (COLLISION_SHAPES[COLLISION_SHAPE_ID[state]!] ?? EMPTY) as Box[];
}
