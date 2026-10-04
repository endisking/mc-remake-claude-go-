/**
 * Entity renderer: draws box models part by part with a per-part matrix, skin texture,
 * vanilla-style two-light diffuse shading and lightmap lighting at the entity position.
 */
import { createProgram, Uniforms } from '../gl';
import { mat4, multiply, type Mat4 } from '../math';
import { bakeEntityModel, FLOATS_PER_VERTEX, PartPose, type BakedEntityModel, type PartDef } from './model';
import { playerParts, animateHumanoid } from './playermodel';
import type { RemotePlayer } from '../../world/entities';
import type { ClientWorld } from '../../world/clientworld';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uL0;
uniform vec3 uL1;
out vec2 vUV;
out float vShade;
out float vDist;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * w;
  vUV = aUV;
  vec3 n = normalize(mat3(uModel) * aNormal);
  // vanilla entity lighting: two directional lights + ambient
  vShade = min(1.0, 0.4 + 0.6 * (max(dot(n, uL0), 0.0) + max(dot(n, uL1), 0.0)));
  vDist = length(w.xyz);
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uLightmap;
uniform vec2 uLight;
uniform vec4 uOverlay;
uniform vec4 uFogColor;
uniform vec2 uFog;
in vec2 vUV;
in float vShade;
in float vDist;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.1) discard;
  c.rgb = mix(c.rgb, uOverlay.rgb, uOverlay.a);
  c.rgb *= vShade * texture(uLightmap, uLight).rgb;
  float f = clamp((vDist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
  outColor = vec4(mix(c.rgb, uFogColor.rgb, f), 1.0);
}`;

interface GpuModel {
  baked: BakedEntityModel;
  vao: WebGLVertexArrayObject;
}

/** Vanilla level lights (Lighting.setupLevel), world space. */
export const LIGHT0: [number, number, number] = norm(0.2, 1, -0.7);
export const LIGHT1: [number, number, number] = norm(-0.2, 1, 0.7);

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/** px → blocks with the player render scale (0.9375). */
const PLAYER_SCALE = 0.9375 / 16;

export class EntityRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private models = new Map<string, GpuModel>();
  private skins = new Map<string, WebGLTexture>();
  private defaultSkins: string[] = [];
  private readonly m = mat4();
  private readonly tmp = mat4();
  private readonly partMats: Float32Array[] = [];

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, 'entity');
    this.u = new Uniforms(gl, this.prog);
    this.models.set('player', this.upload(playerParts(false), 64, 64));
    this.models.set('player_slim', this.upload(playerParts(true), 64, 64));
  }

  async loadSkins(base = './textures/skins/'): Promise<void> {
    this.defaultSkins = (await (await fetch(`${base}skins.json`)).json()) as string[];
    await Promise.all(this.defaultSkins.map(async (n) => this.skins.set(n, await this.loadTexture(`${base}${n}.png`))));
  }

  private async loadTexture(url: string): Promise<WebGLTexture> {
    const bmp = await createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none' });
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Default skin for a player without a custom one: stable choice from the name. */
  skinFor(name: string, skin: string): string {
    if (skin && this.skins.has(skin)) return skin;
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return this.defaultSkins[Math.abs(h) % Math.max(1, this.defaultSkins.length)] ?? '';
  }

  private upload(parts: PartDef[], tw: number, th: number): GpuModel {
    const gl = this.gl;
    const baked = bakeEntityModel(parts, tw, th);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, baked.data, gl.STATIC_DRAW);
    const st = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 20);
    gl.bindVertexArray(null);
    return { baked, vao };
  }

  private poses = new Map<number, Record<string, PartPose>>();
  /** Held-item draws queued by renderPlayers (camera-relative matrix, light, item, left hand). */
  readonly held: { matrix: Mat4; light: number; item: number; left: boolean }[] = [];
  private heldPool: Mat4[] = [];
  /** Bed yaw (Direction.toYRot of FACING) under a sleeping player — set by the game. */
  bedFacing: ((p: RemotePlayer) => number | null) | null = null;
  /** Resolves whether an item has a model and whether it is flat (generated) — set by the game. */
  itemModel: (item: number) => { flat: boolean } | null = () => null;

  renderPlayers(
    players: Iterable<RemotePlayer>, world: ClientWorld, viewProj: Mat4, camX: number, camY: number, camZ: number, partial: number,
    lightmap: WebGLTexture, fog: [number, number, number], fogStart: number, fogEnd: number,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.uniform1i(this.u.get('uLightmap'), 1);
    gl.uniform4f(this.u.get('uFogColor'), fog[0], fog[1], fog[2], 1);
    gl.uniform2f(this.u.get('uFog'), fogStart, fogEnd);
    gl.uniform4f(this.u.get('uOverlay'), 1, 0, 0, 0);
    gl.uniform3f(this.u.get('uL0'), LIGHT0[0], LIGHT0[1], LIGHT0[2]);
    gl.uniform3f(this.u.get('uL1'), LIGHT1[0], LIGHT1[1], LIGHT1[2]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmap);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    const model = this.models.get('player')!;
    gl.bindVertexArray(model.vao);
    for (const p of players) {
      const x = p.xo + (p.x - p.xo) * partial - camX;
      const y = p.yo + (p.y - p.yo) * partial - camY;
      const z = p.zo + (p.z - p.zo) * partial - camZ;
      // LivingEntityRenderer.isShaking: fully frozen entities shiver
      const shake = p.ticksFrozen >= 140 ? (Math.cos((p.tickCount + partial) * 3.25) * Math.PI * 0.4) : 0;
      const bodyYaw = lerpAngle(p.bodyYawO, p.bodyYaw, partial) + shake;
      const headYaw = lerpAngle(p.headYawO, p.headYaw, partial);
      let poses = this.poses.get(p.id);
      if (!poses) {
        poses = {};
        for (const part of model.baked.parts) poses[part.def.name] = new PartPose(part.def);
        this.poses.set(p.id, poses);
      }
      animateHumanoid(poses, {
        limbSwing: p.animationPosition - p.animationSpeed * (1 - partial),
        limbSwingAmount: Math.min(1, p.animationSpeedOld + (p.animationSpeed - p.animationSpeedOld) * partial),
        ageInTicks: p.tickCount + partial,
        netHeadYaw: wrap(headYaw - bodyYaw),
        headPitch: p.pitchO + (p.pitch - p.pitchO) * partial,
        crouching: p.crouching,
        attackTime: p.attackAnimO + (p.attackAnim - p.attackAnimO) * partial,
        attackArm: p.swingingArm,
        swimAmount: 0,
      });
      // entity base transform: translate, rotate by body yaw (yaw 0 faces +Z), scale px → blocks
      const m = this.m;
      const bed = p.pose === 'sleeping' ? this.bedFacing?.(p) ?? null : null;
      if (bed !== null) {
        // LivingEntityRenderer.setupRotations (sleeping): lie along the bed, head on the pillow
        const yr = (bed * Math.PI) / 180;
        const sx = -Math.sin(yr), sz = Math.cos(yr); // bed facing (foot → head) as a vector
        const back = 1.62 - 0.1;
        m.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x - sx * back, y, z - sz * back, 1]);
        // model up (+Y) points toward the head end, model front (+Z) points up
        const r = mat4();
        r.set([-sz, 0, sx, 0, sx, 0, sz, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
        multiply(m, m, r);
        const sc = mat4();
        sc[0] = sc[5] = sc[10] = PLAYER_SCALE;
        multiply(m, m, sc);
      } else {
        const a = (-bodyYaw * Math.PI) / 180;
        const c = Math.cos(a), s = Math.sin(a);
        m.set([c * PLAYER_SCALE, 0, -s * PLAYER_SCALE, 0, 0, PLAYER_SCALE, 0, 0, s * PLAYER_SCALE, 0, c * PLAYER_SCALE, 0, x, y + (p.crouching ? -0.125 : 0), z, 1]);
      }
      const light = world.getLight(Math.floor(p.x), Math.floor(p.y + 1.62), Math.floor(p.z));
      gl.uniform2f(this.u.get('uLight'), ((light & 15) + 0.5) / 16, ((light >> 4) + 0.5) / 16);
      gl.bindTexture(gl.TEXTURE_2D, this.skins.get(this.skinFor(p.name, p.skin)) ?? null);
      // OverlayTexture: hurt entities are tinted 30% red
      gl.uniform4f(this.u.get('uOverlay'), 1, 0, 0, p.hurtTime > 0 ? 0.3 : 0);
      model.baked.parts.forEach((part, i) => {
        const pose = poses![part.def.name]!;
        if (!pose.visible) return;
        const pm = (this.partMats[i] ??= mat4());
        partMatrix(pm, pose);
        multiply(this.tmp, m, pm);
        gl.uniformMatrix4fv(this.u.get('uModel'), false, this.tmp);
        gl.drawArrays(gl.TRIANGLES, part.first, part.count);
      });
      // ItemInHandLayer: items held in each hand
      for (const [item, armName, left] of [[p.mainHand, 'rightArm', false], [p.offHand, 'leftArm', true]] as const) {
        if (!item) continue;
        const info = this.itemModel(item);
        if (!info) continue;
        const arm = poses[armName]!;
        const am = mat4();
        partMatrix(am, arm);
        const out = this.heldPool.pop() ?? mat4();
        multiply(out, m, am);
        multiply(out, out, heldItemTransform(left, info.flat));
        this.held.push({ matrix: out, light, item, left });
      }
    }
    gl.bindVertexArray(null);
  }

  /**
   * First-person arm (vanilla PlayerRenderer.renderRightHand): the right arm part drawn with
   * `base` (view space, vanilla model units where +Y is down) and the idle zRot of 0.1.
   */
  renderFirstPersonArm(proj: Mat4, base: Mat4, skinName: string, light: number, lightmap: WebGLTexture, l0: [number, number, number], l1: [number, number, number]): void {
    const gl = this.gl;
    const model = this.models.get('player')!;
    const part = model.baked.parts.find((p) => p.def.name === 'rightArm')!;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, proj);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.uniform1i(this.u.get('uLightmap'), 1);
    gl.uniform4f(this.u.get('uFogColor'), 0, 0, 0, 1);
    gl.uniform2f(this.u.get('uFog'), 1e6, 1e6 + 1);
    gl.uniform4f(this.u.get('uOverlay'), 1, 0, 0, 0);
    gl.uniform3f(this.u.get('uL0'), l0[0], l0[1], l0[2]);
    gl.uniform3f(this.u.get('uL1'), l1[0], l1[1], l1[2]);
    gl.uniform2f(this.u.get('uLight'), ((light & 15) + 0.5) / 16, ((light >> 4) + 0.5) / 16);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmap);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.skins.get(this.skinFor(skinName, '')) ?? null);
    // pivot (−5, 2, 0) in vanilla model space, zRot 0.1, px → blocks, then our model space
    // (y up, facing +Z) → vanilla's (y down, facing −Z): diag(1, −1, −1)
    const m = this.tmp;
    m.set(base);
    const c = Math.cos(0.1), s = Math.sin(0.1), k = 1 / 16;
    const r = this.m;
    r.set([c * k, s * k, 0, 0, s * k, -c * k, 0, 0, 0, 0, -k, 0, -5 / 16, 2 / 16, 0, 1]);
    multiply(m, m, r);
    gl.uniformMatrix4fv(this.u.get('uModel'), false, m);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(model.vao);
    gl.drawArrays(gl.TRIANGLES, part.first, part.count);
    gl.bindVertexArray(null);
  }
}

/** Return queued held-item matrices to the pool after drawing. */
export function recycleHeld(r: EntityRenderer): void {
  for (const h of r.held) (r as unknown as { heldPool: Mat4[] }).heldPool.push(h.matrix);
  r.held.length = 0;
}

/**
 * Hand → item transform in our model space (px): vanilla ItemInHandLayer.renderArmWithItem
 * (rotX −90, rotY 180, translate (±1/16, 0.125, −0.625)) and the item's thirdperson display
 * transform (blocks: rot (75, 45, 0), 2.5 px up, scale 0.375; generated: 3 px up, 1 px forward,
 * scale 0.55), converted from vanilla's y-down model space by diag(1, −1, −1) and px scale.
 */
function heldItemTransform(left: boolean, flat: boolean): Mat4 {
  const out = mat4();
  const mul = (b: Mat4) => multiply(out, out, b);
  const S = mat4();
  S[0] = 16; S[5] = -16; S[10] = -16; // px · diag(1, −1, −1)
  mul(S);
  mul(rot(1, 0, 0, -90));
  mul(rot(0, 1, 0, 180));
  mul(tr((left ? -1 : 1) / 16, 0.125, -0.625));
  const sgn = left ? -1 : 1;
  if (flat) {
    mul(tr(0, 3 / 16, 1 / 16));
    const k = mat4();
    k[0] = k[5] = k[10] = 0.55;
    mul(k);
  } else {
    mul(tr(0, 2.5 / 16, 0));
    mul(rot(1, 0, 0, 75));
    mul(rot(0, 1, 0, 45 * sgn));
    const k = mat4();
    k[0] = k[5] = k[10] = 0.375;
    mul(k);
  }
  return out;
}

function tr(x: number, y: number, z: number): Mat4 {
  const m = mat4();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function rot(x: number, y: number, z: number, deg: number): Mat4 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const m = mat4();
  m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
  return m;
}

/** translate(pivot) · rotZ · rotY · rotX (vanilla ModelPart.translateAndRotate order). */
function partMatrix(out: Mat4, p: PartPose): void {
  const cx = Math.cos(p.xRot), sx = Math.sin(p.xRot);
  const cy = Math.cos(p.yRot), sy = Math.sin(p.yRot);
  const cz = Math.cos(p.zRot), sz = Math.sin(p.zRot);
  // R = Rz * Ry * Rx
  const r00 = cz * cy, r01 = cz * sy * sx - sz * cx, r02 = cz * sy * cx + sz * sx;
  const r10 = sz * cy, r11 = sz * sy * sx + cz * cx, r12 = sz * sy * cx - cz * sx;
  const r20 = -sy, r21 = cy * sx, r22 = cy * cx;
  out[0] = r00; out[1] = r10; out[2] = r20; out[3] = 0;
  out[4] = r01; out[5] = r11; out[6] = r21; out[7] = 0;
  out[8] = r02; out[9] = r12; out[10] = r22; out[11] = 0;
  out[12] = p.x; out[13] = p.y; out[14] = p.z; out[15] = 1;
}

function wrap(a: number): number {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrap(b - a) * t;
}
