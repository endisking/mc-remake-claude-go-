/**
 * Gradient noise in the style the 1.17-era world generator is built on:
 * "improved" Perlin noise with a seeded permutation and random offsets, stacked
 * into octaves. The algorithm is Ken Perlin's public improved-noise reference.
 */
import { JavaRandom } from './random';

const GRAD = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
] as const;

function gradDot(hash: number, x: number, y: number, z: number): number {
  const g = GRAD[hash & 15]!;
  return g[0] * x + g[1] * y + g[2] * z;
}

function smoothstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

export class ImprovedNoise {
  readonly xo: number;
  readonly yo: number;
  readonly zo: number;
  private readonly p = new Uint8Array(512);

  constructor(random: JavaRandom) {
    this.xo = random.nextDouble() * 256;
    this.yo = random.nextDouble() * 256;
    this.zo = random.nextDouble() * 256;
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) {
      const j = random.nextInt(256 - i);
      const t = p[i]!;
      p[i] = p[i + j]!;
      p[i + j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255]!;
  }

  private perm(i: number): number {
    return this.p[i & 255]!;
  }

  /** 3D noise in roughly [-1, 1]. yScale/yMax implement the vertical "fudge" used for terrain. */
  noise(x: number, y: number, z: number, yScale = 0, yMax = 0): number {
    const dx = x + this.xo, dy = y + this.yo, dz = z + this.zo;
    const ix = Math.floor(dx), iy = Math.floor(dy), iz = Math.floor(dz);
    const fx = dx - ix, fy = dy - iy, fz = dz - iz;
    let fyAdj = fy;
    if (yScale !== 0) {
      const t = yMax >= 0 && yMax < fy ? yMax : fy;
      // (1.0E-7F: the float literal vanilla adds)
      fyAdj = fy - Math.floor(t / yScale + 1.0000000116860974e-7) * yScale;
    }
    return this.sampleAndLerp(ix, iy, iz, fx, fyAdj, fz, fy);
  }

  private sampleAndLerp(ix: number, iy: number, iz: number, fx: number, fy: number, fz: number, fyOrig: number): number {
    const a = this.perm(ix), b = this.perm(ix + 1);
    const aa = this.perm(a + iy), ab = this.perm(a + iy + 1);
    const ba = this.perm(b + iy), bb = this.perm(b + iy + 1);
    const g000 = gradDot(this.perm(aa + iz), fx, fy, fz);
    const g100 = gradDot(this.perm(ba + iz), fx - 1, fy, fz);
    const g010 = gradDot(this.perm(ab + iz), fx, fy - 1, fz);
    const g110 = gradDot(this.perm(bb + iz), fx - 1, fy - 1, fz);
    const g001 = gradDot(this.perm(aa + iz + 1), fx, fy, fz - 1);
    const g101 = gradDot(this.perm(ba + iz + 1), fx - 1, fy, fz - 1);
    const g011 = gradDot(this.perm(ab + iz + 1), fx, fy - 1, fz - 1);
    const g111 = gradDot(this.perm(bb + iz + 1), fx - 1, fy - 1, fz - 1);
    const u = smoothstep(fx), v = smoothstep(fyOrig), w = smoothstep(fz);
    return lerp(
      w,
      lerp(v, lerp(u, g000, g100), lerp(u, g010, g110)),
      lerp(v, lerp(u, g001, g101), lerp(u, g011, g111)),
    );
  }
}

/** Wraps large coordinates to keep precision (same constant the 1.17 generator uses). */
export function wrap(v: number): number {
  return v - Math.floor(v / 33554432 + 0.5) * 33554432;
}

/**
 * Octave Perlin noise. `octaves` lists octave indices relative to the first (e.g. -7..0);
 * lower octaves have larger features.
 */
export class PerlinNoise {
  private readonly levels: (ImprovedNoise | null)[] = [];
  private readonly amplitudes: number[] = [];
  private readonly lowestFreqInputFactor: number;
  private readonly lowestFreqValueFactor: number;

  constructor(random: JavaRandom, firstOctave: number, amplitudes: number[]) {
    const n = amplitudes.length;
    this.amplitudes = amplitudes;
    const zeroOctaveIndex = -firstOctave;
    // build levels from the highest octave down, consuming randomness like the reference
    const levels: (ImprovedNoise | null)[] = new Array(n).fill(null);
    const base = new ImprovedNoise(random);
    if (zeroOctaveIndex >= 0 && zeroOctaveIndex < n && amplitudes[zeroOctaveIndex] !== 0) levels[zeroOctaveIndex] = base;
    for (let i = zeroOctaveIndex - 1; i >= 0; i--) {
      if (i < n && amplitudes[i] !== 0) levels[i] = new ImprovedNoise(random);
      else random.skip(262);
    }
    this.levels = levels;
    this.lowestFreqInputFactor = Math.pow(2, -zeroOctaveIndex);
    this.lowestFreqValueFactor = Math.pow(2, n - 1) / (Math.pow(2, n) - 1);
  }

