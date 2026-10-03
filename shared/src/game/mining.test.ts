import { describe, it, expect } from 'vitest';
import { ticksToBreak, type MinerState } from './mining';
import { stateOf } from '../world/blockstate';
import { ITEMS_BY_NAME } from '../data';

const id = (n: string) => (n === 'air' ? 0 : ITEMS_BY_NAME.get(n)!.id);
const base: MinerState = { item: id('air'), efficiency: 0, haste: 0, miningFatigue: 0, underwater: false, aquaAffinity: false, onGround: true };
const t = (block: string, item = 'air', extra: Partial<MinerState> = {}) => ticksToBreak({ ...base, item: id(item), ...extra }, stateOf(block));

// expected values from the minecraft.wiki breaking-time tables (seconds × 20)
describe('mining times (vanilla 1.17.1)', () => {
  it('stone', () => {
    expect(t('stone')).toBe(150); // 7.5 s by hand
    expect(t('stone', 'wooden_pickaxe')).toBe(23); // 1.15 s
    expect(t('stone', 'stone_pickaxe')).toBe(12); // 0.6 s
    expect(t('stone', 'iron_pickaxe')).toBe(8); // 0.4 s
    expect(t('stone', 'diamond_pickaxe')).toBe(6); // 0.3 s
    expect(t('stone', 'netherite_pickaxe')).toBe(5); // 0.25 s
    expect(t('stone', 'golden_pickaxe')).toBe(4); // 0.2 s
  });
  it('dirt, logs, obsidian, leaves, instant blocks', () => {
    expect(t('dirt')).toBe(15); // 0.75 s
    expect(t('dirt', 'wooden_shovel')).toBe(8); // 0.4 s
    expect(t('oak_log')).toBe(60); // 3 s
    expect(t('oak_log', 'diamond_axe')).toBe(8); // 0.4 s
    expect(t('obsidian', 'diamond_pickaxe')).toBe(188); // 9.4 s
    expect(t('obsidian', 'iron_pickaxe')).toBe(834); // 41.7 s (no drop)
    expect(t('oak_leaves')).toBe(6); // 0.3 s
    expect(t('oak_leaves', 'shears')).toBe(1); // instant
    expect(t('grass')).toBe(1);
    expect(t('bedrock')).toBe(Infinity);
  });
  it('modifiers: efficiency, haste, underwater, airborne', () => {
    expect(t('stone', 'diamond_pickaxe', { efficiency: 5 })).toBe(2); // 0.1 s
    expect(t('stone', 'diamond_pickaxe', { efficiency: 5, haste: 2 })).toBe(1); // instant mining
    expect(t('stone', 'iron_pickaxe', { haste: 2 })).toBe(6);
    expect(t('stone', 'diamond_pickaxe', { underwater: true })).toBe(29);
    expect(t('stone', 'diamond_pickaxe', { onGround: false })).toBe(29);
    expect(t('stone', 'diamond_pickaxe', { underwater: true, onGround: false })).toBe(141);
  });
});
