/** Hostile mobs: zombie (+ husk, drowned), skeleton (+ stray), creeper, spider (vanilla 1.17.1). */
import { stack, itemName } from '@shared/item/stack';
import { blockNameOf, getProp } from '@shared/world/blockstate';
import { attackDamageOf } from '@shared/game/combat';
import { Difficulty } from '@shared/game/food';
import type { ServerPlayer } from '../player';
import type { DamageSource } from '../survival';
import { Goal, Flag } from './goal';
import { Mob, GroundNavigation, canTarget, type MobCategory, type Target } from './mob';
import {
  FloatGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, MeleeAttackGoal, HurtByTargetGoal,
  NearestAttackableTargetGoal, LeapAtTargetGoal, FleeSunGoal, RestrictSunGoal, NearestMobTargetGoal,
} from './goals';
import { PROFESSIONS } from '@shared/game/trades';
import type { VillagerData } from './villager';
import { brightnessOf } from './mob';
import { MOB_FLAG } from '@shared/entity/mobdata';

export abstract class Monster extends Mob {
  readonly category: MobCategory = 'monster';
  readonly trackRange = 128;
  override xpReward = 5;
  override walkTargetValue(x: number, y: number, z: number): number {
    return 0.5 - brightnessOf(this.rawBrightness(x, y, z));
  }
  override shouldDespawnInPeaceful(): boolean {
    return true;
  }
}

// ------------------------------------------------------------------ zombie
/** ZombieAttackGoal: melee that raises the arms 5 ticks in, while the next hit is < 10 ticks away. */
class ZombieAttackGoal extends MeleeAttackGoal {
  private raiseArmTicks = 0;
  override start(): void {
    super.start();
    this.raiseArmTicks = 0;
  }
  override stop(): void {
    super.stop();
    this.m.setAggressive(false);
  }
  override tick(): void {
    super.tick();
    this.raiseArmTicks++;
    this.m.setAggressive(this.raiseArmTicks >= 5 && this.ticksUntilNextAttack < 10);
  }
}

/** BreakDoorGoal: on hard, a door-breaking zombie hacks through a closed wooden door in its path (240 ticks). */
export class BreakDoorGoal extends Goal {
  private dx = 0;
  private dy = 0;
  private dz = 0;
  private breakTime = 0;
  private lastProgress = -1;
  constructor(private readonly m: Mob) {
    super();
  }
  private isWoodenDoor(x: number, y: number, z: number): boolean {
    const n = blockNameOf(this.m.world.getState(x, y, z));
    return n.endsWith('_door') && n !== 'iron_door';
  }
  private isOpen(): boolean {
    return getProp(this.m.world.getState(this.dx, this.dy, this.dz), 'open') === true;
  }
  /** DoorInteractGoal.canUse: a wooden door at the next path nodes (or above our feet) within 1.5 blocks */
  private findDoor(): boolean {
    const m = this.m;
    if (!m.horizontalCollision) return false;
    const p = m.navigation.path;
    if (p && !p.done && m.navigation.canOpenDoors) {
      for (let i = 0; i < Math.min(p.index + 2, p.nodes.length); i++) {
        const n = p.nodes[i]!;
        if ((m.x - (n.x + 0.5)) ** 2 + (m.y - (n.y + 1)) ** 2 + (m.z - (n.z + 0.5)) ** 2 > 2.25) continue;
        if (this.isWoodenDoor(n.x, n.y + 1, n.z)) {
          [this.dx, this.dy, this.dz] = [n.x, n.y + 1, n.z];
          return true;
        }
      }
    }
    [this.dx, this.dy, this.dz] = [Math.floor(m.x), Math.floor(m.y) + 1, Math.floor(m.z)];
    return this.isWoodenDoor(this.dx, this.dy, this.dz);
  }
  canUse(): boolean {
    return this.m.s.difficulty === Difficulty.Hard && this.findDoor() && !this.isOpen();
  }
  override start(): void {
    this.breakTime = 0;
  }
  override canContinueToUse(): boolean {
    const m = this.m;
    return this.breakTime <= 240 && this.isWoodenDoor(this.dx, this.dy, this.dz) && !this.isOpen() && (m.x - (this.dx + 0.5)) ** 2 + (m.y - (this.dy + 0.5)) ** 2 + (m.z - (this.dz + 0.5)) ** 2 < 4 && m.s.difficulty === Difficulty.Hard;
  }
  override stop(): void {
    this.progress(-1);
  }
  private progress(stage: number): void {
    const s = this.m.s;
    for (const o of s.players) s.send(o, { t: 'blockBreakProgress', id: this.m.id, x: this.dx, y: this.dy, z: this.dz, stage });
  }
  override tick(): void {
    const m = this.m, s = m.s;
    if (m.rng.nextInt(20) === 0) {
      s.playSound(null, 'entity.zombie.attack_wooden_door', 'hostile', this.dx + 0.5, this.dy + 0.5, this.dz + 0.5, 2, (m.rng.nextFloat() - m.rng.nextFloat()) * 0.2 + 1);
      m.swing();
    }
    this.breakTime++;
    const i = Math.floor((this.breakTime / 240) * 10);
    if (i !== this.lastProgress) {
      this.progress(i);
      this.lastProgress = i;
    }
    if (this.breakTime === 240) {
      s.destroyBlock(this.dx, this.dy, this.dz, null, false);
      s.playSound(null, 'entity.zombie.break_wooden_door', 'hostile', this.dx + 0.5, this.dy + 0.5, this.dz + 0.5, 2, (m.rng.nextFloat() - m.rng.nextFloat()) * 0.2 + 1);
    }
  }
}

