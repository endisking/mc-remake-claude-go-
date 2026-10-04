/**
 * Block placement (BlockItem.place → Block.getStateForPlacement) and neighbour-dependent
 * shapes (Block.updateShape) for the common block families. Shared by client prediction
 * and the authoritative server.
 */
import { BLOCKS_BY_NAME, BLOCKS } from '../data';
import { STATE_TO_BLOCK, getProp, withProp, blockNameOf } from '../world/blockstate';
import { FLUID, FLUID_LEVEL, FULL_COLLISION, IS_AIR } from '../world/blockinfo';
import type { StateGetter } from '../world/raycast';
import { leavesDistance, touchesWater, concreteOf } from './growth';

export const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'] as const;
export type Dir = (typeof DIRS)[number];
export const DX = [0, 0, 0, 0, -1, 1];
export const DY = [-1, 1, 0, 0, 0, 0];
export const DZ = [0, 0, -1, 1, 0, 0];
const OPP = [1, 0, 3, 2, 5, 4];

export interface PlaceContext {
  world: StateGetter;
  /** position the block will go */
  x: number;
  y: number;
  z: number;
  /** clicked face index (0..5) */
  face: number;
  /** hit position within the clicked block (0..1) */
  hx: number;
  hy: number;
  hz: number;
  yaw: number;
  pitch: number;
  sneaking: boolean;
}

/** Horizontal facing the player looks toward (vanilla Direction.fromYRot). */
export function horizontalFacing(yaw: number): Dir {
  const i = Math.floor(((((yaw % 360) + 360) % 360) / 90) + 0.5) & 3;
  return (['south', 'west', 'north', 'east'] as const)[i]!;
}

function opposite(d: Dir): Dir {
  return DIRS[OPP[DIRS.indexOf(d)]!]!;
}

/** Nearest looking direction including up/down (vanilla getNearestLookingDirection). */
export function nearestLookingDirection(yaw: number, pitch: number): Dir {
  const p = (pitch * Math.PI) / 180, y = (-yaw * Math.PI) / 180;
  const fx = Math.sin(y) * Math.cos(p), fy = -Math.sin(p), fz = Math.cos(y) * Math.cos(p);
  const ax = Math.abs(fx), ay = Math.abs(fy), az = Math.abs(fz);
  if (ay > ax && ay > az) return fy > 0 ? 'up' : 'down';
  if (ax > az) return fx > 0 ? 'east' : 'west';
  return fz > 0 ? 'south' : 'north';
}

// ------------------------------------------------------------------ block families
const names = new Set(BLOCKS.map((b) => b.name));
const has = (b: string, prop: string) => BLOCKS_BY_NAME.get(b)!.states.some((s) => s.name === prop);

/** Replaceable by placement (vanilla Material.replaceable). */
const REPLACEABLE = new Set([
  'air', 'cave_air', 'void_air', 'water', 'lava', 'grass', 'fern', 'dead_bush', 'vine', 'glow_lichen', 'tall_grass', 'large_fern',
  'seagrass', 'tall_seagrass', 'fire', 'soul_fire', 'structure_void', 'light', 'crimson_roots', 'warped_roots', 'nether_sprouts', 'hanging_roots',
]);

export function isReplaceable(state: number, placing?: string): boolean {
  const name = blockNameOf(state);
  if (name === 'snow') return getProp(state, 'layers') === 1 && placing !== 'snow';
  return REPLACEABLE.has(name);
}

function isWater(state: number): boolean {
  return FLUID[state] === 1 && FLUID_LEVEL[state] === 0 && blockNameOf(state) === 'water';
}

const FENCE_GATES = new Set([...names].filter((n) => n.endsWith('_fence_gate')));
const FENCES = new Set([...names].filter((n) => n.endsWith('_fence')));
const WALLS = new Set([...names].filter((n) => n.endsWith('_wall') && n !== 'wall_torch' && !n.endsWith('_wall_torch') && !n.endsWith('_wall_sign') && !n.endsWith('_wall_banner') && !n.endsWith('_wall_head') && !n.endsWith('_wall_skull') && !n.endsWith('_wall_fan')));
const PANES = new Set([...names].filter((n) => n.endsWith('glass_pane') || n === 'iron_bars'));

