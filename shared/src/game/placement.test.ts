import { describe, it, expect } from 'vitest';
import { stateForPlacement, updateShape, horizontalFacing, type PlaceContext } from './placement';
import { stateOf, getProp, propsOf } from '../world/blockstate';

function world(blocks: Record<string, number>) {
  return { getState: (x: number, y: number, z: number) => blocks[`${x},${y},${z}`] ?? (y < 0 ? stateOf('stone') : 0) };
}
function ctx(w: ReturnType<typeof world>, over: Partial<PlaceContext>): PlaceContext {
  return { world: w, x: 0, y: 0, z: 0, face: 1, hx: 0.5, hy: 1, hz: 0.5, yaw: 0, pitch: 0, sneaking: false, ...over };
}

describe('placement rules', () => {
  it('horizontal facing from yaw', () => {
    expect(horizontalFacing(0)).toBe('south');
    expect(horizontalFacing(90)).toBe('west');
    expect(horizontalFacing(180)).toBe('north');
    expect(horizontalFacing(-90)).toBe('east');
  });
  it('logs take the clicked axis', () => {
    const w = world({});
    expect(getProp(stateForPlacement('oak_log', ctx(w, { face: 1 }), 0)!, 'axis')).toBe('y');
    expect(getProp(stateForPlacement('oak_log', ctx(w, { face: 4 }), 0)!, 'axis')).toBe('x');
    expect(getProp(stateForPlacement('oak_log', ctx(w, { face: 2 }), 0)!, 'axis')).toBe('z');
  });
  it('stairs face the look direction; upper half when clicking the top of a side', () => {
    const w = world({});
    const s = stateForPlacement('oak_stairs', ctx(w, { face: 1, yaw: 0 }), 0)!;
    expect(propsOf(s)).toMatchObject({ facing: 'south', half: 'bottom', shape: 'straight' });
    const t = stateForPlacement('oak_stairs', ctx(w, { face: 2, hy: 0.8, yaw: 90 }), 0)!;
    expect(propsOf(t)).toMatchObject({ facing: 'west', half: 'top' });
  });
  it('slabs: top/bottom by click height, and merge into a double slab', () => {
    const w = world({});
    expect(getProp(stateForPlacement('oak_slab', ctx(w, { face: 3, hy: 0.7 }), 0)!, 'type')).toBe('top');
    expect(getProp(stateForPlacement('oak_slab', ctx(w, { face: 1 }), 0)!, 'type')).toBe('bottom');
    const bottom = stateOf('oak_slab', { type: 'bottom' });
    expect(getProp(stateForPlacement('oak_slab', ctx(w, { face: 1 }), bottom)!, 'type')).toBe('double');
  });
  it('torches go on walls facing away from the support and need a solid block', () => {
    const w = world({ '0,0,1': stateOf('stone') });
    const t = stateForPlacement('torch', ctx(w, { face: 2 }), 0)!; // clicked the north face of the stone at z=1
    expect(propsOf(t)).toEqual({ facing: 'north' });
    expect(stateForPlacement('torch', ctx(world({}), { face: 3 }), 0)).toBeNull();
  });
  it('fences and panes connect to neighbours', () => {
    const w = world({ '1,0,0': stateOf('oak_fence'), '0,0,1': stateOf('stone') });
    const f = stateForPlacement('oak_fence', ctx(w, {}), 0)!;
    expect(propsOf(f)).toMatchObject({ east: true, south: true, north: false, west: false });
    const g = updateShape(w, 1, 0, 0, stateOf('oak_fence'));
    expect(getProp(g, 'west')).toBe(false); // nothing at 0,0,0 yet in this world
  });
  it('stairs form inner/outer corners', () => {
    const east = stateOf('oak_stairs', { facing: 'east' });
    const north = stateOf('oak_stairs', { facing: 'north' });
    // a stair facing east with a north-facing stair in front of it (to the east) → outer corner
    const w = world({ '1,0,0': north });
    const s = stateForPlacement('oak_stairs', ctx(w, { yaw: -90 }), 0)!;
    expect(getProp(s, 'facing')).toBe('east');
    expect(getProp(s, 'shape')).toBe('outer_left');
    void east;
  });
});
