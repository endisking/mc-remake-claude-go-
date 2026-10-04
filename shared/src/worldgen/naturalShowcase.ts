/**
 * Natural-blocks showcase for visual checks of every block world generation places:
 * a platform at y=100 (x 0..63, z 16..47) with rows of terrain cubes, plants on grass,
 * an ocean pool (seagrass, kelp, corals, sea pickles, lily pads) and a cave strip
 * (dripstone, lichen, amethyst, lush-cave plants). Enabled with `scene=natural`.
 */
import type { Chunk } from '../world/chunk';
import { stateOf, type Props } from '../world/blockstate';

type Placement = [number, number, number, string, Props?];

const CUBES = [
  'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt', 'moss_block', 'packed_ice', 'blue_ice', 'snow_block', 'clay', 'gravel', 'red_sand', 'sand',
  'terracotta', 'white_terracotta', 'orange_terracotta', 'yellow_terracotta', 'brown_terracotta', 'red_terracotta', 'light_gray_terracotta',
  'sandstone', 'cut_sandstone', 'chiseled_sandstone', 'red_sandstone', 'cut_red_sandstone', 'chiseled_red_sandstone',
  'amethyst_block', 'budding_amethyst', 'calcite', 'smooth_basalt', 'tuff', 'deepslate', 'dripstone_block', 'andesite', 'diorite', 'granite',
  'copper_ore', 'deepslate_copper_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_diamond_ore', 'deepslate_redstone_ore', 'deepslate_lapis_ore',
  'deepslate_emerald_ore', 'deepslate_coal_ore', 'mossy_cobblestone', 'spawner', 'obsidian', 'magma_block', 'stone_bricks', 'mossy_stone_bricks',
  'cracked_stone_bricks', 'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'blackstone', 'crimson_nylium', 'warped_nylium', 'nether_wart_block',
  'warped_wart_block', 'shroomlight', 'glowstone', 'ancient_debris', 'end_stone',
];
const CUBES2: [string, Props?][] = [
  ['brown_mushroom_block'], ['red_mushroom_block'], ['mushroom_stem'], ['red_mushroom_block', { north: false, west: false }],
  ['pumpkin'], ['carved_pumpkin', { facing: 'south' }], ['jack_o_lantern', { facing: 'south' }], ['melon'],
  ['bee_nest', { facing: 'south' }], ['bee_nest', { facing: 'south', honey_level: 5 }], ['chest', { facing: 'south' }],
  ['chest', { facing: 'south', type: 'right' }], ['chest', { facing: 'south', type: 'left' }], ['trapped_chest', { facing: 'south' }],
  ...['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'].flatMap((w): [string, Props?][] => [[`${w}_log`], [`${w}_leaves`]]),
  ['azalea_leaves'], ['flowering_azalea_leaves'], ['crimson_stem'], ['warped_stem'], ['oak_wood'], ['stripped_oak_log'],
  ['tube_coral_block'], ['dead_brain_coral_block'],
];
const PLANTS: [string, Props?, boolean?][] = [
  ['oak_sapling'], ['spruce_sapling'], ['birch_sapling'], ['jungle_sapling'], ['acacia_sapling'], ['dark_oak_sapling'],
  ['grass'], ['fern'], ['tall_grass', {}, true], ['large_fern', {}, true],
  ['dandelion'], ['poppy'], ['blue_orchid'], ['allium'], ['azure_bluet'], ['red_tulip'], ['orange_tulip'], ['white_tulip'], ['pink_tulip'],
  ['oxeye_daisy'], ['cornflower'], ['lily_of_the_valley'], ['wither_rose'],
  ['sunflower', {}, true], ['lilac', {}, true], ['rose_bush', {}, true], ['peony', {}, true],
  ['sugar_cane'], ['dead_bush'], ['sweet_berry_bush', { age: 0 }], ['sweet_berry_bush', { age: 1 }], ['sweet_berry_bush', { age: 2 }], ['sweet_berry_bush', { age: 3 }],
  ['brown_mushroom'], ['red_mushroom'], ['azalea'], ['flowering_azalea'], ['bamboo_sapling'], ['cactus'], ['moss_carpet'],
  ['crimson_fungus'], ['warped_fungus'], ['crimson_roots'], ['warped_roots'], ['nether_sprouts'], ['snow', { layers: 2 }], ['fire'], ['soul_fire'],
];
const CORALS = ['tube', 'brain', 'bubble', 'fire', 'horn'];

