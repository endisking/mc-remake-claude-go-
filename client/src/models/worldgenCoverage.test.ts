/**
 * Every block that world generation can place must have a real model: no missing-texture
 * quads, no empty geometry (except air and fluids), and the expected render layer / tint.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BLOCKS } from '@shared/data';
import { LIGHT_EMIT } from '@shared/world/blockinfo';
import { propsOf, stateOf } from '@shared/world/blockstate';
import { bakeAll, PASS_CUTOUT, PASS_SOLID, PASS_TRANSLUCENT, type BakeResult } from './bake';
import { blockStateDef, FLUID_BLOCKS } from './blockstates';
import { textureInfoMap, type TextureManifest } from '../render/blockmodels';
import { TINT_KIND, TINT_CONST, TINT_CONST_COLOR, TINT_FOLIAGE, TINT_GRASS, TINT_NONE } from '../render/tints';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}client/public/textures/blocks.json`, 'utf8')) as TextureManifest;
const worldgen = JSON.parse(readFileSync(`${root}shared/src/data/generated/worldgen.json`, 'utf8')) as Record<string, unknown>;

/** Every `Name` in configured features, surface builders, carvers and noise settings. */
function worldgenBlockNames(): Set<string> {
  const out = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object')
      for (const [k, v] of Object.entries(o)) {
        if (k === 'Name' && typeof v === 'string') out.add(v.replace('minecraft:', ''));
        else walk(v);
      }
  };
  for (const k of ['configured_features', 'configured_surface_builders', 'configured_carvers', 'noise_settings']) walk(worldgen[k]);
  return out;
}

/** Blocks placed by hard-coded features and structures (not named in the JSON). */
const HARDCODED = [
  'oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'oak_wood', 'spruce_wood', 'birch_wood', 'jungle_wood', 'acacia_wood', 'dark_oak_wood',
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'azalea_leaves', 'flowering_azalea_leaves',
  'vine', 'cocoa', 'bee_nest', 'grass', 'fern', 'tall_grass', 'large_fern',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
  'sunflower', 'lilac', 'rose_bush', 'peony', 'sugar_cane', 'cactus', 'pumpkin', 'melon', 'dead_bush', 'sweet_berry_bush', 'lily_pad',
  'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'sea_pickle', 'brown_mushroom', 'red_mushroom', 'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem',
  'bamboo', 'bamboo_sapling',
  ...['tube', 'brain', 'bubble', 'fire', 'horn'].flatMap((c) => [`${c}_coral`, `${c}_coral_fan`, `${c}_coral_wall_fan`, `${c}_coral_block`, `dead_${c}_coral`, `dead_${c}_coral_fan`, `dead_${c}_coral_wall_fan`, `dead_${c}_coral_block`]),
  'podzol', 'mycelium', 'coarse_dirt', 'packed_ice', 'blue_ice', 'ice', 'snow', 'snow_block', 'clay', 'gravel', 'sand', 'red_sand',
  'terracotta', ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => `${c}_terracotta`),
  'sandstone', 'red_sandstone', 'cut_sandstone', 'chiseled_sandstone', 'smooth_sandstone', 'cut_red_sandstone', 'chiseled_red_sandstone', 'smooth_red_sandstone',
  'amethyst_block', 'budding_amethyst', 'small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud', 'amethyst_cluster',
  'calcite', 'smooth_basalt', 'tuff', 'deepslate', 'copper_ore', 'deepslate_copper_ore', 'pointed_dripstone', 'dripstone_block', 'glow_lichen',
  'mossy_cobblestone', 'cobblestone', 'spawner', 'chest', 'obsidian', 'magma_block', 'cave_air', 'bubble_column',
  'moss_block', 'moss_carpet', 'rooted_dirt', 'hanging_roots', 'cave_vines', 'cave_vines_plant', 'spore_blossom', 'azalea', 'flowering_azalea',
  'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf', 'andesite', 'diorite', 'granite', 'infested_stone', 'infested_deepslate',
  'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'fire', 'soul_fire',
  'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'blackstone', 'crimson_nylium', 'warped_nylium', 'crimson_fungus', 'warped_fungus',
  'crimson_roots', 'warped_roots', 'nether_sprouts', 'nether_wart_block', 'warped_wart_block', 'shroomlight', 'glowstone', 'ancient_debris',
  'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'nether_gold_ore', 'nether_quartz_ore', 'end_stone', 'nether_portal',
  // common structure blocks (villages, temples, dungeons, ruins)
  'cobblestone_stairs', 'cobblestone_slab', 'mossy_cobblestone_stairs', 'mossy_cobblestone_slab', 'stone_brick_stairs', 'stone_brick_slab', 'stone_brick_wall',
  'mossy_stone_brick_wall', 'mossy_stone_brick_stairs', 'sandstone_stairs', 'sandstone_slab', 'sandstone_wall', 'cut_sandstone_slab', 'smooth_sandstone_stairs',
  'smooth_stone_slab', 'smooth_stone', 'stone_slab', 'stone_stairs', 'oak_planks', 'spruce_planks', 'birch_planks', 'acacia_planks', 'oak_stairs', 'spruce_stairs',
  'acacia_stairs', 'oak_slab', 'spruce_slab', 'oak_fence', 'spruce_fence', 'acacia_fence', 'birch_fence', 'dark_oak_fence', 'bricks', 'brick_stairs', 'brick_slab',
  'hay_block', 'white_stained_glass', 'orange_stained_glass', 'white_stained_glass_pane', 'glass_pane', 'polished_andesite', 'polished_granite', 'polished_diorite',
  'stripped_oak_log', 'stripped_spruce_log', 'stripped_acacia_log', 'candle', 'trapped_chest', 'jack_o_lantern', 'carved_pumpkin', 'granite_wall', 'andesite_slab',
  'cobweb', 'dirt_path', 'tnt', 'iron_bars', 'prismarine_bricks', 'dark_prismarine', 'sponge', 'wet_sponge', 'gold_block', 'iron_block', 'prismarine',
];

