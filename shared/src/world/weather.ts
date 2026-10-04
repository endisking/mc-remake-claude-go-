/** Weather helpers shared by client rendering and server logic. */
import { BIOMES } from '../data';
import type { BlockWorld } from './world';

import { getTemperature } from './climate';

/** Level.isRainingAt: raining, open to the sky, and a biome warm enough for rain. */
export function isRainingAt(world: BlockWorld, raining: boolean, x: number, y: number, z: number): boolean {
  if (!raining) return false;
  const chunk = world.getChunk(x >> 4, z >> 4);
  if (!chunk) return false;
  if (chunk.motionBlocking[(z & 15) * 16 + (x & 15)]! > y) return false;
  const biome = world.getBiome(x, y, z);
  const b = BIOMES[biome];
  return !!b && b.precipitation !== 'none' && getTemperature(biome, x, y, z) >= 0.15;
}
