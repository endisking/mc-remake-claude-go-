/**
 * Lightning bolts (vanilla LightningBolt client tick + LightningBoltRenderer): the client runs
 * its own flash timing and draws the branching bolt as additive translucent quads, seeded per
 * flash so each re-flash takes a new shape.
 */
import { createProgram, Uniforms } from './gl';
import type { Mat4 } from './math';
import { JavaRandom } from '@shared/util/random';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }`;
const FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(0.45, 0.45, 0.5, 0.3); }`;

export class ClientBolt {
  life = 2;
  flashes: number;
  seed: bigint;
  constructor(
    public x: number,
    public y: number,
    public z: number,
    private rand: JavaRandom,
  ) {
    this.flashes = rand.nextInt(3) + 1;
    this.seed = rand.nextLong();
  }

  /** Returns whether the sky should flash (life ≥ 0). */
  tick(): boolean {
    this.life--;
    if (this.life < 0 && this.flashes > 0 && this.life < -this.rand.nextInt(10)) {
      this.flashes--;
      this.life = 1;
      this.seed = this.rand.nextLong();
    }
    return this.life >= 0;
  }
}

export class LightningRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data = new Float32Array(4 * 3 * 8 * 4 * 6 * 3);
  private readonly xs = new Float32Array(8);
  private readonly zs = new Float32Array(8);

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, 'lightning');
    this.u = new Uniforms(gl, this.prog);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
  }

  render(bolts: Iterable<ClientBolt>, viewProj: Mat4, camX: number, camY: number, camZ: number): void {
    const gl = this.gl;
    let started = false;
    for (const b of bolts) {
      const n = this.build(b, b.x - camX, b.y - camY, b.z - camZ);
      if (!started) {
        started = true;
        gl.useProgram(this.prog);
        gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // LIGHTNING_TRANSPARENCY
        gl.disable(gl.CULL_FACE);
        gl.depthMask(false);
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, n * 3);
      gl.drawArrays(gl.TRIANGLES, 0, n);
    }
    if (started) {
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  /** LightningBoltRenderer.render geometry; returns the vertex count. */
  private build(b: ClientBolt, ox: number, oy: number, oz: number): number {
    const xs = this.xs, zs = this.zs;
    let f = 0, f1 = 0;
    const random = new JavaRandom(b.seed);
    for (let i = 7; i >= 0; i--) {
      xs[i] = f;
      zs[i] = f1;
      f += random.nextInt(11) - 5;
      f1 += random.nextInt(11) - 5;
    }
    let n = 0;
    const d = this.data;
    const v = (x: number, y: number, z: number) => {
      d[n * 3] = x + ox;
      d[n * 3 + 1] = y + oy;
      d[n * 3 + 2] = z + oz;
      n++;
    };
    const quad = (x1: number, z1: number, seg: number, x2: number, z2: number, w1: number, w2: number, b1: boolean, b2: boolean, b3: boolean, b4: boolean) => {
      const ax = x1 + (b1 ? w2 : -w2), ay = seg * 16, az = z1 + (b2 ? w2 : -w2);
      const bx = x2 + (b1 ? w1 : -w1), by = (seg + 1) * 16, bz = z2 + (b2 ? w1 : -w1);
      const cx = x2 + (b3 ? w1 : -w1), cy = (seg + 1) * 16, cz = z2 + (b4 ? w1 : -w1);
      const dx = x1 + (b3 ? w2 : -w2), dy = seg * 16, dz = z1 + (b4 ? w2 : -w2);
      v(ax, ay, az); v(bx, by, bz); v(cx, cy, cz);
      v(ax, ay, az); v(cx, cy, cz); v(dx, dy, dz);
    };
    for (let j = 0; j < 4; j++) {
      const random1 = new JavaRandom(b.seed);
      for (let k = 0; k < 3; k++) {
        let l = 7, i1 = 0;
        if (k > 0) {
          l = 7 - k;
          i1 = l - 2;
        }
        let f2 = xs[l]! - f, f3 = zs[l]! - f1;
        for (let j1 = l; j1 >= i1; j1--) {
          const f4 = f2, f5 = f3;
          if (k === 0) {
            f2 += random1.nextInt(11) - 5;
            f3 += random1.nextInt(11) - 5;
          } else {
            f2 += random1.nextInt(31) - 15;
            f3 += random1.nextInt(31) - 15;
          }
          let f10 = 0.1 + j * 0.2;
          if (k === 0) f10 *= j1 * 0.1 + 1;
          let f11 = 0.1 + j * 0.2;
          if (k === 0) f11 *= (j1 - 1) * 0.1 + 1;
          quad(f2, f3, j1, f4, f5, f10, f11, false, false, true, false);
          quad(f2, f3, j1, f4, f5, f10, f11, true, false, true, true);
          quad(f2, f3, j1, f4, f5, f10, f11, true, true, false, true);
          quad(f2, f3, j1, f4, f5, f10, f11, false, true, false, false);
        }
      }
    }
    return n;
  }
}
