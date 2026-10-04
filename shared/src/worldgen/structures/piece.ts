/**
 * Structure pieces (vanilla StructurePiece / BoundingBox): a piece has a world bounding box and an
 * orientation; its postProcess draws it in local coordinates, and every write is clipped to the
 * box of the chunk being decorated (vanilla places only the part of a piece inside that chunk).
 *
 * Local frame: x across, z along, y up from the box floor. Rotation r turns the piece r × 90°
 * clockwise seen from above (r = 0: local +x = east, +z = south). Block states written in local
 * terms (facing, axis, rails, fences…) are rotated the same way, so a local "facing=south" stair
 * faces local +z in the world too.
 */
import type { JavaRandom } from '../../util/random';
import { blockNameOf, getProp, parseState, withProp } from '../../world/blockstate';
import { IS_AIR, FLUID } from '../../world/blockinfo';
import { BLOCK_STATE_COUNT } from '../../data';
import type { GenLevel } from '../features/level';
import { addBlockEntity } from '../features/underground';

export class BoundingBox {
  constructor(
    public x0: number, public y0: number, public z0: number,
    public x1: number, public y1: number, public z1: number,
  ) {}

  static chunk(cx: number, cz: number): BoundingBox {
    return new BoundingBox(cx << 4, 0, cz << 4, (cx << 4) + 15, 255, (cz << 4) + 15);
  }

  /** BoundingBox.orientBox: a box of size (sx, sy, sz) at (x, y, z) offset by (ox, oy, oz) in the direction's frame. */
  static orient(x: number, y: number, z: number, ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, r: number): BoundingBox {
    // local (lx, lz) → world offsets for rotation r about (x, z) as the local origin's corner
    const corners: [number, number][] = [[ox, oz], [ox + sx - 1, oz + sz - 1]];
    const w = corners.map(([lx, lz]) => rotOffset(lx, lz, r));
    return new BoundingBox(
      x + Math.min(w[0]![0], w[1]![0]), y + oy, z + Math.min(w[0]![1], w[1]![1]),
      x + Math.max(w[0]![0], w[1]![0]), y + oy + sy - 1, z + Math.max(w[0]![1], w[1]![1]),
    );
  }

  intersects(b: BoundingBox): boolean {
    return this.x1 >= b.x0 && this.x0 <= b.x1 && this.z1 >= b.z0 && this.z0 <= b.z1 && this.y1 >= b.y0 && this.y0 <= b.y1;
  }

  intersectsXZ(x0: number, z0: number, x1: number, z1: number): boolean {
    return this.x1 >= x0 && this.x0 <= x1 && this.z1 >= z0 && this.z0 <= z1;
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1 && y >= this.y0 && y <= this.y1;
  }

  move(dx: number, dy: number, dz: number): this {
    this.x0 += dx; this.x1 += dx; this.y0 += dy; this.y1 += dy; this.z0 += dz; this.z1 += dz;
    return this;
  }

  encapsulate(b: BoundingBox): this {
    this.x0 = Math.min(this.x0, b.x0); this.y0 = Math.min(this.y0, b.y0); this.z0 = Math.min(this.z0, b.z0);
    this.x1 = Math.max(this.x1, b.x1); this.y1 = Math.max(this.y1, b.y1); this.z1 = Math.max(this.z1, b.z1);
    return this;
  }

  copy(): BoundingBox {
    return new BoundingBox(this.x0, this.y0, this.z0, this.x1, this.y1, this.z1);
  }

  get xSpan(): number { return this.x1 - this.x0 + 1; }
  get ySpan(): number { return this.y1 - this.y0 + 1; }
  get zSpan(): number { return this.z1 - this.z0 + 1; }
  get centerX(): number { return this.x0 + ((this.x1 - this.x0 + 1) >> 1); }
  get centerZ(): number { return this.z0 + ((this.z1 - this.z0 + 1) >> 1); }
}

/** A local offset rotated r × 90° clockwise. */
export function rotOffset(lx: number, lz: number, r: number): [number, number] {
  switch (r & 3) {
    case 1: return [-lz, lx];
    case 2: return [-lx, -lz];
    case 3: return [lz, -lx];
    default: return [lx, lz];
  }
}

// ------------------------------------------------------------------ block state rotation
const HDIRS = ['north', 'east', 'south', 'west'];
const rotDir = (d: string, r: number) => {
  const i = HDIRS.indexOf(d);
  return i < 0 ? d : HDIRS[(i + r) & 3]!;
};
const RAIL_SHAPES: Record<string, string> = {};
function rotRailShape(s: string, r: number): string {
  if (s === 'north_south' || s === 'east_west') return r & 1 ? (s === 'north_south' ? 'east_west' : 'north_south') : s;
  if (s.startsWith('ascending_')) return 'ascending_' + rotDir(s.slice(10), r);
  // curves: two directions
  const [a, b] = s.split('_') as [string, string];
  const ra = rotDir(a, r), rb = rotDir(b, r);
  const pair = [ra, rb].sort((p, q) => (p === 'north' || p === 'south' ? -1 : 1) - (q === 'north' || q === 'south' ? -1 : 1));
  return pair.join('_');
}
void RAIL_SHAPES;

