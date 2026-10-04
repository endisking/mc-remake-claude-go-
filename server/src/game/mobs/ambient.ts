/** Ambient and water mobs: bats and squid (vanilla Bat / Squid, 1.17.1). */
import { blockNameOf } from '@shared/world/blockstate';
import { FULL_COLLISION, FLUID } from '@shared/world/blockinfo';
import type { DamageSource } from '../survival';
import { Goal } from './goal';
import { Mob, wrapDegrees, type MobCategory, type Target } from './mob';
import { MOB_FLAG } from '@shared/entity/mobdata';

export class Bat extends Mob {
  readonly type = 'bat';
  readonly category: MobCategory = 'ambient';
  readonly trackRange = 80;
  readonly maxHealth = 6;
  readonly width = 0.5;
  readonly height = 0.9;
  resting = true;
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private hasTarget = false;
  override get eyeHeight(): number {
    return this.height / 2;
  }
  protected registerGoals(): void {}
  override mobFlags(): number {
    return super.mobFlags() | (this.resting ? MOB_FLAG.RESTING : 0);
  }
  private setResting(v: boolean): void {
    if (v === this.resting) return;
    this.resting = v;
    this.flagsDirty = true;
    if (!v) this.playSound('entity.bat.takeoff', 0.05, (this.rng.nextFloat() - this.rng.nextFloat()) * 0.2 + 1);
  }
  override hurt(src: DamageSource, amount: number, attacker: Target | null = null): boolean {
    const ok = super.hurt(src, amount, attacker);
    if (ok) this.setResting(false);
    return ok;
  }
  protected override causeFallDamage(): void {}
  override tick(world: Parameters<Mob['tick']>[0]): void {
    super.tick(world);
    // Bat.tick
    if (this.resting) {
      this.vx = this.vy = this.vz = 0;
      this.y = Math.floor(this.y) + 1 - this.height;
    } else this.vy *= 0.6;
  }
  protected override customServerAiStep(): void {
    const w = this.world, r = this.rng;
    const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    const ceiling = FULL_COLLISION[w.getState(bx, by + 1, bz)] === 1;
    if (this.resting) {
      if (ceiling) {
        if (r.nextInt(200) === 0) this.yHeadRot = r.nextInt(360);
        if (this.s.mobs.nearestPlayer(this.x, this.y, this.z, 4, (p) => p.gameMode !== 3)) this.setResting(false);
      } else this.setResting(false);
      return;
    }
    if (this.hasTarget && (w.getState(this.tx, this.ty, this.tz) !== 0 || this.ty < 1)) this.hasTarget = false;
    if (!this.hasTarget || r.nextInt(30) === 0 || (this.tx + 0.5 - this.x) ** 2 + (this.ty + 0.5 - this.y) ** 2 + (this.tz + 0.5 - this.z) ** 2 < 4) {
      this.tx = bx + r.nextInt(7) - r.nextInt(7);
      this.ty = Math.floor(this.y + r.nextInt(6) - 2);
      this.tz = bz + r.nextInt(7) - r.nextInt(7);
      this.hasTarget = true;
    }
    const d2 = this.tx + 0.5 - this.x, d0 = this.ty + 0.1 - this.y, d1 = this.tz + 0.5 - this.z;
    this.vx += (Math.sign(d2) * 0.5 - this.vx) * 0.1;
    this.vy += (Math.sign(d0) * 0.7 - this.vy) * 0.1;
    this.vz += (Math.sign(d1) * 0.5 - this.vz) * 0.1;
    const f = (Math.atan2(this.vz, this.vx) * 180) / Math.PI - 90;
    this.zza = 0.5;
    this.yaw += wrapDegrees(f - this.yaw);
    if (r.nextInt(100) === 0 && ceiling) this.setResting(true);
  }
  override ambientSound(): string | null {
    return this.resting && this.rng.nextInt(4) !== 0 ? null : 'entity.bat.ambient';
  }
  override hurtSound(): string {
    return 'entity.bat.hurt';
  }
  override deathSound(): string {
    return 'entity.bat.death';
  }
  override soundVolume(): number {
    return 0.1;
  }
  override voicePitch(): number {
    return super.voicePitch() * 0.95;
  }
}

class SquidRandomMovementGoal extends Goal {
  constructor(private readonly sq: Squid) {
    super();
  }
  canUse(): boolean {
    return true;
  }
  override tick(): void {
    const sq = this.sq, r = sq.rng;
    if (sq.noActionTime > 100) sq.setMovement(0, 0, 0);
    else if (r.nextInt(50) === 0 || !sq.wasTouchingWater || !sq.hasMovement()) {
      const f = r.nextFloat() * Math.PI * 2;
      sq.setMovement(Math.cos(f) * 0.2, -0.1 + r.nextFloat() * 0.2, Math.sin(f) * 0.2);
    }
  }
}

