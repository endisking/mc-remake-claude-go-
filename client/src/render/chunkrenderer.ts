/**
 * Chunk section rendering: schedules meshing on a worker pool, uploads meshes
 * incrementally, culls by frustum and cave visibility, and draws the opaque, cutout and
 * translucent passes (translucent sorted back to front).
 */
import { hasAllNeighbours } from './sectionready';
import { chunkKey } from '@shared/world/chunk';
import { padIndex, PADDED_VOLUME, type MeshInput, type MeshOutput, type MesherOptions } from './mesher';
import type { ClientWorld } from '../world/clientworld';
import type { TextureManifest } from './blockmodels';
import type { BiomeColors } from './biomecolors';
import { createProgram, Uniforms, QuadIndices } from './gl';
import { aabbInFrustum } from './math';

const VS = `#version 300 es
layout(location = 0) in uvec3 aData;
uniform mat4 uViewProj;
uniform vec3 uOrigin;
uniform float uShade[7];
uniform float uAo;
out vec3 vUV;
out vec2 vLight;
out vec3 vColor;
out float vDist;
void main() {
  uint a0 = aData.x, a1 = aData.y, a2 = aData.z;
  vec3 p = vec3(float(a0 & 1023u), float((a0 >> 10u) & 1023u), float((a0 >> 20u) & 1023u)) / 32.0 - 8.0;
  vec3 w = uOrigin + p;
  gl_Position = uViewProj * vec4(w, 1.0);
  vUV = vec3(float(a1 & 31u) / 16.0, float((a1 >> 5u) & 31u) / 16.0, float((a1 >> 10u) & 4095u));
  float sky = float((a1 >> 22u) & 31u) * 0.5;
  float blk = float((a1 >> 27u) & 31u) * 0.5;
  vLight = vec2((blk + 0.5) / 16.0, (sky + 0.5) / 16.0);
  vec3 tint = vec3(float((a2 >> 16u) & 255u), float((a2 >> 8u) & 255u), float(a2 & 255u)) / 255.0;
  float ao = 1.0 - float(a0 >> 30u) * 0.2 * uAo;
  vColor = tint * uShade[(a2 >> 24u) & 7u] * ao;
  vDist = length(w);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform sampler2D uLightmap;
uniform vec4 uFogColor;
uniform vec2 uFog;
uniform int uPass;
in vec3 vUV;
in vec2 vLight;
in vec3 vColor;
in float vDist;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  if (uPass == 0) {
    // solid pass: alpha ignored; transparent texels (fast leaves) show a dark fill
    if (c.a < 0.5) c.rgb = vec3(0.16, 0.16, 0.16);
    c.a = 1.0;
  } else if (uPass == 1) {
    if (c.a < 0.5) discard;
    c.a = 1.0;
  } else if (c.a < 0.004) discard;
  c.rgb *= vColor;
  c.rgb *= texture(uLightmap, vLight).rgb;
  float f = clamp((vDist - uFog.x) / max(uFog.y - uFog.x, 0.001), 0.0, 1.0);
  c.rgb = mix(c.rgb, uFogColor.rgb, f * uFogColor.a);
  outColor = c;
}`;

/** Vanilla directional face shading: down, up, north, south, west, east, none. */
const SHADE = new Float32Array([0.5, 1.0, 0.8, 0.8, 0.6, 0.6, 1.0]);

class RenderSection {
  vao: (WebGLVertexArrayObject | null)[] = [null, null, null];
  vbo: (WebGLBuffer | null)[] = [null, null, null];
  quads = [0, 0, 0];
  vis: Uint8Array | null = null;
  centers: Float32Array | null = null;
  sortIbo: WebGLBuffer | null = null;
  sortedAt: [number, number, number] = [NaN, NaN, NaN];
  dirty = true;
  building = false;
  /** Rebuild requested while a build was in flight. */
  rebuild = false;
  hasMesh = false;
  // traversal scratch
  frame = -1;
  dirs = 0;
  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
  ) {}
}

export interface ChunkRenderStats {
  sections: number;
  visible: number;
  pending: number;
  building: number;
  avgBuildMs: number;
  quads: number;
}

