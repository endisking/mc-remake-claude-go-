/**
 * Block sound types (vanilla SoundType constants and which blocks use them). Event names are
 * the vanilla sound event ids; the client maps them to our own audio files.
 */
import { BLOCKS } from '../data';
import { STATE_TO_BLOCK } from './blockstate';

export interface SoundType {
  volume: number;
  pitch: number;
  break: string;
  step: string;
  place: string;
  hit: string;
  fall: string;
}

const group = (g: string, volume = 1, pitch = 1): SoundType => ({
  volume, pitch,
  break: `block.${g}.break`, step: `block.${g}.step`, place: `block.${g}.place`, hit: `block.${g}.hit`, fall: `block.${g}.fall`,
});

export const SOUND_TYPES = {
  wood: group('wood'),
  gravel: group('gravel'),
  grass: group('grass'),
  lily_pad: { ...group('grass'), place: 'block.lily_pad.place' },
  stone: group('stone'),
  metal: group('metal', 1, 1.5),
  glass: group('glass'),
  wool: group('wool'),
  sand: group('sand'),
  snow: group('snow'),
  powder_snow: group('powder_snow'),
  ladder: group('ladder'),
  anvil: group('anvil', 0.3, 1),
  slime_block: group('slime_block'),
  honey_block: group('honey_block'),
  wet_grass: group('wet_grass'),
  coral_block: group('coral_block'),
  bamboo: group('bamboo'),
  bamboo_sapling: { ...group('bamboo'), break: 'block.bamboo_sapling.break', place: 'block.bamboo_sapling.place', hit: 'block.bamboo_sapling.hit' },
  scaffolding: group('scaffolding'),
  sweet_berry_bush: { ...group('grass'), break: 'block.sweet_berry_bush.break', place: 'block.sweet_berry_bush.place' },
  crop: { ...group('grass'), break: 'block.crop.break', place: 'item.crop.plant' },
  hard_crop: { ...group('wood'), place: 'item.crop.plant' },
  vine: group('vine'),
  nether_wart: { ...group('stone'), break: 'block.nether_wart.break', place: 'item.nether_wart.plant' },
  lantern: group('lantern'),
  stem: group('stem'),
  nylium: group('nylium'),
  fungus: group('fungus'),
  roots: group('roots'),
  shroomlight: group('shroomlight'),
  weeping_vines: group('weeping_vines'),
  twisting_vines: { ...group('weeping_vines'), place: 'block.weeping_vines.place' },
  soul_sand: group('soul_sand'),
  soul_soil: group('soul_soil'),
  basalt: group('basalt'),
  wart_block: group('wart_block'),
  netherrack: group('netherrack'),
  nether_bricks: group('nether_bricks'),
  nether_sprouts: group('nether_sprouts'),
  nether_ore: group('nether_ore'),
  bone_block: group('bone_block'),
  netherite_block: group('netherite_block'),
  ancient_debris: group('ancient_debris'),
  lodestone: group('lodestone'),
  chain: group('chain'),
  nether_gold_ore: group('nether_gold_ore'),
  gilded_blackstone: group('gilded_blackstone'),
  candle: group('candle'),
  amethyst: group('amethyst_block'),
  amethyst_cluster: group('amethyst_cluster'),
  small_amethyst_bud: { ...group('amethyst_cluster'), break: 'block.small_amethyst_bud.break', place: 'block.small_amethyst_bud.place' },
  medium_amethyst_bud: { ...group('amethyst_cluster'), break: 'block.medium_amethyst_bud.break', place: 'block.medium_amethyst_bud.place' },
  large_amethyst_bud: { ...group('amethyst_cluster'), break: 'block.large_amethyst_bud.break', place: 'block.large_amethyst_bud.place' },
  tuff: group('tuff'),
  calcite: group('calcite'),
  dripstone_block: group('dripstone_block'),
  pointed_dripstone: group('pointed_dripstone'),
  copper: group('copper'),
  cave_vines: group('cave_vines'),
  spore_blossom: group('spore_blossom'),
  azalea: group('azalea'),
  flowering_azalea: group('flowering_azalea'),
  moss_carpet: group('moss_carpet'),
  moss: group('moss'),
  big_dripleaf: group('big_dripleaf'),
  small_dripleaf: group('small_dripleaf'),
  rooted_dirt: group('rooted_dirt'),
  hanging_roots: group('hanging_roots'),
  azalea_leaves: group('azalea_leaves'),
  sculk_sensor: group('sculk_sensor'),
  // 1.17.1 has no glow lichen sound events: GLOW_LICHEN plays the vine sounds
  glow_lichen: group('vine'),
  deepslate: group('deepslate'),
  deepslate_bricks: group('deepslate_bricks'),
  deepslate_tiles: group('deepslate_tiles'),
  polished_deepslate: group('polished_deepslate'),
} satisfies Record<string, SoundType>;

