/**
 * Mob glue for the GameServer: spawning (natural + chunk generation, vanilla NaturalSpawner
 * 1.17.1), despawning, melee between mobs and players, player interactions, arrows, explosions,
 * death loot/XP and the network sync of mob state.
 */
import { AABB, noCollision } from '@shared/entity/aabb';
import { blockOf, blockNameOf, getProp } from '@shared/world/blockstate';
import { FLUID, FULL_COLLISION, LIGHT_EMIT } from '@shared/world/blockinfo';
import { collisionBoxes } from '@shared/world/shapes';
import { raycastBlocks } from '@shared/world/raycast';
import { isDay, skyDarkenLevel } from '@shared/world/daylight';
import { BIOMES, ENTITIES_BY_NAME } from '@shared/data';
import { WORLDGEN } from '@shared/worldgen/features/data';
import { blockDrops } from '@shared/game/loot';
import { mobLoot } from '@shared/game/mobloot';
import { computeAttack } from '@shared/game/combat';
import { Difficulty, EXHAUSTION } from '@shared/game/food';
import { itemName, maxStackSize, type ItemStack } from '@shared/item/stack';
import { ITEMS_BY_ID } from '@shared/data';
import { DYE_COLORS } from '@shared/entity/mobdata';
import type { Chunk } from '@shared/world/chunk';
import type { JavaRandom } from '@shared/util/random';
import { ItemEntity, ExperienceOrb, type ServerEntity } from '../entity';
import type { ServerPlayer } from '../player';
import type { GameServer } from '../server';
import { DAMAGE, type DamageSource } from '../survival';
import { Mob, isMob, targetEye, type Target, type MobCategory } from './mob';
import { Zombie, Husk, Drowned, Skeleton, Stray, Creeper, Spider, Monster, ZombieVillager, CaveSpider } from './monsters';
import { Pig, Cow, Sheep, Chicken, Animal } from './animals';
import { Arrow } from './arrow';
import { Slime, isSlimeChunk, moonBrightness } from './slime';
import { Enderman } from './enderman';
import { Bat, Squid } from './ambient';
import { saveMob, applyMobSave, type MobSave } from './persist';
import { commandHooks } from '../commands/hooks';
import { MobSpawners } from './spawners';
import { itemForBlock } from '@shared/game/loot';

type MobCtor = new (id: number, s: GameServer) => Mob;
export const MOB_TYPES: Record<string, MobCtor> = {
  zombie: Zombie, husk: Husk, drowned: Drowned, zombie_villager: ZombieVillager, cave_spider: CaveSpider, skeleton: Skeleton, stray: Stray, creeper: Creeper, spider: Spider,
  pig: Pig, cow: Cow, sheep: Sheep, chicken: Chicken, slime: Slime, enderman: Enderman, bat: Bat, squid: Squid,
};

/** MobCategory caps (1.17.1) and the categories we spawn. */
export const MOB_CAPS: Partial<Record<MobCategory, number>> = { monster: 70, creature: 10, ambient: 15, water_creature: 5 };
const SPAWN_CATEGORIES: MobCategory[] = ['monster', 'creature', 'ambient', 'water_creature'];
/** NaturalSpawner.MAGIC_NUMBER: 17×17 chunks */
const MAGIC_NUMBER = 289;

export type SpawnReason = 'natural' | 'chunk_generation' | 'breeding' | 'command' | 'spawner' | 'conversion';

export class MobManager {
  /** natural and chunk-generation spawning enabled for this server (null = from the server options) */
  spawningOverride: boolean | null = null;

  /** monster spawner blocks */
  readonly spawners: MobSpawners;

  constructor(private readonly s: GameServer) {
    this.spawners = new MobSpawners(s);
  }

  get naturalSpawning(): boolean {
    const o = this.s.opts;
    return this.spawningOverride ?? o.spawnMobs ?? !(o.devTerrain || o.scene);
  }

  get mobGriefing(): boolean {
    return this.s.gameRules.mobGriefing;
  }
  get doMobLoot(): boolean {
    return this.s.gameRules.doMobLoot;
  }
  get doMobSpawning(): boolean {
    return this.s.gameRules.doMobSpawning;
  }

  /** LightningBolt hitting mobs (Entity.thunderHit; creepers become charged). */
  thunderHit(x: number, y: number, z: number): void {
    for (const m of this.nearbyMobs(x, z, 3.3)) {
      if (m.dead || Math.abs(m.x - x) > 3.3 || Math.abs(m.z - z) > 3.3 || m.y + m.height < y - 3 || m.y > y + 9) continue;
      m.remainingFireTicks++;
      if (m.remainingFireTicks === 0) m.setSecondsOnFire(8);
      if (m instanceof Creeper && !m.powered) {
        m.powered = true;
        m.flagsDirty = true;
      }
      m.hurt(DAMAGE.lightningBolt, 5);
    }
  }

  // ------------------------------------------------------------------ queries
  mobs(): Mob[] {
    const out: Mob[] = [];
    for (const e of this.s.entities.values()) if (e instanceof Mob && !e.removed) out.push(e);
    return out;
  }

  /** 16×16 column buckets of mobs, rebuilt once per tick (and lazily after spawns). */
  private index = new Map<number, Mob[]>();
  private indexTick = -1;
  private indexSize = -1;

  private rebuildIndex(): void {
    this.index.clear();
    for (const e of this.s.entities.values()) {
      if (!(e instanceof Mob) || e.removed) continue;
      const k = (Math.floor(e.x) >> 4) * 65536 + (Math.floor(e.z) >> 4);
      let b = this.index.get(k);
      if (!b) this.index.set(k, (b = []));
      b.push(e);
    }
    this.indexTick = this.s.gameTime;
    this.indexSize = this.s.entities.size;
  }

