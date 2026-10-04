import { describe, it, expect } from 'vitest';
import { ITEMS_BY_NAME } from '../data';
import { stateOf } from '../world/blockstate';
import { JavaRandom } from '../util/random';
import {
  maxDamage, hurtItem, mineBlockCost, hurtEnemyCost, armorInfo, armorTotals, damageAfterArmor, armorDurabilityLoss,
  damageAfterResistance, foodProps, useDuration, canStartUsing, shouldTriggerUseEffects, bowPower, useRemainder, equipSlotFor,
} from './items';
import { attackDamageOf, attackSpeedOf } from './combat';
import { EffectMap, type EffectTarget } from './effects';
import { stack } from '../item/stack';

const id = (n: string) => ITEMS_BY_NAME.get(n)!.id;

describe('durability', () => {
  it('max durability matches vanilla tiers', () => {
    expect(maxDamage(id('wooden_pickaxe'))).toBe(59);
    expect(maxDamage(id('stone_axe'))).toBe(131);
    expect(maxDamage(id('iron_sword'))).toBe(250);
    expect(maxDamage(id('golden_shovel'))).toBe(32);
    expect(maxDamage(id('diamond_hoe'))).toBe(1561);
    expect(maxDamage(id('netherite_sword'))).toBe(2031);
    expect(maxDamage(id('shears'))).toBe(238);
    expect(maxDamage(id('flint_and_steel'))).toBe(64);
    expect(maxDamage(id('fishing_rod'))).toBe(64);
    expect(maxDamage(id('bow'))).toBe(384);
    expect(maxDamage(id('diamond_chestplate'))).toBe(528);
    expect(maxDamage(id('dirt'))).toBe(0);
  });

  it('block breaking costs: diggers 1, swords 2, instant blocks free, shears 1', () => {
    const stone = stateOf('stone'), grass = stateOf('grass'), dirt = stateOf('dirt');
    expect(mineBlockCost(id('iron_pickaxe'), stone)).toBe(1);
    expect(mineBlockCost(id('iron_pickaxe'), dirt)).toBe(1);
    expect(mineBlockCost(id('iron_sword'), stone)).toBe(2);
    expect(mineBlockCost(id('iron_sword'), grass)).toBe(0);
    expect(mineBlockCost(id('iron_pickaxe'), grass)).toBe(0);
    expect(mineBlockCost(id('shears'), grass)).toBe(1);
    expect(mineBlockCost(id('stick'), stone)).toBe(0);
    expect(mineBlockCost(id('trident'), stone)).toBe(2);
  });

  it('attack costs: swords 1, tools 2', () => {
    expect(hurtEnemyCost(id('diamond_sword'))).toBe(1);
    expect(hurtEnemyCost(id('diamond_axe'))).toBe(2);
    expect(hurtEnemyCost(id('wooden_hoe'))).toBe(2);
    expect(hurtEnemyCost(id('stick'))).toBe(0);
  });

  it('breaks when damage reaches max', () => {
    const s = stack('golden_sword');
    const r = new JavaRandom(1n);
    for (let i = 0; i < 31; i++) expect(hurtItem(s, 1, r)).toBe(false);
    expect(hurtItem(s, 1, r)).toBe(true);
    expect(s.damage).toBe(32);
  });

  it('Unbreaking III ignores about 3/4 of tool damage', () => {
    const s = stack('diamond_pickaxe');
    const r = new JavaRandom(42n);
    for (let i = 0; i < 4000; i++) hurtItem(s, 1, r, 3);
    expect(s.damage).toBeGreaterThan(900);
    expect(s.damage).toBeLessThan(1100);
  });
});

describe('weapon attributes', () => {
  it('attack damage and speed per vanilla', () => {
    expect(attackDamageOf(id('iron_sword'))).toBe(6);
    expect(attackSpeedOf(id('iron_sword'))).toBe(1.6);
    expect(attackDamageOf(id('iron_axe'))).toBe(9);
    expect(attackSpeedOf(id('iron_axe'))).toBe(0.9);
    expect(attackDamageOf(id('netherite_axe'))).toBe(10);
    expect(attackSpeedOf(id('wooden_axe'))).toBe(0.8);
    expect(attackDamageOf(id('diamond_shovel'))).toBe(5.5);
    expect(attackSpeedOf(id('diamond_hoe'))).toBe(4);
  });
});

describe('armour', () => {
  it('material defense and toughness', () => {
    expect(armorInfo(id('diamond_chestplate'))).toMatchObject({ slot: 'chest', defense: 8, toughness: 2 });
    expect(armorInfo(id('iron_helmet'))).toMatchObject({ slot: 'head', defense: 2, toughness: 0 });
    expect(armorInfo(id('netherite_boots'))).toMatchObject({ slot: 'feet', defense: 3, toughness: 3, knockbackResistance: 0.1 });
    expect(armorInfo(id('turtle_helmet'))).toMatchObject({ slot: 'head', defense: 2 });
    expect(equipSlotFor(id('elytra'))).toBe('chest');
    const full = ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots'].map((n) => stack(n));
    expect(armorTotals(full)).toMatchObject({ armor: 20, toughness: 8 });
  });

  it('damage reduction formula (CombatRules.getDamageAfterAbsorb)', () => {
    // full iron (15 points, no toughness) against a 10 damage hit: 15 - 10/2 = 10 → 60%
    expect(damageAfterArmor(10, 15, 0)).toBeCloseTo(6, 5);
    // full diamond (20, toughness 8) vs 20 damage: f = 4, 20 - 5 = 15 → 40%
    expect(damageAfterArmor(20, 20, 8)).toBeCloseTo(8, 5);
    // the 20% floor: armour 5 against a huge hit still reduces by 4%
    expect(damageAfterArmor(100, 5, 0)).toBeCloseTo(96, 5);
    // cap at 80%
    expect(damageAfterArmor(1, 30, 20)).toBeCloseTo(0.2, 5);
    expect(damageAfterArmor(7, 0, 0)).toBe(7);
  });

  it('armour durability loss per hit is max(1, damage/4)', () => {
    expect(armorDurabilityLoss(1)).toBe(1);
    expect(armorDurabilityLoss(7)).toBe(1);
    expect(armorDurabilityLoss(8)).toBe(2);
    expect(armorDurabilityLoss(19)).toBe(4);
    expect(armorDurabilityLoss(0)).toBe(0);
  });

  it('resistance reduces 20% per level', () => {
    expect(damageAfterResistance(10, -1)).toBe(10);
    expect(damageAfterResistance(10, 0)).toBeCloseTo(8, 5);
    expect(damageAfterResistance(10, 4)).toBe(0);
  });
});

