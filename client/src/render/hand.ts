/**
 * First-person hand and held item (vanilla ItemInHandRenderer, right main arm): equip
 * height animation, swing transforms, view-lag sway from xBob/yBob, and the item display
 * transforms of block models (rotate 45°, scale 0.4) and generated item models.
 */
import { PoseStack } from './posestack';
import { createProgram, Uniforms } from './gl';
import { mat4, perspective, multiply, type Mat4 } from './math';
import type { EntityRenderer } from './entities/entityrenderer';
import { LIGHT0, LIGHT1 } from './entities/entityrenderer';
import type { ItemStack } from '@shared/item/stack';
import {
  FIRST_PERSON_DISPLAY, applyItemTransform, handSway, itemArmPose, playerArmPose,
  type HandUse, type ItemDisplay,
} from './handpose';

/** A held item's model as the hand renderer needs it: which parent display it uses and how to draw it. */
export interface HeldItemModel {
  /** parent model whose firstperson display transform applies (block/block, item/generated, …) */
  display: ItemDisplay;
  /**
   * Draw the model centred at the origin of `model` (the unit model space −0.5..0.5, i.e. after
   * vanilla's translate(−0.5, −0.5, −0.5)), lit by the packed light and the two view-space lights.
   */
  draw(proj: Mat4, model: Mat4, light: number, lightmap: WebGLTexture, lights: [[number, number, number], [number, number, number]]): void;
}

/**
 * Supplies held-item models: block items, extruded item sprites, … Plug in a better one (e.g.
 * an item-texture mesh builder) with HandRenderer.setHeldItemProvider; null = nothing drawn.
 */
export type HeldItemProvider = (stack: ItemStack) => HeldItemModel | null;

/** One hand's state for this frame. */
export interface HandSide {
  stack: ItemStack | null;
  swing: number; // getAttackAnim(partial) if this hand is swinging, else 0
  equip: number; // 1 − lerp(oHandHeight, handHeight)
  /** the item this hand is using (eating, drawing a bow, …), or null */
  use: HandUse | null;
  /** held crossbow state, or null when not holding a crossbow */
  crossbow: { charged: boolean } | null;
}

export interface HandFrame {
  main: HandSide;
  off: HandSide;
  /** evaluateWhichHandsToRender */
  renderMain: boolean;
  renderOff: boolean;
  partial: number;
  /** Riptide spin attack (isAutoSpinAttack) */
  autoSpin: boolean;
  /** looking through a spyglass: no hands */
  scoping: boolean;
  /** view rotation (deg) and the lagging xBob/yBob */
  pitch: number;
  yaw: number;
  xBob: number;
  yBob: number;
  light: number;
  skinName: string;
  aspect: number;
  /** FOV of the hand pass: 70 × fluid × death modifiers (never the FOV setting or sprint change) */
  fov: number;
  /** extra transform from bobHurt/bobView (applied before the hand, like the projection side) */
  bob: Mat4 | null;
  /** world-space → view-space rotation, to bring the level lights into view space */
  viewRot: Mat4;
  /** draw the hand/item (false: only screen effects) */
  showHand: boolean;
  /** burning overlay */
  onFire: boolean;
  /** texture layer of the block the camera is inside (in-wall overlay), or −1 */
  inWallLayer: number;
  /** underwater overlay: eye in water, with the eye-light brightness and view angles */
  underwater: { brightness: number; yaw: number; pitch: number } | null;
}

const FIRE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform mat4 uMVP;
out vec2 vUV;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vUV = aUV; }`;
const FIRE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform sampler2D uTex2D;
uniform int uUse2D;
uniform float uLayer;
uniform vec4 uColor;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 c = uUse2D == 1 ? texture(uTex2D, vUV) : texture(uTex, vec3(vUV, uLayer));
  outColor = c * uColor;
}`;

export { attackSpeedOf } from '@shared/game/combat';

export class HandRenderer {
  private readonly ps = new PoseStack();
  private readonly proj = mat4();
  private readonly l0: [number, number, number] = [0, 0, 0];
  private readonly l1: [number, number, number] = [0, 0, 0];

