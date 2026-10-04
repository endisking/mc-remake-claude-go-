/**
 * Arrow projectile (vanilla AbstractArrow / Arrow, 1.17.1): gravity 0.05, drag 0.99 (0.6 in
 * water), block hits stick the arrow 0.05 blocks short of the hit point with a 7-tick shake,
 * entity hits deal ceil(speed × baseDamage) (+ random(damage/2 + 2) when critical), bounce
 * back when the hit is refused, despawn after 1200 ticks in the ground, pickup rules.
 *
 * The arrow talks to the rest of the server through an ArrowHost so mobs (or any entity that
 * implements ArrowTarget) can be hit without this file knowing about them.
 */
import { AABB } from '@shared/entity/aabb';
import { raycastBlocks } from '@shared/world/raycast';
import { collisionBoxes } from '@shared/world/shapes';
import { FLUID } from '@shared/world/blockinfo';
import type { BlockWorld } from '@shared/world/world';
import type { ItemStack } from '@shared/item/stack';
import { ServerEntity } from './entity';

export const enum Pickup {
  Disallowed = 0,
  Allowed = 1,
  CreativeOnly = 2,
}

/** Something an arrow can hit (players, mobs). */
export interface ArrowTarget {
  readonly id: number;
  bb(): AABB;
  /** Entity.hurt with DamageSource.arrow; returns whether damage was applied. */
  hurtByArrow(arrow: Arrow, damage: number): boolean;
  /** knockback push (Punch) */
  isSpectator?(): boolean;
}

export interface ArrowHost {
  /** entities that could be hit (excluding spectators and dead ones) */
  arrowTargets(): Iterable<ArrowTarget>;
  /** owner entity's bounding box (for leftOwner), null if gone */
  ownerBox(ownerId: number): AABB | null;
  playSound(event: string, x: number, y: number, z: number, volume: number, pitch: number): void;
  /** spawn an item at the arrow (bounced arrows that stop) */
  dropItem(x: number, y: number, z: number, stack: ItemStack): void;
  /** PvP check for player-on-player hits */
  canHarm(ownerId: number, target: ArrowTarget): boolean;
  rand: { nextFloat(): number; nextInt(n: number): number; nextGaussian(): number };
}

export class Arrow extends ServerEntity {
  readonly type: string = 'arrow';
  readonly width = 0.5;
  readonly height = 0.5;
  readonly trackRange = 64;
  ownerId = -1;
  baseDamage = 2;
  crit = false;
  inGround = false;
  inGroundTime = 0;
  shakeTime = 0;
  life = 0;
  pickup: Pickup = Pickup.Disallowed;
  knockback = 0;
  leftOwner = false;
  /** item given back on pickup */
  item: ItemStack;
  private lastStateAt: { x: number; y: number; z: number; state: number } | null = null;

  constructor(id: number, readonly host: ArrowHost, item: ItemStack) {
    super(id);
    this.item = { ...item, count: 1 };
  }

  /** Projectile.shoot: normalised direction with gaussian inaccuracy, scaled by velocity. */
  shoot(dx: number, dy: number, dz: number, velocity: number, inaccuracy: number): void {
    const len = Math.hypot(dx, dy, dz) || 1;
    const r = this.host.rand;
    const g = 0.0075 * inaccuracy;
    this.vx = (dx / len + r.nextGaussian() * g) * velocity;
    this.vy = (dy / len + r.nextGaussian() * g) * velocity;
    this.vz = (dz / len + r.nextGaussian() * g) * velocity;
    this.updateRotation();
  }

  /** Projectile.shootFromRotation (degrees). */
  shootFromRotation(pitch: number, yaw: number, velocity: number, inaccuracy: number): void {
    const D = Math.PI / 180;
    const fx = -Math.sin(yaw * D) * Math.cos(pitch * D);
    const fy = -Math.sin(pitch * D);
    const fz = Math.cos(yaw * D) * Math.cos(pitch * D);
    this.shoot(fx, fy, fz, velocity, inaccuracy);
  }

  private updateRotation(): void {
    const h = Math.hypot(this.vx, this.vz);
    this.yaw = (Math.atan2(this.vx, this.vz) * 180) / Math.PI;
    this.pitch = (Math.atan2(this.vy, h) * 180) / Math.PI;
  }

  /** Arrow box is centred on the position horizontally, bottom at y (vanilla EntityDimensions). */
  override bb(): AABB {
    return AABB.ofSize(this.x, this.y, this.z, this.width, this.height);
  }

