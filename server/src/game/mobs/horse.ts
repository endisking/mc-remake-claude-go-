/**
 * Horses, donkeys and mules (vanilla AbstractHorse / Horse / AbstractChestedHorse, 1.17.1):
 * random stats (health 15–30, speed 0.1125–0.3375, jump 0.4–1.0 for horses; donkeys/mules 0.175
 * speed, 0.5 jump), taming by temper (each mount attempt tames with chance temper/100, otherwise
 * +5 temper and the horse rears), feeding (temper, healing, growth), saddles, chests on donkeys
 * and mules, breeding with golden carrots/apples (child stats average both parents and a random
 * roll; horse × donkey → mule; mules are sterile).
 *
 * Riding (riding.ts): an empty-handed click mounts; untamed horses run around and, each tick
 * with chance 1/50, either accept the rider (random(100) < temper) or throw them off (+5 temper).
 * Saddled tame horses are steered by the rider (AbstractHorse.travel) with the charged jump.
 */
import { itemName, stack } from '@shared/item/stack';
import type { ServerPlayer } from '../player';
import type { DamageSource } from '../survival';
import type { MobCategory, Target } from './mob';
import { Animal } from './animals';
import { FloatGoal, PanicGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal } from './goals';
import { BreedGoal, FollowParentGoal } from './animals';

/** AbstractHorse.handleEating: [heal, age-up ticks, temper] */
const FOODS: Record<string, [number, number, number]> = {
  sugar: [1, 30, 3],
  wheat: [2, 20, 3],
  hay_block: [20, 180, 0],
  apple: [3, 60, 3],
  golden_carrot: [4, 60, 5],
  golden_apple: [10, 240, 10],
  enchanted_golden_apple: [10, 240, 10],
};
const BREED_FOOD = new Set(['golden_carrot', 'golden_apple', 'enchanted_golden_apple']);

export abstract class AbstractHorse extends Animal {
  override readonly category: MobCategory = 'creature';
  readonly adultWidth = 1.3964844;
  readonly adultHeight: number = 1.6;
  readonly food = BREED_FOOD;
  /** random max health (generateRandomMaxHealth) */
  maxHp = 20;
  jumpStrength = 0.7;
  tame = false;
  temper = 0;
  ownerName: string | null = null;
  saddled = false;
  /** ticks of the rearing animation after a failed mount */
  standCounter = 0;
  /** AbstractHorse.playerJumpPendingScale (0 = none) and isJumping */
  playerJumpPendingScale = 0;
  isJumping = false;
  /** AbstractHorse: maxUpStep 1.0 */
  override maxUpStep = 1;

  get maxHealth(): number {
    return this.maxHp;
  }

  protected registerGoals(): void {
    this.goalSelector.add(1, new PanicGoal(this, 1.2));
    this.goalSelector.add(2, new BreedGoal(this, 1));
    this.goalSelector.add(4, new FollowParentGoal(this, 1));
    this.goalSelector.add(6, new RandomStrollGoal(this, 0.7));
    this.goalSelector.add(7, new LookAtPlayerGoal(this, 6));
    this.goalSelector.add(8, new RandomLookAroundGoal(this));
    this.goalSelector.add(0, new FloatGoal(this));
  }

  override init(): void {
    this.randomizeAttributes();
    super.init();
  }

  static randomHealth(r: { nextInt(n: number): number }): number {
    return 15 + r.nextInt(8) + r.nextInt(9);
  }
  static randomSpeed(r: { nextDouble(): number }): number {
    return (0.45 + r.nextDouble() * 0.3 + r.nextDouble() * 0.3 + r.nextDouble() * 0.3) * 0.25;
  }
  static randomJump(r: { nextDouble(): number }): number {
    return 0.4 + r.nextDouble() * 0.2 + r.nextDouble() * 0.2 + r.nextDouble() * 0.2;
  }

  protected randomizeAttributes(): void {
    this.maxHp = AbstractHorse.randomHealth(this.rng);
  }

  override get eyeHeight(): number {
    return this.height * 0.95;
  }

  override canMate(o: Animal): boolean {
    return o !== this && o instanceof AbstractHorse && this.tame && o.tame && this.isInLove() && o.isInLove() && this.canParent() && o.canParent() && breedResult(this, o) !== null;
  }
  canParent(): boolean {
    return !this.isBaby() && this.health >= this.maxHealth && this.isInLove();
  }

  /** AbstractHorse.modifyTemper */
  modifyTemper(n: number): number {
    this.temper = Math.max(0, Math.min(100, this.temper + n));
    return this.temper;
  }

