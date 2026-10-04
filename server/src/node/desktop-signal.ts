/**
 * Entry point bundled (with `ws`) into the desktop app as signaling.cjs by tools/package.ts:
 * attaches the "Open to LAN" signaling relay at /signal to the desktop app's local HTTP server.
 */
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { SignalingHub } from './signaling';

export function attachSignaling(http: Server): void {
  const hub = new SignalingHub();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 << 10 });
  http.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname === '/signal') wss.handleUpgrade(req, socket, head, (ws) => hub.accept(ws));
    else socket.destroy();
  });
}
