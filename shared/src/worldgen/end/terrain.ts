/**
 * 1.17.1 End terrain shape: NoiseBasedChunkGenerator with the "end" noise settings (height 128,
 * size_horizontal 2 → 8-block cells, size_vertical 1 → 4-block cells, sampling xz_scale 2 /
 * y_scale 1 / xz_factor 80 / y_factor 160, density factor/offset 0, top slide (-3000, 64, -46),
 * bottom slide (-30, 7, 1), island_noise_override). With the island override fillNoiseColumn uses
 * depth = getHeightValue(x, z) - 8 and scale 0.25 (positive) / 1 (negative); with density factor
 * and offset 0 the initial density is (depth · scale) × 4 when positive, i.e. exactly depth - 8
 * either way. The blended 3D noise is the same BlendedNoise the overworld and Nether use, seeded
 * from WorldgenRandom(seed) — kept as its own class so neither of those can change.
 */
import { JavaRandom } from '../../util/random';
import { PerlinNoise, wrap, type SimplexNoise } from '../../util/noise';
import { endHeightValue, endIslandNoise } from './biomesource';

export const END_NOISE_HEIGHT = 128;
const CELL_W = 8, CELL_H = 4, CELLS_Y = END_NOISE_HEIGHT / CELL_H;
const XZ_SCALE = 684.412 * 2, Y_SCALE = 684.412 * 1;
const XZ_STEP = XZ_SCALE / 80, Y_STEP = Y_SCALE / 160;
const TOP_SLIDE = { target: -3000, size: 64, offset: -46 };
const BOTTOM_SLIDE = { target: -30, size: 7, offset: 1 };

function clampedLerp(a: number, b: number, t: number): number {
  return t < 0 ? a : t > 1 ? b : a + t * (b - a);
}

export class EndTerrain {
  private readonly minLimit: PerlinNoise;
  private readonly maxLimit: PerlinNoise;
  private readonly main: PerlinNoise;
  readonly islandNoise: SimplexNoise;
  private readonly columns = new Map<number, Float64Array>();

  constructor(seed: bigint) {
    const r = new JavaRandom(seed);
    const oct = (lo: number) => new PerlinNoise(r, lo, new Array(1 - lo).fill(1));
    this.minLimit = oct(-15);
    this.maxLimit = oct(-15);
    this.main = oct(-7);
    this.islandNoise = endIslandNoise(seed);
  }

  /** BlendedNoise.sampleAndClampNoise at a cell corner. */
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

  /** fillNoiseColumn for the cell column at cell (x, z) (8-block cells): 33 values, cached. */
  column(x: number, z: number): Float64Array {
    const key = (x & 0xffff) * 65536 + (z & 0xffff);
    let col = this.columns.get(key);
    if (col) return col;
    col = new Float64Array(CELLS_Y + 1);
    const depth = endHeightValue(this.islandNoise, x, z) - 8;
    const scale = depth > 0 ? 0.25 : 1;
    for (let y = 0; y <= CELLS_Y; y++) {
      let d = this.sample(x, y, z);
      const fall = depth * scale;
      d = fall > 0 ? d + fall * 4 : d + fall;
      d = clampedLerp(TOP_SLIDE.target, d, (CELLS_Y - y - TOP_SLIDE.offset) / TOP_SLIDE.size);
      d = clampedLerp(BOTTOM_SLIDE.target, d, (y - BOTTOM_SLIDE.offset) / BOTTOM_SLIDE.size);
      col[y] = d;
    }
    if (this.columns.size > 4096) this.columns.clear();
    this.columns.set(key, col);
    return col;
  }

  /** Density for y 0–127 of a chunk (index (y << 8) | (z << 4) | x), interpolated y → x → z. */
  fillChunk(cx: number, cz: number, out: Float64Array): void {
    const cols: Float64Array[] = [];
    for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) cols[i * 3 + j] = this.column(cx * 2 + i, cz * 2 + j);
    for (let ci = 0; ci < 2; ci++)
      for (let cj = 0; cj < 2; cj++) {
        const c00 = cols[ci * 3 + cj]!, c01 = cols[ci * 3 + cj + 1]!, c10 = cols[(ci + 1) * 3 + cj]!, c11 = cols[(ci + 1) * 3 + cj + 1]!;
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
                out[(y << 8) | ((cj * CELL_W + pz) << 4) | (ci * CELL_W + px)] = d14 + tz * (d15 - d14);
              }
            }
          }
        }
      }
  }
}
