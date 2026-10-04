/**
 * TreeFeature (vanilla 1.17.1): trunk placers, foliage placers, tree decorators and the leaf
 * distance update, driven by the configured tree JSON.
 *
 * Decorators see the trunk and foliage positions in Java HashSet iteration order, stably sorted by
 * y (TreeFeature.place), which decides where vines, cocoa and hives go; javaSetOrder reproduces it.
 */
import { JavaRandom } from '../../util/random';
import { mthSin, mthCos } from '../../util/mth';
import { stateOf, blockNameOf, getProp, withProp } from '../../world/blockstate';
import { IS_AIR } from '../../world/blockinfo';
import type { GenLevel } from './level';
import { intProvider, stateProvider, inTag, type IntProvider, type StateProvider } from './providers';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const f = Math.fround;

// ------------------------------------------------------------------ positions in Java HashSet order
/** Vec3i.hashCode */
function posHash(x: number, y: number, z: number): number {
  return (Math.imul(y + Math.imul(z, 31), 31) + x) | 0;
}
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** A HashSet<BlockPos>: keeps insertion order, and yields Java's iteration order on request. */
export class PosSet {
  readonly keys = new Set<string>();
  readonly list: [number, number, number][] = [];
  add(x: number, y: number, z: number): void {
    const k = key(x, y, z);
    if (this.keys.has(k)) return;
    this.keys.add(k);
    this.list.push([x, y, z]);
  }
  has(x: number, y: number, z: number): boolean {
    return this.keys.has(key(x, y, z));
  }
  get size(): number {
    return this.list.length;
  }
  /** HashMap iteration: by bucket (hash ^ hash >>> 16) & (capacity - 1), insertion order within a bucket. */
  javaOrder(): [number, number, number][] {
    let cap = 16;
    while (this.list.length > cap * 0.75) cap *= 2;
    const bucket = (p: [number, number, number]) => {
      const h = posHash(p[0], p[1], p[2]);
      return (h ^ (h >>> 16)) & (cap - 1);
    };
    return this.list.map((p, i) => ({ p, b: bucket(p), i })).sort((a, b) => a.b - b.b || a.i - b.i).map((e) => e.p);
  }
}

// ------------------------------------------------------------------ tree context
const LEAVES_TAG = 'leaves', LOGS_TAG = 'logs';
const REPLACEABLE_PLANT = new Set(['grass', 'fern', 'dead_bush', 'tall_grass', 'large_fern', 'vine', 'glow_lichen', 'hanging_roots']);

interface Tree {
  lv: GenLevel;
  r: JavaRandom;
  cfg: TreeConfig;
  logs: PosSet;
  leaves: PosSet;
  decorations: PosSet;
}

/** TreeFeature.validTreePos: air, leaves, replaceable plants or water. */
function validTreePos(lv: GenLevel, x: number, y: number, z: number): boolean {
  const s = lv.getState(x, y, z);
  return IS_AIR[s] === 1 || inTag(LEAVES_TAG, s) || REPLACEABLE_PLANT.has(blockNameOf(s)) || blockNameOf(s) === 'water';
}
/** TreeFeature.isFree: a valid tree position or a log. */
function isFree(lv: GenLevel, x: number, y: number, z: number): boolean {
  return validTreePos(lv, x, y, z) || inTag(LOGS_TAG, lv.getState(x, y, z));
}

function setTrunk(t: Tree, x: number, y: number, z: number, s: number): void {
  t.logs.add(x, y, z);
  t.lv.setState(x, y, z, s);
}
function setFoliage(t: Tree, x: number, y: number, z: number, s: number): void {
  t.leaves.add(x, y, z);
  t.lv.setState(x, y, z, s);
}
function setDecoration(t: Tree, x: number, y: number, z: number, s: number): void {
  t.decorations.add(x, y, z);
  t.lv.setState(x, y, z, s);
}

/** TrunkPlacer.placeLog */
function placeLog(t: Tree, x: number, y: number, z: number, axis?: string): boolean {
  if (!validTreePos(t.lv, x, y, z)) return false;
  let s = t.cfg.trunk(t.r, x, y, z);
  if (axis) s = withProp(s, 'axis', axis);
  setTrunk(t, x, y, z, s);
  return true;
}

