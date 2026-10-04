import { describe, it, expect } from 'vitest';
import { getProp, stateOf } from '../world/blockstate';
import { railNeighborChanged, railPlaced, isRailState, type RailHost } from './rails';

/** a tiny world: rails on stone, a set of "powered" positions acting as neighbour signals */
function world() {
  const blocks = new Map<string, number>();
  const signals = new Set<string>();
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const h: RailHost = {
    getState: (x, y, z) => blocks.get(k(x, y, z)) ?? 0,
    setBlock: (x, y, z, st) => {
      const old = blocks.get(k(x, y, z)) ?? 0;
      blocks.set(k(x, y, z), st);
      if (isRailState(st) && (old === 0 || !isRailState(old))) railPlaced(h, x, y, z);
    },
    hasNeighborSignal: (x, y, z) => signals.has(k(x, y, z)),
    updateNeighborsAt: (x, y, z, from) => {
      for (const [dx, dy, dz] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as const) {
        const st = h.getState(x + dx, y + dy, z + dz);
        if (isRailState(st)) railNeighborChanged(h, x + dx, y + dy, z + dz, st, from);
      }
    },
  };
  const shape = (x: number, y: number, z: number) => getProp(h.getState(x, y, z), 'shape');
  const powered = (x: number, y: number, z: number) => getProp(h.getState(x, y, z), 'powered');
  return { h, signals, shape, powered, k };
}

describe('rail shapes', () => {
  it('a straight line along X becomes east_west', () => {
    const { h, shape } = world();
    h.setBlock(0, 1, 0, stateOf('rail'));
    h.setBlock(1, 1, 0, stateOf('rail'));
    expect(shape(0, 1, 0)).toBe('east_west');
    expect(shape(1, 1, 0)).toBe('east_west');
  });

  it('a corner makes a curve on the plain rail only', () => {
    const { h, shape } = world();
    h.setBlock(1, 1, 0, stateOf('rail'));
    h.setBlock(0, 1, 1, stateOf('rail'));
    h.setBlock(0, 1, 0, stateOf('rail'));
    expect(shape(0, 1, 0)).toBe('south_east');
    const w = world();
    w.h.setBlock(1, 1, 0, stateOf('powered_rail'));
    w.h.setBlock(0, 1, 1, stateOf('powered_rail'));
    w.h.setBlock(0, 1, 0, stateOf('powered_rail'));
    expect(['north_south', 'east_west']).toContain(w.shape(0, 1, 0));
  });

  it('a rail one block higher makes a slope', () => {
    const { h, shape } = world();
    h.setBlock(1, 2, 0, stateOf('rail'));
    h.setBlock(0, 1, 0, stateOf('rail'));
    expect(shape(0, 1, 0)).toBe('ascending_east');
  });

  it('a T junction with no signal prefers south_east', () => {
    const { h, shape } = world();
    h.setBlock(-1, 1, 0, stateOf('rail', { shape: 'east_west' }));
    h.setBlock(1, 1, 0, stateOf('rail', { shape: 'east_west' }));
    h.setBlock(0, 1, 1, stateOf('rail'));
    // place the junction last: three neighbours, unpowered → south_east wins (checked last)
    h.setBlock(0, 1, 0, stateOf('rail'));
    expect(shape(0, 1, 0)).toBe('south_east');
  });
});

describe('powered rail propagation', () => {
  it('a powered rail powers itself and the next 8 rails in line', () => {
    const { h, signals, powered, k } = world();
    for (let x = 0; x < 12; x++) h.setBlock(x, 1, 0, stateOf('powered_rail', { shape: 'east_west' }));
    signals.add(k(0, 1, 0));
    railNeighborChanged(h, 0, 1, 0, h.getState(0, 1, 0), -1);
    // propagate the updates down the line (each rail re-checks when its neighbour changes)
    for (let i = 0; i < 12; i++) for (let x = 0; x < 12; x++) railNeighborChanged(h, x, 1, 0, h.getState(x, 1, 0), -1);
    expect(Array.from({ length: 12 }, (_, x) => powered(x, 1, 0))).toEqual([true, true, true, true, true, true, true, true, true, false, false, false]);
  });

  it('activator rails do not carry power along powered rails', () => {
    const { h, signals, powered, k } = world();
    h.setBlock(0, 1, 0, stateOf('powered_rail', { shape: 'east_west' }));
    h.setBlock(1, 1, 0, stateOf('activator_rail', { shape: 'east_west' }));
    signals.add(k(0, 1, 0));
    railNeighborChanged(h, 0, 1, 0, h.getState(0, 1, 0), -1);
    railNeighborChanged(h, 1, 1, 0, h.getState(1, 1, 0), -1);
    expect(powered(0, 1, 0)).toBe(true);
    expect(powered(1, 1, 0)).toBe(false);
  });
});
