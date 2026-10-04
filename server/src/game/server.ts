/**
 * The authoritative game server. Environment-agnostic: runs inside a Web Worker for
 * single-player and inside Node for the dedicated server.
 */
import { BlockWorld } from '@shared/world/world';
import { LightEngine } from '@shared/world/light';
import { Chunk, chunkKey, chunkKeyX, chunkKeyZ } from '@shared/world/chunk';
import { serializeChunk, deserializeChunk, packRecord, unpackRecord, capturePlayer, applyPlayer, chunkEntities } from '../storage/codec';
import { SAVE_FORMAT_VERSION, type WorldStorage, type LevelMeta, type PlayerData } from '../storage/types';
import { DevGenerator } from '@shared/worldgen/devgen';
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { NetherGenerator } from '@shared/worldgen/nether/generator';
import { ServerLevel, DIMENSION_TYPES, type DimensionType, type LevelGenerator } from './level';
import { Portals } from './portals';
import { useAnchor } from './anchor';
import { obfuscateSeed } from '@shared/worldgen/biome/zoom';
import { encodeS2C, decodeC2S, type C2S, type S2C, PROTOCOL_VERSION } from '@shared/protocol/packets';
import { TICKS_PER_SECOND, DAY_LENGTH } from '@shared/constants';
import { JavaRandom } from '@shared/util/random';
import { ServerPlayer } from './player';
import { AABB, noCollision } from '@shared/entity/aabb';
import { ItemEntity, LightningBolt, ExperienceOrb, experienceOrbValue, type ServerEntity } from './entity';
import { Sleep } from './sleep';
import { FluidTicks } from './fluidticks';
import { legacyBlock, FLUID_OF } from '@shared/game/fluids';
import { isRainingAt } from '@shared/world/weather';
import { stateForPlacement, updateShape, isReplaceable, companionPlacement, DIRS, DX, DY, DZ } from '@shared/game/placement';
import { canSurvive } from '@shared/game/support';
import { destroyProgress, hardness, canHarvest } from '@shared/game/mining';
import { blockDrops, blockForItem, itemForBlock } from '@shared/game/loot';
import { isEmpty, maxStackSize, itemName, type ItemStack } from '@shared/item/stack';
import { collisionBoxes } from '@shared/world/shapes';
import { getProp, blockNameOf, parseState } from '@shared/world/blockstate';
import { FLUID } from '@shared/world/blockinfo';
import { BLOCKS_BY_NAME, ITEMS_BY_NAME } from '@shared/data';
import { Survival, DEFAULT_GAME_RULES, DAMAGE, type GameRules } from './survival';
import { Difficulty, EXHAUSTION } from '@shared/game/food';
import { soundId, sourceId, type SoundSource } from '@shared/sound/events';
import { soundTypeOf } from '@shared/world/soundtype';
import { computeAttack } from '@shared/game/combat';
import { StepTracker } from '@shared/entity/steps';
import { MobManager, MOB_TYPES } from './mobs/manager';
import { Mob } from './mobs/mob';
import type { MobSave } from './mobs/persist';
// --- block behaviours (Phase 4: ticks, gravity, farming, doors)
import { BlockBehaviors } from './blocks';
import { FallingBlockEntity } from './fallingblock';
import { ItemUse } from './itemuse';
import { Arrow } from './arrow';
import { Thrown } from './throwable';
import { Containers } from './containers';
import { ServerRedstone } from './redstone';
import { takeGenBlockEntities } from '@shared/worldgen/features/underground';
import { takeGenEntities } from '@shared/worldgen/structures/entities';
import { Commands, commandHooks, type AccessStore } from './commands';
import { DEFAULT_ALL_GAME_RULES, type AllGameRules } from './commands/gamerules';

export interface Connection {
  send(data: ArrayBuffer): void;
  close(reason: string): void;
  /** remote IP address (dedicated server; used by /ban-ip) */
  address?: string;
}

export interface ServerOptions {
  seed: bigint;
  /** Development scene (e.g. 'models' showcase). */
  scene?: string;
  /** Use the flat development terrain instead of the 1.17 generator (fast tests). */
  devTerrain?: boolean;
  /** Max chunks sent per tick across all players. */
  chunkGenBudget?: number;
  /**
   * Milliseconds per tick that chunk generation (generate / decorate / light) may use, so a
   * player flying into new terrain never stalls the 20 TPS loop. Default 20 (Infinity when
   * chunkGenBudget is given explicitly, as tests expect whole chunks per tick).
   */
  chunkGenTimeMs?: number;
  /** Game mode for new players: 0 survival, 1 creative, 2 adventure, 3 spectator. */
  defaultGameMode?: number;
  /** Seed for the level's random source (tests); defaults to the clock like vanilla. */
  randomSeed?: bigint;
  /** Natural/chunk-generation mob spawning (default: on, except on the flat dev terrain used by tests). */
  spawnMobs?: boolean;
  /** Persistent world storage; without it the world lives only in memory. Call load() before start(). */
  storage?: WorldStorage;
  /** World name written to the level data. */
  worldName?: string;
  /** Dedicated server: enables /op, /ban, /whitelist, /stop… (vanilla registers them only there). */
  dedicated?: boolean;
  /** The world's "Allow Cheats" for the single-player/LAN host (default on). */
  cheats?: boolean;
  /** Persistence for ops/bans/whitelist (the dedicated server's JSON files). */
  access?: AccessStore;
}

/** Vanilla MinecraftServer autosave interval: every 6000 ticks (5 minutes). */
export const AUTOSAVE_INTERVAL = 6000;
/** Player-data key of the world's host (single-player / LAN host), like level.dat's Player tag. */
export const HOST_PLAYER_KEY = '~host';

