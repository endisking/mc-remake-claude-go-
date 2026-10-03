/**
 * Binary game protocol. Every message is [u8 packet id][payload]. The same encoding is
 * used for the in-browser server worker (postMessage with transferable buffers), the
 * WebSocket dedicated server, and WebRTC data channels.
 */
import { ByteReader, ByteWriter } from './buffer';
import { readChunk, writeChunk, writeSection, readSection } from './chunkcodec';
import { Chunk, ChunkSection } from '../world/chunk';

export const PROTOCOL_VERSION = 1;

// ------------------------------------------------------------------ server → client
export type S2C =
  | { t: 'login'; entityId: number; gameMode: number; dimension: string; seed: bigint; x: number; y: number; z: number; yaw: number; pitch: number; simulationDistance: number }
  | { t: 'chunk'; chunk: Chunk }
  | { t: 'unloadChunk'; cx: number; cz: number }
  | { t: 'blockChange'; x: number; y: number; z: number; state: number }
  | { t: 'sectionLight'; cx: number; sy: number; cz: number; section: ChunkSection }
  | { t: 'time'; gameTime: number; dayTime: number; doDaylightCycle: boolean }
  | { t: 'teleport'; x: number; y: number; z: number; yaw: number; pitch: number }
  | { t: 'chat'; json: string }
  | { t: 'disconnect'; reason: string }
  | { t: 'weather'; rain: number; thunder: number };

const S2C_IDS = ['login', 'chunk', 'unloadChunk', 'blockChange', 'sectionLight', 'time', 'teleport', 'chat', 'disconnect', 'weather'] as const;

export function encodeS2C(p: S2C): ArrayBuffer {
  const w = new ByteWriter(p.t === 'chunk' ? 65536 : 64);
  w.u8(S2C_IDS.indexOf(p.t));
  switch (p.t) {
    case 'login':
      w.i32(p.entityId).u8(p.gameMode).str(p.dimension).i64(p.seed).f64(p.x).f64(p.y).f64(p.z).f32(p.yaw).f32(p.pitch).u8(p.simulationDistance);
      break;
    case 'chunk':
      writeChunk(w, p.chunk, true);
      break;
    case 'unloadChunk':
      w.i32(p.cx).i32(p.cz);
      break;
    case 'blockChange':
      w.i32(p.x).i16(p.y).i32(p.z).u16(p.state);
      break;
    case 'sectionLight':
      w.i32(p.cx).u8(p.sy).i32(p.cz);
      writeLightOnly(w, p.section);
      break;
    case 'time':
      w.f64(p.gameTime).f64(p.dayTime).bool(p.doDaylightCycle);
      break;
    case 'teleport':
      w.f64(p.x).f64(p.y).f64(p.z).f32(p.yaw).f32(p.pitch);
      break;
    case 'chat':
      w.str(p.json);
      break;
    case 'disconnect':
      w.str(p.reason);
      break;
    case 'weather':
      w.f32(p.rain).f32(p.thunder);
      break;
  }
  return w.finish();
}

function writeLightOnly(w: ByteWriter, s: ChunkSection): void {
  if (s.light) {
    w.u8(1);
    w.bytes(s.light);
  } else {
    w.u8(0);
    w.u8(s.uniformLight);
  }
}

function readLightOnly(r: ByteReader): ChunkSection {
  const s = new ChunkSection();
  if (r.u8() === 1) s.light = r.bytes(4096);
  else s.uniformLight = r.u8();
  return s;
}

export function decodeS2C(buf: ArrayBuffer): S2C {
  const r = new ByteReader(buf);
  const t = S2C_IDS[r.u8()];
  switch (t) {
    case 'login':
      return { t, entityId: r.i32(), gameMode: r.u8(), dimension: r.str(), seed: r.i64(), x: r.f64(), y: r.f64(), z: r.f64(), yaw: r.f32(), pitch: r.f32(), simulationDistance: r.u8() };
    case 'chunk':
      return { t, chunk: readChunk(r, true) };
    case 'unloadChunk':
      return { t, cx: r.i32(), cz: r.i32() };
    case 'blockChange':
      return { t, x: r.i32(), y: r.i16(), z: r.i32(), state: r.u16() };
    case 'sectionLight':
      return { t, cx: r.i32(), sy: r.u8(), cz: r.i32(), section: readLightOnly(r) };
    case 'time':
      return { t, gameTime: r.f64(), dayTime: r.f64(), doDaylightCycle: r.bool() };
    case 'teleport':
      return { t, x: r.f64(), y: r.f64(), z: r.f64(), yaw: r.f32(), pitch: r.f32() };
    case 'chat':
      return { t, json: r.str() };
    case 'disconnect':
      return { t, reason: r.str() };
    case 'weather':
      return { t, rain: r.f32(), thunder: r.f32() };
    default:
      throw new Error('unknown S2C packet');
  }
}

// ------------------------------------------------------------------ client → server
export type C2S =
  | { t: 'hello'; protocol: number; name: string; viewDistance: number }
  | { t: 'move'; x: number; y: number; z: number; yaw: number; pitch: number; onGround: boolean }
  | { t: 'settings'; viewDistance: number }
  | { t: 'chat'; message: string }
  | { t: 'setBlock'; x: number; y: number; z: number; state: number };

const C2S_IDS = ['hello', 'move', 'settings', 'chat', 'setBlock'] as const;

export function encodeC2S(p: C2S): ArrayBuffer {
  const w = new ByteWriter(64);
  w.u8(C2S_IDS.indexOf(p.t));
  switch (p.t) {
    case 'hello':
      w.u16(p.protocol).str(p.name).u8(p.viewDistance);
      break;
    case 'move':
      w.f64(p.x).f64(p.y).f64(p.z).f32(p.yaw).f32(p.pitch).bool(p.onGround);
      break;
    case 'settings':
      w.u8(p.viewDistance);
      break;
    case 'chat':
      w.str(p.message);
      break;
    case 'setBlock':
      w.i32(p.x).i16(p.y).i32(p.z).u16(p.state);
      break;
  }
  return w.finish();
}

export function decodeC2S(buf: ArrayBuffer): C2S {
  const r = new ByteReader(buf);
  const t = C2S_IDS[r.u8()];
  switch (t) {
    case 'hello':
      return { t, protocol: r.u16(), name: r.str(), viewDistance: r.u8() };
    case 'move':
      return { t, x: r.f64(), y: r.f64(), z: r.f64(), yaw: r.f32(), pitch: r.f32(), onGround: r.bool() };
    case 'settings':
      return { t, viewDistance: r.u8() };
    case 'chat':
      return { t, message: r.str() };
    case 'setBlock':
      return { t, x: r.i32(), y: r.i16(), z: r.i32(), state: r.u16() };
    default:
      throw new Error('unknown C2S packet');
  }
}

export { writeSection, readSection };
