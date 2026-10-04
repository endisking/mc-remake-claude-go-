/** Farm animals: pig, cow, sheep, chicken (vanilla Animal / AgeableMob, 1.17.1). */
import { itemName, stack, type ItemStack } from '@shared/item/stack';
import { blockNameOf } from '@shared/world/blockstate';
import { BLOCKS_BY_NAME } from '@shared/data';
import type { ServerPlayer } from '../player';
import type { DamageSource } from '../survival';
import { Goal, Flag } from './goal';
import { Mob, brightnessOf, type MobCategory } from './mob';
import { PathType } from './pathfinder';
import { FloatGoal, PanicGoal, TemptGoal, RandomStrollGoal, LookAtPlayerGoal, RandomLookAroundGoal } from './goals';
import { MOB_FLAG, ENTITY_EVENT, DYE_COLORS } from '@shared/entity/mobdata';

export abstract class Animal extends Mob {
  readonly category: MobCategory = 'creature';
  readonly trackRange = 160;
  /** AgeableMob age: < 0 baby (−24000 at birth), > 0 breeding cooldown */
  ageTicks = 0;
  inLove = 0;
  loveCause: ServerPlayer | null = null;
  abstract readonly adultWidth: number;
  abstract readonly adultHeight: number;
  /** vanilla breeding items */
  abstract readonly food: Set<string>;

  constructor(id: number, s: Mob['s']) {
    super(id, s);
    this.setMalus(PathType.DANGER_FIRE, 16);
    this.setMalus(PathType.DAMAGE_FIRE, -1);
  }

