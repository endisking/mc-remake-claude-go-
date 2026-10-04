/**
 * Server-side mobs: vanilla LivingEntity + Mob + PathfinderMob (1.17.1) — health, damage with
 * armour, invulnerability frames, knockback, fire/lava/drowning/suffocation, death and loot, the
 * goal/target selectors, Move/Look/Jump/BodyRotation controls, ground navigation and
 * LivingEntity.travel physics (gravity 0.08, drag 0.98, ground friction, step-up 0.6, swimming).
 */
import { AABB, collideBox, noCollision } from '@shared/entity/aabb';
import { FRICTION, SPEED_FACTOR, JUMP_FACTOR, CLIMBABLE, STUCK } from '@shared/entity/blockphysics';
import { STATE_TO_BLOCK, blockNameOf } from '@shared/world/blockstate';
import { FLUID, FLUID_LEVEL } from '@shared/world/blockinfo';
import { isSuffocating } from '@shared/world/blockprops';
import { collisionBoxes } from '@shared/world/shapes';
import { raycastBlocks } from '@shared/world/raycast';
import { isRainingAt } from '@shared/world/weather';
import { skyDarkenLevel, isDay } from '@shared/world/daylight';
import { soundTypeOf } from '@shared/world/soundtype';
import { POSE_EYE, POSE_SIZE } from '@shared/entity/playerphysics';
import { JavaRandom } from '@shared/util/random';
import type { BlockWorld } from '@shared/world/world';
import type { ItemStack } from '@shared/item/stack';
import { ServerEntity } from '../entity';
import type { ServerPlayer } from '../player';
import type { GameServer } from '../server';
import type { DamageSource } from '../survival';
import { GoalSelector } from './goal';
import { findPath, staticPathType, PathType, DEFAULT_MALUS, type Path, type PathMob } from './pathfinder';
import { damageAfterArmor } from '@shared/game/items';
import { MOB_FLAG, ENTITY_EVENT } from '@shared/entity/mobdata';

export type Target = ServerPlayer | Mob;
export type MobCategory = 'monster' | 'creature' | 'ambient' | 'water_creature' | 'water_ambient' | 'misc';

export const isMob = (t: unknown): t is Mob => t instanceof Mob;

export function targetWidth(t: Target): number {
  return isMob(t) ? t.width : POSE_SIZE[t.pose][0];
}
export function targetHeight(t: Target): number {
  return isMob(t) ? t.height : POSE_SIZE[t.pose][1];
}
export function targetEye(t: Target): number {
  return isMob(t) ? t.eyeHeight : POSE_EYE[t.pose];
}
export function targetAlive(t: Target, s: GameServer): boolean {
  return isMob(t) ? !t.dead && !t.removed : !t.living.dead && s.players.includes(t);
}
/** TargetingConditions: creative/spectator players and dead entities can't be targeted. */
export function canTarget(t: Target | null, s: GameServer): t is Target {
  if (!t || !targetAlive(t, s)) return false;
  return isMob(t) || t.gameMode === 0 || t.gameMode === 2;
}

const GRAVITY = 0.08;

/** LightTexture/DimensionType brightness ramp for the overworld (ambient light 0). */
export function brightnessOf(light: number): number {
  const f = light / 15;
  return f / (f * -3 + 4);
}

export abstract class Mob extends ServerEntity {
  abstract readonly category: MobCategory;
  abstract readonly maxHealth: number;
  /** attribute base values */
  movementSpeed = 0.25;
  attackDamage = 2;
  armor = 0;
  armorToughness = 0;
  followRange = 16;
  knockbackResistance = 0;
  /** Mob.xpReward */
  xpReward = 0;
  health = 0;
  readonly rng: JavaRandom;
  /** body yaw (= this.yaw, LivingEntity.yBodyRot) and head yaw */
  yHeadRot = 0;
  yBodyRot = 0;
  xxa = 0;
  yya = 0;
  zza = 0;
  speed = 0;
  jumping = false;
  noJumpDelay = 0;
  maxUpStep = 0.6;
  horizontalCollision = false;
  hurtTime = 0;
  invulnerableTime = 0;
  lastHurt = 0;
  deathTime = 0;
  dead = false;
  remainingFireTicks = -1;
  fireImmune = false;
  airSupply = 300;
  lastHurtByMob: Target | null = null;
  lastHurtByMobTimestamp = 0;
  lastHurtByPlayer: ServerPlayer | null = null;
  lastHurtByPlayerTime = 0;
  target: Target | null = null;
  noActionTime = 0;
  persistenceRequired = false;
  aggressive = false;
  /** ticks this mob has been using its item (bow draw), −1 = not using */
  useItemTicks = -1;
  mainHand: ItemStack | null = null;
  /** Mob.handDropChances[MAINHAND] */
  handDropChance = 0.085;
  wasTouchingWater = false;
  waterHeight = 0;
  lavaHeight = 0;
  eyeInWater = false;
  isInPowderSnow = false;
  private stuck: [number, number, number] | null = null;
  /** chunk version and position of the last resting collision pass (−1 = not resting) */
  private restVersion = -1;
  private restX = 0;
  private restY = 0;
  private restZ = 0;
  ambientSoundTime = 0;
  private moveDist = 0;
  private nextStep = 1;
  tickCount = 0;
  // network state
  flagsDirty = true;
  stateDirty = true;
  sentFlags = -1;
  sentVariant = -1;
  /** last mobData values sent, by key */
  readonly sentData: Record<string, number> = {};
  sentOnFire = false;
  sentHeadYaw = NaN;
  sentYaw = NaN;
  sentPitch = NaN;
  sentMainHand = -1;
  velocityDirty = false;

  readonly goalSelector = new GoalSelector();
  readonly targetSelector = new GoalSelector();
  readonly navigation: GroundNavigation;
  readonly moveControl: MoveControl;
  readonly lookControl: LookControl;
  readonly jumpControl = new JumpControl(this);
  private readonly sightCache = new Map<Target, boolean>();
  protected readonly malusOverrides = new Map<PathType, number>();

  constructor(id: number, readonly s: GameServer) {
    super(id);
    this.rng = new JavaRandom(BigInt(s.rand.nextInt()) * 65536n + BigInt(id));
    this.navigation = this.createNavigation();
    this.moveControl = new MoveControl(this);
    this.lookControl = new LookControl(this);
  }

