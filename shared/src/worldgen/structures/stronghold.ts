/**
 * Strongholds (vanilla 1.17.1 StrongholdFeature + StrongholdPieces): the start staircase, then
 * pieces chosen by weight (straight 40, prison hall 5/max 5, left/right turns 20, room crossing
 * 10/6, straight stairs 5/5, spiral stairs 5/5, five-way crossing 5/4, chest corridor 5/4, library
 * 10/2 past depth 4, portal room 20/1 past depth 5) through small doors, to depth 50 within 112
 * blocks, retried with seed + 1 until a portal room exists, then moved below sea level. Room
 * sizes, door logic, loot and the end portal room follow vanilla; block details are our own.
 */
import type { JavaRandom } from '../../util/random';
import { IS_AIR } from '../../world/blockinfo';
import { BoundingBox, Piece, S, type PlaceContext } from './piece';
import type { StartContext } from './placement';
import { JavaRandom as JR } from '../../util/random';
import { largeFeatureSeed } from '../rand';

const SOUTH = 0, WEST = 1, NORTH = 2, EAST = 3;
type Door = 'opening' | 'wood' | 'grates' | 'iron';

/** StructurePiece.orientBox in vanilla's per-direction layout */
function orientBox(x: number, y: number, z: number, ox: number, oy: number, oz: number, w: number, h: number, d: number, dir: number): BoundingBox {
  switch (dir) {
    case NORTH: return new BoundingBox(x + ox, y + oy, z - d + 1 + oz, x + w - 1 + ox, y + h - 1 + oy, z + oz);
    case WEST: return new BoundingBox(x - d + 1 + oz, y + oy, z + ox, x + oz, y + h - 1 + oy, z + w - 1 + ox);
    case EAST: return new BoundingBox(x + oz, y + oy, z + ox, x + d - 1 + oz, y + h - 1 + oy, z + w - 1 + ox);
    default: return new BoundingBox(x + ox, y + oy, z + oz, x + w - 1 + ox, y + h - 1 + oy, z + d - 1 + oz);
  }
}

interface Weight { type: string; weight: number; max: number; count: number; minDepth: number }
interface Gen {
  pieces: SPiece[];
  pending: SPiece[];
  rand: JavaRandom;
  start: BoundingBox;
  weights: Weight[];
  total: number;
  previous: Weight | null;
  imposed: string | null;
  portal: SPiece | null;
}

function newWeights(): Weight[] {
  return [
    { type: 'straight', weight: 40, max: 0, count: 0, minDepth: 0 },
    { type: 'prison', weight: 5, max: 5, count: 0, minDepth: 0 },
    { type: 'left', weight: 20, max: 0, count: 0, minDepth: 0 },
    { type: 'right', weight: 20, max: 0, count: 0, minDepth: 0 },
    { type: 'room', weight: 10, max: 6, count: 0, minDepth: 0 },
    { type: 'straightStairs', weight: 5, max: 5, count: 0, minDepth: 0 },
    { type: 'stairs', weight: 5, max: 5, count: 0, minDepth: 0 },
    { type: 'five', weight: 5, max: 4, count: 0, minDepth: 0 },
    { type: 'chest', weight: 5, max: 4, count: 0, minDepth: 0 },
    { type: 'library', weight: 10, max: 2, count: 0, minDepth: 5 },
    { type: 'portal', weight: 20, max: 1, count: 0, minDepth: 6 },
  ];
}
const doPlace = (w: Weight, depth: number) => (w.max === 0 || w.count < w.max) && depth >= w.minDepth;
const valid = (w: Weight) => w.max === 0 || w.count < w.max;

/** StoneBrickSelector */
function brick(r: JavaRandom, edge: boolean): number {
  if (!edge) return S('cave_air');
  const f = r.nextFloat();
  return f < 0.2 ? S('cracked_stone_bricks') : f < 0.5 ? S('mossy_stone_bricks') : f < 0.55 ? S('infested_stone_bricks') : S('stone_bricks');
}

function randomDoor(r: JavaRandom): Door {
  switch (r.nextInt(5)) {
    case 2: return 'wood';
    case 3: return 'grates';
    case 4: return 'iron';
    default: return 'opening';
  }
}

abstract class SPiece extends Piece {
  door: Door = 'opening';
  constructor(box: BoundingBox, dir: number, readonly depth: number) {
    super(box, dir);
    this.mirrored = true;
  }
  addChildren(_g: Gen): void {}

  bricks(c: PlaceContext, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skipAir = false): void {
    this.fillWith(c, x0, y0, z0, x1, y1, z1, (edge) => brick(c.rand, edge), skipAir);
  }

