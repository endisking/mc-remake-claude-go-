/**
 * LAN world discovery, like vanilla's (LanServerPinger / LanServerDetection): every world opened
 * to LAN is announced by UDP multicast every 1.5 s, and the desktop app lists what it hears so the
 * launcher can show "LAN Worlds" without anyone typing an address. Vanilla's text format is kept
 * ([MOTD]…[/MOTD][AD]port[/AD]) plus the room code, but on our own port so real Minecraft
 * clients on the network don't list (and fail to join) Blockcraft worlds. Subnet broadcast is
 * sent as well because some Wi-Fi access points drop multicast.
 */
import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

export const DISCOVERY_GROUP = '224.0.2.60';
export const DISCOVERY_PORT = 47616;
/** vanilla LanServerPinger sleeps 1500 ms between pings */
export const ANNOUNCE_INTERVAL_MS = 1500;
/** a world is dropped from the list once it has been silent this long */
export const EXPIRE_MS = 5000;

export interface Announcement {
  motd: string;
  /** port of the host's relay / game page */
  port: number;
  room: string;
}

export interface LanWorld extends Announcement {
  address: string;
  /** ms timestamp of the last announcement heard */
  seen: number;
}

const between = (s: string, open: string, close: string): string | null => {
  const a = s.indexOf(open);
  if (a < 0) return null;
  const b = s.indexOf(close, a + open.length);
  return b < 0 ? null : s.slice(a + open.length, b);
};

export function encodeAnnouncement(a: Announcement): string {
  const motd = a.motd.replace(/\[\/?(MOTD|AD|ROOM)\]/g, '').slice(0, 64);
  return `[MOTD]${motd}[/MOTD][AD]${a.port}[/AD][ROOM]${a.room}[/ROOM]`;
}

/** null for anything that isn't a well-formed Blockcraft announcement */
export function parseAnnouncement(text: string): Announcement | null {
  const motd = between(text, '[MOTD]', '[/MOTD]');
  const ad = between(text, '[AD]', '[/AD]');
  const room = between(text, '[ROOM]', '[/ROOM]');
  if (motd === null || ad === null || room === null) return null;
  const port = Number(ad);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Z0-9_-]{1,32}$/.test(room)) return null;
  return { motd: motd.slice(0, 64), port, room };
}

/** The worlds heard on the network, newest information wins; expired entries are dropped. */
export class LanWorldList {
  private worlds = new Map<string, LanWorld>();

  heard(a: Announcement, address: string, now: number): void {
    this.worlds.set(`${address}:${a.port}/${a.room}`, { ...a, address, seen: now });
  }

  list(now: number): LanWorld[] {
    for (const [k, w] of this.worlds) if (now - w.seen > EXPIRE_MS) this.worlds.delete(k);
    return [...this.worlds.values()].sort((a, b) => a.motd.localeCompare(b.motd) || a.address.localeCompare(b.address));
  }
}

interface Iface {
  address: string;
  broadcast: string;
}

/** Non-internal IPv4 interfaces with their subnet broadcast address. */
function ipv4Interfaces(): Iface[] {
  const out: Iface[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number), mask = a.netmask.split('.').map(Number);
      out.push({ address: a.address, broadcast: ip.map((o, i) => (o | (~mask[i]! & 255)) >>> 0).join('.') });
    }
  }
  return out;
}

/**
 * Announces `rooms()` (worlds hosted on this machine's relay) and listens for other machines'
 * announcements. Never throws: on a machine without a usable network it simply finds nothing.
 */
export class LanDiscovery {
  readonly found = new LanWorldList();
  private socket: Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ifaces: Iface[] = [];

  constructor(private port: number, private rooms: () => { room: string; motd: string }[]) {}

  start(): void {
    const s = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = s;
    s.on('error', (e) => console.warn('LAN discovery:', e.message));
    s.on('message', (msg, rinfo) => {
      const a = parseAnnouncement(msg.toString('utf8'));
      if (!a) return;
      // our own worlds come back to us through multicast loopback; the launcher doesn't need them
      if (this.ifaces.some((i) => i.address === rinfo.address) && this.rooms().some((r) => r.room === a.room)) return;
      this.found.heard(a, rinfo.address, Date.now());
    });
    s.bind(DISCOVERY_PORT, () => {
      s.setBroadcast(true);
      s.setMulticastTTL(1);
      this.refreshInterfaces();
    });
    this.timer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS);
  }

  /** joins the multicast group on interfaces that appeared since last time (Wi-Fi reconnects) */
  private refreshInterfaces(): void {
    const now = ipv4Interfaces();
    for (const i of now) {
      if (this.ifaces.some((o) => o.address === i.address)) continue;
      try {
        this.socket?.addMembership(DISCOVERY_GROUP, i.address);
      } catch {
        // already a member, or the interface can't do multicast: broadcast still works
      }
    }
    this.ifaces = now;
  }

  private announce(): void {
    const s = this.socket;
    if (!s) return;
    this.refreshInterfaces();
    const rooms = this.rooms();
    if (!rooms.length) return;
    for (const r of rooms) {
      const msg = Buffer.from(encodeAnnouncement({ motd: r.motd, port: this.port, room: r.room }), 'utf8');
      const send = (addr: string) => s.send(msg, DISCOVERY_PORT, addr, () => {});
      send(DISCOVERY_GROUP);
      for (const i of this.ifaces) send(i.broadcast);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.socket?.close();
    this.socket = null;
  }
}
