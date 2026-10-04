/**
 * The 1.17.1 nether cave carver (NetherWorldCarver extends CaveWorldCarver, configured
 * "nether_cave": probability 0.2, y uniform 0..below_top(1), room yScale 0.5, floor level -0.7).
 * Differences from overworld caves: cave bound 10, thickness (2·rand + rand)·2, tunnel yScale 5,
 * generation depth 128 (spheres stop 8 below it), no liquid check, and every carved block at or
 * below y 31 becomes lava (cave air above). Floats emulated as in overworld/carvers.ts.
 */
import { JavaRandom } from '../../util/random';
import { mthSin, mthCos, F_PI } from '../../util/mth';
import { stateOf, blockNameOf } from '../../world/blockstate';
import { largeFeatureSeed } from '../rand';
import type { ProtoBlocks } from '../overworld/surface';

const f = Math.fround;
const HALF_PI = f(Math.PI / 2), TWO_PI = f(Math.PI * 2);

const CAVE_AIR = stateOf('cave_air');
const LAVA = stateOf('lava', { level: 0 });
const REPLACEABLE_NAMES = new Set(['stone', 'granite', 'diorite', 'andesite', 'dirt', 'coarse_dirt', 'podzol', 'grass_block', 'netherrack', 'soul_sand',
  'soul_soil', 'crimson_nylium', 'warped_nylium', 'nether_wart_block', 'warped_wart_block', 'basalt', 'blackstone']);
const replaceCache = new Map<number, boolean>();
function replaceable(s: number): boolean {
  let v = replaceCache.get(s);
  if (v === undefined) replaceCache.set(s, (v = REPLACEABLE_NAMES.has(blockNameOf(s))));
  return v;
}

const GEN_DEPTH = 128;
const PROBABILITY = f(0.2);

export class NetherCarver {
  private readonly mask = new Uint8Array(65536);
  private blocks!: ProtoBlocks;
  private cx = 0;
  private cz = 0;

  constructor(private readonly seed: bigint) {}

  /** ChunkGenerator.applyCarvers (AIR step; the nether biomes have no liquid carvers). Returns the carving mask bit set. */
  carve(blocks: ProtoBlocks, cx: number, cz: number): Uint8Array {
    this.blocks = blocks;
    this.cx = cx;
    this.cz = cz;
    this.mask.fill(0);
    for (let sx = cx - 8; sx <= cx + 8; sx++)
      for (let sz = cz - 8; sz <= cz + 8; sz++) {
        const r = new JavaRandom(largeFeatureSeed(this.seed, sx, sz));
        if (r.nextFloat() <= PROBABILITY) this.carveCaves(r, sx, sz);
      }
    const bits = new Uint8Array(8192);
    for (let i = 0; i < 65536; i++) if (this.mask[i]) bits[i >> 3] |= 1 << (i & 7);
    return bits;
  }

  private carveCaves(r: JavaRandom, sx: number, sz: number): void {
    const range = (4 * 2 - 1) * 16;
    const n = r.nextInt(r.nextInt(r.nextInt(10) + 1) + 1);
    for (let k = 0; k < n; k++) {
      const x = sx * 16 + r.nextInt(16);
      // UniformHeight(absolute 0, below_top 1): 0..126
      const y = r.nextInt(GEN_DEPTH - 2 + 1);
      const z = sz * 16 + r.nextInt(16);
      let branches = 1;
      if (r.nextInt(4) === 0) {
        const radius = f(1 + f(r.nextFloat() * 6));
        const d0 = 1.5 + f(mthSin(HALF_PI) * radius);
        this.carveSphere(r.nextLong(), x + 1, y, z, d0, d0 * 0.5);
        branches += r.nextInt(4);
      }
      for (let b = 0; b < branches; b++) {
        const yaw = f(r.nextFloat() * TWO_PI);
        const pitch = f(f(r.nextFloat() - 0.5) / 4);
        const thickness = f(f(f(r.nextFloat() * 2) + r.nextFloat()) * 2);
        const count = range - r.nextInt(range / 4);
        this.tunnel(r.nextLong(), x, y, z, thickness, yaw, pitch, 0, count, 5);
      }
    }
  }

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
        const dx = x - (this.cx * 16 + 8), dz = z - (this.cz * 16 + 8), left = count - j;
        const reach = f(thickness + f(2) + f(16));
        if (dx * dx + dz * dz - left * left > reach * reach) return;
        this.carveSphere(seed, x, y, z, d0, d1);
      }
    }
  }

  private carveSphere(_seed: bigint, x: number, y: number, z: number, h: number, v: number): void {
    const { cx, cz, blocks } = this;
    const ox = cx * 16 + 8, oz = cz * 16 + 8;
    if (Math.abs(x - ox) > 16 + h * 2 || Math.abs(z - oz) > 16 + h * 2) return;
    const x0 = Math.max(Math.floor(x - h) - cx * 16 - 1, 0), x1 = Math.min(Math.floor(x + h) - cx * 16 + 1, 16);
    const y0 = Math.max(Math.floor(y - v) - 1, 1), y1 = Math.min(Math.floor(y + v) + 1, GEN_DEPTH - 8);
    const z0 = Math.max(Math.floor(z - h) - cz * 16 - 1, 0), z1 = Math.min(Math.floor(z + h) - cz * 16 + 1, 16);
    for (let lx = x0; lx < x1; lx++) {
      const rx = (lx + cx * 16 + 0.5 - x) / h;
      for (let lz = z0; lz < z1; lz++) {
        const rz = (lz + cz * 16 + 0.5 - z) / h;
        if (rx * rx + rz * rz >= 1) continue;
        for (let ly = y1; ly > y0; ly--) {
          const ry = (ly - 0.5 - y) / v;
          if (ry <= -0.7 || rx * rx + ry * ry + rz * rz >= 1) continue;
          const i = (ly << 8) | (lz << 4) | lx;
          if (this.mask[i]) continue;
          this.mask[i] = 1;
          if (!replaceable(blocks[i]!)) continue;
          blocks[i] = ly <= 31 ? LAVA : CAVE_AIR;
        }
      }
    }
  }
}
