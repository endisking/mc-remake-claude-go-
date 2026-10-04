/**
 * Renders single block models outside the chunk meshes: dropped items, held blocks and GUI
 * item icons (rendered once into an icon atlas canvas for the 2D GUI).
 *
 * Model keys: a block state id (≥ 0) draws that block's item model; a negative key
 * −(layer + 1) draws item sprite `layer` from the item texture array, extruded like vanilla's
 * ItemModelGenerator. Use `modelKey(itemId)` to get the key for any item.
 */
import { createProgram, Uniforms } from './gl';
import { mat4, multiply, type Mat4 } from './math';
import type { BakeResult } from '../models/bake';

const VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aUV;
layout(location = 2) in vec3 aNormal;
layout(location = 3) in float aTinted;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uLight0;
uniform vec3 uLight1;
uniform float uAmbient;
uniform int uGuiShade;
out vec3 vUV;
out float vShade;
out float vTinted;
out float vDist;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * w;
  vUV = aUV;
  vec3 n = normalize(mat3(uModel) * aNormal);
  vShade = min(1.0, uAmbient + (1.0 - uAmbient) * (max(dot(n, uLight0), 0.0) + max(dot(n, uLight1), 0.0)));
  // inventory icons: top full bright, left side 0.8, right side 0.6 (as vanilla's GUI lighting looks)
  if (uGuiShade == 1) vShade = n.y > 0.5 ? 1.0 : n.y < -0.5 ? 0.5 : (n.x < 0.0 ? 0.8 : 0.6);
  vTinted = aTinted;
  vDist = length(w.xyz);
}`;
const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform sampler2D uLightmap;
uniform vec2 uLight;
uniform vec3 uTint;
uniform int uUseLightmap;
uniform vec4 uFogColor;
uniform vec2 uFog;
uniform sampler2D uGlintTex;
uniform float uGlint;
uniform float uGlintTime;
in vec3 vUV;
in float vShade;
in float vTinted;
in float vDist;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.5) discard;
  if (vTinted > 0.5) c.rgb *= uTint;
  c.rgb *= vShade;
  if (uUseLightmap == 1) {
    c.rgb *= texture(uLightmap, uLight).rgb;
  }
  if (uGlint > 0.5) {
    // enchantment glint: scrolling texture rotated 10 degrees, added on top (GLINT render type)
    vec2 g = mat2(0.9848, 0.1736, -0.1736, 0.9848) * (vUV.xy * 2.0) + vec2(-uGlintTime, uGlintTime * 0.2727);
    c.rgb += texture(uGlintTex, g).rgb * 0.9;
  }
  if (uUseLightmap == 1) {
    float f = clamp((vDist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
    c.rgb = mix(c.rgb, uFogColor.rgb, f);
  }
  outColor = vec4(c.rgb, 1.0);
}`;

interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
}

/** Item sprites for non-block (and flat-sprite block) items. */
export interface ItemSpriteSource {
  /** TEXTURE_2D_ARRAY of item sprites */
  texture(): WebGLTexture;
  /** 16×16 alpha of a sprite layer */
  alpha(layer: number): Uint8Array | undefined;
  /** sprite layer for an item id, or −1 */
  layerFor(itemId: number): number;
  /** sprite layer for a texture name (e.g. "bow_pulling_1", "crossbow_arrow"), or −1 */
  layerByName(name: string): number;
  /** held like a tool (vanilla item/handheld) */
  handheld(layer: number): boolean | 'rod';
}

const ICON = 64;

export class BlockItemRenderer {
  private prog: WebGLProgram;
  private u: Uniforms;
  private meshes = new Map<number, Mesh | null>();
  // icon atlas
  readonly iconCanvas: HTMLCanvasElement;
  private iconCtx: CanvasRenderingContext2D;
  private iconSlots = new Map<number, number>();
  private fbo: WebGLFramebuffer;
  private fboTex: WebGLTexture;
  private fboDepth: WebGLRenderbuffer;
  private pixels = new Uint8Array(ICON * ICON * 4);
  /** draw the next model with the enchantment glint (consumed by draw) */
  glintNext = false;
  private glintTex: WebGLTexture | null = null;
  private glintLoading = false;