/** Does the neighbour present a full solid face toward us (vanilla isFaceSturdy, approximated by full collision)? */
function sturdy(state: number): boolean {
  return FULL_COLLISION[state] === 1;
}

function connectsFence(self: string, n: number, sideToUs: number): boolean {
  const nn = blockNameOf(n);
  if (FENCES.has(nn)) return (self === 'nether_brick_fence') === (nn === 'nether_brick_fence');
  if (FENCE_GATES.has(nn)) {
    const f = getProp(n, 'facing') as string;
    const axisX = f === 'east' || f === 'west';
    return axisX ? sideToUs >= 2 && sideToUs <= 3 : sideToUs >= 4;
  }
  return sturdy(n) && !isLeavesOrShulker(nn);
}

function connectsPane(n: number): boolean {
  const nn = blockNameOf(n);
  return PANES.has(nn) || WALLS.has(nn) || sturdy(n) && !isLeavesOrShulker(nn);
}

function connectsWall(n: number, sideToUs: number): boolean {
  const nn = blockNameOf(n);
  if (WALLS.has(nn) || PANES.has(nn)) return true;
  if (FENCE_GATES.has(nn)) {
    const f = getProp(n, 'facing') as string;
    const axisX = f === 'east' || f === 'west';
    return axisX ? sideToUs >= 2 && sideToUs <= 3 : sideToUs >= 4;
  }
  return sturdy(n) && !isLeavesOrShulker(nn);
}

function isLeavesOrShulker(n: string): boolean {
  return n.endsWith('_leaves') || n.endsWith('shulker_box') || n === 'barrier' || n === 'pumpkin' || n === 'melon' || n === 'carved_pumpkin' || n === 'jack_o_lantern';
}

/**
 * Recompute neighbour-dependent properties of `state` at (x,y,z) (vanilla updateShape for
 * fences, panes, walls, stairs, snowy grass). Returns the new state.
 */
export function updateShape(world: StateGetter, x: number, y: number, z: number, state: number): number {
  const name = blockNameOf(state);
  const nb = (d: number) => world.getState(x + DX[d]!, y + DY[d]!, z + DZ[d]!);
  if (FENCES.has(name)) {
    for (let d = 2; d < 6; d++) state = withProp(state, DIRS[d]!, connectsFence(name, nb(d), OPP[d]!));
    return state;
  }
  if (PANES.has(name)) {
    for (let d = 2; d < 6; d++) state = withProp(state, DIRS[d]!, connectsPane(nb(d)));
    return state;
  }
  if (WALLS.has(name)) {
    const conn = [false, false, false, false, false, false];
    for (let d = 2; d < 6; d++) conn[d] = connectsWall(nb(d), OPP[d]!);
    const above = nb(1);
    const aboveName = blockNameOf(above);
    // tall sides when the block above covers that side (approximation of the 1.17 wall rules)
    const tallAbove = FULL_COLLISION[above] === 1 || WALLS.has(aboveName);
    for (let d = 2; d < 6; d++) state = withProp(state, DIRS[d]!, conn[d] ? (tallAbove ? 'tall' : 'low') : 'none');
    // post shown unless exactly two opposite sides connect (and nothing above forces it)
    const ns = conn[2] && conn[3] && !conn[4] && !conn[5];
    const ew = conn[4] && conn[5] && !conn[2] && !conn[3];
    const up = !(ns || ew) || (WALLS.has(aboveName) && getProp(above, 'up') === true) || aboveName.includes('torch') || aboveName.includes('lantern');
    return withProp(state, 'up', up);
  }
  if (name.endsWith('_stairs')) return withProp(state, 'shape', stairShape(world, x, y, z, state));
  if (FENCE_GATES.has(name)) {
    // FenceGateBlock: lowered when a wall is on either side
    const f = getProp(state, 'facing');
    const sides = f === 'north' || f === 'south' ? [4, 5] : [2, 3];
    return withProp(state, 'in_wall', sides.some((d) => WALLS.has(blockNameOf(nb(d)))));
  }
  if (name === 'grass_block' || name === 'podzol' || name === 'mycelium') {
    const a = blockNameOf(nb(1));
    return withProp(state, 'snowy', a === 'snow_block' || a === 'snow' || a === 'powder_snow');
  }
  return state;
}

