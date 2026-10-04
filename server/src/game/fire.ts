/**
 * Fire (vanilla 1.17.1 FireBlock / BaseFireBlock / SoulFireBlock): placement state, survival,
 * the scheduled tick with ageing, burn-out of flammable neighbours and spread, plus the
 * flammability table from FireBlock.bootStrap (encouragement = ignite odds, flammability = burn odds).
 */
import { blockNameOf, getProp, withProp, defaultState } from '@shared/world/blockstate';
import { FULL_COLLISION, IS_AIR } from '@shared/world/blockinfo';
import { BIOMES } from '@shared/data';
import type { BlockWorld } from '@shared/world/world';

const IGNITE = new Map<string, number>();
const BURN = new Map<string, number>();
function flammable(names: string[], ignite: number, burn: number): void {
  for (const n of names) {
    IGNITE.set(n, ignite);
    BURN.set(n, burn);
  }
}
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
flammable(WOODS.flatMap((w) => [`${w}_planks`, `${w}_slab`, `${w}_fence_gate`, `${w}_fence`, `${w}_stairs`]), 5, 20);
flammable(WOODS.flatMap((w) => [`${w}_log`, `stripped_${w}_log`, `${w}_wood`, `stripped_${w}_wood`]), 5, 5);
flammable(WOODS.map((w) => `${w}_leaves`), 30, 60);
flammable(['bookshelf'], 30, 20);
flammable(['tnt'], 15, 100);
flammable(['grass', 'fern', 'dead_bush', 'sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern'], 60, 100);
flammable(['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose'], 60, 100);
flammable(COLORS.map((c) => `${c}_wool`), 30, 60);
flammable(['vine'], 15, 100);
flammable(['coal_block'], 5, 5);
flammable(['hay_block'], 60, 20);
flammable(['target'], 15, 20);
flammable(COLORS.map((c) => `${c}_carpet`), 60, 20);
flammable(['dried_kelp_block'], 30, 60);
flammable(['bamboo'], 60, 60);
flammable(['scaffolding'], 60, 60);
flammable(['lectern'], 30, 20);
flammable(['composter'], 5, 20);
flammable(['sweet_berry_bush'], 60, 100);
flammable(['beehive'], 5, 20);
flammable(['bee_nest'], 30, 20);
flammable(['azalea_leaves', 'flowering_azalea_leaves'], 30, 60);
flammable(['cave_vines', 'cave_vines_plant'], 15, 60);
flammable(['spore_blossom'], 60, 100);
flammable(['azalea', 'flowering_azalea'], 30, 60);
flammable(['big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf'], 60, 100);
flammable(['hanging_roots'], 30, 60);
flammable(['glow_lichen'], 15, 100);

const waterlogged = (s: number) => getProp(s, 'waterlogged') === true;
/** FireBlock.getIgniteOdds */
export function igniteOdds(s: number): number {
  return waterlogged(s) ? 0 : IGNITE.get(blockNameOf(s)) ?? 0;
}
/** FireBlock.getBurnOdd */
export function burnOdds(s: number): number {
  return waterlogged(s) ? 0 : BURN.get(blockNameOf(s)) ?? 0;
}
const canBurn = (s: number) => igniteOdds(s) > 0;
const sturdyUp = (s: number) => FULL_COLLISION[s] === 1;

const N6 = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]] as const;
const FACE_PROP: Record<string, string> = { '0,1,0': 'up', '0,0,-1': 'north', '0,0,1': 'south', '-1,0,0': 'west', '1,0,0': 'east' };

/** FireBlock.isValidFireLocation: something flammable next to it. */
export function isValidFireLocation(w: BlockWorld, x: number, y: number, z: number): boolean {
  for (const [dx, dy, dz] of N6) if (canBurn(w.getState(x + dx, y + dy, z + dz))) return true;
  return false;
}

/** BaseFireBlock.getState: soul fire on soul sand/soil, otherwise fire attached to burnable sides. */
export function fireStateAt(w: BlockWorld, x: number, y: number, z: number): number {
  const below = w.getState(x, y - 1, z);
  const bn = blockNameOf(below);
  if (bn === 'soul_sand' || bn === 'soul_soil') return defaultState('soul_fire');
  let s = defaultState('fire');
  if (!canBurn(below) && !sturdyUp(below)) {
    for (const [dx, dy, dz] of N6) {
      const prop = FACE_PROP[`${dx},${dy},${dz}`];
      if (prop) s = withProp(s, prop, canBurn(w.getState(x + dx, y + dy, z + dz)));
    }
  }
  return s;
}

/** FireBlock / SoulFireBlock.canSurvive */
export function fireCanSurvive(w: BlockWorld, x: number, y: number, z: number, s: number): boolean {
  const below = w.getState(x, y - 1, z);
  if (blockNameOf(s) === 'soul_fire') return ['soul_sand', 'soul_soil'].includes(blockNameOf(below));
  return sturdyUp(below) || isValidFireLocation(w, x, y, z);
}

