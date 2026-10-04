/**
 * Chunk-section mesher. Pure function of a padded 18×18×18 snapshot (the section plus a
 * one-block border) → packed vertex data per render pass. Runs in Web Workers.
 *
 * Vertex format (3 × uint32 = 12 bytes):
 *   a0: x10 | y10 | z10 | ao2        positions in 1/32 block, offset +8 blocks
 *   a1: u5 | v5 | layer12 | sky5 | blk5   light in half levels (0..30)
 *   a2: rgb24 | shade3 | flags5
 */
import { BLOCKS } from '@shared/data';
import { STATE_TO_BLOCK, getProp } from '@shared/world/blockstate';
import { FULL_COLLISION, FLUID, FLUID_LEVEL, IS_AIR } from '@shared/world/blockinfo';
import { MATERIAL_SOLID } from '@shared/world/blockprops';
import { getFlow } from '@shared/game/fluids';
import { BLOCK_STATE_COUNT } from '@shared/data';
import { PASS_SOLID, PASS_CUTOUT, PASS_TRANSLUCENT, type BakeResult, type BakedQuad } from '../models/bake';
import { TINT_KIND, TINT_CONST_COLOR, TINT_GRASS, TINT_FOLIAGE, TINT_WATER, TINT_CONST, TINT_REDSTONE, TINT_STEM, redstoneColor, stemColor } from './tints';

export const P = 18;
export const PADDED_VOLUME = P * P * P;
export function padIndex(x: number, y: number, z: number): number {
  return ((y + 1) * P + (z + 1)) * P + (x + 1);
}

export interface MeshInput {
  sx: number;
  sy: number;
  sz: number;
  states: Uint16Array;
  light: Uint8Array;
  /** grass, foliage, water colour per column (z*16+x) → 3 × 256 entries. */
  tints: Uint32Array;
}

export interface MeshOutput {
  sx: number;
  sy: number;
  sz: number;
  /** vertex data per pass (solid, cutout, translucent) */
  passes: [Uint32Array, Uint32Array, Uint32Array];
  /** translucent quad centres (x,y,z per quad, section-relative) for back-to-front sorting */
  centers: Float32Array;
  /** Cave culling: visibility[a] has bit b set if face a connects to face b through open cells. */
  visibility: Uint8Array;
}

export interface MesherOptions {
  smoothLighting: boolean;
  fancy: boolean;
}

export interface FluidTextures {
  waterStill: number;
  waterFlow: number;
  lavaStill: number;
  lavaFlow: number;
}

class VBuf {
  data = new Uint32Array(3 * 4 * 256);
  n = 0;
  push(a: number, b: number, c: number): void {
    if (this.n + 3 > this.data.length) {
      const d = new Uint32Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    this.data[this.n++] = a >>> 0;
    this.data[this.n++] = b >>> 0;
    this.data[this.n++] = c >>> 0;
  }
  take(): Uint32Array {
    return this.data.slice(0, this.n);
  }
  reset(): void {
    this.n = 0;
  }
}

const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];
const OPP = [1, 0, 3, 2, 5, 4];
/** For each face: the two tangent axes (0=x,1=y,2=z). */
const TAN: [number, number][] = [[0, 2], [0, 2], [0, 1], [0, 1], [2, 1], [2, 1]];

/** Blocks whose faces against the same block are hidden (glass-like). */
const SAME_CULL = new Uint8Array(BLOCKS.length);
for (const b of BLOCKS) {
  if (b.name === 'glass' || b.name.endsWith('_stained_glass') || b.name === 'tinted_glass' || b.name === 'ice' || b.name === 'frosted_ice' ||
    b.name === 'slime_block' || b.name === 'honey_block' || b.name === 'powder_snow' || b.name.endsWith('_leaves')) SAME_CULL[b.id] = 1;
}

