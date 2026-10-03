/**
 * Block crack overlay (destroy stages 0–9): redraws the block's model quads with a crack
 * texture projected per face, multiplied onto the block (vanilla crumbling render type).
 */
import type { BakeResult } from '../models/bake';
import { createProgram, Uniforms } from './gl';
import type { Mat4 } from './math';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
uniform mat4 uViewProj;
out vec2 vUV;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vUV = aUV; }`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uLayer;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vec3(vUV, uLayer));
  if (c.a < 0.1) discard;
  outColor = vec4(c.rgb, 1.0);
}`;

export class CrackRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;

  constructor(
    private gl: WebGL2RenderingContext,
    private bake: BakeResult,
    private stageLayers: number[],
  ) {
    this.prog = createProgram(gl, VS, FS, 'crack');
    this.u = new Uniforms(gl, this.prog);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.bindVertexArray(null);
  }

  render(viewProj: Mat4, tex: WebGLTexture, x: number, y: number, z: number, state: number, stage: number, camX: number, camY: number, camZ: number): void {
    if (stage < 0 || stage > 9) return;
    const baked = this.bake.states[state];
    if (!baked) return;
    const v: number[] = [];
    for (const q of baked.choices[0]!.quads) {
      const pts: number[][] = [];
      for (let i = 0; i < 4; i++) {
        const px = q.pos[i * 3]!, py = q.pos[i * 3 + 1]!, pz = q.pos[i * 3 + 2]!;
        // project the crack texture onto the face plane (world-aligned, like vanilla)
        let u = 0, w = 0;
        switch (q.dir) {
          case 0: u = px; w = 1 - pz; break;
          case 1: u = px; w = pz; break;
          case 2: u = 1 - px; w = 1 - py; break;
          case 3: u = px; w = 1 - py; break;
          case 4: u = pz; w = 1 - py; break;
          default: u = 1 - pz; w = 1 - py; break;
        }
        pts.push([x + px - camX, y + py - camY, z + pz - camZ, u, w]);
      }
      for (const k of [0, 1, 2, 0, 2, 3]) v.push(...pts[k]!);
    }
    if (!v.length) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniform1f(this.u.get('uLayer'), this.stageLayers[stage]!);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -10);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, v.length / 5);
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }
}
