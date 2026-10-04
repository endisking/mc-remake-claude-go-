/**
 * Abandoned mineshafts (vanilla 1.17.1 MineshaftFeature + MineShaftPieces): the dirt-floored
 * room, then corridors (supports, rails, cobwebs, cave spider spawners, chests), crossings (one or
 * two floors) and stairs grown recursively to depth 8 within 80 blocks, moved below sea level
 * (normal) or around it (mesa). Chest minecarts are placed as chests (no minecart entities yet).
 */
import type { JavaRandom } from '../../util/random';
import { IS_AIR, FLUID } from '../../world/blockinfo';
import { MATERIAL_SOLID } from '../../world/blockprops';
import { BoundingBox, Piece, S, type PlaceContext } from './piece';
import type { StartContext } from './placement';

/** Direction as our rotation: SOUTH 0, WEST 1, NORTH 2, EAST 3 */
const SOUTH = 0, WEST = 1, NORTH = 2, EAST = 3;
type Kind = 'normal' | 'mesa';
const MATERIALS: Record<Kind, { planks: string; fence: string; wood: string }> = {
  normal: { planks: 'oak_planks', fence: 'oak_fence', wood: 'oak_log' },
  mesa: { planks: 'dark_oak_planks', fence: 'dark_oak_fence', wood: 'dark_oak_log' },
};

interface Ctx { pieces: MinePiece[]; rand: JavaRandom; start: BoundingBox; kind: Kind }

abstract class MinePiece extends Piece {
  constructor(box: BoundingBox, rot: number, readonly depth: number, readonly kind: Kind) {
    super(box, rot);
  }
  abstract addChildren(c: Ctx): void;
  get planks(): number { return S(MATERIALS[this.kind].planks); }
  get fence(): number { return S(MATERIALS[this.kind].fence); }

  /** StructurePiece.isInterior: below the ocean-floor surface at the block above */
  interior(c: PlaceContext, x: number, y: number, z: number): boolean {
    const X = this.wx(x, z), Y = this.wy(y + 1), Z = this.wz(x, z);
    return c.chunk.inside(X, Y, Z) && Y < c.lv.getHeight('OCEAN_FLOOR_WG', X, Z);
  }

  /** MineShaftPiece.isInInvalidLocation: liquid on the piece's shell (within the chunk) */
  invalidLocation(c: PlaceContext): boolean {
    const b = this.box, ch = c.chunk;
    const i = Math.max(b.x0 - 1, ch.x0), j = Math.max(b.y0 - 1, ch.y0), k = Math.max(b.z0 - 1, ch.z0);
    const l = Math.min(b.x1 + 1, ch.x1), m = Math.min(b.y1 + 1, ch.y1), n = Math.min(b.z1 + 1, ch.z1);
    const liquid = (x: number, y: number, z: number) => FLUID[c.lv.getState(x, y, z)] !== 0;
    for (let x = i; x <= l; x++) for (let z = k; z <= n; z++) if (liquid(x, j, z) || liquid(x, m, z)) return true;
    for (let x = i; x <= l; x++) for (let y = j; y <= m; y++) if (liquid(x, y, k) || liquid(x, y, n)) return true;
    for (let z = k; z <= n; z++) for (let y = j; y <= m; y++) if (liquid(i, y, z) || liquid(l, y, z)) return true;
    return false;
  }
}

function collides(pieces: MinePiece[], b: BoundingBox): boolean {
  return pieces.some((p) => p.box.intersects(b));
}

/** MineShaftPieces.generateAndAddPiece */
function generateAndAdd(c: Ctx, x: number, y: number, z: number, dir: number, depth: number): MinePiece | null {
  if (depth > 8) return null;
  if (Math.abs(x - c.start.x0) > 80 || Math.abs(z - c.start.z0) > 80) return null;
  const p = createRandomShaftPiece(c, x, y, z, dir, depth + 1);
  if (p) {
    c.pieces.push(p);
    p.addChildren(c);
  }
  return p;
}

