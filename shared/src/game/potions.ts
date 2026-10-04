/**
 * Potions and brewing (vanilla Potions / PotionBrewing / PotionUtils / BrewingStandBlockEntity,
 * Java Edition 1.17.1). A potion item stores its potion id in tag.Potion.
 */
import { ITEMS_BY_NAME, ITEMS_BY_ID } from '../data';
import type { ItemStack } from '../item/stack';
import { EFFECT_BY_NAME, effectsColor } from './effectdata';

export interface PotionEffect {
  effect: string;
  duration: number;
  amplifier: number;
}

const fx = (effect: string, duration: number, amplifier = 0): PotionEffect => ({ effect, duration, amplifier });

/** Potions registry (1.17.1), in registry order. */
export const POTIONS: Record<string, PotionEffect[]> = {
  empty: [], water: [], mundane: [], thick: [], awkward: [],
  night_vision: [fx('night_vision', 3600)], long_night_vision: [fx('night_vision', 9600)],
  invisibility: [fx('invisibility', 3600)], long_invisibility: [fx('invisibility', 9600)],
  leaping: [fx('jump_boost', 3600)], long_leaping: [fx('jump_boost', 9600)], strong_leaping: [fx('jump_boost', 1800, 1)],
  fire_resistance: [fx('fire_resistance', 3600)], long_fire_resistance: [fx('fire_resistance', 9600)],
  swiftness: [fx('speed', 3600)], long_swiftness: [fx('speed', 9600)], strong_swiftness: [fx('speed', 1800, 1)],
  slowness: [fx('slowness', 1800)], long_slowness: [fx('slowness', 4800)], strong_slowness: [fx('slowness', 400, 3)],
  turtle_master: [fx('slowness', 400, 3), fx('resistance', 400, 2)],
  long_turtle_master: [fx('slowness', 800, 3), fx('resistance', 800, 2)],
  strong_turtle_master: [fx('slowness', 400, 5), fx('resistance', 400, 3)],
  water_breathing: [fx('water_breathing', 3600)], long_water_breathing: [fx('water_breathing', 9600)],
  healing: [fx('instant_health', 1)], strong_healing: [fx('instant_health', 1, 1)],
  harming: [fx('instant_damage', 1)], strong_harming: [fx('instant_damage', 1, 1)],
  poison: [fx('poison', 900)], long_poison: [fx('poison', 1800)], strong_poison: [fx('poison', 432, 1)],
  regeneration: [fx('regeneration', 900)], long_regeneration: [fx('regeneration', 1800)], strong_regeneration: [fx('regeneration', 450, 1)],
  strength: [fx('strength', 3600)], long_strength: [fx('strength', 9600)], strong_strength: [fx('strength', 1800, 1)],
  weakness: [fx('weakness', 1800)], long_weakness: [fx('weakness', 4800)],
  luck: [fx('luck', 6000)],
  slow_falling: [fx('slow_falling', 1800)], long_slow_falling: [fx('slow_falling', 4800)],
};

const ID = (n: string) => ITEMS_BY_NAME.get(n)?.id ?? -1;
const POTION = ID('potion'), SPLASH = ID('splash_potion'), LINGERING = ID('lingering_potion'), BOTTLE = ID('glass_bottle'), BLAZE = ID('blaze_powder');

export const isPotionItem = (id: number): boolean => id === POTION || id === SPLASH || id === LINGERING;

/** PotionUtils.getPotion: the stack's potion id ("empty" when none). */
export function potionOf(s: ItemStack | null | undefined): string {
  const p = s?.tag?.Potion;
  return typeof p === 'string' ? p.replace(/^minecraft:/, '') : 'empty';
}

export function potionStack(item: 'potion' | 'splash_potion' | 'lingering_potion', potion: string, count = 1): ItemStack {
  return { id: ID(item), count, damage: 0, tag: { Potion: potion } };
}

/** PotionUtils.getColor(ItemStack): 16253176 for empty, the effect mix, or 3694022 (water blue). */
export function potionColor(s: ItemStack | null | undefined): number {
  const p = potionOf(s);
  if (p === 'empty') return 16253176;
  const list = (POTIONS[p] ?? []).map((e) => ({ effect: EFFECT_BY_NAME.get(e.effect)!, amplifier: e.amplifier, visible: true }));
  return effectsColor(list);
}

