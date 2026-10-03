/**
 * Per-state lookup tables (typed arrays indexed by state id) for hot paths:
 * light emission/filtering, collision shapes, fluids, solidity.
 */
import { BLOCKS, BLOCKS_BY_NAME, COLLISION_SHAPES, BLOCK_STATE_COUNT, type BlockData } from '../data';
import { getProp } from './blockstate';

const N = BLOCK_STATE_COUNT;

/** Light emitted by a state (0–15). */
export const LIGHT_EMIT = new Uint8Array(N);
/** Light opacity: how much light is reduced passing through (0–15). */
export const LIGHT_FILTER = new Uint8Array(N);
/**
 * For blocks that occlude light by their shape (slabs, stairs, snow, ...): bitmask of
 * faces (see Face) fully covered by the shape. 0 for all other blocks.
 */
export const LIGHT_FACE_OCCLUSION = new Uint8Array(N);
/** 1 if the block uses shape-based (directional) light occlusion. */
export const USE_SHAPE_LIGHT = new Uint8Array(N);
/** Collision boxes per state, as an index into COLLISION_SHAPES. */
export const COLLISION_SHAPE_ID = new Uint16Array(N);
/** 1 if the collision shape is exactly the full cube. */
export const FULL_COLLISION = new Uint8Array(N);
/** 1 for air, cave_air, void_air. */
export const IS_AIR = new Uint8Array(N);
/** 0 none, 1 water (source or flowing or waterlogged), 2 lava. */
export const FLUID = new Uint8Array(N);
/** Fluid level 0 (source/full) .. 7 for flowing; 8+ = falling. -1 stored as 255 when no fluid. */
export const FLUID_LEVEL = new Uint8Array(N).fill(255);

/** Face indices used everywhere: down, up, north(-z), south(+z), west(-x), east(+x). */
export const Face = { Down: 0, Up: 1, North: 2, South: 3, West: 4, East: 5 } as const;
export const FACE_DX = [0, 0, 0, 0, -1, 1] as const;
export const FACE_DY = [-1, 1, 0, 0, 0, 0] as const;
export const FACE_DZ = [0, 0, -1, 1, 0, 0] as const;
export const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4] as const;

/** Blocks whose light occlusion follows their shape (vanilla `useShapeForLightOcclusion`). */
const SHAPE_LIGHT_BLOCKS = (b: BlockData) =>
  b.name.endsWith('_slab') ||
  b.name.endsWith('_stairs') ||
  b.name === 'snow' ||
  b.name === 'farmland' ||
  b.name === 'dirt_path' ||
  b.name === 'daylight_detector' ||
  b.name === 'lectern' ||
  b.name === 'stonecutter' ||
  b.name === 'enchanting_table' ||
  b.name === 'end_portal_frame' ||
  b.name === 'sculk_sensor';

/**
 * State-dependent light emission (vanilla `lightLevel` functions). minecraft-data gives a
 * single per-block value; these override it per state.
 */
function emissionFor(b: BlockData, s: number): number {
  const n = b.name;
  const lit = () => getProp(s, 'lit') === true;
  switch (n) {
    case 'redstone_lamp':
      return lit() ? 15 : 0;
    case 'furnace':
    case 'blast_furnace':
    case 'smoker':
      return lit() ? 13 : 0;
    case 'redstone_ore':
    case 'deepslate_redstone_ore':
      return lit() ? 9 : 0;
    case 'redstone_torch':
    case 'redstone_wall_torch':
      return lit() ? 7 : 0;
    case 'campfire':
      return lit() ? 15 : 0;
    case 'soul_campfire':
      return lit() ? 10 : 0;
    case 'sea_pickle':
      return getProp(s, 'waterlogged') === true ? 3 + 3 * ((getProp(s, 'pickles') as number) - 1) : 0;
    case 'respawn_anchor':
      return [0, 3, 7, 11, 15][getProp(s, 'charges') as number]!;
    case 'light':
      return getProp(s, 'level') as number;
    case 'cave_vines':
    case 'cave_vines_plant':
      return getProp(s, 'berries') === true ? 14 : 0;
    case 'glow_lichen':
      return 7;
    case 'enchanting_table':
      return 7;
  }
  if (n === 'candle' || n.endsWith('_candle')) return lit() ? 3 * (getProp(s, 'candles') as number) : 0;
  if (n === 'candle_cake' || n.endsWith('_candle_cake')) return lit() ? 3 : 0;
  return b.emitLight;
}

