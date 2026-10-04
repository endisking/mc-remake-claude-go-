/**
 * Cooking recipes (vanilla 1.17.1 data pack: smelting / blasting / smoking) and furnace fuels
 * (AbstractFurnaceBlockEntity.getFuel). minecraft-data has no cooking recipes, so the 1.17.1
 * list is written out here.
 */
import { ITEMS_BY_NAME } from '../data';

export type CookingType = 'smelting' | 'blasting' | 'smoking';

export interface CookingRecipe {
  id: string;
  input: number;
  result: number;
  xp: number;
  /** ticks: 200 smelting, 100 blasting/smoking */
  time: number;
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

const FOOD: [string, string, number][] = [
  ['beef', 'cooked_beef', 0.35], ['porkchop', 'cooked_porkchop', 0.35], ['chicken', 'cooked_chicken', 0.35],
  ['cod', 'cooked_cod', 0.35], ['salmon', 'cooked_salmon', 0.35], ['mutton', 'cooked_mutton', 0.35],
  ['rabbit', 'cooked_rabbit', 0.35], ['potato', 'baked_potato', 0.35], ['kelp', 'dried_kelp', 0.1],
];

const IRON_GEAR = ['iron_pickaxe', 'iron_shovel', 'iron_axe', 'iron_hoe', 'iron_sword', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'iron_horse_armor', 'chainmail_helmet', 'chainmail_chestplate', 'chainmail_leggings', 'chainmail_boots'];
const GOLD_GEAR = ['golden_pickaxe', 'golden_shovel', 'golden_axe', 'golden_hoe', 'golden_sword', 'golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots', 'golden_horse_armor'];

const ORES: [string, string, number][] = [
  ['iron_ore', 'iron_ingot', 0.7], ['deepslate_iron_ore', 'iron_ingot', 0.7], ['raw_iron', 'iron_ingot', 0.7],
  ['gold_ore', 'gold_ingot', 1.0], ['deepslate_gold_ore', 'gold_ingot', 1.0], ['raw_gold', 'gold_ingot', 1.0], ['nether_gold_ore', 'gold_ingot', 1.0],
  ['copper_ore', 'copper_ingot', 0.7], ['deepslate_copper_ore', 'copper_ingot', 0.7], ['raw_copper', 'copper_ingot', 0.7],
  ['diamond_ore', 'diamond', 1.0], ['deepslate_diamond_ore', 'diamond', 1.0],
  ['emerald_ore', 'emerald', 1.0], ['deepslate_emerald_ore', 'emerald', 1.0],
  ['lapis_ore', 'lapis_lazuli', 0.2], ['deepslate_lapis_ore', 'lapis_lazuli', 0.2],
  ['redstone_ore', 'redstone', 0.7], ['deepslate_redstone_ore', 'redstone', 0.7],
  ['coal_ore', 'coal', 0.1], ['deepslate_coal_ore', 'coal', 0.1],
  ['nether_quartz_ore', 'quartz', 0.2], ['ancient_debris', 'netherite_scrap', 2.0],
  ...IRON_GEAR.map((g): [string, string, number] => [g, 'iron_nugget', 0.1]),
  ...GOLD_GEAR.map((g): [string, string, number] => [g, 'gold_nugget', 0.1]),
];

const SMELT_ONLY: [string, string, number][] = [
  ['sand', 'glass', 0.1], ['red_sand', 'glass', 0.1], ['cobblestone', 'stone', 0.1], ['stone', 'smooth_stone', 0.1],
  ['sandstone', 'smooth_sandstone', 0.1], ['red_sandstone', 'smooth_red_sandstone', 0.1], ['quartz_block', 'smooth_quartz', 0.1],
  ['stone_bricks', 'cracked_stone_bricks', 0.1], ['polished_blackstone_bricks', 'cracked_polished_blackstone_bricks', 0.1],
  ['nether_bricks', 'cracked_nether_bricks', 0.1], ['basalt', 'smooth_basalt', 0.1], ['cobbled_deepslate', 'deepslate', 0.1],
  ['deepslate_bricks', 'cracked_deepslate_bricks', 0.1], ['deepslate_tiles', 'cracked_deepslate_tiles', 0.1],
  ['clay_ball', 'brick', 0.3], ['clay', 'terracotta', 0.35], ['netherrack', 'nether_brick', 0.1],
  ['cactus', 'green_dye', 1.0], ['sea_pickle', 'lime_dye', 0.1], ['chorus_fruit', 'popped_chorus_fruit', 0.1], ['wet_sponge', 'sponge', 0.15],
  ...WOODS.flatMap((w) => [`${w}_log`, `${w}_wood`, `stripped_${w}_log`, `stripped_${w}_wood`]).map((l): [string, string, number] => [l, 'charcoal', 0.15]),
  ...COLORS.map((c): [string, string, number] => [`${c}_terracotta`, `${c}_glazed_terracotta`, 0.1]),
];

function id(name: string): number {
  const it = ITEMS_BY_NAME.get(name);
  if (!it) throw new Error(`smelting: unknown item ${name}`);
  return it.id;
}

function build(): Record<CookingType, Map<number, CookingRecipe>> {
  const t: Record<CookingType, Map<number, CookingRecipe>> = { smelting: new Map(), blasting: new Map(), smoking: new Map() };
  const add = (type: CookingType, list: [string, string, number][], time: number) => {
    for (const [a, b, xp] of list) t[type].set(id(a), { id: `${b}_from_${type}_${a}`, input: id(a), result: id(b), xp, time });
  };
  add('smelting', FOOD, 200);
  add('smelting', ORES, 200);
  add('smelting', SMELT_ONLY, 200);
  add('blasting', ORES, 100);
  add('smoking', FOOD, 100);
  return t;
}

export const COOKING: Record<CookingType, Map<number, CookingRecipe>> = build();

export function cookingRecipe(type: CookingType, input: number): CookingRecipe | null {
  return COOKING[type].get(input) ?? null;
}

export function recipeById(recipeId: string): CookingRecipe | null {
  for (const m of Object.values(COOKING)) for (const r of m.values()) if (r.id === recipeId) return r;
  return null;
}

// ---------------------------------------------------------------- fuel
function buildFuel(): Map<number, number> {
  const m = new Map<number, number>();
  const set = (name: string, t: number) => {
    const it = ITEMS_BY_NAME.get(name);
    if (it) m.set(it.id, t);
  };
  set('lava_bucket', 20000);
  set('coal_block', 16000);
  set('blaze_rod', 2400);
  set('coal', 1600);
  set('charcoal', 1600);
  // wooden tags (crimson/warped are NON_FLAMMABLE_WOOD and never fuel)
  for (const w of WOODS) {
    for (const s of [`${w}_log`, `${w}_wood`, `stripped_${w}_log`, `stripped_${w}_wood`, `${w}_planks`, `${w}_stairs`, `${w}_trapdoor`, `${w}_pressure_plate`, `${w}_fence`, `${w}_fence_gate`]) set(s, 300);
    set(`${w}_slab`, 150);
    set(`${w}_sign`, 200);
    set(`${w}_door`, 200);
    set(`${w}_boat`, 1200);
    set(`${w}_button`, 100);
    set(`${w}_sapling`, 100);
  }
  for (const s of ['note_block', 'bookshelf', 'lectern', 'jukebox', 'chest', 'trapped_chest', 'crafting_table', 'daylight_detector', 'bow', 'fishing_rod', 'ladder', 'crossbow', 'loom', 'barrel', 'cartography_table', 'fletching_table', 'smithing_table', 'composter']) set(s, 300);
  for (const c of COLORS) {
    set(`${c}_banner`, 300);
    set(`${c}_wool`, 100);
    set(`${c}_carpet`, 67);
  }
  for (const s of ['wooden_shovel', 'wooden_sword', 'wooden_hoe', 'wooden_axe', 'wooden_pickaxe']) set(s, 200);
  for (const s of ['stick', 'bowl', 'dead_bush', 'azalea', 'flowering_azalea']) set(s, 100);
  set('dried_kelp_block', 4001);
  set('bamboo', 50);
  set('scaffolding', 400);
  return m;
}

export const FUEL: Map<number, number> = buildFuel();

/** AbstractFurnaceBlockEntity.getBurnDuration (0 = not fuel). */
export function burnDuration(itemId: number): number {
  return FUEL.get(itemId) ?? 0;
}

export function isFuel(itemId: number): boolean {
  return FUEL.has(itemId);
}
