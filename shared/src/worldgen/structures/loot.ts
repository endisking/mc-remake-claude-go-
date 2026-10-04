/**
 * Structure chest loot tables (vanilla 1.17.1 data/minecraft/loot_tables/chests/*, values from the
 * minecraft.wiki) and the roller: LootTable.fill with the chest's loot seed — pools roll weighted
 * entries, then the stacks are split and shuffled into random free slots like vanilla.
 */
import { JavaRandom } from '../../util/random';
import { ENCHANTMENTS, ITEMS_BY_NAME, type EnchantmentData } from '../../data';
import { CHEST_LOOT, type LootEntry, type LootTable } from '../features/chest-loot';

type Range = number | [number, number];
type Fn =
  | { count: Range }
  | { enchantRandomly: true }
  | { enchantLevels: number; treasure: boolean }
  | { potion: string }
  | { stew: true }
  | { explorationMap: string }
  | { damage: [number, number] };
interface Entry { item: string | null; weight: number; fns?: Fn[] }
interface Pool { rolls: Range; entries: Entry[] }
export interface StructureLootTable { pools: Pool[] }

const e = (item: string | null, weight: number, ...fns: Fn[]): Entry => ({ item, weight, ...(fns.length ? { fns } : {}) });
const n = (min: number, max: number): Fn => ({ count: [min, max] });
const ER: Fn = { enchantRandomly: true };
const EL30: Fn = { enchantLevels: 30, treasure: true };
const MAP_TREASURE: Fn = { explorationMap: 'buried_treasure' };

