/**
 * Villager and wandering trader trades (vanilla VillagerTrades / MerchantOffer, 1.17.1).
 *
 * Every profession has five levels (novice, apprentice, journeyman, expert, master); a villager
 * that reaches a level picks 2 random listings of that level (the wandering trader picks 5 generic
 * + 1 rare). Item stacks carry no NBT yet, so enchanted items/books, suspicious stew, tipped arrows,
 * explorer maps and dyed leather are offered as the plain item (logged deviation).
 */
import { stack, type ItemStack } from '../item/stack';
import type { JavaRandom } from '../util/random';

export const PROFESSIONS = [
  'none', 'armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher',
  'leatherworker', 'librarian', 'mason', 'nitwit', 'shepherd', 'toolsmith', 'weaponsmith',
] as const;
export type Profession = (typeof PROFESSIONS)[number];

/** PoiType of each profession's job site block(s) (1.17.1: any cauldron counts for leatherworkers). */
export const JOB_SITES: Record<string, Profession> = {
  blast_furnace: 'armorer',
  smoker: 'butcher',
  cartography_table: 'cartographer',
  brewing_stand: 'cleric',
  composter: 'farmer',
  barrel: 'fisherman',
  fletching_table: 'fletcher',
  cauldron: 'leatherworker',
  water_cauldron: 'leatherworker',
  lava_cauldron: 'leatherworker',
  powder_snow_cauldron: 'leatherworker',
  lectern: 'librarian',
  stonecutter: 'mason',
  loom: 'shepherd',
  smithing_table: 'toolsmith',
  grindstone: 'weaponsmith',
};

/** VillagerData.NEXT_LEVEL_XP_THRESHOLDS: xp needed to reach level 1..5 */
export const LEVEL_XP = [0, 10, 70, 150, 250] as const;
export const LEVEL_NAMES = ['novice', 'apprentice', 'journeyman', 'expert', 'master'] as const;

/** VillagerData.canLevelUp / getMinXpPerLevel / getMaxXpPerLevel */
export const canLevelUp = (level: number) => level >= 1 && level < 5;
export const minXp = (level: number) => (canLevelUp(level) ? LEVEL_XP[level - 1]! : 0);
export const maxXp = (level: number) => (canLevelUp(level) ? LEVEL_XP[level]! : 0);

export interface MerchantOffer {
  /** base cost A (before demand/special price), cost B, result */
  costA: ItemStack;
  costB: ItemStack | null;
  result: ItemStack;
  uses: number;
  maxUses: number;
  /** villager xp gained per trade */
  xp: number;
  priceMultiplier: number;
  /** demand (raises the price when traded out) and the special price (reputation, hero) */
  demand: number;
  specialPriceDiff: number;
  rewardExp: boolean;
}

function offer(costA: ItemStack, costB: ItemStack | null, result: ItemStack, maxUses: number, xp: number, priceMultiplier: number): MerchantOffer {
  return { costA, costB, result, uses: 0, maxUses, xp, priceMultiplier, demand: 0, specialPriceDiff: 0, rewardExp: true };
}

type Listing = (r: JavaRandom) => MerchantOffer;

/** EmeraldForItems: `cost` items → 1 emerald (price multiplier 0.05) */
const buy = (item: string, cost: number, maxUses: number, xp: number): Listing => () => offer(stack(item, cost), null, stack('emerald'), maxUses, xp, 0.05);
/** ItemsForEmeralds: `emeralds` → `count` items */
const sell = (item: string, emeralds: number, count: number, maxUses: number, xp: number, mult = 0.05): Listing => () =>
  offer(stack('emerald', emeralds), null, stack(item, count), maxUses, xp, mult);
/** ItemsAndEmeraldsToItems: `n` items + `emeralds` → `m` other items */
const swap = (from: string, n: number, emeralds: number, to: string, m: number, maxUses: number, xp: number): Listing => () =>
  offer(stack('emerald', emeralds), stack(from, n), stack(to, m), maxUses, xp, 0.05);