  tick(world: BlockWorld): void {
    this.age++;
    const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    const state = world.getState(bx, by, bz);
    if (state !== 0 && !this.inGround) {
      for (const b of collisionBoxes(state)) {
        if (this.x >= bx + b[0]! && this.x < bx + b[3]! && this.y >= by + b[1]! && this.y < by + b[4]! && this.z >= bz + b[2]! && this.z < bz + b[5]!) {
          this.inGround = true;
          break;
        }
      }
    }
    if (this.shakeTime > 0) this.shakeTime--;
    if (this.inGround) {
      const ls = this.lastStateAt;
      const cur = ls ? world.getState(ls.x, ls.y, ls.z) : state;
      if (ls && cur !== ls.state && this.shouldFall(world)) {
        // startFalling
        this.inGround = false;
        const r = this.host.rand;
        this.vx *= r.nextFloat() * 0.2;
        this.vy *= r.nextFloat() * 0.2;
        this.vz *= r.nextFloat() * 0.2;
        this.life = 0;
      } else if (++this.life >= 1200) this.removed = true;
      this.inGroundTime++;
      return;
    }
    this.inGroundTime = 0;
    if (!this.leftOwner) {
      const ob = this.host.ownerBox(this.ownerId);
      this.leftOwner = !ob || !ob.expandTowards(this.vx, this.vy, this.vz).inflate(1).intersects(this.bb());
    }
    const x0 = this.x, y0 = this.y, z0 = this.z;
    let x1 = x0 + this.vx, y1 = y0 + this.vy, z1 = z0 + this.vz;
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    let blockHit = speed > 0 ? raycastBlocks(world, x0, y0, z0, this.vx, this.vy, this.vz, speed, false, undefined, collisionBoxes) : null;
    if (blockHit) {
      x1 = blockHit.px;
      y1 = blockHit.py;
      z1 = blockHit.pz;
    }
    const target = this.findHitEntity(x0, y0, z0, x1, y1, z1);
    if (target && this.host.canHarm(this.ownerId, target)) {
      this.onHitEntity(target);
      blockHit = null;
    } else if (blockHit) {
      this.lastStateAt = { x: blockHit.x, y: blockHit.y, z: blockHit.z, state: blockHit.state };
      // onHitBlock: move to just before the hit point and stick
      this.vx = blockHit.px - this.x;
      this.vy = blockHit.py - this.y;
      this.vz = blockHit.pz - this.z;
      const l = Math.hypot(this.vx, this.vy, this.vz) || 1;
      this.x -= (this.vx / l) * 0.05;
      this.y -= (this.vy / l) * 0.05;
      this.z -= (this.vz / l) * 0.05;
      const r = this.host.rand;
      this.host.playSound('entity.arrow.hit', this.x, this.y, this.z, 1, 1.2 / (r.nextFloat() * 0.2 + 0.9));
      this.inGround = true;
      this.shakeTime = 7;
      this.crit = false;
    }
    if (this.removed) return;
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    this.updateRotation();
    let f = 0.99;
    if (FLUID[world.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))] === 1) f = 0.6;
    this.vx *= f;
    this.vy *= f;
    this.vz *= f;
    this.vy -= 0.05;
    this.x = nx;
    this.y = ny;
    this.z = nz;
  }

  private shouldFall(world: BlockWorld): boolean {
    const bb = this.bb().inflate(0.06);
    for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++) {
          for (const b of collisionBoxes(world.getState(x, y, z))) {
            const box = new AABB(x + b[0]!, y + b[1]!, z + b[2]!, x + b[3]!, y + b[4]!, z + b[5]!);
            if (box.intersects(bb)) return false;
          }
        }
    return true;
  }

  /** ProjectileUtil.getEntityHitResult: nearest target whose box (inflated 0.3) the segment crosses. */
  private findHitEntity(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): ArrowTarget | null {
    const sweep = this.bb().expandTowards(this.vx, this.vy, this.vz).inflate(1);
    let best: ArrowTarget | null = null, bestD = Infinity;
    for (const t of this.host.arrowTargets()) {
      if (t.id === this.ownerId && !this.leftOwner) continue;
      if (t.isSpectator?.()) continue;
      const tb = t.bb();
      if (!tb.intersects(sweep)) continue;
      const box = tb.inflate(0.3);
      const d = segmentBox(x0, y0, z0, x1, y1, z1, box);
      if (d >= 0 && d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private onHitEntity(t: ArrowTarget): void {
    const r = this.host.rand;
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    let dmg = Math.ceil(Math.max(0, Math.min(speed * this.baseDamage, 2147483647)));
    if (this.crit) dmg = Math.min(dmg + r.nextInt(Math.floor(dmg / 2) + 2), 2147483647);
    if (t.hurtByArrow(this, dmg)) {
      this.host.playSound('entity.arrow.hit', this.x, this.y, this.z, 1, 1.2 / (r.nextFloat() * 0.2 + 0.9));
      this.removed = true;
    } else {
      this.vx *= -0.1;
      this.vy *= -0.1;
      this.vz *= -0.1;
      this.yaw += 180;
      if (this.vx * this.vx + this.vy * this.vy + this.vz * this.vz < 1e-7) {
        if (this.pickup === Pickup.Allowed) this.host.dropItem(this.x, this.y + 0.1, this.z, this.item);
        this.removed = true;
      }
    }
  }

  /** AbstractArrow.playerTouch: may this player pick the arrow up now? */
  canPickUp(creative: boolean): boolean {
    if (!this.inGround || this.shakeTime > 0) return false;
    return this.pickup === Pickup.Allowed || (this.pickup === Pickup.CreativeOnly && creative);
  }
}

/** Entry distance of a segment into a box (0 if it starts inside), −1 on a miss. */
export function segmentBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: AABB): number {
  const d = [x1 - x0, y1 - y0, z1 - z0];
  const o = [x0, y0, z0];
  const mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-12) {
      if (o[i]! < mn[i]! || o[i]! > mx[i]!) return -1;
      continue;
    }
    let a = (mn[i]! - o[i]!) / d[i]!, c = (mx[i]! - o[i]!) / d[i]!;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return -1;
  }
  return t0 * Math.hypot(d[0]!, d[1]!, d[2]!);
}
