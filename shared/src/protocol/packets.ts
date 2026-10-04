/**
 * Binary game protocol. Every message is [u8 packet id][fields...]. Packets are declared as
 * typed field lists and encoded/decoded generically. The same bytes travel over the
 * in-browser worker channel, WebSockets (dedicated server) and WebRTC data channels (LAN).
 */
import { ByteReader, ByteWriter } from './buffer';
import { readChunk, writeChunk, writeSection, readSection } from './chunkcodec';
import { Chunk, ChunkSection } from '../world/chunk';

export const PROTOCOL_VERSION = 4;

type FieldType =
  | 'u8' | 'bool' | 'i16' | 'u16' | 'i32' | 'u32' | 'f32' | 'f64' | 'i64' | 'str' | 'varint' | 'svarint'
  | 'chunk' | 'light' | 'i32list' | 'bytes';

type TypeOf<T extends FieldType> = T extends 'bool' ? boolean : T extends 'str' ? string : T extends 'i64' ? bigint : T extends 'chunk' ? Chunk : T extends 'light' ? ChunkSection : T extends 'i32list' ? number[] : T extends 'bytes' ? Uint8Array : number;

type Schema = Record<string, readonly (readonly [string, FieldType])[]>;
type PacketsOf<S extends Schema> = {
  [K in keyof S]: { t: K } & { [F in S[K][number] as F[0]]: TypeOf<F[1]> };
}[keyof S];

