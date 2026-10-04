/**
 * Nether portal geometry (vanilla 1.17.1 PortalShape, PortalForcer, BlockUtil.getLargestRectangleAround,
 * PortalShape.getRelativePosition / createPortalInfo): frame detection for lighting (2×3 up to
 * 21×21 interior, obsidian frame, corners optional), portal-block validity for updateShape,
 * coordinate scaling between dimensions, the exit-portal search and the PortalForcer.createPortal
 * placement rules. Pure functions over a block getter so they can be unit tested.
 */
import { stateOf, blockNameOf, getProp } from '../world/blockstate';
import { IS_AIR } from '../world/blockinfo';
import { MATERIAL_SOLID } from '../world/blockprops';

export type Axis = 'x' | 'z';

export interface PortalLevel {
  getState(x: number, y: number, z: number): number;
}

const OBSIDIAN = stateOf('obsidian');
export const PORTAL_X = stateOf('nether_portal', { axis: 'x' });
export const PORTAL_Z = stateOf('nether_portal', { axis: 'z' });
export const portalState = (axis: Axis) => (axis === 'x' ? PORTAL_X : PORTAL_Z);

export function isPortal(s: number): boolean {
  return s === PORTAL_X || s === PORTAL_Z;
}
export function portalAxis(s: number): Axis | null {
  return s === PORTAL_X ? 'x' : s === PORTAL_Z ? 'z' : null;
}
const isFrame = (s: number) => s === OBSIDIAN;
const fireCache = new Map<number, boolean>();
function isFire(s: number): boolean {
  let v = fireCache.get(s);
  if (v === undefined) {
    const n = blockNameOf(s);
    fireCache.set(s, (v = n === 'fire' || n === 'soul_fire'));
  }
  return v;
}
/** PortalShape.isEmpty: air, fire (BlockTags.FIRE) or portal. */
const isEmpty = (s: number) => IS_AIR[s] === 1 || isFire(s) || isPortal(s);

export interface PortalShape {
  axis: Axis;
  /** bottom-left interior block (smallest coordinate along `rightDir`'s opposite… see rightDir) */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  /** portal blocks already inside the frame */
  portalBlocks: number;
  /** step of PortalShape.rightDir: WEST (−x) for axis x, SOUTH (+z) for axis z */
  rdx: number;
  rdz: number;
}

/** new PortalShape(level, pos, axis); null when the shape is not valid (isValid()). */
export function portalShapeAt(lv: PortalLevel, x: number, y: number, z: number, axis: Axis): PortalShape | null {
  const rdx = axis === 'x' ? -1 : 0, rdz = axis === 'x' ? 0 : 1;
  // calculateBottomLeft: drop down through empty blocks (at most 21), then walk left to the frame
  const minY = Math.max(0, y - 21);
  while (y > minY && isEmpty(lv.getState(x, y - 1, z))) y--;
  const left = distanceUntilEdgeAboveFrame(lv, x, y, z, -rdx, -rdz) - 1;
  if (left < 0) return null;
  const bx = x - rdx * left, bz = z - rdz * left;
  const w = distanceUntilEdgeAboveFrame(lv, bx, y, bz, rdx, rdz);
  const width = w >= 2 && w <= 21 ? w : 0;
  if (!width) return null;
  // calculateHeight / getDistanceUntilTop
  let portalBlocks = 0;
  let h = 21;
  outer: for (let i = 0; i < 21; i++) {
    if (!isFrame(lv.getState(bx - rdx, y + i, bz - rdz)) || !isFrame(lv.getState(bx + rdx * width, y + i, bz + rdz * width))) {
      h = i;
      break;
    }
    for (let j = 0; j < width; j++) {
      const s = lv.getState(bx + rdx * j, y + i, bz + rdz * j);
      if (!isEmpty(s)) {
        h = i;
        break outer;
      }
      if (isPortal(s)) portalBlocks++;
    }
  }
  if (h < 3 || h > 21) return null;
  for (let j = 0; j < width; j++) if (!isFrame(lv.getState(bx + rdx * j, y + h, bz + rdz * j))) return null;
  return { axis, x: bx, y, z: bz, width, height: h, portalBlocks, rdx, rdz };
}

/** getDistanceUntilEdgeAboveFrame: empty blocks with frame below, ending at a frame block (0 if not). */
function distanceUntilEdgeAboveFrame(lv: PortalLevel, x: number, y: number, z: number, dx: number, dz: number): number {
  for (let i = 0; i <= 21; i++) {
    const px = x + dx * i, pz = z + dz * i;
    const s = lv.getState(px, y, pz);
    if (!isEmpty(s)) return isFrame(s) ? i : 0;
    if (!isFrame(lv.getState(px, y - 1, pz))) break;
  }
  return 0;
}

/** PortalShape.isComplete */
export function isCompleteShape(sh: PortalShape | null): boolean {
  return !!sh && sh.portalBlocks === sh.width * sh.height;
}

