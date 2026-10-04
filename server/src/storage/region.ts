/**
 * Region files, after vanilla's Anvil layout: one file holds the 32×32 chunks of a region,
 * with a header table of (sector offset, byte length) per chunk followed by the chunk records
 * padded to 4 KiB sectors.
 *
 *   0..7      magic "BCRGN\0\0\x01"
 *   8..8199   1024 × (u32 sector offset, u32 byte length), little-endian, index (z&31)*32 + (x&31)
 *   then      sectors (4096 bytes); a chunk's record starts at offset*4096
 *
 * This module is pure (no fs); the disk storage and the zip exporter both use it.
 */

export const REGION_SIZE = 32;
export const SECTOR = 4096;
const MAGIC = [0x42, 0x43, 0x52, 0x47, 0x4e, 0, 0, 1];
const HEADER = 8 + REGION_SIZE * REGION_SIZE * 8;
const HEADER_SECTORS = Math.ceil(HEADER / SECTOR);

export function regionOf(cx: number, cz: number): [number, number] {
  return [cx >> 5, cz >> 5];
}

export function regionFileName(rx: number, rz: number): string {
  return `r.${rx}.${rz}.bcr`;
}

export function parseRegionFileName(name: string): [number, number] | null {
  const m = /^r\.(-?\d+)\.(-?\d+)\.bcr$/.exec(name);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Index within a region of chunk (cx, cz). */
export function regionIndex(cx: number, cz: number): number {
  return (cz & 31) * 32 + (cx & 31);
}

/** In-memory region: local index → record bytes. */
export class Region {
  readonly chunks = new Map<number, Uint8Array>();

  constructor(
    readonly rx: number,
    readonly rz: number,
  ) {}

  get(cx: number, cz: number): Uint8Array | null {
    return this.chunks.get(regionIndex(cx, cz)) ?? null;
  }

  set(cx: number, cz: number, data: Uint8Array): void {
    this.chunks.set(regionIndex(cx, cz), data);
  }

  /** Chunk coordinates present in this region. */
  coords(): [number, number][] {
    return [...this.chunks.keys()].map((i) => [this.rx * 32 + (i & 31), this.rz * 32 + (i >> 5)]);
  }

  encode(): Uint8Array {
    let sectors = HEADER_SECTORS;
    const order = [...this.chunks.keys()].sort((a, b) => a - b);
    const placed: [number, number, Uint8Array][] = [];
    for (const i of order) {
      const d = this.chunks.get(i)!;
      placed.push([i, sectors, d]);
      sectors += Math.max(1, Math.ceil(d.length / SECTOR));
    }
    const out = new Uint8Array(sectors * SECTOR);
    out.set(MAGIC, 0);
    const view = new DataView(out.buffer);
    for (const [i, off, d] of placed) {
      view.setUint32(8 + i * 8, off, true);
      view.setUint32(8 + i * 8 + 4, d.length, true);
      out.set(d, off * SECTOR);
    }
    return out;
  }

  static decode(rx: number, rz: number, bytes: Uint8Array): Region {
    const r = new Region(rx, rz);
    if (bytes.length < HEADER) throw new Error('region file too short');
    for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) throw new Error('not a region file');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < REGION_SIZE * REGION_SIZE; i++) {
      const off = view.getUint32(8 + i * 8, true);
      const len = view.getUint32(8 + i * 8 + 4, true);
      if (off === 0 || len === 0) continue;
      const start = off * SECTOR;
      if (off < HEADER_SECTORS || start + len > bytes.length) continue; // corrupt entry: treat as missing
      r.chunks.set(i, bytes.slice(start, start + len));
    }
    return r;
  }
}
