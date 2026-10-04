/**
 * Boats (vanilla Boat, 1.17.1): placed from a boat item, float on water (buoyancy toward a
 * waterline 0.366 below the surface), paddled by the controlling passenger (0.04 forward,
 * 0.005 back or while only turning, ±1°/tick turning with 0.9 rotational damping in water),
 * glide on ice (ground friction averaged under the hull, halved with a player driver), carry
 * two passengers, and break into their boat item after 40 damage (×10 per hit; creative = instant).
 */
import { AABB } from '@shared/entity/aabb';
import { FRICTION } from '@shared/entity/blockphysics';
import { STATE_TO_BLOCK } from '@shared/world/blockstate';
import { FLUID_OF, fluidHeight, fluidKind, getFlow } from '@shared/game/fluids';
import { collideBox } from '@shared/entity/aabb';
import type { BlockWorld } from '@shared/world/world';
import { ServerEntity } from './entity';
import type { SteerInput, Vehicle } from './riding';

export const BOAT_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'] as const;

type Status = 'in_water' | 'under_water' | 'under_flowing_water' | 'on_land' | 'in_air';

export class Boat extends ServerEntity implements Vehicle {
  readonly type = 'boat';
  readonly width = 1.375;
  readonly height = 0.5625;
  readonly trackRange = 80;
  steer: SteerInput | null = null;
  /** Boat.Type ordinal (BOAT_WOODS index) */
  wood = 0;
  damage = 0;
  hurtTime = 0;
  hurtDir = 1;
  deltaRotation = 0;
  status: Status = 'on_land';
  oldStatus: Status = 'on_land';
  waterLevel = 0;
  landFriction = 0;
  outOfControlTicks = 0;
  /** set when a driving player held the boat this tick (landFriction halved) */
  driverIsPlayer = false;

  maxPassengers(): number {
    return 2;
  }
  /** Boat.getPassengersRidingOffset */
  passengersRidingOffset(): number {
    return -0.1;
  }
  /** Boat.positionRider: two riders sit at +0.2 and −0.6 along the hull */
  seatOffset(i: number, n: number): number {
    return n > 1 ? (i === 0 ? 0.2 : -0.6) : 0;
  }

  itemName(): string {
    return `${BOAT_WOODS[this.wood] ?? 'oak'}_boat`;
  }

  private world: BlockWorld | null = null;
  /** Boat.lastYd: vertical movement of the previous tick */
  private lastYd = 0;

