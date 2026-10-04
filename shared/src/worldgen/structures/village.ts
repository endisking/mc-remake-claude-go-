/**
 * Villages (vanilla 1.17.1 VillageFeature: jigsaw assembly of size 6 from the biome's town
 * centers, 80-block limit, five biome styles). This is our own jigsaw-like layout: a meeting
 * point with a bell, streets that follow the terrain (dirt path, planks over water) branching up
 * to depth 6, and houses facing the streets — homes, the job-site workshops of every 1.17.1
 * profession with their village chest loot tables, farms, animal pens and lamps — in plains,
 * desert, savanna, snowy and taiga styles. Houses sit on the ground at their door (rigid pieces)
 * on a filled foundation (vanilla's terrain adaptation); streets are terrain-matching.
 */
import type { JavaRandom } from '../../util/random';
import { IS_AIR, FLUID } from '../../world/blockinfo';
import { blockNameOf } from '../../world/blockstate';
import { MATERIAL_BLOCKS_MOTION } from '../../world/blockprops';
import { BoundingBox, Piece, S, type PlaceContext } from './piece';
import { Model, TemplatePiece, VOID } from './template';
import type { StartContext } from './placement';

type Style = 'plains' | 'desert' | 'savanna' | 'snowy' | 'taiga';
interface Palette {
  log: string; planks: string; stairs: string; slab: string; base: string; door: string; fence: string; path: string;
  roofFlat: boolean; crops: string[]; glass: string; accent: string; house: string; bed: string;
}
const PALETTES: Record<Style, Palette> = {
  plains: { log: 'oak_log', planks: 'oak_planks', stairs: 'oak_stairs', slab: 'oak_slab', base: 'cobblestone', door: 'oak_door', fence: 'oak_fence', path: 'dirt_path', roofFlat: false, crops: ['wheat', 'carrots', 'potatoes', 'beetroots'], glass: 'glass_pane', accent: 'stripped_oak_log', house: 'village_plains_house', bed: 'red_bed' },
  desert: { log: 'cut_sandstone', planks: 'smooth_sandstone', stairs: 'smooth_sandstone_stairs', slab: 'smooth_sandstone_slab', base: 'sandstone', door: 'jungle_door', fence: 'sandstone_wall', path: 'smooth_sandstone', roofFlat: true, crops: ['wheat'], glass: 'glass_pane', accent: 'orange_terracotta', house: 'village_desert_house', bed: 'green_bed' },
  savanna: { log: 'acacia_log', planks: 'acacia_planks', stairs: 'acacia_stairs', slab: 'acacia_slab', base: 'cobblestone', door: 'acacia_door', fence: 'acacia_fence', path: 'dirt_path', roofFlat: false, crops: ['wheat', 'melon_stem'], glass: 'glass_pane', accent: 'orange_terracotta', house: 'village_savanna_house', bed: 'orange_bed' },
  snowy: { log: 'spruce_log', planks: 'spruce_planks', stairs: 'spruce_stairs', slab: 'spruce_slab', base: 'stone_bricks', door: 'spruce_door', fence: 'spruce_fence', path: 'dirt_path', roofFlat: false, crops: ['potatoes', 'beetroots'], glass: 'glass_pane', accent: 'snow_block', house: 'village_snowy_house', bed: 'light_blue_bed' },
  taiga: { log: 'spruce_log', planks: 'spruce_planks', stairs: 'spruce_stairs', slab: 'spruce_slab', base: 'cobblestone', door: 'spruce_door', fence: 'spruce_fence', path: 'dirt_path', roofFlat: false, crops: ['potatoes', 'carrots', 'pumpkin_stem'], glass: 'glass_pane', accent: 'mossy_cobblestone', house: 'village_taiga_house', bed: 'brown_bed' },
};

