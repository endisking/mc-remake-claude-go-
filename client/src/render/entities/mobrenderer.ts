/**
 * Mob renderer (vanilla LivingEntityRenderer / MobRenderer): box models with per-type layers
 * (saddle, wool tinted by dye colour, full-bright eyes, translucent slime body), the red hurt
 * overlay, the creeper's white fuse flash, the death fall-over, baby proportions, blob shadows
 * on the blocks below (EntityRenderDispatcher.renderShadow), the burning overlay and the death
 * poof particles.
 */
import { createProgram, Uniforms } from '../gl';
import { mat4, multiply, type Mat4 } from '../math';
import { FLOATS_PER_VERTEX } from './model';
import { LIGHT0, LIGHT1 } from './entityrenderer';
import { ITEMS_BY_NAME } from '@shared/data';
import { MOB_MODELS, MOB_RENDER, MOB_TEXTURES, MOB_SCROLLING, bakeMobModel, createPoses, type BakedMobModel, type MobAnim, type MobModelDef, type Poses, type VPose } from './mobmodels';
import type { ClientMob } from '../../world/mobs';
import type { ClientWorld } from '../../world/clientworld';
import { FLUID, FULL_COLLISION } from '@shared/world/blockinfo';
import { BitmapFont } from '../../gui/gui';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uL0;
uniform vec3 uL1;
uniform vec4 uUVRect;
out vec2 vUV;
out float vShade;
out float vDist;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * w;
  vUV = uUVRect.xy + aUV * uUVRect.zw;
  vec3 n = normalize(mat3(uModel) * aNormal);
  vShade = min(1.0, 0.4 + 0.6 * (max(dot(n, uL0), 0.0) + max(dot(n, uL1), 0.0)));
  vDist = length(w.xyz);
}`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uLightmap;
uniform vec2 uLight;
uniform vec4 uOverlay;
uniform vec4 uColor;
uniform vec4 uFogColor;
uniform vec2 uFog;
uniform float uEmissive;
uniform float uNoShade;
uniform float uCutout;
uniform float uMaxAlpha;
in vec2 vUV;
in float vShade;
in float vDist;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < uCutout) discard;
  c *= uColor;
  c.a = min(c.a, uMaxAlpha);
  float f = clamp((vDist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
  if (uEmissive > 0.5) {
    // RenderType.eyes: full bright, additive, fogged toward black
    outColor = vec4(c.rgb * (1.0 - f), c.a);
    return;
  }
  c.rgb = mix(c.rgb, uOverlay.rgb, uOverlay.a);
  c.rgb *= (uNoShade > 0.5 ? 1.0 : vShade) * texture(uLightmap, uLight).rgb;
  outColor = vec4(mix(c.rgb, uFogColor.rgb, f), c.a);
}`;

const SHADOW_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aUVA;
uniform mat4 uViewProj;
out vec3 vUVA;
out float vDist;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vUVA = aUVA; vDist = length(aPos); }`;
const SHADOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uFog;
in vec3 vUVA;
in float vDist;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUVA.xy);
  float f = clamp((vDist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
  outColor = vec4(c.rgb, c.a * vUVA.z * (1.0 - f));
}`;

interface GpuModel {
  def: MobModelDef;
  baked: BakedMobModel;
  vao: WebGLVertexArrayObject;
}

interface Poof {
  x: number; y: number; z: number;
  xo: number; yo: number; zo: number;
  vx: number; vy: number; vz: number;
  age: number; life: number; size: number; col: number;
}

/** unit quad for flames and particles: x −0.5..0.5, y 0..1, uv 0..1 (facing +Z) */
const QUAD = new Float32Array([
  -0.5, 0, 0, 0, 1, 0, 0, 1, 0.5, 0, 0, 1, 1, 0, 0, 1, 0.5, 1, 0, 1, 0, 0, 0, 1,
  -0.5, 0, 0, 0, 1, 0, 0, 1, 0.5, 1, 0, 1, 0, 0, 0, 1, -0.5, 1, 0, 0, 0, 0, 0, 1,
]);

const MAX_SHADOW_QUADS = 4096;