export const STRUCTURE_LOOT: Record<string, StructureLootTable> = {
  'chests/desert_pyramid': {
    pools: [
      {
        rolls: [2, 4],
        entries: [
          e('diamond', 5, n(1, 3)), e('iron_ingot', 15, n(1, 5)), e('gold_ingot', 15, n(2, 7)), e('emerald', 15, n(1, 3)),
          e('bone', 25, n(4, 6)), e('spider_eye', 25, n(1, 3)), e('rotten_flesh', 25, n(3, 7)), e('saddle', 20),
          e('iron_horse_armor', 15), e('golden_horse_armor', 10), e('diamond_horse_armor', 5), e('book', 20, ER),
          e('golden_apple', 20), e('enchanted_golden_apple', 2), e(null, 15),
        ],
      },
      { rolls: 4, entries: [e('bone', 10, n(1, 8)), e('gunpowder', 10, n(1, 8)), e('rotten_flesh', 10, n(1, 8)), e('string', 10, n(1, 8)), e('sand', 10, n(1, 8))] },
    ],
  },
  'chests/jungle_temple': {
    pools: [
      {
        rolls: [2, 6],
        entries: [
          e('diamond', 3, n(1, 3)), e('iron_ingot', 10, n(1, 5)), e('gold_ingot', 15, n(2, 7)), e('bamboo', 15, n(1, 3)),
          e('emerald', 2, n(1, 3)), e('bone', 20, n(4, 6)), e('rotten_flesh', 16, n(3, 7)), e('saddle', 3),
          e('iron_horse_armor', 1), e('golden_horse_armor', 1), e('diamond_horse_armor', 1), e('book', 1, EL30),
        ],
      },
    ],
  },
  'chests/jungle_temple_dispenser': { pools: [{ rolls: [1, 2], entries: [e('arrow', 30, n(2, 7))] }] },
  'chests/igloo_chest': {
    pools: [
      {
        rolls: [2, 8],
        entries: [e('apple', 15, n(1, 3)), e('coal', 15, n(1, 4)), e('gold_nugget', 10, n(1, 3)), e('stone_axe', 2), e('rotten_flesh', 10), e('emerald', 1), e('wheat', 10, n(2, 3))],
      },
      { rolls: 1, entries: [e('golden_apple', 1)] },
    ],
  },
  'chests/buried_treasure': {
    pools: [
      { rolls: 1, entries: [e('heart_of_the_sea', 1)] },
      { rolls: [5, 8], entries: [e('iron_ingot', 20, n(1, 4)), e('gold_ingot', 10, n(1, 4)), e('tnt', 5, n(1, 2))] },
      { rolls: [1, 3], entries: [e('emerald', 5, n(4, 8)), e('diamond', 5, n(1, 2)), e('prismarine_crystals', 5, n(1, 5))] },
      { rolls: [0, 1], entries: [e('leather_chestplate', 1), e('iron_sword', 1)] },
      { rolls: 2, entries: [e('cooked_cod', 1, n(2, 4)), e('cooked_salmon', 1, n(2, 4))] },
      { rolls: [0, 2], entries: [e('potion', 1, { potion: 'water_breathing' })] },
    ],
  },
  'chests/shipwreck_map': {
    pools: [
      { rolls: 1, entries: [e('map', 1, MAP_TREASURE)] },
      { rolls: 3, entries: [e('compass', 1), e('map', 1), e('clock', 1), e('paper', 20, n(1, 10)), e('feather', 10, n(1, 5)), e('book', 5, n(1, 5))] },
    ],
  },
  'chests/shipwreck_supply': {
    pools: [
      {
        rolls: [3, 10],
        entries: [
          e('paper', 8, n(1, 12)), e('potato', 7, n(2, 6)), e('poisonous_potato', 7, n(2, 6)), e('carrot', 7, n(4, 8)), e('wheat', 7, n(8, 21)),
          e('suspicious_stew', 10, { stew: true }), e('coal', 6, n(2, 8)), e('rotten_flesh', 5, n(5, 24)), e('pumpkin', 2, n(1, 3)),
          e('bamboo', 2, n(1, 3)), e('gunpowder', 3, n(1, 5)), e('tnt', 1, n(1, 2)),
          e('leather_helmet', 3, ER), e('leather_chestplate', 3, ER), e('leather_leggings', 3, ER), e('leather_boots', 3, ER),
        ],
      },
    ],
  },
  'chests/shipwreck_treasure': {
    pools: [
      { rolls: [3, 6], entries: [e('iron_ingot', 90, n(1, 5)), e('gold_ingot', 10, n(1, 5)), e('emerald', 40, n(1, 5)), e('diamond', 5), e('experience_bottle', 5)] },
      { rolls: [2, 5], entries: [e('iron_nugget', 50, n(1, 10)), e('gold_nugget', 10, n(1, 10)), e('lapis_lazuli', 20, n(1, 10))] },
    ],
  },
  'chests/underwater_ruin_small': {
    pools: [
      { rolls: [2, 8], entries: [e('coal', 10, n(1, 4)), e('stone_axe', 2), e('rotten_flesh', 5), e('emerald', 1), e('wheat', 10, n(2, 3))] },
      { rolls: 1, entries: [e('leather_chestplate', 1), e('golden_helmet', 1), e('fishing_rod', 5, ER), e('map', 10, MAP_TREASURE)] },
    ],
  },
  'chests/underwater_ruin_big': {
    pools: [
      { rolls: [2, 8], entries: [e('coal', 10, n(1, 4)), e('gold_nugget', 10, n(1, 3)), e('emerald', 1), e('wheat', 10, n(2, 3))] },
      { rolls: 1, entries: [e('golden_apple', 1), e('book', 5, ER), e('leather_chestplate', 1), e('golden_helmet', 1), e('fishing_rod', 5, ER), e('map', 10, MAP_TREASURE)] },
    ],
  },
  'chests/ruined_portal': {
    pools: [
      {
        rolls: [4, 8],
        entries: [
          e('obsidian', 40, n(1, 2)), e('flint', 40, n(1, 4)), e('iron_nugget', 40, n(9, 18)), e('flint_and_steel', 40), e('fire_charge', 40),
          e('golden_apple', 15), e('gold_nugget', 15, n(4, 24)), e('golden_sword', 15, ER), e('golden_axe', 15, ER), e('golden_hoe', 15, ER),
          e('golden_shovel', 15, ER), e('golden_pickaxe', 15, ER), e('golden_boots', 15, ER), e('golden_chestplate', 15, ER),
          e('golden_helmet', 15, ER), e('golden_leggings', 15, ER), e('glistering_melon_slice', 5, n(4, 12)), e('golden_horse_armor', 5),
          e('light_weighted_pressure_plate', 5), e('golden_carrot', 5, n(4, 12)), e('clock', 5), e('gold_ingot', 5, n(2, 8)),
          e('bell', 1), e('enchanted_golden_apple', 1), e('gold_block', 1, n(1, 2)),
        ],
      },
    ],
  },
  'chests/abandoned_mineshaft': {
    pools: [
      { rolls: 1, entries: [e('golden_apple', 20), e('enchanted_golden_apple', 1), e('name_tag', 30), e('book', 10, ER), e('iron_pickaxe', 5), e(null, 5)] },
      {
        rolls: [2, 4],
        entries: [
          e('iron_ingot', 10, n(1, 5)), e('gold_ingot', 5, n(1, 3)), e('redstone', 5, n(4, 9)), e('lapis_lazuli', 5, n(4, 9)), e('diamond', 3, n(1, 2)),
          e('coal', 10, n(3, 8)), e('bread', 15, n(1, 3)), e('glow_berries', 15, n(3, 6)), e('melon_seeds', 10, n(2, 4)), e('pumpkin_seeds', 10, n(2, 4)),
          e('beetroot_seeds', 10, n(2, 4)),
        ],
      },
      { rolls: 3, entries: [e('rail', 20, n(4, 8)), e('powered_rail', 5, n(1, 4)), e('detector_rail', 5, n(1, 4)), e('activator_rail', 5, n(1, 4)), e('torch', 15, n(1, 16))] },
    ],
  },
  'chests/stronghold_corridor': {
    pools: [
      {
        rolls: [2, 3],
        entries: [
          e('ender_pearl', 10), e('diamond', 3, n(1, 3)), e('iron_ingot', 10, n(1, 5)), e('gold_ingot', 5, n(1, 3)), e('redstone', 5, n(4, 9)),
          e('bread', 15, n(1, 3)), e('apple', 15, n(1, 3)), e('iron_pickaxe', 5), e('iron_sword', 5), e('iron_chestplate', 5), e('iron_helmet', 5),
          e('iron_leggings', 5), e('iron_boots', 5), e('golden_apple', 1), e('saddle', 1), e('iron_horse_armor', 1), e('golden_horse_armor', 1),
          e('diamond_horse_armor', 1), e('book', 1, EL30),
        ],
      },
    ],
  },
  'chests/stronghold_crossing': {
    pools: [
      {
        rolls: [1, 4],
        entries: [e('iron_ingot', 10, n(1, 5)), e('gold_ingot', 5, n(1, 3)), e('redstone', 5, n(4, 9)), e('coal', 10, n(3, 8)), e('bread', 15, n(1, 3)), e('apple', 15, n(1, 3)), e('iron_pickaxe', 1), e('book', 1, EL30)],
      },
    ],
  },
  'chests/stronghold_library': {
    pools: [{ rolls: [2, 10], entries: [e('book', 20, n(1, 3)), e('paper', 20, n(2, 7)), e('map', 1), e('compass', 1), e('book', 10, EL30)] }],
  },
  'chests/pillager_outpost': {
    pools: [
      { rolls: [0, 1], entries: [e('crossbow', 1)] },
      { rolls: [2, 3], entries: [e('wheat', 7, n(3, 5)), e('potato', 5, n(2, 5)), e('carrot', 5, n(3, 5))] },
      { rolls: [1, 3], entries: [e('dark_oak_log', 1, n(2, 3))] },
      { rolls: [2, 3], entries: [e('experience_bottle', 7), e('string', 4, n(1, 6)), e('arrow', 4, n(2, 7)), e('tripwire_hook', 3, n(1, 3)), e('iron_ingot', 3, n(1, 3)), e('book', 1, ER)] },
    ],
  },
  'chests/woodland_mansion': {
    pools: [
      {
        rolls: [1, 3],
        entries: [
          e('lead', 20), e('golden_apple', 15), e('enchanted_golden_apple', 2), e('music_disc_13', 15), e('music_disc_cat', 15), e('name_tag', 20),
          e('chainmail_chestplate', 10), e('diamond_hoe', 15), e('diamond_chestplate', 5), e('book', 10, ER),
        ],
      },
      {
        rolls: [1, 4],
        entries: [
          e('iron_ingot', 10, n(1, 4)), e('gold_ingot', 5, n(1, 4)), e('bread', 20), e('wheat', 20, n(1, 4)), e('bucket', 10), e('redstone', 15, n(1, 4)),
          e('coal', 15, n(1, 4)), e('melon_seeds', 10, n(2, 4)), e('pumpkin_seeds', 10, n(2, 4)), e('beetroot_seeds', 10, n(2, 4)),
        ],
      },
      { rolls: 3, entries: [e('bone', 10, n(1, 8)), e('gunpowder', 10, n(1, 8)), e('rotten_flesh', 10, n(1, 8)), e('string', 10, n(1, 8))] },
    ],
  },
  // villages (chests/village/*)
  'chests/village/village_plains_house': {
    pools: [{ rolls: [3, 8], entries: [e('gold_nugget', 1, n(1, 3)), e('dandelion', 2), e('poppy', 1), e('potato', 10, n(1, 7)), e('bread', 10, n(1, 4)), e('apple', 10, n(1, 5)), e('book', 1), e('feather', 1), e('emerald', 2, n(1, 4)), e('oak_sapling', 5, n(1, 2))] }],
  },
  'chests/village/village_desert_house': {
    pools: [{ rolls: [3, 8], entries: [e('clay_ball', 1), e('green_dye', 1), e('cactus', 10, n(1, 4)), e('wheat', 10, n(1, 7)), e('bread', 10, n(1, 4)), e('book', 1), e('dead_bush', 2, n(1, 3)), e('emerald', 1, n(1, 3))] }],
  },
  'chests/village/village_savanna_house': {
    pools: [{ rolls: [3, 8], entries: [e('gold_nugget', 1, n(1, 3)), e('grass', 5), e('tall_grass', 5), e('bread', 10, n(1, 4)), e('wheat_seeds', 10, n(1, 5)), e('emerald', 1, n(1, 4)), e('acacia_sapling', 10, n(1, 2)), e('saddle', 1), e('torch', 1, n(1, 2)), e('bucket', 1)] }],
  },
  'chests/village/village_snowy_house': {
    pools: [{ rolls: [3, 8], entries: [e('blue_ice', 1), e('snow_block', 4), e('potato', 10, n(1, 7)), e('bread', 10, n(1, 4)), e('beetroot_seeds', 10, n(1, 5)), e('beetroot_soup', 1), e('furnace', 1), e('emerald', 1, n(1, 4)), e('snowball', 10, n(1, 7)), e('coal', 5, n(1, 4))] }],
  },
  'chests/village/village_taiga_house': {
    pools: [{ rolls: [3, 8], entries: [e('iron_nugget', 1, n(1, 5)), e('fern', 2), e('large_fern', 2), e('potato', 10, n(1, 7)), e('sweet_berries', 5, n(1, 7)), e('bread', 10, n(1, 4)), e('pumpkin_seeds', 5, n(1, 5)), e('pumpkin_pie', 1), e('emerald', 1, n(1, 4)), e('spruce_sapling', 5, n(1, 5)), e('spruce_sign', 1), e('spruce_log', 10, n(1, 5))] }],
  },
  'chests/village/village_weaponsmith': {
    pools: [{ rolls: [3, 8], entries: [e('diamond', 3, n(1, 3)), e('iron_ingot', 10, n(1, 5)), e('gold_ingot', 5, n(1, 3)), e('bread', 15, n(1, 3)), e('apple', 15, n(1, 3)), e('iron_pickaxe', 5), e('iron_sword', 5), e('iron_chestplate', 5), e('iron_helmet', 5), e('iron_leggings', 5), e('iron_boots', 5), e('obsidian', 5, n(3, 7)), e('oak_sapling', 5, n(3, 7)), e('saddle', 3), e('iron_horse_armor', 1), e('golden_horse_armor', 1), e('diamond_horse_armor', 1)] }],
  },
  'chests/village/village_toolsmith': {
    pools: [{ rolls: [3, 8], entries: [e('diamond', 1, n(1, 3)), e('iron_ingot', 5, n(1, 5)), e('gold_ingot', 1, n(1, 3)), e('bread', 15, n(1, 3)), e('iron_pickaxe', 5), e('coal', 1, n(1, 3)), e('stick', 20, n(1, 3)), e('iron_shovel', 5)] }],
  },
  'chests/village/village_armorer': {
    pools: [{ rolls: [1, 5], entries: [e('iron_ingot', 2, n(1, 3)), e('bread', 4, n(1, 4)), e('iron_helmet', 1), e('emerald', 1)] }],
  },
  'chests/village/village_cartographer': {
    pools: [{ rolls: [1, 5], entries: [e('map', 10, n(1, 3)), e('paper', 15, n(1, 5)), e('compass', 5), e('bread', 15, n(1, 4)), e('stick', 5, n(1, 2))] }],
  },
  'chests/village/village_mason': {
    pools: [{ rolls: [1, 5], entries: [e('clay_ball', 1, n(1, 3)), e('flower_pot', 1), e('stone', 2), e('stone_bricks', 2), e('bread', 4, n(1, 4)), e('yellow_dye', 1), e('smooth_stone', 1), e('emerald', 1)] }],
  },
  'chests/village/village_shepherd': {
    pools: [{ rolls: [1, 5], entries: [e('white_wool', 6, n(1, 8)), e('black_wool', 3, n(1, 3)), e('gray_wool', 2, n(1, 3)), e('brown_wool', 2, n(1, 3)), e('light_gray_wool', 2, n(1, 3)), e('emerald', 1), e('shears', 1), e('wheat', 6, n(1, 6))] }],
  },
  'chests/village/village_butcher': {
    pools: [{ rolls: [1, 5], entries: [e('emerald', 1), e('porkchop', 6), e('wheat', 6), e('beef', 6), e('mutton', 6), e('coal', 3, n(1, 3))] }],
  },
  'chests/village/village_fletcher': {
    pools: [{ rolls: [1, 5], entries: [e('emerald', 1), e('arrow', 2), e('feather', 6), e('egg', 2), e('flint', 6), e('stick', 6)] }],
  },
  'chests/village/village_fisher': {
    pools: [{ rolls: [1, 5], entries: [e('emerald', 1), e('cod', 2), e('salmon', 1), e('water_bucket', 1), e('barrel', 1), e('wheat_seeds', 3), e('coal', 2)] }],
  },
  'chests/village/village_tannery': {
    pools: [{ rolls: [1, 5], entries: [e('leather', 1, n(1, 3)), e('leather_chestplate', 2), e('leather_boots', 2), e('leather_helmet', 2), e('bread', 5, n(1, 4)), e('leather_leggings', 2), e('saddle', 1), e('emerald', 1, n(1, 4))] }],
  },
  'chests/village/village_temple': {
    pools: [{ rolls: [3, 8], entries: [e('redstone', 2, n(1, 4)), e('bread', 7, n(1, 4)), e('rotten_flesh', 7, n(1, 4)), e('lapis_lazuli', 1, n(1, 4)), e('gold_ingot', 1, n(1, 4)), e('emerald', 1, n(1, 4))] }],
  },
};

