/**
 * Block drops from the 1.17.1 block loot tables (minecraft-data blockLoot): each entry has
 * a drop chance, a stack size range and silk-touch / block-age conditions.
 */
import { ITEMS_BY_NAME, ITEMS_BY_ID, BLOCKS_BY_NAME } from '../data';
import { STATE_TO_BLOCK, getProp } from '../world/blockstate';
import { BLOCKS } from '../data';
import type { ItemStack } from '../item/stack';

/**
 * Drop rules. minecraft-data's blockLoot table is lossy (it halves the chance of silk-touch
 * alternatives and ignores tool/chance conditions on leaves), so drops are derived from each
 * block's default drop item (`drops` in the block data) plus curated special cases taken
 * from the minecraft.wiki drop documentation for 1.17.1.
 */
export interface LootContext {
  silkTouch: boolean;
  /** shears in hand (leaves, grass, cobwebs, vines, ...) */
  shears?: boolean;
  /** allowed to drop at all (correct tool for blocks that require one) */
  canHarvest: boolean;
  random: () => number;
  /** Fortune level of the tool (ApplyBonusCount / table_bonus); Phase 7 */
  fortune?: number;
}

const F = (c: LootContext) => c.fortune ?? 0;
/** ApplyBonusCount.OreDrops */
const oreBonus = (c: LootContext, n: number) => {
  const f = F(c);
  if (f <= 0) return n;
  const i = Math.max(0, Math.floor(c.random() * (f + 2)) - 1);
  return n * (i + 1);
};
/** ApplyBonusCount.UniformBonusCount */
const uniBonus = (c: LootContext, n: number, mult: number) => n + Math.floor(c.random() * (mult * F(c) + 1));
/** BonusLevelTableCondition */
const table = (c: LootContext, chances: number[]) => chances[Math.min(F(c), chances.length - 1)]!;

const ID = (n: string) => ITEMS_BY_NAME.get(n)?.id ?? 0;
const range = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const binomial = (r: () => number, n: number, p: number) => {
  let k = 0;
  for (let i = 0; i < n; i++) if (r() < p) k++;
  return k;
};

type Rule = (state: number, ctx: LootContext, out: ItemStack[]) => void;
const push = (out: ItemStack[], name: string, count: number) => {
  if (count > 0) out.push({ id: ID(name), count, damage: 0 });
};

const SAPLING_OF: Record<string, string> = {
  oak_leaves: 'oak_sapling', spruce_leaves: 'spruce_sapling', birch_leaves: 'birch_sapling', jungle_leaves: 'jungle_sapling',
  acacia_leaves: 'acacia_sapling', dark_oak_leaves: 'dark_oak_sapling', azalea_leaves: 'azalea', flowering_azalea_leaves: 'flowering_azalea',
};

