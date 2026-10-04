/**
 * Particle engine. Terrain particles follow vanilla TerrainParticle/Particle: random initial
 * velocity, gravity 0.04·g per tick, 0.98 drag, ground friction 0.7, lifetime 4/(r·0.9+0.1),
 * a random 4×4-pixel piece of the block texture, lit by the lightmap.
 */
import { createProgram, Uniforms } from './gl';
import type { Mat4 } from './math';
import type { ClientWorld } from '../world/clientworld';
import { collideBox, AABB } from '@shared/entity/aabb';
import { outlineBoxes } from '@shared/world/shapes';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aUV;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec2 aLight;
uniform mat4 uViewProj;
out vec3 vUV;
out vec4 vColor;
out vec2 vLight;
out float vDist;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vUV = aUV; vColor = aColor; vLight = aLight; vDist = length(aPos); }`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform sampler2D uLightmap;
uniform vec4 uFogColor;
uniform vec2 uFog;
in vec3 vUV;
in vec4 vColor;
in vec2 vLight;
in float vDist;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV) * vColor;
  if (c.a < 0.1) discard;
  c.rgb *= texture(uLightmap, vLight).rgb;
  float f = clamp((vDist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
  outColor = vec4(mix(c.rgb, uFogColor.rgb, f), c.a);
}`;

const MAX = 16384;
const CORNER_X = [-1, -1, 1, -1, 1, 1];
const CORNER_Y = [-1, 1, 1, -1, 1, -1];
const CORNER_U1 = [1, 1, 0, 1, 0, 0];
const CORNER_V1 = [1, 0, 0, 1, 0, 1];
/** floats per particle in the simulation buffer */
const S = 16;
// layout: x y z xo yo zo xd yd zd age life size layer u0 v0 flags(gravity*1000 + onGround)

export class ParticleEngine {
  private sim = new Float32Array(MAX * S);
  private col = new Float32Array(MAX * 3);
  count = 0;
  private prog: WebGLProgram;
  private u: Uniforms;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private verts = new Float32Array(MAX * 6 * 12);
  private rand = Math.random;
  private readonly bb = new AABB(0, 0, 0, 0, 0, 0);