  tameWith(p: ServerPlayer): void {
    this.tame = true;
    this.ownerName = p.name;
    this.persistenceRequired = true;
    this.entityEvent(7);
    this.flagsDirty = true;
  }

  /** HorseRunAroundLikeCrazyGoal: the taming roll of a mount attempt */
  tryTame(p: ServerPlayer): boolean {
    if (this.rng.nextInt(100) < this.temper) {
      this.tameWith(p);
      return true;
    }
    this.modifyTemper(5);
    this.makeMad();
    this.entityEvent(6);
    return false;
  }

  /** HorseRunAroundLikeCrazyGoal.tick roll: tame, or throw the rider off (ejectPassengers). */
  riderTamingRoll(p: ServerPlayer): boolean {
    const ok = this.tryTame(p);
    if (!ok) this.s.riding.dismount(p);
    return ok;
  }

  makeMad(): void {
    this.standCounter = 20;
    this.playSound(this.angrySound(), 1, this.voicePitch());
  }

  /** AbstractHorse.handleEating */
  protected handleEating(p: ServerPlayer, name: string): boolean {
    const f = FOODS[name];
    if (!f) return false;
    const [heal, grow, temper] = f;
    let used = false;
    if (this.health < this.maxHealth && heal > 0) {
      this.heal(heal);
      used = true;
    }
    if (this.isBaby() && grow > 0) {
      this.ageUp(Math.floor(grow / 20));
      used = true;
    }
    if (temper > 0 && (used || !this.tame) && this.temper < 100) {
      this.modifyTemper(temper);
      used = true;
    }
    if (BREED_FOOD.has(name) && this.tame && !this.isBaby() && this.ageTicks === 0 && !this.isInLove()) {
      this.setInLove(p);
      used = true;
    }
    if (used) this.playSound(this.eatSound(), 1, 1 + (this.rng.nextFloat() - this.rng.nextFloat()) * 0.2);
    return used;
  }

  override interact(p: ServerPlayer, hand: number): boolean {
    if (this.dead) return false;
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    const name = held ? itemName(held.id) : '';
    if (held && FOODS[name]) {
      if (this.handleEating(p, name)) this.s.mobs.usePlayerItem(p, slot);
      return true;
    }
    if (this.isBaby()) return false;
    if (name === 'saddle' && this.tame && !this.saddled) {
      this.saddled = true;
      this.flagsDirty = true;
      this.playSound('entity.horse.saddle', 0.5, 1);
      this.s.mobs.usePlayerItem(p, slot);
      return true;
    }
    if (this.extraInteract(p, slot, name)) return true;
    // an empty hand mounts (doPlayerRide); holding anything else angers an untamed horse
    if (hand !== 0) return false;
    if (held && !this.tame) {
      this.makeMad();
      return true;
    }
    if (this.s.riding.isVehicle(this)) return false;
    return this.s.riding.mount(p, this);
  }

  /** AbstractHorse.onPlayerJump: power 0–100 → pending jump scale */
  onPlayerJump(power: number): void {
    if (!this.saddled) return;
    if (power < 0) power = 0;
    this.playerJumpPendingScale = power >= 90 ? 1 : 0.4 + (0.4 * power) / 90;
  }

  /** AbstractHorse.travel, ridden by a player: rider rotation, rider input, charged jump. */
  protected override steeredStep(inp: import('../riding').SteerInput): boolean {
    if (!this.tame || !this.saddled) return false;
    if (inp.jumpPower >= 0) this.onPlayerJump(inp.jumpPower);
    this.navigation.stop();
    this.yaw = inp.yaw;
    this.pitch = inp.pitch * 0.5;
    this.yBodyRot = this.yaw;
    this.yHeadRot = this.yBodyRot;
    let f = inp.strafe * 0.5;
    let f1 = inp.forward;
    if (f1 <= 0) f1 *= 0.25;
    if (this.onGround && this.playerJumpPendingScale === 0 && this.standCounter > 0) f = f1 = 0;
    if (this.playerJumpPendingScale > 0 && !this.isJumping && this.onGround) {
      const jb = this.mobEffects.get('jump_boost');
      const d0 = this.jumpStrength * this.playerJumpPendingScale * this.jumpFactor();
      this.vy = jb ? d0 + (jb.amplifier + 1) * 0.1 : d0;
      this.isJumping = true;
      if (f1 > 0) {
        const r = (this.yaw * Math.PI) / 180;
        this.vx += -0.4 * Math.sin(r) * this.playerJumpPendingScale;
        this.vz += 0.4 * Math.cos(r) * this.playerJumpPendingScale;
      }
      this.playerJumpPendingScale = 0;
      this.playSound('entity.horse.jump', 0.4, 1);
    }
    this.flyingSpeed = this.movementSpeedValue() * 0.1;
    this.speed = this.movementSpeedValue();
    this.xxa = f;
    this.zza = f1;
    this.jumping = false;
    return true;
  }