/** EnchantBookForEmeralds: 1 random enchantment level → 2 + rand(5 + level·10) + 3·level emeralds (×2 for treasure) */
const book = (xp: number): Listing => (r) => {
  const level = 1 + r.nextInt(3);
  const cost = Math.min(64, 2 + r.nextInt(5 + level * 10) + 3 * level);
  return offer(stack('emerald', cost), stack('book'), stack('enchanted_book'), 12, xp, 0.2);
};
/** EnchantedItemForEmeralds: base cost + (5–19 enchantment levels) */
const enchanted = (item: string, base: number, maxUses: number, xp: number, mult = 0.05): Listing => (r) => {
  const lvl = 5 + r.nextInt(15);
  return offer(stack('emerald', Math.min(base + lvl, 64)), null, stack(item), maxUses, xp, mult);
};
/** one of several listings (wool/dye/terracotta colour variants are separate listings in vanilla) */
const anyOf = (...ls: Listing[]): Listing[] => ls;

const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

export const VILLAGER_TRADES: Partial<Record<Profession, Listing[][]>> = {
  farmer: [
    [buy('wheat', 20, 16, 2), buy('potato', 26, 16, 2), buy('carrot', 22, 16, 2), buy('beetroot', 15, 16, 2), sell('bread', 1, 6, 16, 1)],
    [buy('pumpkin', 6, 12, 10), sell('pumpkin_pie', 1, 4, 12, 5), sell('apple', 1, 4, 16, 5)],
    [sell('cookie', 3, 18, 12, 10), buy('melon', 4, 12, 20)],
    [sell('cake', 1, 1, 12, 15), sell('suspicious_stew', 1, 1, 12, 15)],
    [sell('golden_carrot', 3, 3, 12, 30), sell('glistering_melon_slice', 4, 3, 12, 30)],
  ],
  fisherman: [
    [buy('string', 20, 16, 2), buy('coal', 10, 16, 2), swap('cod', 6, 1, 'cooked_cod', 6, 16, 1), sell('cod_bucket', 3, 1, 16, 1)],
    [buy('cod', 15, 16, 10), swap('salmon', 6, 1, 'cooked_salmon', 6, 16, 5), sell('campfire', 2, 1, 12, 5)],
    [buy('salmon', 13, 16, 20), enchanted('fishing_rod', 3, 3, 10, 0.2)],
    [buy('tropical_fish', 6, 12, 30)],
    [buy('pufferfish', 4, 12, 30), buy('oak_boat', 1, 12, 30)],
  ],
  shepherd: [
    [buy('white_wool', 18, 16, 2), buy('brown_wool', 18, 16, 2), buy('black_wool', 18, 16, 2), buy('gray_wool', 18, 16, 2), sell('shears', 2, 1, 12, 1)],
    [
      ...['white', 'gray', 'black', 'light_blue', 'lime'].map((c) => buy(`${c}_dye`, 12, 16, 10)),
      ...COLORS.map((c) => sell(`${c}_wool`, 1, 1, 16, 5)),
      ...COLORS.map((c) => sell(`${c}_carpet`, 1, 4, 16, 5)),
    ],
    [...['yellow', 'light_gray', 'orange', 'red', 'pink'].map((c) => buy(`${c}_dye`, 12, 16, 20)), ...COLORS.map((c) => sell(`${c}_bed`, 3, 1, 12, 10))],
    [...['brown', 'purple', 'blue', 'green', 'magenta', 'cyan'].map((c) => buy(`${c}_dye`, 12, 16, 30)), ...COLORS.map((c) => sell(`${c}_banner`, 3, 1, 12, 15))],
    [sell('painting', 2, 3, 12, 30)],
  ],
  fletcher: [
    [buy('stick', 32, 16, 2), sell('arrow', 1, 16, 12, 1), swap('gravel', 10, 1, 'flint', 10, 12, 1)],
    [buy('flint', 26, 12, 10), sell('bow', 2, 1, 12, 5)],
    [buy('string', 14, 16, 20), sell('crossbow', 3, 1, 12, 10)],
    [buy('feather', 24, 16, 30), enchanted('bow', 2, 3, 15)],
    [buy('tripwire_hook', 8, 12, 30), enchanted('crossbow', 3, 3, 15), swap('arrow', 5, 2, 'tipped_arrow', 5, 12, 30)],
  ],
  librarian: [
    [buy('paper', 24, 16, 2), book(1), sell('bookshelf', 9, 1, 12, 1)],
    [buy('book', 4, 12, 10), book(5), sell('lantern', 1, 1, 12, 5)],
    [buy('ink_sac', 5, 12, 20), book(10), sell('glass', 1, 4, 12, 10)],
    [buy('writable_book', 2, 12, 30), book(15), sell('clock', 5, 1, 12, 15), sell('compass', 4, 1, 12, 15)],
    [sell('name_tag', 20, 1, 12, 30)],
  ],
  cartographer: [
    [buy('paper', 24, 16, 2), sell('map', 7, 1, 12, 1)],
    [buy('glass_pane', 11, 16, 10), swap('compass', 1, 13, 'filled_map', 1, 12, 5)],
    [buy('compass', 1, 12, 20), swap('compass', 1, 14, 'filled_map', 1, 12, 10)],
    [sell('item_frame', 7, 1, 12, 15), ...COLORS.map((c) => sell(`${c}_banner`, 3, 1, 12, 15))],
    [sell('globe_banner_pattern', 8, 1, 12, 30)],
  ],
  cleric: [
    [buy('rotten_flesh', 32, 16, 2), sell('redstone', 1, 2, 12, 1)],
    [buy('gold_ingot', 3, 12, 10), sell('lapis_lazuli', 1, 1, 12, 5)],
    [buy('rabbit_foot', 2, 12, 20), sell('glowstone', 4, 1, 12, 10)],
    [buy('scute', 4, 12, 30), buy('glass_bottle', 9, 12, 30), sell('ender_pearl', 5, 1, 12, 15)],
    [buy('nether_wart', 22, 12, 30), sell('experience_bottle', 3, 1, 12, 30)],
  ],
  armorer: [
    [buy('coal', 15, 16, 2), sell('iron_leggings', 7, 1, 12, 1, 0.2), sell('iron_boots', 4, 1, 12, 1, 0.2), sell('iron_helmet', 5, 1, 12, 1, 0.2), sell('iron_chestplate', 9, 1, 12, 1, 0.2)],
    [buy('iron_ingot', 4, 12, 10), sell('bell', 36, 1, 12, 5, 0.2), sell('chainmail_boots', 1, 1, 12, 5, 0.2), sell('chainmail_leggings', 3, 1, 12, 5, 0.2)],
    [buy('lava_bucket', 1, 12, 20), buy('diamond', 1, 12, 20), sell('chainmail_helmet', 1, 1, 12, 10, 0.2), sell('chainmail_chestplate', 4, 1, 12, 10, 0.2), sell('shield', 5, 1, 12, 10, 0.2)],
    [enchanted('diamond_leggings', 14, 3, 15, 0.2), enchanted('diamond_boots', 8, 3, 15, 0.2)],
    [enchanted('diamond_helmet', 8, 3, 30, 0.2), enchanted('diamond_chestplate', 16, 3, 30, 0.2)],
  ],
  weaponsmith: [
    [buy('coal', 15, 16, 2), sell('iron_axe', 3, 1, 12, 1, 0.2), enchanted('iron_sword', 2, 3, 1)],
    [buy('iron_ingot', 4, 12, 10), sell('bell', 36, 1, 12, 5, 0.2)],
    [buy('flint', 24, 12, 20)],
    [buy('diamond', 1, 12, 30), enchanted('diamond_axe', 12, 3, 15, 0.2)],
    [enchanted('diamond_sword', 8, 3, 30, 0.2)],
  ],
  toolsmith: [
    [buy('coal', 15, 16, 2), sell('stone_axe', 1, 1, 12, 1, 0.2), sell('stone_shovel', 1, 1, 12, 1, 0.2), sell('stone_pickaxe', 1, 1, 12, 1, 0.2), sell('stone_hoe', 1, 1, 12, 1, 0.2)],
    [buy('iron_ingot', 4, 12, 10), sell('bell', 36, 1, 12, 5, 0.2)],
    [buy('flint', 30, 12, 20), enchanted('iron_axe', 1, 3, 10, 0.2), enchanted('iron_shovel', 2, 3, 10, 0.2), enchanted('iron_pickaxe', 3, 3, 10, 0.2), sell('diamond_hoe', 4, 1, 3, 10, 0.2)],
    [buy('diamond', 1, 12, 30), enchanted('diamond_axe', 12, 3, 15, 0.2), enchanted('diamond_shovel', 5, 3, 15, 0.2)],
    [enchanted('diamond_pickaxe', 13, 3, 30, 0.2)],
  ],
  butcher: [
    [buy('chicken', 14, 16, 2), buy('porkchop', 7, 16, 2), buy('rabbit', 4, 16, 2), sell('rabbit_stew', 1, 1, 12, 1)],
    [buy('coal', 15, 16, 2), sell('cooked_porkchop', 1, 5, 16, 5), sell('cooked_chicken', 1, 8, 16, 5)],
    [buy('mutton', 7, 16, 20), buy('beef', 10, 16, 20)],
    [buy('dried_kelp_block', 10, 12, 30)],
    [buy('sweet_berries', 10, 12, 30)],
  ],
  leatherworker: [
    [buy('leather', 6, 16, 2), sell('leather_leggings', 3, 1, 12, 1, 0.2), sell('leather_chestplate', 7, 1, 12, 1, 0.2)],
    [buy('flint', 26, 12, 10), sell('leather_helmet', 5, 1, 12, 5, 0.2), sell('leather_boots', 4, 1, 12, 5, 0.2)],
    [buy('rabbit_hide', 9, 12, 20), sell('leather_chestplate', 7, 1, 12, 10, 0.2)],
    [buy('scute', 4, 12, 30), sell('leather_horse_armor', 6, 1, 12, 15, 0.2)],
    [sell('saddle', 6, 1, 12, 30, 0.2), sell('leather_helmet', 5, 1, 12, 30, 0.2)],
  ],
  mason: [
    [buy('clay_ball', 10, 16, 2), sell('brick', 1, 10, 16, 1)],
    [buy('stone', 20, 16, 10), sell('chiseled_stone_bricks', 1, 4, 16, 5)],
    [buy('granite', 16, 16, 20), buy('andesite', 16, 16, 20), buy('diorite', 16, 16, 20), sell('dripstone_block', 1, 4, 16, 10), sell('polished_andesite', 1, 4, 16, 10), sell('polished_diorite', 1, 4, 16, 10), sell('polished_granite', 1, 4, 16, 10)],
    [buy('quartz', 12, 12, 30), ...COLORS.map((c) => sell(`${c}_terracotta`, 1, 1, 12, 15)), ...COLORS.map((c) => sell(`${c}_glazed_terracotta`, 1, 1, 12, 15))],
    [sell('quartz_pillar', 1, 1, 12, 30), sell('quartz_block', 1, 1, 12, 30)],
  ],
};

