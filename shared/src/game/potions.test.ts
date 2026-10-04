import { describe, it, expect } from 'vitest';
import { brew, hasMix, isIngredient, potionStack, potionOf, potionColor, potionName, tickBrewingStand, newBrewingStand, isBrewable } from './potions';
import { stack } from '../item/stack';

describe('brewing', () => {
  it('nether wart turns water into awkward potions; awkward + sugar → swiftness; redstone/glowstone upgrade', () => {
    const water = potionStack('potion', 'water');
    expect(hasMix(water, stack('nether_wart'))).toBe(true);
    const awkward = brew(stack('nether_wart'), water)!;
    expect(potionOf(awkward)).toBe('awkward');
    expect(potionOf(brew(stack('sugar'), awkward))).toBe('swiftness');
    expect(potionOf(brew(stack('redstone'), potionStack('potion', 'swiftness')))).toBe('long_swiftness');
    expect(potionOf(brew(stack('glowstone_dust'), potionStack('potion', 'swiftness')))).toBe('strong_swiftness');
    expect(potionOf(brew(stack('fermented_spider_eye'), potionStack('potion', 'healing')))).toBe('harming');
    expect(hasMix(potionStack('potion', 'long_swiftness'), stack('glowstone_dust'))).toBe(false);
  });

  it('gunpowder makes splash potions and dragon breath lingering ones (keeping the potion)', () => {
    const s = brew(stack('gunpowder'), potionStack('potion', 'healing'))!;
    expect(s.id).toBe(stack('splash_potion').id);
    expect(potionOf(s)).toBe('healing');
    const l = brew(stack('dragon_breath'), s)!;
    expect(l.id).toBe(stack('lingering_potion').id);
    expect(isIngredient(stack('stone'))).toBe(false);
  });

  it('colours and names', () => {
    expect(potionColor(potionStack('potion', 'water'))).toBe(3694022);
    expect(potionColor(potionStack('potion', 'swiftness'))).toBe(8171462);
    expect(potionName(potionStack('potion', 'water'))).toBe('Water Bottle');
    expect(potionName(potionStack('splash_potion', 'strong_healing'))).toBe('Splash Potion of Healing');
    expect(potionName(potionStack('potion', 'turtle_master'))).toBe('Potion of the Turtle Master');
  });

  it('the brewing stand takes 400 ticks and 1 of 20 blaze powder charges', () => {
    const b = newBrewingStand();
    b.items[0] = potionStack('potion', 'water');
    b.items[2] = potionStack('potion', 'water');
    b.items[3] = stack('nether_wart', 2);
    b.items[4] = stack('blaze_powder', 1);
    expect(isBrewable(b.items)).toBe(true);
    tickBrewingStand(b);
    expect(b.items[4]).toBeNull();
    expect(b.fuel).toBe(19);
    expect(b.brewTime).toBe(400);
    let brewed = 0;
    for (let i = 0; i < 400; i++) if (tickBrewingStand(b).brewed) brewed = i + 1;
    expect(brewed).toBe(400);
    expect(potionOf(b.items[0])).toBe('awkward');
    expect(potionOf(b.items[2])).toBe('awkward');
    expect(b.items[3]!.count).toBe(1);
    // the next brew needs a matching ingredient: awkward + nether wart has no mix
    tickBrewingStand(b);
    expect(b.brewTime).toBe(0);
  });

  it('removing the ingredient cancels the brew', () => {
    const b = newBrewingStand();
    b.items[0] = potionStack('potion', 'awkward');
    b.items[3] = stack('sugar', 1);
    b.fuel = 5;
    tickBrewingStand(b);
    expect(b.brewTime).toBe(400);
    b.items[3] = null;
    tickBrewingStand(b);
    expect(b.brewTime).toBe(0);
  });
});
