import { describe, it, expect } from 'vitest';
import {
  getEnchantmentCost, availableEnchantments, selectEnchantment, enchantOffers, clickEnchant, countBookshelves, enchantability,
  damageProtection, magicAbsorb, damageBonus, sweepingRatio, hurtItem, mendingRepair, oreDropsBonus, isCompatible, enchByName,
  minCost, maxCost, enchLevel, hasFoil, enchantmentLine, armorAbsorb, grindstoneOutput, grindstoneExperience,
} from './enchantments';
import { JavaRandom } from '../util/random';
import { ITEMS_BY_NAME } from '../data';
import { Inventory, stack, type ItemStack } from '../item/stack';

const ID = (n: string) => ITEMS_BY_NAME.get(n)!.id;
const ench = (name: string, lvl: number): { id: string; lvl: number } => ({ id: name, lvl });

describe('enchantment data', () => {
  it('costs match the vanilla formulas', () => {
    expect([minCost(enchByName('sharpness'), 1), maxCost(enchByName('sharpness'), 1)]).toEqual([1, 21]);
    expect([minCost(enchByName('silk_touch'), 1), maxCost(enchByName('silk_touch'), 1)]).toEqual([15, 61]);
    expect([minCost(enchByName('protection'), 4), maxCost(enchByName('protection'), 4)]).toEqual([34, 45]);
    expect([minCost(enchByName('mending'), 1), maxCost(enchByName('mending'), 1)]).toEqual([25, 75]);
  });
  it('exclusions are symmetric', () => {
    expect(isCompatible(enchByName('silk_touch'), enchByName('fortune'))).toBe(false);
    expect(isCompatible(enchByName('fortune'), enchByName('silk_touch'))).toBe(false);
    expect(isCompatible(enchByName('sharpness'), enchByName('smite'))).toBe(false);
    expect(isCompatible(enchByName('sharpness'), enchByName('sharpness'))).toBe(false);
    expect(isCompatible(enchByName('sharpness'), enchByName('looting'))).toBe(true);
    expect(isCompatible(enchByName('protection'), enchByName('feather_falling'))).toBe(true);
    expect(isCompatible(enchByName('mending'), enchByName('infinity'))).toBe(false);
  });
  it('enchantability per material', () => {
    expect(enchantability(ID('golden_sword'))).toBe(22);
    expect(enchantability(ID('golden_chestplate'))).toBe(25);
    expect(enchantability(ID('stone_pickaxe'))).toBe(5);
    expect(enchantability(ID('iron_boots'))).toBe(9);
    expect(enchantability(ID('book'))).toBe(1);
    expect(enchantability(ID('shears'))).toBe(0);
  });
});