const RULES: Record<string, Rule> = {
  gravel: (_s, c, o) => push(o, c.random() < table(c, [0.1, 0.14285715, 0.25, 1]) ? 'flint' : 'gravel', 1),
  grass: (_s, c, o) => (c.shears ? push(o, 'grass', 1) : c.random() < 0.125 && push(o, 'wheat_seeds', uniBonus(c, 1, 2))),
  fern: (_s, c, o) => (c.shears ? push(o, 'fern', 1) : c.random() < 0.125 && push(o, 'wheat_seeds', uniBonus(c, 1, 2))),
  tall_grass: (s, c, o) => getProp(s, 'half') === 'lower' && (c.shears ? push(o, 'grass', 2) : c.random() < 0.125 && push(o, 'wheat_seeds', uniBonus(c, 1, 2))),
  large_fern: (s, c, o) => getProp(s, 'half') === 'lower' && (c.shears ? push(o, 'fern', 2) : c.random() < 0.125 && push(o, 'wheat_seeds', uniBonus(c, 1, 2))),
  dead_bush: (_s, c, o) => (c.shears ? push(o, 'dead_bush', 1) : push(o, 'stick', range(c.random, 0, 2))),
  cobweb: (_s, c, o) => (c.shears ? push(o, 'cobweb', 1) : push(o, 'string', 1)),
  vine: (_s, c, o) => c.shears && push(o, 'vine', 1),
  glow_lichen: (_s, c, o) => c.shears && push(o, 'glow_lichen', 1),
  seagrass: (_s, c, o) => c.shears && push(o, 'seagrass', 1),
  lapis_ore: (_s, c, o) => push(o, 'lapis_lazuli', oreBonus(c, range(c.random, 4, 9))),
  deepslate_lapis_ore: (_s, c, o) => push(o, 'lapis_lazuli', oreBonus(c, range(c.random, 4, 9))),
  redstone_ore: (_s, c, o) => push(o, 'redstone', uniBonus(c, range(c.random, 4, 5), 1)),
  deepslate_redstone_ore: (_s, c, o) => push(o, 'redstone', uniBonus(c, range(c.random, 4, 5), 1)),
  copper_ore: (_s, c, o) => push(o, 'raw_copper', oreBonus(c, range(c.random, 2, 3))),
  deepslate_copper_ore: (_s, c, o) => push(o, 'raw_copper', oreBonus(c, range(c.random, 2, 3))),
  nether_gold_ore: (_s, c, o) => push(o, 'gold_nugget', oreBonus(c, range(c.random, 2, 6))),
  glowstone: (_s, c, o) => push(o, 'glowstone_dust', Math.min(4, uniBonus(c, range(c.random, 2, 4), 1))),
  sea_lantern: (_s, c, o) => push(o, 'prismarine_crystals', Math.min(5, uniBonus(c, range(c.random, 2, 3), 1))),
  melon: (_s, c, o) => push(o, 'melon_slice', Math.min(9, uniBonus(c, range(c.random, 3, 7), 1))),
  clay: (_s, _c, o) => push(o, 'clay_ball', 4),
  bookshelf: (_s, _c, o) => push(o, 'book', 3),
  snow_block: (_s, _c, o) => push(o, 'snowball', 4),
  snow: (s, _c, o) => push(o, 'snowball', getProp(s, 'layers') as number),
  amethyst_cluster: (_s, c, o) => push(o, 'amethyst_shard', oreBonus(c, 4)),
  wheat: (s, c, o) => {
    const ripe = getProp(s, 'age') === 7;
    if (ripe) push(o, 'wheat', 1);
    push(o, 'wheat_seeds', 1 + (ripe ? binomial(c.random, 3 + F(c), 0.5714286) : 0));
  },
  carrots: (s, c, o) => push(o, 'carrot', 1 + (getProp(s, 'age') === 7 ? binomial(c.random, 3 + F(c), 0.5714286) : 0)),
  potatoes: (s, c, o) => {
    const ripe = getProp(s, 'age') === 7;
    push(o, 'potato', 1 + (ripe ? binomial(c.random, 3 + F(c), 0.5714286) : 0));
    if (ripe && c.random() < 0.02) push(o, 'poisonous_potato', 1);
  },
  beetroots: (s, c, o) => {
    const ripe = getProp(s, 'age') === 3;
    if (ripe) push(o, 'beetroot', 1);
    push(o, 'beetroot_seeds', 1 + (ripe ? binomial(c.random, 3 + F(c), 0.5714286) : 0));
  },
};

