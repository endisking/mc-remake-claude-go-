/**
 * Phantoms (vanilla Phantom + PhantomSpawner, 1.17.1): circle an anchor high above the player,
 * swoop down to bite every 8–11 s, burn by day; spawn over players who haven't slept for 3 days.
 */
import { FRICTION } from '@shared/entity/blockphysics';
import { STATE_TO_BLOCK } from '@shared/world/blockstate';
import { AABB } from '@shared/entity/aabb';
import { Difficulty } from '@shared/game/food';
import type { GameServer } from '../server';
import type { ServerPlayer } from '../player';
import { Goal, Flag } from './goal';
import { Mob, MoveControl, LookControl, canTarget, wrapDegrees, type Target } from './mob';
import { Monster } from './monsters';
import { isValidEmptySpawnBlock } from './manager';
import { moonBrightness } from './slime';

const enum Phase {
  CIRCLE,
  SWOOP,
}

function approach(v: number, target: number, step: number): number {
  return v < target ? Math.min(v + step, target) : Math.max(v - step, target);
}
function approachDegrees(from: number, to: number, step: number): number {
  return approach(from, from + wrapDegrees(to - from), step);
}

class PhantomMoveControl extends MoveControl {
  private speed = 0.1;
  constructor(private readonly ph: Phantom) {
    super(ph);
  }
  override tick(): void {
    const m = this.ph;
    if (m.horizontalCollision) {
      m.yaw += 180;
      this.speed = 0.1;
    }
    let f = m.mx - m.x;
    const f1 = m.my - m.y;
    let f2 = m.mz - m.z;
    let d0 = Math.sqrt(f * f + f2 * f2);
    if (Math.abs(d0) <= 1e-5) return;
    const d1 = 1 - Math.abs(f1 * 0.7) / d0;
    f *= d1;
    f2 *= d1;
    d0 = Math.sqrt(f * f + f2 * f2);
    const d2 = Math.sqrt(f * f + f2 * f2 + f1 * f1);
    const f3 = m.yaw;
    const f4 = Math.atan2(f2, f);
    const f5 = wrapDegrees(m.yaw + 90), f6 = wrapDegrees((f4 * 180) / Math.PI);
    m.yaw = approachDegrees(f5, f6, 4) - 90;
    m.yBodyRot = m.yaw;
    if (Math.abs(wrapDegrees(f3 - m.yaw)) < 3) this.speed = approach(this.speed, 1.8, 0.005 * (1.8 / this.speed));
    else this.speed = approach(this.speed, 0.2, 0.025);
    const f7 = -(Math.atan2(-f1, d0) * 180) / Math.PI;
    m.pitch = f7;
    const f8 = ((m.yaw + 90) * Math.PI) / 180;
    const d6 = this.speed * Math.cos(f8) * Math.abs(f / d2);
    const d4 = this.speed * Math.sin(f8) * Math.abs(f2 / d2);
    const d5 = this.speed * Math.sin((f7 * Math.PI) / 180) * Math.abs(f1 / d2);
    m.vx += (d6 - m.vx) * 0.2;
    m.vy += (d5 - m.vy) * 0.2;
    m.vz += (d4 - m.vz) * 0.2;
  }
}

class NoLookControl extends LookControl {
  override tick(): void {}
}

class AttackStrategyGoal extends Goal {
  private nextSweepTick = 0;
  constructor(private readonly ph: Phantom) {
    super();
  }
  canUse(): boolean {
    return canTarget(this.ph.target, this.ph.s);
  }
  override start(): void {
    this.nextSweepTick = 10;
    this.ph.phase = Phase.CIRCLE;
    this.ph.setAnchorAboveTarget();
  }
  override stop(): void {
    const p = this.ph;
    const c = p.world.getChunk(p.ax >> 4, p.az >> 4);
    const top = c ? c.motionBlocking[(p.az & 15) * 16 + (p.ax & 15)]! : p.ay;
    p.ay = top + 10 + p.rng.nextInt(20);
  }
  override tick(): void {
    const p = this.ph;
    if (p.phase === Phase.CIRCLE && --this.nextSweepTick <= 0) {
      p.phase = Phase.SWOOP;
      p.setAnchorAboveTarget();
      this.nextSweepTick = (8 + p.rng.nextInt(4)) * 20;
      p.playSound('entity.phantom.swoop', 10, 0.95 + p.rng.nextFloat() * 0.1);
    }
  }
}

