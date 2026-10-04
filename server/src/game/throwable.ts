/**
 * Thrown item projectiles (vanilla ThrowableItemProjectile: Snowball, ThrownEgg, ThrownEnderpearl):
 * gravity 0.03, drag 0.99 (0.8 in water), shot at 1.5 blocks/tick with inaccuracy 1. They break
 * on the first block or entity they hit; the effect of the hit is up to the owner (ItemUse).
 */
import { AABB } from '@shared/entity/aabb';
import { raycastBlocks } from '@shared/world/raycast';
import { collisionBoxes } from '@shared/world/shapes';
import { FLUID } from '@shared/world/blockinfo';
import type { BlockWorld } from '@shared/world/world';
import { ServerEntity } from './entity';
import { segmentBox, type ArrowHost, type ArrowTarget } from './arrow';

export type ThrownKind = 'snowball' | 'egg' | 'ender_pearl';

export interface ThrowHit {
  x: number;
  y: number;
  z: number;
  /** the entity hit, or null for a block */
  target: ArrowTarget | null;
}

export class Thrown extends ServerEntity {
  readonly width = 0.25;
  readonly height = 0.25;
  readonly trackRange = 64;
  ownerId = -1;
  leftOwner = false;
  /** called once when it hits something; the projectile is removed afterwards */
  onHit: ((t: Thrown, hit: ThrowHit) => void) | null = null;

  constructor(id: number, readonly type: ThrownKind, readonly item: number, private readonly host: ArrowHost) {
    super(id);
  }

  /** Projectile.shootFromRotation (degrees) + shoot with gaussian inaccuracy. */
  shootFromRotation(pitch: number, yaw: number, velocity: number, inaccuracy: number): void {
    const D = Math.PI / 180;
    const fx = -Math.sin(yaw * D) * Math.cos(pitch * D), fy = -Math.sin(pitch * D), fz = Math.cos(yaw * D) * Math.cos(pitch * D);
    const r = this.host.rand, g = 0.0075 * inaccuracy, len = Math.hypot(fx, fy, fz) || 1;
    this.vx = (fx / len + r.nextGaussian() * g) * velocity;
    this.vy = (fy / len + r.nextGaussian() * g) * velocity;
    this.vz = (fz / len + r.nextGaussian() * g) * velocity;
  }

  override bb(): AABB {
    return AABB.ofSize(this.x, this.y, this.z, this.width, this.height);
  }

  tick(world: BlockWorld): void {
    this.age++;
    if (!this.leftOwner) {
      const ob = this.host.ownerBox(this.ownerId);
      this.leftOwner = !ob || !ob.expandTowards(this.vx, this.vy, this.vz).inflate(1).intersects(this.bb());
    }
    const x0 = this.x, y0 = this.y, z0 = this.z;
    let x1 = x0 + this.vx, y1 = y0 + this.vy, z1 = z0 + this.vz;
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    const block = speed > 0 ? raycastBlocks(world, x0, y0, z0, this.vx, this.vy, this.vz, speed, false, undefined, collisionBoxes) : null;
    if (block) {
      x1 = block.px;
      y1 = block.py;
      z1 = block.pz;
    }
    // ProjectileUtil.getEntityHitResult: nearest entity box (inflated 0.3) on the path
    let best: ArrowTarget | null = null, bd = Infinity;
    const sweep = this.bb().expandTowards(this.vx, this.vy, this.vz).inflate(1);
    for (const t of this.host.arrowTargets()) {
      if (t.id === this.ownerId && !this.leftOwner) continue;
      const tb = t.bb();
      if (!tb.intersects(sweep)) continue;
      const d = segmentBox(x0, y0, z0, x1, y1, z1, tb.inflate(0.3));
      if (d >= 0 && d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best || block) {
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
      const k = best ? bd / len : 1;
      this.onHit?.(this, { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, z: z0 + (z1 - z0) * k, target: best });
      this.removed = true;
      return;
    }
    this.x = x1;
    this.y = y1;
    this.z = z1;
    const f = FLUID[world.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))] === 1 ? 0.8 : 0.99;
    this.vx *= f;
    this.vy = this.vy * f - 0.03;
    this.vz *= f;
    if (this.y < -64) this.removed = true;
  }
}
