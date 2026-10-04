/**
 * The dragon fight (vanilla 1.17.1 EnderDragon, EndCrystal, DragonFireball, EndDragonFight),
 * simplified where noted:
 * - End crystals: sit on the pillar tops (bedrock base from SpikeFeature, fire kept lit under
 *   them), explode with power 6 when hurt (not by the dragon), and heal the dragon 1 HP every 10
 *   ticks while it's within 32 blocks (EnderDragon.checkCrystals) — the beam is synced as mobData
 *   `beam` (the dragon's entity id, 0 = none). Destroying the crystal that heals it hurts the
 *   dragon for 10 (onCrystalDestroyed).
 * - The dragon: 200 HP, a pink boss bar (bossEvent packets) for players in the End within 192
 *   blocks of 0, 0, and the phase machine HOLDING_PATTERN → STRAFE_PLAYER (dragon fireballs →
 *   breath clouds) / LANDING_APPROACH → LANDING → SITTING_SCANNING → SITTING_FLAMING / CHARGING_PLAYER
 *   → TAKEOFF. Deviation: the holding pattern circles the pillars on a radius-40 circle instead of
 *   the 24-node path graph, flight is simple steering, and every hit counts as a head hit.
 * - Breaks every non-dragon-immune block it flies through (EnderDragon.checkWalls).
 * - Death: rises for 200 ticks, drops 12000 XP the first time (500 later), then the fight lights
 *   the exit portal, puts the egg on top (first kill) and opens a gateway (TheEnd.onDragonKilled).
 */
import { blockNameOf, stateOf } from '@shared/world/blockstate';
import { IS_AIR } from '@shared/world/blockinfo';
import type { BlockWorld } from '@shared/world/world';
import type { GameServer } from '../server';
import type { ServerPlayer } from '../player';
import type { DamageSource } from '../survival';
import { Mob, type MobCategory, type Target } from './mob';
import { explode } from '../explosion';
import { EffectCloud } from '../effectcloud';

/** BlockTags.DRAGON_IMMUNE (1.17.1) */
const DRAGON_IMMUNE = new Set([
  'barrier', 'bedrock', 'end_portal', 'end_portal_frame', 'end_gateway', 'command_block', 'repeating_command_block', 'chain_command_block',
  'structure_block', 'jigsaw', 'moving_piston', 'obsidian', 'crying_obsidian', 'end_stone', 'iron_bars', 'respawn_anchor',
]);
const FIRE = stateOf('fire');

export class EndCrystal extends Mob {
  readonly type = 'end_crystal';
  readonly category: MobCategory = 'misc';
  readonly trackRange = 256;
  readonly maxHealth = 1;
  readonly width = 2;
  readonly height = 2;
  /** the dragon this crystal is healing (beam target), 0 = none */
  beamTarget = 0;
  override persistenceRequired = true;
  protected registerGoals(): void {}

  override tick(_world: BlockWorld): void {
    this.age++;
    this.tickCount++;
    // EndCrystal.tick: keep a fire burning in its block (in the End)
    if (this.s.level.id === 'the_end') {
      const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
      if (this.s.world.getChunk(bx >> 4, bz >> 4) && IS_AIR[this.s.world.getState(bx, by, bz)] === 1) this.s.setBlock(bx, by, bz, FIRE);
    }
  }

  /** EndCrystal.hurt: anything but the dragon blows it up (power 6). */
  override hurt(src: DamageSource, _amount: number, attacker: Target | null = null): boolean {
    if (this.removed || this.dead) return false;
    if (attacker instanceof EnderDragon) return false;
    this.removed = true;
    this.dead = true;
    void src;
    explode(this.s, this.x, this.y, this.z, 6, false, 'destroy', null);
    for (const e of this.s.entities.values()) if (e instanceof EnderDragon && !e.dead) e.onCrystalDestroyed(this, attacker);
    return true;
  }
}

