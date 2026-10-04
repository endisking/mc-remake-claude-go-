/**
 * Scattered features (vanilla 1.17.1 ScatteredFeaturePiece family): desert pyramid, jungle temple,
 * swamp hut and igloo. Sizes, placement heights, room logic, traps, chests and loot tables follow
 * vanilla; the block-by-block designs are this project's own.
 */
import type { JavaRandom } from '../../util/random';
import { BoundingBox, Piece, S, type PlaceContext } from './piece';
import type { StartContext } from './placement';

/** ScatteredFeaturePiece: box of (w, h, d) at (x, y, z), w across local x. */
function scatteredBox(x: number, y: number, z: number, w: number, h: number, d: number, rot: number): BoundingBox {
  return rot & 1 ? new BoundingBox(x, y, z, x + d - 1, y + h - 1, z + w - 1) : new BoundingBox(x, y, z, x + w - 1, y + h - 1, z + d - 1);
}

// ------------------------------------------------------------------ desert pyramid
const SANDSTONE = 'sandstone';
const CUT = 'cut_sandstone';
const CHISELED = 'chiseled_sandstone';

class DesertPyramidPiece extends Piece {
  constructor(rand: JavaRandom, x: number, z: number) {
    const rot = rand.nextInt(4);
    super(scatteredBox(x, 64, z, 21, 15, 21, rot), rot);
  }

  postProcess(c: PlaceContext): boolean {
    const ss = S(SANDSTONE), cut = S(CUT), chis = S(CHISELED), air = S('air');
    const orange = S('orange_terracotta'), blue = S('blue_terracotta');
    const W = 21, D = 21;
    // foundation and the stepped hollow body
    this.fill(c, 0, -4, 0, W - 1, 0, D - 1, ss);
    for (let i = 1; i <= 9; i++) {
      this.fill(c, i, i, i, W - 1 - i, i, D - 1 - i, ss);
      this.fill(c, i + 1, i, i + 1, W - 2 - i, i, D - 2 - i, air);
    }
    for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) this.fillDown(c, ss, x, -5, z);
    const stairN = S('sandstone_stairs[facing=south]'), stairS = S('sandstone_stairs[facing=north]');
    const stairE = S('sandstone_stairs[facing=west]'), stairW = S('sandstone_stairs[facing=east]');
    // two front towers (local z = 0 is the front)
    for (const tx of [0, W - 5]) {
      this.fill(c, tx, 0, 0, tx + 4, 9, 4, ss, air);
      this.fill(c, tx + 1, 10, 1, tx + 3, 10, 3, cut);
      this.set(c, stairN, tx + 2, 10, 0);
      this.set(c, stairS, tx + 2, 10, 4);
      this.set(c, stairW, tx, 10, 2);
      this.set(c, stairE, tx + 4, 10, 2);
      // tower doorway into the hall and outward door
      this.fill(c, tx + 1, 1, 0, tx + 3, 4, 0, ss);
      this.fill(c, tx + 2, 1, 0, tx + 2, 2, 0, air);
      // terracotta bands and the chiseled eye on the tower face
      for (const y of [6, 8]) this.fill(c, tx + 1, y, 0, tx + 3, y, 0, orange);
      this.set(c, chis, tx + 2, 7, 0);
      this.set(c, blue, tx + 2, 9, 0);
      // inner stair climbing to the roof
      for (let y = 1; y <= 8; y++) this.set(c, S('ladder[facing=south]'), tx + 2, y, 3);
      this.set(c, air, tx + 2, 9, 3);
      this.set(c, air, tx + 2, 10, 3);
    }
    // the entrance portico between the towers
    this.fill(c, 8, 0, 0, 12, 4, 4, ss, air);
    this.fill(c, 9, 1, 0, 11, 3, 4, air);
    this.set(c, cut, 9, 3, 0);
    this.set(c, cut, 11, 3, 0);
    this.fill(c, 8, 5, 0, 12, 5, 0, cut);
    this.set(c, chis, 10, 5, 0);
    // side passages from the towers into the hall
    this.fill(c, 5, 1, 1, 7, 2, 3, air);
    this.fill(c, 13, 1, 1, 15, 2, 3, air);
    this.fill(c, 5, 1, 4, 15, 2, 4, air);
    // the hall: pillars, a raised walkway and the terracotta floor design
    for (const [px, pz] of [[5, 5], [15, 5], [5, 15], [15, 15], [5, 10], [15, 10]] as const) {
      this.fill(c, px, 1, pz, px, 4, pz, cut);
      this.set(c, chis, px, 2, pz);
    }
    this.fill(c, 9, 0, 9, 11, 0, 11, orange);
    this.fill(c, 8, 0, 10, 12, 0, 10, orange);
    this.fill(c, 10, 0, 8, 10, 0, 12, orange);
    this.set(c, blue, 10, 0, 10);
    for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) this.set(c, orange, 10 + dx, 0, 10 + dz);
    // floor of the hall above the hidden shaft is solid; the treasure room lies below
    this.fill(c, 7, -1, 7, 13, -9, 13, ss);
    this.fill(c, 7, -10, 7, 13, -14, 13, ss);
    // the treasure room: a plus-shaped 5×5 chamber with four chest alcoves
    this.fill(c, 9, -11, 8, 11, -10, 12, air);
    this.fill(c, 8, -11, 9, 12, -10, 11, air);
    this.fill(c, 9, -9, 9, 11, -9, 11, cut);
    this.set(c, chis, 10, -9, 10);
    for (const [wx, wz] of [[8, 8], [12, 8], [8, 12], [12, 12]] as const) this.fill(c, wx, -11, wz, wx, -10, wz, chis);
    // the trap: a stone pressure plate over nine TNT
    this.fill(c, 9, -13, 9, 11, -13, 11, S('tnt'));
    this.set(c, S('stone_pressure_plate'), 10, -11, 10);
    // four chests two blocks out from the centre (vanilla: east, south, west, north)
    for (const [dx, dz] of [[2, 0], [0, 2], [-2, 0], [0, -2]] as const) this.chest(c, 10 + dx, -11, 10 + dz, 'chests/desert_pyramid');
    return true;
  }
}