class SweepAttackGoal extends Goal {
  constructor(private readonly ph: Phantom) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    return this.ph.target !== null && this.ph.phase === Phase.SWOOP;
  }
  override canContinueToUse(): boolean {
    return canTarget(this.ph.target, this.ph.s) && this.canUse();
  }
  override stop(): void {
    this.ph.target = null;
    this.ph.phase = Phase.CIRCLE;
  }
  override tick(): void {
    const p = this.ph, t = p.target!;
    p.mx = t.x;
    p.my = t.y + (t instanceof Mob ? t.height : 1.8) * 0.5;
    p.mz = t.z;
    const tb = t instanceof Mob ? t.bb() : AABB.ofSize(t.x, t.y, t.z, 0.6, 1.8);
    if (p.bb().inflate(0.2).intersects(tb)) {
      p.s.mobs.doHurtTarget(p, t);
      p.phase = Phase.CIRCLE;
      p.playSound('entity.phantom.bite', 1, 1);
    } else if (p.horizontalCollision || p.hurtTime > 0) p.phase = Phase.CIRCLE;
  }
}

class CircleAroundAnchorGoal extends Goal {
  private angle = 0;
  private distance = 0;
  private height = 0;
  private clockwise = 1;
  constructor(private readonly ph: Phantom) {
    super();
    this.flags = Flag.MOVE;
  }
  canUse(): boolean {
    return this.ph.target === null || this.ph.phase === Phase.CIRCLE;
  }
  override start(): void {
    const r = this.ph.rng;
    this.distance = 5 + r.nextFloat() * 10;
    this.height = -4 + r.nextFloat() * 9;
    this.clockwise = r.nextBoolean() ? 1 : -1;
    this.selectNext();
  }
  override tick(): void {
    const p = this.ph, r = p.rng, w = p.world;
    if (r.nextInt(350) === 0) this.height = -4 + r.nextFloat() * 9;
    if (r.nextInt(250) === 0) {
      this.distance++;
      if (this.distance > 15) {
        this.distance = 5;
        this.clockwise = -this.clockwise;
      }
    }
    if (r.nextInt(450) === 0) {
      this.angle = r.nextFloat() * 2 * Math.PI;
      this.selectNext();
    }
    if ((p.mx - p.x) ** 2 + (p.my - p.y) ** 2 + (p.mz - p.z) ** 2 < 4) this.selectNext();
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    if (p.my < p.y && w.getState(bx, by - 1, bz) !== 0) {
      this.height = Math.max(1, this.height);
      this.selectNext();
    }
    if (p.my > p.y && w.getState(bx, by + 1, bz) !== 0) {
      this.height = Math.min(-1, this.height);
      this.selectNext();
    }
  }
  private selectNext(): void {
    const p = this.ph;
    if (p.ax === 0 && p.ay === 0 && p.az === 0) {
      p.ax = Math.floor(p.x);
      p.ay = Math.floor(p.y);
      p.az = Math.floor(p.z);
    }
    this.angle += (this.clockwise * 15 * Math.PI) / 180;
    p.mx = p.ax + this.distance * Math.cos(this.angle);
    p.my = p.ay - 4 + this.height;
    p.mz = p.az + this.distance * Math.sin(this.angle);
  }
}

class AttackPlayerTargetGoal extends Goal {
  private nextScan = 20;
  constructor(private readonly ph: Phantom) {
    super();
    this.flags = Flag.TARGET;
  }
  canUse(): boolean {
    if (this.nextScan > 0) {
      this.nextScan--;
      return false;
    }
    this.nextScan = 60;
    const p = this.ph;
    const list = p.s.players
      .filter((pl) => canTarget(pl, p.s) && Math.abs(pl.x - p.x) <= 16 + 0.45 && Math.abs(pl.z - p.z) <= 16 + 0.45 && Math.abs(pl.y - p.y) <= 64)
      .sort((a, b) => b.y - a.y);
    for (const pl of list) {
      p.target = pl;
      return true;
    }
    return false;
  }
  override canContinueToUse(): boolean {
    return canTarget(this.ph.target, this.ph.s);
  }
}

