/**
 * World persistence: the server talks to a WorldStorage, implemented over IndexedDB in the
 * browser (single-player worker) and over region files on disk for the dedicated server.
 * Chunk records are opaque, already-compressed blobs (see codec.ts).
 */
import type { GameRules } from '../game/survival';
import type { ItemStack } from '@shared/item/stack';

export const SAVE_FORMAT_VERSION = 1;

/** level.dat equivalent. */
export interface LevelMeta {
  version: number;
  name: string;
  /** world seed as a decimal string (64-bit) */
  seed: string;
  /** game mode for new players / the world's default game mode */
  defaultGameMode: number;
  gameTime: number;
  dayTime: number;
  doDaylightCycle: boolean;
  doWeatherCycle: boolean;
  raining: boolean;
  thundering: boolean;
  rainTime: number;
  thunderTime: number;
  clearWeatherTime: number;
  rainLevel: number;
  thunderLevel: number;
  /** world spawn, null until first chosen */
  worldSpawn: [number, number, number] | null;
  gameRules: GameRules;
  difficulty: number;
  playersSleepingPercentage: number;
  spawnRadius: number;
  pvp: boolean;
  /** ms since epoch */
  lastPlayed: number;
  createdAt: number;
}

/** Per-player save (playerdata/<name>.dat equivalent). */
export interface PlayerData {
  /** Phase 7 (optional for older saves) */
  effects?: unknown;
  xpSeed?: number;
  version: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  gameMode: number;
  flying: boolean;
  fallDistance: number;
  health: number;
  absorption: number;
  foodLevel: number;
  saturation: number;
  exhaustion: number;
  foodTickTimer: number;
  air: number;
  fireTicks: number;
  xpLevel: number;
  xpProgress: number;
  xpTotal: number;
  score: number;
  /** 41 slots (vanilla Inventory numbering), null = empty */
  inventory: (ItemStack | null)[];
  /** ender chest contents (27), absent in older saves */
  enderItems?: (ItemStack | null)[];
  selected: number;
  respawn: { x: number; y: number; z: number; angle: number } | null;
}

export interface ChunkRecord {
  cx: number;
  cz: number;
  data: Uint8Array;
}

export interface WorldStorage {
  /** Coordinates of every chunk present in the save. */
  listChunks(): Promise<[number, number][]>;
  getChunk(cx: number, cz: number): Promise<Uint8Array | null>;
  putChunks(chunks: ChunkRecord[]): Promise<void>;
  getMeta(): Promise<LevelMeta | null>;
  putMeta(meta: LevelMeta): Promise<void>;
  getPlayer(id: string): Promise<PlayerData | null>;
  putPlayer(id: string, data: PlayerData): Promise<void>;
  listPlayers(): Promise<string[]>;
  close(): Promise<void>;
}
