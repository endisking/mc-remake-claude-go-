/**
 * Block raycast: walks voxels along a ray (Amanatides–Woo DDA) and intersects each
 * block's outline boxes, like vanilla BlockGetter.clip with OUTLINE shapes.
 */
import { outlineBoxes, type Box } from './shapes';
import { FLUID } from './blockinfo';

export interface BlockHit {
  x: number;
  y: number;
  z: number;
  /** Face hit: 0 down, 1 up, 2 north, 3 south, 4 west, 5 east */
  face: number;
  /** Exact hit point */
  px: number;
  py: number;
  pz: number;
  distance: number;
  state: number;
}

export interface StateGetter {
  getState(x: number, y: number, z: number): number;
}

/** Face of the most recent successful rayBox() hit. */
export let rayBoxFace = -1;

/** Slab-test a ray against a box; returns the entry distance (>= 0) or -1 on a miss. Allocation-free. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box, bx: number, by: number, bz: number): number {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const base = axis === 0 ? bx : axis === 1 ? by : bz;
    const lo = base + b[axis]!, hi = base + b[axis + 3]!;
    const fneg = axis === 0 ? 4 : axis === 1 ? 0 : 2;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    let f1 = fneg;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      f1 = fneg + 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      face = f1;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  rayBoxFace = face;
  return Math.max(0, tmin);
}

export function raycastBlocks(
  world: StateGetter, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number,
  includeFluids = false,
  out?: BlockHit,
): BlockHit | null {
  const len = Math.hypot(dx, dy, dz);
  dx /= len;
  dy /= len;
  dz /= len;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = sz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
  let best: BlockHit | null = null;
  for (let i = 0; i < 256; i++) {
    const st = world.getState(x, y, z);
    if (st !== 0) {
      let boxes = outlineBoxes(st);
      if (includeFluids && FLUID[st] && !boxes.length) boxes = [[0, 0, 0, 1, 1, 1]];
      for (const b of boxes) {
        const t = rayBox(ox, oy, oz, dx, dy, dz, b, x, y, z);
        if (t >= 0 && t <= maxDist && (!best || t < best.distance)) {
          best = out ?? ({} as BlockHit);
          best.x = x; best.y = y; best.z = z; best.face = rayBoxFace;
          best.px = ox + dx * t; best.py = oy + dy * t; best.pz = oz + dz * t;
          best.distance = t; best.state = st;
        }
      }
      if (best) return best;
    }
    const tNext = Math.min(tmx, tmy, tmz);
    if (tNext > maxDist) break;
    if (tmx === tNext) {
      x += sx;
      tmx += tdx;
    } else if (tmy === tNext) {
      y += sy;
      tmy += tdy;
    } else {
      z += sz;
      tmz += tdz;
    }
  }
  return best;
}