function faceCovered(boxes: number[][], face: number): boolean {
  // A face is fully covered if some box spans the whole face at the boundary.
  // (Union coverage of multiple partial boxes is checked with a 4x4 grid.)
  const grid = new Uint8Array(16);
  for (const [x0, y0, z0, x1, y1, z1] of boxes as [number, number, number, number, number, number][]) {
    let onFace = false;
    let a0 = 0, a1 = 0, b0 = 0, b1 = 0;
    switch (face) {
      case Face.Down: onFace = y0 <= 0; a0 = x0; a1 = x1; b0 = z0; b1 = z1; break;
      case Face.Up: onFace = y1 >= 1; a0 = x0; a1 = x1; b0 = z0; b1 = z1; break;
      case Face.North: onFace = z0 <= 0; a0 = x0; a1 = x1; b0 = y0; b1 = y1; break;
      case Face.South: onFace = z1 >= 1; a0 = x0; a1 = x1; b0 = y0; b1 = y1; break;
      case Face.West: onFace = x0 <= 0; a0 = z0; a1 = z1; b0 = y0; b1 = y1; break;
      case Face.East: onFace = x1 >= 1; a0 = z0; a1 = z1; b0 = y0; b1 = y1; break;
    }
    if (!onFace) continue;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const ca = (i + 0.5) / 4, cb = (j + 0.5) / 4;
        if (ca > a0 && ca < a1 && cb > b0 && cb < b1) grid[i * 4 + j] = 1;
      }
  }
  return grid.every((v) => v === 1);
}

const shapeIds = Object.keys(COLLISION_SHAPES).map(Number);
let fullCubeShapeId = 1;
for (const id of shapeIds) {
  const s = COLLISION_SHAPES[id]!;
  if (s.length === 1 && s[0]!.join(',') === '0,0,0,1,1,1') fullCubeShapeId = id;
}

for (const b of BLOCKS) {
  const shapeLight = SHAPE_LIGHT_BLOCKS(b);
  const isAir = b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air';
  for (let s = b.minStateId; s <= b.maxStateId; s++) {
    const rel = s - b.minStateId;
    const shapeId = Array.isArray(b.shape) ? b.shape[rel]! : b.shape;
    COLLISION_SHAPE_ID[s] = shapeId;
    FULL_COLLISION[s] = shapeId === fullCubeShapeId ? 1 : 0;
    IS_AIR[s] = isAir ? 1 : 0;
    LIGHT_EMIT[s] = emissionFor(b, s);
    LIGHT_FILTER[s] = b.filterLight;
    if (shapeLight) {
      USE_SHAPE_LIGHT[s] = 1;
      const boxes = COLLISION_SHAPES[shapeId] ?? [];
      let mask = 0;
      for (let f = 0; f < 6; f++) if (faceCovered(boxes, f)) mask |= 1 << f;
      LIGHT_FACE_OCCLUSION[s] = mask;
    }
    // fluids
    if (b.name === 'water' || b.name === 'lava') {
      FLUID[s] = b.name === 'water' ? 1 : 2;
      FLUID_LEVEL[s] = getProp(s, 'level') as number;
    } else if (getProp(s, 'waterlogged') === true) {
      FLUID[s] = 1;
      FLUID_LEVEL[s] = 0;
    } else if (
      b.name === 'bubble_column' || b.name === 'kelp' || b.name === 'kelp_plant' ||
      b.name === 'seagrass' || b.name === 'tall_seagrass'
    ) {
      FLUID[s] = 1;
      FLUID_LEVEL[s] = 0;
    }
  }
}

export const FULL_CUBE_SHAPE_ID = fullCubeShapeId;

/**
 * Can light travel from a cell in state `from` to its neighbor in state `to` in direction `face`?
 * Implements vanilla shape-based occlusion: blocked when the union of the two touching faces
 * is a full square (approximated: either face fully covered).
 */
export function lightPasses(from: number, to: number, face: number): boolean {
  if (USE_SHAPE_LIGHT[from] && (LIGHT_FACE_OCCLUSION[from]! >> face) & 1) return false;
  if (USE_SHAPE_LIGHT[to] && (LIGHT_FACE_OCCLUSION[to]! >> OPPOSITE_FACE[face]) & 1) return false;
  return true;
}

export function blockId(name: string): number {
  const b = BLOCKS_BY_NAME.get(name);
  if (!b) throw new Error(`unknown block ${name}`);
  return b.id;
}