/** WanderingTrader trades (1.17.1): level 1 = generic (5 picked), level 2 = rare (1 picked). */
export const WANDERING_TRADES: Listing[][] = [
  [
    sell('sea_pickle', 2, 1, 5, 1), sell('slime_ball', 4, 1, 5, 1), sell('glowstone', 2, 1, 5, 1), sell('nautilus_shell', 5, 1, 5, 1),
    sell('fern', 1, 1, 12, 1), sell('sugar_cane', 1, 1, 8, 1), sell('pumpkin', 1, 1, 4, 1), sell('kelp', 3, 1, 12, 1), sell('cactus', 3, 1, 8, 1),
    sell('dandelion', 1, 1, 12, 1), sell('poppy', 1, 1, 12, 1), sell('blue_orchid', 1, 1, 8, 1), sell('allium', 1, 1, 12, 1), sell('azure_bluet', 1, 1, 12, 1),
    sell('red_tulip', 1, 1, 12, 1), sell('orange_tulip', 1, 1, 12, 1), sell('white_tulip', 1, 1, 12, 1), sell('pink_tulip', 1, 1, 12, 1), sell('oxeye_daisy', 1, 1, 12, 1),
    sell('cornflower', 1, 1, 12, 1), sell('lily_of_the_valley', 1, 1, 7, 1), sell('wheat_seeds', 1, 1, 12, 1), sell('beetroot_seeds', 1, 1, 12, 1), sell('pumpkin_seeds', 1, 1, 12, 1),
    sell('melon_seeds', 1, 1, 12, 1), sell('acacia_sapling', 5, 1, 8, 1), sell('birch_sapling', 5, 1, 8, 1), sell('dark_oak_sapling', 5, 1, 8, 1), sell('jungle_sapling', 5, 1, 8, 1),
    sell('oak_sapling', 5, 1, 8, 1), sell('spruce_sapling', 5, 1, 8, 1),
    ...COLORS.map((c) => sell(`${c}_dye`, 1, 3, 12, 1)),
    sell('brain_coral_block', 3, 1, 8, 1), sell('bubble_coral_block', 3, 1, 8, 1), sell('fire_coral_block', 3, 1, 8, 1), sell('horn_coral_block', 3, 1, 8, 1), sell('tube_coral_block', 3, 1, 8, 1),
    sell('vine', 1, 1, 12, 1), sell('brown_mushroom', 1, 1, 12, 1), sell('red_mushroom', 1, 1, 12, 1), sell('lily_pad', 1, 2, 5, 1), sell('small_dripleaf', 1, 2, 5, 1),
    sell('sand', 1, 8, 8, 1), sell('red_sand', 1, 4, 6, 1), sell('pointed_dripstone', 1, 2, 5, 1), sell('rooted_dirt', 1, 2, 5, 1), sell('moss_block', 1, 2, 5, 1),
  ],
  [
    sell('tropical_fish_bucket', 5, 1, 4, 1), sell('pufferfish_bucket', 5, 1, 4, 1), sell('packed_ice', 3, 1, 6, 1), sell('blue_ice', 6, 1, 6, 1),
    sell('gunpowder', 1, 1, 8, 1), sell('podzol', 3, 3, 6, 1),
  ],
];

