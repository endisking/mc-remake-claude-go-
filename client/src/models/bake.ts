/**
 * Model baking: resolves every block state to a list of quads ready for meshing.
 * Runs at startup in the main thread (items, particles) and in each mesher worker.
 */
import { BLOCKS } from '@shared/data';
import { propsOf, type Props } from '@shared/world/blockstate';
import { BLOCK_STATE_COUNT } from '@shared/data';
import { FACE_NAMES, type BlockModel, type BlockStateDef, type Condition, type FaceName, type ModelElement, type ModelRef } from './format';
import { MODELS } from './library';

/** Render pass a quad belongs to. */
export const PASS_SOLID = 0;
export const PASS_CUTOUT = 1;
export const PASS_TRANSLUCENT = 2;

export interface TextureInfo {
  layer: number;
  cutout: boolean;
  translucent: boolean;
  /** Leaves: rendered opaque (solid pass, alpha ignored) with Fast graphics. */
  leaves?: boolean;
}

export interface BakeOptions {
  /** Fancy graphics: see-through leaves. */
  fancy: boolean;
}

export interface BakedQuad {
  /** 4 corners × xyz in block units (0..1 within the block). Order: TL, BL, BR, TR. */
  pos: Float32Array;
  /** 4 corners × uv in texture pixels (0..16). */
  uv: Float32Array;
  layer: number;
  /** Face direction (0..5) used to cull against neighbours, or -1. */
  cull: number;
  /** Nearest axis direction of the quad normal (0..5), for shading and light sampling. */
  dir: number;
  /** Apply directional shading. */
  shade: boolean;
  /** Quad lies on the block boundary in its direction (enables per-vertex smooth light). */
  onBoundary: boolean;
  /** Covers the full 1×1 face (used for occlusion). */
  fullFace: boolean;
  tint: number;
  pass: number;
  ao: boolean;
}

export interface BakedModel {
  quads: BakedQuad[];
}

export interface BakedState {
  /** Weighted alternatives (picked per position); usually a single model. */
  choices: BakedModel[];
  weights: number[];
  totalWeight: number;
  offset: 0 | 1 | 2;
}

// ------------------------------------------------------------------ model resolution
function resolveModel(name: string, models: Record<string, BlockModel>): { elements: ModelElement[]; textures: Record<string, string>; ao: boolean } {
  const chain: BlockModel[] = [];
  let cur: BlockModel | undefined = models[name];
  if (!cur) throw new Error(`unknown model ${name}`);
  while (cur) {
    chain.push(cur);
    cur = cur.parent ? models[cur.parent] : undefined;
  }
  const textures: Record<string, string> = {};
  let elements: ModelElement[] = [];
  let ao = true;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i]!;
    if (m.textures) Object.assign(textures, m.textures);
    if (m.elements) elements = m.elements;
    if (m.ao !== undefined) ao = m.ao;
  }
  return { elements, textures, ao };
}

function resolveTexture(ref: string, textures: Record<string, string>): string {
  let r = ref;
  for (let i = 0; i < 10 && r.startsWith('#'); i++) {
    const next = textures[r.slice(1)];
    if (next === undefined) return 'missing';
    r = next;
  }
  return r.startsWith('#') ? 'missing' : r;
}

// ------------------------------------------------------------------ geometry helpers
type V3 = [number, number, number];

function faceCorners(f: FaceName, a: V3, b: V3): V3[] {
  const [x1, y1, z1] = a, [x2, y2, z2] = b;
  switch (f) {
    case 'up': return [[x1, y2, z1], [x1, y2, z2], [x2, y2, z2], [x2, y2, z1]];
    case 'down': return [[x1, y1, z2], [x1, y1, z1], [x2, y1, z1], [x2, y1, z2]];
    case 'north': return [[x2, y2, z1], [x2, y1, z1], [x1, y1, z1], [x1, y2, z1]];
    case 'south': return [[x1, y2, z2], [x1, y1, z2], [x2, y1, z2], [x2, y2, z2]];
    case 'west': return [[x1, y2, z1], [x1, y1, z1], [x1, y1, z2], [x1, y2, z2]];
    case 'east': return [[x2, y2, z2], [x2, y1, z2], [x2, y1, z1], [x2, y2, z1]];
  }
}