export class Mesher {
  private readonly bufs = [new VBuf(), new VBuf(), new VBuf()];
  private centers: number[] = [];
  private readonly faceQuads: BakedQuad[][][] = [];
  private readonly redstonePower = new Uint8Array(BLOCK_STATE_COUNT);
  private readonly stemAge = new Uint8Array(BLOCK_STATE_COUNT);
  private readonly leavesId = new Uint8Array(BLOCKS.length);

  constructor(
    readonly bake: BakeResult,
    readonly fluids: FluidTextures,
    readonly opts: MesherOptions,
  ) {
    for (const b of BLOCKS) {
      if (b.name === 'redstone_wire') for (let s = b.minStateId; s <= b.maxStateId; s++) this.redstonePower[s] = getProp(s, 'power') as number;
      if (b.name === 'melon_stem' || b.name === 'pumpkin_stem') for (let s = b.minStateId; s <= b.maxStateId; s++) this.stemAge[s] = getProp(s, 'age') as number;
      if (b.name.endsWith('_leaves')) this.leavesId[b.id] = 1;
    }
  }

  mesh(input: MeshInput): MeshOutput {
    for (const b of this.bufs) b.reset();
    this.centers = [];
    const { states } = input;
    const occ = this.bake.occludes;
    for (let y = 0; y < 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const i = padIndex(x, y, z);
          const st = states[i]!;
          if (IS_AIR[st]) continue;
          const bid = STATE_TO_BLOCK[st]!;
          if (FLUID[st]) this.fluid(input, x, y, z, st);
          const baked = this.bake.states[st];
          if (!baked) continue;
          // fast reject: fully enclosed opaque cube
          if (this.bake.fullOpaque[st]) {
            let hidden = true;
            for (let f = 0; f < 6; f++) {
              const n = states[i + DX[f]! + DY[f]! * P * P + DZ[f]! * P]!;
              if (!((occ[n]! >> OPP[f]!) & 1)) {
                hidden = false;
                break;
              }
            }
            if (hidden) continue;
          }
          let model = baked.choices[0]!;
          if (baked.choices.length > 1) {
            const h = posHash(input.sx * 16 + x, input.sy * 16 + y, input.sz * 16 + z);
            let r = h % baked.totalWeight;
            for (let k = 0; k < baked.choices.length; k++) {
              r -= baked.weights[k]!;
              if (r < 0) {
                model = baked.choices[k]!;
                break;
              }
            }
          }
          let ox = 0, oy = 0, oz = 0;
          if (baked.offset) {
            const o = plantOffset(input.sx * 16 + x, input.sz * 16 + z);
            ox = o[0];
            oz = o[1];
            if (baked.offset === 2) oy = o[2];
          }
          for (const q of model.quads) {
            if (q.cull >= 0) {
              const n = states[i + DX[q.cull]! + DY[q.cull]! * P * P + DZ[q.cull]! * P]!;
              if ((occ[n]! >> OPP[q.cull]!) & 1) continue;
              if (SAME_CULL[bid] && STATE_TO_BLOCK[n] === bid && (this.opts.fancy ? !this.leavesId[bid] : true)) continue;
            }
            this.emitQuad(input, x, y, z, st, bid, q, ox, oy, oz);
          }
        }
    const passes = this.bufs.map((b) => b.take()) as [Uint32Array, Uint32Array, Uint32Array];
    return { sx: input.sx, sy: input.sy, sz: input.sz, passes, centers: new Float32Array(this.centers), visibility: this.visibility(states) };
  }

  private readonly visited = new Uint8Array(4096);
  private readonly stack = new Int32Array(4096);

