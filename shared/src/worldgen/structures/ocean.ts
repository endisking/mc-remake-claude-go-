/**
 * Ocean structures (vanilla 1.17.1 ShipwreckFeature/ShipwreckPieces, OceanRuinFeature/
 * OceanRuinPieces, BuriedTreasureFeature/BuriedTreasurePieces). Placement heights, variants,
 * integrity, clustering and loot follow vanilla; the ship and ruin designs are our own.
 */
import { S, Piece, BoundingBox, type PlaceContext, shuffle } from './piece';
import { Model, TemplatePiece, VOID, integrity, positionRandom } from './template';
import type { StartContext } from './placement';
import type { JavaRandom } from '../../util/random';
import { IS_AIR, FLUID } from '../../world/blockinfo';
import { blockNameOf } from '../../world/blockstate';

// ------------------------------------------------------------------ shipwrecks
const WOODS = ['oak', 'spruce', 'dark_oak', 'birch', 'jungle', 'acacia'];
type Section = 'full' | 'fronthalf' | 'backhalf';

/** One of our ship designs: 9 wide, 10 tall (with mast 17), 26 long; bow at local z = 0. */
function buildShip(wood: string, trim: string, mast: boolean, section: Section, degraded: boolean, seedish: number): Model {
  const L = 26, W = 9, H = mast ? 17 : 10;
  const m = new Model(W, H, L);
  const planks = S(`${wood}_planks`), log = S(`${trim}_log[axis=y]`), logZ = S(`${trim}_log[axis=z]`);
  const fence = S(`${wood}_fence`), slab = S(`${wood}_slab[type=bottom]`), air = S('air');
  const trapdoor = S(`${wood}_trapdoor[facing=north,half=top,open=false]`);
  const stairsN = (f: string) => S(`${wood}_stairs[facing=${f}]`);
  // hull half-width along the keel: narrow at the bow and stern
  const half = (z: number) => (z < 2 ? 1 : z < 5 ? 2 : z < 8 ? 3 : z > 23 ? 3 : 4);
  const bottom = (z: number) => (z < 3 ? 2 : z < 6 ? 1 : 0);
  for (let z = 0; z < L; z++) {
    const hw = half(z), b = bottom(z);
    for (let y = b; y <= 5; y++)
      for (let dx = -hw; dx <= hw; dx++) {
        const x = 4 + dx;
        const lowHw = y <= b + 1 ? Math.max(0, hw - (b + 1 - y + 1)) : hw; // rounded bilge
        if (Math.abs(dx) > lowHw + (y > b + 1 ? 0 : 1)) continue;
        const edge = Math.abs(dx) === hw || y === b || z === 0 || z === L - 1 || (y <= b + 1 && Math.abs(dx) >= lowHw);
        if (edge) m.set(x, y, z, y === 5 || y === b ? planks : (y === 3 ? logZ : planks));
        else m.set(x, y, z, air);
      }
    // gunwale fence on the deck edges
    if (z > 1 && z < L - 1) {
      m.set(4 - hw, 6, z, fence);
      m.set(4 + hw, 6, z, fence);
    }
  }
  // the deck: planks at y 5 over the hold, with hatch trapdoors
  for (let z = 1; z < L - 1; z++) for (let dx = -half(z) + 1; dx < half(z); dx++) m.set(4 + dx, 5, z, planks);
  m.set(4, 5, 12, trapdoor);
  m.set(4, 5, 4, trapdoor);
  // bowsprit
  m.fill(4, 6, 0, 4, 6, 1, logZ);
  m.set(4, 7, 0, fence);
  // stern cabin (z 19..24) with stairs roof
  m.box(1, 5, 19, 7, 9, 24, planks, air);
  m.fill(1, 5, 19, 7, 5, 24, planks);
  m.set(4, 6, 19, air);
  m.set(4, 7, 19, air);
  m.set(1, 7, 21, S('glass_pane'));
  m.set(7, 7, 21, S('glass_pane'));
  m.set(1, 7, 22, S('glass_pane'));
  m.set(7, 7, 22, S('glass_pane'));
  m.fill(1, 10, 19, 7, 10, 24, slab);
  for (let x = 0; x <= 8; x++) {
    m.set(x, 9, 18, stairsN('south'));
  }
  // map chest in the captain's cabin, supply chest in the bow hold, treasure chest amidships below deck
  m.chest(2, 6, 23, 'chests/shipwreck_map', S('chest[facing=east]'));
  m.chest(4, 2, 4, 'chests/shipwreck_supply', S('chest[facing=south]'));
  m.chest(4, 1, 14, 'chests/shipwreck_treasure', S('chest[facing=north]'));
  m.set(3, 1, 13, S('barrel[facing=up]'));
  m.set(5, 1, 15, S('barrel[facing=up]'));
  if (mast) {
    m.fill(4, 1, 10, 4, 15, 10, log);
    m.fill(1, 12, 10, 7, 12, 10, S(`${trim}_log[axis=x]`));
    // the torn sail
    for (let y = 8; y <= 11; y++) for (let x = 2; x <= 6; x++) if ((x + y + seedish) % 4 !== 0) m.set(x, y, 11, S('white_wool'));
    m.set(4, 16, 10, fence);
  }
  // halves: cut the hull across the middle
  if (section === 'fronthalf') for (let z = 14; z < L; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.set(x, y, z, VOID);
  if (section === 'backhalf') for (let z = 0; z < 12; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.set(x, y, z, VOID);
  if (section !== 'full') {
    // drop chests cut away
    for (let i = m.chests.length - 1; i >= 0; i--) if (m.get(m.chests[i]!.x, m.chests[i]!.y, m.chests[i]!.z) === VOID) m.chests.splice(i, 1);
  }
  // broken planks: weathered holes (fixed per design, like the templates' gaps)
  if (degraded)
    for (let y = 0; y < H; y++)
      for (let z = 0; z < L; z++)
        for (let x = 0; x < W; x++) {
          const s = m.get(x, y, z);
          if (s === VOID || s === air || m.chests.some((c) => c.x === x && c.y === y && c.z === z)) continue;
          if (positionRandom(x + seedish, y, z).nextInt(100) < 18) m.set(x, y, z, VOID);
        }
  // the inside stays water: interior air is left void, as vanilla ignores template air
  for (let i = 0; i < m.blocks.length; i++) if (m.blocks[i] === air) m.blocks[i] = VOID;
  return m;
}

/** The 20 vanilla shipwreck templates, as (orientation, section, mast, degraded) combinations. */
const SHIP_VARIANTS: { kind: 'rightsideup' | 'sideways' | 'upsidedown'; section: Section; mast: boolean; degraded: boolean }[] = [];
for (const kind of ['rightsideup', 'sideways', 'upsidedown'] as const)
  for (const section of ['full', 'fronthalf', 'backhalf'] as const)
    for (const degraded of [false, true]) SHIP_VARIANTS.push({ kind, section, mast: section !== 'backhalf' && kind === 'rightsideup', degraded });
SHIP_VARIANTS.push({ kind: 'rightsideup', section: 'full', mast: true, degraded: false }, { kind: 'rightsideup', section: 'full', mast: false, degraded: true });
/** STRUCTURE_LOCATION_BEACHED: only the right-side-up ones */
const BEACHED = SHIP_VARIANTS.map((v, i) => [v, i] as const).filter(([v]) => v.kind === 'rightsideup');

export function shipwreck(s: StartContext): Piece[] {
  const r = s.rand;
  const beached = !!s.config.is_beached;
  const rot = r.nextInt(4);
  const idx = beached ? BEACHED[r.nextInt(BEACHED.length)]![1] : r.nextInt(SHIP_VARIANTS.length);
  const v = SHIP_VARIANTS[idx]!;
  const wood = WOODS[idx % WOODS.length]!, trim = WOODS[(idx * 7 + 3) % WOODS.length]!;
  let model = buildShip(wood, trim, v.mast, v.section, v.degraded, idx);
  if (v.kind !== 'rightsideup') model = model.transformed(v.kind);
  const piece = new TemplatePiece(model, s.cx << 4, 90, s.cz << 4, rot, (c, p) => {
    // ShipwreckPiece.postProcess: average (ocean) or lowest (beached) surface over the footprint
    const hs = p.footprintHeights(c, beached ? 'WORLD_SURFACE_WG' : 'OCEAN_FLOOR_WG');
    if (!hs.length) return 63;
    const min = Math.min(...hs), avg = Math.trunc(hs.reduce((a, b) => a + b, 0) / hs.length);
    return beached ? min - (model.sy >> 1) - c.rand.nextInt(3) : avg;
  });
  return [piece];
}

// ------------------------------------------------------------------ ocean ruins
type Temp = 'warm' | 'cold';
function ruinPalette(temp: Temp) {
  if (temp === 'warm')
    return { wall: [S('sandstone'), S('sandstone'), S('cut_sandstone'), S('chiseled_sandstone')], floor: S('smooth_sandstone'), stair: (f: string) => S(`sandstone_stairs[facing=${f}]`), slab: S('sandstone_slab[type=bottom]'), accent: S('chiseled_sandstone') };
  return { wall: [S('stone_bricks'), S('mossy_stone_bricks'), S('cracked_stone_bricks'), S('stone_bricks')], floor: S('stone_bricks'), stair: (f: string) => S(`stone_brick_stairs[facing=${f}]`), slab: S('stone_brick_slab[type=bottom]'), accent: S('chiseled_stone_bricks') };
}

/** Small ruins: broken huts (8 designs from 4 shapes × brick or mossy look). */
function smallRuin(temp: Temp, design: number): Model {
  const p = ruinPalette(temp);
  const w = 5 + (design & 3), d = 5 + ((design >> 1) & 3), h = 4 + (design % 3);
  const m = new Model(w, h, d);
  const wall = (x: number, y: number, z: number) => p.wall[positionRandom(x * 7 + design, y, z).nextInt(4)]!;
  m.fill(0, 0, 0, w - 1, 0, d - 1, p.floor);
  for (let y = 1; y < h; y++)
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
        if (!edge) continue;
        // walls crumble towards the top
        const keep = y < 2 || positionRandom(x, y * 13 + design, z).nextInt(h) >= y - 1;
        if (keep) m.set(x, y, z, wall(x, y, z));
      }
  // doorway and a fallen roof slab corner
  m.fill(w >> 1, 1, 0, w >> 1, 2, 0, VOID);
  if (design & 1) m.fill(0, h - 1, 0, (w >> 1), h - 1, d - 1, p.slab);
  m.set(w - 2, 1, d - 2, S('chest[facing=west]'));
  m.chests.push({ x: w - 2, y: 1, z: d - 2, loot: 'chests/underwater_ruin_small', state: S('chest[facing=west]') });
  return m;
}

/** Big ruins: a 15×15 temple court with columns, rooms and stairs. */
function bigRuin(temp: Temp, design: number): Model {
  const p = ruinPalette(temp);
  const W = 15, H = 9;
  const m = new Model(W, H, W);
  const wall = (x: number, y: number, z: number) => p.wall[positionRandom(x, y + design * 31, z).nextInt(4)]!;
  m.fill(0, 0, 0, W - 1, 0, W - 1, p.floor);
  m.fill(1, 1, 1, W - 2, 1, W - 2, p.floor);
  // outer walls with crumbling tops
  for (let y = 2; y < 6; y++)
    for (let i = 0; i < W; i++)
      for (const [x, z] of [[i, 0], [i, W - 1], [0, i], [W - 1, i]] as const)
        if (y < 4 || positionRandom(x + design, y, z).nextInt(3) > 0) m.set(x, y, z, wall(x, y, z));
  // gate and stairs up to the court
  m.fill(6, 2, 0, 8, 4, 0, VOID);
  for (let x = 6; x <= 8; x++) m.set(x, 1, 0, p.stair('south'));
  // four columns and an inner shrine
  for (const [cx, cz] of [[4, 4], [10, 4], [4, 10], [10, 10]] as const) {
    m.fill(cx, 2, cz, cx, 6, cz, (x, y, z) => wall(x, y, z));
    m.set(cx, 7, cz, p.accent);
  }
  m.box(5, 2, 8, 9, 6, 12, p.wall[0]!);
  m.fill(6, 2, 8, 8, 4, 8, VOID);
  m.fill(5, 7, 8, 9, 7, 12, p.slab);
  m.set(7, 3, 12, p.accent);
  // chests: one in the shrine, one in the corner room
  m.chest(7, 2, 11, 'chests/underwater_ruin_big', S('chest[facing=north]'));
  m.box(1, 2, 1, 4, 4, 3, p.wall[1]!);
  m.fill(2, 2, 3, 3, 3, 3, VOID);
  m.chest(2, 2, 2, 'chests/underwater_ruin_big', S('chest[facing=south]'));
  if (design & 1) m.fill(0, 6, 0, W - 1, 8, W - 1, VOID); // a lower ruin
  return m;
}

function ruinPiece(s: StartContext, x: number, z: number, rot: number, temp: Temp, large: boolean, r: JavaRandom): TemplatePiece {
  const design = r.nextInt(large ? 3 : 8);
  const model = large ? bigRuin(temp, design) : smallRuin(temp, design);
  const integ = large ? 0.9 : 0.8;
  const rot90 = integrity(integ);
  // cold ruins only: mossy, cracked; warm ruins keep sand around (nothing extra here)
  return new TemplatePiece(model, x, 90, z, rot, (c, p) => {
    // OceanRuinPiece.getHeight: the lowest ocean floor of the four corners, sunk one block
    const corners = [[p.box.x0, p.box.z0], [p.box.x1, p.box.z0], [p.box.x0, p.box.z1], [p.box.x1, p.box.z1]];
    let min = 255;
    for (const [cx, cz] of corners) if (c.lv.world.isLoaded(cx!, cz!)) min = Math.min(min, c.lv.getHeight('OCEAN_FLOOR_WG', cx!, cz!));
    return (min === 255 ? 40 : min) - 1;
  }, (st, X, Y, Z, here) => {
    // never float above the water: blocks over air are dropped
    if (IS_AIR[here] === 1 && Y > 62) return VOID;
    void s;
    return rot90(st, X, Y, Z, here);
  });
}

export function oceanRuin(s: StartContext): Piece[] {
  const r = s.rand;
  const rot = r.nextInt(4);
  const temp: Temp = s.config.biome_temp === 'warm' ? 'warm' : 'cold';
  const large = r.nextFloat() <= Math.fround(s.config.large_probability);
  const x = s.cx << 4, z = s.cz << 4;
  const pieces: Piece[] = [ruinPiece(s, x, z, rot, temp, large, r)];
  if (large && r.nextFloat() <= Math.fround(s.config.cluster_probability)) {
    // addClusterRuins: up to 8 positions around the big ruin; 4–8 small ruins, each in a free spot
    const offsets = [[-16, -16], [-16, 0], [-16, 16], [0, 16], [16, 16], [16, 0], [16, -16], [0, -16]].map(([dx, dz]) => [x + dx! + r.nextInt(8) - 4, z + dz! + r.nextInt(8) - 4] as const);
    shuffle(offsets, r);
    const n = r.nextInt(5) + 4;
    const taken: BoundingBox[] = [pieces[0]!.box];
    for (let i = 0; i < n && i < offsets.length; i++) {
      const [ox, oz] = offsets[i]!;
      const p = ruinPiece(s, ox, oz, r.nextInt(4), temp, false, r);
      if (taken.some((b) => b.intersectsXZ(p.box.x0 - 1, p.box.z0 - 1, p.box.x1 + 1, p.box.z1 + 1))) continue;
      taken.push(p.box);
      pieces.push(p);
    }
  }
  return pieces;
}

// ------------------------------------------------------------------ buried treasure
const TREASURE_BASE = new Set(['sandstone', 'stone', 'andesite', 'granite', 'diorite']);

/** BuriedTreasurePieces.BuriedTreasurePiece: a chest under the beach sand at (x + 9, z + 9). */
class BuriedTreasurePiece extends Piece {
  constructor(x: number, z: number) {
    super(new BoundingBox(x, 90, z, x, 90, z), 0);
  }

  postProcess(c: PlaceContext): boolean {
    const { lv } = c;
    const X = this.box.x0, Z = this.box.z0;
    let y = lv.getHeight('OCEAN_FLOOR_WG', X, Z);
    const isLiquid = (s: number) => FLUID[s] !== 0;
    while (y > 0) {
      const s = lv.getState(X, y, Z), below = lv.getState(X, y - 1, Z);
      if (TREASURE_BASE.has(blockNameOf(below))) {
        const cover = IS_AIR[s] === 1 || isLiquid(s) ? S('sand') : s;
        for (const [dx, dy, dz] of [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]] as const) {
          const nx = X + dx, ny = y + dy, nz = Z + dz;
          const n = lv.getState(nx, ny, nz);
          if (IS_AIR[n] !== 1 && !isLiquid(n)) continue;
          const nb = lv.getState(nx, ny - 1, nz);
          const up = dy === 1;
          if ((IS_AIR[nb] === 1 || isLiquid(nb)) && !up) lv.setState(nx, ny, nz, below);
          else lv.setState(nx, ny, nz, cover);
        }
        this.box = new BoundingBox(X, y, Z, X, y, Z);
        const local = new BuriedChest(this.box, 0);
        return local.place(c);
      }
      y--;
    }
    return false;
  }
}
class BuriedChest extends Piece {
  postProcess(): boolean {
    return true;
  }
  place(c: PlaceContext): boolean {
    return this.chest(c, 0, 0, 0, 'chests/buried_treasure');
  }
}

export function buriedTreasure(s: StartContext): Piece[] {
  return [new BuriedTreasurePiece((s.cx << 4) + 9, (s.cz << 4) + 9)];
}
