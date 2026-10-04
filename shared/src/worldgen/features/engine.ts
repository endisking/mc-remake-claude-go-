/**
 * The data-driven feature engine (vanilla 1.17.1 ConfiguredFeature / ConfiguredDecorator), run on
 * the configured-feature JSON from the generated worldgen data.
 *
 * Decorators produce positions depth-first: each getPositions call draws its randoms when it is
 * reached, and the feature placed at a position shares the same random before the next position
 * is drawn (Java streams + flatMap + forEach), so `emit` callbacks reproduce the exact order.
 */
import { JavaRandom } from '../../util/random';
import { mthSin, F_PI } from '../../util/mth';
import { stateOf, blockNameOf, getProp, withProp } from '../../world/blockstate';
import { IS_AIR, FLUID, FULL_COLLISION } from '../../world/blockinfo';
import { MATERIAL_SOLID } from '../../world/blockprops';
import { BIOME_INFO_NOISE, getTemperature } from '../../world/climate';
import { canSurvive } from '../../game/support';
import { WORLDGEN } from './data';
import type { GenLevel, HeightmapType } from './level';
import { blockState, intProvider, floatProvider, heightProvider, ruleTest, stateProvider, inTag, type RuleTest } from './providers';
import { treeFeature } from './trees';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const f = Math.fround;

export type Emit = (x: number, y: number, z: number) => void;
export type Decorator = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number, emit: Emit) => void;
/** A configured feature: places at (x, y, z), true if it placed anything. */
export type Placer = (lv: GenLevel, r: JavaRandom, x: number, y: number, z: number) => boolean;

/** Feature types not built yet (they're skipped; each feature has its own seeded random, so the rest are unaffected). */
export const MISSING_FEATURES = new Set<string>();

// ------------------------------------------------------------------ decorators
function decorator(j: J): Decorator {
  const c = j.config ?? {};
  switch (j.type) {
    case 'minecraft:decorated': {
      const outer = decorator(c.outer), inner = decorator(c.inner);
      return (lv, r, x, y, z, emit) => outer(lv, r, x, y, z, (a, b, d) => inner(lv, r, a, b, d, emit));
    }
    case 'minecraft:count': {
      const n = intProvider(c.count);
      return (_lv, r, x, y, z, emit) => {
        for (let i = n(r); i > 0; i--) emit(x, y, z);
      };
    }
    case 'minecraft:count_extra': {
      const { count, extra_chance: chance, extra_count: extra } = c;
      return (_lv, r, x, y, z, emit) => {
        for (let i = count + (r.nextFloat() < f(chance) ? extra : 0); i > 0; i--) emit(x, y, z);
      };
    }
    case 'minecraft:chance': {
      const p = f(1 / c.chance);
      return (_lv, r, x, y, z, emit) => {
        if (r.nextFloat() < p) emit(x, y, z);
      };
    }
    case 'minecraft:square':
      return (_lv, r, x, y, z, emit) => {
        const a = r.nextInt(16) + x, b = r.nextInt(16) + z;
        emit(a, y, b);
      };
    case 'minecraft:range': {
      const h = heightProvider(c.height);
      return (_lv, r, x, _y, z, emit) => emit(x, h(r), z);
    }
    case 'minecraft:heightmap': {
      const hm = c.heightmap as HeightmapType;
      return (lv, _r, x, _y, z, emit) => {
        const y = lv.getHeight(hm, x, z);
        if (y > lv.minY) emit(x, y, z);
      };
    }
    case 'minecraft:heightmap_spread_double': {
      const hm = c.heightmap as HeightmapType;
      return (lv, r, x, _y, z, emit) => {
        const h = lv.getHeight(hm, x, z);
        if (h !== lv.minY) emit(x, lv.minY + r.nextInt((h - lv.minY) * 2), z);
      };
    }
    case 'minecraft:spread_32_above':
      return (_lv, r, x, y, z, emit) => emit(x, r.nextInt(Math.max(y, 0) + 32), z);
    case 'minecraft:water_depth_threshold': {
      const max = c.max_water_depth as number;
      return (lv, _r, x, y, z, emit) => {
        if (lv.getHeight('WORLD_SURFACE', x, z) - lv.getHeight('OCEAN_FLOOR', x, z) <= max) emit(x, y, z);
      };
    }
    case 'minecraft:count_noise': {
      const { noise_level: level, below_noise: below, above_noise: above } = c;
      return (_lv, _r, x, y, z, emit) => {
        const d = BIOME_INFO_NOISE.getValue(x / 200, z / 200, false);
        for (let i = d < level ? below : above; i > 0; i--) emit(x, y, z);
      };
    }
    case 'minecraft:count_noise_biased': {
      const { noise_to_count_ratio: ratio, noise_factor: factor, noise_offset: offset = 0 } = c;
      return (_lv, _r, x, y, z, emit) => {
        const d = BIOME_INFO_NOISE.getValue(x / factor, z / factor, false);
        for (let i = Math.ceil((d + offset) * ratio); i > 0; i--) emit(x, y, z);
      };
    }
    case 'minecraft:lava_lake': {
      const chance = c.chance as number;
      return (lv, r, x, _y, z, emit) => {
        if (r.nextInt(Math.trunc(chance / 10)) !== 0) return;
        const a = r.nextInt(16) + x, b = r.nextInt(16) + z;
        const y = r.nextInt(r.nextInt(lv.height - 8) + 8);
        if (y < lv.seaLevel || r.nextInt(Math.trunc(chance / 8)) === 0) emit(a, y, b);
      };
    }
    case 'minecraft:iceberg':
      return (_lv, r, x, y, z, emit) => {
        const a = r.nextInt(8) + 4 + x, b = r.nextInt(8) + 4 + z;
        emit(a, y, b);
      };
    case 'minecraft:dark_oak_tree':
      return (_lv, r, x, y, z, emit) => {
        for (let i = 0; i < 16; i++) {
          const a = Math.trunc(i / 4) * 4 + 1 + r.nextInt(3) + x, b = (i % 4) * 4 + 1 + r.nextInt(3) + z;
          emit(a, y, b);
        }
      };
    case 'minecraft:cave_surface': {
      const ceiling = c.surface === 'ceiling', range = c.floor_to_ceiling_search_range as number;
      return (lv, _r, x, y, z, emit) => {
        // Column.scan: from an air block, scan up/down through air to a solid edge
        if (!lv.isAir(x, y, z)) return;
        const dir = ceiling ? 1 : -1;
        let m = y;
        for (let j = 1; j < range && lv.isAir(x, m, z); j++) m += dir;
        if (lv.isSolid(x, m, z)) emit(x, m - dir, z);
      };
    }
    default:
      // carving_mask (lush caves, seagrass in carved water), count_multilayer and end_gateway (other dimensions)
      MISSING_FEATURES.add(`decorator ${j.type}`);
      return () => {};
  }
}