/** Professions: job-site block and the workshop chest's loot table (none for some, like vanilla). */
const JOBS: { job: string; loot: string | null }[] = [
  { job: 'blast_furnace', loot: 'village_armorer' },
  { job: 'smoker', loot: 'village_butcher' },
  { job: 'cartography_table', loot: 'village_cartographer' },
  { job: 'brewing_stand', loot: 'village_temple' },
  { job: 'barrel', loot: 'village_fisher' },
  { job: 'fletching_table', loot: 'village_fletcher' },
  { job: 'cauldron', loot: 'village_tannery' },
  { job: 'lectern', loot: null },
  { job: 'stonecutter', loot: 'village_mason' },
  { job: 'loom', loot: 'village_shepherd' },
  { job: 'smithing_table', loot: 'village_toolsmith' },
  { job: 'grindstone', loot: 'village_weaponsmith' },
];

// ------------------------------------------------------------------ building designs
function house(p: Palette, w: number, d: number, wallH: number, fill: (m: Model, air: number) => void): Model {
  const roofH = p.roofFlat ? 1 : (w >> 1) + 1;
  const m = new Model(w, wallH + roofH + 1, d);
  const planks = S(p.planks), log = S(`${p.log}${p.log.endsWith('_log') ? '[axis=y]' : ''}`), base = S(p.base), air = S('air');
  m.fill(0, 0, 0, w - 1, 0, d - 1, base);
  for (let y = 1; y <= wallH; y++)
    for (let z = 0; z < d; z++)
      for (let x = 0; x < w; x++) {
        const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
        const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
        m.set(x, y, z, corner ? log : edge ? (y === 1 && p.accent && p.roofFlat ? S(p.accent) : planks) : air);
      }
  // windows on the side walls and back
  const glass = S(p.glass);
  if (d >= 5) {
    m.set(0, 2, d >> 1, glass);
    m.set(w - 1, 2, d >> 1, glass);
  }
  if (w >= 5) m.set(w >> 1, 2, d - 1, glass);
  // door at the front centre (local z = 0 faces the street)
  const dx = w >> 1;
  m.set(dx, 1, 0, S(`${p.door}[half=lower,facing=north]`));
  m.set(dx, 2, 0, S(`${p.door}[half=upper,facing=north]`));
  if (p.roofFlat) {
    m.fill(0, wallH + 1, 0, w - 1, wallH + 1, d - 1, S(`${p.slab}[type=bottom]`));
  } else {
    // gable roof from stairs along x, gable ends of planks
    for (let i = 0; i <= w >> 1; i++) {
      const y = wallH + 1 + i;
      const xl = i - 1, xr = w - i;
      for (let z = -0; z < d; z++) {
        if (xl >= 0 && xl < xr) m.set(xl, y, z, S(`${p.stairs}[facing=east]`));
        if (xr < w && xr > xl) m.set(xr, y, z, S(`${p.stairs}[facing=west]`));
        for (let x = Math.max(0, xl + 1); x <= Math.min(w - 1, xr - 1); x++) if (z === 0 || z === d - 1) m.set(x, y, z, planks);
          else m.set(x, y, z, air);
      }
      if (xr - xl === 2) for (let z = 0; z < d; z++) m.set(xl + 1, y, z, S(`${p.slab}[type=bottom]`));
    }
  }
  m.set(1, 3, 1, S('wall_torch[facing=south]'));
  fill(m, air);
  return m;
}

function farm(p: Palette, large: boolean, r: JavaRandom): Model {
  const w = large ? 13 : 7, d = 9;
  const m = new Model(w, 2, d);
  const log = S(`${p.log}${p.log.endsWith('_log') ? '[axis=x]' : ''}`), logZ = S(`${p.log}${p.log.endsWith('_log') ? '[axis=z]' : ''}`);
  for (let x = 0; x < w; x++) {
    m.set(x, 0, 0, log);
    m.set(x, 0, d - 1, log);
  }
  for (let z = 0; z < d; z++) {
    m.set(0, 0, z, logZ);
    m.set(w - 1, 0, z, logZ);
  }
  const waterCols = large ? [3, 9] : [3];
  for (let x = 1; x < w - 1; x++) {
    const crop = p.crops[r.nextInt(p.crops.length)]!;
    for (let z = 1; z < d - 1; z++) {
      if (waterCols.includes(x)) {
        m.set(x, 0, z, S('water'));
        m.set(x, 1, z, S('air'));
        continue;
      }
      if (large && x === 6) {
        m.set(x, 0, z, logZ);
        continue;
      }
      m.set(x, 0, z, S('farmland[moisture=7]'));
      const age = crop.endsWith('_stem') ? r.nextInt(8) : crop === 'beetroots' ? 1 + r.nextInt(3) : 2 + r.nextInt(6);
      m.set(x, 1, z, S(`${crop}[age=${Math.min(age, crop === 'beetroots' ? 3 : 7)}]`));
    }
  }
  m.set(0, 1, 0, S('composter'));
  return m;
}