/** Blocks the JSON names that belong to other areas (not natural terrain) and may still be pending. */
const NOT_YET = new Set<string>([]);

const EMPTY_OK = new Set(['air', 'cave_air', 'void_air', 'bubble_column', ...FLUID_BLOCKS]);

let bake: BakeResult | null = null;
const textures = textureInfoMap(manifest);
const missingLayer = textures.get('missing')!.layer;
function baked(): BakeResult {
  bake ??= bakeAll((n) => blockStateDef(n, (t) => textures.has(t)), textures, { fancy: true });
  return bake;
}
/** Multiface blocks (vine, glow lichen) with no face set are invalid and render nothing, like vanilla. */
function noFaces(name: string, s: number): boolean {
  const p = propsOf(s);
  if (name.endsWith('_wall')) return p.up === false && ['north', 'east', 'south', 'west'].every((d) => p[d] === 'none');
  if (name !== 'vine' && name !== 'glow_lichen') return false;
  return !['north', 'east', 'south', 'west', 'up', 'down'].some((d) => p[d] === true);
}
const byName = new Map(BLOCKS.map((b) => [b.name, b]));

describe('world generation block models', () => {
  const targets = [...new Set([...worldgenBlockNames(), ...HARDCODED])].filter((n) => !NOT_YET.has(n)).sort();

  it('lists a sensible number of blocks', () => {
    expect(targets.length).toBeGreaterThan(200);
  });

  it.each(targets)('%s has a complete model for every state', (name) => {
    const b = byName.get(name);
    expect(b, `unknown block ${name}`).toBeDefined();
    const { states } = baked();
    for (let s = b!.minStateId; s <= b!.maxStateId; s++) {
      const st = states[s]!;
      for (const choice of st.choices) {
        if (!EMPTY_OK.has(name) && !noFaces(name, s)) expect(choice.quads.length, `${name} state ${s} has no geometry`).toBeGreaterThan(0);
        for (const q of choice.quads) expect(q.layer, `${name} state ${s} uses the missing texture`).not.toBe(missingLayer);
      }
    }
  });
});

/** Crafted/utility blocks players place early in survival must not show the missing texture either. */
const CRAFTED_BLOCKS = [
  'crafting_table', 'furnace', 'bookshelf', 'dispenser', 'dropper', 'observer', 'jukebox', 'note_block', 'redstone_lamp', 'beehive', 'lapis_block', 'diamond_block',
  'emerald_block', 'coal_block', 'redstone_block', 'netherite_block', 'raw_iron_block', 'copper_block', 'cut_copper', 'waxed_cut_copper_stairs', 'oxidized_cut_copper_slab',
  'quartz_block', 'quartz_pillar', 'quartz_stairs', 'smooth_quartz', 'cobbled_deepslate_wall', 'deepslate_tile_stairs', 'polished_blackstone_brick_slab', 'nether_brick_fence',
  'red_nether_brick_wall', 'end_stone_brick_stairs', 'purpur_slab', 'purpur_pillar', 'red_wool', 'red_carpet', 'blue_concrete', 'lime_concrete_powder', 'cyan_glazed_terracotta',
  'purple_shulker_box', 'carrots', 'potatoes', 'beetroots', 'nether_wart', 'pumpkin_stem', 'attached_melon_stem', 'spruce_door', 'iron_door', 'birch_trapdoor', 'iron_trapdoor',
  'oak_fence_gate', 'warped_fence_gate', 'oak_pressure_plate', 'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate', 'soul_torch', 'soul_wall_torch', 'redstone_torch',
  'redstone_wall_torch', 'lantern', 'soul_lantern', 'chain', 'end_rod', 'flower_pot', 'potted_poppy', 'potted_fern', 'slime_block', 'honey_block', 'tinted_glass', 'bone_block',
  'dried_kelp_block', 'target', 'crying_obsidian', 'lodestone', 'gilded_blackstone', 'chiseled_deepslate', 'frosted_ice', 'petrified_oak_slab',
];

