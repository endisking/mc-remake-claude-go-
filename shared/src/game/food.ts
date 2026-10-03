/**
 * Hunger (vanilla FoodData): food level, saturation and exhaustion, natural regeneration and
 * starvation. Exhaustion values per action are the vanilla constants below.
 */

export const Difficulty = { Peaceful: 0, Easy: 1, Normal: 2, Hard: 3 } as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

/** Exhaustion added per action (Player.causeFoodExhaustion call sites, 1.17). */
export const EXHAUSTION = {
  /** per metre (×0.01 per cm in vanilla) */
  swim: 0.01,
  sprint: 0.1,
  jump: 0.05,
  sprintJump: 0.2,
  breakBlock: 0.005,
  attack: 0.1,
  /** default damage-source exhaustion (0 for sources that bypass armour) */
  damage: 0.1,
  regen: 6,
} as const;

export interface FoodOwner {
  health: number;
  maxHealth: number;
  heal(amount: number): void;
  /** starvation damage */
  starve(amount: number): void;
}

export class FoodData {
  foodLevel = 20;
  saturationLevel = 5;
  exhaustionLevel = 0;
  tickTimer = 0;
  lastFoodLevel = 20;

  eat(food: number, saturationModifier: number): void {
    this.foodLevel = Math.min(food + this.foodLevel, 20);
    this.saturationLevel = Math.min(this.saturationLevel + food * saturationModifier * 2, this.foodLevel);
  }

  addExhaustion(amount: number): void {
    this.exhaustionLevel = Math.min(this.exhaustionLevel + amount, 40);
  }

  needsFood(): boolean {
    return this.foodLevel < 20;
  }

  tick(owner: FoodOwner, difficulty: Difficulty, naturalRegeneration = true): void {
    this.lastFoodLevel = this.foodLevel;
    if (this.exhaustionLevel > 4) {
      this.exhaustionLevel -= 4;
      if (this.saturationLevel > 0) this.saturationLevel = Math.max(this.saturationLevel - 1, 0);
      else if (difficulty !== Difficulty.Peaceful) this.foodLevel = Math.max(this.foodLevel - 1, 0);
    }
    const hurt = owner.health > 0 && owner.health < owner.maxHealth;
    if (naturalRegeneration && this.saturationLevel > 0 && hurt && this.foodLevel >= 20) {
      // saturation boost: fast regen every 10 ticks, costing the healed amount ×6 in exhaustion
      if (++this.tickTimer >= 10) {
        const f = Math.min(this.saturationLevel, 6);
        owner.heal(f / 6);
        this.addExhaustion(f);
        this.tickTimer = 0;
      }
    } else if (naturalRegeneration && this.foodLevel >= 18 && hurt) {
      if (++this.tickTimer >= 80) {
        owner.heal(1);
        this.addExhaustion(EXHAUSTION.regen);
        this.tickTimer = 0;
      }
    } else if (this.foodLevel <= 0) {
      if (++this.tickTimer >= 80) {
        if (owner.health > 10 || difficulty === Difficulty.Hard || (owner.health > 1 && difficulty === Difficulty.Normal)) owner.starve(1);
        this.tickTimer = 0;
      }
    } else {
      this.tickTimer = 0;
    }
  }
}