  nearbyMobs(x: number, z: number, r: number): Mob[] {
    if (this.indexTick !== this.s.gameTime || this.indexSize !== this.s.entities.size) this.rebuildIndex();
    const out: Mob[] = [];
    const R = r + 2;
    const cx0 = Math.floor(x - R) >> 4, cx1 = Math.floor(x + R) >> 4, cz0 = Math.floor(z - R) >> 4, cz1 = Math.floor(z + R) >> 4;
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const b = this.index.get(cx * 65536 + cz);
        if (!b) continue;
        for (const e of b) if (!e.removed && Math.abs(e.x - x) <= R && Math.abs(e.z - z) <= R) out.push(e);
      }
    return out;
  }

  nearestPlayer(x: number, y: number, z: number, range: number, pred: (p: ServerPlayer) => boolean): ServerPlayer | null {
    let best: ServerPlayer | null = null, bd = range < 0 ? Infinity : range * range;
    for (const p of this.s.players) {
      if (p.living.dead || !pred(p)) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** ServerPlayer.startSleepInBed: a hostile monster's box within (±8, ±5, ±8) of the bed. */
  monstersNear(x: number, y: number, z: number): boolean {
    const box = new AABB(x - 8, y - 5, z - 8, x + 8, y + 5, z + 8);
    return this.nearbyMobs(x, z, 10).some((m) => m instanceof Monster && !m.dead && m.bb().intersects(box));
  }

  isDay(): boolean {
    const s = this.s;
    return isDay(s.dayTime, s.rainLevel, s.thunderLevel * s.rainLevel);
  }

  displayName(m: Mob): string {
    return ENTITIES_BY_NAME.get(m.type)?.displayName ?? m.type;
  }

  // ------------------------------------------------------------------ spawning
  /** Create and add a mob (EntityType.spawn + finalizeSpawn). */
  spawn(type: string, x: number, y: number, z: number, reason: SpawnReason = 'command', groupIndex = 0): Mob | null {
    const C = MOB_TYPES[type];
    if (!C) return null;
    const m = new C(this.s.allocateEntityId(), this.s);
    m.x = x;
    m.y = y;
    m.z = z;
    m.yaw = m.rng.nextFloat() * 360;
    m.yHeadRot = m.yBodyRot = m.yaw;
    m.init();
    if (reason !== 'breeding' && reason !== 'conversion') {
      if (m instanceof Zombie || m instanceof Skeleton || m instanceof Slime) m.finalizeSpawn();
      else if (m instanceof Animal) m.finalizeSpawn(groupIndex);
    }
    this.s.spawnEntity(m);
    return m;
  }

  /** Save data of every living mob (optionally only those inside a chunk). */
  save(cx?: number, cz?: number): MobSave[] {
    return this.mobs().filter((m) => !m.dead && (cx === undefined || ((Math.floor(m.x) >> 4) === cx && (Math.floor(m.z) >> 4) === cz))).map(saveMob);
  }

  /** Chunks whose last saved record contained mobs (they must be rewritten even when the mobs left). */
  private readonly savedWithMobs = new Set<number>();

  private hasMobsIn(cx: number, cz: number): boolean {
    return this.nearbyMobs(cx * 16 + 8, cz * 16 + 8, 8).some((m) => !m.dead && !m.removed && Math.floor(m.x) >> 4 === cx && Math.floor(m.z) >> 4 === cz);
  }

  /** Whether a chunk's record must be rewritten because of mobs (present now or in the last save). */
  chunkNeedsSave(cx: number, cz: number): boolean {
    return this.savedWithMobs.has(cx * 65536 + cz) || this.hasMobsIn(cx, cz);
  }

  /** Remember whether a chunk's newest record holds mobs. */
  noteSaved(cx: number, cz: number, count: number): void {
    if (count > 0) this.savedWithMobs.add(cx * 65536 + cz);
    else this.savedWithMobs.delete(cx * 65536 + cz);
  }

  /** A chunk is unloading: save its mobs and take them out of the world (they return with the chunk). */
  unloadChunk(cx: number, cz: number): MobSave[] {
    const out: MobSave[] = [];
    for (const m of this.nearbyMobs(cx * 16 + 8, cz * 16 + 8, 8)) {
      if (m.dead || m.removed || Math.floor(m.x) >> 4 !== cx || Math.floor(m.z) >> 4 !== cz) continue;
      out.push(saveMob(m));
      m.removed = true;
    }
    return out;
  }

  /** Recreate saved mobs (no spawn randomisation). */
  load(list: MobSave[]): Mob[] {
    const out: Mob[] = [];
    for (const o of list) {
      const C = MOB_TYPES[o.type];
      if (!C) continue;
      const m = new C(this.s.allocateEntityId(), this.s);
      m.init();
      applyMobSave(m, o);
      if (m instanceof Skeleton) m.reassessWeaponGoal();
      this.s.spawnEntity(m);
      out.push(m);
    }
    return out;
  }

  /** ServerChunkCache.tickChunks → NaturalSpawner.spawnForChunk for every spawning chunk. */
  tick(): void {
    const s = this.s;
    // Mob.checkDespawn every tick
    for (const m of this.mobs()) this.checkDespawn(m);
    this.spawners.tick();
    if (!this.doMobSpawning || !this.naturalSpawning || s.players.length === 0) return;
    const spawnEnemies = s.difficulty !== Difficulty.Peaceful;
    const spawnPersistent = s.gameTime % 400 === 0;
    const sim = s.simulationDistanceFor();
    const spawnable = new Set<number>();
    const ticking: [number, number][] = [];
    const seen = new Set<number>();
    for (const p of s.players) {
      if (p.gameMode === 3) continue;
      const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
      for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) spawnable.add((pcx + dx) * 65536 + (pcz + dz));
      for (let dx = -sim; dx <= sim; dx++)
        for (let dz = -sim; dz <= sim; dz++) {
          const cx = pcx + dx, cz = pcz + dz;
          const k = cx * 65536 + cz;
          if (seen.has(k)) continue;
          seen.add(k);
          if (!s.world.getChunk(cx, cz)) continue;
          // noPlayersCloseForSpawning: a player within 128 blocks of the chunk centre
          if ((cx * 16 + 8 - p.x) ** 2 + (cz * 16 + 8 - p.z) ** 2 >= 16384) continue;
          ticking.push([cx, cz]);
        }
    }
    const counts: Partial<Record<MobCategory, number>> = {};
    for (const m of this.mobs()) {
      if (m.persistenceRequired) continue;
      if (!spawnable.has((Math.floor(m.x) >> 4) * 65536 + (Math.floor(m.z) >> 4))) continue;
      counts[m.category] = (counts[m.category] ?? 0) + 1;
    }
    const r = s.rand;
    // Collections.shuffle
    for (let i = ticking.length - 1; i > 0; i--) {
      const j = r.nextInt(i + 1);
      [ticking[i], ticking[j]] = [ticking[j]!, ticking[i]!];
    }
    for (const [cx, cz] of ticking) {
      for (const cat of SPAWN_CATEGORIES) {
        const friendly = cat !== 'monster';
        const persistent = cat === 'creature';
        if (!friendly && !spawnEnemies) continue;
        if (persistent && !spawnPersistent) continue;
        const cap = Math.floor((MOB_CAPS[cat]! * spawnable.size) / MAGIC_NUMBER);
        if ((counts[cat] ?? 0) >= cap) continue;
        const n = this.spawnCategoryForChunk(cat, cx, cz);
        counts[cat] = (counts[cat] ?? 0) + n;
      }
    }
  }

  /** NaturalSpawner.spawnCategoryForChunk + spawnCategoryForPosition */
  spawnCategoryForChunk(cat: MobCategory, cx: number, cz: number): number {
    const s = this.s, r = s.rand, w = s.world;
    const c = w.getChunk(cx, cz);
    if (!c) return 0;
    const bx = cx * 16 + r.nextInt(16), bz = cz * 16 + r.nextInt(16);
    const top = c.motionBlocking[(bz & 15) * 16 + (bx & 15)]! + 1;
    const y = r.nextInt(top + 1);
    if (y < 1) return 0;
    if (FULL_COLLISION[w.getState(bx, y, bz)]) return 0;
    let spawned = 0;
    for (let k = 0; k < 3; k++) {
      let x = bx, z = bz;
      let data: { type: string; minCount: number; maxCount: number } | null = null;
      let packSize = Math.ceil(r.nextFloat() * 4);
      let inGroup = 0;
      for (let j = 0; j < packSize; j++) {
        x += r.nextInt(6) - r.nextInt(6);
        z += r.nextInt(6) - r.nextInt(6);
        const px = x + 0.5, pz = z + 0.5;
        const pl = this.nearestPlayer(px, y, pz, -1, (p) => p.gameMode !== 3);
        if (!pl) continue;
        const d2 = (pl.x - px) ** 2 + (pl.y - y) ** 2 + (pl.z - pz) ** 2;
        // isRightDistanceToPlayerAndSpawnPoint
        if (d2 <= 576) continue;
        const ws = s.worldSpawn;
        if ((ws[0] + 0.5 - px) ** 2 + (ws[1] - y) ** 2 + (ws[2] + 0.5 - pz) ** 2 < 576) continue;
        if (!w.getChunk(x >> 4, z >> 4)) continue;
        if (!data) {
          data = this.randomSpawnerAt(cat, x, y, z, r);
          if (!data) break;
          packSize = data.minCount + r.nextInt(1 + data.maxCount - data.minCount);
        }
        const type = data.type;
        if (!MOB_TYPES[type]) continue;
        // isValidSpawnPostitionForType: monsters can't spawn beyond the despawn distance
        if (cat !== 'creature' && d2 > 16384) continue;
        if (!this.spawnPositionOk(type, x, y, z)) continue;
        const e = ENTITIES_BY_NAME.get(type)!;
        if (!noCollision(w, AABB.ofSize(px, y, pz, e.width, e.height))) continue;
        if (!this.checkSpawnRules(type, x, y, z, 'natural', r)) continue;
        const m = this.spawn(type, px, y, pz, 'natural', inGroup);
        if (!m) continue;
        spawned++;
        inGroup++;
        if (spawned >= 4) return spawned;
      }
    }
    return spawned;
  }

  /** NaturalSpawner.getRandomSpawnMobAt: weighted pick from the biome's spawner list. */
  randomSpawnerAt(cat: MobCategory, x: number, y: number, z: number, r: JavaRandom): { type: string; minCount: number; maxCount: number } | null {
    const biome = BIOMES[this.s.world.getBiome(x, y, z)]?.name ?? 'plains';
    const list = WORLDGEN.biomes[biome]?.spawners?.[cat] ?? [];
    let total = 0;
    for (const e of list) total += e.weight;
    if (total <= 0) return null;
    let i = r.nextInt(total);
    for (const e of list) {
      i -= e.weight;
      if (i < 0) return { type: e.type.replace(/^minecraft:/, ''), minCount: e.minCount, maxCount: e.maxCount };
    }
    return null;
  }

  /** SpawnPlacements: ON_GROUND (IN_WATER for drowned) with isValidSpawn / isValidEmptySpawnBlock. */
  spawnPositionOk(type: string, x: number, y: number, z: number): boolean {
    const w = this.s.world;
    if (type === 'drowned' || type === 'squid') return FLUID[w.getState(x, y, z)] === 1 && !FULL_COLLISION[w.getState(x, y + 1, z)];
    return isValidSpawnOn(w.getState(x, y - 1, z)) && isValidEmptySpawnBlock(w.getState(x, y, z)) && isValidEmptySpawnBlock(w.getState(x, y + 1, z));
  }

  /** SpawnPlacements predicates (Monster.checkMonsterSpawnRules, Animal.checkAnimalSpawnRules, …). */
  checkSpawnRules(type: string, x: number, y: number, z: number, reason: SpawnReason, r: JavaRandom): boolean {
    const s = this.s, w = s.world;
    const C = MOB_TYPES[type];
    if (!C) return false;
    const proto = C.prototype as Mob;
    if (proto instanceof Animal || type === 'pig' || type === 'cow' || type === 'sheep' || type === 'chicken') {
      return blockNameOf(w.getState(x, y - 1, z)) === 'grass_block' && Math.max(w.getSkyLight(x, y, z), w.getBlockLight(x, y, z)) > 8;
    }
    if (type === 'bat') {
      // Bat.checkBatSpawnRules: below sea level, dark (outside the Halloween season)
      if (y >= 63) return false;
      if (r.nextBoolean()) return false;
      const darken = skyDarkenLevel(s.dayTime, s.rainLevel, s.thunderLevel * s.rainLevel);
      return Math.max(w.getSkyLight(x, y, z) - darken, w.getBlockLight(x, y, z)) <= r.nextInt(4);
    }
    if (type === 'squid') return y > 45 && y < 63;
    // monsters
    if (s.difficulty === Difficulty.Peaceful) return false;
    if (type === 'slime') {
      // Slime.checkSlimeSpawnRules: swamps at night by moonlight, or slime chunks below y 40
      const biome = BIOMES[w.getBiome(x, y, z)]?.name ?? '';
      if ((biome === 'swamp' || biome === 'swamp_hills') && y > 50 && y < 70 && r.nextFloat() < 0.5 && r.nextFloat() < moonBrightness(s.dayTime)) {
        const darken = skyDarkenLevel(s.dayTime, s.rainLevel, s.thunderLevel * s.rainLevel);
        if (Math.max(w.getSkyLight(x, y, z) - darken, w.getBlockLight(x, y, z)) <= r.nextInt(8)) return true;
      }
      return r.nextInt(10) === 0 && isSlimeChunk(s.opts.seed, x >> 4, z >> 4) && y < 40;
    }
    if (!this.isDarkEnoughToSpawn(x, y, z, r)) return false;
    if (type === 'husk' || type === 'stray') {
      const c = w.getChunk(x >> 4, z >> 4);
      if (reason !== 'spawner' && !(c && c.skyTop[(z & 15) * 16 + (x & 15)]! <= y)) return false;
    }
    if (type === 'drowned') {
      const biome = BIOMES[w.getBiome(x, y, z)]?.name ?? '';
      const river = biome === 'river' || biome === 'frozen_river';
      if (!(river ? r.nextInt(15) === 0 : r.nextInt(40) === 0)) return false;
      if (y >= 63 - 5) return false;
    }
    return true;
  }

  /** Monster.isDarkEnoughToSpawn (1.17.1): sky light ≤ random(32), then raw brightness ≤ random(8). */
  isDarkEnoughToSpawn(x: number, y: number, z: number, r: JavaRandom): boolean {
    const s = this.s, w = s.world;
    if (w.getSkyLight(x, y, z) > r.nextInt(32)) return false;
    const darken = s.isThundering() ? 10 : skyDarkenLevel(s.dayTime, s.rainLevel, s.thunderLevel * s.rainLevel);
    const light = Math.max(w.getSkyLight(x, y, z) - darken, w.getBlockLight(x, y, z));
    return light <= r.nextInt(8);
  }

  /** NaturalSpawner.spawnMobsForChunkGeneration: creature packs placed while the chunk generates. */
  spawnForChunkGeneration(c: Chunk): void {
    const s = this.s, w = s.world;
    const r = s.rand;
    const biomeName = BIOMES[w.getBiome(c.x * 16 + 8, 64, c.z * 16 + 8)]?.name ?? 'plains';
    const bw = WORLDGEN.biomes[biomeName] as { spawners?: Record<string, { type: string; weight: number; minCount: number; maxCount: number }[]>; creature_spawn_probability?: number } | undefined;
    const list = bw?.spawners?.creature ?? [];
    if (!list.length) return;
    const prob = bw?.creature_spawn_probability ?? 0.1;
    const i0 = c.x * 16, j0 = c.z * 16;
    while (r.nextFloat() < prob) {
      let total = 0;
      for (const e of list) total += e.weight;
      let pick = r.nextInt(total);
      let data = list[0]!;
      for (const e of list) {
        pick -= e.weight;
        if (pick < 0) {
          data = e;
          break;
        }
      }
      const type = data.type.replace(/^minecraft:/, '');
      const n = data.minCount + r.nextInt(1 + data.maxCount - data.minCount);
      let l = i0 + r.nextInt(16), i1 = j0 + r.nextInt(16);
      const j1 = l, k1 = i1;
      let groupIndex = 0;
      for (let k = 0; k < n; k++) {
        let ok = false;
        for (let t = 0; !ok && t < 4; t++) {
          const yTop = this.topNonCollidingY(l, i1);
          const ent = ENTITIES_BY_NAME.get(type);
          if (MOB_TYPES[type] && ent && this.spawnPositionOk(type, l, yTop, i1)) {
            const f = ent.width;
            const d0 = Math.max(i0 + f, Math.min(i0 + 16 - f, l)), d1 = Math.max(j0 + f, Math.min(j0 + 16 - f, i1));
            if (noCollision(w, AABB.ofSize(d0, yTop, d1, ent.width, ent.height)) && this.checkSpawnRules(type, Math.floor(d0), yTop, Math.floor(d1), 'chunk_generation', r)) {
              if (this.spawn(type, d0, yTop, d1, 'chunk_generation', groupIndex++)) ok = true;
            }
          }
          l += r.nextInt(5) - r.nextInt(5);
          for (i1 += r.nextInt(5) - r.nextInt(5); l < i0 || l >= i0 + 16 || i1 < j0 || i1 >= j0 + 16; i1 = k1 + r.nextInt(5) - r.nextInt(5)) {
            l = j1 + r.nextInt(5) - r.nextInt(5);
          }
        }
      }
    }
  }

  private topNonCollidingY(x: number, z: number): number {
    const c = this.s.world.getChunk(x >> 4, z >> 4);
    return c ? c.motionBlocking[(z & 15) * 16 + (x & 15)]! : 64;
  }

  /** Mob.checkDespawn */
  checkDespawn(m: Mob): void {
    if (m.dead) return;
    if (this.s.difficulty === Difficulty.Peaceful && m.shouldDespawnInPeaceful()) {
      m.removed = true;
      return;
    }
    if (m.persistenceRequired) {
      m.noActionTime = 0;
      return;
    }
    const p = this.nearestPlayer(m.x, m.y, m.z, -1, (pl) => pl.gameMode !== 3);
    if (!p) return;
    const d2 = (p.x - m.x) ** 2 + (p.y - m.y) ** 2 + (p.z - m.z) ** 2;
    if (d2 > 128 * 128 && m.removeWhenFarAway(d2)) {
      m.removed = true;
      return;
    }
    if (m.noActionTime > 600 && m.rng.nextInt(800) === 0 && d2 > 32 * 32 && m.removeWhenFarAway(d2)) m.removed = true;
    else if (d2 < 32 * 32) m.noActionTime = 0;
  }

  // ------------------------------------------------------------------ combat
  /** Mob.doHurtTarget */
  doHurtTarget(m: Mob, t: Target): boolean {
    const dmg = m instanceof Zombie ? m.attackDamageValue() : m.attackDamage;
    const src: DamageSource = { id: 'mob', scalesWithDifficulty: true, knockbackFrom: m, entity: { name: this.displayName(m), player: false } };
    const ok = isMob(t) ? t.hurt(src, dmg, m) : this.s.survival.hurt(t, src, dmg);
    if (ok && m instanceof Zombie) m.afterHurtTarget(t);
    return ok;
  }

  setOnFire(t: Target, seconds: number): void {
    if (isMob(t)) t.setSecondsOnFire(seconds);
    else this.s.survival.setOnFire(t, seconds);
  }

  /** Player.attack on a mob: damage, crits, sprint knockback and sword sweeps. */
  playerAttack(p: ServerPlayer, t: Mob): void {
    const s = this.s;
    if (t.dead) return;
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
    });
    p.attackStrengthTicker = 0;
    const sx = p.x, sy = p.y, sz = p.z;
    if (res.knockback > 0 && res.charged && p.sprinting) s.playSound(null, 'entity.player.attack.knockback', 'player', sx, sy, sz, 1, 1);
    const src: DamageSource = { ...DAMAGE.playerAttack, entity: { name: p.name, player: true } };
    const hpBefore = t.health;
    const hit = t.hurt(src, res.damage, p);
    if (!hit) {
      s.playSound(null, 'entity.player.attack.nodamage', 'player', sx, sy, sz, 1, 1);
      return;
    }
    const yr = (p.yaw * Math.PI) / 180;
    if (res.knockback > 0) {
      t.knockback(res.knockback * 0.5, Math.sin(yr), -Math.cos(yr));
      p.sprinting = false;
      p.stateDirty = true;
    }
    if (res.sweep) {
      // sweep: everything within the target's box inflated (1, 0.25, 1) and 3 blocks of the player
      const bb = t.bb().inflate(1, 0.25, 1);
      for (const o of this.nearbyMobs(t.x, t.z, 3)) {
        if (o === t || o.dead || !o.bb().intersects(bb)) continue;
        if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 + (o.z - p.z) ** 2 >= 9) continue;
        o.knockback(0.4, Math.sin(yr), -Math.cos(yr));
        o.hurt(src, 1, p);
      }
      s.playSound(null, 'entity.player.attack.sweep', 'player', sx, sy, sz, 1, 1);
    }
    if (res.critical) {
      s.playSound(null, 'entity.player.attack.crit', 'player', sx, sy, sz, 1, 1);
      t.broadcast({ t: 'animate', id: t.id, action: 4 });
      s.send(p, { t: 'animate', id: t.id, action: 4 });
    }
    if (!res.critical && !res.sweep) s.playSound(null, res.charged ? 'entity.player.attack.strong' : 'entity.player.attack.weak', 'player', sx, sy, sz, 1, 1);
    // weapons lose durability (swords 1, tools 2)
    const held = p.inventory.selectedStack;
    // Item.hurtEnemy: swords and tridents lose 1, digging tools 2, anything else nothing
    if (held) {
      const n = itemName(held.id);
      const cost = /_sword$|^trident$/.test(n) ? 1 : /_(axe|pickaxe|shovel|hoe)$/.test(n) ? 2 : 0;
      if (cost) this.damageHeldItem(p, p.inventory.selected, cost);
    }
    void hpBefore;
    p.living.food.addExhaustion(EXHAUSTION.attack);
  }

  /** Right-click on a mob (vanilla Interact INTERACT). */
  interact(p: ServerPlayer, targetId: number, hand: number): void {
    const t = this.s.entities.get(targetId);
    if (!(t instanceof Mob) || t.dead || p.gameMode === 3) return;
    if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 + (t.z - p.z) ** 2 >= 36) return;
    if (t.interact(p, hand)) this.s.broadcastToTrackers(p, { t: 'animate', id: p.id, action: hand === 1 ? 3 : 0 }, false);
  }

  /** ItemStack.shrink unless creative (Animal.usePlayerItem). */
  usePlayerItem(p: ServerPlayer, slot: number): void {
    if (p.gameMode === 1) return;
    const st = p.inventory.get(slot);
    if (!st) return;
    st.count--;
    if (st.count <= 0) p.inventory.set(slot, null);
    this.s.syncSlot(p, slot);
  }

  /** ItemUtils.createFilledResult: bucket → milk bucket. */
  fillContainer(p: ServerPlayer, slot: number, result: ItemStack): void {
    if (p.gameMode === 1) {
      if (p.inventory.find(result.id) < 0) {
        const left = p.inventory.add(result);
        if (left > 0) this.s.tossItem(p, { ...result, count: left });
        for (let i = 0; i < 36; i++) this.s.syncSlot(p, i);
      }
      return;
    }
    const st = p.inventory.get(slot)!;
    if (st.count === 1) {
      p.inventory.set(slot, result);
      this.s.syncSlot(p, slot);
      return;
    }
    st.count--;
    this.s.syncSlot(p, slot);
    const left = p.inventory.add(result);
    if (left > 0) this.s.tossItem(p, { ...result, count: left });
    for (let i = 0; i < 36; i++) this.s.syncSlot(p, i);
  }

  /** ItemStack.hurtAndBreak (no Unbreaking yet). */
  damageHeldItem(p: ServerPlayer, slot: number, amount: number): void {
    if (p.gameMode === 1) return;
    const st = p.inventory.get(slot);
    if (!st) return;
    const max = ITEMS_BY_ID[st.id]?.maxDurability ?? 0;
    if (max <= 0) return;
    st.damage += amount;
    if (st.damage >= max) {
      p.inventory.set(slot, null);
      this.s.playSound(null, 'entity.item.break', 'player', p.x, p.y, p.z, 0.8, 0.8 + this.s.rand.nextFloat() * 0.4);
    }
    this.s.syncSlot(p, slot);
  }

  /** Entity.spawnAtLocation: drop an item at the mob (offset y), with the ItemEntity default toss. */
  spawnAtLocation(m: Mob, st: ItemStack, yOff = 0): ItemEntity | null {
    if (!st || st.count <= 0) return null;
    const r = this.s.rand;
    const e = new ItemEntity(this.s.allocateEntityId(), st);
    e.x = m.x;
    e.y = m.y + yOff;
    e.z = m.z;
    e.vx = r.nextDouble() * 0.2 - 0.1;
    e.vy = 0.2;
    e.vz = r.nextDouble() * 0.2 - 0.1;
    e.pickupDelay = 10;
    this.s.spawnEntity(e);
    return e;
  }

  /** LivingEntity.die → dropAllDeathLoot + experience */
  onMobDeath(m: Mob, src: DamageSource, attacker: Target | null): void {
    const s = this.s;
    void src;
    void attacker;
    const byPlayer = m.lastHurtByPlayerTime > 0;
    const looting = 0; // Looting enchantment arrives with enchanting (Phase 7)
    const dropLoot = !(m instanceof Animal && m.isBaby());
    if (this.doMobLoot && dropLoot) {
      const items = mobLoot(m.type, {
        looting, onFire: m.isOnFire(), killedByPlayer: byPlayer, random: () => s.rand.nextFloat(),
        sheared: m instanceof Sheep ? m.sheared : undefined, color: m instanceof Sheep ? DYE_COLORS[m.color] : undefined,
        size: m instanceof Slime ? m.size : undefined,
      });
      for (const it of items) {
        // split into stacks
        let n = it.count;
        while (n > 0) {
          const k = Math.min(n, maxStackSize(it.id));
          this.spawnAtLocation(m, { id: it.id, count: k, damage: 0 });
          n -= k;
        }
      }
      // Mob.dropCustomDeathLoot: equipment (8.5% + 1%/looting, randomly damaged), saddles
      const eq = m.mainHand;
      if (eq && byPlayer && Math.max(m.rng.nextFloat() - looting * 0.01, 0) < m.handDropChance) {
        const max = ITEMS_BY_ID[eq.id]?.maxDurability ?? 0;
        const st = { ...eq };
        if (max > 0 && m.handDropChance <= 1) st.damage = max - m.rng.nextInt(1 + m.rng.nextInt(Math.max(max - 3, 1)));
        this.spawnAtLocation(m, st);
      }
      if (m instanceof Enderman && m.carried) {
        const it = itemForBlock(m.carried);
        if (it) this.spawnAtLocation(m, { id: it, count: 1, damage: 0 });
      }
      if (m instanceof Pig && m.saddled) this.spawnAtLocation(m, { id: itemIdOf('saddle'), count: 1, damage: 0 });
    }
    // experience: only when a player hurt it in the last 5 s (or always-dropping mobs)
    if (byPlayer && this.doMobLoot) {
      const xp = m.experienceReward();
      if (xp > 0) s.spawnExperience(m.x, m.y, m.z, xp);
    }
  }

  // ------------------------------------------------------------------ projectiles / explosions
  /** AbstractSkeleton.performRangedAttack: arrow at the target's lower third, velocity 1.6, inaccuracy 14 − 4×difficulty. */
  shootArrow(m: Mob, t: Target, power: number, effect: string | null): Arrow {
    const s = this.s;
    const a = new Arrow(s.allocateEntityId(), s, m);
    a.x = m.x;
    a.y = m.y + m.eyeHeight - 0.1;
    a.z = m.z;
    // setEnchantmentEffectsFromEntity: base damage power×2 + gaussian×0.25 + difficulty×0.11
    a.baseDamage = power * 2 + m.rng.nextGaussian() * 0.25 + s.difficulty * 0.11;
    a.effect = effect;
    const th = isMob(t) ? t.height : targetEye(t) / 0.9;
    const dx = t.x - m.x, dy = t.y + th / 3 - a.y, dz = t.z - m.z;
    const d3 = Math.hypot(dx, dz);
    a.shoot(dx, dy + d3 * 0.2, dz, 1.6, 14 - s.difficulty * 4, m.rng);
    s.spawnEntity(a);
    return a;
  }

  /** Explosion.explode + finalizeExplosion (vanilla ray-marched block destruction and entity exposure). */
  explode(source: Mob | null, x: number, y: number, z: number, radius: number, destroy: boolean): void {
    const s = this.s, w = s.world, r = s.rand;
    const toBlow = new Map<number, [number, number, number]>();
    for (let j = 0; j < 16; j++)
      for (let k = 0; k < 16; k++)
        for (let l = 0; l < 16; l++) {
          if (!(j === 0 || j === 15 || k === 0 || k === 15 || l === 0 || l === 15)) continue;
          let d0 = (j / 15) * 2 - 1, d1 = (k / 15) * 2 - 1, d2 = (l / 15) * 2 - 1;
          const d3 = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
          d0 /= d3;
          d1 /= d3;
          d2 /= d3;
          let f = radius * (0.7 + r.nextFloat() * 0.6);
          let px = x, py = y, pz = z;
          for (; f > 0; f -= 0.22500001) {
            const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
            if (by < 0 || by > 255) break;
            const st = w.getState(bx, by, bz);
            if (st !== 0 || FLUID[st]) {
              const res = Math.max(blockOf(st).resistance, FLUID[st] ? 100 : 0);
              f -= (res + 0.3) * 0.3;
            }
            if (f > 0 && st !== 0) toBlow.set((bx * 4096 + bz) * 512 + by, [bx, by, bz]);
            px += d0 * 0.3;
            py += d1 * 0.3;
            pz += d2 * 0.3;
          }
        }
    // entities
    const f2 = radius * 2;
    const hitEntity = (t: Target | ItemEntity | ExperienceOrb, eyeY: number, bb: AABB) => {
      const dist = Math.sqrt((t.x - x) ** 2 + (t.y - y) ** 2 + (t.z - z) ** 2) / f2;
      if (dist > 1) return;
      let ex = t.x - x, ey = eyeY - y, ez = t.z - z;
      const d13 = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (d13 === 0) return;
      ex /= d13;
      ey /= d13;
      ez /= d13;
      const seen = this.seenPercent(x, y, z, bb);
      const d10 = (1 - dist) * seen;
      const dmg = Math.floor(((d10 * d10 + d10) / 2) * 7 * f2 + 1);
      const src: DamageSource = { id: source ? 'explosion.player' : 'explosion', explosion: true, scalesWithDifficulty: true, entity: source ? { name: this.displayName(source), player: false } : undefined };
      if (t instanceof ItemEntity || t instanceof ExperienceOrb) {
        if (dmg >= 5) t.removed = true;
        else {
          t.vx += ex * d10;
          t.vy += ey * d10;
          t.vz += ez * d10;
        }
        return;
      }
      if (isMob(t)) {
        if (t === source) return;
        t.hurt(src, dmg, source);
        t.vx += ex * d10;
        t.vy += ey * d10;
        t.vz += ez * d10;
        t.velocityDirty = true;
      } else {
        const p = t as ServerPlayer;
        if (p.gameMode === 3) return;
        s.survival.hurt(p, src, dmg);
        if (!(p.gameMode === 1 && p.flying)) {
          p.vx += ex * d10;
          p.vy += ey * d10;
          p.vz += ez * d10;
          p.knockbackDirty = true;
        }
      }
    };
    for (const p of s.players) if (!p.living.dead) hitEntity(p, p.y + targetEye(p), AABB.ofSize(p.x, p.y, p.z, 0.6, 1.8));
    for (const e of [...s.entities.values()]) {
      if (e.removed) continue;
      if (Math.abs(e.x - x) > f2 + 1 || Math.abs(e.z - z) > f2 + 1 || Math.abs(e.y - y) > f2 + 1) continue;
      if (e instanceof Mob) {
        if (!e.dead) hitEntity(e, e.y + e.eyeHeight, e.bb());
      } else if (e instanceof ItemEntity || e instanceof ExperienceOrb) hitEntity(e, e.y + e.height * 0.85, e.bb());
    }
    // finalizeExplosion: sound, particles, blocks (each drop survives with chance 1/radius)
    s.playSound(null, 'entity.generic.explode', 'block', x, y, z, 4, (1 + (r.nextFloat() - r.nextFloat()) * 0.2) * 0.7);
    for (const o of s.players) {
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.viewDistance * 16) ** 2) s.send(o, { t: 'explode', x, y, z, power: radius, destroy });
    }
    if (!destroy) return;
    const list = [...toBlow.values()];
    for (let i = list.length - 1; i > 0; i--) {
      const j = r.nextInt(i + 1);
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    for (const [bx, by, bz] of list) {
      const st = w.getState(bx, by, bz);
      if (st === 0) continue;
      const name = blockNameOf(st);
      if (name === 'tnt') {
        // primed TNT entities arrive with redstone; the block just goes
      }
      const drops = blockDrops(st, { silkTouch: false, canHarvest: true, random: () => r.nextFloat() });
      s.setBlock(bx, by, bz, 0);
      for (const it of drops) if (r.nextFloat() < 1 / radius) s.popResource(bx, by, bz, it);
    }
    for (const [bx, by, bz] of list) s.updateNeighbors(bx, by, bz);
  }

  /** Explosion.getSeenPercent: fraction of sample points of the box with a clear line to the centre. */
  seenPercent(x: number, y: number, z: number, bb: AABB): number {
    const w = this.s.world;
    const d0 = 1 / ((bb.maxX - bb.minX) * 2 + 1), d1 = 1 / ((bb.maxY - bb.minY) * 2 + 1), d2 = 1 / ((bb.maxZ - bb.minZ) * 2 + 1);
    const d3 = (1 - Math.floor(1 / d0) * d0) / 2, d4 = (1 - Math.floor(1 / d2) * d2) / 2;
    let i = 0, j = 0;
    for (let k = 0; k <= 1; k += d0)
      for (let l = 0; l <= 1; l += d1)
        for (let m = 0; m <= 1; m += d2) {
          const sx = bb.minX + (bb.maxX - bb.minX) * k + d3, sy = bb.minY + (bb.maxY - bb.minY) * l, sz = bb.minZ + (bb.maxZ - bb.minZ) * m + d4;
          const dx = x - sx, dy = y - sy, dz = z - sz;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (len < 1e-9 || raycastBlocks(w, sx, sy, sz, dx, dy, dz, len, false, undefined, collisionBoxes) === null) i++;
          j++;
        }
    return i / j;
  }

  // ------------------------------------------------------------------ network
  /** Packets that follow addEntity for a mob. */
  onStartTracking(p: ServerPlayer, e: ServerEntity): void {
    if (!(e instanceof Mob)) return;
    const s = this.s;
    s.send(p, { t: 'mobData', id: e.id, flags: e.mobFlags(), variant: e.variant() });
    s.send(p, { t: 'entityMove', id: e.id, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, headYaw: e.yHeadRot, onGround: e.onGround });
    if (e.isOnFire()) s.send(p, { t: 'entityState', id: e.id, flags: 1, pose: 'standing', frozen: 0 });
    if (e.mainHand) s.send(p, { t: 'equipment', id: e.id, mainHand: e.mainHand.id, offHand: 0 });
  }

  /** Per-tick mob state broadcast (ServerEntity.sendChanges). */
  sync(): void {
    const s = this.s;
    for (const m of this.mobs()) {
      const flags = m.mobFlags(), variant = m.variant();
      if (m.flagsDirty || flags !== m.sentFlags || variant !== m.sentVariant) {
        m.flagsDirty = false;
        m.sentFlags = flags;
        m.sentVariant = variant;
        m.broadcast({ t: 'mobData', id: m.id, flags, variant });
      }
      const fire = m.isOnFire();
      if (fire !== m.sentOnFire) {
        m.sentOnFire = fire;
        m.broadcast({ t: 'entityState', id: m.id, flags: fire ? 1 : 0, pose: m.dead ? 'dying' : 'standing', frozen: 0 });
      }
      const main = m.mainHand?.id ?? 0;
      if (main !== m.sentMainHand) {
        m.sentMainHand = main;
        m.broadcast({ t: 'equipment', id: m.id, mainHand: main, offHand: 0 });
      }
      if (m.x !== m.sentX || m.y !== m.sentY || m.z !== m.sentZ || m.yaw !== m.sentYaw || m.yHeadRot !== m.sentHeadYaw || m.pitch !== m.sentPitch) {
        m.sentX = m.x;
        m.sentY = m.y;
        m.sentZ = m.z;
        m.sentYaw = m.yaw;
        m.sentHeadYaw = m.yHeadRot;
        m.sentPitch = m.pitch;
        m.broadcast({ t: 'entityMove', id: m.id, x: m.x, y: m.y, z: m.z, yaw: m.yBodyRot, pitch: m.pitch, headYaw: m.yHeadRot, onGround: m.onGround });
      }
      if (m.velocityDirty) {
        m.velocityDirty = false;
        m.broadcast({ t: 'entityMotion', id: m.id, vx: m.vx, vy: m.vy, vz: m.vz });
      }
    }
    void s;
  }
}

