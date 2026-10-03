/**
 * Sky, sun, moon, stars and fog colours following the vanilla 1.17.1 client logic
 * (sky colour by biome temperature, time-of-day brightness, sunrise/sunset fan, rain and
 * thunder darkening, distance fog).
 */
import { JavaRandom } from '@shared/util/random';
import { createProgram, Uniforms } from './gl';
import { mat4, multiply, type Mat4 } from './math';

/** HSV → RGB (Java Color.HSBtoRGB semantics). */
export function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = (h - Math.floor(h)) * 6;
  const f = hh - Math.floor(hh);
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  switch (Math.floor(hh)) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/** Default biome sky colour from temperature (vanilla OverworldBiomes.calculateSkyColor). */
export function skyColorForTemperature(temp: number): [number, number, number] {
  const f = Math.max(-1, Math.min(1, temp / 3));
  return hsbToRgb(0.62222224 - f * 0.05, 0.5 + f * 0.1, 1);
}

export function sunriseColor(timeOfDay: number): [number, number, number, number] | null {
  const f1 = Math.cos(timeOfDay * Math.PI * 2);
  if (f1 >= -0.4 && f1 <= 0.4) {
    const f3 = (f1 / 0.4) * 0.5 + 0.5;
    let f4 = 1 - (1 - Math.sin(f3 * Math.PI)) * 0.99;
    f4 *= f4;
    return [f3 * 0.3 + 0.7, f3 * f3 * 0.7 + 0.2, 0.2, f4];
  }
  return null;
}

export function starBrightness(timeOfDay: number): number {
  let f = 1 - (Math.cos(timeOfDay * Math.PI * 2) * 2 + 0.25);
  f = Math.max(0, Math.min(1, f));
  return f * f * 0.5;
}

export interface SkyState {
  timeOfDay: number;
  moonPhase: number;
  rain: number;
  thunder: number;
  flash: number;
  /** blended biome sky colour (0..1) */
  biomeSky: [number, number, number];
  /** blended biome fog colour (0..1) */
  biomeFog: [number, number, number];
  renderDistanceChunks: number;
  camY: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  /** 'air' | 'water' | 'lava' */
  medium: 'air' | 'water' | 'lava';
  waterFog: [number, number, number];
}

export function skyColor(s: SkyState): [number, number, number] {
  const f1 = Math.max(0, Math.min(1, Math.cos(s.timeOfDay * Math.PI * 2) * 2 + 0.5));
  let [r, g, b] = s.biomeSky.map((c) => c * f1) as [number, number, number];
  if (s.rain > 0) {
    const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.6;
    const k = 1 - s.rain * 0.75;
    r = r * k + l * (1 - k);
    g = g * k + l * (1 - k);
    b = b * k + l * (1 - k);
  }
  if (s.thunder > 0) {
    const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.2;
    const k = 1 - s.thunder * 0.75;
    r = r * k + l * (1 - k);
    g = g * k + l * (1 - k);
    b = b * k + l * (1 - k);
  }
  if (s.flash > 0) {
    const f = Math.min(1, s.flash) * 0.45;
    r = r * (1 - f) + 0.8 * f;
    g = g * (1 - f) + 0.8 * f;
    b = b * (1 - f) + 1 * f;
  }
  return [r, g, b];
}

