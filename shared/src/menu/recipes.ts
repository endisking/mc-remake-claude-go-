/**
 * Crafting recipes (vanilla ShapedRecipe / ShapelessRecipe / RepairItemRecipe) built from
 * minecraft-data 1.17.1. minecraft-data expands tag ingredients (#planks, #logs, #coals…) into
 * one recipe per item; recipes with the same result and pattern are merged back into one
 * recipe whose slots accept the union of items, which is what the vanilla tag ingredient does
 * (two oak + two birch planks make a crafting table).
 */
import { RECIPES, ITEMS_BY_ID } from '../data';
import { isEmpty, type ItemStack } from '../item/stack';
import { itemId, maxDamage } from './container';

export interface ShapedRecipe {
  kind: 'shaped';
  width: number;
  height: number;
  /** row-major, top row first; null = must be empty */
  pattern: (Set<number> | null)[];
  result: ItemStack;
}

export interface ShapelessRecipe {
  kind: 'shapeless';
  ingredients: Set<number>[];
  result: ItemStack;
}

export type CraftingRecipe = ShapedRecipe | ShapelessRecipe;

/** Items that appear as alternatives in minecraft-data but are separate recipes in vanilla (not tag members). */
const NOT_TAG_ALTERNATIVES = new Set(['bamboo']);

function buildRecipes(): CraftingRecipe[] {
  const out: CraftingRecipe[] = [];
  const shapedGroups = new Map<string, ShapedRecipe>();
  for (const r of RECIPES) {
    const result: ItemStack = { id: r.result.id, count: r.result.count, damage: 0 };
    if (r.inShape) {
      const h = r.inShape.length;
      const w = Math.max(...r.inShape.map((row) => row.length));
      const cells: (number | null)[] = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(r.inShape[y]![x] ?? null);
      const special = cells.some((c) => c !== null && NOT_TAG_ALTERNATIVES.has(ITEMS_BY_ID[c]?.name ?? ''));
      const key = `${r.result.id}:${r.result.count}:${w}x${h}:${cells.map((c) => (c === null ? '_' : 'x')).join('')}${special ? ':' + cells.join(',') : ''}`;
      const g = shapedGroups.get(key);
      if (g) {
        cells.forEach((c, i) => {
          if (c !== null) g.pattern[i]!.add(c);
        });
      } else {
        const rec: ShapedRecipe = { kind: 'shaped', width: w, height: h, pattern: cells.map((c) => (c === null ? null : new Set([c]))), result };
        shapedGroups.set(key, rec);
        out.push(rec);
      }
    } else if (r.ingredients) {
      out.push({ kind: 'shapeless', ingredients: r.ingredients.map((i) => new Set([i])), result });
    }
  }
  return out;
}

export const CRAFTING_RECIPES: CraftingRecipe[] = buildRecipes();

/** A crafting grid as seen by recipes: width × height item stacks, row-major. */
export interface CraftingGrid {
  width: number;
  height: number;
  items: (ItemStack | null)[];
}

function matchesShaped(r: ShapedRecipe, g: CraftingGrid): boolean {
  // bounding box of the non-empty cells
  let x0 = g.width, y0 = g.height, x1 = -1, y1 = -1;
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++)
      if (!isEmpty(g.items[y * g.width + x])) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return false;
  if (x1 - x0 + 1 !== r.width || y1 - y0 + 1 !== r.height) {
    // patterns with empty border cells (e.g. a 3-wide pattern whose column is all null) — check every offset
    return matchesAnyOffset(r, g);
  }
  return matchAt(r, g, x0, y0, false) || matchAt(r, g, x0, y0, true);
}

function matchesAnyOffset(r: ShapedRecipe, g: CraftingGrid): boolean {
  for (let ox = 0; ox <= g.width - r.width; ox++)
    for (let oy = 0; oy <= g.height - r.height; oy++) if (matchFull(r, g, ox, oy, true) || matchFull(r, g, ox, oy, false)) return true;
  return false;
}

/** ShapedRecipe.matches(grid, x, y, mirrored): every grid cell checked (outside the pattern = empty). */
function matchFull(r: ShapedRecipe, g: CraftingGrid, ox: number, oy: number, mirrored: boolean): boolean {
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      const px = x - ox, py = y - oy;
      let ing: Set<number> | null = null;
      if (px >= 0 && py >= 0 && px < r.width && py < r.height) ing = r.pattern[mirrored ? r.width - px - 1 + py * r.width : px + py * r.width]!;
      const st = g.items[y * g.width + x];
      if (!ing) {
        if (!isEmpty(st)) return false;
      } else if (isEmpty(st) || !ing.has(st.id)) return false;
    }
  return true;
}

function matchAt(r: ShapedRecipe, g: CraftingGrid, ox: number, oy: number, mirrored: boolean): boolean {
  return matchFull(r, g, ox, oy, mirrored);
}

function matchesShapeless(r: ShapelessRecipe, g: CraftingGrid): boolean {
  const stacks = g.items.filter((s): s is ItemStack => !isEmpty(s));
  if (stacks.length !== r.ingredients.length) return false;
  // bipartite matching (vanilla StackedContents / RecipeMatcher)
  const used = new Array(stacks.length).fill(false);
  const tryIng = (i: number): boolean => {
    if (i === r.ingredients.length) return true;
    const ing = r.ingredients[i]!;
    for (let j = 0; j < stacks.length; j++) {
      if (used[j] || !ing.has(stacks[j]!.id)) continue;
      used[j] = true;
      if (tryIng(i + 1)) return true;
      used[j] = false;
    }
    return false;
  };
  return tryIng(0);
}

/** RepairItemRecipe: two of the same damageable item → combined durability + 5% bonus. */
function repairResult(g: CraftingGrid): ItemStack | null {
  const stacks = g.items.filter((s): s is ItemStack => !isEmpty(s));
  if (stacks.length !== 2) return null;
  const [a, b] = stacks as [ItemStack, ItemStack];
  const max = maxDamage(a.id);
  if (a.id !== b.id || max <= 0 || a.count !== 1 || b.count !== 1) return null;
  const k = max - a.damage + (max - b.damage) + Math.floor((max * 5) / 100);
  return { id: a.id, count: 1, damage: Math.max(0, max - k) };
}

/** RecipeManager.getRecipeFor(CRAFTING): the result for a grid, or null. */
export function craftingResult(g: CraftingGrid): ItemStack | null {
  for (const r of CRAFTING_RECIPES) {
    if (r.kind === 'shaped' ? r.width <= g.width && r.height <= g.height && matchesShaped(r, g) : matchesShapeless(r, g)) {
      return { ...r.result };
    }
  }
  return repairResult(g);
}

/** Item.getCraftingRemainingItem (buckets, bottles left behind in the grid). */
export function craftingRemainder(id: number): number {
  const n = ITEMS_BY_ID[id]?.name;
  if (n === 'milk_bucket' || n === 'water_bucket' || n === 'lava_bucket' || n === 'powder_snow_bucket') return itemId('bucket');
  if (n === 'honey_bottle' || n === 'dragon_breath') return itemId('glass_bottle');
  return 0;
}