// The plain-JSON view in CHEST_LOOT (for code that only needs item names and weights).
for (const [id, t] of Object.entries(STRUCTURE_LOOT)) {
  if (CHEST_LOOT[id]) continue;
  const table: LootTable = {
    type: 'minecraft:chest',
    pools: t.pools.map((p) => ({
      rolls: typeof p.rolls === 'number' ? p.rolls : { type: 'minecraft:uniform' as const, min: p.rolls[0], max: p.rolls[1] },
      entries: p.entries.map((en): LootEntry => {
        if (!en.item) return { type: 'minecraft:empty', weight: en.weight };
        const functions: NonNullable<LootEntry['functions']> = [];
        for (const fn of en.fns ?? []) {
          if ('count' in fn) functions.push({ function: 'minecraft:set_count', count: typeof fn.count === 'number' ? fn.count : { type: 'minecraft:uniform', min: fn.count[0], max: fn.count[1] } });
          else if ('enchantRandomly' in fn || 'enchantLevels' in fn) functions.push({ function: 'minecraft:enchant_randomly' });
        }
        return { type: 'minecraft:item', name: `minecraft:${en.item}`, weight: en.weight, ...(functions.length ? { functions } : {}) };
      }),
    })),
  };
  CHEST_LOOT[id] = table;
}

