/** Server-side non-player entities. */
import { AABB, collideBox } from '@shared/entity/aabb';
import { FRICTION } from '@shared/entity/blockphysics';
import { STATE_TO_BLOCK } from '@shared/world/blockstate';
import { FLUID } from '@shared/world/blockinfo';
import { getFlow, FLUID_OF, fluidHeight, fluidKind } from '@shared/game/fluids';
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

  fallDistance = 0;

  constructor(readonly id: number) {}

  bb(): AABB {
    return AABB.ofSize(this.x, this.y, this.z, this.width, this.height);
  }

  /**
   * Entity.updateFluidHeightAndDoFluidPushing for non-player entities: returns the fluid height
   * over the feet (−1 when not touching) and adds the averaged, normalised flow × `factor`.
   */
  protected fluidPush(world: BlockWorld, kind: number, factor: number): number {
    const bb = this.bb().deflate(0.001);
    let height = 0, touching = false;
    let px = 0, py = 0, pz = 0;
    for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y < Math.ceil(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) {
          const f = FLUID_OF[world.getState(x, y, z)]!;
          if (f === 0 || fluidKind(f) !== kind) continue;
          const top = y + fluidHeight(world, x, y, z, f);
          if (top < bb.minY) continue;
          touching = true;
          height = Math.max(top - bb.minY, height);
          const v = getFlow(world, x, y, z);
          const k = height < 0.4 ? height : 1;
          px += v[0] * k;
          py += v[1] * k;
          pz += v[2] * k;
        }
    let len = Math.hypot(px, py, pz);
    if (len > 0) {
      // averaged, then normalised (only players skip the normalisation)
      px /= len;
      py /= len;
      pz /= len;
      px *= factor;
      py *= factor;
      pz *= factor;
      len = factor;
      if (Math.abs(this.vx) < 0.003 && Math.abs(this.vz) < 0.003 && len < 0.0045) {
        const s = 0.0045 / len;
        px *= s;
        py *= s;
        pz *= s;
      }
      this.vx += px;
      this.vy += py;
      this.vz += pz;
    }
    return touching ? height : -1;
  }

  /** Move with collisions (no step-up); returns whether we hit the ground. */
  protected moveWithCollision(world: BlockWorld, dx: number, dy: number, dz: number): void {
    const [mx, my, mz] = collideBox(world, this.bb(), dx, dy, dz, { bottom: this.y, descending: false, fallDistance: this.fallDistance, walkOnPowderSnow: false });
    this.x += mx;
    this.y += my;
    this.z += mz;
    this.onGround = dy !== my && dy < 0;
    // Entity.checkFallDamage bookkeeping (powder snow and scaffolding read it)
    if (this.onGround) this.fallDistance = 0;
    else if (my < 0) this.fallDistance -= my;
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
    // Entity.baseTick: pushed by flowing water (0.014) and lava (0.0023333 in the overworld)
    const water = this.fluidPush(world, 1, 0.014);
    const lava = this.fluidPush(world, 2, 0.0023333333333333335);
    // eye height 0.2125 − 0.11111111
    const eye = 0.2125 - 0.11111111;
    if (water > eye) {
      // float upward in water (ItemEntity.setUnderwaterMovement)
      this.vx *= 0.99;
      this.vy += this.vy < 0.06 ? 5.0e-4 : 0;
      this.vz *= 0.99;
    } else if (lava > eye) {
      // setUnderLavaMovement
      this.vx *= 0.95;
      this.vy += this.vy < 0.06 ? 5.0e-4 : 0;
      this.vz *= 0.95;
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
    this.fluidPush(world, 1, 0.014);
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