  private fireProg: WebGLProgram;
  private fireU: Uniforms;
  private fireVao: WebGLVertexArrayObject;
  private quadVao: WebGLVertexArrayObject;
  private quadVbo: WebGLBuffer;
  private underwaterTex: WebGLTexture | null = null;
  private readonly tmp = mat4();

  constructor(
    private gl: WebGL2RenderingContext,
    private entities: EntityRenderer,
    private heldItems: HeldItemProvider,
    private texArray: () => WebGLTexture,
    private fireLayer: number,
  ) {
    this.fireProg = createProgram(gl, FIRE_VS, FIRE_FS, 'fire-overlay');
    this.fireU = new Uniforms(gl, this.fireProg);
    // one unit quad at z = −0.5, u mirrored like vanilla's fire overlay
    const v = new Float32Array([-0.5, -0.5, -0.5, 1, 1, 0.5, -0.5, -0.5, 0, 1, 0.5, 0.5, -0.5, 0, 0, -0.5, -0.5, -0.5, 1, 1, 0.5, 0.5, -0.5, 0, 0, -0.5, 0.5, -0.5, 1, 0]);
    this.fireVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.fireVao);
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    // full-screen overlay quad at z = −0.5 (uv filled per use)
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    this.quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 30 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
    void this.loadUnderwater();
  }

  /** Replace the held-item model source (one function: stack → model). */
  setHeldItemProvider(p: HeldItemProvider): void {
    this.heldItems = p;
  }

  private async loadUnderwater(): Promise<void> {
    const bmp = await createImageBitmap(await (await fetch('./textures/environment/underwater.png')).blob());
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.underwaterTex = t;
  }

  private overlayState(): void {
    const gl = this.gl;
    gl.useProgram(this.fireProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texArray());
    gl.uniform1i(this.fireU.get('uTex'), 0);
    gl.uniform1i(this.fireU.get('uTex2D'), 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private restoreState(): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  /** A quad from (−1,−1) to (1,1) at z = −0.5 with the given corner uvs (u0 left, u1 right). */
  private drawQuad(proj: Mat4, u0: number, v0: number, u1: number, v1: number): void {
    const gl = this.gl;
    const d = new Float32Array([-1, -1, -0.5, u0, v1, 1, -1, -0.5, u1, v1, 1, 1, -0.5, u1, v0, -1, -1, -0.5, u0, v1, 1, 1, -0.5, u1, v0, -1, 1, -0.5, u0, v0]);
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
    gl.uniformMatrix4fv(this.fireU.get('uMVP'), false, proj);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** ScreenEffectRenderer.renderTex: the inside of the block the camera is stuck in, at 10% brightness. */
  private renderInWall(proj: Mat4, layer: number): void {
    const gl = this.gl;
    this.overlayState();
    gl.uniform1i(this.fireU.get('uUse2D'), 0);
    gl.uniform1f(this.fireU.get('uLayer'), layer);
    gl.uniform4f(this.fireU.get('uColor'), 0.1, 0.1, 0.1, 1);
    this.drawQuad(proj, 1, 0, 0, 1);
    this.restoreState();
  }

  /** ScreenEffectRenderer.renderWater: a faint dark texture that slides with the view. */
  private renderWater(proj: Mat4, u: { brightness: number; yaw: number; pitch: number }): void {
    if (!this.underwaterTex) return;
    const gl = this.gl;
    this.overlayState();
    gl.uniform1i(this.fireU.get('uUse2D'), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.underwaterTex);
    gl.activeTexture(gl.TEXTURE0);
    const b = u.brightness;
    gl.uniform4f(this.fireU.get('uColor'), b, b, b, 0.1);
    const f7 = -u.yaw / 64, f8 = u.pitch / 64;
    this.drawQuad(proj, 4 + f7, f8, f7, 4 + f8);
    this.restoreState();
  }

  /** ScreenEffectRenderer.renderFire: two tilted fire sprites in front of the camera. */
  private renderFire(proj: Mat4): void {
    const gl = this.gl;
    this.overlayState();
    gl.uniform1i(this.fireU.get('uUse2D'), 0);
    gl.uniform1f(this.fireU.get('uLayer'), this.fireLayer);
    gl.uniform4f(this.fireU.get('uColor'), 1, 1, 1, 0.9);
    gl.bindVertexArray(this.fireVao);
    for (let i = 0; i < 2; i++) {
      const ps = this.ps.reset();
      ps.translate(-(i * 2 - 1) * 0.24, -0.3, 0);
      ps.rotY((i * 2 - 1) * 10);
      multiply(this.tmp, proj, ps.last);
      gl.uniformMatrix4fv(this.fireU.get('uMVP'), false, this.tmp);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    this.restoreState();
  }

  render(f: HandFrame, lightmap: WebGLTexture): void {
    const gl = this.gl;
    // GameRenderer.renderItemInHand: its own projection (fixed FOV) and a cleared depth range
    gl.clear(gl.DEPTH_BUFFER_BIT);
    perspective(this.proj, (f.fov * Math.PI) / 180, f.aspect, 0.05, 100);
    if (f.showHand && !f.scoping) {
      this.base.set(this.proj);
      if (f.bob) multiply(this.proj, this.proj, f.bob);
      this.renderHands(f, lightmap);
      this.proj.set(this.base);
    }
    // screen effects (ScreenEffectRenderer) use the projection without view bobbing
    if (f.inWallLayer >= 0) this.renderInWall(this.proj, f.inWallLayer);
    if (f.underwater) this.renderWater(this.proj, f.underwater);
    if (f.onFire) this.renderFire(this.proj);
  }

  private readonly base = mat4();

  /** ItemInHandRenderer.renderHandsWithItems (right-handed player: main hand = right arm). */
  private renderHands(f: HandFrame, lightmap: WebGLTexture): void {
    // level lights in view space
    rotateDir(this.l0, f.viewRot, LIGHT0);
    rotateDir(this.l1, f.viewRot, LIGHT1);
    if (f.renderMain) this.renderArmWithItem(f, 1, true, f.main, lightmap);
    if (f.renderOff) this.renderArmWithItem(f, -1, false, f.off, lightmap);
  }

  /** renderArmWithItem: one hand (side 1 = right, −1 = left), the bare arm or the held item. */
  private renderArmWithItem(f: HandFrame, side: 1 | -1, mainHand: boolean, h: HandSide, lightmap: WebGLTexture): void {
    const gl = this.gl;
    const ps = this.ps.reset();
    handSway(ps, f.pitch, f.yaw, f.xBob, f.yBob);
    if (!h.stack) {
      // only the main hand shows the bare arm
      if (!mainHand) return;
      playerArmPose(ps, side, h.swing, h.equip);
      this.entities.renderFirstPersonArm(this.proj, ps.last, f.skinName, f.light, lightmap, this.l0, this.l1, side);
      return;
    }
    const model = this.heldItems(h.stack);
    if (!model) return;
    itemArmPose(ps, {
      side, swing: h.swing, equip: h.equip, partial: f.partial, use: h.use, autoSpin: f.autoSpin,
      crossbow: h.crossbow ? { charged: h.crossbow.charged, mainHand } : null,
    });
    // renderItem(FIRST_PERSON_RIGHT/LEFT_HAND): the model's display transform, then −0.5 centring
    const d = FIRST_PERSON_DISPLAY[model.display];
    applyItemTransform(ps, side === 1 ? d.right : d.left, side === -1);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    model.draw(this.proj, ps.last, f.light, lightmap, this.lights);
  }

  private readonly lights: [[number, number, number], [number, number, number]] = [this.l0, this.l1];
}

function rotateDir(out: [number, number, number], m: Mat4, v: [number, number, number]): void {
  out[0] = m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2];
  out[1] = m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2];
  out[2] = m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2];
}