  /** StrongholdPiece.generateSmallDoor */
  smallDoor(c: PlaceContext, door: Door, x: number, y: number, z: number): void {
    const air = S('cave_air'), sb = S('stone_bricks');
    switch (door) {
      case 'opening':
        this.fill(c, x, y, z, x + 2, y + 2, z, air);
        break;
      case 'wood':
        this.fill(c, x, y, z, x + 2, y + 2, z, sb);
        this.set(c, S('oak_door[half=lower,facing=north]'), x + 1, y, z);
        this.set(c, S('oak_door[half=upper,facing=north]'), x + 1, y + 1, z);
        break;
      case 'grates':
        this.set(c, air, x + 1, y, z);
        this.set(c, air, x + 1, y + 1, z);
        this.set(c, S('iron_bars[west=true]'), x, y, z);
        this.set(c, S('iron_bars[west=true]'), x, y + 1, z);
        this.set(c, S('iron_bars[east=true,west=true]'), x, y + 2, z);
        this.set(c, S('iron_bars[east=true,west=true]'), x + 1, y + 2, z);
        this.set(c, S('iron_bars[east=true,west=true]'), x + 2, y + 2, z);
        this.set(c, S('iron_bars[east=true]'), x + 2, y + 1, z);
        this.set(c, S('iron_bars[east=true]'), x + 2, y, z);
        break;
      case 'iron':
        this.fill(c, x, y, z, x + 2, y + 2, z, sb);
        this.set(c, S('iron_door[half=lower,facing=north]'), x + 1, y, z);
        this.set(c, S('iron_door[half=upper,facing=north]'), x + 1, y + 1, z);
        this.set(c, S('stone_button[face=wall,facing=north]'), x + 2, y + 1, z + 1);
        this.set(c, S('stone_button[face=wall,facing=south]'), x + 2, y + 1, z - 1);
        break;
    }
  }

  forward(g: Gen, i: number, j: number): SPiece | null {
    const b = this.box;
    switch (this.rot) {
      case NORTH: return addPiece(g, b.x0 + i, b.y0 + j, b.z0 - 1, this.rot, this.depth);
      case SOUTH: return addPiece(g, b.x0 + i, b.y0 + j, b.z1 + 1, this.rot, this.depth);
      case WEST: return addPiece(g, b.x0 - 1, b.y0 + j, b.z0 + i, this.rot, this.depth);
      default: return addPiece(g, b.x1 + 1, b.y0 + j, b.z0 + i, this.rot, this.depth);
    }
  }
  left(g: Gen, i: number, j: number): SPiece | null {
    const b = this.box;
    switch (this.rot) {
      case NORTH: case SOUTH: return addPiece(g, b.x0 - 1, b.y0 + i, b.z0 + j, WEST, this.depth);
      default: return addPiece(g, b.x0 + j, b.y0 + i, b.z0 - 1, NORTH, this.depth);
    }
  }
  right(g: Gen, i: number, j: number): SPiece | null {
    const b = this.box;
    switch (this.rot) {
      case NORTH: case SOUTH: return addPiece(g, b.x1 + 1, b.y0 + i, b.z0 + j, EAST, this.depth);
      default: return addPiece(g, b.x0 + j, b.y0 + i, b.z1 + 1, SOUTH, this.depth);
    }
  }
}

// ------------------------------------------------------------------ pieces
class Straight extends SPiece {
  leftChild: boolean;
  rightChild: boolean;
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number) {
    super(box, dir, depth);
    this.door = randomDoor(r);
    this.leftChild = r.nextInt(2) === 0;
    this.rightChild = r.nextInt(2) === 0;
  }
  override addChildren(g: Gen): void {
    this.forward(g, 1, 1);
    if (this.leftChild) this.left(g, 1, 2);
    if (this.rightChild) this.right(g, 1, 2);
  }
  postProcess(c: PlaceContext): boolean {
    this.bricks(c, 0, 0, 0, 4, 4, 6);
    this.smallDoor(c, this.door, 1, 1, 0);
    this.smallDoor(c, 'opening', 1, 1, 6);
    const torchE = S('wall_torch[facing=east]'), torchW = S('wall_torch[facing=west]');
    if (c.rand.nextFloat() < 0.1) this.set(c, torchE, 1, 2, 1);
    if (c.rand.nextFloat() < 0.1) this.set(c, torchW, 3, 2, 1);
    if (c.rand.nextFloat() < 0.1) this.set(c, torchE, 1, 2, 5);
    if (c.rand.nextFloat() < 0.1) this.set(c, torchW, 3, 2, 5);
    if (this.leftChild) this.fill(c, 0, 1, 2, 0, 3, 4, S('cave_air'));
    if (this.rightChild) this.fill(c, 4, 1, 2, 4, 3, 4, S('cave_air'));
    return true;
  }
}

