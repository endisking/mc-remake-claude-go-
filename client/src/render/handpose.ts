/**
 * Pose math of the first-person hands (vanilla 1.17.1 ItemInHandRenderer), kept free of GL so
 * it can be unit tested: renderPlayerArm, renderArmWithItem with every use animation
 * (eat/drink, bow, spear, crossbow), applyItemArmTransform / applyItemArmAttackTransform, the
 * item model display transforms (ItemTransform.apply) and LivingEntity.getCurrentSwingDuration.
 *
 * Coordinates are vanilla's first-person view space: x right, y up, camera looking down −z.
 */
import type { PoseStack } from './posestack';

export type UseAnim = 'none' | 'eat' | 'drink' | 'block' | 'bow' | 'spear' | 'crossbow' | 'spyglass';

/** Item model display transform (model JSON "display" entry), in model JSON units. */
export interface ItemTransform {
  rotation: [number, number, number];
  /** pixels (1/16 block) */
  translation: [number, number, number];
  scale: [number, number, number];
}

/** Which vanilla parent model's first-person display a held item uses. */
export type ItemDisplay = 'block' | 'generated' | 'handheld' | 'handheld_rod';

/**
 * firstperson_righthand / firstperson_lefthand of the vanilla parent models (block/block,
 * item/generated, item/handheld, item/handheld_rod), exactly as the 1.17.1 model JSON states.
 * A model without its own display entries inherits these from its parent.
 */