/** DragonFireball: a straight-flying projectile; bursts into a breath cloud (harming II) on impact. */
export class DragonFireball extends Mob {
  readonly type = 'dragon_fireball';
  readonly category: MobCategory = 'misc';
  readonly trackRange = 64;
  readonly maxHealth = 1;
  readonly width = 1;
  readonly height = 1;
  px = 0;
  py = 0;
  pz = 0;
  owner = 0;
  override persistenceRequired = true;
  protected registerGoals(): void {}

  override hurt(): boolean {
    return false;
  }

  override tick(_world: BlockWorld): void {
    this.age++;
    this.tickCount++;
    if (this.removed) return;
    // AbstractHurtingProjectile.tick: move, then inertia 0.95 and the constant power
    const nx = this.x + this.vx, ny = this.y + this.vy, nz = this.z + this.vz;
    const w = this.s.world;
    let hit = this.age > 600 || ny < 0;
    if (!hit && IS_AIR[w.getState(Math.floor(nx), Math.floor(ny + 0.5), Math.floor(nz))] !== 1) hit = true;
    if (!hit)
      for (const p of this.s.players)
        if (p.gameMode !== 3 && !p.living.dead && Math.abs(p.x - nx) < 0.8 && Math.abs(p.z - nz) < 0.8 && ny + 1 > p.y && ny < p.y + 1.8) hit = true;
    this.x = nx;
    this.y = ny;
    this.z = nz;
    this.vx = (this.vx + this.px) * 0.95;
    this.vy = (this.vy + this.py) * 0.95;
    this.vz = (this.vz + this.pz) * 0.95;
    this.velocityDirty = true;
    if (hit) {
      this.removed = true;
      spawnBreathCloud(this.s, this.x, this.y, this.z, 5, 600);
      this.s.players.forEach((o) => this.s.send(o, { t: 'levelEvent', event: 2006, x: Math.floor(this.x), y: Math.floor(this.y), z: Math.floor(this.z), data: 1 }));
    }
  }
}

/** DragonFireball.onHit / SittingFlaming: an AreaEffectCloud of dragon's breath (instant damage II). */
export function spawnBreathCloud(s: GameServer, x: number, y: number, z: number, radius: number, duration: number): EffectCloud {
  const c = new EffectCloud(s.newEntityId(), x, y, z, [{ effect: 'instant_damage', duration: 1, amplifier: 1 }], 0xb24fd6);
  const m = c as unknown as { radius: number; radiusPerTick: number; duration: number };
  m.radius = radius;
  m.duration = duration;
  // DragonFireball: radius 3 growing to 7 over the duration; SittingFlaming: radius 5 shrinking by (−0.? ) — kept constant
  m.radiusPerTick = radius <= 3 ? (7 - radius) / duration : 0;
  c.level = s.level;
  s.items.clouds.push(c);
  return c;
}

export const enum DragonPhase {
  HOLDING,
  STRAFE,
  LANDING_APPROACH,
  LANDING,
  SITTING_SCANNING,
  SITTING_FLAMING,
  CHARGING,
  TAKEOFF,
  DYING,
}

export interface DragonFightHost {
  /** fountain top bedrock y at 0, 0 (the dragon lands on top+1) */
  fountainTop(): number;
  /** first kill? (12000 vs 500 XP) */
  previouslyKilled(): boolean;
  onDragonKilled(d: EnderDragon): void;
}

export class EnderDragon extends Mob {
  readonly type = 'ender_dragon';
  readonly category: MobCategory = 'monster';
  readonly trackRange = 160;
  readonly maxHealth = 200;
  readonly width = 16;
  readonly height = 8;
  override persistenceRequired = true;
  override fireImmune = true;
  phase = DragonPhase.HOLDING;
  phaseTicks = 0;
  /** target point of the current phase */
  tx = 0;
  ty = 100;
  tz = 0;
  private angle = 0;
  nearestCrystal: EndCrystal | null = null;
  attackTarget: ServerPlayer | null = null;
  private fireballCharge = 0;
  private flameCount = 0;
  private damageSinceLanding = 0;
  readonly bossPlayers = new Set<ServerPlayer>();
  private sentProgress = -1;
  host: DragonFightHost | null = null;

