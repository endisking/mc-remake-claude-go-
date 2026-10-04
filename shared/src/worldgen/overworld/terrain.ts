/**
 * 1.16/1.17 overworld terrain shape (vanilla NoiseBasedChunkGenerator with the "overworld" noise
 * settings): a 3D density from blended min/max/main Perlin octaves, offset by each column's
 * biome-weighted depth and scale and a random density term, sampled on a 4×8×4 cell grid and
 * trilinearly interpolated. Settings from the 1.17.1 overworld noise_settings. Positive density is stone, otherwise water below sea level.
 * Cross-checked with SeedFinding mc_terrain_java (MIT, licenses/SeedFinding.txt).
 */
import { JavaRandom } from '../../util/random';
import { PerlinNoise, PerlinSimplexNoise, wrap } from '../../util/noise';
import type { Layer } from '../biome/layers';
import { BIOME_GEN } from '../biome/biomegen';

const f = Math.fround;

export const SEA_LEVEL = 63;
const CELL_W = 4, CELL_H = 8, CELLS_Y = 32;
const XZ_SCALE = 684.412 * 0.9999999814507745, Y_SCALE = 684.412 * 0.9999999814507745;
const XZ_STEP = XZ_SCALE / 80, Y_STEP = Y_SCALE / 160;
const DENSITY_FACTOR = 1, DENSITY_OFFSET = -0.46875;
const TOP_SLIDE = { target: -10, size: 3, offset: 0 };
/** 1.17.1 overworld (1.16 had size 0): the bottom three cells blend toward solid */
const BOTTOM_SLIDE = { target: 15, size: 3, offset: 0 };

/** NoiseBasedChunkGenerator.BIOME_WEIGHTS (float) */
const BIOME_WEIGHTS = new Float32Array(25);
for (let i = -2; i <= 2; i++)
  for (let j = -2; j <= 2; j++) BIOME_WEIGHTS[i + 2 + (j + 2) * 5] = f(10 / f(Math.sqrt(f(f(i * i + j * j) + f(0.2)))));

function clampedLerp(a: number, b: number, t: number): number {
  return t < 0 ? a : t > 1 ? b : a + t * (b - a);
}

export class TerrainNoise {
  private readonly minLimit: PerlinNoise;
  private readonly maxLimit: PerlinNoise;
  private readonly main: PerlinNoise;
  /** surface depth noise for the surface builders */
  readonly surfaceNoise: PerlinSimplexNoise;
  private readonly depthNoise: PerlinNoise;
  private readonly columns = new Map<number, Float64Array>();

  constructor(seed: bigint, private readonly biomes: Layer, private readonly amplified = false) {
    // NoiseBasedChunkGenerator constructor order (WorldgenRandom(seed))
    const r = new JavaRandom(seed);
    const oct = (lo: number) => new PerlinNoise(r, lo, new Array(1 - lo).fill(1));
    this.minLimit = oct(-15);
    this.maxLimit = oct(-15);
    this.main = oct(-7);
    this.surfaceNoise = new PerlinSimplexNoise(r, [-3, -2, -1, 0]);
    r.skip(2620);
    this.depthNoise = oct(-15);
  }

  /** sampleAndClampNoise: the blended 3D noise at a cell corner. */
  private sample(x: number, y: number, z: number): number {
    let lo = 0, hi = 0, mid = 0, d3 = 1;
    for (let i = 0; i < 16; i++) {
      const sx = wrap(x * XZ_SCALE * d3), sy = wrap(y * Y_SCALE * d3), sz = wrap(z * XZ_SCALE * d3);
      const ys = Y_SCALE * d3;
      const a = this.minLimit.getOctaveNoise(i);
      if (a) lo += a.noise(sx, sy, sz, ys, y * ys) / d3;
      const b = this.maxLimit.getOctaveNoise(i);
      if (b) hi += b.noise(sx, sy, sz, ys, y * ys) / d3;
      if (i < 8) {
        const c = this.main.getOctaveNoise(i);
        if (c) mid += c.noise(wrap(x * XZ_STEP * d3), wrap(y * Y_STEP * d3), wrap(z * XZ_STEP * d3), Y_STEP * d3, y * Y_STEP * d3) / d3;
      }
      d3 /= 2;
    }
    return clampedLerp(lo / 512, hi / 512, (mid / 10 + 1) / 2);
  }

