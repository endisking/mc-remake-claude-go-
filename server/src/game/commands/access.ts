/**
 * Operators, bans and the whitelist (vanilla ServerOpList / UserBanList / IpBanList /
 * UserWhiteList). Persisted through an AccessStore as ops.json, banned-players.json,
 * banned-ips.json and whitelist.json (same shapes as vanilla, minus UUIDs: players have no
 * accounts here, so entries are keyed by name, case-insensitively).
 */
import type { ServerPlayer } from '../player';

export interface OpEntry {
  name: string;
  level: number;
  bypassesPlayerLimit: boolean;
}
export interface BanEntry {
  name: string;
  created: string;
  source: string;
  expires: string;
  reason: string;
}
export interface IpBanEntry {
  ip: string;
  created: string;
  source: string;
  expires: string;
  reason: string;
}
export interface WhitelistEntry {
  name: string;
}

export type AccessFile = 'ops' | 'banned-players' | 'banned-ips' | 'whitelist' | 'server-settings';

/** Persistence for the lists (the dedicated server writes JSON files; tests use memory). */
export interface AccessStore {
  load(file: AccessFile): unknown;
  save(file: AccessFile, data: unknown): void;
}

export class MemoryAccessStore implements AccessStore {
  readonly files = new Map<AccessFile, unknown>();
  load(file: AccessFile): unknown {
    return this.files.get(file) ?? null;
  }
  save(file: AccessFile, data: unknown): void {
    this.files.set(file, JSON.parse(JSON.stringify(data)));
  }
}

/** Vanilla BanListEntry date format "yyyy-MM-dd HH:mm:ss Z". */
export function banDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

export const IP_PATTERN = /^([01]?\d\d?|2[0-4]\d|25[0-5])\.([01]?\d\d?|2[0-4]\d|25[0-5])\.([01]?\d\d?|2[0-4]\d|25[0-5])\.([01]?\d\d?|2[0-4]\d|25[0-5])$/;

export class AccessControl {
  ops: OpEntry[] = [];
  bans: BanEntry[] = [];
  ipBans: IpBanEntry[] = [];
  whitelist: WhitelistEntry[] = [];
  /** server.properties white-list / enforce-whitelist */
  whitelistEnabled = false;
  enforceWhitelist = false;
  /** server.properties op-permission-level */
  opPermissionLevel = 4;
  /** The world's "Allow Cheats" (single-player / LAN: every player is an operator when on). */
  cheats = true;
  /** Dedicated server: only ops.json entries are operators. */
  dedicated = false;
  /** Dedicated server started with OPS=* : every player is an operator (private test/friend rooms). */
  allOps = false;

  constructor(private store: AccessStore | null = null) {
    this.reload();
  }

  setStore(store: AccessStore | null): void {
    this.store = store;
    this.reload();
  }

  reload(): void {
    const s = this.store;
    if (!s) return;
    const arr = <T>(f: AccessFile): T[] => {
      const v = s.load(f);
      return Array.isArray(v) ? (v as T[]).filter((e) => e && typeof e === 'object') : [];
    };
    this.ops = arr<OpEntry>('ops').filter((e) => typeof e.name === 'string').map((e) => ({ name: e.name, level: typeof e.level === 'number' ? e.level : this.opPermissionLevel, bypassesPlayerLimit: !!e.bypassesPlayerLimit }));
    this.bans = arr<BanEntry>('banned-players').filter((e) => typeof e.name === 'string');
    this.ipBans = arr<IpBanEntry>('banned-ips').filter((e) => typeof e.ip === 'string');
    this.whitelist = arr<WhitelistEntry>('whitelist').filter((e) => typeof e.name === 'string');
    const settings = s.load('server-settings') as { whitelist?: boolean; enforceWhitelist?: boolean } | null;
    if (settings) {
      this.whitelistEnabled = !!settings.whitelist;
      this.enforceWhitelist = !!settings.enforceWhitelist;
    }
  }

  private save(file: AccessFile): void {
    if (!this.store) return;
    const data = file === 'ops' ? this.ops : file === 'banned-players' ? this.bans : file === 'banned-ips' ? this.ipBans : file === 'whitelist' ? this.whitelist : { whitelist: this.whitelistEnabled, enforceWhitelist: this.enforceWhitelist };
    this.store.save(file, data);
  }

