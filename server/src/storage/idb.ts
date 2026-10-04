/**
 * Browser storage: one IndexedDB database ("blockcraft") holding every single-player world.
 *   worlds   key worldId           → LevelMeta
 *   chunks   key [worldId, cx, cz] → chunk record (Uint8Array)
 *   players  key [worldId, id]     → PlayerData
 * Used by the server worker (IdbStorage) and the launcher (world list, delete, export, import).
 */
import type { ChunkRecord, LevelMeta, PlayerData, WorldStorage } from './types';
import { exportWorld, importWorld } from './archive';

const DB_NAME = 'blockcraft';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds');
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('players')) db.createObjectStore('players');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Key range covering every [worldId, ...] key. */
function worldRange(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id], [id, []]);
}

export class IdbStorage implements WorldStorage {
  constructor(readonly worldId: string) {}

  async listChunks(): Promise<[number, number][]> {
    const db = await openDb();
    const keys = await request(db.transaction('chunks').objectStore('chunks').getAllKeys(worldRange(this.worldId)));
    return keys.map((k) => {
      const a = k as [string, number, number];
      return [a[1], a[2]];
    });
  }

  async getChunk(cx: number, cz: number): Promise<Uint8Array | null> {
    const db = await openDb();
    const v = await request(db.transaction('chunks').objectStore('chunks').get([this.worldId, cx, cz]));
    return v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
  }

  async putChunks(chunks: ChunkRecord[]): Promise<void> {
    if (!chunks.length) return;
    const db = await openDb();
    const tx = db.transaction('chunks', 'readwrite');
    const st = tx.objectStore('chunks');
    for (const c of chunks) st.put(c.data, [this.worldId, c.cx, c.cz]);
    await done(tx);
  }

  async getMeta(): Promise<LevelMeta | null> {
    const db = await openDb();
    return ((await request(db.transaction('worlds').objectStore('worlds').get(this.worldId))) as LevelMeta | undefined) ?? null;
  }

  async putMeta(meta: LevelMeta): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(meta, this.worldId);
    await done(tx);
  }

  async getPlayer(id: string): Promise<PlayerData | null> {
    const db = await openDb();
    return ((await request(db.transaction('players').objectStore('players').get([this.worldId, id]))) as PlayerData | undefined) ?? null;
  }

  async putPlayer(id: string, data: PlayerData): Promise<void> {
    const db = await openDb();
    const tx = db.transaction('players', 'readwrite');
    tx.objectStore('players').put(data, [this.worldId, id]);
    await done(tx);
  }

  async listPlayers(): Promise<string[]> {
    const db = await openDb();
    const keys = await request(db.transaction('players').objectStore('players').getAllKeys(worldRange(this.worldId)));
    return keys.map((k) => (k as [string, string])[1]);
  }

  async close(): Promise<void> {}
}

// ------------------------------------------------------------------ world list (launcher)
export interface WorldSummary {
  id: string;
  meta: LevelMeta;
}

export async function listWorlds(): Promise<WorldSummary[]> {
  const db = await openDb();
  const st = db.transaction('worlds').objectStore('worlds');
  const [keys, values] = await Promise.all([request(st.getAllKeys()), request(st.getAll())]);
  return keys.map((k, i) => ({ id: String(k), meta: values[i] as LevelMeta })).sort((a, b) => (b.meta.lastPlayed ?? 0) - (a.meta.lastPlayed ?? 0));
}

export function newWorldId(): string {
  return `w${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
}

export async function deleteWorld(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['worlds', 'chunks', 'players'], 'readwrite');
  tx.objectStore('worlds').delete(id);
  tx.objectStore('chunks').delete(worldRange(id));
  tx.objectStore('players').delete(worldRange(id));
  await done(tx);
}

export function exportWorldZip(id: string): Promise<Uint8Array> {
  return exportWorld(new IdbStorage(id));
}

/** Import a .zip as a new world; returns its id. */
export async function importWorldZip(bytes: Uint8Array): Promise<string> {
  const id = newWorldId();
  try {
    const meta = await importWorld(bytes, new IdbStorage(id));
    // keep names unique-ish in the list
    const names = new Set((await listWorlds()).filter((w) => w.id !== id).map((w) => w.meta.name));
    if (names.has(meta.name)) {
      meta.name = `${meta.name} (imported)`;
      await new IdbStorage(id).putMeta(meta);
    }
    return id;
  } catch (e) {
    await deleteWorld(id).catch(() => {});
    throw e;
  }
}