/** Vanilla StairBlock.getStairsShape. */
export function stairShape(world: StateGetter, x: number, y: number, z: number, state: number): string {
  const facing = getProp(state, 'facing') as Dir;
  const half = getProp(state, 'half');
  const fi = DIRS.indexOf(facing);
  const isStairs = (s: number) => blockNameOf(s).endsWith('_stairs');
  const ccw: Record<string, Dir> = { north: 'west', west: 'south', south: 'east', east: 'north' };
  const cw: Record<string, Dir> = { north: 'east', east: 'south', south: 'west', west: 'north' };
  const front = world.getState(x + DX[fi]!, y, z + DZ[fi]!);
  if (isStairs(front) && getProp(front, 'half') === half) {
    const f2 = getProp(front, 'facing') as Dir;
    if ((f2 === ccw[facing] || f2 === cw[facing]) && canTakeShape(world, x, y, z, state, opposite(f2))) {
      return f2 === ccw[facing] ? 'outer_left' : 'outer_right';
    }
  }
  const oi = OPP[fi]!;
  const back = world.getState(x + DX[oi]!, y, z + DZ[oi]!);
  if (isStairs(back) && getProp(back, 'half') === half) {
    const f3 = getProp(back, 'facing') as Dir;
    if ((f3 === ccw[facing] || f3 === cw[facing]) && canTakeShape(world, x, y, z, state, f3)) {
      return f3 === ccw[facing] ? 'inner_left' : 'inner_right';
    }
  }
  return 'straight';
}

function canTakeShape(world: StateGetter, x: number, y: number, z: number, state: number, d: Dir): boolean {
  const di = DIRS.indexOf(d);
  const n = world.getState(x + DX[di]!, y, z + DZ[di]!);
  return !blockNameOf(n).endsWith('_stairs') || getProp(n, 'facing') !== getProp(state, 'facing') || getProp(n, 'half') !== getProp(state, 'half');
}

// ------------------------------------------------------------------ getStateForPlacement
const AXIS_BLOCKS = (n: string) => has(n, 'axis') && !n.includes('portal');

/**
 * State for placing `block` in context, or null if it can't be placed there.
 * `existing` is the state currently at the target position.
 */
