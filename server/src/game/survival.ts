/**
 * Player health, hunger and damage (vanilla LivingEntity/Player/ServerPlayer): damage sources,
 * invulnerability frames, fire, lava, drowning, suffocation, void, contact blocks, fall damage,
 * natural regeneration/starvation, death (drops, death message) and respawn.
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { FoodData, Difficulty, EXHAUSTION } from '@shared/game/food';
import { isSuffocating } from '@shared/world/blockprops';
import { blockNameOf, getProp } from '@shared/world/blockstate';
import { CLIMBABLE, STUCK, blockIdAt } from '@shared/entity/blockphysics';
import { AABB } from '@shared/entity/aabb';
import { isRainingAt } from '@shared/world/weather';
import { giveExperienceLevels, giveExperiencePoints } from '@shared/game/experience';

export interface DamageSource {
  id: string;
  bypassArmor?: boolean;
  bypassInvul?: boolean;
  fire?: boolean;
  fall?: boolean;
}

/** Vanilla DamageSource constants used by the environment. */
export const DAMAGE = {
  inFire: { id: 'inFire', bypassArmor: true, fire: true },
  onFire: { id: 'onFire', bypassArmor: true, fire: true },
  lava: { id: 'lava', fire: true },
  hotFloor: { id: 'hotFloor', fire: true },
  inWall: { id: 'inWall', bypassArmor: true },
  drown: { id: 'drown', bypassArmor: true },
  starve: { id: 'starve', bypassArmor: true },
  cactus: { id: 'cactus' },
  fall: { id: 'fall', bypassArmor: true, fall: true },
  outOfWorld: { id: 'outOfWorld', bypassArmor: true, bypassInvul: true },
  generic: { id: 'generic', bypassArmor: true },
  sweetBerryBush: { id: 'sweetBerryBush' },
  freeze: { id: 'freeze', bypassArmor: true },
  lightningBolt: { id: 'lightningBolt' },
} as const satisfies Record<string, DamageSource>;

/** Death messages (vanilla wording; %s = player name). */
const DEATH: Record<string, string> = {
  inFire: '%s went up in flames',
  onFire: '%s burned to death',
  lava: '%s tried to swim in lava',
  hotFloor: '%s discovered the floor was lava',
  inWall: '%s suffocated in a wall',
  drown: '%s drowned',
  starve: '%s starved to death',
  cactus: '%s was pricked to death',
  fall: '%s hit the ground too hard',
  outOfWorld: '%s fell out of the world',
  generic: '%s died',
  sweetBerryBush: '%s was poked to death by a sweet berry bush',
  freeze: '%s froze to death',
  lightningBolt: '%s was struck by lightning',
};
const FALL_MESSAGES: Record<string, string> = {
  generic: '%s fell from a high place',
  ladder: '%s fell off a ladder',
  vines: '%s fell off some vines',
  weeping_vines: '%s fell off some weeping vines',
  twisting_vines: '%s fell off some twisting vines',
  scaffolding: '%s fell off scaffolding',
  water: '%s fell out of the water',
};

export interface GameRules {
  naturalRegeneration: boolean;
  keepInventory: boolean;
  fallDamage: boolean;
  fireDamage: boolean;
  drowningDamage: boolean;
  freezeDamage: boolean;
  doImmediateRespawn: boolean;
  showDeathMessages: boolean;
}

export const DEFAULT_GAME_RULES: GameRules = {
  naturalRegeneration: true,
  keepInventory: false,
  fallDamage: true,
  fireDamage: true,
  drowningDamage: true,
  freezeDamage: true,
  doImmediateRespawn: false,
  showDeathMessages: true,
};

/** Survival state carried by a ServerPlayer. */
export class LivingState {
  health = 20;
  maxHealth = 20;
  absorption = 0;
  readonly food = new FoodData();
  invulnerableTime = 0;
  lastHurt = 0;
  hurtTime = 0;
  deathTime = 0;
  airSupply = 300;
  readonly maxAirSupply = 300;
  remainingFireTicks = -20;
  /** vanilla ServerPlayer.spawnInvulnerableTime (after joining/respawning) */
  spawnInvulnerableTime = 60;
  experienceLevel = 0;
  experienceProgress = 0;
  totalExperience = 0;
  score = 0;
  // last values sent to the client
  lastSentHealth = -1;
  lastSentFood = -1;
  lastSentSaturationZero = false;
  lastSentAir = -1;
  lastSentExp = -1;
  /** where the current fall started (for "fell off a ladder" messages) */
  lastClimbable: string | null = null;
  lastClimbableTick = -1000;
  lastFallDistanceWhenHurt = 0;

