/**
 * Client-side mobs: interpolation toward server positions (vanilla lerpTo, 3 steps), body
 * rotation (BodyRotationControl), limb animation (LivingEntity.calculateEntityAnimation),
 * hurt/death timers and the small per-type client animations vanilla runs locally (sheep
 * grazing, chicken wing flapping, creeper swelling, slime squish).
 */
import { ENTITIES_BY_NAME } from '@shared/data';
import { wrapDegrees } from './entities';

/** Mob types the client knows how to draw (others fall back to a generic box). */
export interface MobInfo {
  /** EntityRenderer.shadowRadius (blocks) */
  shadow: number;
  /** sound category of its ambient/hurt/death sounds */
  category: 'hostile' | 'neutral' | 'ambient';
  /** degrees the model rotates when dying (LivingEntityRenderer.getFlipDegrees) */
  flip: number;
  /** Mob.getAmbientSoundInterval (ticks) */
  ambientInterval: number;
  /** flying mobs include vertical motion in the limb animation */
  flying?: boolean;
  /** step sound event (null: silent steps) */
  step?: string | null;
}

const H = (shadow: number, extra: Partial<MobInfo> = {}): MobInfo => ({ shadow, category: 'hostile', flip: 90, ambientInterval: 80, ...extra });
const N = (shadow: number, extra: Partial<MobInfo> = {}): MobInfo => ({ shadow, category: 'neutral', flip: 90, ambientInterval: 80, ...extra });

export const MOB_INFO: Record<string, MobInfo> = {
  zombie: H(0.5),
  husk: H(0.5),
  drowned: H(0.5),
  zombie_villager: H(0.5),
  skeleton: H(0.5),
  stray: H(0.5),
  wither_skeleton: H(0.5),
  creeper: H(0.5, { step: null }),
  spider: H(1, { flip: 180 }),
  cave_spider: H(0.7, { flip: 180 }),
  enderman: H(0.5),
  slime: H(0.25),
  pig: N(0.7, { ambientInterval: 120 }),
  cow: N(0.7, { ambientInterval: 120 }),
  sheep: N(0.7, { ambientInterval: 120 }),
  chicken: N(0.3, { ambientInterval: 120 }),
  squid: N(0.7, { category: 'neutral', step: null }),
  glow_squid: N(0.7, { category: 'neutral', step: null }),
  villager: N(0.5),
  wandering_trader: N(0.5),
  witch: H(0.5),
  bat: N(0.25, { category: 'ambient', flying: true, step: null }),
};

export function isMobType(type: string): boolean {
  if (type in MOB_INFO) return true;
  const e = ENTITIES_BY_NAME.get(type);
  return !!e && (e.type === 'mob' || e.type === 'hostile' || e.type === 'animal' || e.type === 'water_creature' || e.type === 'ambient' || e.type === 'passive');
}

export class ClientMob {
  x = 0;
  y = 0;
  z = 0;
  xo = 0;
  yo = 0;
  zo = 0;
  /** entity yRot (the body's facing when moving) */
  yaw = 0;
  pitch = 0;
  pitchO = 0;
  headYaw = 0;
  headYawO = 0;
  bodyYaw = 0;
  bodyYawO = 0;
  onGround = false;
  wasOnGround = false;
  flags = 0;
  // interpolation (vanilla lerpTo: 3 steps; lerpHeadTo: 3 steps)
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private lyaw = 0;
  private lpitch = 0;
  private lsteps = 0;
  private lheadYaw = 0;
  private lheadSteps = 0;
  // BodyRotationControl
  private headStableTime = 0;
  private lastStableHeadYaw = 0;
  // limb animation
  animationPosition = 0;
  animationSpeed = 0;
  animationSpeedOld = 0;
  // swing (attack) animation
  swingTime = 0;
  swinging = false;
  attackAnim = 0;
  attackAnimO = 0;
  hurtTime = 0;
  /** LivingEntity.deathTime: 0 alive, counts up to 20 then the poof */
  deathTime = 0;
  /** removed by the server (or done dying): drop from the world after the death animation */
  removed = false;
  /** death poof already spawned */
  poofed = false;
  tickCount = 0;
  /** synced per-mob values (mobData packet) */
  readonly data = new Map<string, number>();
  /** custom name (name tag), '' if none */
  customName = '';
  mainHand = -1;
  offHand = 0;
  // per-type client state
  /** Sheep.eatAnimationTick */
  eatAnimationTick = 0;
  /** Chicken flap state */
  flap = 0;
  oFlap = 0;
  flapSpeed = 0;
  oFlapSpeed = 0;
  private flapping = 1;
  /** Creeper swell (0..30) */
  swell = 0;
  oldSwell = 0;
  /** Slime squish */
  squish = 0;
  oSquish = 0;
  private targetSquish = 0;
  /** Squid tentacle animation (Squid.aiStep) */
  tentacleAngle = 0;
  tentacleAngleO = 0;
  private tentacleMovement = 0;
  /** Squid body tilt (degrees, Squid.xBodyRot): leans toward its swim direction */
  xBodyRot = 0;
  xBodyRotO = 0;
  private tentacleSpeed = 0;
  /** ambient sound timer (Mob.ambientSoundTime) */
  ambientSoundTime = 0;
  /** distance walked for step sounds (Entity.moveDist / nextStep) */
  moveDist = 0;
  nextStep = 1;
  readonly info: MobInfo;
  readonly width: number;
  readonly height: number;

