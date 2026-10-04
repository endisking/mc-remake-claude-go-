/**
 * Vanilla numeric biome ids (1.17) and the classification helpers the layer system uses
 * (cubiomes biomes.c, MIT — licenses/cubiomes.txt).
 */
export const B = {
  ocean: 0, plains: 1, desert: 2, mountains: 3, forest: 4, taiga: 5, swamp: 6, river: 7, nether_wastes: 8, the_end: 9,
  frozen_ocean: 10, frozen_river: 11, snowy_tundra: 12, snowy_mountains: 13, mushroom_fields: 14, mushroom_field_shore: 15,
  beach: 16, desert_hills: 17, wooded_hills: 18, taiga_hills: 19, mountain_edge: 20, jungle: 21, jungle_hills: 22,
  jungle_edge: 23, deep_ocean: 24, stone_shore: 25, snowy_beach: 26, birch_forest: 27, birch_forest_hills: 28,
  dark_forest: 29, snowy_taiga: 30, snowy_taiga_hills: 31, giant_tree_taiga: 32, giant_tree_taiga_hills: 33,
  wooded_mountains: 34, savanna: 35, savanna_plateau: 36, badlands: 37, wooded_badlands_plateau: 38, badlands_plateau: 39,
  small_end_islands: 40, end_midlands: 41, end_highlands: 42, end_barrens: 43, warm_ocean: 44, lukewarm_ocean: 45,
  cold_ocean: 46, deep_warm_ocean: 47, deep_lukewarm_ocean: 48, deep_cold_ocean: 49, deep_frozen_ocean: 50, the_void: 127,
  sunflower_plains: 129, desert_lakes: 130, gravelly_mountains: 131, flower_forest: 132, taiga_mountains: 133,
  swamp_hills: 134, ice_spikes: 140, modified_jungle: 149, modified_jungle_edge: 151, tall_birch_forest: 155,
  tall_birch_hills: 156, dark_forest_hills: 157, snowy_taiga_mountains: 158, giant_spruce_taiga: 160,
  giant_spruce_taiga_hills: 161, modified_gravelly_mountains: 162, shattered_savanna: 163, shattered_savanna_plateau: 164,
  eroded_badlands: 165, modified_wooded_badlands_plateau: 166, modified_badlands_plateau: 167, bamboo_jungle: 168,
  bamboo_jungle_hills: 169, soul_sand_valley: 170, crimson_forest: 171, warped_forest: 172, basalt_deltas: 173,
} as const;

const MUTATED: Record<number, number> = {
  [B.plains]: B.sunflower_plains, [B.desert]: B.desert_lakes, [B.mountains]: B.gravelly_mountains, [B.forest]: B.flower_forest,
  [B.taiga]: B.taiga_mountains, [B.swamp]: B.swamp_hills, [B.snowy_tundra]: B.ice_spikes, [B.jungle]: B.modified_jungle,
  [B.jungle_edge]: B.modified_jungle_edge, [B.birch_forest]: B.tall_birch_forest, [B.birch_forest_hills]: B.tall_birch_hills,
  [B.dark_forest]: B.dark_forest_hills, [B.snowy_taiga]: B.snowy_taiga_mountains, [B.giant_tree_taiga]: B.giant_spruce_taiga,
  [B.giant_tree_taiga_hills]: B.giant_spruce_taiga_hills, [B.wooded_mountains]: B.modified_gravelly_mountains,
  [B.savanna]: B.shattered_savanna, [B.savanna_plateau]: B.shattered_savanna_plateau, [B.badlands]: B.eroded_badlands,
  [B.wooded_badlands_plateau]: B.modified_wooded_badlands_plateau, [B.badlands_plateau]: B.modified_badlands_plateau,
};

/** The mutated ("M") variant of a biome, or −1. */
export function getMutated(id: number): number {
  return MUTATED[id] ?? -1;
}

