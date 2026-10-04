/**
 * Structure start placement (vanilla 1.17.1 StructureFeature.generate / getPotentialFeatureChunk,
 * StructureSettings.DEFAULTS, the per-feature isFeatureChunk checks and the stronghold rings of
 * ChunkGenerator.generateStrongholds), the start cache, placing pieces while a chunk is decorated
 * and /locate (StructureFeature.getNearestGeneratedFeature).
 */
import { JavaRandom } from '../../util/random';
import { largeFeatureSeed, regionSeed } from '../rand';
import { WORLDGEN } from '../features/data';
import type { GenLevel } from '../features/level';
import { OverworldGenerator } from '../overworld/generator';
import { B } from '../biome/biomeids';
import { BoundingBox, StructureStart, type Piece } from './piece';
import { desertPyramid, jungleTemple, swampHut, igloo } from './scattered';
import { shipwreck, oceanRuin, buriedTreasure } from './ocean';
import { ruinedPortal } from './ruined-portal';
import { mineshaft } from './mineshaft';
import { stronghold } from './stronghold';
import { village } from './village';
import { pillagerOutpost } from './outpost';
import { oceanMonument } from './monument';
import { woodlandMansion } from './mansion';
// registers the structure loot tables in CHEST_LOOT (the chest roller reads them from there)
import './loot';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface StartContext {
  gen: OverworldGenerator;
  seed: bigint;
  cx: number;
  cz: number;
  /** the start's random: setLargeFeatureSeed(seed, cx, cz) */
  rand: JavaRandom;
  /** the chunk's primary biome */
  biome: number;
  /** the configured structure feature's config */
  config: J;
}
export type StartGenerator = (c: StartContext) => Piece[];

export interface FeatureDef {
  /** GenerationStep.Decoration and the index within the step (registry order) */
  step: number;
  index: number;
  /** StructureFeatureConfiguration: spacing, separation, salt; triangular = !linearSeparation */
  spacing: number;
  separation: number;
  salt: number;
  triangular?: boolean;
  /** furthest a piece reaches from the start chunk, in chunks */
  reach: number;
  generate: StartGenerator;
  /** extra isFeatureChunk rule */
  check?: (gen: OverworldGenerator, seed: bigint, cx: number, cz: number, config: J) => boolean;
}

/** Biome category from the worldgen data. */
const categoryOf = (b: number) => WORLDGEN.biomes[biomeName(b)]?.category ?? 'none';
const BIOME_NAMES: Record<number, string> = Object.fromEntries(Object.entries(B).map(([n, id]) => [id, n]));
const biomeName = (b: number) => BIOME_NAMES[b] ?? 'plains';

/** BiomeSource.getBiomesWithin(x, y, z, radius) at quart resolution. */
function biomesWithin(gen: OverworldGenerator, x: number, z: number, radius: number): Set<number> {
  const out = new Set<number>();
  const qx0 = (x - radius) >> 2, qx1 = (x + radius) >> 2, qz0 = (z - radius) >> 2, qz1 = (z + radius) >> 2;
  for (let qz = qz0; qz <= qz1; qz++) for (let qx = qx0; qx <= qx1; qx++) out.add(gen.quartBiome(qx, qz));
  return out;
}

/** The configured structure features a biome lists for a feature type (biome `starts`). */
function configuredFor(biome: number, type: string): J | undefined {
  for (const name of WORLDGEN.biomes[biomeName(biome)]?.starts ?? []) {
    const csf = WORLDGEN.configured_structure_features[name.replace('minecraft:', '')];
    if (csf && csf.type === `minecraft:${type}`) return csf.config;
  }
  return undefined;
}
const validStart = (biome: number, type: string) => configuredFor(biome, type) !== undefined;

