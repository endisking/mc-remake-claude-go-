/**
 * Chunk decoration (vanilla 1.17.1 ChunkGenerator.applyBiomeDecoration → Biome.generate): the
 * chunk's primary biome lists configured features per GenerationStep.Decoration; each runs with
 * setFeatureSeed(decorationSeed, index, step) at the chunk's min corner and may write into the 8
 * neighbouring chunks. Every registered structure of a step takes an index before the features
 * (whether or not it starts here), so feature indices are offset by those counts.
 */
import { JavaRandom } from '../../util/random';
import type { BlockWorld } from '../../world/world';
import { decorationSeed, featureSeed } from '../rand';
import { WORLDGEN } from '../features/data';
import { configuredFeature, type Placer } from '../features/engine';
import { GenLevel } from '../features/level';
import { B } from '../biome/biomeids';
import type { OverworldGenerator } from './generator';

/** GenerationStep.Decoration */
export const STEP = {
  RAW_GENERATION: 0, LAKES: 1, LOCAL_MODIFICATIONS: 2, UNDERGROUND_STRUCTURES: 3, SURFACE_STRUCTURES: 4,
  STRONGHOLDS: 5, UNDERGROUND_ORES: 6, UNDERGROUND_DECORATION: 7, VEGETAL_DECORATION: 8, TOP_LAYER_MODIFICATION: 9,
} as const;

/**
 * Registered structure features per step (Registry.STRUCTURE_FEATURE grouped by step, 1.17.1):
 * underground — mineshaft, buried treasure; surface — the 13 surface structures; strongholds —
 * stronghold; underground decoration — nether fortress, fossil-free ones (nether fossil, ruined portal… per vanilla grouping).
 */
export const STRUCTURES_PER_STEP = [0, 0, 0, 2, 13, 1, 0, 2, 0, 0];

export const BIOME_NAMES: Record<number, string> = Object.fromEntries(Object.entries(B).map(([n, id]) => [id, n]));

const biomeLists = new Map<number, Placer[][]>();
/** BiomeGenerationSettings.features for a biome, compiled. */
export function biomeFeatures(biome: number): Placer[][] {
  let lists = biomeLists.get(biome);
  if (!lists) {
    const data = WORLDGEN.biomes[BIOME_NAMES[biome] ?? 'plains']!;
    lists = data.features.map((step) => step.map((fj) => configuredFeature(fj)));
    biomeLists.set(biome, lists);
  }
  return lists;
}

/** ChunkGenerator.applyBiomeDecoration for chunk (cx, cz). Returns the fluid ticks features scheduled (springs). */
export function decorateChunk(gen: OverworldGenerator, world: BlockWorld, cx: number, cz: number): [number, number, number][] {
  const x = cx << 4, z = cz << 4;
  // BiomeSource.getPrimaryBiome: the quart cell at the chunk centre
  const biome = gen.quartBiome((cx << 2) + 2, (cz << 2) + 2);
  const dec = decorationSeed(gen.seed, x, z);
  const level = new GenLevel(world, gen, cx, cz);
  biomeFeatures(biome).forEach((features, step) => {
    let index = STRUCTURES_PER_STEP[step] ?? 0;
    for (const place of features) {
      const rand = new JavaRandom(featureSeed(dec, index++, step));
      place(level, rand, x, 0, z);
    }
  });
  return level.fluidTicks;
}