export interface FireLevel {
  world: BlockWorld;
  rand: { nextInt(n: number): number; nextFloat(): number };
  setBlock(x: number, y: number, z: number, s: number): void;
  removeBlock(x: number, y: number, z: number): void;
  scheduleTick(x: number, y: number, z: number, s: number, delay: number): void;
  isRaining(): boolean;
  isRainingAt(x: number, y: number, z: number): boolean;
  difficulty: number;
  doFireTick: boolean;
  /** TntBlock.explode (later: TNT) */
  explodeTnt?(x: number, y: number, z: number): void;
}

/** FireBlock.getFireTickDelay */
export function fireTickDelay(r: { nextInt(n: number): number }): number {
  return 30 + r.nextInt(10);
}

/** FireBlock.tick */
export function tickFire(lv: FireLevel, x: number, y: number, z: number, st: number): void {
  const w = lv.world, r = lv.rand;
  lv.scheduleTick(x, y, z, st, fireTickDelay(r));
  if (!lv.doFireTick) return;
  if (!fireCanSurvive(w, x, y, z, st)) lv.removeBlock(x, y, z);
  if (blockNameOf(st) === 'soul_fire') return;
  const below = w.getState(x, y - 1, z);
  const infini = blockNameOf(below) === 'netherrack' || blockNameOf(below) === 'magma_block';
  const i = getProp(st, 'age') as number;
  const nearRain = (px: number, py: number, pz: number) =>
    lv.isRainingAt(px, py, pz) || lv.isRainingAt(px - 1, py, pz) || lv.isRainingAt(px + 1, py, pz) || lv.isRainingAt(px, py, pz - 1) || lv.isRainingAt(px, py, pz + 1);
  if (!infini && lv.isRaining() && nearRain(x, y, z) && r.nextFloat() < 0.2 + i * 0.03) {
    lv.removeBlock(x, y, z);
    return;
  }
  const j = Math.min(15, i + Math.trunc(r.nextInt(3) / 2));
  if (i !== j) {
    st = withProp(st, 'age', j);
    lv.setBlock(x, y, z, st);
  }
  if (!infini) {
    if (!isValidFireLocation(w, x, y, z)) {
      if (!sturdyUp(w.getState(x, y - 1, z)) || i > 3) lv.removeBlock(x, y, z);
      return;
    }
    if (i === 15 && r.nextInt(4) === 0 && !canBurn(w.getState(x, y - 1, z))) {
      lv.removeBlock(x, y, z);
      return;
    }
  }
  // Level.isHumidAt: biome downfall > 0.85
  const humid = (BIOMES.find((b) => b.id === w.getBiome(x, y, z))?.rainfall ?? 0) > 0.85;
  const k = humid ? -50 : 0;
  checkBurnOut(lv, x + 1, y, z, 300 + k, i);
  checkBurnOut(lv, x - 1, y, z, 300 + k, i);
  checkBurnOut(lv, x, y - 1, z, 250 + k, i);
  checkBurnOut(lv, x, y + 1, z, 250 + k, i);
  checkBurnOut(lv, x, y, z - 1, 300 + k, i);
  checkBurnOut(lv, x, y, z + 1, 300 + k, i);
  for (let l = -1; l <= 1; l++)
    for (let n = -1; n <= 1; n++)
      for (let o = -1; o <= 4; o++) {
        if (l === 0 && o === 0 && n === 0) continue;
        let p = 100;
        if (o > 1) p += (o - 1) * 100;
        const mx = x + l, my = y + o, mz = z + n;
        const q = fireOdds(w, mx, my, mz);
        if (q <= 0) continue;
        let rr = Math.trunc((q + 40 + lv.difficulty * 7) / (i + 30));
        if (humid) rr = Math.trunc(rr / 2);
        if (rr > 0 && r.nextInt(p) <= rr && (!lv.isRaining() || !nearRain(mx, my, mz))) {
          const s = Math.min(15, i + Math.trunc(r.nextInt(5) / 4));
          placeFire(lv, mx, my, mz, s);
        }
      }
}

/** FireBlock.getFireOdds: an empty spot's best neighbour encouragement. */
function fireOdds(w: BlockWorld, x: number, y: number, z: number): number {
  if (!IS_AIR[w.getState(x, y, z)]) return 0;
  let best = 0;
  for (const [dx, dy, dz] of N6) best = Math.max(best, igniteOdds(w.getState(x + dx, y + dy, z + dz)));
  return best;
}

function placeFire(lv: FireLevel, x: number, y: number, z: number, age: number): void {
  let s = fireStateAt(lv.world, x, y, z);
  if (blockNameOf(s) === 'fire') s = withProp(s, 'age', age);
  lv.setBlock(x, y, z, s);
}

/** FireBlock.checkBurnOut: a flammable block burns away, sometimes leaving fire in its place. */
function checkBurnOut(lv: FireLevel, x: number, y: number, z: number, chance: number, age: number): void {
  const s = lv.world.getState(x, y, z);
  const odds = burnOdds(s);
  if (lv.rand.nextInt(chance) >= odds) return;
  if (lv.rand.nextInt(age + 10) < 5 && !lv.isRainingAt(x, y, z)) {
    const j = Math.min(age + Math.trunc(lv.rand.nextInt(5) / 4), 15);
    placeFire(lv, x, y, z, j);
  } else lv.removeBlock(x, y, z);
  if (blockNameOf(s) === 'tnt') lv.explodeTnt?.(x, y, z);
}
