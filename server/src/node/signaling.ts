/**
 * WebRTC signaling relay for browser-hosted LAN worlds. JSON messages:
 *   host:   {type:'host', code}                     → {type:'hosting', code}
 *   guest:  {type:'join', code}                     → {type:'joined', id} / {type:'error'}
 *   relay:  {type:'signal', to, data}               → delivered as {type:'signal', from, data}
 * The host learns of guests via {type:'guest', id}. Only SDP/ICE passes through here;
 * game traffic flows peer-to-peer over data channels.
 */
import type { WebSocket } from 'ws';

interface Peer {
  id: number;
  ws: WebSocket;
  hostOf?: string;
  guestOf?: string;
}

export class SignalingHub {
  private nextId = 1;
  private peers = new Map<number, Peer>();
  private hosts = new Map<string, Peer>();

  accept(ws: WebSocket): void {
    const peer: Peer = { id: this.nextId++, ws };
    this.peers.set(peer.id, peer);
    ws.on('message', (raw) => {
      let m: { type: string; code?: string; to?: number; data?: unknown };
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.handle(peer, m);
    });
    ws.on('close', () => {
      this.peers.delete(peer.id);
      if (peer.hostOf && this.hosts.get(peer.hostOf) === peer) {
        this.hosts.delete(peer.hostOf);
        for (const p of this.peers.values()) if (p.guestOf === peer.hostOf) this.send(p, { type: 'hostLeft' });
      }
      if (peer.guestOf) {
        const host = this.hosts.get(peer.guestOf);
        if (host) this.send(host, { type: 'guestLeft', id: peer.id });
      }
    });
  }

  private send(p: Peer, m: unknown): void {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(JSON.stringify(m));
  }

  private handle(peer: Peer, m: { type: string; code?: string; to?: number; data?: unknown }): void {
    const code = typeof m.code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(m.code) ? m.code.toUpperCase() : null;
    switch (m.type) {
      case 'host':
        if (!code || this.hosts.has(code)) return this.send(peer, { type: 'error', reason: 'Room code in use' });
        peer.hostOf = code;
        this.hosts.set(code, peer);
        this.send(peer, { type: 'hosting', code });
        break;
      case 'join': {
        const host = code ? this.hosts.get(code) : undefined;
        if (!host) return this.send(peer, { type: 'error', reason: 'No world with that code' });
        peer.guestOf = code!;
        this.send(peer, { type: 'joined', id: peer.id, host: host.id });
        this.send(host, { type: 'guest', id: peer.id });
        break;
      }
      case 'signal': {
        const to = typeof m.to === 'number' ? this.peers.get(m.to) : undefined;
        if (!to) return;
        // only allow host<->guest pairs of the same room
        const room = peer.hostOf ?? peer.guestOf;
        if (!room || (to.hostOf ?? to.guestOf) !== room) return;
        this.send(to, { type: 'signal', from: peer.id, data: m.data });
        break;
      }
    }
  }
}
