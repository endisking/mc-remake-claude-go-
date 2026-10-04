/** Common vanilla AI goals (net.minecraft.world.entity.ai.goal, 1.17.1). */
import { FULL_COLLISION, FLUID } from '@shared/world/blockinfo';
import { isSuffocating } from '@shared/world/blockprops';
import { itemName } from '@shared/item/stack';
import type { ServerPlayer } from '../player';
import { Goal, Flag } from './goal';
import { Mob, canTarget, targetEye, targetWidth, isMob, type Target } from './mob';
import { staticPathType } from './pathfinder';

// ------------------------------------------------------------------ random positions
/** RandomPos.generateRandomDirection */
function randomDir(m: Mob, h: number, v: number): [number, number, number] {
  const r = m.rng;
  return [r.nextInt(2 * h + 1) - h, r.nextInt(2 * v + 1) - v, r.nextInt(2 * h + 1) - h];
}

function isSolid(m: Mob, x: number, y: number, z: number): boolean {
  return FULL_COLLISION[m.world.getState(x, y, z)] === 1 || isSuffocating(m.world.getState(x, y, z));
}

/** LandRandomPos.getPos: best of 10 stable, malus-free positions by walk target value. */
export function landRandomPos(m: Mob, h: number, v: number, toward?: [number, number, number], away = false): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bestV = -Infinity;
  const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
  for (let i = 0; i < 10; i++) {
    let [dx, dy, dz] = randomDir(m, h, v);
    if (toward) {
      // RandomPos.generateRandomDirectionWithinRadians (approximated: keep directions on the wanted side)
      const sx = toward[0] - m.x, sz = toward[2] - m.z;
      const dot = dx * sx + dz * sz;
      if ((dot < 0 && !away) || (dot > 0 && away)) {
        dx = -dx;
        dz = -dz;
      }
    }
    const x = bx + dx, z = bz + dz;
    let y = by + dy;
    if (y < 1 || y > 255) continue;
    if (!m.world.isLoaded(x, z)) continue;
    // isNotStable: the block below must be solid
    if (!FULL_COLLISION[m.world.getState(x, y - 1, z)]) continue;
    while (y < 255 && isSolid(m, x, y, z)) y++;
    if (m.malus(staticPathType(m.world, x, y, z)) !== 0) continue;
    const val = m.walkTargetValue(x, y, z);
    if (val > bestV) {
      bestV = val;
      best = [x, y, z];
    }
  }
  return best;
}

/** DefaultRandomPos.getPos: any non-solid position with no water. */
export function defaultRandomPos(m: Mob, h: number, v: number): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bestV = -Infinity;
  for (let i = 0; i < 10; i++) {
    const [dx, dy, dz] = randomDir(m, h, v);
    const x = Math.floor(m.x) + dx, y = Math.floor(m.y) + dy, z = Math.floor(m.z) + dz;
    if (y < 1 || y > 255 || !m.world.isLoaded(x, z)) continue;
    if (isSolid(m, x, y, z) || FLUID[m.world.getState(x, y, z)] !== 0) continue;
    if (m.malus(staticPathType(m.world, x, y, z)) < 0) continue;
    const val = m.walkTargetValue(x, y, z);
    if (val > bestV) {
      bestV = val;
      best = [x, y, z];
    }
  }
  return best;
}

// ------------------------------------------------------------------ basic goals
export class FloatGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.JUMP;
    m.navigation.canFloat = true;
  }
  canUse(): boolean {
    const m = this.m;
    return (m.wasTouchingWater && m.waterHeight > (m.eyeHeight < 0.4 ? 0 : 0.4)) || m.lavaHeight > 0;
  }
  override tick(): void {
    if (this.m.rng.nextFloat() < 0.8) this.m.jumpControl.jump = true;
  }
}

export class PanicGoal extends Goal {
  private pos: [number, number, number] | null = null;
  constructor(protected readonly m: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m;
    if (!m.lastHurtByMob && !m.isOnFire()) return false;
    if (m.isOnFire()) {
      const w = this.lookForWater(5, 4);
      if (w) {
        this.pos = w;
        return true;
      }
    }
    this.pos = defaultRandomPos(m, 5, 4);
    return this.pos !== null;
  }
  private lookForWater(h: number, v: number): [number, number, number] | null {
    const m = this.m;
    const bx = Math.floor(m.x), by = Math.floor(m.y), bz = Math.floor(m.z);
    let best: [number, number, number] | null = null, bd = Infinity;
    for (let dx = -h; dx <= h; dx++)
      for (let dy = -v; dy <= v; dy++)
        for (let dz = -h; dz <= h; dz++) {
          if (FLUID[m.world.getState(bx + dx, by + dy, bz + dz)] !== 1) continue;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bd) {
            bd = d;
            best = [bx + dx, by + dy, bz + dz];
          }
        }
    return best;
  }
  override start(): void {
    const p = this.pos!;
    this.m.navigation.moveTo(p[0], p[1], p[2], this.speed);
  }
  override canContinueToUse(): boolean {
    return !this.m.navigation.isDone();
  }
}

