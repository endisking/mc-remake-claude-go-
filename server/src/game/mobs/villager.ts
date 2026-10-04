/**
 * Villagers and wandering traders (vanilla Villager / WanderingTrader / AbstractVillager, 1.17.1).
 *
 * Villagers claim job sites (POI search) and take that profession, level up novice → master from
 * trading xp (10/70/150/250), get 2 new offers per level from VillagerTrades, restock at their job
 * site up to twice a day, follow the default schedule (work 2000, meet 9000, rest 12000; babies
 * play), sleep in a claimed bed, gather at a bell, panic from zombies and illagers, summon iron
 * golems when enough of them panic or gossip without a golem nearby, pick up food and breed when
 * willing (12 food points) with a free bed nearby. Zombies convert killed villagers on normal
 * (50%) and hard (100%); cured zombie villagers turn back with their trades.
 */
import { blockNameOf, getProp } from '@shared/world/blockstate';
import { FULL_COLLISION } from '@shared/world/blockinfo';
import { itemName, stack, type ItemStack } from '@shared/item/stack';
import { Difficulty } from '@shared/game/food';
import {
  JOB_SITES, offersForLevel, pickOffers, WANDERING_TRADES, canLevelUp, maxXp, isOutOfStock, updateDemand, resetUses, takeOffer, costA, tradeXpReward,
  type MerchantOffer, type Profession,
} from '@shared/game/trades';
import { ItemEntity } from '../entity';
import type { ServerPlayer } from '../player';
import type { DamageSource } from '../survival';
import { Goal, Flag } from './goal';
import { Mob, isMob, type MobCategory, type Target } from './mob';
import { Animal } from './animals';
import { FloatGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, defaultRandomPos, landRandomPos } from './goals';
import { ENTITY_EVENT } from '@shared/entity/mobdata';
import type { GameServer } from '../server';

/** VillagerHostilesSensor.ACCEPTABLE_DISTANCE_FROM_HOSTILES (1.17.1) */
export const HOSTILE_DISTANCE: Record<string, number> = {
  drowned: 8, evoker: 12, husk: 8, illusioner: 12, pillager: 15, ravager: 12, vex: 8, vindicator: 10, zoglin: 10, zombie: 8, zombie_villager: 8,
};

/** Villager.FOOD_POINTS */
export const FOOD_POINTS: Record<string, number> = { bread: 4, potato: 1, carrot: 1, beetroot: 1 };
/** Villager.WANTED_ITEMS (plus the farmer's seeds) */
const WANTED = new Set(['bread', 'potato', 'carrot', 'beetroot', 'wheat', 'wheat_seeds', 'beetroot_seeds']);

export type Activity = 'idle' | 'work' | 'meet' | 'rest' | 'play';

/** Schedule.VILLAGER_DEFAULT / VILLAGER_BABY */
export function scheduleActivity(dayTime: number, baby: boolean): Activity {
  const t = ((dayTime % 24000) + 24000) % 24000;
  if (baby) {
    if (t < 10 || t >= 12000) return 'rest';
    if (t < 3000) return 'idle';
    if (t < 6000) return 'play';
    if (t < 10000) return 'idle';
    return 'play';
  }
  if (t < 10 || t >= 12000) return 'rest';
  if (t < 2000) return 'idle';
  if (t < 9000) return 'work';
  if (t < 11000) return 'meet';
  return 'idle';
}

// ---------------------------------------------------------------- POI claims
type Pos = [number, number, number];
const claims = new WeakMap<GameServer, Map<string, number>>();
const key = (p: Pos) => `${p[0]},${p[1]},${p[2]}`;
function claimMap(s: GameServer): Map<string, number> {
  let m = claims.get(s);
  if (!m) claims.set(s, (m = new Map()));
  return m;
}
function claim(s: GameServer, p: Pos, id: number): void {
  claimMap(s).set(key(p), id);
}
function release(s: GameServer, p: Pos | null, id: number): void {
  if (!p) return;
  const m = claimMap(s), k = key(p);
  if (m.get(k) === id) m.delete(k);
}
function claimedByOther(s: GameServer, p: Pos, id: number): boolean {
  const o = claimMap(s).get(key(p));
  if (o === undefined || o === id) return false;
  const e = s.entities.get(o);
  if (!e || e.removed || (isMob(e) && e.dead)) {
    claimMap(s).delete(key(p));
    return false;
  }
  return true;
}