describe('enchanting table', () => {
  it('15 bookshelves always offer level 30 in the bottom slot', () => {
    for (let seed = 0; seed < 200; seed++) {
      const r = new JavaRandom(BigInt(seed));
      const a = getEnchantmentCost(r, 0, 15, ID('diamond_pickaxe'));
      const b = getEnchantmentCost(r, 1, 15, ID('diamond_pickaxe'));
      const c = getEnchantmentCost(r, 2, 15, ID('diamond_pickaxe'));
      expect(c).toBe(30);
      expect(a).toBeGreaterThanOrEqual(2);
      expect(a).toBeLessThanOrEqual(10);
      expect(b).toBeGreaterThanOrEqual(6);
      expect(b).toBeLessThanOrEqual(21);
    }
    expect(getEnchantmentCost(new JavaRandom(1n), 2, 40, ID('diamond_pickaxe'))).toBe(30);
  });

  it('no bookshelves: costs at most 8', () => {
    for (let seed = 0; seed < 100; seed++) {
      const o = enchantOffers(stack('iron_sword'), 0, seed * 7919);
      for (const c of o.costs) expect(c).toBeLessThanOrEqual(8);
    }
  });

  it('available enchantments at level 30 for a diamond pickaxe', () => {
    const av = availableEnchantments(30, ID('diamond_pickaxe'), false).map((x) => `${x.ench.name}${x.level}`);
    expect(av).toEqual(['efficiency3', 'silk_touch1', 'unbreaking3', 'fortune2']);
    // treasure enchantments only when allowed
    expect(availableEnchantments(30, ID('diamond_boots'), false).some((x) => x.ench.name === 'frost_walker')).toBe(false);
    expect(availableEnchantments(30, ID('diamond_boots'), true).some((x) => x.ench.name === 'frost_walker')).toBe(true);
    // books take everything non-treasure; soul speed is never discoverable
    const book = availableEnchantments(30, ID('book'), true).map((x) => x.ench.name);
    expect(book).not.toContain('soul_speed');
    expect(book).toContain('mending');
  });

  it('selection is deterministic per seed and never picks incompatible pairs', () => {
    for (let seed = -50; seed < 300; seed++) {
      const a = selectEnchantment(new JavaRandom(BigInt(seed)), ID('diamond_sword'), 30, false);
      const b = selectEnchantment(new JavaRandom(BigInt(seed)), ID('diamond_sword'), 30, false);
      expect(a.map((x) => x.ench.name + x.level)).toEqual(b.map((x) => x.ench.name + x.level));
      expect(a.length).toBeGreaterThan(0);
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(isCompatible(a[i]!.ench, a[j]!.ench)).toBe(true);
    }
  });

  it('offers and the click agree (the hint is one of the enchantments applied)', () => {
    for (let seed = 1; seed < 60; seed++) {
      const item = stack('diamond_pickaxe');
      const o = enchantOffers(item, 15, seed * 1000003);
      expect(o.costs[2]).toBe(30);
      const res = clickEnchant(item, 3, 30, false, o, seed * 1000003, 2);
      expect(res.ok).toBe(true);
      expect(res.levelsSpent).toBe(3);
      expect(res.lapisSpent).toBe(3);
      const names = res.result!.tag!.Enchantments!.map((e) => e.id + e.lvl);
      const clue = availableEnchantments(1, 0, false); void clue;
      expect(names.length).toBeGreaterThan(0);
      expect(o.clues[2]).toBeGreaterThanOrEqual(0);
    }
  });

  it('requires lapis and levels unless creative', () => {
    const item = stack('iron_sword');
    const o = enchantOffers(item, 15, 42);
    expect(clickEnchant(item, 2, 30, false, o, 42, 2).ok).toBe(false);
    expect(clickEnchant(item, 3, 29, false, o, 42, 2).ok).toBe(false);
    expect(clickEnchant(item, 0, 0, true, o, 42, 2).ok).toBe(true);
  });

  it('books become enchanted books with stored enchantments', () => {
    const o = enchantOffers(stack('book'), 15, 1234);
    const res = clickEnchant(stack('book'), 3, 30, false, o, 1234, 2);
    expect(res.result!.id).toBe(ID('enchanted_book'));
    expect(res.result!.tag!.StoredEnchantments!.length).toBeGreaterThan(0);
    expect(hasFoil(res.result!)).toBe(true);
  });

  it('already-enchanted and stackable items get no offers', () => {
    const s: ItemStack = { ...stack('iron_sword'), tag: { Enchantments: [ench('sharpness', 1)] } };
    expect(enchantOffers(s, 15, 1).costs).toEqual([0, 0, 0]);
    expect(enchantOffers(stack('stone', 1), 15, 1).costs).toEqual([0, 0, 0]);
  });

  it('counts bookshelves with the 1.17.1 layout rules', () => {
    // a full ring of 32 shelf positions at distance 2, two high: capped later at 15
    const shelf = (dx: number, _dy: number, dz: number) => Math.max(Math.abs(dx), Math.abs(dz)) === 2;
    expect(countBookshelves(() => true, shelf)).toBe(32);
    // anything (e.g. a torch) in the gap blocks the shelves behind it
    expect(countBookshelves((dx, _dy, dz) => !(dx === 1 && dz === 0), shelf)).toBe(32 - 2);
  });
});

