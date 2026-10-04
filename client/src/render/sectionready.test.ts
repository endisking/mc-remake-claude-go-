import { describe, it, expect } from 'vitest';
import { hasAllNeighbours } from './sectionready';

describe('section meshing waits for neighbour chunks', () => {
  const loaded = (set: [number, number][]) => {
    const s = new Set(set.map(([x, z]) => `${x},${z}`));
    return (x: number, z: number) => s.has(`${x},${z}`);
  };
  const ring = (r: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) out.push([x, z]);
    return out;
  };

  it('meshes only chunks whose eight neighbours are loaded (never the loaded-area edge)', () => {
    const is = loaded(ring(2));
    expect(hasAllNeighbours(is, 0, 0)).toBe(true);
    expect(hasAllNeighbours(is, 1, -1)).toBe(true);
    expect(hasAllNeighbours(is, 2, 0)).toBe(false);
    expect(hasAllNeighbours(is, -2, 2)).toBe(false);
  });

  it('a missing diagonal neighbour also blocks meshing', () => {
    const is = loaded(ring(1).filter(([x, z]) => !(x === 1 && z === 1)));
    expect(hasAllNeighbours(is, 0, 0)).toBe(false);
  });
});