export function desertPyramid(s: StartContext): Piece[] {
  return [new DesertPyramidPiece(s.rand, s.cx << 4, s.cz << 4)];
}

// ------------------------------------------------------------------ jungle temple
class JungleTemplePiece extends Piece {
  constructor(rand: JavaRandom, x: number, z: number) {
    const rot = rand.nextInt(4);
    super(scatteredBox(x, 64, z, 12, 10, 15, rot), rot);
  }

  postProcess(c: PlaceContext): boolean {
    if (!this.updateAverageGroundHeight(c, 0)) return false;
    const r = c.rand;
    // MossStoneSelector: 40% cobblestone, else mossy cobblestone
    const stone = () => (r.nextFloat() < 0.4 ? S('cobblestone') : S('mossy_cobblestone'));
    const pick = () => stone();
    const air = S('air');
    // shell, -4 (basement floor) to 9 (roof)
    this.fillWith(c, 0, -4, 0, 11, 0, 14, pick);
    this.fillWith(c, 2, 1, 2, 9, 2, 2, pick);
    this.fillWith(c, 2, 1, 12, 9, 2, 12, pick);
    this.fillWith(c, 2, 1, 3, 2, 2, 11, pick);
    this.fillWith(c, 9, 1, 3, 9, 2, 11, pick);
    this.fillWith(c, 1, 3, 1, 10, 6, 1, pick);
    this.fillWith(c, 1, 3, 13, 10, 6, 13, pick);
    this.fillWith(c, 1, 3, 2, 1, 6, 12, pick);
    this.fillWith(c, 10, 3, 2, 10, 6, 12, pick);
    this.fillWith(c, 2, 3, 2, 9, 3, 12, pick);
    this.fillWith(c, 2, 6, 2, 9, 6, 12, pick);
    this.fillWith(c, 3, 7, 3, 8, 7, 11, pick);
    this.fillWith(c, 4, 8, 4, 7, 8, 10, pick);
    this.fill(c, 3, 1, 3, 8, 2, 11, air);
    this.fill(c, 4, 3, 6, 7, 3, 9, air);
    this.fill(c, 2, 4, 2, 9, 5, 12, air);
    this.fill(c, 4, 6, 5, 7, 6, 9, air);
    this.fill(c, 5, 7, 6, 6, 7, 8, air);
    // the front entrance and windows
    this.fill(c, 5, 1, 2, 6, 2, 2, air);
    this.fill(c, 5, 2, 12, 6, 2, 12, air);
    this.fill(c, 5, 5, 1, 6, 5, 1, air);
    this.fill(c, 5, 5, 13, 6, 5, 13, air);
    this.set(c, air, 1, 5, 5);
    this.set(c, air, 10, 5, 5);
    this.set(c, air, 1, 5, 9);
    this.set(c, air, 10, 5, 9);
    // chiseled-looking rims: stairs on the roof edges
    const stairUp = S('cobblestone_stairs[facing=north]'), stairDown = S('cobblestone_stairs[facing=south]');
    for (let x = 2; x <= 9; x++) {
      this.set(c, stairUp, x, 7, 2);
      this.set(c, stairDown, x, 7, 12);
    }
    for (let x = 0; x < 12; x++) for (let z = 0; z < 15; z++) this.fillDown(c, stone(), x, -5, z);
    // stairway from the ground floor down to the basement (back right)
    const stairS = S('cobblestone_stairs[facing=south]');
    this.fill(c, 8, -3, 3, 8, 0, 6, air);
    for (let i = 0; i < 4; i++) this.set(c, stairS, 8, -i, 3 + i);
    this.fill(c, 8, -3, 7, 8, -1, 7, air);
    // basement: the trap corridor along local x = 8 → 8 with tripwires and arrow dispensers
    this.fill(c, 3, -3, 8, 8, -1, 11, air);
    this.fill(c, 8, -3, 7, 8, -1, 11, air);
    this.fill(c, 2, -3, 1, 4, -1, 7, air);
    this.fill(c, 3, -3, 7, 3, -1, 8, air);
    // first trap: tripwire across the stair foot, dispenser in the wall facing the corridor
    this.set(c, S('tripwire_hook[facing=east,attached=true]'), 7, -3, 7);
    this.set(c, S('tripwire_hook[facing=west,attached=true]'), 9, -3, 7);
    this.set(c, S('tripwire[attached=true,east=true,west=true]'), 8, -3, 7);
    this.set(c, S('redstone_wire[north=side,south=side]'), 9, -3, 6);
    this.set(c, S('redstone_wire[north=side,south=side]'), 9, -3, 5);
    this.set(c, S('dispenser[facing=north]'), 9, -2, 4);
    this.chest(c, 9, -2, 4, 'chests/jungle_temple_dispenser', S('dispenser[facing=north]'));
    this.set(c, stone(), 9, -1, 4);
    // second trap: tripwire in the far corridor, dispenser firing along it
    this.set(c, S('tripwire_hook[facing=south,attached=true]'), 4, -3, 7);
    this.set(c, S('tripwire_hook[facing=north,attached=true]'), 4, -3, 9);
    this.set(c, S('tripwire[attached=true,north=true,south=true]'), 4, -3, 8);
    this.set(c, S('redstone_wire[east=side,west=side]'), 4, -3, 10);
    this.set(c, S('redstone_wire[north=side,south=side]'), 4, -3, 11);
    this.set(c, S('dispenser[facing=north]'), 4, -2, 12);
    this.chest(c, 4, -2, 12, 'chests/jungle_temple_dispenser', S('dispenser[facing=north]'));
    this.fill(c, 4, -3, 10, 4, -1, 11, air);
    this.set(c, S('redstone_wire[north=side,south=side]'), 4, -3, 10);
    this.set(c, S('redstone_wire[north=side,south=side]'), 4, -3, 11);
    // the trap corridor ends in a chest behind the tripwire
    this.chest(c, 3, -3, 1, 'chests/jungle_temple', S('chest[facing=south]'));
    // lever puzzle on the basement wall (three levers), sticky pistons hiding the second chest
    this.set(c, S('lever[face=wall,facing=north]'), 8, -3, 12);
    this.set(c, S('lever[face=wall,facing=north]'), 6, -3, 12);
    this.set(c, S('lever[face=wall,facing=north]'), 7, -2, 12);
    this.fill(c, 5, -3, 13, 9, -1, 13, stone());
    this.set(c, S('redstone_wire[east=side,west=side]'), 8, -3, 13);
    this.set(c, S('redstone_wire[east=side,west=side]'), 7, -3, 13);
    this.set(c, S('redstone_wire[east=side,west=side]'), 6, -3, 13);
    this.set(c, S('repeater[facing=west]'), 9, -3, 13);
    this.set(c, S('sticky_piston[facing=west]'), 10, -3, 12);
    this.set(c, S('sticky_piston[facing=west]'), 10, -2, 12);
    this.set(c, S('chiseled_stone_bricks'), 9, -2, 12);
    this.set(c, S('chiseled_stone_bricks'), 9, -3, 12);
    this.set(c, air, 9, -3, 11);
    this.chest(c, 9, -3, 10, 'chests/jungle_temple', S('chest[facing=west]'));
    this.set(c, S('vine[south=true]'), 9, -2, 10);
    return true;
  }
}

