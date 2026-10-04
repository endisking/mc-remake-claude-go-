/**
 * Block part of ClientLevel.animateTick for cooking blocks: lit furnaces crackle
 * (AbstractFurnaceBlock.animateTick: 10% of display ticks), smokers hiss, blast furnaces roar,
 * lit campfires crackle (1 in 10). Same 667 × 2 random cells within 16/32 blocks as vanilla.
 * (Smoke/flame particles need particle types the engine doesn't have yet.)
 */
import type { BlockWorld } from '@shared/world/world';
import type { JavaRandom } from '@shared/util/random';
import { BLOCKS_BY_NAME } from '@shared/data';
import { getProp } from '@shared/world/blockstate';
import type { PlayBlockSound } from './fluidambience';

const SOUND = new Map<number, string>();
for (const [name, ev] of [['furnace', 'block.furnace.fire_crackle'], ['blast_furnace', 'block.blastfurnace.fire_crackle'], ['smoker', 'block.smoker.smoke'], ['campfire', 'block.campfire.crackle'], ['soul_campfire', 'block.campfire.crackle']] as const) {
  const b = BLOCKS_BY_NAME.get(name);
  if (!b) continue;
  for (let s = b.minStateId; s <= b.maxStateId; s++) if (getProp(s, 'lit') === true) SOUND.set(s, ev);
}

export function animateCookingBlocks(world: BlockWorld, px: number, py: number, pz: number, r: JavaRandom, play: PlayBlockSound): void {
  const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
  for (let l = 0; l < 667; l++) {
    cell(world, bx, by, bz, 16, r, play);
    cell(world, bx, by, bz, 32, r, play);
  }
}

function cell(world: BlockWorld, bx: number, by: number, bz: number, range: number, r: JavaRandom, play: PlayBlockSound): void {
  const x = bx + r.nextInt(range) - r.nextInt(range);
  const y = by + r.nextInt(range) - r.nextInt(range);
  const z = bz + r.nextInt(range) - r.nextInt(range);
  const ev = SOUND.get(world.getState(x, y, z));
  if (!ev) return;
  if (ev === 'block.campfire.crackle') {
    if (r.nextInt(10) === 0) play(ev, x + 0.5, y + 0.5, z + 0.5, 0.5 + r.nextFloat(), r.nextFloat() * 0.7 + 0.6);
  } else if (r.nextDouble() < 0.1) play(ev, x + 0.5, y, z + 0.5, 1, 1);
}
