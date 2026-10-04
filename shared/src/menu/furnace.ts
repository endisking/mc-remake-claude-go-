/**
 * Furnace / blast furnace / smoker block entity logic (vanilla AbstractFurnaceBlockEntity),
 * operating on the plain block entity data object so it can be saved with the chunk as-is.
 */
import { isEmpty, maxStackSize, type ItemStack } from '../item/stack';
import { burnDuration, cookingRecipe, recipeById, type CookingRecipe, type CookingType } from './smelting';
import { craftingRemainder } from './recipes';
import { itemId, sameItemSameTags, type Container } from './container';

export type FurnaceKind = 'furnace' | 'blast_furnace' | 'smoker';

export interface FurnaceData {
  id: FurnaceKind;
  /** 0 ingredient, 1 fuel, 2 result */
  items: (ItemStack | null)[];
  litTime: number;
  litDuration: number;
  cookingProgress: number;
  cookingTotalTime: number;
  /** recipe id → times used since the result was last taken (for XP) */
  recipesUsed: Record<string, number>;
}

export const COOKING_TYPE: Record<FurnaceKind, CookingType> = { furnace: 'smelting', blast_furnace: 'blasting', smoker: 'smoking' };

export function newFurnace(kind: FurnaceKind): FurnaceData {
  return { id: kind, items: [null, null, null], litTime: 0, litDuration: 0, cookingProgress: 0, cookingTotalTime: 0, recipesUsed: {} };
}

export function isLit(f: FurnaceData): boolean {
  return f.litTime > 0;
}

function recipeFor(f: FurnaceData): CookingRecipe | null {
  const input = f.items[0];
  return isEmpty(input) ? null : cookingRecipe(COOKING_TYPE[f.id], input.id);
}

/** getTotalCookTime: the recipe's cooking time, 200 when there is none. */
export function totalCookTime(f: FurnaceData): number {
  return recipeFor(f)?.time ?? 200;
}

function canBurn(r: CookingRecipe | null, f: FurnaceData, max: number): boolean {
  if (isEmpty(f.items[0]) || !r) return false;
  const out = f.items[2];
  if (isEmpty(out)) return true;
  if (out.id !== r.result || out.damage !== 0) return false;
  if (out.count < max && out.count < maxStackSize(out.id)) return true;
  return out.count < maxStackSize(r.result);
}

function burn(r: CookingRecipe | null, f: FurnaceData, max: number): boolean {
  if (!r || !canBurn(r, f, max)) return false;
  const input = f.items[0]!;
  const out = f.items[2];
  if (isEmpty(out)) f.items[2] = { id: r.result, count: 1, damage: 0 };
  else out.count++;
  // a wet sponge dried over an empty bucket fills it with water
  const fuel = f.items[1];
  if (input.id === itemId('wet_sponge') && !isEmpty(fuel) && fuel.id === itemId('bucket')) f.items[1] = { id: itemId('water_bucket'), count: 1, damage: 0 };
  input.count--;
  if (input.count <= 0) f.items[0] = null;
  return true;
}

/**
 * AbstractFurnaceBlockEntity.serverTick. Returns whether anything changed and whether the lit
 * block state must flip.
 */
export function tickFurnace(f: FurnaceData): { changed: boolean; litChanged: boolean } {
  const wasLit = isLit(f);
  let changed = false;
  if (isLit(f)) f.litTime--;
  const fuel = f.items[1];
  if (isLit(f) || (!isEmpty(fuel) && !isEmpty(f.items[0]))) {
    const r = recipeFor(f);
    const max = 64;
    if (!isLit(f) && canBurn(r, f, max)) {
      f.litTime = isEmpty(fuel) ? 0 : burnDuration(fuel.id);
      f.litDuration = f.litTime;
      if (isLit(f)) {
        changed = true;
        if (!isEmpty(fuel)) {
          const used = fuel.id;
          fuel.count--;
          if (fuel.count <= 0) {
            const rem = craftingRemainder(used);
            f.items[1] = rem ? { id: rem, count: 1, damage: 0 } : null;
          }
        }
      }
    }
    if (isLit(f) && canBurn(r, f, max)) {
      f.cookingProgress++;
      if (f.cookingProgress === f.cookingTotalTime) {
        f.cookingProgress = 0;
        f.cookingTotalTime = totalCookTime(f);
        if (burn(r, f, max)) f.recipesUsed[r!.id] = (f.recipesUsed[r!.id] ?? 0) + 1;
        changed = true;
      }
    } else f.cookingProgress = 0;
  } else if (!isLit(f) && f.cookingProgress > 0) {
    f.cookingProgress = Math.max(0, Math.min(f.cookingTotalTime, f.cookingProgress - 2));
  }
  const litChanged = wasLit !== isLit(f);
  return { changed: changed || litChanged, litChanged };
}

/**
 * getRecipesToAwardAndPopExperience: experience owed for everything smelted since the result
 * was last taken (fractional parts rounded up with that probability), then forgotten.
 */
export function takeFurnaceExperience(f: FurnaceData, random: () => number): number {
  let total = 0;
  for (const [id, n] of Object.entries(f.recipesUsed)) {
    const r = recipeById(id);
    if (!r) continue;
    const amount = n * r.xp;
    let i = Math.floor(amount);
    const frac = amount - i;
    if (frac !== 0 && random() < frac) i++;
    total += i;
  }
  f.recipesUsed = {};
  return total;
}

/** The furnace's items as a Container; changing the ingredient restarts the cook timer (setItem). */
export class FurnaceContainer implements Container {
  constructor(
    readonly data: FurnaceData,
    private readonly changed: () => void = () => {},
    readonly valid: () => boolean = () => true,
  ) {}
  size(): number {
    return 3;
  }
  getItem(i: number): ItemStack | null {
    const s = this.data.items[i];
    if (isEmpty(s)) {
      if (s) this.data.items[i] = null;
      return null;
    }
    return s;
  }
  setItem(i: number, s: ItemStack | null): void {
    const old = this.data.items[i] ?? null;
    const same = !isEmpty(s) && sameItemSameTags(s, old);
    this.data.items[i] = isEmpty(s) ? null : s;
    if (s && s.count > 64) s.count = 64;
    if (i === 0 && !same) {
      this.data.cookingTotalTime = totalCookTime(this.data);
      this.data.cookingProgress = 0;
    }
    this.changed();
  }
  removeItem(i: number, n: number): ItemStack | null {
    const s = this.getItem(i);
    if (!s || n <= 0) return null;
    const k = Math.min(n, s.count);
    s.count -= k;
    if (s.count <= 0) this.data.items[i] = null;
    this.changed();
    return { id: s.id, count: k, damage: s.damage };
  }
  maxStackSize(): number {
    return 64;
  }
  setChanged(): void {
    this.changed();
  }
  stillValid(): boolean {
    return this.valid();
  }
}

