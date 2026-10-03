/**
 * Typed access to the generated 1.17.1 data tables (see tools/datagen).
 */
import blocksJson from './generated/blocks.json';
import shapesJson from './generated/collisionShapes.json';
import itemsJson from './generated/items.json';
import foodsJson from './generated/foods.json';
import materialsJson from './generated/materials.json';
import entitiesJson from './generated/entities.json';
import biomesJson from './generated/biomes.json';
import tintsJson from './generated/tints.json';
import enchantmentsJson from './generated/enchantments.json';
import effectsJson from './generated/effects.json';
import attributesJson from './generated/attributes.json';
import instrumentsJson from './generated/instruments.json';
import particlesJson from './generated/particles.json';
import soundsJson from './generated/sounds.json';
import blockLootJson from './generated/blockLoot.json';
import entityLootJson from './generated/entityLoot.json';
import recipesJson from './generated/recipes.json';
import metaJson from './generated/meta.json';

export interface BlockStateProp {
  name: string;
  type: 'enum' | 'bool' | 'int' | 'direction';
  num_values: number;
  values?: string[];
}

export interface BlockData {
  id: number;
  name: string;
  displayName: string;
  hardness: number | null;
  resistance: number;
  stackSize: number;
  diggable: boolean;
  material: string;
  transparent: boolean;
  emitLight: number;
  filterLight: number;
  defaultState: number;
  minStateId: number;
  maxStateId: number;
  states: BlockStateProp[];
  /** item ids of tools that can harvest this block (null: any/hand) */
  harvestTools: number[] | null;
  drops: number[];
  boundingBox: 'block' | 'empty';
  /** collision shape id for all states, or an array indexed by (stateId - minStateId) */
  shape: number | number[];
}

export interface ItemData {
  id: number;
  name: string;
  displayName: string;
  stackSize: number;
  maxDurability: number;
  enchantCategories: string[];
  repairWith: string[];
}

export interface FoodData {
  id: number;
  name: string;
  displayName: string;
  stackSize: number;
  foodPoints: number;
  saturation: number;
  effectiveQuality: number;
  saturationRatio: number;
}

export interface EntityData {
  id: number;
  name: string;
  displayName: string;
  width: number;
  height: number;
  type: string;
  category: string | null;
}

export interface BiomeData {
  id: number;
  name: string;
  category: string;
  temperature: number;
  precipitation: 'rain' | 'snow' | 'none';
  depth: number;
  dimension: 'overworld' | 'the_nether' | 'the_end';
  displayName: string;
  color: number;
  rainfall: number;
}

export interface EnchantmentData {
  id: number;
  name: string;
  displayName: string;
  maxLevel: number;
  minCost: { a: number; b: number };
  maxCost: { a: number; b: number };
  treasureOnly: boolean;
  curse: boolean;
  exclude: string[];
  category: string;
  weight: number;
  tradeable: boolean;
  discoverable: boolean;
}

export interface EffectData {
  id: number;
  name: string;
  displayName: string;
  type: 'good' | 'bad';
}

export interface RecipeData {
  result: { id: number; count: number };
  /** shaped: rows of item ids (null = empty) */
  inShape: (number | null)[][] | null;
  outShape: (number | null)[][] | null;
  /** shapeless: list of item ids */
  ingredients: number[] | null;
  resultKey: number;
}

export interface LootDrop {
  item: string;
  dropChance: number;
  stackSizeRange: [number, number?];
  silkTouch?: boolean;
  noSilkTouch?: boolean;
  blockAge?: number;
  playerKill?: boolean;
}

export interface TintTable {
  data: { keys: (string | number)[]; color: number }[];
  default?: number;
}

export const BLOCKS = blocksJson as unknown as BlockData[];
export const COLLISION_SHAPES = shapesJson as unknown as Record<string, number[][]>;
export const ITEMS = itemsJson as ItemData[];
export const FOODS = foodsJson as FoodData[];
export const MATERIALS = materialsJson as Record<string, Record<string, number>>;
export const ENTITIES = entitiesJson as EntityData[];
export const BIOMES = biomesJson as BiomeData[];
export const TINTS = tintsJson as unknown as Record<'grass' | 'foliage' | 'water' | 'redstone' | 'constant', TintTable>;
export const ENCHANTMENTS = enchantmentsJson as EnchantmentData[];
export const EFFECTS = effectsJson as EffectData[];
export const ATTRIBUTES = attributesJson as { name: string; resource: string; default: number; min: number; max: number }[];
export const INSTRUMENTS = instrumentsJson as { id: number; name: string }[];
export const PARTICLES = particlesJson as { id: number; name: string }[];
export const SOUND_EVENTS = soundsJson as { id: number; name: string }[];
export const BLOCK_LOOT = blockLootJson as unknown as { block: string; drops: LootDrop[] }[];
export const ENTITY_LOOT = entityLootJson as unknown as { entity: string; drops: LootDrop[] }[];
export const RECIPES = recipesJson as unknown as RecipeData[];
export const DATA_META = metaJson;

function byName<T extends { name: string }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of list) m.set(x.name, x);
  return m;
}

export const BLOCKS_BY_NAME = byName(BLOCKS);
export const ITEMS_BY_NAME = byName(ITEMS);
export const ENTITIES_BY_NAME = byName(ENTITIES);
export const BIOMES_BY_NAME = byName(BIOMES);
export const ENCHANTMENTS_BY_NAME = byName(ENCHANTMENTS);
export const FOODS_BY_NAME = byName(FOODS);

/** Total number of block states (global palette size). */
export const BLOCK_STATE_COUNT: number = DATA_META.counts.blockStates;
