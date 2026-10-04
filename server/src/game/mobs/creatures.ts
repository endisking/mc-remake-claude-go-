/**
 * More animals (vanilla 1.17.1): rabbits, polar bears, ocelots, cats and turtles — health,
 * speed, breeding food, taming/trusting, fleeing and the polar bear's defence of its cubs.
 * Not yet: rabbit carrot raids and killer bunny, cat gifts/creeper scaring, ocelot chicken
 * hunting, turtle egg laying and home beaches.
 */
import { itemName } from '@shared/item/stack';
import type { ServerPlayer } from '../player';
import { Goal, Flag } from './goal';
import { Mob, isMob, type Target } from './mob';
import { Animal, BreedGoal, FollowParentGoal } from './animals';
import {
  FloatGoal, PanicGoal, TemptGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, MeleeAttackGoal, HurtByTargetGoal,
  NearestMobTargetGoal, NearestAttackableTargetGoal, landRandomPos, LeapAtTargetGoal,
} from './goals';

const set = (...a: string[]) => new Set(a);

/** AvoidEntityGoal: run from the nearest matching entity within `dist` (walk/sprint speeds). */
class AvoidGoal extends Goal {
  private from: Target | null = null;
  constructor(private readonly m: Mob, private readonly dist: number, private readonly walk: number, private readonly sprint: number, private readonly pred: (t: Target) => boolean) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m;
    let best: Target | null = null, bd = this.dist * this.dist;
    for (const p of m.s.players) if (p.gameMode !== 3 && !p.living.dead && this.pred(p)) {
      const d = m.distanceToTargetSqr(p);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    for (const o of m.s.mobs.nearbyMobs(m.x, m.z, this.dist)) if (o !== m && !o.dead && this.pred(o)) {
      const d = m.distanceToTargetSqr(o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) return false;
    const pos = landRandomPos(m, 16, 7, [best.x, best.y, best.z], true);
    if (!pos || (pos[0] - best.x) ** 2 + (pos[2] - best.z) ** 2 < bd) return false;
    this.from = best;
    return m.navigation.moveTo(pos[0], pos[1], pos[2], this.walk);
  }
  override canContinueToUse(): boolean {
    return !this.m.navigation.isDone();
  }
  override tick(): void {
    const f = this.from;
    if (f) this.m.speed = this.m.movementSpeedValue() * (this.m.distanceToTargetSqr(f) < 49 ? this.sprint : this.walk);
  }
  override stop(): void {
    this.from = null;
  }
}


export class Rabbit extends Animal {
  readonly type = 'rabbit';
  readonly maxHealth = 3;
  readonly adultWidth = 0.4;
  readonly adultHeight = 0.5;
  override movementSpeed = 0.3;
  readonly food = set('carrot', 'golden_carrot', 'dandelion');
  /** RabbitType: 0 brown, 1 white, 2 black, 3 white splotched, 4 gold, 5 salt (99 = killer) */
  rabbitType = 0;
  protected registerGoals(): void {
    this.goalSelector.add(1, new FloatGoal(this));
    this.goalSelector.add(1, new PanicGoal(this, 2.2));
    this.goalSelector.add(2, new BreedGoal(this, 0.8));
    this.goalSelector.add(3, new TemptGoal(this, 1, this.food));
    this.goalSelector.add(4, new AvoidGoal(this, 8, 2.2, 2.2, (t) => !isMob(t) && t.gameMode !== 1));
    this.goalSelector.add(4, new AvoidGoal(this, 10, 2.2, 2.2, (t) => isMob(t) && (t.type === 'wolf' || t.type === 'fox')));
    this.goalSelector.add(4, new AvoidGoal(this, 4, 2.2, 2.2, (t) => isMob(t) && ENEMY_RE.test(t.type)));
    this.goalSelector.add(6, new RandomStrollGoal(this, 0.6));
    this.goalSelector.add(11, new LookAtPlayerGoal(this, 10));
  }
  override finalizeSpawn(groupIndex: number): void {
    super.finalizeSpawn(groupIndex);
    const x = Math.floor(this.x), z = Math.floor(this.z);
    const biome = this.s.world.getBiome(x, Math.floor(this.y), z);
    const name = biomeName(biome);
    // Rabbit.getRandomRabbitType: desert → gold, snowy → white / white splotched, else brown/salt/black
    if (name.includes('desert')) this.rabbitType = 4;
    else if (name.includes('snowy') || name.includes('ice')) this.rabbitType = this.rng.nextInt(100) < 80 ? 1 : 3;
    else {
      const i = this.rng.nextInt(100);
      this.rabbitType = i < 50 ? 0 : i < 90 ? 5 : 2;
    }
  }
  override variant(): number {
    return this.rabbitType;
  }
  /** rabbits jump to move (Rabbit.getJumpPower 0.5 → hops); approximated by the ground walk */
  override ambientSound(): string {
    return 'entity.rabbit.ambient';
  }
  override hurtSound(): string {
    return 'entity.rabbit.hurt';
  }
  override deathSound(): string {
    return 'entity.rabbit.death';
  }
  override saveExtra(): Record<string, unknown> {
    return { rabbitType: this.rabbitType };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.rabbitType = (o.rabbitType as number) ?? 0;
  }
  protected override inheritTo(baby: Animal, partner: Animal): void {
    if (baby instanceof Rabbit && partner instanceof Rabbit) baby.rabbitType = this.rng.nextBoolean() ? this.rabbitType : partner.rabbitType;
  }
}

const ENEMY_RE = /^(zombie|husk|drowned|skeleton|stray|creeper|spider|cave_spider|witch|pillager|vindicator|evoker)$/;
import { BIOMES } from '@shared/data';
const biomeName = (id: number) => BIOMES[id]?.name ?? '';

/** PolarBear: neutral; attacks when hurt or when a player comes near its cubs; can't be bred. */
export class PolarBear extends Animal {
  readonly type = 'polar_bear';
  readonly maxHealth = 30;
  readonly adultWidth = 1.4;
  readonly adultHeight = 1.4;
  override movementSpeed = 0.25;
  override attackDamage = 6;
  override followRange = 20;
  readonly food = new Set<string>();
  warningTicks = 0;
  protected registerGoals(): void {
    this.goalSelector.add(0, new FloatGoal(this));
    this.goalSelector.add(1, new MeleeAttackGoal(this, 1.25, true));
    this.goalSelector.add(1, new (class extends PanicGoal {
      override canUse(): boolean {
        return (this.m.isBaby() || this.m.isOnFire()) && super.canUse();
      }
    })(this, 2));
    this.goalSelector.add(4, new FollowParentGoal(this, 1.25));
    this.goalSelector.add(5, new RandomStrollGoal(this, 1));
    this.goalSelector.add(6, new LookAtPlayerGoal(this, 6));
    this.goalSelector.add(7, new RandomLookAroundGoal(this));
    this.targetSelector.add(1, new (class extends HurtByTargetGoal {
      constructor(private readonly b: PolarBear) {
        super(b);
      }
      override canUse(): boolean {
        return !this.b.isBaby() && super.canUse();
      }
    })(this));
    // PolarBearAttackPlayersGoal: adults with cubs within 8 blocks attack players
    this.targetSelector.add(2, new NearestAttackableTargetGoal(this, true, 10, () => !this.isBaby() && this.s.mobs.nearbyMobs(this.x, this.z, 8).some((m) => m instanceof PolarBear && m.isBaby())));
    this.targetSelector.add(3, new NearestMobTargetGoal(this, true, (m) => m.type === 'fox', 10));
  }
  override canMate(): boolean {
    return false;
  }
  protected override customServerAiStep(): void {
    if (this.warningTicks > 0) this.warningTicks--;
    if (this.target && this.warningTicks === 0 && this.distanceToTargetSqr(this.target) < 16) {
      this.warningTicks = 40;
      this.playSound('entity.polar_bear.warning', 1, this.voicePitch());
    }
    this.setAggressive(!!this.target);
  }
  override ambientSound(): string {
    return this.isBaby() ? 'entity.polar_bear.ambient_baby' : 'entity.polar_bear.ambient';
  }
  override hurtSound(): string {
    return 'entity.polar_bear.hurt';
  }
  override deathSound(): string {
    return 'entity.polar_bear.death';
  }
  override stepSound(): string {
    return 'entity.polar_bear.step';
  }
}

const FISH = set('cod', 'salmon');

/** Ocelot: skittish; feeding raw cod/salmon earns trust (1 in 3); trusting ocelots don't flee. */
export class Ocelot extends Animal {
  readonly type = 'ocelot';
  readonly maxHealth = 10;
  readonly adultWidth = 0.6;
  readonly adultHeight = 0.7;
  override movementSpeed = 0.3;
  override attackDamage = 3;
  readonly food = FISH;
  trusting = false;
  protected registerGoals(): void {
    this.goalSelector.add(1, new FloatGoal(this));
    this.goalSelector.add(3, new TemptGoal(this, 0.6, FISH));
    this.goalSelector.add(4, new AvoidGoal(this, 16, 0.8, 1.33, (t) => !this.trusting && !isMob(t)));
    this.goalSelector.add(7, new LeapAtTargetGoal(this, 0.3));
    this.goalSelector.add(8, new MeleeAttackGoal(this, 1, true));
    this.goalSelector.add(9, new BreedGoal(this, 0.8));
    this.goalSelector.add(10, new RandomStrollGoal(this, 0.8));
    this.goalSelector.add(11, new LookAtPlayerGoal(this, 10));
    this.targetSelector.add(1, new NearestMobTargetGoal(this, false, (m) => m.type === 'chicken', 10));
    this.targetSelector.add(1, new NearestMobTargetGoal(this, false, (m) => m.type === 'turtle' && m.isBaby(), 10));
  }
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (!this.trusting && held && FISH.has(itemName(held.id)) && this.distanceToTargetSqr(p) < 81) {
      this.s.mobs.usePlayerItem(p, slot);
      if (this.rng.nextInt(3) === 0) {
        this.trusting = true;
        this.persistenceRequired = true;
        this.entityEvent(41);
      } else this.entityEvent(40);
      return true;
    }
    return super.interact(p, hand);
  }
  override saveExtra(): Record<string, unknown> {
    return { trusting: this.trusting };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.trusting = !!o.trusting;
  }
  override ambientSound(): string {
    return 'entity.ocelot.ambient';
  }
  override hurtSound(): string {
    return 'entity.ocelot.hurt';
  }
  override deathSound(): string {
    return 'entity.ocelot.death';
  }
}