/** PortalShape.findEmptyPortalShape(level, pos, preferredAxis): a valid frame with no portal blocks yet. */
export function findEmptyPortalShape(lv: PortalLevel, x: number, y: number, z: number, preferred: Axis = 'x'): PortalShape | null {
  for (const axis of preferred === 'x' ? (['x', 'z'] as const) : (['z', 'x'] as const)) {
    const sh = portalShapeAt(lv, x, y, z, axis);
    if (sh && sh.portalBlocks === 0) return sh;
  }
  return null;
}

/** The interior blocks of a shape (createPortalBlocks fills them with the axis's portal state). */
export function shapeBlocks(sh: PortalShape): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < sh.height; i++) for (let j = 0; j < sh.width; j++) out.push([sh.x + sh.rdx * j, sh.y + i, sh.z + sh.rdz * j]);
  return out;
}

/**
 * NetherPortalBlock.updateShape: a neighbour change along the portal's own axis or vertically
 * breaks the portal unless the neighbour is portal too or the shape is still complete.
 * `dir` is the axis of the neighbour that changed ('x', 'y' or 'z').
 */
export function portalSurvives(lv: PortalLevel, x: number, y: number, z: number, state: number, dir: 'x' | 'y' | 'z', neighbour: number): boolean {
  const axis = portalAxis(state)!;
  if (dir !== axis && dir !== 'y') return true;
  if (isPortal(neighbour) && neighbour === state) return true;
  return isCompleteShape(portalShapeAt(lv, x, y, z, axis));
}

// ------------------------------------------------------------------ travel
/** DimensionType.getTeleportationScale(from, to): coordinate_scale ratio (overworld 1, nether 8). */
export function teleportationScale(fromScale: number, toScale: number): number {
  return fromScale / toScale;
}

/** The target block position of a portal trip (Entity.findDimensionEntryPoint): x, z scaled and clamped to the border. */
export function scaledTarget(x: number, y: number, z: number, fromScale: number, toScale: number): [number, number, number] {
  const g = teleportationScale(fromScale, toScale);
  const lim = 2.9999872e7 - 16;
  const cl = (v: number) => Math.max(-lim, Math.min(lim, v));
  return [Math.floor(cl(x * g)), Math.floor(y), Math.floor(cl(z * g))];
}

/** PortalForcer.findPortalAround search radius: 16 into the Nether, 128 out of it (1.17.1). */
export function portalSearchRadius(toNether: boolean): number {
  return toNether ? 16 : 128;
}

export interface FoundRectangle {
  x: number;
  y: number;
  z: number;
  /** size along the portal's axis */
  axis1: number;
  /** size along y */
  axis2: number;
}

/**
 * BlockUtil.getLargestRectangleAround for a portal block: the portal blocks of a lit frame form a
 * full rectangle, so this is the run along the axis and the column height around `center`.
 */
export function portalRectangle(lv: PortalLevel, x: number, y: number, z: number): FoundRectangle {
  const st = lv.getState(x, y, z);
  const axis = portalAxis(st) ?? 'x';
  const dx = axis === 'x' ? 1 : 0, dz = axis === 'z' ? 1 : 0;
  let lo = 0, hi = 0, down = 0, up = 0;
  while (lo < 21 && lv.getState(x - dx * (lo + 1), y, z - dz * (lo + 1)) === st) lo++;
  while (hi < 21 && lv.getState(x + dx * (hi + 1), y, z + dz * (hi + 1)) === st) hi++;
  while (down < 21 && lv.getState(x, y - down - 1, z) === st) down++;
  while (up < 21 && lv.getState(x, y + up + 1, z) === st) up++;
  return { x: x - dx * lo, y: y - down, z: z - dz * lo, axis1: lo + hi + 1, axis2: down + up + 1 };
}

/** PortalShape.getRelativePosition: where in the entrance portal the entity stands (0–1 across, 0–1 up, offset through). */
export function relativePortalPosition(r: FoundRectangle, axis: Axis, px: number, py: number, pz: number, width: number, height: number): [number, number, number] {
  const d = r.axis1 - width, e = r.axis2 - height;
  const along = axis === 'x' ? px : pz, base = axis === 'x' ? r.x : r.z;
  const g = d > 0 ? Math.max(0, Math.min(1, (along - (base + Math.fround(width / 2))) / d)) : 0.5;
  const h = e > 0 ? Math.max(0, Math.min(1, (py - r.y) / e)) : 0;
  const across = axis === 'x' ? pz - (r.z + 0.5) : px - (r.x + 0.5);
  return [g, h, across];
}

/** PortalShape.createPortalInfo: the arrival position and yaw change in the exit portal. */
export function portalArrival(exit: FoundRectangle, exitAxis: Axis, entryAxis: Axis, rel: [number, number, number], width: number, height: number, yaw: number): { x: number; y: number; z: number; yaw: number } {
  const f = width / 2 + (exit.axis1 - width) * rel[0];
  const g = (exit.axis2 - height) * rel[1];
  const h = 0.5 + rel[2];
  const isX = exitAxis === 'x';
  return { x: exit.x + (isX ? f : h), y: exit.y + g, z: exit.z + (isX ? h : f), yaw: yaw + (entryAxis === exitAxis ? 0 : 90) };
}

