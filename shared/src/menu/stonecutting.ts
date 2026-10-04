/**
 * Stonecutting recipes (vanilla 1.17.1 data pack). minecraft-data has none, so they're derived
 * from the crafting recipes the way the data pack was built: for a pickaxe-mineable block X, the
 * stonecutter makes everything crafting turns X into one-for-one (polished, bricks, tiles, cut,
 * pillar, chiseled — following chains, e.g. stone → stone bricks → chiseled stone bricks), plus
 * the slab (2), stairs (1) and wall (1) of each of those. Cut copper comes out four to a block
 * (cut_copper_from_copper_block_stonecutting), so its slab gives 8 and stairs 4.
 */
import { BLOCKS_BY_NAME, ITEMS_BY_ID, ITEMS_BY_NAME, RECIPES } from '../data';

export interface StonecutterRecipe {
  input: number;
  result: number;
  count: number;
}

const name = (id: number) => ITEMS_BY_ID[id]?.name ?? '';
const isStone = (n: string) => BLOCKS_BY_NAME.get(n)?.material === 'mineable/pickaxe';
/** The name a block's slab/stairs/wall are built on: stone_bricks → stone_brick, quartz_block → quartz. */
const shapeBase = (n: string) => n.replace(/_block$/, '').replace(/bricks$/, 'brick').replace(/tiles$/, 'tile');

function build(): Map<number, StonecutterRecipe[]> {
  // per block: its one-for-one conversions, and its slab / stairs / wall
  const convert = new Map<number, Set<number>>();
  const shapes = new Map<number, { slab?: number; stairs?: number; wall?: number }>();
  const slabOf = new Map<number, number>(); // slab id → full block id
  for (const r of RECIPES) {
    if (!r.inShape) continue;
    const cells = r.inShape.flat().filter((c): c is number => c !== null);
    const ids = new Set(cells);
    if (ids.size !== 1) continue;
    const input = cells[0]!;
    const inName = name(input), outName = name(r.result.id);
    if (!isStone(inName) || !isStone(outName)) continue;
    if (/_button$|_pressure_plate$/.test(outName)) continue;
    const s = shapes.get(input) ?? {};
    const own = (suffix: string) => outName === `${shapeBase(inName)}_${suffix}`;
    if (outName.endsWith('_slab') || outName.endsWith('_stairs') || outName.endsWith('_wall')) {
      // only a block's own shapes (crafting also makes sandstone slabs from chiseled sandstone)
      if (!own('slab') && !own('stairs') && !own('wall')) continue;
    }
    if (outName.endsWith('_slab') && cells.length === 3 && r.result.count === 6) {
      s.slab = r.result.id;
      slabOf.set(r.result.id, input);
    } else if (outName.endsWith('_stairs') && cells.length === 6 && r.result.count === 4) s.stairs = r.result.id;
    else if (outName.endsWith('_wall') && cells.length === 6 && r.result.count === 6) s.wall = r.result.id;
    else if (r.result.count === cells.length) {
      if (!convert.has(input)) convert.set(input, new Set());
      convert.get(input)!.add(r.result.id);
    }
    shapes.set(input, s);
  }
  // two slabs → one block (chiseled …, purpur pillar) count as a conversion of the full block
  for (const r of RECIPES) {
    if (!r.inShape) continue;
    const cells = r.inShape.flat().filter((c): c is number => c !== null);
    if (cells.length !== 2 || new Set(cells).size !== 1 || r.result.count !== 1) continue;
    const full = slabOf.get(cells[0]!);
    if (full === undefined || !isStone(name(r.result.id))) continue;
    if (!convert.has(full)) convert.set(full, new Set());
    convert.get(full)!.add(r.result.id);
  }
  const out = new Map<number, StonecutterRecipe[]>();
  const inputs = new Set<number>([...convert.keys(), ...shapes.keys()]);
  for (const x of inputs) {
    const list = new Map<number, number>();
    const add = (id: number | undefined, count: number) => {
      if (id !== undefined && id !== x && !list.has(id)) list.set(id, count);
    };
    // walk the conversion chain
    const seen = new Set<number>([x]);
    const queue: [number, number][] = [[x, 1]];
    while (queue.length) {
      const [b, mult] = queue.shift()!;
      const sh = shapes.get(b) ?? {};
      add(sh.slab, 2 * mult);
      add(sh.stairs, mult);
      add(sh.wall, mult);
      for (const y of convert.get(b) ?? []) {
        if (seen.has(y)) continue;
        seen.add(y);
        const m = name(y).includes('cut_copper') && !name(b).includes('cut_copper') ? 4 : mult;
        add(y, m);
        queue.push([y, m]);
      }
    }
    if (list.size) {
      const recipes = [...list].map(([result, count]) => ({ input: x, result, count }));
      // RecipeManager sorts stonecutting results by their description id
      recipes.sort((a, b) => (name(a.result) < name(b.result) ? -1 : 1));
      out.set(x, recipes);
    }
  }
  return out;
}

export const STONECUTTING: Map<number, StonecutterRecipe[]> = build();

export function stonecutterRecipes(input: number): StonecutterRecipe[] {
  return STONECUTTING.get(input) ?? [];
}

export function stonecutterItemId(n: string): number {
  return ITEMS_BY_NAME.get(n)?.id ?? 0;
}