export function stateForPlacement(block: string, ctx: PlaceContext, existing: number): number | null {
  const b = BLOCKS_BY_NAME.get(block);
  if (!b) return null;
  let s = b.defaultState;
  const face = DIRS[ctx.face]!;
  const water = isWater(existing);
  const setWater = () => {
    if (has(block, 'waterlogged')) s = withProp(s, 'waterlogged', water);
  };
  const below = ctx.world.getState(ctx.x, ctx.y - 1, ctx.z);
  const playerFacing = horizontalFacing(ctx.yaw);

  // slabs merge into doubles
  if (block.endsWith('_slab')) {
    if (blockNameOf(existing) === block && getProp(existing, 'type') !== 'double') return withProp(withProp(existing, 'type', 'double'), 'waterlogged', false);
    const top = face === 'down' || (face !== 'up' && ctx.hy > 0.5);
    s = withProp(s, 'type', top ? 'top' : 'bottom');
    setWater();
    return s;
  }
  if (block === 'snow' && blockNameOf(existing) === 'snow') {
    const l = getProp(existing, 'layers') as number;
    return l < 8 ? withProp(existing, 'layers', l + 1) : null;
  }
  if (block.endsWith('_stairs')) {
    s = withProp(s, 'facing', playerFacing);
    s = withProp(s, 'half', face === 'down' || (face !== 'up' && ctx.hy > 0.5) ? 'top' : 'bottom');
    setWater();
    return withProp(s, 'shape', stairShape(ctx.world, ctx.x, ctx.y, ctx.z, s));
  }
  if (block === 'torch' || block === 'soul_torch' || block === 'redstone_torch') {
    if (face === 'up' || face === 'down') {
      if (face === 'down') return wallTorch(block, ctx, playerFacing);
      return sturdyTop(below) ? s : null;
    }
    return wallTorch(block, ctx, face);
  }
  if (block.endsWith('_button') || block === 'lever') {
    const f = face === 'up' ? 'floor' : face === 'down' ? 'ceiling' : 'wall';
    s = withProp(s, 'face', f);
    s = withProp(s, 'facing', f === 'wall' ? face : playerFacing);
    return s;
  }
  if (block === 'ladder') {
    if (face === 'up' || face === 'down') return null;
    s = withProp(s, 'facing', face);
    setWater();
    return s;
  }
  if (block.endsWith('_trapdoor')) {
    if (face === 'up' || face === 'down') {
      s = withProp(s, 'facing', opposite(playerFacing));
      s = withProp(s, 'half', face === 'up' ? 'bottom' : 'top');
    } else {
      s = withProp(s, 'facing', face);
      s = withProp(s, 'half', ctx.hy > 0.5 ? 'top' : 'bottom');
    }
    setWater();
    return s;
  }
  if (block.endsWith('_door')) {
    s = withProp(s, 'facing', playerFacing);
    s = withProp(s, 'half', 'lower');
    return withProp(s, 'hinge', doorHinge(block, ctx, playerFacing));
  }
  if (block.endsWith('_sign')) {
    // SignBlock / WallSignBlock.getStateForPlacement
    if (face === 'up' || face === 'down') {
      s = withProp(s, 'rotation', Math.floor(((180 + ctx.yaw) * 16) / 360 + 0.5) & 15);
    } else {
      const wall = BLOCKS_BY_NAME.get(block.replace('_sign', '_wall_sign'));
      if (!wall) return null;
      s = withProp(wall.defaultState, 'facing', face);
    }
    setWater();
    return s;
  }
  if (block.endsWith('_leaves')) {
    // LeavesBlock.getStateForPlacement: player-placed leaves never decay
    s = withProp(s, 'persistent', true);
    return withProp(s, 'distance', leavesDistance(ctx.world, ctx.x, ctx.y, ctx.z));
  }
  if (block.endsWith('_concrete_powder') && (isWater(existing) || touchesWater(ctx.world, ctx.x, ctx.y, ctx.z))) {
    return BLOCKS_BY_NAME.get(concreteOf(block))!.defaultState;
  }
  if (block.endsWith('_bed')) {
    // BedBlock.getStateForPlacement: the head goes one block further in the look direction
    const d = DIRS.indexOf(playerFacing as (typeof DIRS)[number]);
    const head = ctx.world.getState(ctx.x + DX[d]!, ctx.y, ctx.z + DZ[d]!);
    if (!isReplaceable(head, block)) return null;
    s = withProp(s, 'facing', playerFacing);
    s = withProp(s, 'part', 'foot');
    s = withProp(s, 'occupied', false);
    return s;
  }
  if (FENCES.has(block) || PANES.has(block) || WALLS.has(block)) {
    setWater();
    return updateShape(ctx.world, ctx.x, ctx.y, ctx.z, s);
  }
  if (block.endsWith('_fence_gate')) return updateShape(ctx.world, ctx.x, ctx.y, ctx.z, withProp(s, 'facing', playerFacing));
  if (AXIS_BLOCKS(block)) {
    const axis = face === 'up' || face === 'down' ? 'y' : face === 'north' || face === 'south' ? 'z' : 'x';
    s = withProp(s, 'axis', axis);
    setWater();
    return s;
  }
  // blocks facing toward the player (furnace, chest, carved pumpkin, ...): horizontal facing opposite to look
  if (has(block, 'facing')) {
    const vals = b.states.find((p) => p.name === 'facing')!.values ?? [];
    if (vals.length === 4) s = withProp(s, 'facing', opposite(playerFacing));
    else if (vals.length === 6) {
      // directional blocks (dispenser, observer, piston...) face away from the player's look
      const look = nearestLookingDirection(ctx.yaw, ctx.pitch);
      s = withProp(s, 'facing', block === 'observer' ? look : opposite(look));
    }
  }
  if (block === 'grass' || block === 'fern' || block.endsWith('_sapling') || isFlower(block) || block === 'dead_bush') {
    if (!plantSurvives(block, below)) return null;
  }
  setWater();
  if (has(block, 'snowy')) s = updateShape(ctx.world, ctx.x, ctx.y, ctx.z, s);
  return s;
}