function createRandomShaftPiece(c: Ctx, x: number, y: number, z: number, dir: number, depth: number): MinePiece | null {
  const r = c.rand;
  const i = r.nextInt(100);
  if (i >= 80) {
    const b = findCrossing(c, x, y, z, dir);
    if (b) return new Crossing(b, dir, depth, c.kind);
  } else if (i >= 70) {
    const b = findStairs(c, x, y, z, dir);
    if (b) return new Stairs(b, dir, depth, c.kind);
  } else {
    const b = findCorridor(c, x, y, z, dir);
    if (b) return new Corridor(b, dir, depth, c.kind, r);
  }
  return null;
}

/** a box given in vanilla's per-direction offsets, moved to (x, y, z) */
const at = (x: number, y: number, z: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => new BoundingBox(x + x0, y + y0, z + z0, x + x1, y + y1, z + z1);

// ------------------------------------------------------------------ corridor
function findCorridor(c: Ctx, x: number, y: number, z: number, dir: number): BoundingBox | null {
  for (let i = c.rand.nextInt(3) + 2; i > 0; i--) {
    const j = i * 5;
    const b =
      dir === NORTH ? at(x, y, z, 0, 0, -(j - 1), 2, 2, 0)
        : dir === SOUTH ? at(x, y, z, 0, 0, 0, 2, 2, j - 1)
          : dir === WEST ? at(x, y, z, -(j - 1), 0, 0, 0, 2, 2)
            : at(x, y, z, 0, 0, 0, j - 1, 2, 2);
    if (!collides(c.pieces, b)) return b;
  }
  return null;
}

class Corridor extends MinePiece {
  readonly hasRails: boolean;
  readonly spider: boolean;
  private placedSpider = false;
  readonly sections: number;
  constructor(box: BoundingBox, dir: number, depth: number, kind: Kind, r: JavaRandom) {
    super(box, dir, depth, kind);
    this.hasRails = r.nextInt(3) === 0;
    this.spider = !this.hasRails && r.nextInt(23) === 0;
    this.sections = Math.trunc((dir === NORTH || dir === SOUTH ? box.zSpan : box.xSpan) / 5);
  }

  addChildren(c: Ctx): void {
    const r = c.rand, b = this.box, d = this.depth;
    const j = r.nextInt(4);
    switch (this.rot) {
      case SOUTH:
        if (j <= 1) generateAndAdd(c, b.x0, b.y0 - 1 + r.nextInt(3), b.z1 + 1, SOUTH, d);
        else if (j === 2) generateAndAdd(c, b.x0 - 1, b.y0 - 1 + r.nextInt(3), b.z1 - 3, WEST, d);
        else generateAndAdd(c, b.x1 + 1, b.y0 - 1 + r.nextInt(3), b.z1 - 3, EAST, d);
        break;
      case WEST:
        if (j <= 1) generateAndAdd(c, b.x0 - 1, b.y0 - 1 + r.nextInt(3), b.z0, WEST, d);
        else if (j === 2) generateAndAdd(c, b.x0, b.y0 - 1 + r.nextInt(3), b.z0 - 1, NORTH, d);
        else generateAndAdd(c, b.x0, b.y0 - 1 + r.nextInt(3), b.z1 + 1, SOUTH, d);
        break;
      case EAST:
        if (j <= 1) generateAndAdd(c, b.x1 + 1, b.y0 - 1 + r.nextInt(3), b.z0, EAST, d);
        else if (j === 2) generateAndAdd(c, b.x1 - 3, b.y0 - 1 + r.nextInt(3), b.z0 - 1, NORTH, d);
        else generateAndAdd(c, b.x1 - 3, b.y0 - 1 + r.nextInt(3), b.z1 + 1, SOUTH, d);
        break;
      default:
        if (j <= 1) generateAndAdd(c, b.x0, b.y0 - 1 + r.nextInt(3), b.z0 - 1, NORTH, d);
        else if (j === 2) generateAndAdd(c, b.x0 - 1, b.y0 - 1 + r.nextInt(3), b.z0, WEST, d);
        else generateAndAdd(c, b.x1 + 1, b.y0 - 1 + r.nextInt(3), b.z0, EAST, d);
    }
    if (d < 8) {
      if (this.rot === NORTH || this.rot === SOUTH) {
        for (let k = b.z0 + 3; k + 3 <= b.z1; k += 5) {
          const l = r.nextInt(5);
          if (l === 0) generateAndAdd(c, b.x0 - 1, b.y0, k, WEST, d + 1);
          else if (l === 1) generateAndAdd(c, b.x1 + 1, b.y0, k, EAST, d + 1);
        }
      } else {
        for (let k = b.x0 + 3; k + 3 <= b.x1; k += 5) {
          const l = r.nextInt(5);
          if (l === 0) generateAndAdd(c, k, b.y0, b.z0 - 1, NORTH, d + 1);
          else if (l === 1) generateAndAdd(c, k, b.y0, b.z1 + 1, SOUTH, d + 1);
        }
      }
    }
  }

  postProcess(c: PlaceContext): boolean {
    if (this.invalidLocation(c)) return false;
    const r = c.rand, air = S('cave_air');
    const m = this.sections * 5 - 1;
    this.fill(c, 0, 0, 0, 2, 1, m, air);
    this.fillMaybe(c, r, 0.8, 0, 2, 0, 2, 2, m, air);
    if (this.spider) {
      // generateMaybeBox(0.6, cobweb edge, requireSkylight = interior)
      for (let y = 0; y <= 1; y++)
        for (let x = 0; x <= 2; x++)
          for (let z = 0; z <= m; z++)
            if (r.nextFloat() <= 0.6 && this.interior(c, x, y, z)) {
              const shell = y === 0 || y === 1 || x === 0 || x === 2 || z === 0 || z === m;
              this.set(c, shell ? S('cobweb') : air, x, y, z);
            }
    }
    for (let n = 0; n < this.sections; n++) {
      const o = 2 + n * 5;
      this.placeSupport(c, 0, 0, o, 2, 2);
      this.cobweb(c, 0.1, 0, 2, o - 1);
      this.cobweb(c, 0.1, 2, 2, o - 1);
      this.cobweb(c, 0.1, 0, 2, o + 1);
      this.cobweb(c, 0.1, 2, 2, o + 1);
      this.cobweb(c, 0.05, 0, 2, o - 2);
      this.cobweb(c, 0.05, 2, 2, o - 2);
      this.cobweb(c, 0.05, 0, 2, o + 2);
      this.cobweb(c, 0.05, 2, 2, o + 2);
      if (r.nextInt(100) === 0) this.minecartChest(c, 2, 0, o - 1);
      if (r.nextInt(100) === 0) this.minecartChest(c, 0, 0, o + 1);
      if (!this.spider || this.placedSpider) continue;
      const q = o - 1 + r.nextInt(3);
      if (!this.isInside(c, 1, 0, q) || !this.interior(c, 1, 0, q)) continue;
      this.placedSpider = true;
      this.spawner(c, 1, 0, q, 'cave_spider');
    }
    // planks bridging gaps in the floor
    for (let n = 0; n <= 2; n++)
      for (let o = 0; o <= m; o++)
        if (IS_AIR[this.get(c, n, -1, o)] === 1 && this.isInside(c, n, -1, o) && this.interior(c, n, -1, o)) this.set(c, this.planks, n, -1, o);
    if (this.hasRails) {
      const rail = S('rail[shape=north_south]');
      for (let n = 0; n <= m; n++) {
        const s = this.get(c, 1, -1, n);
        if (IS_AIR[s] === 1 || MATERIAL_SOLID[s] !== 1) continue;
        const f = this.interior(c, 1, 0, n) ? 0.7 : 0.9;
        if (r.nextFloat() < f) this.set(c, rail, 1, 0, n);
      }
    }
    return true;
  }

  /** MineShaftCorridor.createChest: a chest minecart on a rail, here a chest on the floor */
  private minecartChest(c: PlaceContext, x: number, y: number, z: number): void {
    if (!this.isInside(c, x, y, z) || IS_AIR[this.get(c, x, y, z)] !== 1 || IS_AIR[this.get(c, x, y - 1, z)] === 1) return;
    this.chest(c, x, y, z, 'chests/abandoned_mineshaft');
  }

  private cobweb(c: PlaceContext, p: number, x: number, y: number, z: number): void {
    if (!this.interior(c, x, y, z) || c.rand.nextFloat() >= p) return;
    // hasSturdyNeighbours(…, 2)
    let n = 0;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) if (MATERIAL_SOLID[this.get(c, x + dx, y + dy, z + dz)] === 1) n++;
    if (n >= 2) this.set(c, S('cobweb'), x, y, z);
  }

  private placeSupport(c: PlaceContext, x0: number, y0: number, z: number, y1: number, x1: number): void {
    for (let x = x0; x <= x1; x++) if (IS_AIR[this.get(c, x, y1 + 1, z)] === 1) return;
    const r = c.rand;
    const fenceA = S(`${MATERIALS[this.kind].fence}`);
    this.fill(c, x0, y0, z, x0, y1 - 1, z, fenceA);
    this.fill(c, x1, y0, z, x1, y1 - 1, z, fenceA);
    if (r.nextInt(4) === 0) {
      this.set(c, this.planks, x0, y1, z);
      this.set(c, this.planks, x1, y1, z);
    } else {
      this.fill(c, x0, y1, z, x1, y1, z, this.planks);
      if (r.nextFloat() < 0.05) this.set(c, S('wall_torch[facing=south]'), x0 + 1, y1, z - 1);
      if (r.nextFloat() < 0.05) this.set(c, S('wall_torch[facing=north]'), x0 + 1, y1, z + 1);
    }
  }
}

