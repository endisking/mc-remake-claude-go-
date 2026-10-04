/**
 * Creative inventory tabs (vanilla 1.17.1 CreativeModeTab). Tab contents are listed in item
 * registry order like vanilla's Item.fillItemCategory pass; each item's tab follows its
 * 1.17.1 Item.Properties().tab(...) assignment (minecraft-data has no tab field, so the
 * assignment is written out here by family). Items with no tab (command blocks, barrier,
 * structure blocks, spawner, debug stick, knowledge book, bundle, …) are absent like in vanilla.
 */
import { ITEMS } from '../data';

export type CreativeTab = 'building_blocks' | 'decorations' | 'redstone' | 'transportation' | 'misc' | 'food' | 'tools' | 'combat' | 'brewing';

const NO_TAB = new Set([
  'air', 'command_block', 'repeating_command_block', 'chain_command_block', 'command_block_minecart', 'barrier', 'light', 'structure_block',
  'structure_void', 'jigsaw', 'spawner', 'debug_stick', 'knowledge_book', 'bundle', 'petrified_oak_slab', 'farmland', 'dirt_path',
  'budding_amethyst', 'written_book', 'filled_map', 'enchanted_book', 'chorus_plant', 'end_portal_frame', 'infested_deepslate', 'reinforced_deepslate',
]);

const REDSTONE = new Set([
  'redstone', 'redstone_torch', 'redstone_block', 'repeater', 'comparator', 'piston', 'sticky_piston', 'slime_block', 'honey_block',
  'observer', 'hopper', 'dispenser', 'dropper', 'lectern', 'target', 'lever', 'lightning_rod', 'daylight_detector', 'sculk_sensor',
  'tripwire_hook', 'trapped_chest', 'tnt', 'redstone_lamp', 'note_block',
]);

const TRANSPORT = new Set(['powered_rail', 'detector_rail', 'rail', 'activator_rail', 'saddle', 'minecart', 'chest_minecart', 'furnace_minecart', 'tnt_minecart', 'hopper_minecart', 'carrot_on_a_stick', 'warped_fungus_on_a_stick', 'elytra']);

const FOOD = new Set([
  'apple', 'mushroom_stew', 'bread', 'porkchop', 'cooked_porkchop', 'golden_apple', 'enchanted_golden_apple', 'cod', 'salmon', 'tropical_fish',
  'pufferfish', 'cooked_cod', 'cooked_salmon', 'cake', 'cookie', 'melon_slice', 'dried_kelp', 'beef', 'cooked_beef', 'chicken', 'cooked_chicken',
  'rotten_flesh', 'spider_eye', 'carrot', 'potato', 'baked_potato', 'poisonous_potato', 'pumpkin_pie', 'rabbit', 'cooked_rabbit',
  'rabbit_stew', 'mutton', 'cooked_mutton', 'chorus_fruit', 'beetroot', 'beetroot_soup', 'suspicious_stew', 'sweet_berries', 'glow_berries', 'honey_bottle',
]);

const TOOLS = new Set(['flint_and_steel', 'compass', 'fishing_rod', 'clock', 'spyglass', 'shears', 'lead', 'name_tag']);

const COMBAT = new Set(['turtle_helmet', 'bow', 'arrow', 'spectral_arrow', 'tipped_arrow', 'shield', 'totem_of_undying', 'trident', 'crossbow', 'iron_horse_armor', 'golden_horse_armor', 'diamond_horse_armor', 'leather_horse_armor']);

const BREWING = new Set(['ghast_tear', 'potion', 'glass_bottle', 'fermented_spider_eye', 'blaze_powder', 'magma_cream', 'brewing_stand', 'cauldron', 'glistering_melon_slice', 'rabbit_foot', 'dragon_breath', 'splash_potion', 'lingering_potion', 'phantom_membrane', 'sugar', 'nether_wart', 'golden_carrot']);

