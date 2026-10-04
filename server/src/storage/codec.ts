/**
 * Save-format encoding: chunk records (generation stage + lit flag + the shared chunk codec,
 * deflate-compressed when the platform has CompressionStream) and player data.
 */
import type { Chunk } from '@shared/world/chunk';
import { writeChunk, readChunk } from '@shared/protocol/chunkcodec';
import { ByteWriter, ByteReader } from '@shared/protocol/buffer';
import type { ServerPlayer } from '../game/player';
import { SAVE_FORMAT_VERSION, type PlayerData } from './types';

/** 1: stage, lit, chunk; 2: + carving masks (kept until the chunk is decorated); 3: + block entities (in the chunk body); 4: + entities (mob saves, JSON). */
const CHUNK_FORMAT = 4;

/** Entity save data read with a chunk (deserializeChunk) — the mobs that were in it. */
export const chunkEntities = new WeakMap<Chunk, unknown[]>();
const COMP_NONE = 0;
const COMP_DEFLATE = 1;

const hasStreams = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new CompressionStream('deflate'));
}

export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream('deflate'));
}

/** Serialize a chunk synchronously (snapshot), uncompressed. */
export function serializeChunk(c: Chunk, entities?: unknown[]): Uint8Array {
  const w = new ByteWriter(65536);
  w.u8(CHUNK_FORMAT).u8(c.stage).u8(c.lit ? 1 : 0);
  writeChunk(w, c, true);
  const masks = c.carvingMasks;
  w.u8(masks ? masks.length : 0);
  for (const m of masks ?? []) {
    w.u32(m ? m.length : 0);
    if (m) w.bytes(m);
  }
  const ents = entities && entities.length ? new TextEncoder().encode(JSON.stringify(entities)) : null;
  w.u32(ents ? ents.length : 0);
  if (ents) w.bytes(ents);
  return new Uint8Array(w.finish());
}

export function deserializeChunk(raw: Uint8Array): Chunk {
  const r = new ByteReader(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  const format = r.u8();
  if (format < 1 || format > 4) throw new Error(`unknown chunk format ${format}`);
  const stage = r.u8();
  const lit = r.u8() === 1;
  const c = readChunk(r, true, format >= 3);
  if (format >= 2) {
    const n = r.u8();
    if (n) {
      c.carvingMasks = [];
      for (let i = 0; i < n; i++) {
        const len = r.u32();
        c.carvingMasks.push(len ? r.bytes(len) : null);
      }
    }
  }
  if (format >= 4) {
    const n = r.u32();
    if (n) chunkEntities.set(c, JSON.parse(new TextDecoder().decode(r.bytes(n))) as unknown[]);
  }
  c.stage = stage;
  c.lit = lit;
  return c;
}

/** Compress a serialized chunk into a storage record. */
export async function packRecord(raw: Uint8Array): Promise<Uint8Array> {
  const body = hasStreams ? await deflate(raw) : raw;
  const out = new Uint8Array(body.length + 1);
  out[0] = hasStreams ? COMP_DEFLATE : COMP_NONE;
  out.set(body, 1);
  return out;
}

export async function unpackRecord(rec: Uint8Array): Promise<Uint8Array> {
  const body = rec.subarray(1);
  if (rec[0] === COMP_NONE) return body;
  if (rec[0] === COMP_DEFLATE) return inflate(body);
  throw new Error(`unknown chunk compression ${rec[0]}`);
}

export async function encodeChunkRecord(c: Chunk): Promise<Uint8Array> {
  return packRecord(serializeChunk(c));
}

export async function decodeChunkRecord(rec: Uint8Array): Promise<Chunk> {
  return deserializeChunk(await unpackRecord(rec));
}

// ------------------------------------------------------------------ players
export function capturePlayer(p: ServerPlayer): PlayerData {
  const l = p.living;
  return {
    version: SAVE_FORMAT_VERSION,
    name: p.name,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    gameMode: p.gameMode,
    flying: p.flying,
    fallDistance: p.fallDistance,
    health: l.health,
    absorption: l.absorption,
    foodLevel: l.food.foodLevel,
    saturation: l.food.saturationLevel,
    exhaustion: l.food.exhaustionLevel,
    foodTickTimer: l.food.tickTimer,
    air: l.airSupply,
    fireTicks: l.remainingFireTicks,
    xpLevel: l.experienceLevel,
    xpProgress: l.experienceProgress,
    xpTotal: l.totalExperience,
    score: l.score,
    inventory: p.inventory.slots.map((s) => (s && s.count > 0 ? { ...s } : null)),
    enderItems: p.enderChest.map((s) => (s && s.count > 0 ? { ...s } : null)),
    selected: p.inventory.selected,
    respawn: p.respawn ? { ...p.respawn } : null,
  };
}

/** Restore saved state onto a freshly created player (before the login packet is sent). */
export function applyPlayer(p: ServerPlayer, d: PlayerData): void {
  const l = p.living;
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  p.x = num(d.x, p.x);
  p.y = num(d.y, p.y);
  p.z = num(d.z, p.z);
  p.yaw = num(d.yaw, 0);
  p.pitch = num(d.pitch, 0);
  p.headYaw = p.yaw;
  p.gameMode = num(d.gameMode, p.gameMode) | 0;
  p.flying = !!d.flying && (p.gameMode === 1 || p.gameMode === 3);
  if (p.gameMode === 3) p.flying = true;
  p.fallDistance = num(d.fallDistance, 0);
  l.health = num(d.health, 20);
  l.absorption = num(d.absorption, 0);
  l.food.foodLevel = num(d.foodLevel, 20);
  l.food.lastFoodLevel = l.food.foodLevel;
  l.food.saturationLevel = num(d.saturation, 5);
  l.food.exhaustionLevel = num(d.exhaustion, 0);
  l.food.tickTimer = num(d.foodTickTimer, 0);
  l.airSupply = num(d.air, 300);
  l.remainingFireTicks = num(d.fireTicks, -20);
  l.experienceLevel = num(d.xpLevel, 0);
  l.experienceProgress = num(d.xpProgress, 0);
  l.totalExperience = num(d.xpTotal, 0);
  l.score = num(d.score, 0);
  if (Array.isArray(d.enderItems)) {
    for (let i = 0; i < p.enderChest.length; i++) {
      const s = d.enderItems[i];
      p.enderChest[i] = s && typeof s.id === 'number' && s.count > 0 ? { ...s } : null;
    }
  }
  if (Array.isArray(d.inventory)) {
    for (let i = 0; i < p.inventory.slots.length; i++) {
      const s = d.inventory[i];
      p.inventory.set(i, s && typeof s.id === 'number' && s.count > 0 ? { ...s } : null);
    }
  }
  p.inventory.selected = Math.max(0, Math.min(8, num(d.selected, 0) | 0));
  p.respawn = d.respawn ? { ...d.respawn } : null;
}