export const FEATURES: Record<string, FeatureDef> = {
  // underground structures: mineshaft 0, buried treasure 1
  mineshaft: {
    step: 3, index: 0, spacing: 1, separation: 0, salt: 0, reach: 8, generate: mineshaft,
    // MineshaftFeature.isFeatureChunk: setLargeFeatureSeed, nextDouble() < probability
    check: (_g, seed, cx, cz, config) => new JavaRandom(largeFeatureSeed(seed, cx, cz)).nextDouble() < (config.probability as number),
  },
  buried_treasure: {
    step: 3, index: 1, spacing: 1, separation: 0, salt: 0, reach: 0, generate: buriedTreasure,
    check: (_g, seed, cx, cz, config) => new JavaRandom(regionSeed(seed, cx, cz, 10387320)).nextFloat() < Math.fround(config.probability as number),
  },
  // surface structures, in registry order
  pillager_outpost: {
    step: 4, index: 0, spacing: 32, separation: 8, salt: 165745296, reach: 6, generate: pillagerOutpost,
    check: (_g, seed, cx, cz) => {
      // PillagerOutpostFeature.isFeatureChunk
      const r = new JavaRandom(BigInt.asIntN(64, BigInt((cx >> 4) ^ ((cz >> 4) << 4)) ^ seed));
      r.nextInt();
      if (r.nextInt(5) !== 0) return false;
      // isNearVillage: any village potential chunk within 10 chunks
      const v = FEATURES.village!;
      for (let x = cx - 10; x <= cx + 10; x++)
        for (let z = cz - 10; z <= cz + 10; z++) {
          const [px, pz] = potentialChunk(v, seed, x, z);
          if (px === x && pz === z) return false;
        }
      return true;
    },
  },
  mansion: {
    step: 4, index: 1, spacing: 80, separation: 20, salt: 10387319, triangular: true, reach: 8, generate: woodlandMansion,
    check: (gen, _s, cx, cz) => [...biomesWithin(gen, (cx << 4) + 9, (cz << 4) + 9, 32)].every((b) => validStart(b, 'mansion')),
  },
  jungle_pyramid: { step: 4, index: 2, spacing: 32, separation: 8, salt: 14357619, reach: 2, generate: jungleTemple },
  desert_pyramid: { step: 4, index: 3, spacing: 32, separation: 8, salt: 14357617, reach: 2, generate: desertPyramid },
  igloo: { step: 4, index: 4, spacing: 32, separation: 8, salt: 14357618, reach: 2, generate: igloo },
  ruined_portal: { step: 4, index: 5, spacing: 40, separation: 15, salt: 34222645, reach: 3, generate: ruinedPortal },
  shipwreck: { step: 4, index: 6, spacing: 24, separation: 4, salt: 165745295, reach: 3, generate: shipwreck },
  swamp_hut: { step: 4, index: 7, spacing: 32, separation: 8, salt: 14357620, reach: 1, generate: swampHut },
  monument: {
    step: 4, index: 8, spacing: 32, separation: 5, salt: 10387313, triangular: true, reach: 4, generate: oceanMonument,
    check: (gen, _s, cx, cz) => {
      const x = (cx << 4) + 9, z = (cz << 4) + 9;
      for (const b of biomesWithin(gen, x, z, 16)) if (!validStart(b, 'monument')) return false;
      for (const b of biomesWithin(gen, x, z, 29)) {
        const c = categoryOf(b);
        if (c !== 'ocean' && c !== 'river') return false;
      }
      return true;
    },
  },
  ocean_ruin: { step: 4, index: 9, spacing: 20, separation: 8, salt: 14357621, reach: 3, generate: oceanRuin },
  village: { step: 4, index: 11, spacing: 32, separation: 8, salt: 10387312, reach: 8, generate: village },
  // strongholds step
  stronghold: { step: 5, index: 0, spacing: 1, separation: 0, salt: 0, reach: 8, generate: stronghold },
};

/** StructureFeature.getPotentialFeatureChunk */
export function potentialChunk(def: FeatureDef, seed: bigint, cx: number, cz: number): [number, number] {
  const sp = def.spacing, se = def.separation;
  if (sp === 1) return [cx, cz];
  const rx = Math.floor(cx / sp), rz = Math.floor(cz / sp);
  const r = new JavaRandom(regionSeed(seed, rx, rz, def.salt));
  let ox: number, oz: number;
  if (def.triangular) {
    ox = (r.nextInt(sp - se) + r.nextInt(sp - se)) >> 1;
    oz = (r.nextInt(sp - se) + r.nextInt(sp - se)) >> 1;
  } else {
    ox = r.nextInt(sp - se);
    oz = r.nextInt(sp - se);
  }
  return [rx * sp + ox, rz * sp + oz];
}