  constructor(
    readonly id: number,
    readonly type: string,
  ) {
    this.info = MOB_INFO[type] ?? H(0.5);
    const e = ENTITIES_BY_NAME.get(type);
    this.width = e?.width ?? 0.6;
    this.height = e?.height ?? 1.8;
    this.ambientSoundTime = -this.info.ambientInterval;
  }

  get baby(): boolean {
    return (this.data.get('baby') ?? 0) !== 0;
  }
  get onFire(): boolean {
    return (this.flags & 1) !== 0;
  }
  get invisible(): boolean {
    return (this.flags & 32) !== 0;
  }
  get dying(): boolean {
    return this.deathTime > 0;
  }
  /** Slime size (1, 2 or 4; vanilla bounding box 0.51·size, scaled from minecraft-data's size-4 entry) */
  get slimeSize(): number {
    return Math.max(1, this.data.get('size') ?? 1);
  }

  /** Bounding box size (Entity.getDimensions with the baby scale). */
  dims(): [number, number] {
    if (this.type === 'slime' || this.type === 'magma_cube') {
      const s = 0.51000005 * this.slimeSize;
      return [s, s];
    }
    const k = this.baby ? 0.5 : 1;
    return [this.width * k, this.height * k];
  }

  setPos(x: number, y: number, z: number, yaw: number, pitch: number, headYaw: number): void {
    this.x = this.xo = this.lx = x;
    this.y = this.yo = this.ly = y;
    this.z = this.zo = this.lz = z;
    this.yaw = this.lyaw = yaw;
    this.pitch = this.pitchO = this.lpitch = pitch;
    this.headYaw = this.headYawO = this.lheadYaw = this.lastStableHeadYaw = headYaw;
    this.bodyYaw = this.bodyYawO = yaw;
  }

