/**
 * Things that exist in Java Edition 1.17.1 but cannot be obtained in survival
 * (as an item), or mobs that never spawn naturally. Curated from the History
 * sections on minecraft.wiki (checked 2026-10-03). Notable 1.17.1 specifics:
 * lush caves and dripstone caves did not generate naturally until 1.18, so the
 * spore blossom was unobtainable; moss, small dripleaf, rooted dirt and pointed
 * dripstone came from wandering traders; glow berries from mineshaft chests;
 * azaleas from bone-mealing moss. Bundles and sculk sensors were not in the
 * creative inventory or craftable in 1.17.1.
 */
export const NOT_SURVIVAL_OBTAINABLE = new Set<string>([
  // technical / operator blocks
  'bedrock', 'barrier', 'light', 'structure_block', 'structure_void', 'jigsaw', 'command_block', 'chain_command_block',
  'repeating_command_block', 'spawner', 'end_portal_frame', 'end_portal', 'end_gateway', 'nether_portal', 'moving_piston',
  'piston_head', 'fire', 'soul_fire', 'bubble_column', 'frosted_ice', 'tall_seagrass', 'water', 'lava',
  // blocks without a survival item form
  'budding_amethyst', 'petrified_oak_slab', 'farmland', 'dirt_path', 'chorus_plant', 'player_head', 'player_wall_head',
  'infested_stone', 'infested_cobblestone', 'infested_stone_bricks', 'infested_mossy_stone_bricks', 'infested_cracked_stone_bricks',
  'infested_chiseled_stone_bricks', 'infested_deepslate', 'reinforced_deepslate',
  // 1.17.1-specific
  'spore_blossom', 'sculk_sensor', 'bundle',
  // items
  'debug_stick', 'knowledge_book', 'command_block_minecart',
]);

// every spawn egg is creative-only
import { ITEMS } from '../../shared/src/data';
for (const i of ITEMS) if (i.name.endsWith('_spawn_egg')) NOT_SURVIVAL_OBTAINABLE.add(i.name);

/** Mobs that exist in 1.17.1 but never spawn naturally. */
export const NOT_NATURAL_MOBS = new Set<string>(['giant', 'illusioner']);