// ------------------------------------------------------------------ crossing
function findCrossing(c: Ctx, x: number, y: number, z: number, dir: number): BoundingBox | null {
  const i = c.rand.nextInt(4) === 0 ? 6 : 2;
  const b =
    dir === NORTH ? at(x, y, z, -1, 0, -4, 3, i, 0)
      : dir === SOUTH ? at(x, y, z, -1, 0, 0, 3, i, 4)
        : dir === WEST ? at(x, y, z, -4, 0, -1, 0, i, 3)
          : at(x, y, z, 0, 0, -1, 4, i, 3);
  return collides(c.pieces, b) ? null : b;
}

class Crossing extends MinePiece {
  readonly twoFloors: boolean;
  constructor(box: BoundingBox, readonly dir: number, depth: number, kind: Kind) {
    super(box, 0, depth, kind); // crossings draw in world-aligned coordinates
    this.twoFloors = box.ySpan > 3;
  }

  addChildren(c: Ctx): void {
    const b = this.box, d = this.depth, r = c.rand;
    switch (this.dir) {
      case SOUTH:
        generateAndAdd(c, b.x0 + 1, b.y0, b.z1 + 1, SOUTH, d);
        generateAndAdd(c, b.x0 - 1, b.y0, b.z0 + 1, WEST, d);
        generateAndAdd(c, b.x1 + 1, b.y0, b.z0 + 1, EAST, d);
        break;
      case WEST:
        generateAndAdd(c, b.x0 + 1, b.y0, b.z0 - 1, NORTH, d);
        generateAndAdd(c, b.x0 + 1, b.y0, b.z1 + 1, SOUTH, d);
        generateAndAdd(c, b.x0 - 1, b.y0, b.z0 + 1, WEST, d);
        break;
      case EAST:
        generateAndAdd(c, b.x0 + 1, b.y0, b.z0 - 1, NORTH, d);
        generateAndAdd(c, b.x0 + 1, b.y0, b.z1 + 1, SOUTH, d);
        generateAndAdd(c, b.x1 + 1, b.y0, b.z0 + 1, EAST, d);
        break;
      default:
        generateAndAdd(c, b.x0 + 1, b.y0, b.z0 - 1, NORTH, d);
        generateAndAdd(c, b.x0 - 1, b.y0, b.z0 + 1, WEST, d);
        generateAndAdd(c, b.x1 + 1, b.y0, b.z0 + 1, EAST, d);
    }
    if (this.twoFloors) {
      if (r.nextBoolean()) generateAndAdd(c, b.x0 + 1, b.y0 + 4, b.z0 - 1, NORTH, d);
      if (r.nextBoolean()) generateAndAdd(c, b.x0 - 1, b.y0 + 4, b.z0 + 1, WEST, d);
      if (r.nextBoolean()) generateAndAdd(c, b.x1 + 1, b.y0 + 4, b.z0 + 1, EAST, d);
      if (r.nextBoolean()) generateAndAdd(c, b.x0 + 1, b.y0 + 4, b.z1 + 1, SOUTH, d);
    }
  }

