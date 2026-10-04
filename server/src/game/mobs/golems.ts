/**
 * Iron and snow golems (vanilla IronGolem / SnowGolem / CarvedPumpkinBlock, 1.17.1).
 *
 * Iron golems: 100 HP, knockback resistance 1, attack 15 → 7.5–21.5 damage per hit with a 0.4
 * upward toss, attack hostile monsters (not creepers) and whoever hurts them (player-built golems
 * never retaliate against players), drop 3–5 iron ingots and 0–2 poppies. Snow golems: 4 HP,
 * throw a snowball at monsters every 20 ticks within 10 blocks (3 damage to blazes), leave snow
 * layers where it's cold, take damage in rain/water and hot biomes, drop 0–15 snowballs.
 * Both are built by placing a carved pumpkin (or jack o'lantern) on the block pattern.
 */
import { blockNameOf, stateOf } from '@shared/world/blockstate';
import { BIOMES } from '@shared/data';
import { getTemperature } from '@shared/world/climate';
import { itemName } from '@shared/item/stack';
import type { ServerPlayer } from '../player';
import type { DamageSource } from '../survival';
import type { GameServer } from '../server';
import { Goal, Flag } from './goal';
import { Mob, isMob, type MobCategory, type Target } from './mob';
import { Thrown } from '../throwable';
import {
  FloatGoal, MeleeAttackGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal, HurtByTargetGoal, NearestMobTargetGoal,
} from './goals';

/** Mobs that implement Enemy in 1.17.1 (golems target these). */
export const ENEMIES = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'wither_skeleton', 'creeper', 'spider', 'cave_spider', 'slime', 'magma_cube',
  'enderman', 'endermite', 'silverfish', 'witch', 'pillager', 'vindicator', 'evoker', 'illusioner', 'ravager', 'vex', 'blaze', 'ghast', 'guardian',
  'elder_guardian', 'shulker', 'phantom', 'hoglin', 'zoglin', 'piglin_brute', 'wither',
]);

export class IronGolem extends Mob {
  readonly type = 'iron_golem';
  readonly category: MobCategory = 'misc';
  readonly trackRange = 160;
  readonly maxHealth = 100;
  readonly width = 1.4;
  readonly height = 2.7;
  override movementSpeed = 0.25;
  override knockbackResistance = 1;
  override attackDamage = 15;
  playerCreated = false;
  attackAnimationTick = 0;
  offerFlowerTick = 0;

  protected registerGoals(): void {
    this.goalSelector.add(1, new MeleeAttackGoal(this, 1, true));
    this.goalSelector.add(6, new RandomStrollGoal(this, 0.6));
    this.goalSelector.add(7, new LookAtPlayerGoal(this, 6));
    this.goalSelector.add(8, new RandomLookAroundGoal(this));
    this.targetSelector.add(2, new (class extends HurtByTargetGoal {
      constructor(private readonly g: IronGolem) {
        super(g);
      }
      override canUse(): boolean {
        // IronGolem.canAttackType: player-built golems don't fight players
        const by = this.g.lastHurtByMob;
        if (this.g.playerCreated && by && !isMob(by)) return false;
        return super.canUse();
      }
    })(this));
    this.targetSelector.add(3, new NearestMobTargetGoal(this, false, (m) => ENEMIES.has(m.type) && m.type !== 'creeper', 5));
  }

  override get eyeHeight(): number {
    return 2.3;
  }
  override saveExtra(): Record<string, unknown> {
    return { playerCreated: this.playerCreated };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.playerCreated = !!o.playerCreated;
  }
  override removeWhenFarAway(): boolean {
    return false;
  }
  override maxFallDistance(): number {
    return 3;
  }
  /** IronGolem.doHurtTarget: f/2 + rand(f) */
  override meleeDamage(): number {
    const f = this.attackDamage;
    this.attackAnimationTick = 10;
    this.entityEvent(4);
    return Math.trunc(f) > 0 ? f / 2 + this.rng.nextInt(Math.trunc(f)) : f;
  }
  override afterMeleeHit(t: Target): void {
    t.vy += 0.4;
    if (isMob(t)) t.velocityDirty = true;
    else t.knockbackDirty = true;
    this.playSound('entity.iron_golem.attack', 1, 1);
  }
  protected override customServerAiStep(): void {
    if (this.attackAnimationTick > 0) this.attackAnimationTick--;
    if (this.offerFlowerTick > 0) this.offerFlowerTick--;
  }
  /** IronGolem.mobInteract: iron ingots heal 25 HP */
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (!held || itemName(held.id) !== 'iron_ingot' || this.health >= this.maxHealth) return false;
    this.heal(25);
    this.s.mobs.usePlayerItem(p, slot);
    this.playSound('entity.iron_golem.repair', 1, 1 + (this.rng.nextFloat() - this.rng.nextFloat()) * 0.2);
    return true;
  }
  override hurt(src: DamageSource, amount: number, attacker: Target | null = null): boolean {
    const ok = super.hurt(src, amount, attacker);
    if (ok) this.playSound('entity.iron_golem.damage', 1, 1);
    return ok;
  }
  override hurtSound(): string {
    return 'entity.iron_golem.hurt';
  }
  override deathSound(): string {
    return 'entity.iron_golem.death';
  }
  override stepSound(): string {
    return 'entity.iron_golem.step';
  }
}

