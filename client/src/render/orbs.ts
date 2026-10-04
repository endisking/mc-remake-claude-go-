/**
 * Experience orbs (vanilla ExperienceOrbRenderer): camera-facing sprites picked by orb value,
 * pulsing between green and yellow, scaled 0.3, lit with block light + 7.
 */
import { createProgram, Uniforms } from './gl';
import type { Mat4 } from './math';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec2 aLight;
uniform mat4 uViewProj;
out vec2 vUV;
out vec4 vColor;
out vec2 vLight;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); vUV = aUV; vColor = aColor; vLight = aLight; }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uLightmap;
in vec2 vUV;
in vec4 vColor;
in vec2 vLight;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.1) discard;
  outColor = vec4(c.rgb * vColor.rgb * texture(uLightmap, vLight).rgb, c.a * vColor.a);
}`;

export interface OrbView {
  x: number;
  y: number;
  z: number;
  value: number;
  /** ticks + partial, for the pulse */
  time: number;
  /** packed light (sky << 4 | block) */
  light: number;
}

/** ExperienceOrb.getIcon. */
function icon(v: number): number {
  const steps = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3];
  for (let i = 0; i < steps.length; i++) if (v >= steps[i]!) return 10 - i;
  return 0;
}

export class OrbRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private tex: WebGLTexture | null = null;
  private data = new Float32Array(256 * 6 * 11);

  constructor(private gl: WebGL2RenderingContext) {
    this.prog = createProgram(gl, VS, FS, 'orbs');
    this.u = new Uniforms(gl, this.prog);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const st = 11 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, st, 36);
    gl.bindVertexArray(null);
    void this.load();
  }

  private async load(): Promise<void> {
    const bmp = await createImageBitmap(await (await fetch('./textures/entity/experience_orb.png')).blob(), { premultiplyAlpha: 'none' });
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.tex = t;
  }

  /** right/up: camera basis vectors for billboarding. */
  render(orbs: OrbView[], viewProj: Mat4, camX: number, camY: number, camZ: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number, lightmap: WebGLTexture): void {
    if (!this.tex || !orbs.length) return;
    const gl = this.gl;
    const d = this.data;
    let n = 0;
    for (const o of orbs.slice(0, 256)) {
      const i = icon(o.value);
      const u0 = ((i % 4) * 16) / 64, v0 = (Math.floor(i / 4) * 16) / 64, u1 = u0 + 0.25, v1 = v0 + 0.25;
      const f8 = o.time / 2;
      const r = ((Math.sin(f8) + 1) * 0.5 * 255) / 255;
      const b = ((Math.sin(f8 + 4.1887903) + 1) * 0.1 * 255) / 255;
      const lu = (Math.min(15, (o.light & 15) + 7) + 0.5) / 16, lv = ((o.light >> 4) + 0.5) / 16;
      const s = 0.3 * 0.5;
      const cx = o.x - camX, cy = o.y + 0.1 - camY, cz = o.z - camZ;
      const corner = (sx: number, sy: number, u: number, v: number) => {
        d.set([cx + (rx * sx + ux * sy) * s * 2, cy + (ry * sx + uy * sy) * s * 2, cz + (rz * sx + uz * sy) * s * 2, u, v, r, 1, b, 128 / 255, lu, lv], n * 11);
        n++;
      };
      corner(-0.5, -0.25, u0, v1); corner(0.5, -0.25, u1, v1); corner(0.5, 0.75, u1, v0);
      corner(-0.5, -0.25, u0, v1); corner(0.5, 0.75, u1, v0); corner(-0.5, 0.75, u0, v0);
    }
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmap);
    gl.uniform1i(this.u.get('uLightmap'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 11);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    gl.bindVertexArray(null);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
  }
}