  postProcess(c: PlaceContext): boolean {
    if (this.invalidLocation(c)) return false;
    const air = S('cave_air');
    const X = this.box.xSpan - 1, Y = this.box.ySpan - 1, Z = this.box.zSpan - 1;
    if (this.twoFloors) {
      this.fill(c, 1, 0, 0, X - 1, 2, Z, air);
      this.fill(c, 0, 0, 1, X, 2, Z - 1, air);
      this.fill(c, 1, Y - 2, 0, X - 1, Y, Z, air);
      this.fill(c, 0, Y - 2, 1, X, Y, Z - 1, air);
      this.fill(c, 1, 3, 1, X - 1, 3, Z - 1, air);
    } else {
      this.fill(c, 1, 0, 0, X - 1, Y, Z, air);
      this.fill(c, 0, 0, 1, X, Y, Z - 1, air);
    }
    for (const [x, z] of [[1, 1], [1, Z - 1], [X - 1, 1], [X - 1, Z - 1]] as const) {
      // placeSupportPillar: planks up to the ceiling where it's solid above
      if (IS_AIR[this.get(c, x, Y + 1, z)] !== 1) this.fill(c, x, 0, z, x, Y, z, this.planks);
    }
    for (let x = 0; x <= X; x++)
      for (let z = 0; z <= Z; z++)
        if (IS_AIR[this.get(c, x, -1, z)] === 1 && this.interior(c, x, -1, z)) this.set(c, this.planks, x, -1, z);
    return true;
  }
}