  /** AbstractHorse.travel tail: landing ends the jump */
  protected override afterTravel(): void {
    if (this.onGround) {
      if (this.isJumping) this.playerJumpPendingScale = 0;
      this.isJumping = false;
    }
    if (!this.steer) this.flyingSpeed = 0.02;
  }

  protected extraInteract(_p: ServerPlayer, _slot: number, _name: string): boolean {
    return false;
  }

  protected override customServerAiStep(): void {
    if (this.standCounter > 0) {
      this.standCounter--;
      this.navigation.stop();
    }
    // HorseRunAroundLikeCrazyGoal: an untamed horse with a rider bolts and, 1 in 50 ticks, decides
    const rider = !this.tame ? this.s.riding.passengers(this)[0] : undefined;
    if (rider) {
      if (this.navigation.isDone()) {
        const a = this.rng.nextFloat() * Math.PI * 2, d = 5 + this.rng.nextInt(5);
        this.navigation.moveTo(this.x + Math.cos(a) * d, this.y, this.z + Math.sin(a) * d, 1.2);
      }
      if (this.rng.nextInt(50) === 0) this.riderTamingRoll(rider);
    }
    // AbstractHorse.aiStep: heal 1 every 900 ticks
    if (this.tickCount % 900 === 0 && this.health < this.maxHealth) this.heal(1);
  }

  override die(src: DamageSource, attacker: Target | null): void {
    if (this.saddled && this.s.mobs.doMobLoot) this.s.mobs.spawnAtLocation(this, stack('saddle'));
    super.die(src, attacker);
  }

  protected override inheritTo(baby: Animal, partner: Animal): void {
    if (!(baby instanceof AbstractHorse) || !(partner instanceof AbstractHorse)) return;
    // AbstractHorse.setOffspringAttributes: (parent + parent + random) / 3
    baby.maxHp = (this.maxHp + partner.maxHp + AbstractHorse.randomHealth(this.rng)) / 3;
    baby.health = baby.maxHp;
    baby.movementSpeed = (this.movementSpeed + partner.movementSpeed + AbstractHorse.randomSpeed(this.rng)) / 3;
    baby.jumpStrength = (this.jumpStrength + partner.jumpStrength + AbstractHorse.randomJump(this.rng)) / 3;
  }

  /** Animal.spawnChildFromBreeding with the horse × donkey → mule rule */
  override breedWith(partner: Animal): void {
    const type = partner instanceof AbstractHorse ? breedResult(this, partner) : null;
    if (!type) return;
    if (type === this.type) return super.breedWith(partner);
    const baby = this.s.mobs.spawn(type, this.x, this.y, this.z, 'breeding') as AbstractHorse | null;
    if (!baby) return;
    baby.setAge(-24000);
    baby.persistenceRequired = true;
    this.inheritTo(baby, partner);
    this.setAge(6000);
    partner.setAge(6000);
    this.resetLove();
    partner.resetLove();
    if (this.s.mobs.doMobLoot) this.s.spawnExperience(this.x, this.y, this.z, this.rng.nextInt(7) + 1);
  }

  override saveExtra(): Record<string, unknown> {
    return { maxHp: this.maxHp, speed: this.movementSpeed, jump: this.jumpStrength, tame: this.tame, temper: this.temper, owner: this.ownerName, saddled: this.saddled };
  }
  override loadExtra(o: Record<string, unknown>): void {
    this.maxHp = (o.maxHp as number) ?? this.maxHp;
    this.movementSpeed = (o.speed as number) ?? this.movementSpeed;
    this.jumpStrength = (o.jump as number) ?? this.jumpStrength;
    this.tame = !!o.tame;
    this.temper = (o.temper as number) ?? 0;
    this.ownerName = (o.owner as string | null) ?? null;
    this.saddled = !!o.saddled;
  }

  protected abstract angrySound(): string;
  protected abstract eatSound(): string;
}

