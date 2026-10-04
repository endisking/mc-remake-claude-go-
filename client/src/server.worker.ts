/// <reference lib="webworker" />
/**
 * Single-player: the game server runs in this worker, talking the same binary protocol
 * as the dedicated server. The page is one connection; LAN guests (WebRTC) are others.
 * With a world id, the world is loaded from and saved to IndexedDB.
 */
import { GameServer, type Connection } from '@server/game/server';
import { IdbStorage } from '@server/storage/idb';

type Init = { type: 'start'; seed: string; scene?: string; gameMode?: number; world?: string };
type Msg =
  | Init
  | { type: 'packet'; conn: number; data: ArrayBuffer }
  | { type: 'open'; conn: number }
  | { type: 'close'; conn: number }
  | { type: 'save'; id: number }
  | { type: 'stop'; id: number };

let server: GameServer | null = null;
const handlers = new Map<number, { conn: Connection; recv: (d: ArrayBuffer) => void }>();
const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);

async function start(m: Init): Promise<void> {
  let seed = BigInt(m.seed);
  let gameMode = m.gameMode ?? 0;
  let storage: IdbStorage | undefined;
  let worldName: string | undefined;
  if (m.world) {
    storage = new IdbStorage(m.world);
    const meta = await storage.getMeta();
    if (!meta) throw new Error('This world no longer exists');
    seed = BigInt(meta.seed);
    gameMode = meta.defaultGameMode;
    worldName = meta.name;
  }
  server = new GameServer({ seed, scene: m.scene, defaultGameMode: gameMode, storage, worldName });
  await server.load();
  server.start();
  post({ type: 'started' });
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  switch (m.type) {
    case 'start':
      start(m).catch((err: unknown) => post({ type: 'error', message: (err as Error).message ?? String(err) }));
      break;
    case 'open': {
      if (!server) return;
      const id = m.conn;
      const conn: Connection = {
        send: (data) => post({ type: 'packet', conn: id, data }, [data]),
        close: (reason) => post({ type: 'kick', conn: id, reason }),
      };
      handlers.set(id, { conn, recv: server.connect(conn, id === 0) });
      break;
    }
    case 'packet':
      handlers.get(m.conn)?.recv(m.data);
      break;
    case 'close': {
      const h = handlers.get(m.conn);
      if (h && server) server.disconnect(h.conn);
      handlers.delete(m.conn);
      break;
    }
    case 'save':
    case 'stop': {
      const id = m.id;
      const s = server;
      if (!s) {
        post({ type: 'saved', id });
        break;
      }
      (m.type === 'stop' ? s.shutdown() : s.save()).then(
        () => post({ type: 'saved', id }),
        (err: unknown) => post({ type: 'saved', id, error: (err as Error).message ?? String(err) }),
      );
      break;
    }
  }
};
