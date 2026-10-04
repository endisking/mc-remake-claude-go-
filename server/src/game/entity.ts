/** Server-side non-player entities. */
import { AABB, collideBox } from '@shared/entity/aabb';
import { FRICTION } from '@shared/entity/blockphysics';
import { STATE_TO_BLOCK } from '@shared/world/blockstate';
import { FLUID } from '@shared/world/blockinfo';
import type { ItemStack } from '@shared/item/stack';
import type { BlockWorld } from '@shared/world/world';

export abstract class ServerEntity {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  age = 0;
  removed = false;
  /** last position sent to trackers */
  sentX = NaN;
  sentY = NaN;
  sentZ = NaN;
  abstract readonly type: string;
  abstract readonly width: number;
  abstract readonly height: number;
  /** clientTrackingRange in blocks */
  abstract readonly trackRange: number;

  constructor(readonly id: number) {}

  bb(): AABB {
    return AABB.ofSize(this.x, this.y, this.z, this.width, this.height);
  }

  /** Move with collisions (no step-up); returns whether we hit the ground. */
  protected moveWithCollision(world: BlockWorld, dx: number, dy: number, dz: number): void {
    const [mx, my, mz] = collideBox(world, this.bb(), dx, dy, dz);
    this.x += mx;
    this.y += my;
    this.z += mz;
    this.onGround = dy !== my && dy < 0;
    if (mx !== dx) this.vx = 0;
    if (mz !== dz) this.vz = 0;
  }

  abstract tick(world: BlockWorld): void;
}

/** Dropped item (vanilla ItemEntity physics: gravity 0.04, drag 0.98, ground friction × 0.98, bounce). */
export class ItemEntity extends ServerEntity {
  readonly type = 'item';
  readonly width = 0.25;
  readonly height = 0.25;
  readonly trackRange = 96;
  pickupDelay = 10;
  /** owner-specific pickup restriction not needed yet */
  constructor(id: number, public stack: ItemStack) {
    super(id);
  }

  tick(world: BlockWorld): void {
    this.age++;
    if (this.pickupDelay > 0 && this.pickupDelay !== 32767) this.pickupDelay--;
    const inWater = FLUID[world.getState(Math.floor(this.x), Math.floor(this.y + 0.1), Math.floor(this.z))] === 1;
    if (inWater) {
      // float upward in water (ItemEntity.setUnderwaterMovement)
      this.vx *= 0.99;
      this.vy += this.vy < 0.06 ? 5.0e-4 : 0;
      this.vz *= 0.99;
    } else this.vy -= 0.04;
    if (!this.onGround || this.vx * this.vx + this.vz * this.vz > 1e-5 || (this.age + this.id) % 4 === 0) {
      this.moveWithCollision(world, this.vx, this.vy, this.vz);
      let f = 0.98;
      if (this.onGround) {
        const below = world.getState(Math.floor(this.x), Math.floor(this.y - 1), Math.floor(this.z));
        f = FRICTION[STATE_TO_BLOCK[below]!]! * 0.98;
      }
      this.vx *= f;
      this.vy *= 0.98;
      this.vz *= f;
      if (this.onGround && this.vy < 0) this.vy *= -0.5;
    }
    if (this.age >= 6000) this.removed = true;
  }
}

/**
 * Lightning bolt (vanilla LightningBolt): lives 2 ticks plus 1–3 re-flashes; while flashing
 * it strikes entities within 3 blocks (thunderHit). The client simulates its own flashes.
 */
export class LightningBolt extends ServerEntity {
  readonly type = 'lightning_bolt';
  readonly width = 0;
  readonly height = 0;
  readonly trackRange = 256;
  life = 2;
  flashes: number;
  /** set when the bolt's flash should hit entities this tick */
  striking = false;
  firstTick = true;
  /** fires to place this tick (spawnFire count), −1 for none */
  fire = -1;

  constructor(id: number, private readonly rand: { nextInt(n: number): number }, readonly visualOnly = false) {
    super(id);
    this.flashes = rand.nextInt(3) + 1;
  }

  tick(): void {
    this.fire = -1;
    if (this.life === 2) this.fire = 4;
    this.life--;
    if (this.life < 0) {
      if (this.flashes === 0) this.removed = true;
      else if (this.life < -this.rand.nextInt(10)) {
        this.flashes--;
        this.life = 1;
        this.fire = 0;
      }
    }
    this.striking = this.life >= 0 && !this.removed && !this.visualOnly;
  }
}

/** ExperienceOrb.getExperienceValue: the orb sizes a pile of XP splits into. */
export function experienceOrbValue(i: number): number {
  for (const v of [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3]) if (i >= v) return v;
  return 1;
}

/**
 * Experience orb (vanilla ExperienceOrb): gravity 0.03, drifts toward the nearest player within
 * 8 blocks, bounces on the ground, merges with equal orbs, lives 5 minutes.
 */
export class ExperienceOrb extends ServerEntity {
  readonly type = 'experience_orb';
  readonly width = 0.5;
  readonly height = 0.5;
  readonly trackRange = 96;
  /** how many orbs this entity stands for (merged) */
  count = 1;
  /** id of the player it follows */
  following: { x: number; y: number; z: number; eyeHeight: number } | null = null;

  constructor(id: number, readonly value: number) {
    super(id);
  }

  tick(world: BlockWorld): void {
    this.age++;
    const inWater = FLUID[world.getState(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z))] === 1;
    if (inWater) {
      // setUnderwaterMovement
      this.vx *= 0.99;
      this.vy = Math.min(this.vy + 5.0e-4, 0.06);
      this.vz *= 0.99;
    } else this.vy -= 0.03;
    const f = this.following;
    if (f) {
      const dx = f.x - this.x, dy = f.y + f.eyeHeight / 2 - this.y, dz = f.z - this.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 64) {
        const d = Math.sqrt(d2), k = 1 - d / 8;
        const s = (k * k * 0.1) / (d || 1);
        this.vx += dx * s;
        this.vy += dy * s;
        this.vz += dz * s;
      }
    }
    this.moveWithCollision(world, this.vx, this.vy, this.vz);
    let fr = 0.98;
    if (this.onGround) fr = FRICTION[STATE_TO_BLOCK[world.getState(Math.floor(this.x), Math.floor(this.y - 1), Math.floor(this.z))]!]! * 0.98;
    this.vx *= fr;
    this.vy *= 0.98;
    this.vz *= fr;
    if (this.onGround) this.vy *= -0.9;
    if (this.age >= 6000) this.removed = true;
  }
}
