/**
 * Endermen (vanilla EnderMan, 1.17.1): provoked by being looked at, teleport (random, away from
 * projectiles, towards distant targets), hurt by water and rain, pick up and place holdable blocks.
 */
import { AABB, noCollision } from '@shared/entity/aabb';
import { blockNameOf, getProp } from '@shared/world/blockstate';
import { FLUID } from '@shared/world/blockinfo';
import { collisionBoxes } from '@shared/world/shapes';
import { raycastBlocks } from '@shared/world/raycast';
import { blocksMotion } from '@shared/world/chunk';
import { WORLDGEN } from '@shared/worldgen/features/data';
import { itemName } from '@shared/item/stack';
import type { ServerPlayer } from '../player';
import type { DamageSource } from '../survival';
import { Goal, Flag } from './goal';
import { Mob, canTarget, isMob, type Target } from './mob';
import { Monster } from './monsters';
import { FloatGoal, MeleeAttackGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal } from './goals';
import { MOB_FLAG } from '@shared/entity/mobdata';

const HOLDABLE = new Set(WORLDGEN.block_tags['enderman_holdable'] ?? []);

/** EnderMan.isLookingAtMe: the player's view ray points at the enderman's eyes (no carved pumpkin). */
export function isLookingAt(p: ServerPlayer, e: Mob): boolean {
  const head = p.inventory.get(39);
  if (head && itemName(head.id) === 'carved_pumpkin') return false;
  const yr = (p.yaw * Math.PI) / 180, pr = (p.pitch * Math.PI) / 180;
  const vx = -Math.sin(yr) * Math.cos(pr), vy = -Math.sin(pr), vz = Math.cos(yr) * Math.cos(pr);
  const eye = p.y + (p.pose === 'crouching' ? 1.27 : 1.62);
  let dx = e.x - p.x, dy = e.y + e.eyeHeight - eye, dz = e.z - p.z;
  const d0 = Math.hypot(dx, dy, dz);
  dx /= d0;
  dy /= d0;
  dz /= d0;
  const d1 = vx * dx + vy * dy + vz * dz;
  if (!(d1 > 1 - 0.025 / d0)) return false;
  return raycastBlocks(e.world, p.x, eye, p.z, e.x - p.x, e.y + e.eyeHeight - eye, e.z - p.z, d0, false, undefined, collisionBoxes) === null;
}

class LookForPlayerGoal extends Goal {
  private pending: ServerPlayer | null = null;
  private aggroTime = 0;
  private teleportTime = 0;
  constructor(private readonly e: Enderman) {
    super();
    this.flags = Flag.TARGET;
  }
  canUse(): boolean {
    const e = this.e;
    this.pending = e.s.mobs.nearestPlayer(e.x, e.y, e.z, e.followRange, (p) => canTarget(p, e.s) && isLookingAt(p, e));
    return this.pending !== null;
  }
  override start(): void {
    this.aggroTime = 5;
    this.teleportTime = 0;
    this.e.setBeingStaredAt();
  }
  override stop(): void {
    this.pending = null;
  }
  override canContinueToUse(): boolean {
    const e = this.e;
    if (this.pending) {
      if (!isLookingAt(this.pending, e)) return false;
      e.lookAt(this.pending, 10, 10);
      return true;
    }
    return canTarget(e.target, e.s) && e.distanceToTargetSqr(e.target!) <= e.followRange * e.followRange;
  }
  override tick(): void {
    const e = this.e;
    if (!e.target) {
      if (this.pending && --this.aggroTime <= 0) {
        e.setTarget(this.pending);
        this.pending = null;
      }
      return;
    }
    const t = e.target;
    if (!isMob(t)) {
      if (isLookingAt(t, e)) {
        if (e.distanceToTargetSqr(t) < 16) e.teleportRandom();
        this.teleportTime = 0;
      } else if (e.distanceToTargetSqr(t) > 256 && this.teleportTime++ >= 30 && e.teleportTowards(t)) this.teleportTime = 0;
    }
  }
}

class FreezeWhenLookedAtGoal extends Goal {
  constructor(private readonly e: Enderman) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    const t = this.e.target;
    if (!t || isMob(t)) return false;
    return this.e.distanceToTargetSqr(t) <= 256 && isLookingAt(t, this.e);
  }
  override start(): void {
    this.e.navigation.stop();
  }
  override tick(): void {
    const t = this.e.target;
    if (t) this.e.lookControl.setLookAt(t.x, t.y + 1.62, t.z);
  }
}