  tick(world: BlockWorld): void {
    this.world = world;
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.damage > 0) this.damage -= 1;
    this.oldStatus = this.status;
    this.status = this.getStatus(world);
    this.outOfControlTicks = this.status === 'under_water' || this.status === 'under_flowing_water' ? this.outOfControlTicks + 1 : 0;
    this.floatBoat();
    if (this.steer) this.controlBoat(this.steer);
    const y0 = this.y;
    this.move(world, this.vx, this.vy, this.vz);
    this.lastYd = this.y - y0;
  }

  /** Boat.controlBoat */
  controlBoat(inp: SteerInput): void {
    const left = inp.strafe > 0, right = inp.strafe < 0, up = inp.forward > 0, down = inp.forward < 0;
    let f = 0;
    if (left) this.deltaRotation--;
    if (right) this.deltaRotation++;
    if (right !== left && !up && !down) f += 0.005;
    this.yaw += this.deltaRotation;
    if (up) f += 0.04;
    if (down) f -= 0.005;
    const r = (this.yaw * Math.PI) / 180;
    this.vx += Math.sin(-r) * f;
    this.vz += Math.cos(r) * f;
  }

  /** Boat.floatBoat */
  floatBoat(): void {
    const d1 = -0.04;
    let d2 = 0;
    let inv = 0.05;
    if (this.oldStatus === 'in_air' && this.status !== 'in_air' && this.status !== 'on_land') {
      this.waterLevel = this.y + this.height;
      this.y = this.waterLevelAbove(this.world!) - this.height + 0.101;
      this.vy = 0;
      this.status = 'in_water';
      return;
    }
    if (this.status === 'in_water') {
      d2 = (this.waterLevel - this.y) / this.height;
      inv = 0.9;
    } else if (this.status === 'under_flowing_water') {
      this.vy += -7.0e-4 - d1; // replaces the gravity below
      inv = 0.9;
    } else if (this.status === 'under_water') {
      d2 = 0.01;
      inv = 0.45;
    } else if (this.status === 'in_air') inv = 0.9;
    else if (this.status === 'on_land') {
      inv = this.landFriction;
      if (this.driverIsPlayer) this.landFriction /= 2;
    }
    this.vx *= inv;
    this.vy += d1;
    this.vz *= inv;
    this.deltaRotation *= inv;
    if (d2 > 0) this.vy = (this.vy + d2 * 0.06153846) * 0.75;
  }

  /** Boat.getWaterLevelAbove: the first water layer from the hull top upward that isn't full */
  private waterLevelAbove(world: BlockWorld): number {
    const bb = this.bb();
    const l = Math.floor(bb.maxY), i1 = Math.ceil(bb.maxY - this.lastYd);
    outer: for (let k = l; k < i1; k++) {
      let f = 0;
      for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
        for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) {
          const fl = FLUID_OF[world.getState(x, k, z)]!;
          if (fl !== 0 && fluidKind(fl) === 1) f = Math.max(f, fluidHeight(world, x, k, z, fl));
          if (f >= 1) continue outer;
        }
      if (f < 1) return k + f;
    }
    return i1 + 1;
  }

  /** Boat.getStatus */
  getStatus(world: BlockWorld): Status {
    const under = this.isUnderwater(world);
    if (under) {
      this.waterLevel = this.bb().maxY;
      return under;
    }
    if (this.checkInWater(world)) return 'in_water';
    const f = this.groundFriction(world);
    if (f > 0) {
      this.landFriction = f;
      return 'on_land';
    }
    return 'in_air';
  }

  /** Boat.checkInWater: highest water surface touching the hull */
  private checkInWater(world: BlockWorld): boolean {
    const bb = this.bb();
    let found = false;
    this.waterLevel = -Infinity;
    for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y < Math.ceil(bb.minY + 0.001); y++)
        for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) {
          const fl = FLUID_OF[world.getState(x, y, z)]!;
          if (fl === 0 || fluidKind(fl) !== 1) continue;
          const top = y + fluidHeight(world, x, y, z, fl);
          this.waterLevel = Math.max(top, this.waterLevel);
          if (bb.minY < top) found = true;
        }
    return found;
  }

  /** Boat.isUnderwater: water above the hull's top */
  private isUnderwater(world: BlockWorld): Status | null {
    const bb = this.bb();
    const top = bb.maxY + 0.001;
    let flowing = false, any = false;
    for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
      for (let y = Math.floor(bb.maxY); y < Math.ceil(top); y++)
        for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) {
          const fl = FLUID_OF[world.getState(x, y, z)]!;
          if (fl === 0 || fluidKind(fl) !== 1) continue;
          if (top < y + fluidHeight(world, x, y, z, fl)) {
            any = true;
            const v = getFlow(world, x, y, z);
            if (v[0] !== 0 || v[2] !== 0) flowing = true;
          }
        }
    return any ? (flowing ? 'under_flowing_water' : 'under_water') : null;
  }

  /** Boat.getGroundFriction: average friction of the blocks under the hull (0 = none) */
  groundFriction(world: BlockWorld): number {
    const bb = this.bb();
    const y = Math.floor(bb.minY - 0.001);
    let sum = 0, n = 0;
    for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
      for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) {
        const st = world.getState(x, y, z);
        const box = new AABB(x, y, z, x + 1, y + 1, z + 1);
        if (!box.intersects(bb.move(0, -0.001, 0))) continue;
        const [, my] = collideBox(world, new AABB(Math.max(bb.minX, x), bb.minY, Math.max(bb.minZ, z), Math.min(bb.maxX, x + 1), bb.minY + 0.01, Math.min(bb.maxZ, z + 1)), 0, -0.002, 0);
        if (my > -0.002) {
          sum += FRICTION[STATE_TO_BLOCK[st]!]!;
          n++;
        }
      }
    return n > 0 ? sum / n : 0;
  }

  private move(world: BlockWorld, dx: number, dy: number, dz: number): void {
    const [mx, my, mz] = collideBox(world, this.bb(), dx, dy, dz);
    this.x += mx;
    this.y += my;
    this.z += mz;
    this.onGround = my !== dy && dy < 0;
    if (my !== dy) this.vy = 0;
    if (mx !== dx) this.vx = 0;
    if (mz !== dz) this.vz = 0;
  }

  /** Boat.hurt: damage × 10 accumulates; > 40 (or creative) breaks it. Returns true when destroyed. */
  hit(amount: number, creative: boolean): boolean {
    this.hurtDir = -this.hurtDir;
    this.hurtTime = 10;
    this.damage += amount * 10;
    return creative || this.damage > 40;
  }
}