/** FollowOwnerGoal(1.0, 10, 2) for cats, without teleporting. */
class FollowOwnerGoal extends Goal {
  constructor(private readonly c: Cat) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const o = this.c.owner();
    return !!o && !this.c.orderedToSit && this.c.distanceToTargetSqr(o) >= 100;
  }
  override canContinueToUse(): boolean {
    const o = this.c.owner();
    return !!o && !this.c.orderedToSit && this.c.distanceToTargetSqr(o) > 4;
  }
  override tick(): void {
    const o = this.c.owner();
    if (!o) return;
    if (this.c.distanceToTargetSqr(o) >= 144) {
      this.c.x = o.x;
      this.c.y = o.y;
      this.c.z = o.z;
      this.c.navigation.stop();
    } else if (this.c.navigation.isDone()) this.c.navigation.moveToEntity(o, 1);
  }
}

class SitGoal extends Goal {
  constructor(private readonly c: Cat) {
    super();
    this.flags = Flag.MOVE | Flag.JUMP;
  }
  canUse(): boolean {
    return this.c.tame && this.c.orderedToSit;
  }
  override tick(): void {
    this.c.navigation.stop();
  }
}

/** Cat: tamed with raw cod/salmon (1 in 3), sits on command, follows its owner, breeds with fish. */
export class Cat extends Animal {
  readonly type = 'cat';
  readonly maxHealth = 10;
  readonly adultWidth = 0.6;
  readonly adultHeight = 0.7;
  override movementSpeed = 0.3;
  override attackDamage = 3;
  readonly food = FISH;
  tame = false;
  ownerName: string | null = null;
  orderedToSit = false;
  /** CatType 0–10 (tabby … all black) */
  catType = 0;
  protected registerGoals(): void {
    this.goalSelector.add(1, new FloatGoal(this));
    this.goalSelector.add(1, new PanicGoal(this, 1.5));
    this.goalSelector.add(2, new SitGoal(this));
    this.goalSelector.add(4, new TemptGoal(this, 0.6, FISH));
    this.goalSelector.add(5, new AvoidGoal(this, 16, 0.8, 1.33, (t) => !this.tame && !isMob(t)));
    this.goalSelector.add(6, new FollowOwnerGoal(this));
    this.goalSelector.add(9, new BreedGoal(this, 0.8));
    this.goalSelector.add(10, new LeapAtTargetGoal(this, 0.3));
    this.goalSelector.add(11, new MeleeAttackGoal(this, 1, true));
    this.goalSelector.add(12, new RandomStrollGoal(this, 0.8));
    this.goalSelector.add(13, new LookAtPlayerGoal(this, 10));
    this.targetSelector.add(1, new NearestMobTargetGoal(this, false, (m) => !this.tame && m.type === 'rabbit', 10));
    this.targetSelector.add(1, new NearestMobTargetGoal(this, false, (m) => !this.tame && m.type === 'turtle' && m.isBaby(), 10));
  }
  override finalizeSpawn(groupIndex: number): void {
    super.finalizeSpawn(groupIndex);
    this.catType = this.rng.nextInt(10);
  }
  override variant(): number {
    return this.catType;
  }
  owner(): ServerPlayer | null {
    return this.ownerName ? this.s.players.find((p) => p.name === this.ownerName && !p.living.dead) ?? null : null;
  }
  override canMate(o: Animal): boolean {
    return this.tame && o instanceof Cat && o.tame && super.canMate(o);
  }
  override removeWhenFarAway(): boolean {
    return !this.tame && this.tickCount > 2400;
  }
  /** Cat.mobInteract */
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    const fish = !!held && FISH.has(itemName(held.id));
    if (!this.tame) {
      if (!fish) return false;
      this.s.mobs.usePlayerItem(p, slot);
      if (this.rng.nextInt(3) === 0) {
        this.tame = true;
        this.ownerName = p.name;
        this.persistenceRequired = true;
        this.orderedToSit = true;
        this.entityEvent(7);
      } else this.entityEvent(6);
      this.flagsDirty = true;
      return true;
    }
    if (this.ownerName !== p.name) return false;
    if (fish && this.health < this.maxHealth) {
      this.s.mobs.usePlayerItem(p, slot);
      this.heal(2);
      return true;
    }
    if (fish && super.interact(p, hand)) return true;
    if (hand !== 0) return false;
    this.orderedToSit = !this.orderedToSit;
    this.navigation.stop();
    this.flagsDirty = true;
    return true;
  }
  protected override inheritTo(baby: Animal, partner: Animal): void {
    if (baby instanceof Cat && partner instanceof Cat) {
      baby.catType = this.rng.nextBoolean() ? this.catType : partner.catType;
      baby.tame = true;
      baby.ownerName = this.ownerName;
    }
  }
  override saveExtra(): Record<string, unknown> {
    return { tame: this.tame, owner: this.ownerName, sit: this.orderedToSit, catType: this.catType };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.tame = !!o.tame;
    this.ownerName = (o.owner as string | null) ?? null;
    this.orderedToSit = !!o.sit;
    this.catType = (o.catType as number) ?? 0;
  }
  override ambientSound(): string {
    return this.tame ? (this.isInLove() ? 'entity.cat.purr' : 'entity.cat.ambient') : 'entity.cat.stray_ambient';
  }
  override hurtSound(): string {
    return 'entity.cat.hurt';
  }
  override deathSound(): string {
    return 'entity.cat.death';
  }
}