class ChestCorridor extends SPiece {
  private hasPlacedChest = false;
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number) {
    super(box, dir, depth);
    this.door = randomDoor(r);
  }
  override addChildren(g: Gen): void {
    this.forward(g, 1, 1);
  }
  postProcess(c: PlaceContext): boolean {
    this.bricks(c, 0, 0, 0, 4, 4, 6);
    this.smallDoor(c, this.door, 1, 1, 0);
    this.smallDoor(c, 'opening', 1, 1, 6);
    this.fill(c, 3, 1, 2, 3, 1, 4, S('stone_bricks'));
    this.set(c, S('stone_brick_slab'), 3, 1, 1);
    this.set(c, S('stone_brick_slab'), 3, 1, 5);
    this.set(c, S('stone_brick_slab'), 3, 2, 2);
    this.set(c, S('stone_brick_slab'), 3, 2, 4);
    for (let z = 2; z <= 4; z++) this.set(c, S('stone_brick_slab'), 2, 1, z);
    if (!this.hasPlacedChest && this.isInside(c, 3, 2, 3)) {
      this.hasPlacedChest = true;
      this.chest(c, 3, 2, 3, 'minecraft:chests/stronghold_corridor', S('chest[facing=west]'));
    }
    return true;
  }
}

class PrisonHall extends SPiece {
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number) {
    super(box, dir, depth);
    this.door = randomDoor(r);
  }
  override addChildren(g: Gen): void {
    this.forward(g, 1, 1);
  }
  postProcess(c: PlaceContext): boolean {
    this.bricks(c, 0, 0, 0, 8, 4, 10);
    this.smallDoor(c, this.door, 1, 1, 0);
    this.fill(c, 1, 1, 10, 3, 3, 10, S('cave_air'));
    // the cells: stone-brick walls with iron bars and iron doors
    this.bricks(c, 4, 1, 1, 4, 3, 1);
    this.bricks(c, 4, 1, 3, 4, 3, 3);
    this.bricks(c, 4, 1, 7, 4, 3, 7);
    this.bricks(c, 4, 1, 9, 4, 3, 9);
    for (let y = 1; y <= 3; y++) {
      this.set(c, S('iron_bars[north=true,south=true]'), 4, y, 4);
      this.set(c, S('iron_bars[north=true,south=true,east=true]'), 4, y, 5);
      this.set(c, S('iron_bars[north=true,south=true]'), 4, y, 6);
      for (let x = 5; x <= 7; x++) this.set(c, S('iron_bars[east=true,west=true]'), x, y, 5);
    }
    this.set(c, S('iron_bars[north=true,south=true]'), 4, 3, 2);
    this.set(c, S('iron_bars[north=true,south=true]'), 4, 3, 8);
    this.set(c, S('iron_door[facing=west,half=lower]'), 4, 1, 2);
    this.set(c, S('iron_door[facing=west,half=upper]'), 4, 2, 2);
    this.set(c, S('iron_door[facing=west,half=lower]'), 4, 1, 8);
    this.set(c, S('iron_door[facing=west,half=upper]'), 4, 2, 8);
    return true;
  }
}

class Turn extends SPiece {
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number, readonly isLeft: boolean) {
    super(box, dir, depth);
    this.door = randomDoor(r);
  }
  override addChildren(g: Gen): void {
    // vanilla swaps left/right for NORTH and EAST because of their mirrored frames
    const goLeft = this.rot === NORTH || this.rot === EAST ? this.isLeft : !this.isLeft;
    if (goLeft) this.left(g, 1, 1);
    else this.right(g, 1, 1);
  }
  postProcess(c: PlaceContext): boolean {
    this.bricks(c, 0, 0, 0, 4, 4, 4);
    this.smallDoor(c, this.door, 1, 1, 0);
    const goLeft = this.rot === NORTH || this.rot === EAST ? this.isLeft : !this.isLeft;
    if (goLeft) this.fill(c, 0, 1, 1, 0, 3, 3, S('cave_air'));
    else this.fill(c, 4, 1, 1, 4, 3, 3, S('cave_air'));
    return true;
  }
}