function pen(p: Palette): Model {
  const m = new Model(7, 2, 7);
  const fence = S(p.fence);
  for (let i = 0; i < 7; i++) {
    m.set(i, 1, 0, fence);
    m.set(i, 1, 6, fence);
    m.set(0, 1, i, fence);
    m.set(6, 1, i, fence);
  }
  m.set(3, 1, 0, S(p.fence.endsWith('_wall') ? 'air' : `${p.fence}_gate[facing=north]`));
  m.fill(1, 0, 1, 5, 0, 5, S(p.roofFlat ? 'sand' : 'grass_block'));
  m.set(5, 1, 5, S('hay_block'));
  return m;
}

function lamp(p: Palette): Model {
  const m = new Model(1, 4, 1);
  m.set(0, 0, 0, S(p.base));
  m.set(0, 1, 0, S(p.fence));
  m.set(0, 2, 0, S(p.fence));
  m.set(0, 3, 0, S('torch'));
  return m;
}

function meetingPoint(p: Palette): Model {
  const m = new Model(9, 4, 9);
  const base = S(p.base), path = S(p.path);
  m.fill(0, 0, 0, 8, 0, 8, path);
  m.fill(0, 1, 0, 8, 3, 8, S('air'));
  // basin with water and the bell on a post
  m.box(2, 0, 2, 6, 1, 6, base);
  m.fill(3, 1, 3, 5, 1, 5, S('water'));
  m.fill(3, 0, 3, 5, 0, 5, base);
  m.set(4, 1, 4, base);
  m.set(4, 2, 4, base);
  m.set(4, 3, 4, S('bell[attachment=floor,facing=north]'));
  m.set(4, 2, 4, S(p.fence.endsWith('_wall') ? p.fence : p.log.endsWith('_log') ? `${p.log}[axis=y]` : p.log));
  m.set(4, 1, 4, base);
  return m;
}

type Kind = 'home' | 'big_home' | 'job' | 'small_farm' | 'large_farm' | 'pen' | 'lamp';
const KIND_WEIGHTS: [Kind, number][] = [['home', 30], ['big_home', 12], ['job', 30], ['small_farm', 10], ['large_farm', 5], ['pen', 4], ['lamp', 6]];