  private glintTexture(): WebGLTexture | null {
    if (this.glintTex || this.glintLoading || typeof fetch === 'undefined') return this.glintTex;
    this.glintLoading = true;
    void fetch('./textures/misc/enchanted_item_glint.png').then((r) => r.blob()).then((b) => createImageBitmap(b)).then((img) => {
      const gl = this.gl;
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.glintTex = t;
    }).catch(() => {});
    return null;
  }

  /** item sprites (set by the game once loaded) */
  sprites: ItemSpriteSource | null = null;
  /** block placed by an item, if any (set by the game) */
  blockOf: (itemId: number) => number | null = () => null;

  constructor(
    private gl: WebGL2RenderingContext,
    private bake: BakeResult,
    private texArray: () => WebGLTexture,
    /** constant tint for tinted faces in item form (grass/foliage default colours) */
    private itemTint: (state: number) => [number, number, number],
    /** texture layer for items drawn as flat sprites (item/generated), or null for 3D blocks */
    private flatLayer: (state: number) => number | null = () => null,
    /** 16×16 alpha of a texture layer, to extrude flat sprites like vanilla's ItemModelGenerator */
    private layerAlpha: (layer: number) => Uint8Array | undefined = () => undefined,
  ) {
    this.prog = createProgram(gl, VS, FS, 'blockitem');
    this.u = new Uniforms(gl, this.prog);
    this.iconCanvas = document.createElement('canvas');
    this.iconCanvas.width = ICON * 32;
    this.iconCanvas.height = ICON * 32;
    this.iconCtx = this.iconCanvas.getContext('2d')!;
    this.fboTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ICON, ICON, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.fboDepth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.fboDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, ICON, ICON);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fboDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Whether the model key is drawn as a flat (extruded) sprite. */
  isFlat(state: number): boolean {
    return state < 0 || this.flatLayer(state) !== null;
  }

  /**
   * Model key for an item: its own sprite when it has one (tools, food, doors, seeds, …),
   * else the block state it places (3D block or flat block-texture sprite), else null.
   */
  modelKey(itemId: number): number | null {
    const l = this.sprites?.layerFor(itemId) ?? -1;
    if (l >= 0) return -(l + 1);
    return this.blockOf(itemId);
  }

  /**
   * Model key of a named item sprite — for vanilla model overrides such as bow_pulling_0..2,
   * crossbow_pulling_0..2 / crossbow_arrow / crossbow_firework or fishing_rod_cast.
   */
  spriteKey(name: string): number | null {
    const l = this.sprites?.layerByName(name) ?? -1;
    return l >= 0 ? -(l + 1) : null;
  }

  /** Display type of a model key: 'block' (3D), 'generated' (flat) or 'handheld' (tools, sticks, rods). */
  display(key: number): 'block' | 'generated' | 'handheld' | 'handheld_rod' {
    if (key < 0) {
      const h = this.sprites?.handheld(-key - 1) ?? false;
      return h === 'rod' ? 'handheld_rod' : h ? 'handheld' : 'generated';
    }
    return this.isFlat(key) ? 'generated' : 'block';
  }