class RoomCrossing extends SPiece {
  readonly type: number;
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number) {
    super(box, dir, depth);
    this.door = randomDoor(r);
    this.type = r.nextInt(5);
  }
  override addChildren(g: Gen): void {
    this.forward(g, 4, 1);
    this.left(g, 1, 4);
    this.right(g, 1, 4);
  }
  postProcess(c: PlaceContext): boolean {
    const air = S('cave_air');
    this.bricks(c, 0, 0, 0, 10, 6, 10);
    this.smallDoor(c, this.door, 4, 1, 0);
    this.fill(c, 4, 1, 10, 6, 3, 10, air);
    this.fill(c, 0, 1, 4, 0, 3, 6, air);
    this.fill(c, 10, 1, 4, 10, 3, 6, air);
    switch (this.type) {
      case 0: {
        // a central pillar ringed with torches and slabs
        this.fill(c, 5, 1, 5, 5, 5, 5, S('stone_bricks'));
        for (const [x, z, f] of [[4, 5, 'west'], [6, 5, 'east'], [5, 4, 'north'], [5, 6, 'south']] as const) this.set(c, S(`wall_torch[facing=${f}]`), x, 3, z);
        for (const [x, z] of [[4, 4], [4, 6], [6, 4], [6, 6], [4, 5], [6, 5], [5, 4], [5, 6]] as const) this.set(c, S('smooth_stone_slab'), x, 1, z);
        break;
      }
      case 1: {
        // a cobblestone fountain basin with a water source on top
        for (let i = 0; i < 5; i++) {
          this.set(c, S('stone_bricks'), 3, 1, 3 + i);
          this.set(c, S('stone_bricks'), 7, 1, 3 + i);
          this.set(c, S('stone_bricks'), 3 + i, 1, 3);
          this.set(c, S('stone_bricks'), 3 + i, 1, 7);
        }
        this.fill(c, 5, 1, 5, 5, 3, 5, S('stone_bricks'));
        this.set(c, S('water'), 5, 4, 5);
        break;
      }
      case 2: {
        // storeroom: cobblestone gallery, ladder and the crossing chest
        const cob = S('cobblestone'), planks = S('oak_planks');
        for (let i = 1; i <= 9; i++) {
          this.set(c, cob, 1, 3, i);
          this.set(c, cob, 9, 3, i);
        }
        for (let i = 1; i <= 9; i++) {
          this.set(c, cob, i, 3, 1);
          this.set(c, cob, i, 3, 9);
        }
        this.set(c, cob, 5, 1, 4);
        this.set(c, cob, 5, 1, 6);
        this.set(c, cob, 5, 3, 4);
        this.set(c, cob, 5, 3, 6);
        this.set(c, cob, 4, 1, 5);
        this.set(c, cob, 6, 1, 5);
        this.set(c, cob, 4, 3, 5);
        this.set(c, cob, 6, 3, 5);
        for (let y = 1; y <= 3; y++) {
          this.set(c, cob, 4, y, 4);
          this.set(c, cob, 6, y, 4);
          this.set(c, cob, 4, y, 6);
          this.set(c, cob, 6, y, 6);
        }
        this.set(c, S('wall_torch[facing=south]'), 5, 3, 5);
        for (let x = 2; x <= 8; x++) for (let z = 2; z <= 8; z++) this.set(c, planks, x, 4, z);
        for (let y = 1; y <= 4; y++) this.set(c, S('ladder[facing=west]'), 9, y, 3);
        this.chest(c, 3, 5, 3, 'minecraft:chests/stronghold_crossing', S('chest[facing=south]'));
        break;
      }
      default:
        break;
    }
    return true;
  }
}

class StraightStairsDown extends SPiece {
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number) {
    super(box, dir, depth);
    this.door = randomDoor(r);
  }
  override addChildren(g: Gen): void {
    this.forward(g, 1, 1);
  }
  postProcess(c: PlaceContext): boolean {
    this.bricks(c, 0, 0, 0, 4, 10, 7);
    this.smallDoor(c, this.door, 1, 7, 0);
    this.smallDoor(c, 'opening', 1, 1, 7);
    const stair = S('cobblestone_stairs[facing=south]');
    for (let i = 0; i < 6; i++) {
      this.set(c, stair, 1, 6 - i, 1 + i);
      this.set(c, stair, 2, 6 - i, 1 + i);
      this.set(c, stair, 3, 6 - i, 1 + i);
      if (i < 5) {
        this.set(c, S('stone_bricks'), 1, 5 - i, 1 + i);
        this.set(c, S('stone_bricks'), 2, 5 - i, 1 + i);
        this.set(c, S('stone_bricks'), 3, 5 - i, 1 + i);
      }
    }
    return true;
  }
}