/** PoiManager.findClosest within ±rh horizontally and ±rv vertically. */
export function findPoi(m: Mob, rh: number, rv: number, pred: (name: string, x: number, y: number, z: number) => boolean): Pos | null {
  const w = m.world;
  const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
  let best: Pos | null = null, bd = Infinity;
  for (let dy = -rv; dy <= rv; dy++) {
    const y = by + dy;
    if (y < 0 || y > 255) continue;
    for (let dx = -rh; dx <= rh; dx++)
      for (let dz = -rh; dz <= rh; dz++) {
        const st = w.getState(bx + dx, y, bz + dz);
        if (st === 0) continue;
        const d = dx * dx + dy * dy + dz * dz;
        if (d >= bd) continue;
        if (pred(blockNameOf(st), bx + dx, y, bz + dz)) {
          bd = d;
          best = [bx + dx, y, bz + dz];
        }
      }
  }
  return best;
}

const isBedHead = (m: Mob, name: string, x: number, y: number, z: number) => name.endsWith('_bed') && getProp(m.world.getState(x, y, z), 'part') === 'head';

// ---------------------------------------------------------------- merchant base
export abstract class AbstractVillager extends Animal {
  override readonly category: MobCategory = 'misc';
  readonly adultWidth = 0.6;
  readonly adultHeight = 1.95;
  readonly food = new Set<string>();
  readonly maxHealth = 20;
  override movementSpeed = 0.5;
  override followRange = 48;
  offers: MerchantOffer[] = [];
  tradingPlayer: ServerPlayer | null = null;
  inventory: ItemStack[] = [];
  /** ticks shaking the head after a refused interaction */
  unhappyCounter = 0;

  override get eyeHeight(): number {
    return this.isBaby() ? 0.81 : 1.62;
  }
  override experienceReward(): number {
    return 0;
  }
  override finalizeSpawn(): void {}
  override shouldDespawnInPeaceful(): boolean {
    return false;
  }
  /** AbstractVillager.setUnhappy: head shake + "no" sound */
  setUnhappy(): void {
    this.unhappyCounter = 40;
    this.playSound(this.isBaby() || this.type === 'wandering_trader' ? (this.type === 'wandering_trader' ? 'entity.wandering_trader.no' : 'entity.villager.no') : 'entity.villager.no', 1, this.voicePitch());
  }
  protected override aiStep(): void {
    if (this.unhappyCounter > 0) this.unhappyCounter--;
    if (this.tradingPlayer && (this.tradingPlayer.living.dead || this.distanceToTargetSqr(this.tradingPlayer) > 64 || this.dead)) this.stopTrading();
    super.aiStep();
  }
  startTrading(p: ServerPlayer): void {
    this.tradingPlayer = p;
    this.navigation.stop();
    this.s.mobs.openMerchant?.(p, this);
  }
  stopTrading(): void {
    this.tradingPlayer = null;
  }
  /** a trade was completed (MerchantMenu result taken): uses, xp, sounds */
  notifyTrade(o: MerchantOffer, p: ServerPlayer | null): void {
    o.uses++;
    this.ambientSoundTime = -this.ambientSoundInterval();
    this.rewardTradeXp(o, p);
    this.playSound(this.type === 'wandering_trader' ? 'entity.wandering_trader.yes' : 'entity.villager.yes', 1, this.voicePitch());
  }
  protected rewardTradeXp(o: MerchantOffer, _p: ServerPlayer | null): void {
    if (o.rewardExp) this.s.spawnExperience(this.x, this.y + 0.5, this.z, 3 + this.rng.nextInt(4));
  }
  /**
   * One trade from payment stacks (used by the merchant menu and tests): consumes the payment and
   * returns the result, or null when the offer can't be taken.
   */
  trade(index: number, a: ItemStack, b: ItemStack | null, p: ServerPlayer | null): ItemStack | null {
    const o = this.offers[index];
    if (!o || isOutOfStock(o)) return null;
    const before = o.uses;
    if (!takeOffer(o, a, b)) return null;
    o.uses = before;
    this.notifyTrade(o, p);
    return structuredClone(o.result);
  }
  /** pick up wanted items lying within reach (Mob.aiStep pickUpItem, every tick in vanilla) */
  protected pickUpItems(): void {
    if (this.isBaby() || !this.s.mobs.mobGriefing) return;
    const bb = this.bb().inflate(1, 0.5, 1);
    for (const e of this.s.entities.values()) {
      if (!(e instanceof ItemEntity) || e.removed || !e.bb().intersects(bb)) continue;
      const st = e.stack;
      const n = itemName(st.id);
      if (!this.wantsItem(n)) continue;
      const left = this.addToInventory(st);
      if (left <= 0) e.removed = true;
      else st.count = left;
    }
  }
  wantsItem(n: string): boolean {
    return WANTED.has(n);
  }
  /** SimpleContainer(8).addItem: returns what didn't fit */
  addToInventory(st: ItemStack): number {
    let n = st.count;
    for (const s of this.inventory) if (s.id === st.id && s.count < 64) {
      const k = Math.min(64 - s.count, n);
      s.count += k;
      n -= k;
    }
    while (n > 0 && this.inventory.length < 8) {
      const k = Math.min(64, n);
      this.inventory.push({ id: st.id, count: k, damage: 0 });
      n -= k;
    }
    return n;
  }
  countFood(): number {
    let n = 0;
    for (const s of this.inventory) n += (FOOD_POINTS[itemName(s.id)] ?? 0) * s.count;
    return n;
  }
}