  noise(x: number, y: number, z: number, yScale = 0, yMax = 0, useFixedY = false): number {
    let total = 0;
    let inputFactor = this.lowestFreqInputFactor;
    let valueFactor = this.lowestFreqValueFactor;
    for (let i = 0; i < this.levels.length; i++) {
      const lvl = this.levels[i];
      if (lvl) {
        total +=
          this.amplitudes[i]! *
          lvl.noise(
            wrap(x * inputFactor),
            useFixedY ? -lvl.yo : wrap(y * inputFactor),
            wrap(z * inputFactor),
            yScale * inputFactor,
            yMax * inputFactor,
          ) *
          valueFactor;
      }
      inputFactor *= 2;
      valueFactor /= 2;
    }
    return total;
  }

  /** PerlinNoise.getOctaveNoise(i): octave i counted from the highest frequency (octave 0). */
  getOctaveNoise(i: number): ImprovedNoise | null {
    return this.levels[this.levels.length - 1 - i] ?? null;
  }

  /** Convenience: octaves -n+1..0 with amplitude 1 each. */
  static simple(random: JavaRandom, octaves: number): PerlinNoise {
    return new PerlinNoise(random, -(octaves - 1), new Array(octaves).fill(1));
  }
}

/** 2D simplex noise (used by the End island and surface noise in the 1.17 generator). */
export class SimplexNoise {
  private readonly p = new Int32Array(512);
  readonly xo: number;
  readonly yo: number;
  readonly zo: number;
  private static readonly F2 = 0.5 * (Math.sqrt(3) - 1);
  private static readonly G2 = (3 - Math.sqrt(3)) / 6;

  constructor(random: JavaRandom) {
    this.xo = random.nextDouble() * 256;
    this.yo = random.nextDouble() * 256;
    this.zo = random.nextDouble() * 256;
    for (let i = 0; i < 256; i++) this.p[i] = i;
    for (let i = 0; i < 256; i++) {
      const j = random.nextInt(256 - i);
      const t = this.p[i]!;
      this.p[i] = this.p[j + i]!;
      this.p[j + i] = t;
    }
  }

  private perm(i: number): number {
    return this.p[i & 255]!;
  }

  private corner(g: number, x: number, y: number, z: number, off: number): number {
    let t = off - x * x - y * y - z * z;
    if (t < 0) return 0;
    t *= t;
    return t * t * gradDot(g % 12, x, y, z);
  }

  getValue(x: number, y: number): number {
    const s = (x + y) * SimplexNoise.F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * SimplexNoise.G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1];
    const x1 = x0 - i1 + SimplexNoise.G2, y1 = y0 - j1 + SimplexNoise.G2;
    const x2 = x0 - 1 + 2 * SimplexNoise.G2, y2 = y0 - 1 + 2 * SimplexNoise.G2;
    const ii = i & 255, jj = j & 255;
    const g0 = this.perm(ii + this.perm(jj)) % 12;
    const g1 = this.perm(ii + i1 + this.perm(jj + j1)) % 12;
    const g2 = this.perm(ii + 1 + this.perm(jj + 1)) % 12;
    return 70 * (this.corner(g0, x0, y0, 0, 0.5) + this.corner(g1, x1, y1, 0, 0.5) + this.corner(g2, x2, y2, 0, 0.5));
  }
}

/**
 * Octaves of 2D simplex noise (vanilla PerlinSimplexNoise, the surface-depth noise): octave 0 is
 * built first, then lower octaves; the highest frequency comes first in the sum.
 */
export class PerlinSimplexNoise {
  private readonly levels: (SimplexNoise | null)[];
  private readonly highestFreqInputFactor: number;
  private readonly highestFreqValueFactor: number;

  constructor(random: JavaRandom, octaves: number[]) {
    const sorted = [...octaves].sort((a, b) => a - b);
    const first = -sorted[0]!, last = sorted[sorted.length - 1]!;
    const n = first + last + 1;
    const has = new Set(sorted);
    const base = new SimplexNoise(random);
    this.levels = new Array(n).fill(null);
    if (last >= 0 && last < n && has.has(0)) this.levels[last] = base;
    for (let i = last + 1; i < n; i++) {
      if (i >= 0 && has.has(last - i)) this.levels[i] = new SimplexNoise(random);
      else random.skip(262);
    }
    if (last > 0) throw new Error('positive simplex octaves are not used by 1.17.1 generation');
    this.highestFreqInputFactor = Math.pow(2, last);
    this.highestFreqValueFactor = 1 / (Math.pow(2, n) - 1);
  }

  getValue(x: number, y: number, useOffsets: boolean): number {
    let total = 0, input = this.highestFreqInputFactor, value = this.highestFreqValueFactor;
    for (const s of this.levels) {
      if (s) total += s.getValue(x * input + (useOffsets ? s.xo : 0), y * input + (useOffsets ? s.yo : 0)) * value;
      input /= 2;
      value *= 2;
    }
    return total;
  }

  /** SurfaceNoise.getSurfaceNoiseValue (PerlinSimplexNoise implements it as getValue(x, y, true) × 0.55). */
  getSurfaceNoiseValue(x: number, y: number): number {
    return this.getValue(x, y, true) * 0.55;
  }
}
