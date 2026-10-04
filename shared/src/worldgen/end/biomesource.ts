/**
 * The 1.17.1 End biome source (TheEndBiomeSource): a SimplexNoise "island noise" seeded with
 * WorldgenRandom(seed) after consumeCount(17292). Within 64 chunks of the origin the biome is
 * the_end; elsewhere getHeightValue at the chunk's centre picks end_highlands (> 40),
 * end_midlands (≥ 0), small_end_islands (< -20) or end_barrens.
 */
import { JavaRandom } from '../../util/random';
import { SimplexNoise } from '../../util/noise';
import { B } from '../biome/biomeids';

const f = Math.fround;
const clampF = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The End's island noise (shared by the biome source and the noise generator). */
export function endIslandNoise(seed: bigint): SimplexNoise {
  const r = new JavaRandom(seed);
  r.skip(17292);
  return new SimplexNoise(r);
}

/** Java int division (truncating toward zero). */
const idiv = (a: number, b: number) => Math.trunc(a / b);

/**
 * TheEndBiomeSource.getHeightValue(noise, x, z) in half-chunk (8-block cell) coordinates: the
 * main island's falloff plus every outer island (simplex value < -0.9 at chunk positions beyond 64
 * chunks) within 12 chunks, in float arithmetic like vanilla.
 */
export function endHeightValue(noise: SimplexNoise, x: number, z: number): number {
  const i = idiv(x, 2), j = idiv(z, 2);
  const k = x % 2, l = z % 2;
  let h = f(100 - f(f(Math.sqrt(f(Math.imul(x, x) + Math.imul(z, z)))) * 8));
  h = clampF(h, -100, 80);
  for (let i1 = -12; i1 <= 12; i1++)
    for (let j1 = -12; j1 <= 12; j1++) {
      const k1 = i + i1, l1 = j + j1;
      if (k1 * k1 + l1 * l1 > 4096 && noise.getValue(k1, l1) < f(-0.9)) {
        const f1 = f(f(f(f(Math.abs(k1)) * 3439) + f(f(Math.abs(l1)) * 147)) % 13) + 9;
        const f2 = k - i1 * 2, f3 = l - j1 * 2;
        let f4 = f(100 - f(f(Math.sqrt(f(f(f2 * f2) + f(f3 * f3)))) * f(f1)));
        f4 = clampF(f4, -100, 80);
        if (f4 > h) h = f4;
      }
    }
  return h;
}

export class EndBiomeSource {
  readonly islandNoise: SimplexNoise;
  private readonly cache = new Map<number, number>();

  constructor(seed: bigint) {
    this.islandNoise = endIslandNoise(seed);
  }

  /** getNoiseBiome(qx, qy, qz): the End ignores y. */
  getNoiseBiome(qx: number, qz: number): number {
    const i = qx >> 2, j = qz >> 2;
    if (i * i + j * j <= 4096) return B.the_end;
    const key = (i & 0xffff) * 65536 + (j & 0xffff);
    let b = this.cache.get(key);
    if (b !== undefined) return b;
    const h = endHeightValue(this.islandNoise, i * 2 + 1, j * 2 + 1);
    b = h > 40 ? B.end_highlands : h >= 0 ? B.end_midlands : h < -20 ? B.small_end_islands : B.end_barrens;
    if (this.cache.size > 16384) this.cache.clear();
    this.cache.set(key, b);
    return b;
  }
}
