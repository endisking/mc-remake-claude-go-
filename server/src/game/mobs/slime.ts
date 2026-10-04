/** Slimes (vanilla Slime, 1.17.1): hopping movement, sizes 1/2/4, contact damage, splitting, slime chunks. */
import { JavaRandom } from '@shared/util/random';
import { Goal, Flag } from './goal';
import { Mob, MoveControl, rotlerp, canTarget, type MobCategory } from './mob';
import { NearestAttackableTargetGoal } from './goals';
import type { DamageSource } from '../survival';
import type { ServerPlayer } from '../player';
import { AABB } from '@shared/entity/aabb';

/** SlimeMoveControl: turn towards a direction and hop every 10–29 ticks (a third of that when hunting). */
class SlimeMoveControl extends MoveControl {
  private yRotWanted = 0;
  private jumpDelay = 0;
  private isAggressive = false;
  private moving = false;
  constructor(private readonly slime: Slime) {
    super(slime);
    this.yRotWanted = (180 * slime.yaw) / Math.PI;
  }
  setDirection(yRot: number, aggressive: boolean): void {
    this.yRotWanted = yRot;
    this.isAggressive = aggressive;
  }
  setWantedMovement(speed: number): void {
    this.speedModifier = speed;
    this.moving = true;
  }
  override tick(): void {
    const m = this.slime;
    m.yaw = rotlerp(m.yaw, this.yRotWanted, 90);
    m.yHeadRot = m.yaw;
    m.yBodyRot = m.yaw;
    if (!this.moving) {
      m.zza = 0;
      return;
    }
    this.moving = false;
    if (m.onGround) {
      m.setSpeed(this.speedModifier * m.movementSpeedValue());
      if (this.jumpDelay-- <= 0) {
        this.jumpDelay = m.rng.nextInt(20) + 10;
        if (this.isAggressive) this.jumpDelay = Math.floor(this.jumpDelay / 3);
        m.jumpControl.jump = true;
        m.playSound(m.size === 1 ? 'entity.slime.jump_small' : 'entity.slime.jump', m.soundVolume(), m.soundPitch());
      } else {
        m.xxa = 0;
        m.zza = 0;
        m.setSpeed(0);
      }
    } else m.setSpeed(this.speedModifier * m.movementSpeedValue());
  }
}

class SlimeFloatGoal extends Goal {
  constructor(private readonly s: Slime) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
    s.navigation.canFloat = true;
  }
  canUse(): boolean {
    return this.s.wasTouchingWater || this.s.lavaHeight > 0;
  }
  override tick(): void {
    if (this.s.rng.nextFloat() < 0.8) this.s.jumpControl.jump = true;
    (this.s.moveControl as SlimeMoveControl).setWantedMovement(1.2);
  }
}

class SlimeAttackGoal extends Goal {
  private growTiredTimer = 0;
  constructor(private readonly s: Slime) {
    super();
    this.flags = Flag.LOOK;
  }
  canUse(): boolean {
    return canTarget(this.s.target, this.s.s);
  }
  override start(): void {
    this.growTiredTimer = 300;
  }
  override canContinueToUse(): boolean {
    return canTarget(this.s.target, this.s.s) && --this.growTiredTimer > 0;
  }
  override tick(): void {
    const s = this.s;
    s.lookAt(s.target!, 10, 10);
    (s.moveControl as SlimeMoveControl).setDirection(s.yaw, s.dealsDamage());
  }
}

class SlimeRandomDirectionGoal extends Goal {
  private chosen = 0;
  private next = 0;
  constructor(private readonly s: Slime) {
    super();
    this.flags = Flag.LOOK;
  }
  canUse(): boolean {
    const s = this.s;
    return !s.target && (s.onGround || s.wasTouchingWater || s.lavaHeight > 0);
  }
  override tick(): void {
    if (--this.next <= 0) {
      this.next = 40 + this.s.rng.nextInt(60);
      this.chosen = this.s.rng.nextInt(360);
    }
    (this.s.moveControl as SlimeMoveControl).setDirection(this.chosen, false);
  }
}

class SlimeKeepOnJumpingGoal extends Goal {
  constructor(private readonly s: Slime) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    return true;
  }
  override tick(): void {
    (this.s.moveControl as SlimeMoveControl).setWantedMovement(1);
  }
}