  constructor(private gl: WebGL2RenderingContext, private world: ClientWorld) {
    this.prog = createProgram(gl, VS, FS, 'particles');
    this.u = new Uniforms(gl, this.prog);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const st = 12 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, st, 40);
    gl.bindVertexArray(null);
  }

  private add(x: number, y: number, z: number, xd: number, yd: number, zd: number, layer: number, r: number, g: number, b: number, gravity: number, sizeMul: number, keepVelocity = false): number {
    if (this.count >= MAX) return -1;
    const rnd = this.rand;
    // Particle constructor: randomised initial velocity
    if (!keepVelocity) {
      xd += (rnd() * 2 - 1) * 0.4;
      yd += (rnd() * 2 - 1) * 0.4;
      zd += (rnd() * 2 - 1) * 0.4;
      const f = (rnd() + rnd() + 1) * 0.15;
      const len = Math.hypot(xd, yd, zd) || 1;
      xd = (xd / len) * f * 0.4;
      yd = (yd / len) * f * 0.4 + 0.1;
      zd = (zd / len) * f * 0.4;
    }
    const i = this.count++ * S;
    const s = this.sim;
    s[i] = s[i + 3] = x;
    s[i + 1] = s[i + 4] = y;
    s[i + 2] = s[i + 5] = z;
    s[i + 6] = xd;
    s[i + 7] = yd;
    s[i + 8] = zd;
    s[i + 9] = 0;
    s[i + 10] = Math.floor(4 / (rnd() * 0.9 + 0.1));
    s[i + 11] = 0.1 * (rnd() * 0.5 + 0.5) * 2 * 0.5 * sizeMul; // terrain particles are half size
    s[i + 12] = layer;
    s[i + 13] = Math.floor(rnd() * 3 * 4) / 16; // 4 px sub-sprite (uo·4 px)
    s[i + 14] = Math.floor(rnd() * 3 * 4) / 16;
    s[i + 15] = gravity * 1000;
    const c = this.count - 1;
    this.col[c * 3] = r;
    this.col[c * 3 + 1] = g;
    this.col[c * 3 + 2] = b;
    return c;
  }

  /** Vanilla ParticleEngine.destroy: a grid of particles over the block's shape. */
  destroy(x: number, y: number, z: number, state: number, layer: number, tint: [number, number, number]): void {
    for (const bx of outlineBoxes(state)) {
      const dx = Math.min(1, bx[3] - bx[0]), dy = Math.min(1, bx[4] - bx[1]), dz = Math.min(1, bx[5] - bx[2]);
      const nx = Math.max(2, Math.ceil(dx / 0.25)), ny = Math.max(2, Math.ceil(dy / 0.25)), nz = Math.max(2, Math.ceil(dz / 0.25));
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < ny; j++)
          for (let k = 0; k < nz; k++) {
            const fx = (i + 0.5) / nx, fy = (j + 0.5) / ny, fz = (k + 0.5) / nz;
            const px = fx * dx + bx[0], py = fy * dy + bx[1], pz = fz * dz + bx[2];
            this.add(x + px, y + py, z + pz, fx - 0.5, fy - 0.5, fz - 0.5, layer, 0.6 * tint[0], 0.6 * tint[1], 0.6 * tint[2], 1, 1);
          }
    }
  }

  /** BreakingItemParticle (eating crumbs, broken tools): random burst damped to 10% plus the given velocity. */
  item(x: number, y: number, z: number, vx: number, vy: number, vz: number, layer: number): void {
    const idx = this.add(x, y, z, vx, vy, vz, layer, 1, 1, 1, 1, 1);
    if (idx < 0) return;
    const i = idx * S;
    this.sim[i + 6] = this.sim[i + 6]! * 0.1 + vx;
    this.sim[i + 7] = this.sim[i + 7]! * 0.1 + vy;
    this.sim[i + 8] = this.sim[i + 8]! * 0.1 + vz;
  }

  /** Vanilla ParticleEngine.crack: one particle on the face being hit. */
  crack(x: number, y: number, z: number, face: number, state: number, layer: number, tint: [number, number, number]): void {
    const box = outlineBoxes(state)[0] ?? [0, 0, 0, 1, 1, 1];
    const rnd = this.rand;
    const e = 0.1;
    let px = x + rnd() * (box[3] - box[0] - e * 2) + e + box[0];
    let py = y + rnd() * (box[4] - box[1] - e * 2) + e + box[1];
    let pz = z + rnd() * (box[5] - box[2] - e * 2) + e + box[2];
    if (face === 0) py = y + box[1] - e;
    if (face === 1) py = y + box[4] + e;
    if (face === 2) pz = z + box[2] - e;
    if (face === 3) pz = z + box[5] + e;
    if (face === 4) px = x + box[0] - e;
    if (face === 5) px = x + box[3] + e;
    const idx = this.add(px, py, pz, 0, 0, 0, layer, 0.6 * tint[0], 0.6 * tint[1], 0.6 * tint[2], 1, 0.6);
    if (idx < 0) return;
    // setPower(0.2)
    const i = idx * S;
    this.sim[i + 6]! *= 0.2;
    this.sim[i + 7] = (this.sim[i + 7]! - 0.1) * 0.2 + 0.1;
    this.sim[i + 8]! *= 0.2;
  }

  tick(): void {
    const s = this.sim;
    let w = 0;
    for (let p = 0; p < this.count; p++) {
      const i = p * S;
      s[i + 3] = s[i]!;
      s[i + 4] = s[i + 1]!;
      s[i + 5] = s[i + 2]!;
      if (s[i + 9]!++ >= s[i + 10]!) continue; // dead: drop it
      s[i + 7]! -= 0.04 * (s[i + 15]! / 1000);
      // move with block collisions (Particle.move)
      const half = 0.1;
      const bb = this.bb;
      bb.minX = s[i]! - half;
      bb.minY = s[i + 1]!;
      bb.minZ = s[i + 2]! - half;
      bb.maxX = s[i]! + half;
      bb.maxY = s[i + 1]! + 0.2;
      bb.maxZ = s[i + 2]! + half;
      const [mx, my, mz] = collideBox(this.world, bb, s[i + 6]!, s[i + 7]!, s[i + 8]!);
      const onGround = my !== s[i + 7] && s[i + 7]! < 0;
      if (mx !== s[i + 6]) s[i + 6] = 0;
      if (mz !== s[i + 8]) s[i + 8] = 0;
      s[i] = s[i]! + mx;
      s[i + 1] = s[i + 1]! + my;
      s[i + 2] = s[i + 2]! + mz;
      s[i + 6]! *= 0.98;
      s[i + 7]! *= 0.98;
      s[i + 8]! *= 0.98;
      if (onGround) {
        s[i + 6]! *= 0.7;
        s[i + 8]! *= 0.7;
      }
      if (w !== p) {
        s.copyWithin(w * S, i, i + S);
        this.col.copyWithin(w * 3, p * 3, p * 3 + 3);
      }
      w++;
    }
    this.count = w;
  }

  render(viewProj: Mat4, rightX: number, rightY: number, rightZ: number, upX: number, upY: number, upZ: number, camX: number, camY: number, camZ: number, partial: number, tex: WebGLTexture, lightmap: WebGLTexture, fog: [number, number, number], fogStart: number, fogEnd: number): void {
    if (!this.count) return;
    const s = this.sim, v = this.verts;
    let o = 0;
    for (let p = 0; p < this.count; p++) {
      const i = p * S;
      const x = s[i + 3]! + (s[i]! - s[i + 3]!) * partial - camX;
      const y = s[i + 4]! + (s[i + 1]! - s[i + 4]!) * partial - camY;
      const z = s[i + 5]! + (s[i + 2]! - s[i + 5]!) * partial - camZ;
      const size = s[i + 11]!;
      const layer = s[i + 12]!, u0 = s[i + 13]!, v0 = s[i + 14]!, u1 = u0 + 0.25, v1 = v0 + 0.25;
      const light = this.world.getLight(Math.floor(s[i]!), Math.floor(s[i + 1]!), Math.floor(s[i + 2]!));
      const lu = ((light & 15) + 0.5) / 16, lv = ((light >> 4) + 0.5) / 16;
      const r = this.col[p * 3]!, g = this.col[p * 3 + 1]!, b = this.col[p * 3 + 2]!;
      for (let k = 0; k < 6; k++) {
        const cx = CORNER_X[k]!, cy = CORNER_Y[k]!;
        const cu = CORNER_U1[k] ? u1 : u0, cv = CORNER_V1[k] ? v1 : v0;
        v[o++] = x + (rightX * cx + upX * cy) * size;
        v[o++] = y + (rightY * cx + upY * cy) * size;
        v[o++] = z + (rightZ * cx + upZ * cy) * size;
        v[o++] = cu;
        v[o++] = cv;
        v[o++] = layer;
        v[o++] = r;
        v[o++] = g;
        v[o++] = b;
        v[o++] = 1;
        v[o++] = lu;
        v[o++] = lv;
      }
    }
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.uniform1i(this.u.get('uLightmap'), 1);
    gl.uniform4f(this.u.get('uFogColor'), fog[0], fog[1], fog[2], 1);
    gl.uniform2f(this.u.get('uFog'), fogStart, fogEnd);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmap);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, o), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, o / 12);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
  }
}