/** Which foal two parents make (null = can't breed). */
export function breedResult(a: AbstractHorse, b: AbstractHorse): string | null {
  if (a.type === 'mule' || b.type === 'mule') return null;
  if (a.type === b.type) return a.type;
  return 'mule';
}

export class Horse extends AbstractHorse {
  readonly type = 'horse';
  /** Variant: colour 0–6 + markings 0–4 × 256 */
  horseVariant = 0;
  protected override randomizeAttributes(): void {
    super.randomizeAttributes();
    this.movementSpeed = AbstractHorse.randomSpeed(this.rng);
    this.jumpStrength = AbstractHorse.randomJump(this.rng);
    this.horseVariant = this.rng.nextInt(7) + (this.rng.nextInt(5) << 8);
  }
  override variant(): number {
    return this.horseVariant;
  }
  protected override inheritTo(baby: Animal, partner: Animal): void {
    super.inheritTo(baby, partner);
    // Horse.getBreedOffspring: colour from a parent (or random 1/9), markings likewise (1/9)
    if (baby instanceof Horse && partner instanceof Horse) {
      const r = this.rng.nextInt(9);
      const color = r < 4 ? this.horseVariant & 255 : r < 8 ? partner.horseVariant & 255 : this.rng.nextInt(7);
      const k = this.rng.nextInt(5);
      const marks = k < 2 ? this.horseVariant >> 8 : k < 4 ? partner.horseVariant >> 8 : this.rng.nextInt(5);
      baby.horseVariant = color | (marks << 8);
    }
  }
  override saveExtra(): Record<string, unknown> {
    return { ...super.saveExtra(), variant: this.horseVariant };
  }
  override loadExtra(o: Record<string, unknown>): void {
    super.loadExtra(o);
    this.horseVariant = (o.variant as number) ?? 0;
  }
  protected angrySound(): string {
    return 'entity.horse.angry';
  }
  protected eatSound(): string {
    return 'entity.horse.eat';
  }
  override ambientSound(): string {
    return 'entity.horse.ambient';
  }
  override hurtSound(): string {
    return 'entity.horse.hurt';
  }
  override deathSound(): string {
    return 'entity.horse.death';
  }
  override stepSound(): string {
    return 'entity.horse.step';
  }
}

/** AbstractChestedHorse: donkeys and mules take a chest (15 extra slots). */
export abstract class AbstractChestedHorse extends AbstractHorse {
  hasChest = false;
  protected override randomizeAttributes(): void {
    super.randomizeAttributes();
    this.movementSpeed = 0.175;
    this.jumpStrength = 0.5;
  }
  protected override extraInteract(_p: ServerPlayer, slot: number, name: string): boolean {
    if (name !== 'chest' || !this.tame || this.hasChest) return false;
    this.hasChest = true;
    this.flagsDirty = true;
    this.playSound('entity.donkey.chest', 1, 1 + (this.rng.nextFloat() - this.rng.nextFloat()) * 0.2);
    this.s.mobs.usePlayerItem(_p, slot);
    return true;
  }
  override die(src: DamageSource, attacker: Target | null): void {
    if (this.hasChest && this.s.mobs.doMobLoot) this.s.mobs.spawnAtLocation(this, stack('chest'));
    super.die(src, attacker);
  }
  override saveExtra(): Record<string, unknown> {
    return { ...super.saveExtra(), chest: this.hasChest };
  }
  override loadExtra(o: Record<string, unknown>): void {
    super.loadExtra(o);
    this.hasChest = !!o.chest;
  }
}

export class Donkey extends AbstractChestedHorse {
  readonly type = 'donkey';
  override readonly adultHeight = 1.5;
  protected angrySound(): string {
    return 'entity.donkey.angry';
  }
  protected eatSound(): string {
    return 'entity.donkey.eat';
  }
  override ambientSound(): string {
    return 'entity.donkey.ambient';
  }
  override hurtSound(): string {
    return 'entity.donkey.hurt';
  }
  override deathSound(): string {
    return 'entity.donkey.death';
  }
  override stepSound(): string {
    return 'entity.horse.step';
  }
}

export class Mule extends AbstractChestedHorse {
  readonly type = 'mule';
  protected angrySound(): string {
    return 'entity.mule.angry';
  }
  protected eatSound(): string {
    return 'entity.mule.eat';
  }
  override ambientSound(): string {
    return 'entity.mule.ambient';
  }
  override hurtSound(): string {
    return 'entity.mule.hurt';
  }
  override deathSound(): string {
    return 'entity.mule.death';
  }
  override stepSound(): string {
    return 'entity.horse.step';
  }
}