function sturdyTop(state: number): boolean {
  return FULL_COLLISION[state] === 1 || blockNameOf(state).endsWith('_fence') || WALLS.has(blockNameOf(state));
}

function wallTorch(block: string, ctx: PlaceContext, face: Dir): number | null {
  const wall = block === 'torch' ? 'wall_torch' : block === 'soul_torch' ? 'soul_wall_torch' : 'redstone_wall_torch';
  const fi = DIRS.indexOf(face);
  // the supporting block is behind the torch (opposite of its facing)
  const support = ctx.world.getState(ctx.x - DX[fi]!, ctx.y, ctx.z - DZ[fi]!);
  if (!sturdy(support)) return null;
  return withProp(BLOCKS_BY_NAME.get(wall)!.defaultState, 'facing', face);
}

const FLOWERS = new Set(['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose']);
function isFlower(n: string): boolean {
  return FLOWERS.has(n);
}

const PLANT_SOIL = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'farmland', 'rooted_dirt', 'moss_block', 'mycelium']);
/** Vanilla BushBlock.mayPlaceOn (dirt family). */
export function plantSurvives(_block: string, below: number): boolean {
  return PLANT_SOIL.has(blockNameOf(below));
}

/** States that must accompany a placement (door upper half, bed head, tall plant top). */
export function companionPlacement(block: string, state: number): { dx: number; dy: number; dz: number; state: number }[] {
  if (block.endsWith('_door')) return [{ dx: 0, dy: 1, dz: 0, state: withProp(state, 'half', 'upper') }];
  if (block.endsWith('_bed')) {
    const d = DIRS.indexOf(getProp(state, 'facing') as (typeof DIRS)[number]);
    return [{ dx: DX[d]!, dy: 0, dz: DZ[d]!, state: withProp(state, 'part', 'head') }];
  }
  if (['tall_grass', 'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony'].includes(block)) return [{ dx: 0, dy: 1, dz: 0, state: withProp(state, 'half', 'upper') }];
  return [];
}

export function isAirState(s: number): boolean {
  return IS_AIR[s] === 1;
}

export { STATE_TO_BLOCK };

/** DoorBlock.getHinge: away from solid blocks and toward a neighbouring door, else by the click position. */
function doorHinge(block: string, ctx: PlaceContext, dir: Dir): 'left' | 'right' {
  const w = ctx.world;
  const di = DIRS.indexOf(dir);
  const ccwOf: Record<string, Dir> = { north: 'west', west: 'south', south: 'east', east: 'north' };
  const cwOf: Record<string, Dir> = { north: 'east', east: 'south', south: 'west', west: 'north' };
  const l = DIRS.indexOf(ccwOf[dir]!), r = DIRS.indexOf(cwOf[dir]!);
  const at = (d: number, dy: number) => w.getState(ctx.x + DX[d]!, ctx.y + dy, ctx.z + DZ[d]!);
  const full = (st: number) => (FULL_COLLISION[st] === 1 ? 1 : 0);
  const i = -full(at(l, 0)) - full(at(l, 1)) + full(at(r, 0)) + full(at(r, 1));
  const ls = at(l, 0), rs = at(r, 0);
  const lDoor = blockNameOf(ls) === block && getProp(ls, 'half') === 'lower';
  const rDoor = blockNameOf(rs) === block && getProp(rs, 'half') === 'lower';
  if ((lDoor && !rDoor) || i > 0) return 'right';
  if ((rDoor && !lDoor) || i < 0) return 'left';
  const j = DX[di]!, k = DZ[di]!;
  // click position relative to the door's block (the hit is on the clicked block, one step back along the face)
  const d = ctx.hx - DX[ctx.face]!, e = ctx.hz - DZ[ctx.face]!;
  return (j >= 0 || !(e < 0.5)) && (j <= 0 || !(e > 0.5)) && (k >= 0 || !(d > 0.5)) && (k <= 0 || !(d < 0.5)) ? 'left' : 'right';
}