  lerpTo(x: number, y: number, z: number, yaw: number, pitch: number, headYaw: number, onGround: boolean): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
    this.lyaw = yaw;
    this.lpitch = pitch;
    this.lsteps = 3;
    this.lheadYaw = headYaw;
    this.lheadSteps = 3;
    this.onGround = onGround;
  }

  swing(): void {
    // LivingEntity.swing: restart if not swinging or past halfway (6-tick swing)
    if (!this.swinging || this.swingTime >= 3 || this.swingTime < 0) {
      this.swingTime = -1;
      this.swinging = true;
    }
  }

  /** LivingEntity.handleEntityEvent subset; returns which sound to play, if any. */
  handleEvent(event: number): 'hurt' | 'death' | null {
    switch (event) {
      case 2: case 33: case 36: case 37: case 44: case 57:
        this.hurtTime = 10;
        return 'hurt';
      case 3:
        if (this.deathTime === 0) this.deathTime = 1;
        this.hurtTime = 10;
        return 'death';
      case 10:
        // Sheep: start grazing (40 ticks)
        if (this.type === 'sheep') this.eatAnimationTick = 40;
        return null;
      default:
        return null;
    }
  }

  setData(key: string, value: number): void {
    this.data.set(key, value);
  }

  /** One client tick (20 TPS). */
  tick(): void {
    this.tickCount++;
    this.xo = this.x;
    this.yo = this.y;
    this.zo = this.z;
    this.bodyYawO = this.bodyYaw;
    this.headYawO = this.headYaw;
    this.pitchO = this.pitch;
    this.wasOnGround = this.onGround;
    if (this.deathTime > 0) {
      // dying mobs stay where they fell (LivingEntity.tickDeath); position still lerps in
      this.deathTime++;
    }
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
    const dx = this.x - this.xo, dz = this.z - this.zo;
    if (this.deathTime === 0) this.bodyRotationTick(dx * dx + dz * dz);
    // limb animation (LivingEntity.calculateEntityAnimation)
    this.animationSpeedOld = this.animationSpeed;
    const dy = this.info.flying ? this.y - this.yo : 0;
    let f = Math.sqrt(dx * dx + dy * dy + dz * dz) * 4;
    if (f > 1) f = 1;
    if (this.deathTime > 0) f = 0;
    this.animationSpeed += (f - this.animationSpeed) * 0.4;
    this.animationPosition += this.animationSpeed;
    // swing (LivingEntity.updateSwingTime, 6 ticks)
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
    this.typeTick();
  }

  /**
   * BodyRotationControl.clientTick: while moving the body follows yRot and the head is kept
   * within 75° of it; standing still the body turns after the head once it moves more than 15°,
   * and after 10 still ticks the body gradually lines up with the head.
   */
  private bodyRotationTick(moved2: number): void {
    const max = 75;
    if (moved2 > 2.5e-7) {
      this.bodyYaw = this.yaw;
      this.headYaw = rotateIfNecessary(this.headYaw, this.bodyYaw, max);
      this.lastStableHeadYaw = this.headYaw;
      this.headStableTime = 0;
      return;
    }
    if (Math.abs(this.headYaw - this.lastStableHeadYaw) > 15) {
      this.headStableTime = 0;
      this.lastStableHeadYaw = this.headYaw;
      this.bodyYaw = rotateIfNecessary(this.bodyYaw, this.headYaw, max);
    } else if (++this.headStableTime > 10) {
      const i = this.headStableTime - 10;
      const k = Math.min(1, Math.max(0, i / 10));
      this.bodyYaw = rotateIfNecessary(this.bodyYaw, this.headYaw, max * (1 - k));
    }
  }

  private typeTick(): void {
    switch (this.type) {
      case 'sheep':
        // Sheep.aiStep (client): the grazing timer runs down locally
        this.eatAnimationTick = Math.max(0, this.eatAnimationTick - 1);
        break;
      case 'chicken': {
        // Chicken.aiStep: wings flap while airborne
        this.oFlap = this.flap;
        this.oFlapSpeed = this.flapSpeed;
        this.flapSpeed += (this.onGround ? -1 : 4) * 0.3;
        this.flapSpeed = Math.min(1, Math.max(0, this.flapSpeed));
        if (!this.onGround && this.flapping < 1) this.flapping = 1;
        this.flapping *= 0.9;
        this.flap += this.flapping * 2;
        break;
      }
      case 'creeper': {
        // Creeper.tick: swell moves by the synced swell direction, 0..maxSwell (30)
        this.oldSwell = this.swell;
        const dir = this.data.get('swell_dir') ?? -1;
        if (dir > 0 && this.swell === 0) {
          /* fuse sound is played by the server (entity.creeper.primed) */
        }
        this.swell = Math.min(30, Math.max(0, this.swell + (dir > 0 ? 1 : -1)));
        break;
      }
      case 'squid':
      case 'glow_squid': {
        // Squid.aiStep (client part): tentacles pulse; a stroke restarts after each cycle
        this.tentacleAngleO = this.tentacleAngle;
        this.tentacleMovement += this.tentacleSpeed;
        if (this.tentacleMovement > Math.PI * 2 || this.tentacleSpeed === 0) {
          this.tentacleMovement = this.tentacleMovement > Math.PI * 2 ? this.tentacleMovement - Math.PI * 2 : 0;
          this.tentacleSpeed = (1 / (Math.random() + 1)) * 0.2;
        }
        // Squid.aiStep: the mantle tilts toward the direction of motion
        this.xBodyRotO = this.xBodyRot;
        const hd = Math.hypot(this.x - this.xo, this.z - this.zo), vd = this.y - this.yo;
        const target = hd * hd + vd * vd > 1e-6 ? (-Math.atan2(hd, vd) * 180) / Math.PI : 0;
        this.xBodyRot += (target - this.xBodyRot) * 0.1;
        if (this.tentacleMovement < Math.PI) {
          const f = this.tentacleMovement / Math.PI;
          this.tentacleAngle = Math.sin(f * f * Math.PI) * Math.PI * 0.25;
        } else this.tentacleAngle = 0;
        break;
      }
      case 'slime':
      case 'magma_cube': {
        // Slime.tick: squash on landing, stretch when jumping, relax back
        this.squish += (this.targetSquish - this.squish) * 0.5;
        this.oSquish = this.squish;
        if (this.onGround && !this.wasOnGround) this.targetSquish = -0.5;
        else if (!this.onGround && this.wasOnGround) this.targetSquish = 1;
        this.targetSquish *= 0.6;
        break;
      }
    }
  }

  /** Creeper.getSwelling(partial): 0..~1.07 */
  swelling(partial: number): number {
    return (this.oldSwell + (this.swell - this.oldSwell) * partial) / 28;
  }

  /** Sheep.getHeadEatPositionScale */
  headEatPositionScale(partial: number): number {
    const t = this.eatAnimationTick;
    if (t <= 0) return 0;
    if (t >= 4 && t <= 36) return 1;
    return t < 4 ? (t - partial) / 4 : -(t - 40 - partial) / 4;
  }

  /** Sheep.getHeadEatAngleScale (null: use the head pitch) */
  headEatAngleScale(partial: number): number | null {
    const t = this.eatAnimationTick;
    if (t > 4 && t <= 36) {
      const f = (t - 4 - partial) / 32;
      return Math.PI / 5 + 0.21991149 * Math.sin(f * 28.7);
    }
    return t > 0 ? Math.PI / 5 : null;
  }

  /** ChickenRenderer.getBob */
  chickenBob(partial: number): number {
    const f = this.oFlap + (this.flap - this.oFlap) * partial;
    const f1 = this.oFlapSpeed + (this.flapSpeed - this.oFlapSpeed) * partial;
    return (Math.sin(f) + 1) * f1;
  }
}