/** EndermanTakeBlockGoal: 1/20 per tick, a holdable block within ±2 (raycast-visible). */
class TakeBlockGoal extends Goal {
  constructor(private readonly e: Enderman) {
    super();
  }
  canUse(): boolean {
    const e = this.e;
    return e.carried === 0 && e.s.mobs.mobGriefing && e.rng.nextInt(20) === 0;
  }
  override tick(): void {
    const e = this.e, r = e.rng;
    const x = Math.floor(e.x - 2 + r.nextDouble() * 4), y = Math.floor(e.y + r.nextDouble() * 3), z = Math.floor(e.z - 2 + r.nextDouble() * 4);
    const st = e.world.getState(x, y, z);
    if (!HOLDABLE.has(blockNameOf(st))) return;
    const ex = e.x, ey = e.y + e.eyeHeight * 0.5 + 0.5, ez = e.z;
    const hit = raycastBlocks(e.world, ex, ey, ez, x + 0.5 - ex, y + 0.5 - ey, z + 0.5 - ez, Math.hypot(x + 0.5 - ex, y + 0.5 - ey, z + 0.5 - ez) + 0.5);
    if (!hit || hit.x !== x || hit.y !== y || hit.z !== z) return;
    e.s.setBlock(x, y, z, 0);
    e.s.updateNeighbors(x, y, z);
    e.carried = st;
    e.flagsDirty = true;
  }
}

/** EndermanLeaveBlockGoal: 1/2000 per tick, place the carried block on a solid block nearby. */
class LeaveBlockGoal extends Goal {
  constructor(private readonly e: Enderman) {
    super();
  }
  canUse(): boolean {
    const e = this.e;
    return e.carried !== 0 && e.s.mobs.mobGriefing && e.rng.nextInt(2000) === 0;
  }
  override tick(): void {
    const e = this.e, r = e.rng;
    const x = Math.floor(e.x - 1 + r.nextDouble() * 2), y = Math.floor(e.y + r.nextDouble() * 2), z = Math.floor(e.z - 1 + r.nextDouble() * 2);
    const w = e.world;
    const here = w.getState(x, y, z), below = w.getState(x, y - 1, z);
    if (here !== 0 || below === 0 || blockNameOf(below) === 'bedrock' || !collisionBoxes(below).some((b) => b[4] >= 1)) return;
    const box = AABB.ofSize(x + 0.5, y, z + 0.5, 1, 1);
    if (box.intersects(e.bb())) return;
    e.s.setBlock(x, y, z, e.carried);
    e.s.updateNeighbors(x, y, z);
    e.carried = 0;
    e.flagsDirty = true;
  }
}

