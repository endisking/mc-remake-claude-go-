/**
 * First-person hand and held item (vanilla ItemInHandRenderer, right main arm): equip
 * height animation, swing transforms, view-lag sway from xBob/yBob, and the item display
 * transforms of block models (rotate 45°, scale 0.4) and generated item models.
 */
import { PoseStack } from './posestack';
import { mat4, perspective, multiply, type Mat4 } from './math';
import type { EntityRenderer } from './entities/entityrenderer';
import { LIGHT0, LIGHT1 } from './entities/entityrenderer';
import type { BlockItemRenderer } from './blockitem';
import type { ItemStack } from '@shared/item/stack';
import { ITEMS_BY_ID } from '@shared/data';

export interface HandFrame {
  /** held item (main hand) and the block state it renders as, if any */
  stack: ItemStack | null;
  blockState: number | null;
  swing: number; // getAttackAnim(partial), 0..1
  equip: number; // 1 − lerp(oMainHandHeight, mainHandHeight)
  /** view rotation (deg) and the lagging xBob/yBob */
  pitch: number;
  yaw: number;
  xBob: number;
  yBob: number;
  light: number;
  skinName: string;
  aspect: number;
  /** FOV multiplier for being in water/lava */
  fluidFov: number;
  /** extra transform from bobHurt/bobView (applied before the hand, like the projection side) */
  bob: Mat4 | null;
  /** world-space → view-space rotation, to bring the level lights into view space */
  viewRot: Mat4;
}

/** Vanilla attack speeds (attack_speed attribute) of held items, for the equip dip. */
export function attackSpeedOf(id: number): number {
  const n = ITEMS_BY_ID[id]?.name ?? '';
  if (n.endsWith('_sword')) return 1.6;
  if (n.endsWith('_pickaxe')) return 1.2;
  if (n.endsWith('_shovel')) return 1.0;
  if (n.endsWith('_axe')) return n.startsWith('wooden') || n.startsWith('stone') ? 0.8 : n.startsWith('iron') ? 0.9 : 1.0;
  if (n.endsWith('_hoe')) return ({ wooden: 1, stone: 2, iron: 3, golden: 1, diamond: 4, netherite: 4 } as Record<string, number>)[n.split('_')[0]!] ?? 1;
  if (n === 'trident') return 1.1;
  return 4;
}

export class HandRenderer {
  private readonly ps = new PoseStack();
  private readonly proj = mat4();
  private readonly l0: [number, number, number] = [0, 0, 0];
  private readonly l1: [number, number, number] = [0, 0, 0];

  constructor(
    private gl: WebGL2RenderingContext,
    private entities: EntityRenderer,
    private items: BlockItemRenderer,
  ) {}

  render(f: HandFrame, lightmap: WebGLTexture): void {
    const gl = this.gl;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    perspective(this.proj, ((70 * f.fluidFov) * Math.PI) / 180, f.aspect, 0.05, 100);
    if (f.bob) multiply(this.proj, this.proj, f.bob);
    // level lights in view space
    rotateDir(this.l0, f.viewRot, LIGHT0);
    rotateDir(this.l1, f.viewRot, LIGHT1);

    const ps = this.ps.reset();
    // renderHandsWithItems: sway toward where the view is going
    ps.rotX((f.pitch - f.xBob) * 0.1);
    ps.rotY((f.yaw - f.yBob) * 0.1);
    const sp = f.swing, eq = f.equip, side = 1;
    if (!f.stack) {
      // renderPlayerArm
      const f1 = Math.sqrt(sp);
      const f2 = -0.3 * Math.sin(f1 * Math.PI);
      const f3 = 0.4 * Math.sin(f1 * Math.PI * 2);
      const f4 = -0.4 * Math.sin(sp * Math.PI);
      ps.translate(side * (f2 + 0.64000005), f3 - 0.6 + eq * -0.6, f4 - 0.71999997);
      ps.rotY(side * 45);
      const f5 = Math.sin(sp * sp * Math.PI);
      const f6 = Math.sin(f1 * Math.PI);
      ps.rotY(side * f6 * 70);
      ps.rotZ(side * f5 * -20);
      ps.translate(side * -1, 3.6, 3.5);
      ps.rotZ(side * 120);
      ps.rotX(200);
      ps.rotY(side * -135);
      ps.translate(side * 5.6, 0, 0);
      this.entities.renderFirstPersonArm(this.proj, ps.last, f.skinName, f.light, lightmap, this.l0, this.l1);
      return;
    }
    if (f.blockState === null) return; // non-block items have no model yet
    // renderArmWithItem (not using the item)
    const f5 = -0.4 * Math.sin(Math.sqrt(sp) * Math.PI);
    const f6 = 0.2 * Math.sin(Math.sqrt(sp) * Math.PI * 2);
    const f10 = -0.2 * Math.sin(sp * Math.PI);
    ps.translate(side * f5, f6, f10);
    // applyItemArmTransform
    ps.translate(side * 0.56, -0.52 + eq * -0.6, -0.72);
    // applyItemArmAttackTransform
    const a = Math.sin(sp * sp * Math.PI);
    ps.rotY(side * (45 + a * -20));
    const b = Math.sin(Math.sqrt(sp) * Math.PI);
    ps.rotZ(side * b * -20);
    ps.rotX(b * -80);
    ps.rotY(side * -45);
    // display transform firstperson_righthand (translation in px), then the model is centred
    if (this.items.isFlat(f.blockState)) {
      ps.translate(1.13 / 16, 3.2 / 16, 1.13 / 16);
      ps.rotY(-90).rotZ(25);
      ps.scale(0.68, 0.68, 0.68);
    } else {
      ps.rotY(45);
      ps.scale(0.4, 0.4, 0.4);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    this.items.draw(f.blockState, this.proj, ps.last, f.light, lightmap, undefined, false, [this.l0, this.l1]);
  }
}

function rotateDir(out: [number, number, number], m: Mat4, v: [number, number, number]): void {
  out[0] = m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2];
  out[1] = m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2];
  out[2] = m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2];
}