function defaultUV(f: FaceName, a: V3, b: V3): [number, number, number, number] {
  const [x1, y1, z1] = a, [x2, y2, z2] = b;
  switch (f) {
    case 'down': return [x1, 16 - z2, x2, 16 - z1];
    case 'up': return [x1, z1, x2, z2];
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 'south': return [x1, 16 - y2, x2, 16 - y1];
    case 'west': return [z1, 16 - y2, z2, 16 - y1];
    case 'east': return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
  }
}

const DIR_VEC: V3[] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

function nearestDir(v: V3): number {
  let best = 0, bd = -Infinity;
  for (let i = 0; i < 6; i++) {
    const d = DIR_VEC[i]!;
    const dot = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    if (dot > bd) {
      bd = dot;
      best = i;
    }
  }
  return best;
}

function rotateElementPoint(p: V3, rot: NonNullable<ModelElement['rotation']>): V3 {
  const rad = (rot.angle * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const [ox, oy, oz] = rot.origin;
  let x = p[0] - ox, y = p[1] - oy, z = p[2] - oz;
  let sx = 1, sy = 1, sz = 1;
  if (rot.rescale) {
    const k = 1 / Math.cos(Math.abs(rad) > 0 ? Math.abs(rad) : 0);
    if (rot.axis === 'x') { sy = k; sz = k; }
    else if (rot.axis === 'y') { sx = k; sz = k; }
    else { sx = k; sy = k; }
  }
  let nx = x, ny = y, nz = z;
  if (rot.axis === 'y') { nx = x * c + z * s; nz = -x * s + z * c; }
  else if (rot.axis === 'x') { ny = y * c - z * s; nz = y * s + z * c; }
  else { nx = x * c - y * s; ny = x * s + y * c; }
  return [nx * sx + ox, ny * sy + oy, nz * sz + oz];
}

/** Blockstate rotation: X (multiples of 90, north→down for 90) then Y (clockwise from above). */
function rotateStatePoint(p: V3, xr: number, yr: number): V3 {
  let x = p[0] - 8, y = p[1] - 8, z = p[2] - 8;
  for (let i = 0; i < xr / 90; i++) [y, z] = [z, -y];
  for (let i = 0; i < yr / 90; i++) [x, z] = [-z, x];
  return [x + 8, y + 8, z + 8];
}

function rotateVec(v: V3, xr: number, yr: number): V3 {
  let [x, y, z] = v;
  for (let i = 0; i < xr / 90; i++) [y, z] = [z, -y];
  for (let i = 0; i < yr / 90; i++) [x, z] = [-z, x];
  return [x, y, z];
}

const EPS = 1e-4;

export function bakeModelRef(ref: ModelRef, models: Record<string, BlockModel>, textures: Map<string, TextureInfo>, opts: BakeOptions = { fancy: true }): BakedModel {
  const { elements, textures: vars, ao } = resolveModel(ref.model, models);
  const xr = ref.x ?? 0, yr = ref.y ?? 0;
  const quads: BakedQuad[] = [];
  for (const el of elements) {
    for (const fname of FACE_NAMES) {
      const face = el.faces[fname];
      if (!face) continue;
      const texName = resolveTexture(face.texture, vars);
      const tex = textures.get(texName) ?? textures.get('missing')!;
      // geometry: element rotation, then state rotation
      let pts = faceCorners(fname, el.from, el.to);
      if (el.rotation && el.rotation.angle !== 0) pts = pts.map((p) => rotateElementPoint(p, el.rotation!));
      pts = pts.map((p) => rotateStatePoint(p, xr, yr));
      // uv
      let uvRect = face.uv ?? defaultUV(fname, el.from, el.to);
      const fdir = FACE_NAMES.indexOf(fname);
      let normal = DIR_VEC[fdir]!;
      if (el.rotation && el.rotation.angle !== 0) {
        const o = rotateElementPoint([0, 0, 0], { ...el.rotation, origin: [0, 0, 0], rescale: false });
        const n = rotateElementPoint(normal, { ...el.rotation, origin: [0, 0, 0], rescale: false });
        normal = [n[0] - o[0], n[1] - o[1], n[2] - o[2]];
      }
      normal = rotateVec(normal, xr, yr);
      const dir = nearestDir(normal);
      const axisAligned = Math.abs(Math.abs(normal[0]) + Math.abs(normal[1]) + Math.abs(normal[2]) - 1) < 1e-3;
      if (ref.uvlock && axisAligned && (xr !== 0 || yr !== 0)) {
        // world-aligned UVs: project the rotated quad's bounds
        const mn: V3 = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.min(...pts.map((p) => p[2]))];
        const mx: V3 = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[2]))];
        uvRect = defaultUV(FACE_NAMES[dir]!, mn, mx);
        // re-derive the corner order for the rotated face so UVs map upright
        pts = faceCorners(FACE_NAMES[dir]!, mn, mx);
      }
      const [u1, v1, u2, v2] = uvRect;
      const uvc: [number, number][] = [[u1, v1], [u1, v2], [u2, v2], [u2, v1]];
      const rsteps = ((face.rotation ?? 0) / 90) | 0;
      const uv = new Float32Array(8);
      for (let i = 0; i < 4; i++) {
        const c = uvc[(i + rsteps) % 4]!;
        uv[i * 2] = c[0];
        uv[i * 2 + 1] = c[1];
      }
      const pos = new Float32Array(12);
      for (let i = 0; i < 4; i++) {
        pos[i * 3] = pts[i]![0] / 16;
        pos[i * 3 + 1] = pts[i]![1] / 16;
        pos[i * 3 + 2] = pts[i]![2] / 16;
      }
      let cull = -1;
      if (face.cull) cull = nearestDir(rotateVec(DIR_VEC[FACE_NAMES.indexOf(face.cull)]!, xr, yr));
      // boundary / full-face checks (axis aligned only)
      let onBoundary = false, fullFace = false;
      if (axisAligned) {
        const axis = dir < 2 ? 1 : dir < 4 ? 2 : 0;
        const coord = pos[axis]!;
        const positive = dir % 2 === 1;
        onBoundary = positive ? Math.abs(coord - 1) < EPS : Math.abs(coord) < EPS;
        if (onBoundary) {
          const a1 = axis === 0 ? 1 : 0, a2 = axis === 2 ? 1 : 2;
          const ma = [0, 3, 6, 9].map((i) => pos[i + a1]!), mb = [0, 3, 6, 9].map((i) => pos[i + a2]!);
          fullFace = Math.min(...ma) < EPS && Math.max(...ma) > 1 - EPS && Math.min(...mb) < EPS && Math.max(...mb) > 1 - EPS;
        }
      }
      quads.push({
        pos, uv, layer: tex.layer, cull, dir, shade: el.shade !== false, onBoundary, fullFace,
        tint: face.tint ?? -1,
        pass: tex.translucent ? PASS_TRANSLUCENT : tex.cutout && !(tex.leaves && !opts.fancy) ? PASS_CUTOUT : PASS_SOLID,
        ao,
      });
    }
  }
  return { quads };
}