// ------------------------------------------------------------------ strongholds
const STRONGHOLD_BIOMES = new Set<number>(Object.entries(B).filter(([n]) => (WORLDGEN.biomes[n]?.starts ?? []).includes('minecraft:stronghold')).map(([, id]) => id));

/** BiomeSource.findBiomeHorizontal (not closest-first): a random matching quart within radius, or null. */
function findBiomeHorizontal(gen: OverworldGenerator, x: number, z: number, radius: number, ok: (b: number) => boolean, r: JavaRandom): [number, number] | null {
  const i = x >> 2, j = z >> 2, k = radius >> 2;
  let pos: [number, number] | null = null;
  let m = 0;
  for (let o = k; o <= k; o++)
    for (let p = -o; p <= o; p++)
      for (let q = -o; q <= o; q++) {
        const rx = i + q, rz = j + p;
        if (!ok(gen.quartBiome(rx, rz))) continue;
        if (pos === null || r.nextInt(m + 1) === 0) pos = [rx << 2, rz << 2];
        m++;
      }
  return pos;
}

/** Resumable ChunkGenerator.generateStrongholds state (positions are produced ring by ring, in order). */
interface RingState { r: JavaRandom; d: number; l: number; m: number; spread: number; n: number; list: [number, number][] }
const ringStates = new Map<bigint, RingState>();
const RING_DISTANCE = 32, RING_COUNT = 128;

function ringState(gen: OverworldGenerator): RingState {
  let st = ringStates.get(gen.seed);
  if (!st) {
    const r = new JavaRandom(gen.seed);
    st = { r, d: r.nextDouble() * Math.PI * 2, l: 0, m: 0, spread: 3, n: 0, list: [] };
    ringStates.set(gen.seed, st);
  }
  return st;
}

/** Generates the next stronghold position (one step of the vanilla loop). */
function nextStronghold(gen: OverworldGenerator, st: RingState): void {
  const r = st.r, distance = RING_DISTANCE;
  const e = 4 * distance + distance * st.m * 6 + (r.nextDouble() - 0.5) * distance * 2.5;
  let o = javaRound(Math.cos(st.d) * e), p = javaRound(Math.sin(st.d) * e);
  const pos = findBiomeHorizontal(gen, (o << 4) + 8, (p << 4) + 8, 112, (b) => STRONGHOLD_BIOMES.has(b), r);
  if (pos) {
    o = pos[0] >> 4;
    p = pos[1] >> 4;
  }
  st.list.push([o, p]);
  st.d += (Math.PI * 2) / st.spread;
  if (++st.l === st.spread) {
    st.l = 0;
    st.spread += Math.trunc((2 * st.spread) / (++st.m + 1));
    st.spread = Math.min(st.spread, RING_COUNT - st.n);
    st.d += r.nextDouble() * Math.PI * 2;
  }
  st.n++;
}

/**
 * ChunkGenerator.generateStrongholds: 128 positions in rings (distance 32, count 128, spread 3).
 * With `withinChunks`, only the rings that can come that close to the origin are computed (the
 * random sequence is the same; later rings are generated on demand).
 */
export function strongholdPositions(gen: OverworldGenerator, withinChunks = Infinity): [number, number][] {
  const st = ringState(gen);
  // ring m lies at 128 + 192 m ± 40 chunks, moved at most 7 chunks by the biome search
  while (st.n < RING_COUNT && 4 * RING_DISTANCE + RING_DISTANCE * st.m * 6 - 40 - 8 <= withinChunks) nextStronghold(gen, st);
  return st.list;
}
/** Math.round(double) → long */
const javaRound = (v: number) => Math.floor(v + 0.5);