export class ChunkRenderer {
  private readonly program: WebGLProgram;
  private readonly u: Uniforms;
  private readonly indices: QuadIndices;
  private readonly sections = new Map<number, RenderSection>();
  private readonly workers: { w: Worker; busy: boolean }[] = [];
  private readonly jobs = new Map<number, RenderSection>();
  /** Sections waiting for a (re)build, so scheduling never scans every loaded section. */
  private readonly dirtySet = new Set<RenderSection>();
  /** Biome tints per chunk column (the 1.17 overworld zoom ignores y): computed once, reused by all 16 sections. */
  private readonly tintCache = new Map<number, Uint32Array>();
  private tintCacheRadius = -1;
  // scheduling scratch (no per-frame allocation)
  private readonly pickS: (RenderSection | null)[] = [null, null, null, null, null, null, null, null];
  private readonly pickD = new Float64Array(8);
  private nextJob = 1;
  private readonly uploads: MeshOutput[] = [];
  private frameNo = 0;
  private readonly visible: RenderSection[] = [];
  private buildTimes: number[] = [];
  private readonly tintScratch = new Uint32Array(768);
  renderDistance = 8;
  /** Time budget for mesh uploads per frame in ms (keeps frame times smooth). */
  uploadBudgetMs = 3;
  private camX = 0;
  private camY = 0;
  private camZ = 0;

