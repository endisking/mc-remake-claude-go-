/**
 * Screen-space thick line renderer (block outline, hitboxes, chunk borders). Each segment
 * becomes a quad expanded perpendicular to the line in clip space, like vanilla's
 * rendertype_lines (width 2.5 px at 1080p, scaled with window size).
 */
import { createProgram, Uniforms } from './gl';
import type { Mat4 } from './math';

const VS = `#version 300 es
layout(location = 0) in vec3 aA;
layout(location = 1) in vec3 aB;
layout(location = 2) in vec4 aColor;
layout(location = 3) in float aSide;
layout(location = 4) in float aEnd;
uniform mat4 uViewProj;
uniform vec2 uScreen;
uniform float uWidth;
out vec4 vColor;
void main() {
  vec4 ca = uViewProj * vec4(aA, 1.0);
  vec4 cb = uViewProj * vec4(aB, 1.0);
  vec4 c = aEnd < 0.5 ? ca : cb;
  vec2 na = ca.xy / max(ca.w, 1e-4), nb = cb.xy / max(cb.w, 1e-4);
  vec2 dir = normalize((nb - na) * uScreen + 1e-6);
  vec2 off = vec2(-dir.y, dir.x) * uWidth / uScreen;
  gl_Position = c + vec4(off * aSide * c.w, 0.0, 0.0);
  vColor = aColor;
}`;
const FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 outColor;
void main() { outColor = vColor; }`;

export class LineRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data = new Float32Array(1024 * 6 * 12);
  private n = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, 'lines');
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
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, st, 40);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, st, 44);
    gl.bindVertexArray(null);
  }

  begin(): void {
    this.n = 0;
  }

  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, g: number, b: number, a: number): void {
    if ((this.n + 6) * 12 > this.data.length) {
      const d = new Float32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    const corners: [number, number][] = [[-1, 0], [1, 0], [1, 1], [-1, 0], [1, 1], [-1, 1]];
    for (const [side, end] of corners) {
      const o = this.n * 12;
      const d = this.data;
      d[o] = ax; d[o + 1] = ay; d[o + 2] = az;
      d[o + 3] = bx; d[o + 4] = by; d[o + 5] = bz;
      d[o + 6] = r; d[o + 7] = g; d[o + 8] = b; d[o + 9] = a;
      d[o + 10] = side; d[o + 11] = end;
      this.n++;
    }
  }

  /** The 12 edges of a box. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, g: number, b: number, a: number): void {
    const L = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => this.line(ax, ay, az, bx, by, bz, r, g, b, a);
    L(x0, y0, z0, x1, y0, z0); L(x0, y1, z0, x1, y1, z0); L(x0, y0, z1, x1, y0, z1); L(x0, y1, z1, x1, y1, z1);
    L(x0, y0, z0, x0, y1, z0); L(x1, y0, z0, x1, y1, z0); L(x0, y0, z1, x0, y1, z1); L(x1, y0, z1, x1, y1, z1);
    L(x0, y0, z0, x0, y0, z1); L(x1, y0, z0, x1, y0, z1); L(x0, y1, z0, x0, y1, z1); L(x1, y1, z0, x1, y1, z1);
  }

  flush(viewProj: Mat4, width: number, height: number, depthTest = true): void {
    if (!this.n) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniform2f(this.u.get('uScreen'), width, height);
    gl.uniform1f(this.u.get('uWidth'), Math.max(2.5, (width / 1920) * 2.5));
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ZERO);
    gl.disable(gl.CULL_FACE);
    if (depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * 12), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, this.n);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }
}