/** RangedAttackGoal(1.25, 20, 10): keep the target in sight within 10 blocks and throw. */
class SnowballAttackGoal extends Goal {
  private attackTime = -1;
  private seeTime = 0;
  constructor(private readonly g: SnowGolem) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    const t = this.g.target;
    return !!t && isMob(t) && !t.dead;
  }
  override canContinueToUse(): boolean {
    return this.canUse() || !this.g.navigation.isDone();
  }
  override stop(): void {
    this.seeTime = 0;
    this.attackTime = -1;
  }
  override tick(): void {
    const g = this.g, t = g.target;
    if (!t) return;
    const d2 = g.distanceToTargetSqr(t);
    const see = g.hasLineOfSight(t);
    this.seeTime = see ? this.seeTime + 1 : 0;
    if (d2 <= 100 && this.seeTime >= 5) g.navigation.stop();
    else g.navigation.moveToEntity(t, 1.25);
    g.lookControl.setLookAt(t.x, t.y + (isMob(t) ? t.eyeHeight : 1.62), t.z, 30, 30);
    if (--this.attackTime === 0) {
      if (!see) return;
      g.throwSnowball(t);
      this.attackTime = 20;
    } else if (this.attackTime < 0) this.attackTime = 20;
  }
}

export class SnowGolem extends Mob {
  readonly type = 'snow_golem';
  readonly category: MobCategory = 'misc';
  readonly trackRange = 80;
  readonly maxHealth = 4;
  readonly width = 0.7;
  readonly height = 1.9;
  override movementSpeed = 0.2;
  pumpkin = true;

  protected registerGoals(): void {
    this.goalSelector.add(1, new SnowballAttackGoal(this));
    this.goalSelector.add(2, new RandomStrollGoal(this, 1, 120));
    this.goalSelector.add(3, new LookAtPlayerGoal(this, 6));
    this.goalSelector.add(4, new RandomLookAroundGoal(this));
    this.targetSelector.add(1, new NearestMobTargetGoal(this, true, (m) => ENEMIES.has(m.type), 10));
  }
  override get eyeHeight(): number {
    return 1.7;
  }
  override saveExtra(): Record<string, unknown> {
    return { pumpkin: this.pumpkin };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.pumpkin = o.pumpkin !== false;
  }
  override removeWhenFarAway(): boolean {
    return false;
  }
  temperatureHere(): number {
    const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
    return getTemperature(this.world.getBiome(x, y, z), x, y, z);
  }
  /** SnowGolem.aiStep: melt in water/rain and hot biomes, leave snow where it's cold */
  protected override customServerAiStep(): void {
    if (this.isInWaterOrRain()) this.hurt({ id: 'drown', bypassArmor: true }, 1);
    const bx = Math.floor(this.x), by = Math.floor(this.y), bz = Math.floor(this.z);
    const biome = BIOMES[this.world.getBiome(bx, by, bz)];
    if (biome && biome.name.includes('nether')) this.hurt({ id: 'onFire', bypassArmor: true, fire: true }, 1);
    else if (this.temperatureHere() > 1) this.hurt({ id: 'onFire', bypassArmor: true, fire: true }, 1);
    if (!this.s.mobs.mobGriefing) return;
    const snow = stateOf('snow');
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(this.x + ((i % 2) * 2 - 1) * 0.25), y = Math.floor(this.y), z = Math.floor(this.z + (((i / 2) | 0) % 2 * 2 - 1) * 0.25);
      if (this.world.getState(x, y, z) !== 0) continue;
      if (getTemperature(this.world.getBiome(x, y, z), x, y, z) >= 0.8) continue;
      const below = this.world.getState(x, y - 1, z);
      if (below === 0 || !isSturdy(below)) continue;
      this.s.setBlock(x, y, z, snow);
    }
  }
  throwSnowball(t: Target): void {
    const host = this.s.items.arrowHost;
    const ball = new Thrown(this.s.newEntityId(), 'snowball', 0, host);
    ball.x = this.x;
    ball.y = this.y + this.eyeHeight - 0.1;
    ball.z = this.z;
    ball.ownerId = this.id;
    const tx = t.x - this.x, tz = t.z - this.z;
    const ty = t.y + (isMob(t) ? t.eyeHeight : 1.62) - 1.1 - ball.y;
    const h = Math.hypot(tx, tz) * 0.2;
    // Projectile.shoot(dx, dy + h, dz, 1.6, 12)
    const len = Math.hypot(tx, ty + h, tz) || 1, r = this.rng, g = 0.0075 * 12;
    ball.vx = (tx / len + r.nextGaussian() * g) * 1.6;
    ball.vy = ((ty + h) / len + r.nextGaussian() * g) * 1.6;
    ball.vz = (tz / len + r.nextGaussian() * g) * 1.6;
    ball.onHit = (_e, hit) => {
      // Snowball.onHitEntity: 3 damage to blazes, 0 ("thrown") otherwise — knockback still applies
      const target = hit.target ? this.s.entities.get(hit.target.id) : null;
      if (target && isMob(target)) {
        const src = { id: 'thrown', projectile: true, knockbackFrom: this } as DamageSource;
        if (target.type === 'blaze') target.hurt(src, 3, this);
        else if (!target.dead) {
          target.lastHurtByMob = this;
          target.lastHurtByMobTimestamp = target.tickCount;
          target.knockback(0.4, this.x - target.x, this.z - target.z);
          target.entityEvent(2);
        }
      }
    };
    this.s.spawnEntity(ball);
    this.playSound('entity.snow_golem.shoot', 1, 0.4 / (this.rng.nextFloat() * 0.4 + 0.8));
  }
  /** shears remove the pumpkin */
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (!held || itemName(held.id) !== 'shears' || !this.pumpkin) return false;
    this.pumpkin = false;
    this.flagsDirty = true;
    this.playSound('entity.snow_golem.shear', 1, 1);
    this.s.mobs.damageHeldItem(p, slot, 1);
    return true;
  }
  override ambientSound(): string {
    return 'entity.snow_golem.ambient';
  }
  override hurtSound(): string {
    return 'entity.snow_golem.hurt';
  }
  override deathSound(): string {
    return 'entity.snow_golem.death';
  }
}