/** BlockBehaviour.isValidSpawn for ordinary mobs: a sturdy top face, not glass/leaves/ice/bedrock/barrier, light < 14. */
export function isValidSpawnOn(state: number): boolean {
  if (state === 0) return false;
  const n = blockNameOf(state);
  if (n === 'bedrock' || n === 'barrier' || n.endsWith('glass') || n.endsWith('_leaves') || n === 'ice' || n === 'packed_ice' || n === 'magma_block' || n === 'soul_sand' && false) return false;
  if (LIGHT_EMIT[state]! >= 14) return false;
  // isFaceSturdy(UP): a collision box covering the whole top face
  return collisionBoxes(state).some((b) => b[4] >= 1 && b[0] <= 0 && b[2] <= 0 && b[3] >= 1 && b[5] >= 1);
}

/** NaturalSpawner.isValidEmptySpawnBlock */
export function isValidEmptySpawnBlock(state: number): boolean {
  if (FULL_COLLISION[state]) return false;
  if (FLUID[state]) return false;
  const n = blockNameOf(state);
  if (n.endsWith('rail') || n === 'redstone_block' || n === 'lever' || n.endsWith('_button') || n === 'redstone_torch' || n.endsWith('pressure_plate')) return false;
  if (n === 'fire' || n === 'soul_fire' || n === 'lava' || n === 'magma_block' || n === 'wither_rose' || n === 'sweet_berry_bush' || n === 'cactus' || n === 'powder_snow') return false;
  if ((n === 'campfire' || n === 'soul_campfire') && getProp(state, 'lit') === true) return false;
  return true;
}