export class Phantom extends Monster {
  readonly type = 'phantom';
  readonly maxHealth = 20;
  size = 0;
  phase = Phase.CIRCLE;
  /** move target point and anchor */
  mx = 0;
  my = 0;
  mz = 0;
  ax = 0;
  ay = 0;
  az = 0;
  override readonly moveControl: MoveControl = new PhantomMoveControl(this);
  override readonly lookControl: LookControl = new NoLookControl(this);
  override attackDamage = 6;
  get width(): number {
    return 0.9 * (1 + 0.15 * this.size);
  }
  get height(): number {
    return 0.5 * (1 + 0.15 * this.size);
  }
  override get eyeHeight(): number {
    return this.height * 0.35;
  }
  protected registerGoals(): void {
    this.goalSelector.add(1, new AttackStrategyGoal(this));
    this.goalSelector.add(2, new SweepAttackGoal(this));
    this.goalSelector.add(3, new CircleAroundAnchorGoal(this));
    this.targetSelector.add(1, new AttackPlayerTargetGoal(this));
  }
  finalizeSpawn(): void {
    this.ax = Math.floor(this.x);
    this.ay = Math.floor(this.y) + 5;
    this.az = Math.floor(this.z);
  }
  setAnchorAboveTarget(): void {
    const t = this.target;
    if (!t) return;
    this.ax = Math.floor(t.x);
    this.ay = Math.floor(t.y) + 20 + this.rng.nextInt(20);
    this.az = Math.floor(t.z);
    if (this.ay < 63) this.ay = 64;
  }
  override canBreatheUnderwater(): boolean {
    return true;
  }
  protected override causeFallDamage(): void {}
  protected override customServerAiStep(): void {
    if (this.isSunBurnTick()) this.setSecondsOnFire(8);
  }
  /** FlyingMob.travel: no gravity */
  override travel(strafe: number, up: number, forward: number): void {
    void strafe;
    void up;
    void forward;
    let f = 0.91;
    if (this.wasTouchingWater) f = 0.8;
    else if (this.lavaHeight > 0) f = 0.5;
    else if (this.onGround) f = FRICTION[STATE_TO_BLOCK[this.world.getState(Math.floor(this.x), Math.floor(this.y - 1), Math.floor(this.z))]!]! * 0.91;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= f;
    this.vy *= f;
    this.vz *= f;
  }
  protected override tickHeadTurn(): void {
    this.yHeadRot = this.yBodyRot = this.yaw;
  }
  override ambientSound(): string {
    return 'entity.phantom.ambient';
  }
  override hurtSound(): string {
    return 'entity.phantom.hurt';
  }
  override deathSound(): string {
    return 'entity.phantom.death';
  }
}

/** DifficultyInstance.getEffectiveDifficulty (no chunk inhabited time). */
export function effectiveDifficulty(difficulty: number, gameTime: number, dayTime: number): number {
  if (difficulty === Difficulty.Peaceful) return 0;
  const hard = difficulty === Difficulty.Hard;
  let f = 0.75;
  const f1 = Math.max(0, Math.min(1, (gameTime - 72000) / 1440000)) * 0.25;
  f += f1;
  let f2 = 0;
  f2 += Math.max(0, Math.min(f1, moonBrightness(dayTime) * 0.25));
  if (difficulty === Difficulty.Easy) f2 *= 0.5;
  f += f2;
  void hard;
  return difficulty * f;
}

/** PhantomSpawner.tick: every 60–119 s at night, players under the sky who haven't slept for 72000+ ticks. */
export class PhantomSpawner {
  private nextTick = 0;
  constructor(private readonly s: GameServer) {}
  tick(): void {
    const s = this.s;
    if (s.difficulty === Difficulty.Peaceful || !s.gameRules.doInsomnia) return;
    const r = s.rand;
    if (--this.nextTick > 0) return;
    this.nextTick += (60 + r.nextInt(60)) * 20;
    if (s.mobs.skyDarken() < 5) return;
    for (const p of s.players as ServerPlayer[]) {
      if (p.gameMode === 3 || p.living.dead) continue;
      const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
      const c = s.world.getChunk(bx >> 4, bz >> 4);
      if (!(by >= 63 && c && c.skyTop[(bz & 15) * 16 + (bx & 15)]! <= by)) continue;
      if (!(effectiveDifficulty(s.difficulty, s.gameTime, s.dayTime) > r.nextFloat() * 3)) continue;
      const j = Math.max(1, p.living.timeSinceRest);
      if (r.nextInt(j) < 72000) continue;
      const x = bx - 10 + r.nextInt(21), y = by + 20 + r.nextInt(15), z = bz - 10 + r.nextInt(21);
      if (!isValidEmptySpawnBlock(s.world.getState(x, y, z))) continue;
      const k = 1 + r.nextInt(s.difficulty + 1);
      for (let l = 0; l < k; l++) s.mobs.spawn('phantom', x + 0.5, y, z + 0.5, 'natural');
    }
  }
}

export type { Target };