export function blockDrops(state: number, ctx: LootContext): ItemStack[] {
  const b = BLOCKS[STATE_TO_BLOCK[state]!]!;
  const out: ItemStack[] = [];
  const name = b.name;
  // silk touch / shears keep the block itself for blocks that otherwise drop something else or nothing
  const keepsSelf = ctx.silkTouch && ITEMS_BY_NAME.has(name) && !name.endsWith('_door') && !name.endsWith('_bed');
  if (name.endsWith('_leaves')) {
    if (ctx.shears || ctx.silkTouch) return [{ id: ID(name), count: 1, damage: 0 }];
    const r = ctx.random;
    const sapling = SAPLING_OF[name];
    const saplingChance = table(ctx, name === 'jungle_leaves' ? [0.025, 0.027777778, 0.03125, 0.041666668, 0.1] : [0.05, 0.0625, 0.083333336, 0.1]);
    if (sapling && r() < saplingChance) push(out, sapling, 1);
    if (r() < table(ctx, [0.02, 0.022222223, 0.025, 0.033333335, 0.1])) push(out, 'stick', range(r, 1, 2));
    if ((name === 'oak_leaves' || name === 'dark_oak_leaves') && r() < table(ctx, [0.005, 0.0055555557, 0.00625, 0.008333334, 0.025])) push(out, 'apple', 1);
    return out;
  }
  if (!ctx.canHarvest) return out;
  if (keepsSelf && (name.endsWith('_ore') || ['stone', 'deepslate', 'grass_block', 'glass', 'ice', 'glowstone', 'melon', 'bookshelf', 'clay', 'gravel', 'sea_lantern', 'snow_block', 'amethyst_cluster', 'mycelium', 'podzol', 'ender_chest'].includes(name) || name.includes('glass') || name.endsWith('_mushroom_block') || name === 'turtle_egg' || name === 'bee_nest' || name === 'beehive')) {
    return [{ id: ID(name), count: 1, damage: 0 }];
  }
  const rule = RULES[name];
  if (rule) {
    rule(state, ctx, out);
    return out;
  }
  // doors and tall structures drop only from their lower half; beds only from the head
  // (vanilla loot tables: block_state_property half=lower / part=head)
  const half = getProp(state, 'half');
  if (half === 'upper' && name.endsWith('_door')) return out;
  if (name.endsWith('_bed')) return getProp(state, 'part') === 'head' ? [{ id: ID(name), count: 1, damage: 0 }] : out;
  for (const id of b.drops) out.push({ id, count: 1, damage: 0 });
  // ores that drop an item (coal, diamond, emerald, quartz, raw iron/gold): Fortune multiplies
  if (name.endsWith('_ore') && F(ctx) > 0) for (const st of out) if (st.id !== ID(name)) st.count = oreBonus(ctx, st.count);
  // double slabs drop two
  if (name.endsWith('_slab') && getProp(state, 'type') === 'double') for (const s of out) s.count = 2;
  // candles and sea pickles drop their count
  if (name.endsWith('candle') && getProp(state, 'candles') !== undefined) for (const s of out) s.count = getProp(state, 'candles') as number;
  if (name === 'sea_pickle') for (const s of out) s.count = getProp(state, 'pickles') as number;
  return out;
}

/** The item that places a block (pick block / creative), if any. */
export function itemForBlock(state: number): number {
  const b = BLOCKS[STATE_TO_BLOCK[state]!]!;
  const alias: Record<string, string> = {
    wall_torch: 'torch', soul_wall_torch: 'soul_torch', redstone_wall_torch: 'redstone_torch', redstone_wire: 'redstone',
    water: 'water_bucket', lava: 'lava_bucket', tripwire: 'string', wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato',
    beetroots: 'beetroot_seeds', cocoa: 'cocoa_beans', melon_stem: 'melon_seeds', pumpkin_stem: 'pumpkin_seeds',
    sweet_berry_bush: 'sweet_berries', cave_vines: 'glow_berries', cave_vines_plant: 'glow_berries', kelp_plant: 'kelp',
    bamboo_sapling: 'bamboo', tall_seagrass: 'seagrass', powder_snow: 'powder_snow_bucket', fire: 'flint_and_steel',
  };
  let name = alias[b.name] ?? b.name;
  if (name.endsWith('_wall_sign')) name = name.replace('_wall_sign', '_sign');
  if (name.endsWith('_wall_banner')) name = name.replace('_wall_banner', '_banner');
  if (name.endsWith('_wall_head') || name.endsWith('_wall_skull')) name = name.replace('_wall_', '_');
  if (name.startsWith('potted_')) name = name.slice(7);
  return ITEMS_BY_NAME.get(name)?.id ?? 0;
}

const ITEM_TO_BLOCK_ALIAS: Record<string, string> = {
  redstone: 'redstone_wire', string: 'tripwire', wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot_seeds: 'beetroots',
  melon_seeds: 'melon_stem', pumpkin_seeds: 'pumpkin_stem', sweet_berries: 'sweet_berry_bush', glow_berries: 'cave_vines', cocoa_beans: 'cocoa',
};

/** Items that share a name with a block they don't place (the wheat item vs the wheat crop). */
const NOT_PLACEABLE = new Set(['wheat']);

/** Block placed by an item, if it is a block item. */
export function blockForItem(itemId: number): string | null {
  const n = ITEMS_BY_ID[itemId]?.name;
  if (!n || NOT_PLACEABLE.has(n)) return null;
  if (BLOCKS_BY_NAME.has(n)) return n;
  return ITEM_TO_BLOCK_ALIAS[n] ?? null;
}
