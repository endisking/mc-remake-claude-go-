/**
 * The authoritative game server. Environment-agnostic: runs inside a Web Worker for
 * single-player and inside Node for the dedicated server.
 */
import { BlockWorld } from '@shared/world/world';
import { LightEngine } from '@shared/world/light';
import { Chunk, chunkKey } from '@shared/world/chunk';
import { writeChunk, readChunk } from '@shared/protocol/chunkcodec';
import { ByteWriter, ByteReader } from '@shared/protocol/buffer';
import { DevGenerator } from '@shared/worldgen/devgen';
import { OverworldGenerator } from '@shared/worldgen/overworld/generator';
import { obfuscateSeed } from '@shared/worldgen/biome/zoom';
import { encodeS2C, decodeC2S, type C2S, type S2C, PROTOCOL_VERSION } from '@shared/protocol/packets';
import { TICKS_PER_SECOND, DAY_LENGTH } from '@shared/constants';
import { JavaRandom } from '@shared/util/random';
import { ServerPlayer } from './player';
import { AABB, noCollision } from '@shared/entity/aabb';
import { ItemEntity, LightningBolt, ExperienceOrb, experienceOrbValue, type ServerEntity } from './entity';
import { Sleep } from './sleep';
import { isRainingAt } from '@shared/world/weather';
import { stateForPlacement, updateShape, isReplaceable, companionPlacement, DIRS, DX, DY, DZ } from '@shared/game/placement';
import { canSurvive } from '@shared/game/support';
import { destroyProgress, hardness, canHarvest } from '@shared/game/mining';
import { blockDrops, blockForItem, itemForBlock } from '@shared/game/loot';
import { isEmpty, maxStackSize, itemName, type ItemStack } from '@shared/item/stack';
import { collisionBoxes } from '@shared/world/shapes';
import { getProp, blockNameOf } from '@shared/world/blockstate';
import { FLUID } from '@shared/world/blockinfo';
import { BLOCKS_BY_NAME, ITEMS_BY_NAME } from '@shared/data';
import { Survival, DEFAULT_GAME_RULES, DAMAGE, type GameRules } from './survival';
import { Difficulty, EXHAUSTION } from '@shared/game/food';
import { soundId, sourceId, type SoundSource } from '@shared/sound/events';
import { soundTypeOf } from '@shared/world/soundtype';
import { computeAttack } from '@shared/game/combat';
import { StepTracker } from '@shared/entity/steps';
import { ItemUse } from './itemuse';
import { Arrow } from './arrow';
import { EFFECT_ID } from '@shared/game/effects';

export interface Connection {
  send(data: ArrayBuffer): void;
  close(reason: string): void;
}

export interface ServerOptions {
  seed: bigint;
  /** Development scene (e.g. 'models' showcase). */
  scene?: string;
  /** Use the flat development terrain instead of the 1.17 generator (fast tests). */
  devTerrain?: boolean;
  /** Max chunks generated per tick across all players. */
  chunkGenBudget?: number;
  /** Game mode for new players: 0 survival, 1 creative, 2 adventure, 3 spectator. */
  defaultGameMode?: number;
  /** Seed for the level's random source (tests); defaults to the clock like vanilla. */
  randomSeed?: bigint;
}

export class GameServer {
  readonly world = new BlockWorld();
  readonly light: LightEngine;
  readonly generator: DevGenerator | OverworldGenerator;
  readonly players: ServerPlayer[] = [];
  readonly entities = new Map<number, ServerEntity>();
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
  readonly gameRules: GameRules = { ...DEFAULT_GAME_RULES };
  difficulty: Difficulty = Difficulty.Normal;
  readonly survival = new Survival(this);
  /** item use, durability, armour, effects sync (itemuse.ts) */
  readonly items = new ItemUse(this);
  /** server.properties pvp */
  pvp = true;
  readonly sleep = new Sleep(this);
  /** gamerules playersSleepingPercentage and spawnRadius */
  playersSleepingPercentage = 100;
  spawnRadius = 10;
  /** world spawn (set on the first join at the origin) */
  worldSpawn: [number, number, number] = [8, 64, 8];
  private worldSpawnSet = false;
  /** Server simulation distance (chunks); the single-player host's setting overrides it. */
  simulationDistance = 10;
  private nextEntityId = 1;
  private readonly chunkGenBudget: number;
  /** Sections whose light changed this tick: key -> [cx, sy, cz] */
  private lightDirty = new Map<number, [number, number, number]>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Measured milliseconds per tick (for F3 / profiling). */
  mspt = 0;