export function jungleTemple(s: StartContext): Piece[] {
  return [new JungleTemplePiece(s.rand, s.cx << 4, s.cz << 4)];
}

// ------------------------------------------------------------------ swamp hut
class SwampHutPiece extends Piece {
  constructor(rand: JavaRandom, x: number, z: number) {
    const rot = rand.nextInt(4);
    super(scatteredBox(x, 64, z, 7, 7, 9, rot), rot);
  }

  postProcess(c: PlaceContext): boolean {
    if (!this.updateAverageGroundHeight(c, 0)) return false;
    const planks = S('spruce_planks'), log = S('oak_log'), fence = S('oak_fence'), air = S('air');
    // floor on stilts, porch at the front (local z = 1)
    this.fill(c, 1, 1, 1, 5, 1, 7, planks);
    this.fill(c, 1, 4, 2, 5, 4, 7, planks);
    this.fill(c, 2, 1, 0, 4, 1, 0, planks);
    this.fill(c, 2, 2, 2, 3, 3, 2, planks);
    this.fill(c, 1, 2, 3, 1, 3, 6, planks);
    this.fill(c, 5, 2, 3, 5, 3, 6, planks);
    this.fill(c, 2, 2, 7, 4, 3, 7, planks);
    this.fill(c, 2, 2, 3, 4, 3, 6, air);
    this.set(c, air, 4, 2, 2);
    this.set(c, air, 4, 3, 2);
    for (const [x, z] of [[1, 2], [5, 2], [1, 7], [5, 7]] as const) this.fill(c, x, 0, z, x, 3, z, log);
    // windows, porch posts
    this.set(c, fence, 2, 3, 2);
    this.set(c, fence, 3, 3, 7);
    this.set(c, air, 1, 3, 4);
    this.set(c, air, 5, 3, 4);
    this.set(c, air, 5, 3, 5);
    this.set(c, fence, 1, 3, 4);
    this.set(c, fence, 5, 3, 4);
    this.set(c, fence, 5, 3, 5);
    this.set(c, fence, 1, 2, 1);
    this.set(c, fence, 5, 2, 1);
    // furnishings: a potted red mushroom, crafting table and cauldron
    this.set(c, S('potted_red_mushroom'), 1, 3, 5);
    this.set(c, S('crafting_table'), 3, 2, 6);
    this.set(c, S('cauldron'), 4, 2, 6);
    // roof: spruce stairs overhanging all round
    const sN = S('spruce_stairs[facing=north]'), sS = S('spruce_stairs[facing=south]'), sE = S('spruce_stairs[facing=east]'), sW = S('spruce_stairs[facing=west]');
    this.fill(c, 0, 4, 1, 6, 4, 1, sS);
    this.fill(c, 0, 4, 2, 0, 4, 7, sE);
    this.fill(c, 6, 4, 2, 6, 4, 7, sW);
    this.fill(c, 0, 4, 8, 6, 4, 8, sN);
    // stilts down to the ground
    for (const [x, z] of [[1, 2], [5, 2], [1, 7], [5, 7]] as const) this.fillDown(c, log, x, -1, z);
    return true;
  }
}

