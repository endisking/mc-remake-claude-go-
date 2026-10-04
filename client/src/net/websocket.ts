/** Transport to a dedicated server over WebSocket (wss://host/play?room=CODE). */
import type { ClientTransport } from './connection';

export class WebSocketTransport implements ClientTransport {
  onMessage: ((data: ArrayBuffer) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private ws: WebSocket;
  private queue: ArrayBuffer[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      for (const q of this.queue) this.ws.send(q);
      this.queue = [];
    };
    this.ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) this.onMessage?.(e.data);
    };
    this.ws.onclose = (e) => this.onClose?.(e.reason || 'Connection closed');
    this.ws.onerror = () => this.onClose?.('Could not connect');
  }

  send(data: ArrayBuffer): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else if (this.ws.readyState === WebSocket.CONNECTING) this.queue.push(data);
  }

  close(): void {
    this.ws.close();
  }
}

/** Build the play URL for a server address ("host[:port]" or full ws(s):// URL) and room code. */
export function playUrl(address: string, room: string): string {
  let base = address.trim();
  if (!/^wss?:\/\//.test(base)) {
    // plain ws:// for LAN addresses and for the server this page came from over http://
    const secure = location.protocol === 'https:' || (!/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(base) && base !== location.host);
    base = `${secure ? 'wss' : 'ws'}://${base}`;
  }
  const u = new URL(base);
  u.pathname = '/play';
  u.searchParams.set('room', room || 'default');
  return u.toString();
}