// ------------------------------------------------------------------ rolling
export interface LootItem {
  item: string;
  count: number;
  enchantments?: { id: string; lvl: number }[];
  /** potion type for potions */
  potion?: string;
  /** suspicious stew effect */
  stewEffect?: { effect: string; duration: number };
  /** exploration map target structure */
  mapTarget?: string;
}

/** Mth.nextInt */
const nextIntRange = (r: JavaRandom, min: number, max: number) => (min >= max ? min : r.nextInt(max - min + 1) + min);
const rollRange = (r: JavaRandom, v: Range) => (typeof v === 'number' ? v : nextIntRange(r, v[0], v[1]));

function canEnchant(e: EnchantmentData, item: string): boolean {
  if (item === 'book') return true;
  const armor = /_(helmet|chestplate|leggings|boots)$/.exec(item)?.[1];
  switch (e.category) {
    case 'armor': return !!armor;
    case 'armor_head': return armor === 'helmet';
    case 'armor_chest': return armor === 'chestplate';
    case 'armor_legs': return armor === 'leggings';
    case 'armor_feet': return armor === 'boots';
    case 'weapon': return /_(sword)$/.test(item);
    case 'digger': return /_(pickaxe|axe|shovel|hoe)$/.test(item);
    case 'fishing_rod': return item === 'fishing_rod';
    case 'trident': return item === 'trident';
    case 'bow': return item === 'bow';
    case 'crossbow': return item === 'crossbow';
    case 'breakable': case 'vanishable': return /_(helmet|chestplate|leggings|boots|sword|pickaxe|axe|shovel|hoe)$|^(fishing_rod|bow|crossbow|trident|shears|flint_and_steel|elytra|shield)$/.test(item);
    case 'wearable': return !!armor || item === 'elytra';
    default: return false;
  }
}

