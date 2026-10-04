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
import { soundTypeOf } from '@shared/world/soundtype';
import { giveExperienceLevels, giveExperiencePoints, deathExperience } from '@shared/game/experience';
import { CombatTracker, fallLocation, type CombatSource } from '@shared/game/combattracker';
import { EffectMap } from '@shared/game/effects';
import { damageAfterArmor, damageAfterResistance } from '@shared/game/items';

export interface DamageSource extends CombatSource {
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
  playerAttack: { id: 'player' },
  magic: { id: 'magic', bypassArmor: true },
  wither: { id: 'wither', bypassArmor: true },
  arrow: { id: 'arrow' },
} as const satisfies Record<string, DamageSource>;

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
  /** block last climbed (LivingEntity.lastClimbablePos), cleared back on the ground */
  lastClimbable: string | null = null;
  /** LivingEntity.lastHurtByPlayer, remembered for 100 ticks (kill credit) */
  lastHurtByPlayer: string | null = null;
  lastHurtByPlayerTime = 0;
  readonly combat = new CombatTracker();
  /** ticks since the player last slept (phantoms, Phase 6) */
  timeSinceRest = 0;
  /** Entity.ticksFrozen (powder snow; 140 = fully frozen) */
  ticksFrozen = 0;
  /** active status effects (LivingEntity.activeEffects) */
  readonly effects = new EffectMap();
  lastSentAbsorption = -1;

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
  hurt(p: ServerPlayer, src: DamageSource, amount: number, attacker: ServerPlayer | null = null): boolean {
    const l = p.living;
    if (this.invulnerableTo(p, src) || l.dead) return false;
    // LivingEntity.hurt: fire resistance makes fire sources harmless
    if (src.fire && l.effects.has('fire_resistance')) return false;
    if (attacker) {
      src = { ...src, entity: { name: attacker.name, player: true } };
      l.lastHurtByPlayer = attacker.name;
      l.lastHurtByPlayerTime = 100;
    }
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
      // LivingEntity.hurt: knock the victim away from the attacker
      if (attacker) {
        let dx = attacker.x - p.x, dz = attacker.z - p.z;
        while (dx * dx + dz * dz < 1e-4) {
          dx = (Math.random() - Math.random()) * 0.01;
          dz = (Math.random() - Math.random()) * 0.01;
        }
        this.s.knockback(p, 0.4, dx, dz);
      }
    }
    // entity event 2/36/37/44/57: hurt animation + the hurt sound for the player itself
    const event = src.id === 'drown' ? 36 : src.id === 'onFire' ? 37 : src.id === 'sweetBerryBush' ? 44 : src.id === 'freeze' ? 57 : 2;
    if (fresh) this.s.broadcastToTrackers(p, { t: 'entityEvent', id: p.id, event }, true);
    const r = this.s.rand;
    const voice = (r.nextFloat() - r.nextFloat()) * 0.2 + 1;
    if (l.dead) {
      if (fresh) this.s.playSound(p, 'entity.player.death', 'player', p.x, p.y, p.z, 1, voice);
      this.die(p, src);
    } else if (fresh) {
      // Player.getHurtSound
      const ev = src.id === 'onFire' ? 'entity.player.hurt_on_fire' : src.id === 'drown' ? 'entity.player.hurt_drown'
        : src.id === 'sweetBerryBush' ? 'entity.player.hurt_sweet_berry_bush' : src.id === 'freeze' ? 'entity.player.hurt_freeze' : 'entity.player.hurt';
      this.s.playSound(p, ev, 'player', p.x, p.y, p.z, 1, voice);
    }
    return true;
  }

  private actuallyHurt(p: ServerPlayer, src: DamageSource, amount: number): void {
    const l = p.living;
    // LivingEntity.getDamageAfterArmorAbsorb: armour loses durability, then reduces the damage
    if (!src.bypassArmor) {
      this.s.items.hurtArmor(p, src, amount);
      const a = this.s.items.armorOf(p);
      amount = damageAfterArmor(amount, a.armor, a.toughness);
    }
    // getDamageAfterMagicAbsorb: Resistance (not for starvation or the void); enchantments Phase 7
    if (src.id !== 'starve' && src.id !== 'outOfWorld') amount = damageAfterResistance(amount, l.effects.amplifier('resistance'));
    if (amount <= 0) return;
    // absorption first
    const absorbed = Math.min(l.absorption, amount);
    l.absorption -= absorbed;
    amount -= absorbed;
    if (amount === 0) return;
    if (!src.bypassArmor) l.food.addExhaustion(EXHAUSTION.damage);
    // Player.actuallyHurt: the combat entry is recorded before the health drops
    l.combat.recordDamage(src, l.health, amount, this.s.gameTime, fallLocation(l.lastClimbable, p.phys.isInWater), p.fallDistance, true);
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
      // Water Breathing (turtle shell, conduits) stops the air supply from dropping
      if (!invulnerable && !l.effects.has('water_breathing') && !l.effects.has('conduit_power')) {
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
    const inPowderSnow = this.blockContact(p);
    // LivingEntity.aiStep freezing: +1 per tick in powder snow (up to 140), −2 outside;
    // fully frozen players take 1 freeze damage every 2 s (leather armour protects — Phase 5)
    const before = l.ticksFrozen;
    if (inPowderSnow && p.gameMode !== 3 && this.s.items.canFreeze(p)) l.ticksFrozen = Math.min(140, l.ticksFrozen + 1);
    else l.ticksFrozen = Math.max(0, l.ticksFrozen - 2);
    if (l.ticksFrozen !== before) p.stateDirty = true;
    if (this.s.gameTime % 40 === 0 && l.ticksFrozen >= 140 && p.gameMode !== 3) this.hurt(p, DAMAGE.freeze, 1);

    // LivingEntity.onClimbable: climbing resets falls and remembers the block for death messages
    if (p.gameMode !== 3 && ph.onClimbable()) {
      p.fallDistance = 0;
      l.lastClimbable = blockNameOf(w.getState(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
    } else if (p.onGround) l.lastClimbable = null;
    // kill credit for the last player to hurt us lasts 5 s; combat entries 5 s (15 s in a fight)
    if (l.lastHurtByPlayerTime > 0) l.lastHurtByPlayerTime--;
    else l.lastHurtByPlayer = null;
    l.combat.recheckStatus(this.s.gameTime, !l.dead);

    // LivingEntity.tickEffects
    if (l.effects.active.size) l.effects.tick(this.s.items.effectTarget(p));
    if (l.dead) {
      this.sync(p);
      return;
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
    if (l.absorption !== l.lastSentAbsorption) {
      this.s.send(p, { t: 'absorption', amount: l.absorption });
      l.lastSentAbsorption = l.absorption;
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

  /** entityInside / stepOn damage: cactus, fire, campfires, sweet berry bushes, magma blocks. Returns isInPowderSnow. */
  private blockContact(p: ServerPlayer): boolean {
    let powderSnow = false;
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
          if (n === 'powder_snow') powderSnow = true;
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
    return powderSnow;
  }

  /** Entity.checkFallDamage on landing, with Block.fallOn multipliers. */
  land(p: ServerPlayer, fallDistance: number): void {
    if (p.mayFly) return;
    const w = this.s.world;
    const below = w.getState(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    const n = blockNameOf(below);
    if (n === 'powder_snow') {
      // PowderSnowBlock.fallOn: no damage, just a thud (small under 7 blocks)
      if (fallDistance >= 4) this.s.playSound(null, fallDistance < 7 ? 'entity.player.small_fall' : 'entity.player.big_fall', 'player', p.x, p.y, p.z, 1, 1);
      return;
    }
    let mult = 1;
    if (n === 'hay_block' || n === 'honey_block') mult = 0.2;
    else if (n.endsWith('_bed')) mult = 0.5;
    else if (n === 'slime_block' && !p.sneaking) mult = 0;
    else if (n === 'pointed_dripstone' && getProp(below, 'vertical_direction') === 'up' && getProp(below, 'thickness') === 'tip') {
      // falling onto a stalagmite tip: double damage plus 2 (vanilla PointedDripstoneBlock.fallOn)
      const dmg = Math.ceil((fallDistance + 2 - 3) * 2);
      if (dmg > 0) {
        this.fallSounds(p, dmg, below);
        this.hurt(p, { id: 'stalagmite', bypassArmor: true }, dmg);
      }
      return;
    }
    const dmg = Math.ceil((fallDistance - 3) * mult);
    if (dmg > 0) {
      this.fallSounds(p, dmg, below);
      this.hurt(p, DAMAGE.fall, dmg);
    }
  }

  /** LivingEntity.causeFallDamage sounds (others hear them; the player's client plays its own). */
  private fallSounds(p: ServerPlayer, dmg: number, below: number): void {
    this.s.playSound(p, dmg > 4 ? 'entity.player.big_fall' : 'entity.player.small_fall', 'player', p.x, p.y, p.z, 1, 1);
    if (below !== 0) {
      const st = soundTypeOf(below);
      this.s.playSound(p, st.fall, 'player', p.x, p.y, p.z, st.volume * 0.5, st.pitch * 0.75);
    }
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
    const msg = this.deathMessage(p);
    if (this.s.gameRules.showDeathMessages) {
      for (const o of this.s.players) this.s.send(o, { t: 'chat', json: JSON.stringify({ text: msg }) });
    }
    this.s.broadcastToTrackers(p, { t: 'entityEvent', id: p.id, event: 3 }, true);
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
      // Player.getExperienceReward: 7 per level (max 100), dropped as orbs
      const xp = p.gameMode === 3 ? 0 : deathExperience(l.experienceLevel);
      if (xp > 0) this.s.spawnExperience(p.x, p.y, p.z, xp);
      l.experienceLevel = 0;
      l.experienceProgress = 0;
      l.totalExperience = 0;
    }
    this.sync(p);
  }

  /** LivingEntity.die → CombatTracker.getDeathMessage (kill credit: the tracker's killer, else lastHurtByPlayer). */
  private deathMessage(p: ServerPlayer): string {
    const l = p.living;
    return l.combat.getDeathMessage(p.name, l.lastHurtByPlayer ? { name: l.lastHurtByPlayer, player: true } : null);
  }

  /** PlayerList.respawn: back to spawn with fresh survival state. */
  respawn(p: ServerPlayer): void {
    if (!p.living.dead) return;
    const keep = this.s.gameRules.keepInventory;
    const old = p.living;
    p.living = new LivingState();
    p.living.effects.onChange = (e, removed) => this.s.items.sendEffect(p, e, removed);
    if (keep) {
      p.living.experienceLevel = old.experienceLevel;
      p.living.experienceProgress = old.experienceProgress;
      p.living.totalExperience = old.totalExperience;
    }
    p.fallDistance = 0;
    const { pos: [x, y, z], yaw } = this.s.sleep.respawnPosition(p);
    p.x = x;
    p.y = y;
    p.z = z;
    p.yaw = yaw;
    p.pitch = 0;
    p.flying = p.gameMode === 3;
    this.s.send(p, { t: 'respawn', gameMode: p.gameMode });
    this.s.send(p, { t: 'teleport', x, y, z, yaw, pitch: 0 });
    this.sync(p);
    p.stateDirty = true;
  }
}
