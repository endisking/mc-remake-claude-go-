/**
 * The authoritative game server. Environment-agnostic: runs inside a Web Worker for
 * single-player and inside Node for the dedicated server.
 */
import { BlockWorld } from '@shared/world/world';
import { LightEngine } from '@shared/world/light';
import { Chunk, chunkKey } from '@shared/world/chunk';
import { DevGenerator } from '@shared/worldgen/devgen';
import { encodeS2C, decodeC2S, type C2S, type S2C, PROTOCOL_VERSION } from '@shared/protocol/packets';
import { TICKS_PER_SECOND, DAY_LENGTH } from '@shared/constants';

export interface Connection {
  send(data: ArrayBuffer): void;
  close(reason: string): void;
}

export interface ServerOptions {
  seed: bigint;
  /** Max chunks generated per tick across all players. */
  chunkGenBudget?: number;
}

class ServerPlayer {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  viewDistance = 8;
  /** Chunks this client currently has. */
  readonly sent = new Set<number>();
  name = 'Player';
  constructor(
    readonly id: number,
    readonly conn: Connection,
  ) {}
}

export class GameServer {
  readonly world = new BlockWorld();
  readonly light: LightEngine;
  readonly generator: DevGenerator;
  readonly players: ServerPlayer[] = [];
  gameTime = 0;
  dayTime = 1000;
  doDaylightCycle = true;
  private nextEntityId = 1;
  private readonly chunkGenBudget: number;
  /** Sections whose light changed this tick: key -> [cx, sy, cz] */
  private lightDirty = new Map<number, [number, number, number]>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Measured milliseconds per tick (for F3 / profiling). */
  mspt = 0;

  constructor(readonly opts: ServerOptions) {
    this.generator = new DevGenerator(opts.seed);
    this.light = new LightEngine(this.world);
    this.light.onSectionChanged = (cx, sy, cz) => {
      this.lightDirty.set(chunkKey(cx, cz) * 16 + sy, [cx, sy, cz]);
    };
    this.chunkGenBudget = opts.chunkGenBudget ?? 6;
  }

  // ---------------------------------------------------------------- connections
  connect(conn: Connection): (data: ArrayBuffer) => void {
    let player: ServerPlayer | null = null;
    return (data: ArrayBuffer) => {
      const p = decodeC2S(data);
      if (!player) {
        if (p.t !== 'hello') return;
        if (p.protocol !== PROTOCOL_VERSION) {
          conn.send(encodeS2C({ t: 'disconnect', reason: 'Outdated client' }));
          conn.close('protocol');
          return;
        }
        player = this.join(conn, p);
        return;
      }
      this.handle(player, p);
    };
  }

  disconnect(conn: Connection): void {
    const i = this.players.findIndex((p) => p.conn === conn);
    if (i >= 0) this.players.splice(i, 1);
  }

