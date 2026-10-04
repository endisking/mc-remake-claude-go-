/**
 * Code-built structure templates (this project's own designs standing in for vanilla's template
 * files) and TemplatePiece (vanilla TemplateStructurePiece + StructureTemplate.placeInWorld):
 * a voxel model placed with a rotation, clipped to the decorated chunk, with an optional block
 * processor (integrity/rot, block replacement) and chest markers that become loot chests.
 */
import { JavaRandom } from '../../util/random';
import { getProp, withProp, blockNameOf } from '../../world/blockstate';
import { FLUID } from '../../world/blockinfo';
import { BoundingBox, Piece, rotateState, type PlaceContext } from './piece';
import { addBlockEntity } from '../features/underground';

/** -1 = structure void (leave the world block). */
export const VOID = -1;

export class Model {
  readonly blocks: Int32Array;
  readonly chests: { x: number; y: number; z: number; loot: string; state: number }[] = [];
  readonly spawners: { x: number; y: number; z: number; entity: string }[] = [];
  constructor(readonly sx: number, readonly sy: number, readonly sz: number) {
    this.blocks = new Int32Array(sx * sy * sz).fill(VOID);
  }
  idx(x: number, y: number, z: number): number {
    return (y * this.sz + z) * this.sx + x;
  }
  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }
  set(x: number, y: number, z: number, s: number): void {
    if (this.inside(x, y, z)) this.blocks[this.idx(x, y, z)] = s;
  }
  get(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.blocks[this.idx(x, y, z)]! : VOID;
  }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, s: number | ((x: number, y: number, z: number) => number)): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, typeof s === 'number' ? s : s(x, y, z));
  }
  /** hollow box: walls (and floor/roof) of `edge`, inside `inner` */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, edge: number, inner = VOID): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const shell = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
          if (shell) this.set(x, y, z, edge);
          else if (inner !== VOID) this.set(x, y, z, inner);
        }
  }
  chest(x: number, y: number, z: number, loot: string, state: number): void {
    this.set(x, y, z, state);
    this.chests.push({ x, y, z, loot, state });
  }
  spawner(x: number, y: number, z: number, entity: string, state: number): void {
    this.set(x, y, z, state);
    this.spawners.push({ x, y, z, entity });
  }
  /** a copy turned so local y becomes x (lying on its side) or upside down */
  transformed(kind: 'sideways' | 'upsidedown'): Model {
    if (kind === 'upsidedown') {
      const m = new Model(this.sx, this.sy, this.sz);
      for (let y = 0; y < this.sy; y++) for (let z = 0; z < this.sz; z++) for (let x = 0; x < this.sx; x++) m.set(this.sx - 1 - x, this.sy - 1 - y, z, flipVertical(this.get(x, y, z)));
      for (const c of this.chests) m.chests.push({ ...c, x: this.sx - 1 - c.x, y: this.sy - 1 - c.y });
      return m;
    }
    const m = new Model(this.sy, this.sx, this.sz);
    for (let y = 0; y < this.sy; y++) for (let z = 0; z < this.sz; z++) for (let x = 0; x < this.sx; x++) m.set(this.sy - 1 - y, x, z, layOnSide(this.get(x, y, z)));
    for (const c of this.chests) m.chests.push({ ...c, x: this.sy - 1 - c.y, y: c.x });
    return m;
  }
}

function flipVertical(s: number): number {
  if (s < 0) return s;
  const half = getProp(s, 'half');
  if (half === 'top') return withProp(s, 'half', 'bottom');
  if (half === 'bottom') return withProp(s, 'half', 'top');
  const type = getProp(s, 'type');
  if (type === 'top') return withProp(s, 'type', 'bottom');
  if (type === 'bottom') return withProp(s, 'type', 'top');
  return s;
}
function layOnSide(s: number): number {
  if (s < 0) return s;
  const axis = getProp(s, 'axis');
  if (axis === 'y') return withProp(s, 'axis', 'x');
  if (axis === 'x') return withProp(s, 'axis', 'y');
  return s;
}