const DECOR_NAMES = new Set([
  'cobweb', 'grass', 'fern', 'azalea', 'flowering_azalea', 'dead_bush', 'seagrass', 'sea_pickle', 'dandelion', 'poppy', 'blue_orchid', 'allium',
  'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
  'spore_blossom', 'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots', 'nether_sprouts',
  'weeping_vines', 'twisting_vines', 'sugar_cane', 'kelp', 'moss_carpet', 'moss_block', 'hanging_roots', 'big_dripleaf', 'small_dripleaf', 'bamboo',
  'torch', 'end_rod', 'chorus_flower', 'chest', 'crafting_table', 'furnace', 'ladder', 'snow', 'cactus', 'jukebox', 'soul_torch', 'brown_mushroom_block',
  'red_mushroom_block', 'mushroom_stem', 'iron_bars', 'chain', 'glass_pane', 'vine', 'glow_lichen', 'lily_pad', 'nether_brick_fence', 'enchanting_table',
  'dragon_egg', 'ender_chest', 'anvil', 'chipped_anvil', 'damaged_anvil', 'sunflower', 'lilac', 'rose_bush', 'peony', 'tall_grass', 'large_fern',
  'scaffolding', 'painting', 'item_frame', 'glow_item_frame', 'flower_pot', 'skeleton_skull', 'wither_skeleton_skull',
  'player_head', 'zombie_head', 'creeper_head', 'dragon_head', 'armor_stand', 'end_crystal', 'loom', 'composter', 'barrel', 'smoker', 'blast_furnace',
  'cartography_table', 'fletching_table', 'grindstone', 'smithing_table', 'stonecutter', 'bell', 'lantern', 'soul_lantern', 'campfire', 'soul_campfire',
  'shroomlight', 'bee_nest', 'beehive', 'honeycomb_block', 'lodestone', 'respawn_anchor', 'small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud',
  'amethyst_cluster', 'pointed_dripstone', 'shulker_box', 'candle',
]);

function tabOf(n: string): CreativeTab | null {
  if (NO_TAB.has(n)) return null;
  if (REDSTONE.has(n) || n.endsWith('_button') || n.endsWith('_pressure_plate') || n.endsWith('_door') || n.endsWith('_trapdoor') || n.endsWith('_fence_gate')) return 'redstone';
  if (TRANSPORT.has(n) || n.endsWith('_boat')) return 'transportation';
  if (FOOD.has(n)) return 'food';
  if (BREWING.has(n)) return 'brewing';
  if (COMBAT.has(n) || n.endsWith('_sword') || /_(helmet|chestplate|leggings|boots)$/.test(n)) return 'combat';
  if (MISC_ITEMS.has(n)) return 'misc';
  if (TOOLS.has(n) || /_(shovel|pickaxe|axe|hoe)$/.test(n)) return 'tools';
  if (
    DECOR_NAMES.has(n) || n.endsWith('_sapling') || n.endsWith('_leaves') || n.endsWith('_carpet') || n.endsWith('_fence') || n.endsWith('_wall') ||
    n.endsWith('_stained_glass_pane') || n.endsWith('_glazed_terracotta') || n.endsWith('_bed') || n.endsWith('_banner') || n.endsWith('_sign') ||
    n.endsWith('_shulker_box') || n.endsWith('_candle') || n.startsWith('infested_') || n.includes('coral')
  ) {
    // coral blocks are building blocks; coral plants and fans decorate
    if (n.endsWith('coral_block')) return 'building_blocks';
    return 'decorations';
  }
  // everything else that places a block is a building block; the rest is miscellaneous
  const item = ITEMS.find((i) => i.name === n);
  if (!item) return null;
  if (MISC_ITEMS.has(n) || n.endsWith('_spawn_egg') || n.startsWith('music_disc_') || n.endsWith('_dye') || n.endsWith('_banner_pattern')) return 'misc';
  return BLOCK_ITEMS.has(n) ? 'building_blocks' : 'misc';
}

const MISC_ITEMS = new Set(['beacon', 'conduit', 'turtle_egg', 'wheat', 'bucket', 'water_bucket', 'lava_bucket', 'powder_snow_bucket', 'milk_bucket', 'pufferfish_bucket', 'salmon_bucket', 'cod_bucket', 'tropical_fish_bucket', 'axolotl_bucket']);

/** Item names that are block items (built lazily from the generated block list). */
let BLOCK_ITEMS: Set<string> = new Set();

let tabs: Record<CreativeTab, number[]> | null = null;

/** Item ids per creative tab, in registry order. */
export function creativeTabItems(blockNames: Iterable<string>): Record<CreativeTab, number[]> {
  if (tabs) return tabs;
  BLOCK_ITEMS = new Set(blockNames);
  const t: Record<CreativeTab, number[]> = { building_blocks: [], decorations: [], redstone: [], transportation: [], misc: [], food: [], tools: [], combat: [], brewing: [] };
  for (const it of ITEMS) {
    const tab = tabOf(it.name);
    if (tab) t[tab].push(it.id);
  }
  tabs = t;
  return t;
}

export const TAB_TITLES: Record<CreativeTab | 'search' | 'inventory' | 'hotbar', string> = {
  building_blocks: 'Building Blocks', decorations: 'Decoration Blocks', redstone: 'Redstone', transportation: 'Transportation',
  misc: 'Miscellaneous', food: 'Foodstuffs', tools: 'Tools', combat: 'Combat', brewing: 'Brewing',
  search: 'Search Items', inventory: 'Survival Inventory', hotbar: 'Saved Hotbars',
};