export class GameServer {
  // ---- dimensions (vanilla ServerLevel per dimension; see level.ts) ----
  readonly levels = new Map<string, ServerLevel>();
  /** The dimension being ticked or whose player's packet is being handled; world/light/entities/players below are its. */
  level!: ServerLevel;
  /** Every connected player, in any dimension (vanilla PlayerList). */
  readonly allPlayers: ServerPlayer[] = [];
  get world(): BlockWorld {
    return this.level.world;
  }
  get light(): LightEngine {
    return this.level.light;
  }
  get generator(): LevelGenerator {
    return this.level.generator;
  }
  /** Players in the current dimension (ServerLevel.players); allPlayers has everyone. */
  get players(): ServerPlayer[] {
    return this.level.players;
  }
  get entities(): Map<number, ServerEntity> {
    return this.level.entities;
  }
  get fluids(): FluidTicks {
    return this.level.fluids;
  }
  private get lightDirty(): Map<number, [number, number, number]> {
    return this.level.lightDirty;
  }
  /** Run `fn` with `lv` as the current dimension. */
  inLevel<T>(lv: ServerLevel, fn: () => T): T {
    const prev = this.level;
    this.level = lv;
    try {
      return fn();
    } finally {
      this.level = prev;
    }
  }
  /** Player's dimension (overworld when unknown). */
  levelOf(p: ServerPlayer): ServerLevel {
    return this.levels.get(p.dimension) ?? this.levels.get('overworld')!;
  }
  readonly portals: Portals;
  /**
   * Move a player to another dimension (ServerPlayer.changeDimension → PlayerList.respawn): the
   * client gets a `dimension` packet, drops its chunks and entities, and the new dimension's
   * chunks are streamed in.
   */
  changeDimension(p: ServerPlayer, dim: string, x: number, y: number, z: number, yaw: number, pitch: number): void {
    const from = this.levelOf(p), to = this.levels.get(dim);
    if (!to) return;
    for (const o of this.allPlayers) if (o !== p && o.tracking.delete(p.id)) this.send(o, { t: 'removeEntities', ids: [p.id] });
    if (p.tracking.size) this.send(p, { t: 'removeEntities', ids: [...p.tracking] });
    this.portals.arrived(p, x, y, z);
    const i = from.players.indexOf(p);
    if (i >= 0) from.players.splice(i, 1);
    if (!to.players.includes(p)) to.players.push(p);
    p.dimension = to.id;
    (p.phys as unknown as { world: BlockWorld }).world = to.world;
    p.sent.clear();
    p.tracking.clear();
    p.x = x;
    p.y = y;
    p.z = z;
    p.yaw = yaw;
    p.pitch = pitch;
    p.prevTickX = x;
    p.prevTickZ = z;
    p.fallDistance = 0;
    p.lastSentX = NaN;
    this.send(p, { t: 'dimension', dimension: to.id, gameMode: p.gameMode, x, y, z, yaw, pitch });
    this.inLevel(to, () => {
      this.sendAbilities(p);
      this.survival.sync(p);
    });
    this.send(p, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
    // ServerLevel weather is per dimension; only the overworld has any
    this.send(p, { t: 'weather', rain: to.id === 'overworld' ? this.rainLevel : 0, thunder: to.id === 'overworld' ? this.thunderLevel * this.rainLevel : 0 });
  }
  // ---- end dimensions ----
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
  readonly rand: JavaRandom;
  readonly gameRules: AllGameRules = { ...DEFAULT_ALL_GAME_RULES };
  readonly commands = new Commands(this);
  difficulty: Difficulty = Difficulty.Normal;
  readonly survival = new Survival(this);
  /** item use, durability, armour, effects sync (itemuse.ts) */
  readonly items = new ItemUse(this);
  /** server.properties pvp */
  pvp = true;
  readonly sleep = new Sleep(this);
  /** mob spawning, combat, interactions and sync */
  readonly mobs = new MobManager(this);
  /** Block behaviours: scheduled + random ticks, gravity blocks, farming, doors (blocks.ts). */
  readonly blocks = new BlockBehaviors(this);
  /** container menus, block entities and furnaces */
  readonly containers = new Containers(this);
  /** redstone signals and components (redstone.ts) */
  readonly redstone = new ServerRedstone(this);
  // ---- fluids (FlowingFluid ticks; see fluidticks.ts) ----
  private readonly makeFluids = (): FluidTicks => new FluidTicks({
    getState: (x, y, z) => this.world.getState(x, y, z),
    setBlock: (x, y, z, s) => {
      this.setBlock(x, y, z, s);
      this.updateNeighbors(x, y, z);
    },
    dropResources: (x, y, z, s) => {
      for (const it of blockDrops(s, { silkTouch: false, canHarvest: true, random: () => this.rand.nextFloat() })) this.popResource(x, y, z, it);
    },
    fizz: (x, y, z) => {
      const key = chunkKey(x >> 4, z >> 4);
      for (const p of this.players) if (p.sent.has(key)) this.send(p, { t: 'levelEvent', event: 1501, x, y, z, data: 0 });
    },
    nextInt: (n) => this.rand.nextInt(n),
    isTickingChunk: (cx, cz) => {
      if (this.world.getChunk(cx, cz)?.stage !== 3 || !this.isTickingChunk(cx, cz)) return false;
      return !!(this.world.getChunk(cx - 1, cz) && this.world.getChunk(cx + 1, cz) && this.world.getChunk(cx, cz - 1) && this.world.getChunk(cx, cz + 1));
    },
    now: () => this.gameTime,
  });
  // ---- end fluids ----
  /** gamerules playersSleepingPercentage and spawnRadius */
  playersSleepingPercentage = 100;
  spawnRadius = 10;
  /** world spawn (set on the first join at the origin) */
  worldSpawn: [number, number, number] = [8, 64, 8];
  worldSpawnSet = false;
  /** Server simulation distance (chunks); the single-player host's setting overrides it. */
  simulationDistance = 10;
  nextEntityId = 1;
  private readonly chunkGenBudget: number;
  private readonly chunkGenTimeMs: number;
  /** Per-tick chunk pipeline timings for profiling (EMA, ms). */
  readonly genStats = { genMs: 0, sent: 0, generated: 0, decorated: 0 };
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Measured milliseconds per tick (for F3 / profiling). */
  mspt = 0;

  constructor(readonly opts: ServerOptions) {
    this.rand = new JavaRandom(opts.randomSeed ?? BigInt(Date.now()));
    // development scenes (model showcase, tests) keep the flat dev terrain; worlds use the 1.17 generator
    const dev = !!(opts.scene || opts.devTerrain);
    const zoom = obfuscateSeed(opts.seed);
    const mkLevel = (type: DimensionType, gen: LevelGenerator) => {
      const lv = new ServerLevel(type, gen, type.folder ? opts.storage?.dimension?.(type.folder) : opts.storage, zoom);
      lv.light.onSectionChanged = (cx, sy, cz) => {
        lv.lightDirty.set(chunkKey(cx, cz) * 16 + sy, [cx, sy, cz]);
        lv.saveDirty.add(chunkKey(cx, cz));
      };
      this.levels.set(type.id, lv);
      this.level = lv;
      lv.fluids = this.makeFluids();
      lv.fluids.ultraWarm = type.ultraWarm;
      return lv;
    };
    mkLevel(DIMENSION_TYPES.the_nether, dev ? new DevGenerator(opts.seed, opts.scene) : new NetherGenerator(opts.seed));
    this.level = mkLevel(DIMENSION_TYPES.overworld, dev ? new DevGenerator(opts.seed, opts.scene) : new OverworldGenerator(opts.seed));
    this.portals = new Portals(this);
    this.chunkGenBudget = opts.chunkGenBudget ?? 6;
    this.chunkGenTimeMs = opts.chunkGenTimeMs ?? (opts.chunkGenBudget !== undefined ? Infinity : 20);
    this.commands.configure(opts);
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
        const refused = owner ? null : this.commands.loginCheck(p.name.slice(0, 16) || 'Player', conn.address);
        if (refused) {
          conn.send(encodeS2C({ t: 'disconnect', reason: refused }));
          conn.close(refused);
          return;
        }
        player = this.join(conn, p, owner);
        this.commands.joined(player);
        return;
      }
      const pl = player;
      this.inLevel(this.levelOf(pl), () => this.handle(pl, p));
    };
  }

  disconnect(conn: Connection): void {
    const i = this.allPlayers.findIndex((p) => p.conn === conn);
    if (i < 0) return;
    const [gone] = this.allPlayers.splice(i, 1);
    const gl = this.levelOf(gone!).players;
    if (gl.includes(gone!)) gl.splice(gl.indexOf(gone!), 1);
    this.items.forget(gone!);
    this.containers.closeAll(gone!);
    if (this.opts.storage) {
      const key = this.playerKey(gone!);
      const data = capturePlayer(gone!);
      this.playerData.set(key, data);
      this.opts.storage.putPlayer(key, data).catch((e) => console.error('[server] saving player failed', e));
    }
    this.commands.left(gone!);
    for (const o of this.allPlayers) {
      if (o.tracking.delete(gone!.id)) this.send(o, { t: 'removeEntities', ids: [gone!.id] });
      this.send(o, { t: 'playerInfo', action: 4, id: gone!.id, name: gone!.name, skin: '', gameMode: 0 });
      if (o.camera === gone) this.setCamera(o, null);
    }
  }

  private join(conn: Connection, hello: Extract<C2S, { t: 'hello' }>, owner: boolean): ServerPlayer {
    const p = new ServerPlayer(this.nextEntityId++, conn, this.world);
    p.name = hello.name.slice(0, 16) || 'Player';
    // a bundled skin name, or an uploaded 64×64 PNG as a data URL (client-checked, size-capped here)
    p.skin = hello.skin.startsWith('data:image/png;base64,') ? (hello.skin.length <= 24000 ? hello.skin : '') : hello.skin.slice(0, 64);
    p.isOwner = owner;
    p.viewDistance = clampViewDistance(hello.viewDistance);
    p.gameMode = this.opts.defaultGameMode ?? 0;
    p.flying = p.gameMode === 3;
    const saved = this.opts.storage ? this.playerData.get(this.playerKey(p)) : undefined;
    if (saved && saved.health > 0) applyPlayer(p, saved);
    else {
      [p.x, p.y, p.z] = this.spawnPosition();
      // died and quit before respawning: back at the spawn point (death drops were already made)
      if (saved) {
        applyPlayer(p, saved);
        p.living.health = p.living.maxHealth;
        p.living.food.foodLevel = 20;
        p.living.food.saturationLevel = 5;
        p.living.remainingFireTicks = -20;
        p.dimension = 'overworld';
        [p.x, p.y, p.z] = p.respawn ? [p.respawn.x + 0.5, p.respawn.y + 0.6, p.respawn.z + 0.5] : this.spawnPosition();
      }
    }
    p.prevTickX = p.x;
    p.prevTickZ = p.z;
    // the saved dimension (unknown ones fall back to the overworld)
    if (!this.levels.has(p.dimension)) p.dimension = 'overworld';
    this.level = this.levelOf(p);
    (p.phys as unknown as { world: BlockWorld }).world = this.world;
    p.living.effects.onChange = (e, removed) => this.items.sendEffect(p, e, removed);
    this.allPlayers.push(p);
    this.players.push(p);
    this.send(p, {
      t: 'login', entityId: p.id, gameMode: p.gameMode, dimension: this.level.id, seed: this.world.biomeZoomSeed!,
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, simulationDistance: 10,
    });
    if (saved) {
      for (let i = 0; i < p.inventory.slots.length; i++) if (p.inventory.slots[i]) this.syncSlot(p, i);
      this.send(p, { t: 'heldSlot', slot: p.inventory.selected });
    }
    this.sendAbilities(p);
    this.survival.sync(p);
    // effects restored from the save
    for (const e of p.living.effects.active.values()) this.items.sendEffect(p, e, false);
    this.send(p, { t: 'difficulty', difficulty: this.difficulty });
    this.send(p, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
    this.send(p, { t: 'weather', rain: this.rainLevel, thunder: this.thunderLevel * this.rainLevel });
    // PlayerList.placeNewPlayer: everyone's PlayerInfo to the newcomer, theirs to everyone
    for (const o of this.allPlayers) {
      this.send(p, { t: 'playerInfo', action: 0, id: o.id, name: o.name, skin: o.skin, gameMode: o.gameMode });
      if (o !== p) this.send(o, { t: 'playerInfo', action: 0, id: p.id, name: p.name, skin: p.skin, gameMode: p.gameMode });
    }
    return p;
  }

  /** Level.isRaining / isThundering (thresholds on the smoothed levels). */
  isRaining(): boolean {
    return this.rainLevel > 0.2;
  }
  isThundering(): boolean {
    return this.thunderLevel * this.rainLevel > 0.9;
  }

  /** Chunks that tick (random ticks, lightning, entities): within simulation distance of a player. */
  isTickingChunk(cx: number, cz: number): boolean {
    for (const p of this.players) {
      const d = this.simulationDistanceFor();
      if (Math.max(Math.abs((Math.floor(p.x) >> 4) - cx), Math.abs((Math.floor(p.z) >> 4) - cz)) <= d) return true;
    }
    return false;
  }

  /** Simulation distance: the host's setting in single-player/LAN, the server's otherwise. */
  simulationDistanceFor(): number {
    const owner = this.allPlayers.find((p) => p.isOwner);
    return owner?.simulationDistance ?? this.simulationDistance;
  }

  /** ServerLevel.tickChunk thunder part: 1 in 100000 per ticking chunk per tick while thundering. */
  private tickLightning(): void {
    if (!(this.isRaining() && this.isThundering())) return;
    const seen = new Set<number>();
    for (const p of this.players) {
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      const d = Math.min(this.simulationDistanceFor(), 8);
      for (let cx = pcx - d; cx <= pcx + d; cx++)
        for (let cz = pcz - d; cz <= pcz + d; cz++) {
          const key = chunkKey(cx, cz);
          if (seen.has(key) || !this.world.getChunk(cx, cz)) continue;
          seen.add(key);
          // noPlayersCloseForSpawning: a player within 128 blocks of the chunk centre
          const dx = cx * 16 + 8 - p.x, dz = cz * 16 + 8 - p.z;
          if (dx * dx + dz * dz > 128 * 128) continue;
          if (this.rand.nextInt(100000) !== 0) continue;
          const [x, y, z] = this.lightningTarget(cx * 16 + this.rand.nextInt(16), cz * 16 + this.rand.nextInt(16));
          if (isRainingAt(this.world, this.isRaining(), x, y, z)) this.strikeLightning(x + 0.5, y, z + 0.5);
        }
    }
  }

  /** ServerLevel.findLightningTargetAround: the top block, or a player under open sky within 3 blocks. */
  private lightningTarget(x: number, z: number): [number, number, number] {
    const c = this.world.getChunk(x >> 4, z >> 4)!;
    const y = c.motionBlocking[(z & 15) * 16 + (x & 15)]!;
    const targets = this.players.filter((p) => {
      if (p.living.dead || Math.abs(p.x - (x + 0.5)) > 3.5 || Math.abs(p.z - (z + 0.5)) > 3.5 || p.y < y - 3) return false;
      const pc = this.world.getChunk(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4);
      return !!pc && pc.motionBlocking[(Math.floor(p.z) & 15) * 16 + (Math.floor(p.x) & 15)]! <= Math.floor(p.y);
    });
    if (targets.length) {
      const t = targets[this.rand.nextInt(targets.length)]!;
      return [Math.floor(t.x), Math.floor(t.y), Math.floor(t.z)];
    }
    return [x, y, z];
  }

  strikeLightning(x: number, y: number, z: number, visualOnly = false): void {
    const b = new LightningBolt(this.nextEntityId++, this.rand, visualOnly);
    b.x = x;
    b.y = y;
    b.z = z;
    this.spawnEntity(b);
  }

  /** LightningBolt.tick server side: strike entities, light fires (needs fire spread, Phase 4). */
  private tickBolt(b: LightningBolt): void {
    // LightningBolt.spawnFire: 4 extra on the first tick (normal/hard), none on re-flashes
    if (!b.visualOnly && b.fire === 4 && (this.difficulty === Difficulty.Normal || this.difficulty === Difficulty.Hard)) this.blocks.lightningFire(b.x, b.y, b.z, 4);
    else if (!b.visualOnly && b.fire === 0) this.blocks.lightningFire(b.x, b.y, b.z, 0);
    if (!b.striking) return;
    this.mobs.thunderHit(b.x, b.y, b.z);
    for (const p of this.players) {
      if (Math.abs(p.x - b.x) > 3 + 0.3 || Math.abs(p.z - b.z) > 3 + 0.3 || p.y + 1.8 < b.y - 3 || p.y > b.y + 9) continue;
      // Entity.thunderHit
      const l = p.living;
      if (p.gameMode !== 3) {
        l.remainingFireTicks++;
        if (l.remainingFireTicks === 0) this.survival.setOnFire(p, 8);
      }
      this.survival.hurt(p, DAMAGE.lightningBolt, 5);
    }
  }

  /** World spawn: on top of the terrain at the world origin (fixed once found). */
  spawnPosition(): [number, number, number] {
    if (!this.worldSpawnSet) {
      const spawn = this.inLevel(this.levels.get('overworld')!, () => this.prepareChunk(0, 0));
      this.worldSpawn = [8, spawn.topY(8, 8) + 1, 8];
      this.worldSpawnSet = true;
    }
    return [this.worldSpawn[0] + 0.5, this.worldSpawn[1], this.worldSpawn[2] + 0.5];
  }

  actionBar(p: ServerPlayer, text: string): void {
    this.send(p, { t: 'actionBar', text });
  }

  setDayTime(t: number): void {
    this.dayTime = t;
    for (const pl of this.allPlayers) this.send(pl, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
  }

  /** ServerLevel.resetWeatherCycle (after sleeping through the night). */
  resetWeatherCycle(): void {
    this.rainTime = 0;
    this.raining = false;
    this.thunderTime = 0;
    this.thundering = false;
  }

  /**
   * Level.playSound(except, ...): sent to players within 16 blocks (× volume when louder),
   * except the one who caused it (they play it themselves).
   */
  playSound(except: ServerPlayer | null, event: string, source: SoundSource, x: number, y: number, z: number, volume: number, pitch: number): void {
    const range = volume > 1 ? 16 * volume : 16;
    const id = soundId(event);
    for (const o of this.players) {
      if (o === except) continue;
      const dx = o.x - x, dy = o.y - y, dz = o.z - z;
      if (dx * dx + dy * dy + dz * dz > range * range) continue;
      this.send(o, { t: 'sound', event: id, category: sourceId(source), x, y, z, volume, pitch });
    }
  }

  /** Send to every player tracking `p` (and `p` itself if asked). */
  broadcastToTrackers(p: ServerPlayer, packet: S2C, self = false): void {
    for (const o of this.players) if (o.tracking.has(p.id) || (self && o === p)) this.send(o, packet);
  }

  /** Player.drop(stack, dropAround = true): flung in a random horizontal direction (death drops). */
  dropAround(p: ServerPlayer, stack: ItemStack): void {
    const r = this.rand;
    const e = new ItemEntity(this.nextEntityId++, stack);
    e.x = p.x;
    e.y = p.y + 1.62 - 0.3;
    e.z = p.z;
    e.pickupDelay = 40;
    const f = r.nextFloat() * 0.5, a = r.nextFloat() * Math.PI * 2;
    e.vx = -Math.sin(a) * f;
    e.vy = 0.2;
    e.vz = Math.cos(a) * f;
    this.spawnEntity(e);
  }

  // ------------------------------------------------------------------ inventory
  syncSlot(p: ServerPlayer, slot: number): void {
    const st = p.inventory.get(slot);
    this.send(p, { t: 'setSlot', slot, item: st?.id ?? 0, count: st?.count ?? 0, damage: st?.damage ?? 0 });
  }

  /** Vanilla pick block: Inventory.setPickedItem (creative) / pickSlot (survival, item already owned). */
  private pickBlock(p: ServerPlayer, x: number, y: number, z: number): void {
    if (p.gameMode === 3 || !this.inReach(p, x, y, z)) return;
    const item = itemForBlock(this.world.getState(x, y, z));
    if (!item) return;
    const inv = p.inventory;
    const found = inv.find(item);
    const suitable = (): number => {
      for (let i = 0; i < 9; i++) {
        const k = (inv.selected + i) % 9;
        if (!inv.get(k)) return k;
      }
      return inv.selected;
    };
    if (found >= 0 && found < 9) inv.selected = found;
    else if (found >= 9) {
      // pickSlot: swap the stack into a suitable hotbar slot
      inv.selected = suitable();
      const held = inv.get(inv.selected);
      inv.set(inv.selected, inv.get(found));
      inv.set(found, held);
      this.syncSlot(p, found);
      this.syncSlot(p, inv.selected);
    } else if (p.gameMode === 1) {
      inv.selected = suitable();
      const held = inv.get(inv.selected);
      if (held) {
        // keep the displaced stack in a free main-inventory slot if there is one
        for (let i = 0; i < 36; i++)
          if (!inv.get(i)) {
            inv.set(i, held);
            this.syncSlot(p, i);
            break;
          }
      }
      inv.set(inv.selected, { id: item, count: 1, damage: 0 });
      this.syncSlot(p, inv.selected);
    }
    this.send(p, { t: 'heldSlot', slot: inv.selected });
  }

  // ------------------------------------------------------------------ digging
  private inReach(p: ServerPlayer, x: number, y: number, z: number): boolean {
    // vanilla: distance from the eye to the block centre squared < 36
    const dx = p.x - (x + 0.5), dy = p.y + 1.5 - (y + 0.5), dz = p.z - (z + 0.5);
    return dx * dx + dy * dy + dz * dz <= 36;
  }

  private handleDig(p: ServerPlayer, action: number, x: number, y: number, z: number): void {
    if (y < 0 || y > 255 || !this.inReach(p, x, y, z)) return this.resendBlock(p, x, y, z);
    if (p.gameMode === 3 || p.gameMode === 2) return this.resendBlock(p, x, y, z);
    const state = this.world.getState(x, y, z);
    if (action === 3) {
      if (p.gameMode !== 1) return this.resendBlock(p, x, y, z);
      // creative: swords can't break blocks
      const held = p.inventory.selectedStack;
      if (held && /_sword$/.test(itemNameOf(held.id))) return this.resendBlock(p, x, y, z);
      this.destroyBlock(x, y, z, p, false);
      return;
    }
    if (action === 0) {
      if (hardness(state) < 0) return this.resendBlock(p, x, y, z);
      if (this.blocks.attack(x, y, z)) return this.resendBlock(p, x, y, z);
      p.digging = { x, y, z, start: this.gameTime };
      if (destroyProgress(this.minerState(p), state) >= 1) {
        this.destroyBlock(x, y, z, p, true);
        p.digging = null;
      }
      return;
    }
    if (action === 1) {
      p.digging = null;
      this.broadcastBreakProgress(p, x, y, z, -1);
      return;
    }
    if (action === 2) {
      const d = p.digging;
      p.digging = null;
      if (!d || d.x !== x || d.y !== y || d.z !== z) return this.resendBlock(p, x, y, z);
      const elapsed = this.gameTime - d.start + 1;
      // vanilla ServerPlayerGameMode: accept when at least 70% of the expected progress elapsed
      if (destroyProgress(this.minerState(p), state) * elapsed < 0.7) return this.resendBlock(p, x, y, z);
      this.destroyBlock(x, y, z, p, true);
      this.broadcastBreakProgress(p, x, y, z, -1);
    }
  }

  private minerState(p: ServerPlayer) {
    const held = p.inventory.selectedStack;
    const eyeState = this.world.getState(Math.floor(p.x), Math.floor(p.y + 1.62), Math.floor(p.z));
    const fx = p.living.effects;
    return { item: held?.id ?? 0, efficiency: 0, haste: Math.max(fx.amplifier('haste'), fx.amplifier('conduit_power')) + 1, miningFatigue: fx.amplifier('mining_fatigue') + 1, underwater: FLUID[eyeState] === 1, aquaAffinity: false, onGround: p.onGround || p.flying };
  }

  private broadcastBreakProgress(p: ServerPlayer, x: number, y: number, z: number, stage: number): void {
    for (const o of this.players) if (o !== p) this.send(o, { t: 'blockBreakProgress', id: p.id, x, y, z, stage });
  }

  private resendBlock(p: ServerPlayer, x: number, y: number, z: number): void {
    this.send(p, { t: 'blockChange', x, y, z, state: this.world.getState(x, y, z) });
  }

  /** Remove a block (with drops for survival breakers), its companion half, and update neighbours. */
  destroyBlock(x: number, y: number, z: number, breaker: ServerPlayer | null, drops: boolean): void {
    const state = this.world.getState(x, y, z);
    if (state === 0) return;
    const name = blockNameOf(state);
    // doors and tall plants drop from their lower half (vanilla destroys it with drops via updateShape)
    const below = this.world.getState(x, y - 1, z);
    const lootState = getProp(state, 'half') === 'upper' && blockNameOf(below) === name ? below : state;
    // Level.destroyBlock leaves the block's fluid behind (waterlogged blocks, kelp, seagrass)
    this.setBlock(x, y, z, legacyBlock(FLUID_OF[state]!));
    // particles + sound for everyone else (the breaker plays them locally)
    for (const o of this.players) if (o !== breaker) this.send(o, { t: 'levelEvent', event: 2001, x, y, z, data: state });
    if (breaker && (breaker.gameMode === 0 || breaker.gameMode === 2)) breaker.living.food.addExhaustion(EXHAUSTION.breakBlock);
    if (drops && breaker && breaker.gameMode !== 1) {
      const held = breaker.inventory.selectedStack;
      const harvest = canHarvest(held?.id ?? 0, state);
      const shears = held ? itemNameOf(held.id) === 'shears' : false;
      const items = blockDrops(lootState, { silkTouch: false, shears, canHarvest: harvest, random: () => this.rand.nextFloat() });
      for (const it of items) this.popResource(x, y, z, it);
      // Block.spawnAfterBreak → popExperience (OreBlock / RedStoneOreBlock / SpawnerBlock)
      const xp = harvest ? oreExperience(name, this.rand) : 0;
      // Block.popExperience: only with doTileDrops
      if (xp > 0 && this.gameRules.doTileDrops) this.spawnExperience(x + 0.5, y + 0.5, z + 0.5, xp);
    }
    // Item.mineBlock: tools lose durability (survival/adventure breakers)
    if (drops && breaker && breaker.gameMode !== 1) this.items.onBlockMined(breaker, state);
    // beds: the other half goes too (BedBlock.updateShape → destroyBlock), dropping its loot
    // (the bed item comes from the head) unless the breaker is in creative
    if (name.endsWith('_bed')) {
      const d = DIRS.indexOf(getProp(state, 'facing') as (typeof DIRS)[number]);
      const sgn = getProp(state, 'part') === 'foot' ? 1 : -1;
      const ox = x + DX[d]! * sgn, oz = z + DZ[d]! * sgn;
      const other = this.world.getState(ox, y, oz);
      if (blockNameOf(other) === name && getProp(other, 'part') !== getProp(state, 'part')) {
        this.setBlock(ox, y, oz, 0);
        for (const o of this.players) if (o !== breaker) this.send(o, { t: 'levelEvent', event: 2001, x: ox, y, z: oz, data: other });
        if (drops && (!breaker || breaker.gameMode !== 1)) {
          for (const it of blockDrops(other, { silkTouch: false, canHarvest: true, random: () => this.rand.nextFloat() })) this.popResource(ox, y, oz, it);
        }
        this.updateNeighbors(ox, y, oz);
      }
    }
    // two-block structures lose their other half without drops
    if (name.endsWith('_door') || ['tall_grass', 'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony'].includes(name)) {
      const oy = getProp(state, 'half') === 'upper' || getProp(state, 'half') === 'upper' ? -1 : 1;
      const other = this.world.getState(x, y + oy, z);
      if (blockNameOf(other) === name) this.setBlock(x, y + oy, z, 0);
    }
    this.updateNeighbors(x, y, z);
  }

  /** After a change at (x,y,z): refresh neighbour shapes and break unsupported neighbours. */
  updateNeighbors(x: number, y: number, z: number, depth = 0): void {
    if (depth > 64) return;
    for (let d = 0; d < 6; d++) {
      const nx = x + DX[d]!, ny = y + DY[d]!, nz = z + DZ[d]!;
      if (ny < 0 || ny > 255) continue;
      const st = this.world.getState(nx, ny, nz);
      if (st === 0) continue;
      if (!canSurvive(this.world, nx, ny, nz, st)) {
        this.setBlock(nx, ny, nz, 0);
        for (const o of this.players) this.send(o, { t: 'levelEvent', event: 2001, x: nx, y: ny, z: nz, data: st });
        for (const it of blockDrops(st, { silkTouch: false, canHarvest: true, random: () => this.rand.nextFloat() })) this.popResource(nx, ny, nz, it);
        this.updateNeighbors(nx, ny, nz, depth + 1);
        continue;
      }
      const ns = updateShape(this.world, nx, ny, nz, st);
      if (ns !== st) this.setBlock(nx, ny, nz, ns);
    }
  }

  // ------------------------------------------------------------------ placing
  private handleUseOn(p: ServerPlayer, m: Extract<C2S, { t: 'useOn' }>): void {
    const { x, y, z, face } = m;
    if (!this.inReach(p, x, y, z) || p.gameMode === 3) return this.resendBlock(p, x, y, z);
    // block interaction first unless sneaking with something in hand (secondary use)
    const holding = !!p.inventory.selectedStack || !!p.inventory.get(40);
    if (!(p.sneaking && holding) && this.useBlock(p, x, y, z)) return;
    const slot = m.hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    const block = held ? blockForItem(held.id) : null;
    // hoes, shovels, axes, bone meal, flint and steel on blocks/TNT (blocks.ts)
    if (held && !block && p.gameMode !== 2 && this.blocks.useItemOn(p, slot, held, x, y, z, face)) return;
    // other non-block items (buckets, flint and steel fire): Item.useOn (itemuse.ts)
    if (held && !block && this.items.useOn(p, m.hand === 1 ? 1 : 0, x, y, z, face)) return;
    if (!held || !block || p.gameMode === 2) return;
    const clicked = this.world.getState(x, y, z);
    let px = x, py = y, pz = z;
    if (!(isReplaceable(clicked, block) || (block.endsWith('_slab') && blockNameOf(clicked) === block && getProp(clicked, 'type') !== 'double' && slabMergeFace(clicked, face, m.cy)))) {
      px += DX[face]!;
      py += DY[face]!;
      pz += DZ[face]!;
    }
    if (py < 0 || py > 255) return this.resendBlock(p, px, py, pz);
    const existing = this.world.getState(px, py, pz);
    const canReplaceExisting = isReplaceable(existing, block) || (block.endsWith('_slab') && blockNameOf(existing) === block);
    if (!canReplaceExisting) return this.resendBlock(p, px, py, pz);
    let state = stateForPlacement(block, { world: this.world, x: px, y: py, z: pz, face, hx: m.cx, hy: m.cy, hz: m.cz, yaw: p.yaw, pitch: p.pitch, sneaking: p.sneaking }, existing);
    if (state !== null) state = this.redstone.placementState(px, py, pz, state);
    if (state === null || !canSurvive(this.world, px, py, pz, state)) return this.resendBlock(p, px, py, pz);
    const extra = companionPlacement(block, state);
    for (const e of extra) {
      const ey = py + e.dy;
      if (ey > 255 || !isReplaceable(this.world.getState(px + e.dx, ey, pz + e.dz))) return this.resendBlock(p, px, py, pz);
    }
    // don't place a block inside a player
    for (const b of collisionBoxes(state)) {
      const box = new AABB(px + b[0], py + b[1], pz + b[2], px + b[3], py + b[4], pz + b[5]);
      for (const o of this.players) {
        if (o.gameMode === 3) continue;
        const pb = AABB.ofSize(o.x, o.y, o.z, 0.6, o.pose === 'crouching' ? 1.5 : o.pose === 'swimming' ? 0.6 : 1.8);
        if (box.intersects(pb)) return this.resendBlock(p, px, py, pz);
      }
    }
    this.setBlock(px, py, pz, state);
    for (const e of extra) this.setBlock(px + e.dx, py + e.dy, pz + e.dz, e.state);
    this.updateNeighbors(px, py, pz);
    this.redstone.placed(px, py, pz);
    // BlockItem.place: the placer plays it locally, everyone else hears it from here
    const st = soundTypeOf(state);
    this.playSound(p, st.place, 'block', px + 0.5, py + 0.5, pz + 0.5, (st.volume + 1) / 2, st.pitch * 0.8);
    if (p.gameMode !== 1) {
      held.count--;
      if (held.count <= 0) p.inventory.set(slot, null);
      this.syncSlot(p, slot);
    }
  }

  // ------------------------------------------------------------------ item entities
  newEntityId(): number {
    return this.nextEntityId++;
  }

  spawnEntity(e: ServerEntity): void {
    this.entities.set(e.id, e);
  }

  allocateEntityId(): number {
    return this.nextEntityId++;
  }

  /** Vanilla Block.popResource: item at the block centre ± 0.25 with a small upward toss. */
  popResource(x: number, y: number, z: number, stack: ItemStack): void {
    // gamerule doTileDrops (vanilla Block.popResource)
    if (!this.gameRules.doTileDrops) return;
    const r = this.rand;
    const e = new ItemEntity(this.nextEntityId++, stack);
    e.x = x + 0.5 + (r.nextDouble() * 0.5 - 0.25);
    e.y = y + 0.5 + (r.nextDouble() * 0.5 - 0.25) - 0.125;
    e.z = z + 0.5 + (r.nextDouble() * 0.5 - 0.25);
    e.vx = r.nextDouble() * 0.2 - 0.1;
    e.vy = 0.2;
    e.vz = r.nextDouble() * 0.2 - 0.1;
    this.spawnEntity(e);
  }

  /** Spawn an item entity with a given motion (Containers.dropItemStack and friends). */
  spawnItem(x: number, y: number, z: number, stack: ItemStack, vx: number, vy: number, vz: number): void {
    const e = new ItemEntity(this.nextEntityId++, stack);
    e.x = x;
    e.y = y;
    e.z = z;
    e.vx = vx;
    e.vy = vy;
    e.vz = vz;
    this.spawnEntity(e);
  }

  /** Q / Ctrl+Q (vanilla Player.drop with traceItem). */
  private dropFromHand(p: ServerPlayer, all: boolean): void {
    const inv = p.inventory;
    const held = inv.selectedStack;
    if (isEmpty(held)) return;
    const n = all ? held.count : 1;
    const stack: ItemStack = { id: held.id, count: n, damage: held.damage };
    held.count -= n;
    if (held.count <= 0) inv.set(inv.selected, null);
    this.syncSlot(p, inv.selected);
    this.tossItem(p, stack);
  }

  tossItem(p: ServerPlayer, stack: ItemStack): void {
    const r = this.rand;
    const e = new ItemEntity(this.nextEntityId++, stack);
    e.x = p.x;
    e.y = p.y + 1.62 - 0.3;
    e.z = p.z;
    e.pickupDelay = 40;
    const yr = (p.yaw * Math.PI) / 180, pr = (p.pitch * Math.PI) / 180;
    const f = 0.3;
    const sy = Math.sin(yr), cy = Math.cos(yr), sp = Math.sin(pr), cp = Math.cos(pr);
    const ang = r.nextFloat() * Math.PI * 2, f4 = 0.02 * r.nextFloat();
    e.vx = -sy * cp * f + Math.cos(ang) * f4;
    e.vy = -sp * f + 0.1 + (r.nextFloat() - r.nextFloat()) * 0.1;
    e.vz = cy * cp * f + Math.sin(ang) * f4;
    this.spawnEntity(e);
  }

  private tickEntities(): void {
    for (const e of this.entities.values()) {
      // entities outside every player's simulation distance are frozen
      if (!(e instanceof LightningBolt) && !this.isTickingChunk(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4)) continue;
      e.tick(this.world);
      if (e instanceof LightningBolt) this.tickBolt(e);
      if (e instanceof ItemEntity && !e.removed) {
        this.items.itemHazards(e);
        // ItemEntity.tick: merge every 2 ticks while moving between blocks, else every 40
        const moved = Math.floor(e.x) !== Math.floor(e.prevX) || Math.floor(e.y) !== Math.floor(e.prevY) || Math.floor(e.z) !== Math.floor(e.prevZ);
        if (!e.removed && e.age % (moved ? 2 : 40) === 0) this.tryMerge(e);
      }
      if (e instanceof ExperienceOrb && !e.removed && e.age % 20 === 1) this.scanOrb(e);
    }
    // experience orbs (Player.touch → ExperienceOrb.playerTouch: one orb every 2 ticks)
    for (const p of this.players) {
      if (p.takeXpDelay > 0) p.takeXpDelay--;
      if (p.gameMode === 3 || p.living.dead) continue;
      const bb = AABB.ofSize(p.x, p.y, p.z, 0.6, 1.8).inflate(1, 0.5, 1);
      for (const e of this.entities.values()) {
        if (!(e instanceof ExperienceOrb) || e.removed || p.takeXpDelay !== 0) continue;
        if (!e.bb().intersects(bb)) continue;
        p.takeXpDelay = 2;
        for (const o of this.players) if (o === p || o.tracking.has(e.id)) this.send(o, { t: 'takeItem', itemId: e.id, collectorId: p.id, count: 1 });
        const before = p.living.experienceLevel;
        this.survival.giveExperience(p, e.value, false);
        this.levelUpSound(p, before);
        if (--e.count === 0) e.removed = true;
      }
    }
    // pickups (Player.touch → ItemEntity.playerTouch)
    for (const p of this.players) {
      if (p.gameMode === 3) continue;
      const bb = AABB.ofSize(p.x, p.y, p.z, 0.6, 1.8).inflate(1, 0.5, 1);
      for (const e of this.entities.values()) {
        if (!(e instanceof ItemEntity) || e.removed || e.pickupDelay !== 0) continue;
        if (!e.bb().intersects(bb)) continue;
        const before = e.stack.count;
        const left = p.inventory.add(e.stack);
        const taken = before - left;
        if (taken <= 0) continue;
        for (const o of this.players) if (o === p || o.tracking.has(e.id)) this.send(o, { t: 'takeItem', itemId: e.id, collectorId: p.id, count: taken });
        e.stack.count = left;
        if (left <= 0) e.removed = true;
        for (let i = 0; i < 36; i++) this.syncSlot(p, i);
      }
    }
    for (const [id, e] of this.entities) {
      if (!e.removed) continue;
      this.entities.delete(id);
      for (const p of this.players) if (p.tracking.delete(id)) this.send(p, { t: 'removeEntities', ids: [id] });
    }
  }

  /** ExperienceOrb.scanForEntities: follow the nearest player within 8 blocks, merge with equal orbs. */
  private scanOrb(e: ExperienceOrb): void {
    let best: ServerPlayer | null = null, bd = 64;
    for (const p of this.players) {
      if (p.gameMode === 3 || p.living.dead) continue;
      const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2 + (p.z - e.z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    e.following = best ? { get x() { return best.x; }, get y() { return best.y; }, get z() { return best.z; }, eyeHeight: best.phys.eyeHeight } : null;
    const bb = e.bb().inflate(0.5);
    for (const o of this.entities.values()) {
      if (o === e || !(o instanceof ExperienceOrb) || o.removed || o.value !== e.value || !o.bb().intersects(bb)) continue;
      e.count += o.count;
      e.age = Math.min(e.age, o.age);
      o.removed = true;
    }
  }

  /** ExperienceOrb.award: split XP into orbs; an equal orb nearby absorbs it instead (1 in 40 id match). */
  spawnExperience(x: number, y: number, z: number, amount: number): void {
    const r = this.rand;
    while (amount > 0) {
      const v = experienceOrbValue(amount);
      amount -= v;
      const pick = r.nextInt(40);
      let merged = false;
      for (const o of this.entities.values()) {
        if (!(o instanceof ExperienceOrb) || o.removed || o.value !== v || (o.id - pick) % 40 !== 0) continue;
        if (Math.abs(o.x - x) > 0.5 || Math.abs(o.y - y) > 0.5 || Math.abs(o.z - z) > 0.5) continue;
        o.count++;
        o.age = 0;
        merged = true;
        break;
      }
      if (merged) continue;
      const e = new ExperienceOrb(this.nextEntityId++, v);
      e.x = x;
      e.y = y;
      e.z = z;
      e.vx = (r.nextDouble() * 0.2 - 0.1) * 2;
      e.vy = r.nextDouble() * 0.2 * 2;
      e.vz = (r.nextDouble() * 0.2 - 0.1) * 2;
      this.spawnEntity(e);
    }
  }

  /** Player.giveExperienceLevels: a chime every fifth level (at most every 5 s). */
  private levelUpSound(p: ServerPlayer, before: number): void {
    const lvl = p.living.experienceLevel;
    if (lvl > before && lvl % 5 === 0 && p.lastLevelUpTick < this.gameTime - 100) {
      const f = lvl > 30 ? 1 : lvl / 30;
      this.playSound(null, 'entity.player.levelup', 'player', p.x, p.y, p.z, f * 0.75, 1);
      p.lastLevelUpTick = this.gameTime;
    }
  }

  private tryMerge(a: ItemEntity): void {
    const max = maxStackSize(a.stack.id);
    if (a.stack.count >= max) return;
    const bb = a.bb().inflate(0.5, 0, 0.5);
    for (const b of this.entities.values()) {
      if (b === a || !(b instanceof ItemEntity) || b.removed || b.stack.id !== a.stack.id || b.stack.damage !== a.stack.damage) continue;
      if (!b.bb().intersects(bb)) continue;
      if (b.stack.count + a.stack.count > max) continue;
      // the smaller stack merges into the larger one
      const [big, small] = a.stack.count >= b.stack.count ? [a, b] : [b, a];
      big.stack.count += small.stack.count;
      big.pickupDelay = Math.max(big.pickupDelay, small.pickupDelay);
      big.age = Math.min(big.age, small.age);
      small.removed = true;
      for (const p of this.players) if (p.tracking.has(big.id)) this.send(p, { t: 'itemStack', id: big.id, item: big.stack.id, count: big.stack.count });
      if (small === a) return;
    }
  }

  private trackEntities(): void {
    for (const p of this.players) {
      for (const e of this.entities.values()) {
        if (e.removed) continue;
        const dx = e.x - p.x, dz = e.z - p.z;
        const range = Math.min(e.trackRange, p.viewDistance * 16);
        const visible = dx * dx + dz * dz <= range * range;
        if (visible && !p.tracking.has(e.id)) {
          p.tracking.add(e.id);
          this.send(p, { t: 'addEntity', id: e.id, type: e.type, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, data: e instanceof ExperienceOrb ? e.value : e instanceof FallingBlockEntity ? e.state : e instanceof Arrow ? e.ownerId :  e instanceof Thrown ? e.item : 0 });
          if (e instanceof ItemEntity) this.send(p, { t: 'itemStack', id: e.id, item: e.stack.id, count: e.stack.count });
          this.mobs.onStartTracking(p, e);
        } else if (!visible && p.tracking.has(e.id)) {
          p.tracking.delete(e.id);
          this.send(p, { t: 'removeEntities', ids: [e.id] });
        }
      }
    }
    for (const e of this.entities.values()) {
      if (e.removed || e instanceof Mob) continue;
      if (e.x === e.sentX && e.y === e.sentY && e.z === e.sentZ) continue;
      e.sentX = e.x;
      e.sentY = e.y;
      e.sentZ = e.z;
      for (const p of this.players) if (p.tracking.has(e.id)) this.send(p, { t: 'entityMove', id: e.id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, headYaw: e.yaw, onGround: e.onGround });
    }
  }

  private sendAbilities(p: ServerPlayer): void {
    this.send(p, { t: 'abilities', flying: p.flying, mayFly: p.mayFly, flySpeed: 0.05, instabuild: p.gameMode === 1, invulnerable: p.gameMode === 1 || p.gameMode === 3 });
  }

  setGameMode(p: ServerPlayer, mode: number): void {
    p.gameMode = mode;
    if (!p.mayFly) p.flying = false;
    if (mode === 3) p.flying = true;
    // leaving spectator stops looking through another entity
    if (mode !== 3) this.setCamera(p, null);
    // spectators can't keep a container open
    else this.containers.closeContainer(p, true);
    p.stateDirty = true;
    this.send(p, { t: 'gameMode', mode });
    this.sendAbilities(p);
    for (const o of this.allPlayers) this.send(o, { t: 'playerInfo', action: 1, id: p.id, name: p.name, skin: '', gameMode: mode });
  }

  /** ServerPlayer.setCamera: look through `target` (null = yourself), landing where it is. */
  setCamera(p: ServerPlayer, target: ServerPlayer | null): void {
    if (target === p) target = null;
    if (p.camera === target) return;
    p.camera = target;
    this.send(p, { t: 'setCamera', id: (target ?? p).id });
    if (target) {
      p.x = target.x;
      p.y = target.y;
      p.z = target.z;
    }
    this.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
  }

  /**
   * Validate a client move like vanilla ServerGamePacketListenerImpl.handleMovePlayer:
   * reject "moved too quickly" (> 10 blocks/tick, owner exempt) and "moved wrongly" (the
   * collision-resolved move ends more than 0.25 blocks from the claimed position; creative
   * and spectator exempt), and refuse moving into solid blocks.
   */
  private handleMove(p: ServerPlayer, m: Extract<C2S, { t: 'move' }>): void {
    // moves sent from the old dimension before the client saw the dimension change
    if (this.portals.ignoreMove(p, m.x, m.y, m.z)) return;
    // sleeping players stay in bed (rotation still updates)
    if (p.sleepingPos) {
      p.yaw = m.yaw;
      p.pitch = Math.max(-90, Math.min(90, m.pitch));
      return;
    }
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
      ph.fallDistance = p.fallDistance;
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
        if (!noCollision(this.world, bb, ph.ctx())) return this.rejectMove(p);
      }
    }
    // exhaustion from movement and jumping, then fall damage (Entity.checkFallDamage driven by
    // the client's onGround, like ServerGamePacketListenerImpl.handleMovePlayer)
    this.survival.movementExhaustion(p, dx, dy, dz, p.onGround, m.onGround);
    p.walkDist += Math.hypot(dx, dz) * 0.6;
    p.x = m.x;
    p.y = m.y;
    p.z = m.z;
    p.onGround = m.onGround;
    this.movementSounds(p, dx, dy, dz);
    if (m.onGround) {
      if (p.fallDistance > 0) this.blocks.fallOn(p, p.fallDistance);
      if (p.fallDistance > 0) this.survival.land(p, p.fallDistance);
      p.fallDistance = 0;
    } else if (dy < 0) p.fallDistance -= dy;
    // flying, Slow Falling and Levitation never build up a fall (LivingEntity.travel)
    if (p.flying || p.living.effects.has('slow_falling') || p.living.effects.has('levitation')) p.fallDistance = 0;
  }

  /** BlockState.use for interactive blocks; returns true when the click was consumed. */
  private useBlock(p: ServerPlayer, x: number, y: number, z: number): boolean {
    const st = this.world.getState(x, y, z);
    if (blockNameOf(st).endsWith('_bed')) return this.sleep.useBed(p, x, y, z);
    if (useAnchor(this, p, x, y, z)) return true;
    if (this.blocks.use(p, x, y, z)) return true;
    if (this.redstone.use(p, x, y, z)) return true;
    if (this.containers.useBlock(p, x, y, z)) return true;
    return false;
  }

  /** ServerGamePacketListenerImpl.handleInteract (attack) → Player.attack. */
  private handleAttack(p: ServerPlayer, targetId: number): void {
    const t = this.players.find((o) => o.id === targetId);
    const mob = t ? null : this.entities.get(targetId);
    if (mob instanceof Mob) {
      if (p.gameMode !== 3) this.mobs.playerAttack(p, mob);
      return;
    }
    // ServerPlayer.attack: a spectator's attack spectates the target instead
    if (p.gameMode === 3) {
      if (t && t !== p && t.gameMode !== 3 && !t.living.dead && (t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2 < 36) this.setCamera(p, t);
      return;
    }
    // items, orbs, arrows and yourself can't be attacked (vanilla disconnects; we ignore)
    if (!t || t === p || t.gameMode === 3 || t.living.dead) return;
    const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
    if (dx * dx + dy * dy + dz * dz >= 36) return;
    const item = p.inventory.selectedStack?.id ?? 0;
    const ph = p.phys;
    ph.x = p.x;
    ph.y = p.y;
    ph.z = p.z;
    ph.updateFluidState();
    const res = computeAttack({
      item, attackStrengthTicker: p.attackStrengthTicker, sprinting: p.sprinting, fallDistance: p.fallDistance, onGround: p.onGround,
      onClimbable: ph.onClimbable(), inWater: ph.isInWater, walked: p.walkDist - p.walkDistO, speed: 0.1,
      damageBonus: 3 * (p.living.effects.amplifier('strength') + 1) - 4 * (p.living.effects.amplifier('weakness') + 1),
      speedMul: (1 + 0.1 * (p.living.effects.amplifier('haste') + 1)) * (1 - 0.1 * (p.living.effects.amplifier('mining_fatigue') + 1)),
    });
    p.attackStrengthTicker = 0;
    if (!this.pvp) return;
    const r = this.rand;
    const sx = p.x, sy = p.y, sz = p.z;
    if (res.knockback > 0 && res.charged && p.sprinting) this.playSound(null, 'entity.player.attack.knockback', 'player', sx, sy, sz, 1, 1);
    const hit = this.survival.hurt(t, DAMAGE.playerAttack, res.damage, p);
    if (hit) {
      const yr = (p.yaw * Math.PI) / 180;
      if (res.knockback > 0) {
        this.knockback(t, res.knockback * 0.5, Math.sin(yr), -Math.cos(yr));
        p.sprinting = false;
        p.stateDirty = true;
      }
      if (res.critical) this.playSound(null, 'entity.player.attack.crit', 'player', sx, sy, sz, 1, 1);
      if (res.sweep) this.playSound(null, 'entity.player.attack.sweep', 'player', sx, sy, sz, 1, 1);
      else if (!res.critical) this.playSound(null, res.charged ? 'entity.player.attack.strong' : 'entity.player.attack.weak', 'player', sx, sy, sz, 1, 1);
      if (res.critical) this.broadcastToTrackers(t, { t: 'animate', id: t.id, action: 4 }, true);
      // ItemStack.hurtEnemy: swords lose 1 durability per hit, tools 2
      this.items.onAttackHit(p);
      p.living.food.addExhaustion(EXHAUSTION.attack);
    } else {
      this.playSound(null, 'entity.player.attack.nodamage', 'player', sx, sy, sz, 1, 1);
    }
    void r;
  }

  /** LivingEntity.knockback, sent to the victim's client as a velocity (SetEntityMotion). */
  knockback(t: ServerPlayer, strength: number, x: number, z: number): void {
    // KNOCKBACK_RESISTANCE (netherite armour)
    strength *= 1 - this.items.armorOf(t).knockbackResistance;
    if (strength <= 0) return;
    const len = Math.hypot(x, z) || 1;
    const kx = (x / len) * strength, kz = (z / len) * strength;
    // the server-side velocity of a player is its last knockback (movement is client-driven)
    t.vx = t.vx / 2 - kx;
    t.vy = t.onGround ? Math.min(0.4, t.vy / 2 + strength) : t.vy;
    t.vz = t.vz / 2 - kz;
    t.knockbackDirty = true;
  }

  /** Entity.move step/swim sounds of a player, heard by everyone else. */
  private movementSounds(p: ServerPlayer, dx: number, dy: number, dz: number): void {
    // Player.getMovementEmission: flying or sneaking on the ground is silent; spectators too
    const silent = p.flying || p.gameMode === 3 || (p.onGround && p.sneaking);
    const ph = p.phys;
    ph.x = p.x;
    ph.y = p.y;
    ph.z = p.z;
    ph.updateFluidState();
    const ev = p.steps.update(this.world, p.x, p.y, p.z, dx, dy, dz, ph.isInWater, silent);
    if (!ev) return;
    const r = this.rand;
    if (ev.kind === 'swim') {
      const v = Math.min(1, Math.sqrt(dx * dx * 0.2 + dy * dy + dz * dz * 0.2) * 0.35);
      this.playSound(p, 'entity.player.swim', 'player', p.x, p.y, p.z, v, 1 + (r.nextFloat() - r.nextFloat()) * 0.4);
    } else {
      const st = soundTypeOf(ev.state);
      this.playSound(p, st.step, 'player', p.x, p.y, p.z, st.volume * 0.15, st.pitch);
    }
  }

  private rejectMove(p: ServerPlayer): void {
    p.rejectedMoves++;
    this.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
  }

  private handle(p: ServerPlayer, m: C2S): void {
    if (p.living.dead) {
      // a dead player can only chat or respawn
      if (m.t === 'respawn') this.survival.respawn(p);
      else if (m.t === 'chat') this.commands.handleChat(p, m.message);
      else if (m.t === 'commandSuggest' || m.t === 'keepAlive') this.commands.handlePacket(p, m);
      return;
    }
    switch (m.t) {
      case 'move':
        // while spectating through someone, the server places the player (vanilla clients stop sending)
        if (!p.camera) this.handleMove(p, m);
        break;
      case 'spectate': {
        // TeleportToEntity: spectators only
        const t = this.allPlayers.find((o) => o.id === m.target);
        if (p.gameMode === 3 && t) {
          this.setCamera(p, null);
          p.x = t.x;
          p.y = t.y;
          p.z = t.z;
          p.yaw = t.yaw;
          p.pitch = t.pitch;
          this.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
        }
        break;
      }
      case 'playerState':
        p.sneaking = m.sneaking;
        p.sprinting = m.sprinting;
        p.flying = m.flying && p.mayFly;
        p.stateDirty = true;
        break;
      case 'heldSlot':
        if (m.slot >= 0 && m.slot < 9) p.inventory.selected = m.slot;
        break;
      case 'attack':
        this.handleAttack(p, m.target);
        break;
      case 'interactEntity':
        this.mobs.interact(p, m.id, m.hand);
        break;
      case 'stopSleeping':
        this.sleep.wake(p, false);
        break;
      case 'swapOffhand': {
        if (p.gameMode === 3) break;
        const inv = p.inventory;
        const main = inv.get(inv.selected);
        inv.set(inv.selected, inv.get(40));
        inv.set(40, main);
        this.syncSlot(p, inv.selected);
        this.syncSlot(p, 40);
        break;
      }
      case 'clickWindow':
        this.containers.handleClick(p, m);
        break;
      case 'closeWindow':
        this.containers.handleClose(p, m.windowId);
        break;
      case 'menuButton':
        this.containers.handleButton(p, m.windowId, m.button);
        break;
      case 'creativeSlot':
        // slot −1: the creative inventory throws the stack out of the window
        if (p.gameMode === 1 && m.slot === -1 && m.item > 0 && m.count > 0) this.tossItem(p, { id: m.item, count: Math.min(m.count, maxStackSize(m.item)), damage: Math.max(0, m.damage) });
        if (p.gameMode === 1 && m.slot >= 0 && m.slot < 41) {
          p.inventory.set(m.slot, m.item > 0 && m.count > 0 ? { id: m.item, count: Math.min(m.count, maxStackSize(m.item)), damage: Math.max(0, m.damage) } : null);
        }
        break;
      case 'pickBlock':
        this.pickBlock(p, m.x, m.y, m.z);
        break;
      case 'dig':
        this.handleDig(p, m.action, m.x, m.y, m.z);
        break;
      case 'useOn':
        this.handleUseOn(p, m);
        break;
      case 'dropItem':
        this.dropFromHand(p, m.all);
        break;
      case 'useItem':
        this.items.useItem(p, m.hand === 1 ? 1 : 0);
        break;
      case 'releaseUseItem':
        this.items.release(p);
        break;
      case 'swing':
        for (const o of this.players) if (o.tracking.has(p.id)) this.send(o, { t: 'animate', id: p.id, action: m.hand === 1 ? 3 : 0 });
        break;
      case 'settings':
        p.viewDistance = clampViewDistance(m.viewDistance);
        p.simulationDistance = Math.max(5, Math.min(32, m.simulationDistance));
        break;
      case 'setBlock':
        this.setBlock(m.x, m.y, m.z, m.state);
        break;
      case 'chat':
        this.commands.handleChat(p, m.message);
        break;
      case 'commandSuggest':
      case 'keepAlive':
        this.commands.handlePacket(p, m);
        break;
    }
  }

  send(p: ServerPlayer, packet: S2C): void {
    p.conn.send(encodeS2C(packet));
  }

  // ---------------------------------------------------------------- world access
  /**
   * Chunks not in the world but held in memory, serialized (serializeChunk): unloaded this session
   * and not yet written to storage (`unsaved`), or read back from storage ahead of use.
   */
  private get stored() {
    return this.level.stored;
  }
  /** Chunks present in the save (storage). */
  private get savedKeys() {
    return this.level.savedKeys;
  }
  /** Chunks being read from storage. */
  private get loading() {
    return this.level.loading;
  }
  /** Chunk state signature (version, stage, lit) when last saved or loaded. */
  private get savedSig() {
    return this.level.savedSig;
  }
  /** Chunks whose light changed (or otherwise need saving) since last saved. */
  private get saveDirty() {
    return this.level.saveDirty;
  }
  /**
   * Saved chunks that had to be generated anyway because something needed them synchronously
   * before they were read back; never written, so the save keeps the real chunk.
   */
  private get shadowed() {
    return this.level.shadowed;
  }
  /** Saved player data by key (HOST_PLAYER_KEY or name), loaded with the world. */
  private readonly playerData = new Map<string, PlayerData>();
  private saving: Promise<void> | null = null;
  /** World creation time (ms), kept in the level data. */
  private createdAt = Date.now();

  /**
   * Bring a chunk up to a generation stage, like vanilla's ChunkStatus pyramid: features (stage 2)
   * need the 8 neighbours carved, because they write into them; a full chunk (stage 3) needs its
   * neighbours decorated, so nothing writes into it any more.
   */
  /** The dimension's generator has a features stage (the overworld and Nether generators; not dev/test terrain). */
  private decorates(): boolean {
    return !(this.generator instanceof DevGenerator) && typeof (this.generator as { decorate?: unknown }).decorate === 'function';
  }

  ensureStage(cx: number, cz: number, stage: number): Chunk {
    let c = this.world.getChunk(cx, cz);
    if (!c) {
      const key = chunkKey(cx, cz);
      const saved = this.stored.get(key);
      if (saved) {
        c = deserializeChunk(saved.raw);
        this.stored.delete(key);
        // mobs saved with the chunk come back with it
        const ents = chunkEntities.get(c);
        if (ents?.length) this.mobs.load(ents as MobSave[]);
      } else {
        c = this.generator.generate(cx, cz);
        if (this.decorates()) c.stage = 1;
        if (this.savedKeys.has(key)) {
          console.warn(`[server] chunk ${cx},${cz} needed before it was loaded; using a temporary copy`);
          this.shadowed.add(key);
        }
      }
      this.world.addChunk(c);
      if (saved && !saved.unsaved) this.savedSig.set(key, chunkSig(c));
      else this.savedSig.delete(key);
    }
    if (stage >= 2 && c.stage < 2) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) this.ensureStage(cx + dx, cz + dz, 1);
      if (this.decorates()) {
        // springs schedule their fluid tick (delay 0); it runs once the chunk is full and ticking
        const decorator = this.generator as unknown as { decorate(world: BlockWorld, cx: number, cz: number): [number, number, number][] };
        for (const [x, y, z] of decorator.decorate(this.world, cx, cz)) this.fluids.scheduleFluidAt(x, y, z, 0);
        // chests placed by features (dungeons) get their loot table, spawners their mob
        const gen = takeGenBlockEntities(this.world);
        this.containers.attachGenerated(gen);
        this.mobs.spawners.attachGenerated(gen);
        // mobs placed by structures (villagers, witch, elder guardians…), once their mob type exists
        for (const g of takeGenEntities(this.world)) {
          const hook = commandHooks.summon.get(g.type);
          if (!hook) continue;
          try {
            const e = hook(this, g.x, g.y, g.z, '{PersistenceRequired:1b}');
            if (e && !this.entities.has(e.id)) this.spawnEntity(e);
          } catch (err) {
            console.error(`[server] structure mob ${g.type} failed:`, err);
          }
        }
      }
      c.stage = 2;
    }
    if (stage >= 3 && c.stage < 3) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) this.ensureStage(cx + dx, cz + dz, 2);
      c.stage = 3;
    }
    return c;
  }

  ensureChunk(cx: number, cz: number): Chunk {
    return this.ensureStage(cx, cz, 1);
  }

  /**
   * One unit of generation work toward prepareChunk(cx, cz): generates one missing chunk
   * (radius 2) or decorates one neighbour (radius 1). Returns true once nothing is left to
   * generate, so the expensive pipeline can be spread over ticks under a time budget.
   */
  private stepTowards(cx: number, cz: number): boolean {
    // nearest first, so the chunks the player needs soonest exist first
    for (const [dx, dz] of SPIRAL2) {
      if (this.world.getChunk(cx + dx, cz + dz)) continue;
      this.ensureStage(cx + dx, cz + dz, 1);
      this.genStats.generated++;
      return false;
    }
    for (const [dx, dz] of SPIRAL1) {
      if (this.world.getChunk(cx + dx, cz + dz)!.stage >= 2) continue;
      this.ensureStage(cx + dx, cz + dz, 2);
      this.genStats.decorated++;
      return false;
    }
    return true;
  }

  /** A chunk is ready to send once it is full (neighbours decorated) and lit. */
  private prepareChunk(cx: number, cz: number): Chunk {
    const c = this.ensureStage(cx, cz, 3);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.ensureStage(cx + dx, cz + dz, 1);
    if (!c.lit) {
      this.light.lightChunk(c);
      // NaturalSpawner.spawnMobsForChunkGeneration for freshly generated chunks
      if (c.stage === 3 && this.gameRules.doMobSpawning && this.mobs.naturalSpawning) this.mobs.spawnForChunkGeneration(c);
    }
    this.mobs.spawners.scanChunk(c);
    return c;
  }

  /**
   * Whether prepareChunk(cx, cz) can run without generating a chunk that exists in the save:
   * everything it touches (radius 2) is loaded, held in memory, or not saved. Starts reading
   * missing saved chunks.
   */
  private chunksReady(cx: number, cz: number): boolean {
    if (this.savedKeys.size === 0) return true;
    let ready = true;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        const x = cx + dx, z = cz + dz;
        if (this.world.getChunk(x, z)) continue;
        const key = chunkKey(x, z);
        if (!this.savedKeys.has(key) || this.stored.has(key)) continue;
        ready = false;
        this.requestLoad(x, z);
      }
    return ready;
  }

  private requestLoad(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const lv = this.level;
    const storage = lv.storage;
    if (!storage || lv.loading.has(key)) return;
    lv.loading.add(key);
    storage
      .getChunk(cx, cz)
      .then(async (rec) => {
        if (!rec) {
          lv.savedKeys.delete(key);
          return;
        }
        const raw = await unpackRecord(rec);
        if (!lv.world.getChunk(cx, cz) && !lv.stored.has(key)) lv.stored.set(key, { raw, unsaved: false });
      })
      .catch((e) => {
        console.error(`[server] failed to read chunk ${cx},${cz}; it will be regenerated`, e);
        lv.savedKeys.delete(key);
      })
      .finally(() => lv.loading.delete(key));
  }

  /** Read every saved chunk needed to prepare the chunks within `r` of a chunk (before players join). */
  async preloadChunks(cx: number, cz: number, r: number, lv: ServerLevel = this.level): Promise<void> {
    for (let i = 0; i < 2000; i++) {
      let ready = true;
      this.inLevel(lv, () => {
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (!this.chunksReady(cx + dx, cz + dz)) ready = false;
      });
      if (ready) return;
      await new Promise((res) => setTimeout(res, 5));
    }
  }

  /** Mark a loaded chunk as needing a save (e.g. a block entity's contents changed). */
  markChunkDirty(cx: number, cz: number): void {
    this.saveDirty.add(chunkKey(cx, cz));
  }

  private needsSave(c: Chunk, key: number, blockEntities = true): boolean {
    if (this.shadowed.has(key)) return false;
    if (this.saveDirty.has(key) || this.savedSig.get(key) !== chunkSig(c)) return true;
    if (!blockEntities) return false;
    // mobs move without changing blocks: chunks that hold (or held) mobs are rewritten
    if (this.mobs.chunkNeedsSave(c.x, c.z)) return true;
    // block entities (containers) can change without a block change
    const be = (c as unknown as { blockEntities?: { size?: number; length?: number } }).blockEntities;
    return !!be && (be.size ?? be.length ?? 0) > 0;
  }

  private markSaved(c: Chunk, key: number): void {
    this.savedSig.set(key, chunkSig(c));
    this.saveDirty.delete(key);
    this.savedKeys.add(key);
  }

  /** Serialize a loaded chunk with the mobs inside it (they stay in the world). */
  private chunkRecord(c: Chunk): Uint8Array {
    const mobs = this.mobs.save(c.x, c.z);
    this.mobs.noteSaved(c.x, c.z, mobs.length);
    return serializeChunk(c, mobs);
  }

  /** Keep an unloaded chunk (blocks, light, stage, mobs) so coming back finds it as it was. */
  private storeChunk(c: Chunk): void {
    const key = chunkKey(c.x, c.z);
    // its mobs leave with it, saved inside the chunk record
    const dirtyMobs = this.mobs.chunkNeedsSave(c.x, c.z);
    const mobs = this.mobs.unloadChunk(c.x, c.z);
    this.mobs.spawners.dropChunk(c.x, c.z);
    this.mobs.noteSaved(c.x, c.z, mobs.length);
    if (this.shadowed.delete(key)) {
      // the save has the real chunk; forget the temporary copy
      this.savedSig.delete(key);
      this.saveDirty.delete(key);
      return;
    }
    const dirty = dirtyMobs || this.needsSave(c, key);
    this.savedSig.delete(key);
    this.saveDirty.delete(key);
    if (this.opts.storage && !dirty && this.savedKeys.has(key)) return; // unchanged since saved
    this.stored.set(key, { raw: serializeChunk(c, mobs), unsaved: true });
  }

  /** Write chunks unloaded since the last flush to storage. */
  private async flushStored(): Promise<void> {
    const lv = this.level;
    if (!lv.storage) return;
    const entries = [...lv.stored].filter(([, e]) => e.unsaved);
    if (!entries.length) return;
    for (const [, e] of entries) {
      e.unsaved = false;
      e.writing = true;
    }
    try {
      await this.writeChunks(entries.map(([key, e]) => ({ key, raw: e.raw })));
    } catch (err) {
      for (const [, e] of entries) e.unsaved = true;
      throw err;
    } finally {
      for (const [key, e] of entries) {
        e.writing = false;
        // written: drop it from memory unless it was reloaded or replaced meanwhile
        if (!e.unsaved && lv.stored.get(key) === e) lv.stored.delete(key);
      }
    }
  }

  /** Compress and write serialized chunks, after every write queued before. */
  private writeChunks(raws: { key: number; raw: Uint8Array }[]): Promise<void> {
    const lv = this.level;
    const storage = lv.storage!;
    const packed = Promise.all(raws.map(async ({ key, raw }) => ({ cx: chunkKeyX(key), cz: chunkKeyZ(key), data: await packRecord(raw) })));
    const w = lv.writeChain.then(async () => {
      const records = await packed;
      for (let i = 0; i < records.length; i += 256) await storage.putChunks(records.slice(i, i + 256));
      for (const { key } of raws) lv.savedKeys.add(key);
    });
    lv.writeChain = w.catch(() => {});
    return w;
  }

  /**
   * Save changed chunks in the background (about 2 ms of each tick), so autosaves and
   * "Save and Quit" have little left to write. Finished chunks first; the not-yet-full ring
   * at the edge only when nothing else is waiting.
   */
  private trickleSave(): void {
    const lv = this.level;
    if (!lv.storage || lv.trickling || this.saving) return;
    const raws: { key: number; raw: Uint8Array }[] = [];
    const deadline = performance.now() + 2;
    for (const pass of [0, 1]) {
      for (const [key, c] of this.world.chunks) {
        if ((pass === 0 && (c.stage < 3 || !c.lit)) || !this.needsSave(c, key, false)) continue;
        raws.push({ key, raw: this.chunkRecord(c) });
        this.markSaved(c, key);
        if (raws.length >= 16 || performance.now() > deadline) break;
      }
      if (raws.length) break;
    }
    if (!raws.length) return;
    lv.trickling = true;
    this.writeChunks(raws)
      .catch((e) => {
        for (const { key } of raws) lv.saveDirty.add(key);
        console.error('[server] background chunk save failed', e);
      })
      .finally(() => (lv.trickling = false));
  }

  // ---------------------------------------------------------------- persistence
  /** Level data snapshot. */
  captureMeta(): LevelMeta {
    return {
      version: SAVE_FORMAT_VERSION,
      name: this.opts.worldName ?? 'World',
      seed: this.opts.seed.toString(),
      defaultGameMode: this.opts.defaultGameMode ?? 0,
      gameTime: this.gameTime,
      dayTime: this.dayTime,
      doDaylightCycle: this.doDaylightCycle,
      doWeatherCycle: this.doWeatherCycle,
      raining: this.raining,
      thundering: this.thundering,
      rainTime: this.rainTime,
      thunderTime: this.thunderTime,
      clearWeatherTime: this.clearWeatherTime,
      rainLevel: this.rainLevel,
      thunderLevel: this.thunderLevel,
      worldSpawn: this.worldSpawnSet ? [...this.worldSpawn] : null,
      gameRules: { ...this.gameRules },
      difficulty: this.difficulty,
      playersSleepingPercentage: this.playersSleepingPercentage,
      spawnRadius: this.spawnRadius,
      pvp: this.pvp,
      lastPlayed: Date.now(),
      createdAt: this.createdAt,
      portalPois: this.portals.saveIndex(),
    };
  }

  applyMeta(m: LevelMeta): void {
    const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    if (typeof m.name === 'string' && !this.opts.worldName) this.opts.worldName = m.name;
    if (typeof m.defaultGameMode === 'number') this.opts.defaultGameMode = m.defaultGameMode;
    this.gameTime = num(m.gameTime, 0);
    this.dayTime = num(m.dayTime, 1000);
    this.doDaylightCycle = m.doDaylightCycle ?? true;
    this.doWeatherCycle = m.doWeatherCycle ?? true;
    this.raining = !!m.raining;
    this.thundering = !!m.thundering;
    this.rainTime = num(m.rainTime, 0);
    this.thunderTime = num(m.thunderTime, 0);
    this.clearWeatherTime = num(m.clearWeatherTime, 0);
    this.rainLevel = num(m.rainLevel, 0);
    this.thunderLevel = num(m.thunderLevel, 0);
    if (Array.isArray(m.worldSpawn) && m.worldSpawn.length === 3) {
      this.worldSpawn = [m.worldSpawn[0], m.worldSpawn[1], m.worldSpawn[2]];
      this.worldSpawnSet = true;
    }
    if (m.gameRules) Object.assign(this.gameRules, m.gameRules);
    this.difficulty = num(m.difficulty, this.difficulty) as Difficulty;
    this.playersSleepingPercentage = num(m.playersSleepingPercentage, 100);
    this.spawnRadius = num(m.spawnRadius, 10);
    if (typeof m.pvp === 'boolean') this.pvp = m.pvp;
    this.createdAt = num(m.createdAt, this.createdAt);
    this.portals.loadIndex(m.portalPois);
  }

  /**
   * Open the world from storage: level data, the saved chunk index, player data, and the chunks
   * around spawn. A world without level data is new; its level data is written right away.
   */
  async load(): Promise<void> {
    const storage = this.opts.storage;
    if (!storage) return;
    const meta = await storage.getMeta();
    if (meta) this.applyMeta(meta);
    for (const lv of this.levels.values()) if (lv.storage) for (const [cx, cz] of await lv.storage.listChunks()) lv.savedKeys.add(chunkKey(cx, cz));
    for (const id of await storage.listPlayers()) {
      const d = await storage.getPlayer(id);
      if (d) this.playerData.set(id, d);
    }
    if (this.worldSpawnSet) await this.preloadChunks(Math.floor(this.worldSpawn[0]) >> 4, Math.floor(this.worldSpawn[2]) >> 4, 1);
    const host = this.playerData.get(HOST_PLAYER_KEY);
    if (host) {
      const hl = this.levels.get(host.dimension ?? 'overworld') ?? this.level;
      await this.preloadChunks(Math.floor(host.x) >> 4, Math.floor(host.z) >> 4, 1, hl);
    }
    if (!meta) await storage.putMeta(this.captureMeta());
  }

  playerKey(p: ServerPlayer): string {
    return p.isOwner ? HOST_PLAYER_KEY : p.name;
  }

  /** Save everything (changed chunks, players, level data). Concurrent calls queue behind the running save. */
  save(): Promise<void> {
    if (!this.opts.storage) return Promise.resolve();
    if (this.saving) return this.saving.catch(() => {}).then(() => this.save());
    const s = this.doSave().finally(() => {
      if (this.saving === s) this.saving = null;
    });
    this.saving = s;
    return s;
  }

  private async doSave(): Promise<void> {
    const storage = this.opts.storage!;
    const t0 = performance.now();
    // snapshot synchronously so the saved state is consistent
    // every dimension's changed chunks (each into its own storage namespace)
    const perLevel: { lv: ServerLevel; raws: { key: number; raw: Uint8Array }[] }[] = [];
    let chunkCount = 0;
    for (const lv of this.levels.values()) {
      if (!lv.storage) continue;
      const raws: { key: number; raw: Uint8Array }[] = [];
      this.inLevel(lv, () => {
        for (const [key, c] of this.world.chunks) {
          if (!this.needsSave(c, key)) continue;
          raws.push({ key, raw: this.chunkRecord(c) });
          this.markSaved(c, key);
        }
      });
      chunkCount += raws.length;
      perLevel.push({ lv, raws });
    }
    for (const p of this.allPlayers) this.playerData.set(this.playerKey(p), capturePlayer(p));
    const players = [...this.playerData];
    const meta = this.captureMeta();
    try {
      await Promise.all(perLevel.flatMap(({ lv, raws }) => this.inLevel(lv, () => [this.writeChunks(raws), this.flushStored()])));
      for (const [id, d] of players) await storage.putPlayer(id, d);
      await storage.putMeta(meta);
    } catch (e) {
      // retry these chunks next time
      for (const { lv, raws } of perLevel) for (const { key } of raws) lv.saveDirty.add(key);
      console.error('[server] saving the world failed', e);
      throw e;
    }
    console.info(`[server] saved ${chunkCount} chunks, ${players.length} players in ${Math.round(performance.now() - t0)} ms`);
  }

  /** Stop ticking and save; resolves once everything is written. */
  async shutdown(): Promise<void> {
    this.stop();
    this.items.dispose();
    await this.save();
    await this.opts.storage?.close();
  }

  /** Level.setBlock; `flags` as vanilla (1 neighbour updates, 2 clients, 16 no shape updates) for redstone. */
  setBlock(x: number, y: number, z: number, state: number, flags = 3): void {
    if (y < 0 || y > 255) return;
    const old = this.world.setStateRaw(x, y, z, state);
    if (old === state) return;
    this.containers.onBlockChanged(x, y, z, old, state);
    this.light.onBlockChanged(x, y, z, old, state);
    const key = chunkKey(x >> 4, z >> 4);
    for (const p of this.players) if (p.sent.has(key)) this.send(p, { t: 'blockChange', x, y, z, state });
    // redstone: onRemove/onPlace, neighbour updates (flag 1) and shape updates (no flag 16)
    this.redstone.onBlockChanged(x, y, z, old, state, flags);
    if (this.world.getState(x, y, z) !== state) return;
    this.blocks.afterSetBlock(x, y, z, old, state);
    this.portals.onBlockChanged(x, y, z, old, state);
    // after the packet: fluid updates may replace this block again (lava hardening) and must arrive later
    this.fluids.blockChanged(x, y, z, old, state);
  }

  // ---------------------------------------------------------------- ticking
  /** performance.now() when the current tick started (chunk generation fits in what is left). */
  private tickStart = 0;

  tick(): void {
    const t0 = performance.now();
    this.tickStart = t0;
    const overworld = this.levels.get('overworld')!;
    this.level = overworld;
    this.gameTime++;
    if (this.doDaylightCycle) this.dayTime++;
    // MinecraftServer.tickServer: autosave every 6000 ticks
    if (this.opts.storage && this.gameTime % AUTOSAVE_INTERVAL === 0) this.save().catch(() => {});
    else if (this.opts.storage) for (const lv of this.levels.values()) this.inLevel(lv, () => this.trickleSave());
    if (this.gameTime % 20 === 0) {
      for (const p of this.allPlayers) this.send(p, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
    }
    this.advanceWeather();
    this.tickLightning();
    this.sleep.tick();
    this.commands.tick();
    // MinecraftServer.tickChildren: every dimension (ServerLevel.tick), its players and entities
    const ticked = new Set<ServerPlayer>();
    for (const lv of this.levels.values()) {
      this.level = lv;
      this.fluids.tick();
      for (const p of [...this.players]) {
        if (ticked.has(p)) continue;
        ticked.add(p);
        this.tickPlayer(p);
        // nether portals (Entity.handleNetherPortal); may move the player to another dimension
        this.portals.tickPlayer(p);
      }
      // mobs exist in the overworld only so far (no nether mobs yet)
      if (lv === overworld) this.mobs.tick();
      this.blocks.tick();
      this.redstone.tickLevel();
      this.tickEntities();
      this.portals.tickEntities();
      this.containers.tick();
      this.updateChunks();
      this.updateTracking();
      this.trackEntities();
      if (lv === overworld) this.mobs.sync();
      this.flushLight();
    }
    this.level = overworld;
    this.mspt = this.mspt * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** Per-player part of the tick (ServerPlayer.tick), in the player's dimension. */
  private tickPlayer(p: ServerPlayer): void {
    {
      // ServerPlayer.tick: a spectator rides along with its camera entity until it sneaks
      const cam = p.camera;
      if (cam) {
        if (!this.allPlayers.includes(cam) || cam.living.dead) this.setCamera(p, null);
        else {
          p.x = cam.x;
          p.y = cam.y;
          p.z = cam.z;
          p.yaw = cam.yaw;
          p.pitch = cam.pitch;
          if (p.sneaking) this.setCamera(p, null);
        }
      }
      p.updatePose();
      this.survival.tick(p);
      this.items.tick(p);
      this.items.touchArrows(p);
      // Player.tick: attack strength recharges; switching to a different item restarts it
      p.attackStrengthTicker++;
      const main = p.inventory.selectedStack?.id ?? 0;
      if (main !== p.lastMainHandItem) {
        p.attackStrengthTicker = 0;
        p.lastMainHandItem = main;
      }
      p.walkDistO = p.walkDist;
      // knockback velocity goes to the victim's client, then decays server-side
      if (p.knockbackDirty) {
        this.send(p, { t: 'entityMotion', id: p.id, vx: p.vx, vy: p.vy, vz: p.vz });
        p.knockbackDirty = false;
      }
      p.vx = p.vy = p.vz = 0;
    }
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
      // ServerLevel.setWeatherParameters(0, duration, true, thunder): both timers get the duration
      this.clearWeatherTime = 0;
      this.rainTime = duration;
      this.thunderTime = duration;
      this.raining = true;
      this.thundering = kind === 'thunder';
    }
  }

  private updateChunks(): void {
    let budget = this.chunkGenBudget;
    const g0 = performance.now();
    // a player still waiting for the terrain around them ("Loading terrain…") gets most of the tick
    let limit = this.players.some((p) => p.sent.size < 25) ? Math.max(this.chunkGenTimeMs, 40) : this.chunkGenTimeMs;
    // never past ~45 ms into the tick, so the rest of the tick still fits in 50 ms (20 TPS)
    if (limit !== Infinity) limit = Math.max(2, Math.min(limit, 45 - (g0 - this.tickStart)));
    const outOfTime = () => performance.now() - g0 >= limit;
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
      // send nearest missing chunks first; generation work is spread over ticks (time budget)
      for (const [dx, dz] of spiral(r)) {
        if (budget <= 0 || outOfTime()) break;
        const cx = pcx + dx, cz = pcz + dz;
        const key = chunkKey(cx, cz);
        if (p.sent.has(key)) continue;
        // saved chunks are read asynchronously; send this one once they are in memory
        if (!this.chunksReady(cx, cz)) continue;
        let ready = this.stepTowards(cx, cz);
        while (!ready && !outOfTime()) ready = this.stepTowards(cx, cz);
        if (!ready) break;
        const c = this.prepareChunk(cx, cz);
        p.sent.add(key);
        this.send(p, { t: 'chunk', chunk: c });
        // the chunk packet already carries current light for this column
        for (let sy = 0; sy < 16; sy++) this.lightDirty.delete(key * 16 + sy);
        budget--;
      }
    }
    this.genStats.genMs = this.genStats.genMs * 0.9 + (performance.now() - g0) * 0.1;
    this.genStats.sent += this.chunkGenBudget - budget;
    // drop chunks nobody can see (keep a margin of 2 for lighting neighbors)
    if (this.gameTime % 40 === 0) {
      for (const c of [...this.world.chunks.values()]) {
        const needed = this.players.some((p) => {
          const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
          return Math.abs(c.x - pcx) <= p.viewDistance + 3 && Math.abs(c.z - pcz) <= p.viewDistance + 3;
        });
        if (!needed) {
          this.storeChunk(c);
          this.world.removeChunk(c.x, c.z);
        }
      }
      if (this.opts.storage) {
        // chunks read ahead but no longer needed: storage still has them
        for (const [key, e] of this.stored) {
          if (e.unsaved || e.writing) continue;
          const cx = chunkKeyX(key), cz = chunkKeyZ(key);
          const needed = this.players.some((p) => Math.abs(cx - (Math.floor(p.x) >> 4)) <= p.viewDistance + 3 && Math.abs(cz - (Math.floor(p.z) >> 4)) <= p.viewDistance + 3);
          if (!needed) this.stored.delete(key);
        }
        // write unloaded chunks out in the background (not while a full save is running)
        if (!this.saving && [...this.stored.values()].some((e) => e.unsaved)) {
          this.flushStored().catch((e) => console.error('[server] writing unloaded chunks failed', e));
        }
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
        const visible = Math.abs(ocx - pcx) <= p.viewDistance && Math.abs(ocz - pcz) <= p.viewDistance && o.broadcastTo(p);
        if (visible && !p.tracking.has(o.id)) {
          p.tracking.add(o.id);
          this.send(p, { t: 'addPlayer', id: o.id, name: o.name, skin: o.skin, x: o.x, y: o.y, z: o.z, yaw: o.yaw, pitch: o.pitch, headYaw: o.headYaw });
          this.send(p, { t: 'entityState', id: o.id, flags: o.flags(), pose: o.pose, frozen: o.living.ticksFrozen });
          this.send(p, { t: 'equipment', id: o.id, mainHand: o.inventory.selectedStack?.id ?? 0, offHand: o.inventory.get(40)?.id ?? 0 });
          this.items.sendStateTo(p, o);
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
        if (o.stateDirty) this.send(p, { t: 'entityState', id: o.id, flags: o.flags(), pose: o.pose, frozen: o.living.ticksFrozen });
      }
      // held items (LivingEntity.detectEquipmentUpdates)
      const main = o.inventory.selectedStack?.id ?? 0, off = o.inventory.get(40)?.id ?? 0;
      if (main !== o.sentMainHand || off !== o.sentOffHand) {
        o.sentMainHand = main;
        o.sentOffHand = off;
        for (const p of this.players) if (p.tracking.has(o.id)) this.send(p, { t: 'equipment', id: o.id, mainHand: main, offHand: off });
      }
      // entity data also goes to the player itself (on-fire overlay)
      if (o.stateDirty) this.send(o, { t: 'entityState', id: o.id, flags: o.flags(), pose: o.pose, frozen: o.living.ticksFrozen });
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

function itemNameOf(id: number): string {
  return itemName(id);
}

/** Clicking the inner face of a slab of the same type merges it (vanilla SlabBlock.canBeReplaced). */
function slabMergeFace(slab: number, face: number, hitY: number): boolean {
  const type = getProp(slab, 'type');
  if (type === 'bottom') return face === 1 || (face > 1 && hitY > 0.5);
  return face === 0 || (face > 1 && hitY <= 0.5);
}

/** XP from mining ores (vanilla UniformInt ranges); copper/iron/gold drop raw ore instead. */
function oreExperience(name: string, r: JavaRandom): number {
  const n = name.replace(/^deepslate_/, '');
  const range = (a: number, b: number) => a + r.nextInt(b - a + 1);
  if (n === 'coal_ore') return range(0, 2);
  if (n === 'diamond_ore' || n === 'emerald_ore') return range(3, 7);
  if (n === 'lapis_ore' || n === 'nether_quartz_ore') return range(2, 5);
  if (n === 'redstone_ore') return 1 + r.nextInt(5);
  if (n === 'nether_gold_ore') return range(0, 1);
  if (n === 'spawner') return 15 + r.nextInt(15) + r.nextInt(15);
  return 0;
}

/** Changes to a chunk that need saving: block version, generation stage, lit flag. */
function chunkSig(c: Chunk): number {
  return c.version * 8 + c.stage * 2 + (c.lit ? 1 : 0);
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
const SPIRAL2 = spiral(2);
const SPIRAL1 = spiral(1);

export { DAY_LENGTH };
