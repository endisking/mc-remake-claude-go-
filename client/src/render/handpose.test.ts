import { describe, it, expect } from 'vitest';
import { PoseStack } from './posestack';
import {
  FIRST_PERSON_DISPLAY, applyItemTransform, armPartTransform, handsToRender, itemArmPose, playerArmPose,
  swingDuration, tickHandHeight,
} from './handpose';

function apply(m: Float32Array, x: number, y: number, z: number): [number, number, number] {
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
}
function close(a: [number, number, number], b: [number, number, number], eps = 2e-3): void {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, -Math.log10(eps));
}

// Reference points from an independent row-major re-implementation of vanilla 1.17.1
// ItemInHandRenderer.renderPlayerArm + PlayerRenderer.renderRightHand (pivot (−5, 2, 0), zRot 0.1).
describe('first-person arm (renderPlayerArm)', () => {
  it('rests at the lower right of the view, the hand end pointing up and in', () => {
    const ps = new PoseStack();
    playerArmPose(ps, 1, 0, 0);
    armPartTransform(ps, 1);
    close(apply(ps.last, 1, 10, -2), [0.605, -0.462, -1.185]);
    close(apply(ps.last, -3, -2, -2), [0.412, -0.697, -0.456]);
    close(apply(ps.last, -3, 10, 2), [0.905, -0.414, -1.005]);
  });

  it('swings toward the crosshair (swing 1/6)', () => {
    const ps = new PoseStack();
    playerArmPose(ps, 1, 1 / 6, 0);
    armPartTransform(ps, 1);
    close(apply(ps.last, 1, 10, -2), [-0.092, -0.253, -1.073]);
    close(apply(ps.last, -3, -2, 2), [0.61, -0.595, -0.794]);
  });

  it('drops by 0.6 blocks when unequipped', () => {
    const a = new PoseStack(), b = new PoseStack();
    playerArmPose(a, 1, 0, 0);
    playerArmPose(b, 1, 0, 1);
    const pa = apply(a.last, 0, 0, 0), pb = apply(b.last, 0, 0, 0);
    expect(pa[1] - pb[1]).toBeCloseTo(0.6, 5);
  });
});

describe('held items (renderArmWithItem + display transforms)', () => {
  const noUse = { swing: 0, equip: 0, partial: 0, use: null, autoSpin: false } as const;
  it('item/generated sprite: torch top leans in toward the crosshair', () => {
    const ps = new PoseStack();
    itemArmPose(ps, { side: 1, ...noUse });
    applyItemTransform(ps, FIRST_PERSON_DISPLAY.generated.right, false);
    // sprite top-centre (torch tip) and bottom-centre, in centred model space
    close(apply(ps.last, 0, 10 / 16 - 0.5, 0), [0.631, -0.243, -0.685]);
    close(apply(ps.last, 0, -0.5, 0), [0.631, -0.628, -0.506]);
  });

  it('block/block: centred at (0.56, −0.52, −0.72), rotated 45°, scale 0.4', () => {
    const ps = new PoseStack();
    itemArmPose(ps, { side: 1, ...noUse });
    applyItemTransform(ps, FIRST_PERSON_DISPLAY.block.right, false);
    close(apply(ps.last, 0, 0, 0), [0.56, -0.52, -0.72], 1e-5);
    const c = apply(ps.last, 0.5, 0, 0);
    close(c, [0.56 + 0.2 * Math.SQRT1_2, -0.52, -0.72 - 0.2 * Math.SQRT1_2], 1e-5);
  });

  it('left hand: ItemTransform.apply mirrors the lefthand entry back to the right one, x mirrored', () => {
    const r = new PoseStack(), l = new PoseStack();
    applyItemTransform(r, FIRST_PERSON_DISPLAY.generated.right, false);
    applyItemTransform(l, FIRST_PERSON_DISPLAY.generated.left, true);
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(l.last[i]).toBeCloseTo(r.last[i]!, 6);
    expect(l.last[12]).toBeCloseTo(-r.last[12]!, 6);
    expect(l.last[13]).toBeCloseTo(r.last[13]!, 6);
  });

  it('eating bobs the item up toward the mouth', () => {
    const a = new PoseStack(), b = new PoseStack();
    itemArmPose(a, { side: 1, ...noUse });
    itemArmPose(b, { side: 1, ...noUse, use: { anim: 'eat', remaining: 16, duration: 32 } });
    const pa = apply(a.last, 0, 0, 0), pb = apply(b.last, 0, 0, 0);
    // f3 = 1 − 0.53^27 ≈ 1: moved 0.6 toward the centre … (in the rotated frame) and lifted
    expect(pb[0]).toBeLessThan(pa[0]);
  });

  it('bow pull stretches the item along z up to 1.2×', () => {
    const ps = new PoseStack();
    itemArmPose(ps, { side: 1, ...noUse, use: { anim: 'bow', remaining: 72000 - 40, duration: 72000 } });
    // fully drawn (f12 = 1): scale(1, 1, 1.2) → the pose's volume scale (determinant) is 1.2
    const m = ps.last;
    const det = m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) - m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) + m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!);
    expect(det).toBeCloseTo(1.2, 5);
  });
});

describe('swing duration (LivingEntity.getCurrentSwingDuration)', () => {
  it('is 6 ticks, shorter with Haste, longer with Mining Fatigue', () => {
    expect(swingDuration(null, null)).toBe(6);
    expect(swingDuration(0, null)).toBe(5);
    expect(swingDuration(1, null)).toBe(4);
    expect(swingDuration(null, 0)).toBe(8);
    expect(swingDuration(null, 2)).toBe(12);
    expect(swingDuration(1, 2)).toBe(4);
  });
});

describe('hand height and hand selection', () => {
  it('equip height moves at most 0.4 per tick', () => {
    expect(tickHandHeight(1, 0)).toBeCloseTo(0.6);
    expect(tickHandHeight(0.1, 1)).toBeCloseTo(0.5);
    expect(tickHandHeight(0.9, 1)).toBeCloseTo(1);
  });

  it('evaluateWhichHandsToRender', () => {
    expect(handsToRender('stone', null, null, false, false)).toEqual({ main: true, off: true });
    expect(handsToRender('bow', 'torch', { hand: 0, item: 'bow' }, false, false)).toEqual({ main: true, off: false });
    expect(handsToRender('torch', 'bow', { hand: 1, item: 'bow' }, false, false)).toEqual({ main: false, off: true });
    expect(handsToRender('crossbow', 'torch', null, true, false)).toEqual({ main: true, off: false });
    expect(handsToRender('bread', 'crossbow', { hand: 0, item: 'bread' }, false, true)).toEqual({ main: true, off: false });
  });
});
