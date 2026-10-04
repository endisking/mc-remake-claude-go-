/**
 * Arrows (vanilla AbstractArrow, 1.17.1): move by their velocity, then drag 0.99 (0.6 in water) and
 * gravity 0.05; block hits stick the arrow in; entity hits deal ceil(speed × baseDamage).
 */
import { AABB } from '@shared/entity/aabb';
import { FLUID } from '@shared/world/blockinfo';
import { collisionBoxes } from '@shared/world/shapes';
import { raycastBlocks } from '@shared/world/raycast';
import type { BlockWorld } from '@shared/world/world';
import type { JavaRandom } from '@shared/util/random';
import { ServerEntity } from '../entity';
import type { ServerPlayer } from '../player';
import type { GameServer } from '../server';
import { Mob, isMob, targetWidth, targetHeight, type Target } from './mob';

export class Arrow extends ServerEntity {
  readonly type = 'arrow';
  readonly width = 0.5;
  readonly height = 0.5;
  readonly trackRange = 64;
  baseDamage = 2;
  inGround = false;
  life = 0;
  crit = false;
  /** effect applied on hit (stray arrows: slowness) — effects are not modelled yet */
  effect: string | null = null;
  /** pickup: 0 disallowed (mob arrows), 1 allowed, 2 creative only */
  pickup = 0;
  private stuckIn: [number, number, number, number] | null = null;
  private leftOwner = false;

  constructor(id: number, private readonly s: GameServer, readonly owner: Target | null) {
    super(id);
  }

  /** Projectile.shoot: normalized direction with gaussian spread × 0.0075 × inaccuracy, scaled by velocity. */
  shoot(dx: number, dy: number, dz: number, velocity: number, inaccuracy: number, r: JavaRandom): void {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx = dx / len + r.nextGaussian() * 0.0075 * inaccuracy;
    dy = dy / len + r.nextGaussian() * 0.0075 * inaccuracy;
    dz = dz / len + r.nextGaussian() * 0.0075 * inaccuracy;
    this.vx = dx * velocity;
    this.vy = dy * velocity;
    this.vz = dz * velocity;
    this.updateRotation();
  }

  /** yaw/pitch in the mob/player convention (yaw 0 = +Z, pitch < 0 = up) */
  private updateRotation(): void {
    const h = Math.hypot(this.vx, this.vz);
    this.yaw = (Math.atan2(-this.vx, this.vz) * 180) / Math.PI;
    this.pitch = -(Math.atan2(this.vy, h) * 180) / Math.PI;
  }