/** TrunkPlacer.setDirtAt: grass and mycelium under a trunk become dirt (forced for some trees). */
function setDirtAt(t: Tree, x: number, y: number, z: number): void {
  const s = t.lv.getState(x, y, z);
  const isDirt = inTag('dirt', s) && blockNameOf(s) !== 'grass_block' && blockNameOf(s) !== 'mycelium';
  if (t.cfg.forceDirt || !isDirt) setTrunk(t, x, y, z, t.cfg.dirt(t.r, x, y, z));
}

interface Attachment {
  x: number;
  y: number;
  z: number;
  radiusOffset: number;
  doubleTrunk: boolean;
}

// ------------------------------------------------------------------ trunk placers
type TrunkPlacer = (t: Tree, height: number, x: number, y: number, z: number) => Attachment[];
const HORIZONTAL: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // north, east, south, west

function trunkPlacer(j: J): { height: (r: JavaRandom) => number; place: TrunkPlacer } {
  const height = (r: JavaRandom) => j.base_height + r.nextInt(j.height_rand_a + 1) + r.nextInt(j.height_rand_b + 1);
  switch (j.type) {
    case 'minecraft:straight_trunk_placer':
      return {
        height, place: (t, h, x, y, z) => {
          setDirtAt(t, x, y - 1, z);
          for (let i = 0; i < h; i++) placeLog(t, x, y + i, z);
          return [{ x, y: y + h, z, radiusOffset: 0, doubleTrunk: false }];
        },
      };
    case 'minecraft:forking_trunk_placer':
      return {
        height, place: (t, h, x, y, z) => {
          const r = t.r;
          setDirtAt(t, x, y - 1, z);
          const out: Attachment[] = [];
          const dir = HORIZONTAL[r.nextInt(4)]!;
          const i = h - r.nextInt(4) - 1;
          let j2 = 3 - r.nextInt(3);
          let k = x, l = z, top = 0;
          for (let n = 0; n < h; n++) {
            const o = y + n;
            if (n >= i && j2 > 0) {
              k += dir[0];
              l += dir[1];
              j2--;
            }
            if (placeLog(t, k, o, l)) top = o + 1;
          }
          out.push({ x: k, y: top, z: l, radiusOffset: 1, doubleTrunk: false });
          k = x;
          l = z;
          const dir2 = HORIZONTAL[r.nextInt(4)]!;
          if (dir2 !== dir) {
            const o = i - r.nextInt(2) - 1;
            let p = 1 + r.nextInt(3);
            top = 0;
            for (let q = o; q < h && p > 0; q++, p--) {
              if (q < 1) continue;
              const ry = y + q;
              k += dir2[0];
              l += dir2[1];
              if (placeLog(t, k, ry, l)) top = ry + 1;
            }
            if (top > 1) out.push({ x: k, y: top, z: l, radiusOffset: 0, doubleTrunk: false });
          }
          return out;
        },
      };
    case 'minecraft:giant_trunk_placer':
      return { height, place: giantTrunk };
    case 'minecraft:mega_jungle_trunk_placer':
      return {
        height, place: (t, h, x, y, z) => {
          const out = giantTrunk(t, h, x, y, z);
          const r = t.r;
          for (let i = h - 2 - r.nextInt(4); i > Math.trunc(h / 2); i -= 2 + r.nextInt(4)) {
            const a = f(r.nextFloat() * f(Math.PI * 2));
            let jx = 0, kz = 0;
            for (let l = 0; l < 5; l++) {
              jx = Math.trunc(f(1.5 + f(mthCos(a) * l)));
              kz = Math.trunc(f(1.5 + f(mthSin(a) * l)));
              placeLog(t, x + jx, y + i - 3 + Math.trunc(l / 2), z + kz);
            }
            out.push({ x: x + jx, y: y + i, z: z + kz, radiusOffset: -2, doubleTrunk: false });
          }
          return out;
        },
      };
    case 'minecraft:dark_oak_trunk_placer':
      return {
        height, place: (t, h, x, y, z) => {
          const r = t.r;
          const out: Attachment[] = [];
          setDirtAt(t, x, y - 1, z);
          setDirtAt(t, x + 1, y - 1, z);
          setDirtAt(t, x, y - 1, z + 1);
          setDirtAt(t, x + 1, y - 1, z + 1);
          const dir = HORIZONTAL[r.nextInt(4)]!;
          const i = h - r.nextInt(4);
          let j2 = 2 - r.nextInt(3);
          let n = x, o = z;
          const p = y + h - 1;
          for (let q = 0; q < h; q++) {
            if (q >= i && j2 > 0) {
              n += dir[0];
              o += dir[1];
              j2--;
            }
            const ry = y + q;
            const s = t.lv.getState(n, ry, o);
            if (IS_AIR[s] === 1 || inTag(LEAVES_TAG, s)) {
              placeLog(t, n, ry, o);
              placeLog(t, n + 1, ry, o);
              placeLog(t, n, ry, o + 1);
              placeLog(t, n + 1, ry, o + 1);
            }
          }
          out.push({ x: n, y: p, z: o, radiusOffset: 0, doubleTrunk: true });
          for (let q = -1; q <= 2; q++)
            for (let rr = -1; rr <= 2; rr++) {
              if ((q >= 0 && q <= 1 && rr >= 0 && rr <= 1) || r.nextInt(3) > 0) continue;
              const s = r.nextInt(3) + 2;
              for (let tt = 0; tt < s; tt++) placeLog(t, x + q, p - tt - 1, z + rr);
              out.push({ x: n + q, y: p, z: o + rr, radiusOffset: 0, doubleTrunk: false });
            }
          return out;
        },
      };
    case 'minecraft:fancy_trunk_placer':
      return { height, place: fancyTrunk };
    default:
      throw new Error(`trunk placer ${j.type}`);
  }
}