function buildKind(kind: Kind, p: Palette, r: JavaRandom): Model {
  switch (kind) {
    case 'home':
      return house(p, 5 + 2 * r.nextInt(2), 5 + r.nextInt(3), 3, (m, air) => {
        m.set(1, 1, m.sz - 2, S(`${p.bed}[part=head,facing=south]`));
        m.set(1, 1, m.sz - 3 > 0 ? m.sz - 3 : 1, S(`${p.bed}[part=foot,facing=south]`));
        if (r.nextInt(2) === 0) m.chest(m.sx - 2, 1, m.sz - 2, `chests/village/${p.house}`, S('chest[facing=north]'));
        else m.set(m.sx - 2, 1, m.sz - 2, S('crafting_table'));
        void air;
      });
    case 'big_home':
      return house(p, 9, 7, 4, (m) => {
        for (const x of [1, 3]) {
          m.set(x, 1, 5, S(`${p.bed}[part=head,facing=south]`));
          m.set(x, 1, 4, S(`${p.bed}[part=foot,facing=south]`));
        }
        m.chest(7, 1, 5, `chests/village/${p.house}`, S('chest[facing=west]'));
        m.set(7, 1, 1, S('furnace[facing=west]'));
        m.set(6, 1, 5, S('crafting_table'));
      });
    case 'job': {
      const j = JOBS[r.nextInt(JOBS.length)]!;
      return house(p, 7, 6 + r.nextInt(2), 3, (m) => {
        const js = j.job === 'lectern' || j.job === 'grindstone' || j.job.includes('furnace') || j.job === 'smoker' || j.job === 'loom' || j.job === 'stonecutter' ? `${j.job}[facing=north]` : j.job;
        m.set(1, 1, m.sz - 2, S(js));
        if (j.job === 'lectern') {
          m.fill(1, 1, m.sz - 2 + 0, 5, 2, m.sz - 2, S('bookshelf'));
          m.set(3, 1, m.sz - 3, S('lectern[facing=north]'));
          m.set(1, 1, m.sz - 2, S('bookshelf'));
        }
        if (j.loot) m.chest(m.sx - 2, 1, m.sz - 2, `chests/village/${j.loot}`, S('chest[facing=north]'));
        m.set(m.sx - 2, 1, 1, S(`${p.bed}[part=head,facing=north]`));
        m.set(m.sx - 2, 1, 2, S(`${p.bed}[part=foot,facing=north]`));
      });
    }
    case 'small_farm': return farm(p, false, r);
    case 'large_farm': return farm(p, true, r);
    case 'pen': return pen(p);
    default: return lamp(p);
  }
}

/** Zombie village look (the abandoned variants of every pool): no doors or lights, broken windows, cobwebs. */
function abandon(m: Model, r: JavaRandom): Model {
  const cob = S('cobweb'), air = S('air');
  for (let i = 0; i < m.blocks.length; i++) {
    const st = m.blocks[i]!;
    if (st === VOID) continue;
    const n = blockNameOf(st);
    if (n.endsWith('_door') || n === 'torch' || n === 'wall_torch' || n === 'lantern') m.blocks[i] = air;
    else if (n === 'glass_pane' && r.nextInt(2) === 0) m.blocks[i] = air;
    else if (n === 'cobblestone' && r.nextInt(4) === 0) m.blocks[i] = S('mossy_cobblestone');
    else if (st === air && r.nextInt(14) === 0) m.blocks[i] = cob;
  }
  return m;
}

// ------------------------------------------------------------------ pieces
const BRIDGE_TOPS = /^(water)$/;
const PATHABLE = /^(grass_block|dirt|coarse_dirt|podzol|mycelium|sand|red_sand|gravel|snow_block|stone|andesite|granite|diorite)$/;

/** A terrain-matching street segment 3 wide (local x 0..2, z along). */
class StreetPiece extends Piece {
  constructor(box: BoundingBox, rot: number, readonly style: Palette) {
    super(box, rot);
  }
  postProcess(c: PlaceContext): boolean {
    const path = S(this.style.path), planks = S(this.style.planks);
    const L = this.rot & 1 ? this.box.xSpan : this.box.zSpan;
    for (let z = 0; z < L; z++)
      for (let x = 0; x < 3; x++) {
        const X = this.wx(x, z), Z = this.wz(x, z);
        if (!c.chunk.inside(X, 64, Z)) continue;
        let y = c.lv.getHeight('WORLD_SURFACE_WG', X, Z) - 1;
        // clear grass and flowers on the path
        let top = c.lv.getState(X, y, Z);
        while (y > 1 && MATERIAL_BLOCKS_MOTION[top] !== 1 && FLUID[top] === 0) {
          c.lv.setState(X, y, Z, 0);
          y--;
          top = c.lv.getState(X, y, Z);
        }
        const name = blockNameOf(top);
        if (BRIDGE_TOPS.test(name)) {
          if (y >= 62) c.lv.setState(X, y, Z, planks);
        } else if (PATHABLE.test(name) || name.endsWith('_log') || name.endsWith('_leaves')) c.lv.setState(X, y, Z, path);
        if (blockNameOf(c.lv.getState(X, y + 1, Z)) === 'snow') c.lv.setState(X, y + 1, Z, 0);
      }
    return true;
  }
}

