import { describe, it, expect } from 'vitest';
import { anvilResult } from './anvil';
import { stack, type ItemStack } from '../item/stack';

const ench = (s: ItemStack, list: [string, number][], key: 'Enchantments' | 'StoredEnchantments' = 'Enchantments', repairCost?: number): ItemStack => ({
  ...s, tag: { [key]: list.map(([id, lvl]) => ({ id, lvl })), ...(repairCost !== undefined ? { RepairCost: repairCost } : {}) },
});

describe('anvil', () => {
  it('two Sharpness IV swords make Sharpness V for 5 levels, prior work 1', () => {
    const a = ench(stack('diamond_sword'), [['sharpness', 4]]), b = ench(stack('diamond_sword'), [['sharpness', 4]]);
    const r = anvilResult(a, b, null, false);
    expect(r.cost).toBe(5);
    expect(r.result!.tag!.Enchantments).toEqual([{ id: 'sharpness', lvl: 5 }]);
    expect(r.result!.tag!.RepairCost).toBe(1);
  });

  it('books cost half (min 1) per level by rarity; incompatible enchantments are refused', () => {
    const sword = stack('diamond_sword');
    expect(anvilResult(sword, ench(stack('enchanted_book'), [['sharpness', 5]], 'StoredEnchantments'), null, false).cost).toBe(5);
    expect(anvilResult(sword, ench(stack('enchanted_book'), [['mending', 1]], 'StoredEnchantments'), null, false).cost).toBe(2);
    const smite = ench(stack('diamond_sword'), [['smite', 5]]);
    expect(anvilResult(smite, ench(stack('enchanted_book'), [['sharpness', 5]], 'StoredEnchantments'), null, false).result).toBeNull();
    // a pickaxe can't take Sharpness (outside creative)
    expect(anvilResult(stack('diamond_pickaxe'), ench(stack('enchanted_book'), [['sharpness', 1]], 'StoredEnchantments'), null, false).result).toBeNull();
  });

  it('repairs with the material, 25% per item', () => {
    const pick = { ...stack('diamond_pickaxe'), damage: 1000 };
    const r = anvilResult(pick, stack('diamond', 5), null, false);
    expect(r.result!.damage).toBe(1000 - 390 - 390 - 220);
    expect(r.repairItemCount).toBe(3);
    expect(r.cost).toBe(3);
    expect(anvilResult(stack('diamond_pickaxe'), stack('diamond', 1), null, false).result).toBeNull();
  });

  it('renaming costs 1 level and keeps the prior work penalty', () => {
    const s = ench(stack('iron_sword'), [['sharpness', 1]], 'Enchantments', 3);
    const r = anvilResult(s, null, 'Blade', false);
    expect(r.cost).toBe(4);
    expect(r.result!.tag!.display!.Name).toBe('Blade');
    expect(r.result!.tag!.RepairCost).toBe(3);
    expect(anvilResult(s, null, 'Iron Sword', false).result).toBeNull();
  });

  it('too expensive at 40 levels outside creative', () => {
    const a = ench(stack('diamond_sword'), [['sharpness', 4]], 'Enchantments', 39), b = ench(stack('diamond_sword'), [['sharpness', 4]]);
    const r = anvilResult(a, b, null, false);
    expect(r.cost).toBeGreaterThanOrEqual(40);
    expect(r.result).toBeNull();
    expect(anvilResult(a, b, null, true).result).not.toBeNull();
  });
});