  /** Flood-fill open cells to find which section faces see each other (vanilla VisGraph). */
  visibility(states: Uint16Array): Uint8Array {
    const vis = new Uint8Array(6);
    const occ = this.bake.occludes;
    const visited = this.visited;
    visited.fill(0);
    let closed = 0;
    for (let i = 0; i < 4096; i++) {
      const x = i & 15, z = (i >> 4) & 15, y = i >> 8;
      if (occ[states[padIndex(x, y, z)]!] === 63) {
        visited[i] = 1;
        closed++;
      }
    }
    if (closed < 256) {
      vis.fill(63);
      return vis;
    }
    const stack = this.stack;
    for (let start = 0; start < 4096; start++) {
      if (visited[start]) continue;
      const sx = start & 15, sz = (start >> 4) & 15, sy = start >> 8;
      if (sx !== 0 && sx !== 15 && sy !== 0 && sy !== 15 && sz !== 0 && sz !== 15) continue;
      let faces = 0;
      let sp = 0;
      stack[sp++] = start;
      visited[start] = 1;
      while (sp > 0) {
        const c = stack[--sp]!;
        const x = c & 15, z = (c >> 4) & 15, y = c >> 8;
        if (y === 0) faces |= 1;
        if (y === 15) faces |= 2;
        if (z === 0) faces |= 4;
        if (z === 15) faces |= 8;
        if (x === 0) faces |= 16;
        if (x === 15) faces |= 32;
        if (x > 0 && !visited[c - 1]) { visited[c - 1] = 1; stack[sp++] = c - 1; }
        if (x < 15 && !visited[c + 1]) { visited[c + 1] = 1; stack[sp++] = c + 1; }
        if (z > 0 && !visited[c - 16]) { visited[c - 16] = 1; stack[sp++] = c - 16; }
        if (z < 15 && !visited[c + 16]) { visited[c + 16] = 1; stack[sp++] = c + 16; }
        if (y > 0 && !visited[c - 256]) { visited[c - 256] = 1; stack[sp++] = c - 256; }
        if (y < 15 && !visited[c + 256]) { visited[c + 256] = 1; stack[sp++] = c + 256; }
      }
      for (let f = 0; f < 6; f++) if (faces & (1 << f)) vis[f]! |= faces;
    }
    return vis;
  }

  private tintFor(input: MeshInput, x: number, z: number, st: number, bid: number): number {
    switch (TINT_KIND[bid]) {
      case TINT_GRASS: return input.tints[z * 16 + x]!;
      case TINT_FOLIAGE: return input.tints[256 + z * 16 + x]!;
      case TINT_WATER: return input.tints[512 + z * 16 + x]!;
      case TINT_CONST: return TINT_CONST_COLOR[bid]!;
      case TINT_REDSTONE: return redstoneColor(this.redstonePower[st]!);
      case TINT_STEM: return stemColor(this.stemAge[st]!);
    }
    return 0xffffff;
  }

  // per-vertex light/ao scratch
  private readonly vSky = new Uint8Array(4);
  private readonly vBlk = new Uint8Array(4);
  private readonly vAo = new Uint8Array(4);