class StairsDown extends SPiece {
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number, readonly isSource = false) {
    super(box, dir, depth);
    this.door = isSource ? 'opening' : randomDoor(r);
  }
  override addChildren(g: Gen): void {
    if (this.isSource) g.imposed = 'five';
    this.forward(g, 1, 1);
  }
  postProcess(c: PlaceContext): boolean {
    this.bricks(c, 0, 0, 0, 4, 10, 4);
    this.smallDoor(c, this.door, 1, 7, 0);
    this.smallDoor(c, 'opening', 1, 1, 4);
    // the spiral staircase around a stone-brick core
    const sb = S('stone_bricks'), slab = S('smooth_stone_slab');
    this.set(c, sb, 2, 6, 1);
    this.set(c, sb, 1, 5, 1);
    this.set(c, slab, 1, 6, 1);
    this.set(c, sb, 1, 5, 2);
    this.set(c, sb, 1, 4, 3);
    this.set(c, slab, 1, 5, 3);
    this.set(c, sb, 2, 4, 3);
    this.set(c, sb, 3, 3, 3);
    this.set(c, slab, 3, 4, 3);
    this.set(c, sb, 3, 3, 2);
    this.set(c, sb, 3, 2, 1);
    this.set(c, slab, 3, 3, 1);
    this.set(c, sb, 2, 2, 1);
    this.set(c, sb, 1, 1, 1);
    this.set(c, slab, 1, 2, 1);
    this.set(c, sb, 1, 1, 2);
    this.set(c, slab, 1, 1, 3);
    for (let y = 1; y <= 9; y++) this.set(c, sb, 2, y, 2);
    return true;
  }
}

class FiveCrossing extends SPiece {
  leftLow: boolean; leftHigh: boolean; rightLow: boolean; rightHigh: boolean;
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number) {
    super(box, dir, depth);
    this.door = randomDoor(r);
    this.leftLow = r.nextBoolean();
    this.leftHigh = r.nextBoolean();
    this.rightLow = r.nextBoolean();
    this.rightHigh = r.nextInt(3) > 0;
  }
  override addChildren(g: Gen): void {
    let i = 3, j = 5;
    if (this.rot === WEST || this.rot === NORTH) {
      i = 8 - i;
      j = 8 - j;
    }
    this.forward(g, 5, 1);
    if (this.leftLow) this.left(g, i, 1);
    if (this.leftHigh) this.left(g, j, 7);
    if (this.rightLow) this.right(g, i, 1);
    if (this.rightHigh) this.right(g, j, 7);
  }
  postProcess(c: PlaceContext): boolean {
    const air = S('cave_air'), sb = S('stone_bricks');
    this.bricks(c, 0, 0, 0, 9, 8, 10);
    this.smallDoor(c, this.door, 4, 3, 0);
    if (this.leftLow) this.fill(c, 0, 3, 1, 0, 5, 3, air);
    if (this.rightLow) this.fill(c, 9, 3, 1, 9, 5, 3, air);
    if (this.leftHigh) this.fill(c, 0, 5, 7, 0, 7, 9, air);
    if (this.rightHigh) this.fill(c, 9, 5, 7, 9, 7, 9, air);
    this.fill(c, 5, 1, 10, 7, 3, 10, air);
    // the raised floor and the upper walkway with steps
    this.bricks(c, 1, 2, 1, 8, 2, 6);
    this.bricks(c, 4, 1, 5, 4, 4, 9);
    this.bricks(c, 8, 1, 5, 8, 4, 9);
    this.bricks(c, 1, 4, 7, 3, 4, 9);
    this.bricks(c, 1, 3, 5, 3, 3, 6);
    this.fill(c, 1, 3, 4, 3, 3, 4, S('smooth_stone_slab'));
    this.fill(c, 1, 4, 6, 3, 4, 6, S('smooth_stone_slab'));
    this.bricks(c, 5, 1, 7, 7, 1, 8);
    this.fill(c, 5, 1, 9, 7, 1, 9, S('smooth_stone_slab'));
    this.fill(c, 5, 2, 7, 7, 2, 7, S('smooth_stone_slab'));
    this.fill(c, 4, 5, 7, 4, 5, 9, S('smooth_stone_slab'));
    this.fill(c, 8, 5, 7, 8, 5, 9, S('smooth_stone_slab'));
    this.fill(c, 5, 5, 7, 7, 5, 9, S('smooth_stone_slab[type=double]'));
    this.set(c, S('wall_torch[facing=south]'), 6, 5, 6);
    void sb;
    return true;
  }
}

