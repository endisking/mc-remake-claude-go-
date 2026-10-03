import { describe, it, expect } from 'vitest';
import { StepTracker } from './steps';
import { stateOf } from '../world/blockstate';

function world(blocks: Record<string, number>) {
  return { getState: (x: number, y: number, z: number) => blocks[`${x},${y},${z}`] ?? 0 };
}

describe('footsteps', () => {
  it('a step every 1/0.6 blocks walked, from the block under the feet', () => {
    const stone = stateOf('stone');
    const blocks: Record<string, number> = {};
    for (let x = 0; x < 20; x++) blocks[`${x},0,0`] = stone;
    const w = world(blocks);
    const t = new StepTracker();
    let steps = 0;
    for (let i = 0; i < 100; i++) {
      const ev = t.update(w, 0.5 + i * 0.1, 1, 0.5, 0.1, 0, 0, false, false);
      if (ev?.kind === 'step') {
        expect(ev.state).toBe(stone);
        steps++;
      }
    }
    // 10 blocks × 0.6 = 6 units of moveDist → steps at 1..6 (the first once moveDist passes 1)
    expect(steps).toBe(5);
  });
  it('snow layers on top make the step sound; sneaking on the ground is silent', () => {
    const blocks: Record<string, number> = { '0,0,0': stateOf('grass_block'), '0,1,0': stateOf('snow') };
    const w = world(blocks);
    const t = new StepTracker();
    let ev = null;
    for (let i = 0; i < 20 && !ev; i++) ev = t.update(w, 0.5, 1.125, 0.5, 0.2, 0, 0, false, false);
    expect(ev).toEqual({ kind: 'step', state: stateOf('snow') });
    const s = new StepTracker();
    for (let i = 0; i < 20; i++) expect(s.update(w, 0.5, 1.125, 0.5, 0.2, 0, 0, false, true)).toBeNull();
  });
  it('vertical movement only counts on climbable blocks', () => {
    const w = world({ '0,0,0': stateOf('stone'), '0,1,0': stateOf('ladder') });
    const t = new StepTracker();
    let n = 0;
    for (let i = 0; i < 20; i++) if (t.update(w, 0.5, 1.2, 0.5, 0, 0.2, 0, false, false)) n++;
    expect(n).toBeGreaterThan(0);
    const air = world({ '0,0,0': stateOf('stone') });
    const u = new StepTracker();
    for (let i = 0; i < 20; i++) expect(u.update(air, 0.5, 1.2, 0.5, 0, 0.2, 0, false, false)).toBeNull();
  });
});