const rotCache = [null, new Map<number, number>(), new Map<number, number>(), new Map<number, number>()] as (Map<number, number> | null)[];
/** BlockState.rotate(Rotation) for r × 90° clockwise. */
export function rotateState(s: number, r: number): number {
  r &= 3;
  if (r === 0 || s === 0) return s;
  const cache = rotCache[r]!;
  let out = cache.get(s);
  if (out !== undefined) return out;
  out = s;
  const facing = getProp(s, 'facing');
  if (typeof facing === 'string') out = withProp(out, 'facing', rotDir(facing, r));
  const axis = getProp(s, 'axis');
  if ((r & 1) && (axis === 'x' || axis === 'z')) out = withProp(out, 'axis', axis === 'x' ? 'z' : 'x');
  const rotation = getProp(s, 'rotation');
  if (typeof rotation === 'number') out = withProp(out, 'rotation', (rotation + 4 * r) & 15);
  const shape = getProp(s, 'shape');
  if (typeof shape === 'string' && blockNameOf(s).includes('rail')) {
    const ns = rotRailShape(shape, r);
    const t = withProp(out, 'shape', ns);
    out = t;
  }
  const sides = HDIRS.map((d) => getProp(s, d));
  if (sides.every((v) => v !== undefined)) for (let i = 0; i < 4; i++) out = withProp(out, HDIRS[(i + r) & 3]!, sides[i]!);
  cache.set(s, out);
  return out;
}

// ------------------------------------------------------------------ states by name, cached
const stateCache = new Map<string, number>();
/** A block state from "name[prop=value,…]", cached. */
export function S(str: string): number {
  let s = stateCache.get(str);
  if (s === undefined) stateCache.set(str, (s = parseState(str)));
  return s;
}
void BLOCK_STATE_COUNT;

// ------------------------------------------------------------------ pieces
export interface PlaceContext {
  lv: GenLevel;
  /** the structure feature's random for this chunk (setFeatureSeed(decorationSeed, index, step)) */
  rand: JavaRandom;
  /** the decorated chunk's box */
  chunk: BoundingBox;
}

export abstract class Piece {
  constructor(public box: BoundingBox, public rot: number) {}

  /** Draws the part of the piece inside ctx.chunk; false removes the piece (vanilla). */
  abstract postProcess(ctx: PlaceContext): boolean;

  /** local → world */
  wx(x: number, z: number): number {
    switch (this.rot & 3) {
      case 1: return this.box.x1 - z;
      case 2: return this.box.x1 - x;
      case 3: return this.box.x0 + z;
      default: return this.box.x0 + x;
    }
  }
  wy(y: number): number {
    return this.box.y0 + y;
  }
  wz(x: number, z: number): number {
    switch (this.rot & 3) {
      case 1: return this.box.z0 + x;
      case 2: return this.box.z1 - z;
      case 3: return this.box.z1 - x;
      default: return this.box.z0 + z;
    }
  }

  /** StructurePiece.placeBlock: in local coordinates, clipped to the chunk. */
  set(c: PlaceContext, state: number, x: number, y: number, z: number): void {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    if (!c.chunk.inside(X, Y, Z)) return;
    c.lv.setState(X, Y, Z, rotateState(state, this.rot));
  }

  get(c: PlaceContext, x: number, y: number, z: number): number {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    return c.chunk.inside(X, Y, Z) ? c.lv.getState(X, Y, Z) : 0;
  }

  isInside(c: PlaceContext, x: number, y: number, z: number): boolean {
    return c.chunk.inside(this.wx(x, z), this.wy(y), this.wz(x, z));
  }

