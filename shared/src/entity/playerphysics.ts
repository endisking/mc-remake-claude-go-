/**
 * Player movement simulation, ported from the vanilla 1.17.1 tick logic (LocalPlayer.aiStep,
 * Player.travel, LivingEntity.aiStep/travel, Entity.move/collide/baseTick). Used by the
 * client for prediction and by the server to validate movement.
 *
 * Units: blocks and ticks. Velocities are per tick.
 */
import { AABB, collideBox, noCollision } from './aabb';
import { FRICTION, SPEED_FACTOR, JUMP_FACTOR, CLIMBABLE, STUCK } from './blockphysics';
import { STATE_TO_BLOCK, getProp } from '../world/blockstate';
import { FLUID, FLUID_LEVEL, COLLISION_SHAPE_ID, FULL_COLLISION } from '../world/blockinfo';
import { BLOCKS_BY_NAME } from '../data';
import type { StateGetter } from '../world/raycast';

export type Pose = 'standing' | 'crouching' | 'swimming' | 'fall_flying' | 'sleeping' | 'dying';

export const POSE_SIZE: Record<Pose, [number, number]> = {
  standing: [0.6, 1.8],
  crouching: [0.6, 1.5],
  swimming: [0.6, 0.6],
  fall_flying: [0.6, 0.6],
  sleeping: [0.2, 0.2],
  dying: [0.2, 0.2],
};
export const POSE_EYE: Record<Pose, number> = {
  standing: 1.62,
  crouching: 1.27,
  swimming: 0.4,
  fall_flying: 0.4,
  sleeping: 0.2,
  dying: 1.62,
};

export interface MoveInput {
  /** W/S: +1 forward, −1 back */
  forward: number;
  /** A/D: +1 left, −1 right */
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export const NO_INPUT: MoveInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };

const MAX_UP_STEP = 0.6;
const GRAVITY = 0.08;
const ID_WATER = BLOCKS_BY_NAME.get('water')!.id;
const ID_BUBBLE = BLOCKS_BY_NAME.get('bubble_column')!.id;
const ID_SCAFFOLDING = BLOCKS_BY_NAME.get('scaffolding')!.id;
const ID_LADDER = BLOCKS_BY_NAME.get('ladder')!.id;

export interface PhysicsAbilities {
  flying: boolean;
  mayFly: boolean;
  /** creative/spectator flying speed (default 0.05) */
  flySpeed: number;
  /** spectator: no collision */
  noPhysics: boolean;
}

export interface PhysicsEffects {
  speed: number; // amplifier+1, 0 = none
  slowness: number;
  jumpBoost: number;
  slowFalling: boolean;
  levitation: number;
  dolphinsGrace: boolean;
  depthStrider: number;
}

export class PlayerPhysics {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  onGround = false;
  horizontalCollision = false;
  verticalCollision = false;
  fallDistance = 0;
  pose: Pose = 'standing';
  sprinting = false;
  swimming = false;
  jumping = false;
  shiftDown = false;
  noJumpDelay = 0;
  sprintTriggerTime = 0;
  jumpTriggerTime = 0;
  wasTouchingWater = false;
  wasEyeInWater = false;
  waterHeight = 0;
  lavaHeight = 0;
  stuckX = 0;
  stuckY = 0;
  stuckZ = 0;
  walkDist = 0;
  walkDistO = 0;
  bob = 0;
  oBob = 0;
  /** Food level gates sprinting (> 6). */
  foodLevel = 20;
  usingItem = false;
  blind = false;
  /** forward/strafe impulses after this tick's input processing (for animations/FOV) */
  forwardImpulse = 0;
  leftImpulse = 0;
  readonly abilities: PhysicsAbilities = { flying: false, mayFly: false, flySpeed: 0.05, noPhysics: false };
  readonly effects: PhysicsEffects = { speed: 0, slowness: 0, jumpBoost: 0, slowFalling: false, levitation: 0, dolphinsGrace: false, depthStrider: 0 };
  private prevSprintKey = false;
  private prevJumpKey = false;
  private wasForward = false;

  constructor(readonly world: StateGetter) {}

  get width(): number {
    return POSE_SIZE[this.pose][0];
  }
  get height(): number {
    return POSE_SIZE[this.pose][1];
  }
  get eyeHeight(): number {
    return POSE_EYE[this.pose];
  }