// ------------------------------------------------------------------ helpers
const AIR = 0;
const CAVE_AIR = stateOf('cave_air');
const STONE = stateOf('stone');
const ICE = stateOf('ice');
const isWaterBlock = (s: number) => blockNameOf(s) === 'water';
const isWaterFluid = (s: number) => FLUID[s] === 1;
const isLiquidMaterial = (s: number) => { const n = blockNameOf(s); return n === 'water' || n === 'lava' || n === 'bubble_column'; };

/** Biome.shouldFreeze without the edge check: cold, still water source, no block light (none during generation). */
export function shouldFreeze(lv: GenLevel, x: number, y: number, z: number): boolean {
  if (getTemperature(lv.biome(x, z), x, y, z) >= 0.15 || y < 0 || y >= 256) return false;
  const st = lv.getState(x, y, z);
  return isWaterBlock(st) && getProp(st, 'level') === 0;
}

/** Block.canSurvive for generated plants, including the water and neighbour rules (sugar cane, cactus, seagrass, kelp…). */
export function genCanSurvive(lv: GenLevel, x: number, y: number, z: number, s: number): boolean {
  const name = blockNameOf(s);
  const below = lv.getState(x, y - 1, z);
  const belowName = blockNameOf(below);
  switch (name) {
    case 'sugar_cane': {
      if (belowName === 'sugar_cane') return true;
      if (!inTag('dirt', below) && belowName !== 'sand' && belowName !== 'red_sand') return false;
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const n = lv.getState(x + dx, y - 1, z + dz);
        if (isWaterFluid(n) || blockNameOf(n) === 'frosted_ice') return true;
      }
      return false;
    }
    case 'cactus':
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const n = lv.getState(x + dx, y, z + dz);
        if (MATERIAL_SOLID[n] === 1 || FLUID[n] === 2) return false;
      }
      return (belowName === 'cactus' || belowName === 'sand' || belowName === 'red_sand') && FLUID[lv.getState(x, y + 1, z)] !== 2;
    case 'seagrass': case 'sea_pickle':
      return FULL_COLLISION[below] === 1 && belowName !== 'magma_block';
    case 'tall_seagrass':
      if (getProp(s, 'half') === 'upper') return belowName === 'tall_seagrass';
      return FULL_COLLISION[below] === 1 && belowName !== 'magma_block';
    case 'kelp': case 'kelp_plant':
      if (belowName === 'magma_block') return false;
      return belowName === 'kelp' || belowName === 'kelp_plant' || FULL_COLLISION[below] === 1;
    case 'lily_pad':
      return (isWaterBlock(below) && getProp(below, 'level') === 0 || belowName === 'ice') && FLUID[lv.getState(x, y, z)] === 0;
    case 'sweet_berry_bush':
      return inTag('dirt', below) || belowName === 'farmland';
    case 'pumpkin': case 'melon':
      return true;
  }
  return canSurvive(lv, x, y, z, s);
}

