import { describe, it, expect } from 'vitest';
import { BlockWorld } from '@shared/world/world';
import { Arrow, segmentBox, type ArrowHost } from './arrow';
import { AABB } from '@shared/entity/aabb';

const host = (targets: { id: number; box: AABB; hits: number[] }[] = []): ArrowHost => ({
  arrowTargets: () => targets.map((t) => ({ id: t.id, bb: () => t.box, hurtByArrow: (_a, d) => (t.hits.push(d), true) })),
  ownerBox: () => null,
  playSound: () => {},
  dropItem: () => {},
  canHarm: () => true,
  rand: { nextFloat: () => 0.5, nextInt: () => 0, nextGaussian: () => 0 },
});

describe('arrow physics (AbstractArrow.tick)', () => {
  it('moves by its velocity, then drag 0.99 and gravity 0.05 per tick', () => {
    const w = new BlockWorld();
    const a = new Arrow(1, host(), { id: 1, count: 1, damage: 0 });
    a.y = 100;
    a.shootFromRotation(0, -90, 3, 0); // yaw −90 → +X
    expect(a.vx).toBeCloseTo(3, 6);
    a.tick(w);
    expect(a.x).toBeCloseTo(3, 6);
    expect(a.vx).toBeCloseTo(2.97, 6);
    expect(a.vy).toBeCloseTo(-0.05, 6);
    a.tick(w);
    expect(a.x).toBeCloseTo(5.97, 6);
    expect(a.y).toBeCloseTo(99.95, 6);
  });

  it('damage is ceil(speed × 2); a crit adds up to damage/2 + 1', () => {
    const w = new BlockWorld();
    const t = { id: 7, box: new AABB(2.5, 99, -0.3, 3.1, 100.8, 0.3), hits: [] as number[] };
    const a = new Arrow(1, host([t]), { id: 1, count: 1, damage: 0 });
    a.y = 99.5;
    a.ownerId = 99;
    a.shootFromRotation(0, -90, 3, 0);
    a.tick(w);
    expect(t.hits).toEqual([6]);
    expect(a.removed).toBe(true);
  });

  it('segmentBox entry distance', () => {
    const b = new AABB(1, -1, -1, 2, 1, 1);
    expect(segmentBox(0, 0, 0, 3, 0, 0, b)).toBeCloseTo(1, 6);
    expect(segmentBox(0, 2, 0, 3, 2, 0, b)).toBe(-1);
  });
});
