/**
 * Chunk decoration (vanilla ChunkGenerator.applyBiomeDecoration → Biome.generate): the chunk's
 * primary biome lists features per GenerationStep.Decoration; each feature runs with
 * setFeatureSeed(decorationSeed, index, step) and may write into the 8 neighbouring chunks.
 */
import { JavaRandom } from '../../util/random';
import { stateOf, blockNameOf, getProp, withProp } from '../../world/blockstate';
import type { BlockWorld } from '../../world/world';
import { getTemperature } from '../../world/climate';
import { canSurvive } from '../../game/support';
import { decorationSeed, featureSeed } from '../rand';
import type { OverworldGenerator } from './generator';

/** GenerationStep.Decoration */
export const STEP = {
  RAW_GENERATION: 0, LAKES: 1, LOCAL_MODIFICATIONS: 2, UNDERGROUND_STRUCTURES: 3, SURFACE_STRUCTURES: 4,
  STRONGHOLDS: 5, UNDERGROUND_ORES: 6, UNDERGROUND_DECORATION: 7, VEGETAL_DECORATION: 8, TOP_LAYER_MODIFICATION: 9,
} as const;

/** What a feature sees: the decoration region, the generator, its random and origin (chunk min corner). */
export interface FeatureContext {
  world: BlockWorld;
  gen: OverworldGenerator;
  rand: JavaRandom;
  x: number;
  z: number;
}

export type Feature = (ctx: FeatureContext) => void;

const ICE = stateOf('ice');
const SNOW = stateOf('snow', { layers: 1 });

/** MOTION_BLOCKING height (first free y above the highest motion-blocking or fluid block). */
export function motionBlockingHeight(world: BlockWorld, x: number, z: number): number {
  const c = world.getChunk(x >> 4, z >> 4);
  return c ? c.motionBlocking[((z & 15) << 4) | (x & 15)]! : 0;
}

/** Biome.shouldFreeze (not at an edge): cold, still water source at the top. Block light is 0 during generation. */
function shouldFreeze(world: BlockWorld, biome: number, x: number, y: number, z: number): boolean {
  if (getTemperature(biome, x, y, z) >= 0.15 || y < 0 || y >= 256) return false;
  const st = world.getState(x, y, z);
  return blockNameOf(st) === 'water' && getProp(st, 'level') === 0;
}

/** Biome.shouldSnow: cold, air, and snow could stand here. */
function shouldSnow(world: BlockWorld, biome: number, x: number, y: number, z: number): boolean {
  if (getTemperature(biome, x, y, z) >= 0.15 || y < 0 || y >= 256) return false;
  return world.getState(x, y, z) === 0 && canSurvive(world, x, y, z, SNOW);
}

/** SnowAndFreezeFeature (freeze_top_layer): ice on cold water, a snow layer on cold ground. */
export const freezeTopLayer: Feature = ({ world, gen, x: ox, z: oz }) => {
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++) {
      const x = ox + i, z = oz + j;
      const y = motionBlockingHeight(world, x, z);
      const biome = gen.blockBiome(x, z);
      if (shouldFreeze(world, biome, x, y - 1, z)) world.setStateRaw(x, y - 1, z, ICE);
      if (shouldSnow(world, biome, x, y, z)) {
        world.setStateRaw(x, y, z, SNOW);
        const below = world.getState(x, y - 1, z);
        if (getProp(below, 'snowy') === false) world.setStateRaw(x, y - 1, z, withProp(below, 'snowy', true));
      }
    }
};

/** Features per decoration step for a biome (BiomeGenerationSettings.features). */
function biomeFeatures(_biome: number): Feature[][] {
  const steps: Feature[][] = Array.from({ length: 10 }, () => []);
  steps[STEP.TOP_LAYER_MODIFICATION]!.push(freezeTopLayer);
  return steps;
}

/** ChunkGenerator.applyBiomeDecoration for chunk (cx, cz). */
export function decorateChunk(gen: OverworldGenerator, world: BlockWorld, cx: number, cz: number): void {
  const x = cx << 4, z = cz << 4;
  // BiomeSource.getPrimaryBiome: the quart cell at the chunk centre
  const biome = gen.quartBiome((cx << 2) + 2, (cz << 2) + 2);
  const dec = decorationSeed(gen.seed, x, z);
  const steps = biomeFeatures(biome);
  steps.forEach((features, step) => {
    features.forEach((feature, index) => {
      const rand = new JavaRandom(featureSeed(dec, index, step));
      feature({ world, gen, rand, x, z });
    });
  });
}