/** DoublePlantBlock.placeAt: lower half here, upper half above. */
function placeDouble(lv: GenLevel, x: number, y: number, z: number, s: number): void {
  lv.setState(x, y, z, withProp(s, 'half', 'lower'));
  lv.setState(x, y + 1, z, withProp(s, 'half', 'upper'));
}
const isDouble = (s: number) => getProp(s, 'half') === 'lower' || getProp(s, 'half') === 'upper';

// ------------------------------------------------------------------ features
const cache = new Map<string, Placer>();

/** A configured feature by id ("minecraft:ore_iron") or inline JSON. */
export function configuredFeature(j: J): Placer {
  if (typeof j === 'string') {
    const id = j.replace('minecraft:', '');
    let p = cache.get(id);
    if (!p) {
      const def = WORLDGEN.configured_features[id];
      if (!def) throw new Error(`configured feature ${id}`);
      cache.set(id, (p = feature(def)));
    }
    return p;
  }
  return feature(j);
}

function feature(j: J): Placer {
  const c = j.config ?? {};
  switch (j.type) {
    case 'minecraft:decorated': {
      const dec = decorator(c.decorator), inner = configuredFeature(c.feature);
      return (lv, r, x, y, z) => {
        let any = false;
        dec(lv, r, x, y, z, (a, b, d) => {
          if (inner(lv, r, a, b, d)) any = true;
        });
        return any;
      };
    }
    case 'minecraft:random_selector': {
      const options = (c.features as J[]).map((e) => ({ chance: f(e.chance), place: configuredFeature(e.feature) }));
      const def = configuredFeature(c.default);
      return (lv, r, x, y, z) => {
        for (const o of options) if (r.nextFloat() < o.chance) return o.place(lv, r, x, y, z);
        return def(lv, r, x, y, z);
      };
    }
    case 'minecraft:simple_random_selector': {
      const options = (c.features as J[]).map(configuredFeature);
      return (lv, r, x, y, z) => options[r.nextInt(options.length)]!(lv, r, x, y, z);
    }
    case 'minecraft:random_boolean_selector': {
      const t = configuredFeature(c.feature_true), fl = configuredFeature(c.feature_false);
      return (lv, r, x, y, z) => (r.nextBoolean() ? t : fl)(lv, r, x, y, z);
    }
    case 'minecraft:ore': return ore(c);
    case 'minecraft:scattered_ore': return scatteredOre(c);
    case 'minecraft:disk': return disk(c, (lv, x, y, z) => isWaterFluid(lv.getState(x, y, z)));
    case 'minecraft:ice_patch': return disk(c, (lv, x, y, z) => {
      while (lv.isEmpty(x, y, z) && y > lv.minY + 2) y--;
      return blockNameOf(lv.getState(x, y, z)) === 'snow_block';
    });
    case 'minecraft:lake': return lake(c);
    case 'minecraft:spring_feature': return spring(c);
    case 'minecraft:random_patch': return randomPatch(c);
    case 'minecraft:flower': return flower(c);
    case 'minecraft:simple_block': return simpleBlock(c);
    case 'minecraft:seagrass': return seagrass(c);
    case 'minecraft:kelp': return kelp;
    case 'minecraft:sea_pickle': return seaPickle(c);
    case 'minecraft:freeze_top_layer': return freezeTopLayer;
    case 'minecraft:tree': return treeFeature(c);
    default:
      MISSING_FEATURES.add(j.type);
      return () => false;
  }
}

/** OreConfiguration targets. */
function targets(c: J): { test: RuleTest; state: number }[] {
  return (c.targets as J[]).map((t) => ({ test: ruleTest(t.target), state: blockState(t.state) }));
}