/** GiantTrunkPlacer: a 2×2 trunk. */
function giantTrunk(t: Tree, h: number, x: number, y: number, z: number): Attachment[] {
  setDirtAt(t, x, y - 1, z);
  setDirtAt(t, x + 1, y - 1, z);
  setDirtAt(t, x, y - 1, z + 1);
  setDirtAt(t, x + 1, y - 1, z + 1);
  const at = (dx: number, dy: number, dz: number) => {
    if (isFree(t.lv, x + dx, y + dy, z + dz)) placeLog(t, x + dx, y + dy, z + dz);
  };
  for (let i = 0; i < h; i++) {
    at(0, i, 0);
    if (i < h - 1) {
      at(1, i, 0);
      at(1, i, 1);
      at(0, i, 1);
    }
  }
  return [{ x, y: y + h, z, radiusOffset: 0, doubleTrunk: true }];
}

/** FancyTrunkPlacer: the big oak with branches. */
function fancyTrunk(t: Tree, h: number, x: number, y: number, z: number): Attachment[] {
  const r = t.r;
  const height = h + 2;
  const k = Math.floor(height * 0.618);
  setDirtAt(t, x, y - 1, z);
  const l = Math.min(1, Math.floor(1.382 + Math.pow((1 * height) / 13, 2)));
  const m = y + k;
  let n = height - 5;
  const coords: { x: number; y: number; z: number; base: number }[] = [{ x, y: y + n, z, base: m }];
  for (; n >= 0; n--) {
    const shape = treeShape(height, n);
    if (shape < 0) continue;
    for (let o = 0; o < l; o++) {
      const e = 1 * shape * (r.nextFloat() + 0.328);
      const g = f(r.nextFloat() * 2) * Math.PI;
      const bx = Math.floor(x + (e * Math.sin(g) + 0.5)), by = Math.floor(y + (n - 1)), bz = Math.floor(z + (e * Math.cos(g) + 0.5));
      if (!makeLimb(t, bx, by, bz, bx, by + 5, bz, false)) continue;
      const q = x - bx, rr = z - bz;
      const s = by - Math.sqrt(q * q + rr * rr) * 0.381;
      const ty = s > m ? m : Math.trunc(s);
      if (!makeLimb(t, x, ty, z, bx, by, bz, false)) continue;
      coords.push({ x: bx, y: by, z: bz, base: ty });
    }
  }
  makeLimb(t, x, y, z, x, y + k, z, true);
  for (const c of coords) {
    if ((x === c.x && c.base === c.y && z === c.z) || !(c.base - y >= height * 0.2)) continue;
    makeLimb(t, x, c.base, z, c.x, c.y, c.z, true);
  }
  return coords.filter((c) => c.base - y >= height * 0.2).map((c) => ({ x: c.x, y: c.y, z: c.z, radiusOffset: 0, doubleTrunk: false }));
}

