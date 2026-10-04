/**
 * The 1.17.1 overworld chunk generator's first stages (vanilla ChunkStatus BIOMES → NOISE →
 * SURFACE): quart biomes from the layer stack, terrain density, surface builders and the bedrock
 * floor. Carvers, features and structures run on the result in later stages.
 */
import { Chunk } from '../../world/chunk';
import { stateOf } from '../../world/blockstate';
import { OverworldLayers } from '../biome/layers';
import { obfuscateSeed, zoomToQuart } from '../biome/zoom';
import { TerrainNoise, SEA_LEVEL } from './terrain';
import { SurfaceBuilders, placeBedrock, type ProtoBlocks } from './surface';
import { seeded, terrainSeed } from '../rand';
import { Carvers } from './carvers';
import { decorateChunk } from './features';
import { B } from '../biome/biomeids';
import type { BlockWorld } from '../../world/world';

const STONE = stateOf('stone');
const WATER = stateOf('water', { level: 0 });

export interface OverworldOptions {
  largeBiomes?: boolean;
  amplified?: boolean;
}

export class OverworldGenerator {
  readonly layers: OverworldLayers;
  /** BiomeManager.obfuscateSeed(seed) — also what clients use for block biomes */
  readonly biomeSeed: bigint;
  readonly terrain: TerrainNoise;
  readonly surface: SurfaceBuilders;
  readonly carvers: Carvers;
  private readonly density = new Float64Array(65536);
  private readonly q: [number, number] = [0, 0];

  constructor(readonly seed: bigint, opts: OverworldOptions = {}) {
    this.layers = new OverworldLayers(seed, !!opts.largeBiomes);
    this.biomeSeed = obfuscateSeed(seed);
    this.terrain = new TerrainNoise(seed, this.layers.quart, !!opts.amplified);
    this.surface = new SurfaceBuilders(seed);
    this.carvers = new Carvers(seed);
  }

  /** Biome at quart coordinates (OverworldBiomeSource.getNoiseBiome). */
  quartBiome(qx: number, qz: number): number {
    return this.layers.quart.get(qx, qz);
  }

  /** Biome at a block (BiomeManager.getBiome with the fuzzy zoom). */
  blockBiome(x: number, z: number): number {
    zoomToQuart(this.biomeSeed, x, z, this.q);
    return this.layers.quart.get(this.q[0], this.q[1]);
  }

  /** The biome's surface builder puts mycelium on top (lakes regrow it instead of grass). */
  topMaterialIsMycelium(biome: number): boolean {
    return biome === B.mushroom_fields || biome === B.mushroom_field_shore;
  }

  /**
   * ChunkStatus.FEATURES for chunk (cx, cz): runs once its 8 neighbours are carved; features may
   * write into those neighbours through `world`.
   */
  decorate(world: BlockWorld, cx: number, cz: number): [number, number, number][] {
    return decorateChunk(this, world, cx, cz);
  }

  /** Terrain + surface + bedrock for one chunk, as a fresh Chunk (sections and heightmaps filled). */
  generate(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    // biomes (ChunkStatus.BIOMES): the overworld has no vertical biome variation
    for (let qz = 0; qz < 4; qz++)
      for (let qx = 0; qx < 4; qx++) {
        const b = this.quartBiome(cx * 4 + qx, cz * 4 + qz);
        for (let qy = 0; qy < 64; qy++) chunk.biomes[(qy << 4) | (qz << 2) | qx] = b;
      }
    // noise
    const blocks: ProtoBlocks = new Uint16Array(65536);
    const d = this.density;
    this.terrain.fillChunk(cx, cz, d);
    for (let i = 0; i < 65536; i++) blocks[i] = d[i]! > 0 ? STONE : i >> 8 < SEA_LEVEL ? WATER : 0;
    // surface (WORLD_SURFACE_WG height + 1 as the start), x outer, z inner, then bedrock
    const rand = seeded(terrainSeed(cx, cz));
    const bx = cx << 4, bz = cz << 4;
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        let top = 255;
        while (top >= 0 && blocks[(top << 8) | (z << 4) | x] === 0) top--;
        const start = top + 1;
        const noise = this.terrain.surfaceNoise.getSurfaceNoiseValue((bx + x) * 0.0625, (bz + z) * 0.0625) * 15;
        this.surface.build(this.blockBiome(bx + x, bz + z), blocks, rand, bx + x, bz + z, start, noise);
      }
    placeBedrock(blocks, rand);
    // carvers (ChunkStatus.CARVERS, LIQUID_CARVERS): the carver list comes from this chunk's corner biome
    this.carvers.carve({ blocks, cx, cz, biomeAt: (x, z) => this.blockBiome(x, z) }, this.quartBiome(cx << 2, cz << 2));
    for (let s = 0; s < 16; s++) {
      const sec = chunk.sections[s]!;
      const part = blocks.subarray(s * 4096, (s + 1) * 4096);
      if (part.some((v) => v !== 0)) {
        sec.blocks = part.slice();
        sec.recount();
      }
    }
    chunk.computeHeightmaps();
    return chunk;
  }
}
