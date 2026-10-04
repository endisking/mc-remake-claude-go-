/**
 * Fluid simulation: vanilla 1.17.1 FlowingFluid / WaterFluid / LavaFluid / LiquidBlock, as pure
 * logic over a small host interface (the server provides block writes, tick scheduling and
 * drops). Block states stay the source of truth; a fluid state is derived from them like
 * BlockState.getFluidState.
 *
 * Fluid state codes (FluidCode): 0 = empty, otherwise kind * 64 + (source ? 32 : 0) +
 * (falling ? 16 : 0) + amount (1..8; sources have amount 8).
 * Fluid types (vanilla Fluid instances, used for tick identity): 1 water, 2 flowing water,
 * 3 lava, 4 flowing lava.
 */
import { BLOCKS_BY_NAME, BLOCK_STATE_COUNT, COLLISION_SHAPES } from '../data';
import { FLUID, FLUID_LEVEL, COLLISION_SHAPE_ID, FULL_CUBE_SHAPE_ID, IS_AIR } from '../world/blockinfo';
import { MATERIAL_BLOCKS_MOTION, MATERIAL_SOLID } from '../world/blockprops';
import { blockNameOf, getProp, withProp, STATE_TO_BLOCK } from '../world/blockstate';

export type FluidCode = number;

export const KIND_WATER = 1;
export const KIND_LAVA = 2;

export const FLUID_WATER = 1;
export const FLUID_FLOWING_WATER = 2;
export const FLUID_LAVA = 3;
export const FLUID_FLOWING_LAVA = 4;

/** Directions: 0 down, 1 up, 2 north(-z), 3 south(+z), 4 west(-x), 5 east(+x). */
const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];
const OPP = [1, 0, 3, 2, 5, 4];
const DOWN = 0, UP = 1;
/** Direction.Plane.HORIZONTAL order: north, east, south, west. */
const HORIZONTAL = [2, 5, 3, 4];
/** EnumMap iteration order (Direction ordinal) for horizontal directions: north, south, west, east. */
const ENUM_ORDER = [2, 3, 4, 5];
/** LiquidBlock.POSSIBLE_FLOW_DIRECTIONS (down, south, north, east, west); checked at pos.relative(dir.getOpposite()). */
const LAVA_CONTACT = [OPP[0]!, OPP[3]!, OPP[2]!, OPP[5]!, OPP[4]!];

// ------------------------------------------------------------------ fluid states
export const fluidKind = (f: FluidCode): number => f >> 6;
export const fluidIsSource = (f: FluidCode): boolean => (f & 32) !== 0;
export const fluidIsFalling = (f: FluidCode): boolean => (f & 16) !== 0;
export const fluidAmount = (f: FluidCode): number => f & 15;

export function makeFluid(kind: number, source: boolean, amount: number, falling: boolean): FluidCode {
  return (kind << 6) | (source ? 32 : 0) | (falling ? 16 : 0) | (source ? 8 : amount);
}

/** Fluid.getType: source vs flowing instance. */
export function fluidType(f: FluidCode): number {
  if (f === 0) return 0;
  return (fluidKind(f) - 1) * 2 + (fluidIsSource(f) ? 1 : 2);
}

/** BlockState.getFluidState as a code, per state. */
export const FLUID_OF = new Uint16Array(BLOCK_STATE_COUNT);
for (let s = 0; s < BLOCK_STATE_COUNT; s++) {
  const k = FLUID[s]!;
  if (!k) continue;
  const lvl = FLUID_LEVEL[s]!;
  // LiquidBlock.getFluidState: level 0 source, 1..7 flowing amount 8 - level, 8+ falling amount 8
  FLUID_OF[s] = lvl === 0 ? makeFluid(k, true, 8, false) : lvl >= 8 ? makeFluid(k, false, 8, true) : makeFluid(k, false, 8 - lvl, false);
}

const WATER = BLOCKS_BY_NAME.get('water')!;
const LAVA = BLOCKS_BY_NAME.get('lava')!;
export const ID_WATER = WATER.id;
export const ID_LAVA = LAVA.id;
const WATER_STATES: number[] = [];
const LAVA_STATES: number[] = [];
for (let l = 0; l < 16; l++) {
  WATER_STATES.push(withProp(WATER.defaultState, 'level', l));
  LAVA_STATES.push(withProp(LAVA.defaultState, 'level', l));
}
const st = (n: string) => BLOCKS_BY_NAME.get(n)!.defaultState;
export const OBSIDIAN = st('obsidian');
export const COBBLESTONE = st('cobblestone');
export const STONE = st('stone');
export const BASALT = st('basalt');
const ID_SOUL_SOIL = BLOCKS_BY_NAME.get('soul_soil')!.id;
const ID_BLUE_ICE = BLOCKS_BY_NAME.get('blue_ice')!.id;