class Library extends SPiece {
  constructor(r: JavaRandom, box: BoundingBox, dir: number, depth: number, readonly tall: boolean) {
    super(box, dir, depth);
    this.door = randomDoor(r);
  }
  postProcess(c: PlaceContext): boolean {
    const H = this.tall ? 10 : 5;
    const shelf = S('bookshelf'), planks = S('oak_planks'), fence = S('oak_fence'), air = S('cave_air');
    this.bricks(c, 0, 0, 0, 13, H, 14);
    this.smallDoor(c, this.door, 4, 1, 0);
    this.fillMaybe(c, c.rand, 0.07, 2, 1, 1, 11, 4, 13, S('cobweb'), S('cobweb'), false);
    for (let z = 1; z <= 13; z++) {
      if ((z - 1) % 4 === 0) {
        this.fill(c, 1, 1, z, 1, 4, z, planks);
        this.fill(c, 12, 1, z, 12, 4, z, planks);
        this.set(c, S('wall_torch[facing=east]'), 2, 3, z);
        this.set(c, S('wall_torch[facing=west]'), 11, 3, z);
        if (this.tall) {
          this.fill(c, 1, 6, z, 1, 9, z, planks);
          this.fill(c, 12, 6, z, 12, 9, z, planks);
        }
      } else {
        this.fill(c, 1, 1, z, 1, 4, z, shelf);
        this.fill(c, 12, 1, z, 12, 4, z, shelf);
        if (this.tall) {
          this.fill(c, 1, 6, z, 1, 9, z, shelf);
          this.fill(c, 12, 6, z, 12, 9, z, shelf);
        }
      }
    }
    // free-standing shelves
    for (let z = 3; z < 12; z += 2) {
      this.fill(c, 3, 1, z, 4, 3, z, shelf);
      this.fill(c, 6, 1, z, 7, 3, z, shelf);
      this.fill(c, 9, 1, z, 10, 3, z, shelf);
    }
    if (this.tall) {
      // the balcony with its railing and ladder, and the chandelier
      this.fill(c, 1, 5, 1, 3, 5, 13, planks);
      this.fill(c, 10, 5, 1, 12, 5, 13, planks);
      this.fill(c, 4, 5, 1, 9, 5, 2, planks);
      this.fill(c, 4, 5, 12, 9, 5, 13, planks);
      this.set(c, planks, 9, 5, 11);
      this.set(c, planks, 8, 5, 11);
      this.set(c, planks, 9, 5, 10);
      this.fill(c, 3, 6, 3, 3, 6, 11, fence);
      this.fill(c, 10, 6, 3, 10, 6, 9, fence);
      this.fill(c, 4, 6, 2, 9, 6, 2, fence);
      this.fill(c, 4, 6, 12, 7, 6, 12, fence);
      for (let y = 1; y <= 7; y++) this.set(c, S('ladder[facing=north]'), 10, y, 13);
      this.fill(c, 6, 9, 7, 7, 9, 7, fence);
      this.fill(c, 6, 8, 7, 7, 8, 7, fence);
      this.fill(c, 6, 7, 7, 7, 7, 7, fence);
      this.set(c, S('wall_torch[facing=west]'), 5, 8, 7);
      this.set(c, S('wall_torch[facing=east]'), 8, 8, 7);
      this.set(c, S('wall_torch[facing=north]'), 6, 8, 6);
      this.set(c, S('wall_torch[facing=south]'), 6, 8, 8);
    }
    this.fill(c, 2, 1, 1, 2, 1, 1, air);
    this.chest(c, 3, 3, 5, 'minecraft:chests/stronghold_library', S('chest[facing=west]'));
    if (this.tall) {
      this.set(c, air, 12, 9, 1);
      this.chest(c, 12, 8, 1, 'minecraft:chests/stronghold_library', S('chest[facing=west]'));
    }
    return true;
  }
}

