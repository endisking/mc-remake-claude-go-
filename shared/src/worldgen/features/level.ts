/**
 * The decoration region a chunk's features run in (vanilla WorldGenRegion): reads anywhere that is
 * loaded, writes only within one chunk of the chunk being decorated (ensureCanWrite), and
 * heightmaps computed from the blocks as they are now (vanilla keeps them updated as it writes).
 */
import type { BlockWorld } from '../../world/world';
import { IS_AIR, FLUID } from '../../world/blockinfo';
import { MATERIAL_BLOCKS_MOTION, MATERIAL_SOLID } from '../../world/blockprops';
import { blockNameOf } from '../../world/blockstate';
import type { OverworldGenerator } from '../overworld/generator';

export type HeightmapType = 'WORLD_SURFACE_WG' | 'WORLD_SURFACE' | 'OCEAN_FLOOR_WG' | 'OCEAN_FLOOR' | 'MOTION_BLOCKING' | 'MOTION_BLOCKING_NO_LEAVES';

const LEAVES = new Uint8Array(IS_AIR.length);
for (let s = 0; s < LEAVES.length; s++) LEAVES[s] = blockNameOf(s).endsWith('_leaves') ? 1 : 0;

const KIND: Record<HeightmapType, number> = { WORLD_SURFACE_WG: 0, WORLD_SURFACE: 0, OCEAN_FLOOR_WG: 1, OCEAN_FLOOR: 1, MOTION_BLOCKING: 2, MOTION_BLOCKING_NO_LEAVES: 3 };
function hits(kind: number, s: number): boolean {
  switch (kind) {
    case 0: return IS_AIR[s] !== 1;
    case 1: return MATERIAL_BLOCKS_MOTION[s] === 1;
    case 2: return MATERIAL_BLOCKS_MOTION[s] === 1 || FLUID[s] !== 0;
    default: return (MATERIAL_BLOCKS_MOTION[s] === 1 || FLUID[s] !== 0) && LEAVES[s] !== 1;
  }
}
// exact for |x|, |z| < 2^25 (the 30M world border): stays below 2^53
const colKey = (x: number, z: number) => (x + 0x2000000) * 0x4000000 + (z + 0x2000000);

export class GenLevel {
  readonly minY = 0;
  readonly height = 256;
  readonly seaLevel = 63;

  constructor(
    readonly world: BlockWorld,
    readonly gen: OverworldGenerator,
    /** chunk being decorated */
    readonly cx: number,
    readonly cz: number,
  ) {}

  getState(x: number, y: number, z: number): number {
    return this.world.getState(x, y, z);
  }

  isAir(x: number, y: number, z: number): boolean {
    return IS_AIR[this.world.getState(x, y, z)] === 1;
  }

  /** LevelReader.isEmptyBlock (air). */
  isEmpty(x: number, y: number, z: number): boolean {
    return this.isAir(x, y, z);
  }

  isSolid(x: number, y: number, z: number): boolean {
    return MATERIAL_SOLID[this.world.getState(x, y, z)] === 1;
  }

  isOutsideBuildHeight(y: number): boolean {
    return y < 0 || y >= 256;
  }

  /** WorldGenRegion.ensureCanWrite: within one chunk of the chunk being decorated. */
  canWrite(x: number, z: number): boolean {
    return Math.abs((x >> 4) - this.cx) <= 1 && Math.abs((z >> 4) - this.cz) <= 1;
  }

  /** Level.setBlock (flags 2/3 alike during generation); false when outside the writable area. */
  setState(x: number, y: number, z: number, state: number): boolean {
    if (y < 0 || y >= 256 || !this.canWrite(x, z)) return false;
    this.world.setStateRaw(x, y, z, state);
    // keep the cached heightmaps current (Heightmap.update)
    const col = colKey(x, z);
    for (let k = 0; k < 4; k++) {
      const h = this.heights[k]!.get(col);
      if (h === undefined) continue;
      if (hits(k, state)) {
        if (y + 1 > h) this.heights[k]!.set(col, y + 1);
      } else if (y + 1 === h) this.heights[k]!.delete(col);
    }
    return true;
  }

  /** Cached column heights per heightmap kind (world surface, ocean floor, motion blocking, no leaves). */
  private readonly heights = [new Map<number, number>(), new Map<number, number>(), new Map<number, number>(), new Map<number, number>()];

  /** WorldGenRegion.getHeight: the first free y above the highest block matching the heightmap. */
  getHeight(type: HeightmapType, x: number, z: number): number {
    const k = KIND[type];
    const col = colKey(x, z);
    let h = this.heights[k]!.get(col);
    if (h === undefined) {
      h = 0;
      const w = this.world;
      for (let y = 255; y >= 0; y--)
        if (hits(k, w.getState(x, y, z))) {
          h = y + 1;
          break;
        }
      this.heights[k]!.set(col, h);
    }
    return h;
  }

  /** Fluid ticks scheduled by features (springs, delay 0); the server schedules them after decoration. */
  readonly fluidTicks: [number, number, number][] = [];
  scheduleFluidTick(x: number, y: number, z: number): void {
    this.fluidTicks.push([x, y, z]);
  }

  /** Biome at a block (BiomeManager with the fuzzy zoom). */
  biome(x: number, z: number): number {
    return this.gen.blockBiome(x, z);
  }

  /**
   * Sky light > 0 during generation (light isn't computed yet): approximated as "nothing that
   * blocks light above", which is where vanilla's later sky light would reach.
   */
  canSeeSky(x: number, y: number, z: number): boolean {
    return y >= this.getHeight('MOTION_BLOCKING', x, z);
  }
}
