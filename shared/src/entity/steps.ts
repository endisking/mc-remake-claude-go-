/**
 * Footstep timing (vanilla Entity.move): moveDist grows by 0.6 per block moved (vertical
 * movement only counts on climbable blocks / powder snow); a step sound plays each time it
 * passes the next whole number, from the block under the feet (getOnPos) — or a swim sound
 * in water.
 */
import { blockNameOf } from '../world/blockstate';
import { CLIMBABLE, blockIdAt } from './blockphysics';
import { FLUID } from '../world/blockinfo';

export interface StepWorld {
  getState(x: number, y: number, z: number): number;
}

export type StepEvent = { kind: 'step'; state: number } | { kind: 'swim' } | null;

export class StepTracker {
  moveDist = 0;
  nextStep = 1;

  /** vanilla getOnPos: the block 0.2 below the feet, or a fence/wall/gate below an air block */
  static onPos(w: StepWorld, x: number, y: number, z: number): [number, number, number] {
    const bx = Math.floor(x), by = Math.floor(y - 0.2), bz = Math.floor(z);
    if (w.getState(bx, by, bz) === 0) {
      const n = blockNameOf(w.getState(bx, by - 1, bz));
      if (n.endsWith('_fence') || n.endsWith('_wall') || n.endsWith('_fence_gate')) return [bx, by - 1, bz];
    }
    return [bx, by, bz];
  }

  update(w: StepWorld, x: number, y: number, z: number, mx: number, my: number, mz: number, inWater: boolean, silent: boolean): StepEvent {
    if (silent) return null;
    const [ox, oy, oz] = StepTracker.onPos(w, x, y, z);
    const on = w.getState(ox, oy, oz);
    const feet = w.getState(Math.floor(x), Math.floor(y), Math.floor(z));
    const climbing = CLIMBABLE[blockIdAt(feet)] === 1 || blockNameOf(feet) === 'powder_snow';
    const dy = climbing ? my : 0;
    this.moveDist += Math.sqrt(mx * mx + dy * dy + mz * mz) * 0.6;
    if (this.moveDist > this.nextStep && on !== 0) {
      this.nextStep = Math.floor(this.moveDist) + 1;
      if (inWater) return { kind: 'swim' };
      if (FLUID[on]) return null;
      // snow layers / powder snow on top of the block make the step sound (INSIDE_STEP_SOUND_BLOCKS)
      const above = w.getState(ox, oy + 1, oz);
      const an = blockNameOf(above);
      return { kind: 'step', state: an === 'snow' || an === 'powder_snow' ? above : on };
    }
    return null;
  }
}