  get width(): number {
    return this.isBaby() ? this.adultWidth * 0.5 : this.adultWidth;
  }
  get height(): number {
    return this.isBaby() ? this.adultHeight * 0.5 : this.adultHeight;
  }
  override isBaby(): boolean {
    return this.ageTicks < 0;
  }
  setAge(a: number): void {
    const wasBaby = this.isBaby();
    this.ageTicks = a;
    if (wasBaby !== this.isBaby()) this.flagsDirty = true;
  }
  /** AgeableMob.ageUp */
  ageUp(seconds: number): void {
    let a = this.ageTicks;
    a += seconds * 20;
    if (a > 0) a = 0;
    this.setAge(a);
  }
  isFood(item: ItemStack | null): boolean {
    return !!item && this.food.has(itemName(item.id));
  }
  canFallInLove(): boolean {
    return this.inLove <= 0;
  }
  isInLove(): boolean {
    return this.inLove > 0;
  }
  setInLove(p: ServerPlayer | null): void {
    this.inLove = 600;
    this.loveCause = p;
    this.entityEvent(ENTITY_EVENT.IN_LOVE_HEARTS);
    this.flagsDirty = true;
  }
  resetLove(): void {
    if (this.inLove > 0) this.flagsDirty = true;
    this.inLove = 0;
  }
  override mobFlags(): number {
    return super.mobFlags() | (this.inLove > 0 ? MOB_FLAG.IN_LOVE : 0);
  }
  canMate(o: Animal): boolean {
    return o !== this && o.type === this.type && this.isInLove() && o.isInLove();
  }
  override walkTargetValue(x: number, y: number, z: number): number {
    return blockNameOf(this.world.getState(x, y - 1, z)) === 'grass_block' ? 10 : brightnessOf(this.rawBrightness(x, y, z)) - 0.5;
  }
  override removeWhenFarAway(): boolean {
    return false;
  }
  override experienceReward(): number {
    return this.isBaby() ? 0 : 1 + this.rng.nextInt(3);
  }
  override hurt(src: DamageSource, amount: number, attacker: Mob['target'] = null): boolean {
    const ok = super.hurt(src, amount, attacker);
    if (ok) this.resetLove();
    return ok;
  }
  protected override aiStep(): void {
    // AgeableMob.aiStep
    if (!this.dead) {
      if (this.ageTicks < 0) this.setAge(this.ageTicks + 1);
      else if (this.ageTicks > 0) this.setAge(this.ageTicks - 1);
    }
    super.aiStep();
    // Animal.aiStep
    if (this.ageTicks !== 0) this.resetLove();
    if (this.inLove > 0) {
      this.inLove--;
      if (this.inLove === 0) this.flagsDirty = true;
    }
  }
  /** Animal.mobInteract: feed to breed or to speed up a baby's growth */
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (this.isFood(held)) {
      if (!this.isBaby() && this.ageTicks === 0 && this.canFallInLove()) {
        this.s.mobs.usePlayerItem(p, slot);
        this.setInLove(p);
        return true;
      }
      if (this.isBaby()) {
        this.s.mobs.usePlayerItem(p, slot);
        this.ageUp(Math.floor((-this.ageTicks / 20) * 0.1));
        return true;
      }
    }
    return false;
  }
  /** Animal.spawnChildFromBreeding */
  breedWith(partner: Animal): void {
    const baby = this.s.mobs.spawn(this.type, this.x, this.y, this.z, 'breeding') as Animal | null;
    if (!baby) return;
    baby.setAge(-24000);
    baby.persistenceRequired = true;
    this.inheritTo(baby, partner);
    this.setAge(6000);
    partner.setAge(6000);
    this.resetLove();
    partner.resetLove();
    this.entityEvent(ENTITY_EVENT.IN_LOVE_HEARTS);
    if (this.s.mobs.doMobLoot) this.s.spawnExperience(this.x, this.y, this.z, this.rng.nextInt(7) + 1);
  }
  protected inheritTo(_baby: Animal, _partner: Animal): void {}
  protected baseGoals(panic: number, tempt: number, follow: number, temptItems: Set<string>): void {
    this.goalSelector.add(0, new FloatGoal(this));
    this.goalSelector.add(1, new PanicGoal(this, panic));
    this.goalSelector.add(2, new BreedGoal(this, 1));
    this.goalSelector.add(3, new TemptGoal(this, tempt, temptItems));
    this.goalSelector.add(4, new FollowParentGoal(this, follow));
    this.goalSelector.add(6, new RandomStrollGoal(this, 1));
    this.goalSelector.add(7, new LookAtPlayerGoal(this, 6));
    this.goalSelector.add(8, new RandomLookAroundGoal(this));
  }
  /** AgeableMob.finalizeSpawn: 5% babies, never the first of a group */
  finalizeSpawn(groupIndex: number): void {
    if (groupIndex > 0 && this.rng.nextFloat() <= 0.05) this.setAge(-24000);
  }
}