/** A rigid building: floor at the ground height in front of its door, foundation filled below. */
class BuildingPiece extends TemplatePiece {
  private skip = false;
  constructor(model: Model, box: BoundingBox, rot: number, readonly style: Palette) {
    super(model, 0, 0, 0, rot, null, null);
    this.box = box;
  }
  private resolvedY = false;
  override postProcess(c: PlaceContext): boolean {
    if (!this.resolvedY) {
      this.resolvedY = true;
      const fx = this.wx(this.model.sx >> 1, -1), fz = this.wz(this.model.sx >> 1, -1);
      const y = c.lv.getHeight('WORLD_SURFACE_WG', fx, fz) - 1;
      const top = c.lv.getState(fx, y, fz);
      if (FLUID[top] !== 0 && y < 64) this.skip = true;
      this.box.move(0, y - this.box.y0, 0);
    }
    if (this.skip) return true;
    // foundation under the floor, and the ground cleared above it (terrain adaptation)
    const base = S(this.style.base);
    for (let z = 0; z < this.model.sz; z++)
      for (let x = 0; x < this.model.sx; x++) {
        if (this.model.get(x, 0, z) === VOID) continue;
        const X = this.wx(x, z), Z = this.wz(x, z);
        if (!c.chunk.inside(X, 64, Z)) continue;
        for (let Y = this.box.y0 - 1; Y > 1; Y--) {
          const s = c.lv.getState(X, Y, Z);
          if (IS_AIR[s] !== 1 && FLUID[s] === 0 && MATERIAL_BLOCKS_MOTION[s] === 1) break;
          c.lv.setState(X, Y, Z, base);
        }
        for (let Y = this.box.y0 + 1; Y <= this.box.y1 + 3; Y++) {
          const s = c.lv.getState(X, Y, Z);
          if (IS_AIR[s] === 1) continue;
          const n = blockNameOf(s);
          if (n.endsWith('_log') && Y > this.box.y1) break;
          if (this.model.get(x, Y - this.box.y0, z) === VOID) c.lv.setState(X, Y, Z, 0);
        }
      }
    return super.postProcess(c);
  }
}

// ------------------------------------------------------------------ layout
const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]] as const; // rot 0 S, 1 W, 2 N, 3 E: the street's forward direction

interface Street { x: number; z: number; dir: number; depth: number }