export class Slime extends Mob {
  readonly type = 'slime';
  readonly category: MobCategory = 'monster';
  readonly trackRange = 160;
  size = 1;
  private wasOnGround = false;
  override readonly moveControl: MoveControl = new SlimeMoveControl(this);
  get maxHealth(): number {
    return this.size * this.size;
  }
  get width(): number {
    return 0.51000005 * this.size;
  }
  get height(): number {
    return 0.51000005 * this.size;
  }
  override get eyeHeight(): number {
    return 0.625 * this.height;
  }
  setSize(n: number): void {
    this.size = n;
    this.health = this.maxHealth;
    this.movementSpeed = 0.2 + 0.1 * n;
    this.attackDamage = n;
    this.xpReward = n;
    this.flagsDirty = true;
  }
  override variant(): number {
    return this.size;
  }
  protected registerGoals(): void {
    this.goalSelector.add(1, new SlimeFloatGoal(this));
    this.goalSelector.add(2, new SlimeAttackGoal(this));
    this.goalSelector.add(3, new SlimeRandomDirectionGoal(this));
    this.goalSelector.add(5, new SlimeKeepOnJumpingGoal(this));
    this.targetSelector.add(1, new NearestAttackableTargetGoal(this, true, 10, (p) => Math.abs(p.y - this.y) <= 4));
  }
  /** Slime.finalizeSpawn: size 1, 2 or 4 */
  finalizeSpawn(): void {
    this.setSize(1 << this.rng.nextInt(3));
  }
  dealsDamage(): boolean {
    return this.size > 1;
  }
  override jumpFromGround(): void {
    this.vy = 0.42;
  }
  soundPitch(): number {
    const r = this.rng;
    return ((r.nextFloat() - r.nextFloat()) * 0.2 + 1) * (this.size === 1 ? 1.4 : 0.8);
  }
  override soundVolume(): number {
    return 0.4 * this.size;
  }
  override voicePitch(): number {
    return this.soundPitch();
  }
  override hurtSound(): string {
    return this.size === 1 ? 'entity.slime.hurt_small' : 'entity.slime.hurt';
  }
  override deathSound(): string {
    return this.size === 1 ? 'entity.slime.death_small' : 'entity.slime.death';
  }
  override shouldDespawnInPeaceful(): boolean {
    return this.size > 0;
  }
  override tick(world: Parameters<Mob['tick']>[0]): void {
    super.tick(world);
    // landing squish
    if (this.onGround && !this.wasOnGround && !this.dead) this.playSound(this.size === 1 ? 'entity.slime.squish_small' : 'entity.slime.squish', this.soundVolume(), this.soundPitch() / 0.8);
    this.wasOnGround = this.onGround;
    // Slime.playerTouch → dealDamage for players touching it
    if (this.dealsDamage() && !this.dead) {
      const bb = this.bb();
      for (const p of this.s.players) {
        if (p.gameMode !== 0 && p.gameMode !== 2) continue;
        if (p.living.dead) continue;
        const pb = AABB.ofSize(p.x, p.y, p.z, 0.6, 1.8).inflate(1, 0.5, 1);
        if (!pb.intersects(bb)) continue;
        this.dealDamage(p);
      }
    }
  }
  private dealDamage(p: ServerPlayer): void {
    const i = this.size;
    if (this.distanceToTargetSqr(p) < 0.6 * i * 0.6 * i && this.hasLineOfSight(p)) {
      const src: DamageSource = { id: 'mob', scalesWithDifficulty: true, knockbackFrom: this, entity: { name: 'Slime', player: false } };
      if (this.s.survival.hurt(p, src, this.attackDamage)) {
        const r = this.rng;
        this.playSound('entity.slime.attack', 1, (r.nextFloat() - r.nextFloat()) * 0.2 + 1);
      }
    }
  }
  /** Slime.remove: big slimes split into 2–4 of half the size when the body disappears */
  protected override tickDeath(): void {
    super.tickDeath();
    if (!this.removed || this.size <= 1) return;
    const j = this.size / 2;
    const k = 2 + this.rng.nextInt(3);
    const f1 = this.size / 4;
    for (let l = 0; l < k; l++) {
      const f = ((l % 2) - 0.5) * f1, f2 = (Math.floor(l / 2) - 0.5) * f1;
      const c = this.s.mobs.spawn('slime', this.x + f, this.y + 0.5, this.z + f2, 'conversion') as Slime | null;
      if (!c) continue;
      c.setSize(j);
      c.persistenceRequired = this.persistenceRequired;
      c.yaw = this.rng.nextFloat() * 360;
    }
  }
}

/** WorldgenRandom.seedSlimeChunk(x, z, seed, 987234911).nextInt(10) == 0 */
export function isSlimeChunk(seed: bigint, cx: number, cz: number): boolean {
  const a = BigInt.asIntN(32, BigInt(cx) * BigInt(cx) * 4987142n);
  const b = BigInt.asIntN(32, BigInt(cx) * 5947611n);
  const c = BigInt(BigInt.asIntN(32, BigInt(cz) * BigInt(cz))) * 4392871n;
  const d = BigInt.asIntN(32, BigInt(cz) * 389711n);
  const s = BigInt.asIntN(64, (seed + a + b + c + d) ^ 987234911n);
  return new JavaRandom(s).nextInt(10) === 0;
}

/** Moon brightness per phase (DimensionType.MOON_BRIGHTNESS_PER_PHASE). */
export function moonBrightness(dayTime: number): number {
  const phase = Math.floor(dayTime / 24000) % 8;
  return [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75][(phase + 8) % 8]!;
}