  /** getRandomDensity */
  private randomDensity(x: number, z: number): number {
    const d0 = this.depthNoise.noise(x * 200, 10, z * 200, 1, 0, true);
    const d1 = d0 < 0 ? -d0 * 0.3 : d0;
    const d2 = d1 * 24.575625 - 2;
    return d2 < 0 ? d2 * 0.009486607142857142 : Math.min(d2, 1) * 0.006640625;
  }

  /** fillNoiseColumn for the cell column at (x, z) (quart coordinates); 33 values, cached. */
  column(x: number, z: number): Float64Array {
    const key = (x & 0xffff) * 65536 + (z & 0xffff);
    let col = this.columns.get(key);
    if (col) return col;
    col = new Float64Array(CELLS_Y + 1);
    let sumScale = 0, sumDepth = 0, sumW = 0;
    const center = f(BIOME_GEN[this.biomes.get(x, z)]?.depth ?? 0.1);
    for (let k = -2; k <= 2; k++)
      for (let l = -2; l <= 2; l++) {
        const g = BIOME_GEN[this.biomes.get(x + k, z + l)];
        const d4 = f(g?.depth ?? 0.1), s5 = f(g?.scale ?? 0.2);
        let d6 = d4, s7 = s5;
        if (this.amplified && d4 > 0) {
          d6 = f(1 + f(d4 * 2));
          s7 = f(1 + f(s5 * 4));
        }
        const w = f(f((d4 > center ? 0.5 : 1) * BIOME_WEIGHTS[k + 2 + (l + 2) * 5]!) / f(d6 + 2));
        sumScale = f(sumScale + f(s7 * w));
        sumDepth = f(sumDepth + f(d6 * w));
        sumW = f(sumW + w);
      }
    const depth = f(f(f(sumDepth / sumW) * 0.5) - 0.125) * 0.265625;
    const scale = 96 / f(f(f(sumScale / sumW) * f(0.9)) + f(0.1));
    const rnd = this.randomDensity(x, z);
    for (let y = 0; y <= CELLS_Y; y++) {
      let d = this.sample(x, y, z);
      const fall = ((1 - (y * 2) / CELLS_Y + rnd) * DENSITY_FACTOR + DENSITY_OFFSET + depth) * scale;
      d = fall > 0 ? d + fall * 4 : d + fall;
      d = clampedLerp(TOP_SLIDE.target, d, (CELLS_Y - y - TOP_SLIDE.offset) / TOP_SLIDE.size);
      d = clampedLerp(BOTTOM_SLIDE.target, d, (y - BOTTOM_SLIDE.offset) / BOTTOM_SLIDE.size);
      col[y] = d;
    }
    if (this.columns.size > 4096) this.columns.clear();
    this.columns.set(key, col);
    return col;
  }

  /**
   * NoiseBasedChunkGenerator.doFill: density for every block of a chunk (x fastest, then z, then y),
   * interpolated y → x → z like vanilla. `out` has 16×16×256 entries.
   */
  fillChunk(cx: number, cz: number, out: Float64Array): void {
    const cols: Float64Array[] = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) cols[i * 5 + j] = this.column(cx * 4 + i, cz * 4 + j);
    for (let ci = 0; ci < 4; ci++)
      for (let cj = 0; cj < 4; cj++) {
        const c00 = cols[ci * 5 + cj]!, c01 = cols[ci * 5 + cj + 1]!, c10 = cols[(ci + 1) * 5 + cj]!, c11 = cols[(ci + 1) * 5 + cj + 1]!;
        for (let cy = CELLS_Y - 1; cy >= 0; cy--) {
          const d0 = c00[cy]!, d1 = c01[cy]!, d2 = c10[cy]!, d3 = c11[cy]!;
          const d4 = c00[cy + 1]!, d5 = c01[cy + 1]!, d6 = c10[cy + 1]!, d7 = c11[cy + 1]!;
          for (let py = CELL_H - 1; py >= 0; py--) {
            const ty = py / CELL_H;
            const d9 = d0 + ty * (d4 - d0), d10 = d2 + ty * (d6 - d2), d11 = d1 + ty * (d5 - d1), d12 = d3 + ty * (d7 - d3);
            const y = cy * CELL_H + py;
            for (let px = 0; px < CELL_W; px++) {
              const tx = px / CELL_W;
              const d14 = d9 + tx * (d10 - d9), d15 = d11 + tx * (d12 - d11);
              for (let pz = 0; pz < CELL_W; pz++) {
                const tz = pz / CELL_W;
                out[(y << 8) | ((cj * 4 + pz) << 4) | (ci * 4 + px)] = d14 + tz * (d15 - d14);
              }
            }
          }
        }
      }
  }
}
