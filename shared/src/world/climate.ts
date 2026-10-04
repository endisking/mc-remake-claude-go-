/**
 * Biome temperature (vanilla Biome.getTemperature): the base temperature, the FROZEN modifier of
 * frozen oceans (patches warm up to 0.2), and the drop above y = 64 with a little per-column
 * noise. Float arithmetic like vanilla, since rain/snow and ice decisions compare against 0.15.
 */
import { BIOMES } from '../data';
import { JavaRandom } from '../util/random';
import { PerlinSimplexNoise } from '../util/noise';

const f = Math.fround;
export const TEMPERATURE_NOISE = new PerlinSimplexNoise(new JavaRandom(1234n), [0]);
export const FROZEN_TEMPERATURE_NOISE = new PerlinSimplexNoise(new JavaRandom(3456n), [-2, -1, 0]);
export const BIOME_INFO_NOISE = new PerlinSimplexNoise(new JavaRandom(2345n), [0]);

const FROZEN_OCEAN = 10, DEEP_FROZEN_OCEAN = 50;

export function baseTemperature(biome: number): number {
  return f(BIOMES[biome]?.temperature ?? 0.8);
}

/** Biome.getTemperature(pos) (getHeightAdjustedTemperature with the temperature modifier). */
export function getTemperature(biome: number, x: number, y: number, z: number): number {
  let t = baseTemperature(biome);
  if (biome === FROZEN_OCEAN || biome === DEEP_FROZEN_OCEAN) {
    const d0 = FROZEN_TEMPERATURE_NOISE.getValue(x * 0.05, z * 0.05, false) * 7;
    const d1 = BIOME_INFO_NOISE.getValue(x * 0.2, z * 0.2, false);
    if (d0 + d1 < 0.3 && BIOME_INFO_NOISE.getValue(x * 0.09, z * 0.09, false) < 0.8) t = f(0.2);
  }
  if (y > 64) {
    const n = f(TEMPERATURE_NOISE.getValue(f(x / 8), f(z / 8), false) * 4);
    const drop = f(f(f(f(n + y) - 64) * f(0.05)) / 30);
    return f(t - drop);
  }
  return t;
}