class PortalRoom extends SPiece {
  private hasSpawner = false;
  postProcess(c: PlaceContext): boolean {
    const air = S('cave_air'), sb = S('stone_bricks'), lava = S('lava'), bars = S('iron_bars[east=true,west=true]');
    this.bricks(c, 0, 0, 0, 10, 7, 15);
    this.smallDoor(c, 'grates', 4, 1, 0);
    this.bricks(c, 1, 6, 1, 1, 6, 14);
    this.bricks(c, 9, 6, 1, 9, 6, 14);
    this.bricks(c, 2, 6, 1, 8, 6, 2);
    this.bricks(c, 2, 6, 14, 8, 6, 14);
    this.bricks(c, 1, 1, 1, 2, 1, 4);
    this.bricks(c, 8, 1, 1, 9, 1, 4);
    this.fill(c, 1, 1, 1, 1, 1, 3, lava);
    this.fill(c, 9, 1, 1, 9, 1, 3, lava);
    this.bricks(c, 3, 1, 8, 7, 1, 12);
    this.fill(c, 4, 1, 9, 6, 1, 11, lava);
    for (let z = 3; z < 14; z += 2) {
      this.fill(c, 0, 3, z, 0, 4, z, S('iron_bars[north=true,south=true]'));
      this.fill(c, 10, 3, z, 10, 4, z, S('iron_bars[north=true,south=true]'));
    }
    for (let x = 2; x < 9; x += 2) this.fill(c, x, 3, 15, x, 4, 15, bars);
    // the stairs up to the portal and the silverfish spawner on them
    const stair = S('stone_brick_stairs[facing=north]');
    this.bricks(c, 4, 1, 5, 6, 1, 7);
    this.bricks(c, 4, 2, 6, 6, 2, 7);
    this.bricks(c, 4, 3, 7, 6, 3, 7);
    for (let x = 4; x <= 6; x++) {
      this.set(c, stair, x, 1, 4);
      this.set(c, stair, x, 2, 5);
      this.set(c, stair, x, 3, 6);
    }
    // twelve end portal frames, each with an eye 10% of the time
    const frames: [number, number, string][] = [];
    for (let x = 4; x <= 6; x++) frames.push([x, 8, 'south']);
    for (let x = 4; x <= 6; x++) frames.push([x, 12, 'north']);
    for (let z = 9; z <= 11; z++) frames.push([3, z, 'east']);
    for (let z = 9; z <= 11; z++) frames.push([7, z, 'west']);
    let all = true;
    const eyes: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      eyes[i] = c.rand.nextFloat() > 0.9;
      all &&= eyes[i]!;
    }
    frames.forEach(([x, z, f], i) => this.set(c, S(`end_portal_frame[facing=${f},eye=${eyes[i]}]`), x, 3, z));
    if (all) this.fill(c, 4, 3, 9, 6, 3, 11, S('end_portal'));
    else this.fill(c, 4, 3, 9, 6, 3, 11, air);
    if (!this.hasSpawner && this.isInside(c, 5, 3, 6)) {
      this.hasSpawner = true;
      this.spawner(c, 5, 3, 6, 'silverfish');
    }
    void sb;
    return true;
  }
}

class FillerCorridor extends SPiece {
  constructor(box: BoundingBox, dir: number, depth: number, readonly steps: number) {
    super(box, dir, depth);
  }
  postProcess(c: PlaceContext): boolean {
    for (let i = 0; i < this.steps; i++) {
      this.set(c, S('stone_bricks'), 0, 0, i);
      this.set(c, S('stone_bricks'), 1, 0, i);
      this.set(c, S('stone_bricks'), 2, 0, i);
      this.set(c, S('stone_bricks'), 3, 0, i);
      this.set(c, S('stone_bricks'), 4, 0, i);
      for (let y = 1; y <= 3; y++) {
        this.set(c, S('stone_bricks'), 0, y, i);
        this.set(c, S('cave_air'), 1, y, i);
        this.set(c, S('cave_air'), 2, y, i);
        this.set(c, S('cave_air'), 3, y, i);
        this.set(c, S('stone_bricks'), 4, y, i);
      }
      for (let x = 0; x <= 4; x++) this.set(c, S('stone_bricks'), x, 4, i);
    }
    return true;
  }
}

// ------------------------------------------------------------------ assembly
const collides = (g: Gen, b: BoundingBox) => g.pieces.some((p) => p.box.intersects(b));

function createPiece(g: Gen, type: string, x: number, y: number, z: number, dir: number, depth: number): SPiece | null {
  const r = g.rand;
  const ok = (b: BoundingBox) => b.y0 > 10 && !collides(g, b);
  let b: BoundingBox;
  switch (type) {
    case 'straight': b = orientBox(x, y, z, -1, -1, 0, 5, 5, 7, dir); return ok(b) ? new Straight(r, b, dir, depth) : null;
    case 'chest': b = orientBox(x, y, z, -1, -1, 0, 5, 5, 7, dir); return ok(b) ? new ChestCorridor(r, b, dir, depth) : null;
    case 'prison': b = orientBox(x, y, z, -1, -1, 0, 9, 5, 11, dir); return ok(b) ? new PrisonHall(r, b, dir, depth) : null;
    case 'left': b = orientBox(x, y, z, -1, -1, 0, 5, 5, 5, dir); return ok(b) ? new Turn(r, b, dir, depth, true) : null;
    case 'right': b = orientBox(x, y, z, -1, -1, 0, 5, 5, 5, dir); return ok(b) ? new Turn(r, b, dir, depth, false) : null;
    case 'room': b = orientBox(x, y, z, -4, -1, 0, 11, 7, 11, dir); return ok(b) ? new RoomCrossing(r, b, dir, depth) : null;
    case 'straightStairs': b = orientBox(x, y, z, -1, -7, 0, 5, 11, 8, dir); return ok(b) ? new StraightStairsDown(r, b, dir, depth) : null;
    case 'stairs': b = orientBox(x, y, z, -1, -7, 0, 5, 11, 5, dir); return ok(b) ? new StairsDown(r, b, dir, depth) : null;
    case 'five': b = orientBox(x, y, z, -4, -3, 0, 10, 9, 11, dir); return ok(b) ? new FiveCrossing(r, b, dir, depth) : null;
    case 'library': {
      b = orientBox(x, y, z, -4, -1, 0, 14, 11, 15, dir);
      if (ok(b)) return new Library(r, b, dir, depth, true);
      b = orientBox(x, y, z, -4, -1, 0, 14, 6, 15, dir);
      return ok(b) ? new Library(r, b, dir, depth, false) : null;
    }
    case 'portal': {
      b = orientBox(x, y, z, -4, -1, 0, 11, 8, 16, dir);
      if (!ok(b)) return null;
      const p = new PortalRoom(b, dir, depth);
      g.portal = p;
      return p;
    }
  }
  return null;
}