  /** called once after construction and attribute setup (subclasses register goals here) */
  init(): void {
    this.health = this.maxHealth;
    this.registerGoals();
  }

  protected createNavigation(): GroundNavigation {
    return new GroundNavigation(this);
  }

  protected abstract registerGoals(): void;

  get eyeHeight(): number {
    return this.height * 0.85;
  }

  get world(): BlockWorld {
    return this.s.world;
  }

  isBaby(): boolean {
    return false;
  }

  /** MOVEMENT_SPEED attribute value (with modifiers, e.g. baby zombies ×1.5) */
  movementSpeedValue(): number {
    return this.movementSpeed;
  }

  /** MOB_FLAG bits sent with mobData */
  mobFlags(): number {
    return (this.isBaby() ? MOB_FLAG.BABY : 0) | (this.aggressive ? MOB_FLAG.AGGRESSIVE : 0) | (this.useItemTicks >= 0 ? MOB_FLAG.USING_ITEM : 0);
  }

  variant(): number {
    return 0;
  }

  isOnFire(): boolean {
    return this.remainingFireTicks > 0;
  }

  setSecondsOnFire(sec: number): void {
    if (this.fireImmune) return;
    const t = sec * 20;
    if (this.remainingFireTicks < t) this.remainingFireTicks = t;
  }

  malus(t: PathType): number {
    return this.malusOverrides.get(t) ?? DEFAULT_MALUS[t]!;
  }

  setMalus(t: PathType, v: number): void {
    this.malusOverrides.set(t, v);
  }

  /** Mob.getMaxFallDistance */
  maxFallDistance(): number {
    if (!this.target) return 3;
    let i = Math.floor(this.health - this.maxHealth * 0.33);
    i -= (3 - this.s.difficulty) * 4;
    return Math.max(0, i) + 3;
  }

  distanceToSqr(x: number, y: number, z: number): number {
    return (this.x - x) ** 2 + (this.y - y) ** 2 + (this.z - z) ** 2;
  }

  distanceToTargetSqr(t: Target): number {
    return this.distanceToSqr(t.x, t.y, t.z);
  }

  /** Sensing.hasLineOfSight (eye to eye, collision shapes, cached per tick). */
  hasLineOfSight(t: Target): boolean {
    const c = this.sightCache.get(t);
    if (c !== undefined) return c;
    const ex = this.x, ey = this.y + this.eyeHeight, ez = this.z;
    const tx = t.x, ty = t.y + targetEye(t), tz = t.z;
    const d = Math.hypot(tx - ex, ty - ey, tz - ez);
    let v = d <= 128;
    if (v && d > 1e-6) v = raycastBlocks(this.world, ex, ey, ez, tx - ex, ty - ey, tz - ez, d, false, undefined, collisionBoxes) === null;
    this.sightCache.set(t, v);
    return v;
  }

  /** Entity.getBrightness at the eyes-free block position (with the sky darkening). */
  brightness(): number {
    return brightnessOf(this.rawBrightness(Math.floor(this.x), Math.floor(this.y + this.eyeHeight), Math.floor(this.z)));
  }

  rawBrightness(x: number, y: number, z: number): number {
    const w = this.world;
    const darken = skyDarkenLevel(this.s.dayTime, this.s.rainLevel, this.s.thunderLevel * this.s.rainLevel);
    return Math.max(w.getSkyLight(x, y, z) - darken, w.getBlockLight(x, y, z));
  }

  canSeeSky(x: number, y: number, z: number): boolean {
    const c = this.world.getChunk(x >> 4, z >> 4);
    return !!c && c.skyTop[(z & 15) * 16 + (x & 15)]! <= y;
  }

  isInWaterOrRain(): boolean {
    if (this.wasTouchingWater) return true;
    const r = this.s.isRaining();
    const x = Math.floor(this.x), z = Math.floor(this.z);
    return isRainingAt(this.world, r, x, Math.floor(this.y), z) || isRainingAt(this.world, r, x, Math.floor(this.y + this.height), z);
  }

  /** Mob.isSunBurnTick */
  isSunBurnTick(): boolean {
    if (!isDay(this.s.dayTime, this.s.rainLevel, this.s.thunderLevel * this.s.rainLevel)) return false;
    const f = this.brightness();
    const bx = Math.floor(this.x), by = Math.round(this.y + this.eyeHeight), bz = Math.floor(this.z);
    const wet = this.isInWaterOrRain() || this.isInPowderSnow;
    return f > 0.5 && this.rng.nextFloat() * 30 < (f - 0.4) * 2 && !wet && this.canSeeSky(bx, by, bz);
  }

  // ------------------------------------------------------------------ sounds
  voicePitch(): number {
    const r = this.rng;
    return this.isBaby() ? (r.nextFloat() - r.nextFloat()) * 0.2 + 1.5 : (r.nextFloat() - r.nextFloat()) * 0.2 + 1;
  }
  get soundSource(): 'hostile' | 'neutral' {
    return this.category === 'monster' ? 'hostile' : 'neutral';
  }
  ambientSound(): string | null {
    return null;
  }
  hurtSound(): string | null {
    return null;
  }
  deathSound(): string | null {
    return null;
  }
  stepSound(): string | null {
    return null;
  }
  soundVolume(): number {
    return 1;
  }
  playSound(event: string | null, volume: number, pitch: number): void {
    if (event) this.s.playSound(null, event, this.soundSource, this.x, this.y, this.z, volume, pitch);
  }
  ambientSoundInterval(): number {
    return 80;
  }

  // ------------------------------------------------------------------ packets
  broadcast(p: Parameters<GameServer['send']>[1]): void {
    for (const o of this.s.players) if (o.tracking.has(this.id)) this.s.send(o, p);
  }

  entityEvent(ev: number): void {
    this.broadcast({ t: 'entityEvent', id: this.id, event: ev });
  }

  swing(): void {
    this.broadcast({ t: 'animate', id: this.id, action: 0 });
  }

  setAggressive(v: boolean): void {
    if (v !== this.aggressive) {
      this.aggressive = v;
      this.flagsDirty = true;
    }
  }