/** Item.getEnchantmentValue by material. */
function enchantability(item: string): number {
  if (item === 'book') return 1;
  const m = /^(leather|chainmail|iron|golden|diamond|netherite|wooden|stone)_/.exec(item)?.[1];
  const armor = /_(helmet|chestplate|leggings|boots)$/.test(item);
  switch (m) {
    case 'leather': return 15;
    case 'chainmail': return 12;
    case 'iron': return armor ? 9 : 14;
    case 'golden': return armor ? 25 : 22;
    case 'diamond': return 10;
    case 'netherite': return 15;
    case 'wooden': return 15;
    case 'stone': return 5;
  }
  return item === 'fishing_rod' || item === 'bow' || item === 'crossbow' || item === 'trident' ? 1 : 0;
}

const cost = (c: { a: number; b: number }, lvl: number) => c.a * lvl + c.b;
const compatible = (a: EnchantmentData, b: EnchantmentData) => a !== b && !a.exclude.includes(b.name) && !b.exclude.includes(a.name);

function weighted<T extends { w: number }>(r: JavaRandom, list: T[]): T | undefined {
  const total = list.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return undefined;
  let k = r.nextInt(total);
  for (const x of list) if ((k -= x.w) < 0) return x;
  return undefined;
}

/** EnchantmentHelper.selectEnchantment */
function selectEnchantments(r: JavaRandom, item: string, level: number, treasure: boolean): { id: string; lvl: number }[] {
  const ench = enchantability(item);
  const out: { e: EnchantmentData; lvl: number; w: number }[] = [];
  if (ench <= 0) return [];
  level += 1 + r.nextInt(Math.floor(ench / 4) + 1) + r.nextInt(Math.floor(ench / 4) + 1);
  const f = Math.fround(Math.fround(Math.fround(r.nextFloat() + r.nextFloat()) - 1) * 0.15);
  level = Math.max(1, Math.min(2147483647, Math.round(level + level * f)));
  let avail: { e: EnchantmentData; lvl: number; w: number }[] = [];
  for (const e of ENCHANTMENTS) {
    if ((e.treasureOnly && !treasure) || !e.discoverable || !canEnchant(e, item)) continue;
    for (let l = e.maxLevel; l >= 1; l--)
      if (level >= cost(e.minCost, l) && level <= cost(e.maxCost, l)) {
        avail.push({ e, lvl: l, w: e.weight });
        break;
      }
  }
  if (!avail.length) return [];
  const first = weighted(r, avail)!;
  out.push(first);
  while (r.nextInt(50) <= level) {
    const last = out[out.length - 1]!;
    avail = avail.filter((a) => compatible(a.e, last.e));
    if (!avail.length) break;
    out.push(weighted(r, avail)!);
    level = Math.floor(level / 2);
  }
  return out.map((o) => ({ id: o.e.name, lvl: o.lvl }));
}

