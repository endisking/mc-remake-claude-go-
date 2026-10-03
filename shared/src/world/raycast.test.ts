import { describe, it, expect } from 'vitest';
import { raycastBlocks } from './raycast';
import { stateOf } from './blockstate';

function world(blocks: Record<string, number>) {
  return { getState: (x: number, y: number, z: number) => blocks[`${x},${y},${z}`] ?? 0 };
}

describe('raycast', () => {
  it('hits the near face of a block', () => {
    const w = world({ '0,0,5': stateOf('stone') });
    const hit = raycastBlocks(w, 0.5, 0.5, 0.5, 0, 0, 1, 10)!;
    expect(hit).toMatchObject({ x: 0, y: 0, z: 5, face: 2 });
    expect(hit.distance).toBeCloseTo(4.5, 6);
  });
  it('respects reach and partial shapes', () => {
    const slab = stateOf('stone_slab', { type: 'bottom' });
    const w = world({ '0,0,3': slab });
    // ray passes above the bottom slab
    expect(raycastBlocks(w, 0.5, 0.75, 0.5, 0, 0, 1, 10)).toBeNull();
    expect(raycastBlocks(w, 0.5, 0.25, 0.5, 0, 0, 1, 10)?.z).toBe(3);
    expect(raycastBlocks(w, 0.5, 0.25, 0.5, 0, 0, 1, 2)).toBeNull();
  });
  it('selects plants by their outline and looks down onto the top face', () => {
    const w = world({ '0,0,2': stateOf('poppy'), '0,-1,0': stateOf('grass_block') });
    expect(raycastBlocks(w, 0.5, 0.3, 0.5, 0, 0, 1, 5)?.z).toBe(2);
    expect(raycastBlocks(w, 0.5, 1.62, 0.5, 0, -1, 0, 5)).toMatchObject({ y: -1, face: 1 });
  });
});