export function swampHut(s: StartContext): Piece[] {
  return [new SwampHutPiece(s.rand, s.cx << 4, s.cz << 4)];
}

// ------------------------------------------------------------------ igloo
/**
 * IglooPieces: the dome (7 × 5 × 8), and with 50% chance a trapdoor, a ladder shaft of
 * nextInt(8) + 4 three-block segments and the basement lab (7 × 6 × 9) with the igloo chest.
 * The pieces sit on the WORLD_SURFACE_WG height (minus one) of the dome's entrance column.
 */
class IglooPiece extends Piece {
  private placed = false;
  constructor(box: BoundingBox, rot: number, readonly part: 'top' | 'middle' | 'bottom', readonly depth: number, readonly root: IglooRoot) {
    super(box, rot);
  }

  postProcess(c: PlaceContext): boolean {
    if (!this.placed) {
      this.placed = true;
      if (this.root.surface < 0) {
        // the dome's door column (local 3, 0)
        const top = this.root.top;
        this.root.surface = c.lv.getHeight('WORLD_SURFACE_WG', top.wx(3, 0), top.wz(3, 0)) - 1;
      }
      this.box.move(0, this.root.surface - 90, 0);
    }
    if (this.part === 'top') this.top(c);
    else if (this.part === 'middle') this.middle(c);
    else this.bottom(c);
    return true;
  }