/** EnchantRandomlyFunction: one random applicable discoverable enchantment at a random level. */
function enchantRandomly(r: JavaRandom, item: string): { id: string; lvl: number } | undefined {
  const list = ENCHANTMENTS.filter((e) => e.discoverable && canEnchant(e, item));
  if (!list.length) return undefined;
  const e = list[r.nextInt(list.length)]!;
  return { id: e.name, lvl: nextIntRange(r, 1, e.maxLevel) };
}

const STEW_EFFECTS: [string, number][] = [
  ['night_vision', 7], ['jump_boost', 7], ['weakness', 6], ['blindness', 5], ['poison', 10], ['saturation', 7],
];

/** LootTable.getRandomItems for a table id. */
export function rollLootItems(tableId: string, r: JavaRandom): LootItem[] {
  const t = STRUCTURE_LOOT[tableId.replace(/^minecraft:/, '')];
  if (!t) return rollBasicTable(tableId, r);
  const out: LootItem[] = [];
  for (const pool of t.pools) {
    const rolls = rollRange(r, pool.rolls);
    for (let i = 0; i < rolls; i++) {
      let entry: Entry;
      if (pool.entries.length === 1) entry = pool.entries[0]!;
      else {
        const total = pool.entries.reduce((s, x) => s + x.weight, 0);
        let k = r.nextInt(total);
        entry = pool.entries.find((x) => (k -= x.weight) < 0)!;
      }
      if (!entry.item) continue;
      const it: LootItem = { item: entry.item, count: 1 };
      for (const fn of entry.fns ?? []) {
        if ('count' in fn) it.count = rollRange(r, fn.count);
        else if ('enchantRandomly' in fn) {
          const en = enchantRandomly(r, it.item);
          if (en) {
            if (it.item === 'book') it.item = 'enchanted_book';
            it.enchantments = [en];
          }
        } else if ('enchantLevels' in fn) {
          const list = selectEnchantments(r, it.item, fn.enchantLevels, fn.treasure);
          if (it.item === 'book') it.item = 'enchanted_book';
          if (list.length) it.enchantments = list;
        } else if ('potion' in fn) it.potion = fn.potion;
        else if ('stew' in fn) {
          const [effect, secs] = STEW_EFFECTS[r.nextInt(STEW_EFFECTS.length)]!;
          it.stewEffect = { effect, duration: secs * 20 };
        } else if ('explorationMap' in fn) {
          it.item = 'filled_map';
          it.mapTarget = fn.explorationMap;
        }
      }
      // createStackSplitter: stacks over the item's max size split
      const max = ITEMS_BY_NAME.get(it.item)?.stackSize ?? 64;
      while (it.count > max) {
        out.push({ ...it, count: max });
        it.count -= max;
      }
      out.push(it);
    }
  }
  return out;
}

