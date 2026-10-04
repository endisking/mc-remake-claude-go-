/**
 * Wolves (vanilla Wolf / TamableAnimal, 1.17.1): tamed with bones (1 in 3), sit on command,
 * follow and teleport to their owner, defend it and attack what it attacks, get angry in packs
 * when hit, hunt sheep while wild, heal on meat and breed with it when tame.
 */
import { itemName } from '@shared/item/stack';
import { FOODS_BY_NAME } from '@shared/data';
import { blockNameOf } from '@shared/world/blockstate';
import { FULL_COLLISION } from '@shared/world/blockinfo';
import { AABB, noCollision } from '@shared/entity/aabb';
import type { ServerPlayer } from '../player';
import type { DamageSource } from '../survival';
import { Goal, Flag } from './goal';
import { Mob, canTarget, isMob, type Target } from './mob';
import { Animal, BreedGoal } from './animals';
import { FloatGoal, LeapAtTargetGoal, MeleeAttackGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal } from './goals';
import { ENTITY_EVENT } from '@shared/entity/mobdata';

const MEAT = new Set(['porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'rotten_flesh', 'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit']);

class SitWhenOrderedToGoal extends Goal {
  constructor(private readonly w: Wolf) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    const w = this.w;
    if (!w.tame || w.wasTouchingWater || !w.onGround) return false;
    const o = w.owner();
    if (!o) return true;
    return w.distanceToTargetSqr(o) < 144 && w.s.mobs.ownerHurtBy(o) ? false : w.orderedToSit;
  }
  override start(): void {
    this.w.navigation.stop();
    this.w.setSitting(true);
  }
  override stop(): void {
    this.w.setSitting(false);
  }
}

/** FollowOwnerGoal(speed 1, start 10, stop 2): walk to the owner, teleport when 12+ blocks away. */
class FollowOwnerGoal extends Goal {
  private recalc = 0;
  constructor(private readonly w: Wolf) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const w = this.w, o = w.owner();
    if (!o || o.gameMode === 3 || w.orderedToSit) return false;
    return w.distanceToTargetSqr(o) >= 100;
  }
  override canContinueToUse(): boolean {
    const w = this.w, o = w.owner();
    if (!o || w.navigation.isDone() || w.orderedToSit) return false;
    return w.distanceToTargetSqr(o) > 4;
  }
  override start(): void {
    this.recalc = 0;
  }
  override stop(): void {
    this.w.navigation.stop();
  }
  override tick(): void {
    const w = this.w, o = w.owner()!;
    w.lookControl.setLookAt(o.x, o.y + 1.62, o.z, 10, 40);
    if (--this.recalc <= 0) {
      this.recalc = 10;
      if (w.distanceToTargetSqr(o) >= 144) this.teleportToOwner(o);
      else w.navigation.moveToEntity(o, 1);
    }
  }
  private teleportToOwner(o: ServerPlayer): void {
    const w = this.w, r = w.rng;
    const ox = Math.floor(o.x), oy = Math.floor(o.y), oz = Math.floor(o.z);
    for (let i = 0; i < 10; i++) {
      const x = ox + r.nextInt(7) - 3, y = oy + r.nextInt(3) - 1, z = oz + r.nextInt(7) - 3;
      if (Math.abs(x - o.x) < 2 && Math.abs(z - o.z) < 2) continue;
      const below = w.world.getState(x, y - 1, z);
      if (!FULL_COLLISION[below] || blockNameOf(below).endsWith('_leaves')) continue;
      if (!noCollision(w.world, AABB.ofSize(x + 0.5, y, z + 0.5, w.width, w.height))) continue;
      w.x = x + 0.5;
      w.y = y;
      w.z = z + 0.5;
      w.navigation.stop();
      return;
    }
  }
}

/** OwnerHurtByTargetGoal / OwnerHurtTargetGoal: defend the owner, attack what it attacks. */
class OwnerTargetGoal extends Goal {
  private timestamp = -1;
  private pick: Mob | null = null;
  constructor(private readonly w: Wolf, private readonly attackersOfOwner: boolean) {
    super();
    this.flags = Flag.TARGET;
  }
  canUse(): boolean {
    const w = this.w;
    if (!w.tame || w.orderedToSit) return false;
    const o = w.owner();
    if (!o) return false;
    const c = this.attackersOfOwner ? w.s.mobs.ownerHurtBy(o) : w.s.mobs.ownerHurt(o);
    if (!c || c.time === this.timestamp || c.mob === w || c.mob.dead) return false;
    if (c.mob instanceof Wolf && c.mob.tame && c.mob.ownerName === w.ownerName) return false;
    this.pick = c.mob;
    return true;
  }
  override start(): void {
    const w = this.w, o = w.owner()!;
    const c = this.attackersOfOwner ? w.s.mobs.ownerHurtBy(o) : w.s.mobs.ownerHurt(o);
    this.timestamp = c?.time ?? -1;
    w.target = this.pick;
  }
  override canContinueToUse(): boolean {
    const t = this.w.target;
    return canTarget(t, this.w.s) && this.w.distanceToTargetSqr(t!) < this.w.followRange ** 2;
  }
  override stop(): void {
    this.w.target = null;
  }
}