// ------------------------------------------------------------------ stairs
function findStairs(c: Ctx, x: number, y: number, z: number, dir: number): BoundingBox | null {
  const b =
    dir === NORTH ? at(x, y, z, 0, -5, -8, 2, 2, 0)
      : dir === SOUTH ? at(x, y, z, 0, -5, 0, 2, 2, 8)
        : dir === WEST ? at(x, y, z, -8, -5, 0, 0, 2, 2)
          : at(x, y, z, 0, -5, 0, 8, 2, 2);
  return collides(c.pieces, b) ? null : b;
}

class Stairs extends MinePiece {
  addChildren(c: Ctx): void {
    const b = this.box, d = this.depth;
    switch (this.rot) {
      case SOUTH: generateAndAdd(c, b.x0, b.y0, b.z1 + 1, SOUTH, d); break;
      case WEST: generateAndAdd(c, b.x0 - 1, b.y0, b.z0, WEST, d); break;
      case EAST: generateAndAdd(c, b.x1 + 1, b.y0, b.z0, EAST, d); break;
      default: generateAndAdd(c, b.x0, b.y0, b.z0 - 1, NORTH, d);
    }
  }

  postProcess(c: PlaceContext): boolean {
    if (this.invalidLocation(c)) return false;
    const air = S('cave_air');
    this.fill(c, 0, 5, 0, 2, 7, 1, air);
    this.fill(c, 0, 0, 7, 2, 2, 8, air);
    for (let i = 0; i < 5; i++) this.fill(c, 0, 5 - i - (i < 4 ? 1 : 0), 2 + i, 2, 7 - i, 2 + i, air);
    return true;
  }
}

// ------------------------------------------------------------------ room
class Room extends MinePiece {
  readonly entrances: BoundingBox[] = [];
  constructor(r: JavaRandom, x: number, z: number, kind: Kind) {
    super(new BoundingBox(x, 50, z, x + 7 + r.nextInt(6), 54 + r.nextInt(6), z + 7 + r.nextInt(6)), 0, 0, kind);
  }