  private top(c: PlaceContext): void {
    const snow = S('snow_block'), air = S('air'), ice = S('ice');
    // dome: an ellipse of snow blocks 7 wide, 8 deep, 4 high, plus the entrance tunnel at local z = 0..1
    for (let y = 0; y <= 4; y++)
      for (let x = 0; x < 7; x++)
        for (let z = 1; z < 8; z++) {
          const dx = (x - 3) / 3.5, dz = (z - 4.5) / 3.6, dy = y / 4.4;
          const d = dx * dx + dz * dz + dy * dy;
          if (y === 0) {
            if (dx * dx + dz * dz <= 1) this.set(c, snow, x, y, z);
          } else if (d <= 1) {
            const inner = (x - 3) ** 2 / 2.4 ** 2 + (z - 4.5) ** 2 / 2.6 ** 2 + (y / 3.5) ** 2;
            this.set(c, inner <= 1 && y <= 3 ? air : snow, x, y, z);
          }
        }
    this.fill(c, 2, 0, 0, 4, 3, 1, snow);
    this.fill(c, 3, 1, 0, 3, 2, 2, air);
    // windows of ice on the sides
    this.set(c, ice, 0, 2, 4);
    this.set(c, ice, 6, 2, 4);
    // floor: white carpet, bed, furnace, crafting table, redstone torch
    this.fill(c, 2, 1, 3, 4, 1, 6, S('white_carpet'));
    this.set(c, S('white_bed[facing=north,part=head]'), 5, 1, 4);
    this.set(c, S('white_bed[facing=north,part=foot]'), 5, 1, 5);
    this.set(c, S('furnace[facing=east]'), 1, 1, 5);
    this.set(c, S('crafting_table'), 1, 1, 4);
    this.set(c, S('redstone_torch'), 5, 1, 6);
    if (this.root.basement) {
      // the trapdoor hides the ladder under the carpet
      this.set(c, S('stone'), 3, 0, 5);
      this.set(c, S('air'), 3, 0, 5);
      this.set(c, S('oak_trapdoor[facing=north,half=top,open=false]'), 3, 0, 5);
      this.set(c, S('air'), 3, 1, 5);
      this.set(c, S('white_carpet'), 3, 1, 4);
    }
  }

