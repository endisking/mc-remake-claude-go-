/**
 * Dedicated-server storage: a world folder on disk.
 *   level.json            level data
 *   players/<id>.json     per-player data
 *   region/r.X.Z.bcr      32×32-chunk region files (region.ts)
 * Files are written to a temporary name and renamed, so a crash never leaves half a file.
 * Node only (imports node:fs) — never import this from client code.
 */
import { promises as fs, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Region, regionFileName, regionOf, parseRegionFileName } from './region';
import type { ChunkRecord, LevelMeta, PlayerData, WorldStorage } from './types';

const MAX_CACHED_REGIONS = 16;

export class DiskStorage implements WorldStorage {
  private readonly regions = new Map<string, Region>();
  /** serializes writes per file */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {}

  private async writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, path);
  }

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const p = this.queue.then(f, f);
    this.queue = p.catch(() => {});
    return p;
  }

  private async region(rx: number, rz: number): Promise<Region> {
    const k = `${rx},${rz}`;
    let r = this.regions.get(k);
    if (r) {
      // LRU: move to the end
      this.regions.delete(k);
      this.regions.set(k, r);
      return r;
    }
    const path = join(this.dir, 'region', regionFileName(rx, rz));
    if (existsSync(path)) {
      try {
        r = Region.decode(rx, rz, new Uint8Array(await fs.readFile(path)));
      } catch (e) {
        console.warn(`[storage] unreadable region ${path}: ${(e as Error).message}`);
        r = new Region(rx, rz);
      }
    } else r = new Region(rx, rz);
    this.regions.set(k, r);
    while (this.regions.size > MAX_CACHED_REGIONS) this.regions.delete(this.regions.keys().next().value!);
    return r;
  }

  async listChunks(): Promise<[number, number][]> {
    const dir = join(this.dir, 'region');
    if (!existsSync(dir)) return [];
    const out: [number, number][] = [];
    for (const f of readdirSync(dir)) {
      const rc = parseRegionFileName(f);
      if (!rc) continue;
      out.push(...(await this.region(rc[0], rc[1])).coords());
    }
    return out;
  }

  async getChunk(cx: number, cz: number): Promise<Uint8Array | null> {
    const [rx, rz] = regionOf(cx, cz);
    return (await this.region(rx, rz)).get(cx, cz);
  }

  putChunks(chunks: ChunkRecord[]): Promise<void> {
    return this.serial(async () => {
      await fs.mkdir(join(this.dir, 'region'), { recursive: true });
      const byRegion = new Map<string, ChunkRecord[]>();
      for (const c of chunks) {
        const [rx, rz] = regionOf(c.cx, c.cz);
        const k = `${rx},${rz}`;
        let l = byRegion.get(k);
        if (!l) byRegion.set(k, (l = []));
        l.push(c);
      }
      for (const list of byRegion.values()) {
        const [rx, rz] = regionOf(list[0]!.cx, list[0]!.cz);
        const r = await this.region(rx, rz);
        for (const c of list) r.set(c.cx, c.cz, c.data);
        await this.writeAtomic(join(this.dir, 'region', regionFileName(rx, rz)), r.encode());
      }
    });
  }

  async getMeta(): Promise<LevelMeta | null> {
    try {
      return JSON.parse(await fs.readFile(join(this.dir, 'level.json'), 'utf8')) as LevelMeta;
    } catch {
      return null;
    }
  }

  putMeta(meta: LevelMeta): Promise<void> {
    return this.serial(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      await this.writeAtomic(join(this.dir, 'level.json'), JSON.stringify(meta, null, 2));
    });
  }

  async getPlayer(id: string): Promise<PlayerData | null> {
    try {
      return JSON.parse(await fs.readFile(join(this.dir, 'players', `${encodeURIComponent(id)}.json`), 'utf8')) as PlayerData;
    } catch {
      return null;
    }
  }

  putPlayer(id: string, data: PlayerData): Promise<void> {
    return this.serial(async () => {
      await fs.mkdir(join(this.dir, 'players'), { recursive: true });
      await this.writeAtomic(join(this.dir, 'players', `${encodeURIComponent(id)}.json`), JSON.stringify(data));
    });
  }

  async listPlayers(): Promise<string[]> {
    const dir = join(this.dir, 'players');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => decodeURIComponent(f.slice(0, -5)));
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
