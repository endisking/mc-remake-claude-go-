/**
 * Surface builders (vanilla SurfaceBuilder subclasses, 1.16/1.17): turn the top stone of each
 * column into grass/dirt, sand/sandstone, gravel, podzol, coarse dirt, mycelium, badlands
 * terracotta bands with plateaus and hoodoos, swamp puddles and frozen-ocean icebergs.
 * Cross-checked with SeedFinding mc_biome_java (MIT, licenses/SeedFinding.txt).
 */
import { JavaRandom } from '../../util/random';
import { PerlinSimplexNoise } from '../../util/noise';
import { stateOf } from '../../world/blockstate';
import { getTemperature, BIOME_INFO_NOISE } from '../../world/climate';
import { BIOME_GEN } from '../biome/biomegen';

const S = {
  air: 0,
  stone: stateOf('stone'),
  water: stateOf('water', { level: 0 }),
  grass: stateOf('grass_block', { snowy: false }),
  dirt: stateOf('dirt'),
  coarse: stateOf('coarse_dirt'),
  podzol: stateOf('podzol', { snowy: false }),
  gravel: stateOf('gravel'),
  sand: stateOf('sand'),
  redSand: stateOf('red_sand'),
  sandstone: stateOf('sandstone'),
  redSandstone: stateOf('red_sandstone'),
  mycelium: stateOf('mycelium', { snowy: false }),
  snowBlock: stateOf('snow_block'),
  ice: stateOf('ice'),
  packedIce: stateOf('packed_ice'),
  terracotta: stateOf('terracotta'),
  white: stateOf('white_terracotta'),
  orange: stateOf('orange_terracotta'),
  yellow: stateOf('yellow_terracotta'),
  brown: stateOf('brown_terracotta'),
  red: stateOf('red_terracotta'),
  lightGray: stateOf('light_gray_terracotta'),
};
const TERRACOTTAS = new Set(['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => stateOf(`${c}_terracotta`)));

interface Config {
  top: number;
  under: number;
  underwater: number;
}
const C = {
  grass: { top: S.grass, under: S.dirt, underwater: S.gravel },
  stone: { top: S.stone, under: S.stone, underwater: S.gravel },
  coarse: { top: S.coarse, under: S.dirt, underwater: S.gravel },
  podzol: { top: S.podzol, under: S.dirt, underwater: S.gravel },
  gravel: { top: S.gravel, under: S.gravel, underwater: S.gravel },
  desert: { top: S.sand, under: S.sand, underwater: S.gravel },
  oceanSand: { top: S.grass, under: S.dirt, underwater: S.sand },
  fullSand: { top: S.sand, under: S.sand, underwater: S.sand },
  badlands: { top: S.redSand, under: S.white, underwater: S.gravel },
  mycelium: { top: S.mycelium, under: S.dirt, underwater: S.gravel },
  iceSpikes: { top: S.snowBlock, under: S.dirt, underwater: S.gravel },
} satisfies Record<string, Config>;

const SEA = 63;

/** A chunk's blocks during generation: index (y << 8) | (z << 4) | x. */
export type ProtoBlocks = Uint16Array;

export class SurfaceBuilders {
  private readonly clayBands: number[] = new Array(64).fill(S.terracotta);
  private readonly clayBandsOffset: PerlinSimplexNoise;
  private readonly pillarNoise: PerlinSimplexNoise;
  private readonly pillarRoofNoise: PerlinSimplexNoise;
  private readonly icebergNoise: PerlinSimplexNoise;
  private readonly icebergRoofNoise: PerlinSimplexNoise;

  constructor(seed: bigint) {
    // BadlandsSurfaceBuilder.generateBands
    const r = new JavaRandom(seed);
    this.clayBandsOffset = new PerlinSimplexNoise(r, [0]);
    const b = this.clayBands;
    for (let y = 0; y < 64; y++) {
      y += r.nextInt(5) + 1;
      if (y < 64) b[y] = S.orange;
    }
    const streaks = (color: number, minLen: number) => {
      const n = r.nextInt(4) + 2;
      for (let i = 0; i < n; i++) {
        const len = r.nextInt(3) + minLen, at = r.nextInt(64);
        for (let k = 0; at + k < 64 && k < len; k++) b[at + k] = color;
      }
    };
    streaks(S.yellow, 1);
    streaks(S.brown, 2);
    streaks(S.red, 1);
    const n = r.nextInt(3) + 3;
    let at = 0;
    for (let i = 0; i < n; i++) {
      at += r.nextInt(16) + 4;
      for (let k = 0; at + k < 64 && k < 1; k++) {
        b[at + k] = S.white;
        if (at + k > 1 && r.nextBoolean()) b[at + k - 1] = S.lightGray;
        if (at + k < 63 && r.nextBoolean()) b[at + k + 1] = S.lightGray;
      }
    }
    // ErodedBadlandsSurfaceBuilder.initNoise / FrozenOceanSurfaceBuilder.initNoise
    const r2 = new JavaRandom(seed);
    this.pillarNoise = new PerlinSimplexNoise(r2, [-3, -2, -1, 0]);
    this.pillarRoofNoise = new PerlinSimplexNoise(r2, [0]);
    const r3 = new JavaRandom(seed);
    this.icebergNoise = new PerlinSimplexNoise(r3, [-3, -2, -1, 0]);
    this.icebergRoofNoise = new PerlinSimplexNoise(r3, [0]);
  }

  private band(x: number, y: number, z: number): number {
    const i = Math.round(this.clayBandsOffset.getValue(x / 512, z / 512, false) * 2);
    return this.clayBands[(((y + i + 64) % 64) + 64) % 64]!;
  }

  /** Biome.buildSurfaceAt for one column (x, z world; startHeight = top non-air + 1). */
  build(biome: number, blocks: ProtoBlocks, rand: JavaRandom, x: number, z: number, startHeight: number, noise: number): void {
    const kind = BIOME_GEN[biome]?.surface ?? 'grass';
    switch (kind) {
      case 'grass': return this.normal(C.grass, biome, blocks, rand, x, z, startHeight, noise);
      case 'desert': return this.normal(C.desert, biome, blocks, rand, x, z, startHeight, noise);
      case 'ocean_sand': return this.normal(C.oceanSand, biome, blocks, rand, x, z, startHeight, noise);
      case 'full_sand': return this.normal(C.fullSand, biome, blocks, rand, x, z, startHeight, noise);
      case 'mycelium': return this.normal(C.mycelium, biome, blocks, rand, x, z, startHeight, noise);
      case 'ice_spikes': return this.normal(C.iceSpikes, biome, blocks, rand, x, z, startHeight, noise);
      case 'stone': return this.normal(C.stone, biome, blocks, rand, x, z, startHeight, noise);
      case 'mountain': return this.normal(noise > 1 ? C.stone : C.grass, biome, blocks, rand, x, z, startHeight, noise);
      case 'shattered_savanna': return this.normal(noise > 1.75 ? C.stone : noise > -0.5 ? C.coarse : C.grass, biome, blocks, rand, x, z, startHeight, noise);
      case 'gravelly_mountain': return this.normal(noise < -1 || noise > 2 ? C.gravel : noise > 1 ? C.stone : C.grass, biome, blocks, rand, x, z, startHeight, noise);
      case 'giant_tree_taiga': return this.normal(noise > 1.75 ? C.coarse : noise > -0.95 ? C.podzol : C.grass, biome, blocks, rand, x, z, startHeight, noise);
      case 'swamp': return this.swamp(biome, blocks, rand, x, z, startHeight, noise);
      case 'badlands': return this.badlands(blocks, rand, x, z, startHeight, noise, false, 0);
      case 'wooded_badlands': return this.badlands(blocks, rand, x, z, startHeight, noise, true, 0);
      case 'eroded_badlands': return this.eroded(blocks, rand, x, z, startHeight, noise);
      case 'frozen_ocean': return this.frozenOcean(biome, blocks, rand, x, z, startHeight, noise);
      default: return this.normal(C.grass, biome, blocks, rand, x, z, startHeight, noise);
    }
  }

  /** DefaultSurfaceBuilder.apply */
  private normal(cfg: Config, biome: number, blocks: ProtoBlocks, rand: JavaRandom, x: number, z: number, startHeight: number, noise: number): void {
    const lx = x & 15, lz = z & 15;
    let top = cfg.top, under = cfg.under;
    let depth = -1;
    const k = Math.trunc(noise / 3 + 3 + rand.nextDouble() * 0.25);
    for (let y = startHeight; y >= 0; y--) {
      const i = (y << 8) | (lz << 4) | lx;
      const st = blocks[i]!;
      if (st === S.air) depth = -1;
      else if (st === S.stone) {
        if (depth === -1) {
          if (k <= 0) {
            top = S.air;
            under = S.stone;
          } else if (y >= SEA - 4 && y <= SEA + 1) {
            top = cfg.top;
            under = cfg.under;
          }
          if (y < SEA && top === S.air) top = getTemperature(biome, x, y, z) < 0.15 ? S.ice : S.water;
          depth = k;
          if (y >= SEA - 1) blocks[i] = top;
          else if (y < SEA - 7 - k) {
            top = S.air;
            under = S.stone;
            blocks[i] = cfg.underwater;
          } else blocks[i] = under;
        } else if (depth > 0) {
          depth--;
          blocks[i] = under;
          if (depth === 0 && under === S.sand && k > 1) {
            depth = rand.nextInt(4) + Math.max(0, y - 63);
            under = S.sandstone;
          }
        }
      }
    }
  }

  /** SwampSurfaceBuilder: puddles at y 62 where the biome info noise is positive. */
  private swamp(biome: number, blocks: ProtoBlocks, rand: JavaRandom, x: number, z: number, startHeight: number, noise: number): void {
    if (BIOME_INFO_NOISE.getValue(x * 0.25, z * 0.25, false) > 0) {
      const lx = x & 15, lz = z & 15;
      for (let y = startHeight; y >= 0; y--) {
        const i = (y << 8) | (lz << 4) | lx;
        if (blocks[i] !== S.air) {
          if (y === 62 && blocks[i] !== S.water) blocks[i] = S.water;
          break;
        }
      }
    }
    this.normal(C.grass, biome, blocks, rand, x, z, startHeight, noise);
  }

  /** BadlandsSurfaceBuilder (and the wooded variant's grass/coarse dirt tops above y 86). */
  private badlands(blocks: ProtoBlocks, rand: JavaRandom, x: number, z: number, startHeight: number, noise: number, wooded: boolean, pillar: number): void {
    const lx = x & 15, lz = z & 15;
    const cfg = C.badlands;
    let top = S.white, under = cfg.under;
    const k = Math.trunc(noise / 3 + 3 + rand.nextDouble() * 0.25);
    const simple = Math.cos((noise / 3) * Math.PI) > 0;
    let depth = -1, orange = false, count = 0;
    const eroded = pillar > 0 || pillar === -1;
    const start = pillar > 0 ? Math.max(startHeight, Math.trunc(pillar) + 1) : startHeight;
    for (let y = start; y >= 0; y--) {
      if (count >= 15 && !eroded) continue;
      const i = (y << 8) | (lz << 4) | lx;
      if (pillar > 0 && blocks[i] === S.air && y < Math.trunc(pillar)) blocks[i] = S.stone;
      const st = blocks[i]!;
      if (st === S.air) depth = -1;
      else if (st === S.stone) {
        if (depth === -1) {
          orange = false;
          if (k <= 0) {
            top = S.air;
            under = S.stone;
          } else if (y >= SEA - 4 && y <= SEA + 1) {
            top = S.white;
            under = cfg.under;
          }
          if (y < SEA && top === S.air) top = S.water;
          depth = k + Math.max(0, y - SEA);
          if (y >= SEA - 1) {
            if (wooded && y > 86 + k * 2) blocks[i] = simple ? S.coarse : S.grass;
            else if (y > SEA + 3 + k) blocks[i] = y >= 64 && y <= 127 ? (simple ? S.terracotta : this.band(x, y, z)) : S.orange;
            else {
              blocks[i] = cfg.top;
              orange = true;
            }
          } else {
            blocks[i] = TERRACOTTAS.has(under) ? S.orange : under;
          }
        } else if (depth > 0) {
          depth--;
          blocks[i] = orange ? S.orange : this.band(x, y, z);
        }
        count++;
      }
    }
  }

  /** ErodedBadlandsSurfaceBuilder: terracotta hoodoos rising from y 64. */
  private eroded(blocks: ProtoBlocks, rand: JavaRandom, x: number, z: number, startHeight: number, noise: number): void {
    let d0 = 0;
    const d1 = Math.min(Math.abs(noise), this.pillarNoise.getValue(x * 0.25, z * 0.25, false) * 15);
    if (d1 > 0) {
      const d3 = Math.abs(this.pillarRoofNoise.getValue(x * 0.001953125, z * 0.001953125, false));
      d0 = d1 * d1 * 2.5;
      const d4 = Math.ceil(d3 * 50) + 14;
      if (d0 > d4) d0 = d4;
      d0 += 64;
    }
    // pillar −1 marks "eroded without a pillar here" (still no 15-block limit)
    this.badlands(blocks, rand, x, z, startHeight, noise, false, d0 > 0 ? d0 : -1);
  }

  /** FrozenOceanSurfaceBuilder: icebergs of packed ice with snow caps. */
  private frozenOcean(biome: number, blocks: ProtoBlocks, rand: JavaRandom, x: number, z: number, startHeight: number, noise: number): void {
    let d0 = 0, d1 = 0;
    const t = getTemperature(biome, x, 63, z);
    const d2 = Math.min(Math.abs(noise), this.icebergNoise.getValue(x * 0.1, z * 0.1, false) * 15);
    if (d2 > 1.8) {
      const d4 = Math.abs(this.icebergRoofNoise.getValue(x * 0.09765625, z * 0.09765625, false));
      d0 = d2 * d2 * 1.2;
      const d5 = Math.ceil(d4 * 40) + 14;
      if (d0 > d5) d0 = d5;
      if (t > 0.1) d0 -= 2;
      if (d0 > 2) {
        d1 = SEA - d0 - 7;
        d0 += SEA;
      } else d0 = 0;
    }
    const lx = x & 15, lz = z & 15;
    const cfg = C.grass;
    let top = cfg.top, under = cfg.under;
    const k = Math.trunc(noise / 3 + 3 + rand.nextDouble() * 0.25);
    let depth = -1, snow = 0;
    const maxSnow = 2 + rand.nextInt(4);
    const snowFrom = SEA + 18 + rand.nextInt(10);
    for (let y = Math.max(startHeight, Math.trunc(d0) + 1); y >= 0; y--) {
      const i = (y << 8) | (lz << 4) | lx;
      if (blocks[i] === S.air && y < Math.trunc(d0) && rand.nextDouble() > 0.01) blocks[i] = S.packedIce;
      else if (blocks[i] === S.water && y > Math.trunc(d1) && y < SEA && d1 !== 0 && rand.nextDouble() > 0.15) blocks[i] = S.packedIce;
      const st = blocks[i]!;
      if (st === S.air) depth = -1;
      else if (st !== S.stone) {
        if (st === S.packedIce && snow <= maxSnow && y > snowFrom) {
          blocks[i] = S.snowBlock;
          snow++;
        }
      } else if (depth === -1) {
        if (k <= 0) {
          top = S.air;
          under = S.stone;
        } else if (y >= SEA - 4 && y <= SEA + 1) {
          top = cfg.top;
          under = cfg.under;
        }
        if (y < SEA && top === S.air) top = getTemperature(biome, x, y, z) < 0.15 ? S.ice : S.water;
        depth = k;
        if (y >= SEA - 1) blocks[i] = top;
        else if (y < SEA - 7 - k) {
          top = S.air;
          under = S.stone;
          blocks[i] = S.gravel;
        } else blocks[i] = under;
      } else if (depth > 0) {
        depth--;
        blocks[i] = under;
        if (depth === 0 && under === S.sand && k > 1) {
          depth = rand.nextInt(4) + Math.max(0, y - 63);
          under = S.sandstone;
        }
      }
    }
  }
}

/** NoiseBasedChunkGenerator.setBedrock (overworld floor): y 0–4, x fastest then z. */
export function placeBedrock(blocks: ProtoBlocks, rand: JavaRandom): void {
  const bedrock = stateOf('bedrock');
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++)
      for (let y = 4; y >= 0; y--) if (y <= rand.nextInt(5)) blocks[(y << 8) | (z << 4) | x] = bedrock;
}