// ------------------------------------------------------------------ server → client
const S2C_SCHEMA = {
  login: [['entityId', 'i32'], ['gameMode', 'u8'], ['dimension', 'str'], ['seed', 'i64'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['yaw', 'f32'], ['pitch', 'f32'], ['simulationDistance', 'u8']],
  chunk: [['chunk', 'chunk']],
  unloadChunk: [['cx', 'i32'], ['cz', 'i32']],
  blockChange: [['x', 'i32'], ['y', 'i16'], ['z', 'i32'], ['state', 'u16']],
  sectionLight: [['cx', 'i32'], ['sy', 'u8'], ['cz', 'i32'], ['section', 'light']],
  time: [['gameTime', 'f64'], ['dayTime', 'f64'], ['doDaylightCycle', 'bool']],
  teleport: [['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['yaw', 'f32'], ['pitch', 'f32']],
  chat: [['json', 'str']],
  disconnect: [['reason', 'str']],
  weather: [['rain', 'f32'], ['thunder', 'f32']],
  /** Another player became visible. */
  addPlayer: [['id', 'i32'], ['name', 'str'], ['skin', 'str'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['yaw', 'f32'], ['pitch', 'f32'], ['headYaw', 'f32']],
  removeEntities: [['ids', 'i32list']],
  /** Absolute entity position/rotation update (interpolated on the client over 3 ticks). */
  entityMove: [['id', 'i32'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['yaw', 'f32'], ['pitch', 'f32'], ['headYaw', 'f32'], ['onGround', 'bool']],
  /** Shared flags: 1 on fire, 2 crouching, 8 sprinting, 16 swimming, 32 invisible, 128 fall flying; pose name. */
  entityState: [['id', 'i32'], ['flags', 'u8'], ['pose', 'str'], ['frozen', 'u8']],
  /** 0 swing main arm, 1 hurt, 3 swing off hand, 4 critical, 5 magic critical. */
  animate: [['id', 'i32'], ['action', 'u8']],
  gameMode: [['mode', 'u8']],
  abilities: [['flying', 'bool'], ['mayFly', 'bool'], ['flySpeed', 'f32'], ['instabuild', 'bool'], ['invulnerable', 'bool']],
  health: [['health', 'f32'], ['food', 'u8'], ['saturation', 'f32']],
  /** Block crack progress of another player's digging (stage −1 clears). */
  blockBreakProgress: [['id', 'i32'], ['x', 'i32'], ['y', 'i16'], ['z', 'i32'], ['stage', 'i16']],
  /** Level event: 2001 = block broken (particles+sound, data = state). */
  levelEvent: [['event', 'i32'], ['x', 'i32'], ['y', 'i16'], ['z', 'i32'], ['data', 'i32']],
  /** Server acknowledges/corrects a dig action at a position. */
  digAck: [['x', 'i32'], ['y', 'i16'], ['z', 'i32'], ['state', 'u16'], ['action', 'u8'], ['ok', 'bool']],
  /** Non-player entity spawn: type name, position, velocity, type-specific data. */
  addEntity: [['id', 'i32'], ['type', 'str'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['vx', 'f32'], ['vy', 'f32'], ['vz', 'f32'], ['data', 'i32']],
  /** Item entity contents. */
  itemStack: [['id', 'i32'], ['item', 'i16'], ['count', 'u8']],
  /** Item picked up: animate it flying to the collector. */
  takeItem: [['itemId', 'i32'], ['collectorId', 'i32'], ['count', 'u8']],
  /** Inventory slot contents (player inventory numbering, see Inventory). */
  setSlot: [['slot', 'i16'], ['item', 'i16'], ['count', 'u8'], ['damage', 'i16']],
  heldSlot: [['slot', 'u8']],
  /** Items another player holds (vanilla SetEquipment: main hand and off hand item ids, 0 = empty). */
  equipment: [['id', 'i32'], ['mainHand', 'i16'], ['offHand', 'i16']],
  /** Set an entity's velocity (vanilla SetEntityMotion) — knockback for the local player. */
  entityMotion: [['id', 'i32'], ['vx', 'f32'], ['vy', 'f32'], ['vz', 'f32']],
  /** Message shown above the hotbar (vanilla overlay / action bar). */
  actionBar: [['text', 'str']],
  /** World difficulty (vanilla ChangeDifficulty). */
  difficulty: [['difficulty', 'u8']],
  /** Remaining air (300 = full). */
  air: [['air', 'i16']],
  /** XP bar progress, level and total points. */
  experience: [['progress', 'f32'], ['level', 'varint'], ['total', 'varint']],
  /** The receiving player died (vanilla PlayerCombatKill): show the death screen. */
  playerDied: [['message', 'str'], ['score', 'varint']],
  /** Entity status (vanilla ClientboundEntityEvent): 2 hurt, 3 death, 33 thorns, 36 drowning hurt, 37 burning hurt, 44 berry bush hurt, 57 freezing hurt. */
  entityEvent: [['id', 'i32'], ['event', 'u8']],
  /** A positional sound event (vanilla ClientboundSoundPacket); event = registry id. */
  sound: [['event', 'varint'], ['category', 'u8'], ['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['volume', 'f32'], ['pitch', 'f32']],
  /** Respawned (same dimension): reset client-side player state. */
  respawn: [['gameMode', 'u8']],
  /** Online player list (vanilla PlayerInfo): action 0 add, 1 game mode update, 4 remove. */
  playerInfo: [['action', 'u8'], ['id', 'i32'], ['name', 'str'], ['skin', 'str'], ['gameMode', 'u8']],
  /** Spectate through another entity's eyes, or back to your own (vanilla SetCamera). */
  setCamera: [['id', 'i32']],
  /**
   * Per-mob synced state (vanilla SynchedEntityData subset), one key at a time. Keys (see
   * MOB_DATA_KEYS): color (sheep DyeColor id 0–15), sheared, baby, swell_dir (creeper −1/1),
   * charged, aggressive (zombie arms up / skeleton aiming / enderman creepy), saddle, size
   * (slime), carried (enderman block state), hanging (bat resting), bow (skeleton holds a bow),
   * name_visible (custom name always shown).
   */
  mobData: [['id', 'i32'], ['key', 'str'], ['value', 'i32']],
  /** A mob's custom name (name tag); empty clears it. Shown when looked at, or always with mobData name_visible = 1. */
  mobName: [['id', 'i32'], ['name', 'str']],
} as const satisfies Schema;

/** Keys of the mobData packet (client: client/src/world/mobs.ts). */
export const MOB_DATA_KEYS = ['color', 'sheared', 'baby', 'swell_dir', 'charged', 'aggressive', 'saddle', 'size', 'carried', 'hanging', 'bow', 'name_visible'] as const;

// ------------------------------------------------------------------ client → server
const C2S_SCHEMA = {
  hello: [['protocol', 'u16'], ['name', 'str'], ['viewDistance', 'u8'], ['skin', 'str']],
  move: [['x', 'f64'], ['y', 'f64'], ['z', 'f64'], ['yaw', 'f32'], ['pitch', 'f32'], ['onGround', 'bool']],
  settings: [['viewDistance', 'u8'], ['simulationDistance', 'u8']],
  chat: [['message', 'str']],
  setBlock: [['x', 'i32'], ['y', 'i16'], ['z', 'i32'], ['state', 'u16']],
  /** Sneak/sprint/flying state changes (vanilla PlayerCommand / abilities). */
  playerState: [['sneaking', 'bool'], ['sprinting', 'bool'], ['flying', 'bool']],
  /** 0 start digging, 1 abort, 2 finish (survival), 3 creative instant break. */
  dig: [['action', 'u8'], ['x', 'i32'], ['y', 'i16'], ['z', 'i32'], ['face', 'u8']],
  /** Right-click on a block face with the held item (cursor = hit position within the block). */
  useOn: [['x', 'i32'], ['y', 'i16'], ['z', 'i32'], ['face', 'u8'], ['cx', 'f32'], ['cy', 'f32'], ['cz', 'f32'], ['hand', 'u8']],
  swing: [['hand', 'u8']],
  heldSlot: [['slot', 'u8']],
  /** Creative inventory: put an item stack into a slot (vanilla SetCreativeModeSlot). */
  creativeSlot: [['slot', 'i16'], ['item', 'i16'], ['count', 'u8']],
  /** Q / Ctrl+Q: drop one or the whole stack from the selected slot. */
  dropItem: [['all', 'bool']],
  /** Middle click in creative: put the block's item in the hotbar (vanilla pick block). */
  pickBlock: [['x', 'i32'], ['y', 'i16'], ['z', 'i32']],
  /** Attack an entity (vanilla Interact ATTACK); sneaking as sent by vanilla. */
  attack: [['target', 'i32'], ['sneaking', 'bool']],
  /** F: swap the selected hotbar item with the off hand (vanilla PlayerAction SWAP_ITEM_WITH_OFFHAND). */
  swapOffhand: [],
  /** "Leave Bed" (vanilla PlayerCommand STOP_SLEEPING). */
  stopSleeping: [],
  /** Death screen "Respawn" (vanilla ClientCommand PERFORM_RESPAWN). */
  respawn: [],
  /** Spectator menu "Teleport to Player" (vanilla TeleportToEntity). */
  spectate: [['target', 'i32']],
} as const satisfies Schema;

export type S2C = PacketsOf<typeof S2C_SCHEMA>;
export type C2S = PacketsOf<typeof C2S_SCHEMA>;

function codec<S extends Schema>(schema: S) {
  const names = Object.keys(schema) as (keyof S & string)[];
  const encode = (p: { t: string } & Record<string, unknown>): ArrayBuffer => {
    const fields = schema[p.t];
    if (!fields) throw new Error(`unknown packet ${p.t}`);
    const w = new ByteWriter(p.t === 'chunk' ? 65536 : 64);
    w.u8(names.indexOf(p.t));
    for (const [name, type] of fields) writeField(w, type, p[name]);
    return w.finish();
  };
  const decode = (buf: ArrayBuffer): { t: string } & Record<string, unknown> => {
    const r = new ByteReader(buf);
    const t = names[r.u8()];
    if (t === undefined) throw new Error('unknown packet id');
    const out: { t: string } & Record<string, unknown> = { t };
    for (const [name, type] of schema[t]!) out[name] = readField(r, type);
    return out;
  };
  return { encode, decode };
}

function writeField(w: ByteWriter, type: FieldType, v: unknown): void {
  switch (type) {
    case 'u8': w.u8(v as number); break;
    case 'bool': w.bool(v as boolean); break;
    case 'i16': w.i16(v as number); break;
    case 'u16': w.u16(v as number); break;
    case 'i32': w.i32(v as number); break;
    case 'u32': w.u32(v as number); break;
    case 'f32': w.f32(v as number); break;
    case 'f64': w.f64(v as number); break;
    case 'i64': w.i64(v as bigint); break;
    case 'str': w.str(v as string); break;
    case 'varint': w.varint(v as number); break;
    case 'svarint': w.svarint(v as number); break;
    case 'chunk': writeChunk(w, v as Chunk, true); break;
    case 'light': {
      const s = v as ChunkSection;
      if (s.light) { w.u8(1); w.bytes(s.light); } else { w.u8(0); w.u8(s.uniformLight); }
      break;
    }
    case 'i32list': {
      const a = v as number[];
      w.varint(a.length);
      for (const x of a) w.i32(x);
      break;
    }
    case 'bytes': {
      const b = v as Uint8Array;
      w.varint(b.length);
      w.bytes(b);
      break;
    }
  }
}

function readField(r: ByteReader, type: FieldType): unknown {
  switch (type) {
    case 'u8': return r.u8();
    case 'bool': return r.bool();
    case 'i16': return r.i16();
    case 'u16': return r.u16();
    case 'i32': return r.i32();
    case 'u32': return r.u32();
    case 'f32': return r.f32();
    case 'f64': return r.f64();
    case 'i64': return r.i64();
    case 'str': return r.str();
    case 'varint': return r.varint();
    case 'svarint': return r.svarint();
    case 'chunk': return readChunk(r, true);
    case 'light': {
      const s = new ChunkSection();
      if (r.u8() === 1) s.light = r.bytes(4096);
      else s.uniformLight = r.u8();
      return s;
    }
    case 'i32list': {
      const n = r.varint();
      const a: number[] = [];
      for (let i = 0; i < n; i++) a.push(r.i32());
      return a;
    }
    case 'bytes': return r.bytes(r.varint());
  }
}

const s2c = codec(S2C_SCHEMA);
const c2s = codec(C2S_SCHEMA);

export function encodeS2C(p: S2C): ArrayBuffer {
  return s2c.encode(p as unknown as { t: string } & Record<string, unknown>);
}
export function decodeS2C(buf: ArrayBuffer): S2C {
  return s2c.decode(buf) as unknown as S2C;
}
export function encodeC2S(p: C2S): ArrayBuffer {
  return c2s.encode(p as unknown as { t: string } & Record<string, unknown>);
}
export function decodeC2S(buf: ArrayBuffer): C2S {
  return c2s.decode(buf) as unknown as C2S;
}

export { writeSection, readSection };