function isAdjacentToAir(lv: GenLevel, x: number, y: number, z: number): boolean {
  return lv.isAir(x - 1, y, z) || lv.isAir(x + 1, y, z) || lv.isAir(x, y - 1, z) || lv.isAir(x, y + 1, z) || lv.isAir(x, y, z - 1) || lv.isAir(x, y, z + 1);
}

/** OreFeature.canPlaceOre */
function canPlaceOre(lv: GenLevel, s: number, r: JavaRandom, discard: number, test: RuleTest, x: number, y: number, z: number): boolean {
  if (!test(s, r)) return false;
  // shouldSkipAirCheck
  if (discard <= 0) return true;
  if (discard < 1 && r.nextFloat() >= f(discard)) return true;
  return !isAdjacentToAir(lv, x, y, z);
}

/** OreFeature (1.17.1): a tube of blobs between two random points around the origin. */
function ore(c: J): Placer {
  const size = c.size as number, discard = f(c.discard_chance_on_air_exposure ?? 0), tg = targets(c);
  return (lv, r, ox, oy, oz) => {
    const a = f(r.nextFloat() * F_PI);
    const g = f(size / 8);
    const i = Math.ceil(f(f(f(size / 16) * 2) + 1) / 2);
    const x0 = ox + Math.sin(a) * g, x1 = ox - Math.sin(a) * g;
    const z0 = oz + Math.cos(a) * g, z1 = oz - Math.cos(a) * g;
    const y0 = oy + r.nextInt(3) - 2, y1 = oy + r.nextInt(3) - 2;
    const minX = ox - Math.ceil(g) - i, minY = oy - 2 - i, minZ = oz - Math.ceil(g) - i;
    const width = 2 * (Math.ceil(g) + i), height = 2 * (2 + i);
    for (let s = minX; s <= minX + width; s++)
      for (let t = minZ; t <= minZ + width; t++)
        if (minY <= lv.getHeight('OCEAN_FLOOR_WG', s, t)) return orePlace(lv, r, size, discard, tg, x0, x1, z0, z1, y0, y1, minX, minY, minZ, width, height);
    return false;
  };
}

function orePlace(lv: GenLevel, r: JavaRandom, size: number, discard: number, tg: { test: RuleTest; state: number }[], x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, minX: number, minY: number, minZ: number, width: number, height: number): boolean {
  let placed = 0;
  const done = new Uint8Array(width * height * width);
  const ds = new Float64Array(size * 4);
  for (let k = 0; k < size; k++) {
    const t = f(k / size);
    const h = (r.nextDouble() * size) / 16;
    ds[k * 4] = x0 + t * (x1 - x0);
    ds[k * 4 + 1] = y0 + t * (y1 - y0);
    ds[k * 4 + 2] = z0 + t * (z1 - z0);
    ds[k * 4 + 3] = (f(mthSin(f(F_PI * t)) + 1) * h + 1) / 2;
  }
  for (let k = 0; k < size - 1; k++) {
    if (ds[k * 4 + 3]! <= 0) continue;
    for (let n = k + 1; n < size; n++) {
      if (ds[n * 4 + 3]! <= 0) continue;
      const dx = ds[k * 4]! - ds[n * 4]!, dy = ds[k * 4 + 1]! - ds[n * 4 + 1]!, dz = ds[k * 4 + 2]! - ds[n * 4 + 2]!, dr = ds[k * 4 + 3]! - ds[n * 4 + 3]!;
      if (dr * dr > dx * dx + dy * dy + dz * dz) {
        if (dr > 0) ds[n * 4 + 3] = -1;
        else ds[k * 4 + 3] = -1;
      }
    }
  }
  for (let n = 0; n < size; n++) {
    const d = ds[n * 4 + 3]!;
    if (d < 0) continue;
    const cx = ds[n * 4]!, cy = ds[n * 4 + 1]!, cz = ds[n * 4 + 2]!;
    const ax = Math.max(Math.floor(cx - d), minX), ay = Math.max(Math.floor(cy - d), minY), az = Math.max(Math.floor(cz - d), minZ);
    const bx = Math.max(Math.floor(cx + d), ax), by = Math.max(Math.floor(cy + d), ay), bz = Math.max(Math.floor(cz + d), az);
    for (let u = ax; u <= bx; u++) {
      const v = (u + 0.5 - cx) / d;
      if (v * v >= 1) continue;
      for (let w = ay; w <= by; w++) {
        const q = (w + 0.5 - cy) / d;
        if (v * v + q * q >= 1) continue;
        for (let e = az; e <= bz; e++) {
          const p = (e + 0.5 - cz) / d;
          if (v * v + q * q + p * p >= 1 || lv.isOutsideBuildHeight(w)) continue;
          const idx = u - minX + (w - minY) * width + (e - minZ) * width * height;
          if (done[idx]) continue;
          done[idx] = 1;
          if (!lv.canWrite(u, e)) continue;
          const s = lv.getState(u, w, e);
          for (const t of tg) {
            if (!canPlaceOre(lv, s, r, discard, t.test, u, w, e)) continue;
            lv.setState(u, w, e, t.state);
            placed++;
            break;
          }
        }
      }
    }
  }
  return placed > 0;
}