  constructor(readonly opts: ServerOptions) {
    this.rand = new JavaRandom(opts.randomSeed ?? BigInt(Date.now()));
    // development scenes (model showcase, tests) keep the flat dev terrain; worlds use the 1.17 generator
    this.generator = opts.scene || opts.devTerrain ? new DevGenerator(opts.seed, opts.scene) : new OverworldGenerator(opts.seed);
    this.world.biomeZoomSeed = obfuscateSeed(opts.seed);
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
    this.items.forget(gone!);
    for (const o of this.players) {
      if (o.tracking.delete(gone!.id)) this.send(o, { t: 'removeEntities', ids: [gone!.id] });
      this.send(o, { t: 'playerInfo', action: 4, id: gone!.id, name: gone!.name, skin: '', gameMode: 0 });
      if (o.camera === gone) this.setCamera(o, null);
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
    [p.x, p.y, p.z] = this.spawnPosition();
    p.prevTickX = p.x;
    p.prevTickZ = p.z;
    p.living.effects.onChange = (e, removed) => this.items.sendEffect(p, e, removed);
    this.players.push(p);
    this.send(p, {
      t: 'login', entityId: p.id, gameMode: p.gameMode, dimension: 'overworld', seed: this.world.biomeZoomSeed!,
      x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, simulationDistance: 10,
    });
    this.sendAbilities(p);
    this.survival.sync(p);
    this.send(p, { t: 'difficulty', difficulty: this.difficulty });
    this.send(p, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
    this.send(p, { t: 'weather', rain: this.rainLevel, thunder: this.thunderLevel * this.rainLevel });
    // PlayerList.placeNewPlayer: everyone's PlayerInfo to the newcomer, theirs to everyone
    for (const o of this.players) {
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
    const owner = this.players.find((p) => p.isOwner);
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
    if (!b.striking) return;
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
      const spawn = this.prepareChunk(0, 0);
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
    for (const pl of this.players) this.send(pl, { t: 'time', gameTime: this.gameTime, dayTime: this.dayTime, doDaylightCycle: this.doDaylightCycle });
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
    const waterlogged = getProp(state, 'waterlogged') === true;
    const water = BLOCKS_BY_NAME.get('water')!.defaultState;
    this.setBlock(x, y, z, waterlogged ? water : 0);
    // particles + sound for everyone else (the breaker plays them locally)
    for (const o of this.players) if (o !== breaker) this.send(o, { t: 'levelEvent', event: 2001, x, y, z, data: state });
    if (breaker && (breaker.gameMode === 0 || breaker.gameMode === 2)) breaker.living.food.addExhaustion(EXHAUSTION.breakBlock);
    if (drops && breaker && breaker.gameMode !== 1) {
      const held = breaker.inventory.selectedStack;
      const harvest = canHarvest(held?.id ?? 0, state);
      const items = blockDrops(state, { silkTouch: false, shears: itemNameOf(held?.id ?? 0) === 'shears', canHarvest: harvest, random: () => this.rand.nextFloat() });
      for (const it of items) this.popResource(x, y, z, it);
      // Block.spawnAfterBreak → popExperience (OreBlock / RedStoneOreBlock / SpawnerBlock)
      const xp = harvest ? oreExperience(name, this.rand) : 0;
      if (xp > 0) this.spawnExperience(x + 0.5, y + 0.5, z + 0.5, xp);
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
    // non-block items (flint and steel): Item.useOn
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
    const state = stateForPlacement(block, { world: this.world, x: px, y: py, z: pz, face, hx: m.cx, hy: m.cy, hz: m.cz, yaw: p.yaw, pitch: p.pitch, sneaking: p.sneaking }, existing);
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

  /** Vanilla Block.popResource: item at the block centre ± 0.25 with a small upward toss. */
  popResource(x: number, y: number, z: number, stack: ItemStack): void {
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
          this.send(p, { t: 'addEntity', id: e.id, type: e.type, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz, data: e instanceof ExperienceOrb ? e.value : e instanceof Arrow ? e.ownerId : 0 });
          if (e instanceof ItemEntity) this.send(p, { t: 'itemStack', id: e.id, item: e.stack.id, count: e.stack.count });
        } else if (!visible && p.tracking.has(e.id)) {
          p.tracking.delete(e.id);
          this.send(p, { t: 'removeEntities', ids: [e.id] });
        }
      }
    }
    for (const e of this.entities.values()) {
      if (e.removed) continue;
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
    p.stateDirty = true;
    this.send(p, { t: 'gameMode', mode });
    this.sendAbilities(p);
    for (const o of this.players) this.send(o, { t: 'playerInfo', action: 1, id: p.id, name: p.name, skin: '', gameMode: mode });
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
    return false;
  }

  /** ServerGamePacketListenerImpl.handleInteract (attack) → Player.attack. */
  private handleAttack(p: ServerPlayer, targetId: number): void {
    const t = this.players.find((o) => o.id === targetId);
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
      else if (m.t === 'chat' && m.message.startsWith('/')) this.runCommand(p, m.message.slice(1));
      return;
    }
    switch (m.t) {
      case 'move':
        // while spectating through someone, the server places the player (vanilla clients stop sending)
        if (!p.camera) this.handleMove(p, m);
        break;
      case 'spectate': {
        // TeleportToEntity: spectators only
        const t = this.players.find((o) => o.id === m.target);
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
      case 'creativeSlot':
        if (p.gameMode === 1 && m.slot >= 0 && m.slot < 41) {
          p.inventory.set(m.slot, m.item > 0 && m.count > 0 ? { id: m.item, count: Math.min(m.count, maxStackSize(m.item)), damage: 0 } : null);
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
    } else if (a[0] === 'give' && a.length >= 3) {
      const target = a[1] === '@s' || a[1] === '@p' ? p : this.players.find((o) => o.name === a[1]);
      const item = ITEMS_BY_NAME.get(a[2]!.replace(/^minecraft:/, ''));
      const count = a[3] ? Math.floor(Number(a[3])) : 1;
      if (!target || !item || !(count >= 1 && count <= 6400)) return;
      // vanilla GiveCommand: fill the inventory, drop what doesn't fit at the player's feet
      let left = count;
      while (left > 0) {
        const n = Math.min(left, maxStackSize(item.id));
        left -= n;
        const rest = target.inventory.add({ id: item.id, count: n, damage: 0 });
        if (rest > 0) this.tossItem(target, { id: item.id, count: rest, damage: 0 });
      }
      for (let i = 0; i < 36; i++) this.syncSlot(target, i);
      this.send(p, { t: 'chat', json: JSON.stringify({ text: `Gave ${count} [${item.displayName}] to ${target.name}` }) });
    } else if (a[0] === 'setblock' && a.length >= 5) {
      const rel = (v: string, base: number) => (v.startsWith('~') ? Math.floor(base) + (Number(v.slice(1)) || 0) : Math.floor(Number(v)));
      const x = rel(a[1]!, p.x), y = rel(a[2]!, p.y), z = rel(a[3]!, p.z);
      const b = BLOCKS_BY_NAME.get(a[4]!.replace(/^minecraft:/, ''));
      if (!b || ![x, y, z].every(Number.isFinite)) return;
      this.setBlock(x, y, z, b.defaultState);
      this.updateNeighbors(x, y, z);
    } else if (a[0] === 'summon' && a[1]?.replace(/^minecraft:/, '') === 'lightning_bolt') {
      const rel = (v: string | undefined, base: number) => (v === undefined ? base : v.startsWith('~') ? base + (Number(v.slice(1)) || 0) : Number(v));
      const x = rel(a[2], p.x), y = rel(a[3], p.y), z = rel(a[4], p.z);
      if ([x, y, z].every(Number.isFinite)) this.strikeLightning(x, y, z);
    } else if (a[0] === 'spawnpoint') {
      const t = a[1] && !a[1].startsWith('~') && isNaN(Number(a[1])) ? this.players.find((o) => o.name === a[1] || a[1] === '@s' || a[1] === '@p') : p;
      const c = a.slice(a[1] && isNaN(Number(a[1])) && !a[1].startsWith('~') ? 2 : 1);
      const rel = (v: string | undefined, base: number) => (v === undefined ? Math.floor(base) : v.startsWith('~') ? Math.floor(base) + (Number(v.slice(1)) || 0) : Math.floor(Number(v)));
      if (!t) return;
      const x = rel(c[0], t.x), y = rel(c[1], t.y), z = rel(c[2], t.z);
      t.respawn = { x, y, z, angle: t.yaw };
      this.send(p, { t: 'chat', json: JSON.stringify({ text: `Set spawn point to ${x}, ${y}, ${z} in minecraft:overworld for ${t.name}` }) });
    } else if (a[0] === 'setworldspawn') {
      const rel = (v: string | undefined, base: number) => (v === undefined ? Math.floor(base) : v.startsWith('~') ? Math.floor(base) + (Number(v.slice(1)) || 0) : Math.floor(Number(v)));
      this.worldSpawn = [rel(a[1], p.x), rel(a[2], p.y), rel(a[3], p.z)];
      this.worldSpawnSet = true;
      this.send(p, { t: 'chat', json: JSON.stringify({ text: `Set the world spawn point to ${this.worldSpawn.join(', ')} [0.0]` }) });
    } else if (a[0] === 'gamerule' && (a[1] === 'playersSleepingPercentage' || a[1] === 'spawnRadius') && a[2] !== undefined && Number.isFinite(Number(a[2]))) {
      if (a[1] === 'playersSleepingPercentage') this.playersSleepingPercentage = Math.max(0, Math.floor(Number(a[2])));
      else this.spawnRadius = Math.max(0, Math.floor(Number(a[2])));
    } else if (a[0] === 'kill') {
      this.survival.hurt(p, DAMAGE.outOfWorld, 3.4028235e38);
    } else if (a[0] === 'difficulty' && a[1]) {
      const d = ({ peaceful: 0, easy: 1, normal: 2, hard: 3 } as Record<string, Difficulty>)[a[1]];
      if (d !== undefined) {
        this.difficulty = d;
        for (const o of this.players) this.send(o, { t: 'difficulty', difficulty: d });
      }
    } else if (a[0] === 'gamerule' && a[1] && a[1] in this.gameRules && (a[2] === 'true' || a[2] === 'false')) {
      (this.gameRules as unknown as Record<string, boolean>)[a[1]] = a[2] === 'true';
    } else if ((a[0] === 'xp' || a[0] === 'experience') && a[1] === 'add' && a[3]) {
      const n = Math.floor(Number(a[3]));
      if (Number.isFinite(n)) this.survival.giveExperience(p, n, a[4] === 'levels');
    } else if (a[0] === 'effect' && (a[1] === 'clear' || a[1] === 'give')) {
      const t = !a[2] || a[2] === '@s' || a[2] === '@p' ? p : this.players.find((o) => o.name === a[2]);
      if (!t) return;
      const target = this.items.effectTarget(t);
      const name = a[3]?.replace(/^minecraft:/, '');
      if (a[1] === 'clear') {
        if (name) t.living.effects.remove(name, target);
        else t.living.effects.clear(target);
      } else if (name && EFFECT_ID[name] !== undefined) {
        const secs = a[4] ? Number(a[4]) : 30, amp = a[5] ? Number(a[5]) : 0;
        if (!Number.isFinite(secs) || !Number.isFinite(amp)) return;
        // EffectCommands: instant effects last 1 tick; others seconds × 20
        t.living.effects.add(name, name.startsWith('instant_') ? 1 : secs * 20, Math.max(0, Math.min(255, amp)), target);
      }
      this.survival.sync(t);
    } else if (a[0] === 'clear') {
      for (let i = 0; i < 41; i++) p.inventory.set(i, null);
      for (let i = 0; i < 41; i++) this.syncSlot(p, i);
    } else if (a[0] === 'tp' && a.length >= 4) {
      const n = a.slice(1, 4).map(Number);
      if (n.some((v) => !Number.isFinite(v))) return;
      p.x = n[0]!;
      p.y = n[1]!;
      p.z = n[2]!;
      this.send(p, { t: 'teleport', x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch });
    }
  }

  send(p: ServerPlayer, packet: S2C): void {
    p.conn.send(encodeS2C(packet));
  }

  // ---------------------------------------------------------------- world access
  /** Chunks unloaded this session (serialized with their generation stage), restored instead of regenerated. */
  private readonly stored = new Map<number, { data: ArrayBuffer; stage: number; lit: boolean }>();

  /**
   * Bring a chunk up to a generation stage, like vanilla's ChunkStatus pyramid: features (stage 2)
   * need the 8 neighbours carved, because they write into them; a full chunk (stage 3) needs its
   * neighbours decorated, so nothing writes into it any more.
   */
  ensureStage(cx: number, cz: number, stage: number): Chunk {
    let c = this.world.getChunk(cx, cz);
    if (!c) {
      const saved = this.stored.get(chunkKey(cx, cz));
      if (saved) {
        c = readChunk(new ByteReader(saved.data), true);
        c.stage = saved.stage;
        c.lit = saved.lit;
        this.stored.delete(chunkKey(cx, cz));
      } else {
        c = this.generator.generate(cx, cz);
        if (this.generator instanceof OverworldGenerator) c.stage = 1;
      }
      this.world.addChunk(c);
    }
    if (stage >= 2 && c.stage < 2) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) this.ensureStage(cx + dx, cz + dz, 1);
      if (this.generator instanceof OverworldGenerator) this.generator.decorate(this.world, cx, cz);
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

  /** A chunk is ready to send once it is full (neighbours decorated) and lit. */
  private prepareChunk(cx: number, cz: number): Chunk {
    const c = this.ensureStage(cx, cz, 3);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.ensureStage(cx + dx, cz + dz, 1);
    if (!c.lit) this.light.lightChunk(c);
    return c;
  }

  /** Keep an unloaded chunk (blocks, light, stage) so coming back finds it as it was. */
  private storeChunk(c: Chunk): void {
    const w = new ByteWriter(65536);
    writeChunk(w, c, true);
    this.stored.set(chunkKey(c.x, c.z), { data: w.finish(), stage: c.stage, lit: c.lit });
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
    this.tickLightning();
    this.sleep.tick();
    for (const p of this.players) {
      // ServerPlayer.tick: a spectator rides along with its camera entity until it sneaks
      const cam = p.camera;
      if (cam) {
        if (!this.players.includes(cam) || cam.living.dead) this.setCamera(p, null);
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
    this.tickEntities();
    this.updateChunks();
    this.updateTracking();
    this.trackEntities();
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
        if (!needed) {
          this.storeChunk(c);
          this.world.removeChunk(c.x, c.z);
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