function placements(): Placement[] {
  const p: Placement[] = [];
  const Y = 101;
  // row 1: terrain cubes (z 17 and 19)
  CUBES.forEach((n, i) => p.push([i % 64, Y, 17 + 2 * Math.floor(i / 64), n]));
  CUBES2.forEach(([n, props], i) => p.push([i, Y, 19, n, props]));
  // row 2: plants on grass (z 22)
  PLANTS.forEach(([n, props, tall], i) => {
    const x = i;
    if (n === 'cactus' || n === 'dead_bush' || n === 'sugar_cane') p.push([x, Y - 1, 22, 'sand']);
    if (n.startsWith('crimson') || n.startsWith('warped') || n === 'nether_sprouts' || n === 'fire') p.push([x, Y - 1, 22, n.startsWith('warped') ? 'warped_nylium' : 'netherrack']);
    if (n === 'soul_fire') p.push([x, Y - 1, 22, 'soul_soil']);
    if (n === 'sugar_cane') p.push([x, Y + 1, 22, n]);
    if (tall) p.push([x, Y, 22, n, { ...props, half: 'lower' }], [x, Y + 1, 22, n, { ...props, half: 'upper' }]);
    else p.push([x, Y, 22, n, props]);
  });
  // bamboo stalks of increasing height with leaves
  for (let k = 0; k < 4; k++) {
    const x = 50 + k * 2, h = 3 + k * 2;
    for (let y = 0; y < h; y++) p.push([x, Y + y, 22, 'bamboo', { age: k > 1 ? 1 : 0, leaves: y >= h - 1 ? 'large' : y >= h - 3 ? 'small' : 'none' }]);
  }
  // row 3: ocean pool (x 0..47, z 24..29; water y 98..100, sand floor y 97)
  for (let z = 24; z <= 29; z++) for (let x = 0; x < 48; x++) {
    p.push([x, 97, z, 'sand']);
    for (let y = 98; y <= 100; y++) p.push([x, y, z, 'water']);
  }
  let x = 0;
  p.push([x++, 98, 25, 'seagrass']);
  p.push([x, 98, 25, 'tall_seagrass', { half: 'lower' }], [x++, 99, 25, 'tall_seagrass', { half: 'upper' }]);
  for (let k = 0; k < 3; k++, x++) {
    for (let y = 98; y < 98 + k; y++) p.push([x, y, 25, 'kelp_plant']);
    p.push([x, 98 + k, 25, 'kelp']);
  }
  for (let n = 1; n <= 4; n++) p.push([x++, 98, 25, 'sea_pickle', { pickles: n, waterlogged: true }]);
  p.push([x++, Y, 25, 'sea_pickle', { pickles: 3, waterlogged: false }]); // on the rim: dead pickles
  for (const c of CORALS) {
    p.push([x, 98, 25, `${c}_coral`, { waterlogged: true }], [x, 98, 27, `${c}_coral_fan`, { waterlogged: true }]);
    p.push([x, 98, 28, `${c}_coral_block`], [x, 98, 29, `dead_${c}_coral_block`]);
    p.push([x, 99, 27, `${c}_coral_wall_fan`, { facing: 'north', waterlogged: true }]);
    p.push([x, 99, 28, `${c}_coral_block`]);
    p.push([x + 1, 98, 25, `dead_${c}_coral`, { waterlogged: true }], [x + 1, 98, 27, `dead_${c}_coral_fan`, { waterlogged: true }]);
    x += 2;
  }
  for (let k = 0; k < 6; k++) p.push([30 + k * 2, Y, 26, 'lily_pad']);
  // row 4: cave strip (z 32..38): stone floor at 100, ceiling at 106
  for (let z = 32; z <= 38; z++) for (let xx = 0; xx < 64; xx++) p.push([xx, 106, z, 'stone']);
  for (let xx = 0; xx < 64; xx++) for (let y = Y; y < 106; y++) p.push([xx, y, 39, xx % 8 < 4 ? 'stone' : 'deepslate']);
  x = 0;
  // pointed dripstone: stalagmites (up) of 1..4 blocks, matching stalactites (down), and a merged column
  const up = [['tip'], ['frustum', 'tip'], ['base', 'frustum', 'tip'], ['base', 'middle', 'frustum', 'tip']];
  for (const col of up) {
    col.forEach((th, i) => p.push([x, Y + i, 34, 'pointed_dripstone', { thickness: th, vertical_direction: 'up' }]));
    col.forEach((th, i) => p.push([x, 105 - i, 36, 'pointed_dripstone', { thickness: th, vertical_direction: 'down' }]));
    p.push([x, Y - 1, 34, 'dripstone_block'], [x, 106, 36, 'dripstone_block']);
    x += 2;
  }
  p.push([x, Y, 34, 'pointed_dripstone', { thickness: 'base', vertical_direction: 'up' }], [x, Y + 1, 34, 'pointed_dripstone', { thickness: 'frustum', vertical_direction: 'up' }]);
  p.push([x, Y + 2, 34, 'pointed_dripstone', { thickness: 'tip_merge', vertical_direction: 'up' }], [x, Y + 3, 34, 'pointed_dripstone', { thickness: 'tip_merge', vertical_direction: 'down' }]);
  p.push([x, Y + 4, 34, 'pointed_dripstone', { thickness: 'base', vertical_direction: 'down' }]);
  x += 2;
  // glow lichen on the wall and floor; vines on the wall
  for (let k = 0; k < 3; k++) p.push([x + k, Y + 1, 38, 'glow_lichen', { south: true }], [x + k, Y, 38, 'glow_lichen', { south: true, down: true }]);
  p.push([x + 3, Y + 2, 38, 'vine', { south: true }], [x + 3, Y + 1, 38, 'vine', { south: true }]);
  x += 5;
  // amethyst geode corner: buds in every direction around a budding block
  p.push([x + 1, Y + 1, 35, 'budding_amethyst']);
  const dirs: [string, number, number, number][] = [['up', 0, 1, 0], ['down', 0, -1, 0], ['north', 0, 0, -1], ['south', 0, 0, 1], ['west', -1, 0, 0], ['east', 1, 0, 0]];
  const sizes = ['amethyst_cluster', 'large_amethyst_bud', 'medium_amethyst_bud', 'small_amethyst_bud', 'amethyst_cluster', 'large_amethyst_bud'];
  dirs.forEach(([f, dx, dy, dz], i) => p.push([x + 1 + dx, Y + 1 + dy, 35 + dz, sizes[i]!, { facing: f }]));
  x += 4;
  // cocoa on a jungle log, all ages
  for (let y = Y; y < Y + 4; y++) p.push([x + 1, y, 35, 'jungle_log']);
  p.push([x, Y, 35, 'cocoa', { age: 0, facing: 'east' }], [x + 2, Y + 1, 35, 'cocoa', { age: 1, facing: 'west' }], [x + 1, Y + 2, 36, 'cocoa', { age: 2, facing: 'north' }], [x + 1, Y + 3, 34, 'cocoa', { age: 2, facing: 'south' }]);
  x += 4;
  // lush cave plants
  p.push([x, 105, 35, 'cave_vines_plant', { berries: true }], [x, 104, 35, 'cave_vines_plant', { berries: false }], [x, 103, 35, 'cave_vines', { berries: true }]);
  p.push([x + 2, 105, 35, 'spore_blossom'], [x + 4, 105, 35, 'hanging_roots']);
  p.push([x + 6, Y, 35, 'big_dripleaf_stem', { facing: 'south' }], [x + 6, Y + 1, 35, 'big_dripleaf', { facing: 'south' }]);
  p.push([x + 8, Y, 35, 'big_dripleaf', { facing: 'south', tilt: 'partial' }], [x + 10, Y, 35, 'big_dripleaf', { facing: 'south', tilt: 'full' }]);
  p.push([x + 12, Y, 35, 'small_dripleaf', { facing: 'south', half: 'lower' }], [x + 12, Y + 1, 35, 'small_dripleaf', { facing: 'south', half: 'upper' }]);
  p.push([x + 14, 105, 35, 'weeping_vines_plant'], [x + 14, 104, 35, 'weeping_vines'], [x + 16, Y, 35, 'twisting_vines_plant'], [x + 16, Y + 1, 35, 'twisting_vines']);
  p.push([x + 18, Y, 35, 'brown_mushroom'], [x + 19, Y, 35, 'red_mushroom'], [x + 20, Y, 35, 'chest', { facing: 'south' }], [x + 21, Y, 35, 'spawner']);
  // row 5 (z 42, 45): crafted cubes and shaped blocks
  const crafted: [string, Props?][] = [
    ['crafting_table'], ['furnace', { facing: 'south' }], ['furnace', { facing: 'south', lit: true }], ['dispenser', { facing: 'south' }], ['dropper', { facing: 'south' }],
    ['observer', { facing: 'south' }], ['bookshelf'], ['jukebox'], ['note_block'], ['redstone_lamp'], ['redstone_lamp', { lit: true }], ['beehive', { facing: 'south' }],
    ['lapis_block'], ['diamond_block'], ['emerald_block'], ['gold_block'], ['iron_block'], ['coal_block'], ['redstone_block'], ['netherite_block'], ['raw_iron_block'],
    ['copper_block'], ['exposed_cut_copper'], ['weathered_copper'], ['oxidized_cut_copper'], ['quartz_block'], ['quartz_pillar'], ['chiseled_quartz_block'], ['quartz_bricks'],
    ['cobbled_deepslate'], ['polished_deepslate'], ['deepslate_tiles'], ['deepslate_bricks'], ['chiseled_deepslate'], ['polished_blackstone_bricks'], ['gilded_blackstone'],
    ['nether_bricks'], ['red_nether_bricks'], ['end_stone_bricks'], ['purpur_block'], ['purpur_pillar'], ['red_wool'], ['light_blue_concrete'], ['lime_concrete_powder'],
    ['orange_glazed_terracotta', { facing: 'south' }], ['purple_shulker_box'], ['slime_block'], ['honey_block'], ['tinted_glass'], ['bone_block'], ['dried_kelp_block'],
    ['target'], ['crying_obsidian'], ['lodestone'], ['tnt'], ['hay_block'], ['bricks'], ['sponge'], ['prismarine_bricks'], ['white_stained_glass'], ['cyan_stained_glass'],
  ];
  crafted.forEach(([n, props], i) => p.push([i, Y, 42, n, props]));
  x = 0;
  const shaped: [number, string, Props?][] = [
    [0, 'oak_door', { half: 'lower', facing: 'south' }], [0, 'spruce_door', { half: 'lower', facing: 'south' }], [0, 'iron_door', { half: 'lower', facing: 'south' }],
    [0, 'birch_trapdoor', { half: 'bottom' }], [0, 'iron_trapdoor', { open: true, facing: 'south' }], [0, 'oak_fence_gate', { facing: 'south' }], [0, 'crimson_fence_gate', { facing: 'south', open: true }],
    [0, 'oak_pressure_plate'], [0, 'light_weighted_pressure_plate'], [0, 'soul_torch'], [0, 'redstone_torch'], [0, 'redstone_torch', { lit: false }], [0, 'lantern'],
    [0, 'soul_lantern'], [0, 'chain'], [0, 'end_rod', { facing: 'up' }], [0, 'flower_pot'], [0, 'potted_poppy'], [0, 'potted_fern'], [0, 'potted_cactus'], [0, 'red_carpet'],
    [0, 'candle', { candles: 3 }], [0, 'cobweb'], [0, 'iron_bars', { east: true, west: true }], [0, 'white_stained_glass_pane', { east: true, west: true }], [0, 'dirt_path'],
    [0, 'cobblestone_stairs', { facing: 'south' }], [0, 'stone_brick_slab'], [0, 'sandstone_wall', { up: true }], [0, 'nether_brick_fence', { east: true }],
  ];
  for (const [, n, props] of shaped) {
    if (n.endsWith('_door')) p.push([x, Y + 1, 45, n, { ...props, half: 'upper' }]);
    p.push([x++, Y, 45, n, props]);
  }
  for (const [crop, ages] of [['wheat', [7]], ['carrots', [1, 3, 7]], ['potatoes', [7]], ['beetroots', [1, 3]]] as [string, number[]][])
    for (const a of ages) p.push([x, Y - 1, 45, 'farmland', { moisture: 7 }], [x++, Y, 45, crop, { age: a }]);
  p.push([x, Y - 1, 45, 'soul_sand'], [x++, Y, 45, 'nether_wart', { age: 3 }]);
  p.push([x++, Y, 45, 'pumpkin_stem', { age: 7 }], [x, Y, 45, 'attached_melon_stem', { facing: 'east' }], [x + 1, Y, 45, 'melon']);
  // row 6 (z 47): redstone components, workstations and special blocks
  const tech: [string, Props?][] = [
    ['redstone_wire', { east: 'side', power: 15 }], ['redstone_wire', { west: 'side', east: 'side', power: 9 }], ['redstone_wire', { west: 'side', power: 3 }], ['redstone_wire', {}],
    ['powered_rail', { powered: true }], ['detector_rail'], ['activator_rail'], ['repeater', { facing: 'south', delay: 3 }], ['comparator', { facing: 'south', powered: true }],
    ['piston', { facing: 'up' }], ['sticky_piston', { facing: 'south' }], ['hopper'], ['cauldron'], ['water_cauldron', { level: 3 }], ['lava_cauldron'],
    ['enchanting_table'], ['anvil', { facing: 'south' }], ['brewing_stand'], ['cake', { bites: 2 }], ['candle_cake', { lit: false }], ['campfire', { facing: 'south' }],
    ['soul_campfire', { facing: 'south' }], ['barrel', { facing: 'south' }], ['smoker', { facing: 'south' }], ['blast_furnace', { facing: 'south', lit: true }],
    ['cartography_table'], ['fletching_table'], ['smithing_table'], ['loom', { facing: 'south' }], ['composter', { level: 5 }], ['lectern', { facing: 'south' }],
    ['stonecutter', { facing: 'south' }], ['grindstone', { face: 'floor', facing: 'south' }], ['bell', { attachment: 'floor', facing: 'south' }], ['ender_chest', { facing: 'south' }],
    ['oak_sign', { rotation: 0 }], ['red_banner', { rotation: 0 }], ['creeper_head', { rotation: 0 }], ['skeleton_skull', { rotation: 0 }], ['lime_candle', { candles: 4 }],
    ['end_portal_frame', { facing: 'south', eye: true }], ['respawn_anchor', { charges: 2 }], ['beacon'], ['conduit'], ['chorus_flower'], ['dragon_egg'],
    ['turtle_egg', { eggs: 3 }], ['sculk_sensor'], ['lightning_rod'], ['tripwire_hook', { facing: 'south' }], ['daylight_detector'], ['command_block', { facing: 'south' }],
  ];
  tech.forEach(([n, props], i) => p.push([i, Y, 47, n, props]));
  return p;
}

let PLACEMENTS: Placement[] | null = null;

export function applyNaturalShowcase(c: Chunk): void {
  const bx = c.x << 4, bz = c.z << 4;
  if (bz < 16 || bz >= 48 || bx < 0 || bx >= 64) return;
  PLACEMENTS ??= placements();
  const grass = stateOf('grass_block', { snowy: false }), stone = stateOf('stone');
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      for (let y = 96; y < 112; y++) c.setState(x, y, z, 0);
      c.setState(x, 100, z, bz + z >= 32 ? stone : grass);
    }
  for (const [x, y, z, name, props] of PLACEMENTS) {
    if (x < bx || x >= bx + 16 || z < bz || z >= bz + 16) continue;
    c.setState(x - bx, y, z - bz, stateOf(name, props));
  }
}
