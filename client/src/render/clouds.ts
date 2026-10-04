/**
 * Clouds: a 256×256 cloud map tiled across the sky at Y=128, each texel a 12×12 block
 * cell, drifting toward +X at 0.03 blocks per tick. Fancy = 4-block-thick shaded boxes,
 * Fast = a single flat layer. Colour follows vanilla getCloudColor (time + weather).
 */
import { createProgram, Uniforms } from './gl';
import type { Mat4 } from './math';

const CELL = 12;
const HEIGHT = 4;
const CLOUD_Y = 128;

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aShade;
uniform mat4 uViewProj;
uniform vec3 uOffset;
out float vShade;
out float vDist;
void main() {
  vec3 p = aPos + uOffset;
  gl_Position = uViewProj * vec4(p, 1.0);
  vShade = aShade;
  vDist = length(p.xz);
}`;
const FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform vec4 uFogColor;
uniform vec2 uFog;
in float vShade;
in float vDist;
out vec4 outColor;
void main() {
  float f = clamp((vDist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
  outColor = vec4(mix(uColor * vShade, uFogColor.rgb, f), 0.8 * (1.0 - f));
}`;

export class CloudRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private count = 0;
  private map: Uint8Array | null = null;
  /** cell x, cell z, radius, fancy (1/0) the mesh was built for */
  private readonly built = new Float64Array([NaN, NaN, NaN, NaN]);

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, 'clouds');
    this.u = new Uniforms(gl, this.prog);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);
  }

  async load(url = './textures/environment/clouds.png'): Promise<void> {
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const c = new OffscreenCanvas(256, 256);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, 256, 256).data;
    this.map = new Uint8Array(256 * 256);
    for (let i = 0; i < 256 * 256; i++) this.map[i] = d[i * 4 + 3]! > 128 ? 1 : 0;
  }

  private filled(cx: number, cz: number): boolean {
    return this.map![(((cz % 256) + 256) % 256) * 256 + (((cx % 256) + 256) % 256)] === 1;
  }

  /** Build geometry for cells around (baseX, baseZ) in cloud-cell coordinates, positions relative to that base. */
  private build(baseX: number, baseZ: number, radius: number, fancy: boolean): void {
    const v: number[] = [];
    const quad = (pts: number[][], shade: number) => {
      for (const k of [0, 1, 2, 0, 2, 3]) v.push(pts[k]![0]!, pts[k]![1]!, pts[k]![2]!, shade);
    };
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = baseX + dx, cz = baseZ + dz;
        if (!this.filled(cx, cz)) continue;
        const x0 = dx * CELL, z0 = dz * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
        if (!fancy) {
          quad([[x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0]], 1);
          continue;
        }
        const y0 = 0, y1 = HEIGHT;
        quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], 1.0);
        quad([[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]], 0.7);
        if (!this.filled(cx, cz - 1)) quad([[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]], 0.8);
        if (!this.filled(cx, cz + 1)) quad([[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], 0.8);
        if (!this.filled(cx - 1, cz)) quad([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], 0.9);
        if (!this.filled(cx + 1, cz)) quad([[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]], 0.9);
      }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    this.count = v.length / 4;
  }

  render(
    viewProj: Mat4, camX: number, camY: number, camZ: number, ticks: number,
    mode: 'off' | 'fast' | 'fancy', renderDistance: number,
    color: [number, number, number], fog: [number, number, number],
  ): void {
    if (mode === 'off' || !this.map) return;
    const gl = this.gl;
    // cloud-space position of the camera (clouds drift +x)
    const drift = ticks * 0.03;
    const wx = camX + drift, wz = camZ + 3.96; // vanilla offsets the field slightly in z
    const baseX = Math.floor(wx / CELL), baseZ = Math.floor(wz / CELL);
    const radius = Math.ceil((renderDistance * 16) / CELL) + 1;
    // rebuild only when the cell, radius or mode changes (compared without building a key string per frame)
    const b = this.built;
    if (b[0] !== baseX || b[1] !== baseZ || b[2] !== radius || b[3] !== (mode === 'fancy' ? 1 : 0)) {
      this.build(baseX, baseZ, radius, mode === 'fancy');
      b[0] = baseX;
      b[1] = baseZ;
      b[2] = radius;
      b[3] = mode === 'fancy' ? 1 : 0;
    }
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniform3f(this.u.get('uOffset'), baseX * CELL - wx, CLOUD_Y - camY + 0.33, baseZ * CELL - wz);
    gl.uniform3f(this.u.get('uColor'), color[0], color[1], color[2]);
    gl.uniform4f(this.u.get('uFogColor'), fog[0], fog[1], fog[2], 1);
    gl.uniform2f(this.u.get('uFog'), renderDistance * 16 * 2, renderDistance * 16 * 4);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    // fancy clouds are closed boxes: cull back faces; fast clouds are a single double-sided layer
    const inside = camY > CLOUD_Y - 0.5 && camY < CLOUD_Y + HEIGHT + 1;
    if (mode === 'fancy' && !inside) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }
}

/** Vanilla ClientLevel.getCloudColor. */
export function cloudColor(timeOfDay: number, rain: number, thunder: number): [number, number, number] {
  let f1 = Math.cos(timeOfDay * Math.PI * 2) * 2 + 0.5;
  f1 = Math.max(0, Math.min(1, f1));
  let r = f1 * 0.9 + 0.1, g = f1 * 0.9 + 0.1, b = f1 * 0.85 + 0.15;
  if (rain > 0) {
    const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.6;
    const k = 1 - rain * 0.95;
    r = r * k + l * (1 - k);
    g = g * k + l * (1 - k);
    b = b * k + l * (1 - k);
  }
  if (thunder > 0) {
    const l = (r * 0.3 + g * 0.59 + b * 0.11) * 0.2;
    const k = 1 - thunder * 0.95;
    r = r * k + l * (1 - k);
    g = g * k + l * (1 - k);
    b = b * k + l * (1 - k);
  }
  return [r, g, b];
}
