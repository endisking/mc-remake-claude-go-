import { describe, it, expect } from 'vitest';
import { SOUND_TYPES, soundTypeNameOf } from './soundtype';
import { SOUND_EVENTS } from '../data';

describe('block sound types', () => {
  it('every event is a vanilla 1.17.1 sound event', () => {
    const names = new Set(SOUND_EVENTS.map((e) => e.name));
    const missing: string[] = [];
    for (const t of Object.values(SOUND_TYPES)) for (const e of [t.break, t.step, t.place, t.hit, t.fall]) if (!names.has(e)) missing.push(e);
    expect([...new Set(missing)]).toEqual([]);
  });
  it('assigns vanilla groups', () => {
    expect(soundTypeNameOf('oak_planks')).toBe('wood');
    expect(soundTypeNameOf('dirt')).toBe('gravel');
    expect(soundTypeNameOf('grass_block')).toBe('grass');
    expect(soundTypeNameOf('white_wool')).toBe('wool');
    expect(soundTypeNameOf('glass_pane')).toBe('glass');
    expect(soundTypeNameOf('iron_block')).toBe('metal');
    expect(soundTypeNameOf('crimson_stem')).toBe('stem');
    expect(soundTypeNameOf('crimson_planks')).toBe('wood');
    expect(soundTypeNameOf('stone_bricks')).toBe('stone');
    expect(soundTypeNameOf('cobbled_deepslate')).toBe('deepslate');
  });
  it('follows the Blocks.java exceptions to the name rules', () => {
    const cases: Record<string, string> = {
      torch: 'wood', soul_wall_torch: 'wood', redstone_torch: 'wood', fire: 'wool', soul_fire: 'wool', lever: 'wood',
      pumpkin: 'wood', jack_o_lantern: 'wood', melon: 'wood', repeater: 'wood', comparator: 'wood', end_rod: 'wood',
      chorus_plant: 'wood', turtle_egg: 'metal', candle_cake: 'wool', red_candle_cake: 'wool', honeycomb_block: 'coral_block',
      brewing_stand: 'stone', copper_ore: 'stone', deepslate_copper_ore: 'deepslate', raw_copper_block: 'stone',
      stripped_warped_stem: 'stem', pumpkin_stem: 'hard_crop', attached_melon_stem: 'wood', potted_oak_sapling: 'stone',
      dead_brain_coral_block: 'stone', dead_tube_coral_fan: 'stone', brain_coral_block: 'coral_block', tube_coral_fan: 'wet_grass',
      amethyst_cluster: 'amethyst_cluster', small_amethyst_bud: 'small_amethyst_bud', glow_lichen: 'glow_lichen',
      moss_carpet: 'moss_carpet', cave_vines_plant: 'cave_vines', big_dripleaf_stem: 'big_dripleaf', powder_snow: 'powder_snow',
      soul_soil: 'soul_soil', nether_gold_ore: 'nether_gold_ore', nether_quartz_ore: 'nether_ore', chain: 'chain', bell: 'anvil',
      lantern: 'lantern', bamboo_sapling: 'bamboo_sapling', scaffolding: 'scaffolding', lily_pad: 'lily_pad', vine: 'vine',
      ladder: 'ladder', snow: 'snow', slime_block: 'slime_block', honey_block: 'honey_block', nether_wart: 'nether_wart',
      wheat: 'crop', sweet_berry_bush: 'sweet_berry_bush', calcite: 'calcite', tuff: 'tuff', dripstone_block: 'dripstone_block',
      polished_deepslate_wall: 'polished_deepslate', deepslate_tile_slab: 'deepslate_tiles', chiseled_deepslate: 'deepslate_bricks',
      lightning_rod: 'copper', waxed_cut_copper_stairs: 'copper', gilded_blackstone: 'gilded_blackstone', blackstone: 'stone',
    };
    for (const [b, g] of Object.entries(cases)) expect(soundTypeNameOf(b), b).toBe(g);
  });
});
