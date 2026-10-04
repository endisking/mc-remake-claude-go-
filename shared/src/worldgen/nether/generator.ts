/**
 * The 1.17.1 Nether chunk generator (NoiseBasedChunkGenerator + "nether" noise settings +
 * MultiNoiseBiomeSource "nether" preset): biomes, noise (netherrack, lava sea below y 32, air
 * above 127), surface builders, bedrock roof (y 127 down) and floor (y 0 up), the nether cave
 * carver, then the biomes' features through the data-driven feature engine.
 */
import { Chunk } from '../../world/chunk';
import { stateOf } from '../../world/blockstate';
import { obfuscateSeed, zoomToQuart } from '../biome/zoom';
import { seeded, terrainSeed } from '../rand';
import { decorateChunk } from '../overworld/features';
import type { BlockWorld } from '../../world/world';
import type { ProtoBlocks } from '../overworld/surface';
import { NetherBiomeSource } from './biomesource';
import { NetherTerrain, NETHER_SEA_LEVEL, NETHER_NOISE_HEIGHT } from './terrain';
import { NetherSurfaceBuilders } from './surface';
import { NetherCarver } from './carver';

const NETHERRACK = stateOf('netherrack');
const LAVA = stateOf('lava', { level: 0 });
const BEDROCK = stateOf('bedrock');

export class NetherGenerator {
  readonly biomeSeed: bigint;
  readonly biomes: NetherBiomeSource;
  readonly terrain: NetherTerrain;
  readonly surface: NetherSurfaceBuilders;
  readonly carver: NetherCarver;
  readonly seaLevel = NETHER_SEA_LEVEL;
  private readonly density = new Float64Array(65536);
  private readonly q: [number, number] = [0, 0];

  constructor(readonly seed: bigint) {
    this.biomeSeed = obfuscateSeed(seed);
    this.biomes = new NetherBiomeSource(seed);
    this.terrain = new NetherTerrain(seed);
    this.surface = new NetherSurfaceBuilders(seed);
    this.carver = new NetherCarver(seed);
  }

  quartBiome(qx: number, qz: number): number {
    return this.biomes.getNoiseBiome(qx, qz);
  }

  /** Biome at a block. Vanilla's nether uses the 3D fuzzy zoom; the biomes don't vary with y, so the column zoom is used. */
  blockBiome(x: number, z: number): number {
    zoomToQuart(this.biomeSeed, x, z, this.q);
    return this.biomes.getNoiseBiome(this.q[0], this.q[1]);
  }

  topMaterialIsMycelium(): boolean {
    return false;
  }

  /** Features; returns the fluid ticks they scheduled (springs). */
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
    const blocks: ProtoBlocks = new Uint16Array(65536);
    const d = this.density;
    this.terrain.fillChunk(cx, cz, d);
    const top = NETHER_NOISE_HEIGHT << 8;
    for (let i = 0; i < top; i++) blocks[i] = d[i]! > 0 ? NETHERRACK : i >> 8 < NETHER_SEA_LEVEL ? LAVA : 0;
    // surface builders, then bedrock (same random)
    const rand = seeded(terrainSeed(cx, cz));
    const bx = cx << 4, bz = cz << 4;
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        const noise = this.terrain.surfaceDepthNoise(bx + x, bz + z);
        this.surface.build(this.blockBiome(bx + x, bz + z), blocks, rand, bx + x, bz + z, noise, NETHER_SEA_LEVEL);
      }
    // NoiseBasedChunkGenerator.setBedrock: roof at 127 - 0 and floor at 0, per column (x fastest)
    const roof = NETHER_NOISE_HEIGHT - 1;
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        for (let i = 0; i < 5; i++) if (i <= rand.nextInt(5)) blocks[((roof - i) << 8) | (z << 4) | x] = BEDROCK;
        for (let j = 4; j >= 0; j--) if (j <= rand.nextInt(5)) blocks[(j << 8) | (z << 4) | x] = BEDROCK;
      }
    chunk.carvingMasks = [this.carver.carve(blocks, cx, cz), null];
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
