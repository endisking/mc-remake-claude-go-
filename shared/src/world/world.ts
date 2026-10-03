/**
 * A dimension's block storage: a map of chunk columns with block/light accessors.
 * Shared by the server (authoritative) and the client (mirror for rendering/prediction).
 */
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

  getBiome(x: number, y: number, z: number): number {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.getBiome(x & 15, y, z & 15) : 1;
  }
}