function itemIdOf(name: string): number {
  for (const it of ITEMS_BY_ID) if (it?.name === name) return it.id;
  return 0;
}

/** /summon <mob> [pos] [nbt]: the common entity NBT tags (IsBaby, Age, Size, Color, Sheared, powered, Saddle, PersistenceRequired). */
for (const type of Object.keys(MOB_TYPES)) {
  commandHooks.summon.set(type, (server, x, y, z, nbt) => {
    const m = server.mobs.spawn(type, x, y, z, 'command');
    if (!m || !nbt) return m;
    const num = (tag: string): number | null => {
      const r = new RegExp(`\\b${tag}\\s*:\\s*(-?\\d+)`).exec(nbt);
      return r ? Number(r[1]) : null;
    };
    const baby = num('IsBaby'), age = num('Age'), size = num('Size'), color = num('Color'), sheared = num('Sheared'), powered = num('powered'), saddle = num('Saddle'), persist = num('PersistenceRequired');
    if (m instanceof Zombie && baby !== null) m.baby = baby !== 0;
    if (m instanceof Animal && age !== null) m.setAge(age);
    if (m instanceof Slime && size !== null) m.setSize(Math.max(1, size + 1));
    if (m instanceof Sheep) {
      if (color !== null) m.color = color & 15;
      if (sheared !== null) m.sheared = sheared !== 0;
    }
    if (m instanceof Creeper && powered !== null) m.powered = powered !== 0;
    if (m instanceof Pig && saddle !== null) m.saddled = saddle !== 0;
    if (persist !== null) m.persistenceRequired = persist !== 0;
    m.flagsDirty = true;
    return m;
  });
}