export class Zombie extends Monster {
  readonly type: string = 'zombie';
  readonly maxHealth = 20;
  baby = false;
  override movementSpeed = 0.23;
  override attackDamage = 3;
  override armor = 2;
  override followRange = 35;
  get width(): number {
    return this.baby ? 0.3 : 0.6;
  }
  get height(): number {
    return this.baby ? 0.975 : 1.95;
  }
  override get eyeHeight(): number {
    return this.baby ? 0.93 : 1.74;
  }
  override isBaby(): boolean {
    return this.baby;
  }
  override movementSpeedValue(): number {
    return this.baby ? this.movementSpeed * 1.5 : this.movementSpeed;
  }
  override experienceReward(): number {
    const xp = super.experienceReward();
    return this.baby ? Math.floor(xp * 2.5) : xp;
  }
  protected registerGoals(): void {
    this.goalSelector.add(8, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(8, new RandomLookAroundGoal(this));
    this.goalSelector.add(2, new ZombieAttackGoal(this, 1, false));
    this.goalSelector.add(7, new RandomStrollGoal(this, 1));
    this.targetSelector.add(1, new HurtByTargetGoal(this));
    this.targetSelector.add(2, new NearestAttackableTargetGoal(this, true));
    // Zombie.addBehaviourGoals: AbstractVillager (no sight needed) and IronGolem
    this.targetSelector.add(3, new NearestMobTargetGoal(this, false, (m) => m.type === 'villager' || m.type === 'wandering_trader'));
    this.targetSelector.add(3, new NearestMobTargetGoal(this, true, (m) => m.type === 'iron_golem'));
  }
  isSunSensitive(): boolean {
    return true;
  }
  /** undead mobs breathe underwater (LivingEntity.canBreatheUnderwater) */
  override canBreatheUnderwater(): boolean {
    return true;
  }
  override ambientSound(): string {
    return 'entity.zombie.ambient';
  }
  override hurtSound(): string {
    return 'entity.zombie.hurt';
  }
  override deathSound(): string {
    return 'entity.zombie.death';
  }
  override stepSound(): string {
    return 'entity.zombie.step';
  }
  canBreakDoors = false;
  /** Zombie.setCanBreakDoors: open-door paths plus the BreakDoorGoal */
  setCanBreakDoors(v: boolean): void {
    if (v === this.canBreakDoors) return;
    this.canBreakDoors = v;
    this.navigation.canOpenDoors = v;
    if (v) this.goalSelector.add(1, new BreakDoorGoal(this));
  }
  /** Zombie.finalizeSpawn + populateDefaultEquipmentSlots */
  finalizeSpawn(): void {
    const r = this.rng;
    // canBreakDoors: 10% × the regional special multiplier (non-zero only on hard)
    const eff = this.s.difficulty === Difficulty.Hard ? 3 * (0.75 + Math.max(0, Math.min(1, (this.s.gameTime - 72000) / 1440000)) * 0.25) : 0;
    const special = eff < 2 ? 0 : eff > 4 ? 1 : (eff - 2) / 2;
    this.setCanBreakDoors(r.nextFloat() < special * 0.1);
    this.baby = r.nextFloat() < 0.05;
    if (r.nextFloat() < (this.s.difficulty === Difficulty.Hard ? 0.05 : 0.01)) {
      this.mainHand = r.nextInt(3) === 0 ? stack('iron_sword') : stack('iron_shovel');
    }
  }
  /** ticks with the eyes underwater, and the conversion countdown (−1 = not converting) */
  inWaterTime = 0;
  conversionTime = -1;
  convertsInWater(): boolean {
    return true;
  }
  convertsTo(): string {
    return 'drowned';
  }
  protected conversionSound(): string {
    return 'entity.zombie.converted_to_drowned';
  }
  override mobFlags(): number {
    return super.mobFlags() | (this.conversionTime >= 0 ? MOB_FLAG.CONVERTING : 0);
  }
  protected override customServerAiStep(): void {
    // Zombie.tick: 30 s with the eyes underwater starts a 15 s conversion (zombie → drowned, husk → zombie)
    if (this.conversionTime >= 0) {
      if (--this.conversionTime < 0) this.convert();
    } else if (this.convertsInWater()) {
      if (this.eyeInWater) {
        if (++this.inWaterTime >= 600) {
          this.conversionTime = 300;
          this.flagsDirty = true;
        }
      } else this.inWaterTime = -1;
    }
    if (this.isSunSensitive() && this.isSunBurnTick()) this.setSecondsOnFire(8);
  }
  /** Mob.convertTo: same place, rotation, age, equipment and persistence; the old mob vanishes. */
  private convert(): void {
    const n = this.s.mobs.spawn(this.convertsTo(), this.x, this.y, this.z, 'conversion') as Zombie | null;
    if (!n) return;
    n.yaw = this.yaw;
    n.yHeadRot = this.yHeadRot;
    n.yBodyRot = this.yBodyRot;
    n.baby = this.baby;
    n.mainHand = this.mainHand;
    n.persistenceRequired = this.persistenceRequired;
    this.removed = true;
    this.playSound(this.conversionSound(), 1, 1);
  }
  /** attack damage with the held weapon's modifier */
  attackDamageValue(): number {
    return this.attackDamage + (this.mainHand ? attackDamageOf(this.mainHand.id) - 1 : 0);
  }
  /** Zombie.doHurtTarget: a burning, empty-handed zombie sets its target on fire */
  afterHurtTarget(t: Target): void {
    const f = this.s.difficulty; // getEffectiveDifficulty ≈ difficulty id (regional difficulty not modelled)
    if (!this.mainHand && this.isOnFire() && this.rng.nextFloat() < f * 0.3) this.s.mobs.setOnFire(t, 2 * f);
  }
}

export class Husk extends Zombie {
  override readonly type = 'husk';
  override convertsTo(): string {
    return 'zombie';
  }
  protected override conversionSound(): string {
    return 'entity.husk.converted_to_zombie';
  }
  override isSunSensitive(): boolean {
    return false;
  }
  override ambientSound(): string {
    return 'entity.husk.ambient';
  }
  override hurtSound(): string {
    return 'entity.husk.hurt';
  }
  override deathSound(): string {
    return 'entity.husk.death';
  }
  override stepSound(): string {
    return 'entity.husk.step';
  }
}

export class Drowned extends Zombie {
  override readonly type = 'drowned';
  override convertsInWater(): boolean {
    return false;
  }
  override canBreatheUnderwater(): boolean {
    return true;
  }
  override finalizeSpawn(): void {
    super.finalizeSpawn();
    this.mainHand = null;
  }
  override ambientSound(): string {
    return this.wasTouchingWater ? 'entity.drowned.ambient_water' : 'entity.drowned.ambient';
  }
  override hurtSound(): string {
    return this.wasTouchingWater ? 'entity.drowned.hurt_water' : 'entity.drowned.hurt';
  }
  override deathSound(): string {
    return this.wasTouchingWater ? 'entity.drowned.death_water' : 'entity.drowned.death';
  }
  override stepSound(): string {
    return 'entity.drowned.step';
  }
}

// ------------------------------------------------------------------ skeleton
/** RangedBowAttackGoal (speed 1.0, interval 20 on hard / 40 otherwise, radius 15). */
export class RangedBowAttackGoal extends Goal {
  private attackTime = -1;
  private seeTime = 0;
  private strafingClockwise = false;
  private strafingBackwards = false;
  private strafingTime = -1;
  private readonly radiusSqr: number;
  constructor(private readonly m: Skeleton, private readonly speed: number, public interval: number, radius: number) {
    super();
    this.radiusSqr = radius * radius;
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    return canTarget(this.m.target, this.m.s) && this.m.holdingBow();
  }
  override canContinueToUse(): boolean {
    return (this.canUse() || !this.m.navigation.isDone()) && this.m.holdingBow();
  }
  override start(): void {
    this.m.setAggressive(true);
  }
  override stop(): void {
    this.m.setAggressive(false);
    this.seeTime = 0;
    this.attackTime = -1;
    this.m.stopUsingItem();
  }
  override tick(): void {
    const m = this.m, t = m.target;
    if (!t) return;
    const d0 = m.distanceToSqr(t.x, t.y, t.z);
    const see = m.hasLineOfSight(t);
    if (see !== this.seeTime > 0) this.seeTime = 0;
    if (see) this.seeTime++;
    else this.seeTime--;
    if (d0 <= this.radiusSqr && this.seeTime >= 20) {
      m.navigation.stop();
      this.strafingTime++;
    } else {
      m.navigation.moveToEntity(t, this.speed);
      this.strafingTime = -1;
    }
    if (this.strafingTime >= 20) {
      if (m.rng.nextFloat() < 0.3) this.strafingClockwise = !this.strafingClockwise;
      if (m.rng.nextFloat() < 0.3) this.strafingBackwards = !this.strafingBackwards;
      this.strafingTime = 0;
    }
    if (this.strafingTime > -1) {
      if (d0 > this.radiusSqr * 0.75) this.strafingBackwards = false;
      else if (d0 < this.radiusSqr * 0.25) this.strafingBackwards = true;
      m.moveControl.strafe(this.strafingBackwards ? -0.5 : 0.5, this.strafingClockwise ? 0.5 : -0.5);
      m.lookAt(t, 30, 30);
    } else m.lookControl.setLookAtEntity(t, 30, 30);
    if (m.useItemTicks >= 0) {
      if (!see && this.seeTime < -60) m.stopUsingItem();
      else if (see) {
        const i = m.useItemTicks;
        if (i >= 20) {
          m.stopUsingItem();
          m.performRangedAttack(t, bowPower(i));
          this.attackTime = this.interval;
        }
      }
    } else if (--this.attackTime <= 0 && this.seeTime >= -60) m.startUsingItem();
  }
}

/** BowItem.getPowerForTime */
export function bowPower(ticks: number): number {
  let f = ticks / 20;
  f = (f * f + f * 2) / 3;
  return Math.min(1, f);
}

export class Skeleton extends Monster {
  readonly type: string = 'skeleton';
  readonly maxHealth = 20;
  readonly width = 0.6;
  readonly height = 1.99;
  override movementSpeed = 0.25;
  private bowGoal!: RangedBowAttackGoal;
  private meleeGoal!: MeleeAttackGoal;
  override get eyeHeight(): number {
    return 1.74;
  }
  protected registerGoals(): void {
    this.goalSelector.add(2, new RestrictSunGoal(this));
    this.goalSelector.add(3, new FleeSunGoal(this, 1));
    this.goalSelector.add(5, new RandomStrollGoal(this, 1));
    this.goalSelector.add(6, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(6, new RandomLookAroundGoal(this));
    this.targetSelector.add(1, new HurtByTargetGoal(this));
    this.targetSelector.add(2, new NearestAttackableTargetGoal(this, true));
    this.bowGoal = new RangedBowAttackGoal(this, 1, 40, 15);
    this.meleeGoal = new MeleeAttackGoal(this, 1.2, false);
  }
  override canBreatheUnderwater(): boolean {
    return true;
  }
  holdingBow(): boolean {
    return !!this.mainHand && itemName(this.mainHand.id) === 'bow';
  }
  /** AbstractSkeleton.reassessWeaponGoal */
  reassessWeaponGoal(): void {
    this.goalSelector.remove(this.bowGoal);
    this.goalSelector.remove(this.meleeGoal);
    if (this.holdingBow()) {
      this.bowGoal.interval = this.s.difficulty === Difficulty.Hard ? 20 : 40;
      this.goalSelector.add(4, this.bowGoal);
    } else this.goalSelector.add(4, this.meleeGoal);
  }
  finalizeSpawn(): void {
    this.mainHand = stack('bow');
    this.reassessWeaponGoal();
  }
  startUsingItem(): void {
    this.useItemTicks = 0;
    this.flagsDirty = true;
  }
  stopUsingItem(): void {
    if (this.useItemTicks >= 0) this.flagsDirty = true;
    this.useItemTicks = -1;
  }
  protected override customServerAiStep(): void {
    if (this.useItemTicks >= 0) this.useItemTicks++;
    if (this.isSunBurnTick()) this.setSecondsOnFire(8);
  }
  /** AbstractSkeleton.performRangedAttack */
  performRangedAttack(t: Target, power: number): void {
    this.s.mobs.shootArrow(this, t, power, this.arrowEffect());
    const r = this.rng;
    this.playSound('entity.skeleton.shoot', 1, 1 / (r.nextFloat() * 0.4 + 0.8));
  }
  protected arrowEffect(): string | null {
    return null;
  }
  override ambientSound(): string {
    return 'entity.skeleton.ambient';
  }
  override hurtSound(): string {
    return 'entity.skeleton.hurt';
  }
  override deathSound(): string {
    return 'entity.skeleton.death';
  }
  override stepSound(): string {
    return 'entity.skeleton.step';
  }
}

export class Stray extends Skeleton {
  override readonly type = 'stray';
  protected override arrowEffect(): string {
    return 'slowness';
  }
  override ambientSound(): string {
    return 'entity.stray.ambient';
  }
  override hurtSound(): string {
    return 'entity.stray.hurt';
  }
  override deathSound(): string {
    return 'entity.stray.death';
  }
  override stepSound(): string {
    return 'entity.stray.step';
  }
}

// ------------------------------------------------------------------ creeper
/** SwellGoal: start swelling within 3 blocks, keep it while within 7 and visible. */
class SwellGoal extends Goal {
  constructor(private readonly c: Creeper) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const t = this.c.target;
    return this.c.swellDir > 0 || (!!t && this.c.distanceToTargetSqr(t) < 9);
  }
  override start(): void {
    this.c.navigation.stop();
  }
  override tick(): void {
    const c = this.c, t = c.target;
    if (!t) c.setSwellDir(-1);
    else if (c.distanceToTargetSqr(t) > 49) c.setSwellDir(-1);
    else if (!c.hasLineOfSight(t)) c.setSwellDir(-1);
    else c.setSwellDir(1);
  }
}

export class Creeper extends Monster {
  readonly type = 'creeper';
  readonly maxHealth = 20;
  readonly width = 0.6;
  readonly height = 1.7;
  override movementSpeed = 0.25;
  swell = 0;
  oldSwell = 0;
  swellDir = -1;
  readonly maxSwell = 30;
  explosionRadius = 3;
  powered = false;
  ignited = false;
  protected registerGoals(): void {
    this.goalSelector.add(1, new FloatGoal(this));
    this.goalSelector.add(2, new SwellGoal(this));
    this.goalSelector.add(4, new MeleeAttackGoal(this, 1, false));
    this.goalSelector.add(5, new RandomStrollGoal(this, 0.8));
    this.goalSelector.add(6, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(6, new RandomLookAroundGoal(this));
    this.targetSelector.add(1, new NearestAttackableTargetGoal(this, true));
    this.targetSelector.add(2, new HurtByTargetGoal(this));
  }
  setSwellDir(d: number): void {
    if (d !== this.swellDir) {
      this.swellDir = d;
      this.flagsDirty = true;
    }
  }
  override mobFlags(): number {
    return super.mobFlags() | (this.swellDir > 0 ? MOB_FLAG.SWELLING : 0) | (this.powered ? MOB_FLAG.POWERED : 0) | (this.ignited ? MOB_FLAG.IGNITED : 0);
  }
  /** Creeper.tick (server part) */
  override tick(world: Parameters<Mob['tick']>[0]): void {
    if (!this.dead) {
      this.oldSwell = this.swell;
      if (this.ignited) this.setSwellDir(1);
      const i = this.swellDir;
      if (i > 0 && this.swell === 0) this.playSound('entity.creeper.primed', 1, 0.5);
      this.swell += i;
      if (this.swell < 0) this.swell = 0;
      if (this.swell >= this.maxSwell) {
        this.swell = this.maxSwell;
        this.explodeCreeper();
        return;
      }
    }
    super.tick(world);
  }
  /** Creeper.causeFallDamage: falling primes the fuse */
  protected override causeFallDamage(dist: number): void {
    super.causeFallDamage(dist);
    this.swell = Math.min(this.swell + Math.floor(dist * 1.5), this.maxSwell - 5);
  }
  explodeCreeper(): void {
    const f = this.powered ? 2 : 1;
    this.dead = true;
    this.s.mobs.explode(this, this.x, this.y, this.z, this.explosionRadius * f, this.s.mobs.mobGriefing);
    this.removed = true;
  }
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (!held || itemName(held.id) !== 'flint_and_steel' || this.ignited) return false;
    const r = this.rng;
    this.s.playSound(null, 'item.flintandsteel.use', 'player', this.x, this.y, this.z, 1, r.nextFloat() * 0.4 + 0.8);
    this.ignited = true;
    this.flagsDirty = true;
    this.s.mobs.damageHeldItem(p, slot, 1);
    return true;
  }
  override hurtSound(): string {
    return 'entity.creeper.hurt';
  }
  override deathSound(): string {
    return 'entity.creeper.death';
  }
}

// ------------------------------------------------------------------ spider
class WallClimberNavigation extends GroundNavigation {
  private pathTo: [number, number, number] | null = null;
  override createPathTo(t: Target, accuracy = 1) {
    this.pathTo = [Math.floor(t.x), Math.floor(t.y), Math.floor(t.z)];
    return super.createPathTo(t, accuracy);
  }
  override moveToEntity(t: Target, speed: number): boolean {
    const p = this.createPathTo(t, 0);
    if (p) return this.moveAlong(p, speed);
    this.pathTo = [Math.floor(t.x), Math.floor(t.y), Math.floor(t.z)];
    this.speedModifier = speed;
    return true;
  }
  override tick(): void {
    if (!this.isDone()) {
      super.tick();
      return;
    }
    const p = this.pathTo, m = this.mob;
    if (!p) return;
    const w = m.width;
    const near = (x: number, y: number, z: number) => (m.x - (x + 0.5)) ** 2 + (m.y - (y + 0.5)) ** 2 + (m.z - (z + 0.5)) ** 2 < w * w;
    if (!near(p[0], p[1], p[2]) && !(m.y > p[1] && near(p[0], Math.floor(m.y), p[2]))) m.moveControl.setWantedPosition(p[0] + 0.5, p[1], p[2] + 0.5, this.speedModifier);
    else this.pathTo = null;
  }
  override stop(): void {
    super.stop();
    this.pathTo = null;
  }
}

class SpiderAttackGoal extends MeleeAttackGoal {
  override canContinueToUse(): boolean {
    if (this.m.brightness() >= 0.5 && this.m.rng.nextInt(100) === 0) {
      this.m.target = null;
      return false;
    }
    return super.canContinueToUse();
  }
  protected override attackReachSqr(t: Target): number {
    return 4 + (t instanceof Mob ? t.width : 0.6);
  }
}

export class Spider extends Monster {
  readonly type: string = 'spider';
  readonly maxHealth: number = 16;
  readonly width: number = 1.4;
  readonly height: number = 0.9;
  override movementSpeed = 0.3;
  climbing = false;
  override get eyeHeight(): number {
    return 0.65;
  }
  protected override createNavigation(): GroundNavigation {
    return new WallClimberNavigation(this);
  }
  protected registerGoals(): void {
    this.goalSelector.add(1, new FloatGoal(this));
    this.goalSelector.add(3, new LeapAtTargetGoal(this, 0.4));
    this.goalSelector.add(4, new SpiderAttackGoal(this, 1, true));
    this.goalSelector.add(5, new RandomStrollGoal(this, 0.8));
    this.goalSelector.add(6, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(6, new RandomLookAroundGoal(this));
    this.targetSelector.add(1, new HurtByTargetGoal(this));
    // SpiderTargetGoal: only hunts in the dark (brightness < 0.5)
    this.targetSelector.add(2, new (class extends NearestAttackableTargetGoal {
      constructor(private readonly sp: Spider) {
        super(sp, true);
      }
      override canUse(): boolean {
        return this.sp.brightness() < 0.5 && super.canUse();
      }
    })(this));
  }
  override onClimbable(): boolean {
    return this.climbing;
  }
  override mobFlags(): number {
    return super.mobFlags() | (this.climbing ? MOB_FLAG.CLIMBING : 0);
  }
  override tick(world: Parameters<Mob['tick']>[0]): void {
    super.tick(world);
    if (this.horizontalCollision !== this.climbing) {
      this.climbing = this.horizontalCollision;
      this.flagsDirty = true;
    }
  }
  override ambientSound(): string {
    return 'entity.spider.ambient';
  }
  override hurtSound(): string {
    return 'entity.spider.hurt';
  }
  override deathSound(): string {
    return 'entity.spider.death';
  }
  override stepSound(): string {
    return 'entity.spider.step';
  }
}

/**
 * Zombie villagers: zombie attributes and AI with their own voice. Curing: a golden apple while
 * under Weakness starts a 3600–6000 tick conversion (sped up by iron bars and beds within 4
 * blocks) back into a villager that keeps its profession, level and trades.
 */
export class ZombieVillager extends Zombie {
  override readonly type = 'zombie_villager';
  /** VillagerData carried over from the villager (profession, level, xp, offers) */
  villagerData: VillagerData | null = null;
  villagerConversionTime = -1;
  conversionStarter: ServerPlayer | null = null;
  override finalizeSpawn(): void {
    super.finalizeSpawn();
    // ZombieVillager.finalizeSpawn: a random profession (no trades)
    if (!this.villagerData) {
      const profs = PROFESSIONS.filter((p) => p !== 'none');
      this.villagerData = { profession: profs[this.rng.nextInt(profs.length)]!, level: 1, xp: 0, type: 'plains', offers: [] };
    }
  }
  isConverting(): boolean {
    return this.villagerConversionTime > 0;
  }
  override saveExtra(): Record<string, unknown> {
    return { villagerData: this.villagerData, villagerConversionTime: this.villagerConversionTime };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.villagerData = (o.villagerData as VillagerData | null) ?? null;
    this.villagerConversionTime = (o.villagerConversionTime as number) ?? -1;
  }
  override mobFlags(): number {
    return super.mobFlags() | (this.isConverting() ? MOB_FLAG.CONVERTING : 0);
  }
  override removeWhenFarAway(d2: number): boolean {
    return !this.isConverting() && super.removeWhenFarAway(d2);
  }
  /** ZombieVillager.mobInteract: golden apple + weakness */
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (!held || itemName(held.id) !== 'golden_apple') return false;
    if (!this.hasMobEffect('weakness') || this.isConverting()) return true;
    this.s.mobs.usePlayerItem(p, slot);
    this.startConverting(p, 3600 + this.rng.nextInt(2401));
    return true;
  }
  startConverting(p: ServerPlayer | null, ticks: number): void {
    this.conversionStarter = p;
    this.villagerConversionTime = ticks;
    this.removeMobEffect('weakness');
    this.addMobEffect('strength', ticks, Math.min(this.s.difficulty - 1, 0));
    this.flagsDirty = true;
    this.entityEvent(16);
    this.playSound('entity.zombie_villager.cure', 1 + this.rng.nextFloat(), this.rng.nextFloat() * 0.7 + 0.3);
  }
  /** getConversionProgress: 1, plus a 1 % chance per tick of counting iron bars/beds (30 % each, max 14) */
  private conversionProgress(): number {
    let n = 1;
    if (this.rng.nextFloat() < 0.01) {
      let k = 0;
      const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
      for (let x = bx - 4; x < bx + 4 && k < 14; x++)
        for (let y = by - 4; y < by + 4 && k < 14; y++)
          for (let z = bz - 4; z < bz + 4 && k < 14; z++) {
            const nm = blockNameOf(this.world.getState(x, y, z));
            if (nm === 'iron_bars' || nm.endsWith('_bed')) {
              if (this.rng.nextFloat() < 0.3) n++;
              k++;
            }
          }
    }
    return n;
  }
  protected override customServerAiStep(): void {
    if (this.isConverting()) {
      this.villagerConversionTime -= this.conversionProgress();
      if (this.villagerConversionTime <= 0) {
        this.finishConversion();
        return;
      }
    }
    super.customServerAiStep();
  }
  private finishConversion(): void {
    const v = this.s.mobs.spawn('villager', this.x, this.y, this.z, 'conversion') as (Mob & { applyData(d: VillagerData): void; setAge(a: number): void }) | null;
    if (!v) return;
    if (this.villagerData) v.applyData(this.villagerData);
    if (this.baby) v.setAge(-24000);
    v.yaw = this.yaw;
    v.persistenceRequired = true;
    v.addMobEffect('nausea', 200, 0);
    this.removed = true;
    this.playSound('entity.zombie_villager.converted', 1, 1);
    if (this.conversionStarter && !this.conversionStarter.living.dead) this.s.mobs.addPlayerEffect(this.conversionStarter, 'nausea', 200, 0);
  }
  override ambientSound(): string {
    return 'entity.zombie_villager.ambient';
  }
  override hurtSound(): string {
    return 'entity.zombie_villager.hurt';
  }
  override deathSound(): string {
    return 'entity.zombie_villager.death';
  }
  override stepSound(): string {
    return 'entity.zombie_villager.step';
  }
}

/** Cave spiders (spawner only): smaller and weaker spiders (their poison needs status effects). */
export class CaveSpider extends Spider {
  override readonly type = 'cave_spider';
  override readonly maxHealth = 12;
  override readonly width = 0.7;
  override readonly height = 0.5;
  override get eyeHeight(): number {
    return 0.45;
  }
}