export const FIRST_PERSON_DISPLAY: Record<ItemDisplay, { right: ItemTransform; left: ItemTransform }> = {
  block: {
    right: { rotation: [0, 45, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
    left: { rotation: [0, 225, 0], translation: [0, 0, 0], scale: [0.4, 0.4, 0.4] },
  },
  generated: {
    right: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
    left: { rotation: [0, 90, -25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
  },
  handheld: {
    right: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
    left: { rotation: [0, 90, -25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
  },
  handheld_rod: {
    right: { rotation: [0, 90, 25], translation: [0, 1.6, 0.8], scale: [0.68, 0.68, 0.68] },
    left: { rotation: [0, 90, 25], translation: [0, 1.6, 0.8], scale: [0.68, 0.68, 0.68] },
  },
};

/** Items whose model parent is item/handheld_rod. */
export const HANDHELD_ROD_ITEMS = new Set(['fishing_rod', 'carrot_on_a_stick', 'warped_fungus_on_a_stick']);

/**
 * Vanilla ItemTransform.apply: translation (x mirrored for the left hand), rotation as the
 * quaternion of Euler angles X·Y·Z (y and z negated for the left hand), then scale.
 */
export function applyItemTransform(ps: PoseStack, t: ItemTransform, leftHand: boolean): void {
  const i = leftHand ? -1 : 1;
  ps.translate((i * t.translation[0]) / 16, t.translation[1] / 16, t.translation[2] / 16);
  ps.rotX(t.rotation[0]);
  ps.rotY(leftHand ? -t.rotation[1] : t.rotation[1]);
  ps.rotZ(leftHand ? -t.rotation[2] : t.rotation[2]);
  ps.scale(t.scale[0], t.scale[1], t.scale[2]);
}

/**
 * LivingEntity.getCurrentSwingDuration: 6 ticks; Haste/Conduit Power shorten it by 1 + amplifier,
 * Mining Fatigue lengthens it by 2·(1 + amplifier). Amplifiers are null when the effect is absent.
 */
export function swingDuration(digSpeedAmp: number | null, digSlowdownAmp: number | null): number {
  if (digSpeedAmp !== null) return 6 - (1 + digSpeedAmp);
  if (digSlowdownAmp !== null) return 6 + (1 + digSlowdownAmp) * 2;
  return 6;
}

/** View lag of the hands: ItemInHandRenderer.renderHandsWithItems rotations from xBob/yBob. */
export function handSway(ps: PoseStack, viewXRot: number, viewYRot: number, xBob: number, yBob: number): void {
  ps.rotX((viewXRot - xBob) * 0.1);
  ps.rotY((viewYRot - yBob) * 0.1);
}

/**
 * renderPlayerArm up to the PlayerRenderer.renderRightHand/LeftHand call (side 1 = right arm).
 * The caller then applies the arm ModelPart: pivot (±5, 2, 0) px, zRot ±0.1 rad from
 * AnimationUtils.bobModelPart at ageInTicks 0, xRot 0.
 */
export function playerArmPose(ps: PoseStack, side: 1 | -1, swing: number, equip: number): void {
  const f = side;
  const f1 = Math.sqrt(swing);
  const f2 = -0.3 * Math.sin(f1 * Math.PI);
  const f3 = 0.4 * Math.sin(f1 * Math.PI * 2);
  const f4 = -0.4 * Math.sin(swing * Math.PI);
  ps.translate(f * (f2 + 0.64000005), f3 - 0.6 + equip * -0.6, f4 - 0.71999997);
  ps.rotY(f * 45);
  const f5 = Math.sin(swing * swing * Math.PI);
  const f6 = Math.sin(f1 * Math.PI);
  ps.rotY(f * f6 * 70);
  ps.rotZ(f * f5 * -20);
  ps.translate(f * -1, 3.6, 3.5);
  ps.rotZ(f * 120);
  ps.rotX(200);
  ps.rotY(f * -135);
  ps.translate(f * 5.6, 0, 0);
}

/** The arm ModelPart transform of renderRightHand/LeftHand, from model px (y down) to blocks. */
export function armPartTransform(ps: PoseStack, side: 1 | -1): void {
  ps.translate((side * -5) / 16, 2 / 16, 0);
  ps.rotZ(((side * 0.1) * 180) / Math.PI);
  ps.scale(1 / 16, 1 / 16, 1 / 16);
}

export function applyItemArmTransform(ps: PoseStack, side: 1 | -1, equip: number): void {
  ps.translate(side * 0.56, -0.52 + equip * -0.6, -0.72);
}

export function applyItemArmAttackTransform(ps: PoseStack, side: 1 | -1, swing: number): void {
  const f = Math.sin(swing * swing * Math.PI);
  ps.rotY(side * (45 + f * -20));
  const f1 = Math.sin(Math.sqrt(swing) * Math.PI);
  ps.rotZ(side * f1 * -20);
  ps.rotX(f1 * -80);
  ps.rotY(side * -45);
}

/** applyEatTransform; `t` = getUseItemRemainingTicks − partial + 1. */
export function applyEatTransform(ps: PoseStack, side: 1 | -1, t: number, useDuration: number): void {
  const f1 = t / useDuration;
  if (f1 < 0.8) ps.translate(0, Math.abs(Math.cos((t / 4) * Math.PI) * 0.1), 0);
  const f3 = 1 - Math.pow(f1, 27);
  ps.translate(f3 * 0.6 * side, f3 * -0.5, 0);
  ps.rotY(side * f3 * 90);
  ps.rotX(f3 * 10);
  ps.rotZ(side * f3 * 30);
}

/** The item being used by this hand: remaining ticks (getUseItemRemainingTicks) and duration. */
export interface HandUse {
  anim: UseAnim;
  remaining: number;
  duration: number;
  /** crossbow: CrossbowItem.getChargeDuration (25 − 5·Quick Charge) */
  chargeDuration?: number;
}

export interface ItemArmInput {
  side: 1 | -1;
  swing: number;
  equip: number;
  partial: number;
  /** the item this hand is using right now (isUsingItem, remaining > 0, used hand = this one) */
  use: HandUse | null;
  /** Riptide spin attack */
  autoSpin: boolean;
  /** held item is a crossbow; charged state; this is the main hand */
  crossbow?: { charged: boolean; mainHand: boolean } | null;
}

/** renderArmWithItem up to the renderItem call (the display transform is applied after). */
export function itemArmPose(ps: PoseStack, a: ItemArmInput): void {
  const k = a.side;
  if (a.crossbow) {
    if (a.use) {
      applyItemArmTransform(ps, k, a.equip);
      ps.translate(k * -0.4785682, -0.094387, 0.05731531);
      ps.rotX(-11.935);
      ps.rotY(k * 65.3);
      ps.rotZ(k * -9.785);
      const f9 = a.use.duration - (a.use.remaining - a.partial + 1);
      let f13 = f9 / (a.use.chargeDuration ?? 25);
      if (f13 > 1) f13 = 1;
      if (f13 > 0.1) {
        const f4 = Math.sin((f9 - 0.1) * 1.3) * (f13 - 0.1);
        ps.translate(0, f4 * 0.004, 0);
      }
      ps.translate(0, 0, f13 * 0.04);
      ps.scale(1, 1, 1 + f13 * 0.2);
      ps.rotY(-k * 45);
    } else {
      swingOffset(ps, k, a.swing);
      applyItemArmTransform(ps, k, a.equip);
      applyItemArmAttackTransform(ps, k, a.swing);
      if (a.crossbow.charged && a.swing < 0.001 && a.crossbow.mainHand) {
        ps.translate(k * -0.641864, 0, 0);
        ps.rotY(k * 10);
      }
    }
    return;
  }
  if (a.use) {
    const u = a.use;
    switch (u.anim) {
      case 'eat':
      case 'drink':
        applyEatTransform(ps, k, u.remaining - a.partial + 1, u.duration);
        applyItemArmTransform(ps, k, a.equip);
        break;
      case 'bow': {
        applyItemArmTransform(ps, k, a.equip);
        ps.translate(k * -0.2785682, 0.18344387, 0.15731531);
        ps.rotX(-13.935);
        ps.rotY(k * 35.3);
        ps.rotZ(k * -9.785);
        const f8 = u.duration - (u.remaining - a.partial + 1);
        let f12 = f8 / 20;
        f12 = (f12 * f12 + f12 * 2) / 3;
        if (f12 > 1) f12 = 1;
        if (f12 > 0.1) ps.translate(0, Math.sin((f8 - 0.1) * 1.3) * (f12 - 0.1) * 0.004, 0);
        ps.translate(0, 0, f12 * 0.04);
        ps.scale(1, 1, 1 + f12 * 0.2);
        ps.rotY(-k * 45);
        break;
      }
      case 'spear': {
        applyItemArmTransform(ps, k, a.equip);
        ps.translate(k * -0.5, 0.7, 0.1);
        ps.rotX(-55);
        ps.rotY(k * 35.3);
        ps.rotZ(k * -9.785);
        const f7 = u.duration - (u.remaining - a.partial + 1);
        let f11 = f7 / 10;
        if (f11 > 1) f11 = 1;
        if (f11 > 0.1) ps.translate(0, Math.sin((f7 - 0.1) * 1.3) * (f11 - 0.1) * 0.004, 0);
        ps.translate(0, 0, f11 * 0.2);
        ps.scale(1, 1, 1 + f11 * 0.2);
        ps.rotY(-k * 45);
        break;
      }
      default:
        // NONE, BLOCK (shields are raised by the shield model itself), SPYGLASS
        applyItemArmTransform(ps, k, a.equip);
    }
    return;
  }
  if (a.autoSpin) {
    applyItemArmTransform(ps, k, a.equip);
    ps.translate(k * -0.4, 0.8, 0.3);
    ps.rotY(k * 65);
    ps.rotZ(k * -85);
    return;
  }
  swingOffset(ps, k, a.swing);
  applyItemArmTransform(ps, k, a.equip);
  applyItemArmAttackTransform(ps, k, a.swing);
}

function swingOffset(ps: PoseStack, k: 1 | -1, swing: number): void {
  const s = Math.sqrt(swing);
  ps.translate(k * -0.4 * Math.sin(s * Math.PI), 0.2 * Math.sin(s * Math.PI * 2), -0.2 * Math.sin(swing * Math.PI));
}

/**
 * ItemInHandRenderer.evaluateWhichHandsToRender: a bow or crossbow being used hides the other
 * hand, and a charged crossbow in the main hand hides the off hand.
 */
export function handsToRender(
  main: string | null, off: string | null, using: { hand: 0 | 1; item: string } | null, mainCharged: boolean, offCharged: boolean,
): { main: boolean; off: boolean } {
  const bowLike = (n: string | null) => n === 'bow' || n === 'crossbow';
  if (!bowLike(main) && !bowLike(off)) return { main: true, off: true };
  if (using) {
    if (!bowLike(using.item)) return using.hand === 0 && offCharged ? { main: true, off: false } : { main: true, off: true };
    return { main: using.hand === 0, off: using.hand === 1 };
  }
  return mainCharged ? { main: true, off: false } : { main: true, off: true };
}

/** Next equip heights, ItemInHandRenderer.tick (heights are 0..1, 1 = fully raised). */
export function tickHandHeight(height: number, target: number): number {
  return height + Math.max(-0.4, Math.min(0.4, target - height));
}
