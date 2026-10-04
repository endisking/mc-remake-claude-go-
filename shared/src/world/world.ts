/**
 * A dimension's block storage: a map of chunk columns with block/light accessors.
 * Shared by the server (authoritative) and the client (mirror for rendering/prediction).
 */
import { zoomToQuart } from '../worldgen/biome/zoom';
import { Chunk, chunkKey, sectionIndex } from './chunk';

export class BlockWorld {
  readonly chunks = new Map<number, Chunk>();
  private lastKey = NaN;
  private lastChunk: Chunk | undefined;

  getChunk(cx: number, cz: number): Chunk | undefined {
    const key = chunkKey(cx, cz);
    if (key === this.lastKey) return this.lastChunk;
    const c = this.chunks.get(key);
    this.lastKey = key;
    this.lastChunk = c;
    return c;
  }

  addChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.x, chunk.z), chunk);
    this.lastKey = NaN;
  }

  removeChunk(cx: number, cz: number): Chunk | undefined {
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    this.chunks.delete(key);
    this.lastKey = NaN;
    return c;
  }

  getChunkAt(x: number, z: number): Chunk | undefined {
    return this.getChunk(x >> 4, z >> 4);
  }

  isLoaded(x: number, z: number): boolean {
    return this.getChunk(x >> 4, z >> 4) !== undefined;
  }

  getState(x: number, y: number, z: number): number {
    if (y < 0 || y > 255) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.sections[y >> 4]!.getState(sectionIndex(x & 15, y & 15, z & 15));
  }

  /** Raw write without light or neighbor updates. Returns the old state. */
  setStateRaw(x: number, y: number, z: number, state: number): number {
    if (y < 0 || y > 255) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.setState(x & 15, y, z & 15, state);
  }

  /** Packed light (sky << 4 | block). Above the world: full sky; unloaded: dark. */
  getLight(x: number, y: number, z: number): number {
    if (y > 255) return 0xf0;
    if (y < 0) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.sections[y >> 4]!.getLight(sectionIndex(x & 15, y & 15, z & 15));
  }

  getSkyLight(x: number, y: number, z: number): number {
    return this.getLight(x, y, z) >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    return this.getLight(x, y, z) & 15;
  }

  /**
   * BiomeManager's hashed seed. When set, block biomes use vanilla's fuzzy zoom between quart
   * cells (FuzzyOffsetConstantColumnBiomeZoomer); otherwise the quart cell is used directly.
   */
  biomeZoomSeed: bigint | null = null;
  private readonly zq: [number, number] = [0, 0];

  getBiome(x: number, y: number, z: number): number {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 1;
    if (this.biomeZoomSeed === null) return c.getBiome(x & 15, y, z & 15);
    const i = ((z & 15) << 4) | (x & 15);
    const cache = (c.blockBiomes ??= new Uint8Array(256).fill(255));
    if (cache[i] !== 255) return cache[i]!;
    zoomToQuart(this.biomeZoomSeed, x, z, this.zq);
    const qx = this.zq[0], qz = this.zq[1];
    const src = this.getChunk(qx >> 2, qz >> 2);
    // the chosen cell may lie in a neighbour that isn't loaded yet: answer without caching
    if (!src) return c.getBiome(Math.max(0, Math.min(15, (qx << 2) - (c.x << 4))), y, Math.max(0, Math.min(15, (qz << 2) - (c.z << 4))));
    return (cache[i] = src.biomes[((qz & 3) << 2) | (qx & 3)]!);
  }
}