// ---------------------------------------------------------------- goals
/** Panic package: flee from hurt sources and nearby hostiles at walk speed × 1.5. */
class VillagerPanicGoal extends Goal {
  constructor(private readonly v: Villager) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    return this.v.isPanicking();
  }
  override canContinueToUse(): boolean {
    return this.v.isPanicking();
  }
  override start(): void {
    this.v.sleeping = false;
  }
  override tick(): void {
    const v = this.v;
    if (!v.navigation.isDone()) return;
    const from = v.nearestHostile ?? v.lastHurtByMob;
    const pos = from ? landRandomPos(v, 10, 7, [from.x, from.y, from.z], true) : defaultRandomPos(v, 5, 4);
    if (pos) v.navigation.moveTo(pos[0], pos[1], pos[2], 0.75);
  }
}

/** Walk to a POI (job site, bed, bell) during an activity; `arrive` runs once within reach. */
class GoToPoiGoal extends Goal {
  private recalc = 0;
  constructor(private readonly v: Villager, private readonly activity: Activity | ((a: Activity) => boolean), private readonly target: () => Pos | null, private readonly reach: number, private readonly arrive: (p: Pos) => void, private readonly speed = 0.5) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const a = this.v.activity();
    const ok = typeof this.activity === 'function' ? this.activity(a) : a === this.activity;
    return ok && !this.v.isPanicking() && this.target() !== null && this.v.tradingPlayer === null;
  }
  override canContinueToUse(): boolean {
    return this.canUse();
  }
  override start(): void {
    this.recalc = 0;
  }
  override stop(): void {
    this.v.navigation.stop();
  }
  override tick(): void {
    const v = this.v, p = this.target()!;
    const d2 = v.distanceToSqr(p[0] + 0.5, p[1], p[2] + 0.5);
    if (d2 <= this.reach * this.reach) {
      v.navigation.stop();
      v.lookControl.setLookAt(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, 10, 40);
      this.arrive(p);
      return;
    }
    if (--this.recalc <= 0) {
      this.recalc = 40 + v.rng.nextInt(40);
      v.navigation.moveTo(p[0], p[1], p[2], this.speed);
    }
  }
}