/** StrongholdPieces.generatePieceFromSmallDoor */
function pieceFromSmallDoor(g: Gen, x: number, y: number, z: number, dir: number, depth: number): SPiece | null {
  g.total = g.weights.reduce((s, w) => s + w.weight, 0);
  if (g.total <= 0 || !g.weights.some((w) => w.max > 0 && w.count < w.max)) return null;
  if (g.imposed) {
    const p = createPiece(g, g.imposed, x, y, z, dir, depth);
    g.imposed = null;
    if (p) return p;
  }
  for (let i = 0; i < 5; i++) {
    let j = g.rand.nextInt(g.total);
    for (const w of g.weights) {
      j -= w.weight;
      if (j >= 0) continue;
      if (!doPlace(w, depth) || w === g.previous) break;
      const p = createPiece(g, w.type, x, y, z, dir, depth);
      if (!p) continue;
      w.count++;
      g.previous = w;
      if (!valid(w)) g.weights.splice(g.weights.indexOf(w), 1);
      return p;
    }
  }
  // FillerCorridor.findPieceBox
  const box = orientBox(x, y, z, -1, -1, 0, 5, 5, 4, dir);
  const hit = g.pieces.find((p) => p.box.intersects(box));
  if (hit && hit.box.y0 === box.y0)
    for (let k = 2; k >= 1; k--) {
      const b2 = orientBox(x, y, z, -1, -1, 0, 5, 5, k, dir);
      if (!hit.box.intersects(b2)) {
        const fb = orientBox(x, y, z, -1, -1, 0, 5, 5, k + 1, dir);
        if (fb.y0 > 1) return new FillerCorridor(fb, dir, depth, k + 1);
        break;
      }
    }
  return null;
}

/** StrongholdPieces.generateAndAddPiece */
function addPiece(g: Gen, x: number, y: number, z: number, dir: number, depth: number): SPiece | null {
  if (depth > 50) return null;
  if (Math.abs(x - g.start.x0) > 112 || Math.abs(z - g.start.z0) > 112) return null;
  const p = pieceFromSmallDoor(g, x, y, z, dir, depth + 1);
  if (p) {
    g.pieces.push(p);
    g.pending.push(p);
  }
  return p;
}

export function stronghold(s: StartContext): Piece[] {
  for (let attempt = 0; attempt < 32; attempt++) {
    const r = attempt === 0 ? s.rand : new JR(largeFeatureSeed(BigInt.asIntN(64, s.seed + BigInt(attempt)), s.cx, s.cz));
    const dir = r.nextInt(4);
    const x = (s.cx << 4) + 2, z = (s.cz << 4) + 2;
    const startBox = orientBox(x, 64, z, 0, 0, 0, 5, 11, 5, dir);
    const g: Gen = { pieces: [], pending: [], rand: r, start: startBox, weights: newWeights(), total: 0, previous: null, imposed: null, portal: null };
    const start = new StairsDown(r, startBox, dir, 0, true);
    g.pieces.push(start);
    start.addChildren(g);
    while (g.pending.length) {
      const p = g.pending.splice(r.nextInt(g.pending.length), 1)[0]!;
      p.addChildren(g);
    }
    if (!g.portal) continue;
    // moveBelowSeaLevel(63, 0, random, 10)
    const all = start.box.copy();
    for (const p of g.pieces) all.encapsulate(p.box);
    let j = all.ySpan + 1;
    if (j < 53) j += r.nextInt(53 - j);
    const dy = j - all.y1;
    for (const p of g.pieces) p.box.move(0, dy, 0);
    return g.pieces;
  }
  return [];
}
void IS_AIR;