/** Tables only defined in CHEST_LOOT's plain shape (dungeons). */
function rollBasicTable(tableId: string, r: JavaRandom): LootItem[] {
  const t = CHEST_LOOT[tableId.replace(/^minecraft:/, '')];
  if (!t) return [];
  const out: LootItem[] = [];
  for (const pool of t.pools) {
    const rolls = typeof pool.rolls === 'number' ? pool.rolls : nextIntRange(r, pool.rolls.min, pool.rolls.max);
    for (let i = 0; i < rolls; i++) {
      const total = pool.entries.reduce((s, x) => s + x.weight, 0);
      let k = pool.entries.length === 1 ? 0 : r.nextInt(total);
      const en = pool.entries.length === 1 ? pool.entries[0]! : pool.entries.find((x) => (k -= x.weight) < 0)!;
      if (en.type !== 'minecraft:item' || !en.name) continue;
      const it: LootItem = { item: en.name.replace('minecraft:', ''), count: 1 };
      for (const fn of en.functions ?? []) {
        if (fn.function === 'minecraft:set_count') it.count = typeof fn.count === 'number' ? fn.count : nextIntRange(r, fn.count.min, fn.count.max);
        else if (fn.function === 'minecraft:enchant_randomly') {
          const e2 = enchantRandomly(r, it.item);
          if (e2) {
            if (it.item === 'book') it.item = 'enchanted_book';
            it.enchantments = [e2];
          }
        }
      }
      out.push(it);
    }
  }
  return out;
}