/** VillagerTrades lookup: the listings a profession offers at `level` (1–5). */
export function listingsFor(prof: Profession, level: number): Listing[] {
  return VILLAGER_TRADES[prof]?.[level - 1] ?? [];
}

/** AbstractVillager.addOffersFromItemListings: pick `n` distinct random listings. */
export function pickOffers(listings: readonly Listing[], n: number, r: JavaRandom): MerchantOffer[] {
  const pool = [...listings];
  const out: MerchantOffer[] = [];
  while (out.length < n && pool.length) {
    const l = pool.splice(r.nextInt(pool.length), 1)[0]!;
    out.push(l(r));
  }
  return out;
}

/** Villager.updateTrades: 2 offers of the given level */
export function offersForLevel(prof: Profession, level: number, r: JavaRandom): MerchantOffer[] {
  return pickOffers(listingsFor(prof, level), 2, r);
}

/** MerchantOffer.getCostA: base + demand bonus + special price, clamped to 1..max stack. */
export function costA(o: MerchantOffer): ItemStack {
  const base = o.costA.count;
  const bonus = Math.max(0, Math.floor(base * o.demand * o.priceMultiplier));
  const n = Math.max(1, Math.min(64, base + bonus + o.specialPriceDiff));
  return { id: o.costA.id, count: n, damage: 0 };
}