  addChildren(c: Ctx): void {
    const r = c.rand, b = this.box, d = this.depth;
    let k = b.ySpan - 3 - 1;
    if (k <= 0) k = 1;
    const xs = b.xSpan, zs = b.zSpan;
    for (let j = 0; j < xs; j += 4) {
      j += r.nextInt(xs);
      if (j + 3 > xs) break;
      const p = generateAndAdd(c, b.x0 + j, b.y0 + r.nextInt(k) + 1, b.z0 - 1, NORTH, d);
      if (p) this.entrances.push(new BoundingBox(p.box.x0, p.box.y0, b.z0, p.box.x1, p.box.y1, b.z0 + 1));
    }
    for (let j = 0; j < xs; j += 4) {
      j += r.nextInt(xs);
      if (j + 3 > xs) break;
      const p = generateAndAdd(c, b.x0 + j, b.y0 + r.nextInt(k) + 1, b.z1 + 1, SOUTH, d);
      if (p) this.entrances.push(new BoundingBox(p.box.x0, p.box.y0, b.z1 - 1, p.box.x1, p.box.y1, b.z1));
    }
    for (let j = 0; j < zs; j += 4) {
      j += r.nextInt(zs);
      if (j + 3 > zs) break;
      const p = generateAndAdd(c, b.x0 - 1, b.y0 + r.nextInt(k) + 1, b.z0 + j, WEST, d);
      if (p) this.entrances.push(new BoundingBox(b.x0, p.box.y0, p.box.z0, b.x0 + 1, p.box.y1, p.box.z1));
    }
    for (let j = 0; j < zs; j += 4) {
      j += r.nextInt(zs);
      if (j + 3 > zs) break;
      const p = generateAndAdd(c, b.x1 + 1, b.y0 + r.nextInt(k) + 1, b.z0 + j, EAST, d);
      if (p) this.entrances.push(new BoundingBox(b.x1 - 1, p.box.y0, p.box.z0, b.x1, p.box.y1, p.box.z1));
    }
  }

  postProcess(c: PlaceContext): boolean {
    if (this.invalidLocation(c)) return false;
    const air = S('cave_air'), b = this.box;
    const X = b.xSpan - 1, Y = b.ySpan - 1, Z = b.zSpan - 1;
    this.fill(c, 0, 0, 0, X, 0, Z, S('dirt'), S('dirt'), true);
    this.fill(c, 0, 1, 0, X, Math.min(3, Y), Z, air);
    for (const e of this.entrances) this.fill(c, e.x0 - b.x0, e.y1 - 2 - b.y0, e.z0 - b.z0, e.x1 - b.x0, e.y1 - b.y0, e.z1 - b.z0, air);
    // generateUpperHalfSphere above y 4
    const fx = X + 1, fy = Y - 4 + 1, fz = Z + 1;
    const cx = fx / 2, cz = fz / 2;
    for (let y = 4; y <= Y; y++) {
      const dy = (y - 4) / fy;
      for (let x = 0; x <= X; x++) {
        const dx = (x - cx) / (fx * 0.5);
        for (let z = 0; z <= Z; z++) {
          const dz = (z - cz) / (fz * 0.5);
          if (dx * dx + dy * dy + dz * dz <= 1.05) this.set(c, air, x, y, z);
        }
      }
    }
    return true;
  }
}

export function mineshaft(s: StartContext): Piece[] {
  const r = s.rand;
  const kind: Kind = s.config.type === 'mesa' ? 'mesa' : 'normal';
  const room = new Room(r, (s.cx << 4) + 2, (s.cz << 4) + 2, kind);
  const c: Ctx = { pieces: [room], rand: r, start: room.box, kind };
  room.addChildren(c);
  const all = room.box.copy();
  for (const p of c.pieces) all.encapsulate(p.box);
  let dy: number;
  if (kind === 'mesa') {
    dy = 63 - all.y1 + Math.trunc(all.ySpan / 2) + 5;
  } else {
    // StructureStart.moveBelowSeaLevel(seaLevel 63, minY 0, random, 10)
    const i = 63 - 10;
    let j = all.ySpan + 0 + 1;
    if (j < i) j += r.nextInt(i - j);
    dy = j - all.y1;
  }
  for (const p of c.pieces) {
    p.box.move(0, dy, 0);
    if (p instanceof Room) for (const e of p.entrances) e.move(0, dy, 0);
  }
  return c.pieces;
}
