/**
 * Nether surface builders (vanilla 1.16/1.17): NetherSurfaceBuilder (nether wastes: soul sand and
 * gravel patches around the lava sea), NetherForestSurfaceBuilder (crimson/warped nylium with wart
 * block and netherrack patches), and the NetherCappedSurfaceBuilder pair for soul sand valleys
 * (soul sand/soul soil floors and ceilings, gravel patches) and basalt deltas (basalt/blackstone
 * floors, basalt ceilings). Configs from the 1.17.1 configured_surface_builders report.
 */
import { JavaRandom } from '../../util/random';
import { PerlinNoise } from '../../util/noise';
import { stateOf } from '../../world/blockstate';
import { B } from '../biome/biomeids';
import type { ProtoBlocks } from '../overworld/surface';

const S = {
  air: 0,
  caveAir: stateOf('cave_air'),
  netherrack: stateOf('netherrack'),
  lava: stateOf('lava', { level: 0 }),
  gravel: stateOf('gravel'),
  soulSand: stateOf('soul_sand'),
  soulSoil: stateOf('soul_soil'),
  basalt: stateOf('basalt', { axis: 'y' }),
  blackstone: stateOf('blackstone'),
  magma: stateOf('magma_block'),
  crimsonNylium: stateOf('crimson_nylium'),
  warpedNylium: stateOf('warped_nylium'),
  netherWart: stateOf('nether_wart_block'),
  warpedWart: stateOf('warped_wart_block'),
};

const isAir = (s: number) => s === S.air || s === S.caveAir;
const idx = (x: number, y: number, z: number) => (y << 8) | (z << 4) | x;

interface Config {
  top: number;
  under: number;
  underwater: number;
}

/** A NetherCappedSurfaceBuilder: floor and ceiling blocks chosen by per-block noise, a patch block near the lava sea. */
interface Capped {
  floors: { state: number; noise: PerlinNoise }[];
  ceilings: { state: number; noise: PerlinNoise }[];
  patchNoise: PerlinNoise;
  patch: number;
}

function capped(seed: bigint, floorStates: number[], ceilingStates: number[], patch: number): Capped {
  // NetherCappedSurfaceBuilder.initNoise: one octave -4 noise per state, seeds counting up from seed
  const mk = (states: number[], s: bigint) => states.map((state, i) => ({ state, noise: new PerlinNoise(new JavaRandom(s + BigInt(i)), -4, [1]) }));
  const floors = mk(floorStates, seed);
  const ceilings = mk(ceilingStates, seed + BigInt(floors.length));
  const patchNoise = new PerlinNoise(new JavaRandom(seed + BigInt(floors.length) + BigInt(ceilings.length)), 0, [1]);
  return { floors, ceilings, patchNoise, patch };
}

/** getBlockState: the state whose noise is highest at (x, 0, z) (above Double.MIN_VALUE; else the first). */
function pick(list: { state: number; noise: PerlinNoise }[], x: number, z: number): number {
  let best = list[0]!.state, max = Number.MIN_VALUE;
  for (const e of list) {
    const v = e.noise.noise(x, 0, z);
    if (v > max) {
      best = e.state;
      max = v;
    }
  }
  return best;
}

export class NetherSurfaceBuilders {
  /** NetherSurfaceBuilder.decorationNoise (octaves -3..0) */
  private readonly wastesNoise: PerlinNoise;
  /** NetherForestSurfaceBuilder.decorationNoise (octave 0) */
  private readonly forestNoise: PerlinNoise;
  private readonly soulSandValley: Capped;
  private readonly basaltDeltas: Capped;

  constructor(seed: bigint) {
    this.wastesNoise = new PerlinNoise(new JavaRandom(seed), -3, [1, 1, 1, 1]);
    this.forestNoise = new PerlinNoise(new JavaRandom(seed), 0, [1]);
    this.soulSandValley = capped(seed, [S.soulSand, S.soulSoil], [S.soulSand, S.soulSoil], S.gravel);
    this.basaltDeltas = capped(seed, [S.basalt, S.blackstone], [S.basalt], S.basalt);
  }

  build(biome: number, blocks: ProtoBlocks, r: JavaRandom, x: number, z: number, noise: number, seaLevel: number): void {
    switch (biome) {
      case B.crimson_forest:
        return this.forest(blocks, r, x, z, noise, seaLevel, { top: S.crimsonNylium, under: S.netherrack, underwater: S.netherWart });
      case B.warped_forest:
        return this.forest(blocks, r, x, z, noise, seaLevel, { top: S.warpedNylium, under: S.netherrack, underwater: S.warpedWart });
      case B.soul_sand_valley:
        return this.capped(this.soulSandValley, blocks, r, x, z, noise, seaLevel);
      case B.basalt_deltas:
        return this.capped(this.basaltDeltas, blocks, r, x, z, noise, seaLevel);
      default:
        return this.wastes(blocks, r, x, z, noise, seaLevel, { top: S.netherrack, under: S.netherrack, underwater: S.netherrack });
    }
  }