/** Mth.getSeed(x, y, z): the per-position seed StructurePlaceSettings.getRandom uses. */
export function positionRandom(x: number, y: number, z: number): JavaRandom {
  let l = BigInt.asIntN(64, BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n) ^ BigInt(y));
  l = BigInt.asIntN(64, l * l * 42317861n + l * 11n);
  return new JavaRandom(l >> 16n);
}

/** Per placed block: the state to place (VOID skips); `world` is the block there now. */
export type Processor = (state: number, x: number, y: number, z: number, world: number) => number;

export class TemplatePiece extends Piece {
  private resolved = false;
  constructor(
    readonly model: Model,
    x: number, y: number, z: number, rot: number,
    /** chooses the template's floor y the first time it's placed (or keeps y when null) */
    readonly resolveY: ((c: PlaceContext, p: TemplatePiece) => number) | null,
    readonly processor: Processor | null = null,
  ) {
    super(BoundingBox.orient(x, y, z, 0, 0, 0, model.sx, model.sy, model.sz, rot), rot);
  }

  postProcess(c: PlaceContext): boolean {
    if (!this.resolved) {
      this.resolved = true;
      if (this.resolveY) this.box.move(0, this.resolveY(c, this) - this.box.y0, 0);
    }
    const m = this.model;
    const { lv, chunk } = c;
    for (let y = 0; y < m.sy; y++) {
      const Y = this.wy(y);
      if (Y < 0 || Y > 255) continue;
      for (let z = 0; z < m.sz; z++)
        for (let x = 0; x < m.sx; x++) {
          let s = m.blocks[m.idx(x, y, z)]!;
          if (s === VOID) continue;
          const X = this.wx(x, z), Z = this.wz(x, z);
          if (!chunk.inside(X, Y, Z)) continue;
          const here = lv.getState(X, Y, Z);
          if (this.processor) {
            s = this.processor(s, X, Y, Z, here);
            if (s === VOID) continue;
          }
          s = rotateState(s, this.rot);
          // keep liquids: a waterloggable block placed in water is waterlogged
          if (FLUID[here] !== 0 && blockNameOf(here) === 'water' && getProp(s, 'waterlogged') === false) s = withProp(s, 'waterlogged', true);
          lv.setState(X, Y, Z, s);
        }
    }
    for (const ch of m.chests) {
      const X = this.wx(ch.x, ch.z), Y = this.wy(ch.y), Z = this.wz(ch.x, ch.z);
      if (!chunk.inside(X, Y, Z)) continue;
      const n = blockNameOf(lv.getState(X, Y, Z));
      if (n !== 'chest' && n !== 'barrel' && n !== 'trapped_chest') continue;
      addBlockEntity(lv, { kind: 'chest', x: X, y: Y, z: Z, lootTable: ch.loot, lootSeed: c.rand.nextLong() });
    }
    for (const sp of m.spawners) {
      const X = this.wx(sp.x, sp.z), Y = this.wy(sp.y), Z = this.wz(sp.x, sp.z);
      if (chunk.inside(X, Y, Z)) addBlockEntity(lv, { kind: 'spawner', x: X, y: Y, z: Z, entity: sp.entity });
    }
    return true;
  }

  /** heights of a heightmap over the piece's footprint, only where chunks are loaded */
  footprintHeights(c: PlaceContext, type: 'OCEAN_FLOOR_WG' | 'WORLD_SURFACE_WG'): number[] {
    const out: number[] = [];
    for (let x = this.box.x0; x <= this.box.x1; x++)
      for (let z = this.box.z0; z <= this.box.z1; z++) if (c.lv.world.isLoaded(x, z)) out.push(c.lv.getHeight(type, x, z));
    return out;
  }
}

/** BlockRotProcessor(integrity) with the per-position random. */
export function integrity(p: number): Processor {
  const f = Math.fround(p);
  return (s, x, y, z) => (positionRandom(x, y, z).nextFloat() <= f ? s : VOID);
}