  private mesh(state: number): Mesh | null {
    if (this.meshes.has(state)) return this.meshes.get(state)!;
    if (state < 0) return this.spriteMesh(state);
    const baked = this.bake.states[state];
    const quads = baked?.choices[0]?.quads ?? [];
    const flat = this.flatLayer(state);
    if (!quads.length && flat === null) {
      this.meshes.set(state, null);
      return null;
    }
    const v: number[] = [];
    if (flat !== null) {
      const t = quads.some((q) => q.tint >= 0) ? 1 : 0;
      extrudeSprite(v, flat, this.layerAlpha(flat), t);
    }
    const src = flat !== null ? [] : quads;
    const N = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
    for (const q of src) {
      const n = N[q.dir]!;
      for (const k of [0, 1, 2, 0, 2, 3]) {
        v.push(q.pos[k * 3]! - 0.5, q.pos[k * 3 + 1]! - 0.5, q.pos[k * 3 + 2]! - 0.5, q.uv[k * 2]! / 16, q.uv[k * 2 + 1]! / 16, q.layer, n[0]!, n[1]!, n[2]!, q.tint >= 0 ? 1 : 0);
      }
    }
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const st = 10 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, st, 36);
    gl.bindVertexArray(null);
    const m = { vao, count: v.length / 10 };
    this.meshes.set(state, m);
    return m;
  }

  private spriteMesh(key: number): Mesh | null {
    const layer = -key - 1;
    if (!this.sprites) return null;
    const v: number[] = [];
    extrudeSprite(v, layer, this.sprites.alpha(layer), 0);
    const m = this.upload(v);
    this.meshes.set(key, m);
    return m;
  }

  private upload(v: number[]): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
    const st = 10 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, st, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, st, 36);
    gl.bindVertexArray(null);
    return { vao, count: v.length / 10 };
  }

  /** Draw a block model centred at the model matrix origin (unit cube −0.5..0.5). */
  draw(
    state: number, viewProj: Mat4, model: Mat4, light: number, lightmap: WebGLTexture | null,
    fog?: { color: [number, number, number]; start: number; end: number }, gui = false,
    /** light directions in the model matrix's output space (default: world-space level lights) */
    lights?: [[number, number, number], [number, number, number]],
  ): void {
    const m = this.mesh(state);
    if (!m) return;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniformMatrix4fv(this.u.get('uModel'), false, model);
    gl.uniform1i(this.u.get('uGuiShade'), gui && !this.isFlat(state) ? 1 : 0);
    if (gui) {
      // GUI lighting: top brightest, left face medium, right face darker
      gl.uniform3f(this.u.get('uLight0'), -0.43, 0.82, 0.37);
      gl.uniform3f(this.u.get('uLight1'), 0, 0, 0);
      gl.uniform1f(this.u.get('uAmbient'), this.isFlat(state) ? 1 : 0.45);
    } else {
      const [l0, l1] = lights ?? [normalize([0.2, 1, -0.7]), normalize([-0.2, 1, 0.7])];
      gl.uniform3f(this.u.get('uLight0'), l0[0], l0[1], l0[2]);
      gl.uniform3f(this.u.get('uLight1'), l1[0], l1[1], l1[2]);
      gl.uniform1f(this.u.get('uAmbient'), 0.4);
    }
    const t = state < 0 ? WHITE : this.itemTint(state);
    gl.uniform3f(this.u.get('uTint'), t[0], t[1], t[2]);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, state < 0 && this.sprites ? this.sprites.texture() : this.texArray());
    gl.uniform1i(this.u.get('uUseLightmap'), lightmap ? 1 : 0);
    // samplers of different types must never share a unit, even when one is unused
    gl.uniform1i(this.u.get('uLightmap'), 1);
    if (lightmap) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lightmap);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(this.u.get('uLight'), ((light & 15) + 0.5) / 16, ((light >> 4) + 0.5) / 16);
      const f = fog ?? { color: [0, 0, 0] as [number, number, number], start: 1e6, end: 1e6 + 1 };
      gl.uniform4f(this.u.get('uFogColor'), f.color[0], f.color[1], f.color[2], 1);
      gl.uniform2f(this.u.get('uFog'), f.start, f.end);
    }
    // enchantment glint (unit 2; samplers of different types never share a unit)
    const glint = this.glintNext ? this.glintTexture() : null;
    this.glintNext = false;
    gl.uniform1i(this.u.get('uGlintTex'), 2);
    gl.uniform1f(this.u.get('uGlint'), glint ? 1 : 0);
    if (glint) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, glint);
      gl.activeTexture(gl.TEXTURE0);
      // RenderStateShard.setupGlintTexturing: (millis × 8 mod 110000) / 110000
      gl.uniform1f(this.u.get('uGlintTime'), ((performance.now() * 8) % 110000) / 110000 * 8);
    }
    gl.bindVertexArray(m.vao);
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
    gl.bindVertexArray(null);
  }

  /**
   * Icon for a block state in the GUI atlas: rendered once with the vanilla inventory
   * transform (rotate 30° about X, 225° about Y, scale 0.625). Returns [sx, sy, size].
   */
  icon(state: number): [number, number, number] | null {
    let slot = this.iconSlots.get(state);
    if (slot === undefined) {
      if (!this.mesh(state)) return null;
      slot = this.iconSlots.size;
      this.iconSlots.set(state, slot);
      this.renderIcon(state, slot);
    }
    return [(slot % 32) * ICON, Math.floor(slot / 32) * ICON, ICON];
  }

  private renderIcon(state: number, slot: number): void {
    const gl = this.gl;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, ICON, ICON);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    // orthographic projection of a 16×16 GUI slot (−8..8 px), model in px
    const proj = mat4();
    proj[0] = 1 / 8;
    proj[5] = 1 / 8;
    proj[10] = -1 / 64;
    const model = mat4();
    if (this.isFlat(state)) {
      // flat items fill the slot, unrotated
      model[0] = model[5] = model[10] = 16;
    } else {
      const rx = rot(1, 0, 0, 30), ry = rot(0, 1, 0, 225);
      const sc = mat4();
      sc[0] = sc[5] = sc[10] = 16 * 0.625;
      multiply(model, rx, ry);
      multiply(model, model, sc);
    }
    this.draw(state, proj, model, 0xf0, null, undefined, true);
    gl.readPixels(0, 0, ICON, ICON, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(prevViewport[0]!, prevViewport[1]!, prevViewport[2]!, prevViewport[3]!);
    // flip vertically into the atlas
    const img = this.iconCtx.createImageData(ICON, ICON);
    for (let y = 0; y < ICON; y++) img.data.set(this.pixels.subarray((ICON - 1 - y) * ICON * 4, (ICON - y) * ICON * 4), y * ICON * 4);
    this.iconCtx.putImageData(img, (slot % 32) * ICON, Math.floor(slot / 32) * ICON);
  }
}

