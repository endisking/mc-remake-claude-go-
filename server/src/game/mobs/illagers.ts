/**
 * Pillagers and vindicators (vanilla Pillager / Vindicator / AbstractIllager, 1.17.1): 24 HP,
 * speed 0.35; they hunt players, villagers, wandering traders and iron golems. Pillagers charge
 * a crossbow (25 ticks) and shoot from up to 8 blocks; vindicators swing an iron axe (5 + axe).
 * Not yet: raids, patrols and captains (ominous banners), vindicator door breaking, "Johnny".
 */
import { stack } from '@shared/item/stack';
import { Goal, Flag } from './goal';
import { targetEye } from './mob';
import { Monster } from './monsters';
import {
  FloatGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal, NearestAttackableTargetGoal, NearestMobTargetGoal, MeleeAttackGoal,
} from './goals';
import { attackDamageOf } from '@shared/game/combat';

abstract class AbstractIllager extends Monster {
  readonly maxHealth = 24;
  readonly width = 0.6;
  readonly height = 1.95;
  override movementSpeed = 0.35;
  override attackDamage = 5;
  override followRange = 32;
  override get eyeHeight(): number {
    return 1.62;
  }
  protected illagerTargets(): void {
    this.targetSelector.add(1, new HurtByTargetGoal(this));
    this.targetSelector.add(2, new NearestAttackableTargetGoal(this, true));
    this.targetSelector.add(3, new NearestMobTargetGoal(this, false, (m) => m.type === 'villager' || m.type === 'wandering_trader'));
    this.targetSelector.add(3, new NearestMobTargetGoal(this, true, (m) => m.type === 'iron_golem'));
  }
}

/** RangedCrossbowAttackGoal(1.0, 8): approach to 8 blocks, charge 25 ticks, wait 20–40, shoot. */
class CrossbowAttackGoal extends Goal {
  private state: 'uncharged' | 'charging' | 'charged' | 'ready' = 'uncharged';
  private seeTime = 0;
  private delay = 0;
  constructor(private readonly p: Pillager) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    return !!this.p.target && this.p.holdingCrossbow();
  }
  override stop(): void {
    this.seeTime = 0;
    this.p.setAggressive(false);
    this.p.useItemTicks = -1;
    this.state = 'uncharged';
  }
  override tick(): void {
    const m = this.p, t = m.target;
    if (!t) return;
    const see = m.hasLineOfSight(t);
    this.seeTime = see ? Math.max(0, this.seeTime) + 1 : Math.min(0, this.seeTime) - 1;
    const d2 = m.distanceToTargetSqr(t);
    if ((d2 > 64 || this.seeTime < 5) && this.delay <= 0) {
      m.navigation.moveToEntity(t, this.state === 'uncharged' ? 1 : 0.5);
      this.delay = 20 + m.rng.nextInt(20);
    } else {
      this.delay--;
      if (d2 <= 64 && this.seeTime >= 5) m.navigation.stop();
    }
    m.lookControl.setLookAt(t.x, t.y + targetEye(t), t.z, 30, 30);
    if (this.state === 'uncharged') {
      if (this.seeTime > -60) {
        this.state = 'charging';
        m.useItemTicks = 0;
        m.flagsDirty = true;
        m.setAggressive(true);
        m.playSound('item.crossbow.loading_start', 1, 1);
      }
    } else if (this.state === 'charging') {
      if (++m.useItemTicks >= 25) {
        m.useItemTicks = -1;
        m.flagsDirty = true;
        m.playSound('item.crossbow.loading_end', 1, 1);
        this.state = 'charged';
        this.delay = 20 + m.rng.nextInt(20);
        m.setAggressive(false);
      }
    } else if (this.state === 'charged') {
      if (--this.delay <= 0) this.state = 'ready';
    } else if (see) {
      m.s.mobs.shootArrow(m, t, 1, null);
      m.playSound('item.crossbow.shoot', 1, 1 / (m.rng.nextFloat() * 0.4 + 1.2) + 0.5);
      this.state = 'uncharged';
    }
  }
}

export class Pillager extends AbstractIllager {
  readonly type = 'pillager';
  protected registerGoals(): void {
    this.goalSelector.add(0, new FloatGoal(this));
    this.goalSelector.add(3, new CrossbowAttackGoal(this));
    this.goalSelector.add(8, new RandomStrollGoal(this, 0.6));
    this.goalSelector.add(9, new LookAtPlayerGoal(this, 15));
    this.goalSelector.add(10, new RandomLookAroundGoal(this));
    this.illagerTargets();
  }
  holdingCrossbow(): boolean {
    return !!this.mainHand;
  }
  finalizeSpawn(): void {
    this.mainHand = stack('crossbow');
  }
  override ambientSound(): string {
    return 'entity.pillager.ambient';
  }
  override hurtSound(): string {
    return 'entity.pillager.hurt';
  }
  override deathSound(): string {
    return 'entity.pillager.death';
  }
}

export class Vindicator extends AbstractIllager {
  readonly type = 'vindicator';
  override followRange = 12;
  protected registerGoals(): void {
    this.goalSelector.add(0, new FloatGoal(this));
    this.goalSelector.add(4, new MeleeAttackGoal(this, 1, false));
    this.goalSelector.add(8, new RandomStrollGoal(this, 0.6));
    this.goalSelector.add(9, new LookAtPlayerGoal(this, 15));
    this.goalSelector.add(10, new RandomLookAroundGoal(this));
    this.illagerTargets();
  }
  finalizeSpawn(): void {
    this.mainHand = stack('iron_axe');
  }
  protected override customServerAiStep(): void {
    this.setAggressive(!!this.target);
  }
  override meleeDamage(): number {
    return this.attackDamage + (this.mainHand ? attackDamageOf(this.mainHand.id) - 1 : 0);
  }
  override ambientSound(): string {
    return 'entity.vindicator.ambient';
  }
  override hurtSound(): string {
    return 'entity.vindicator.hurt';
  }
  override deathSound(): string {
    return 'entity.vindicator.death';
  }
}
