/**
 * World-generation seeding (vanilla WorldgenRandom): every chunk-level random sequence is derived
 * from the world seed and coordinates with these formulas, so a seed always gives the same world.
 * Formulas cross-checked with SeedFinding's ChunkRand (MIT, see licenses/SeedFinding.txt).
 */
import { JavaRandom } from '../util/random';

const i64 = (v: bigint) => BigInt.asIntN(64, v);

/** WorldgenRandom.setBaseChunkSeed: terrain-shape randomness (bedrock, surface depth). */
export function terrainSeed(chunkX: number, chunkZ: number): bigint {
  return i64(BigInt(chunkX) * 341873128712n + BigInt(chunkZ) * 132897987541n);
}

/** The two odd multipliers WorldgenRandom derives from the world seed. */
const multipliers = new Map<bigint, [bigint, bigint]>();
function seedMultipliers(worldSeed: bigint): [bigint, bigint] {
  let m = multipliers.get(worldSeed);
  if (!m) {
    const r = new JavaRandom(worldSeed);
    m = [r.nextLong() | 1n, r.nextLong() | 1n];
    multipliers.set(worldSeed, m);
  }
  return m;
}

/** WorldgenRandom.setDecorationSeed (1.13+): per-chunk population seed from the chunk's min block x/z. */
export function decorationSeed(worldSeed: bigint, blockX: number, blockZ: number): bigint {
  const [a, b] = seedMultipliers(worldSeed);
  return i64((BigInt(blockX) * a + BigInt(blockZ) * b) ^ worldSeed);
}

/** WorldgenRandom.setFeatureSeed: one feature of a decoration step. */
export function featureSeed(decoration: bigint, index: number, step: number): bigint {
  return i64(decoration + BigInt(index) + 10000n * BigInt(step));
}

/** WorldgenRandom.setLargeFeatureSeed: carvers and structure starts (seed + carver index for carvers). */
export function largeFeatureSeed(worldSeed: bigint, chunkX: number, chunkZ: number): bigint {
  const [a, b] = seedMultipliers(worldSeed);
  return i64((BigInt(chunkX) * a) ^ (BigInt(chunkZ) * b) ^ worldSeed);
}

/** WorldgenRandom.setLargeFeatureWithSalt: structure region placement. */
export function regionSeed(worldSeed: bigint, regionX: number, regionZ: number, salt: number): bigint {
  return i64(BigInt(regionX) * 341873128712n + BigInt(regionZ) * 132897987541n + worldSeed + BigInt(salt));
}

/** A JavaRandom seeded with one of the above. */
export function seeded(seed: bigint): JavaRandom {
  return new JavaRandom(seed);
}
