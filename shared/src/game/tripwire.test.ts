import { describe, it, expect } from 'vitest';
import { getProp, stateOf } from '../world/blockstate';
import { tripwireChanged, tripwireTick, wireEntityInside, disarmTripwire, type TripwireHost } from './tripwire';

function world() {
  const blocks = new Map<string, number>();
  const ticks: { x: number; y: number; z: number; at: number }[] = [];
  let time = 0;
  let entityAt: string | null = null;
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const h: TripwireHost = {
    getState: (x, y, z) => blocks.get(k(x, y, z)) ?? 0,
    setBlock: (x, y, z, st) => {
      const old = blocks.get(k(x, y, z)) ?? 0;
      blocks.set(k(x, y, z), st);
      tripwireChanged(h, x, y, z, old, st);
    },
    scheduleTick: (x, y, z, _st, delay) => void ticks.push({ x, y, z, at: time + delay }),
    updateNeighborsAt: () => {},
    entitiesIn: (x0, _y0, z0) => entityAt === k(Math.floor(x0), 0, Math.floor(z0)),
  };
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      time++;
      for (const t of ticks.splice(0).filter((t) => (t.at <= time ? true : (ticks.push(t), false)))) tripwireTick(h, t.x, t.y, t.z, h.getState(t.x, t.y, t.z));
    }
  };
  return { h, run, set: (v: string | null) => (entityAt = v), get: (x: number, z: number, p: string) => getProp(h.getState(x, 1, z), p) };
}

describe('tripwire', () => {
  function build() {
    const w = world();
    w.h.setBlock(0, 1, 0, stateOf('tripwire_hook', { facing: 'east' }));
    for (let x = 1; x <= 3; x++) w.h.setBlock(x, 1, 0, stateOf('tripwire'));
    w.h.setBlock(4, 1, 0, stateOf('tripwire_hook', { facing: 'west' }));
    return w;
  }

  it('hooks facing each other with string between attach', () => {
    const w = build();
    expect(w.get(0, 0, 'attached')).toBe(true);
    expect(w.get(4, 0, 'attached')).toBe(true);
    expect(w.get(2, 0, 'attached')).toBe(true);
    expect(w.get(0, 0, 'powered')).toBe(false);
  });

  it('an entity in the string powers both hooks until 10 ticks after it leaves', () => {
    const w = build();
    w.set('2,0,0');
    wireEntityInside(w.h, 2, 1, 0);
    expect(w.get(2, 0, 'powered')).toBe(true);
    expect(w.get(0, 0, 'powered')).toBe(true);
    expect(w.get(4, 0, 'powered')).toBe(true);
    w.set(null);
    w.run(9);
    expect(w.get(0, 0, 'powered')).toBe(true);
    w.run(12);
    expect(w.get(2, 0, 'powered')).toBe(false);
    expect(w.get(0, 0, 'powered')).toBe(false);
  });

  it('breaking string fires the hooks, cutting disarmed string does not', () => {
    const w = build();
    w.h.setBlock(2, 1, 0, 0);
    // the broken string counts as stepped on until the hook's 10-tick re-check, then it detaches
    expect(w.get(0, 0, 'powered')).toBe(true);
    w.run(11);
    expect(w.get(0, 0, 'attached')).toBe(false);
    expect(w.get(0, 0, 'powered')).toBe(false);
    const v = build();
    disarmTripwire(v.h, 2, 1, 0);
    v.h.setBlock(2, 1, 0, 0);
    expect(v.get(0, 0, 'powered')).toBe(false);
    expect(v.get(0, 0, 'attached')).toBe(false);
  });
});