/** VillagerMakeLove: two willing adults with a free bed nearby walk together and make a baby. */
class VillagerBreedGoal extends Goal {
  private partner: Villager | null = null;
  private time = 0;
  constructor(private readonly v: Villager) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const v = this.v;
    if (!v.canBreed() || v.rng.nextInt(20) !== 0) return false;
    this.partner = null;
    for (const m of v.s.mobs.nearbyMobs(v.x, v.z, 8)) if (m instanceof Villager && m !== v && m.canBreed() && v.distanceToTargetSqr(m) < 64) {
      this.partner = m;
      break;
    }
    return this.partner !== null && v.freeBedNearby() !== null;
  }
  override canContinueToUse(): boolean {
    const p = this.partner;
    return !!p && !p.dead && this.time < 275 && this.v.canBreed() && p.canBreed();
  }
  override start(): void {
    this.time = 0;
  }
  override stop(): void {
    this.partner = null;
  }
  override tick(): void {
    const v = this.v, p = this.partner!;
    v.lookControl.setLookAt(p.x, p.y + p.eyeHeight, p.z, 10, 40);
    if (v.distanceToTargetSqr(p) > 2.25) v.navigation.moveToEntity(p, 0.5);
    else {
      v.navigation.stop();
      if (++this.time === 60 && v.id < p.id) v.breedWithVillager(p);
    }
  }
}

/** TradeWithPlayer: stand still and look at the trading player. */
class TradeWithPlayerGoal extends Goal {
  constructor(private readonly v: AbstractVillager) {
    super();
    this.flags = Flag.MOVE | Flag.JUMP | Flag.LOOK;
  }
  canUse(): boolean {
    return this.v.tradingPlayer !== null && this.v.onGround;
  }
  override start(): void {
    this.v.navigation.stop();
  }
  override tick(): void {
    const p = this.v.tradingPlayer;
    if (p) this.v.lookControl.setLookAt(p.x, p.y + 1.62, p.z, 10, 40);
  }
}

class SleepGoal extends Goal {
  constructor(private readonly v: Villager) {
    super();
    this.flags = Flag.MOVE | Flag.JUMP | Flag.LOOK;
  }
  canUse(): boolean {
    return this.v.sleeping;
  }
  override tick(): void {
    this.v.navigation.stop();
  }
  override stop(): void {
    this.v.sleeping = false;
  }
}

// ---------------------------------------------------------------- villager
export class Villager extends AbstractVillager {
  readonly type: string = 'villager';
  profession: Profession = 'none';
  level = 1;
  xp = 0;
  /** villager type (biome): plains, desert, jungle, savanna, snow, swamp, taiga */
  villagerType = 'plains';
  jobSite: Pos | null = null;
  home: Pos | null = null;
  meetingPoint: Pos | null = null;
  sleeping = false;
  lastSlept = -1;
  /** GOLEM_DETECTED_RECENTLY expiry */
  golemDetectedUntil = -1;
  nearestHostile: Mob | null = null;
  numberOfRestocksToday = 0;
  lastRestockGameTime = 0;
  lastRestockCheckDay = -1;
  /** ticks until a pending level-up (updateMerchantTimer) */
  levelUpTimer = 0;
  private poiCooldown = 0;