export type SoundTypeName = keyof typeof SOUND_TYPES;

const WOOD_TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped'];

/** Which SoundType a block uses (vanilla Blocks.java `.sound(...)`). */
export function soundTypeNameOf(n: string): SoundTypeName {
  const exact: Record<string, SoundTypeName> = {
    gravel: 'gravel', dirt: 'gravel', coarse_dirt: 'gravel', podzol: 'gravel', farmland: 'gravel', clay: 'gravel',
    grass_block: 'grass', mycelium: 'grass', dirt_path: 'grass', sponge: 'grass', wet_sponge: 'grass', hay_block: 'grass', tnt: 'grass',
    dried_kelp_block: 'grass', target: 'grass', sugar_cane: 'grass', dead_bush: 'grass', grass: 'grass', fern: 'grass',
    tall_grass: 'grass', large_fern: 'grass', lily_pad: 'lily_pad', kelp: 'wet_grass', kelp_plant: 'wet_grass', seagrass: 'wet_grass',
    tall_seagrass: 'wet_grass', sea_pickle: 'slime_block', sand: 'sand', red_sand: 'sand', soul_sand: 'soul_sand', soul_soil: 'soul_soil',
    snow: 'snow', snow_block: 'snow', powder_snow: 'powder_snow', ladder: 'ladder', anvil: 'anvil', chipped_anvil: 'anvil',
    damaged_anvil: 'anvil', bell: 'anvil', slime_block: 'slime_block', honey_block: 'honey_block', bamboo: 'bamboo',
    bamboo_sapling: 'bamboo_sapling', scaffolding: 'scaffolding', sweet_berry_bush: 'sweet_berry_bush', wheat: 'crop', carrots: 'crop',
    potatoes: 'crop', beetroots: 'crop', melon_stem: 'hard_crop', pumpkin_stem: 'hard_crop', attached_melon_stem: 'wood',
    attached_pumpkin_stem: 'wood', cocoa: 'wood', vine: 'vine', nether_wart: 'nether_wart', lantern: 'lantern', soul_lantern: 'lantern',
    shroomlight: 'shroomlight', weeping_vines: 'weeping_vines', weeping_vines_plant: 'weeping_vines', twisting_vines: 'twisting_vines',
    twisting_vines_plant: 'twisting_vines', basalt: 'basalt', polished_basalt: 'basalt', smooth_basalt: 'basalt',
    nether_wart_block: 'wart_block', warped_wart_block: 'wart_block', netherrack: 'netherrack', nether_sprouts: 'nether_sprouts',
    nether_quartz_ore: 'nether_ore', bone_block: 'bone_block', netherite_block: 'netherite_block', ancient_debris: 'ancient_debris',
    lodestone: 'lodestone', chain: 'chain', nether_gold_ore: 'nether_gold_ore', gilded_blackstone: 'gilded_blackstone',
    amethyst_block: 'amethyst', budding_amethyst: 'amethyst', amethyst_cluster: 'amethyst_cluster', small_amethyst_bud: 'small_amethyst_bud',
    medium_amethyst_bud: 'medium_amethyst_bud', large_amethyst_bud: 'large_amethyst_bud', tuff: 'tuff', calcite: 'calcite',
    dripstone_block: 'dripstone_block', pointed_dripstone: 'pointed_dripstone', cave_vines: 'cave_vines', cave_vines_plant: 'cave_vines',
    spore_blossom: 'spore_blossom', azalea: 'azalea', flowering_azalea: 'flowering_azalea', moss_carpet: 'moss_carpet', moss_block: 'moss',
    big_dripleaf: 'big_dripleaf', big_dripleaf_stem: 'big_dripleaf', small_dripleaf: 'small_dripleaf', rooted_dirt: 'rooted_dirt',
    hanging_roots: 'hanging_roots', azalea_leaves: 'azalea_leaves', flowering_azalea_leaves: 'azalea_leaves', sculk_sensor: 'sculk_sensor',
    glow_lichen: 'glow_lichen', deepslate: 'deepslate', cobbled_deepslate: 'deepslate', infested_deepslate: 'deepslate',
    polished_deepslate: 'polished_deepslate', deepslate_bricks: 'deepslate_bricks', cracked_deepslate_bricks: 'deepslate_bricks',
    deepslate_tiles: 'deepslate_tiles', cracked_deepslate_tiles: 'deepslate_tiles', chiseled_deepslate: 'deepslate_bricks',
    crimson_nylium: 'nylium', warped_nylium: 'nylium', crimson_fungus: 'fungus', warped_fungus: 'fungus', crimson_roots: 'roots',
    warped_roots: 'roots', cactus: 'wool', cake: 'wool', iron_bars: 'metal', hopper: 'metal',
    heavy_weighted_pressure_plate: 'wood', light_weighted_pressure_plate: 'wood', lightning_rod: 'copper', mushroom_stem: 'wood',
    brown_mushroom_block: 'wood', red_mushroom_block: 'wood', note_block: 'wood', jukebox: 'wood', bookshelf: 'wood',
    crafting_table: 'wood', chest: 'wood', trapped_chest: 'wood', barrel: 'wood', composter: 'wood', lectern: 'wood', loom: 'wood',
    cartography_table: 'wood', fletching_table: 'wood', smithing_table: 'wood', beehive: 'wood', bee_nest: 'wood', campfire: 'wood',
    soul_campfire: 'wood', daylight_detector: 'wood', ice: 'glass', packed_ice: 'glass', blue_ice: 'glass', frosted_ice: 'glass',
    sea_lantern: 'glass', glowstone: 'glass', beacon: 'glass', redstone_lamp: 'glass', conduit: 'glass', end_portal_frame: 'glass',
    nether_portal: 'glass', tinted_glass: 'glass', candle: 'candle', iron_door: 'metal', iron_trapdoor: 'metal', rail: 'metal',
    powered_rail: 'metal', detector_rail: 'metal', activator_rail: 'metal', cauldron: 'stone', spawner: 'metal',
    // Blocks.java exceptions that the name rules below would get wrong
    torch: 'wood', wall_torch: 'wood', soul_torch: 'wood', soul_wall_torch: 'wood', redstone_torch: 'wood', redstone_wall_torch: 'wood',
    fire: 'wool', soul_fire: 'wool', lever: 'wood', pumpkin: 'wood', carved_pumpkin: 'wood', jack_o_lantern: 'wood', melon: 'wood',
    repeater: 'wood', comparator: 'wood', end_rod: 'wood', chorus_plant: 'wood', chorus_flower: 'wood', turtle_egg: 'metal',
    candle_cake: 'wool', honeycomb_block: 'coral_block', brewing_stand: 'stone', copper_ore: 'stone', raw_copper_block: 'stone',
    deepslate_copper_ore: 'deepslate', stripped_crimson_stem: 'stem', stripped_warped_stem: 'stem', stripped_crimson_hyphae: 'stem',
    stripped_warped_hyphae: 'stem',
  };
  if (exact[n]) return exact[n]!;
  // flower pots (and everything potted in them) use the pot's default stone sounds
  if (n.startsWith('potted_')) return 'stone';
  // dead coral blocks and dead coral plants are plain stone (Material.STONE, no .sound)
  if (n.startsWith('dead_') && n.includes('coral')) return 'stone';
  if (n.endsWith('_candle') || n.endsWith('_candle_cake')) return n.endsWith('cake') ? 'wool' : 'candle';
  if (n.includes('nether_brick')) return 'nether_bricks';
  if (n.startsWith('crimson_') || n.startsWith('warped_')) {
    if (n.endsWith('_stem') || n.endsWith('_hyphae')) return 'stem';
  }
  if (n.endsWith('_leaves') || n.endsWith('_sapling') || ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
    'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac',
    'rose_bush', 'peony', 'brown_mushroom', 'red_mushroom'].includes(n)) return 'grass';
  if (n.endsWith('_wool') || n.endsWith('_carpet')) return 'wool';
  if (n.endsWith('_bed') || n.endsWith('_banner') || n.endsWith('_sign')) return 'wood';
  if (n.endsWith('glass') || n.endsWith('glass_pane')) return 'glass';
  if (n.endsWith('concrete_powder')) return 'sand';
  if (n.endsWith('coral_block')) return 'coral_block';
  if (n.endsWith('_coral') || n.endsWith('_coral_fan') || n.endsWith('_coral_wall_fan')) return 'wet_grass';
  if (n.includes('copper') || n.includes('cut_copper')) return 'copper';
  if (n.endsWith('_block') && ['iron', 'gold', 'diamond', 'emerald', 'redstone', 'lapis', 'coal'].some((m) => n.startsWith(m))) {
    return n.startsWith('lapis') || n.startsWith('coal') ? 'stone' : 'metal';
  }
  if (n.startsWith('raw_') && n.endsWith('_block')) return 'stone';
  if (n.endsWith('shulker_box')) return 'stone';
  if (n.includes('deepslate')) {
    if (n.includes('tile')) return 'deepslate_tiles';
    if (n.includes('brick')) return 'deepslate_bricks';
    if (n.startsWith('polished')) return 'polished_deepslate';
    return 'deepslate';
  }
  if (n.includes('blackstone')) return 'stone';
  for (const w of WOOD_TYPES) if (n.startsWith(`${w}_`) || n.startsWith(`stripped_${w}_`)) return 'wood';
  return 'stone';
}

/** SoundType per block state. */
const BY_BLOCK: SoundType[] = BLOCKS.map((b) => SOUND_TYPES[soundTypeNameOf(b.name)]);

export function soundTypeOf(state: number): SoundType {
  return BY_BLOCK[STATE_TO_BLOCK[state]!]!;
}
