/**
 * Chunk column serialization, shared by the network protocol and the save format.
 * Sections are paletted: a palette of state ids + 8-bit or 16-bit indices.
 */
import { Chunk, ChunkSection, SECTION_VOLUME } from '../world/chunk';
import { ByteReader, ByteWriter } from './buffer';

const F_BLOCKS = 1;
const F_LIGHT = 2;
const F_PALETTE8 = 4;

export function writeSection(w: ByteWriter, s: ChunkSection, withLight: boolean): void {
  let flags = 0;
  const blocks = s.blocks;
  let palette: number[] | null = null;
  let indices: Uint8Array | null = null;
  if (blocks) {
    flags |= F_BLOCKS;
    const map = new Map<number, number>();
    const idx = new Uint8Array(SECTION_VOLUME);
    let ok = true;
    for (let i = 0; i < SECTION_VOLUME; i++) {
      const st = blocks[i]!;
      let p = map.get(st);
      if (p === undefined) {
        if (map.size === 256) {
          ok = false;
          break;
        }
        p = map.size;
        map.set(st, p);
      }
      idx[i] = p;
    }
    if (ok) {
      flags |= F_PALETTE8;
      palette = [...map.keys()];
      indices = idx;
    }
  }
  if (withLight && s.light) flags |= F_LIGHT;
  w.u8(flags);
  w.u16(s.nonAir);
  if (blocks) {
    if (palette && indices) {
      w.u16(palette.length);
      for (const p of palette) w.u16(p);
      w.bytes(indices);
    } else {
      w.u16array(blocks);
    }
  }
  if (withLight) {
    if (s.light) w.bytes(s.light);
    else w.u8(s.uniformLight);
  }
}

export function readSection(r: ByteReader, s: ChunkSection, withLight: boolean): void {
  const flags = r.u8();
  s.nonAir = r.u16();
  if (flags & F_BLOCKS) {
    if (flags & F_PALETTE8) {
      const n = r.u16();
      const palette = new Uint16Array(n);
      for (let i = 0; i < n; i++) palette[i] = r.u16();
      const idx = r.bytes(SECTION_VOLUME);
      const b = new Uint16Array(SECTION_VOLUME);
      for (let i = 0; i < SECTION_VOLUME; i++) b[i] = palette[idx[i]!]!;
      s.blocks = b;
    } else {
      s.blocks = new Uint16Array(r.u16array(SECTION_VOLUME));
    }
  } else {
    s.blocks = null;
  }
  if (withLight) {
    if (flags & F_LIGHT) {
      s.light = r.bytes(SECTION_VOLUME);
    } else {
      s.light = null;
      s.uniformLight = r.u8();
    }
  }
}

export function writeChunk(w: ByteWriter, c: Chunk, withLight = true): void {
  w.i32(c.x).i32(c.z);
  w.bytes(c.biomes);
  for (let i = 0; i < 256; i++) w.i16(c.skyTop[i]!);
  for (let i = 0; i < 256; i++) w.i16(c.motionBlocking[i]!);
  for (const s of c.sections) writeSection(w, s, withLight);
}

export function readChunk(r: ByteReader, withLight = true): Chunk {
  const c = new Chunk(r.i32(), r.i32());
  c.biomes.set(r.bytes(1024));
  for (let i = 0; i < 256; i++) c.skyTop[i] = r.i16();
  for (let i = 0; i < 256; i++) c.motionBlocking[i] = r.i16();
  for (const s of c.sections) readSection(r, s, withLight);
  c.lit = withLight;
  return c;
}
