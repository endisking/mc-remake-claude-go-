/**
 * Mob loot tables (vanilla data/minecraft/loot_tables/entities/*.json, 1.17.1): set_count uniform
 * ranges, looting_enchant bonuses (round(looting × U[0,1])), killed_by_player and
 * random_chance_with_looting conditions, and furnace_smelt for mobs that die burning.
 */
import { ITEMS_BY_NAME } from '../data';
import type { ItemStack } from '../item/stack';

export interface MobLootContext {
  looting: number;
  onFire: boolean;
  killedByPlayer: boolean;
  /** uniform [0, 1) */
  random: () => number;
  /** sheep */
  sheared?: boolean;
  /** sheep wool colour name (white, orange, …) */
  color?: string;
  /** slime size */
  size?: number;
}

const ID = (n: string) => ITEMS_BY_NAME.get(n)?.id ?? 0;
const SMELT: Record<string, string> = {
  porkchop: 'cooked_porkchop', beef: 'cooked_beef', mutton: 'cooked_mutton', chicken: 'cooked_chicken',
  potato: 'baked_potato', cod: 'cooked_cod', salmon: 'cooked_salmon', rabbit: 'cooked_rabbit',
};

/** UniformGenerator.getInt: inclusive integer range */
const uniformInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function entry(out: ItemStack[], c: MobLootContext, item: string, lo: number, hi: number, opts: { looting?: [number, number]; limit?: number; smelt?: boolean; player?: boolean } = {}): void {
  if (opts.player && !c.killedByPlayer) return;
  let n = uniformInt(c.random, lo, hi);
  if (opts.looting && c.looting > 0) {
    const [a, b] = opts.looting;
    n += Math.round(c.looting * (a + c.random() * (b - a)));
    if (opts.limit !== undefined) n = Math.min(n, opts.limit);
  }
  if (n <= 0) return;
  const name = opts.smelt && c.onFire ? (SMELT[item] ?? item) : item;
  out.push({ id: ID(name), count: n, damage: 0 });
}

const L: [number, number] = [0, 1];

/** Items dropped by a mob of `type` dying in context `c`. */
export function mobLoot(type: string, c: MobLootContext): ItemStack[] {
  const out: ItemStack[] = [];
  switch (type) {
    case 'zombie':
    case 'husk':
    case 'zombie_villager':
      entry(out, c, 'rotten_flesh', 0, 2, { looting: L });
      // rare drop: killed by player, 2.5% + 1% per looting level
      if (c.killedByPlayer && c.random() < 0.025 + c.looting * 0.01) {
        const pick = ['iron_ingot', 'carrot', 'potato'][Math.floor(c.random() * 3)]!;
        entry(out, c, pick, 1, 1, { smelt: true });
      }
      break;
    case 'drowned':
      entry(out, c, 'rotten_flesh', 0, 2, { looting: L });
      if (c.killedByPlayer && c.random() < 0.11 + c.looting * 0.02) entry(out, c, 'copper_ingot', 1, 1);
      break;
    case 'skeleton':
      entry(out, c, 'arrow', 0, 2, { looting: L });
      entry(out, c, 'bone', 0, 2, { looting: L });
      break;
    case 'stray':
      entry(out, c, 'arrow', 0, 2, { looting: L });
      entry(out, c, 'bone', 0, 2, { looting: L });
      // tipped arrow of slowness (potion data not modelled on stacks yet: a plain tipped_arrow)
      entry(out, c, 'tipped_arrow', 0, 1, { looting: L, limit: 1, player: true });
      break;
    case 'creeper':
      entry(out, c, 'gunpowder', 0, 2, { looting: L });
      break;
    case 'spider':
    case 'cave_spider':
      entry(out, c, 'string', 0, 2, { looting: L });
      entry(out, c, 'spider_eye', -1, 1, { looting: L, player: true });
      break;
    case 'pig':
      entry(out, c, 'porkchop', 1, 3, { looting: L, smelt: true });
      break;
    case 'cow':
    case 'mooshroom':
      entry(out, c, 'leather', 0, 2, { looting: L });
      entry(out, c, 'beef', 1, 3, { looting: L, smelt: true });
      break;
    case 'sheep':
      if (!c.sheared) entry(out, c, `${c.color ?? 'white'}_wool`, 1, 1);
      entry(out, c, 'mutton', 1, 2, { looting: L, smelt: true });
      break;
    case 'chicken':
      entry(out, c, 'feather', 0, 2, { looting: L });
      entry(out, c, 'chicken', 1, 1, { looting: L, smelt: true });
      break;
    case 'enderman':
      entry(out, c, 'ender_pearl', 0, 1, { looting: L });
      break;
    case 'slime':
      if ((c.size ?? 1) === 1) entry(out, c, 'slime_ball', 0, 2, { looting: L });
      break;
    case 'phantom':
      entry(out, c, 'phantom_membrane', 0, 1, { looting: L, player: true });
      break;
    case 'squid':
      entry(out, c, 'ink_sac', 1, 3, { looting: L });
      break;
  }
  return out;
}
