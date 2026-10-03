/** Weather helpers shared by client rendering and server logic. */
import { BIOMES } from '../data';
import type { BlockWorld } from './world';

/**
 * Biome temperature at a height (vanilla Biome.getTemperature; the small per-column noise
 * term above y=64 is left out).
 */
export function temperatureAt(biomeId: number, y: number): number {
  const b = BIOMES[biomeId];
  if (!b) return 0.8;
  let t = b.temperature;
  if (y > 64) t -= ((y - 64) * 0.05) / 30;
  return t;
}

/** Level.isRainingAt: raining, open to the sky, and a biome warm enough for rain. */
export function isRainingAt(world: BlockWorld, raining: boolean, x: number, y: number, z: number): boolean {
  if (!raining) return false;
  const chunk = world.getChunk(x >> 4, z >> 4);
  if (!chunk) return false;
  if (chunk.motionBlocking[(z & 15) * 16 + (x & 15)]! > y) return false;
  const biome = world.getBiome(x, y, z);
  const b = BIOMES[biome];
  return !!b && b.precipitation !== 'none' && temperatureAt(biome, y) >= 0.15;
}