  boundingBox(): AABB {
    return AABB.ofSize(this.x, this.y, this.z, this.width, this.height);
  }

  private state(x: number, y: number, z: number): number {
    return this.world.getState(Math.floor(x), Math.floor(y), Math.floor(z));
  }

  // ------------------------------------------------------------------ attributes
  /** MOVEMENT_SPEED attribute value: base 0.1, sprint ×1.3, Speed +20%/lvl, Slowness −15%/lvl (multiply_total). */
  movementSpeed(): number {
    let v = 0.1;
    // vanilla applies modifiers additively within multiply_base, then multiply_total
    let mult = 1;
    if (this.effects.speed) mult *= 1 + 0.2 * this.effects.speed;
    if (this.effects.slowness) mult *= 1 - 0.15 * this.effects.slowness;
    if (this.sprinting) mult *= 1.3;
    v *= mult;
    return Math.max(0, v);
  }

  // ------------------------------------------------------------------ fluids
  private fluidHeightAt(kind: number, x: number, y: number, z: number): number {
    const s = this.world.getState(x, y, z);
    if (FLUID[s] !== kind) return 0;
    if (FLUID[this.world.getState(x, y + 1, z)] === kind) return 1;
    const lvl = FLUID_LEVEL[s]!;
    return (lvl >= 8 ? 8 : 8 - lvl) / 9;
  }

  private ownHeight(kind: number, x: number, y: number, z: number): number {
    const s = this.world.getState(x, y, z);
    if (FLUID[s] !== kind) return 0;
    const lvl = FLUID_LEVEL[s]!;
    return (lvl >= 8 ? 8 : 8 - lvl) / 9;
  }

