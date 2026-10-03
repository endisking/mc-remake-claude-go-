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
import { JavaRandom } from '@shared/util/random';
import { ServerPlayer } from './player';
import { AABB, noCollision } from '@shared/entity/aabb';

export interface Connection {
  send(data: ArrayBuffer): void;
  close(reason: string): void;
}

export interface ServerOptions {
  seed: bigint;
  /** Development scene (e.g. 'models' showcase). */
  scene?: string;
  /** Max chunks generated per tick across all players. */
  chunkGenBudget?: number;
  /** Game mode for new players: 0 survival, 1 creative, 2 adventure, 3 spectator. */
  defaultGameMode?: number;
}

export class GameServer {
  readonly world = new BlockWorld();
  readonly light: LightEngine;
  readonly generator: DevGenerator;
  readonly players: ServerPlayer[] = [];
  gameTime = 0;
  dayTime = 1000;
  doDaylightCycle = true;
  doWeatherCycle = true;
  // vanilla weather state (LevelData)
  raining = false;
  thundering = false;
  rainTime = 0;
  thunderTime = 0;
  clearWeatherTime = 0;
  rainLevel = 0;
  thunderLevel = 0;
  private readonly rand = new JavaRandom(BigInt(Date.now()));
  private nextEntityId = 1;
  private readonly chunkGenBudget: number;
  /** Sections whose light changed this tick: key -> [cx, sy, cz] */
  private lightDirty = new Map<number, [number, number, number]>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Measured milliseconds per tick (for F3 / profiling). */
  mspt = 0;

  constructor(readonly opts: ServerOptions) {
    this.generator = new DevGenerator(opts.seed, opts.scene);
    this.light = new LightEngine(this.world);
    this.light.onSectionChanged = (cx, sy, cz) => {
      this.lightDirty.set(chunkKey(cx, cz) * 16 + sy, [cx, sy, cz]);
    };
    this.chunkGenBudget = opts.chunkGenBudget ?? 6;
  }

