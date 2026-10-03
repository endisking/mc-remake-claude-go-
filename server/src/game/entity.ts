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
