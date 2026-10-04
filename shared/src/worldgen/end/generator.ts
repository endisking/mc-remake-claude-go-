/**
 * The 1.17.1 End chunk generator (NoiseBasedChunkGenerator + "end" noise settings +
 * TheEndBiomeSource): end stone wherever the island density is positive, air elsewhere (default
 * fluid air, sea level 0, no bedrock, no carvers). Every End biome uses the "end" surface builder
 * (default builder with end stone top/under material), which leaves end stone unchanged, so no
 * surface pass is needed. Then the biomes' features (spikes, chorus, small islands, gateways)
 * through the data-driven feature engine.
 */
import { Chunk } from '../../world/chunk';
import { stateOf } from '../../world/blockstate';
import { obfuscateSeed, zoomToQuart } from '../biome/zoom';
import { decorateChunk } from '../overworld/features';
import type { BlockWorld } from '../../world/world';
import { EndBiomeSource } from './biomesource';
import { EndTerrain, END_NOISE_HEIGHT } from './terrain';

const END_STONE = stateOf('end_stone');

export class EndGenerator {
  readonly biomeSeed: bigint;
  readonly biomes: EndBiomeSource;
  readonly terrain: EndTerrain;
  readonly seaLevel = 0;
  readonly genDepth = END_NOISE_HEIGHT;
  private readonly density = new Float64Array(65536);
  private readonly q: [number, number] = [0, 0];

  constructor(readonly seed: bigint) {
    this.biomeSeed = obfuscateSeed(seed);
    this.biomes = new EndBiomeSource(seed);
    this.terrain = new EndTerrain(seed);
  }

  quartBiome(qx: number, qz: number): number {
    return this.biomes.getNoiseBiome(qx, qz);
  }

  /** Biome at a block (the End's biomes don't vary with y, so the column zoom is used). */
  blockBiome(x: number, z: number): number {
    zoomToQuart(this.biomeSeed, x, z, this.q);
    return this.biomes.getNoiseBiome(this.q[0], this.q[1]);
  }

  topMaterialIsMycelium(): boolean {
    return false;
  }

  decorate(world: BlockWorld, cx: number, cz: number): [number, number, number][] {
    return decorateChunk(this, world, cx, cz);
  }

  generate(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    for (let qz = 0; qz < 4; qz++)
      for (let qx = 0; qx < 4; qx++) {
        const b = this.quartBiome(cx * 4 + qx, cz * 4 + qz);
        for (let qy = 0; qy < 64; qy++) chunk.biomes[(qy << 4) | (qz << 2) | qx] = b;
      }
    const d = this.density;
    this.terrain.fillChunk(cx, cz, d);
    for (let s = 0; s < END_NOISE_HEIGHT >> 4; s++) {
      let any = false;
      const base = s * 4096;
      for (let i = 0; i < 4096; i++) if (d[base + i]! > 0) { any = true; break; }
      if (!any) continue;
      const blocks = new Uint16Array(4096);
      for (let i = 0; i < 4096; i++) if (d[base + i]! > 0) blocks[i] = END_STONE;
      const sec = chunk.sections[s]!;
      sec.blocks = blocks;
      sec.recount();
    }
    chunk.computeHeightmaps();
    return chunk;
  }

  /** Top solid y at a block column (for the dragon fight's podium), -1 when there's none. Generates from noise only. */
  noiseHeight(x: number, z: number): number {
    const cx = x >> 4, cz = z >> 4;
    this.terrain.fillChunk(cx, cz, this.density);
    for (let y = END_NOISE_HEIGHT - 1; y >= 0; y--) if (this.density[(y << 8) | ((z & 15) << 4) | (x & 15)]! > 0) return y;
    return -1;
  }
}