describe('crafted block models', () => {
  it.each(CRAFTED_BLOCKS)('%s has a complete model', (name) => {
    const b = byName.get(name)!;
    const { states } = baked();
    for (let s = b.minStateId; s <= b.maxStateId; s++)
      for (const choice of states[s]!.choices) {
        if (!noFaces(name, s)) expect(choice.quads.length, `${name} state ${s}`).toBeGreaterThan(0);
        for (const q of choice.quads) expect(q.layer, `${name} state ${s} uses the missing texture`).not.toBe(missingLayer);
      }
  });
});

describe('render layers, tints and light', () => {
  const passOf = (name: string, props: Record<string, string | number | boolean> = {}) => {
    const { states } = baked();
    const b = byName.get(name)!;
    const s = Object.keys(props).length ? stateOf(name, props) : name === 'glow_lichen' ? stateOf(name, { north: true }) : b.defaultState;
    return new Set(states[s]!.choices[0]!.quads.map((q) => q.pass));
  };

  it('plants and leaves are cutout; full natural cubes are solid', () => {
    for (const n of ['fern', 'tall_grass', 'poppy', 'oak_sapling', 'kelp', 'seagrass', 'sea_pickle', 'amethyst_cluster', 'pointed_dripstone', 'glow_lichen', 'oak_leaves', 'azalea_leaves', 'brain_coral_fan', 'cave_vines', 'spawner'])
      expect(passOf(n), n).toEqual(new Set([PASS_CUTOUT]));
    for (const n of ['podzol', 'calcite', 'tuff', 'amethyst_block', 'packed_ice', 'blue_ice', 'red_terracotta', 'sandstone', 'brown_mushroom_block', 'pumpkin', 'melon', 'obsidian', 'magma_block', 'dripstone_block', 'mossy_cobblestone'])
      expect(passOf(n), n).toEqual(new Set([PASS_SOLID]));
    expect(passOf('ice')).toEqual(new Set([PASS_TRANSLUCENT]));
  });

  it('uses vanilla tint sources', () => {
    const kind = (n: string) => TINT_KIND[byName.get(n)!.id];
    for (const n of ['grass', 'fern', 'tall_grass', 'large_fern', 'sugar_cane', 'grass_block']) expect(kind(n), n).toBe(TINT_GRASS);
    for (const n of ['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'vine']) expect(kind(n), n).toBe(TINT_FOLIAGE);
    expect(kind('spruce_leaves')).toBe(TINT_CONST);
    expect(TINT_CONST_COLOR[byName.get('spruce_leaves')!.id]).toBe(0x619961);
    expect(TINT_CONST_COLOR[byName.get('birch_leaves')!.id]).toBe(0x80a755);
    expect(TINT_CONST_COLOR[byName.get('lily_pad')!.id]).toBe(0x208030);
    for (const n of ['azalea_leaves', 'flowering_azalea_leaves', 'kelp', 'seagrass', 'poppy', 'dead_bush']) expect(kind(n), n).toBe(TINT_NONE);
  });

  it('tinted models only appear on tinted blocks', () => {
    const { states } = baked();
    for (const n of ['fern', 'tall_grass', 'large_fern', 'sugar_cane', 'lily_pad', 'oak_leaves']) {
      const b = byName.get(n)!;
      expect(states[b.defaultState]!.choices[0]!.quads.some((q) => q.tint >= 0), n).toBe(true);
    }
  });

  it('emits vanilla light levels', () => {
    expect(LIGHT_EMIT[stateOf('amethyst_cluster', {})]).toBe(5);
    expect(LIGHT_EMIT[stateOf('large_amethyst_bud', {})]).toBe(4);
    expect(LIGHT_EMIT[stateOf('medium_amethyst_bud', {})]).toBe(2);
    expect(LIGHT_EMIT[stateOf('small_amethyst_bud', {})]).toBe(1);
    expect(LIGHT_EMIT[stateOf('glow_lichen', { north: true })]).toBe(7);
    expect(LIGHT_EMIT[stateOf('magma_block', {})]).toBe(3);
    expect(LIGHT_EMIT[stateOf('brown_mushroom', {})]).toBe(1);
    for (const n of [1, 2, 3, 4]) {
      expect(LIGHT_EMIT[stateOf('sea_pickle', { pickles: n, waterlogged: true })]).toBe(3 + 3 * n);
      expect(LIGHT_EMIT[stateOf('sea_pickle', { pickles: n, waterlogged: false })]).toBe(0);
    }
    expect(LIGHT_EMIT[stateOf('cave_vines', { berries: true })]).toBe(14);
    expect(LIGHT_EMIT[stateOf('shroomlight', {})]).toBe(15);
    expect(LIGHT_EMIT[stateOf('glowstone', {})]).toBe(15);
    expect(LIGHT_EMIT[stateOf('jack_o_lantern', {})]).toBe(15);
  });
});
