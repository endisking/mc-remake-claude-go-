import { describe, it, expect } from 'vitest';
import { stateOf } from '../world/blockstate';
import {
  findEmptyPortalShape, portalShapeAt, isCompleteShape, shapeBlocks, portalState, scaledTarget, portalSearchRadius, spiralAround,
  planPortal, portalRectangle, relativePortalPosition, portalArrival, portalSurvives, PORTAL_X,
} from './portalshape';

const OBS = stateOf('obsidian');
const STONE = stateOf('stone');

class Grid {
  readonly m = new Map<string, number>();
  getState(x: number, y: number, z: number): number {
    return this.m.get(`${x},${y},${z}`) ?? 0;
  }
  set(x: number, y: number, z: number, s: number): void {
    this.m.set(`${x},${y},${z}`, s);
  }
  /** an obsidian frame in the x–y plane at z, interior w × h with its bottom-left interior block at (x, y) */
  frame(x: number, y: number, z: number, w: number, h: number, corners = true): void {
    for (let i = -1; i <= w; i++)
      for (let j = -1; j <= h; j++) {
        const edge = i === -1 || i === w || j === -1 || j === h;
        const corner = (i === -1 || i === w) && (j === -1 || j === h);
        if (edge && (corners || !corner)) this.set(x + i, y + j, z, OBS);
      }
  }
}

describe('portal shapes (PortalShape)', () => {
  it('finds the minimum 2×3 frame from any interior block, with or without corners', () => {
    for (const corners of [true, false]) {
      const g = new Grid();
      g.frame(0, 10, 0, 2, 3, corners);
      for (const [x, y] of [[0, 10], [1, 12], [0, 11]] as const) {
        const sh = findEmptyPortalShape(g, x, y, 0)!;
        expect(sh).not.toBeNull();
        expect([sh.axis, sh.width, sh.height, sh.y]).toEqual(['x', 2, 3, 10]);
        expect(shapeBlocks(sh).length).toBe(6);
      }
    }
  });

  it('accepts sizes up to 21×21 and rejects bigger, smaller and broken frames', () => {
    const ok = (w: number, h: number) => {
      const g = new Grid();
      g.frame(0, 5, 0, w, h);
      return findEmptyPortalShape(g, 0, 5, 0);
    };
    expect(ok(21, 21)).toMatchObject({ width: 21, height: 21 });
    expect(ok(5, 4)).toMatchObject({ width: 5, height: 4 });
    expect(ok(22, 3)).toBeNull();
    expect(ok(2, 22)).toBeNull();
    expect(ok(1, 3)).toBeNull();
    expect(ok(2, 2)).toBeNull();
    // a missing frame block
    const g = new Grid();
    g.frame(0, 5, 0, 3, 4);
    g.set(3, 7, 0, 0);
    expect(findEmptyPortalShape(g, 1, 5, 0)).toBeNull();
    // a block inside the frame
    const g2 = new Grid();
    g2.frame(0, 5, 0, 3, 4);
    g2.set(1, 6, 0, STONE);
    expect(findEmptyPortalShape(g2, 0, 5, 0)).toBeNull();
    // a frame of the wrong block
    const g3 = new Grid();
    g3.frame(0, 5, 0, 2, 3);
    g3.set(-1, 6, 0, STONE);
    expect(findEmptyPortalShape(g3, 0, 5, 0)).toBeNull();
  });

  it('detects frames along z, and a lit frame is complete until a frame block goes', () => {
    const g = new Grid();
    // z-axis frame: rotate by writing the frame in the z–y plane
    for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) if (i === -1 || i === 2 || j === -1 || j === 3) g.set(4, 20 + j, 7 + i, OBS);
    const sh = findEmptyPortalShape(g, 4, 21, 8)!;
    expect(sh.axis).toBe('z');
    for (const [x, y, z] of shapeBlocks(sh)) g.set(x, y, z, portalState('z'));
    expect(isCompleteShape(portalShapeAt(g, 4, 20, 7, 'z'))).toBe(true);
    expect(findEmptyPortalShape(g, 4, 21, 8)).toBeNull(); // already lit
    g.set(4, 22, 9, 0); // break the right side of the frame
    expect(portalSurvives(g, 4, 22, 8, portalState('z'), 'z', 0)).toBe(false);
    // a neighbour across the portal (x) doesn't matter
    expect(portalSurvives(g, 4, 22, 8, portalState('z'), 'x', 0)).toBe(true);
  });
});

describe('portal travel geometry', () => {
  it('scales coordinates 8:1 between the overworld and the nether', () => {
    expect(scaledTarget(800.5, 70, -1600.2, 1, 8)).toEqual([100, 70, -201]);
    expect(scaledTarget(100.5, 40, -200.5, 8, 1)).toEqual([804, 40, -1604]);
    expect(portalSearchRadius(true)).toBe(16);
    expect(portalSearchRadius(false)).toBe(128);
  });

  it('spirals out from the centre like BlockPos.spiralAround', () => {
    const s = spiralAround(1);
    expect(s[0]).toEqual([0, 0]);
    expect(s.length).toBe(9);
    expect(new Set(s.map((p) => p.join())).size).toBe(9);
    expect(spiralAround(16).length).toBe(33 * 33);
  });

  it('keeps the relative position through the portal', () => {
    const g = new Grid();
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) g.set(10 + i, 64 + j, 3, PORTAL_X);
    const r = portalRectangle(g, 12, 66, 3);
    expect(r).toEqual({ x: 10, y: 64, z: 3, axis1: 4, axis2: 5 });
    const rel = relativePortalPosition(r, 'x', 10.3, 64, 3.5, 0.6, 1.8);
    expect(rel[0]).toBeCloseTo(0, 6);
    expect(rel[1]).toBe(0);
    const a = portalArrival({ x: 0, y: 40, z: 0, axis1: 2, axis2: 3 }, 'x', 'x', rel, 0.6, 1.8, 90);
    expect(a).toMatchObject({ x: 0.3, y: 40, z: 0.5, yaw: 90 });
    // rotated exit portal: yaw turns by 90
    expect(portalArrival({ x: 0, y: 40, z: 0, axis1: 2, axis2: 3 }, 'z', 'x', rel, 0.6, 1.8, 0).yaw).toBe(90);
  });

  it('creates a portal on solid ground, or on an obsidian platform in the air', () => {
    // flat stone floor at y 63
    const g = new Grid();
    const lv = {
      getState: (x: number, y: number, z: number) => (y <= 63 ? STONE : g.getState(x, y, z)),
      motionBlockingHeight: () => 64,
    };
    const p = planPortal(lv, 5, 64, 5, 'x', 256);
    expect(p.rect).toMatchObject({ y: 64, axis1: 2, axis2: 3 });
    expect(p.writes.filter((w) => w[3] === OBS).length).toBe(14);
    expect(p.writes.filter((w) => w[3] === PORTAL_X).length).toBe(6);
    // nothing solid anywhere: a platform at y 70.. with air above
    const air = { getState: () => 0, motionBlockingHeight: () => 0 };
    const q = planPortal(air, 0, 30, 0, 'x', 128);
    expect(q.rect.y).toBe(70);
    expect(q.writes.filter((w) => w[3] === OBS).length).toBe(6 + 14);
  });
});