/** ScatteredOreFeature: single ore blocks scattered around the origin. */
function scatteredOre(c: J): Placer {
  const size = c.size as number, discard = f(c.discard_chance_on_air_exposure ?? 0), tg = targets(c);
  const off = (r: JavaRandom, m: number) => Math.floor(f(f(r.nextFloat() - r.nextFloat()) * m) + 0.5);
  return (lv, r, ox, oy, oz) => {
    const n = r.nextInt(size + 1);
    for (let j = 0; j < n; j++) {
      const m = Math.min(j, 7);
      const x = ox + off(r, m), y = oy + off(r, m), z = oz + off(r, m);
      const s = lv.getState(x, y, z);
      for (const t of tg) {
        if (!canPlaceOre(lv, s, r, discard, t.test, x, y, z)) continue;
        lv.setState(x, y, z, t.state);
        break;
      }
    }
    return true;
  };
}

/** BaseDiskFeature (disk = DiskReplaceFeature, needs water at the origin; ice_patch needs snow below). */
function disk(c: J, precondition: (lv: GenLevel, x: number, y: number, z: number) => boolean): Placer {
  const state = blockState(c.state), radius = intProvider(c.radius), half = c.half_height as number;
  const targetBlocks = new Set((c.targets as J[]).map((t) => String(t.Name).replace('minecraft:', '')));
  const name = blockNameOf(state);
  const falling = ['sand', 'red_sand', 'gravel'].includes(name) || name.endsWith('concrete_powder');
  const support = stateOf(name === 'red_sand' ? 'red_sandstone' : 'sandstone');
  return (lv, r, ox, oy, oz) => {
    if (!precondition(lv, ox, oy, oz)) return false;
    let any = false;
    const top = oy + half, bottom = oy - half - 1;
    const l = radius(r);
    for (let x = ox - l; x <= ox + l; x++)
      for (let z = oz - l; z <= oz + l; z++) {
        const dx = x - ox, dz = z - oz;
        if (dx * dx + dz * dz > l * l) continue;
        let prev = false;
        for (let y = top; y >= bottom; y--) {
          const s = lv.getState(x, y, z);
          let now = false;
          if (y > bottom && targetBlocks.has(blockNameOf(s))) {
            lv.setState(x, y, z, state);
            any = true;
            now = true;
          }
          if (falling && prev && IS_AIR[s] === 1) lv.setState(x, y + 1, z, support);
          prev = now;
        }
      }
    return any;
  };
}