/** FluidState.createLegacyBlock (FlowingFluid.getLegacyLevel). Empty → air. */
export function legacyBlock(f: FluidCode): number {
  if (f === 0) return 0;
  const level = fluidIsSource(f) ? 0 : 8 - Math.min(fluidAmount(f), 8) + (fluidIsFalling(f) ? 8 : 0);
  return fluidKind(f) === KIND_WATER ? WATER_STATES[level]! : LAVA_STATES[level]!;
}

/** The block is a LiquidBlock (water or lava block, not a waterlogged block). */
export function isLiquidBlock(state: number): boolean {
  const b = STATE_TO_BLOCK[state]!;
  return b === ID_WATER || b === ID_LAVA;
}

// ------------------------------------------------------------------ block classification
/** 1 if the block has a waterlogged property (SimpleWaterloggedBlock → LiquidBlockContainer). */
const WATERLOGGABLE = new Uint8Array(BLOCK_STATE_COUNT);
/** canHoldFluid exclusions: 1 never holds (doors, signs, ladder, sugar cane, bubble column, portals, structure void, water plants). */
const NEVER_HOLDS = new Uint8Array(BLOCK_STATE_COUNT);
/** Material.ICE (isSolidFace treats it as not solid). */
const ICE = new Uint8Array(BLOCK_STATE_COUNT);
/** Shape used by canPassThroughWall (getCollisionShape with an empty context); -1 = empty. */
const WALL_SHAPE = new Int32Array(BLOCK_STATE_COUNT);
{
  const never = new Set(['ladder', 'sugar_cane', 'bubble_column', 'nether_portal', 'end_portal', 'end_gateway', 'structure_void', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
  for (let s = 0; s < BLOCK_STATE_COUNT; s++) {
    const n = blockNameOf(s);
    if (getProp(s, 'waterlogged') !== undefined) WATERLOGGABLE[s] = 1;
    if (never.has(n) || n.endsWith('_door') || n.endsWith('_sign')) NEVER_HOLDS[s] = 1;
    if (n === 'ice' || n === 'frosted_ice') ICE[s] = 1;
    const id = COLLISION_SHAPE_ID[s]!;
    const boxes = COLLISION_SHAPES[id];
    // scaffolding and powder snow collide only for entities; liquids have no collision
    WALL_SHAPE[s] = !boxes || boxes.length === 0 || n === 'scaffolding' || n === 'powder_snow' ? -1 : id;
  }
}
/** Kelp and seagrass are LiquidBlockContainers that refuse liquid. */
const PLANT_CONTAINER = new Set(['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass'].map((n) => BLOCKS_BY_NAME.get(n)!.id));

export function isWaterlogged(state: number): boolean {
  return WATERLOGGABLE[state] === 1 && getProp(state, 'waterlogged') === true;
}

// ------------------------------------------------------------------ shape faces
/** 16 rows of 16 bits: which 1/16 cells of a face plane a shape covers at the block boundary. */
const faceCache = new Map<number, Uint16Array>();
function faceMask(shapeId: number, face: number): Uint16Array {
  const key = shapeId * 6 + face;
  let m = faceCache.get(key);
  if (m) return m;
  m = new Uint16Array(16);
  const eps = 1e-7;
  for (const b of COLLISION_SHAPES[shapeId] ?? []) {
    const [x0, y0, z0, x1, y1, z1] = b as [number, number, number, number, number, number];
    let on = false, a0 = 0, a1 = 0, c0 = 0, c1 = 0;
    switch (face) {
      case 0: on = y0 <= eps; a0 = x0; a1 = x1; c0 = z0; c1 = z1; break;
      case 1: on = y1 >= 1 - eps; a0 = x0; a1 = x1; c0 = z0; c1 = z1; break;
      case 2: on = z0 <= eps; a0 = x0; a1 = x1; c0 = y0; c1 = y1; break;
      case 3: on = z1 >= 1 - eps; a0 = x0; a1 = x1; c0 = y0; c1 = y1; break;
      case 4: on = x0 <= eps; a0 = z0; a1 = z1; c0 = y0; c1 = y1; break;
      default: on = x1 >= 1 - eps; a0 = z0; a1 = z1; c0 = y0; c1 = y1; break;
    }
    if (!on) continue;
    for (let i = 0; i < 16; i++) {
      const ca = (i + 0.5) / 16;
      if (ca < a0 || ca > a1) continue;
      for (let j = 0; j < 16; j++) {
        const cc = (j + 0.5) / 16;
        if (cc >= c0 && cc <= c1) m[j] = m[j]! | (1 << i);
      }
    }
  }
  faceCache.set(key, m);
  return m;
}

const occludeCache = new Map<number, boolean>();
/**
 * Shapes.mergedFaceOccludes(shape(a), shape(b), dir): the face of `a` toward `dir` together with
 * the face of `b` toward the opposite side covers the whole square.
 */
function mergedFaceOccludes(a: number, b: number, dir: number): boolean {
  const sa = WALL_SHAPE[a]!, sb = WALL_SHAPE[b]!;
  if (sa === FULL_CUBE_SHAPE_ID && sb === FULL_CUBE_SHAPE_ID) return true;
  if (sa < 0 && sb < 0) return false;
  const key = ((sa + 1) * 65536 + (sb + 1)) * 6 + dir;
  let r = occludeCache.get(key);
  if (r !== undefined) return r;
  const ma = sa < 0 ? null : faceMask(sa, dir);
  const mb = sb < 0 ? null : faceMask(sb, OPP[dir]!);
  r = true;
  for (let j = 0; j < 16; j++) if (((ma ? ma[j]! : 0) | (mb ? mb[j]! : 0)) !== 0xffff) { r = false; break; }
  occludeCache.set(key, r);
  return r;
}

/** FlowingFluid.canPassThroughWall: from a cell in `state` toward `dir` into a cell in `state2`. */
export function canPassThroughWall(dir: number, state: number, state2: number): boolean {
  return !mergedFaceOccludes(state, state2, dir);
}

/** BlockState.isFaceSturdy (approximated by the collision shape covering the face). */
function faceSturdy(state: number, face: number): boolean {
  const s = WALL_SHAPE[state]!;
  if (s < 0) return false;
  if (s === FULL_CUBE_SHAPE_ID) return true;
  const m = faceMask(s, face);
  for (let j = 0; j < 16; j++) if (m[j] !== 0xffff) return false;
  return true;
}

// ------------------------------------------------------------------ per-kind constants
export function tickDelay(kind: number, ultraWarm: boolean): number {
  return kind === KIND_WATER ? 5 : ultraWarm ? 10 : 30;
}
export function dropOff(kind: number, ultraWarm: boolean): number {
  return kind === KIND_WATER || ultraWarm ? 1 : 2;
}
export function slopeFindDistance(kind: number, ultraWarm: boolean): number {
  return kind === KIND_WATER || ultraWarm ? 4 : 2;
}

export interface StateReader {
  getState(x: number, y: number, z: number): number;
}

/** The world as the fluid code sees it (vanilla LevelAccessor + tick list). */
export interface FluidLevel extends StateReader {
  /** Level.setBlock with flag 3: the host notifies neighbours (and calls onBlockChanged). */
  setBlock(x: number, y: number, z: number, state: number): void;
  scheduleTick(x: number, y: number, z: number, type: number, delay: number): void;
  /** Block.dropResources (WaterFluid.beforeDestroyingBlock). */
  dropResources(x: number, y: number, z: number, state: number): void;
  /** levelEvent 1501: lava extinguish sound + smoke (LavaFluid.fizz / LiquidBlock.fizz). */
  fizz(x: number, y: number, z: number): void;
  nextInt(bound: number): number;
  /** DimensionType.ultraWarm (the Nether). */
  ultraWarm: boolean;
}

const fluidAt = (lv: StateReader, x: number, y: number, z: number): FluidCode => FLUID_OF[lv.getState(x, y, z)]!;

/** FluidState.getOwnHeight. */
export function ownHeight(f: FluidCode): number {
  return f === 0 ? 0 : fluidAmount(f) / 9;
}

/** FluidState.getHeight: 1 with the same fluid above. */
export function fluidHeight(lv: StateReader, x: number, y: number, z: number, f: FluidCode): number {
  if (f === 0) return 0;
  return fluidKind(fluidAt(lv, x, y + 1, z)) === fluidKind(f) ? 1 : ownHeight(f);
}

// ------------------------------------------------------------------ flow vector
/** FlowingFluid.getFlow: the (normalised) push direction of the fluid at (x,y,z). */
export function getFlow(lv: StateReader, x: number, y: number, z: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const self = fluidAt(lv, x, y, z);
  out[0] = out[1] = out[2] = 0;
  if (self === 0) return out;
  const kind = fluidKind(self);
  const own = ownHeight(self);
  let d = 0, e = 0;
  for (const dir of HORIZONTAL) {
    const nx = x + DX[dir]!, nz = z + DZ[dir]!;
    const ns = lv.getState(nx, y, nz);
    const nf = FLUID_OF[ns]!;
    if (nf !== 0 && fluidKind(nf) !== kind) continue; // affectsFlow
    let f = ownHeight(nf);
    let g = 0;
    if (f === 0) {
      if (MATERIAL_BLOCKS_MOTION[ns] !== 1) {
        const bf = fluidAt(lv, nx, y - 1, nz);
        if (bf === 0 || fluidKind(bf) === kind) {
          f = ownHeight(bf);
          if (f > 0) g = own - (f - 0.8888889);
        }
      }
    } else if (f > 0) g = own - f;
    if (g === 0) continue;
    d += DX[dir]! * g;
    e += DZ[dir]! * g;
  }
  let vx = d, vy = 0, vz = e;
  if (fluidIsFalling(self)) {
    for (const dir of HORIZONTAL) {
      const nx = x + DX[dir]!, nz = z + DZ[dir]!;
      if (isSolidFace(lv, kind, nx, y, nz, dir) || isSolidFace(lv, kind, nx, y + 1, nz, dir)) {
        const l = Math.hypot(vx, vy, vz);
        if (l < 1e-4) vx = vy = vz = 0;
        else (vx /= l), (vy /= l), (vz /= l);
        vy -= 6;
        break;
      }
    }
  }
  const l = Math.hypot(vx, vy, vz);
  if (l >= 1e-4) {
    out[0] = vx / l;
    out[1] = vy / l;
    out[2] = vz / l;
  }
  return out;
}

function isSolidFace(lv: StateReader, kind: number, x: number, y: number, z: number, dir: number): boolean {
  const s = lv.getState(x, y, z);
  const f = FLUID_OF[s]!;
  if (f !== 0 && fluidKind(f) === kind) return false;
  if (dir === UP) return true;
  if (ICE[s]) return false;
  return faceSturdy(s, dir);
}

// ------------------------------------------------------------------ spreading rules
/** FlowingFluid.canHoldFluid for a fluid type. */
function canHoldFluid(state: number, type: number): boolean {
  if (WATERLOGGABLE[state]) return getProp(state, 'waterlogged') !== true && type === FLUID_WATER;
  if (NEVER_HOLDS[state]) return false;
  return MATERIAL_BLOCKS_MOTION[state] !== 1;
}

/** FluidState.canBeReplacedWith for the fluid currently in a cell. */
function canBeReplacedWith(lv: StateReader, x: number, y: number, z: number, target: FluidCode, type: number, dir: number): boolean {
  if (target === 0) return true;
  const water = type === FLUID_WATER || type === FLUID_FLOWING_WATER;
  if (fluidKind(target) === KIND_WATER) return dir === DOWN && !water;
  return fluidHeight(lv, x, y, z, target) >= 0.44444445 && water;
}

function isSourceOfKind(f: FluidCode, kind: number): boolean {
  return f !== 0 && fluidKind(f) === kind && fluidIsSource(f);
}

const flowingType = (kind: number) => (kind === KIND_WATER ? FLUID_FLOWING_WATER : FLUID_FLOWING_LAVA);

function isWaterHole(kind: number, type: number, state: number, belowState: number): boolean {
  if (!canPassThroughWall(DOWN, state, belowState)) return false;
  const bf = FLUID_OF[belowState]!;
  if (bf !== 0 && fluidKind(bf) === kind) return true;
  return canHoldFluid(belowState, type);
}

function canPassThrough(kind: number, type: number, state: number, dir: number, state2: number): boolean {
  return !isSourceOfKind(FLUID_OF[state2]!, kind) && canPassThroughWall(dir, state, state2) && canHoldFluid(state2, type);
}

function canSpreadTo(lv: StateReader, state: number, dir: number, x2: number, y2: number, z2: number, state2: number, type: number): boolean {
  return canBeReplacedWith(lv, x2, y2, z2, FLUID_OF[state2]!, type, dir) && canPassThroughWall(dir, state, state2) && canHoldFluid(state2, type);
}

/** FlowingFluid.getNewLiquid: what the cell at (x,y,z) (in `state`) should hold given its neighbours. */
export function getNewLiquid(lv: StateReader, kind: number, ultraWarm: boolean, x: number, y: number, z: number, state: number): FluidCode {
  let i = 0, j = 0;
  for (const dir of HORIZONTAL) {
    const s2 = lv.getState(x + DX[dir]!, y, z + DZ[dir]!);
    const f2 = FLUID_OF[s2]!;
    if (f2 === 0 || fluidKind(f2) !== kind || !canPassThroughWall(dir, state, s2)) continue;
    if (fluidIsSource(f2)) j++;
    i = Math.max(i, fluidAmount(f2));
  }
  if (kind === KIND_WATER && j >= 2) {
    const below = lv.getState(x, y - 1, z);
    if (MATERIAL_SOLID[below] === 1 || isSourceOfKind(FLUID_OF[below]!, kind)) return makeFluid(kind, true, 8, false);
  }
  const above = lv.getState(x, y + 1, z);
  const fa = FLUID_OF[above]!;
  if (fa !== 0 && fluidKind(fa) === kind && canPassThroughWall(UP, state, above)) return makeFluid(kind, false, 8, true);
  const k = i - dropOff(kind, ultraWarm);
  return k <= 0 ? 0 : makeFluid(kind, false, k, false);
}

const cacheKey = (ox: number, oz: number, x: number, z: number) => (((x - ox + 128) & 0xff) << 8) | ((z - oz + 128) & 0xff);

/** FlowingFluid.getSlopeDistance: steps from (x,z) to the nearest hole, or 1000. */
function getSlopeDistance(
  lv: StateReader, kind: number, ultraWarm: boolean, x: number, y: number, z: number, distance: number, fromDir: number, state: number,
  ox: number, oz: number, states: Map<number, number>, holes: Map<number, boolean>,
): number {
  let best = 1000;
  const type = flowingType(kind);
  for (const dir of HORIZONTAL) {
    if (dir === fromDir) continue;
    const x2 = x + DX[dir]!, z2 = z + DZ[dir]!;
    const key = cacheKey(ox, oz, x2, z2);
    let s2 = states.get(key);
    if (s2 === undefined) states.set(key, (s2 = lv.getState(x2, y, z2)));
    if (!canPassThrough(kind, type, state, dir, s2)) continue;
    let hole = holes.get(key);
    if (hole === undefined) holes.set(key, (hole = isWaterHole(kind, type, s2, lv.getState(x2, y - 1, z2))));
    if (hole) return distance;
    if (distance >= slopeFindDistance(kind, ultraWarm)) continue;
    const j = getSlopeDistance(lv, kind, ultraWarm, x2, y, z2, distance + 1, OPP[dir]!, s2, ox, oz, states, holes);
    if (j < best) best = j;
  }
  return best;
}

/**
 * FlowingFluid.getSpread: the horizontal directions (with the fluid each would receive) that lead
 * along the shortest path to a drop. Returned in Direction ordinal order (north, south, west, east).
 */
export function getSpread(lv: StateReader, kind: number, ultraWarm: boolean, x: number, y: number, z: number, state: number): [number, FluidCode][] {
  let best = 1000;
  const found: [number, FluidCode, number][] = [];
  const states = new Map<number, number>();
  const holes = new Map<number, boolean>();
  const type = flowingType(kind);
  for (const dir of HORIZONTAL) {
    const x2 = x + DX[dir]!, z2 = z + DZ[dir]!;
    const key = cacheKey(x, z, x2, z2);
    let s2 = states.get(key);
    if (s2 === undefined) states.set(key, (s2 = lv.getState(x2, y, z2)));
    const nf = getNewLiquid(lv, kind, ultraWarm, x2, y, z2, s2);
    if (!canPassThrough(kind, fluidType(nf), state, dir, s2)) continue;
    let hole = holes.get(key);
    if (hole === undefined) holes.set(key, (hole = isWaterHole(kind, type, s2, lv.getState(x2, y - 1, z2))));
    const j = hole ? 0 : getSlopeDistance(lv, kind, ultraWarm, x2, y, z2, 1, OPP[dir]!, s2, x, z, states, holes);
    if (j < best) found.length = 0;
    if (j > best) continue;
    found.push([dir, nf, j]);
    best = j;
  }
  const out: [number, FluidCode][] = [];
  for (const dir of ENUM_ORDER) for (const f of found) if (f[0] === dir) out.push([dir, f[1]]);
  return out;
}

function sourceNeighborCount(lv: StateReader, kind: number, x: number, y: number, z: number): number {
  let n = 0;
  for (const dir of HORIZONTAL) if (isSourceOfKind(fluidAt(lv, x + DX[dir]!, y, z + DZ[dir]!), kind)) n++;
  return n;
}

// ------------------------------------------------------------------ writing
/** FlowingFluid.spreadTo (+ LavaFluid's stone-on-water rule). */
function spreadTo(lv: FluidLevel, kind: number, x: number, y: number, z: number, state: number, dir: number, f: FluidCode): void {
  if (kind === KIND_LAVA && dir === DOWN && fluidKind(FLUID_OF[state]!) === KIND_WATER) {
    if (isLiquidBlock(state)) lv.setBlock(x, y, z, STONE);
    lv.fizz(x, y, z);
    return;
  }
  if (WATERLOGGABLE[state] || PLANT_CONTAINER.has(STATE_TO_BLOCK[state]!)) {
    // LiquidBlockContainer.placeLiquid (SimpleWaterloggedBlock): only a water source waterlogs
    if (WATERLOGGABLE[state] && getProp(state, 'waterlogged') !== true && fluidType(f) === FLUID_WATER) {
      lv.setBlock(x, y, z, withProp(state, 'waterlogged', true));
      lv.scheduleTick(x, y, z, FLUID_WATER, tickDelay(KIND_WATER, lv.ultraWarm));
    }
    return;
  }
  if (IS_AIR[state] !== 1) {
    // beforeDestroyingBlock: water drops the block's loot, lava just fizzes
    if (kind === KIND_WATER) lv.dropResources(x, y, z, state);
    else lv.fizz(x, y, z);
  }
  lv.setBlock(x, y, z, legacyBlock(f));
}

function spreadToSides(lv: FluidLevel, kind: number, x: number, y: number, z: number, f: FluidCode, state: number): void {
  let i = fluidAmount(f) - dropOff(kind, lv.ultraWarm);
  if (fluidIsFalling(f)) i = 7;
  if (i <= 0) return;
  for (const [dir, nf] of getSpread(lv, kind, lv.ultraWarm, x, y, z, state)) {
    const x2 = x + DX[dir]!, z2 = z + DZ[dir]!;
    const s2 = lv.getState(x2, y, z2);
    if (!canSpreadTo(lv, state, dir, x2, y, z2, s2, fluidType(nf))) continue;
    spreadTo(lv, kind, x2, y, z2, s2, dir, nf);
  }
}

/** FlowingFluid.spread. */
function spread(lv: FluidLevel, x: number, y: number, z: number, f: FluidCode): void {
  if (f === 0) return;
  const kind = fluidKind(f);
  const state = lv.getState(x, y, z);
  const belowState = lv.getState(x, y - 1, z);
  const nf = getNewLiquid(lv, kind, lv.ultraWarm, x, y - 1, z, belowState);
  if (y > 0 && canSpreadTo(lv, state, DOWN, x, y - 1, z, belowState, fluidType(nf))) {
    spreadTo(lv, kind, x, y - 1, z, belowState, DOWN, nf);
    if (sourceNeighborCount(lv, kind, x, y, z) >= 3) spreadToSides(lv, kind, x, y, z, f, state);
  } else if (fluidIsSource(f) || !isWaterHole(kind, fluidType(nf), state, belowState)) {
    spreadToSides(lv, kind, x, y, z, f, state);
  }
}

/** LavaFluid.getSpreadDelay (water: the plain tick delay). */
function spreadDelay(lv: FluidLevel, kind: number, x: number, y: number, z: number, f: FluidCode, nf: FluidCode): number {
  let i = tickDelay(kind, lv.ultraWarm);
  if (kind === KIND_LAVA && f !== 0 && nf !== 0 && !fluidIsFalling(f) && !fluidIsFalling(nf) &&
    fluidHeight(lv, x, y, z, nf) > fluidHeight(lv, x, y, z, f) && lv.nextInt(4) !== 0) i *= 4;
  return i;
}

/**
 * A scheduled fluid tick at (x,y,z) for fluid `type` (ServerLevel.tickLiquid → FlowingFluid.tick).
 * Ignored when the cell no longer holds that fluid type.
 */
export function tickFluid(lv: FluidLevel, x: number, y: number, z: number, type: number): void {
  let f = fluidAt(lv, x, y, z);
  if (f === 0 || fluidType(f) !== type) return;
  const kind = fluidKind(f);
  if (!fluidIsSource(f)) {
    const nf = getNewLiquid(lv, kind, lv.ultraWarm, x, y, z, lv.getState(x, y, z));
    const delay = spreadDelay(lv, kind, x, y, z, f, nf);
    if (nf === 0) {
      f = nf;
      lv.setBlock(x, y, z, 0);
    } else if (nf !== f) {
      f = nf;
      lv.setBlock(x, y, z, legacyBlock(nf));
      lv.scheduleTick(x, y, z, fluidType(nf), delay);
    }
  }
  spread(lv, x, y, z, f);
}

/**
 * LiquidBlock.shouldSpreadLiquid: lava touching water (above or beside) hardens into obsidian
 * (source) or cobblestone; lava above soul soil touching blue ice becomes basalt.
 */
function shouldSpreadLiquid(lv: FluidLevel, x: number, y: number, z: number, state: number): boolean {
  if (STATE_TO_BLOCK[state] !== ID_LAVA) return true;
  const soulSoil = STATE_TO_BLOCK[lv.getState(x, y - 1, z)] === ID_SOUL_SOIL;
  for (const d of LAVA_CONTACT) {
    const s2 = lv.getState(x + DX[d]!, y + DY[d]!, z + DZ[d]!);
    if (fluidKind(FLUID_OF[s2]!) === KIND_WATER) {
      lv.setBlock(x, y, z, fluidIsSource(FLUID_OF[state]!) ? OBSIDIAN : COBBLESTONE);
      lv.fizz(x, y, z);
      return false;
    }
    if (soulSoil && STATE_TO_BLOCK[s2] === ID_BLUE_ICE) {
      lv.setBlock(x, y, z, BASALT);
      lv.fizz(x, y, z);
      return false;
    }
  }
  return true;
}

/** LiquidBlock.onPlace / neighborChanged: schedule the fluid's tick unless lava hardened. */
function liquidUpdate(lv: FluidLevel, x: number, y: number, z: number, state: number): void {
  if (!shouldSpreadLiquid(lv, x, y, z, state)) return;
  const f = FLUID_OF[state]!;
  lv.scheduleTick(x, y, z, fluidType(f), tickDelay(fluidKind(f), lv.ultraWarm));
}

/**
 * Call after any block change at (x,y,z) (Level.setBlock with neighbour/shape updates): runs
 * LiquidBlock.onPlace for a new liquid, neighborChanged on liquid neighbours and the waterlogged
 * blocks' updateShape → scheduleTick(WATER).
 */
export function onBlockChanged(lv: FluidLevel, x: number, y: number, z: number, oldState: number, newState: number): void {
  if (isLiquidBlock(newState)) liquidUpdate(lv, x, y, z, newState);
  else if (isWaterlogged(newState) && !(FLUID[oldState] === 1 && FLUID_LEVEL[oldState] === 0)) {
    // SimpleWaterloggedBlock.placeLiquid (a bucket emptied into the block)
    lv.scheduleTick(x, y, z, FLUID_WATER, tickDelay(KIND_WATER, lv.ultraWarm));
  }
  for (let d = 0; d < 6; d++) {
    const nx = x + DX[d]!, ny = y + DY[d]!, nz = z + DZ[d]!;
    if (ny < 0 || ny > 255) continue;
    const ns = lv.getState(nx, ny, nz);
    if (ns === 0) continue;
    if (isLiquidBlock(ns)) {
      // the liquid may have changed already (a recursive hardening), so re-read before acting
      liquidUpdate(lv, nx, ny, nz, ns);
    } else if (isWaterlogged(ns)) lv.scheduleTick(nx, ny, nz, FLUID_WATER, tickDelay(KIND_WATER, lv.ultraWarm));
  }
}

/** The fluid tick type for whatever fluid a state holds (0 if none): used to schedule spring ticks. */
export function fluidTickType(state: number): number {
  return fluidType(FLUID_OF[state]!);
}