/** NonTameRandomTargetGoal: wild wolves hunt sheep (rabbits and foxes aren't simulated yet). */
class HuntGoal extends Goal {
  private prey: Mob | null = null;
  constructor(private readonly w: Wolf) {
    super();
    this.flags = Flag.TARGET;
  }
  canUse(): boolean {
    const w = this.w;
    if (w.tame || w.rng.nextInt(10) !== 0) return false;
    let best: Mob | null = null, bd = Infinity;
    for (const m of w.s.mobs.nearbyMobs(w.x, w.z, w.followRange)) {
      if (m.type !== 'sheep' || m.dead) continue;
      const d = w.distanceToTargetSqr(m);
      if (d < bd && d < w.followRange ** 2 && w.hasLineOfSight(m)) {
        bd = d;
        best = m;
      }
    }
    this.prey = best;
    return best !== null;
  }
  override start(): void {
    this.w.target = this.prey;
  }
  override canContinueToUse(): boolean {
    const t = this.w.target;
    return !!t && isMob(t) && !t.dead && this.w.distanceToTargetSqr(t) < this.w.followRange ** 2;
  }
  override stop(): void {
    this.w.target = null;
  }
}

/** Angry at a player (NeutralMob persistent anger, 20–39 s). */
class AngerTargetGoal extends Goal {
  constructor(private readonly w: Wolf) {
    super();
    this.flags = Flag.TARGET;
  }
  canUse(): boolean {
    const w = this.w;
    if (w.angerTime <= 0 || !w.angerTarget) return false;
    const p = w.s.players.find((pl) => pl.name === w.angerTarget);
    if (!p || !canTarget(p, w.s)) return false;
    w.target = p;
    return true;
  }
  override canContinueToUse(): boolean {
    return this.w.angerTime > 0 && canTarget(this.w.target, this.w.s);
  }
  override stop(): void {
    this.w.target = null;
  }
}

/** BegGoal: tilt the head at a player within 8 blocks holding a bone (wild) or meat (tame). */
class BegGoal extends Goal {
  private player: ServerPlayer | null = null;
  private lookTime = 0;
  constructor(private readonly w: Wolf) {
    super();
    this.flags = Flag.LOOK;
  }
  private interesting(p: ServerPlayer): boolean {
    const st = p.inventory.selectedStack ?? p.inventory.get(40);
    if (!st) return false;
    const n = itemName(st.id);
    return this.w.tame ? MEAT.has(n) : n === 'bone';
  }
  canUse(): boolean {
    const w = this.w;
    this.player = w.s.mobs.nearestPlayer(w.x, w.y, w.z, 8, (p) => p.gameMode !== 3 && this.interesting(p));
    return this.player !== null;
  }
  override canContinueToUse(): boolean {
    const p = this.player;
    return !!p && !p.living.dead && this.w.distanceToTargetSqr(p) <= 64 && this.lookTime > 0 && this.interesting(p);
  }
  override start(): void {
    this.lookTime = 40 + this.w.rng.nextInt(40);
    this.w.setAggressive(false);
  }
  override tick(): void {
    const p = this.player!;
    this.w.lookControl.setLookAt(p.x, p.y + 1.62, p.z, 10, 40);
    this.lookTime--;
  }
}