/** BodyRotationControl.rotateIfNecessary */
export function rotateIfNecessary(a: number, b: number, max: number): number {
  let f = wrapDegrees(b - a);
  if (f < -max) f = -max;
  if (f > max) f = max;
  return b - f;
}

/** DyeColor texture colours (textureDiffuseColors), by DyeColor id. */
export const DYE_COLORS = [0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21];

/** Sheep.createSheepColor: white wool is 0.9019608 grey, other dyes are 75% of the dye colour. */
export function sheepColor(dye: number): [number, number, number] {
  if (dye === 0) return [0.9019608, 0.9019608, 0.9019608];
  const c = DYE_COLORS[dye & 15]!;
  return [((c >> 16) & 255) / 255 * 0.75, ((c >> 8) & 255) / 255 * 0.75, (c & 255) / 255 * 0.75];
}

export interface MobHooks {
  /** play a sound event at a position */
  sound(event: string, category: 'hostile' | 'neutral' | 'ambient', x: number, y: number, z: number, volume: number, pitch: number): void;
  /** block step sound under a mob without its own step sound */
  blockStep(x: number, y: number, z: number): void;
  /** whether a sound event exists (has audio) */
  hasSound(event: string): boolean;
  /** death poof particles */
  poof(m: ClientMob): void;
  /** forget renderer state for a mob */
  forget(id: number): void;
}

/** Mobs with no ambient sound (Creeper, Slime: getAmbientSound returns null). */
const NO_AMBIENT = new Set(['creeper', 'slime', 'magma_cube']);
/** Mob.getSoundVolume overrides */
const SOUND_VOLUME: Record<string, number> = { bat: 0.1, squid: 0.4 };

