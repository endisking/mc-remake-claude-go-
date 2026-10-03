/**
 * Which block items are drawn as flat sprites (vanilla "item/generated" models whose layer0
 * is the block texture) instead of a small 3D block, and which texture they use.
 */

const CROSS_PLANTS = new Set([
  'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling',
  'grass', 'fern', 'dead_bush', 'seagrass', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
  'wither_rose', 'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'warped_fungus', 'crimson_roots',
  'warped_roots', 'nether_sprouts', 'weeping_vines', 'twisting_vines', 'sugar_cane', 'kelp', 'hanging_roots',
  'cobweb', 'ladder', 'vine', 'lily_pad', 'lever', 'tripwire_hook', 'iron_bars', 'glow_lichen',
  'torch', 'soul_torch', 'redstone_torch', 'rail', 'powered_rail', 'detector_rail', 'activator_rail',
]);

const TALL: Record<string, string> = {
  tall_grass: 'tall_grass_top',
  large_fern: 'large_fern_top',
  sunflower: 'sunflower_front',
  lilac: 'lilac_top',
  rose_bush: 'rose_bush_top',
  peony: 'peony_top',
};

/** Texture name for a flat block item, or null if the item is a 3D block. */
export function flatItemTexture(block: string): string | null {
  if (CROSS_PLANTS.has(block)) return block;
  if (TALL[block]) return TALL[block]!;
  if (block === 'glass_pane') return 'glass';
  if (block.endsWith('_stained_glass_pane')) return block.replace(/_pane$/, '');
  if (block.endsWith('_door')) return `${block}_bottom`;
  return null;
}