export class Wolf extends Animal {
  override readonly type = 'wolf';
  readonly adultWidth = 0.6;
  readonly adultHeight = 0.85;
  override movementSpeed = 0.3;
  tame = false;
  ownerName: string | null = null;
  orderedToSit = false;
  sitting = false;
  angerTime = 0;
  angerTarget: string | null = null;
  readonly food = MEAT;
  get maxHealth(): number {
    return this.tame ? 20 : 8;
  }
  override get eyeHeight(): number {
    return this.height * 0.8;
  }
  protected registerGoals(): void {
    this.goalSelector.add(1, new FloatGoal(this));
    this.goalSelector.add(2, new SitWhenOrderedToGoal(this));
    this.goalSelector.add(4, new LeapAtTargetGoal(this, 0.4));
    this.goalSelector.add(5, new MeleeAttackGoal(this, 1, true));
    this.goalSelector.add(6, new FollowOwnerGoal(this));
    this.goalSelector.add(7, new BreedGoal(this, 1));
    this.goalSelector.add(8, new RandomStrollGoal(this, 1));
    this.goalSelector.add(9, new BegGoal(this));
    this.goalSelector.add(10, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(10, new RandomLookAroundGoal(this));
    this.targetSelector.add(1, new OwnerTargetGoal(this, true));
    this.targetSelector.add(2, new OwnerTargetGoal(this, false));
    this.targetSelector.add(3, new HurtByTargetGoal(this));
    this.targetSelector.add(4, new AngerTargetGoal(this));
    this.targetSelector.add(5, new HuntGoal(this));
  }
  owner(): ServerPlayer | null {
    if (!this.ownerName) return null;
    return this.s.players.find((p) => p.name === this.ownerName && !p.living.dead) ?? null;
  }
  /** changes of these re-send the wolf's mobData (health drives the tail) */
  override variant(): number {
    return Math.ceil(this.health) * 4 + (this.angerTime > 0 ? 2 : 0) + (this.tame ? 1 : 0);
  }
  setSitting(v: boolean): void {
    if (v !== this.sitting) {
      this.sitting = v;
      this.flagsDirty = true;
    }
  }
  override isFood(item: Parameters<Animal['isFood']>[0]): boolean {
    return !!item && MEAT.has(itemName(item.id));
  }
  override canFallInLove(): boolean {
    return this.tame && super.canFallInLove();
  }
  override canMate(o: Animal): boolean {
    return o instanceof Wolf && o.tame && this.tame && !o.sitting && !this.sitting && super.canMate(o);
  }
  override removeWhenFarAway(): boolean {
    return false;
  }
  protected override customServerAiStep(): void {
    if (this.angerTime > 0 && --this.angerTime === 0) this.angerTarget = null;
    this.setAggressive(this.target !== null);
  }
  /** Wolf.mobInteract */
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    const n = held ? itemName(held.id) : '';
    if (this.tame) {
      if (held && MEAT.has(n) && this.health < this.maxHealth) {
        this.s.mobs.usePlayerItem(p, slot);
        this.heal(FOODS_BY_NAME.get(n)?.foodPoints ?? 2);
        return true;
      }
      if (held && this.isFood(held) && this.ageTicks === 0 && this.canFallInLove()) return super.interact(p, hand);
      if (p.name === this.ownerName) {
        this.orderedToSit = !this.orderedToSit;
        this.jumping = false;
        this.navigation.stop();
        this.target = null;
        return true;
      }
      return false;
    }
    if (n === 'bone' && this.angerTime <= 0) {
      this.s.mobs.usePlayerItem(p, slot);
      if (this.rng.nextInt(3) === 0) {
        this.tame = true;
        this.ownerName = p.name;
        this.navigation.stop();
        this.target = null;
        this.orderedToSit = true;
        this.health = 20;
        this.attackDamage = 4;
        this.persistenceRequired = true;
        this.flagsDirty = true;
        this.entityEvent(ENTITY_EVENT.TAMING_SUCCEEDED);
      } else this.entityEvent(ENTITY_EVENT.TAMING_FAILED);
      return true;
    }
    return super.interact(p, hand);
  }
  /** Wolf.hurt: stops sitting; a wild wolf hit by a player gets angry with its pack */
  override hurt(src: DamageSource, amount: number, attacker: Target | null = null): boolean {
    if (this.isInvulnerableTo(src)) return false;
    this.orderedToSit = false;
    // mobs (other than players and arrows) deal (amount + 1) / 2 to wolves (vanilla Wolf.hurt)
    if (attacker && isMob(attacker) && !src.projectile) amount = (amount + 1) / 2;
    const ok = super.hurt(src, amount, attacker);
    if (ok && attacker && !isMob(attacker) && !this.tame) {
      const anger = 400 + this.rng.nextInt(400);
      for (const m of [this, ...this.s.mobs.nearbyMobs(this.x, this.z, 10)]) {
        if (!(m instanceof Wolf) || m.tame || m.dead) continue;
        m.angerTime = anger;
        m.angerTarget = attacker.name;
      }
    }
    return ok;
  }
  override ambientSound(): string {
    if (this.angerTime > 0) return 'entity.wolf.growl';
    if (this.rng.nextInt(3) === 0) return this.tame && this.health < 10 ? 'entity.wolf.whine' : 'entity.wolf.pant';
    return 'entity.wolf.ambient';
  }
  override hurtSound(): string {
    return 'entity.wolf.hurt';
  }
  override deathSound(): string {
    return 'entity.wolf.death';
  }
  override stepSound(): string {
    return 'entity.wolf.step';
  }
  override soundVolume(): number {
    return 0.4;
  }
}