/** Display name: "Potion of Swiftness", "Splash Potion of Healing", "Water Bottle", "Awkward Potion"… */
export function potionName(s: ItemStack): string {
  const p = potionOf(s);
  const kind = s.id === SPLASH ? 'Splash Potion' : s.id === LINGERING ? 'Lingering Potion' : s.id === POTION ? 'Potion' : 'Tipped Arrow';
  const base = p.replace(/^(long|strong)_/, '');
  const special: Record<string, string> = { empty: `Uncraftable ${kind}`, water: s.id === POTION ? 'Water Bottle' : `${kind.split(' ')[0]} Water Bottle`, mundane: `Mundane ${kind}`, thick: `Thick ${kind}`, awkward: `Awkward ${kind}` };
  if (special[base]) return special[base]!;
  const label: Record<string, string> = { leaping: 'Leaping', swiftness: 'Swiftness', turtle_master: 'the Turtle Master', water_breathing: 'Water Breathing', fire_resistance: 'Fire Resistance', night_vision: 'Night Vision', slow_falling: 'Slow Falling', healing: 'Healing', harming: 'Harming' };
  const name = label[base] ?? base.charAt(0).toUpperCase() + base.slice(1);
  if (kind === 'Tipped Arrow') return `Arrow of ${name}`;
  return `${kind} of ${name}`;
}

// ------------------------------------------------------------------ brewing

interface Mix {
  from: string;
  ingredient: string;
  to: string;
}

const CONTAINER_MIXES: Mix[] = [
  { from: 'potion', ingredient: 'gunpowder', to: 'splash_potion' },
  { from: 'splash_potion', ingredient: 'dragon_breath', to: 'lingering_potion' },
];

/** PotionBrewing.bootStrap potion mixes, in order. */
const POTION_MIXES: Mix[] = [];
const mix = (from: string, ingredient: string, to: string) => POTION_MIXES.push({ from, ingredient, to });
mix('water', 'glistering_melon_slice', 'mundane');
mix('water', 'ghast_tear', 'mundane');
mix('water', 'rabbit_foot', 'mundane');
mix('water', 'blaze_powder', 'mundane');
mix('water', 'spider_eye', 'mundane');
mix('water', 'sugar', 'mundane');
mix('water', 'magma_cream', 'mundane');
mix('water', 'glowstone_dust', 'thick');
mix('water', 'redstone', 'mundane');
mix('water', 'nether_wart', 'awkward');
mix('awkward', 'golden_carrot', 'night_vision');
mix('night_vision', 'redstone', 'long_night_vision');
mix('night_vision', 'fermented_spider_eye', 'invisibility');
mix('long_night_vision', 'fermented_spider_eye', 'long_invisibility');
mix('invisibility', 'redstone', 'long_invisibility');
mix('awkward', 'magma_cream', 'fire_resistance');
mix('fire_resistance', 'redstone', 'long_fire_resistance');
mix('awkward', 'rabbit_foot', 'leaping');
mix('leaping', 'redstone', 'long_leaping');
mix('leaping', 'glowstone_dust', 'strong_leaping');
mix('leaping', 'fermented_spider_eye', 'slowness');
mix('long_leaping', 'fermented_spider_eye', 'long_slowness');
mix('slowness', 'redstone', 'long_slowness');
mix('slowness', 'glowstone_dust', 'strong_slowness');
mix('awkward', 'turtle_helmet', 'turtle_master');
mix('turtle_master', 'redstone', 'long_turtle_master');
mix('turtle_master', 'glowstone_dust', 'strong_turtle_master');
mix('swiftness', 'fermented_spider_eye', 'slowness');
mix('long_swiftness', 'fermented_spider_eye', 'long_slowness');
mix('awkward', 'sugar', 'swiftness');
mix('swiftness', 'redstone', 'long_swiftness');
mix('swiftness', 'glowstone_dust', 'strong_swiftness');
mix('awkward', 'pufferfish', 'water_breathing');
mix('water_breathing', 'redstone', 'long_water_breathing');
mix('awkward', 'glistering_melon_slice', 'healing');
mix('healing', 'glowstone_dust', 'strong_healing');
mix('healing', 'fermented_spider_eye', 'harming');
mix('strong_healing', 'fermented_spider_eye', 'strong_harming');
mix('harming', 'glowstone_dust', 'strong_harming');
mix('poison', 'fermented_spider_eye', 'harming');
mix('long_poison', 'fermented_spider_eye', 'harming');
mix('strong_poison', 'fermented_spider_eye', 'strong_harming');
mix('awkward', 'spider_eye', 'poison');
mix('poison', 'redstone', 'long_poison');
mix('poison', 'glowstone_dust', 'strong_poison');
mix('awkward', 'ghast_tear', 'regeneration');
mix('regeneration', 'redstone', 'long_regeneration');
mix('regeneration', 'glowstone_dust', 'strong_regeneration');
mix('awkward', 'blaze_powder', 'strength');
mix('strength', 'redstone', 'long_strength');
mix('strength', 'glowstone_dust', 'strong_strength');
mix('water', 'fermented_spider_eye', 'weakness');
mix('weakness', 'redstone', 'long_weakness');
mix('awkward', 'phantom_membrane', 'slow_falling');
mix('slow_falling', 'redstone', 'long_slow_falling');