/**
 * Vanilla ItemModelGenerator: a sprite becomes a 1/16-thick slab — front and back faces of the
 * whole texture plus 1-pixel side faces wherever an opaque pixel borders a transparent one.
 * Coordinates are centred (−0.5..0.5 in x/y, ±1/32 in z); the front faces +Z.
 */
function extrudeSprite(v: number[], layer: number, alpha: Uint8Array | undefined, tint: number): void {
  const zf = 1 / 32, zb = -1 / 32;
  const quad = (c: number[][], uv: number[][], n: [number, number, number]) => {
    for (const k of [0, 1, 2, 0, 2, 3]) v.push(c[k]![0]!, c[k]![1]!, c[k]![2]!, uv[k]![0]! / 16, uv[k]![1]! / 16, layer, n[0], n[1], n[2], tint);
  };
  // front (+Z) and back (−Z, mirrored)
  quad([[-0.5, 0.5, zf], [-0.5, -0.5, zf], [0.5, -0.5, zf], [0.5, 0.5, zf]], [[0, 0], [0, 16], [16, 16], [16, 0]], [0, 0, 1]);
  quad([[0.5, 0.5, zb], [0.5, -0.5, zb], [-0.5, -0.5, zb], [-0.5, 0.5, zb]], [[16, 0], [16, 16], [0, 16], [0, 0]], [0, 0, -1]);
  if (!alpha) return;
  const solid = (i: number, j: number) => i >= 0 && j >= 0 && i < 16 && j < 16 && alpha[j * 16 + i]! > 0;
  for (let j = 0; j < 16; j++)
    for (let i = 0; i < 16; i++) {
      if (!solid(i, j)) continue;
      const x0 = i / 16 - 0.5, x1 = x0 + 1 / 16, y1 = 0.5 - j / 16, y0 = y1 - 1 / 16;
      const uc = i + 0.5, vc = j + 0.5;
      if (!solid(i - 1, j)) quad([[x0, y1, zb], [x0, y0, zb], [x0, y0, zf], [x0, y1, zf]], [[uc, j], [uc, j + 1], [uc, j + 1], [uc, j]], [-1, 0, 0]);
      if (!solid(i + 1, j)) quad([[x1, y1, zf], [x1, y0, zf], [x1, y0, zb], [x1, y1, zb]], [[uc, j], [uc, j + 1], [uc, j + 1], [uc, j]], [1, 0, 0]);
      if (!solid(i, j - 1)) quad([[x0, y1, zb], [x0, y1, zf], [x1, y1, zf], [x1, y1, zb]], [[i, vc], [i, vc], [i + 1, vc], [i + 1, vc]], [0, 1, 0]);
      if (!solid(i, j + 1)) quad([[x0, y0, zf], [x0, y0, zb], [x1, y0, zb], [x1, y0, zf]], [[i, vc], [i, vc], [i + 1, vc], [i + 1, vc]], [0, -1, 0]);
    }
}

const WHITE: [number, number, number] = [1, 1, 1];

function normalize(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

function rot(x: number, y: number, z: number, deg: number): Mat4 {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const m = mat4();
  m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
  m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
  m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
  return m;
}

export { rot };