/** Turtle: 30 HP, slow on land, breeds with seagrass, babies drop a scute when they grow up. */
export class Turtle extends Animal {
  readonly type = 'turtle';
  readonly maxHealth = 30;
  readonly adultWidth = 1.2;
  readonly adultHeight = 0.4;
  override movementSpeed = 0.25;
  readonly food = set('seagrass');
  protected registerGoals(): void {
    this.goalSelector.add(0, new PanicGoal(this, 1.2));
    this.goalSelector.add(1, new BreedGoal(this, 1));
    this.goalSelector.add(2, new TemptGoal(this, 1.1, this.food));
    this.goalSelector.add(7, new RandomStrollGoal(this, 1, 100, false));
    this.goalSelector.add(8, new LookAtPlayerGoal(this, 8));
  }
  override canBreatheUnderwater(): boolean {
    return true;
  }
  override setAge(a: number): void {
    const wasBaby = this.isBaby();
    super.setAge(a);
    // Turtle.ageBoundaryReached: a growing-up baby drops a scute
    if (wasBaby && !this.isBaby() && this.s.mobs.doMobLoot && this.tickCount > 0) this.s.mobs.spawnAtLocation(this, { id: scuteId(), count: 1, damage: 0 });
  }
  override ambientSound(): string | null {
    return this.wasTouchingWater ? null : 'entity.turtle.ambient_land';
  }
  override hurtSound(): string {
    return 'entity.turtle.hurt';
  }
  override deathSound(): string {
    return 'entity.turtle.death';
  }
  override stepSound(): string {
    return 'entity.turtle.shamble';
  }
}
import { ITEMS_BY_NAME } from '@shared/data';
const scuteId = () => ITEMS_BY_NAME.get('scute')!.id;