// ------------------------------------------------------------------ blockstate matching
function matchesKey(key: string, props: Props): boolean {
  if (key === '' || key === 'normal') return true;
  for (const kv of key.split(',')) {
    const [k, v] = kv.split('=');
    if (String(props[k!]) !== v) return false;
  }
  return true;
}

function matchesCondition(c: Condition, props: Props): boolean {
  if ('OR' in c && Array.isArray((c as { OR: Condition[] }).OR)) return (c as { OR: Condition[] }).OR.some((x) => matchesCondition(x, props));
  if ('AND' in c && Array.isArray((c as { AND: Condition[] }).AND)) return (c as { AND: Condition[] }).AND.every((x) => matchesCondition(x, props));
  for (const [k, allowed] of Object.entries(c as Record<string, string>)) {
    const v = String(props[k]);
    const neg = allowed.startsWith('!');
    const opts = (neg ? allowed.slice(1) : allowed).split('|');
    if (opts.includes(v) === neg) return false;
  }
  return true;
}

export interface BakeResult {
  states: BakedState[];
  /** Per state, bitmask of faces fully covered by solid (opaque) geometry. */
  occludes: Uint8Array;
  /** Per state: 1 if the model is a plain full opaque cube (fast path). */
  fullOpaque: Uint8Array;
}