/** LakeFeature: a 16×8×16 blob of overlapping ellipsoids; liquid below the midline, air above. */
function lake(c: J): Placer {
  const state = blockState(c.state);
  const lava = blockNameOf(state) === 'lava', water = blockNameOf(state) === 'water';
  const GRASS = stateOf('grass_block', { snowy: false }), MYCELIUM = stateOf('mycelium', { snowy: false });
  return (lv, r, ox, y, oz) => {
    while (y > lv.minY + 5 && lv.isEmpty(ox, y, oz)) y--;
    if (y <= lv.minY + 4) return false;
    y -= 4;
    // (no villages yet, so the village-start check never stops a lake)
    const bs = new Uint8Array(2048);
    const n = r.nextInt(4) + 4;
    for (let j = 0; j < n; j++) {
      const d = r.nextDouble() * 6 + 3, e = r.nextDouble() * 4 + 2, g = r.nextDouble() * 6 + 3;
      const h = r.nextDouble() * (16 - d - 2) + 1 + d / 2, k = r.nextDouble() * (8 - e - 4) + 2 + e / 2, m = r.nextDouble() * (16 - g - 2) + 1 + g / 2;
      for (let l = 1; l < 15; l++)
        for (let q = 1; q < 15; q++)
          for (let t = 1; t < 7; t++) {
            const a = (l - h) / (d / 2), b = (t - k) / (e / 2), cc = (q - m) / (g / 2);
            if (a * a + b * b + cc * cc < 1) bs[(l * 16 + q) * 8 + t] = 1;
          }
    }
    const edge = (j: number, s: number, t: number) =>
      !bs[(j * 16 + s) * 8 + t] && ((j < 15 && bs[((j + 1) * 16 + s) * 8 + t]) || (j > 0 && bs[((j - 1) * 16 + s) * 8 + t]) || (s < 15 && bs[(j * 16 + s + 1) * 8 + t]) ||
        (s > 0 && bs[(j * 16 + (s - 1)) * 8 + t]) || (t < 7 && bs[(j * 16 + s) * 8 + t + 1]) || (t > 0 && bs[(j * 16 + s) * 8 + (t - 1)]));
    for (let j = 0; j < 16; j++)
      for (let s = 0; s < 16; s++)
        for (let t = 0; t < 8; t++) {
          if (!edge(j, s, t)) continue;
          const st = lv.getState(ox + j, y + t, oz + s);
          if (t >= 4 && isLiquidMaterial(st)) return false;
          if (t < 4 && MATERIAL_SOLID[st] !== 1 && st !== state) return false;
        }
    for (let j = 0; j < 16; j++)
      for (let s = 0; s < 16; s++)
        for (let t = 0; t < 8; t++) if (bs[(j * 16 + s) * 8 + t]) lv.setState(ox + j, y + t, oz + s, t >= 4 ? CAVE_AIR : state);
    for (let j = 0; j < 16; j++)
      for (let s = 0; s < 16; s++)
        for (let t = 4; t < 8; t++) {
          if (!bs[(j * 16 + s) * 8 + t]) continue;
          const x = ox + j, z = oz + s, by = y + t - 1;
          if (!inTag('dirt', lv.getState(x, by, z)) || !lv.canSeeSky(x, y + t, z)) continue;
          lv.setState(x, by, z, lv.gen.topMaterialIsMycelium(lv.biome(x, z)) ? MYCELIUM : GRASS);
        }
    if (lava)
      for (let j = 0; j < 16; j++)
        for (let s = 0; s < 16; s++)
          for (let t = 0; t < 8; t++) {
            if (!edge(j, s, t) || (t >= 4 && r.nextInt(2) === 0) || MATERIAL_SOLID[lv.getState(ox + j, y + t, oz + s)] !== 1) continue;
            lv.setState(ox + j, y + t, oz + s, STONE);
          }
    if (water)
      for (let j = 0; j < 16; j++)
        for (let s = 0; s < 16; s++) if (shouldFreeze(lv, ox + j, y + 4, oz + s)) lv.setState(ox + j, y + 4, oz + s, ICE);
    return true;
  };
}

/** SpringFeature: a single fluid source in a wall with the right number of rock and open sides. */
function spring(c: J): Placer {
  const valid = new Set((c.valid_blocks as string[]).map((b) => b.replace('minecraft:', '')));
  const state = stateOf(blockNameOf(blockState(c.state)), { level: 0 });
  const ok = (lv: GenLevel, x: number, y: number, z: number) => valid.has(blockNameOf(lv.getState(x, y, z)));
  return (lv, _r, x, y, z) => {
    if (!ok(lv, x, y + 1, z)) return false;
    if (c.requires_block_below && !ok(lv, x, y - 1, z)) return false;
    const s = lv.getState(x, y, z);
    if (IS_AIR[s] !== 1 && !valid.has(blockNameOf(s))) return false;
    const sides: [number, number, number][] = [[x - 1, y, z], [x + 1, y, z], [x, y, z - 1], [x, y, z + 1], [x, y - 1, z]];
    let rock = 0, hole = 0;
    for (const [a, b, d] of sides) if (ok(lv, a, b, d)) rock++;
    for (const [a, b, d] of sides) if (lv.isEmpty(a, b, d)) hole++;
    if (rock !== c.rock_count || hole !== c.hole_count) return false;
    lv.setState(x, y, z, state);
    lv.scheduleFluidTick(x, y, z);
    return true;
  };
}

type BlockPlacer = (lv: GenLevel, x: number, y: number, z: number, s: number, r: JavaRandom) => void;
function blockPlacer(j: J): BlockPlacer {
  switch (j.type) {
    case 'minecraft:simple_block_placer': return (lv, x, y, z, s) => void lv.setState(x, y, z, s);
    case 'minecraft:double_plant_placer': return (lv, x, y, z, s) => placeDouble(lv, x, y, z, s);
    case 'minecraft:column_placer': {
      const size = intProvider(j.size);
      return (lv, x, y, z, s, r) => {
        for (let i = size(r); i > 0; i--) lv.setState(x, y++, z, s);
      };
    }
    default: throw new Error(`block placer ${j.type}`);
  }
}