export const isOutOfStock = (o: MerchantOffer) => o.uses >= o.maxUses;

/** MerchantOffer.updateDemand (on restock): demand += uses − (maxUses − uses), floored at 0 when read. */
export function updateDemand(o: MerchantOffer): void {
  o.demand = o.demand + o.uses - (o.maxUses - o.uses);
}

/** MerchantOffer.resetUses */
export function resetUses(o: MerchantOffer): void {
  o.uses = 0;
}

/** Whether payment stacks satisfy an offer (MerchantOffer.satisfiedBy). */
export function satisfiedBy(o: MerchantOffer, a: ItemStack | null, b: ItemStack | null): boolean {
  const ca = costA(o);
  if (!a || a.id !== ca.id || a.count < ca.count) return false;
  if (!o.costB) return true;
  return !!b && b.id === o.costB.id && b.count >= o.costB.count;
}

/** MerchantOffer.take: consume the payment, count a use. Returns false when not satisfied. */
export function takeOffer(o: MerchantOffer, a: ItemStack, b: ItemStack | null): boolean {
  if (!satisfiedBy(o, a, b) || isOutOfStock(o)) return false;
  a.count -= costA(o).count;
  if (o.costB && b) b.count -= o.costB.count;
  o.uses++;
  return true;
}

/** Player XP from one trade (Villager.rewardTradeXp): 3–6, +5 when the villager levels up. */
export function tradeXpReward(r: JavaRandom, levelUp: boolean): number {
  return 3 + r.nextInt(4) + (levelUp ? 5 : 0);
}