  protected registerGoals(): void {
    this.goalSelector.add(0, new FloatGoal(this));
    this.goalSelector.add(1, new VillagerPanicGoal(this));
    this.goalSelector.add(1, new TradeWithPlayerGoal(this));
    this.goalSelector.add(2, new SleepGoal(this));
    this.goalSelector.add(3, new GoToPoiGoal(this, 'rest', () => this.home, 1.5, () => this.startSleeping()));
    this.goalSelector.add(3, new GoToPoiGoal(this, 'work', () => this.jobSite, 1.73, () => this.workAtPoi()));
    this.goalSelector.add(3, new GoToPoiGoal(this, 'meet', () => this.meetingPoint, 4, () => {}));
    this.goalSelector.add(4, new VillagerBreedGoal(this));
    this.goalSelector.add(2, new GoToPoiGoal(this, (a) => a !== 'rest', () => (this.profession === 'none' && !this.isBaby() ? this.jobSite : null), 2, (p) => this.takeJob(p)));
    this.goalSelector.add(6, new RandomStrollGoal(this, 0.5));
    this.goalSelector.add(7, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(8, new RandomLookAroundGoal(this));
  }

  activity(): Activity {
    if (this.isPanicking()) return 'idle';
    return scheduleActivity(this.s.dayTime, this.isBaby());
  }

  isPanicking(): boolean {
    return !!this.nearestHostile || (!!this.lastHurtByMob && this.tickCount - this.lastHurtByMobTimestamp < 100);
  }

  /** VillagerHostilesSensor: closest hostile within its acceptable distance */
  private sense(): void {
    let best: Mob | null = null, bd = Infinity;
    for (const m of this.s.mobs.nearbyMobs(this.x, this.z, 15)) {
      const r = HOSTILE_DISTANCE[m.type];
      if (!r || m.dead) continue;
      const d = this.distanceToTargetSqr(m);
      if (d <= r * r && d < bd) {
        bd = d;
        best = m;
      }
    }
    this.nearestHostile = best;
    // GolemSensor (every 200 ticks in vanilla): an iron golem within 16 blocks
    if (this.tickCount % 200 === 0 && this.s.mobs.nearbyMobs(this.x, this.z, 16).some((m) => m.type === 'iron_golem' && !m.dead && this.distanceToTargetSqr(m) < 256)) {
      this.golemDetectedUntil = this.s.gameTime + 600;
    }
  }

  setProfession(p: Profession): void {
    if (p === this.profession) return;
    this.profession = p;
    this.stateDirty = true;
    this.flagsDirty = true;
  }

  /** AssignProfessionFromJobSite */
  takeJob(p: Pos): void {
    const n = blockNameOf(this.world.getState(p[0], p[1], p[2]));
    const prof = JOB_SITES[n];
    if (!prof) {
      release(this.s, this.jobSite, this.id);
      this.jobSite = null;
      return;
    }
    this.setProfession(prof);
    if (this.offers.length === 0) this.offers = offersForLevel(prof, this.level, this.rng);
    this.playSound(`entity.villager.work_${prof}`, 1, 1);
  }

  /** WorkAtPoi: work sound, restock when allowed */
  workAtPoi(): void {
    if (this.profession === 'none' || this.profession === 'nitwit') return;
    if (this.s.gameTime % 300 !== this.id % 300) return;
    this.playSound(`entity.villager.work_${this.profession}`, 1, 1);
    if (this.allowedToRestock() && this.shouldRestock()) this.restock();
  }

  shouldRestock(): boolean {
    return this.offers.some((o) => o.uses > 0);
  }

  allowedToRestock(): boolean {
    return this.numberOfRestocksToday === 0 || (this.numberOfRestocksToday < 2 && this.s.gameTime > this.lastRestockGameTime + 2400);
  }

  /** Villager.restock: demand update + reset uses */
  restock(): void {
    for (const o of this.offers) {
      updateDemand(o);
      resetUses(o);
    }
    this.lastRestockGameTime = this.s.gameTime;
    this.numberOfRestocksToday++;
  }

  private catchUpDay(): void {
    const day = Math.floor(this.s.dayTime / 24000);
    if (day !== this.lastRestockCheckDay) {
      this.lastRestockCheckDay = day;
      this.numberOfRestocksToday = 0;
    }
  }

  startSleeping(): void {
    if (!this.home || this.sleeping) return;
    const h = this.home;
    if (!blockNameOf(this.world.getState(h[0], h[1], h[2])).endsWith('_bed')) {
      release(this.s, h, this.id);
      this.home = null;
      return;
    }
    this.sleeping = true;
    this.lastSlept = this.s.gameTime;
    this.x = h[0] + 0.5;
    this.y = h[1] + 0.6875;
    this.z = h[2] + 0.5;
    this.vx = this.vy = this.vz = 0;
  }

  /** POI acquisition: job site (unemployed), bed and bell, rescanned every 5–10 s */
  private acquirePois(): void {
    if (--this.poiCooldown > 0) return;
    this.poiCooldown = 100 + this.rng.nextInt(100);
    const s = this.s;
    const valid = (p: Pos | null, test: (n: string) => boolean) => !!p && test(blockNameOf(this.world.getState(p[0], p[1], p[2])));
    // lost job site
    if (this.jobSite && !valid(this.jobSite, (n) => JOB_SITES[n] !== undefined && (this.profession === 'none' || JOB_SITES[n] === this.profession))) {
      release(s, this.jobSite, this.id);
      this.jobSite = null;
    }
    // ResetProfession: a novice that never traded loses its profession with its job site
    if (!this.jobSite && this.profession !== 'none' && this.profession !== 'nitwit' && this.xp === 0 && this.level <= 1) {
      this.setProfession('none');
      this.offers = [];
    }
    if (!this.jobSite && this.profession !== 'nitwit' && !this.isBaby()) {
      const want = this.profession;
      const p = findPoi(this, 16, 6, (n, x, y, z) => {
        const pr = JOB_SITES[n];
        return pr !== undefined && (want === 'none' || pr === want) && !claimedByOther(s, [x, y, z], this.id);
      });
      if (p) {
        this.jobSite = p;
        claim(s, p, this.id);
      }
    }
    if (this.home && !valid(this.home, (n) => n.endsWith('_bed'))) {
      release(s, this.home, this.id);
      this.home = null;
    }
    if (!this.home) {
      const p = findPoi(this, 16, 6, (n, x, y, z) => isBedHead(this, n, x, y, z) && !claimedByOther(s, [x, y, z], this.id));
      if (p) {
        this.home = p;
        claim(s, p, this.id);
      }
    }
    if (!this.meetingPoint || !valid(this.meetingPoint, (n) => n === 'bell')) this.meetingPoint = findPoi(this, 16, 6, (n) => n === 'bell');
  }

  freeBedNearby(): Pos | null {
    return findPoi(this, 16, 6, (n, x, y, z) => isBedHead(this, n, x, y, z) && !claimMap(this.s).has(key([x, y, z])));
  }

  canBreed(): boolean {
    return !this.isBaby() && this.ageTicks === 0 && !this.sleeping && this.countFood() >= 12;
  }

  /** eat 12 food points (Villager.eatAndDigestFood) */
  private eatFood(): void {
    let need = 12;
    for (const s of this.inventory) {
      const v = FOOD_POINTS[itemName(s.id)] ?? 0;
      while (v > 0 && need > 0 && s.count > 0) {
        s.count--;
        need -= v;
      }
    }
    this.inventory = this.inventory.filter((s) => s.count > 0);
  }

  breedWithVillager(p: Villager): void {
    if (!this.freeBedNearby()) return;
    const baby = this.s.mobs.spawn('villager', this.x, this.y, this.z, 'breeding') as Villager | null;
    if (!baby) return;
    baby.setAge(-24000);
    baby.villagerType = this.rng.nextBoolean() ? this.villagerType : p.villagerType;
    this.eatFood();
    p.eatFood();
    this.setAge(6000);
    p.setAge(6000);
    this.entityEvent(ENTITY_EVENT.IN_LOVE_HEARTS);
    p.entityEvent(ENTITY_EVENT.IN_LOVE_HEARTS);
  }

  /** Villager.spawnGolemIfNeeded */
  wantsToSpawnGolem(): boolean {
    return this.lastSlept >= 0 && this.s.gameTime - this.lastSlept < 24000 && this.s.gameTime >= this.golemDetectedUntil;
  }

  spawnGolemIfNeeded(minVillagers: number): void {
    if (!this.wantsToSpawnGolem()) return;
    const list = this.s.mobs.nearbyMobs(this.x, this.z, 10).filter((m) => m instanceof Villager && Math.abs(m.y - this.y) <= 10 && m.wantsToSpawnGolem()) as Villager[];
    if (list.length < minVillagers) return;
    if (trySpawnIronGolem(this)) for (const v of list) v.golemDetectedUntil = this.s.gameTime + 600;
  }

  protected override customServerAiStep(): void {
    this.catchUpDay();
    this.sense();
    this.acquirePois();
    if (this.sleeping && (this.activity() !== 'rest' || this.isPanicking())) this.sleeping = false;
    if (this.tickCount % 10 === 0) this.pickUpItems();
    if (this.levelUpTimer > 0 && --this.levelUpTimer === 0) this.increaseMerchantCareer();
    // the farmer bakes bread from wheat (Villager.eatAndDigestFood / wheat→bread)
    if (this.profession === 'farmer' && this.tickCount % 100 === 0) this.bakeBread();
    if (this.s.gameTime % 100 === 0) {
      if (this.isPanicking()) this.spawnGolemIfNeeded(3);
      else if (this.activity() === 'meet' && this.meetingPoint && this.distanceToSqr(this.meetingPoint[0], this.meetingPoint[1], this.meetingPoint[2]) < 100) this.spawnGolemIfNeeded(5);
    }
  }

  private bakeBread(): void {
    const w = this.inventory.find((s) => itemName(s.id) === 'wheat' && s.count >= 3);
    if (!w) return;
    const n = Math.floor(w.count / 3);
    w.count -= n * 3;
    this.inventory = this.inventory.filter((s) => s.count > 0);
    this.addToInventory(stack('bread', n));
  }

  /** Villager.mobInteract: open trading (adults with offers) or shake the head */
  override interact(p: ServerPlayer, hand: number): boolean {
    if (this.dead || this.tradingPlayer || this.sleeping) return false;
    const held = p.inventory.get(hand === 1 ? 40 : p.inventory.selected);
    if (held && itemName(held.id) === 'villager_spawn_egg') return false;
    if (this.isBaby()) {
      this.setUnhappy();
      return true;
    }
    if (this.offers.length === 0) {
      if (hand === 0) this.setUnhappy();
      return true;
    }
    this.startTrading(p);
    return true;
  }

  protected override rewardTradeXp(o: MerchantOffer, _p: ServerPlayer | null): void {
    this.xp += o.xp;
    let up = false;
    if (canLevelUp(this.level) && this.xp >= maxXp(this.level) && this.levelUpTimer === 0) {
      this.levelUpTimer = 40;
      up = true;
    }
    if (o.rewardExp) this.s.spawnExperience(this.x, this.y + 0.5, this.z, tradeXpReward(this.rng, up));
  }

  /** Villager.increaseMerchantCareer: next level, 2 new offers */
  increaseMerchantCareer(): void {
    if (!canLevelUp(this.level)) return;
    this.level++;
    this.offers.push(...offersForLevel(this.profession, this.level, this.rng));
    this.stateDirty = true;
  }

  override die(src: DamageSource, attacker: Target | null): void {
    // Zombie.killed: normal 50 %, hard 100 % → zombie villager keeping profession and trades
    const d = this.s.difficulty;
    if (attacker && isMob(attacker) && /zombie|husk|drowned/.test(attacker.type) && (d === Difficulty.Hard || (d === Difficulty.Normal && this.rng.nextBoolean()))) {
      const z = this.s.mobs.spawn('zombie_villager', this.x, this.y, this.z, 'conversion') as (Mob & { villagerData?: VillagerData; baby?: boolean }) | null;
      if (z) {
        z.yaw = this.yaw;
        z.villagerData = this.saveData();
        if ('baby' in z) z.baby = this.isBaby();
        z.persistenceRequired = true;
        z.flagsDirty = true;
        this.playSound('entity.zombie_villager.converted', 1, 1);
        this.releaseAll();
        this.removed = true;
        this.dead = true;
        return;
      }
    }
    this.releaseAll();
    super.die(src, attacker);
  }

  releaseAll(): void {
    release(this.s, this.jobSite, this.id);
    release(this.s, this.home, this.id);
  }

  override saveExtra(): Record<string, unknown> {
    return { ...this.saveData(), jobSite: this.jobSite, home: this.home, lastSlept: this.lastSlept, inventory: this.inventory, restocks: this.numberOfRestocksToday, lastRestock: this.lastRestockGameTime };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.applyData(o as unknown as VillagerData);
    this.jobSite = (o.jobSite as Pos | null) ?? null;
    this.home = (o.home as Pos | null) ?? null;
    if (this.jobSite) claim(this.s, this.jobSite, this.id);
    if (this.home) claim(this.s, this.home, this.id);
    this.lastSlept = (o.lastSlept as number) ?? -1;
    this.inventory = (o.inventory as ItemStack[]) ?? [];
    this.numberOfRestocksToday = (o.restocks as number) ?? 0;
    this.lastRestockGameTime = (o.lastRestock as number) ?? 0;
  }

  saveData(): VillagerData {
    return { profession: this.profession, level: this.level, xp: this.xp, type: this.villagerType, offers: this.offers.map((o) => ({ ...o })) };
  }

  applyData(d: VillagerData): void {
    this.setProfession(d.profession);
    this.level = d.level;
    this.xp = d.xp;
    this.villagerType = d.type;
    this.offers = d.offers.map((o) => ({ ...o }));
  }

  override ambientSound(): string | null {
    if (this.sleeping) return null;
    return this.tradingPlayer ? 'entity.villager.trade' : 'entity.villager.ambient';
  }
  override hurtSound(): string {
    return 'entity.villager.hurt';
  }
  override deathSound(): string {
    return 'entity.villager.death';
  }
}

export interface VillagerData {
  profession: Profession;
  level: number;
  xp: number;
  type: string;
  offers: MerchantOffer[];
}

/** Villager.trySpawnGolem: 10 tries in a 16×6×16 box, standing on a solid block in air. */
export function trySpawnIronGolem(v: Mob): Mob | null {
  const r = v.rng;
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(v.x + r.nextDouble() * 16 - 8), z = Math.floor(v.z + r.nextDouble() * 16 - 8);
    let y = Math.floor(v.y + r.nextDouble() * 12 - 6);
    // SpawnUtil.moveToPossibleSpawnPosition: scan down 6 blocks for a surface
    for (let k = 0; k < 12; k++, y--) {
      const below = v.world.getState(x, y - 1, z), at = v.world.getState(x, y, z), above = v.world.getState(x, y + 1, z), above2 = v.world.getState(x, y + 2, z);
      const solid = (st: number) => st !== 0 && !/leaves|water|lava|glass_pane|_fence|_wall/.test(blockNameOf(st)) && FULLS(st);
      if (solid(below) && at === 0 && above === 0 && above2 === 0) {
        const g = v.s.mobs.spawn('iron_golem', x + 0.5, y, z + 0.5, 'natural');
        if (g) return g;
      }
    }
  }
  return null;
}
const FULLS = (st: number) => FULL_COLLISION[st] === 1;