  get dead(): boolean {
    return this.health <= 0;
  }
}

export class Survival {
  constructor(private readonly s: GameServer) {}

  private invulnerableTo(p: ServerPlayer, src: DamageSource): boolean {
    const rules = this.s.gameRules;
    if ((p.gameMode === 1 || p.gameMode === 3) && !src.bypassInvul) return true;
    if (src.id === 'drown') return !rules.drowningDamage;
    if (src.fall) return !rules.fallDamage;
    if (src.fire) return !rules.fireDamage;
    if (src.id === 'freeze') return !rules.freezeDamage;
    return false;
  }

  /** LivingEntity.hurt (+ Player/ServerPlayer checks). Returns whether damage was applied. */
  hurt(p: ServerPlayer, src: DamageSource, amount: number): boolean {
    const l = p.living;
    if (this.invulnerableTo(p, src) || l.dead) return false;
    if (l.spawnInvulnerableTime > 0 && src.id !== 'outOfWorld') return false;
    if (amount <= 0) return false;
    let fresh = true;
    if (l.invulnerableTime > 10) {
      if (amount <= l.lastHurt) return false;
      this.actuallyHurt(p, src, amount - l.lastHurt);
      l.lastHurt = amount;
      fresh = false;
    } else {
      l.lastHurt = amount;
      l.invulnerableTime = 20;
      this.actuallyHurt(p, src, amount);
      l.hurtTime = 10;
    }
    if (fresh) this.s.broadcastToTrackers(p, { t: 'animate', id: p.id, action: 1 }, true);
    l.lastFallDistanceWhenHurt = p.fallDistance;
    if (l.dead) this.die(p, src);
    return true;
  }

  private actuallyHurt(p: ServerPlayer, src: DamageSource, amount: number): void {
    const l = p.living;
    // armour and enchantment protection arrive with items (Phase 5); absorption first
    const absorbed = Math.min(l.absorption, amount);
    l.absorption -= absorbed;
    amount -= absorbed;
    if (amount === 0) return;
    if (!src.bypassArmor) l.food.addExhaustion(EXHAUSTION.damage);
    l.health = Math.max(0, l.health - amount);
  }

  heal(p: ServerPlayer, amount: number): void {
    const l = p.living;
    if (l.dead) return;
    l.health = Math.min(l.maxHealth, l.health + amount);
  }

  setOnFire(p: ServerPlayer, seconds: number): void {
    const ticks = seconds * 20;
    if (p.living.remainingFireTicks < ticks) p.living.remainingFireTicks = ticks;
  }

