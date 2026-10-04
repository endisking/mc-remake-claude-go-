/** Map-backed storage (tests, transient worlds). */
import type { ChunkRecord, LevelMeta, PlayerData, WorldStorage } from './types';

export class MemoryStorage implements WorldStorage {
  readonly chunks: Map<string, Uint8Array>;
  /** chunk key prefix of this dimension ('' = overworld) */
  private readonly prefix: string;

  constructor(chunks?: Map<string, Uint8Array>, prefix = '') {
    this.chunks = chunks ?? new Map();
    this.prefix = prefix;
  }

  /** Another dimension's chunks, kept in the same map under a "DIM-1:" prefix. */
  dimension(folder: string): MemoryStorage {
    return new MemoryStorage(this.chunks, `${folder}:`);
  }

  readonly players = new Map<string, PlayerData>();
  meta: LevelMeta | null = null;

  async listChunks(): Promise<[number, number][]> {
    const p = this.prefix;
    return [...this.chunks.keys()]
      .filter((k) => (p ? k.startsWith(p) : !k.includes(':')))
      .map((k) => k.slice(p.length).split(',').map(Number) as [number, number]);
  }
  async getChunk(cx: number, cz: number): Promise<Uint8Array | null> {
    return this.chunks.get(`${this.prefix}${cx},${cz}`) ?? null;
  }
  async putChunks(chunks: ChunkRecord[]): Promise<void> {
    for (const c of chunks) this.chunks.set(`${this.prefix}${c.cx},${c.cz}`, c.data.slice());
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