/** RandomStrollGoal / WaterAvoidingRandomStrollGoal. */
export class RandomStrollGoal extends Goal {
  private pos: [number, number, number] | null = null;
  forceTrigger = false;
  constructor(protected readonly m: Mob, private readonly speed: number, private readonly interval = 120, private readonly waterAvoiding = true) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m;
    if (!this.forceTrigger) {
      if (m.noActionTime >= 100) return false;
      if (m.rng.nextInt(this.interval) !== 0) return false;
    }
    this.pos = this.position();
    if (!this.pos) return false;
    this.forceTrigger = false;
    return true;
  }
  protected position(): [number, number, number] | null {
    const m = this.m;
    if (!this.waterAvoiding) return defaultRandomPos(m, 10, 7);
    if (m.wasTouchingWater) return landRandomPos(m, 15, 7);
    return m.rng.nextFloat() >= 0.001 ? landRandomPos(m, 10, 7) : defaultRandomPos(m, 10, 7);
  }
  override start(): void {
    const p = this.pos!;
    this.m.navigation.moveTo(p[0], p[1], p[2], this.speed);
  }
  override canContinueToUse(): boolean {
    return !this.m.navigation.isDone();
  }
  override stop(): void {
    this.m.navigation.stop();
  }
}

export class LookAtPlayerGoal extends Goal {
  private lookAt: Target | null = null;
  private lookTime = 0;
  constructor(private readonly m: Mob, private readonly range: number, private readonly probability = 0.02) {
    super();
    this.flags = Flag.LOOK;
  }
  canUse(): boolean {
    const m = this.m;
    if (m.rng.nextFloat() >= this.probability) return false;
    if (m.target) this.lookAt = m.target;
    else this.lookAt = m.s.mobs.nearestPlayer(m.x, m.y + m.eyeHeight, m.z, this.range, (p) => p.gameMode !== 3);
    return this.lookAt !== null;
  }
  override canContinueToUse(): boolean {
    const t = this.lookAt;
    if (!t || !(isMob(t) ? !t.dead : !t.living.dead)) return false;
    return this.m.distanceToTargetSqr(t) <= this.range * this.range && this.lookTime > 0;
  }
  override start(): void {
    this.lookTime = 40 + this.m.rng.nextInt(40);
  }
  override stop(): void {
    this.lookAt = null;
  }
  override tick(): void {
    const t = this.lookAt!;
    this.m.lookControl.setLookAt(t.x, t.y + targetEye(t), t.z);
    this.lookTime--;
  }
}

export class RandomLookAroundGoal extends Goal {
  private relX = 0;
  private relZ = 0;
  private lookTime = 0;
  constructor(private readonly m: Mob) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    return this.m.rng.nextFloat() < 0.02;
  }
  override canContinueToUse(): boolean {
    return this.lookTime >= 0;
  }
  override start(): void {
    const d = Math.PI * 2 * this.m.rng.nextDouble();
    this.relX = Math.cos(d);
    this.relZ = Math.sin(d);
    this.lookTime = 20 + this.m.rng.nextInt(20);
  }
  override tick(): void {
    this.lookTime--;
    const m = this.m;
    m.lookControl.setLookAt(m.x + this.relX, m.y + m.eyeHeight, m.z + this.relZ);
  }
}

/** TemptGoal: follow players holding a temptation item (range 10, stop at 2.5 blocks). */
export class TemptGoal extends Goal {
  player: ServerPlayer | null = null;
  private calmDown = 0;
  constructor(private readonly m: Mob, private readonly speed: number, private readonly items: Set<string>) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  private tempted(p: ServerPlayer): boolean {
    const main = p.inventory.selectedStack, off = p.inventory.get(40);
    return (!!main && this.items.has(itemName(main.id))) || (!!off && this.items.has(itemName(off.id)));
  }
  canUse(): boolean {
    if (this.calmDown > 0) {
      this.calmDown--;
      return false;
    }
    const m = this.m;
    this.player = m.s.mobs.nearestPlayer(m.x, m.y, m.z, 10, (p) => (p.gameMode === 0 || p.gameMode === 2 || p.gameMode === 1) && !p.living.dead && this.tempted(p));
    return this.player !== null;
  }
  override start(): void {}
  override stop(): void {
    this.player = null;
    this.m.navigation.stop();
    this.calmDown = 100;
  }
  override tick(): void {
    const m = this.m, p = this.player!;
    m.lookControl.setLookAtEntity(p, 40, 40);
    if (m.distanceToTargetSqr(p) < 6.25) m.navigation.stop();
    else m.navigation.moveToEntity(p, this.speed);
  }
}