/** Nearest ring distance is 128 - 40 chunks; skip the ring computation for chunks well inside it. */
const STRONGHOLD_MIN_CHUNKS = 128 - 40 - 28 - 8 - 2;
function hasStronghold(gen: OverworldGenerator, cx: number, cz: number): boolean {
  const d = Math.hypot(cx, cz);
  if (d < STRONGHOLD_MIN_CHUNKS) return false;
  return strongholdPositions(gen, d).some(([x, z]) => x === cx && z === cz);
}

// ------------------------------------------------------------------ starts
const startCaches = new WeakMap<OverworldGenerator, Map<string, StructureStart | null>>();
function cacheFor(gen: OverworldGenerator): Map<string, StructureStart | null> {
  let c = startCaches.get(gen);
  if (!c) startCaches.set(gen, (c = new Map()));
  return c;
}

/** StructureFeature.generate: the start of `type` in chunk (cx, cz), or null. */
export function structureStart(gen: OverworldGenerator, type: string, cx: number, cz: number): StructureStart | null {
  const def = FEATURES[type];
  if (!def) return null;
  const cache = cacheFor(gen);
  const key = `${type}:${cx}:${cz}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const start = createStart(gen, type, def, cx, cz);
  // empty results are cheap to recompute: forget them when the cache grows large
  if (!start && cache.size > 400000) for (const [k, v] of cache) if (!v) cache.delete(k);
  cache.set(key, start);
  return start;
}

function createStart(gen: OverworldGenerator, type: string, def: FeatureDef, cx: number, cz: number): StructureStart | null {
  const seed = gen.seed;
  const [px, pz] = potentialChunk(def, seed, cx, cz);
  if (px !== cx || pz !== cz) return null;
  // BiomeSource.getPrimaryBiome
  const biome = gen.quartBiome((cx << 2) + 2, (cz << 2) + 2);
  let config: J;
  if (type === 'stronghold') {
    if (!hasStronghold(gen, cx, cz)) return null;
    config = {};
  } else {
    config = configuredFor(biome, type);
    if (config === undefined) return null;
  }
  if (def.check && !def.check(gen, seed, cx, cz, config)) return null;
  const rand = new JavaRandom(largeFeatureSeed(seed, cx, cz));
  let pieces: Piece[];
  try {
    pieces = def.generate({ gen, seed, cx, cz, rand, biome, config });
  } catch (e) {
    // a broken structure must never stop world generation
    console.error(`[worldgen] ${type} start at chunk ${cx},${cz} failed:`, e);
    return null;
  }
  if (!pieces.length) return null;
  return new StructureStart(type, cx, cz, pieces);
}

/** Starts of `type` whose box reaches chunk (cx, cz). */
export function startsReaching(gen: OverworldGenerator, type: string, cx: number, cz: number): StructureStart[] {
  const def = FEATURES[type]!;
  const out: StructureStart[] = [];
  const R = def.reach;
  const x0 = cx << 4, z0 = cz << 4;
  const consider = (sx: number, sz: number) => {
    const s = structureStart(gen, type, sx, sz);
    if (s && s.xzBox.intersectsXZ(x0, z0, x0 + 15, z0 + 15)) out.push(s);
  };
  if (def.spacing === 1) {
    for (let sx = cx - R; sx <= cx + R; sx++) for (let sz = cz - R; sz <= cz + R; sz++) consider(sx, sz);
  } else {
    const sp = def.spacing;
    for (let rx = Math.floor((cx - R) / sp); rx <= Math.floor((cx + R) / sp); rx++)
      for (let rz = Math.floor((cz - R) / sp); rz <= Math.floor((cz + R) / sp); rz++) {
        const [px, pz] = potentialChunk(def, gen.seed, rx * sp, rz * sp);
        if (Math.abs(px - cx) <= R && Math.abs(pz - cz) <= R) consider(px, pz);
      }
  }
  return out;
}

/** Per step, the structure features in index order. */
const BY_STEP: [string, FeatureDef][][] = [];
for (const [name, def] of Object.entries(FEATURES)) (BY_STEP[def.step] ??= []).push([name, def]);
for (const l of BY_STEP) l?.sort((a, b) => a[1].index - b[1].index);

/** Whether structures generate (the level's generate-structures flag); tools can turn it off. */
export const STRUCTURE_OPTIONS = { enabled: true };

/**
 * Biome.generate's structure part for one step: every start of each feature reaching this chunk
 * places its pieces inside the chunk, with the feature's random setFeatureSeed(decoration, index, step).
 */
export function placeStructures(gen: OverworldGenerator, lv: GenLevel, step: number, randFor: (index: number) => JavaRandom): void {
  if (!STRUCTURE_OPTIONS.enabled) return;
  const list = BY_STEP[step];
  if (!list) return;
  const chunk = BoundingBox.chunk(lv.cx, lv.cz);
  for (const [name, def] of list) {
    const starts = startsReaching(gen, name, lv.cx, lv.cz);
    if (!starts.length) continue;
    const rand = randFor(def.index);
    for (const s of starts)
      try {
        s.placeInChunk({ lv, rand, chunk });
      } catch (e) {
        console.error(`[worldgen] placing ${name} at chunk ${lv.cx},${lv.cz} failed:`, e);
      }
  }
}

// ------------------------------------------------------------------ /locate
const genCache = new Map<bigint, OverworldGenerator>();
const LOCATE_ALIASES: Record<string, string> = {
  buried_treasure: 'buried_treasure', desert_pyramid: 'desert_pyramid', igloo: 'igloo',
  jungle_pyramid: 'jungle_pyramid', mansion: 'mansion', mineshaft: 'mineshaft', monument: 'monument', ocean_ruin: 'ocean_ruin',
  pillager_outpost: 'pillager_outpost', ruined_portal: 'ruined_portal', shipwreck: 'shipwreck', stronghold: 'stronghold',
  swamp_hut: 'swamp_hut', village: 'village',
};

/** Structure ids /locate can find in the overworld. */
export const LOCATABLE_STRUCTURES = Object.keys(LOCATE_ALIASES);

/**
 * /locate (StructureFeature.getNearestGeneratedFeature, search radius 100 regions; strongholds:
 * the nearest ring position): the block position of the nearest start of `type` from (x, z), or
 * null. `type` is the 1.17.1 structure id (village, desert_pyramid, …, with or without minecraft:).
 */
export function locateStructure(seedOrGen: bigint | OverworldGenerator, type: string, x: number, z: number, radius = 100): { x: number; z: number } | null {
  let gen: OverworldGenerator;
  if (typeof seedOrGen === 'bigint') {
    gen = genCache.get(seedOrGen) ?? new OverworldGenerator(seedOrGen);
    genCache.set(seedOrGen, gen);
  } else gen = seedOrGen;
  const name = LOCATE_ALIASES[type.replace(/^minecraft:/, '').toLowerCase()];
  const def = name ? FEATURES[name] : undefined;
  if (!def || !name) return null;
  const cx = x >> 4, cz = z >> 4;
  if (name === 'stronghold') {
    let best: [number, number] | null = null, bd = Infinity;
    for (const [sx, sz] of strongholdPositions(gen)) {
      const s = structureStart(gen, name, sx, sz);
      if (!s) continue;
      const d = (sx - cx) ** 2 + (sz - cz) ** 2;
      if (d < bd) {
        bd = d;
        best = [sx, sz];
      }
    }
    return best ? { x: (best[0] << 4) + 4, z: (best[1] << 4) + 4 } : null;
  }
  const sp = def.spacing;
  for (let l = 0; l <= radius; l++)
    for (let m = -l; m <= l; m++) {
      const edgeM = m === -l || m === l;
      for (let n = -l; n <= l; n++) {
        if (!edgeM && n !== -l && n !== l) continue;
        const [px, pz] = potentialChunk(def, gen.seed, cx + sp * m, cz + sp * n);
        if (validStart(gen.quartBiome((px << 2) + 2, (pz << 2) + 2), name)) {
          const s = structureStart(gen, name, px, pz);
          if (s) return { x: px << 4, z: pz << 4 };
        }
        if (l === 0) break;
      }
      if (l === 0) break;
    }
  return null;
}