// ---------------------------------------------------------------- wandering trader
/** WanderingTrader: 5 generic + 1 rare trade, despawns after 48000 ticks (40 min) unless leashed. */
export class WanderingTrader extends AbstractVillager {
  readonly type = 'wandering_trader';
  despawnDelay = 48000;
  protected registerGoals(): void {
    this.goalSelector.add(0, new FloatGoal(this));
    this.goalSelector.add(1, new TradeWithPlayerGoal(this));
    this.goalSelector.add(1, new (class extends Goal {
      constructor(private readonly t: WanderingTrader) {
        super();
        this.flags = Flag.MOVE;
      }
      canUse(): boolean {
        const t = this.t;
        if (t.lastHurtByMob && t.tickCount - t.lastHurtByMobTimestamp < 100) return true;
        return t.s.mobs.nearbyMobs(t.x, t.z, 8).some((m) => (HOSTILE_DISTANCE[m.type] ?? 0) > 0 && t.distanceToTargetSqr(m) < 64);
      }
      override tick(): void {
        const t = this.t;
        if (t.navigation.isDone()) {
          const p = defaultRandomPos(t, 10, 7);
          if (p) t.navigation.moveTo(p[0], p[1], p[2], 0.5);
        }
      }
    })(this));
    this.goalSelector.add(8, new RandomStrollGoal(this, 0.35));
    this.goalSelector.add(9, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(10, new RandomLookAroundGoal(this));
  }
  override init(): void {
    super.init();
    this.offers = [...pickOffers(WANDERING_TRADES[0]!, 5, this.rng), ...pickOffers(WANDERING_TRADES[1]!, 1, this.rng)];
    for (const o of this.offers) o.rewardExp = true;
  }
  override interact(p: ServerPlayer, hand: number): boolean {
    if (this.dead || this.tradingPlayer || this.isBaby()) return false;
    if (this.offers.length === 0) {
      if (hand === 0) this.setUnhappy();
      return true;
    }
    this.startTrading(p);
    return true;
  }
  override saveExtra(): Record<string, unknown> {
    return { offers: this.offers, despawnDelay: this.despawnDelay };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.offers = (o.offers as MerchantOffer[]) ?? this.offers;
    this.despawnDelay = (o.despawnDelay as number) ?? this.despawnDelay;
  }
  protected override customServerAiStep(): void {
    if (!this.tradingPlayer && this.despawnDelay > 0 && --this.despawnDelay === 0) this.removed = true;
  }
  override ambientSound(): string {
    return this.tradingPlayer ? 'entity.wandering_trader.trade' : 'entity.wandering_trader.ambient';
  }
  override hurtSound(): string {
    return 'entity.wandering_trader.hurt';
  }
  override deathSound(): string {
    return 'entity.wandering_trader.death';
  }
}

export { costA };
