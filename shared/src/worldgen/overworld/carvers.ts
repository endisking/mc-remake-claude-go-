/**
 * Carvers (vanilla WorldCarver / CaveWorldCarver / CanyonWorldCarver and the underwater variants,
 * 1.16–1.17): every chunk within 8 of the one being generated may start caves or a canyon, seeded
 * with setLargeFeatureSeed(seed + carver index); their tunnels of spheres cut into this chunk only.
 * Floats are emulated with Math.fround and Mth.sin/cos use vanilla's lookup table, since tunnel
 * paths accumulate float rounding.
 */
import { JavaRandom } from '../../util/random';
import { mthSin, mthCos, F_PI } from '../../util/mth';
import { stateOf, blockNameOf } from '../../world/blockstate';
import { largeFeatureSeed } from '../rand';
import { B, isOceanic } from '../biome/biomeids';
import { BIOME_GEN } from '../biome/biomegen';
import type { ProtoBlocks } from './surface';

const f = Math.fround;
const HALF_PI = f(Math.PI / 2), TWO_PI = f(Math.PI * 2);

const AIR = 0;
const CAVE_AIR = stateOf('cave_air');
const LAVA = stateOf('lava', { level: 0 });
const WATER = stateOf('water', { level: 0 });
const OBSIDIAN = stateOf('obsidian');
const MAGMA = stateOf('magma_block');
const GRASS = stateOf('grass_block', { snowy: false });
const MYCELIUM = stateOf('mycelium', { snowy: false });
const DIRT = stateOf('dirt');
const SAND = stateOf('sand');
const GRAVEL = stateOf('gravel');

const TERRACOTTA = ['', 'white_', 'orange_', 'magenta_', 'light_blue_', 'yellow_', 'lime_', 'pink_', 'gray_', 'light_gray_', 'cyan_', 'purple_', 'blue_', 'brown_', 'green_', 'red_', 'black_'].map((c) => `${c}terracotta`);
const BASE_REPLACEABLE = ['stone', 'granite', 'diorite', 'andesite', 'dirt', 'coarse_dirt', 'podzol', 'grass_block', ...TERRACOTTA, 'sandstone', 'red_sandstone', 'mycelium', 'snow', 'packed_ice'];
const UNDERWATER_REPLACEABLE = [...BASE_REPLACEABLE, 'sand', 'gravel', 'water', 'lava', 'obsidian', 'air', 'cave_air'];

/** Block-name sets → fast state-id lookups. */
function nameSet(names: string[]): (state: number) => boolean {
  const set = new Set(names);
  const cache = new Map<number, boolean>();
  return (s) => {
    let v = cache.get(s);
    if (v === undefined) cache.set(s, (v = set.has(blockNameOf(s))));
    return v;
  };
}
const isBaseReplaceable = nameSet(BASE_REPLACEABLE);
const isUnderwaterReplaceable = nameSet(UNDERWATER_REPLACEABLE);
const isWater = (s: number) => blockNameOf(s) === 'water' || blockNameOf(s) === 'bubble_column';

/** Top material of a biome's configured surface builder (cave openings turn dirt back into it). */
function topMaterial(biome: number): number {
  switch (BIOME_GEN[biome]?.surface) {
    case 'desert': case 'full_sand': return SAND;
    case 'mycelium': return MYCELIUM;
    case 'badlands': case 'wooded_badlands': case 'eroded_badlands': return stateOf('red_sand');
    case 'ice_spikes': return stateOf('snow_block');
    case 'stone': return stateOf('stone');
    default: return GRASS;
  }
}

/** The chunk being carved and what carving needs from the generator. */
export interface CarveTarget {
  blocks: ProtoBlocks;
  cx: number;
  cz: number;
  /** block biome (fuzzy zoom) */
  biomeAt(x: number, z: number): number;
}

type Kind = 'cave' | 'canyon' | 'underwater_cave' | 'underwater_canyon';
interface Carver {
  kind: Kind;
  probability: number;
}

const CAVE: Carver = { kind: 'cave', probability: 0.14285715 };
const OCEAN_CAVE: Carver = { kind: 'cave', probability: 0.06666667 };
const CANYON: Carver = { kind: 'canyon', probability: 0.02 };
const UNDERWATER_CANYON: Carver = { kind: 'underwater_canyon', probability: 0.02 };
const UNDERWATER_CAVE: Carver = { kind: 'underwater_cave', probability: 0.06666667 };

