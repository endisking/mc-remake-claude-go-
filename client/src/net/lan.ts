/**
 * "Open to LAN" over WebRTC. The host's integrated server accepts guests through data
 * channels; a small signaling relay (server/src/node/signaling.ts) exchanges SDP/ICE.
 */
import type { ClientTransport, IntegratedServer } from './connection';

const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};

/** Signaling endpoint: explicit, or the page's own origin when served by the Node server. */
export function signalingUrl(explicit?: string | null): string {
  if (explicit) return explicit;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`;
}

export function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const r = crypto.getRandomValues(new Uint8Array(5));
  for (const b of r) s += alphabet[b % alphabet.length];
  return s;
}

/** Max bytes queued on a data channel before we wait (keeps memory bounded). */
const HIGH_WATER = 4 * 1024 * 1024;

export class LanHost {
  private ws: WebSocket;
  private peers = new Map<number, { pc: RTCPeerConnection; close?: () => void }>();
  onStatus: ((s: string) => void) | null = null;
  guests = 0;

  constructor(
    private server: IntegratedServer,
    readonly code: string,
    signal: string,
  ) {
    this.ws = new WebSocket(signal);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'host', code }));
    this.ws.onmessage = (e) => this.onSignal(JSON.parse(String(e.data)));
    this.ws.onclose = () => this.onStatus?.('Signaling disconnected (existing players stay connected)');
    this.ws.onerror = () => this.onStatus?.('Could not reach the signaling server');
  }

  private async onSignal(m: { type: string; id?: number; from?: number; data?: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }; reason?: string; code?: string }): Promise<void> {
    if (m.type === 'hosting') this.onStatus?.(`Hosting. Room code: ${m.code}`);
    else if (m.type === 'error') this.onStatus?.(m.reason ?? 'Error');
    else if (m.type === 'guest' && m.id !== undefined) await this.addGuest(m.id);
    else if (m.type === 'guestLeft' && m.id !== undefined) this.dropGuest(m.id);
    else if (m.type === 'signal' && m.from !== undefined) {
      const p = this.peers.get(m.from);
      if (!p) return;
      if (m.data?.sdp) await p.pc.setRemoteDescription(m.data.sdp);
      if (m.data?.ice) await p.pc.addIceCandidate(m.data.ice).catch(() => {});
    }
  }

  private async addGuest(id: number): Promise<void> {
    const pc = new RTCPeerConnection(ICE);
    const entry: { pc: RTCPeerConnection; close?: () => void } = { pc };
    this.peers.set(id, entry);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.ws.send(JSON.stringify({ type: 'signal', to: id, data: { ice: e.candidate.toJSON() } }));
    };
    const ch = pc.createDataChannel('game', { ordered: true });
    ch.binaryType = 'arraybuffer';
    ch.bufferedAmountLowThreshold = HIGH_WATER / 4;
    const backlog: ArrayBuffer[] = [];
    const flush = () => {
      while (backlog.length && ch.bufferedAmount < HIGH_WATER) ch.send(backlog.shift()!);
    };
    ch.onbufferedamountlow = flush;
    ch.onopen = () => {
      this.guests++;
      const link = this.server.addRemote(
        (data) => {
          if (ch.readyState !== 'open') return;
          if (backlog.length || ch.bufferedAmount >= HIGH_WATER) backlog.push(data);
          else ch.send(data);
        },
        () => ch.close(),
      );
      entry.close = link.close;
      ch.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) link.receive(e.data);
      };
      this.onStatus?.(`A player joined (${this.guests} connected)`);
    };
    ch.onclose = () => this.dropGuest(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.ws.send(JSON.stringify({ type: 'signal', to: id, data: { sdp: pc.localDescription!.toJSON() } }));
  }

  private dropGuest(id: number): void {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    if (p.close) {
      p.close();
      this.guests--;
    }
    p.pc.close();
  }

  stop(): void {
    for (const id of [...this.peers.keys()]) this.dropGuest(id);
    this.ws.close();
  }
}

/** Guest side: join a LAN world by room code. */
export class LanGuestTransport implements ClientTransport {
  onMessage: ((data: ArrayBuffer) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private ws: WebSocket;
  private pc: RTCPeerConnection | null = null;
  private ch: RTCDataChannel | null = null;
  private queue: ArrayBuffer[] = [];
  private hostId = -1;

  constructor(code: string, signal: string) {
    this.ws = new WebSocket(signal);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ type: 'join', code: code.toUpperCase() }));
    this.ws.onmessage = (e) => void this.onSignal(JSON.parse(String(e.data)));
    this.ws.onerror = () => this.onClose?.('Could not reach the signaling server');
  }

  private async onSignal(m: { type: string; host?: number; from?: number; data?: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }; reason?: string }): Promise<void> {
    if (m.type === 'error') this.onClose?.(m.reason ?? 'Could not join');
    else if (m.type === 'hostLeft') this.onClose?.('The host closed the world');
    else if (m.type === 'joined') {
      this.hostId = m.host!;
      const pc = (this.pc = new RTCPeerConnection(ICE));
      pc.onicecandidate = (e) => {
        if (e.candidate) this.ws.send(JSON.stringify({ type: 'signal', to: this.hostId, data: { ice: e.candidate.toJSON() } }));
      };
      pc.ondatachannel = (e) => {
        const ch = (this.ch = e.channel);
        ch.binaryType = 'arraybuffer';
        ch.onopen = () => {
          for (const q of this.queue) ch.send(q);
          this.queue = [];
        };
        ch.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) this.onMessage?.(ev.data);
        };
        ch.onclose = () => this.onClose?.('Connection lost');
      };
    } else if (m.type === 'signal' && this.pc) {
      if (m.data?.sdp) {
        await this.pc.setRemoteDescription(m.data.sdp);
        if (m.data.sdp.type === 'offer') {
          const ans = await this.pc.createAnswer();
          await this.pc.setLocalDescription(ans);
          this.ws.send(JSON.stringify({ type: 'signal', to: this.hostId, data: { sdp: this.pc.localDescription!.toJSON() } }));
        }
      }
      if (m.data?.ice) await this.pc.addIceCandidate(m.data.ice).catch(() => {});
    }
  }

  send(data: ArrayBuffer): void {
    if (this.ch?.readyState === 'open') this.ch.send(data);
    else this.queue.push(data);
  }

  close(): void {
    this.ch?.close();
    this.pc?.close();
    this.ws.close();
  }
}
