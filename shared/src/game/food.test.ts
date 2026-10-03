import { describe, it, expect } from 'vitest';
import { FoodData, Difficulty, type FoodOwner } from './food';

function owner(health: number): FoodOwner & { starved: number } {
  return {
    health,
    maxHealth: 20,
    starved: 0,
    heal(a) {
      this.health = Math.min(this.maxHealth, this.health + a);
    },
    starve(a) {
      this.starved += a;
      this.health -= a;
    },
  };
}

describe('FoodData', () => {
  it('exhaustion over 4 drains saturation first, then food', () => {
    const f = new FoodData();
    f.saturationLevel = 1;
    f.addExhaustion(4.5);
    f.tick(owner(20), Difficulty.Normal);
    expect(f.saturationLevel).toBe(0);
    expect(f.foodLevel).toBe(20);
    f.addExhaustion(4.5);
    f.tick(owner(20), Difficulty.Normal);
    expect(f.foodLevel).toBe(19);
    // peaceful never drains food
    const p = new FoodData();
    p.saturationLevel = 0;
    p.addExhaustion(40);
    p.tick(owner(20), Difficulty.Peaceful);
    expect(p.foodLevel).toBe(20);
  });

  it('saturation regen heals every 10 ticks at full food; slow regen every 80 ticks at food >= 18', () => {
    const f = new FoodData();
    const o = owner(10);
    for (let i = 0; i < 10; i++) f.tick(o, Difficulty.Normal);
    expect(o.health).toBeCloseTo(10 + 5 / 6); // min(saturation 5, 6) / 6
    const s = new FoodData();
    s.foodLevel = 18;
    s.saturationLevel = 0;
    const o2 = owner(10);
    for (let i = 0; i < 79; i++) s.tick(o2, Difficulty.Normal);
    expect(o2.health).toBe(10);
    s.tick(o2, Difficulty.Normal);
    expect(o2.health).toBe(11);
    expect(s.exhaustionLevel).toBe(6);
  });

  it('starvation: normal stops at 1 HP, easy at 10, hard kills', () => {
    for (const [d, floor] of [[Difficulty.Easy, 10], [Difficulty.Normal, 1], [Difficulty.Hard, 0]] as const) {
      const f = new FoodData();
      f.foodLevel = 0;
      f.saturationLevel = 0;
      const o = owner(20);
      for (let i = 0; i < 80 * 25 && o.health > 0; i++) f.tick(o, d);
      expect(o.health).toBe(floor);
    }
  });

  it('eating adds food and saturation capped by the food level', () => {
    const f = new FoodData();
    f.foodLevel = 10;
    f.saturationLevel = 0;
    f.eat(8, 0.8); // steak
    expect(f.foodLevel).toBe(18);
    expect(f.saturationLevel).toBeCloseTo(12.8);
  });
});