  // ------------------------------------------------------------------ damage
  /** LivingEntity.hurt */
  hurt(src: DamageSource, amount: number, attacker: Target | null = null): boolean {
    if (this.dead || this.removed) return false;
    if (src.fire && this.fireImmune) return false;
    if (this.isInvulnerableTo(src)) return false;
    this.noActionTime = 0;
    if (amount <= 0) return false;
    let fresh = true;
    if (this.invulnerableTime > 10) {
      if (amount <= this.lastHurt) return false;
      this.actuallyHurt(src, amount - this.lastHurt);
      this.lastHurt = amount;
      fresh = false;
    } else {
      this.lastHurt = amount;
      this.invulnerableTime = 20;
      this.actuallyHurt(src, amount);
      this.hurtTime = 10;
    }
    if (attacker && attacker !== this) {
      this.lastHurtByMob = attacker;
      this.lastHurtByMobTimestamp = this.tickCount;
      if (!isMob(attacker)) {
        this.lastHurtByPlayer = attacker;
        this.lastHurtByPlayerTime = 100;
      }
    }
    if (fresh) {
      this.entityEvent(ENTITY_EVENT.HURT);
      const kb = src.knockbackFrom ?? attacker;
      if (kb && !src.explosion) {
        let dx = kb.x - this.x, dz = kb.z - this.z;
        while (dx * dx + dz * dz < 1e-4) {
          dx = (Math.random() - Math.random()) * 0.01;
          dz = (Math.random() - Math.random()) * 0.01;
        }
        this.knockback(0.4, dx, dz);
      }
    }
    if (this.health <= 0) {
      this.playSound(this.deathSound(), this.soundVolume(), this.voicePitch());
      this.die(src, attacker);
    } else if (fresh) {
      this.ambientSoundTime = -this.ambientSoundInterval();
      this.playSound(this.hurtSound(), this.soundVolume(), this.voicePitch());
    }
    return true;
  }

  /** ArrowTarget (server/src/game/arrow.ts): arrows shot by players (or other shooters) hit mobs. */
  hurtByArrow(arrow: { x: number; y: number; z: number; ownerId: number }, damage: number): boolean {
    if (this.dead) return false;
    const owner: Target | null = this.s.players.find((p) => p.id === arrow.ownerId) ?? ((this.s.entities.get(arrow.ownerId) as Mob | undefined) ?? null);
    const ownerName = owner ? (isMob(owner) ? this.s.mobs.displayName(owner) : owner.name) : null;
    const src: DamageSource = { id: 'arrow', projectile: true, knockbackFrom: owner ?? arrow, entity: ownerName ? { name: ownerName, player: !!owner && !isMob(owner) } : undefined };
    return this.hurt(src, damage, owner);
  }

  protected isInvulnerableTo(_src: DamageSource): boolean {
    return false;
  }

  /** LivingEntity.actuallyHurt: armour (unless bypassed), then health. */
  protected actuallyHurt(src: DamageSource, amount: number): void {
    if (!src.bypassArmor) amount = damageAfterArmor(amount, this.armor, this.armorToughness);
    this.health = Math.max(0, this.health - amount);
  }

  heal(n: number): void {
    if (!this.dead) this.health = Math.min(this.maxHealth, this.health + n);
  }

  /** LivingEntity.knockback */
  knockback(strength: number, x: number, z: number): void {
    strength *= 1 - this.knockbackResistance;
    if (strength <= 0) return;
    const len = Math.hypot(x, z) || 1;
    const kx = (x / len) * strength, kz = (z / len) * strength;
    this.vx = this.vx / 2 - kx;
    this.vy = this.onGround ? Math.min(0.4, this.vy / 2 + strength) : this.vy;
    this.vz = this.vz / 2 - kz;
    this.velocityDirty = true;
  }

  /** LivingEntity.die */
  die(src: DamageSource, attacker: Target | null): void {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    this.entityEvent(ENTITY_EVENT.DEATH);
    this.s.mobs.onMobDeath(this, src, attacker);
  }

  /** Experience dropped on death (Mob.getExperienceReward with equipment bonus). */
  experienceReward(): number {
    let xp = this.xpReward;
    if (xp > 0 && this.mainHand && this.handDropChance <= 1) xp += 1 + this.rng.nextInt(3);
    return xp;
  }

  // ------------------------------------------------------------------ ticking
  tick(_world: BlockWorld): void {
    // entities in chunks that aren't loaded (and their neighbours) don't tick, like vanilla's entity-ticking chunks
    const cx = Math.floor(this.x) >> 4, cz = Math.floor(this.z) >> 4;
    const w = this.s.world;
    if (!w.getChunk(cx, cz) || !w.getChunk(cx + 1, cz) || !w.getChunk(cx - 1, cz) || !w.getChunk(cx, cz + 1) || !w.getChunk(cx, cz - 1)) return;
    this.tickCount++;
    this.age++;
    this.sightCache.clear();
    this.baseTick();
    if (!this.removed) this.aiStep();
    this.tickHeadTurn();
  }

