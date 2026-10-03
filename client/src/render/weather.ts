/**
 * Rain and snow rendering (vanilla renderSnowAndRain): textured vertical quads in a
 * radius of 5 (Fast) or 10 (Fancy) columns around the camera, from the precipitation
 * height up to camera+radius, oriented radially, scrolling over time.
 */
import { BIOMES } from '@shared/data';
import { JavaRandom } from '@shared/util/random';
import type { ClientWorld } from '../world/clientworld';
import { createProgram, Uniforms } from './gl';
import type { Mat4 } from './math';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in float aAlpha;
layout(location = 3) in vec2 aLight;
uniform mat4 uViewProj;
out vec2 vUV;
out float vAlpha;
out vec2 vLight;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vUV = aUV; vAlpha = aAlpha; vLight = aLight; }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uLightmap;
in vec2 vUV;
in float vAlpha;
in vec2 vLight;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  c.a *= vAlpha;
  if (c.a < 0.004) discard;
  c.rgb *= texture(uLightmap, vLight).rgb;
  outColor = c;
}`;

const SIZE_X = new Float32Array(1024);
const SIZE_Z = new Float32Array(1024);
for (let i = 0; i < 32; i++)
  for (let j = 0; j < 32; j++) {
    const f = j - 16, f1 = i - 16;
    const f2 = Math.sqrt(f * f + f1 * f1) || 1;
    SIZE_X[(i << 5) | j] = -f1 / f2;
    SIZE_Z[(i << 5) | j] = f / f2;
  }

/** Biome temperature at a height (vanilla Biome.getTemperature without the noise term above sea level+1). */
export function temperatureAt(biomeId: number, y: number): number {
  const b = BIOMES[biomeId];
  if (!b) return 0.8;
  let t = b.temperature;
  if (y > 64) t -= ((y - 64) * 0.05) / 30;
  return t;
}

export class WeatherRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private rainTex: WebGLTexture | null = null;
  private snowTex: WebGLTexture | null = null;
  private data = new Float32Array(441 * 6 * 8 * 2);
  private rand = new JavaRandom(0);

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, 'weather');
    this.u = new Uniforms(gl, this.prog);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 24);
    gl.bindVertexArray(null);
  }

  async load(base = './textures/environment/'): Promise<void> {
    const load = async (name: string) => {
      const bmp = await createImageBitmap(await (await fetch(`${base}${name}.png`)).blob());
      const gl = this.gl;
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return t;
    };
    this.rainTex = await load('rain');
    this.snowTex = await load('snow');
  }

  render(viewProj: Mat4, world: ClientWorld, camX: number, camY: number, camZ: number, ticks: number, partial: number, rainLevel: number, fancy: boolean, lightmap: WebGLTexture): void {
    if (rainLevel <= 0 || !this.rainTex) return;
    const gl = this.gl;
    const ix = Math.floor(camX), iy = Math.floor(camY), iz = Math.floor(camZ);
    const l = fancy ? 10 : 5;
    const f1 = ticks + partial;
    let nRain = 0, nSnow = 0;
    // write rain quads from the start of the buffer and snow quads from the middle
    const half = this.data.length / 2;
    const push = (snow: boolean, v: number[]) => {
      const off = snow ? half + nSnow * 48 : nRain * 48;
      const idx = [0, 1, 2, 0, 2, 3];
      for (let t = 0; t < 6; t++) for (let c = 0; c < 8; c++) this.data[off + t * 8 + c] = v[idx[t]! * 8 + c]!;
      if (snow) nSnow++;
      else nRain++;
    };
    for (let z = iz - l; z <= iz + l; z++)
      for (let x = ix - l; x <= ix + l; x++) {
        const si = ((z - iz + 16) << 5) + (x - ix + 16);
        const d0 = SIZE_X[si]! * 0.5, d1 = SIZE_Z[si]! * 0.5;
        const chunk = world.getChunk(x >> 4, z >> 4);
        if (!chunk) continue;
        const biome = world.getBiome(x, iy, z);
        const b = BIOMES[biome];
        if (!b || b.precipitation === 'none') continue;
        const h = chunk.motionBlocking[(z & 15) * 16 + (x & 15)]!;
        let j2 = iy - l, k2 = iy + l;
        if (j2 < h) j2 = h;
        if (k2 < h) k2 = h;
        const l2 = Math.max(h, iy);
        if (j2 === k2) continue;
        const seed = ((Math.imul(Math.imul(x, x), 3121) + Math.imul(x, 45238971)) | 0) ^ ((Math.imul(Math.imul(z, z), 418711) + Math.imul(z, 13761)) | 0);
        this.rand.setSeed(seed);
        const dx = x + 0.5 - camX, dz = z + 0.5 - camZ;
        const f3 = Math.sqrt(dx * dx + dz * dz) / l;
        const light = world.getLight(x, l2, z);
        const lu = ((light & 15) + 0.5) / 16, lv = ((light >> 4) + 0.5) / 16;
        const px0 = x - camX - d0 + 0.5, pz0 = z - camZ - d1 + 0.5, px1 = x - camX + d0 + 0.5, pz1 = z - camZ + d1 + 0.5;
        const y0 = k2 - camY, y1 = j2 - camY;
        if (temperatureAt(biome, j2) >= 0.15) {
          const i3 = (ticks + Math.imul(Math.imul(x, x), 3121) + Math.imul(x, 45238971) + Math.imul(Math.imul(z, z), 418711) + Math.imul(z, 13761)) & 31;
          const f2 = (-(i3 + partial) / 32) * (3 + this.rand.nextFloat());
          const a = ((1 - f3 * f3) * 0.5 + 0.5) * rainLevel;
          push(false, [
            px0, y0, pz0, 0, k2 * 0.25 + f2, a, lu, lv,
            px1, y0, pz1, 1, k2 * 0.25 + f2, a, lu, lv,
            px1, y1, pz1, 1, j2 * 0.25 + f2, a, lu, lv,
            px0, y1, pz0, 0, j2 * 0.25 + f2, a, lu, lv,
          ]);
        } else {
          const f5 = -((ticks & 511) + partial) / 512;
          const f6 = this.rand.nextDouble() + f1 * 0.01 * this.rand.nextGaussian();
          const f7 = this.rand.nextDouble() + f1 * this.rand.nextGaussian() * 0.001;
          const a = ((1 - f3 * f3) * 0.3 + 0.5) * rainLevel;
          // snow is lit brighter than its surroundings (vanilla (light*3+15)/4)
          const blk = ((((light & 15) * 3 + 15) / 4) + 0.5) / 16, sky = ((((light >> 4) * 3 + 15) / 4) + 0.5) / 16;
          push(true, [
            px0, y0, pz0, 0 + f6, k2 * 0.25 + f5 + f7, a, blk, sky,
            px1, y0, pz1, 1 + f6, k2 * 0.25 + f5 + f7, a, blk, sky,
            px1, y1, pz1, 1 + f6, j2 * 0.25 + f5 + f7, a, blk, sky,
            px0, y1, pz0, 0 + f6, j2 * 0.25 + f5 + f7, a, blk, sky,
          ]);
        }
      }
    if (!nRain && !nSnow) return;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.uniform1i(this.u.get('uLightmap'), 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmap);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ZERO);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.STREAM_DRAW);
    if (nRain) {
      gl.bindTexture(gl.TEXTURE_2D, this.rainTex);
      gl.drawArrays(gl.TRIANGLES, 0, nRain * 6);
    }
    if (nSnow) {
      gl.bindTexture(gl.TEXTURE_2D, this.snowTex);
      gl.drawArrays(gl.TRIANGLES, half / 8, nSnow * 6);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }
}