  private join(conn: Connection, hello: Extract<C2S, { t: 'hello' }>): ServerPlayer {
    const p = new ServerPlayer(this.nextEntityId++, conn);
    p.name = hello.name;
    p.viewDistance = clampViewDistance(hello.viewDistance);
    // spawn: on top of the terrain at the world origin
    const spawn = this.ensureChunk(0, 0);
    const top = spawn.topY(8, 8);
    p.x = 8.5;
    p.y = top + 1;
    p.z = 8.5;
    this.players.push(p);
    this.send(p, {
      t: 'login', entityId: p.id, gameMode: 1, dimension: 'overworld', seed: this.opts.seed,
      x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, simulationDistance: 10,
    });
    this.send(p, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
    return p;
  }

  private handle(p: ServerPlayer, m: C2S): void {
    switch (m.t) {
      case 'move':
        p.x = m.x;
        p.y = m.y;
        p.z = m.z;
        p.yaw = m.yaw;
        p.pitch = m.pitch;
        p.onGround = m.onGround;
        break;
      case 'settings':
        p.viewDistance = clampViewDistance(m.viewDistance);
        break;
      case 'setBlock':
        this.setBlock(m.x, m.y, m.z, m.state);
        break;
      case 'chat':
        if (m.message.startsWith('/')) this.runCommand(p, m.message.slice(1));
        break;
    }
  }

  /** Minimal command handling (the full command system is Phase 9). */
  private runCommand(p: ServerPlayer, cmd: string): void {
    const a = cmd.trim().split(/\s+/);
    if (a[0] === 'time' && (a[1] === 'set' || a[1] === 'add')) {
      const names: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000 };
      const v = names[a[2] ?? ''] ?? Number(a[2]);
      if (!Number.isFinite(v)) return;
      this.dayTime = a[1] === 'set' ? v : this.dayTime + v;
      for (const pl of this.players) this.send(pl, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
    } else if (a[0] === 'gamerule' && a[1] === 'doDaylightCycle') {
      this.doDaylightCycle = a[2] === 'true';
    } else if (a[0] === 'tp' && a.length >= 4) {
      const n = a.slice(1, 4).map(Number);
      if (n.some((v) => !Number.isFinite(v))) return;
      p.x = n[0]!;
      p.y = n[1]!;
      p.z = n[2]!;
      this.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
    }
  }

  private send(p: ServerPlayer, packet: S2C): void {
    p.conn.send(encodeS2C(packet));
  }

  // ---------------------------------------------------------------- world access
  ensureChunk(cx: number, cz: number): Chunk {
    let c = this.world.getChunk(cx, cz);
    if (!c) {
      c = this.generator.generate(cx, cz);
      this.world.addChunk(c);
    }
    return c;
  }

  /** A chunk is ready to send once it and its 8 neighbors exist and it is lit. */
  private prepareChunk(cx: number, cz: number): Chunk {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.ensureChunk(cx + dx, cz + dz);
    const c = this.world.getChunk(cx, cz)!;
    if (!c.lit) this.light.lightChunk(c);
    return c;
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    if (y < 0 || y > 255) return;
    const old = this.world.setStateRaw(x, y, z, state);
    if (old === state) return;
    this.light.onBlockChanged(x, y, z, old, state);
    const key = chunkKey(x >> 4, z >> 4);
    for (const p of this.players) if (p.sent.has(key)) this.send(p, { t: 'blockChange', x, y, z, state });
  }

  // ---------------------------------------------------------------- ticking
  tick(): void {
    const t0 = performance.now();
    this.gameTime++;
    if (this.doDaylightCycle) this.dayTime++;
    if (this.gameTime % 20 === 0) {
      for (const p of this.players) this.send(p, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
    }
    this.updateChunks();
    this.flushLight();
    this.mspt = this.mspt * 0.9 + (performance.now() - t0) * 0.1;
  }

  private updateChunks(): void {
    let budget = this.chunkGenBudget;
    for (const p of this.players) {
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      const r = p.viewDistance;
      // unload far chunks
      for (const key of p.sent) {
        const cx = Math.floor(key / 0x400000) - 0x200000;
        const cz = (key % 0x400000) - 0x200000;
        if (Math.abs(cx - pcx) > r + 1 || Math.abs(cz - pcz) > r + 1) {
          p.sent.delete(key);
          this.send(p, { t: 'unloadChunk', cx, cz });
        }
      }
      // send nearest missing chunks first
      for (const [dx, dz] of spiral(r)) {
        if (budget <= 0) break;
        const cx = pcx + dx, cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (p.sent.has(key)) continue;
        const c = this.prepareChunk(cx, cz);
        p.sent.add(key);
        this.send(p, { t: 'chunk', chunk: c });
        budget--;
      }
    }
    // drop chunks nobody can see (keep a margin of 2 for lighting neighbors)
    if (this.gameTime % 40 === 0) {
      for (const c of [...this.world.chunks.values()]) {
        const needed = this.players.some((p) => {
          const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
          return Math.abs(c.x - pcx) <= p.viewDistance + 2 && Math.abs(c.z - pcz) <= p.viewDistance + 2;
        });
        if (!needed) this.world.removeChunk(c.x, c.z);
      }
    }
  }

  private flushLight(): void {
    if (this.lightDirty.size === 0) return;
    for (const [, [cx, sy, cz]] of this.lightDirty) {
      const key = chunkKey(cx, cz);
      const c = this.world.getChunk(cx, cz);
      if (!c) continue;
      for (const p of this.players) {
        if (p.sent.has(key)) this.send(p, { t: 'sectionLight', cx, sy, cz, section: c.sections[sy]! });
      }
    }
    this.lightDirty.clear();
    this.light.flushChanged();
  }

  // ---------------------------------------------------------------- loop
  start(): void {
    if (this.running) return;
    this.running = true;
    const msPerTick = 1000 / TICKS_PER_SECOND;
    let next = performance.now();
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      // catch up at most 10 ticks if we fell behind (vanilla skips beyond that)
      let n = 0;
      while (now >= next && n < 10) {
        this.tick();
        next += msPerTick;
        n++;
      }
      if (now - next > 2000) next = now; // "Can't keep up!"
      this.timer = setTimeout(loop, Math.max(0, next - performance.now()));
    };
    loop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}

function clampViewDistance(v: number): number {
  return Math.max(2, Math.min(32, v | 0));
}

const spiralCache = new Map<number, [number, number][]>();
/** Chunk offsets within radius r, ordered by distance from the center. */
export function spiral(r: number): [number, number][] {
  let s = spiralCache.get(r);
  if (s) return s;
  s = [];
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) s.push([dx, dz]);
  s.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  spiralCache.set(r, s);
  return s;
}

export { DAY_LENGTH };