/** All client mobs: packet handling and per-tick updates (sounds, death, poof). */
export class ClientMobs {
  readonly mobs = new Map<number, ClientMob>();
  rand: () => number = Math.random;

  constructor(private hooks: MobHooks) {}

  add(id: number, type: string, x: number, y: number, z: number): ClientMob {
    const m = new ClientMob(id, type);
    m.setPos(x, y, z, 0, 0, 0);
    this.mobs.set(id, m);
    return m;
  }

  get(id: number): ClientMob | undefined {
    return this.mobs.get(id);
  }

  /** removeEntities: a dying mob finishes its 20-tick fall first; others vanish at once. */
  remove(id: number): void {
    const m = this.mobs.get(id);
    if (!m) return;
    if (m.deathTime > 0 && m.deathTime < 20) {
      m.removed = true;
      return;
    }
    this.mobs.delete(id);
    this.hooks.forget(id);
  }

  move(id: number, x: number, y: number, z: number, yaw: number, pitch: number, headYaw: number, onGround: boolean): void {
    this.mobs.get(id)?.lerpTo(x, y, z, yaw, pitch, headYaw, onGround);
  }

  /** entityEvent: hurt/death sounds and animations, poof (60). */
  event(id: number, event: number): void {
    const m = this.mobs.get(id);
    if (!m) return;
    if (event === 60) {
      if (!m.poofed) {
        m.poofed = true;
        this.hooks.poof(m);
      }
      return;
    }
    const s = m.handleEvent(event);
    if (s === 'hurt') this.playVoice(m, 'hurt');
    else if (s === 'death') this.playVoice(m, 'death');
  }

  private soundName(m: ClientMob, kind: string): string | null {
    let ev = `entity.${m.type}.${kind}`;
    if ((m.type === 'slime' || m.type === 'magma_cube') && m.slimeSize <= 1 && (kind === 'hurt' || kind === 'death')) ev = `entity.${m.type}.${kind}_small`;
    return this.hooks.hasSound(ev) ? ev : null;
  }

  /** Mob voice (LivingEntity.getVoicePitch: babies are higher). */
  private playVoice(m: ClientMob, kind: string): void {
    const ev = this.soundName(m, kind);
    if (!ev) return;
    const r = this.rand;
    let vol = SOUND_VOLUME[m.type] ?? 1;
    if (m.type === 'slime' || m.type === 'magma_cube') vol = 0.4 * m.slimeSize;
    const pitch = (r() - r()) * 0.2 + (m.baby ? 1.5 : 1);
    this.hooks.sound(ev, m.info.category, m.x, m.y, m.z, vol, pitch);
  }

  tick(): void {
    const r = this.rand;
    for (const [id, m] of this.mobs) {
      const px = m.x, pz = m.z, py = m.y;
      m.tick();
      if (m.deathTime >= 20) {
        // LivingEntity.tickDeath: removed after 20 ticks with a puff of smoke
        if (!m.poofed) {
          m.poofed = true;
          this.hooks.poof(m);
        }
        this.mobs.delete(id);
        this.hooks.forget(id);
        continue;
      }
      if (m.deathTime > 0) continue;
      // Mob.baseTick: ambient sound with a 1/1000 chance growing each tick
      if (!NO_AMBIENT.has(m.type) && Math.floor(r() * 1000) < m.ambientSoundTime++) {
        m.ambientSoundTime = -m.info.ambientInterval;
        this.playVoice(m, 'ambient');
      }
      // Entity.move: a step every block walked on the ground
      const dx = m.x - px, dy = m.y - py, dz = m.z - pz;
      if (m.info.step === null || !m.onGround) continue;
      m.moveDist += Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.6;
      if (m.moveDist > m.nextStep) {
        m.nextStep = Math.floor(m.moveDist) + 1;
        const ev = this.soundName(m, 'step');
        if (ev) this.hooks.sound(ev, m.info.category, m.x, m.y, m.z, 0.15, 1);
        else this.hooks.blockStep(m.x, m.y, m.z);
      }
    }
  }
}