/** BreedGoal: walk to a partner in love within 8 blocks; breed after 60 ticks within 3 blocks. */
export class BreedGoal extends Goal {
  private partner: Animal | null = null;
  private loveTime = 0;
  constructor(private readonly a: Animal, private readonly speed: number) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK;
  }
  canUse(): boolean {
    if (!this.a.isInLove()) return false;
    this.partner = this.freePartner();
    return this.partner !== null;
  }
  override canContinueToUse(): boolean {
    const p = this.partner;
    return !!p && !p.dead && p.isInLove() && this.loveTime < 60;
  }
  override stop(): void {
    this.partner = null;
    this.loveTime = 0;
  }
  override tick(): void {
    const a = this.a, p = this.partner!;
    a.lookControl.setLookAtEntity(p, 10, 40);
    a.navigation.moveToEntity(p, this.speed);
    this.loveTime++;
    if (this.loveTime >= 60 && a.distanceToTargetSqr(p) < 9) a.breedWith(p);
  }
  private freePartner(): Animal | null {
    const a = this.a;
    let best: Animal | null = null, bd = Infinity;
    for (const o of a.s.mobs.nearbyMobs(a.x, a.z, 8)) {
      if (!(o instanceof Animal) || !a.canMate(o) || Math.abs(o.y - a.y) > 8) continue;
      const d = a.distanceToTargetSqr(o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
}

/** FollowParentGoal: babies follow the nearest adult of their kind (3–16 blocks). */
export class FollowParentGoal extends Goal {
  private parent: Animal | null = null;
  private timeToRecalc = 0;
  constructor(private readonly a: Animal, private readonly speed: number) {
    super();
  }
  canUse(): boolean {
    const a = this.a;
    if (a.ageTicks >= 0) return false;
    let best: Animal | null = null, bd = Infinity;
    for (const o of a.s.mobs.nearbyMobs(a.x, a.z, 8)) {
      if (!(o instanceof Animal) || o.type !== a.type || o.ageTicks < 0 || Math.abs(o.y - a.y) > 4) continue;
      const d = a.distanceToTargetSqr(o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best || bd < 9) return false;
    this.parent = best;
    return true;
  }
  override canContinueToUse(): boolean {
    const a = this.a, p = this.parent;
    if (a.ageTicks >= 0 || !p || p.dead) return false;
    const d = a.distanceToTargetSqr(p);
    return d >= 9 && d <= 256;
  }
  override start(): void {
    this.timeToRecalc = 0;
  }
  override stop(): void {
    this.parent = null;
  }
  override tick(): void {
    if (--this.timeToRecalc <= 0) {
      this.timeToRecalc = 10;
      this.a.navigation.moveToEntity(this.parent!, this.speed);
    }
  }
}

const set = (...a: string[]) => new Set(a);

export class Pig extends Animal {
  readonly type = 'pig';
  readonly maxHealth = 10;
  readonly adultWidth = 0.9;
  readonly adultHeight = 0.9;
  override movementSpeed = 0.25;
  saddled = false;
  readonly food = set('carrot', 'potato', 'beetroot');
  protected registerGoals(): void {
    this.baseGoals(1.25, 1.2, 1.1, set('carrot_on_a_stick', 'carrot', 'potato', 'beetroot'));
  }
  override mobFlags(): number {
    return super.mobFlags() | (this.saddled ? MOB_FLAG.SADDLED : 0);
  }
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (held && itemName(held.id) === 'saddle' && !this.saddled && !this.isBaby() && !this.dead) {
      this.saddled = true;
      this.flagsDirty = true;
      this.playSound('entity.pig.saddle', 0.5, 1);
      this.s.mobs.usePlayerItem(p, slot);
      return true;
    }
    return super.interact(p, hand);
  }
  override ambientSound(): string {
    return 'entity.pig.ambient';
  }
  override hurtSound(): string {
    return 'entity.pig.hurt';
  }
  override deathSound(): string {
    return 'entity.pig.death';
  }
  override stepSound(): string {
    return 'entity.pig.step';
  }
}

export class Cow extends Animal {
  readonly type = 'cow';
  readonly maxHealth = 10;
  readonly adultWidth = 0.9;
  readonly adultHeight = 1.4;
  override movementSpeed = 0.2;
  readonly food = set('wheat');
  override get eyeHeight(): number {
    return this.isBaby() ? this.height * 0.95 : 1.3;
  }
  protected registerGoals(): void {
    this.baseGoals(2, 1.25, 1.25, this.food);
  }
  /** Cow.mobInteract: milk with a bucket */
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (held && itemName(held.id) === 'bucket' && !this.isBaby()) {
      this.s.playSound(null, 'entity.cow.milk', 'player', this.x, this.y, this.z, 1, 1);
      this.s.mobs.fillContainer(p, slot, stack('milk_bucket'));
      return true;
    }
    return super.interact(p, hand);
  }
  override ambientSound(): string {
    return 'entity.cow.ambient';
  }
  override hurtSound(): string {
    return 'entity.cow.hurt';
  }
  override deathSound(): string {
    return 'entity.cow.death';
  }
  override stepSound(): string {
    return 'entity.cow.step';
  }
  override soundVolume(): number {
    return 0.4;
  }
}

/** EatBlockGoal: 1/1000 per tick (1/50 for babies) eat the grass at the feet or the grass block below. */
class EatBlockGoal extends Goal {
  eatAnimationTick = 0;
  constructor(private readonly sheep: Sheep) {
    super();
    this.flags = Flag.MOVE | Flag.LOOK | Flag.JUMP;
  }
  canUse(): boolean {
    const m = this.sheep;
    if (m.rng.nextInt(m.isBaby() ? 50 : 1000) !== 0) return false;
    const x = Math.floor(m.x), y = Math.floor(m.y), z = Math.floor(m.z);
    return blockNameOf(m.world.getState(x, y, z)) === 'grass' || blockNameOf(m.world.getState(x, y - 1, z)) === 'grass_block';
  }
  override start(): void {
    this.eatAnimationTick = 40;
    this.sheep.entityEvent(ENTITY_EVENT.EAT_GRASS);
    this.sheep.navigation.stop();
  }
  override stop(): void {
    this.eatAnimationTick = 0;
  }
  override canContinueToUse(): boolean {
    return this.eatAnimationTick > 0;
  }
  override tick(): void {
    this.eatAnimationTick = Math.max(0, this.eatAnimationTick - 1);
    if (this.eatAnimationTick !== 4) return;
    const m = this.sheep, s = m.s;
    const x = Math.floor(m.x), y = Math.floor(m.y), z = Math.floor(m.z);
    if (blockNameOf(m.world.getState(x, y, z)) === 'grass') {
      if (s.mobs.mobGriefing) s.destroyBlock(x, y, z, null, false);
      m.ate();
    } else if (blockNameOf(m.world.getState(x, y - 1, z)) === 'grass_block') {
      if (s.mobs.mobGriefing) {
        const st = m.world.getState(x, y - 1, z);
        for (const o of s.players) s.send(o, { t: 'levelEvent', event: 2001, x, y: y - 1, z, data: st });
        s.setBlock(x, y - 1, z, BLOCKS_BY_NAME.get('dirt')!.defaultState);
      }
      m.ate();
    }
  }
}

/** Dye mixing for lamb colours (the two-dye crafting recipes). */
const DYE_MIX: Record<string, string> = {
  'black+white': 'gray', 'gray+white': 'light_gray', 'red+yellow': 'orange', 'pink+purple': 'magenta', 'blue+white': 'light_blue',
  'green+white': 'lime', 'red+white': 'pink', 'blue+green': 'cyan', 'blue+red': 'purple',
};

export class Sheep extends Animal {
  readonly type = 'sheep';
  readonly maxHealth = 8;
  readonly adultWidth = 0.9;
  readonly adultHeight = 1.3;
  override movementSpeed = 0.23;
  color = 0;
  sheared = false;
  readonly food = set('wheat');
  private eatGoal!: EatBlockGoal;
  override get eyeHeight(): number {
    return this.height * 0.95;
  }
  protected registerGoals(): void {
    this.goalSelector.add(0, new FloatGoal(this));
    this.goalSelector.add(1, new PanicGoal(this, 1.25));
    this.goalSelector.add(2, new BreedGoal(this, 1));
    this.goalSelector.add(3, new TemptGoal(this, 1.1, this.food));
    this.goalSelector.add(4, new FollowParentGoal(this, 1.1));
    this.eatGoal = new EatBlockGoal(this);
    this.goalSelector.add(5, this.eatGoal);
    this.goalSelector.add(6, new RandomStrollGoal(this, 1));
    this.goalSelector.add(7, new LookAtPlayerGoal(this, 6));
    this.goalSelector.add(8, new RandomLookAroundGoal(this));
  }
  override mobFlags(): number {
    return super.mobFlags() | (this.sheared ? MOB_FLAG.SHEARED : 0);
  }
  override variant(): number {
    return this.color;
  }
  /** Sheep.getRandomSheepColor */
  static randomColor(r: { nextInt(n: number): number }): number {
    const i = r.nextInt(100);
    if (i < 5) return 15;
    if (i < 10) return 7;
    if (i < 15) return 8;
    if (i < 18) return 12;
    return r.nextInt(500) === 0 ? 6 : 0;
  }
  override finalizeSpawn(groupIndex: number): void {
    this.color = Sheep.randomColor(this.rng);
    super.finalizeSpawn(groupIndex);
  }
  protected override inheritTo(baby: Animal, partner: Animal): void {
    const a = DYE_COLORS[this.color]!, b = DYE_COLORS[(partner as Sheep).color]!;
    const mix = a === b ? a : DYE_MIX[[a, b].sort().join('+')];
    (baby as Sheep).color = mix ? DYE_COLORS.indexOf(mix as (typeof DYE_COLORS)[number]) : (this.rng.nextBoolean() ? this.color : (partner as Sheep).color);
  }
  /** Sheep.ate: wool regrows; lambs grow 60 s faster */
  ate(): void {
    if (this.sheared) {
      this.sheared = false;
      this.flagsDirty = true;
    }
    if (this.isBaby()) this.ageUp(60);
  }
  override interact(p: ServerPlayer, hand: number): boolean {
    const slot = hand === 1 ? 40 : p.inventory.selected;
    const held = p.inventory.get(slot);
    if (held && itemName(held.id) === 'shears') {
      if (this.dead || this.sheared || this.isBaby()) return false;
      this.shear();
      this.s.mobs.damageHeldItem(p, slot, 1);
      return true;
    }
    return super.interact(p, hand);
  }
  /** Sheep.shear: 1–3 wool, flung randomly */
  shear(): void {
    this.s.playSound(null, 'entity.sheep.shear', 'player', this.x, this.y, this.z, 1, 1);
    this.sheared = true;
    this.flagsDirty = true;
    const n = 1 + this.rng.nextInt(3);
    const wool = `${DYE_COLORS[this.color]}_wool`;
    for (let i = 0; i < n; i++) {
      const e = this.s.mobs.spawnAtLocation(this, stack(wool), 1);
      if (e) {
        const r = this.rng;
        e.vx += (r.nextFloat() - r.nextFloat()) * 0.1;
        e.vy += r.nextFloat() * 0.05;
        e.vz += (r.nextFloat() - r.nextFloat()) * 0.1;
      }
    }
  }
  override ambientSound(): string {
    return 'entity.sheep.ambient';
  }
  override hurtSound(): string {
    return 'entity.sheep.hurt';
  }
  override deathSound(): string {
    return 'entity.sheep.death';
  }
  override stepSound(): string {
    return 'entity.sheep.step';
  }
}

export class Chicken extends Animal {
  readonly type = 'chicken';
  readonly maxHealth = 4;
  readonly adultWidth = 0.4;
  readonly adultHeight = 0.7;
  override movementSpeed = 0.25;
  eggTime = 0;
  readonly food = set('wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds');
  override get eyeHeight(): number {
    return this.isBaby() ? this.height * 0.85 : this.height * 0.92;
  }
  override init(): void {
    super.init();
    this.eggTime = this.rng.nextInt(6000) + 6000;
  }
  protected registerGoals(): void {
    this.baseGoals(1.4, 1, 1.1, this.food);
  }
  /** Chicken.aiStep: flapping slows the fall; lay an egg every 6000–12000 ticks */
  protected override aiStep(): void {
    super.aiStep();
    if (!this.dead && !this.isBaby() && --this.eggTime <= 0) {
      const r = this.rng;
      this.playSound('entity.chicken.egg', 1, (r.nextFloat() - r.nextFloat()) * 0.2 + 1);
      this.s.mobs.spawnAtLocation(this, stack('egg'), 0);
      this.eggTime = r.nextInt(6000) + 6000;
    }
  }
  protected override afterTravel(): void {
    if (!this.onGround && this.vy < 0) this.vy *= 0.6;
  }
  protected override causeFallDamage(): void {}
  override ambientSound(): string {
    return 'entity.chicken.ambient';
  }
  override hurtSound(): string {
    return 'entity.chicken.hurt';
  }
  override deathSound(): string {
    return 'entity.chicken.death';
  }
  override stepSound(): string {
    return 'entity.chicken.step';
  }
}