export function fogColor(s: SkyState, sky: [number, number, number]): [number, number, number] {
  if (s.medium === 'lava') return [0.6, 0.1, 0];
  if (s.medium === 'water') {
    const b = Math.max(0, Math.min(1, Math.cos(s.timeOfDay * Math.PI * 2) * 2 + 0.5));
    return s.waterFog.map((c) => c * (b * 0.94 + 0.06)) as [number, number, number];
  }
  let f = 0.25 + (0.75 * s.renderDistanceChunks) / 32;
  f = 1 - Math.pow(f, 0.25);
  const br = Math.max(0, Math.min(1, Math.cos(s.timeOfDay * Math.PI * 2) * 2 + 0.5));
  let r = s.biomeFog[0] * (br * 0.94 + 0.06);
  let g = s.biomeFog[1] * (br * 0.94 + 0.06);
  let b = s.biomeFog[2] * (br * 0.91 + 0.09);
  if (s.renderDistanceChunks >= 4) {
    const sunDirX = Math.sin(s.timeOfDay * Math.PI * 2) > 0 ? -1 : 1;
    let d = s.lookX * sunDirX;
    if (d < 0) d = 0;
    const sr = sunriseColor(s.timeOfDay);
    if (d > 0 && sr) {
      d *= sr[3];
      r = r * (1 - d) + sr[0] * d;
      g = g * (1 - d) + sr[1] * d;
      b = b * (1 - d) + sr[2] * d;
    }
  }
  r += (sky[0] - r) * f;
  g += (sky[1] - g) * f;
  b += (sky[2] - b) * f;
  if (s.rain > 0) {
    r *= 1 - s.rain * 0.5;
    g *= 1 - s.rain * 0.5;
    b *= 1 - s.rain * 0.4;
  }
  if (s.thunder > 0) {
    const k = 1 - s.thunder * 0.5;
    r *= k;
    g *= k;
    b *= k;
  }
  // darken toward the void near the bottom of the world
  let v = s.camY * 0.03125;
  if (v < 1) {
    if (v < 0) v = 0;
    v *= v;
    r *= v;
    g *= v;
    b *= v;
  }
  return [r, g, b];
}

const SKY_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in vec2 aUV;
uniform mat4 uMVP;
out vec4 vColor;
out vec2 vUV;
out vec2 vXZ;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vColor = aColor; vUV = aUV; vXZ = aPos.xz; }`;

const SKY_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
uniform sampler2D uTex;
uniform int uMode; // 0 vertex colour, 1 textured, 2 flat colour with fog
uniform vec4 uFogColor;
uniform vec2 uFog;
in vec4 vColor;
in vec2 vUV;
in vec2 vXZ;
out vec4 outColor;
void main() {
  float vDist = length(vXZ);
  if (uMode == 1) { outColor = texture(uTex, vUV) * uColor; return; }
  if (uMode == 2) {
    float f = clamp((vDist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
    outColor = vec4(mix(uColor.rgb, uFogColor.rgb, f), 1.0);
    return;
  }
  outColor = vColor * uColor;
}`;

