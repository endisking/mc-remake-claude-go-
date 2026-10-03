/// <reference lib="webworker" />
/**
 * Single-player: the game server runs in this worker, talking the same binary protocol
 * as the dedicated server. The page is one connection; LAN guests (WebRTC) are others.
 */
import { GameServer, type Connection } from '@server/game/server';

type Init = { type: 'start'; seed: string; scene?: string };
type Msg = Init | { type: 'packet'; conn: number; data: ArrayBuffer } | { type: 'open'; conn: number } | { type: 'close'; conn: number };

let server: GameServer | null = null;
const handlers = new Map<number, { conn: Connection; recv: (d: ArrayBuffer) => void }>();
const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  switch (m.type) {
    case 'start':
      server = new GameServer({ seed: BigInt(m.seed), scene: m.scene });
      server.start();
      post({ type: 'started' });
      break;
    case 'open': {
      if (!server) return;
      const id = m.conn;
      const conn: Connection = {
        send: (data) => post({ type: 'packet', conn: id, data }, [data]),
        close: (reason) => post({ type: 'kick', conn: id, reason }),
      };
      handlers.set(id, { conn, recv: server.connect(conn) });
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
  }
};