class SquidFleeGoal extends Goal {
  private fleeTicks = 0;
  constructor(private readonly sq: Squid) {
    super();
  }
  canUse(): boolean {
    const a = this.sq.lastHurtByMob;
    return !!a && this.sq.wasTouchingWater && this.sq.distanceToTargetSqr(a) < 100;
  }
  override start(): void {
    this.fleeTicks = 0;
  }
  override canContinueToUse(): boolean {
    return this.canUse() && this.fleeTicks < 100;
  }
  override tick(): void {
    this.fleeTicks++;
    const sq = this.sq, a = sq.lastHurtByMob!;
    let dx = sq.x - a.x, dy = sq.y - a.y, dz = sq.z - a.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    sq.setMovement(dx * 0.15, dy * 0.15, dz * 0.15);
  }
}

export class Squid extends Mob {
  readonly type = 'squid';
  readonly category: MobCategory = 'water_creature';
  readonly trackRange = 128;
  readonly maxHealth = 10;
  readonly width = 0.8;
  readonly height = 0.8;
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private moveSpeed = 0;
  private tentacle = 0;
  private tentacleSpeed = 0;
  override get eyeHeight(): number {
    return this.height * 0.5;
  }
  override init(): void {
    super.init();
    this.tentacleSpeed = (1 / (this.rng.nextFloat() + 1)) * 0.2;
  }
  protected registerGoals(): void {
    this.goalSelector.add(0, new SquidRandomMovementGoal(this));
    this.goalSelector.add(1, new SquidFleeGoal(this));
  }
  setMovement(x: number, y: number, z: number): void {
    this.tx = x;
    this.ty = y;
    this.tz = z;
  }
  hasMovement(): boolean {
    return this.tx !== 0 || this.ty !== 0 || this.tz !== 0;
  }
  override canBreatheUnderwater(): boolean {
    return true;
  }
  override experienceReward(): number {
    return 1 + this.rng.nextInt(3);
  }
  /** Squid.aiStep (server part): pulse forward with the tentacle cycle in water, fall outside */
  protected override aiStep(): void {
    super.aiStep();
    this.tentacle += this.tentacleSpeed;
    if (this.tentacle > Math.PI * 2) {
      this.tentacle -= Math.PI * 2;
      if (this.rng.nextInt(10) === 0) this.tentacleSpeed = (1 / (this.rng.nextFloat() + 1)) * 0.2;
    }
    if (this.wasTouchingWater) {
      if (this.tentacle < Math.PI) {
        if (this.tentacle / Math.PI > 0.75) this.moveSpeed = 1;
      } else this.moveSpeed *= 0.9;
      this.vx = this.tx * this.moveSpeed;
      this.vy = this.ty * this.moveSpeed;
      this.vz = this.tz * this.moveSpeed;
      const h = Math.hypot(this.vx, this.vz);
      if (h > 1e-4) this.yaw += ((-Math.atan2(this.vx, this.vz) * 180) / Math.PI - this.yaw) * 0.1;
      this.yBodyRot = this.yHeadRot = this.yaw;
    } else {
      this.vx = 0;
      this.vz = 0;
      this.vy = (this.vy - 0.08) * 0.98;
    }
  }
  override travel(): void {
    this.move(this.vx, this.vy, this.vz);
  }
  protected override baseTick(): void {
    const air = this.airSupply;
    super.baseTick();
    // WaterAnimal.handleAirSupply: suffocates out of water
    if (!this.dead && !this.wasTouchingWater) {
      this.airSupply = air - 1;
      if (this.airSupply === -20) {
        this.airSupply = 0;
        this.hurt({ id: 'drown', bypassArmor: true }, 2);
      }
    } else this.airSupply = 300;
  }
  override hurt(src: DamageSource, amount: number, attacker: Target | null = null): boolean {
    const ok = super.hurt(src, amount, attacker);
    if (ok && attacker && !this.dead) this.playSound('entity.squid.squirt', this.soundVolume(), this.voicePitch());
    return ok;
  }
  override ambientSound(): string {
    return 'entity.squid.ambient';
  }
  override hurtSound(): string {
    return 'entity.squid.hurt';
  }
  override deathSound(): string {
    return 'entity.squid.death';
  }
  override soundVolume(): number {
    return 0.4;
  }
  override walkTargetValue(): number {
    return 0;
  }
}

export function isWater(state: number): boolean {
  return FLUID[state] === 1 || blockNameOf(state) === 'bubble_column';
}