export class MobRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private shadowProg: WebGLProgram;
  private su: Uniforms;
  private models = new Map<string, GpuModel>();
  private textures = new Map<string, WebGLTexture>();
  private fire: { tex: WebGLTexture; frames: number }[] = [];
  private shadowTex: WebGLTexture | null = null;
  private poofTex: WebGLTexture | null = null;
  private quadVao: WebGLVertexArrayObject;
  private shadowVao: WebGLVertexArrayObject;
  private shadowVbo: WebGLBuffer;
  private shadowVerts = new Float32Array(MAX_SHADOW_QUADS * 6 * 6);
  private poses = new Map<number, Map<string, Poses>>();
  private poofs: Poof[] = [];
  private readonly E = mat4();
  private readonly roots = [mat4(), mat4(), mat4()];
  private readonly mats: Mat4[] = [];
  private readonly tmp = mat4();
  private readonly tmp2 = mat4();
  private readonly anim: MobAnim = { limbSwing: 0, limbSwingAmount: 0, ageInTicks: 0, netHeadYaw: 0, headPitch: 0, attackTime: 0, partial: 0, mob: null as unknown as ClientMob };
  private readonly burning: ClientMob[] = [];
  private readonly shadowed: ClientMob[] = [];
  /** game ticks, for animated flames */
  ticks = 0;
  private font: BitmapFont | null = null;
  private nameTextures = new Map<string, { tex: WebGLTexture; w: number; h: number; used: number }>();
  /** the entity under the crosshair (its name tag shows) */
  target: number | null = null;
  /** name tags are hidden with the HUD (F1) */
  names = true;
  /**
   * Receives a held item to draw (ItemInHandLayer): the arm's camera-relative matrix in
   * y-up / +Z-front model space (as the player renderer produces), light, item id, hand.
   */
  onHeld: ((arm: Mat4, light: number, item: number, left: boolean) => void) | null = null;
  private readonly armTmp = mat4();
  /** Entity Shadows video option */
  shadows = true;

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, 'mob');
    this.u = new Uniforms(gl, this.prog);
    this.shadowProg = createProgram(gl, SHADOW_VS, SHADOW_FS, 'mob-shadow');
    this.su = new Uniforms(gl, this.shadowProg);
    for (const [name, def] of Object.entries(MOB_MODELS)) {
      const baked = bakeMobModel(def.parts, def.tex[0], def.tex[1]);
      this.models.set(name, { def, baked, vao: this.vao(baked.data) });
    }
    this.quadVao = this.vao(QUAD);
    this.shadowVao = gl.createVertexArray()!;
    this.shadowVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.shadowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);
  }

  private vao(data: Float32Array): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const st = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 20);
    gl.bindVertexArray(null);
    return vao;
  }

  async load(base = './textures/'): Promise<void> {
    const load = async (url: string, clamp = true) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const gl = this.gl;
        const t = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT);
        return { tex: t, w: bmp.width, h: bmp.height };
      } catch {
        return null;
      }
    };
    await Promise.all([
      ...MOB_TEXTURES.map(async (n) => {
        const t = await load(`${base}entity/${n}.png`, !MOB_SCROLLING.has(n));
        if (t) this.textures.set(n, t.tex);
      }),
      (async () => {
        try {
          this.font = await BitmapFont.load(`${base}font/`);
        } catch {
          this.font = null;
        }
      })(),
      (async () => {
        this.shadowTex = (await load(`${base}misc/shadow.png`))?.tex ?? null;
        this.poofTex = (await load(`${base}particle/poof.png`))?.tex ?? null;
        for (const n of ['fire_0', 'fire_1']) {
          const t = await load(`${base}block/${n}.png`);
          if (t) this.fire.push({ tex: t.tex, frames: Math.max(1, Math.round(t.h / t.w)) });
        }
      })(),
    ]);
  }

  /** LivingEntity.makePoofParticles: 20 poof particles over the bounding box. */
  poof(m: ClientMob): void {
    const [w, h] = m.dims();
    for (let i = 0; i < 20; i++) {
      const g = () => gaussian() * 0.02;
      const x = m.x + w * (2 * Math.random() - 1) * 1, y = m.y + h * Math.random(), z = m.z + w * (2 * Math.random() - 1) * 1;
      // ExplodeParticle: small random drift, gravity −0.1 (rises), friction 0.9
      const vx = g() + (Math.random() * 2 - 1) * 0.05, vy = g() + (Math.random() * 2 - 1) * 0.05, vz = g() + (Math.random() * 2 - 1) * 0.05;
      const r = Math.random();
      this.poofs.push({
        x, y, z, xo: x, yo: y, zo: z, vx, vy, vz, age: 0,
        life: Math.floor(16 / (Math.random() * 0.8 + 0.2)) + 2,
        size: 0.1 * (r * r * 6 + 1), col: Math.random() * 0.3 + 0.7,
      });
    }
  }

  tick(): void {
    this.ticks++;
    let w = 0;
    for (const p of this.poofs) {
      p.xo = p.x;
      p.yo = p.y;
      p.zo = p.z;
      if (p.age++ >= p.life) continue;
      p.vy -= 0.04 * -0.1;
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.vz *= 0.9;
      this.poofs[w++] = p;
    }
    this.poofs.length = w;
  }

  render(
    mobs: Iterable<ClientMob>, world: ClientWorld, viewProj: Mat4, camX: number, camY: number, camZ: number, camYaw: number, camPitch: number, partial: number,
    lightmap: WebGLTexture, fog: [number, number, number], fogStart: number, fogEnd: number, skyDarken: number,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.uniform1i(this.u.get('uLightmap'), 1);
    gl.uniform4f(this.u.get('uFogColor'), fog[0], fog[1], fog[2], 1);
    gl.uniform2f(this.u.get('uFog'), fogStart, fogEnd);
    gl.uniform3f(this.u.get('uL0'), LIGHT0[0], LIGHT0[1], LIGHT0[2]);
    gl.uniform3f(this.u.get('uL1'), LIGHT1[0], LIGHT1[1], LIGHT1[2]);
    gl.uniform4f(this.u.get('uUVRect'), 0, 0, 1, 1);
    gl.uniform1f(this.u.get('uNoShade'), 0);
    gl.uniform1f(this.u.get('uCutout'), 0.1);
    gl.uniform1f(this.u.get('uMaxAlpha'), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmap);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.depthFunc(gl.LEQUAL);
    const burning = this.burning, shadowed = this.shadowed;
    burning.length = shadowed.length = 0;
    for (const m of mobs) {
      if (m.invisible) continue;
      this.renderMob(m, world, camX, camY, camZ, partial);
      if (m.onFire) burning.push(m);
      shadowed.push(m);
    }
    for (const m of burning) this.renderFlame(m, world, camX, camY, camZ, camYaw, partial);
    this.renderPoofs(world, camX, camY, camZ, camYaw, camPitch, partial);
    if (this.names) for (const m of shadowed) this.renderNameTag(m, world, camX, camY, camZ, camYaw, camPitch, partial);
    gl.depthFunc(gl.LESS);
    if (this.shadows) this.renderShadows(shadowed, world, viewProj, camX, camY, camZ, partial, fogStart, fogEnd, skyDarken);
    else this.casterCount = 0;
    gl.bindVertexArray(null);
  }

  private posesFor(m: ClientMob, model: string): Poses {
    let byModel = this.poses.get(m.id);
    if (!byModel) this.poses.set(m.id, (byModel = new Map()));
    let p = byModel.get(model);
    if (!p) byModel.set(model, (p = createPoses(MOB_MODELS[model]!.parts)));
    return p;
  }

  /** Drop cached poses of mobs that are gone. */
  forget(id: number): void {
    this.poses.delete(id);
  }

  private renderMob(m: ClientMob, world: ClientWorld, camX: number, camY: number, camZ: number, partial: number): void {
    const gl = this.gl;
    const rdef = MOB_RENDER[m.type] ?? MOB_RENDER.unknown!;
    const x = m.xo + (m.x - m.xo) * partial - camX;
    const y = m.yo + (m.y - m.yo) * partial - camY;
    const z = m.zo + (m.z - m.zo) * partial - camZ;
    const bodyYaw = lerpAngle(m.bodyYawO, m.bodyYaw, partial);
    const headYaw = lerpAngle(m.headYawO, m.headYaw, partial);
    // entity transform: E = T · Ry(−bodyYaw) · Rz(death) · S(scale/16) · V, V = vanilla → world (px)
    const E = this.E;
    setIdentity(E);
    E[12] = x;
    E[13] = y;
    E[14] = z;
    mulRotY(E, (-bodyYaw * Math.PI) / 180);
    if (m.deathTime > 0) {
      // LivingEntityRenderer.setupRotations: fall over with a sqrt ease over 20 ticks
      let f = ((m.deathTime + partial - 1) / 20) * 1.6;
      f = Math.sqrt(f);
      if (f > 1) f = 1;
      mulRotZ(E, (-f * m.info.flip * Math.PI) / 180);
    }
    if (m.type === 'bat') {
      // BatRenderer.setupRotations: bob while flying, hang slightly lower when resting
      const hanging = (m.data.get('hanging') ?? 0) !== 0;
      mulTranslate(E, 0, hanging ? -0.1 : Math.cos((m.tickCount + partial) * 0.3) * 0.1, 0);
    }
    if (m.type === 'iron_golem' && m.animationSpeed >= 0.01) {
      // IronGolemRenderer.setupRotations: side-to-side sway in step with the stride
      const f1 = m.animationPosition - m.animationSpeed * (1 - partial) + 6;
      const f2 = (Math.abs((f1 % 13) - 6.5) - 3.25) / 3.25;
      mulRotZ(E, (-6.5 * f2 * Math.PI) / 180);
    }
    if (m.type === 'phantom') {
      // PhantomRenderer.setupRotations: the body pitches with its flight
      mulRotX(E, ((m.pitchO + (m.pitch - m.pitchO) * partial) * Math.PI) / 180);
    }
    if (m.type === 'cod' || m.type === 'salmon') {
      // CodRenderer / SalmonRenderer.setupRotations: body wiggle; stranded fish lie on their side
      m.inWater = FLUID[world.getState(Math.floor(m.x), Math.floor(m.y + 0.1), Math.floor(m.z))] === 1;
      const salmon = m.type === 'salmon';
      const age = m.tickCount + partial;
      const f = salmon ? (m.inWater ? 1 : 1.3) * 4.3 * Math.sin((m.inWater ? 1 : 1.7) * 0.6 * age) : 4.3 * Math.sin(0.6 * age);
      mulRotY(E, (-f * Math.PI) / 180);
      if (salmon) mulTranslate(E, 0, 0, 0.4);
      if (!m.inWater) {
        mulTranslate(E, salmon ? -0.2 : -0.1, 0.1, salmon ? 0 : 0.1);
        mulRotZ(E, -Math.PI / 2);
      }
    }
    if (m.type === 'squid') {
      // SquidRenderer.setupRotations: pivot about the mantle, tilted by the swim angle
      mulTranslate(E, 0, 0.5, 0);
      mulRotX(E, (-(m.xBodyRotO + (m.xBodyRot - m.xBodyRotO) * partial) * Math.PI) / 180);
      mulTranslate(E, 0, -1.2, 0);
    }
    let sx = 1, sy = 1, sz = 1;
    const base = (rdef.scale ?? 1) * (m.baby && rdef.babyScale ? rdef.babyScale : 1);
    sx = sy = sz = base;
    if (!MOB_RENDER[m.type]) {
      // mobs without a model yet: a box the size of their hit box, so they can be seen and hit
      const [bw, bh] = m.dims();
      sx = sz = bw;
      sy = bh;
    }
    if (m.type === 'creeper') {
      // CreeperRenderer.scale: swell wider than tall, with a jitter
      let f = m.swelling(partial);
      const f1 = 1 + Math.sin(f * 100) * f * 0.01;
      f = Math.min(1, Math.max(0, f));
      f *= f;
      f *= f;
      sx = sz = (1 + f * 0.4) * f1;
      sy = (1 + f * 0.1) / f1;
    } else if (m.type === 'slime') {
      // SlimeRenderer.scale: size, squashed/stretched by the squish
      const size = m.slimeSize;
      const f2 = (m.oSquish + (m.squish - m.oSquish) * partial) / (size * 0.5 + 1);
      const f3 = 1 / (f2 + 1);
      sx = sz = base * f3 * size;
      sy = base * (1 / f3) * size;
    }
    mulScale(E, sx / 16, sy / 16, sz / 16);
    // V: vanilla model space (y down, front −Z, feet at y = 24) → y up, front +Z
    mulTranslate(E, 0, 24, 0);
    mulScale(E, 1, -1, -1);
    if (m.type === 'phantom') {
      // PhantomRenderer.scale: 1 + 0.15·size, then shifted down onto its flat hit box
      const k = 1 + 0.15 * (m.data.get('size') ?? 0);
      mulScale(E, k, k, k);
      mulTranslate(E, 0, 21, 3);
    }
    // baby roots (AgeableListModel)
    const [rPlain, rHead, rBody] = this.roots;
    rPlain!.set(E);
    // lighting at the eyes
    const [, h] = m.dims();
    const light = world.getLight(Math.floor(m.x), Math.floor(m.y + h * 0.85), Math.floor(m.z));
    gl.uniform2f(this.u.get('uLight'), ((light & 15) + 0.5) / 16, ((light >> 4) + 0.5) / 16);
    // overlay: red while hurt or dying, else the creeper's white flash
    let overlay = 0, white = false;
    if (m.hurtTime > 0 || m.deathTime > 0) overlay = 0.3;
    else if (m.type === 'creeper') {
      const f = m.swelling(partial);
      const p = Math.floor(f * 10) % 2 === 0 ? 0 : Math.min(1, Math.max(0.5, f));
      overlay = (Math.floor(p * 15) / 15) * 0.75;
      white = true;
    }
    const baby = m.baby;
    const anim = this.anim;
    anim.limbSwing = (m.animationPosition - m.animationSpeed * (1 - partial)) * (baby ? 3 : 1);
    anim.limbSwingAmount = Math.min(1, m.animationSpeedOld + (m.animationSpeed - m.animationSpeedOld) * partial);
    anim.ageInTicks = m.tickCount + partial;
    anim.netHeadYaw = wrap(headYaw - bodyYaw);
    anim.headPitch = m.pitchO + (m.pitch - m.pitchO) * partial;
    anim.attackTime = m.attackAnimO + (m.attackAnim - m.attackAnimO) * partial;
    anim.partial = partial;
    anim.mob = m;
    for (const layer of rdef.layers) {
      if (layer.when && !layer.when(m)) continue;
      const tex = this.textures.get(layer.texture);
      if (!tex) continue;
      const gm = this.models.get(layer.model)!;
      const def = gm.def;
      const poses = this.posesFor(m, layer.model);
      for (const k in poses) poses[k]!.reset();
      def.anim(poses, anim);
      if (baby && def.baby) {
        const bp = def.baby;
        const hs = bp.scaleHead ? 1.5 / bp.headScale : 1;
        rHead!.set(E);
        mulScale(rHead!, hs, hs, hs);
        mulTranslate(rHead!, 0, bp.yHead, bp.zHead);
        rBody!.set(E);
        const bs = 1 / bp.bodyScale;
        mulScale(rBody!, bs, bs, bs);
        mulTranslate(rBody!, 0, bp.bodyY, 0);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const c = layer.color?.(m);
      gl.uniform4f(this.u.get('uColor'), c ? c[0] : 1, c ? c[1] : 1, c ? c[2] : 1, 1);
      if (layer.emissive) {
        gl.uniform1f(this.u.get('uEmissive'), 1);
        gl.uniform4f(this.u.get('uOverlay'), 0, 0, 0, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);
      } else {
        gl.uniform1f(this.u.get('uEmissive'), 0);
        gl.uniform4f(this.u.get('uOverlay'), 1, white ? 1 : 0, white ? 1 : 0, overlay);
        if (layer.translucent) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
      }
      if (layer.scroll) {
        // CreeperPowerLayer: the energy swirl texture scrolls with age (u, v += 0.01·age)
        const f = (m.tickCount + partial) * 0.01;
        gl.uniform4f(this.u.get('uUVRect'), f, f, 1, 1);
      }
      gl.bindVertexArray(gm.vao);
      const parts = gm.baked.parts;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const pose = poses[part.def.name]!;
        const out = (this.mats[i] ??= mat4());
        let parentM: Mat4;
        if (part.parent >= 0) parentM = this.mats[part.parent]!;
        else if (baby && def.baby) parentM = def.headParts?.includes(part.def.name) ? rHead! : rBody!;
        else parentM = rPlain!;
        partMatrix(this.tmp, pose);
        multiply(out, parentM, this.tmp);
        if (!pose.visible || part.count === 0) continue;
        gl.uniformMatrix4fv(this.u.get('uModel'), false, out);
        gl.drawArrays(gl.TRIANGLES, part.first, part.count);
      }
      if (layer.emissive || layer.translucent) {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
      if (layer.scroll) gl.uniform4f(this.u.get('uUVRect'), 0, 0, 1, 1);
      if (layer === rdef.layers[0] && this.onHeld) this.emitHeld(m, gm, poses, light);
    }
  }

  /** EntityRenderDispatcher.renderFlame: stacked camera-facing fire sheets over the entity. */
  private renderFlame(m: ClientMob, world: ClientWorld, camX: number, camY: number, camZ: number, camYaw: number, partial: number): void {
    if (this.fire.length < 2) return;
    const gl = this.gl;
    const [w, h] = m.dims();
    const x = m.xo + (m.x - m.xo) * partial - camX;
    const y = m.yo + (m.y - m.yo) * partial - camY;
    const z = m.zo + (m.z - m.zo) * partial - camZ;
    const f = w * 1.4;
    let f3 = h / f;
    let f4 = 0, f1 = 0.5, f5 = 0, i = 0;
    const M = this.tmp2;
    gl.bindVertexArray(this.quadVao);
    gl.uniform1f(this.u.get('uEmissive'), 0);
    gl.uniform1f(this.u.get('uNoShade'), 1);
    gl.uniform4f(this.u.get('uOverlay'), 0, 0, 0, 0);
    gl.uniform4f(this.u.get('uColor'), 1, 1, 1, 1);
    gl.uniform2f(this.u.get('uLight'), 15.5 / 16, 15.5 / 16);
    gl.disable(gl.CULL_FACE);
    void world;
    while (f3 > 0) {
      const fire = this.fire[i % 2]!;
      gl.bindTexture(gl.TEXTURE_2D, fire.tex);
      const frame = Math.floor(this.ticks) % fire.frames;
      const flip = Math.floor(i / 2) % 2 === 0;
      gl.uniform4f(this.u.get('uUVRect'), flip ? 1 : 0, frame / fire.frames, flip ? -1 : 1, 1 / fire.frames);
      setIdentity(M);
      M[12] = x;
      M[13] = y;
      M[14] = z;
      mulScale(M, f, f, f);
      mulRotY(M, (-camYaw * Math.PI) / 180 + Math.PI);
      mulTranslate(M, 0, 0, 0.3 - Math.floor(f3) * 0.02);
      // one sheet: width 2·f1, height 1.4, raised by −f4, pushed back by f5
      mulTranslate(M, 0, -f4, -f5);
      mulScale(M, f1 * 2, 1.4, 1);
      gl.uniformMatrix4fv(this.u.get('uModel'), false, M);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      f3 -= 0.45;
      f4 -= 0.45;
      f1 *= 0.9;
      f5 += 0.03;
      i++;
    }
    gl.uniform4f(this.u.get('uUVRect'), 0, 0, 1, 1);
    gl.uniform1f(this.u.get('uNoShade'), 0);
    gl.enable(gl.CULL_FACE);
  }

  private renderPoofs(world: ClientWorld, camX: number, camY: number, camZ: number, camYaw: number, camPitch: number, partial: number): void {
    if (!this.poofs.length || !this.poofTex) return;
    const gl = this.gl;
    gl.bindVertexArray(this.quadVao);
    gl.bindTexture(gl.TEXTURE_2D, this.poofTex);
    gl.uniform1f(this.u.get('uEmissive'), 0);
    gl.uniform1f(this.u.get('uNoShade'), 1);
    gl.uniform4f(this.u.get('uOverlay'), 0, 0, 0, 0);
    gl.disable(gl.CULL_FACE);
    const M = this.tmp2;
    for (const p of this.poofs) {
      // setSpriteFromAge over 8 frames (big puff → wisp)
      const frame = Math.min(7, Math.floor((p.age * 8) / (p.life + 1)));
      gl.uniform4f(this.u.get('uUVRect'), frame / 8, 0, 1 / 8, 1);
      gl.uniform4f(this.u.get('uColor'), p.col, p.col, p.col, 1);
      const light = world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      gl.uniform2f(this.u.get('uLight'), ((light & 15) + 0.5) / 16, ((light >> 4) + 0.5) / 16);
      setIdentity(M);
      M[12] = p.xo + (p.x - p.xo) * partial - camX;
      M[13] = p.yo + (p.y - p.yo) * partial - camY;
      M[14] = p.zo + (p.z - p.zo) * partial - camZ;
      mulRotY(M, (-camYaw * Math.PI) / 180 + Math.PI);
      mulRotX(M, (-camPitch * Math.PI) / 180);
      const s = p.size * 2;
      mulScale(M, s, s, s);
      mulTranslate(M, 0, -0.5, 0);
      gl.uniformMatrix4fv(this.u.get('uModel'), false, M);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.uniform4f(this.u.get('uUVRect'), 0, 0, 1, 1);
    gl.uniform1f(this.u.get('uNoShade'), 0);
    gl.enable(gl.CULL_FACE);
  }

  /** ItemInHandLayer for humanoid mobs: the main-hand item at the right arm. */
  private emitHeld(m: ClientMob, gm: GpuModel, poses: Poses, light: number): void {
    let item = m.mainHand;
    if (item < 0) item = DEFAULT_HELD.get(m.type) ?? 0;
    if (item <= 0 || m.deathTime > 0) return;
    const idx = gm.baked.parts.findIndex((p) => p.def.name === 'right_arm');
    if (idx < 0 || !poses.right_arm!.visible) return;
    // our-space arm matrix = (vanilla-space arm matrix) · diag(1, −1, −1)
    const a = this.armTmp;
    a.set(this.mats[idx]!);
    for (let i = 4; i < 12; i++) a[i] = -a[i]!;
    this.onHeld!(a, light, item, false);
  }

  private nameTexture(name: string): { tex: WebGLTexture; w: number; h: number; used: number } | null {
    const font = this.font;
    if (!font) return null;
    let t = this.nameTextures.get(name);
    if (!t) {
      // text plus vanilla's 25%-black background (1 px margin), white text without shadow
      const w = font.width(name) + 1, h = font.lineHeight + 1;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, w, h);
      font.draw(ctx, name, 1, 1, 0xffffff, false);
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t = { tex, w, h, used: 0 };
      this.nameTextures.set(name, t);
      if (this.nameTextures.size > 64) {
        // drop the least recently drawn name
        let oldest: string | null = null, best = Infinity;
        for (const [k, v] of this.nameTextures) if (v.used < best) [oldest, best] = [k, v.used];
        if (oldest !== null && oldest !== name) {
          gl.deleteTexture(this.nameTextures.get(oldest)!.tex);
          this.nameTextures.delete(oldest);
        }
      }
    }
    t.used = this.ticks;
    return t;
  }

  /**
   * MobRenderer.shouldShowName + EntityRenderer.renderNameTag: a named mob's name floats 0.5
   * above its head when looked at (or always if marked visible), within 64 blocks; the
   * background and a faint copy show through walls, the solid text is depth-tested.
   */
  private renderNameTag(m: ClientMob, world: ClientWorld, camX: number, camY: number, camZ: number, camYaw: number, camPitch: number, partial: number): void {
    if (!m.customName) return;
    if (m.id !== this.target && !(m.data.get('name_visible') ?? 0)) return;
    const x = m.xo + (m.x - m.xo) * partial - camX;
    const y = m.yo + (m.y - m.yo) * partial - camY;
    const z = m.zo + (m.z - m.zo) * partial - camZ;
    if (x * x + y * y + z * z > 4096) return;
    const t = this.nameTexture(m.customName);
    if (!t) return;
    const gl = this.gl;
    const [, h] = m.dims();
    const M = this.tmp2;
    setIdentity(M);
    M[12] = x;
    M[13] = y + h + 0.5;
    M[14] = z;
    mulRotY(M, (-camYaw * Math.PI) / 180 + Math.PI);
    mulRotX(M, (-camPitch * Math.PI) / 180);
    mulScale(M, t.w * 0.025, t.h * 0.025, 1);
    mulTranslate(M, 0, -1 + 1 / t.h, 0);
    const light = world.getLight(Math.floor(m.x), Math.floor(m.y + h * 0.85), Math.floor(m.z));
    gl.uniform2f(this.u.get('uLight'), ((light & 15) + 0.5) / 16, ((light >> 4) + 0.5) / 16);
    gl.uniform4f(this.u.get('uUVRect'), 0, 0, 1, 1);
    gl.uniform1f(this.u.get('uEmissive'), 0);
    gl.uniform1f(this.u.get('uNoShade'), 1);
    gl.uniform4f(this.u.get('uOverlay'), 0, 0, 0, 0);
    gl.uniformMatrix4fv(this.u.get('uModel'), false, M);
    gl.bindVertexArray(this.quadVao);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    // see-through pass: the 25% background (and a faint text) shows through walls
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(this.u.get('uCutout'), 0.05);
    gl.uniform1f(this.u.get('uMaxAlpha'), 0.25);
    gl.uniform4f(this.u.get('uColor'), 1, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // solid text, depth-tested
    gl.enable(gl.DEPTH_TEST);
    gl.uniform1f(this.u.get('uCutout'), 0.5);
    gl.uniform1f(this.u.get('uMaxAlpha'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform1f(this.u.get('uCutout'), 0.1);
    gl.uniform1f(this.u.get('uNoShade'), 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  private casters = new Float64Array(4 * 512);
  private casterCount = 0;

  /** Queue a blob shadow (world position, radius) for this frame's shadow pass (players use this). */
  addShadow(x: number, y: number, z: number, r: number): void {
    if (this.casterCount >= 512) return;
    const i = this.casterCount++ * 4;
    this.casters[i] = x;
    this.casters[i + 1] = y;
    this.casters[i + 2] = z;
    this.casters[i + 3] = r;
  }

  /** EntityRenderDispatcher.renderShadow / renderBlockShadow for every mob in view. */
  private renderShadows(mobs: ClientMob[], world: ClientWorld, viewProj: Mat4, camX: number, camY: number, camZ: number, partial: number, fogStart: number, fogEnd: number, skyDarken: number): void {
    // casters: the mobs in view plus the shadows queued by addShadow (players)
    for (const m of mobs) {
      let r = m.type === 'slime' ? 0.25 * m.slimeSize : m.info.shadow;
      if (m.baby) r *= 0.5;
      this.addShadow(m.xo + (m.x - m.xo) * partial, m.yo + (m.y - m.yo) * partial, m.zo + (m.z - m.zo) * partial, r);
    }
    const n = this.casterCount;
    this.casterCount = 0;
    if (!this.shadowTex || !n) return;
    const v = this.shadowVerts;
    const cs = this.casters;
    let o = 0;
    for (let c = 0; c < n; c++) {
      const x = cs[c * 4]!, y = cs[c * 4 + 1]!, z = cs[c * 4 + 2]!, r = cs[c * 4 + 3]!;
      const d2 = (x - camX) ** 2 + (y - camY) ** 2 + (z - camZ) ** 2;
      const weight = 1 - d2 / 256;
      if (weight <= 0) continue;
      const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y), z0 = Math.floor(z - r), z1 = Math.floor(z + r);
      for (let by = y0; by <= y1; by++)
        for (let bz = z0; bz <= z1; bz++)
          for (let bx = x0; bx <= x1; bx++) {
            if (o + 36 > v.length) break;
            const below = world.getState(bx, by - 1, bz);
            if (below === 0) continue;
            const l = world.getLight(bx, by, bz);
            const raw = Math.max((l >> 4) - skyDarken, l & 15);
            if (raw <= 3) continue;
            if (!FULL_COLLISION[below]) continue;
            const f1 = raw / 15;
            const bright = f1 / (4 - 3 * f1);
            let a = (weight - (y - by) / 2) * 0.5 * bright;
            if (a < 0) continue;
            if (a > 1) a = 1;
            const px0 = bx - x, px1 = bx + 1 - x, pz0 = bz - z, pz1 = bz + 1 - z, py = by - y + 0.001;
            const u0 = -px0 / 2 / r + 0.5, u1 = -px1 / 2 / r + 0.5, v0 = -pz0 / 2 / r + 0.5, v1 = -pz1 / 2 / r + 0.5;
            const ox = x - camX, oy = y - camY + py, oz = z - camZ;
            o = shadowVertex(v, o, ox + px0, oy, oz + pz0, u0, v0, a);
            o = shadowVertex(v, o, ox + px0, oy, oz + pz1, u0, v1, a);
            o = shadowVertex(v, o, ox + px1, oy, oz + pz1, u1, v1, a);
            o = shadowVertex(v, o, ox + px0, oy, oz + pz0, u0, v0, a);
            o = shadowVertex(v, o, ox + px1, oy, oz + pz1, u1, v1, a);
            o = shadowVertex(v, o, ox + px1, oy, oz + pz0, u1, v0, a);
          }
    }
    if (!o) return;
    const gl = this.gl;
    gl.useProgram(this.shadowProg);
    gl.uniformMatrix4fv(this.su.get('uViewProj'), false, viewProj);
    gl.uniform1i(this.su.get('uTex'), 0);
    gl.uniform2f(this.su.get('uFog'), fogStart, fogEnd);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.bindVertexArray(this.shadowVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shadowVbo);
    gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, o), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -4);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, o / 6);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }
}

/** Items mobs spawn holding (FinalizeSpawn equipment) until the server says otherwise. */
const DEFAULT_HELD = new Map<string, number>(
  ([['skeleton', 'bow'], ['stray', 'bow'], ['wither_skeleton', 'stone_sword'], ['pillager', 'crossbow'], ['vindicator', 'iron_axe']] as const)
    .map(([t, i]) => [t, ITEMS_BY_NAME.get(i)?.id ?? 0]),
);

function shadowVertex(v: Float32Array, o: number, x: number, y: number, z: number, u: number, vv: number, a: number): number {
  v[o] = x;
  v[o + 1] = y;
  v[o + 2] = z;
  v[o + 3] = u;
  v[o + 4] = vv;
  v[o + 5] = a;
  return o + 6;
}


function gaussian(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------------------------ matrix helpers (column-major, in place: M = M · X)

function setIdentity(m: Mat4): void {
  m.fill(0);
  m[0] = m[5] = m[10] = m[15] = 1;
}

function mulTranslate(m: Mat4, x: number, y: number, z: number): void {
  m[12] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  m[13] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  m[14] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  m[15] = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
}

function mulScale(m: Mat4, x: number, y: number, z: number): void {
  for (let i = 0; i < 4; i++) {
    m[i] = m[i]! * x;
    m[4 + i] = m[4 + i]! * y;
    m[8 + i] = m[8 + i]! * z;
  }
}

function mulRotY(m: Mat4, a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < 4; i++) {
    const x = m[i]!, z = m[8 + i]!;
    m[i] = x * c - z * s;
    m[8 + i] = x * s + z * c;
  }
}

function mulRotX(m: Mat4, a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < 4; i++) {
    const y = m[4 + i]!, z = m[8 + i]!;
    m[4 + i] = y * c + z * s;
    m[8 + i] = -y * s + z * c;
  }
}

function mulRotZ(m: Mat4, a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < 4; i++) {
    const x = m[i]!, y = m[4 + i]!;
    m[i] = x * c + y * s;
    m[4 + i] = -x * s + y * c;
  }
}

/** translate(pivot) · Rz · Ry · Rx (vanilla ModelPart.translateAndRotate) */
export function partMatrix(out: Mat4, p: VPose): void {
  const cx = Math.cos(p.xRot), sx = Math.sin(p.xRot);
  const cy = Math.cos(p.yRot), sy = Math.sin(p.yRot);
  const cz = Math.cos(p.zRot), sz = Math.sin(p.zRot);
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