/** MeleeAttackGoal */
export class MeleeAttackGoal extends Goal {
  protected ticksUntilNextAttack = 0;
  private ticksUntilRepath = 0;
  private lastCanUseCheck = -100;
  private ptx = 0;
  private pty = 0;
  private ptz = 0;
  constructor(protected readonly m: Mob, private readonly speed: number, private readonly followUnseen: boolean) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const m = this.m;
    const now = m.s.gameTime;
    if (now - this.lastCanUseCheck < 20) return false;
    this.lastCanUseCheck = now;
    const t = m.target;
    if (!canTarget(t, m.s)) return false;
    const p = m.navigation.createPathTo(t, 0);
    if (p) return true;
    return this.attackReachSqr(t) >= m.distanceToSqr(t.x, t.y, t.z);
  }
  override canContinueToUse(): boolean {
    const m = this.m, t = m.target;
    if (!canTarget(t, m.s)) return false;
    if (!this.followUnseen) return !m.navigation.isDone();
    return true;
  }
  override start(): void {
    const m = this.m;
    if (m.target) m.navigation.moveToEntity(m.target, this.speed);
    m.setAggressive(true);
    this.ticksUntilRepath = 0;
    this.ticksUntilNextAttack = 0;
  }
  override stop(): void {
    const m = this.m;
    if (m.target && !canTarget(m.target, m.s)) m.target = null;
    m.setAggressive(false);
    m.navigation.stop();
  }
  override tick(): void {
    const m = this.m, t = m.target;
    if (!t) return;
    m.lookControl.setLookAtEntity(t, 30, 30);
    const d0 = m.distanceToSqr(t.x, t.y, t.z);
    this.ticksUntilRepath = Math.max(this.ticksUntilRepath - 1, 0);
    if ((this.followUnseen || m.hasLineOfSight(t)) && this.ticksUntilRepath <= 0 &&
      ((this.ptx === 0 && this.pty === 0 && this.ptz === 0) || (t.x - this.ptx) ** 2 + (t.y - this.pty) ** 2 + (t.z - this.ptz) ** 2 >= 1 || m.rng.nextFloat() < 0.05)) {
      this.ptx = t.x;
      this.pty = t.y;
      this.ptz = t.z;
      this.ticksUntilRepath = 4 + m.rng.nextInt(7);
      if (d0 > 1024) this.ticksUntilRepath += 10;
      else if (d0 > 256) this.ticksUntilRepath += 5;
      if (!m.navigation.moveToEntity(t, this.speed)) this.ticksUntilRepath += 15;
    }
    this.ticksUntilNextAttack = Math.max(this.ticksUntilNextAttack - 1, 0);
    this.checkAndPerformAttack(t, d0);
  }
  protected checkAndPerformAttack(t: Target, d0: number): void {
    if (d0 <= this.attackReachSqr(t) && this.ticksUntilNextAttack <= 0) {
      this.ticksUntilNextAttack = 20;
      this.m.swing();
      this.m.s.mobs.doHurtTarget(this.m, t);
    }
  }
  protected attackReachSqr(t: Target): number {
    return this.m.width * 2 * this.m.width * 2 + targetWidth(t);
  }
}

/** TargetGoal base: keep the target while visible (60 ticks of memory) and within follow range. */
abstract class TargetGoal extends Goal {
  private unseenTicks = 0;
  protected targetMob: Target | null = null;
  constructor(protected readonly m: Mob, protected readonly mustSee: boolean) {
    super();
    this.flags = Flag.TARGET;
  }
  override canContinueToUse(): boolean {
    const m = this.m;
    const t = m.target ?? this.targetMob;
    if (!canTarget(t, m.s)) return false;
    const r = m.followRange;
    if (m.distanceToTargetSqr(t) > r * r) return false;
    if (this.mustSee) {
      if (m.hasLineOfSight(t)) this.unseenTicks = 0;
      else if (++this.unseenTicks > 60) return false;
    }
    m.target = t;
    return true;
  }
  override start(): void {
    this.unseenTicks = 0;
  }
  override stop(): void {
    this.m.target = null;
    this.targetMob = null;
  }
}

