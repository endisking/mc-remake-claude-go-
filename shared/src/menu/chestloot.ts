/**
 * Rolling chest loot tables into a container (vanilla LootTable.fill with
 * getAvailableSlots + shuffleAndSplitItems), seeded by the chest's loot seed.
 */
import { JavaRandom } from '../util/random';
import { ITEMS_BY_NAME } from '../data';
import { maxStackSize, type ItemStack } from '../item/stack';
import { CHEST_LOOT, type LootTable } from '../worldgen/features/chest-loot';

type Range = number | { type: 'minecraft:uniform'; min: number; max: number };

/** Mth.nextInt(random, min, max) */
function nextInt(r: JavaRandom, min: number, max: number): number {
  return min >= max ? min : r.nextInt(max - min + 1) + min;
}

function rollInt(r: JavaRandom, v: Range): number {
  return typeof v === 'number' ? v : nextInt(r, Math.floor(v.min), Math.floor(v.max));
}

/** Collections.shuffle(list, rnd) */
function shuffle<T>(list: T[], r: JavaRandom): void {
  for (let i = list.length; i > 1; i--) {
    const j = r.nextInt(i);
    const t = list[i - 1]!;
    list[i - 1] = list[j]!;
    list[j] = t;
  }
}

/** LootTable.getRandomItems for the simple item/empty/set_count tables used by chests. */
export function rollLoot(table: LootTable, r: JavaRandom): ItemStack[] {
  const out: ItemStack[] = [];
  for (const pool of table.pools) {
    const rolls = rollInt(r, pool.rolls);
    for (let k = 0; k < rolls; k++) {
      const total = pool.entries.reduce((n, e) => n + e.weight, 0);
      let j = r.nextInt(total);
      for (const e of pool.entries) {
        j -= e.weight;
        if (j >= 0) continue;
        if (e.type === 'minecraft:item' && e.name) {
          const it = ITEMS_BY_NAME.get(e.name.replace(/^minecraft:/, ''));
          if (!it) break;
          let count = 1;
          for (const f of e.functions ?? []) if (f.function === 'minecraft:set_count') count = rollInt(r, f.count);
          // enchant_randomly needs enchantment data on stacks (not supported yet): the plain item drops
          let left = count;
          while (left > 0) {
            const n = Math.min(left, maxStackSize(it.id));
            out.push({ id: it.id, count: n, damage: 0 });
            left -= n;
          }
        }
        break;
      }
    }
  }
  return out;
}

/** LootTable.fill: items spread over random empty slots, big stacks split up to fill space. */
export function fillWithLoot(items: (ItemStack | null)[], tableId: string, seed: bigint): void {
  const table = CHEST_LOOT[tableId];
  if (!table) return;
  const r = new JavaRandom(seed);
  const stacks = rollLoot(table, r);
  const slots: number[] = [];
  for (let i = 0; i < items.length; i++) if (!items[i]) slots.push(i);
  shuffle(slots, r);
  // shuffleAndSplitItems
  const big: ItemStack[] = [];
  for (let i = stacks.length - 1; i >= 0; i--) {
    if (stacks[i]!.count > 1) big.push(...stacks.splice(i, 1));
  }
  big.reverse();
  while (slots.length - stacks.length - big.length > 0 && big.length > 0) {
    const st = big.splice(nextInt(r, 0, big.length - 1), 1)[0]!;
    const n = nextInt(r, 1, Math.floor(st.count / 2));
    const part: ItemStack = { id: st.id, count: n, damage: st.damage };
    st.count -= n;
    if (st.count > 1 && r.nextBoolean()) big.push(st);
    else stacks.push(st);
    if (part.count > 1 && r.nextBoolean()) big.push(part);
    else stacks.push(part);
  }
  stacks.push(...big);
  shuffle(stacks, r);
  for (const st of stacks) {
    const slot = slots.pop();
    if (slot === undefined) return;
    items[slot] = st;
  }
}