  /** NetherSurfaceBuilder.apply */
  private wastes(blocks: ProtoBlocks, r: JavaRandom, x: number, z: number, noise: number, sea: number, c: Config): void {
    const lx = x & 15, lz = z & 15;
    const soulSand = this.wastesNoise.noise(x * 0.03125, z * 0.03125, 0) * 75 + r.nextDouble() * 0.2 > 0;
    const gravel = this.wastesNoise.noise(x * 0.03125, 109, z * 0.03125) * 75 + r.nextDouble() * 0.2 > 0;
    const depth = Math.trunc(noise / 3 + 3 + r.nextDouble() * 0.25);
    let run = -1;
    let top = c.top, under = c.under;
    for (let y = 127; y >= 0; y--) {
      const i = idx(lx, y, lz);
      const st = blocks[i]!;
      if (isAir(st)) run = -1;
      else if (st === S.netherrack) {
        if (run === -1) {
          let shallow = false;
          if (depth <= 0) {
            shallow = true;
            under = c.under;
          } else if (y >= sea - 4 && y <= sea + 1) {
            top = c.top;
            under = c.under;
            if (gravel) {
              top = S.gravel;
              under = c.under;
            }
            if (soulSand) {
              top = S.soulSand;
              under = S.soulSand;
            }
          }
          if (y < sea && shallow) top = S.lava;
          run = depth;
          blocks[i] = y >= sea - 1 ? top : under;
        } else if (run > 0) {
          run--;
          blocks[i] = under;
        }
      }
    }
  }

  /** NetherForestSurfaceBuilder.apply */
  private forest(blocks: ProtoBlocks, r: JavaRandom, x: number, z: number, noise: number, sea: number, c: Config): void {
    const lx = x & 15, lz = z & 15;
    const d0 = this.forestNoise.noise(x * 0.1, sea, z * 0.1);
    const bare = d0 > 0.15 + r.nextDouble() * 0.35;
    const d1 = this.forestNoise.noise(x * 0.1, 109, z * 0.1);
    const wart = d1 > 0.25 + r.nextDouble() * 0.9;
    const depth = Math.trunc(noise / 3 + 3 + r.nextDouble() * 0.25);
    let run = -1;
    let under = c.under;
    for (let y = 127; y >= 0; y--) {
      const i = idx(lx, y, lz);
      let top = c.top;
      const st = blocks[i]!;
      if (isAir(st)) run = -1;
      else if (st === S.netherrack) {
        if (run === -1) {
          let shallow = false;
          if (depth <= 0) {
            shallow = true;
            under = c.under;
          }
          if (bare) top = c.under;
          else if (wart) top = c.underwater;
          if (y < sea && shallow) top = S.lava;
          run = depth;
          blocks[i] = y >= sea - 1 ? top : under;
        } else if (run > 0) {
          run--;
          blocks[i] = under;
        }
      }
    }
  }

  /** NetherCappedSurfaceBuilder.apply */
  private capped(cap: Capped, blocks: ProtoBlocks, r: JavaRandom, x: number, z: number, noise: number, sea: number): void {
    const i0 = sea + 1;
    const lx = x & 15, lz = z & 15;
    const ceilDepth = Math.trunc(noise / 3 + 3 + r.nextDouble() * 0.25);
    const floorDepth = Math.trunc(noise / 3 + 3 + r.nextDouble() * 0.25);
    const patch = cap.patchNoise.noise(x * 0.03125, 109, z * 0.03125) * 75 + r.nextDouble() * 0.2 > 0;
    const ceiling = pick(cap.ceilings, x, z);
    const floor = pick(cap.floors, x, z);
    const isFluidOrAir = (s: number) => isAir(s) || s === S.lava;
    let prev = blocks[idx(lx, 128, lz)]!;
    for (let y = 127; y >= 0; y--) {
      const cur = blocks[idx(lx, y, lz)]!;
      if (prev === S.netherrack && isFluidOrAir(cur)) {
        // the block above is the underside of a ceiling: cap it
        for (let k = 0, yy = y; k < ceilDepth; k++) {
          yy++;
          if (yy > 255 || blocks[idx(lx, yy, lz)] !== S.netherrack) break;
          blocks[idx(lx, yy, lz)] = ceiling;
        }
      }
      if (isFluidOrAir(prev) && cur === S.netherrack) {
        for (let k = 0, yy = y; k < floorDepth && yy >= 0 && blocks[idx(lx, yy, lz)] === S.netherrack; k++, yy--) {
          blocks[idx(lx, yy, lz)] = patch && y >= i0 - 4 && y <= i0 + 1 ? cap.patch : floor;
        }
      }
      prev = cur;
    }
  }
}