describe('food', () => {
  it('nutrition/saturation from minecraft-data', () => {
    expect(foodProps(id('bread'))).toMatchObject({ nutrition: 5, saturationModifier: 0.6 });
    expect(foodProps(id('cooked_beef'))).toMatchObject({ nutrition: 8, saturationModifier: 0.8, meat: true });
    expect(foodProps(id('golden_apple'))!.alwaysEat).toBe(true);
    expect(foodProps(id('stick'))).toBeNull();
  });

  it('eating takes 32 ticks, dried kelp 16, drinks 32/40', () => {
    expect(useDuration(id('bread'))).toBe(32);
    expect(useDuration(id('dried_kelp'))).toBe(16);
    expect(useDuration(id('milk_bucket'))).toBe(32);
    expect(useDuration(id('honey_bottle'))).toBe(40);
    expect(useDuration(id('bow'))).toBe(72000);
  });

  it('only eats when hungry unless always-edible', () => {
    const full = { foodLevel: 20, creative: false, hasArrows: false };
    expect(canStartUsing(id('bread'), full)).toBe(false);
    expect(canStartUsing(id('bread'), { ...full, foodLevel: 19 })).toBe(true);
    expect(canStartUsing(id('golden_apple'), full)).toBe(true);
    expect(canStartUsing(id('chorus_fruit'), full)).toBe(true);
    expect(canStartUsing(id('milk_bucket'), full)).toBe(true);
    expect(canStartUsing(id('bow'), full)).toBe(false);
    expect(canStartUsing(id('bow'), { ...full, hasArrows: true })).toBe(true);
  });

  it('use effects every 4 ticks after the first 7 (kelp from the start)', () => {
    const bread = id('bread');
    const fired = [];
    for (let rem = 31; rem >= 1; rem--) if (shouldTriggerUseEffects(bread, rem)) fired.push(rem);
    expect(fired).toEqual([24, 20, 16, 12, 8, 4]);
    expect(shouldTriggerUseEffects(id('dried_kelp'), 12)).toBe(true);
  });

  it('stews return bowls, milk a bucket', () => {
    expect(useRemainder(id('mushroom_stew'))).toBe('bowl');
    expect(useRemainder(id('milk_bucket'))).toBe('bucket');
    expect(useRemainder(id('bread'))).toBeNull();
  });
});

describe('bow', () => {
  it('BowItem.getPowerForTime', () => {
    expect(bowPower(0)).toBe(0);
    expect(bowPower(20)).toBe(1);
    expect(bowPower(40)).toBe(1);
    expect(bowPower(10)).toBeCloseTo((0.25 + 1) / 3, 6);
    // the release threshold (power < 0.1 doesn't shoot) is crossed at 3 ticks
    expect(bowPower(2)).toBeLessThan(0.1);
    expect(bowPower(3)).toBeGreaterThanOrEqual(0.1);
  });
});

describe('effects', () => {
  function target(health = 10): EffectTarget & { magic: number; ex: number } {
    return {
      health, maxHealth: 20, absorption: 0, magic: 0, ex: 0,
      heal(a) { this.health = Math.min(20, this.health + a); },
      hurtMagic(a) { this.magic += a; this.health -= a; },
      hurtWither(a) { this.health -= a; },
      addExhaustion(a) { this.ex += a; },
      eat() {},
    };
  }

  it('golden apple: regeneration II heals every 25 ticks, absorption 4 hearts', () => {
    const t = target(10);
    const m = new EffectMap();
    m.add('regeneration', 100, 1, t);
    m.add('absorption', 2400, 0, t);
    expect(t.absorption).toBe(4);
    for (let i = 0; i < 100; i++) m.tick(t);
    expect(t.health).toBe(14);
    expect(m.has('regeneration')).toBe(false);
    // re-adding absorption tops it back up
    t.absorption = 1;
    m.add('absorption', 2400, 0, t);
    expect(t.absorption).toBe(4);
    m.clear(t);
    expect(t.absorption).toBe(0);
  });

  it('poison never kills and stronger effects replace weaker ones', () => {
    const t = target(3);
    const m = new EffectMap();
    m.add('poison', 1200, 1, t);
    for (let i = 0; i < 1200; i++) m.tick(t);
    expect(t.health).toBe(1);
    m.add('hunger', 600, 0, t);
    m.add('hunger', 100, 1, t);
    expect(m.get('hunger')).toMatchObject({ amplifier: 1, duration: 100 });
    m.add('hunger', 50, 0, t);
    expect(m.get('hunger')).toMatchObject({ amplifier: 1, duration: 100 });
    m.tick(t);
    expect(t.ex).toBeCloseTo(0.01, 6);
  });
});