  /** Vanilla FlowingFluid.getFlow (horizontal part). */
  private flow(kind: number, x: number, y: number, z: number): [number, number, number] {
    let fx = 0, fz = 0;
    const own = this.ownHeight(kind, x, y, z);
    const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dz] of dirs) {
      const ns = this.world.getState(x + dx, y, z + dz);
      if (FLUID[ns] !== 0 && FLUID[ns] !== kind) continue;
      let f = FLUID[ns] === kind ? this.ownHeight(kind, x + dx, y, z + dz) : 0;
      let f1 = 0;
      if (f === 0) {
        if (COLLISION_SHAPE_ID[ns] === 0) {
          const below = this.ownHeight(kind, x + dx, y - 1, z + dz);
          if (below > 0) f1 = own - (below - 0.8888889);
        }
      } else if (f > 0) f1 = own - f;
      if (f1 !== 0) {
        fx += dx * f1;
        fz += dz * f1;
      }
    }
    const len = Math.hypot(fx, fz);
    return len < 1e-5 ? [0, 0, 0] : [fx / len, 0, fz / len];
  }

  /** updateFluidHeightAndDoFluidPushing for one fluid kind; returns whether touching it. */
  private fluidPush(kind: number, factor: number): boolean {
    const bb = this.boundingBox().deflate(0.001);
    const x0 = Math.floor(bb.minX), x1 = Math.ceil(bb.maxX);
    const y0 = Math.floor(bb.minY), y1 = Math.ceil(bb.maxY);
    const z0 = Math.floor(bb.minZ), z1 = Math.ceil(bb.maxZ);
    let height = 0, touching = false, n = 0;
    let px = 0, py = 0, pz = 0;
    const pushed = !this.abilities.flying;
    for (let x = x0; x < x1; x++)
      for (let y = y0; y < y1; y++)
        for (let z = z0; z < z1; z++) {
          const h = this.fluidHeightAt(kind, x, y, z);
          if (h <= 0) continue;
          const top = y + h;
          if (top >= bb.minY) {
            touching = true;
            height = Math.max(top - bb.minY, height);
            if (pushed) {
              let [fx, fy, fz] = this.flow(kind, x, y, z);
              if (height < 0.4) {
                fx *= height;
                fy *= height;
                fz *= height;
              }
              px += fx;
              py += fy;
              pz += fz;
              n++;
            }
          }
        }
    const len = Math.hypot(px, py, pz);
    if (len > 0) {
      px /= n;
      py /= n;
      pz /= n;
      px *= factor;
      py *= factor;
      pz *= factor;
      const l2 = Math.hypot(px, py, pz);
      if (Math.abs(this.vx) < 0.003 && Math.abs(this.vz) < 0.003 && l2 < 0.0045) {
        const s = 0.0045 / l2;
        px *= s;
        py *= s;
        pz *= s;
      }
      this.vx += px;
      this.vy += py;
      this.vz += pz;
    }
    if (kind === 1) this.waterHeight = height;
    else this.lavaHeight = height;
    return touching;
  }

  get isInWater(): boolean {
    return this.wasTouchingWater;
  }
  get isUnderWater(): boolean {
    return this.wasEyeInWater;
  }
  get isInLava(): boolean {
    return this.lavaHeight > 0;
  }

  private updateEyeInFluid(): void {
    const eyeY = this.y + this.eyeHeight - 0.11111111;
    const bx = Math.floor(this.x), by = Math.floor(eyeY), bz = Math.floor(this.z);
    const h = this.fluidHeightAt(1, bx, by, bz);
    this.wasEyeInWater = h > 0 && by + h > eyeY;
  }

  /** Refresh in-water / in-lava / eye-in-water state at the current position (server side). */
  updateFluidState(): void {
    this.wasTouchingWater = this.fluidPush(1, 0.014);
    this.fluidPush(2, 0.0023333333333333335);
    this.updateEyeInFluid();
  }

  /** Entity.baseTick fluid part + Player.updateSwimming. */
  private baseTick(): void {
    this.walkDistO = this.walkDist;
    this.wasTouchingWater = this.fluidPush(1, 0.014);
    if (this.wasTouchingWater) this.fallDistance = 0;
    this.fluidPush(2, 0.0023333333333333335);
    this.updateEyeInFluid();
    // updateSwimming
    if (this.abilities.flying) this.swimming = false;
    else if (this.swimming) this.swimming = this.sprinting && this.isInWater;
    else this.swimming = this.sprinting && this.isUnderWater && FLUID[this.state(this.x, this.y, this.z)] === 1;
    if (this.isInLava) this.fallDistance *= 0.5;
  }

  // ------------------------------------------------------------------ climbing / block factors
  onClimbable(): boolean {
    if (this.abilities.noPhysics) return false;
    const s = this.state(this.x, this.y, this.z);
    const b = STATE_TO_BLOCK[s]!;
    if (CLIMBABLE[b]) return true;
    // open trapdoor above a ladder with the same facing
    const name = trapdoorCheck(s);
    if (name && getProp(s, 'open') === true) {
      const below = this.state(this.x, this.y - 1, this.z);
      if (STATE_TO_BLOCK[below] === ID_LADDER && getProp(below, 'facing') === getProp(s, 'facing')) return true;
    }
    return false;
  }

  private blockBelowAffectingMovement(): number {
    return this.state(this.x, this.boundingBox().minY - 0.5000001, this.z);
  }

  private blockSpeedFactor(): number {
    const s = this.state(this.x, this.y, this.z);
    const b = STATE_TO_BLOCK[s]!;
    const f = SPEED_FACTOR[b]!;
    if (b !== ID_WATER && b !== ID_BUBBLE) return f === 1 ? SPEED_FACTOR[STATE_TO_BLOCK[this.blockBelowAffectingMovement()]!]! : f;
    return f;
  }

  private blockJumpFactor(): number {
    const f = JUMP_FACTOR[STATE_TO_BLOCK[this.state(this.x, this.y, this.z)]!]!;
    const f1 = JUMP_FACTOR[STATE_TO_BLOCK[this.blockBelowAffectingMovement()]!]!;
    return f === 1 ? f1 : f;
  }

  // ------------------------------------------------------------------ movement core
  private moveRelative(speed: number, strafe: number, up: number, forward: number): void {
    let len = strafe * strafe + up * up + forward * forward;
    if (len < 1e-7) return;
    if (len > 1) {
      len = Math.sqrt(len);
      strafe /= len;
      up /= len;
      forward /= len;
    }
    strafe *= speed;
    up *= speed;
    forward *= speed;
    const r = (this.yaw * Math.PI) / 180;
    const s = Math.sin(r), c = Math.cos(r);
    this.vx += strafe * c - forward * s;
    this.vy += up;
    this.vz += forward * c + strafe * s;
  }

  private isAboveGround(bb: AABB): boolean {
    return this.onGround || (this.fallDistance < MAX_UP_STEP && !noCollision(this.world, bb.move(0, this.fallDistance - MAX_UP_STEP, 0)));
  }

  /** Vanilla Entity.collide with step-up. */
  private collide(dx: number, dy: number, dz: number): [number, number, number] {
    const bb = this.boundingBox();
    const r = collideBox(this.world, bb, dx, dy, dz);
    const cx = r[0] !== dx, cy = r[1] !== dy, cz = r[2] !== dz;
    const grounded = this.onGround || (cy && dy < 0);
    if (grounded && (cx || cz)) {
      let s1 = collideBox(this.world, bb, dx, MAX_UP_STEP, dz);
      const s2 = collideBox(this.world, bb.expandTowards(dx, 0, dz), 0, MAX_UP_STEP, 0);
      if (s2[1] < MAX_UP_STEP) {
        const h = collideBox(this.world, bb.move(0, s2[1], 0), dx, 0, dz);
        const s3: [number, number, number] = [h[0], h[1] + s2[1], h[2]];
        if (s3[0] * s3[0] + s3[2] * s3[2] > s1[0] * s1[0] + s1[2] * s1[2]) s1 = s3;
      }
      if (s1[0] * s1[0] + s1[2] * s1[2] > r[0] * r[0] + r[2] * r[2]) {
        const down = collideBox(this.world, bb.move(s1[0], s1[1], s1[2]), 0, -s1[1] + dy, 0);
        return [s1[0], s1[1] + down[1], s1[2]];
      }
    }
    return r;
  }

  /** Vanilla Entity.move(MoverType.SELF, ...). */
  move(dx: number, dy: number, dz: number): void {
    if (this.abilities.noPhysics) {
      this.x += dx;
      this.y += dy;
      this.z += dz;
      this.horizontalCollision = this.verticalCollision = false;
      this.onGround = false;
      return;
    }
    if (this.stuckX !== 0 || this.stuckY !== 0 || this.stuckZ !== 0) {
      dx *= this.stuckX;
      dy *= this.stuckY;
      dz *= this.stuckZ;
      this.stuckX = this.stuckY = this.stuckZ = 0;
      this.vx = this.vy = this.vz = 0;
    }
    // sneaking: back off from edges (maybeBackOffFromEdge)
    if (!this.abilities.flying && this.shiftDown) {
      const bb = this.boundingBox();
      if (this.isAboveGround(bb)) {
        const step = 0.05;
        while (dx !== 0 && noCollision(this.world, bb.move(dx, -MAX_UP_STEP, 0))) {
          if (Math.abs(dx) < step) dx = 0;
          else dx += dx > 0 ? -step : step;
        }
        while (dz !== 0 && noCollision(this.world, bb.move(0, -MAX_UP_STEP, dz))) {
          if (Math.abs(dz) < step) dz = 0;
          else dz += dz > 0 ? -step : step;
        }
        while (dx !== 0 && dz !== 0 && noCollision(this.world, bb.move(dx, -MAX_UP_STEP, dz))) {
          if (Math.abs(dx) < step) dx = 0;
          else dx += dx > 0 ? -step : step;
          if (Math.abs(dz) < step) dz = 0;
          else dz += dz > 0 ? -step : step;
        }
      }
    }
    const [mx, my, mz] = this.collide(dx, dy, dz);
    this.x += mx;
    this.y += my;
    this.z += mz;
    this.horizontalCollision = !eq(dx, mx) || !eq(dz, mz);
    this.verticalCollision = dy !== my;
    this.onGround = this.verticalCollision && dy < 0;
    // fall distance (Entity.checkFallDamage); landing handled by the caller via landed()
    if (this.onGround) {
      if (this.fallDistance > 0) this.lastFallDistance = this.fallDistance;
      this.fallDistance = 0;
    } else if (my < 0) this.fallDistance -= my;
    if (!eq(dx, mx)) this.vx = 0;
    if (!eq(dz, mz)) this.vz = 0;
    if (dy !== my) {
      // Block.updateEntityAfterFallOn: slime bounces unless sneaking, beds bounce at 66%
      const below = this.state(this.x, this.y - 0.2, this.z);
      const b = STATE_TO_BLOCK[below]!;
      if (b === ID_SLIME && !this.shiftDown && this.vy < 0) this.vy = -this.vy;
      else if (BED_IDS.has(b) && !this.shiftDown && this.vy < 0) this.vy = -this.vy * 0.66;
      else this.vy = 0;
    }
    const horiz = Math.hypot(mx, mz);
    this.walkDist += horiz * 0.6;
    // entityInside: stuck blocks (cobweb, berry bush, powder snow)
    this.checkInsideBlocks();
    const sf = this.blockSpeedFactor();
    this.vx *= sf;
    this.vz *= sf;
  }

  /** Fall distance at the moment of the last landing (consumed by fall-damage logic). */
  lastFallDistance = 0;

  private checkInsideBlocks(): void {
    const bb = this.boundingBox().deflate(0.001);
    for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++) {
          const b = STATE_TO_BLOCK[this.world.getState(x, y, z)]!;
          const sx = STUCK[b * 3]!;
          if (sx !== 0) {
            this.fallDistance = 0;
            this.stuckX = sx;
            this.stuckY = STUCK[b * 3 + 1]!;
            this.stuckZ = STUCK[b * 3 + 2]!;
          }
        }
  }

  private handleOnClimbable(): void {
    if (!this.onClimbable()) return;
    this.fallDistance = 0;
    this.vx = Math.max(-0.15, Math.min(0.15, this.vx));
    this.vz = Math.max(-0.15, Math.min(0.15, this.vz));
    this.vy = Math.max(this.vy, -0.15);
    if (this.vy < 0 && STATE_TO_BLOCK[this.state(this.x, this.y, this.z)] !== ID_SCAFFOLDING && this.shiftDown) this.vy = 0;
  }

  private fluidFallingAdjusted(gravity: number, falling: boolean): void {
    if (!this.sprinting) {
      const d = falling && Math.abs(this.vy - 0.005) >= 0.003 && Math.abs(this.vy - gravity / 16) < 0.003 ? -0.003 : this.vy - gravity / 16;
      this.vy = d;
    }
  }

  private isFree(dx: number, dy: number, dz: number): boolean {
    const bb = this.boundingBox().move(dx, dy, dz);
    if (!noCollision(this.world, bb)) return false;
    // also not in liquid
    for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y < Math.ceil(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) if (FLUID[this.world.getState(x, y, z)] !== 0) return false;
    return true;
  }

  /** LivingEntity.travel (+ Player.travel flying/swimming wrappers). */
  private travel(strafe: number, up: number, forward: number, flyingSpeed: number): void {
    // Player.travel: swimming look-direction vertical pull
    if (this.swimming) {
      const lookY = -Math.sin((this.pitch * Math.PI) / 180);
      const k = lookY < -0.2 ? 0.085 : 0.06;
      const headInWater = FLUID[this.state(this.x, this.y + 1 - 0.1, this.z)] !== 0;
      if (lookY <= 0 || this.jumping || headInWater) this.vy += (lookY - this.vy) * k;
    }
    let gravity = GRAVITY;
    const falling = this.vy <= 0;
    if (falling && this.effects.slowFalling) {
      gravity = 0.01;
      this.fallDistance = 0;
    }
    if (this.isInWater && !this.abilities.flying) {
      const y0 = this.y;
      let drag = this.sprinting ? 0.9 : 0.8;
      let accel = 0.02;
      let ds = Math.min(3, this.effects.depthStrider);
      if (!this.onGround) ds *= 0.5;
      if (ds > 0) {
        drag += ((0.54600006 - drag) * ds) / 3;
        accel += ((this.movementSpeed() - accel) * ds) / 3;
      }
      if (this.effects.dolphinsGrace) drag = 0.96;
      this.moveRelative(accel, strafe, up, forward);
      this.move(this.vx, this.vy, this.vz);
      if (this.horizontalCollision && this.onClimbable()) this.vy = 0.2;
      this.vx *= drag;
      this.vy *= 0.8;
      this.vz *= drag;
      this.fluidFallingAdjusted(gravity, falling);
      if (this.horizontalCollision && this.isFree(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
    } else if (this.isInLava && !this.abilities.flying) {
      const y0 = this.y;
      this.moveRelative(0.02, strafe, up, forward);
      this.move(this.vx, this.vy, this.vz);
      if (this.lavaHeight <= this.fluidJumpThreshold()) {
        this.vx *= 0.5;
        this.vy *= 0.8;
        this.vz *= 0.5;
        this.fluidFallingAdjusted(gravity, falling);
      } else {
        this.vx *= 0.5;
        this.vy *= 0.5;
        this.vz *= 0.5;
      }
      this.vy -= gravity / 4;
      if (this.horizontalCollision && this.isFree(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
    } else {
      const below = this.blockBelowAffectingMovement();
      const friction = FRICTION[STATE_TO_BLOCK[below]!]!;
      const f4 = this.onGround ? friction * 0.91 : 0.91;
      // handleRelativeFrictionAndCalculateMovement
      const speed = this.onGround ? this.movementSpeed() * (0.21600002 / (friction * friction * friction)) : flyingSpeed;
      this.moveRelative(speed, strafe, up, forward);
      this.handleOnClimbable();
      this.move(this.vx, this.vy, this.vz);
      if ((this.horizontalCollision || this.jumping) && this.onClimbable()) this.vy = 0.2;
      let vy = this.vy;
      if (this.effects.levitation) {
        vy += (0.05 * this.effects.levitation - vy) * 0.2;
        this.fallDistance = 0;
      } else if (!this.loadedAt(Math.floor(this.x), Math.floor(this.z))) {
        // client in an unloaded chunk: sink slowly (vanilla)
        vy = this.y > 0 ? -0.1 : 0;
      } else vy -= gravity;
      this.vx *= f4;
      this.vy = vy * 0.98;
      this.vz *= f4;
    }
  }

  /** Whether the chunk at a block column is loaded (client: sinks slowly in unloaded chunks). */
  loadedAt: (x: number, z: number) => boolean = () => true;

  private fluidJumpThreshold(): number {
    return this.eyeHeight < 0.4 ? 0 : 0.4;
  }

  private jumpFromGround(): void {
    let f = 0.42 * this.blockJumpFactor();
    if (this.effects.jumpBoost) f += 0.1 * this.effects.jumpBoost;
    this.vy = f;
    if (this.sprinting) {
      const r = (this.yaw * Math.PI) / 180;
      this.vx += -Math.sin(r) * 0.2;
      this.vz += Math.cos(r) * 0.2;
    }
  }

  // ------------------------------------------------------------------ poses
  private canEnterPose(p: Pose): boolean {
    const [w, h] = POSE_SIZE[p];
    return noCollision(this.world, AABB.ofSize(this.x, this.y, this.z, w, h).deflate(1e-7));
  }

  /** Player.updatePlayerPose. */
  updatePose(): void {
    let p: Pose;
    if (this.swimming) p = 'swimming';
    else if (this.shiftDown && !this.abilities.flying) p = 'crouching';
    else p = 'standing';
    if (!this.abilities.noPhysics && !this.canEnterPose(p)) p = this.canEnterPose('crouching') ? 'crouching' : 'swimming';
    this.pose = p;
  }

  /** True when crouching or crawling (input is slowed to 30%). */
  isMovingSlowly(): boolean {
    return this.pose === 'crouching' || (this.pose === 'swimming' && !this.isInWater);
  }

  // ------------------------------------------------------------------ tick
  /**
   * One game tick of a locally controlled player (LocalPlayer.tick → aiStep).
   * `allowFlightToggle` enables double-tap-jump flight in creative.
   */
  tick(input: MoveInput): void {
    this.baseTick();
    if (this.sprintTriggerTime > 0) this.sprintTriggerTime--;
    if (this.jumpTriggerTime > 0) this.jumpTriggerTime--;
    const wasShift = this.shiftDown;
    const wasForwardEnough = this.hasEnoughImpulseToStartSprinting();
    // KeyboardInput.tick
    let fwd = input.forward, left = input.strafe;
    this.shiftDown = input.sneak;
    if (this.isMovingSlowly()) {
      fwd *= 0.3;
      left *= 0.3;
    }
    if (this.usingItem) {
      fwd *= 0.2;
      left *= 0.2;
      this.sprintTriggerTime = 0;
    }
    this.forwardImpulse = fwd;
    this.leftImpulse = left;
    const canSprint = this.foodLevel > 6 || this.abilities.mayFly;
    // double-tap forward to sprint
    if ((this.onGround || this.isUnderWater) && !wasShift && !wasForwardEnough && this.hasEnoughImpulseToStartSprinting() && !this.sprinting && canSprint && !this.usingItem && !this.blind) {
      if (this.sprintTriggerTime <= 0 && !input.sprint) this.sprintTriggerTime = 7;
      else this.sprinting = true;
    }
    if (!this.sprinting && (!this.isInWater || this.isUnderWater) && this.hasEnoughImpulseToStartSprinting() && canSprint && !this.usingItem && !this.blind && input.sprint) {
      this.sprinting = true;
    }
    if (this.sprinting) {
      const stop = !this.hasEnoughImpulseToStartSprinting() || !canSprint;
      const stop2 = stop || this.horizontalCollision || (this.isInWater && !this.isUnderWater);
      if (this.swimming) {
        if ((!this.onGround && !input.sneak && stop) || !this.isInWater) this.sprinting = false;
      } else if (stop2) this.sprinting = false;
    }
    // creative flight toggle: double-tap jump
    if (this.abilities.mayFly && !this.abilities.noPhysics) {
      if (input.jump && !this.prevJumpKey) {
        if (this.jumpTriggerTime === 0) this.jumpTriggerTime = 7;
        else {
          this.abilities.flying = !this.abilities.flying;
          this.jumpTriggerTime = 0;
        }
      }
    }
    this.prevJumpKey = input.jump;
    if (this.abilities.noPhysics) this.abilities.flying = true;
    // flying vertical control
    if (this.abilities.flying) {
      let j = 0;
      if (input.sneak) j--;
      if (input.jump) j++;
      if (j !== 0) this.vy += j * this.abilities.flySpeed * 3;
    }
    this.jumping = input.jump;
    // Player.aiStep → LivingEntity.aiStep
    const flyingSpeed = this.sprinting ? 0.026 : 0.02;
    if (this.noJumpDelay > 0) this.noJumpDelay--;
    if (Math.abs(this.vx) < 0.003) this.vx = 0;
    if (Math.abs(this.vy) < 0.003) this.vy = 0;
    if (Math.abs(this.vz) < 0.003) this.vz = 0;
    if (this.jumping && !this.abilities.flying) {
      const inWater = this.isInWater && this.waterHeight > 0;
      const h = this.isInLava ? this.lavaHeight : this.waterHeight;
      const thr = this.fluidJumpThreshold();
      if (!inWater || (this.onGround && !(h > thr))) {
        if (!this.isInLava || (this.onGround && !(h > thr))) {
          if ((this.onGround || (inWater && h <= thr)) && this.noJumpDelay === 0) {
            this.jumpFromGround();
            this.noJumpDelay = 10;
          }
        } else this.vy += 0.04; // jumpInLiquid (lava)
      } else this.vy += 0.04; // jumpInLiquid (water)
    } else this.noJumpDelay = 0;
    const strafe = left * 0.98, forward = fwd * 0.98;
    if (this.abilities.flying) {
      const vy0 = this.vy;
      const fs = this.abilities.flySpeed * (this.sprinting ? 2 : 1);
      this.travel(strafe, 0, forward, fs);
      this.vy = vy0 * 0.6;
      this.fallDistance = 0;
    } else {
      this.travel(strafe, 0, forward, flyingSpeed);
    }
    // landing ends creative flight
    if (this.onGround && this.abilities.flying && !this.abilities.noPhysics) this.abilities.flying = false;
    // view bob (Player.aiStep)
    this.oBob = this.bob;
    const hd = this.onGround && !this.swimming ? Math.min(0.1, Math.hypot(this.vx, this.vz)) : 0;
    this.bob += (hd - this.bob) * 0.4;
    this.updatePose();
    this.wasForward = this.forwardImpulse > 1e-5;
  }

  hasEnoughImpulseToStartSprinting(): boolean {
    return this.isUnderWater ? this.forwardImpulse > 1e-5 : this.forwardImpulse >= 0.8;
  }
}

function eq(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

const ID_SLIME = BLOCKS_BY_NAME.get('slime_block')!.id;
const BED_IDS = new Set([...BLOCKS_BY_NAME.values()].filter((b) => b.name.endsWith('_bed')).map((b) => b.id));
const TRAPDOOR_IDS = new Set([...BLOCKS_BY_NAME.values()].filter((b) => b.name.endsWith('_trapdoor')).map((b) => b.id));
function trapdoorCheck(state: number): boolean {
  return TRAPDOOR_IDS.has(STATE_TO_BLOCK[state]!);
}

export { FULL_COLLISION };