  /** Per-tick survival update (Entity.baseTick, LivingEntity.baseTick, Player.tick, ServerPlayer.doTick). */
  tick(p: ServerPlayer): void {
    const l = p.living;
    const w = this.s.world;
    const ph = p.phys;
    ph.x = p.x;
    ph.y = p.y;
    ph.z = p.z;
    ph.pose = p.pose;
    ph.updateFluidState();
    if (l.spawnInvulnerableTime > 0) l.spawnInvulnerableTime--;
    if (l.invulnerableTime > 0) l.invulnerableTime--;
    if (l.hurtTime > 0) l.hurtTime--;

    if (l.dead) {
      l.deathTime++;
      this.sync(p);
      return;
    }
    // Entity.baseTick: water/rain extinguishes, burning, lava, void
    if (ph.isInWater || this.inRain(p)) {
      if (l.remainingFireTicks > 0) l.remainingFireTicks = -20;
      if (ph.isInWater) p.fallDistance = 0;
    }
    if (l.remainingFireTicks > 0) {
      if (l.remainingFireTicks % 20 === 0 && !ph.isInLava) this.hurt(p, DAMAGE.onFire, 1);
      l.remainingFireTicks--;
    } else if (!this.touchingFireOrLava(p)) {
      // Entity.move: out of fire, the catch-fire countdown restarts (−fireImmuneTicks)
      l.remainingFireTicks = -20;
    }
    if (ph.isInLava && p.gameMode !== 3) {
      this.setOnFire(p, 15);
      this.hurt(p, DAMAGE.lava, 4);
      p.fallDistance *= 0.5;
    }
    if (p.y < -64) this.hurt(p, DAMAGE.outOfWorld, 4);

    // LivingEntity.baseTick: suffocation, air supply
    if (p.gameMode !== 3 && this.inWall(p)) this.hurt(p, DAMAGE.inWall, 1);
    const eyeState = w.getState(Math.floor(p.x), Math.floor(p.y + ph.eyeHeight), Math.floor(p.z));
    const invulnerable = p.gameMode === 1 || p.gameMode === 3;
    if (ph.isUnderWater && blockNameOf(eyeState) !== 'bubble_column') {
      if (!invulnerable) {
        l.airSupply--;
        if (l.airSupply === -20) {
          l.airSupply = 0;
          this.hurt(p, DAMAGE.drown, 2);
        }
      }
    } else if (l.airSupply < l.maxAirSupply) {
      l.airSupply = Math.min(l.airSupply + 4, l.maxAirSupply);
    }

    // contact damage from blocks the player is inside / standing on
    this.blockContact(p);

    // climbing resets falls (and remembers where the fall started for the death message)
    const feet = w.getState(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    if (CLIMBABLE[blockIdAt(feet)]) {
      p.fallDistance = 0;
      l.lastClimbable = blockNameOf(feet).replace(/_plant$/, '').replace(/^vine$/, 'vines').replace(/^cave_vines$/, 'vines');
      l.lastClimbableTick = this.s.gameTime;
    } else if (ph.isInWater) {
      l.lastClimbable = 'water';
      l.lastClimbableTick = this.s.gameTime;
    }

    // Player.tick: hunger; Player.aiStep: peaceful regeneration
    if (p.gameMode === 0 || p.gameMode === 2) {
      l.food.tick({
        get health() { return l.health; },
        maxHealth: l.maxHealth,
        heal: (a) => this.heal(p, a),
        starve: (a) => this.hurt(p, DAMAGE.starve, a),
      }, this.s.difficulty, this.s.gameRules.naturalRegeneration);
    }
    if (this.s.difficulty === Difficulty.Peaceful && this.s.gameRules.naturalRegeneration) {
      if (l.health < l.maxHealth && this.s.gameTime % 20 === 0) this.heal(p, 1);
      if (l.food.needsFood() && this.s.gameTime % 10 === 0) l.food.foodLevel++;
    }
    this.sync(p);
  }

  /** ServerPlayer.doTick: send health/food/air/xp when they change. */
  sync(p: ServerPlayer): void {
    const l = p.living;
    const satZero = l.food.saturationLevel === 0;
    if (l.health !== l.lastSentHealth || l.food.foodLevel !== l.lastSentFood || satZero !== l.lastSentSaturationZero) {
      this.s.send(p, { t: 'health', health: l.health, food: l.food.foodLevel, saturation: l.food.saturationLevel });
      l.lastSentHealth = l.health;
      l.lastSentFood = l.food.foodLevel;
      l.lastSentSaturationZero = satZero;
    }
    if (l.airSupply !== l.lastSentAir) {
      this.s.send(p, { t: 'air', air: l.airSupply });
      l.lastSentAir = l.airSupply;
    }
    if (l.totalExperience !== l.lastSentExp) {
      this.s.send(p, { t: 'experience', progress: l.experienceProgress, level: l.experienceLevel, total: l.totalExperience });
      l.lastSentExp = l.totalExperience;
    }
    const onFire = l.remainingFireTicks > 0;
    if (onFire !== p.onFire) {
      p.onFire = onFire;
      p.stateDirty = true;
    }
  }

  /** Entity.isInRain: rain at the feet or the top of the bounding box. */
  private inRain(p: ServerPlayer): boolean {
    const r = this.s.isRaining();
    const x = Math.floor(p.x), z = Math.floor(p.z);
    return isRainingAt(this.s.world, r, x, Math.floor(p.y), z) || isRainingAt(this.s.world, r, x, Math.floor(p.y + p.phys.height), z);
  }

  private touchingFireOrLava(p: ServerPlayer): boolean {
    const bb = p.phys.boundingBox().deflate(0.001);
    for (let x = Math.floor(bb.minX); x < Math.ceil(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y < Math.ceil(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z < Math.ceil(bb.maxZ); z++) {
          const n = blockNameOf(this.s.world.getState(x, y, z));
          if (n === 'fire' || n === 'soul_fire' || n === 'lava') return true;
        }
    return false;
  }

  /** LivingEntity.isInWall: a flat box (80% of the width) at eye height inside a suffocating block. */
  private inWall(p: ServerPlayer): boolean {
    const w = p.phys.width * 0.8, eye = p.y + p.phys.eyeHeight;
    const bb = new AABB(p.x - w / 2, eye - 5e-7, p.z - w / 2, p.x + w / 2, eye + 5e-7, p.z + w / 2);
    for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++)
      for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++)
        for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++) {
          if (isSuffocating(this.s.world.getState(x, y, z))) return true;
        }
    return false;
  }