export class NearestAttackableTargetGoal extends TargetGoal {
  constructor(m: Mob, mustSee: boolean, private readonly randomInterval = 10, private readonly filter: (p: ServerPlayer) => boolean = () => true) {
    super(m, mustSee);
  }
  canUse(): boolean {
    const m = this.m;
    if (this.randomInterval > 0 && m.rng.nextInt(this.randomInterval) !== 0) return false;
    const r = m.followRange;
    this.targetMob = m.s.mobs.nearestPlayer(m.x, m.y + m.eyeHeight, m.z, r, (p) => {
      if (!canTarget(p, m.s) || !this.filter(p)) return false;
      // getVisibilityPercent: sneaking players are seen at 80% range
      const vis = p.sneaking ? 0.8 : 1;
      const d2 = (p.x - m.x) ** 2 + (p.y - m.y) ** 2 + (p.z - m.z) ** 2;
      if (d2 > (r * vis) ** 2) return false;
      return !this.mustSee || m.hasLineOfSight(p);
    });
    return this.targetMob !== null;
  }
  override start(): void {
    this.m.target = this.targetMob;
    super.start();
  }
}

export class HurtByTargetGoal extends TargetGoal {
  private timestamp = 0;
  constructor(m: Mob) {
    super(m, true);
  }
  canUse(): boolean {
    const m = this.m;
    const by = m.lastHurtByMob;
    return m.lastHurtByMobTimestamp !== this.timestamp && by !== null && canTarget(by, m.s) && by !== m;
  }
  override start(): void {
    const m = this.m;
    m.target = m.lastHurtByMob;
    this.targetMob = m.target;
    this.timestamp = m.lastHurtByMobTimestamp;
    super.start();
  }
}

/** LeapAtTargetGoal (spiders, ocelots) */
export class LeapAtTargetGoal extends Goal {
  constructor(private readonly m: Mob, private readonly yd: number) {
    super();
    this.flags = Flag.JUMP | Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m, t = m.target;
    if (!t) return false;
    const d = m.distanceToTargetSqr(t);
    if (d < 4 || d > 16 || !m.onGround) return false;
    return m.rng.nextInt(5) === 0;
  }
  override canContinueToUse(): boolean {
    return !this.m.onGround;
  }
  override start(): void {
    const m = this.m, t = m.target!;
    let dx = t.x - m.x, dz = t.z - m.z;
    const l2 = dx * dx + dz * dz;
    if (l2 > 1e-7) {
      const l = Math.sqrt(l2);
      dx = (dx / l) * 0.4 + m.vx * 0.2;
      dz = (dz / l) * 0.4 + m.vz * 0.2;
    }
    m.vx = dx;
    m.vy = this.yd;
    m.vz = dz;
  }
}

/** FleeSunGoal: hide in shade when burning by day. */
export class FleeSunGoal extends Goal {
  private pos: [number, number, number] | null = null;
  constructor(private readonly m: Mob, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    const m = this.m;
    if (m.target || !m.isOnFire() || !m.s.mobs.isDay()) return false;
    if (!m.canSeeSky(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z))) return false;
    if (m.mainHand && itemName(m.mainHand.id).endsWith('helmet')) return false;
    // getHidePos: 10 random positions within 10×3, one without sky that is good to walk to
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(m.x) + m.rng.nextInt(20) - 10, y = Math.floor(m.y) + m.rng.nextInt(6) - 3, z = Math.floor(m.z) + m.rng.nextInt(20) - 10;
      if (!m.canSeeSky(x, y, z) && m.walkTargetValue(x, y, z) < 0) {
        this.pos = [x, y, z];
        return true;
      }
    }
    return false;
  }
  override canContinueToUse(): boolean {
    return !this.m.navigation.isDone();
  }
  override start(): void {
    const p = this.pos!;
    this.m.navigation.moveTo(p[0], p[1], p[2], this.speed);
  }
}

/** RestrictSunGoal: by day (without a helmet) the navigation avoids sunlit nodes. */
export class RestrictSunGoal extends Goal {
  constructor(private readonly m: Mob) {
    super();
  }
  canUse(): boolean {
    return this.m.s.mobs.isDay() && !(this.m.mainHand && itemName(this.m.mainHand.id).endsWith('_helmet'));
  }
  override start(): void {
    this.m.navigation.avoidSun = true;
  }
  override stop(): void {
    this.m.navigation.avoidSun = false;
  }
}
