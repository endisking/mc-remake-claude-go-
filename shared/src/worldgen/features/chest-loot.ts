/**
 * Chest loot tables of generated features, as data in vanilla's loot-table JSON shape (1.17.1
 * values, from the minecraft.wiki / data reports). A chest block entity created by worldgen stores
 * the table id and a loot seed (see GenBlockEntity in underground.ts); the items roll when the
 * chest is first opened or broken.
 */
export interface LootEntry {
  type: 'minecraft:item' | 'minecraft:empty';
  name?: string;
  weight: number;
  functions?: ({ function: 'minecraft:set_count'; count: number | { type: 'minecraft:uniform'; min: number; max: number } } | { function: 'minecraft:enchant_randomly' })[];
}
export interface LootPool {
  rolls: number | { type: 'minecraft:uniform'; min: number; max: number };
  entries: LootEntry[];
}
export interface LootTable {
  type: 'minecraft:chest';
  pools: LootPool[];
}

const count = (min: number, max: number) => [{ function: 'minecraft:set_count' as const, count: { type: 'minecraft:uniform' as const, min, max } }];
const item = (name: string, weight: number, functions?: LootEntry['functions']): LootEntry => ({ type: 'minecraft:item', name: `minecraft:${name}`, weight, ...(functions ? { functions } : {}) });

export const CHEST_LOOT: Record<string, LootTable> = {
  /** chests/simple_dungeon (dungeon chests) */
  'chests/simple_dungeon': {
    type: 'minecraft:chest',
    pools: [
      {
        rolls: { type: 'minecraft:uniform', min: 1, max: 3 },
        entries: [
          item('saddle', 20),
          item('golden_apple', 15),
          item('enchanted_golden_apple', 2),
          item('music_disc_13', 15),
          item('music_disc_cat', 15),
          item('name_tag', 20),
          item('golden_horse_armor', 10),
          item('iron_horse_armor', 15),
          item('diamond_horse_armor', 5),
          item('book', 10, [{ function: 'minecraft:enchant_randomly' }]),
        ],
      },
      {
        rolls: { type: 'minecraft:uniform', min: 1, max: 4 },
        entries: [
          item('iron_ingot', 10, count(1, 4)),
          item('gold_ingot', 5, count(1, 4)),
          item('bread', 20),
          item('wheat', 20, count(1, 4)),
          item('bucket', 10),
          item('redstone', 15, count(1, 4)),
          item('coal', 15, count(1, 4)),
          item('melon_seeds', 10, count(2, 4)),
          item('pumpkin_seeds', 10, count(2, 4)),
          item('beetroot_seeds', 10, count(2, 4)),
        ],
      },
      {
        rolls: 3,
        entries: [
          item('bone', 10, count(1, 8)),
          item('gunpowder', 10, count(1, 8)),
          item('rotten_flesh', 10, count(1, 8)),
          item('string', 10, count(1, 8)),
        ],
      },
    ],
  },
};
