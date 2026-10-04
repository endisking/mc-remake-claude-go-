import { describe, expect, it } from 'vitest';
import { VILLAGER_TYPES, villagerTypeForBiome } from './trades';
import { BIOMES } from '../data';

describe('VillagerType.byBiome', () => {
  it('maps biomes to their villager type like 1.17.1', () => {
    expect(villagerTypeForBiome('desert')).toBe('desert');
    expect(villagerTypeForBiome('eroded_badlands')).toBe('desert');
    expect(villagerTypeForBiome('bamboo_jungle')).toBe('jungle');
    expect(villagerTypeForBiome('shattered_savanna')).toBe('savanna');
    expect(villagerTypeForBiome('snowy_tundra')).toBe('snow');
    expect(villagerTypeForBiome('frozen_river')).toBe('snow');
    expect(villagerTypeForBiome('swamp_hills')).toBe('swamp');
    expect(villagerTypeForBiome('giant_tree_taiga')).toBe('taiga');
    expect(villagerTypeForBiome('mountains')).toBe('taiga');
    expect(villagerTypeForBiome('plains')).toBe('plains');
    expect(villagerTypeForBiome('forest')).toBe('plains');
    expect(villagerTypeForBiome('dark_forest')).toBe('plains');
  });
  it('only uses real biome names and registry-order types', () => {
    const names = new Set(Object.values(BIOMES).map((b) => b.name));
    for (const b of names) expect(VILLAGER_TYPES).toContain(villagerTypeForBiome(b));
    expect([...VILLAGER_TYPES]).toEqual(['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga']);
  });
});
