/**
 * Humanoid player model (vanilla PlayerModel proportions: 8×8×8 head, 8×12×4 body, 4×12×4
 * limbs, outer layers inflated by 0.5 / 0.25) with walk, look, crouch, swim and swing
 * animations following HumanoidModel.setupAnim.
 */
import type { PartDef } from './model';
import { PartPose } from './model';

export function playerParts(slim = false): PartDef[] {
  const aw = slim ? 3 : 4;
  return [
    { name: 'body', pivot: [0, 24, 0], boxes: [
      { from: [-4, -12, -2], size: [8, 12, 4], uv: [16, 16] },
      { from: [-4, -12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25 },
    ] },
    { name: 'head', pivot: [0, 24, 0], boxes: [
      { from: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] },
      { from: [-4, 0, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 },
    ] },
    { name: 'rightArm', pivot: [-5, 22, 0], boxes: [
      { from: [-aw + 1, -10, -2], size: [aw, 12, 4], uv: [40, 16] },
      { from: [-aw + 1, -10, -2], size: [aw, 12, 4], uv: [40, 32], inflate: 0.25 },
    ] },
    { name: 'leftArm', pivot: [5, 22, 0], boxes: [
      { from: [-1, -10, -2], size: [aw, 12, 4], uv: [32, 48] },
      { from: [-1, -10, -2], size: [aw, 12, 4], uv: [48, 48], inflate: 0.25 },
    ] },
    { name: 'rightLeg', pivot: [-1.9, 12, 0], boxes: [
      { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 16] },
      { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25 },
    ] },
    { name: 'leftLeg', pivot: [1.9, 12, 0], boxes: [
      { from: [-2, -12, -2], size: [4, 12, 4], uv: [16, 48] },
      { from: [-2, -12, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25 },
    ] },
  ];
}

export interface HumanoidAnim {
  /** limb swing position and amount (vanilla animationPosition / animationSpeed) */
  limbSwing: number;
  limbSwingAmount: number;
  ageInTicks: number;
  /** head yaw relative to the body, degrees (positive = toward the character's right) */
  netHeadYaw: number;
  headPitch: number;
  crouching: boolean;
  /** 0..1 progress of the arm swing (attack/use) */
  attackTime: number;
  /** which arm swings (the off hand swings the left arm for a right-handed player) */
  attackArm?: 'right' | 'left';
  swimAmount: number;
}

export function animateHumanoid(p: Record<string, PartPose>, a: HumanoidAnim): void {
  for (const k in p) p[k]!.reset();
  const { head, body, rightArm, leftArm, rightLeg, leftLeg } = p as Record<'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg', PartPose>;
  const deg = Math.PI / 180;
  // head look (negative yRot turns toward the character's right in this y-up model space)
  head.yRot = -a.netHeadYaw * deg;
  head.xRot = a.headPitch * deg;
  // walking
  const ls = a.limbSwing, la = a.limbSwingAmount;
  rightArm.xRot = Math.cos(ls * 0.6662 + Math.PI) * 2 * la * 0.5;
  leftArm.xRot = Math.cos(ls * 0.6662) * 2 * la * 0.5;
  rightLeg.xRot = Math.cos(ls * 0.6662) * 1.4 * la;
  leftLeg.xRot = Math.cos(ls * 0.6662 + Math.PI) * 1.4 * la;
  // attack / use swing (HumanoidModel.setupAttackAnimation, right arm)
  if (a.attackTime > 0) {
    let f = a.attackTime;
    const left = a.attackArm === 'left';
    body.yRot = -Math.sin(Math.sqrt(f) * Math.PI * 2) * 0.2;
    if (left) body.yRot *= -1;
    rightArm.z = Math.sin(body.yRot) * 5;
    rightArm.x = -Math.cos(body.yRot) * 5;
    leftArm.z = -Math.sin(body.yRot) * 5;
    leftArm.x = Math.cos(body.yRot) * 5;
    rightArm.yRot += body.yRot;
    leftArm.yRot += body.yRot;
    leftArm.xRot += body.yRot;
    f = 1 - a.attackTime;
    f *= f;
    f *= f;
    f = 1 - f;
    const f2 = Math.sin(f * Math.PI);
    const f3 = Math.sin(a.attackTime * Math.PI) * -(head.xRot - 0.7) * 0.75;
    const arm = left ? leftArm : rightArm;
    arm.xRot -= f2 * 1.2 + f3;
    arm.yRot += body.yRot * 2;
    arm.zRot += Math.sin(a.attackTime * Math.PI) * -0.4;
  }
  // crouching: lean forward, lower the head, pull the legs back
  if (a.crouching) {
    body.xRot = 0.5;
    rightArm.xRot += 0.4;
    leftArm.xRot += 0.4;
    // legs move back (front is +Z here)
    rightLeg.z -= 4;
    leftLeg.z -= 4;
    rightLeg.y -= 0.2;
    leftLeg.y -= 0.2;
    head.y -= 4.2;
    body.y -= 3.2;
    leftArm.y -= 3.2;
    rightArm.y -= 3.2;
  }
  // idle arm sway (bobModelPart)
  rightArm.zRot -= Math.cos(a.ageInTicks * 0.09) * 0.05 + 0.05;
  leftArm.zRot += Math.cos(a.ageInTicks * 0.09) * 0.05 + 0.05;
  rightArm.xRot += Math.sin(a.ageInTicks * 0.067) * 0.05;
  leftArm.xRot -= Math.sin(a.ageInTicks * 0.067) * 0.05;
}
