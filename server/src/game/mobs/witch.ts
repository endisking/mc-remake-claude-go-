/**
 * Witches (vanilla Witch, 1.17.1): 26 HP, throw splash potions every 60 ticks within 10 blocks
 * (slowness at 8+ blocks, poison while the target has 8+ health, weakness at ≤ 3 blocks 25 % of
 * the time, harming otherwise), drink water breathing / fire resistance / healing / swiftness
 * when needed (32 ticks, slowed while drinking), take 15 % of magic damage.
 */
import { potionStack } from '@shared/game/potions';
import type { DamageSource } from '../survival';
import { Goal, Flag } from './goal';
import { isMob, targetEye, type Target } from './mob';
import { Monster } from './monsters';
import { FloatGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal, NearestAttackableTargetGoal } from './goals';
import { Thrown } from '../throwable';

/** RangedAttackGoal(1.0, 60, 10) */
class WitchAttackGoal extends Goal {
  private attackTime = -1;
  private seeTime = 0;
  constructor(private readonly w: Witch) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const t = this.w.target;
    return t !== null && (isMob(t) ? !t.dead : !t.living.dead);
  }
  override stop(): void {
    this.seeTime = 0;
    this.attackTime = -1;
  }
  override tick(): void {
    const w = this.w, t = w.target;
    if (!t) return;
    const d2 = w.distanceToTargetSqr(t);
    const see = w.hasLineOfSight(t);
    this.seeTime = see ? this.seeTime + 1 : 0;
    if (d2 <= 100 && this.seeTime >= 5) w.navigation.stop();
    else w.navigation.moveToEntity(t, 1);
    w.lookControl.setLookAt(t.x, t.y + targetEye(t), t.z, 30, 30);
    if (--this.attackTime === 0) {
      if (!see) return;
      w.throwPotionAt(t, Math.sqrt(d2));
      this.attackTime = 60;
    } else if (this.attackTime < 0) this.attackTime = 60;
  }
}

export class Witch extends Monster {
  readonly type = 'witch';
  readonly maxHealth = 26;
  readonly width = 0.6;
  readonly height = 1.95;
  override movementSpeed = 0.25;
  /** ticks left drinking (usingTime), and what */
  drinkTicks = 0;
  drinking: string | null = null;

  protected registerGoals(): void {
    this.goalSelector.add(1, new FloatGoal(this));
    this.goalSelector.add(2, new WitchAttackGoal(this));
    this.goalSelector.add(2, new RandomStrollGoal(this, 1));
    this.goalSelector.add(3, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(3, new RandomLookAroundGoal(this));
    this.targetSelector.add(1, new HurtByTargetGoal(this));
    this.targetSelector.add(3, new NearestAttackableTargetGoal(this, true));
  }
  override get eyeHeight(): number {
    return 1.62;
  }
  override movementSpeedValue(): number {
    // drinking: −0.25 speed modifier
    return this.drinking ? Math.max(0, this.movementSpeed - 0.25) : this.movementSpeed;
  }

  /** Witch.performRangedAttack */
  throwPotionAt(t: Target, dist: number): void {
    if (this.drinking) return;
    const has = (e: string) => (isMob(t) ? t.hasMobEffect(e) : t.living.effects.has(e));
    const health = isMob(t) ? t.health : t.living.health;
    let potion = 'harming';
    if (dist >= 8 && !has('slowness')) potion = 'slowness';
    else if (health >= 8 && !has('poison')) potion = 'poison';
    else if (dist <= 3 && !has('weakness') && this.rng.nextFloat() < 0.25) potion = 'weakness';
    const iu = this.s.items;
    const st = potionStack('splash_potion', potion);
    const ball = new Thrown(this.s.newEntityId(), 'potion', st.id, iu.arrowHost);
    ball.x = this.x;
    ball.y = this.y + this.eyeHeight - 0.1;
    ball.z = this.z;
    ball.ownerId = this.id;
    const tvx = isMob(t) ? t.vx : 0, tvz = isMob(t) ? t.vz : 0;
    const dx = t.x + tvx - this.x, dz = t.z + tvz - this.z;
    const dy = t.y + targetEye(t) - 1.1 - ball.y;
    const h = Math.hypot(dx, dz);
    // ThrownPotion.setXRot(−20) then shoot(dx, dy + h·0.2, dz, 0.75, 8)
    const len = Math.hypot(dx, dy + h * 0.2, dz) || 1, r = this.rng, g = 0.0075 * 8;
    ball.vx = (dx / len + r.nextGaussian() * g) * 0.75;
    ball.vy = ((dy + h * 0.2) / len + r.nextGaussian() * g) * 0.75;
    ball.vz = (dz / len + r.nextGaussian() * g) * 0.75;
    ball.onHit = (e, hit) => iu.splash(e, hit, potion);
    this.s.spawnEntity(ball);
    this.playSound('entity.witch.throw', 1, 0.8 + this.rng.nextFloat() * 0.4);
  }

  /** Witch.aiStep: drink a potion when needed */
  protected override customServerAiStep(): void {
    if (this.drinking) {
      if (--this.drinkTicks <= 0) {
        const p = this.drinking;
        this.drinking = null;
        this.useItemTicks = -1;
        this.mainHand = null;
        this.flagsDirty = true;
        if (p === 'healing') this.heal(4);
        else if (p === 'water_breathing') this.addMobEffect('water_breathing', 3600, 0);
        else if (p === 'fire_resistance') this.addMobEffect('fire_resistance', 3600, 0);
        else if (p === 'swiftness') this.addMobEffect('speed', 3600, 0);
      }
      return;
    }
    const r = this.rng;
    let p: string | null = null;
    if (r.nextFloat() < 0.15 && this.eyeInWater && !this.hasMobEffect('water_breathing')) p = 'water_breathing';
    else if (r.nextFloat() < 0.15 && this.isOnFire() && !this.hasMobEffect('fire_resistance')) p = 'fire_resistance';
    else if (r.nextFloat() < 0.05 && this.health < this.maxHealth) p = 'healing';
    else if (r.nextFloat() < 0.5 && this.target && !this.hasMobEffect('speed') && this.distanceToTargetSqr(this.target) > 121) p = 'swiftness';
    if (p) {
      this.drinking = p;
      this.drinkTicks = 32;
      this.mainHand = potionStack('potion', p);
      this.useItemTicks = 0;
      this.flagsDirty = true;
      this.playSound('entity.witch.drink', 1, 0.8 + r.nextFloat() * 0.4);
    }
  }
  override hurt(src: DamageSource, amount: number, attacker: Target | null = null): boolean {
    if (src.fire && this.hasMobEffect('fire_resistance')) return false;
    // Witch.getDamageAfterMagicAbsorb: own potions do nothing, other magic 15 %
    if (attacker === this) return false;
    if (src.id === 'magic' || src.id === 'indirectMagic') amount *= 0.15;
    return super.hurt(src, amount, attacker);
  }
  override experienceReward(): number {
    return 5;
  }
  override ambientSound(): string {
    return 'entity.witch.ambient';
  }
  override hurtSound(): string {
    return 'entity.witch.hurt';
  }
  override deathSound(): string {
    return 'entity.witch.death';
  }
}