  // ---------------------------------------------------------------- connections
  /** `owner`: the host's own connection (single-player / LAN host). */
  connect(conn: Connection, owner = false): (data: ArrayBuffer) => void {
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
        player = this.join(conn, p, owner);
        return;
      }
      this.handle(player, p);
    };
  }

  disconnect(conn: Connection): void {
    const i = this.players.findIndex((p) => p.conn === conn);
    if (i < 0) return;
    const [gone] = this.players.splice(i, 1);
    for (const o of this.players) {
      if (o.tracking.delete(gone!.id)) this.send(o, { t: 'removeEntities', ids: [gone!.id] });
    }
  }

  private join(conn: Connection, hello: Extract<C2S, { t: 'hello' }>, owner: boolean): ServerPlayer {
    const p = new ServerPlayer(this.nextEntityId++, conn, this.world);
    p.name = hello.name.slice(0, 16) || 'Player';
    p.skin = hello.skin.slice(0, 64);
    p.isOwner = owner;
    p.viewDistance = clampViewDistance(hello.viewDistance);
    p.gameMode = this.opts.defaultGameMode ?? 0;
    p.flying = p.gameMode === 3;
    // spawn: on top of the terrain at the world origin
    const spawn = this.ensureChunk(0, 0);
    const top = spawn.topY(8, 8);
    p.x = 8.5;
    p.y = top + 1;
    p.z = 8.5;
    this.players.push(p);
    this.send(p, {
      t: 'login', entityId: p.id, gameMode: p.gameMode, dimension: 'overworld', seed: this.opts.seed,
      x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, simulationDistance: 10,
    });
    this.sendAbilities(p);
    this.send(p, { t: 'health', health: p.health, food: p.food, saturation: p.saturation });
    this.send(p, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
    this.send(p, { t: 'weather', rain: this.rainLevel, thunder: this.thunderLevel * this.rainLevel });
    return p;
  }

  private sendAbilities(p: ServerPlayer): void {
    this.send(p, { t: 'abilities', flying: p.flying, mayFly: p.mayFly, flySpeed: 0.05, instabuild: p.gameMode === 1, invulnerable: p.gameMode === 1 || p.gameMode === 3 });
  }

  setGameMode(p: ServerPlayer, mode: number): void {
    p.gameMode = mode;
    if (!p.mayFly) p.flying = false;
    if (mode === 3) p.flying = true;
    this.send(p, { t: 'gameMode', mode });
    this.sendAbilities(p);
  }

  /**
   * Validate a client move like vanilla ServerGamePacketListenerImpl.handleMovePlayer:
   * reject "moved too quickly" (> 10 blocks/tick, owner exempt) and "moved wrongly" (the
   * collision-resolved move ends more than 0.25 blocks from the claimed position; creative
   * and spectator exempt), and refuse moving into solid blocks.
   */
  private handleMove(p: ServerPlayer, m: Extract<C2S, { t: 'move' }>): void {
    const dx = m.x - p.x, dy = m.y - p.y, dz = m.z - p.z;
    const dist2 = dx * dx + dy * dy + dz * dz;
    if (!Number.isFinite(dist2)) return this.rejectMove(p);
    p.yaw = m.yaw;
    p.pitch = Math.max(-90, Math.min(90, m.pitch));
    p.headYaw = m.yaw;
    if (!p.isOwner && dist2 > 100) return this.rejectMove(p);
    const exempt = p.gameMode === 1 || p.gameMode === 3;
    if (!exempt && dist2 > 0) {
      const ph = p.phys;
      ph.x = p.x;
      ph.y = p.y;
      ph.z = p.z;
      ph.onGround = p.onGround;
      ph.shiftDown = p.sneaking;
      ph.pose = p.pose;
      ph.abilities.flying = p.flying;
      ph.abilities.noPhysics = false;
      ph.move(dx, dy, dz);
      const ex = m.x - ph.x, ey = m.y - ph.y, ez = m.z - ph.z;
      const err = ex * ex + (ey > -0.5 && ey < 0.5 ? 0 : ey * ey) + ez * ez;
      if (err > 0.0625) {
        // the claimed position is only acceptable if it doesn't put the player inside blocks
        const w = 0.3, h = ph.height;
        const bb = new AABB(m.x - w, m.y, m.z - w, m.x + w, m.y + h, m.z + w).deflate(1e-5);
        if (!noCollision(this.world, bb)) return this.rejectMove(p);
      }
    }
    // fall damage bookkeeping (Entity.checkFallDamage driven by the client's onGround)
    if (m.onGround) {
      if (p.fallDistance > 0) this.onLand(p, p.fallDistance);
      p.fallDistance = 0;
    } else if (dy < 0) p.fallDistance -= dy;
    if (p.flying) p.fallDistance = 0;
    p.x = m.x;
    p.y = m.y;
    p.z = m.z;
    p.onGround = m.onGround;
  }

  private rejectMove(p: ServerPlayer): void {
    p.rejectedMoves++;
    this.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
  }

  /** Landing hook; fall damage arrives with the health system. */
  protected onLand(_p: ServerPlayer, _fallDistance: number): void {}

  private handle(p: ServerPlayer, m: C2S): void {
    switch (m.t) {
      case 'move':
        this.handleMove(p, m);
        break;
      case 'playerState':
        p.sneaking = m.sneaking;
        p.sprinting = m.sprinting;
        p.flying = m.flying && p.mayFly;
        p.stateDirty = true;
        break;
      case 'swing':
        for (const o of this.players) if (o.tracking.has(p.id)) this.send(o, { t: 'animate', id: p.id, action: m.hand === 1 ? 3 : 0 });
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
    } else if (a[0] === 'weather' && (a[1] === 'clear' || a[1] === 'rain' || a[1] === 'thunder')) {
      const d = a[2] ? Number(a[2]) * 20 : 6000;
      this.setWeather(a[1], Number.isFinite(d) ? d : 6000);
    } else if (a[0] === 'gamemode' && a[1]) {
      const modes: Record<string, number> = { survival: 0, creative: 1, adventure: 2, spectator: 3, '0': 0, '1': 1, '2': 2, '3': 3 };
      const mode = modes[a[1]];
      if (mode !== undefined) this.setGameMode(p, mode);
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
    this.advanceWeather();
    for (const p of this.players) p.updatePose();
    this.updateChunks();
    this.updateTracking();
    this.flushLight();
    this.mspt = this.mspt * 0.9 + (performance.now() - t0) * 0.1;
  }

  private uniform(min: number, max: number): number {
    return min + this.rand.nextInt(max - min + 1);
  }

  /** Vanilla ServerLevel.advanceWeatherCycle (overworld). */
  advanceWeather(): void {
    const prevRain = this.rainLevel, prevThunder = this.thunderLevel;
    if (this.doWeatherCycle) {
      if (this.clearWeatherTime > 0) {
        this.clearWeatherTime--;
        this.thunderTime = this.thundering ? 0 : 1;
        this.rainTime = this.raining ? 0 : 1;
        this.thundering = false;
        this.raining = false;
      } else {
        if (this.thunderTime > 0) {
          if (--this.thunderTime === 0) this.thundering = !this.thundering;
        } else if (this.thundering) this.thunderTime = this.uniform(3600, 15600);
        else this.thunderTime = this.uniform(12000, 180000);
        if (this.rainTime > 0) {
          if (--this.rainTime === 0) this.raining = !this.raining;
        } else if (this.raining) this.rainTime = this.uniform(12000, 24000);
        else this.rainTime = this.uniform(12000, 180000);
      }
    }
    this.thunderLevel = Math.max(0, Math.min(1, this.thunderLevel + (this.thundering ? 0.01 : -0.01)));
    this.rainLevel = Math.max(0, Math.min(1, this.rainLevel + (this.raining ? 0.01 : -0.01)));
    if (this.rainLevel !== prevRain || this.thunderLevel !== prevThunder) {
      for (const p of this.players) this.send(p, { t: 'weather', rain: this.rainLevel, thunder: this.thunderLevel * this.rainLevel });
    }
  }

  /** /weather clear|rain|thunder [duration] */
  setWeather(kind: 'clear' | 'rain' | 'thunder', duration: number): void {
    if (kind === 'clear') {
      this.clearWeatherTime = duration;
      this.rainTime = 0;
      this.thunderTime = 0;
      this.raining = false;
      this.thundering = false;
    } else {
      this.clearWeatherTime = 0;
      this.rainTime = duration;
      this.thunderTime = kind === 'thunder' ? duration : 0;
      this.raining = true;
      this.thundering = kind === 'thunder';
    }
  }

  private updateChunks(): void {
    let budget = this.chunkGenBudget;
    for (const p of this.players) {
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      // vanilla ChunkMap sends one ring beyond the client's view distance so edge chunks have neighbours
      const r = p.viewDistance + 1;
      // unload far chunks
      for (const key of p.sent) {
        const cx = Math.floor(key / 0x400000) - 0x200000;
        const cz = (key % 0x400000) - 0x200000;
        if (Math.abs(cx - pcx) > r || Math.abs(cz - pcz) > r) {
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
        // the chunk packet already carries current light for this column
        for (let sy = 0; sy < 16; sy++) this.lightDirty.delete(key * 16 + sy);
        budget--;
      }
    }
    // drop chunks nobody can see (keep a margin of 2 for lighting neighbors)
    if (this.gameTime % 40 === 0) {
      for (const c of [...this.world.chunks.values()]) {
        const needed = this.players.some((p) => {
          const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
          return Math.abs(c.x - pcx) <= p.viewDistance + 3 && Math.abs(c.z - pcz) <= p.viewDistance + 3;
        });
        if (!needed) this.world.removeChunk(c.x, c.z);
      }
    }
  }

  /** Show/hide players to each other within view distance and broadcast their movement. */
  private updateTracking(): void {
    for (const p of this.players) {
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      for (const o of this.players) {
        if (o === p) continue;
        const ocx = Math.floor(o.x) >> 4, ocz = Math.floor(o.z) >> 4;
        const visible = Math.abs(ocx - pcx) <= p.viewDistance && Math.abs(ocz - pcz) <= p.viewDistance && o.gameMode !== 3;
        if (visible && !p.tracking.has(o.id)) {
          p.tracking.add(o.id);
          this.send(p, { t: 'addPlayer', id: o.id, name: o.name, skin: o.skin, x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch, headYaw: o.headYaw });
          this.send(p, { t: 'entityState', id: o.id, flags: o.flags(), pose: o.pose });
        } else if (!visible && p.tracking.has(o.id)) {
          p.tracking.delete(o.id);
          this.send(p, { t: 'removeEntities', ids: [o.id] });
        }
      }
    }
    // movement and state updates (players: every tick when changed)
    for (const o of this.players) {
      const moved = o.x !== o.lastSentX || o.y !== o.lastSentY || o.z !== o.lastSentZ || o.yaw !== o.lastSentYaw || o.pitch !== o.lastSentPitch;
      if (moved) {
        o.lastSentX = o.x;
        o.lastSentY = o.y;
        o.lastSentZ = o.z;
        o.lastSentYaw = o.yaw;
        o.lastSentPitch = o.pitch;
      }
      for (const p of this.players) {
        if (!p.tracking.has(o.id)) continue;
        if (moved) this.send(p, { t: 'entityMove', id: o.id, x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch, headYaw: o.headYaw, onGround: o.onGround });
        if (o.stateDirty) this.send(p, { t: 'entityState', id: o.id, flags: o.flags(), pose: o.pose });
      }
      o.stateDirty = false;
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
