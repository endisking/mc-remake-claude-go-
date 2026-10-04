import { describe, it, expect } from 'vitest';
import { JavaRandom } from '@shared/util/random';
import { stateOf } from '@shared/world/blockstate';
import { animateBlockSound, hasBlockAmbience } from './blockambience';

function run(state: number, n: number): Map<string, number> {
  const r = new JavaRandom(42n);
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) animateBlockSound(state, 0, 64, 0, r, (e) => out.set(e, (out.get(e) ?? 0) + 1));
  return out;
}

describe('block animateTick sounds', () => {
  it('fire crackles about 1 in 24 visits', () => {
    const c = run(stateOf('fire'), 24000).get('block.fire.ambient') ?? 0;
    expect(c).toBeGreaterThan(800);
    expect(c).toBeLessThan(1200);
  });

  it('only lit furnaces and campfires play, at 10%', () => {
    expect(hasBlockAmbience(stateOf('furnace', { lit: false }))).toBe(false);
    const lit = stateOf('furnace', { lit: true });
    const c = run(lit, 10000).get('block.furnace.fire_crackle') ?? 0;
    expect(c).toBeGreaterThan(850);
    expect(c).toBeLessThan(1150);
    expect(run(stateOf('campfire', { lit: true }), 1000).has('block.campfire.crackle')).toBe(true);
    expect(hasBlockAmbience(stateOf('campfire', { lit: false }))).toBe(false);
  });

  it('bubble columns pick the whirlpool or upwards sound by drag', () => {
    expect([...run(stateOf('bubble_column', { drag: true }), 4000).keys()]).toEqual(['block.bubble_column.whirlpool_ambient']);
    expect([...run(stateOf('bubble_column', { drag: false }), 4000).keys()]).toEqual(['block.bubble_column.upwards_ambient']);
  });

  it('stone is silent', () => {
    expect(hasBlockAmbience(stateOf('stone'))).toBe(false);
  });
});