  private static key(name: string): string {
    return name.toLowerCase();
  }

  // ---------------------------------------------------------------- ops
  opEntry(name: string): OpEntry | undefined {
    const k = AccessControl.key(name);
    return this.ops.find((o) => AccessControl.key(o.name) === k);
  }
  /**
   * PlayerList.isOp: an ops.json entry, or — on an integrated (single-player / LAN) server with
   * cheats allowed — everyone (vanilla allowCheatsForAllPlayers when opened to LAN with cheats).
   */
  isOp(p: ServerPlayer): boolean {
    return !!this.opEntry(p.name) || (!this.dedicated && this.cheats) || this.allOps;
  }
  /** MinecraftServer.getProfilePermissions */
  permissionLevel(p: ServerPlayer): number {
    const e = this.opEntry(p.name);
    if (e) return e.level;
    if (!this.dedicated) return this.cheats ? 4 : 0;
    return this.allOps ? this.opPermissionLevel : 0;
  }
  op(name: string): boolean {
    if (this.opEntry(name)) return false;
    this.ops.push({ name, level: this.opPermissionLevel, bypassesPlayerLimit: false });
    this.save('ops');
    return true;
  }
  deop(name: string): boolean {
    const e = this.opEntry(name);
    if (!e) return false;
    this.ops.splice(this.ops.indexOf(e), 1);
    this.save('ops');
    return true;
  }

  // ---------------------------------------------------------------- bans
  banEntry(name: string): BanEntry | undefined {
    const k = AccessControl.key(name);
    return this.bans.find((b) => AccessControl.key(b.name) === k);
  }
  ban(name: string, source: string, reason: string): boolean {
    if (this.banEntry(name)) return false;
    this.bans.push({ name, created: banDate(), source, expires: 'forever', reason });
    this.save('banned-players');
    return true;
  }
  pardon(name: string): boolean {
    const e = this.banEntry(name);
    if (!e) return false;
    this.bans.splice(this.bans.indexOf(e), 1);
    this.save('banned-players');
    return true;
  }
  ipBanEntry(ip: string): IpBanEntry | undefined {
    return this.ipBans.find((b) => b.ip === ip);
  }
  banIp(ip: string, source: string, reason: string): boolean {
    if (this.ipBanEntry(ip)) return false;
    this.ipBans.push({ ip, created: banDate(), source, expires: 'forever', reason });
    this.save('banned-ips');
    return true;
  }
  pardonIp(ip: string): boolean {
    const e = this.ipBanEntry(ip);
    if (!e) return false;
    this.ipBans.splice(this.ipBans.indexOf(e), 1);
    this.save('banned-ips');
    return true;
  }

  // ---------------------------------------------------------------- whitelist
  isWhitelisted(name: string): boolean {
    const k = AccessControl.key(name);
    return this.whitelist.some((w) => AccessControl.key(w.name) === k);
  }
  whitelistAdd(name: string): boolean {
    if (this.isWhitelisted(name)) return false;
    this.whitelist.push({ name });
    this.save('whitelist');
    return true;
  }
  whitelistRemove(name: string): boolean {
    const k = AccessControl.key(name);
    const i = this.whitelist.findIndex((w) => AccessControl.key(w.name) === k);
    if (i < 0) return false;
    this.whitelist.splice(i, 1);
    this.save('whitelist');
    return true;
  }
  setWhitelistEnabled(on: boolean): void {
    this.whitelistEnabled = on;
    this.save('server-settings');
  }
  /** PlayerList.isWhiteListed: ops always pass. */
  mayJoinWhitelist(name: string): boolean {
    return !this.whitelistEnabled || !!this.opEntry(name) || this.isWhitelisted(name);
  }

  /** PlayerList.canPlayerLogin: the disconnect message, or null when allowed. */
  loginCheck(name: string, ip: string | undefined): string | null {
    const ban = this.banEntry(name);
    if (ban) return `You are banned from this server.\nReason: ${ban.reason}`;
    if (!this.mayJoinWhitelist(name)) return 'You are not white-listed on this server!';
    const ipBan = ip ? this.ipBanEntry(ip) : undefined;
    if (ipBan) return `Your IP address is banned from this server.\nReason: ${ipBan.reason}`;
    return null;
  }
}