/** RandomPatchFeature: one state, many tries scattered around the origin. */
function randomPatch(c: J): Placer {
  const provider = stateProvider(c.state_provider), placer = blockPlacer(c.block_placer);
  const whitelist = new Set((c.whitelist as J[]).map((b) => String(b.Name).replace('minecraft:', '')));
  const blacklist = new Set((c.blacklist as J[]).map(blockState));
  const { xspread: xs, yspread: ys, zspread: zs, tries, project, can_replace: canReplace, need_water: needWater } = c;
  return (lv, r, ox, oy, oz) => {
    const s = provider(r, ox, oy, oz);
    const by = project ? lv.getHeight('WORLD_SURFACE_WG', ox, oz) : oy;
    let n = 0;
    for (let j = 0; j < tries; j++) {
      const x = ox + r.nextInt(xs + 1) - r.nextInt(xs + 1);
      const y = by + r.nextInt(ys + 1) - r.nextInt(ys + 1);
      const z = oz + r.nextInt(zs + 1) - r.nextInt(zs + 1);
      const below = lv.getState(x, y - 1, z);
      if ((!lv.isEmpty(x, y, z) && (!canReplace || !isReplaceable(lv.getState(x, y, z)))) || !genCanSurvive(lv, x, y, z, s) ||
        (whitelist.size > 0 && !whitelist.has(blockNameOf(below))) || blacklist.has(below) ||
        (needWater && !(isWaterFluid(lv.getState(x - 1, y - 1, z)) || isWaterFluid(lv.getState(x + 1, y - 1, z)) || isWaterFluid(lv.getState(x, y - 1, z - 1)) || isWaterFluid(lv.getState(x, y - 1, z + 1)))))
        continue;
      placer(lv, x, y, z, s, r);
      n++;
    }
    return n > 0;
  };
}

/** Material.isReplaceable: air, water, lava, plants that can be replaced (grass, fern, snow layers…). */
function isReplaceable(s: number): boolean {
  if (IS_AIR[s] === 1 || FLUID[s] !== 0 && !getProp(s, 'waterlogged')) return true;
  const n = blockNameOf(s);
  return ['grass', 'fern', 'dead_bush', 'tall_grass', 'large_fern', 'snow', 'vine', 'glow_lichen', 'seagrass', 'tall_seagrass', 'fire', 'soul_fire', 'crimson_roots', 'warped_roots', 'nether_sprouts', 'hanging_roots'].includes(n);
}

/** FlowerFeature (AbstractFlowerFeature): one flower state per patch, spread nextInt(spread) - nextInt(spread). */
function flower(c: J): Placer {
  const provider = stateProvider(c.state_provider);
  const blacklist = new Set((c.blacklist as J[]).map(blockState));
  const { xspread: xs, yspread: ys, zspread: zs, tries } = c;
  return (lv, r, ox, oy, oz) => {
    const s = provider(r, ox, oy, oz);
    let n = 0;
    for (let j = 0; j < tries; j++) {
      const x = ox + r.nextInt(xs) - r.nextInt(xs), y = oy + r.nextInt(ys) - r.nextInt(ys), z = oz + r.nextInt(zs) - r.nextInt(zs);
      if (!lv.isEmpty(x, y, z) || y >= 255 || !genCanSurvive(lv, x, y, z, s) || blacklist.has(lv.getState(x, y, z))) continue;
      lv.setState(x, y, z, s);
      n++;
    }
    return n > 0;
  };
}

/** SimpleBlockFeature */
function simpleBlock(c: J): Placer {
  const provider = stateProvider(c.to_place);
  const on = new Set(((c.place_on ?? []) as J[]).map(blockState)), inn = new Set(((c.place_in ?? []) as J[]).map(blockState)), under = new Set(((c.place_under ?? []) as J[]).map(blockState));
  return (lv, r, x, y, z) => {
    if (on.size && !on.has(lv.getState(x, y - 1, z))) return false;
    if (inn.size && !inn.has(lv.getState(x, y, z))) return false;
    if (under.size && !under.has(lv.getState(x, y + 1, z))) return false;
    const s = provider(r, x, y, z);
    if (!genCanSurvive(lv, x, y, z, s)) return false;
    if (isDouble(s)) {
      if (!lv.isEmpty(x, y + 1, z)) return false;
      placeDouble(lv, x, y, z, s);
    } else lv.setState(x, y, z, s);
    return true;
  };
}