export class Enderman extends Monster {
  readonly type = 'enderman';
  readonly maxHealth = 40;
  readonly width = 0.6;
  readonly height = 2.9;
  override movementSpeed = 0.3;
  override attackDamage = 7;
  override followRange = 64;
  /** carried block state (0 = none) */
  carried = 0;
  creepy = false;
  private targetChangeTime = 0;
  private lastStareSound = -1000;
  override get eyeHeight(): number {
    return 2.55;
  }
  protected registerGoals(): void {
    this.goalSelector.add(0, new FloatGoal(this));
    this.goalSelector.add(1, new FreezeWhenLookedAtGoal(this));
    this.goalSelector.add(2, new MeleeAttackGoal(this, 1, false));
    this.goalSelector.add(7, new RandomStrollGoal(this, 1, 120, true));
    this.goalSelector.add(8, new LookAtPlayerGoal(this, 8));
    this.goalSelector.add(8, new RandomLookAroundGoal(this));
    this.goalSelector.add(10, new LeaveBlockGoal(this));
    this.goalSelector.add(11, new TakeBlockGoal(this));
    this.targetSelector.add(1, new LookForPlayerGoal(this));
    this.targetSelector.add(2, new HurtByTargetGoal(this));
  }
  override movementSpeedValue(): number {
    return this.movementSpeed + (this.target ? 0.15 : 0);
  }
  override mobFlags(): number {
    return super.mobFlags() | (this.creepy ? MOB_FLAG.AGGRESSIVE : 0);
  }
  override variant(): number {
    return this.carried;
  }
  /** EnderMan.setTarget: creepy face and +0.15 speed while hunting */
  setTarget(t: Target | null): void {
    this.target = t;
    if (!t) {
      this.targetChangeTime = 0;
      if (this.creepy) this.flagsDirty = true;
      this.creepy = false;
    } else {
      this.targetChangeTime = this.tickCount;
      if (!this.creepy) this.flagsDirty = true;
      this.creepy = true;
    }
  }
  setBeingStaredAt(): void {
    if (this.tickCount >= this.lastStareSound + 400) {
      this.lastStareSound = this.tickCount;
      this.playSound('entity.enderman.stare', 2.5, 1);
    }
  }
  protected override customServerAiStep(): void {
    // the generic target goals write `target` directly: keep the creepy state in sync
    if ((this.target !== null) !== this.creepy) this.setTarget(this.target);
    if (this.isInWaterOrRain()) this.hurt({ id: 'drown', bypassArmor: true }, 1);
    if (this.s.mobs.isDay() && this.tickCount >= this.targetChangeTime + 600) {
      const f = this.brightness();
      if (f > 0.5 && this.canSeeSky(Math.floor(this.x), Math.floor(this.y + this.eyeHeight), Math.floor(this.z)) && this.rng.nextFloat() * 30 < (f - 0.4) * 2) {
        this.setTarget(null);
        this.teleportRandom();
      }
    }
  }
  /** EnderMan.hurt: projectiles make it teleport instead; other non-mob damage teleports 90% of the time */
  override hurt(src: DamageSource, amount: number, attacker: Target | null = null): boolean {
    if (src.projectile) {
      for (let i = 0; i < 64; i++) if (this.teleportRandom()) return false;
      return false;
    }
    const ok = super.hurt(src, amount, attacker);
    if (!this.dead && !attacker && this.rng.nextInt(10) !== 0) this.teleportRandom();
    return ok;
  }
  teleportRandom(): boolean {
    if (this.dead) return false;
    const r = this.rng;
    return this.teleportTo(this.x + (r.nextDouble() - 0.5) * 64, this.y + (r.nextInt(64) - 32), this.z + (r.nextDouble() - 0.5) * 64);
  }
  teleportTowards(t: Target): boolean {
    let dx = this.x - t.x, dy = this.y + this.height / 2 - t.y - 1.62, dz = this.z - t.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l;
    dy /= l;
    dz /= l;
    const r = this.rng;
    return this.teleportTo(this.x + (r.nextDouble() - 0.5) * 8 - dx * 16, this.y + (r.nextInt(16) - 8) - dy * 16, this.z + (r.nextDouble() - 0.5) * 8 - dz * 16);
  }
  /** EnderMan.teleport(x, y, z) → LivingEntity.randomTeleport: drop to the ground, need free non-liquid space. */
  private teleportTo(x: number, y: number, z: number): boolean {
    const w = this.world;
    const bx = Math.floor(x), bz = Math.floor(z);
    let by = Math.floor(y);
    if (!w.isLoaded(bx, bz)) return false;
    while (by > 0 && !blocksMotion(w.getState(bx, by - 1, bz))) by--;
    if (by <= 0) return false;
    const below = w.getState(bx, by - 1, bz);
    if (FLUID[below] && !getProp(below, 'waterlogged')) return false;
    const bb = AABB.ofSize(x, by, z, this.width, this.height);
    if (!noCollision(w, bb)) return false;
    for (let yy = by; yy < by + 3; yy++) if (FLUID[w.getState(bx, yy, bz)]) return false;
    const ox = this.x, oy = this.y, oz = this.z;
    this.x = x;
    this.y = by;
    this.z = z;
    this.navigation.stop();
    this.s.playSound(null, 'entity.enderman.teleport', 'hostile', ox, oy, oz, 1, 1);
    this.playSound('entity.enderman.teleport', 1, 1);
    return true;
  }
  override ambientSound(): string {
    return this.creepy ? 'entity.enderman.scream' : 'entity.enderman.ambient';
  }
  override hurtSound(): string {
    return 'entity.enderman.hurt';
  }
  override deathSound(): string {
    return 'entity.enderman.death';
  }
}