  /** entityInside / stepOn damage: cactus, fire, campfires, sweet berry bushes, magma blocks. */
  private blockContact(p: ServerPlayer): void {
    const w = this.s.world;
    const bb = p.phys.boundingBox().deflate(0.001);
    let stuck = false;
    // cactus pricks anything touching it (its collision box is 1/16 inset): check an inflated box
    const touch = bb.inflate(0.001, 0, 0.001);
    for (let x = Math.floor(touch.minX); x < Math.ceil(touch.maxX); x++)
      for (let y = Math.floor(bb.minY); y < Math.ceil(bb.maxY); y++)
        for (let z = Math.floor(touch.minZ); z < Math.ceil(touch.maxZ); z++) {
          const st = w.getState(x, y, z);
          if (st === 0) continue;
          const n = blockNameOf(st);
          const inside = x >= Math.floor(bb.minX) && x < Math.ceil(bb.maxX) && z >= Math.floor(bb.minZ) && z < Math.ceil(bb.maxZ);
          if (n === 'cactus') {
            // vanilla: the cactus cell overlaps the player's box (cactus is 14/16 wide)
            if (bb.maxX > x + 1 / 16 && bb.minX < x + 15 / 16 && bb.maxZ > z + 1 / 16 && bb.minZ < z + 15 / 16) this.hurt(p, DAMAGE.cactus, 1);
            continue;
          }
          if (!inside) continue;
          if (STUCK[blockIdAt(st) * 3]) stuck = true;
          if (n === 'fire' || n === 'soul_fire') {
            if (p.gameMode === 3) continue;
            p.living.remainingFireTicks++;
            if (p.living.remainingFireTicks === 0) this.setOnFire(p, 8);
            this.hurt(p, DAMAGE.inFire, n === 'soul_fire' ? 2 : 1);
          } else if ((n === 'campfire' || n === 'soul_campfire') && getProp(st, 'lit') === true && bb.minY < y + 7 / 16) {
            this.hurt(p, DAMAGE.inFire, n === 'soul_campfire' ? 2 : 1);
          } else if (n === 'sweet_berry_bush' && (getProp(st, 'age') as number) > 0) {
            const mx = Math.abs(p.x - p.prevTickX), mz = Math.abs(p.z - p.prevTickZ);
            if (mx >= 0.003 || mz >= 0.003) this.hurt(p, DAMAGE.sweetBerryBush, 1);
          }
        }
    // makeStuckInBlock resets the fall distance
    if (stuck) p.fallDistance = 0;
    // magma: stepOn while on the ground and not sneaking
    if (p.onGround && !p.sneaking) {
      const below = w.getState(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      if (blockNameOf(below) === 'magma_block') this.hurt(p, DAMAGE.hotFloor, 1);
    }
    p.prevTickX = p.x;
    p.prevTickZ = p.z;
  }

  /** Entity.checkFallDamage on landing, with Block.fallOn multipliers. */
  land(p: ServerPlayer, fallDistance: number): void {
    if (p.mayFly) return;
    const w = this.s.world;
    const below = w.getState(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    const n = blockNameOf(below);
    let mult = 1;
    if (n === 'hay_block' || n === 'honey_block') mult = 0.2;
    else if (n.endsWith('_bed')) mult = 0.5;
    else if (n === 'slime_block' && !p.sneaking) mult = 0;
    else if (n === 'pointed_dripstone' && getProp(below, 'vertical_direction') === 'up' && getProp(below, 'thickness') === 'tip') {
      // falling onto a stalagmite tip: double damage plus 2 (vanilla PointedDripstoneBlock.fallOn)
      const dmg = Math.ceil((fallDistance + 2 - 3) * 2);
      if (dmg > 0) this.hurt(p, { id: 'stalagmite', bypassArmor: true }, dmg);
      return;
    }
    const dmg = Math.ceil((fallDistance - 3) * mult);
    if (dmg > 0) this.hurt(p, DAMAGE.fall, dmg);
  }

  /** Player.checkMovementStatistics + jumpFromGround exhaustion, from a client move. */
  movementExhaustion(p: ServerPlayer, dx: number, dy: number, dz: number, wasOnGround: boolean, onGround: boolean): void {
    if (p.mayFly || p.living.dead) return;
    const food = p.living.food;
    const ph = p.phys;
    if (wasOnGround && !onGround && dy > 0) food.addExhaustion(p.sprinting ? EXHAUSTION.sprintJump : EXHAUSTION.jump);
    const d3 = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 100);
    const d2 = Math.round(Math.sqrt(dx * dx + dz * dz) * 100);
    if (p.pose === 'swimming' && ph.isInWater) {
      if (d3 > 0) food.addExhaustion(EXHAUSTION.swim * d3 * 0.01);
    } else if (ph.isUnderWater) {
      if (d3 > 0) food.addExhaustion(EXHAUSTION.swim * d3 * 0.01);
    } else if (ph.isInWater) {
      if (d2 > 0) food.addExhaustion(EXHAUSTION.swim * d2 * 0.01);
    } else if (onGround && p.sprinting && d2 > 0) {
      food.addExhaustion(EXHAUSTION.sprint * d2 * 0.01);
    }
  }

  /** /xp add: points (Player.giveExperiencePoints) or levels. */
  giveExperience(p: ServerPlayer, n: number, levels: boolean): void {
    if (levels) giveExperienceLevels(p.living, n);
    else giveExperiencePoints(p.living, n);
    p.living.lastSentExp = -1;
    this.sync(p);
  }

  /** LivingEntity.die / ServerPlayer.die. */
  die(p: ServerPlayer, src: DamageSource): void {
    const l = p.living;
    l.remainingFireTicks = 0;
    l.deathTime = 0;
    const msg = this.deathMessage(p, src);
    if (this.s.gameRules.showDeathMessages) {
      for (const o of this.s.players) this.s.send(o, { t: 'chat', json: JSON.stringify({ text: msg }) });
    }
    this.s.send(p, { t: 'playerDied', message: msg, score: l.score });
    if (!this.s.gameRules.keepInventory) {
      // Inventory.dropAll: every stack flung in a random direction
      for (let i = 0; i < 41; i++) {
        const st = p.inventory.get(i);
        if (!st) continue;
        p.inventory.set(i, null);
        this.s.dropAround(p, st);
        this.s.syncSlot(p, i);
      }
      l.experienceLevel = 0;
      l.experienceProgress = 0;
      l.totalExperience = 0;
    }
    this.sync(p);
  }

  private deathMessage(p: ServerPlayer, src: DamageSource): string {
    const l = p.living;
    if (src.fall && l.lastFallDistanceWhenHurt > 5) {
      const fromClimb = l.lastClimbable && this.s.gameTime - l.lastClimbableTick < 100 ? l.lastClimbable : 'generic';
      return (FALL_MESSAGES[fromClimb] ?? FALL_MESSAGES.generic!).replace('%s', p.name);
    }
    return (DEATH[src.id] ?? DEATH.generic!).replace('%s', p.name);
  }

  /** PlayerList.respawn: back to spawn with fresh survival state. */
  respawn(p: ServerPlayer): void {
    if (!p.living.dead) return;
    const keep = this.s.gameRules.keepInventory;
    const old = p.living;
    p.living = new LivingState();
    if (keep) {
      p.living.experienceLevel = old.experienceLevel;
      p.living.experienceProgress = old.experienceProgress;
      p.living.totalExperience = old.totalExperience;
    }
    p.fallDistance = 0;
    const [x, y, z] = this.s.spawnPosition();
    p.x = x;
    p.y = y;
    p.z = z;
    p.flying = p.gameMode === 3;
    this.s.send(p, { t: 'respawn', gameMode: p.gameMode });
    this.s.send(p, { t: 'teleport', x, y, z, yaw: 0, pitch: 0 });
    this.sync(p);
    p.stateDirty = true;
  }
}