function treeShape(height: number, y: number): number {
  if (f(y) < f(height * f(0.3))) return -1;
  const a = f(height / 2), g = f(a - y);
  let h = f(Math.sqrt(f(f(a * a) - f(g * g))));
  if (g === 0) h = a;
  else if (Math.abs(g) >= a) return 0;
  return f(h * 0.5);
}

function makeLimb(t: Tree, sx: number, sy: number, sz: number, ex: number, ey: number, ez: number, place: boolean): boolean {
  if (!place && sx === ex && sy === ey && sz === ez) return true;
  const dx = ex - sx, dy = ey - sy, dz = ez - sz;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const fx = f(dx / steps), fy = f(dy / steps), fz = f(dz / steps);
  for (let j = 0; j <= steps; j++) {
    const px = Math.floor(sx + f(0.5 + f(j * fx))), py = Math.floor(sy + f(0.5 + f(j * fy))), pz = Math.floor(sz + f(0.5 + f(j * fz)));
    if (place) {
      // getLogAxis
      const ax = Math.abs(px - sx), az = Math.abs(pz - sz), mx = Math.max(ax, az);
      placeLog(t, px, py, pz, mx > 0 ? (ax === mx ? 'x' : 'z') : 'y');
      continue;
    }
    if (!isFree(t.lv, px, py, pz)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ foliage placers
interface FoliagePlacer {
  radius: (r: JavaRandom, trunkHeight: number) => number;
  height: (r: JavaRandom, treeHeight: number) => number;
  create: (t: Tree, a: Attachment, foliageHeight: number, radius: number, offset: number) => void;
  offset: IntProvider;
}
type Skip = (r: JavaRandom, dx: number, y: number, dz: number, range: number, large: boolean) => boolean;

/** FoliagePlacer.placeLeavesRow */
function leavesRow(t: Tree, skip: Skip, x: number, y: number, z: number, range: number, dy: number, large: boolean, signed?: Skip): void {
  const ext = large ? 1 : 0;
  for (let j = -range; j <= range + ext; j++)
    for (let k = -range; k <= range + ext; k++) {
      if (signed ? signed(t.r, j, dy, k, range, large) : skipSigned(skip, t.r, j, dy, k, range, large)) continue;
      const px = x + j, py = y + dy, pz = z + k;
      if (!validTreePos(t.lv, px, py, pz)) continue;
      setFoliage(t, px, py, pz, t.cfg.foliage(t.r, px, py, pz));
    }
}
function skipSigned(skip: Skip, r: JavaRandom, dx: number, y: number, dz: number, range: number, large: boolean): boolean {
  const i = large ? Math.min(Math.abs(dx), Math.abs(dx - 1)) : Math.abs(dx);
  const j = large ? Math.min(Math.abs(dz), Math.abs(dz - 1)) : Math.abs(dz);
  return skip(r, i, y, j, range, large);
}

function foliagePlacer(j: J): FoliagePlacer {
  const radius = intProvider(j.radius), offset = intProvider(j.offset);
  const base = { radius: (r: JavaRandom) => radius(r), offset };
  switch (j.type) {
    case 'minecraft:blob_foliage_placer': {
      const skip: Skip = (r, dx, y, dz, range) => dx === range && dz === range && (r.nextInt(2) === 0 || y === 0);
      return {
        ...base, height: () => j.height, create: (t, a, fh, rad, off) => {
          for (let i = off; i >= off - fh; i--) leavesRow(t, skip, a.x, a.y, a.z, Math.max(rad + a.radiusOffset - 1 - Math.trunc(i / 2), 0), i, a.doubleTrunk);
        },
      };
    }
    case 'minecraft:fancy_foliage_placer': {
      const skip: Skip = (_r, dx, _y, dz, range) => f(f(f(dx + 0.5) * f(dx + 0.5)) + f(f(dz + 0.5) * f(dz + 0.5))) > range * range;
      return {
        ...base, height: () => j.height, create: (t, a, fh, rad, off) => {
          for (let i = off; i >= off - fh; i--) leavesRow(t, skip, a.x, a.y, a.z, rad + (i === off || i === off - fh ? 0 : 1), i, a.doubleTrunk);
        },
      };
    }
    case 'minecraft:bush_foliage_placer': {
      const skip: Skip = (r, dx, _y, dz, range) => dx === range && dz === range && r.nextInt(2) === 0;
      return {
        ...base, height: () => j.height, create: (t, a, fh, rad, off) => {
          for (let i = off; i >= off - fh; i--) leavesRow(t, skip, a.x, a.y, a.z, rad + a.radiusOffset - 1 - i, i, a.doubleTrunk);
        },
      };
    }
    case 'minecraft:spruce_foliage_placer': {
      const trunkHeight = intProvider(j.trunk_height);
      const skip: Skip = (_r, dx, _y, dz, range) => dx === range && dz === range && range > 0;
      return {
        ...base, height: (r, h) => Math.max(4, h - trunkHeight(r)), create: (t, a, fh, rad, off) => {
          let i = t.r.nextInt(2), jj = 1, k = 0;
          for (let l = off; l >= -fh; l--) {
            leavesRow(t, skip, a.x, a.y, a.z, i, l, a.doubleTrunk);
            if (i >= jj) {
              i = k;
              k = 1;
              jj = Math.min(jj + 1, rad + a.radiusOffset);
            } else i++;
          }
        },
      };
    }
    case 'minecraft:pine_foliage_placer': {
      const height = intProvider(j.height);
      const skip: Skip = (_r, dx, _y, dz, range) => dx === range && dz === range && range > 0;
      return {
        ...base, radius: (r, th) => radius(r) + r.nextInt(Math.max(th + 1, 1)), height: (r) => height(r), create: (t, a, fh, rad, off) => {
          let i = 0;
          for (let jj = off; jj >= off - fh; jj--) {
            leavesRow(t, skip, a.x, a.y, a.z, i, jj, a.doubleTrunk);
            if (i >= 1 && jj === off - fh + 1) i--;
            else if (i < rad + a.radiusOffset) i++;
          }
        },
      };
    }
    case 'minecraft:acacia_foliage_placer': {
      const skip: Skip = (_r, dx, y, dz, range) => (y === 0 ? (dx > 1 || dz > 1) && dx !== 0 && dz !== 0 : dx === range && dz === range && range > 0);
      return {
        ...base, height: () => 0, create: (t, a, fh, rad, off) => {
          const y = a.y + off;
          leavesRow(t, skip, a.x, y, a.z, rad + a.radiusOffset, -1 - fh, a.doubleTrunk);
          leavesRow(t, skip, a.x, y, a.z, rad - 1, -fh, a.doubleTrunk);
          leavesRow(t, skip, a.x, y, a.z, rad + a.radiusOffset - 1, 0, a.doubleTrunk);
        },
      };
    }
    case 'minecraft:dark_oak_foliage_placer': {
      const skip: Skip = (_r, dx, y, dz, range, large) => {
        if (y === -1 && !large) return dx === range && dz === range;
        if (y === 1) return dx + dz > range * 2 - 2;
        return false;
      };
      const signed: Skip = (r, dx, y, dz, range, large) => {
        if (y === 0 && large && (dx === -range || dx >= range) && (dz === -range || dz >= range)) return true;
        return skipSigned(skip, r, dx, y, dz, range, large);
      };
      return {
        ...base, height: () => 4, create: (t, a, _fh, rad, off) => {
          const y = a.y + off, lg = a.doubleTrunk;
          if (lg) {
            leavesRow(t, skip, a.x, y, a.z, rad + 2, -1, lg, signed);
            leavesRow(t, skip, a.x, y, a.z, rad + 3, 0, lg, signed);
            leavesRow(t, skip, a.x, y, a.z, rad + 2, 1, lg, signed);
            if (t.r.nextBoolean()) leavesRow(t, skip, a.x, y, a.z, rad, 2, lg, signed);
          } else {
            leavesRow(t, skip, a.x, y, a.z, rad + 2, -1, lg, signed);
            leavesRow(t, skip, a.x, y, a.z, rad + 1, 0, lg, signed);
          }
        },
      };
    }
    case 'minecraft:mega_pine_foliage_placer': {
      const crown = intProvider(j.crown_height);
      const skip: Skip = (_r, dx, _y, dz, range) => dx + dz >= 7 || dx * dx + dz * dz > range * range;
      return {
        ...base, height: (r) => crown(r), create: (t, a, fh, rad, off) => {
          let i = 0;
          for (let jj = a.y - fh + off; jj <= a.y + off; jj++) {
            const k = a.y - jj;
            const l = rad + a.radiusOffset + Math.floor(f(f(f(k) / f(fh)) * 3.5));
            const m = k > 0 && l === i && (jj & 1) === 0 ? l + 1 : l;
            leavesRow(t, skip, a.x, jj, a.z, m, 0, a.doubleTrunk);
            i = l;
          }
        },
      };
    }
    case 'minecraft:jungle_foliage_placer': {
      const skip: Skip = (_r, dx, _y, dz, range) => dx + dz >= 7 || dx * dx + dz * dz > range * range;
      return {
        ...base, height: () => j.height, create: (t, a, fh, rad, off) => {
          const i = a.doubleTrunk ? fh : 1 + t.r.nextInt(2);
          for (let jj = off; jj >= off - i; jj--) leavesRow(t, skip, a.x, a.y, a.z, rad + a.radiusOffset + 1 - jj, jj, a.doubleTrunk);
        },
      };
    }
    default:
      throw new Error(`foliage placer ${j.type}`);
  }
}

// ------------------------------------------------------------------ feature size
function featureSize(j: J): { size: (h: number, y: number) => number; minClipped?: number } {
  const minClipped = j.min_clipped_height as number | undefined;
  if (j.type === 'minecraft:two_layers_feature_size') return { size: (_h, y) => (y < j.limit ? j.lower_size : j.upper_size), minClipped };
  return { size: (h, y) => (y < j.limit ? j.lower_size : y >= h - j.upper_limit ? j.upper_size : j.middle_size), minClipped };
}

// ------------------------------------------------------------------ tree decorators
type Pos = [number, number, number];
type TreeDecorator = (t: Tree, logs: Pos[], leaves: Pos[]) => void;
const VINE = stateOf('vine');
function placeVine(t: Tree, x: number, y: number, z: number, side: string): void {
  setDecoration(t, x, y, z, withProp(VINE, side, true));
}

function treeDecorator(j: J): TreeDecorator {
  switch (j.type) {
    case 'minecraft:trunk_vine':
      return (t, logs) => {
        const r = t.r, lv = t.lv;
        for (const [x, y, z] of logs) {
          if (r.nextInt(3) > 0 && lv.isAir(x - 1, y, z)) placeVine(t, x - 1, y, z, 'east');
          if (r.nextInt(3) > 0 && lv.isAir(x + 1, y, z)) placeVine(t, x + 1, y, z, 'west');
          if (r.nextInt(3) > 0 && lv.isAir(x, y, z - 1)) placeVine(t, x, y, z - 1, 'south');
          if (r.nextInt(3) > 0 && lv.isAir(x, y, z + 1)) placeVine(t, x, y, z + 1, 'north');
        }
      };
    case 'minecraft:leave_vine':
      return (t, _logs, leaves) => {
        const r = t.r, lv = t.lv;
        const hang = (x: number, y: number, z: number, side: string) => {
          placeVine(t, x, y, z, side);
          let i = 4;
          for (y--; lv.isAir(x, y, z) && i > 0; y--, i--) placeVine(t, x, y, z, side);
        };
        for (const [x, y, z] of leaves) {
          if (r.nextInt(4) === 0 && lv.isAir(x - 1, y, z)) hang(x - 1, y, z, 'east');
          if (r.nextInt(4) === 0 && lv.isAir(x + 1, y, z)) hang(x + 1, y, z, 'west');
          if (r.nextInt(4) === 0 && lv.isAir(x, y, z - 1)) hang(x, y, z - 1, 'south');
          if (r.nextInt(4) === 0 && lv.isAir(x, y, z + 1)) hang(x, y, z + 1, 'north');
        }
      };
    case 'minecraft:cocoa': {
      const p = f(j.probability);
      const COCOA = stateOf('cocoa');
      const faces: [string, number, number][] = [['north', 0, -1], ['east', 1, 0], ['south', 0, 1], ['west', -1, 0]];
      return (t, logs) => {
        const r = t.r;
        if (r.nextFloat() >= p) return;
        const base = logs[0]![1];
        for (const [x, y, z] of logs) {
          if (y - base > 2) continue;
          for (const [facing, sx, sz] of faces) {
            if (!(r.nextFloat() <= 0.25)) continue;
            const bx = x - sx, bz = z - sz;
            if (!t.lv.isAir(bx, y, bz)) continue;
            setDecoration(t, bx, y, bz, withProp(withProp(COCOA, 'age', r.nextInt(3)), 'facing', facing));
          }
        }
      };
    }
    case 'minecraft:beehive': {
      const p = f(j.probability);
      const HIVE = stateOf('bee_nest', { facing: 'south' });
      // SPAWN_DIRECTIONS: horizontal directions except north (the opposite of the south-facing front)
      const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0]];
      return (t, logs, leaves) => {
        const r = t.r;
        if (r.nextFloat() >= p) return;
        const y = leaves.length ? Math.max(leaves[0]![1] - 1, logs[0]![1] + 1) : Math.min(logs[0]![1] + 1 + r.nextInt(3), logs[logs.length - 1]![1]);
        const at = logs.filter((q) => q[1] === y);
        if (!at.length) return;
        const [x, , z] = at[r.nextInt(at.length)]!;
        for (const [dx, dz] of dirs) {
          const hx = x + dx, hz = z + dz;
          if (!t.lv.isAir(hx, y, hz) || !t.lv.isAir(hx, y, hz + 1)) continue;
          setDecoration(t, hx, y, hz, HIVE);
          // the bees inside (block entities aren't stored yet): 2–3 bees with random ticks in the hive
          for (let k = 2 + r.nextInt(2); k > 0; k--) r.nextInt(599);
          return;
        }
      };
    }
    case 'minecraft:alter_ground': {
      const provider = stateProvider(j.provider);
      const placeAt = (t: Tree, x: number, y: number, z: number) => {
        for (let i = 2; i >= -3; i--) {
          const s = t.lv.getState(x, y + i, z);
          if (inTag('dirt', s)) {
            setDecoration(t, x, y + i, z, provider(t.r, x, y, z));
            break;
          }
          if (IS_AIR[s] !== 1 && i < 0) break;
        }
      };
      const circle = (t: Tree, x: number, y: number, z: number) => {
        for (let i = -2; i <= 2; i++)
          for (let jj = -2; jj <= 2; jj++) if (Math.abs(i) !== 2 || Math.abs(jj) !== 2) placeAt(t, x + i, y, z + jj);
      };
      return (t, logs) => {
        if (!logs.length) return;
        const base = logs[0]![1];
        for (const [x, y, z] of logs) {
          if (y !== base) continue;
          circle(t, x - 1, y, z - 1);
          circle(t, x + 2, y, z - 1);
          circle(t, x - 1, y, z + 2);
          circle(t, x + 2, y, z + 2);
          for (let jj = 0; jj < 5; jj++) {
            const k = t.r.nextInt(64), l = k % 8, m = Math.trunc(k / 8);
            if (l === 0 || l === 7 || m === 0 || m === 7) circle(t, x - 3 + l, y, z - 3 + m);
          }
        }
      };
    }
    default:
      throw new Error(`tree decorator ${j.type}`);
  }
}

// ------------------------------------------------------------------ the feature
interface TreeConfig {
  trunk: StateProvider;
  foliage: StateProvider;
  sapling: StateProvider;
  dirt: StateProvider;
  forceDirt: boolean;
  ignoreVines: boolean;
}

/** TreeFeature.updateLeaves: leaves within 6 blocks of a log get their distance. */
function updateLeaves(lv: GenLevel, logs: PosSet): void {
  let frontier: Pos[] = [];
  const seen = new Set<string>(logs.keys);
  const visit = (x: number, y: number, z: number, d: number, next: Pos[]) => {
    const k = key(x, y, z);
    if (seen.has(k)) return;
    const s = lv.getState(x, y, z);
    const dist = getProp(s, 'distance');
    if (typeof dist !== 'number' || dist <= d) return;
    seen.add(k);
    lv.setState(x, y, z, withProp(s, 'distance', d));
    next.push([x, y, z]);
  };
  const around = (p: Pos, d: number, next: Pos[]) => {
    visit(p[0] - 1, p[1], p[2], d, next);
    visit(p[0] + 1, p[1], p[2], d, next);
    visit(p[0], p[1] - 1, p[2], d, next);
    visit(p[0], p[1] + 1, p[2], d, next);
    visit(p[0], p[1], p[2] - 1, d, next);
    visit(p[0], p[1], p[2] + 1, d, next);
  };
  for (const p of logs.list) around(p, 1, frontier);
  for (let d = 2; d <= 6 && frontier.length; d++) {
    const next: Pos[] = [];
    for (const p of frontier) around(p, d, next);
    frontier = next;
  }
}

export function treeFeature(c: J): (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number) => boolean {
  const cfg: TreeConfig = {
    trunk: stateProvider(c.trunk_provider), foliage: stateProvider(c.foliage_provider), sapling: stateProvider(c.sapling_provider),
    dirt: stateProvider(c.dirt_provider), forceDirt: !!c.force_dirt, ignoreVines: !!c.ignore_vines,
  };
  const trunk = trunkPlacer(c.trunk_placer), foliage = foliagePlacer(c.foliage_placer), size = featureSize(c.minimum_size);
  const decorators = (c.decorators as J[]).map(treeDecorator);
  return (lv, r, x, y, z) => {
    const t: Tree = { lv, r, cfg, logs: new PosSet(), leaves: new PosSet(), decorations: new PosSet() };
    // doPlace
    const h = trunk.height(r);
    const fh = foliage.height(r, h);
    const rad = foliage.radius(r, h - fh);
    if (y < lv.minY + 1 || y + h + 1 > 256) return false;
    const below = lv.getState(x, y - 1, z);
    cfg.sapling(r, x, y, z);
    if (!(inTag('dirt', below) || blockNameOf(below) === 'farmland')) return false;
    let free = h;
    outer: for (let i = 0; i <= h + 1; i++) {
      const j = size.size(h, i);
      for (let k = -j; k <= j; k++)
        for (let l = -j; l <= j; l++) {
          if (isFree(lv, x + k, y + i, z + l) && (cfg.ignoreVines || blockNameOf(lv.getState(x + k, y + i, z + l)) !== 'vine')) continue;
          free = i - 2;
          break outer;
        }
    }
    if (free < h && (size.minClipped === undefined || free < size.minClipped)) return false;
    for (const a of trunk.place(t, free, x, y, z)) foliage.create(t, a, fh, rad, foliage.offset(r));
    if (!t.logs.size && !t.leaves.size) return false;
    if (decorators.length) {
      const logs = t.logs.javaOrder().sort((a, b) => a[1] - b[1]);
      const leaves = t.leaves.javaOrder().sort((a, b) => a[1] - b[1]);
      for (const d of decorators) d(t, logs, leaves);
    }
    updateLeaves(lv, t.logs);
    return true;
  };
}
