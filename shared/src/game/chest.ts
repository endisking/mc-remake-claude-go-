/**
 * Chest placement and double-chest connection (vanilla ChestBlock.getStateForPlacement /
 * updateShape / getConnectedDirection, DoubleBlockCombiner).
 */
import { BLOCKS_BY_NAME } from '../data';
import { blockNameOf, getProp, withProp } from '../world/blockstate';
import type { StateGetter } from '../world/raycast';

type HDir = 'north' | 'south' | 'west' | 'east';
const H: HDir[] = ['north', 'south', 'west', 'east'];
const HX: Record<HDir, number> = { north: 0, south: 0, west: -1, east: 1 };
const HZ: Record<HDir, number> = { north: -1, south: 1, west: 0, east: 0 };
const CW: Record<HDir, HDir> = { north: 'east', east: 'south', south: 'west', west: 'north' };
const CCW: Record<HDir, HDir> = { north: 'west', west: 'south', south: 'east', east: 'north' };
const OPP: Record<HDir, HDir> = { north: 'south', south: 'north', west: 'east', east: 'west' };
const FACE_NAMES = ['down', 'up', 'north', 'south', 'west', 'east'] as const;

export function isChest(name: string): boolean {
  return name === 'chest' || name === 'trapped_chest';
}

/** getConnectedDirection: LEFT halves connect clockwise of their facing, RIGHT halves counter-clockwise. */
export function connectedDirection(state: number): HDir {
  const f = getProp(state, 'facing') as HDir;
  return getProp(state, 'type') === 'left' ? CW[f] : CCW[f];
}

function horizontalFacing(yaw: number): HDir {
  const i = Math.floor(((((yaw % 360) + 360) % 360) / 90) + 0.5) & 3;
  return (['south', 'west', 'north', 'east'] as const)[i]!;
}

export interface ChestPlaceContext {
  world: StateGetter;
  x: number;
  y: number;
  z: number;
  face: number;
  yaw: number;
  sneaking: boolean;
}

/** ChestBlock.getStateForPlacement. */
export function chestStateForPlacement(block: string, ctx: ChestPlaceContext, existing: number): number {
  const b = BLOCKS_BY_NAME.get(block)!;
  let type: 'single' | 'left' | 'right' = 'single';
  let facing = OPP[horizontalFacing(ctx.yaw)];
  const sneak = ctx.sneaking;
  const clicked = FACE_NAMES[ctx.face]!;
  const partner = (d: HDir): HDir | null => {
    const n = ctx.world.getState(ctx.x + HX[d], ctx.y, ctx.z + HZ[d]);
    return blockNameOf(n) === block && getProp(n, 'type') === 'single' ? (getProp(n, 'facing') as HDir) : null;
  };
  if (clicked !== 'up' && clicked !== 'down' && sneak) {
    const c = clicked as HDir;
    const d = partner(OPP[c]);
    // a partner facing along the clicked axis can't pair
    if (d && d !== c && d !== OPP[c]) {
      facing = d;
      type = CCW[d] === OPP[c] ? 'right' : 'left';
    }
  }
  if (type === 'single' && !sneak) {
    if (facing === partner(CW[facing])) type = 'left';
    else if (facing === partner(CCW[facing])) type = 'right';
  }
  let s = withProp(withProp(b.defaultState, 'facing', facing), 'type', type);
  s = withProp(s, 'waterlogged', blockNameOf(existing) === 'water' && getProp(existing, 'level') === 0);
  return s;
}

/** ChestBlock.updateShape applied for every horizontal neighbour. */
export function chestUpdateShape(world: StateGetter, x: number, y: number, z: number, state: number): number {
  const name = blockNameOf(state);
  const facing = getProp(state, 'facing') as HDir;
  if (getProp(state, 'type') !== 'single') {
    const d = connectedDirection(state);
    const n = world.getState(x + HX[d], y, z + HZ[d]);
    const ok = blockNameOf(n) === name && getProp(n, 'type') !== 'single' && getProp(n, 'type') !== getProp(state, 'type') && getProp(n, 'facing') === facing && connectedDirection(n) === OPP[d];
    if (!ok) return withProp(state, 'type', 'single');
    return state;
  }
  for (const d of H) {
    const n = world.getState(x + HX[d], y, z + HZ[d]);
    if (blockNameOf(n) !== name) continue;
    const ct = getProp(n, 'type');
    if (ct !== 'single' && getProp(n, 'facing') === facing && connectedDirection(n) === OPP[d]) {
      return withProp(state, 'type', ct === 'left' ? 'right' : 'left');
    }
  }
  return state;
}

/** The other half of a double chest, or null. */
export function chestPartner(world: StateGetter, x: number, y: number, z: number): [number, number, number] | null {
  const st = world.getState(x, y, z);
  if (!isChest(blockNameOf(st)) || getProp(st, 'type') === 'single') return null;
  const d = connectedDirection(st);
  const ox = x + HX[d], oz = z + HZ[d];
  const n = world.getState(ox, y, oz);
  if (blockNameOf(n) !== blockNameOf(st) || getProp(n, 'type') === 'single' || getProp(n, 'facing') !== getProp(st, 'facing')) return null;
  return [ox, y, oz];
}

/** DoubleBlockCombiner: the RIGHT half holds the first (top) 27 slots. */
export function isFirstHalf(state: number): boolean {
  return getProp(state, 'type') !== 'left';
}
