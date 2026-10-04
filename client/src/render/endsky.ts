/**
 * The End sky (vanilla LevelRenderer.renderEndSky): a camera-centred cube of six 200×200 quads at
 * distance 100, each the bottom face rotated (X +90°, X −90°, X 180°, Z +90°, Z −90°), textured
 * with the End sky tile repeated 16 times per face and tinted 40/255. No sun, moon, stars or
 * clouds. Drawn first with depth writes off.
 */
import { createProgram, Uniforms } from './gl';
import { mat4, multiply, type Mat4 } from './math';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform mat4 uMVP;
out vec2 vUV;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vUV = aUV; }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uTint;
in vec2 vUV;
out vec4 outColor;
void main() { vec4 c = texture(uTex, vUV); outColor = vec4(c.rgb * uTint, 1.0); }`;

/** Vertices (x, y, z, u, v) of the six faces as triangles. */
export function endSkyVertices(): Float32Array {
  const base: [number, number, number, number, number][] = [
    [-100, -100, -100, 0, 0], [-100, -100, 100, 0, 16], [100, -100, 100, 16, 16], [100, -100, -100, 16, 0],
  ];
  const D = Math.PI / 180;
  const rotX = (a: number) => (p: number[]) => [p[0]!, p[1]! * Math.cos(a * D) - p[2]! * Math.sin(a * D), p[1]! * Math.sin(a * D) + p[2]! * Math.cos(a * D)];
  const rotZ = (a: number) => (p: number[]) => [p[0]! * Math.cos(a * D) - p[1]! * Math.sin(a * D), p[0]! * Math.sin(a * D) + p[1]! * Math.cos(a * D), p[2]!];
  const faces = [(p: number[]) => p, rotX(90), rotX(-90), rotX(180), rotZ(90), rotZ(-90)];
  const out: number[] = [];
  for (const f of faces) {
    const q = base.map((v) => [...f(v), v[3], v[4]]);
    for (const k of [0, 1, 2, 0, 2, 3]) out.push(...q[k]!);
  }
  return new Float32Array(out);
}

export class EndSkyRenderer {
  private readonly prog: WebGLProgram;
  private readonly u: Uniforms;
  private readonly vao: WebGLVertexArrayObject;
  private tex: WebGLTexture | null = null;
  private readonly mvp = mat4();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, 'endsky');
    this.u = new Uniforms(gl, this.prog);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, endSkyVertices(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
  }

  async load(url = './textures/environment/end_sky.png'): Promise<void> {
    const r = await fetch(url);
    const bmp = await createImageBitmap(await r.blob());
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.tex = t;
  }

  /** `rot`: camera rotation (no translation). */
  render(proj: Mat4, rot: Mat4): void {
    if (!this.tex) {
      void this.load().catch(() => {});
      this.tex = this.gl.createTexture(); // placeholder until the tile arrives (renders black)
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    multiply(this.mvp, proj, rot);
    gl.uniformMatrix4fv(this.u.get('uMVP'), false, this.mvp);
    gl.uniform1f(this.u.get('uTint'), 40 / 255);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 36);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }
}