  tick(world: BlockWorld): void {
    this.age++;
    if (this.inGround) {
      const st = this.stuckIn!;
      if (world.getState(st[0], st[1], st[2]) !== st[3]) {
        // the block we stuck in changed: fall out
        this.inGround = false;
        this.vx *= Math.random() * 0.2;
        this.vy *= Math.random() * 0.2;
        this.vz *= Math.random() * 0.2;
        this.life = 0;
      } else {
        if (++this.life >= 1200) this.removed = true;
        return;
      }
    }
    if (!this.leftOwner) this.leftOwner = this.checkLeftOwner();
    const x0 = this.x, y0 = this.y, z0 = this.z;
    let x1 = x0 + this.vx, y1 = y0 + this.vy, z1 = z0 + this.vz;
    const len = Math.hypot(this.vx, this.vy, this.vz);
    const hit = len > 1e-7 ? raycastBlocks(world, x0, y0, z0, this.vx, this.vy, this.vz, len, false, undefined, collisionBoxes) : null;
    if (hit) {
      x1 = hit.px;
      y1 = hit.py;
      z1 = hit.pz;
    }
    const ent = this.findHitEntity(x0, y0, z0, x1, y1, z1);
    if (ent) {
      this.onHitEntity(ent);
      if (this.removed) return;
    } else if (hit) {
      // onHitBlock: stick in, nudged back 0.05 along the motion
      const mx = hit.px - x0, my = hit.py - y0, mz = hit.pz - z0;
      const ml = Math.hypot(mx, my, mz) || 1;
      this.x = hit.px - (mx / ml) * 0.05;
      this.y = hit.py - (my / ml) * 0.05;
      this.z = hit.pz - (mz / ml) * 0.05;
      this.vx = mx;
      this.vy = my;
      this.vz = mz;
      this.inGround = true;
      this.stuckIn = [hit.x, hit.y, hit.z, hit.state];
      this.crit = false;
      const r = this.s.rand;
      this.s.playSound(null, 'entity.arrow.hit', 'neutral', this.x, this.y, this.z, 1, 1.2 / (r.nextFloat() * 0.2 + 0.9));
      return;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    this.updateRotation();
    const inWater = FLUID[world.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))] === 1;
    const f = inWater ? 0.6 : 0.99;
    this.vx *= f;
    this.vy *= f;
    this.vz *= f;
    this.vy -= 0.05;
    if (this.y < -64) this.removed = true;
  }

  private checkLeftOwner(): boolean {
    const o = this.owner;
    if (!o) return true;
    const bb = AABB.ofSize(o.x, o.y, o.z, targetWidth(o), targetHeight(o)).inflate(1);
    return !this.bb().move(this.vx, this.vy, this.vz).inflate(1).intersects(bb);
  }

  /** ProjectileUtil.getEntityHitResult: nearest entity box (inflated 0.3) crossed by the segment. */
  private findHitEntity(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Target | null {
    let best: Target | null = null, bd = Infinity;
    const test = (t: Target) => {
      if (t === this.owner && !this.leftOwner) return;
      const b = AABB.ofSize(t.x, t.y, t.z, targetWidth(t), targetHeight(t)).inflate(0.3);
      const d = segmentBox(x0, y0, z0, x1, y1, z1, b);
      if (d >= 0 && d < bd) {
        bd = d;
        best = t;
      }
    };
    for (const p of this.s.players) if (!p.living.dead && p.gameMode !== 3) test(p);
    for (const m of this.s.mobs.nearbyMobs(this.x, this.z, 4 + Math.hypot(this.vx, this.vz))) if (!m.dead) test(m);
    return best;
  }

  private onHitEntity(t: Target): void {
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    let dmg = Math.ceil(Math.max(0, Math.min(2147483647, speed * this.baseDamage)));
    if (this.crit) dmg = Math.min(this.s.rand.nextInt(Math.floor(dmg / 2) + 2) + dmg, 2147483647);
    const owner = this.owner;
    const src = {
      id: 'arrow', projectile: true, scalesWithDifficulty: !!owner && isMob(owner),
      knockbackFrom: owner ?? this,
      entity: owner ? { name: isMob(owner) ? this.s.mobs.displayName(owner) : (owner as ServerPlayer).name, player: !isMob(owner) } : undefined,
    };
    const ok = isMob(t) ? (t as Mob).hurt(src, dmg, owner) : this.s.survival.hurt(t as ServerPlayer, src, dmg, owner && !isMob(owner) ? (owner as ServerPlayer) : null);
    if (ok) {
      if (owner && isMob(owner) && !isMob(t)) this.s.mobs.noteOwnerHurtBy(t as ServerPlayer, owner as Mob);
      const r = this.s.rand;
      this.s.playSound(null, 'entity.arrow.hit', 'neutral', this.x, this.y, this.z, 1, 1.2 / (r.nextFloat() * 0.2 + 0.9));
      this.removed = true;
    } else {
      // deflected
      this.vx *= -0.1;
      this.vy *= -0.1;
      this.vz *= -0.1;
      this.yaw += 180;
      if (this.vx * this.vx + this.vy * this.vy + this.vz * this.vz < 1e-7) this.removed = true;
    }
  }
}

/** Entry distance (0..1 along the segment) of a segment into a box, −1 if it misses or starts inside. */
export function segmentBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: AABB): number {
  if (x0 > b.minX && x0 < b.maxX && y0 > b.minY && y0 < b.maxY && z0 > b.minZ && z0 < b.maxZ) return -1;
  let tmin = 0, tmax = 1;
  const d = [x1 - x0, y1 - y0, z1 - z0], o = [x0, y0, z0], mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-12) {
      if (o[i]! < mn[i]! || o[i]! > mx[i]!) return -1;
      continue;
    }
    let t1 = (mn[i]! - o[i]!) / d[i]!, t2 = (mx[i]! - o[i]!) / d[i]!;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}