const CATEGORY: Record<number, number> = {};
const cat = (c: number, ids: number[]) => ids.forEach((i) => (CATEGORY[i] = c));
cat(B.beach, [B.beach, B.snowy_beach]);
cat(B.desert, [B.desert, B.desert_hills, B.desert_lakes]);
cat(B.mountains, [B.mountains, B.mountain_edge, B.wooded_mountains, B.gravelly_mountains, B.modified_gravelly_mountains]);
cat(B.forest, [B.forest, B.wooded_hills, B.birch_forest, B.birch_forest_hills, B.dark_forest, B.flower_forest, B.tall_birch_forest, B.tall_birch_hills, B.dark_forest_hills]);
cat(B.snowy_tundra, [B.snowy_tundra, B.snowy_mountains, B.ice_spikes]);
cat(B.jungle, [B.jungle, B.jungle_hills, B.jungle_edge, B.modified_jungle, B.modified_jungle_edge, B.bamboo_jungle, B.bamboo_jungle_hills]);
cat(B.badlands, [B.badlands, B.eroded_badlands, B.modified_wooded_badlands_plateau, B.modified_badlands_plateau]);
// 1.16+: the two plateaus form their own category
cat(B.badlands_plateau, [B.wooded_badlands_plateau, B.badlands_plateau]);
cat(B.mushroom_fields, [B.mushroom_fields, B.mushroom_field_shore]);
cat(B.stone_shore, [B.stone_shore]);
cat(B.ocean, [B.ocean, B.frozen_ocean, B.deep_ocean, B.warm_ocean, B.lukewarm_ocean, B.cold_ocean, B.deep_warm_ocean, B.deep_lukewarm_ocean, B.deep_cold_ocean, B.deep_frozen_ocean]);
cat(B.plains, [B.plains, B.sunflower_plains]);
cat(B.river, [B.river, B.frozen_river]);
cat(B.savanna, [B.savanna, B.savanna_plateau, B.shattered_savanna, B.shattered_savanna_plateau]);
cat(B.swamp, [B.swamp, B.swamp_hills]);
cat(B.taiga, [B.taiga, B.taiga_hills, B.snowy_taiga, B.snowy_taiga_hills, B.giant_tree_taiga, B.giant_tree_taiga_hills, B.taiga_mountains, B.snowy_taiga_mountains, B.giant_spruce_taiga, B.giant_spruce_taiga_hills]);
cat(B.nether_wastes, [B.nether_wastes, B.soul_sand_valley, B.crimson_forest, B.warped_forest, B.basalt_deltas]);

/** cubiomes getCategory (vanilla Biome.BiomeCategory as the layers compare it); −1 for none. */
export function category(id: number): number {
  return CATEGORY[id] ?? -1;
}

export function areSimilar(a: number, b: number): boolean {
  return a === b || category(a) === category(b);
}

const SHALLOW = new Set<number>([B.ocean, B.frozen_ocean, B.warm_ocean, B.lukewarm_ocean, B.cold_ocean]);
const DEEP = new Set<number>([B.deep_ocean, B.deep_warm_ocean, B.deep_lukewarm_ocean, B.deep_cold_ocean, B.deep_frozen_ocean]);
export const isShallowOcean = (id: number) => SHALLOW.has(id);
export const isDeepOcean = (id: number) => DEEP.has(id);
export const isOceanic = (id: number) => SHALLOW.has(id) || DEEP.has(id);
const MESA = new Set<number>([B.badlands, B.eroded_badlands, B.modified_wooded_badlands_plateau, B.modified_badlands_plateau, B.wooded_badlands_plateau, B.badlands_plateau]);
export const isMesa = (id: number) => MESA.has(id);
const SNOWY = new Set<number>([B.frozen_ocean, B.frozen_river, B.snowy_tundra, B.snowy_mountains, B.snowy_beach, B.snowy_taiga, B.snowy_taiga_hills, B.ice_spikes, B.snowy_taiga_mountains]);
export const isSnowy = (id: number) => SNOWY.has(id);
