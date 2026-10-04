/**
 * The 1.17.1 Nether biome source: MultiNoiseBiomeSource with the "nether" preset. Four NormalNoise
 * climate fields (temperature, humidity, altitude, weirdness; first octave -7, amplitudes [1, 1],
 * seeded with seed, seed+1, seed+2, seed+3) are sampled at quart coordinates (y = 0, the preset
 * doesn't use y) and the biome whose parameter point has the lowest Biome.ClimateParameters.fitness
 * (squared float distance, including the offset term) wins; ties go to the earlier biome.
 */
import { JavaRandom } from '../../util/random';
import { NormalNoise } from '../features/underground';
import { B } from '../biome/biomeids';

const f = Math.fround;

/** [biome, temperature, humidity, altitude, weirdness, offset] in preset order. */
export const NETHER_BIOME_POINTS: readonly (readonly [number, number, number, number, number, number])[] = [
  [B.nether_wastes, 0, 0, 0, 0, 0],
  [B.soul_sand_valley, 0, -0.5, 0, 0, 0],
  [B.crimson_forest, 0.4, 0, 0, 0, 0],
  [B.warped_forest, 0, 0.5, 0, 0, 0.375],
  [B.basalt_deltas, -0.5, 0, 0, 0, 0.175],
];

/** Biome.ClimateParameters.fitness in float arithmetic. */
export function climateFitness(t: number, h: number, a: number, w: number, p: readonly number[]): number {
  const dt = f(f(p[1]!) - t), dh = f(f(p[2]!) - h), da = f(f(p[3]!) - a), dw = f(f(p[4]!) - w), dofs = f(p[5]!);
  return f(f(f(f(f(dt * dt) + f(dh * dh)) + f(da * da)) + f(dw * dw)) + f(dofs * dofs));
}

/** Pick the nearest parameter point (Stream.min keeps the first of equal minima). */
export function pickNetherBiome(t: number, h: number, a: number, w: number): number {
  let best = NETHER_BIOME_POINTS[0]![0], bestFit = Infinity;
  for (const p of NETHER_BIOME_POINTS) {
    const fit = climateFitness(t, h, a, w, p);
    if (fit < bestFit) {
      bestFit = fit;
      best = p[0];
    }
  }
  return best;
}

export class NetherBiomeSource {
  private readonly temperature: NormalNoise;
  private readonly humidity: NormalNoise;
  private readonly altitude: NormalNoise;
  private readonly weirdness: NormalNoise;
  private readonly cache = new Map<number, number>();

  constructor(seed: bigint) {
    const mk = (s: bigint) => new NormalNoise(new JavaRandom(BigInt.asIntN(64, s)), -7, [1, 1]);
    this.temperature = mk(seed);
    this.humidity = mk(seed + 1n);
    this.altitude = mk(seed + 2n);
    this.weirdness = mk(seed + 3n);
  }

  /** getNoiseBiome(qx, qy, qz) — the nether preset ignores y. */
  getNoiseBiome(qx: number, qz: number): number {
    const key = (qx & 0xffff) * 65536 + (qz & 0xffff);
    let b = this.cache.get(key);
    if (b !== undefined) return b;
    b = pickNetherBiome(
      f(this.temperature.getValue(qx, 0, qz)),
      f(this.humidity.getValue(qx, 0, qz)),
      f(this.altitude.getValue(qx, 0, qz)),
      f(this.weirdness.getValue(qx, 0, qz)),
    );
    if (this.cache.size > 65536) this.cache.clear();
    this.cache.set(key, b);
    return b;
  }
}