  private emitQuad(input: MeshInput, x: number, y: number, z: number, st: number, bid: number, q: BakedQuad, ox: number, oy: number, oz: number): void {
    const { states, light } = input;
    const d = q.dir;
    // base cell for lighting: the neighbour in front of boundary faces, else the block itself
    let bx = x, by = y, bz = z;
    if (q.onBoundary) {
      bx += DX[d]!;
      by += DY[d]!;
      bz += DZ[d]!;
    }
    const bi = padIndex(bx, by, bz);
    const baseLight = light[bi]!;
    const smooth = this.opts.smoothLighting && q.ao;
    for (let v = 0; v < 4; v++) {
      if (!smooth) {
        this.vSky[v] = (baseLight >> 4) * 2;
        this.vBlk[v] = (baseLight & 15) * 2;
        this.vAo[v] = 0;
        continue;
      }
      const [ta, tb] = TAN[d]!;
      const pa = q.pos[v * 3 + ta]!, pb = q.pos[v * 3 + tb]!;
      const sa = pa < 0.5 ? -1 : 1, sb = pb < 0.5 ? -1 : 1;
      const o1 = [0, 0, 0], o2 = [0, 0, 0];
      o1[ta] = sa;
      o2[tb] = sb;
      const i1 = bi + o1[0]! + o1[1]! * P * P + o1[2]! * P;
      const i2 = bi + o2[0]! + o2[1]! * P * P + o2[2]! * P;
      const ic = i1 + o2[0]! + o2[1]! * P * P + o2[2]! * P;
      const s1 = states[i1]!, s2 = states[i2]!;
      const occ1 = FULL_COLLISION[s1] === 1, occ2 = FULL_COLLISION[s2] === 1;
      let lc: number, occC: boolean;
      if (occ1 && occ2) {
        lc = light[i1]!;
        occC = true;
      } else {
        lc = light[ic]!;
        occC = FULL_COLLISION[states[ic]!] === 1;
      }
      const l1 = light[i1]!, l2 = light[i2]!;
      const c0s = baseLight >> 4, c0b = baseLight & 15;
      const sky = c0s + ((l1 >> 4) || c0s) + ((l2 >> 4) || c0s) + ((lc >> 4) || c0s);
      const blk = c0b + ((l1 & 15) || c0b) + ((l2 & 15) || c0b) + ((lc & 15) || c0b);
      this.vSky[v] = Math.min(30, Math.round(sky / 2));
      this.vBlk[v] = Math.min(30, Math.round(blk / 2));
      this.vAo[v] = (occ1 ? 1 : 0) + (occ2 ? 1 : 0) + (occC ? 1 : 0);
    }
    const tint = q.tint >= 0 ? this.tintFor(input, x, z, st, bid) : 0xffffff;
    const shade = q.shade ? d : 6;
    const a2 = (tint & 0xffffff) | (shade << 24);
    const buf = this.bufs[q.pass]!;
    const ex = x + ox, ey = y + oy, ez = z + oz;
    for (let v = 0; v < 4; v++) {
      const px = Math.round((ex + q.pos[v * 3]!) * 32) + 256;
      const py = Math.round((ey + q.pos[v * 3 + 1]!) * 32) + 256;
      const pz = Math.round((ez + q.pos[v * 3 + 2]!) * 32) + 256;
      const a0 = px | (py << 10) | (pz << 20) | (this.vAo[v]! << 30);
      const u = Math.round(q.uv[v * 2]!), w = Math.round(q.uv[v * 2 + 1]!);
      const a1 = u | (w << 5) | (q.layer << 10) | (this.vSky[v]! << 22) | (this.vBlk[v]! << 27);
      buf.push(a0, a1, a2);
    }
    if (q.pass === PASS_TRANSLUCENT) {
      this.centers.push(
        ex + (q.pos[0]! + q.pos[6]!) / 2,
        ey + (q.pos[1]! + q.pos[7]!) / 2,
        ez + (q.pos[2]! + q.pos[8]!) / 2,
      );
    }
  }

  // ------------------------------------------------------------------ fluids
  /** Section-local state reader over the padded snapshot (for the shared fluid flow code). */
  private fluidInput: MeshInput | null = null;
  private readonly fluidReader = {
    getState: (x: number, y: number, z: number): number => this.fluidInput!.states[padIndex(x, y, z)]!,
  };
  private readonly flowVec: [number, number, number] = [0, 0, 0];

  /**
   * LiquidBlockRenderer.getWaterHeight (1.17.1): the surface height at the corner shared by the
   * cell (x, z) and its −x / −z neighbours. 1 if any of them has the fluid above; fluids count
   * ×10 when at least 0.8 high, solid blocks are skipped, anything else counts as 0.
   */
  private cornerHeight(input: MeshInput, kind: number, x: number, y: number, z: number): number {
    const states = input.states;
    let sum = 0, n = 0;
    for (let j = 0; j < 4; j++) {
      const px = x - (j & 1), pz = z - ((j >> 1) & 1);
      if (FLUID[states[padIndex(px, y + 1, pz)]!] === kind) return 1;
      const s = states[padIndex(px, y, pz)]!;
      if (FLUID[s] === kind) {
        const lvl = FLUID_LEVEL[s]!;
        const g = (lvl === 0 || lvl >= 8 ? 8 : 8 - lvl) / 9;
        if (g >= 0.8) {
          sum += g * 10;
          n += 10;
        } else {
          sum += g;
          n++;
        }
      } else if (MATERIAL_SOLID[s] !== 1) n++;
    }
    return sum / n;
  }

