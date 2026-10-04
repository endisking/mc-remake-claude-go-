/**
 * Fluid part of ClientLevel.animateTick: 667 × 2 random cells within 16 and 32 blocks of the
 * player per tick; flowing water gurgles (WaterFluid.animateTick) and exposed lava pops and
 * rumbles (LavaFluid.animateTick). Particles (underwater, lava sparks, drips) need particle types
 * the engine doesn't have yet.
 */
import type { BlockWorld } from '@shared/world/world';
import type { JavaRandom } from '@shared/util/random';
import { FLUID_OF, fluidKind, fluidIsSource, fluidIsFalling, KIND_WATER, KIND_LAVA } from '@shared/game/fluids';
import { IS_AIR } from '@shared/world/blockinfo';
import { animateBlockSound, hasBlockAmbience } from './blockambience';

export type PlayBlockSound = (event: string, x: number, y: number, z: number, volume: number, pitch: number) => void;

export function animateFluids(world: BlockWorld, px: number, py: number, pz: number, r: JavaRandom, play: PlayBlockSound): void {
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
  const st = world.getState(x, y, z);
  // Block.animateTick runs before the fluid's (ClientLevel.doAnimateTick)
  if (hasBlockAmbience(st)) animateBlockSound(st, x, y, z, r, play);
  const f = FLUID_OF[st]!;
  if (f === 0) return;
  const kind = fluidKind(f);
  if (kind === KIND_WATER) {
    if (!fluidIsSource(f) && !fluidIsFalling(f)) {
      if (r.nextInt(64) === 0) play('block.water.ambient', x + 0.5, y + 0.5, z + 0.5, r.nextFloat() * 0.25 + 0.75, r.nextFloat() + 0.5);
    } else r.nextInt(10); // underwater particle roll
  } else if (kind === KIND_LAVA) {
    if (IS_AIR[world.getState(x, y + 1, z)] !== 1) return;
    if (r.nextInt(100) === 0) {
      const ox = x + r.nextFloat(), oy = y + 1, oz = z + r.nextFloat();
      play('block.lava.pop', ox, oy, oz, 0.2 + r.nextFloat() * 0.2, 0.9 + r.nextFloat() * 0.15);
    }
    if (r.nextInt(200) === 0) play('block.lava.ambient', x, y, z, 0.2 + r.nextFloat() * 0.2, 0.9 + r.nextFloat() * 0.15);
  }
}
