/** Client-side entities (other players for now; mobs arrive in Phase 6). */

export class RemotePlayer {
  x = 0;
  y = 0;
  z = 0;
  xo = 0;
  yo = 0;
  zo = 0;
  yaw = 0;
  pitch = 0;
  headYaw = 0;
  bodyYaw = 0;
  bodyYawO = 0;
  headYawO = 0;
  pitchO = 0;
  onGround = false;
  flags = 0;
  pose = 'standing';
  // interpolation target (vanilla lerpTo with 3 steps for players)
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lyaw = 0;
  private lpitch = 0;
  private lsteps = 0;
  private lheadYaw = 0;
  private lheadSteps = 0;
  // animation
  animationPosition = 0;
  animationSpeed = 0;
  animationSpeedOld = 0;
  swingTime = 0;
  swinging = false;
  attackAnim = 0;
  attackAnimO = 0;
  /** red hurt tint ticks (LivingEntity.hurtTime) */
  hurtTime = 0;
  /** shared flag: on fire */
  onFire = false;
  tickCount = 0;

  constructor(
    readonly id: number,
    readonly name: string,
    readonly skin: string,
  ) {}

  setPos(x: number, y: number, z: number, yaw: number, pitch: number, headYaw: number): void {
    this.x = this.xo = this.lx = x;
    this.y = this.yo = this.ly = y;
    this.z = this.zo = this.lz = z;
    this.yaw = this.lyaw = yaw;
    this.pitch = this.pitchO = this.lpitch = pitch;
    this.headYaw = this.headYawO = this.lheadYaw = headYaw;
    this.bodyYaw = this.bodyYawO = yaw;
  }

  lerpTo(x: number, y: number, z: number, yaw: number, pitch: number, headYaw: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lyaw = yaw;
    this.lpitch = pitch;
    this.lsteps = 3;
    this.lheadYaw = headYaw;
    this.lheadSteps = 3;
  }

  swing(): void {
    // LivingEntity.swing: restart if not swinging or past halfway
    if (!this.swinging || this.swingTime >= 3 || this.swingTime < 0) {
      this.swingTime = -1;
      this.swinging = true;
    }
  }

  get crouching(): boolean {
    return this.pose === 'crouching';
  }

  tick(): void {
    this.tickCount++;
    this.xo = this.x;
    this.yo = this.y;
    this.zo = this.z;
    this.bodyYawO = this.bodyYaw;
    this.headYawO = this.headYaw;
    this.pitchO = this.pitch;
    if (this.lsteps > 0) {
      this.x += (this.lx - this.x) / this.lsteps;
      this.y += (this.ly - this.y) / this.lsteps;
      this.z += (this.lz - this.z) / this.lsteps;
      this.yaw += wrapDegrees(this.lyaw - this.yaw) / this.lsteps;
      this.pitch += (this.lpitch - this.pitch) / this.lsteps;
      this.lsteps--;
    }
    if (this.lheadSteps > 0) {
      this.headYaw += wrapDegrees(this.lheadYaw - this.headYaw) / this.lheadSteps;
      this.lheadSteps--;
    }
    // body turns toward movement direction, otherwise lags behind the head (LivingEntity.tickHeadTurn)
    const dx = this.x - this.xo, dz = this.z - this.zo;
    const moved = dx * dx + dz * dz;
    let target = this.bodyYaw;
    if (moved > 0.0025000002) target = (Math.atan2(dz, dx) * 180) / Math.PI - 90;
    const diff = wrapDegrees(target - this.bodyYaw);
    this.bodyYaw += diff * 0.3;
    let h = wrapDegrees(this.headYaw - this.bodyYaw);
    if (h < -75) h = -75;
    if (h >= 75) h = 75;
    this.bodyYaw = this.headYaw - h;
    if (h * h > 2500) this.bodyYaw += h * 0.2;
    // limb animation (LivingEntity.calculateEntityAnimation)
    this.animationSpeedOld = this.animationSpeed;
    let f = Math.sqrt(moved) * 4;
    if (f > 1) f = 1;
    this.animationSpeed += (f - this.animationSpeed) * 0.4;
    this.animationPosition += this.animationSpeed;
    // arm swing (6 ticks)
    this.attackAnimO = this.attackAnim;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.swinging) {
      this.swingTime++;
      if (this.swingTime >= 6) {
        this.swingTime = 0;
        this.swinging = false;
      }
    } else this.swingTime = 0;
    this.attackAnim = this.swingTime / 6;
  }
}

export function wrapDegrees(a: number): number {
  a %= 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}
