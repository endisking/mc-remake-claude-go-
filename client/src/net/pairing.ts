/**
 * Offline LAN: browsers on the same Wi-Fi connect peer-to-peer with no server at all. The two
 * WebRTC connection descriptions a relay would normally pass along are exchanged by the players
 * themselves as "tickets" (QR codes, or copied text):
 *   host:  invite()  → invite ticket ─ friend scans ─→ PairingGuest.fromInvite() → reply ticket
 *   host:  accept(reply) ←──────────── host scans ───┘                  → data channel opens
 * No STUN/TURN servers are used (they'd need the internet), so only same-network routes are
 * offered, which is exactly what LAN play needs.
 */
import type { ClientTransport, IntegratedServer } from './connection';
import { serveDataChannel } from './lan';

/** No ICE servers: same-network (host / mDNS) candidates only, gathered without any internet. */
const RTC: RTCConfiguration = { iceServers: [] };
const INVITE = 'BCI1';
const REPLY = 'BCR1';

/** Drops lines a data-channel connection doesn't need (keeps the QR code small). */
export function minifySdp(sdp: string): string {
  return sdp
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('a=extmap-allow-mixed') && !l.startsWith('a=msid-semantic') && !(l.startsWith('a=candidate') && / tcptype /.test(l)))
    .join('\r\n') + '\r\n';
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text: string): Uint8Array {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** A connection description as a short text ticket: prefix + "." + base64url(deflate(sdp)). */
export async function encodeTicket(kind: 'invite' | 'reply', sdp: string): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(minifySdp(sdp)), new CompressionStream('deflate-raw'));
  return `${kind === 'invite' ? INVITE : REPLY}.${toBase64Url(packed)}`;
}

/** The SDP inside a ticket; throws an Error with a player-facing message when it's the wrong kind. */
export async function decodeTicket(kind: 'invite' | 'reply', ticket: string): Promise<string> {
  const t = ticket.trim().replace(/\s+/g, '');
  const [prefix, body] = t.split('.', 2);
  if (prefix !== INVITE && prefix !== REPLY) throw new Error("That isn't a Blockcraft LAN code.");
  if (kind === 'invite' && prefix === REPLY) throw new Error("That's a reply code. Show it to the host instead.");
  if (kind === 'reply' && prefix === INVITE) throw new Error("That's your own invite code. Scan your friend's reply code.");
  try {
    return new TextDecoder().decode(await pipe(fromBase64Url(body ?? ''), new DecompressionStream('deflate-raw')));
  } catch {
    throw new Error('That code is damaged or incomplete. Try scanning it again.');
  }
}

/** Resolves once ICE gathering is complete (non-trickle: every candidate goes into the ticket). */
function gathered(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export interface Invite {
  /** text to show as a QR code to the joining friend */
  readonly ticket: string;
  /** the friend's reply ticket; resolves when they're connected */
  accept(reply: string): Promise<void>;
  cancel(): void;
}

/** Host side: one invite per friend, each its own peer connection into the integrated server. */
export class PairingHost {
  guests = 0;
  onStatus: ((s: string) => void) | null = null;
  private peers = new Set<RTCPeerConnection>();

  constructor(private server: IntegratedServer) {}

  async invite(): Promise<Invite> {
    const pc = new RTCPeerConnection(RTC);
    this.peers.add(pc);
    let close: (() => void) | null = null;
    let joined: () => void = () => {};
    let failed: (e: Error) => void = () => {};
    const connected = new Promise<void>((res, rej) => {
      joined = res;
      failed = rej;
    });
    const ch = pc.createDataChannel('game', { ordered: true });
    serveDataChannel(this.server, ch, (c) => {
      close = c;
      this.guests++;
      this.onStatus?.(`A player joined (${this.guests} connected)`);
      joined();
    });
    const drop = () => {
      if (!this.peers.delete(pc)) return;
      if (close) {
        close();
        this.guests--;
        this.onStatus?.(`A player left (${this.guests} connected)`);
      }
      pc.close();
    };
    ch.onclose = drop;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        failed(new Error("Couldn't connect. Make sure you're both on the same Wi-Fi network."));
        drop();
      }
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const ticket = await encodeTicket('invite', pc.localDescription!.sdp);
    return {
      ticket,
      accept: async (reply) => {
        await pc.setRemoteDescription({ type: 'answer', sdp: await decodeTicket('reply', reply) });
        await Promise.race([connected, new Promise<void>((_, rej) => setTimeout(() => rej(new Error("Couldn't connect. Make sure you're both on the same Wi-Fi network.")), 20000))]);
      },
      cancel: () => {
        if (!close) drop();
      },
    };
  }

  stop(): void {
    for (const pc of [...this.peers]) pc.close();
    this.peers.clear();
    this.guests = 0;
  }
}

/** Guest side: answers a host's invite; the data channel carries the game protocol. */
export class PairingGuestTransport implements ClientTransport {
  onMessage: ((data: ArrayBuffer) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  /** resolves when the connection to the host is open */
  readonly ready: Promise<void>;
  private ch: RTCDataChannel | null = null;
  private queue: ArrayBuffer[] = [];
  private closed = false;

  private constructor(private pc: RTCPeerConnection) {
    this.ready = new Promise((resolve, reject) => {
      pc.ondatachannel = (e) => {
        const ch = (this.ch = e.channel);
        ch.binaryType = 'arraybuffer';
        ch.onopen = () => {
          for (const q of this.queue) ch.send(q);
          this.queue = [];
          resolve();
        };
        ch.onmessage = (ev) => {
          if (ev.data instanceof ArrayBuffer) this.onMessage?.(ev.data);
        };
        ch.onclose = () => {
          if (!this.closed) this.onClose?.('The host closed the world or the connection was lost');
        };
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          const e = new Error("Couldn't connect to the host. Make sure you're both on the same Wi-Fi network.");
          reject(e);
          if (!this.closed) this.onClose?.(e.message);
        }
      };
    });
  }

  /** Reads the host's invite ticket and returns the reply ticket to show to the host. */
  static async fromInvite(invite: string): Promise<{ transport: PairingGuestTransport; reply: string }> {
    const sdp = await decodeTicket('invite', invite);
    const pc = new RTCPeerConnection(RTC);
    const t = new PairingGuestTransport(pc);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return { transport: t, reply: await encodeTicket('reply', pc.localDescription!.sdp) };
  }

  send(data: ArrayBuffer): void {
    if (this.ch?.readyState === 'open') this.ch.send(data);
    else this.queue.push(data);
  }

  close(): void {
    this.closed = true;
    this.ch?.close();
    this.pc.close();
  }
}