/** BiomeDefaultFeatures.addDefaultCarvers / addOceanCarvers: [air carvers, liquid carvers]. */
function carversFor(biome: number): [Carver[], Carver[]] {
  if (biome === B.the_void || (biome >= B.small_end_islands && biome <= B.end_barrens) || biome === B.the_end) return [[], []];
  if (isOceanic(biome)) return [[OCEAN_CAVE, CANYON], [UNDERWATER_CANYON, UNDERWATER_CAVE]];
  return [[CAVE, CANYON], []];
}

export class Carvers {
  private readonly mask = new Uint8Array(65536);
  private readonly rs = new Float32Array(1024);
  private t!: CarveTarget;
  private underwater = false;
  private canyon = false;

  constructor(private readonly seed: bigint) {}

  /** ChunkGenerator.applyCarvers for the AIR then LIQUID steps (each with its own carving mask). */
  carve(t: CarveTarget, chunkBiome: number): void {
    this.t = t;
    const [air, liquid] = carversFor(chunkBiome);
    for (const list of [air, liquid]) {
      if (!list.length) continue;
      this.mask.fill(0);
      for (let sx = t.cx - 8; sx <= t.cx + 8; sx++)
        for (let sz = t.cz - 8; sz <= t.cz + 8; sz++)
          list.forEach((carver, j) => {
            const r = new JavaRandom(largeFeatureSeed(this.seed + BigInt(j), sx, sz));
            if (r.nextFloat() <= f(carver.probability)) this.run(carver.kind, r, sx, sz);
          });
    }
  }

  private run(kind: Kind, r: JavaRandom, sx: number, sz: number): void {
    this.underwater = kind === 'underwater_cave' || kind === 'underwater_canyon';
    this.canyon = kind === 'canyon' || kind === 'underwater_canyon';
    if (this.canyon) this.carveCanyon(r, sx, sz);
    else this.carveCaves(r, sx, sz);
  }

  // ------------------------------------------------------------------ caves
  private carveCaves(r: JavaRandom, sx: number, sz: number): void {
    const range = (4 * 2 - 1) * 16;
    const n = r.nextInt(r.nextInt(r.nextInt(15) + 1) + 1);
    for (let k = 0; k < n; k++) {
      const x = sx * 16 + r.nextInt(16);
      const y = r.nextInt(r.nextInt(120) + 8);
      const z = sz * 16 + r.nextInt(16);
      let branches = 1;
      if (r.nextInt(4) === 0) {
        const radius = f(1 + f(r.nextFloat() * 6));
        // genRoom: 1.5 + sin(π/2) × radius, squashed to half height
        const d0 = 1.5 + f(mthSin(HALF_PI) * radius);
        this.carveSphere(r.nextLong(), x + 1, y, z, d0, d0 * 0.5);
        branches += r.nextInt(4);
      }
      for (let b = 0; b < branches; b++) {
        const yaw = f(r.nextFloat() * TWO_PI);
        const pitch = f(f(r.nextFloat() - 0.5) / 4);
        const thickness = this.thickness(r);
        const count = range - r.nextInt(range / 4);
        this.tunnel(r.nextLong(), x, y, z, thickness, yaw, pitch, 0, count, 1);
      }
    }
  }

  private thickness(r: JavaRandom): number {
    let t = f(f(r.nextFloat() * 2) + r.nextFloat());
    if (r.nextInt(10) === 0) t = f(t * f(f(f(r.nextFloat() * r.nextFloat()) * 3) + 1));
    return t;
  }