  /** StructurePiece.generateBox: edge state on the box's shell, inner inside; skipAir keeps air air. */
  fill(c: PlaceContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, edge: number, inner = edge, skipAir = false): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          if (skipAir && IS_AIR[this.get(c, x, y, z)] === 1) continue;
          const shell = y === y0 || y === y1 || x === x0 || x === x1 || z === z0 || z === z1;
          this.set(c, shell ? edge : inner, x, y, z);
        }
  }

  /** generateMaybeBox: each block placed with probability p (rand.nextFloat() <= p). */
  fillMaybe(c: PlaceContext, rand: JavaRandom, p: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, edge: number, inner = edge, skipAir = false): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          if (rand.nextFloat() > p) continue;
          if (skipAir && IS_AIR[this.get(c, x, y, z)] === 1) continue;
          const shell = y === y0 || y === y1 || x === x0 || x === x1 || z === z0 || z === z1;
          this.set(c, shell ? edge : inner, x, y, z);
        }
  }

  /** generateBox with a block selector (stone bricks → mossy/cracked…). */
  fillWith(c: PlaceContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, pick: (edge: boolean) => number, skipAir = false): void {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          if (skipAir && IS_AIR[this.get(c, x, y, z)] === 1) continue;
          const shell = y === y0 || y === y1 || x === x0 || x === x1 || z === z0 || z === z1;
          this.set(c, pick(shell), x, y, z);
        }
  }

  /** StructurePiece.fillColumnDown: replaces air/fluid/plants downward until something solid. */
  fillDown(c: PlaceContext, state: number, x: number, y: number, z: number): void {
    const X = this.wx(x, z), Z = this.wz(x, z);
    let Y = this.wy(y);
    if (!c.chunk.inside(X, Y, Z)) return;
    const st = rotateState(state, this.rot);
    while (Y > 1) {
      const s = c.lv.getState(X, Y, Z);
      if (!(IS_AIR[s] === 1 || FLUID[s] !== 0 || isReplaceablePlant(s))) break;
      c.lv.setState(X, Y, Z, st);
      Y--;
    }
  }

  /** StructurePiece.createChest: a chest (if not already one) with a loot table and rand.nextLong() as its seed. */
  chest(c: PlaceContext, x: number, y: number, z: number, lootTable: string, state = S('chest')): boolean {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    if (!c.chunk.inside(X, Y, Z)) return false;
    const name = blockNameOf(c.lv.getState(X, Y, Z));
    if (name === 'chest' || name === 'trapped_chest' || name === 'barrel') return false;
    c.lv.setState(X, Y, Z, rotateState(state, this.rot));
    addBlockEntity(c.lv, { kind: 'chest', x: X, y: Y, z: Z, lootTable, lootSeed: c.rand.nextLong() });
    return true;
  }

  /** A spawner block entity. */
  spawner(c: PlaceContext, x: number, y: number, z: number, entity: string): void {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    if (!c.chunk.inside(X, Y, Z)) return;
    c.lv.setState(X, Y, Z, S('spawner'));
    addBlockEntity(c.lv, { kind: 'spawner', x: X, y: Y, z: Z, entity });
  }

  /** ScatteredFeaturePiece.updateAverageGroundHeight: sit the piece on the average height inside this chunk. */
  protected heightPosition = -1;
  updateAverageGroundHeight(c: PlaceContext, offset: number): boolean {
    if (this.heightPosition >= 0) return true;
    let sum = 0, n = 0;
    for (let z = this.box.z0; z <= this.box.z1; z++)
      for (let x = this.box.x0; x <= this.box.x1; x++)
        if (c.chunk.inside(x, 64, z)) {
          sum += c.lv.getHeight('MOTION_BLOCKING_NO_LEAVES', x, z);
          n++;
        }
    if (n === 0) return false;
    this.heightPosition = Math.trunc(sum / n);
    this.box.move(0, this.heightPosition - this.box.y0 + offset, 0);
    return true;
  }
}

const plantCache = new Int8Array(BLOCK_STATE_COUNT);
/** Material.isReplaceable plants that fillColumnDown goes through (grass, flowers, snow layers…). */
function isReplaceablePlant(s: number): boolean {
  let v = plantCache[s]!;
  if (v === 0) {
    const n = blockNameOf(s);
    v = /^(grass|tall_grass|fern|large_fern|dead_bush|seagrass|tall_seagrass|snow|vine|kelp|kelp_plant|dandelion|poppy|sweet_berry_bush|glow_lichen)$/.test(n) ? 1 : -1;
    plantCache[s] = v;
  }
  return v === 1;
}

/** A structure start: its pieces in generation order, and their combined box. */
export class StructureStart {
  readonly box: BoundingBox;
  constructor(readonly feature: string, readonly cx: number, readonly cz: number, readonly pieces: Piece[]) {
    this.box = pieces[0]!.box.copy();
    for (const p of pieces) this.box.encapsulate(p.box);
  }

  /** StructureStart.placeInChunk */
  placeInChunk(ctx: PlaceContext): void {
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i]!;
      if (!p.box.intersects(ctx.chunk)) continue;
      if (!p.postProcess(ctx)) {
        this.pieces.splice(i, 1);
        i--;
      }
    }
  }
}

/** Collections.shuffle(list, rnd) */
export function shuffle<T>(list: T[], r: JavaRandom): void {
  for (let i = list.length; i > 1; i--) {
    const j = r.nextInt(i);
    const t = list[i - 1]!;
    list[i - 1] = list[j]!;
    list[j] = t;
  }
}

/** Direction.Plane.HORIZONTAL.getRandomDirection: as a rotation (NORTH, EAST, SOUTH, WEST → 0..3 in our rotation sense). */
export function randomRotation(r: JavaRandom): number {
  return r.nextInt(4);
}