import { FULL_COLLISION } from '@shared/world/blockinfo';
const isSturdy = (st: number) => FULL_COLLISION[st] === 1;

// ---------------------------------------------------------------- building
const isHead = (n: string) => n === 'carved_pumpkin' || n === 'jack_o_lantern';

/**
 * CarvedPumpkinBlock.trySpawnGolem: called when a carved pumpkin or jack o'lantern is placed.
 * Snow golem: pumpkin on 2 snow blocks. Iron golem: pumpkin on a T of 4 iron blocks (either
 * orientation) with air (or non-solid replaceables) in the bottom corners.
 */
export function trySpawnGolemAt(s: GameServer, x: number, y: number, z: number): Mob | null {
  const w = s.world;
  const name = (dx: number, dy: number, dz: number) => blockNameOf(w.getState(x + dx, y + dy, z + dz));
  if (!isHead(name(0, 0, 0))) return null;
  if (name(0, -1, 0) === 'snow_block' && name(0, -2, 0) === 'snow_block') {
    for (const dy of [0, -1, -2]) {
      s.setBlock(x, y + dy, z, 0);
      for (const o of s.players) s.send(o, { t: 'levelEvent', event: 2001, x, y: y + dy, z, data: stateOf(dy === 0 ? 'carved_pumpkin' : 'snow_block') });
    }
    return s.mobs.spawn('snow_golem', x + 0.5, y - 1.95, z + 0.5, 'command');
  }
  if (name(0, -1, 0) !== 'iron_block' || name(0, -2, 0) !== 'iron_block') return null;
  const empty = (n: string) => n === 'air' || n === 'cave_air' || n === 'grass' || n === 'snow';
  for (const [ax, az] of [[1, 0], [0, 1]] as const) {
    if (name(ax, -1, az) !== 'iron_block' || name(-ax, -1, -az) !== 'iron_block') continue;
    if (!empty(name(ax, -2, az)) || !empty(name(-ax, -2, -az))) continue;
    const blocks: [number, number, number][] = [[0, 0, 0], [0, -1, 0], [0, -2, 0], [ax, -1, az], [-ax, -1, -az]];
    for (const [dx, dy, dz] of blocks) {
      s.setBlock(x + dx, y + dy, z + dz, 0);
      for (const o of s.players) s.send(o, { t: 'levelEvent', event: 2001, x: x + dx, y: y + dy, z: z + dz, data: stateOf(dy === 0 ? 'carved_pumpkin' : 'iron_block') });
    }
    const g = s.mobs.spawn('iron_golem', x + 0.5, y - 2 + 0.05, z + 0.5, 'command') as IronGolem | null;
    if (g) {
      g.playerCreated = true;
      g.persistenceRequired = true;
    }
    return g;
  }
  return null;
}
