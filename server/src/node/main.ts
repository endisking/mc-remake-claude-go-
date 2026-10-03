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
 * Env: PORT (default 8080), TLS_CERT, TLS_KEY, SEED, STATIC_DIR
 */
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameServer, type Connection } from '../game/server';
import { SignalingHub } from './signaling';

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
const rooms = new Map<string, { server: GameServer; clients: number }>();

function roomFor(code: string): GameServer {
  let r = rooms.get(code);
  if (!r) {
    const seed = process.env.SEED ? BigInt(process.env.SEED) : BigInt.asIntN(64, BigInt(Math.floor(Math.random() * 2 ** 52)) * 4093n);
    const server = new GameServer({ seed });
    server.start();
    r = { server, clients: 0 };
    rooms.set(code, r);
    console.log(`[room ${code}] created (seed ${seed})`);
  }
  return r.server;
}

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
  const server = roomFor(room);
  const r = rooms.get(room)!;
  r.clients++;
  ws.binaryType = 'arraybuffer';
  const conn: Connection = {
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: (reason) => ws.close(1000, reason.slice(0, 120)),
  };
  const recv = server.connect(conn);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const buf = data instanceof ArrayBuffer ? data : Buffer.isBuffer(data) ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null;
    if (!buf) return;
    try {
      recv(buf as ArrayBuffer);
    } catch (e) {
      console.warn(`[room ${room}] bad packet`, (e as Error).message);
      ws.close(1003, 'bad packet');
    }
  });
  ws.on('close', () => {
    server.disconnect(conn);
    r.clients--;
  });
}

http.listen(PORT, () => console.log(`Blockcraft server on ${tls ? 'https' : 'http'}://localhost:${PORT} (client from ${STATIC_DIR})`));