export class SkyRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private skyDisc: { vao: WebGLVertexArrayObject; count: number };
  private voidDisc: { vao: WebGLVertexArrayObject; count: number };
  private stars: { vao: WebGLVertexArrayObject; count: number };
  private quad: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer };
  private fan: { vao: WebGLVertexArrayObject; vbo: WebGLBuffer };
  sunTex: WebGLTexture | null = null;
  moonTex: WebGLTexture | null = null;

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, SKY_VS, SKY_FS, 'sky');
    this.u = new Uniforms(gl, this.prog);
    this.skyDisc = this.disc(16);
    this.voidDisc = this.disc(-16);
    this.stars = this.buildStars();
    this.quad = this.dynamicVao(4);
    this.fan = this.dynamicVao(18);
  }

  async loadTextures(base = './textures/environment/'): Promise<void> {
    const load = async (name: string) => {
      const r = await fetch(`${base}${name}.png`);
      const bmp = await createImageBitmap(await r.blob());
      const gl = this.gl;
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.sunTex = await load('sun');
    this.moonTex = await load('moon_phases');
  }

  private makeVao(data: Float32Array): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.attribs();
    gl.bindVertexArray(null);
    return vao;
  }

  private attribs(): void {
    const gl = this.gl;
    const stride = 9 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 28);
  }

  private dynamicVao(verts: number): { vao: WebGLVertexArrayObject; vbo: WebGLBuffer } {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts * 9 * 4, gl.DYNAMIC_DRAW);
    this.attribs();
    gl.bindVertexArray(null);
    return { vao, vbo };
  }

  /** Vanilla sky disc: a fan of radius 512 at height y (triangle fan as triangles). */
  private disc(y: number): { vao: WebGLVertexArrayObject; count: number } {
    const v: number[] = [];
    const sign = Math.sign(y);
    const pts: [number, number][] = [];
    for (let i = -180; i <= 180; i += 45) pts.push([512 * Math.cos((i * Math.PI) / 180), 512 * Math.sin((i * Math.PI) / 180)]);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const tri = sign > 0 ? [[0, 0], a, b] : [[0, 0], b, a];
      for (const p of tri) v.push(p[0]!, y, p[1]!, 1, 1, 1, 1, 0, 0);
    }
    return { vao: this.makeVao(new Float32Array(v)), count: v.length / 9 };
  }

  private buildStars(): { vao: WebGLVertexArrayObject; count: number } {
    const r = new JavaRandom(10842);
    const v: number[] = [];
    for (let i = 0; i < 1500; i++) {
      let x = r.nextFloat() * 2 - 1, y = r.nextFloat() * 2 - 1, z = r.nextFloat() * 2 - 1;
      const size = 0.15 + r.nextFloat() * 0.1;
      let d = x * x + y * y + z * z;
      if (d < 1 && d > 0.01) {
        d = 1 / Math.sqrt(d);
        x *= d; y *= d; z *= d;
        const px = x * 100, py = y * 100, pz = z * 100;
        const yaw = Math.atan2(x, z), sy = Math.sin(yaw), cy = Math.cos(yaw);
        const pitch = Math.atan2(Math.sqrt(x * x + z * z), y), sp = Math.sin(pitch), cp = Math.cos(pitch);
        const rot = r.nextDouble() * Math.PI * 2, sr = Math.sin(rot), cr = Math.cos(rot);
        const P: number[][] = [];
        for (let j = 0; j < 4; j++) {
          const a = ((j & 2) - 1) * size, b = (((j + 1) & 2) - 1) * size;
          const u = a * cr - b * sr, w = b * cr + a * sr;
          const oy = u * sp, t = -u * cp;
          P.push([px + (t * sy - w * cy), py + oy, pz + (w * sy + t * cy)]);
        }
        for (const k of [0, 1, 2, 0, 2, 3]) v.push(P[k]![0]!, P[k]![1]!, P[k]![2]!, 1, 1, 1, 1, 0, 0);
      }
    }
    return { vao: this.makeVao(new Float32Array(v)), count: v.length / 9 };
  }

  /**
   * Draw the sky. `rot` is the camera rotation matrix (no translation), `proj` the projection.
   */
  render(proj: Mat4, rot: Mat4, s: SkyState, sky: [number, number, number], fog: [number, number, number], fogEnd: number): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    const mvp = mat4();
    multiply(mvp, proj, rot);
    const set = (m: Mat4) => gl.uniformMatrix4fv(this.u.get('uMVP'), false, m);
    set(mvp);
    gl.uniform4f(this.u.get('uFogColor'), fog[0], fog[1], fog[2], 1);
    gl.uniform2f(this.u.get('uFog'), 0, fogEnd);
    if (s.medium !== 'air') {
      gl.depthMask(true);
      return;
    }
    // sky plane
    gl.uniform1i(this.u.get('uMode'), 2);
    gl.uniform4f(this.u.get('uColor'), sky[0], sky[1], sky[2], 1);
    gl.bindVertexArray(this.skyDisc.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.skyDisc.count);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // sunrise / sunset fan
    const sr = sunriseColor(s.timeOfDay);
    if (sr) {
      const fanRot = mat4();
      // rotate 90° about X, then flip toward the sun side, then 90° about Z
      const side = Math.sin(s.timeOfDay * Math.PI * 2) < 0 ? 180 : 0;
      rotX(fanRot, 90);
      const z = mat4();
      rotZ(z, side);
      multiply(fanRot, fanRot, z);
      const z2 = mat4();
      rotZ(z2, 90);
      multiply(fanRot, fanRot, z2);
      const m = mat4();
      multiply(m, mvp, fanRot);
      set(m);
      const v: number[] = [];
      const centre = [0, 100, 0, sr[0], sr[1], sr[2], sr[3], 0, 0];
      const pts: number[][] = [];
      for (let j = 0; j <= 16; j++) {
        const a = (j * Math.PI * 2) / 16;
        const sn = Math.sin(a), cs = Math.cos(a);
        pts.push([sn * 120, cs * 120, -cs * 40 * sr[3], sr[0], sr[1], sr[2], 0, 0, 0]);
      }
      for (let j = 0; j < 16; j++) v.push(...centre, ...pts[j]!, ...pts[j + 1]!);
      gl.bindVertexArray(this.fan.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fan.vbo);
      const data = new Float32Array(v);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.uniform1i(this.u.get('uMode'), 0);
      gl.uniform4f(this.u.get('uColor'), 1, 1, 1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 9);
    }
    // celestial bodies: additive
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ZERO);
    const celestial = mat4();
    rotY(celestial, -90);
    const rx = mat4();
    rotX(rx, s.timeOfDay * 360);
    multiply(celestial, celestial, rx);
    const cm = mat4();
    multiply(cm, mvp, celestial);
    set(cm);
    const rainFade = 1 - s.rain;
    gl.uniform4f(this.u.get('uColor'), 1, 1, 1, rainFade);
    gl.uniform1i(this.u.get('uMode'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.u.get('uTex'), 0);
    if (this.sunTex) {
      gl.bindTexture(gl.TEXTURE_2D, this.sunTex);
      this.drawQuad(30, 100, 0, 0, 1, 1);
    }
    if (this.moonTex) {
      gl.bindTexture(gl.TEXTURE_2D, this.moonTex);
      const ph = s.moonPhase, col = ph % 4, row = Math.floor(ph / 4);
      this.drawQuad(20, -100, col / 4, row / 2, (col + 1) / 4, (row + 1) / 2);
    }
    const stars = starBrightness(s.timeOfDay) * rainFade;
    if (stars > 0) {
      gl.uniform1i(this.u.get('uMode'), 0);
      gl.uniform4f(this.u.get('uColor'), stars, stars, stars, stars);
      gl.bindVertexArray(this.stars.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.stars.count);
    }
    gl.disable(gl.BLEND);
    set(mvp);
    // dark lower disc when the camera is below the horizon (sea level)
    if (s.camY - 63 < 0) {
      gl.uniform1i(this.u.get('uMode'), 2);
      gl.uniform4f(this.u.get('uColor'), sky[0] * 0.2 + 0.04, sky[1] * 0.2 + 0.04, sky[2] * 0.6 + 0.1, 1);
      gl.bindVertexArray(this.voidDisc.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.voidDisc.count);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  private drawQuad(size: number, y: number, u0: number, v0: number, u1: number, v1: number): void {
    const gl = this.gl;
    // quad facing down/up toward the camera at height y (vanilla draws sun at +100, moon at −100)
    const s = size;
    const verts = y > 0
      ? [-s, y, -s, u0, v0, s, y, -s, u1, v0, s, y, s, u1, v1, -s, y, s, u0, v1]
      : [s, y, s, u0, v0, -s, y, s, u1, v0, -s, y, -s, u1, v1, s, y, -s, u0, v1];
    const v: number[] = [];
    for (const k of [0, 1, 2, 0, 2, 3]) v.push(verts[k * 5]!, verts[k * 5 + 1]!, verts[k * 5 + 2]!, 1, 1, 1, 1, verts[k * 5 + 3]!, verts[k * 5 + 4]!);
    gl.bindVertexArray(this.fan.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fan.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

function rotX(m: Mat4, deg: number): void {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  m.set([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
function rotY(m: Mat4, deg: number): void {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  m.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function rotZ(m: Mat4, deg: number): void {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  m.set([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