const SEAGRASS = stateOf('seagrass');
const TALL_SEAGRASS = stateOf('tall_seagrass', { half: 'lower' });
/** SeagrassFeature */
function seagrass(c: J): Placer {
  const p = f(c.probability);
  return (lv, r, ox, _oy, oz) => {
    const i = r.nextInt(8) - r.nextInt(8), j = r.nextInt(8) - r.nextInt(8);
    const x = ox + i, z = oz + j, y = lv.getHeight('OCEAN_FLOOR', x, z);
    if (!isWaterBlock(lv.getState(x, y, z))) return false;
    const tall = r.nextDouble() < p;
    const s = tall ? TALL_SEAGRASS : SEAGRASS;
    if (!genCanSurvive(lv, x, y, z, s)) return false;
    if (tall) {
      if (isWaterBlock(lv.getState(x, y + 1, z))) {
        lv.setState(x, y, z, s);
        lv.setState(x, y + 1, z, withProp(s, 'half', 'upper'));
      }
    } else lv.setState(x, y, z, s);
    return true;
  };
}

const KELP = stateOf('kelp');
const KELP_PLANT = stateOf('kelp_plant');
/** KelpFeature: a column of kelp plant topped by a kelp head of age 20–23. */
const kelp: Placer = (lv, r, x, _oy, z) => {
  let placed = 0;
  let y = lv.getHeight('OCEAN_FLOOR', x, z);
  if (!isWaterBlock(lv.getState(x, y, z))) return false;
  const k = 1 + r.nextInt(10);
  for (let l = 0; l <= k; l++) {
    if (isWaterBlock(lv.getState(x, y, z)) && isWaterBlock(lv.getState(x, y + 1, z)) && genCanSurvive(lv, x, y, z, KELP_PLANT)) {
      if (l === k) {
        lv.setState(x, y, z, withProp(KELP, 'age', r.nextInt(4) + 20));
        placed++;
      } else lv.setState(x, y, z, KELP_PLANT);
    } else if (l > 0) {
      if (genCanSurvive(lv, x, y - 1, z, KELP) && blockNameOf(lv.getState(x, y - 2, z)) !== 'kelp') {
        lv.setState(x, y - 1, z, withProp(KELP, 'age', r.nextInt(4) + 20));
        placed++;
      }
      break;
    }
    y++;
  }
  return placed > 0;
};

/** SeaPickleFeature */
function seaPickle(c: J): Placer {
  const count = intProvider(c.count);
  const PICKLE = stateOf('sea_pickle', { waterlogged: true });
  return (lv, r, ox, _oy, oz) => {
    let n = 0;
    for (let k = count(r); k > 0; k--) {
      const i = r.nextInt(8) - r.nextInt(8), j = r.nextInt(8) - r.nextInt(8);
      const x = ox + i, z = oz + j, y = lv.getHeight('OCEAN_FLOOR', x, z);
      const s = withProp(PICKLE, 'pickles', r.nextInt(4) + 1);
      if (!isWaterBlock(lv.getState(x, y, z)) || !genCanSurvive(lv, x, y, z, s)) continue;
      lv.setState(x, y, z, s);
      n++;
    }
    return n > 0;
  };
}

const SNOW = stateOf('snow', { layers: 1 });
/** SnowAndFreezeFeature (freeze_top_layer): ice on cold water, a snow layer on cold ground, in this chunk. */
const freezeTopLayer: Placer = (lv, _r, ox, _oy, oz) => {
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++) {
      const x = ox + i, z = oz + j;
      const y = lv.getHeight('MOTION_BLOCKING', x, z);
      if (shouldFreeze(lv, x, y - 1, z)) lv.setState(x, y - 1, z, ICE);
      // Biome.shouldSnow: cold, air, and snow could stand here
      if (getTemperature(lv.biome(x, z), x, y, z) < 0.15 && y >= 0 && y < 256 && lv.getState(x, y, z) === AIR && genCanSurvive(lv, x, y, z, SNOW)) {
        lv.setState(x, y, z, SNOW);
        const below = lv.getState(x, y - 1, z);
        if (getProp(below, 'snowy') === false) lv.setState(x, y - 1, z, withProp(below, 'snowy', true));
      }
    }
  return true;
};

export { floatProvider };
