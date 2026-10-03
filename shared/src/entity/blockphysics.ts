/** Block properties that affect entity movement (vanilla Block properties / tags). */
import { BLOCKS, BLOCK_STATE_COUNT } from '../data';
import { STATE_TO_BLOCK } from '../world/blockstate';

const n = BLOCKS.length;
/** Block friction (slipperiness). */
export const FRICTION = new Float32Array(n).fill(0.6);
/** Horizontal speed factor when standing in/on the block. */
export const SPEED_FACTOR = new Float32Array(n).fill(1);
/** Jump power factor. */
export const JUMP_FACTOR = new Float32Array(n).fill(1);
/** #climbable tag. */
export const CLIMBABLE = new Uint8Array(n);
/** Stuck-speed multiplier (x, y, z) applied while inside, 0 = none. */
export const STUCK = new Float32Array(n * 3);

const byName = (name: string) => BLOCKS.find((b) => b.name === name)?.id;
function set(arr: Float32Array | Uint8Array, names: string[], v: number): void {
  for (const nm of names) {
    const id = byName(nm);
    if (id !== undefined) arr[id] = v;
  }
}

set(FRICTION, ['ice', 'packed_ice', 'frosted_ice'], 0.98);
set(FRICTION, ['blue_ice'], 0.989);
set(FRICTION, ['slime_block'], 0.8);
set(SPEED_FACTOR, ['soul_sand', 'honey_block'], 0.4);
set(JUMP_FACTOR, ['honey_block'], 0.5);
set(CLIMBABLE, ['ladder', 'vine', 'scaffolding', 'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'cave_vines', 'cave_vines_plant'], 1);

function stuck(name: string, x: number, y: number, z: number): void {
  const id = byName(name);
  if (id === undefined) return;
  STUCK[id * 3] = x;
  STUCK[id * 3 + 1] = y;
  STUCK[id * 3 + 2] = z;
}
stuck('cobweb', 0.25, 0.05, 0.25);
stuck('sweet_berry_bush', 0.8, 0.75, 0.8);
stuck('powder_snow', 0.9, 1.5, 0.9);

export function blockIdAt(state: number): number {
  return STATE_TO_BLOCK[state]!;
}

export const STATES = BLOCK_STATE_COUNT;