/** BlockPos.spiralAround(center, radius, EAST, SOUTH) as (dx, dz) offsets in vanilla order. */
export function spiralAround(radius: number): [number, number][] {
  const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const out: [number, number][] = [];
  let cx = 0, cz = 1; // center moved SOUTH
  const legs = 4 * radius;
  let leg = -1, legSize = 0, legIndex = 0;
  for (;;) {
    const d = dirs[(leg + 4) % 4]!;
    cx += d[0];
    cz += d[1];
    if (legIndex >= legSize) {
      if (leg >= legs) break;
      leg++;
      legIndex = 0;
      legSize = (leg >> 1) + 1;
    }
    legIndex++;
    out.push([cx, cz]);
  }
  return out;
}

export interface ForcerLevel extends PortalLevel {
  /** MOTION_BLOCKING heightmap (first free y above the top motion-blocking block) */
  motionBlockingHeight(x: number, z: number): number;
}

/**
 * PortalForcer.createPortal(pos, axis): the best spot within 16 blocks (spiral order) with room for
 * a 4×5 frame on solid ground (preferring room for a 3-wide platform), else a floating platform at
 * y 70..maxY-10. Returns the block writes (obsidian, air, portal) and the new portal's rectangle.
 */
export function planPortal(lv: ForcerLevel, px: number, py: number, pz: number, axis: Axis, logicalHeight: number): { writes: [number, number, number, number][]; rect: FoundRectangle } {
  const ddx = axis === 'x' ? 1 : 0, ddz = axis === 'z' ? 1 : 0; // Direction.get(POSITIVE, axis)
  // direction.getClockWise(): EAST → SOUTH, SOUTH → WEST
  const cwx = axis === 'x' ? 0 : -1, cwz = axis === 'x' ? 1 : 0;
  const maxY = Math.min(256, logicalHeight) - 1;
  const empty = (x: number, y: number, z: number) => IS_AIR[lv.getState(x, y, z)] === 1;
  const canHostFrame = (x: number, y: number, z: number, off: number) => {
    for (let i = -1; i < 3; i++)
      for (let j = -1; j < 4; j++) {
        const bx = x + ddx * i + cwx * off, bz = z + ddz * i + cwz * off, by = y + j;
        if (j < 0 && MATERIAL_SOLID[lv.getState(bx, by, bz)] !== 1) return false;
        if (j >= 0 && !empty(bx, by, bz)) return false;
      }
    return true;
  };
  const dist = (x: number, y: number, z: number) => (px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2 + (pz + 0.5 - z) ** 2;
  let d = -1, best: [number, number, number] | null = null;
  let e = -1, best2: [number, number, number] | null = null;
  for (const [ox, oz] of spiralAround(16)) {
    const x = px + ox, z = pz + oz;
    const j = Math.min(maxY, lv.motionBlockingHeight(x, z));
    for (let l = j; l >= 0; l--) {
      if (!empty(x, l, z)) continue;
      const n = l;
      while (l > 0 && empty(x, l - 1, z)) l--;
      if (l + 4 > maxY) continue;
      const o = n - l;
      if (o > 0 && o < 3) continue;
      if (!canHostFrame(x, l, z, 0)) continue;
      const f = dist(x, l, z);
      if (canHostFrame(x, l, z, -1) && canHostFrame(x, l, z, 1) && (d === -1 || d > f)) {
        d = f;
        best = [x, l, z];
      }
      if (d === -1 && (e === -1 || e > f)) {
        e = f;
        best2 = [x, l, z];
      }
    }
  }
  if (d === -1 && e !== -1) {
    best = best2;
    d = e;
  }
  const writes: [number, number, number, number][] = [];
  if (d === -1) {
    const lo = Math.max(1, 70), hi = maxY - 9;
    best = [px, Math.max(lo, Math.min(hi, py)), pz];
    for (let r = -1; r < 2; r++)
      for (let s = 0; s < 2; s++)
        for (let t = -1; t < 3; t++)
          writes.push([best[0] + s * ddx + r * cwx, best[1] + t, best[2] + s * ddz + r * cwz, t < 0 ? OBSIDIAN : 0]);
  }
  const [bx, by, bz] = best!;
  for (let u = -1; u < 3; u++)
    for (let v = -1; v < 4; v++) if (u === -1 || u === 2 || v === -1 || v === 3) writes.push([bx + u * ddx, by + v, bz + u * ddz, OBSIDIAN]);
  const ps = portalState(axis);
  for (let v = 0; v < 2; v++) for (let w = 0; w < 3; w++) writes.push([bx + v * ddx, by + w, bz + v * ddz, ps]);
  return { writes, rect: { x: bx, y: by, z: bz, axis1: 2, axis2: 3 } };
}

/** getProp helper re-export for callers checking the axis of arbitrary states. */
export function axisOf(state: number): Axis | null {
  const a = getProp(state, 'axis');
  return a === 'x' || a === 'z' ? a : null;
}