  private middle(c: PlaceContext): void {
    // a 3-tall segment of the ladder shaft: stone bricks around a ladder (local 1, *, 1 in a 3×3)
    const bricks = S('stone_bricks');
    this.fill(c, 0, 0, 0, 2, 2, 2, bricks);
    for (let y = 0; y < 3; y++) {
      this.set(c, S('air'), 1, y, 1);
      this.set(c, S('ladder[facing=north]'), 1, y, 1);
    }
  }

  private bottom(c: PlaceContext): void {
    const bricks = S('stone_bricks'), mossy = S('mossy_stone_bricks'), air = S('air');
    const r = c.rand;
    this.fillWith(c, 0, 0, 0, 6, 5, 8, () => (r.nextFloat() < 0.2 ? mossy : bricks));
    this.fill(c, 1, 1, 1, 5, 4, 7, air);
    // ladder down from the shaft at local (3, *, 4)
    for (let y = 1; y <= 5; y++) {
      this.set(c, air, 3, y, 4);
      this.set(c, S('ladder[facing=north]'), 3, y, 4);
    }
    this.set(c, S('stone_bricks'), 3, 4, 5);
    // lab: brewing stand, cauldron, chest, a sign and cobwebs
    this.set(c, S('brewing_stand'), 1, 1, 1);
    this.set(c, S('cauldron'), 2, 1, 1);
    this.chest(c, 5, 1, 1, 'chests/igloo_chest', S('chest[facing=south]'));
    this.set(c, S('cobweb'), 1, 4, 7);
    this.set(c, S('cobweb'), 5, 4, 7);
    this.set(c, S('oak_wall_sign[facing=north]'), 4, 2, 1);
    this.set(c, S('red_carpet'), 3, 1, 3);
    this.set(c, S('red_carpet'), 3, 1, 2);
    // two cells with iron bars at the back (the villager and zombie villager stand here)
    this.fill(c, 1, 1, 6, 2, 3, 7, air);
    this.fill(c, 4, 1, 6, 5, 3, 7, air);
    this.fill(c, 1, 1, 5, 2, 3, 5, S('iron_bars'));
    this.fill(c, 4, 1, 5, 5, 3, 5, S('iron_bars'));
    this.fill(c, 3, 1, 5, 3, 3, 7, bricks);
    this.set(c, S('torch'), 3, 1, 3);
  }
}

class IglooRoot {
  surface = -1;
  top!: IglooPiece;
  constructor(readonly basement: boolean) {}
}

export function igloo(s: StartContext): Piece[] {
  const r = s.rand;
  const rot = r.nextInt(4);
  const x = (s.cx << 4) + 0, z = (s.cz << 4) + 0;
  const basement = r.nextDouble() < 0.5;
  const root = new IglooRoot(basement);
  const out: Piece[] = [];
  const top = new IglooPiece(BoundingBox.orient(x, 90, z, 0, 0, 0, 7, 5, 8, rot), rot, 'top', 0, root);
  root.top = top;
  out.push(top);
  if (basement) {
    const segs = r.nextInt(8) + 4;
    // shaft under the trapdoor (local 3, 5) → a 3×3 column centred there
    for (let i = 0; i < segs; i++) out.push(new IglooPiece(BoundingBox.orient(x, 90, z, 2, -3 * (i + 1), 4, 3, 3, 3, rot), rot, 'middle', -3 * (i + 1), root));
    out.push(new IglooPiece(BoundingBox.orient(x, 90, z, 0, -3 * segs - 6, 1, 7, 6, 9, rot), rot, 'bottom', -3 * segs - 6, root));
  }
  return out;
}