const nameOf = (id: number) => ITEMS_BY_ID[id]?.name ?? '';
const INGREDIENTS = new Set([...CONTAINER_MIXES, ...POTION_MIXES].map((m) => m.ingredient));

/** PotionBrewing.isIngredient */
export function isIngredient(s: ItemStack | null | undefined): boolean {
  return !!s && INGREDIENTS.has(nameOf(s.id));
}

/** PotionBrewing.hasMix */
export function hasMix(input: ItemStack, ingredient: ItemStack): boolean {
  const ing = nameOf(ingredient.id), item = nameOf(input.id);
  if (CONTAINER_MIXES.some((m) => m.from === item && m.ingredient === ing)) return true;
  const p = potionOf(input);
  return POTION_MIXES.some((m) => m.from === p && m.ingredient === ing);
}

/** PotionBrewing.mix: the brewed result (or the input unchanged). */
export function brew(ingredient: ItemStack, input: ItemStack | null): ItemStack | null {
  if (!input || input.count <= 0) return input;
  const p = potionOf(input), item = nameOf(input.id), ing = nameOf(ingredient.id);
  for (const m of CONTAINER_MIXES) if (m.from === item && m.ingredient === ing) return potionStack(m.to as 'splash_potion', p);
  for (const m of POTION_MIXES) if (m.from === p && m.ingredient === ing) return { id: input.id, count: 1, damage: 0, tag: { Potion: m.to } };
  return input;
}

/** BrewingStandMenu.PotionSlot.mayPlaceItem */
export const isBrewingBottle = (s: ItemStack): boolean => isPotionItem(s.id) || s.id === BOTTLE;
export const isBrewingFuel = (s: ItemStack): boolean => s.id === BLAZE;

export interface BrewingData {
  [key: string]: unknown;
  id: 'brewing_stand';
  /** 0–2 bottles, 3 ingredient, 4 fuel */
  items: (ItemStack | null)[];
  brewTime: number;
  fuel: number;
  /** ingredient item id the current brew started with */
  ingredient: number;
}

export const newBrewingStand = (): BrewingData => ({ id: 'brewing_stand', items: [null, null, null, null, null], brewTime: 0, fuel: 0, ingredient: 0 });

/** BrewingStandBlockEntity.isBrewable */
export function isBrewable(items: (ItemStack | null)[]): boolean {
  const ing = items[3];
  if (!ing || ing.count <= 0 || !isIngredient(ing)) return false;
  for (let i = 0; i < 3; i++) {
    const s = items[i];
    if (s && s.count > 0 && hasMix(s, ing)) return true;
  }
  return false;
}

export interface BrewTickResult {
  changed: boolean;
  /** brewing finished this tick (level event 1035) */
  brewed: boolean;
  /** crafting remainder that did not fit back into the ingredient slot (dragon's breath bottle) */
  drop: ItemStack | null;
}

/** BrewingStandBlockEntity.serverTick (one tick). */
export function tickBrewingStand(b: BrewingData): BrewTickResult {
  const res: BrewTickResult = { changed: false, brewed: false, drop: null };
  const fuel = b.items[4];
  if (b.fuel <= 0 && fuel && fuel.id === BLAZE) {
    b.fuel = 20;
    fuel.count--;
    if (fuel.count <= 0) b.items[4] = null;
    res.changed = true;
  }
  const can = isBrewable(b.items);
  const ing = b.items[3];
  if (b.brewTime > 0) {
    b.brewTime--;
    if (b.brewTime === 0 && can) {
      // doBrew
      for (let i = 0; i < 3; i++) b.items[i] = brew(ing!, b.items[i] ?? null);
      ing!.count--;
      const remainder = nameOf(ing!.id) === 'dragon_breath' ? { id: BOTTLE, count: 1, damage: 0 } : null;
      if (ing!.count <= 0) b.items[3] = remainder;
      else if (remainder) res.drop = remainder;
      res.brewed = true;
      res.changed = true;
    } else if (!can || !ing || ing.id !== b.ingredient) {
      b.brewTime = 0;
      res.changed = true;
    }
  } else if (can && b.fuel > 0) {
    b.fuel--;
    b.brewTime = 400;
    b.ingredient = ing!.id;
    res.changed = true;
  }
  return res;
}

/** has_bottle_0..2 block state flags. */
export function bottleBits(b: BrewingData): [boolean, boolean, boolean] {
  return [!!b.items[0], !!b.items[1], !!b.items[2]];
}