export function village(s: StartContext): Piece[] {
  const r = s.rand;
  const style = (s.config.start_pool as string).split('/')[1] as Style;
  const p = PALETTES[style] ?? PALETTES.plains;
  const cx = (s.cx << 4) + 8, cz = (s.cz << 4) + 8;
  // the town-center pools hold abandoned (zombie) variants at about 2% of the weight
  const zombie = r.nextInt(50) === 0;
  const pieces: Piece[] = [];
  const boxes: BoundingBox[] = [];
  const free = (b: BoundingBox) => !boxes.some((o) => o.intersectsXZ(b.x0, b.z0, b.x1, b.z1));
  const near = (b: BoundingBox) => Math.abs(b.x0 - cx) <= 80 && Math.abs(b.x1 - cx) <= 80 && Math.abs(b.z0 - cz) <= 80 && Math.abs(b.z1 - cz) <= 80;
  // the meeting point
  const mp = meetingPoint(p);
  const mpBox = new BoundingBox(cx - 4, 64, cz - 4, cx + 4, 64 + mp.sy - 1, cz + 4);
  pieces.push(new BuildingPiece(mp, mpBox, 0, p));
  boxes.push(mpBox);
  const queue: Street[] = [];
  for (let d = 0; d < 4; d++) {
    const [fx, fz] = DIRS[d]!;
    // the street leaves the plaza's edge on its centre line
    queue.push({ x: cx + fx * 5 - (fz !== 0 ? 1 : 0), z: cz + fz * 5 - (fx !== 0 ? 1 : 0), dir: d, depth: 1 });
  }
  while (queue.length) {
    const st = queue.splice(r.nextInt(queue.length), 1)[0]!;
    if (st.depth > 6) continue;
    const [fx, fz] = DIRS[st.dir]!;
    let len = 8 + 4 * r.nextInt(4);
    let box: BoundingBox | null = null;
    for (; len >= 6; len -= 4) {
      const ex = st.x + fx * (len - 1) + (fz !== 0 ? 2 : 0), ez = st.z + fz * (len - 1) + (fx !== 0 ? 2 : 0);
      const b = new BoundingBox(Math.min(st.x, ex), 64, Math.min(st.z, ez), Math.max(st.x, ex), 64, Math.max(st.z, ez));
      if (free(b) && near(b)) {
        box = b;
        break;
      }
    }
    if (!box) continue;
    pieces.push(new StreetPiece(box, st.dir, p));
    boxes.push(box);
    // buildings along both sides, facing the street
    for (const side of [-1, 1]) {
      let along = 1;
      while (along < len - 2) {
        if (r.nextInt(4) === 0) {
          along += 3;
          continue;
        }
        let tw = 0;
        for (const [, w] of KIND_WEIGHTS) tw += w;
        let k = r.nextInt(tw);
        let kind: Kind = 'home';
        for (const [kk, w] of KIND_WEIGHTS) if ((k -= w) < 0) {
          kind = kk;
          break;
        }
        const built = buildKind(kind, p, r);
        const model = zombie ? abandon(built, r) : built;
        // house rotation: its front (local z = 0) faces the street
        const [px, pz] = [-fz * side, fx * side]; // outward from the street
        const rot = pz > 0 ? 0 : pz < 0 ? 2 : px > 0 ? 3 : 1;
        const w = model.sx, dpt = model.sz;
        const xs = rot & 1 ? dpt : w, zs = rot & 1 ? w : dpt;
        // position: start along the street; just past the street edge (+1 gap)
        const ax = st.x + fx * along, az = st.z + fz * along;
        let x0: number, z0: number;
        if (fz !== 0) {
          // street runs along z (x .. x+2 wide)
          z0 = fz > 0 ? az : az - zs + 1;
          x0 = px > 0 ? st.x + 3 : st.x - xs;
        } else {
          x0 = fx > 0 ? ax : ax - xs + 1;
          z0 = pz > 0 ? st.z + 3 : st.z - zs;
        }
        const b = new BoundingBox(x0, 64, z0, x0 + xs - 1, 64 + model.sy - 1, z0 + zs - 1);
        const along2 = (fz !== 0 ? zs : xs) + 1;
        if (free(b) && near(b)) {
          pieces.push(new BuildingPiece(model, b, rot, p));
          boxes.push(b);
        }
        along += along2;
      }
    }
    // at the end of the street: continue, turn, or both
    const endX = st.x + fx * len, endZ = st.z + fz * len;
    void [endX, endZ];
    if (st.depth < 6) {
      const roll = r.nextInt(10);
      const goStraight = roll < 7;
      const goLeft = r.nextInt(10) < 4, goRight = r.nextInt(10) < 4;
      if (goStraight) queue.push({ x: endX, z: endZ, dir: st.dir, depth: st.depth + 1 });
      const lDir = (st.dir + 1) & 3, rDir = (st.dir + 3) & 3;
      // side streets leave from the last 3×3 block of this one
      let bx0: number, bz0: number;
      if (fz !== 0) {
        bx0 = st.x;
        bz0 = fz > 0 ? st.z + len - 3 : st.z - len + 1;
      } else {
        bz0 = st.z;
        bx0 = fx > 0 ? st.x + len - 3 : st.x - len + 1;
      }
      for (const [go, nd] of [[goLeft, lDir], [goRight, rDir]] as const) {
        if (!go) continue;
        const [nfx, nfz] = DIRS[nd]!;
        queue.push({ x: nfx > 0 ? bx0 + 3 : nfx < 0 ? bx0 - 1 : bx0, z: nfz > 0 ? bz0 + 3 : nfz < 0 ? bz0 - 1 : bz0, dir: nd, depth: st.depth + 1 });
      }
    }
  }
  return pieces;
}
