/** Map-backed storage (tests, transient worlds). */
import type { ChunkRecord, LevelMeta, PlayerData, WorldStorage } from './types';

export class MemoryStorage implements WorldStorage {
  readonly chunks = new Map<string, Uint8Array>();
  readonly players = new Map<string, PlayerData>();
  meta: LevelMeta | null = null;

  async listChunks(): Promise<[number, number][]> {
    return [...this.chunks.keys()].map((k) => k.split(',').map(Number) as [number, number]);
  }
  async getChunk(cx: number, cz: number): Promise<Uint8Array | null> {
    return this.chunks.get(`${cx},${cz}`) ?? null;
  }
  async putChunks(chunks: ChunkRecord[]): Promise<void> {
    for (const c of chunks) this.chunks.set(`${c.cx},${c.cz}`, c.data.slice());
  }
  async getMeta(): Promise<LevelMeta | null> {
    return this.meta ? structuredClone(this.meta) : null;
  }
  async putMeta(meta: LevelMeta): Promise<void> {
    this.meta = structuredClone(meta);
  }
  async getPlayer(id: string): Promise<PlayerData | null> {
    const p = this.players.get(id);
    return p ? structuredClone(p) : null;
  }
  async putPlayer(id: string, data: PlayerData): Promise<void> {
    this.players.set(id, structuredClone(data));
  }
  async listPlayers(): Promise<string[]> {
    return [...this.players.keys()];
  }
  async close(): Promise<void> {}
}
