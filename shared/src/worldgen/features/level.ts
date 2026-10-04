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
    return true;
  }

  /** WorldGenRegion.getHeight: the first free y above the highest block matching the heightmap. */
  getHeight(type: HeightmapType, x: number, z: number): number {
    const w = this.world;
    for (let y = 255; y >= 0; y--) {
      const s = w.getState(x, y, z);
      let hit: boolean;
      switch (type) {
        case 'WORLD_SURFACE_WG': case 'WORLD_SURFACE': hit = IS_AIR[s] !== 1; break;
        case 'OCEAN_FLOOR_WG': case 'OCEAN_FLOOR': hit = MATERIAL_BLOCKS_MOTION[s] === 1; break;
        case 'MOTION_BLOCKING': hit = MATERIAL_BLOCKS_MOTION[s] === 1 || FLUID[s] !== 0; break;
        default: hit = (MATERIAL_BLOCKS_MOTION[s] === 1 || FLUID[s] !== 0) && LEAVES[s] !== 1;
      }
      if (hit) return y + 1;
    }
    return 0;
  }

  /** Fluid ticks scheduled by features (springs); fluids don't flow yet, so nothing consumes them. */
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