export function bakeAll(
  defs: (blockName: string) => BlockStateDef,
  textures: Map<string, TextureInfo>,
  opts: BakeOptions = { fancy: true },
  models: Record<string, BlockModel> = MODELS,
): BakeResult {
  const cache = new Map<string, BakedModel>();
  const bakeRef = (r: ModelRef) => {
    const key = `${r.model}|${r.x ?? 0}|${r.y ?? 0}|${r.uvlock ? 1 : 0}`;
    let m = cache.get(key);
    if (!m) {
      m = bakeModelRef(r, models, textures, opts);
      cache.set(key, m);
    }
    return m;
  };
  const states: BakedState[] = new Array(BLOCK_STATE_COUNT);
  const occludes = new Uint8Array(BLOCK_STATE_COUNT);
  const fullOpaque = new Uint8Array(BLOCK_STATE_COUNT);
  const empty: BakedState = { choices: [{ quads: [] }], weights: [1], totalWeight: 1, offset: 0 };
  for (const b of BLOCKS) {
    let def: BlockStateDef;
    try {
      def = defs(b.name);
    } catch {
      def = { variants: { '': { model: 'missing' } } };
    }
    for (let s = b.minStateId; s <= b.maxStateId; s++) {
      if (b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air') {
        states[s] = empty;
        continue;
      }
      const props = propsOf(s);
      let refs: ModelRef[] = [];
      let alternatives: ModelRef[] | null = null;
      if (def.variants) {
        for (const [key, v] of Object.entries(def.variants)) {
          if (matchesKey(key, props)) {
            if (Array.isArray(v)) alternatives = v;
            else refs = [v];
            break;
          }
        }
      }
      if (def.multipart) {
        for (const part of def.multipart) {
          if (!part.when || matchesCondition(part.when, props)) {
            refs.push(...(Array.isArray(part.apply) ? [part.apply[0]!] : [part.apply]));
          }
        }
      }
      let baked: BakedState;
      if (alternatives && alternatives.length > 0) {
        const choices = alternatives.map(bakeRef);
        const weights = alternatives.map((a) => a.weight ?? 1);
        baked = { choices, weights, totalWeight: weights.reduce((a, b) => a + b, 0), offset: 0 };
      } else {
        const merged: BakedModel = refs.length === 1 ? bakeRef(refs[0]!) : { quads: refs.flatMap((r) => bakeRef(r).quads) };
        baked = { choices: [merged], weights: [1], totalWeight: 1, offset: 0 };
      }
      baked.offset = def.offset === 'xz' ? 1 : def.offset === 'xyz' ? 2 : 0;
      states[s] = baked;
      // occlusion: faces covered by solid full-face quads (first choice decides)
      let occ = 0;
      const q0 = baked.choices[0]!.quads;
      for (const q of q0) if (q.fullFace && q.pass === PASS_SOLID && q.cull === q.dir) occ |= 1 << q.dir;
      occludes[s] = occ;
      fullOpaque[s] = occ === 63 && q0.length === 6 && q0.every((q) => q.pass === PASS_SOLID && q.fullFace) && baked.choices.length === 1 && baked.offset === 0 ? 1 : 0;
    }
  }
  return { states, occludes, fullOpaque };
}