  private fluid(input: MeshInput, x: number, y: number, z: number, st: number): void {
    const kind = FLUID[st]!;
    const { states, light } = input;
    const water = kind === 1;
    const tint = water ? input.tints[512 + z * 16 + x]! : 0xffffff;
    const stillTex = water ? this.fluids.waterStill : this.fluids.lavaStill;
    const flowTex = water ? this.fluids.waterFlow : this.fluids.lavaFlow;
    const pass = water ? PASS_TRANSLUCENT : PASS_SOLID;
    const buf = this.bufs[pass]!;
    const above = states[padIndex(x, y + 1, z)]!;
    const h00 = this.cornerHeight(input, kind, x, y, z); // NW
    const h10 = this.cornerHeight(input, kind, x + 1, y, z); // NE
    const h11 = this.cornerHeight(input, kind, x + 1, y, z + 1); // SE
    const h01 = this.cornerHeight(input, kind, x, y, z + 1); // SW
    const lAt = (i: number) => light[i]!;
    const emit = (verts: number[], uvs: number[], l: number, shade: number, tex: number) => {
      const sky = (l >> 4) * 2, blk = Math.max(l & 15, water ? 0 : 15) * 2;
      for (let v = 0; v < 4; v++) {
        const px = Math.round((x + verts[v * 3]!) * 32) + 256;
        const py = Math.round((y + verts[v * 3 + 1]!) * 32) + 256;
        const pz = Math.round((z + verts[v * 3 + 2]!) * 32) + 256;
        const a0 = px | (py << 10) | (pz << 20);
        const u = Math.max(0, Math.min(16, Math.round(uvs[v * 2]!))), w = Math.max(0, Math.min(16, Math.round(uvs[v * 2 + 1]!)));
        const a1 = u | (w << 5) | (tex << 10) | (sky << 22) | (blk << 27);
        buf.push(a0, a1, (tint & 0xffffff) | (shade << 24));
      }
      if (pass === PASS_TRANSLUCENT) {
        this.centers.push(x + (verts[0]! + verts[6]!) / 2, y + (verts[1]! + verts[7]!) / 2, z + (verts[2]! + verts[8]!) / 2);
      }
    };
    // top surface
    if (FLUID[above] !== kind && !((this.bake.occludes[above]! >> 0) & 1 && Math.min(h00, h10, h11, h01) >= 1)) {
      const hm = 0.001;
      const t00 = h00 - hm, t10 = h10 - hm, t11 = h11 - hm, t01 = h01 - hm;
      const lt = Math.max(lAt(padIndex(x, y, z)), lAt(padIndex(x, y + 1, z)));
      // flow direction: FluidState.getFlow
      this.fluidInput = input;
      const flow = getFlow(this.fluidReader, x, y, z, this.flowVec);
      const fx = flow[0], fz = flow[2];
      let tex = stillTex;
      let uv = [0, 0, 0, 16, 16, 16, 16, 0];
      if (Math.abs(fx) > 1e-4 || Math.abs(fz) > 1e-4) {
        tex = flowTex;
        const ang = Math.atan2(fz, fx) - Math.PI / 2;
        const s = Math.sin(ang) * 4, c = Math.cos(ang) * 4;
        // sample the centre half of the flow texture, rotated to the flow direction
        uv = [8 + (-c - s), 8 + (-c + s), 8 + (-c + s), 8 + (c + s), 8 + (c + s), 8 + (c - s), 8 + (c - s), 8 + (-c - s)];
      }
      const verts = [0, t00, 0, 0, t01, 1, 1, t11, 1, 1, t10, 0];
      emit(verts, uv, lt, 1, tex);
      // underside of the surface, visible from below
      if (!((this.bake.occludes[above]! >> 0) & 1)) {
        emit([1, t10, 0, 1, t11, 1, 0, t01, 1, 0, t00, 0], [uv[6]!, uv[7]!, uv[4]!, uv[5]!, uv[2]!, uv[3]!, uv[0]!, uv[1]!], lt, 0, tex);
      }
    }
    // bottom
    const below = states[padIndex(x, y - 1, z)]!;
    if (FLUID[below] !== kind && !((this.bake.occludes[below]! >> 1) & 1)) {
      emit([0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1], [0, 0, 0, 16, 16, 16, 16, 0], lAt(padIndex(x, y - 1, z)), 0, stillTex);
    }
    // sides
    const sides: [number, number, number, number, number, number][] = [
      // face, dx, dz, corner heights (a,b) along the face from left to right as seen from outside
      [2, 0, -1, h10, h00, 0],
      [3, 0, 1, h01, h11, 0],
      [4, -1, 0, h00, h01, 0],
      [5, 1, 0, h11, h10, 0],
    ];
    for (const [face, dx, dz, ha, hb] of sides) {
      const ni = padIndex(x + dx, y, z + dz);
      const n = states[ni]!;
      if (FLUID[n] === kind) continue;
      if ((this.bake.occludes[n]! >> OPP[face]!) & 1) continue;
      let verts: number[];
      switch (face) {
        case 2: verts = [1, ha, 0, 1, 0, 0, 0, 0, 0, 0, hb, 0]; break;
        case 3: verts = [0, ha, 1, 0, 0, 1, 1, 0, 1, 1, hb, 1]; break;
        case 4: verts = [0, ha, 0, 0, 0, 0, 0, 0, 1, 0, hb, 1]; break;
        default: verts = [1, ha, 1, 1, 0, 1, 1, 0, 0, 1, hb, 0]; break;
      }
      const uv = [0, (1 - ha) * 8, 0, 8, 8, 8, 8, (1 - hb) * 8];
      const sh = face < 4 ? 2 : 4;
      emit(verts, uv, lAt(ni), sh, flowTex);
      // inside view of the side (from within the fluid)
      emit([verts[9]!, verts[10]!, verts[11]!, verts[6]!, verts[7]!, verts[8]!, verts[3]!, verts[4]!, verts[5]!, verts[0]!, verts[1]!, verts[2]!], [uv[6]!, uv[7]!, uv[4]!, uv[5]!, uv[2]!, uv[3]!, uv[0]!, uv[1]!], lAt(ni), sh, flowTex);
    }
  }
}