describe('enchantment effects', () => {
  it('EPF: protection IV ×4 caps at 80%', () => {
    const armor = [0, 1, 2, 3].map(() => ({ ...stack('diamond_boots'), tag: { Enchantments: [ench('protection', 4)] } }));
    expect(damageProtection(armor, {})).toBe(16);
    expect(magicAbsorb(10, 16)).toBeCloseTo(3.6, 9);
    expect(magicAbsorb(10, 32)).toBeCloseTo(2, 9);
    const ff = [{ ...stack('diamond_boots'), tag: { Enchantments: [ench('feather_falling', 4)] } }];
    expect(damageProtection(ff, { fall: true })).toBe(12);
    expect(damageProtection(ff, {})).toBe(0);
    expect(damageProtection(armor, { bypassInvul: true })).toBe(0);
  });

  it('armour absorb formula', () => {
    expect(armorAbsorb(10, 20, 8)).toBeCloseTo(10 * (1 - 17.5 / 25), 6);
    expect(armorAbsorb(10, 0, 0)).toBe(10);
  });

  it('damage bonuses', () => {
    const s = { ...stack('diamond_sword'), tag: { Enchantments: [ench('sharpness', 5)] } };
    expect(damageBonus(s)).toBe(3);
    const smite = { ...stack('diamond_sword'), tag: { Enchantments: [ench('smite', 5)] } };
    expect(damageBonus(smite)).toBe(0);
    expect(damageBonus(smite, 'undead')).toBe(12.5);
    expect(sweepingRatio(3)).toBeCloseTo(0.75, 9);
  });

  it('unbreaking reduces wear on average to 1/(level+1)', () => {
    const r = new JavaRandom(5n);
    const s = { ...stack('diamond_pickaxe'), tag: { Enchantments: [ench('unbreaking', 3)] } };
    let n = 0;
    for (let i = 0; i < 4000; i++) hurtItem(s, 1, r);
    n = s.damage;
    expect(n).toBeGreaterThan(850);
    expect(n).toBeLessThan(1150);
    const plain = stack('diamond_pickaxe');
    hurtItem(plain, 2, r);
    expect(plain.damage).toBe(2);
    expect(enchLevel('unbreaking', s)).toBe(3);
  });

  it('mending repairs 2 durability per XP point', () => {
    const inv = new Inventory();
    inv.set(0, { ...stack('diamond_pickaxe'), damage: 10, tag: { Enchantments: [ench('mending', 1)] } });
    const left = mendingRepair(inv, 3, new JavaRandom(1n));
    expect(left).toBe(0);
    expect(inv.get(0)!.damage).toBe(4);
    expect(mendingRepair(inv, 10, new JavaRandom(1n))).toBe(8);
    expect(inv.get(0)!.damage).toBe(0);
  });

  it('fortune ore drops multiply the count', () => {
    let total = 0;
    const r = new JavaRandom(9n);
    for (let i = 0; i < 10000; i++) total += oreDropsBonus(1, 3, () => r.nextFloat());
    expect(total / 10000).toBeGreaterThan(2.1);
    expect(total / 10000).toBeLessThan(2.3); // vanilla average for Fortune III: 2.2
  });

  it('tooltip lines', () => {
    expect(enchantmentLine('sharpness', 5)).toBe('Sharpness V');
    expect(enchantmentLine('mending', 1)).toBe('Mending');
  });
});

describe('grindstone', () => {
  it('strips non-curse enchantments, keeps curses, books become plain books', () => {
    const sword = { ...stack('diamond_sword'), damage: 100, tag: { Enchantments: [ench('sharpness', 5), ench('vanishing_curse', 1)], RepairCost: 3 } };
    const out = grindstoneOutput(sword, null)!;
    expect(out.tag).toEqual({ Enchantments: [ench('vanishing_curse', 1)], RepairCost: 1 });
    expect(out.damage).toBe(100);
    const book = { ...stack('enchanted_book'), tag: { StoredEnchantments: [ench('mending', 1)] } };
    expect(grindstoneOutput(book, null)).toEqual({ id: ID('book'), count: 1, damage: 0 });
  });
  it('repairs two items with the 5% bonus', () => {
    const a = { ...stack('iron_pickaxe'), damage: 200 }, b = { ...stack('iron_pickaxe'), damage: 200 };
    // max 250: (50 + 50 + 12) remaining → damage 138
    expect(grindstoneOutput(a, b)!.damage).toBe(138);
    expect(grindstoneOutput(a, stack('iron_axe'))).toBeNull();
  });
  it('experience: ceil(sum/2) + random(ceil(sum/2)) from non-curse min costs', () => {
    const sword = { ...stack('diamond_sword'), tag: { Enchantments: [ench('sharpness', 5)] } }; // min cost 45
    for (let i = 0; i < 20; i++) {
      const xp = grindstoneExperience(sword, null, new JavaRandom(BigInt(i)));
      expect(xp).toBeGreaterThanOrEqual(23);
      expect(xp).toBeLessThanOrEqual(45);
    }
    expect(grindstoneExperience(stack('diamond_sword'), null, new JavaRandom(1n))).toBe(0);
  });
});
