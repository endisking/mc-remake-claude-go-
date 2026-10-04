import { describe, it, expect } from 'vitest';
import { itemTooltip } from './containerscreen';
import { stack } from '@shared/item/stack';

describe('item tooltips', () => {
  it('weapons and tools show main-hand attack damage and speed', () => {
    expect(itemTooltip(stack('diamond_sword'))).toEqual(['Diamond Sword', '', '§7When in Main Hand:', '§2 7 Attack Damage', '§2 1.6 Attack Speed']);
    expect(itemTooltip(stack('iron_shovel'))).toContain('§2 4.5 Attack Damage');
  });
  it('armour shows its slot, armour, toughness and knockback resistance', () => {
    expect(itemTooltip(stack('netherite_chestplate'))).toEqual(['Netherite Chestplate', '', '§7When on Body:', '§9+8 Armor', '§9+3 Armor Toughness', '§9+1 Knockback Resistance']);
    expect(itemTooltip(stack('leather_helmet'))).toEqual(['Leather Cap', '', '§7When on Head:', '§9+1 Armor']);
  });
  it('plain items show just the name; rarity colours the name', () => {
    expect(itemTooltip(stack('dirt'))).toEqual(['Dirt']);
    expect(itemTooltip(stack('golden_apple'))[0]).toBe('§bGolden Apple');
    expect(itemTooltip(stack('enchanted_golden_apple'))[0]).toBe('§dEnchanted Golden Apple');
  });
});