/** Cheap deterministic position hash for picking model variants. */
export function posHash(x: number, y: number, z: number): number {
  let h = Math.imul(x, 3129871) ^ Math.imul(z, 116129781) ^ y;
  h = Math.imul(h, h) * 42317861 + h * 11;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Vanilla plant offset (BlockBehaviour.getOffset with Mth.getSeed): x/z in ±0.25,
 * y in −0.2..0. Exact 64-bit arithmetic via BigInt; cached per column.
 */
const offsetCache = new Map<string, [number, number, number]>();
export function plantOffset(x: number, z: number): [number, number, number] {
  const key = `${x},${z}`;
  let o = offsetCache.get(key);
  if (o) return o;
  let l = BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n) ^ 0n;
  l = BigInt.asIntN(64, l * l * 42317861n + l * 11n);
  const seed = l >> 16n;
  const bits = (n: bigint) => Number(BigInt.asUintN(64, seed >> n) & 15n);
  o = [((bits(0n) / 15) - 0.5) * 0.5, ((bits(8n) / 15) - 0.5) * 0.5, ((bits(4n) / 15) - 1) * 0.2];
  if (offsetCache.size > 100000) offsetCache.clear();
  offsetCache.set(key, o);
  return o;
}

export { PASS_SOLID, PASS_CUTOUT, PASS_TRANSLUCENT };