  protected registerGoals(): void {}

  override get eyeHeight(): number {
    return 4;
  }

  private fight(): DragonFightHost {
    return this.host ?? (this.s.theEnd as unknown as DragonFightHost);
  }

  setPhase(p: DragonPhase): void {
    this.phase = p;
    this.phaseTicks = 0;
    if (p === DragonPhase.SITTING_SCANNING || p === DragonPhase.LANDING) this.damageSinceLanding = 0;
    if (p === DragonPhase.SITTING_FLAMING) this.flameCount = 0;
    this.stateDirty = true;
  }

  private nearestPlayer(range: number): ServerPlayer | null {
    let best: ServerPlayer | null = null, bd = range * range;
    for (const p of this.s.players) {
      if (p.gameMode === 1 || p.gameMode === 3 || p.living.dead) continue;
      const d = (p.x - this.x) ** 2 + (p.y - this.y) ** 2 + (p.z - this.z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private crystalCount(): number {
    let n = 0;
    for (const e of this.s.entities.values()) if (e instanceof EndCrystal && !e.removed) n++;
    return n;
  }

  // ---------------------------------------------------------------- damage
  /** EnderDragon.hurt: only entity / explosion damage (and /kill); sitting it takes off after 25% of its health. */
  override hurt(src: DamageSource, amount: number, attacker: Target | null = null): boolean {
    if (this.phase === DragonPhase.DYING || this.dead) return false;
    const allowed = attacker !== null || src.explosion || src.projectile || src.id === 'outOfWorld' || src.id === 'kill' || src.id === 'generic';
    if (!allowed) return false;
    const before = this.health;
    const ok = super.hurt(src, amount, attacker);
    if (ok && (this.phase === DragonPhase.SITTING_SCANNING || this.phase === DragonPhase.SITTING_FLAMING)) {
      this.damageSinceLanding += before - this.health;
      if (this.damageSinceLanding > 0.25 * this.maxHealth) this.setPhase(DragonPhase.TAKEOFF);
    }
    return ok;
  }

  /** EnderDragon.onCrystalDestroyed */
  onCrystalDestroyed(c: EndCrystal, attacker: Target | null): void {
    if (c === this.nearestCrystal) {
      this.nearestCrystal = null;
      this.hurt({ id: 'explosion', explosion: true }, 10, attacker && attacker !== this ? attacker : null);
    }
  }

  override die(): void {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.setPhase(DragonPhase.DYING);
    this.deathTime = 0;
    this.s.playSound(null, 'entity.ender_dragon.death', 'hostile', this.x, this.y, this.z, 5, 1);
  }

  // ---------------------------------------------------------------- ticking
  override tick(_world: BlockWorld): void {
    this.age++;
    this.tickCount++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerableTime > 0) this.invulnerableTime--;
    if (this.dead) this.tickDragonDeath();
    else {
      this.checkCrystals();
      this.tickPhase();
      this.fly();
      this.checkWalls();
    }
    this.updateBossBar();
  }

  /** EnderDragon.checkCrystals */
  private checkCrystals(): void {
    const c = this.nearestCrystal;
    if (c) {
      if (c.removed) this.nearestCrystal = null;
      else if (this.tickCount % 10 === 0 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1);
    }
    if (this.rng.nextInt(10) === 0) {
      let best: EndCrystal | null = null, bd = Infinity;
      for (const e of this.s.entities.values()) {
        if (!(e instanceof EndCrystal) || e.removed) continue;
        // within the dragon's box inflated by 32
        if (Math.abs(e.x - this.x) > 32 + this.width / 2 || e.y < this.y - 32 || e.y > this.y + this.height + 32 || Math.abs(e.z - this.z) > 32 + this.width / 2) continue;
        const d = (e.x - this.x) ** 2 + (e.y - this.y) ** 2 + (e.z - this.z) ** 2;
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      this.nearestCrystal = best;
    }
    for (const e of this.s.entities.values()) {
      if (!(e instanceof EndCrystal)) continue;
      const want = e === this.nearestCrystal ? this.id : 0;
      if (e.beamTarget !== want) {
        e.beamTarget = want;
        e.flagsDirty = true;
        e.stateDirty = true;
      }
    }
  }

  private pickHoldingPoint(): void {
    const top = this.fight().fountainTop();
    this.angle += Math.PI / 6;
    const r = 40;
    this.tx = Math.cos(this.angle) * r;
    this.tz = Math.sin(this.angle) * r;
    this.ty = top + 20 + this.rng.nextFloat() * 20;
  }

  private tickPhase(): void {
    this.phaseTicks++;
    const top = this.fight().fountainTop();
    const distT = Math.hypot(this.tx - this.x, this.ty - this.y, this.tz - this.z);
    switch (this.phase) {
      case DragonPhase.HOLDING: {
        if (distT < 10 || this.phaseTicks === 1) {
          // HoldingPattern.findNewTarget: land with chance 1/(crystals + 3); strafe a nearby player sometimes
          const n = this.crystalCount();
          if (this.phaseTicks > 1 && this.rng.nextInt(n + 3) === 0) {
            this.setPhase(DragonPhase.LANDING_APPROACH);
            return;
          }
          const p = this.nearestPlayer(128);
          if (p && this.phaseTicks > 1 && this.rng.nextInt(Math.max(1, n + 2)) === 0) {
            this.attackTarget = p;
            this.setPhase(DragonPhase.STRAFE);
            return;
          }
          this.pickHoldingPoint();
        }
        break;
      }
      case DragonPhase.STRAFE: {
        const p = this.attackTarget;
        if (!p || p.living.dead || !this.s.players.includes(p) || this.phaseTicks > 400) {
          this.setPhase(DragonPhase.HOLDING);
          break;
        }
        this.tx = p.x;
        this.ty = p.y + 10;
        this.tz = p.z;
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d < 64) {
          if (++this.fireballCharge >= 5) {
            this.shootFireball(p);
            this.fireballCharge = 0;
            this.setPhase(DragonPhase.HOLDING);
          }
        } else if (this.fireballCharge > 0) this.fireballCharge--;
        break;
      }
      case DragonPhase.LANDING_APPROACH:
        this.tx = 0;
        this.ty = top + 1;
        this.tz = 0;
        if (Math.hypot(this.x, this.z) < 12) this.setPhase(DragonPhase.LANDING);
        break;
      case DragonPhase.LANDING:
        this.tx = 0;
        this.ty = top + 1;
        this.tz = 0;
        if (Math.hypot(this.x, this.y - (top + 1), this.z) < 1.5) {
          this.x = 0;
          this.z = 0;
          this.y = top + 1;
          this.vx = this.vy = this.vz = 0;
          this.setPhase(DragonPhase.SITTING_SCANNING);
        }
        break;
      case DragonPhase.SITTING_SCANNING: {
        // SittingScanningPhase: face a player within 20 blocks, flame after 25 ticks; give up after 100
        const p = this.nearestPlayer(150);
        if (p && Math.hypot(p.x - this.x, p.z - this.z) < 20 && this.phaseTicks >= 25) this.setPhase(DragonPhase.SITTING_FLAMING);
        else if (this.phaseTicks >= 100) {
          if (p) {
            this.attackTarget = p;
            this.setPhase(DragonPhase.CHARGING);
          } else this.setPhase(DragonPhase.TAKEOFF);
        }
        if (p) this.yaw = (-Math.atan2(p.x - this.x, p.z - this.z) * 180) / Math.PI;
        break;
      }
      case DragonPhase.SITTING_FLAMING:
        // SittingFlamingPhase: 10 ticks roar, then a breath cloud in front of the head, 4 rounds
        if (this.phaseTicks === 10) {
          const yr = (this.yaw * Math.PI) / 180;
          const hx = this.x - Math.sin(yr) * 6, hz = this.z + Math.cos(yr) * 6;
          spawnBreathCloud(this.s, hx, this.y, hz, 5, 200);
          this.s.playSound(null, 'entity.ender_dragon.shoot', 'hostile', hx, this.y, hz, 5, 1);
        }
        if (this.phaseTicks >= 200) {
          if (++this.flameCount >= 4) this.setPhase(DragonPhase.TAKEOFF);
          else {
            this.phaseTicks = 0;
            this.phase = DragonPhase.SITTING_SCANNING;
          }
        }
        break;
      case DragonPhase.CHARGING: {
        const p = this.attackTarget;
        if (!p || p.living.dead || this.phaseTicks > 200) {
          this.setPhase(DragonPhase.HOLDING);
          break;
        }
        this.tx = p.x;
        this.ty = p.y;
        this.tz = p.z;
        if (distT < 3) this.setPhase(DragonPhase.HOLDING);
        break;
      }
      case DragonPhase.TAKEOFF:
        this.tx = 0;
        this.ty = top + 30;
        this.tz = 0;
        if (this.y > top + 20) {
          this.setPhase(DragonPhase.HOLDING);
          this.pickHoldingPoint();
        }
        break;
    }
  }

  /** EnderDragon's strafe attack: a DragonFireball from the head toward the player. */
  shootFireball(p: ServerPlayer): DragonFireball {
    const yr = (this.yaw * Math.PI) / 180;
    const hx = this.x - Math.sin(yr) * 6, hy = this.y + 2, hz = this.z + Math.cos(yr) * 6;
    const f = new DragonFireball(this.s.allocateEntityId(), this.s);
    f.x = hx;
    f.y = hy;
    f.z = hz;
    f.init();
    const dx = p.x - hx, dy = p.y + 0.9 - hy, dz = p.z - hz;
    const l = Math.hypot(dx, dy, dz) || 1;
    f.px = (dx / l) * 0.1;
    f.py = (dy / l) * 0.1;
    f.pz = (dz / l) * 0.1;
    f.owner = this.id;
    this.s.spawnEntity(f);
    this.s.playSound(null, 'entity.ender_dragon.shoot', 'hostile', hx, hy, hz, 5, 1);
    return f;
  }

  private fly(): void {
    if (this.phase === DragonPhase.SITTING_SCANNING || this.phase === DragonPhase.SITTING_FLAMING) return;
    const dx = this.tx - this.x, dy = this.ty - this.y, dz = this.tz - this.z;
    const l = Math.hypot(dx, dy, dz);
    const speed = this.phase === DragonPhase.CHARGING ? 1.2 : this.phase === DragonPhase.LANDING ? 0.3 : 0.6;
    if (l > 1e-3) {
      const k = Math.min(speed, l) / l;
      this.vx += (dx * k - this.vx) * 0.1;
      this.vy += (dy * k - this.vy) * 0.1;
      this.vz += (dz * k - this.vz) * 0.1;
    }
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;
    if (Math.abs(this.vx) + Math.abs(this.vz) > 0.01) this.yaw = (-Math.atan2(this.vx, this.vz) * 180) / Math.PI;
    this.yBodyRot = this.yHeadRot = this.yaw;
    this.velocityDirty = true;
  }

  /** EnderDragon.checkWalls on the body/neck/head boxes (simplified to a 5×3×5 core plus the head). */
  private checkWalls(): void {
    const w = this.s.world;
    const yr = (this.yaw * Math.PI) / 180;
    const hx = this.x - Math.sin(yr) * 6, hz = this.z + Math.cos(yr) * 6;
    const boxes: [number, number, number, number, number, number][] = [
      [this.x - 2.5, this.y, this.z - 2.5, this.x + 2.5, this.y + 3, this.z + 2.5],
      [hx - 0.5, this.y + 1, hz - 0.5, hx + 0.5, this.y + 2, hz + 0.5],
    ];
    for (const b of boxes)
      for (let x = Math.floor(b[0]); x <= Math.floor(b[3]); x++)
        for (let y = Math.floor(b[1]); y <= Math.floor(b[4]); y++)
          for (let z = Math.floor(b[2]); z <= Math.floor(b[5]); z++) {
            if (!w.getChunk(x >> 4, z >> 4)) continue;
            const st = w.getState(x, y, z);
            if (IS_AIR[st] === 1 || st === FIRE || DRAGON_IMMUNE.has(blockNameOf(st))) continue;
            this.s.setBlock(x, y, z, 0);
            // level event 2008: the explosion puff where it broke through
            if (this.rng.nextInt(8) === 0) for (const o of this.s.players) this.s.send(o, { t: 'levelEvent', event: 2008, x, y, z, data: 0 });
          }
  }

  /** EnderDragon.tickDeath: 200 ticks rising, XP from tick 150, then the fight's end. */
  private tickDragonDeath(): void {
    this.deathTime++;
    const total = this.fight().previouslyKilled() ? 500 : 12000;
    if (this.deathTime > 150 && this.deathTime % 5 === 0) this.dropXp(Math.floor(total * 0.08));
    if (this.deathTime === 1) this.s.playSound(null, 'entity.ender_dragon.death', 'hostile', this.x, this.y, this.z, 5, 1);
    this.y += 0.1;
    this.vx = this.vz = 0;
    this.vy = 0.1;
    this.velocityDirty = true;
    if (this.deathTime >= 200) {
      this.dropXp(Math.floor(total * 0.2));
      this.removed = true;
      this.fight().onDragonKilled(this);
    }
  }

  private dropXp(n: number): void {
    // ExperienceOrb.award splits into orb sizes; spawnExperience does the same
    if (this.s.gameRules.doMobLoot) this.s.spawnExperience(this.x, this.y, this.z, n);
  }

  /** ServerBossEvent: add/remove players in the End within 192 of 0, 0 every 20 ticks; progress updates. */
  private updateBossBar(): void {
    const s = this.s;
    if (this.removed) {
      for (const p of this.bossPlayers) s.send(p, { t: 'bossEvent', op: 1, id: this.id, name: '', progress: 0, color: 0, overlay: 0 });
      this.bossPlayers.clear();
      return;
    }
    if (this.tickCount % 20 === 1) {
      for (const p of [...this.bossPlayers])
        if (!s.players.includes(p) || p.x * p.x + p.z * p.z > 192 * 192) {
          this.bossPlayers.delete(p);
          s.send(p, { t: 'bossEvent', op: 1, id: this.id, name: '', progress: 0, color: 0, overlay: 0 });
        }
      for (const p of s.players)
        if (!this.bossPlayers.has(p) && p.x * p.x + p.z * p.z <= 192 * 192) {
          this.bossPlayers.add(p);
          s.send(p, { t: 'bossEvent', op: 0, id: this.id, name: 'Ender Dragon', progress: this.health / this.maxHealth, color: 0, overlay: 0 });
        }
    }
    const prog = this.health / this.maxHealth;
    if (prog !== this.sentProgress) {
      this.sentProgress = prog;
      for (const p of this.bossPlayers) s.send(p, { t: 'bossEvent', op: 2, id: this.id, name: 'Ender Dragon', progress: prog, color: 0, overlay: 0 });
    }
  }
}
