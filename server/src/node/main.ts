/**
 * Dedicated server (Node.js).
 *
 * - Serves the built client (client/dist) over HTTP(S).
 * - Accepts game connections over WebSocket at /play?room=CODE. Each room code is its own
 *   world (GameServer instance), created on first join.
 * - Relays WebRTC signaling at /signal for browser-hosted "Open to LAN" worlds.
 *
 * Deploy behind a TLS-terminating proxy (or pass TLS_CERT/TLS_KEY) so clients connect with
 * wss:// on port 443, which works on school networks.
 *
 * - Saves each room's world under WORLDS_DIR/<room> (autosave every 5 minutes and on SIGINT/SIGTERM).
 *
 * Env: PORT (default 8080), TLS_CERT, TLS_KEY, SEED (new worlds), STATIC_DIR, WORLDS_DIR (default ./worlds)
 */
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameServer, type Connection } from '../game/server';
import { SignalingHub } from './signaling';
import { DiskStorage } from '../storage/disk';

const here = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR ?? join(here, '..', '..', '..', 'client', 'dist');
const PORT = Number(process.env.PORT ?? 8080);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
};

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  let file = join(STATIC_DIR, path);
  if (!file.startsWith(STATIC_DIR) || !existsSync(file) || !statSync(file).isFile()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Client not built. Run: pnpm build');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const tls = process.env.TLS_CERT && process.env.TLS_KEY;
const http = tls
  ? createHttps({ cert: readFileSync(process.env.TLS_CERT!), key: readFileSync(process.env.TLS_KEY!) }, serveStatic)
  : createHttp(serveStatic);

// ------------------------------------------------------------------ rooms
// Each room's world is saved under WORLDS_DIR/<room> (level.json, players/, region/).
const WORLDS_DIR = process.env.WORLDS_DIR ?? join(process.cwd(), 'worlds');
const rooms = new Map<string, { ready: Promise<GameServer>; server: GameServer | null; clients: number }>();

async function openRoom(code: string): Promise<GameServer> {
  const storage = new DiskStorage(join(WORLDS_DIR, code));
  const meta = await storage.getMeta();
  const seed = meta ? BigInt(meta.seed)
    : process.env.SEED ? BigInt(process.env.SEED) : BigInt.asIntN(64, BigInt(Math.floor(Math.random() * 2 ** 52)) * 4093n);
  const server = new GameServer({
    seed, defaultGameMode: meta?.defaultGameMode ?? Number(process.env.GAMEMODE ?? 0), scene: process.env.SCENE,
    storage: process.env.SCENE ? undefined : storage, worldName: meta?.name ?? code,
  });
  await server.load();
  server.start();
  console.log(`[room ${code}] ${meta ? 'loaded' : 'created'} (seed ${seed}) in ${join(WORLDS_DIR, code)}`);
  return server;
}

function roomFor(code: string): { ready: Promise<GameServer>; server: GameServer | null; clients: number } {
  let r = rooms.get(code);
  if (!r) {
    const room: { ready: Promise<GameServer>; server: GameServer | null; clients: number } = { ready: openRoom(code), server: null, clients: 0 };
    room.ready.then((s) => (room.server = s), (e) => {
      console.error(`[room ${code}] failed to open`, e);
      rooms.delete(code);
    });
    rooms.set(code, (r = room));
  }
  return r;
}

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: saving ${rooms.size} world(s)...`);
  await Promise.all([...rooms.entries()].map(async ([code, r]) => {
    try {
      await (await r.ready).shutdown();
    } catch (e) {
      console.error(`[room ${code}] save failed`, e);
    }
  }));
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export function validRoomCode(code: string | null): code is string {
  return !!code && /^[A-Za-z0-9_-]{1,32}$/.test(code);
}

const wssPlay = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
const signaling = new SignalingHub();
const wssSignal = new WebSocketServer({ noServer: true, maxPayload: 64 << 10 });

http.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/play') {
    const room = url.searchParams.get('room') ?? 'default';
    if (!validRoomCode(room)) {
      socket.destroy();
      return;
    }
    wssPlay.handleUpgrade(req, socket, head, (ws) => onPlay(ws, room));
  } else if (url.pathname === '/signal') {
    wssSignal.handleUpgrade(req, socket, head, (ws) => signaling.accept(ws));
  } else socket.destroy();
});

function onPlay(ws: WebSocket, room: string): void {
  if (stopping) {
    ws.close(1001, 'Server closed');
    return;
  }
  const r = roomFor(room);
  r.clients++;
  ws.binaryType = 'arraybuffer';
  const conn: Connection = {
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: (reason) => ws.close(1000, reason.slice(0, 120)),
  };
  // packets that arrive while the world is still loading wait here
  const pending: ArrayBuffer[] = [];
  let recv: ((d: ArrayBuffer) => void) | null = null;
  let closed = false;
  const handle = (buf: ArrayBuffer) => {
    try {
      recv!(buf);
    } catch (e) {
      console.warn(`[room ${room}] bad packet`, (e as Error).message);
      ws.close(1003, 'bad packet');
    }
  };
  r.ready.then((server) => {
    if (closed) return;
    recv = server.connect(conn);
    for (const b of pending.splice(0)) handle(b);
  }, () => ws.close(1011, 'world failed to load'));
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const buf = data instanceof ArrayBuffer ? data : Buffer.isBuffer(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null;
    if (!buf) return;
    if (recv) handle(buf as ArrayBuffer);
    else if (pending.length < 64) pending.push(buf as ArrayBuffer);
  });
  ws.on('close', () => {
    closed = true;
    r.server?.disconnect(conn);
    r.clients--;
  });
}

http.listen(PORT, () => console.log(`Blockcraft server on ${tls ? 'https' : 'http'}://localhost:${PORT} (client from ${STATIC_DIR})`));
