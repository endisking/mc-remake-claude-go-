/**
 * Chunk storage. A chunk column is 16×256×16 (world height 0–255, 1.17.1), split into
 * 16 sections of 16×16×16. Sections that are entirely air and uniformly lit keep no
 * arrays at all, which keeps memory low on school laptops.
 */
import { IS_AIR, COLLISION_SHAPE_ID, FLUID } from './blockinfo';

/** Vanilla MOTION_BLOCKING heightmap predicate: blocks movement or holds fluid. */
export function blocksMotion(state: number): boolean {
  return COLLISION_SHAPE_ID[state] !== 0 || FLUID[state] !== 0;
}

export const SECTION_SIZE = 16;
export const SECTION_VOLUME = 4096;
export const WORLD_HEIGHT = 256;
export const SECTIONS_PER_CHUNK = 16;
export const MIN_Y = 0;
export const MAX_Y = 255;

/** Index of a block inside a section: y-major, then z, then x. */
export function sectionIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

export class ChunkSection {
  /** Block states, or null when the section is all air. */
  blocks: Uint16Array | null = null;
  /** Packed light: high nibble sky, low nibble block. Null means every cell = uniformLight. */
  light: Uint8Array | null = null;
  uniformLight = 0xf0;
  nonAir = 0;

  getState(i: number): number {
    return this.blocks ? this.blocks[i]! : 0;
  }

  /** Set a state; returns the previous state. */
  setState(i: number, state: number): number {
    let blocks = this.blocks;
    if (!blocks) {
      if (state === 0) return 0;
      blocks = this.blocks = new Uint16Array(SECTION_VOLUME);
    }
    const old = blocks[i]!;
    if (old === state) return old;
    blocks[i] = state;
    const wasAir = IS_AIR[old] === 1;
    const isAir = IS_AIR[state] === 1;
    if (wasAir && !isAir) this.nonAir++;
    else if (!wasAir && isAir) this.nonAir--;
    return old;
  }

  getLight(i: number): number {
    return this.light ? this.light[i]! : this.uniformLight;
  }

  setLight(i: number, packed: number): void {
    let light = this.light;
    if (!light) {
      if (packed === this.uniformLight) return;
      light = this.light = new Uint8Array(SECTION_VOLUME).fill(this.uniformLight);
    }
    light[i] = packed;
  }

  getSky(i: number): number {
    return this.getLight(i) >> 4;
  }
  getBlockLight(i: number): number {
    return this.getLight(i) & 15;
  }
  setSky(i: number, v: number): void {
    this.setLight(i, (this.getLight(i) & 0x0f) | (v << 4));
  }
  setBlockLight(i: number, v: number): void {
    this.setLight(i, (this.getLight(i) & 0xf0) | v);
  }

  /** True when the section holds no non-air blocks (may still hold cave_air). */
  isEmpty(): boolean {
    return this.nonAir === 0;
  }

  /** Recount non-air blocks (after bulk writes into `blocks`). */
  recount(): void {
    const b = this.blocks;
    if (!b) {
      this.nonAir = 0;
      return;
    }
    let n = 0;
    let any = false;
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const s = b[i]!;
      if (s !== 0) any = true;
      if (IS_AIR[s] !== 1) n++;
    }
    this.nonAir = n;
    if (!any) this.blocks = null;
  }

  /** Drop the light array if every cell holds the same value. */
  compactLight(): void {
    const l = this.light;
    if (!l) return;
    const v = l[0]!;
    for (let i = 1; i < SECTION_VOLUME; i++) if (l[i] !== v) return;
    this.light = null;
    this.uniformLight = v;
  }
}

export class Chunk {
  readonly sections: ChunkSection[] = [];
  /** Biomes in 4×4×4 cells: index (y>>2)<<4 | (z>>2)<<2 | (x>>2). 64*16 = 1024 entries. */
  readonly biomes = new Uint8Array(1024);
  /** lazily filled block-resolution biomes (fuzzy zoom), 255 = not computed; see BlockWorld.getBiome */
  blockBiomes: Uint8Array | null = null;
  /**
   * Height of the lowest y above which sky light falls unobstructed (y of the topmost
   * light-filtering block + 1). Indexed z*16+x.
   */
  readonly skyTop = new Int16Array(256);
  /** MOTION_BLOCKING heightmap: y+1 of the highest motion-blocking or fluid block (0 if none). Indexed z*16+x. */
  readonly motionBlocking = new Int16Array(256);
  /** Set once lighting has been computed for this chunk. */
  lit = false;
  /** Incremented on every change; used by renderers/savers to detect dirtiness. */
  version = 0;

  constructor(
    readonly x: number,
    readonly z: number,
  ) {
    for (let i = 0; i < SECTIONS_PER_CHUNK; i++) this.sections.push(new ChunkSection());
  }

  getState(x: number, y: number, z: number): number {
    if (y < 0 || y > 255) return 0;
    return this.sections[y >> 4]!.getState(sectionIndex(x, y & 15, z));
  }

  setState(x: number, y: number, z: number, state: number): number {
    if (y < 0 || y > 255) return 0;
    this.version++;
    const old = this.sections[y >> 4]!.setState(sectionIndex(x, y & 15, z), state);
    const hi = z * 16 + x;
    const mb = this.motionBlocking[hi]!;
    if (blocksMotion(state)) {
      if (y + 1 > mb) this.motionBlocking[hi] = y + 1;
    } else if (y + 1 === mb) {
      let ny = y - 1;
      while (ny >= 0 && !blocksMotion(this.getState(x, ny, z))) ny--;
      this.motionBlocking[hi] = ny + 1;
    }
    return old;
  }

  /** Recompute heightmaps from scratch (after bulk generation). */
  computeHeightmaps(): void {
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let y = 255;
        while (y >= 0 && !blocksMotion(this.getState(x, y, z))) y--;
        this.motionBlocking[z * 16 + x] = y + 1;
      }
  }

  getLight(x: number, y: number, z: number): number {
    if (y > 255) return 0xf0;
    if (y < 0) return 0;
    return this.sections[y >> 4]!.getLight(sectionIndex(x, y & 15, z));
  }

  getBiome(x: number, y: number, z: number): number {
    const cy = Math.max(0, Math.min(63, y >> 2));
    return this.biomes[(cy << 4) | ((z >> 2) << 2) | (x >> 2)]!;
  }

  setBiome(qx: number, qy: number, qz: number, biome: number): void {
    this.biomes[(qy << 4) | (qz << 2) | qx] = biome;
  }

  /** Highest non-air block y in a column, or -1. */
  topY(x: number, z: number): number {
    for (let s = SECTIONS_PER_CHUNK - 1; s >= 0; s--) {
      const sec = this.sections[s]!;
      if (sec.isEmpty()) continue;
      for (let y = 15; y >= 0; y--) if (IS_AIR[sec.getState(sectionIndex(x, y, z))] !== 1) return (s << 4) | y;
    }
    return -1;
  }
}

/** Pack chunk coordinates into a single safe-integer map key. */
export function chunkKey(cx: number, cz: number): number {
  return (cx + 0x200000) * 0x400000 + (cz + 0x200000);
}
export function chunkKeyX(key: number): number {
  return Math.floor(key / 0x400000) - 0x200000;
}
export function chunkKeyZ(key: number): number {
  return (key % 0x400000) - 0x200000;
}