  /** CaveWorldCarver.genTunnel */
  private tunnel(seed: bigint, x: number, y: number, z: number, thickness: number, yaw: number, pitch: number, start: number, count: number, ratio: number): void {
    const r = new JavaRandom(seed);
    const split = r.nextInt(Math.trunc(count / 2)) + Math.trunc(count / 4);
    const steep = r.nextInt(6) === 0;
    let dYaw = 0, dPitch = 0;
    for (let j = start; j < count; j++) {
      const d0 = 1.5 + f(mthSin(f(f(F_PI * j) / count)) * thickness);
      const d1 = d0 * ratio;
      const c = mthCos(pitch);
      x += f(mthCos(yaw) * c);
      y += mthSin(pitch);
      z += f(mthSin(yaw) * c);
      pitch = f(pitch * (steep ? f(0.92) : f(0.7)));
      pitch = f(pitch + f(dPitch * f(0.1)));
      yaw = f(yaw + f(dYaw * f(0.1)));
      dPitch = f(dPitch * f(0.9));
      dYaw = f(dYaw * f(0.75));
      dPitch = f(dPitch + f(f(f(r.nextFloat() - r.nextFloat()) * r.nextFloat()) * 2));
      dYaw = f(dYaw + f(f(f(r.nextFloat() - r.nextFloat()) * r.nextFloat()) * 4));
      if (j === split && thickness > 1) {
        this.tunnel(r.nextLong(), x, y, z, f(f(r.nextFloat() * 0.5) + 0.5), f(yaw - HALF_PI), f(pitch / 3), j, count, 1);
        this.tunnel(r.nextLong(), x, y, z, f(f(r.nextFloat() * 0.5) + 0.5), f(yaw + HALF_PI), f(pitch / 3), j, count, 1);
        return;
      }
      if (r.nextInt(4) !== 0) {
        if (!this.canReach(x, z, j, count, thickness)) return;
        this.carveSphere(seed, x, y, z, d0, d1);
      }
    }
  }

  // ------------------------------------------------------------------ canyons
  private carveCanyon(r: JavaRandom, sx: number, sz: number): void {
    const range = (4 * 2 - 1) * 16;
    const x = sx * 16 + r.nextInt(16);
    const y = r.nextInt(r.nextInt(40) + 8) + 20;
    const z = sz * 16 + r.nextInt(16);
    const yaw = f(r.nextFloat() * TWO_PI);
    const pitch = f(f(f(f(r.nextFloat() - 0.5) * 2) / 8));
    const thickness = f(f(f(r.nextFloat() * 2) + r.nextFloat()) * 2);
    const count = range - r.nextInt(range / 4);
    this.canyonPath(r.nextLong(), x, y, z, thickness, yaw, pitch, 0, count, 3);
  }

  /** CanyonWorldCarver.genCanyon (the per-height width table rs is shared by skip()). */
  private canyonPath(seed: bigint, x: number, y: number, z: number, thickness: number, yaw: number, pitch: number, start: number, count: number, yScale: number): void {
    const r = new JavaRandom(seed);
    let w = 1;
    for (let i = 0; i < 256; i++) {
      if (i === 0 || r.nextInt(3) === 0) w = f(1 + f(r.nextFloat() * r.nextFloat()));
      this.rs[i] = f(w * w);
    }
    let dYaw = 0, dPitch = 0;
    for (let j = start; j < count; j++) {
      let d0 = 1.5 + f(mthSin(f(f(j * F_PI) / count)) * thickness);
      let d1 = d0 * yScale;
      d0 *= r.nextFloat() * 0.25 + 0.75;
      d1 *= r.nextFloat() * 0.25 + 0.75;
      const c = mthCos(pitch), s = mthSin(pitch);
      x += f(mthCos(yaw) * c);
      y += s;
      z += f(mthSin(yaw) * c);
      pitch = f(pitch * f(0.7));
      pitch = f(pitch + f(dPitch * f(0.05)));
      yaw = f(yaw + f(dYaw * f(0.05)));
      dPitch = f(dPitch * f(0.8));
      dYaw = f(dYaw * f(0.5));
      dPitch = f(dPitch + f(f(f(r.nextFloat() - r.nextFloat()) * r.nextFloat()) * 2));
      dYaw = f(dYaw + f(f(f(r.nextFloat() - r.nextFloat()) * r.nextFloat()) * 4));
      if (r.nextInt(4) !== 0) {
        if (!this.canReach(x, z, j, count, thickness)) return;
        this.carveSphere(seed, x, y, z, d0, d1);
      }
    }
  }

  // ------------------------------------------------------------------ shared
  /** WorldCarver.canReach: can the rest of the tunnel still get near the carved chunk? */
  private canReach(x: number, z: number, j: number, count: number, thickness: number): boolean {
    const dx = x - (this.t.cx * 16 + 8), dz = z - (this.t.cz * 16 + 8), left = count - j;
    const reach = f(thickness + f(2) + f(16));
    return dx * dx + dz * dz - left * left <= reach * reach;
  }