/**
 * RandomizableContainerBlockEntity.unpackLootTable → LootTable.fill: the chest's contents
 * (`size` slots, null = empty) from its loot table and seed.
 */
export function fillChestLoot(tableId: string, lootSeed: bigint, size = 27): (LootItem | null)[] {
  const r = new JavaRandom(lootSeed);
  const items = rollLootItems(tableId, r);
  const slots: number[] = [];
  for (let i = 0; i < size; i++) slots.push(i);
  javaShuffle(slots, r);
  // shuffleAndSplitItems
  const big: LootItem[] = [];
  for (let i = 0; i < items.length; i++)
    if (items[i]!.count > 1) {
      big.push(items[i]!);
      items.splice(i--, 1);
    }
  while (slots.length - items.length - big.length > 0 && big.length) {
    const s = big.splice(nextIntRange(r, 0, big.length - 1), 1)[0]!;
    const k = nextIntRange(r, 1, Math.floor(s.count / 2));
    const s2: LootItem = { ...s, count: k };
    s.count -= k;
    if (s.count > 1 && r.nextBoolean()) big.push(s);
    else items.push(s);
    if (s2.count > 1 && r.nextBoolean()) big.push(s2);
    else items.push(s2);
  }
  items.push(...big);
  javaShuffle(items, r);
  const out: (LootItem | null)[] = new Array(size).fill(null);
  for (const it of items) {
    if (!slots.length) break;
    out[slots.pop()!] = it;
  }
  return out;
}

function javaShuffle<T>(list: T[], r: JavaRandom): void {
  for (let i = list.length; i > 1; i--) {
    const j = r.nextInt(i);
    const t = list[i - 1]!;
    list[i - 1] = list[j]!;
    list[j] = t;
  }
}
