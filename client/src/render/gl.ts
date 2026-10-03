/** WebGL2 helpers. */

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string, name = 'program'): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`${name}: ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${name}: link: ${gl.getProgramInfoLog(p)}`);
  return p;
}

/** Cached uniform locations. */
export class Uniforms {
  private cache = new Map<string, WebGLUniformLocation | null>();
  constructor(
    private gl: WebGL2RenderingContext,
    private program: WebGLProgram,
  ) {}
  get(name: string): WebGLUniformLocation | null {
    let l = this.cache.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.cache.set(name, l);
    }
    return l;
  }
}

/** A shared quad index buffer (0,1,2, 0,2,3 per quad), grown on demand. */
export class QuadIndices {
  buffer: WebGLBuffer;
  quads = 0;
  constructor(private gl: WebGL2RenderingContext) {
    this.buffer = gl.createBuffer()!;
    this.ensure(16384);
  }
  ensure(quads: number): void {
    if (quads <= this.quads) return;
    let n = Math.max(this.quads * 2, 1024);
    while (n < quads) n *= 2;
    const idx = new Uint32Array(n * 6);
    for (let q = 0; q < n; q++) {
      const v = q * 4, i = q * 6;
      idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
      idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.quads = n;
  }
}
