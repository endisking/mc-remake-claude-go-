/**
 * Model showcase scene for visual checks: a stone platform at y=100 near the origin with
 * one example of every model shape. Enabled with the `scene=models` world option.
 */
import type { Chunk } from '../world/chunk';
import { stateOf, type Props } from '../world/blockstate';

type Placement = [number, number, number, string, Props?];

function placements(): Placement[] {
  const p: Placement[] = [];
  const Y = 101;
  let x = 2;
  const next = (w = 2) => {
    const v = x;
    x += w;
    return v;
  };
  // stairs: straight, plus an L corner (inner/outer shapes)
  let s = next(3);
  p.push([s, Y, 2, 'oak_stairs', { facing: 'east' }], [s + 1, Y, 2, 'oak_stairs', { facing: 'north', shape: 'outer_right' }]);
  p.push([s, Y, 4, 'oak_stairs', { facing: 'east', half: 'top' }], [s, Y, 6, 'oak_stairs', { facing: 'south', shape: 'inner_left' }]);
  s = next();
  p.push([s, Y, 2, 'stone_slab', { type: 'bottom' }], [s, Y, 4, 'stone_slab', { type: 'top' }], [s, Y, 6, 'stone_slab', { type: 'double' }]);
  s = next(4);
  p.push([s, Y, 2, 'oak_fence', { east: true }], [s + 1, Y, 2, 'oak_fence', { west: true, east: true }], [s + 2, Y, 2, 'oak_fence', { west: true, south: true }], [s + 2, Y, 3, 'oak_fence', { north: true }]);
  p.push([s, Y, 5, 'cobblestone_wall', { east: 'low', up: true }], [s + 1, Y, 5, 'cobblestone_wall', { west: 'low', east: 'tall', up: false }], [s + 2, Y, 5, 'cobblestone_wall', { west: 'tall', up: true }]);
  p.push([s, Y, 7, 'glass_pane', { east: true }], [s + 1, Y, 7, 'glass_pane', { west: true, east: true }], [s + 2, Y, 7, 'glass_pane', { west: true, south: true }]);
  s = next(3);
  p.push([s, Y, 2, 'oak_door', { half: 'lower', facing: 'south' }], [s, Y + 1, 2, 'oak_door', { half: 'upper', facing: 'south' }]);
  p.push([s + 1, Y, 2, 'oak_door', { half: 'lower', facing: 'south', open: true }], [s + 1, Y + 1, 2, 'oak_door', { half: 'upper', facing: 'south', open: true }]);
  p.push([s, Y, 5, 'oak_trapdoor', { facing: 'south' }], [s + 1, Y, 5, 'oak_trapdoor', { facing: 'south', open: true }], [s, Y, 7, 'oak_trapdoor', { half: 'top' }]);
  s = next(3);
  p.push([s, Y, 2, 'torch'], [s + 1, Y, 3, 'cobblestone'], [s + 1, Y, 2, 'wall_torch', { facing: 'north' }]);
  p.push([s, Y, 5, 'rail', { shape: 'north_south' }], [s, Y, 6, 'rail', { shape: 'ascending_south' }], [s, Y, 7, 'cobblestone'], [s + 1, Y, 5, 'rail', { shape: 'east_west' }]);
  s = next(3);
  p.push([s, Y, 3, 'cobblestone'], [s, Y, 2, 'ladder', { facing: 'north' }], [s + 1, Y, 3, 'cobblestone'], [s + 1, Y, 2, 'vine', { south: true }]);
  s = next(9);
  for (let a = 0; a < 8; a++) p.push([s + a, Y - 1, 5, 'farmland', { moisture: 7 }], [s + a, Y, 5, 'wheat', { age: a }]);
  for (let n = 1; n <= 8; n++) p.push([s + n - 1, Y, 7, 'snow', { layers: n }]);
  p.push([s, Y, 2, 'cactus'], [s, Y + 1, 2, 'cactus'], [s + 2, Y, 2, 'white_carpet'], [s + 3, Y, 2, 'stone_pressure_plate'], [s + 4, Y, 2, 'stone_button', { face: 'floor' }]);
  p.push([s + 5, Y, 3, 'cobblestone'], [s + 5, Y, 2, 'stone_button', { face: 'wall', facing: 'north' }], [s + 6, Y, 2, 'lever', { face: 'floor', facing: 'north' }]);
  s = next(3);
  p.push([s, Y, 2, 'grass'], [s + 1, Y, 2, 'poppy'], [s, Y, 4, 'dandelion'], [s, Y, 6, 'glass'], [s + 1, Y, 6, 'glass'], [s, Y, 8, 'ice']);
  // water pool and lava pool
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) p.push([2 + dx, Y - 1, 10 + dz, 'water'], [8 + dx, Y - 1, 10 + dz, 'lava']);
  p.push([3, Y, 11, 'water', { level: 0 }]);
  return p;
}

const PLACEMENTS = placements();
const MAX_X = 48;

export function applyShowcase(c: Chunk): void {
  const bx = c.x << 4, bz = c.z << 4;
  if (bz !== 0 || bx < 0 || bx >= MAX_X) return;
  const stone = stateOf('stone');
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      c.setState(x, 100, z, stone);
      for (let y = 101; y < 110; y++) c.setState(x, y, z, 0);
    }
  for (const [x, y, z, name, props] of PLACEMENTS) {
    if (x < bx || x >= bx + 16) continue;
    c.setState(x - bx, y, z - bz, stateOf(name, props));
  }
}