  constructor(
    private gl: WebGL2RenderingContext,
    private world: ClientWorld,
    private biomes: BiomeColors,
    manifest: TextureManifest,
    private meshOpts: MesherOptions,
    workerCount = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)),
  ) {
    this.program = createProgram(gl, VS, FS, 'terrain');
    this.u = new Uniforms(gl, this.program);
    this.indices = new QuadIndices(gl);
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('./mesher.worker.ts', import.meta.url), { type: 'module' });
      const entry = { w, busy: true };
      w.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === 'ready') {
          entry.busy = false;
          this.schedule(this.camX, this.camY, this.camZ);
        } else if (m.type === 'mesh') {
          entry.busy = false;
          this.buildTimes.push(m.ms);
          if (this.buildTimes.length > 100) this.buildTimes.shift();
          this.onMeshed(m.id, m.out as MeshOutput);
          // keep workers fed without waiting for the next frame
          this.schedule(this.camX, this.camY, this.camZ);
        }
      };
      w.postMessage({ type: 'init', manifest, opts: meshOpts });
      this.workers.push(entry);
    }
    world.onSectionDirty = (cx, sy, cz) => this.markDirty(cx, sy, cz);
    world.onChunkLoaded = (c) => {
      for (let sy = 0; sy < 16; sy++) this.markDirty(c.x, sy, c.z);
      // neighbours' border faces/light may change
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          for (let sy = 0; sy < 16; sy++) this.markDirty(c.x + dx, sy, c.z + dz, false);
        }
    };
    world.onChunkUnloaded = (cx, cz) => {
      for (let sy = 0; sy < 16; sy++) this.disposeSection(cx, sy, cz);
      this.tintCache.delete(chunkKey(cx, cz));
    };
  }

  private key(cx: number, sy: number, cz: number): number {
    return chunkKey(cx, cz) * 16 + sy;
  }

  markDirty(cx: number, sy: number, cz: number, create = true): void {
    const k = this.key(cx, sy, cz);
    let s = this.sections.get(k);
    if (!s) {
      if (!create && !this.world.getChunk(cx, cz)) return;
      s = new RenderSection(cx, sy, cz);
      this.sections.set(k, s);
    }
    if (s.building) s.rebuild = true;
    s.dirty = true;
    this.dirtySet.add(s);
  }

  private disposeSection(cx: number, sy: number, cz: number): void {
    const k = this.key(cx, sy, cz);
    const s = this.sections.get(k);
    if (!s) return;
    this.freeBuffers(s);
    this.sections.delete(k);
    this.dirtySet.delete(s);
  }

  private freeBuffers(s: RenderSection): void {
    const gl = this.gl;
    for (let p = 0; p < 3; p++) {
      if (s.vao[p]) gl.deleteVertexArray(s.vao[p]!);
      if (s.vbo[p]) gl.deleteBuffer(s.vbo[p]!);
      s.vao[p] = null;
      s.vbo[p] = null;
      s.quads[p] = 0;
    }
    if (s.sortIbo) gl.deleteBuffer(s.sortIbo);
    s.sortIbo = null;
  }

  /** LevelRenderer.allChanged: rebuild every section (F3+A). */
  allChanged(): void {
    for (const s of this.sections.values()) {
      s.dirty = true;
      this.dirtySet.add(s);
    }
  }

  setMesherOptions(opts: MesherOptions, manifest: TextureManifest): void {
    this.meshOpts = opts;
    for (const w of this.workers) {
      w.busy = true;
      w.w.postMessage({ type: 'init', manifest, opts });
    }
    this.allChanged();
  }

  // ------------------------------------------------------------------ meshing
  private readonly isLoaded = (cx: number, cz: number): boolean => !!this.world.getChunk(cx, cz);
  /** Sections are built only once all 8 neighbour columns are loaded (no faces against missing chunks). */
  private canBuild(s: RenderSection): boolean {
    return hasAllNeighbours(this.isLoaded, s.sx, s.sz);
  }

  /** Copy the section and a one-block border into a padded snapshot. */
  private snapshot(s: RenderSection): MeshInput {
    const states = new Uint16Array(PADDED_VOLUME);
    const light = new Uint8Array(PADDED_VOLUME);
    for (let dcx = -1; dcx <= 1; dcx++)
      for (let dcz = -1; dcz <= 1; dcz++) {
        const chunk = this.world.getChunk(s.sx + dcx, s.sz + dcz);
        if (!chunk) continue;
        const x0 = dcx < 0 ? 15 : 0, x1 = dcx > 0 ? 0 : 15;
        const z0 = dcz < 0 ? 15 : 0, z1 = dcz > 0 ? 0 : 15;
        for (let dsy = -1; dsy <= 1; dsy++) {
          const sy = s.sy + dsy;
          let y0 = dsy < 0 ? 15 : 0, y1 = dsy > 0 ? 0 : 15;
          if (sy < 0) continue;
          if (sy > 15) {
            // above the world: full sky light, air
            for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) light[padIndex(x + dcx * 16, 16, z + dcz * 16)] = 0xf0;
            continue;
          }
          const sec = chunk.sections[sy]!;
          const blocks = sec.blocks, lt = sec.light, ul = sec.uniformLight;
          for (let y = y0; y <= y1; y++)
            for (let z = z0; z <= z1; z++) {
              const src = (y << 8) | (z << 4);
              let dst = padIndex(x0 + dcx * 16, y + dsy * 16, z + dcz * 16);
              for (let x = x0; x <= x1; x++, dst++) {
                states[dst] = blocks ? blocks[src | x]! : 0;
                light[dst] = lt ? lt[src | x]! : ul;
              }
            }
        }
      }
    return { sx: s.sx, sy: s.sy, sz: s.sz, states, light, tints: this.sectionTints(s) };
  }

  /** Tints for a section (a fresh copy: it is transferred to the worker). */
  private sectionTints(s: RenderSection): Uint32Array {
    if (this.world.biomeZoomSeed === null) {
      // dev scenes: quart biomes vary with y
      this.biomes.fillSectionTints(this.world, s.sx * 16, s.sy * 16 + 8, s.sz * 16, this.tintScratch);
      return this.tintScratch.slice();
    }
    if (this.tintCacheRadius !== this.biomes.blendRadius) {
      this.tintCache.clear();
      this.tintCacheRadius = this.biomes.blendRadius;
    }
    const key = chunkKey(s.sx, s.sz);
    let t = this.tintCache.get(key);
    if (!t) {
      // all 8 neighbour columns are loaded (canBuild), so the blended area is complete
      t = new Uint32Array(768);
      this.biomes.fillSectionTints(this.world, s.sx * 16, 64, s.sz * 16, t);
      this.tintCache.set(key, t);
    }
    return t.slice();
  }

  private schedule(camX: number, camY: number, camZ: number): void {
    let nFree = 0;
    for (const w of this.workers) if (!w.busy) nFree++;
    if (!nFree || !this.dirtySet.size) return;
    // pick the nFree nearest buildable dirty sections (insertion into a tiny sorted list)
    const ccx = Math.floor(camX) >> 4, ccy = Math.floor(camY) >> 4, ccz = Math.floor(camZ) >> 4;
    const pickS = this.pickS, pickD = this.pickD;
    const k = Math.min(nFree, pickS.length);
    let n = 0;
    const range = this.renderDistance + 1;
    for (const s of this.dirtySet) {
      if (s.building) continue;
      if (!s.dirty) {
        this.dirtySet.delete(s);
        continue;
      }
      const dx = s.sx - ccx, dz = s.sz - ccz, dy = s.sy - ccy;
      if (dx > range || dx < -range || dz > range || dz < -range) continue;
      const d = dx * dx + dz * dz + dy * dy * 0.5;
      if (n === k && d >= pickD[n - 1]!) continue;
      if (!this.canBuild(s)) continue;
      const sec = this.world.getChunk(s.sx, s.sz)!.sections[s.sy]!;
      if (sec.isEmpty()) {
        // empty section: nothing to draw, fully open for cave culling (no worker needed)
        s.dirty = false;
        this.dirtySet.delete(s);
        this.freeBuffers(s);
        s.vis = null;
        s.hasMesh = true;
        continue;
      }
      let i = n < k ? n++ : n - 1;
      while (i > 0 && pickD[i - 1]! > d) {
        pickD[i] = pickD[i - 1]!;
        pickS[i] = pickS[i - 1]!;
        i--;
      }
      pickD[i] = d;
      pickS[i] = s;
    }
    let wi = 0;
    for (let i = 0; i < n; i++) {
      const s = pickS[i]!;
      pickS[i] = null;
      while (this.workers[wi]!.busy) wi++;
      const w = this.workers[wi]!;
      s.dirty = false;
      this.dirtySet.delete(s);
      const id = this.nextJob++;
      s.building = true;
      s.rebuild = false;
      this.jobs.set(id, s);
      const input = this.snapshot(s);
      w.busy = true;
      w.w.postMessage({ type: 'mesh', id, input }, [input.states.buffer, input.light.buffer, input.tints.buffer]);
    }
  }

  private onMeshed(id: number, out: MeshOutput): void {
    const s = this.jobs.get(id);
    this.jobs.delete(id);
    if (!s) return;
    s.building = false;
    if (this.sections.get(this.key(s.sx, s.sy, s.sz)) !== s) return; // unloaded meanwhile
    if (s.rebuild) {
      s.dirty = true;
      this.dirtySet.add(s);
    }
    this.uploads.push(out);
  }

  private upload(out: MeshOutput): void {
    const s = this.sections.get(this.key(out.sx, out.sy, out.sz));
    if (!s) return;
    const gl = this.gl;
    for (let p = 0; p < 3; p++) {
      const data = out.passes[p]!;
      const quads = data.length / 12;
      if (quads === 0) {
        if (s.vao[p]) gl.deleteVertexArray(s.vao[p]!);
        if (s.vbo[p]) gl.deleteBuffer(s.vbo[p]!);
        s.vao[p] = null;
        s.vbo[p] = null;
        s.quads[p] = 0;
        continue;
      }
      if (!s.vao[p]) {
        s.vao[p] = gl.createVertexArray();
        s.vbo[p] = gl.createBuffer();
        gl.bindVertexArray(s.vao[p]!);
        gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo[p]!);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribIPointer(0, 3, gl.UNSIGNED_INT, 12, 0);
      } else {
        gl.bindVertexArray(s.vao[p]!);
        gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo[p]!);
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.indices.ensure(quads);
      if (p === 2) {
        if (!s.sortIbo) s.sortIbo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.sortIbo);
        s.sortedAt = [NaN, NaN, NaN];
      } else {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices.buffer);
      }
      s.quads[p] = quads;
      gl.bindVertexArray(null);
    }
    s.centers = out.centers.length ? out.centers : null;
    s.vis = out.visibility;
    s.hasMesh = true;
  }

  /** Rewrite a section's translucent index buffer, farthest quads first. */
  private sortOrder = new Uint32Array(1024);
  private sortDist = new Float32Array(1024);
  private sortIdx = new Uint32Array(1024 * 6);

  private sortTranslucent(s: RenderSection, rx: number, ry: number, rz: number): void {
    const c = s.centers;
    if (!c) return;
    const n = c.length / 3;
    if (this.sortOrder.length < n) {
      let cap = this.sortOrder.length;
      while (cap < n) cap *= 2;
      this.sortOrder = new Uint32Array(cap);
      this.sortDist = new Float32Array(cap);
      this.sortIdx = new Uint32Array(cap * 6);
    }
    const order = this.sortOrder.subarray(0, n);
    const dist = this.sortDist;
    for (let i = 0; i < n; i++) {
      const dx = c[i * 3]! - rx, dy = c[i * 3 + 1]! - ry, dz = c[i * 3 + 2]! - rz;
      dist[i] = dx * dx + dy * dy + dz * dz;
      order[i] = i;
    }
    order.sort(this.byDistDesc);
    const idx = this.sortIdx.subarray(0, n * 6);
    for (let i = 0; i < n; i++) {
      const v = order[i]! * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.sortIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    s.sortedAt = [rx, ry, rz];
  }

  private readonly byDistDesc = (a: number, b: number) => this.sortDist[b]! - this.sortDist[a]!;

  // ------------------------------------------------------------------ visibility
  private readonly bfsQueue: RenderSection[] = [];
  private readonly bfsFrom: number[] = [];
  /** Cave culling BFS from the camera section through open faces, limited by the frustum. */
  private collectVisible(cx: number, cy: number, cz: number, planes: Float32Array, caveCulling: boolean): void {
    const vis = this.visible;
    vis.length = 0;
    const frame = ++this.frameNo;
    const ccx = Math.floor(cx) >> 4, ccy = Math.min(15, Math.max(0, Math.floor(cy) >> 4)), ccz = Math.floor(cz) >> 4;
    const rd = this.renderDistance;
    const start = this.sections.get(this.key(ccx, ccy, ccz));
    const queue = this.bfsQueue, fromQ = this.bfsFrom;
    queue.length = 0;
    fromQ.length = 0;
    const inFrustum = (s: RenderSection) =>
      aabbInFrustum(planes, s.sx * 16 - cx, s.sy * 16 - cy, s.sz * 16 - cz, s.sx * 16 + 16 - cx, s.sy * 16 + 16 - cy, s.sz * 16 + 16 - cz);
    if (!caveCulling || !start) {
      // plain frustum culling, ordered by distance
      for (const s of this.sections.values()) {
        if (Math.abs(s.sx - ccx) > rd || Math.abs(s.sz - ccz) > rd) continue;
        if (inFrustum(s)) vis.push(s);
      }
      vis.sort((a, b) => dist2(a, ccx, ccy, ccz) - dist2(b, ccx, ccy, ccz));
      return;
    }
    start.frame = frame;
    start.dirs = 0;
    queue.push(start);
    fromQ.push(-1);
    for (let qi = 0; qi < queue.length; qi++) {
      const s = queue[qi]!, from = fromQ[qi]!;
      vis.push(s);
      for (let d = 0; d < 6; d++) {
        if (s.dirs & (1 << OPP[d]!)) continue; // never travel back toward the camera
        if (from >= 0 && s.vis && !((s.vis[from]! >> d) & 1)) continue;
        const nx = s.sx + DX[d]!, ny = s.sy + DY[d]!, nz = s.sz + DZ[d]!;
        if (ny < 0 || ny > 15 || Math.abs(nx - ccx) > rd || Math.abs(nz - ccz) > rd) continue;
        const n = this.sections.get(this.key(nx, ny, nz));
        if (!n || n.frame === frame) continue;
        if (!inFrustum(n)) continue;
        n.frame = frame;
        n.dirs = s.dirs | (1 << d);
        queue.push(n);
        fromQ.push(OPP[d]!);
      }
    }
  }

  // ------------------------------------------------------------------ frame
  update(camX: number, camY: number, camZ: number): void {
    this.camX = camX;
    this.camY = camY;
    this.camZ = camZ;
    const t0 = performance.now();
    let n = 0;
    while (this.uploads.length && (n < 2 || performance.now() - t0 < this.uploadBudgetMs)) {
      this.upload(this.uploads.shift()!);
      n++;
    }
    this.schedule(camX, camY, camZ);
  }

  render(
    viewProj: Float32Array,
    planes: Float32Array,
    camX: number, camY: number, camZ: number,
    tex: WebGLTexture, lightmap: WebGLTexture,
    fogColor: [number, number, number], fogStart: number, fogEnd: number,
    opts: { smoothLighting: boolean; caveCulling: boolean },
  ): void {
    const gl = this.gl;
    this.collectVisible(camX, camY, camZ, planes, opts.caveCulling);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.u.get('uViewProj'), false, viewProj);
    gl.uniform1fv(this.u.get('uShade'), SHADE);
    gl.uniform1f(this.u.get('uAo'), opts.smoothLighting ? 1 : 0);
    gl.uniform4f(this.u.get('uFogColor'), fogColor[0], fogColor[1], fogColor[2], 1);
    gl.uniform2f(this.u.get('uFog'), fogStart, fogEnd);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.uniform1i(this.u.get('uTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmap);
    gl.uniform1i(this.u.get('uLightmap'), 1);
    const uOrigin = this.u.get('uOrigin');
    const uPass = this.u.get('uPass');
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    for (let p = 0; p < 2; p++) {
      gl.uniform1i(uPass, p);
      // cutout pass contains double-sided plants: draw without back-face culling
      if (p === 1) gl.disable(gl.CULL_FACE);
      for (const s of this.visible) {
        if (!s.quads[p]) continue;
        gl.uniform3f(uOrigin, s.sx * 16 - camX, s.sy * 16 - camY, s.sz * 16 - camZ);
        gl.bindVertexArray(s.vao[p]!);
        gl.drawElements(gl.TRIANGLES, s.quads[p]! * 6, gl.UNSIGNED_INT, 0);
      }
      gl.enable(gl.CULL_FACE);
    }
    gl.bindVertexArray(null);
  }

  /** Translucent pass: back to front, sorted per section. Call after entities. */
  renderTranslucent(camX: number, camY: number, camZ: number, tex: WebGLTexture, lightmap: WebGLTexture): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lightmap);
    const uOrigin = this.u.get('uOrigin');
    const uPass = this.u.get('uPass');
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.uniform1i(uPass, 2);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    let sorts = 0;
    for (let i = this.visible.length - 1; i >= 0; i--) {
      const s = this.visible[i]!;
      if (!s.quads[2]) continue;
      const rx = camX - s.sx * 16, ry = camY - s.sy * 16, rz = camZ - s.sz * 16;
      const moved = (rx - s.sortedAt[0]) ** 2 + (ry - s.sortedAt[1]) ** 2 + (rz - s.sortedAt[2]) ** 2;
      if (!(moved < 1) && (sorts < 12 || Number.isNaN(s.sortedAt[0]))) {
        this.sortTranslucent(s, rx, ry, rz);
        sorts++;
      }
      gl.uniform3f(uOrigin, s.sx * 16 - camX, s.sy * 16 - camY, s.sz * 16 - camZ);
      gl.bindVertexArray(s.vao[2]!);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.sortIbo);
      gl.drawElements(gl.TRIANGLES, s.quads[2]! * 6, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  /** Whether every section of a chunk column has its current mesh (loading screen progress). */
  columnMeshed(cx: number, cz: number): boolean {
    for (let sy = 0; sy < 16; sy++) {
      const s = this.sections.get(this.key(cx, sy, cz));
      if (!s || !s.hasMesh || s.dirty || s.building) return false;
    }
    return true;
  }

  stats(): ChunkRenderStats {
    let pending = 0, building = 0, quads = 0;
    for (const s of this.dirtySet) if (s.dirty && !s.building && this.canBuild(s)) pending++;
    building = this.jobs.size;
    for (const s of this.visible) quads += s.quads[0]! + s.quads[1]! + s.quads[2]!;
    const avg = this.buildTimes.length ? this.buildTimes.reduce((a, b) => a + b, 0) / this.buildTimes.length : 0;
    return { sections: this.sections.size, visible: this.visible.length, pending, building, avgBuildMs: avg, quads };
  }

  dispose(): void {
    for (const w of this.workers) w.w.terminate();
    for (const s of this.sections.values()) this.freeBuffers(s);
    this.sections.clear();
  }
}

const DX = [0, 0, 0, 0, -1, 1], DY = [-1, 1, 0, 0, 0, 0], DZ = [0, 0, -1, 1, 0, 0];
const OPP = [1, 0, 3, 2, 5, 4];

function dist2(s: RenderSection, x: number, y: number, z: number): number {
  return (s.sx - x) ** 2 + (s.sy - y) ** 2 + (s.sz - z) ** 2;
}