  /** Entity.baseTick + LivingEntity.baseTick */
  protected baseTick(): void {
    this.updateFluids();
    if (this.wasTouchingWater) this.fallDistance = 0;
    if (this.isInWaterOrRain() && this.remainingFireTicks > 0) this.remainingFireTicks = -1;
    if (this.remainingFireTicks > 0) {
      if (this.fireImmune) this.remainingFireTicks = Math.max(0, this.remainingFireTicks - 4);
      else {
        if (this.remainingFireTicks % 20 === 0 && this.lavaHeight <= 0) this.hurt({ id: 'onFire', bypassArmor: true, fire: true }, 1);
        this.remainingFireTicks--;
      }
    }
    if (this.lavaHeight > 0 && !this.fireImmune) {
      this.setSecondsOnFire(15);
      this.hurt({ id: 'lava', fire: true }, 4);
      this.fallDistance *= 0.5;
    }
    if (this.y < -64) this.hurt({ id: 'outOfWorld', bypassArmor: true }, 4);
    if (!this.dead && this.isInWall()) this.hurt({ id: 'inWall', bypassArmor: true }, 1);
    if (!this.dead && this.eyeInWater && !this.canBreatheUnderwater()) {
      this.airSupply--;
      if (this.airSupply === -20) {
        this.airSupply = 0;
        this.hurt({ id: 'drown', bypassArmor: true }, 2);
      }
    } else if (this.airSupply < 300) this.airSupply = Math.min(300, this.airSupply + 4);
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerableTime > 0) this.invulnerableTime--;
    if (this.dead) this.tickDeath();
    if (this.lastHurtByPlayerTime > 0) this.lastHurtByPlayerTime--;
    else this.lastHurtByPlayer = null;
    if (this.lastHurtByMob && (!targetAlive(this.lastHurtByMob, this.s) || this.tickCount - this.lastHurtByMobTimestamp > 100)) this.lastHurtByMob = null;
    // Mob.baseTick: ambient sounds
    if (!this.dead && this.rng.nextInt(1000) < this.ambientSoundTime++) {
      this.ambientSoundTime = -this.ambientSoundInterval();
      this.playSound(this.ambientSound(), this.soundVolume(), this.voicePitch());
    }
    const onFire = this.isOnFire();
    if (onFire !== this.sentOnFire) this.stateDirty = true;
  }

  canBreatheUnderwater(): boolean {
    return false;
  }

  protected tickDeath(): void {
    this.deathTime++;
    if (this.deathTime === 20) {
      this.entityEvent(ENTITY_EVENT.POOF);
      this.removed = true;
    }
  }

  private isInWall(): boolean {
    const w = this.width * 0.8, eye = this.y + this.eyeHeight;
    const x0 = Math.floor(this.x - w / 2), x1 = Math.floor(this.x + w / 2), z0 = Math.floor(this.z - w / 2), z1 = Math.floor(this.z + w / 2);
    const y = Math.floor(eye);
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (isSuffocating(this.world.getState(x, y, z))) return true;
    return false;
  }

  /** LivingEntity.aiStep */
  protected aiStep(): void {
    if (this.noJumpDelay > 0) this.noJumpDelay--;
    if (Math.abs(this.vx) < 0.003) this.vx = 0;
    if (Math.abs(this.vy) < 0.003) this.vy = 0;
    if (Math.abs(this.vz) < 0.003) this.vz = 0;
    if (this.dead) {
      this.jumping = false;
      this.xxa = this.zza = 0;
    } else this.serverAiStep();
    if (this.jumping) {
      const h = this.lavaHeight > 0 ? this.lavaHeight : this.waterHeight;
      const inW = this.wasTouchingWater && h > 0;
      const th = this.eyeHeight < 0.4 ? 0 : 0.4;
      if (inW && (!this.onGround || h > th)) this.vy += 0.04;
      else if (this.lavaHeight > 0 && (!this.onGround || h > th)) this.vy += 0.04;
      else if ((this.onGround || (inW && h <= th)) && this.noJumpDelay === 0) {
        this.jumpFromGround();
        this.noJumpDelay = 10;
      }
    } else this.noJumpDelay = 0;
    this.xxa *= 0.98;
    this.zza *= 0.98;
    this.travel(this.xxa, this.yya, this.zza);
    this.pushEntities();
  }

  /** Mob.serverAiStep */
  protected serverAiStep(): void {
    this.noActionTime++;
    this.targetSelector.tick();
    this.goalSelector.tick();
    this.navigation.tick();
    this.customServerAiStep();
    this.moveControl.tick();
    this.lookControl.tick();
    this.jumpControl.tick();
  }

  protected customServerAiStep(): void {}

  jumpFromGround(): void {
    const f = 0.42 * this.jumpFactor();
    this.vy = f;
  }

  private jumpFactor(): number {
    const a = JUMP_FACTOR[STATE_TO_BLOCK[this.world.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))]!]!;
    return a === 1 ? JUMP_FACTOR[STATE_TO_BLOCK[this.blockBelow()]!]! : a;
  }

  private blockBelow(): number {
    return this.world.getState(Math.floor(this.x), Math.floor(this.y - 0.5000001), Math.floor(this.z));
  }

  /** Mob.setSpeed: speed and forward impulse. */
  setSpeed(s: number): void {
    this.speed = s;
    this.zza = s;
  }

  /** whether this mob is climbing (ladders/vines; spiders override) */
  onClimbable(): boolean {
    return CLIMBABLE[STATE_TO_BLOCK[this.world.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))]!] === 1;
  }

  /** gravity multiplier hook (chickens flap) */
  protected afterTravel(): void {}

  /** LivingEntity.travel */
  travel(strafe: number, up: number, forward: number): void {
    const falling = this.vy <= 0;
    if (this.wasTouchingWater) {
      const y0 = this.y;
      this.moveRelative(0.02, strafe, up, forward);
      this.move(this.vx, this.vy, this.vz);
      if (this.horizontalCollision && this.onClimbable()) this.vy = 0.2;
      this.vx *= 0.8;
      this.vy *= 0.8;
      this.vz *= 0.8;
      this.vy = falling && Math.abs(this.vy - 0.005) >= 0.003 && Math.abs(this.vy - GRAVITY / 16) < 0.003 ? -0.003 : this.vy - GRAVITY / 16;
      if (this.horizontalCollision && this.isFree(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
    } else if (this.lavaHeight > 0) {
      const y0 = this.y;
      this.moveRelative(0.02, strafe, up, forward);
      this.move(this.vx, this.vy, this.vz);
      if (this.lavaHeight <= (this.eyeHeight < 0.4 ? 0 : 0.4)) {
        this.vx *= 0.5;
        this.vy *= 0.8;
        this.vz *= 0.5;
        this.vy = falling && Math.abs(this.vy - 0.005) >= 0.003 && Math.abs(this.vy - GRAVITY / 16) < 0.003 ? -0.003 : this.vy - GRAVITY / 16;
      } else {
        this.vx *= 0.5;
        this.vy *= 0.5;
        this.vz *= 0.5;
      }
      this.vy -= GRAVITY / 4;
      if (this.horizontalCollision && this.isFree(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
    } else {
      const friction = FRICTION[STATE_TO_BLOCK[this.blockBelow()]!]!;
      const f3 = this.onGround ? friction * 0.91 : 0.91;
      const sp = this.onGround ? this.speed * (0.21600002 / (friction * friction * friction)) : 0.02;
      this.moveRelative(sp, strafe, up, forward);
      if (this.onClimbable()) {
        this.fallDistance = 0;
        this.vx = Math.max(-0.15, Math.min(0.15, this.vx));
        this.vz = Math.max(-0.15, Math.min(0.15, this.vz));
        this.vy = Math.max(this.vy, -0.15);
      }
      this.move(this.vx, this.vy, this.vz);
      if ((this.horizontalCollision || this.jumping) && this.onClimbable()) this.vy = 0.2;
      let vy = this.vy;
      if (this.world.isLoaded(Math.floor(this.x), Math.floor(this.z))) vy -= GRAVITY;
      else vy = this.y > 0 ? -0.1 : 0;
      this.vx *= f3;
      this.vy = vy * 0.98;
      this.vz *= f3;
    }
    this.afterTravel();
  }

  private isFree(dx: number, dy: number, dz: number): boolean {
    const bb = this.bb().move(dx, dy, dz);
    if (!noCollision(this.world, bb)) return false;
    for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y < Math.ceil(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) if (FLUID[this.world.getState(x, y, z)] !== 0) return false;
    return true;
  }

  private moveRelative(speed: number, strafe: number, up: number, forward: number): void {
    let len = strafe * strafe + up * up + forward * forward;
    if (len < 1e-7) return;
    if (len > 1) {
      len = Math.sqrt(len);
      strafe /= len;
      up /= len;
      forward /= len;
    }
    strafe *= speed;
    up *= speed;
    forward *= speed;
    const r = (this.yaw * Math.PI) / 180;
    const s = Math.sin(r), c = Math.cos(r);
    this.vx += strafe * c - forward * s;
    this.vy += up;
    this.vz += forward * c + strafe * s;
  }

  /** Entity.collide with step-up */
  private collide(dx: number, dy: number, dz: number): [number, number, number] {
    const w = this.world;
    const bb = this.bb();
    const r = collideBox(w, bb, dx, dy, dz);
    const cx = r[0] !== dx, cy = r[1] !== dy, cz = r[2] !== dz;
    const grounded = this.onGround || (cy && dy < 0);
    const step = this.maxUpStep;
    if (step > 0 && grounded && (cx || cz)) {
      let s1 = collideBox(w, bb, dx, step, dz);
      const s2 = collideBox(w, bb.expandTowards(dx, 0, dz), 0, step, 0);
      if (s2[1] < step) {
        const h = collideBox(w, bb.move(0, s2[1], 0), dx, 0, dz);
        const s3: [number, number, number] = [h[0], h[1] + s2[1], h[2]];
        if (s3[0] * s3[0] + s3[2] * s3[2] > s1[0] * s1[0] + s1[2] * s1[2]) s1 = s3;
      }
      if (s1[0] * s1[0] + s1[2] * s1[2] > r[0] * r[0] + r[2] * r[2]) {
        const down = collideBox(w, bb.move(s1[0], s1[1], s1[2]), 0, -s1[1] + dy, 0);
        return [s1[0], s1[1] + down[1], s1[2]];
      }
    }
    return r;
  }

  /** Entity.move(SELF) */
  move(dx: number, dy: number, dz: number): void {
    if (this.stuck) {
      dx *= this.stuck[0];
      dy *= this.stuck[1];
      dz *= this.stuck[2];
      this.stuck = null;
      this.vx = this.vy = this.vz = 0;
    }
    // resting fast path: standing still on unchanged ground needs no collision pass
    if (this.onGround && dx === 0 && dz === 0 && dy <= 0 && dy > -0.2 && this.restVersion >= 0 && this.x === this.restX && this.y === this.restY && this.z === this.restZ) {
      const c = this.world.getChunk(Math.floor(this.x) >> 4, Math.floor(this.z) >> 4);
      if (c && c.version === this.restVersion) {
        this.vy = 0;
        this.fallDistance = 0;
        this.horizontalCollision = false;
        this.checkInsideBlocks();
        return;
      }
    }
    this.restVersion = -1;
    const [mx, my, mz] = this.collide(dx, dy, dz);
    this.x += mx;
    this.y += my;
    this.z += mz;
    this.horizontalCollision = Math.abs(dx - mx) > 1e-5 || Math.abs(dz - mz) > 1e-5;
    const vertical = dy !== my;
    const wasOnGround = this.onGround;
    this.onGround = vertical && dy < 0;
    if (this.onGround) {
      if (this.fallDistance > 0) {
        // Block.fallOn: farmland trampling and friends (server/src/game/blocks.ts)
        this.s.blocks.entityFallOn(this.x, this.y, this.z, this.fallDistance, { width: this.width, height: this.height, player: false });
        this.causeFallDamage(this.fallDistance);
      }
      this.fallDistance = 0;
    } else if (my < 0) this.fallDistance -= my;
    if (Math.abs(dx - mx) > 1e-5) this.vx = 0;
    if (Math.abs(dz - mz) > 1e-5) this.vz = 0;
    if (vertical) {
      const below = this.world.getState(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
      const n = blockNameOf(below);
      if (n === 'slime_block' && this.vy < 0) this.vy = -this.vy;
      else if (n.endsWith('_bed') && this.vy < 0) this.vy = -this.vy * 0.66;
      else this.vy = 0;
    }
    void wasOnGround;
    // step sounds (Entity.move → playStepSound)
    const horiz = Math.hypot(mx, mz);
    this.moveDist += horiz * 0.6;
    if (this.onGround && this.moveDist > this.nextStep) {
      this.nextStep = Math.floor(this.moveDist) + 1;
      const below = this.world.getState(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
      if (below !== 0 && !this.wasTouchingWater) {
        const ev = this.stepSound();
        if (ev) this.playSound(ev, 0.15, 1);
        else {
          const st = soundTypeOf(below);
          this.playSound(st.step, st.volume * 0.15, st.pitch);
        }
      }
    }
    if (this.onGround && mx === 0 && mz === 0 && dx === 0 && dz === 0) {
      const c = this.world.getChunk(Math.floor(this.x) >> 4, Math.floor(this.z) >> 4);
      if (c) {
        this.restVersion = c.version;
        this.restX = this.x;
        this.restY = this.y;
        this.restZ = this.z;
      }
    }
    this.checkInsideBlocks();
    const sf = this.speedFactor();
    this.vx *= sf;
    this.vz *= sf;
  }

  private speedFactor(): number {
    const f = SPEED_FACTOR[STATE_TO_BLOCK[this.world.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))]!]!;
    return f === 1 ? SPEED_FACTOR[STATE_TO_BLOCK[this.blockBelow()]!]! : f;
  }

  private checkInsideBlocks(): void {
    const bb = this.bb().inflate(-0.001);
    this.isInPowderSnow = false;
    for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++) {
          const st = this.world.getState(x, y, z);
          if (st === 0) continue;
          const b = STATE_TO_BLOCK[st]!;
          const n = blockNameOf(st);
          if (n === 'powder_snow') this.isInPowderSnow = true;
          if (STUCK[b * 3]) {
            this.fallDistance = 0;
            this.stuck = [STUCK[b * 3]!, STUCK[b * 3 + 1]!, STUCK[b * 3 + 2]!];
          }
          if (n === 'cactus') this.hurt({ id: 'cactus' }, 1);
          else if (n === 'sweet_berry_bush' && this.type !== 'fox') this.hurt({ id: 'sweetBerryBush' }, 1);
          else if (n === 'fire' || n === 'soul_fire') {
            if (!this.fireImmune) {
              this.remainingFireTicks++;
              if (this.remainingFireTicks === 0) this.setSecondsOnFire(8);
            }
            this.hurt({ id: 'inFire', bypassArmor: true, fire: true }, n === 'soul_fire' ? 2 : 1);
          }
        }
    if (this.onGround && blockNameOf(this.blockBelowFeet()) === 'magma_block') this.hurt({ id: 'hotFloor', fire: true }, 1);
  }

  private blockBelowFeet(): number {
    return this.world.getState(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
  }

  /** LivingEntity.causeFallDamage (safe fall distance 3) */
  protected causeFallDamage(dist: number): void {
    const below = this.blockBelowFeet();
    const n = blockNameOf(below);
    let mult = 1;
    if (n === 'hay_block' || n === 'honey_block') mult = 0.2;
    else if (n.endsWith('_bed')) mult = 0.5;
    else if (n === 'slime_block' || n === 'powder_snow') mult = 0;
    const dmg = Math.ceil((dist - 3) * mult);
    if (dmg <= 0) return;
    this.playSound(dmg > 4 ? this.bigFallSound() : this.smallFallSound(), 1, 1);
    if (below !== 0) {
      const st = soundTypeOf(below);
      this.playSound(st.fall, st.volume * 0.5, st.pitch * 0.75);
    }
    this.hurt({ id: 'fall', bypassArmor: true, fall: true }, dmg);
  }
  protected smallFallSound(): string {
    return this.category === 'monster' ? 'entity.hostile.small_fall' : 'entity.generic.small_fall';
  }
  protected bigFallSound(): string {
    return this.category === 'monster' ? 'entity.hostile.big_fall' : 'entity.generic.big_fall';
  }

  /** Entity.updateInWaterStateAndDoFluidPushing (heights only; no current push) + eye-in-water. */
  private updateFluids(): void {
    const bb = this.bb().inflate(-0.001);
    let wh = 0, lh = 0, touchW = false;
    for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y < Math.ceil(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) {
          const st = this.world.getState(x, y, z);
          const k = FLUID[st];
          if (!k) continue;
          const above = FLUID[this.world.getState(x, y + 1, z)] === k;
          const lvl = FLUID_LEVEL[st]!;
          const h = above ? 1 : (lvl >= 8 || lvl === 255 ? 8 : 8 - lvl) / 9;
          const top = y + h;
          if (top < bb.minY) continue;
          if (k === 1) {
            touchW = true;
            wh = Math.max(wh, top - bb.minY);
          } else lh = Math.max(lh, top - bb.minY);
        }
    this.wasTouchingWater = touchW;
    this.waterHeight = wh;
    this.lavaHeight = lh;
    const eyeY = this.y + this.eyeHeight - 0.11111111;
    const st = this.world.getState(Math.floor(this.x), Math.floor(eyeY), Math.floor(this.z));
    if (FLUID[st] === 1) {
      const lvl = FLUID_LEVEL[st]!;
      const above = FLUID[this.world.getState(Math.floor(this.x), Math.floor(eyeY) + 1, Math.floor(this.z))] === 1;
      const h = above ? 1 : (lvl >= 8 || lvl === 255 ? 8 : 8 - lvl) / 9;
      this.eyeInWater = Math.floor(eyeY) + h > eyeY;
    } else this.eyeInWater = false;
  }

  /** LivingEntity.pushEntities (mob–mob separation, Entity.push) */
  private pushEntities(): void {
    if (this.dead) return;
    const bb = this.bb();
    // players push mobs too (the player's own push happens on its client)
    for (const p of this.s.players) {
      if (p.gameMode === 3 || p.living.dead || Math.abs(p.x - this.x) > 3 || Math.abs(p.z - this.z) > 3) continue;
      const pb = AABB.ofSize(p.x, p.y, p.z, 0.6, p.pose === 'crouching' ? 1.5 : 1.8);
      if (!bb.intersects(pb)) continue;
      let dx = p.x - this.x, dz = p.z - this.z;
      let d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d < 0.01) continue;
      d = Math.sqrt(d);
      const k = Math.min(1, 1 / d);
      dx = (dx / d) * k * 0.05;
      dz = (dz / d) * k * 0.05;
      this.vx -= dx;
      this.vz -= dz;
    }
    for (const o of this.s.mobs.nearbyMobs(this.x, this.z, 2)) {
      if (o === this || o.dead || !(o instanceof Mob)) continue;
      if (!bb.intersects(o.bb())) continue;
      let dx = o.x - this.x, dz = o.z - this.z;
      let d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d < 0.01) continue;
      d = Math.sqrt(d);
      dx /= d;
      dz /= d;
      let k = 1 / d;
      if (k > 1) k = 1;
      dx *= k * 0.05;
      dz *= k * 0.05;
      this.vx -= dx;
      this.vz -= dz;
      o.vx += dx;
      o.vz += dz;
    }
  }

  /** Mob.tickHeadTurn → BodyRotationControl.clientTick */
  private headStableTime = 0;
  private lastStableYHeadRot = 0;
  protected tickHeadTurn(): void {
    const dx = this.x - this.prevX, dz = this.z - this.prevZ;
    this.prevX = this.x;
    this.prevZ = this.z;
    if (dx * dx + dz * dz > 2.5e-7) {
      this.yBodyRot = this.yaw;
      this.yHeadRot = rotateIfNecessary(this.yHeadRot, this.yBodyRot, 75);
      this.lastStableYHeadRot = this.yHeadRot;
      this.headStableTime = 0;
    } else if (Math.abs(this.yHeadRot - this.lastStableYHeadRot) > 15) {
      this.lastStableYHeadRot = this.yHeadRot;
      this.headStableTime = 0;
      this.yBodyRot = rotateIfNecessary(this.yBodyRot, this.yHeadRot, 75);
    } else {
      this.headStableTime++;
      if (this.headStableTime > 10) {
        const f = Math.max(0, Math.min(1, (this.headStableTime - 10) / 10));
        this.yBodyRot = rotateIfNecessary(this.yBodyRot, this.yHeadRot, 75 * (1 - f));
      }
    }
  }
  private prevX = 0;
  private prevZ = 0;

  /** look straight at a target (Mob.lookAt: turns body yaw/pitch immediately, limited) */
  lookAt(t: Target, maxY: number, maxX: number): void {
    const dx = t.x - this.x, dz = t.z - this.z;
    const dy = t.y + targetEye(t) - (this.y + this.eyeHeight);
    const h = Math.hypot(dx, dz);
    const yaw = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
    const pitch = -(Math.atan2(dy, h) * 180) / Math.PI;
    this.pitch = rotlerp(this.pitch, pitch, maxX);
    this.yaw = rotlerp(this.yaw, yaw, maxY);
  }

  /** PathfinderMob.getWalkTargetValue */
  walkTargetValue(_x: number, _y: number, _z: number): number {
    return 0;
  }

  /** Mob.removeWhenFarAway */
  removeWhenFarAway(_d2: number): boolean {
    return true;
  }

  shouldDespawnInPeaceful(): boolean {
    return false;
  }

  /** player right-click (Mob.mobInteract); returns true when consumed */
  interact(_p: ServerPlayer, _hand: number): boolean {
    return false;
  }
}

export function wrapDegrees(a: number): number {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

export function rotlerp(from: number, to: number, max: number): number {
  let d = wrapDegrees(to - from);
  if (d > max) d = max;
  if (d < -max) d = -max;
  let r = from + d;
  if (r < 0) r += 360;
  else if (r > 360) r -= 360;
  return r;
}

function rotateTowards(from: number, to: number, max: number): number {
  const d = wrapDegrees(to - from);
  return from + Math.max(-max, Math.min(max, d));
}

function rotateIfNecessary(a: number, b: number, max: number): number {
  const d = wrapDegrees(b - a);
  if (d < -max) return b + max;
  if (d > max) return b - max;
  return a;
}

// -------------------------------------------------------------------- controls
export class JumpControl {
  jump = false;
  constructor(private readonly mob: Mob) {}
  tick(): void {
    this.mob.jumping = this.jump;
    this.jump = false;
  }
}

export class LookControl {
  wantedX = 0;
  wantedY = 0;
  wantedZ = 0;
  yMaxRotSpeed = 0;
  xMaxRotSpeed = 0;
  cooldown = 0;
  constructor(private readonly mob: Mob) {}
  setLookAt(x: number, y: number, z: number, ySpeed = 10, xSpeed = 40): void {
    this.wantedX = x;
    this.wantedY = y;
    this.wantedZ = z;
    this.yMaxRotSpeed = ySpeed;
    this.xMaxRotSpeed = xSpeed;
    this.cooldown = 2;
  }
  setLookAtEntity(t: Target, ySpeed: number, xSpeed: number): void {
    this.setLookAt(t.x, t.y + targetEye(t), t.z, ySpeed, xSpeed);
  }
  tick(): void {
    const m = this.mob;
    m.pitch = 0;
    if (this.cooldown > 0) {
      this.cooldown--;
      const dx = this.wantedX - m.x, dz = this.wantedZ - m.z;
      if (Math.hypot(dx, dz) > 1e-5) m.yHeadRot = rotateTowards(m.yHeadRot, (Math.atan2(dz, dx) * 180) / Math.PI - 90, this.yMaxRotSpeed);
      const dy = this.wantedY - (m.y + m.eyeHeight);
      const h = Math.hypot(dx, dz);
      if (Math.abs(dy) > 1e-5 || h > 1e-5) m.pitch = rotateTowards(m.pitch, -(Math.atan2(dy, h) * 180) / Math.PI, this.xMaxRotSpeed);
    } else m.yHeadRot = rotateTowards(m.yHeadRot, m.yBodyRot, 10);
    if (!m.navigation.isDone()) m.yHeadRot = rotateIfNecessary(m.yHeadRot, m.yBodyRot, 75);
  }
}

const enum MoveOp {
  WAIT, MOVE_TO, STRAFE, JUMPING,
}

export class MoveControl {
  wantedX = 0;
  wantedY = 0;
  wantedZ = 0;
  speedModifier = 0;
  strafeForwards = 0;
  strafeRight = 0;
  private op = MoveOp.WAIT;
  constructor(protected readonly mob: Mob) {}
  hasWanted(): boolean {
    return this.op === MoveOp.MOVE_TO;
  }
  setWantedPosition(x: number, y: number, z: number, speed: number): void {
    this.wantedX = x;
    this.wantedY = y;
    this.wantedZ = z;
    this.speedModifier = speed;
    if (this.op !== MoveOp.JUMPING) this.op = MoveOp.MOVE_TO;
  }
  strafe(forward: number, right: number): void {
    this.op = MoveOp.STRAFE;
    this.strafeForwards = forward;
    this.strafeRight = right;
    this.speedModifier = 0.25;
  }
  tick(): void {
    const m = this.mob;
    if (this.op === MoveOp.STRAFE) {
      const f1 = this.speedModifier * m.movementSpeedValue();
      let f2 = this.strafeForwards, f3 = this.strafeRight;
      let f4 = Math.sqrt(f2 * f2 + f3 * f3);
      if (f4 < 1) f4 = 1;
      f4 = f1 / f4;
      f2 *= f4;
      f3 *= f4;
      const r = (m.yaw * Math.PI) / 180;
      const s = Math.sin(r), c = Math.cos(r);
      const wx = f2 * c - f3 * s, wz = f3 * c + f2 * s;
      if (!this.isWalkable(wx, wz)) {
        this.strafeForwards = 1;
        this.strafeRight = 0;
        f2 = f1;
        f3 = 0;
      }
      m.setSpeed(f1);
      m.zza = f2;
      m.xxa = f3;
      this.op = MoveOp.WAIT;
    } else if (this.op === MoveOp.MOVE_TO) {
      this.op = MoveOp.WAIT;
      const dx = this.wantedX - m.x, dz = this.wantedZ - m.z, dy = this.wantedY - m.y;
      if (dx * dx + dy * dy + dz * dz < 2.5e-7) {
        m.zza = 0;
        return;
      }
      m.yaw = rotlerp(m.yaw, (Math.atan2(dz, dx) * 180) / Math.PI - 90, 90);
      m.setSpeed(this.speedModifier * m.movementSpeedValue());
      const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
      const st = m.world.getState(bx, by, bz);
      const n = blockNameOf(st);
      let top = -Infinity;
      for (const b of collisionBoxes(st)) top = Math.max(top, b[4]);
      if ((dy > m.maxUpStep && dx * dx + dz * dz < Math.max(1, m.width)) || (top > -Infinity && m.y < top + by && !n.endsWith('_door') && !n.endsWith('_fence'))) {
        m.jumpControl.jump = true;
        this.op = MoveOp.JUMPING;
      }
    } else if (this.op === MoveOp.JUMPING) {
      m.setSpeed(this.speedModifier * m.movementSpeedValue());
      if (m.onGround) this.op = MoveOp.WAIT;
    } else m.zza = 0;
  }
  private isWalkable(dx: number, dz: number): boolean {
    const m = this.mob;
    const x = Math.floor(m.x + dx), y = Math.floor(m.y), z = Math.floor(m.z + dz);
    const t = staticTypeFor(m, x, y, z);
    return t === PathType.WALKABLE || t === PathType.OPEN;
  }
}

function staticTypeFor(m: Mob, x: number, y: number, z: number): PathType {
  return staticPathType(m.world, x, y, z);
}

// -------------------------------------------------------------------- navigation
/** GroundPathNavigation */
export class GroundNavigation {
  path: Path | null = null;
  speedModifier = 1;
  canFloat = false;
  canOpenDoors = false;
  /** RestrictSunGoal: paths are cut before the first node under open sky */
  avoidSun = false;
  private tickN = 0;
  private lastStuckCheck = 0;
  private lastStuckX = 0;
  private lastStuckY = 0;
  private lastStuckZ = 0;
  constructor(protected readonly mob: Mob) {}

  isDone(): boolean {
    return !this.path || this.path.done;
  }

  stop(): void {
    this.path = null;
  }

  private pathMob(): PathMob {
    const m = this.mob;
    return {
      x: m.x, y: m.y, z: m.z, width: m.width, height: m.height, onGround: m.onGround, maxUpStep: m.maxUpStep,
      canFloat: this.canFloat, canOpenDoors: this.canOpenDoors, malus: (t) => m.malus(t), maxFallDistance: () => m.maxFallDistance(),
    };
  }

  canUpdatePath(): boolean {
    return this.mob.onGround || this.mob.wasTouchingWater || this.mob.lavaHeight > 0;
  }

  createPath(x: number, y: number, z: number, accuracy: number): Path | null {
    if (y < 0 || !this.canUpdatePath()) return null;
    const p = this.path;
    if (p && !p.done && p.target.x === x && p.target.y === y && p.target.z === z) return p;
    return findPath(this.mob.world, this.pathMob(), x, y, z, this.mob.followRange, accuracy);
  }

  createPathTo(t: Target, accuracy = 1): Path | null {
    return this.createPath(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z), accuracy);
  }

  moveTo(x: number, y: number, z: number, speed: number): boolean {
    return this.moveAlong(this.createPath(Math.floor(x), Math.floor(y), Math.floor(z), 1), speed);
  }

  moveToEntity(t: Target, speed: number): boolean {
    const p = this.createPathTo(t, 1);
    return p !== null && this.moveAlong(p, speed);
  }

  moveAlong(p: Path | null, speed: number): boolean {
    if (!p) {
      this.path = null;
      return false;
    }
    this.path = p;
    if (this.isDone()) return false;
    // trimPath: skip the start node(s) we already stand on
    const m = this.mob;
    while (!p.done && p.index < p.nodes.length - 1 && p.next.x === Math.floor(m.x) && p.next.z === Math.floor(m.z) && Math.abs(p.next.y - m.y) < 1) p.advance();
    if (p.done) return false;
    // GroundPathNavigation.trimPath with avoidSun
    if (this.avoidSun && !m.canSeeSky(Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z))) {
      for (let i = p.index; i < p.nodes.length; i++) {
        const n = p.nodes[i]!;
        if (m.canSeeSky(n.x, n.y, n.z)) {
          p.nodes.length = i;
          break;
        }
      }
      if (p.done) return false;
    }
    this.speedModifier = speed;
    this.lastStuckCheck = this.tickN;
    this.lastStuckX = m.x;
    this.lastStuckY = m.y;
    this.lastStuckZ = m.z;
    return true;
  }

  tick(): void {
    this.tickN++;
    if (this.isDone()) return;
    const m = this.mob;
    if (this.canUpdatePath()) this.followThePath();
    if (this.isDone()) return;
    const n = this.path!.next;
    const off = Math.floor(m.width + 1) * 0.5;
    let ty = n.y;
    // GroundPathNavigation.getGroundY: aim at the surface when swimming
    if (this.canFloat && m.wasTouchingWater && FLUID[m.world.getState(n.x, n.y, n.z)] === 1) ty = n.y + 0.5;
    m.moveControl.setWantedPosition(n.x + off, ty, n.z + off, this.speedModifier);
  }

  private followThePath(): void {
    const m = this.mob, p = this.path!;
    const maxD = m.width > 0.75 ? m.width / 2 : 0.75 - m.width / 2;
    const n = p.next;
    const dx = Math.abs(m.x - (n.x + 0.5)), dy = Math.abs(m.y - n.y), dz = Math.abs(m.z - (n.z + 0.5));
    if (dx < maxD && dz < maxD && dy < 1) p.advance();
    else if (!p.done && p.index + 1 < p.nodes.length) {
      // shouldTargetNextNodeInDirection: past the current node towards the next one
      const nn = p.nodes[p.index + 1]!;
      const ax = nn.x + 0.5 - (n.x + 0.5), az = nn.z + 0.5 - (n.z + 0.5);
      const bx = m.x - (n.x + 0.5), bz = m.z - (n.z + 0.5);
      if (nn.y <= n.y && ax * bx + az * bz > 0 && Math.abs(m.y - n.y) < 1 && Math.hypot(bx, bz) < 1) p.advance();
    }
    // doStuckDetection
    if (this.tickN - this.lastStuckCheck > 100) {
      if ((m.x - this.lastStuckX) ** 2 + (m.y - this.lastStuckY) ** 2 + (m.z - this.lastStuckZ) ** 2 < 2.25) this.stop();
      this.lastStuckCheck = this.tickN;
      this.lastStuckX = m.x;
      this.lastStuckY = m.y;
      this.lastStuckZ = m.z;
    }
  }
}

export { AABB };