  private skip(rx: number, ry: number, rz: number, py: number): boolean {
    if (this.canyon) return (rx * rx + rz * rz) * this.rs[py - 1]! + (ry * ry) / 6 >= 1;
    return ry <= -0.7 || rx * rx + ry * ry + rz * rz >= 1;
  }

  /** WorldCarver.carveSphere: an ellipsoid of radius (h, v) at (x, y, z), clipped to the chunk. */
  private carveSphere(seed: bigint, x: number, y: number, z: number, h: number, v: number): void {
    const { cx, cz, blocks } = this.t;
    const rand = new JavaRandom(seed + BigInt(cx) + BigInt(cz));
    const ox = cx * 16 + 8, oz = cz * 16 + 8;
    if (x < ox - 16 - h * 2 || z < oz - 16 - h * 2 || x > ox + 16 + h * 2 || z > oz + 16 + h * 2) return;
    const x0 = Math.max(Math.floor(x - h) - cx * 16 - 1, 0), x1 = Math.min(Math.floor(x + h) - cx * 16 + 1, 16);
    const y0 = Math.max(Math.floor(y - v) - 1, 1), y1 = Math.min(Math.floor(y + v) + 1, 256 - 8);
    const z0 = Math.max(Math.floor(z - h) - cz * 16 - 1, 0), z1 = Math.min(Math.floor(z + h) - cz * 16 + 1, 16);
    if (!this.underwater && this.hasWater(x0, x1, y0, y1, z0, z1)) return;
    for (let lx = x0; lx < x1; lx++) {
      const wx = lx + cx * 16;
      const rx = (wx + 0.5 - x) / h;
      for (let lz = z0; lz < z1; lz++) {
        const wz = lz + cz * 16;
        const rz = (wz + 0.5 - z) / h;
        if (rx * rx + rz * rz >= 1) continue;
        let grass = false;
        for (let ly = y1; ly > y0; ly--) {
          const ry = (ly - 0.5 - y) / v;
          if (this.skip(rx, ry, rz, ly)) continue;
          const i = (ly << 8) | (lz << 4) | lx;
          if (this.mask[i]) continue;
          this.mask[i] = 1;
          if (this.underwater) this.carveUnderwater(blocks, rand, i, ly);
          else {
            const st = blocks[i]!;
            if (st === GRASS || st === MYCELIUM) grass = true;
            const above = ly < 255 ? blocks[i + 256]! : AIR;
            if (!(isBaseReplaceable(st) || ((st === SAND || st === GRAVEL) && !isWater(above)))) continue;
            if (ly < 11) blocks[i] = LAVA;
            else {
              blocks[i] = CAVE_AIR;
              if (grass && blocks[i - 256] === DIRT) blocks[i - 256] = topMaterial(this.t.biomeAt(wx, wz));
            }
          }
        }
      }
    }
  }

  /**
   * UnderwaterCaveWorldCarver.carveBlock: below sea level every carved block becomes water (vanilla
   * only differs in which ones get a liquid tick), magma/obsidian at y 10 and lava below.
   */
  private carveUnderwater(blocks: ProtoBlocks, rand: JavaRandom, i: number, ly: number): void {
    if (ly >= 63) return;
    if (!isUnderwaterReplaceable(blocks[i]!)) return;
    if (ly === 10) blocks[i] = rand.nextFloat() < 0.25 ? MAGMA : OBSIDIAN;
    else blocks[i] = ly < 10 ? LAVA : WATER;
  }

  /** WorldCarver.hasWater: is there water on the shell of the volume (the whole top and bottom layers)? */
  private hasWater(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): boolean {
    const blocks = this.t.blocks;
    for (let lx = x0; lx < x1; lx++)
      for (let lz = z0; lz < z1; lz++)
        for (let ly = y0 - 1; ly <= y1 + 1; ly++) {
          if (ly >= 0 && ly < 256 && isWater(blocks[(ly << 8) | (lz << 4) | lx]!)) return true;
          if (ly !== y1 + 1 && !(lx === x0 || lx === x1 - 1 || lz === z0 || lz === z1 - 1)) ly = y1;
        }
    return false;
  }
}
