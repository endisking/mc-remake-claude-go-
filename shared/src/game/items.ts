/**
 * Item behaviour tables (vanilla Item subclasses, 1.17.1): durability use per action, armour
 * materials, food properties with their effects, use durations/animations and the bow power
 * curve. Pure logic shared by the server (authoritative) and the client (prediction, HUD).
 */
import { ITEMS_BY_ID, FOODS_BY_NAME } from '../data';
import { blockNameOf } from '../world/blockstate';
import type { ItemStack } from '../item/stack';
import { hardness } from './mining';

export function nameOf(id: number): string {
  return ITEMS_BY_ID[id]?.name ?? 'air';
}

// ------------------------------------------------------------------ durability

/** Item.getMaxDamage (0 = not damageable). */
export function maxDamage(id: number): number {
  return ITEMS_BY_ID[id]?.maxDurability ?? 0;
}

export function isDamageable(id: number): boolean {
  return maxDamage(id) > 0;
}

export type ToolKind = 'sword' | 'axe' | 'pickaxe' | 'shovel' | 'hoe';
const TOOL_RE = /^(wooden|stone|iron|golden|diamond|netherite)_(sword|axe|pickaxe|shovel|hoe)$/;

export function toolKind(id: number): ToolKind | null {
  const m = nameOf(id).match(TOOL_RE);
  return m ? (m[2] as ToolKind) : null;
}

/** Interface of a random source (JavaRandom fits). */
export interface Rand {
  nextFloat(): number;
  nextInt(n: number): number;
}

/**
 * ItemStack.hurt: apply `amount` durability damage, each point ignored with Unbreaking
 * (DigDurabilityEnchantment.shouldIgnoreDurabilityDrop: armour only gets the reroll 40% of the
 * time). Returns true when the item breaks (damage reaches max).
 */
export function hurtItem(stack: ItemStack, amount: number, rand: Rand, unbreaking = 0): boolean {
  const max = maxDamage(stack.id);
  if (max <= 0) return false;
  if (amount > 0 && unbreaking > 0) {
    const armor = isArmor(stack.id);
    let ignored = 0;
    for (let k = 0; k < amount; k++) {
      if (armor && rand.nextFloat() < 0.6) continue;
      if (rand.nextInt(unbreaking + 1) > 0) ignored++;
    }
    amount -= ignored;
    if (amount <= 0) return false;
  }
  if (amount <= 0) return false;
  stack.damage += amount;
  return stack.damage >= max;
}

/**
 * Item.mineBlock durability cost for breaking `state` (0 for none). Diggers (axes, pickaxes,
 * shovels, hoes) take 1, swords and tridents 2, on any block that isn't instantly broken;
 * shears take 1 on everything except fire.
 */
export function mineBlockCost(itemId: number, state: number): number {
  const n = nameOf(itemId);
  if (n === 'shears') {
    const b = blockNameOf(state);
    return b === 'fire' || b === 'soul_fire' ? 0 : 1;
  }
  const kind = toolKind(itemId);
  if (!kind && n !== 'trident') return 0;
  if (hardness(state) === 0) return 0;
  return kind === 'sword' || n === 'trident' ? 2 : 1;
}

/** Item.hurtEnemy durability cost for a successful melee hit: swords/tridents 1, diggers 2. */
export function hurtEnemyCost(itemId: number): number {
  const n = nameOf(itemId);
  if (n === 'trident') return 1;
  const kind = toolKind(itemId);
  if (!kind) return 0;
  return kind === 'sword' ? 1 : 2;
}

/** Entity events that play the item break sound and particles (LivingEntity.entityEventForEquipmentBreak). */
export const BREAK_EVENT = { mainHand: 47, offHand: 48, head: 49, chest: 50, legs: 51, feet: 52 } as const;

// ------------------------------------------------------------------ armour

export type ArmorSlot = 'feet' | 'legs' | 'chest' | 'head';
/** Inventory slot for each armour slot (36 boots … 39 helmet). */
export const ARMOR_INV_SLOT: Record<ArmorSlot, number> = { feet: 36, legs: 37, chest: 38, head: 39 };

interface ArmorMaterial {
  /** defense per slot: feet, legs, chest, head */
  defense: [number, number, number, number];
  toughness: number;
  knockbackResistance: number;
  equipSound: string;
}

/** ArmorMaterials (1.17.1). */
export const ARMOR_MATERIALS: Record<string, ArmorMaterial> = {
  leather: { defense: [1, 2, 3, 1], toughness: 0, knockbackResistance: 0, equipSound: 'item.armor.equip_leather' },
  chainmail: { defense: [1, 4, 5, 2], toughness: 0, knockbackResistance: 0, equipSound: 'item.armor.equip_chain' },
  iron: { defense: [2, 5, 6, 2], toughness: 0, knockbackResistance: 0, equipSound: 'item.armor.equip_iron' },
  golden: { defense: [1, 3, 5, 2], toughness: 0, knockbackResistance: 0, equipSound: 'item.armor.equip_gold' },
  diamond: { defense: [3, 6, 8, 3], toughness: 2, knockbackResistance: 0, equipSound: 'item.armor.equip_diamond' },
  turtle: { defense: [2, 5, 6, 2], toughness: 0, knockbackResistance: 0, equipSound: 'item.armor.equip_turtle' },
  netherite: { defense: [3, 6, 8, 3], toughness: 3, knockbackResistance: 0.1, equipSound: 'item.armor.equip_netherite' },
};

const PIECE_SLOT: Record<string, ArmorSlot> = { boots: 'feet', leggings: 'legs', chestplate: 'chest', helmet: 'head' };
const SLOT_INDEX: Record<ArmorSlot, number> = { feet: 0, legs: 1, chest: 2, head: 3 };

export interface ArmorInfo {
  material: string;
  slot: ArmorSlot;
  defense: number;
  toughness: number;
  knockbackResistance: number;
  equipSound: string;
}

/** ArmorItem properties of an item, or null. */
export function armorInfo(id: number): ArmorInfo | null {
  const n = nameOf(id);
  if (n === 'turtle_helmet') {
    const m = ARMOR_MATERIALS.turtle!;
    return { material: 'turtle', slot: 'head', defense: m.defense[3], toughness: 0, knockbackResistance: 0, equipSound: m.equipSound };
  }
  const mm = n.match(/^(leather|chainmail|iron|golden|diamond|netherite)_(boots|leggings|chestplate|helmet)$/);
  if (!mm) return null;
  const m = ARMOR_MATERIALS[mm[1]!]!;
  const slot = PIECE_SLOT[mm[2]!]!;
  return { material: mm[1]!, slot, defense: m.defense[SLOT_INDEX[slot]], toughness: m.toughness, knockbackResistance: m.knockbackResistance, equipSound: m.equipSound };
}

export function isArmor(id: number): boolean {
  return armorInfo(id) !== null;
}

/**
 * Mob.getEquipmentSlotForItem for right-click equipping: armour pieces, elytra (chest), carved
 * pumpkins and mob heads (head). Null for anything else.
 */
export function equipSlotFor(id: number): ArmorSlot | null {
  const a = armorInfo(id);
  if (a) return a.slot;
  const n = nameOf(id);
  if (n === 'elytra') return 'chest';
  return null;
}

/** Sum of armour points and toughness of worn pieces (ARMOR / ARMOR_TOUGHNESS attributes). */
export function armorTotals(worn: (ItemStack | null | undefined)[]): { armor: number; toughness: number; knockbackResistance: number } {
  let armor = 0, toughness = 0, kb = 0;
  for (const s of worn) {
    if (!s || s.count <= 0) continue;
    const a = armorInfo(s.id);
    if (!a) continue;
    armor += a.defense;
    toughness += a.toughness;
    kb += a.knockbackResistance;
  }
  return { armor: Math.min(armor, 30), toughness: Math.min(toughness, 20), knockbackResistance: Math.min(kb, 1) };
}

/** CombatRules.getDamageAfterAbsorb: armour points and toughness. */
export function damageAfterArmor(damage: number, armor: number, toughness: number): number {
  const f = 2 + toughness / 4;
  const f1 = Math.max(armor * 0.2, Math.min(armor - damage / f, 20));
  return damage * (1 - f1 / 25);
}

/** Inventory.hurtArmor: durability each worn armour piece loses from a hit (0 for none). */
export function armorDurabilityLoss(damage: number): number {
  if (damage <= 0) return 0;
  return Math.max(1, Math.floor(damage / 4));
}

/** LivingEntity.getDamageAfterMagicAbsorb (Resistance part): amplifier −1 = no effect. */
export function damageAfterResistance(damage: number, resistanceAmplifier: number): number {
  if (resistanceAmplifier < 0) return damage;
  const i = (resistanceAmplifier + 1) * 5;
  return Math.max((damage * (25 - i)) / 25, 0);
}

// ------------------------------------------------------------------ food

export interface FoodEffect {
  /** effect registry name (minecraft-data effect names in snake_case: regeneration, poison…) */
  effect: string;
  duration: number;
  amplifier: number;
  probability: number;
}

export interface FoodProps {
  nutrition: number;
  /** saturation modifier (vanilla FoodProperties.saturationModifier) */
  saturationModifier: number;
  alwaysEat: boolean;
  fastFood: boolean;
  meat: boolean;
  effects: FoodEffect[];
}

const e = (effect: string, duration: number, amplifier: number, probability = 1): FoodEffect => ({ effect, duration, amplifier, probability });

/** Extra food properties not in minecraft-data (Foods.java). */
const FOOD_EXTRA: Record<string, Partial<FoodProps>> = {
  golden_apple: { alwaysEat: true, effects: [e('regeneration', 100, 1), e('absorption', 2400, 0)] },
  enchanted_golden_apple: { alwaysEat: true, effects: [e('regeneration', 400, 1), e('resistance', 6000, 0), e('fire_resistance', 6000, 0), e('absorption', 2400, 3)] },
  rotten_flesh: { meat: true, effects: [e('hunger', 600, 0, 0.8)] },
  chicken: { meat: true, effects: [e('hunger', 600, 0, 0.3)] },
  pufferfish: { effects: [e('poison', 1200, 1), e('hunger', 300, 2), e('nausea', 300, 0)] },
  spider_eye: { effects: [e('poison', 100, 0)] },
  poisonous_potato: { effects: [e('poison', 100, 0, 0.6)] },
  chorus_fruit: { alwaysEat: true },
  suspicious_stew: { alwaysEat: true },
  dried_kelp: { fastFood: true },
  beef: { meat: true }, cooked_beef: { meat: true }, porkchop: { meat: true }, cooked_porkchop: { meat: true },
  cooked_chicken: { meat: true }, mutton: { meat: true }, cooked_mutton: { meat: true }, rabbit: { meat: true },
  cooked_rabbit: { meat: true }, rabbit_stew: { meat: false },
};

const foodCache = new Map<number, FoodProps | null>();

/** Item.getFoodProperties. Nutrition and saturation come from minecraft-data foods. */
export function foodProps(id: number): FoodProps | null {
  let f = foodCache.get(id);
  if (f !== undefined) return f;
  const n = nameOf(id);
  const d = FOODS_BY_NAME.get(n);
  f = null;
  if (d) {
    const x = FOOD_EXTRA[n] ?? {};
    // minecraft-data saturationRatio = 2 × saturationModifier
    f = { nutrition: d.foodPoints, saturationModifier: d.saturationRatio / 2, alwaysEat: !!x.alwaysEat, fastFood: !!x.fastFood, meat: !!x.meat, effects: x.effects ?? [] };
  }
  foodCache.set(id, f);
  return f;
}

/** Item that gives back a container when consumed (BowlFoodItem, MilkBucketItem, HoneyBottleItem). */
export function useRemainder(id: number): string | null {
  const n = nameOf(id);
  if (n === 'mushroom_stew' || n === 'rabbit_stew' || n === 'beetroot_soup' || n === 'suspicious_stew') return 'bowl';
  if (n === 'milk_bucket') return 'bucket';
  if (n === 'honey_bottle' || n === 'potion') return 'glass_bottle';
  return null;
}

export type UseAnim = 'none' | 'eat' | 'drink' | 'block' | 'bow' | 'spear' | 'crossbow' | 'spyglass';

/** Item.getUseAnimation. */
export function useAnim(id: number): UseAnim {
  const n = nameOf(id);
  if (n === 'milk_bucket' || n === 'honey_bottle' || n === 'potion') return 'drink';
  if (n === 'bow') return 'bow';
  if (n === 'crossbow') return 'crossbow';
  if (n === 'trident') return 'spear';
  if (n === 'shield') return 'block';
  if (n === 'spyglass') return 'spyglass';
  if (foodProps(id)) return 'eat';
  return 'none';
}

/** Item.getUseDuration in ticks (0 = not a held-use item). */
export function useDuration(id: number): number {
  const n = nameOf(id);
  if (n === 'bow' || n === 'trident' || n === 'shield') return 72000;
  if (n === 'milk_bucket' || n === 'potion') return 32;
  if (n === 'honey_bottle') return 40;
  if (n === 'spyglass') return 1200;
  const f = foodProps(id);
  if (f) return f.fastFood ? 16 : 32;
  return 0;
}

/**
 * Whether right-clicking with this item starts using it (Item.use → startUsingItem) for a
 * player with the given food state. Bows need ammo (or creative).
 */
export function canStartUsing(id: number, ctx: { foodLevel: number; creative: boolean; hasArrows: boolean }): boolean {
  const n = nameOf(id);
  if (n === 'bow') return ctx.creative || ctx.hasArrows;
  if (n === 'shield') return true;
  if (n === 'milk_bucket' || n === 'honey_bottle' || n === 'potion') return true;
  const f = foodProps(id);
  // Player.canEat: invulnerable (creative) players can always eat
  if (f) return f.alwaysEat || ctx.foodLevel < 20 || ctx.creative;
  return false;
}

/**
 * LivingEntity.shouldTriggerItemUseEffects (1.17): sounds/particles every 4 ticks once 7 ticks
 * of eating passed (fast food from the start).
 */
export function shouldTriggerUseEffects(id: number, remaining: number): boolean {
  const f = foodProps(id);
  let flag = !!f && f.fastFood;
  flag ||= remaining <= useDuration(id) - 7;
  return flag && remaining % 4 === 0;
}

// ------------------------------------------------------------------ bow

/** BowItem.getPowerForTime: draw power 0–1 after `ticks` of charging. */
export function bowPower(ticks: number): number {
  let f = ticks / 20;
  f = (f * f + f * 2) / 3;
  return f > 1 ? 1 : f;
}

/** Arrows the bow can shoot (Player.getProjectile with BowItem.ARROW_ONLY). */
export const ARROW_ITEMS = ['arrow', 'spectral_arrow', 'tipped_arrow'] as const;

export function isArrow(id: number): boolean {
  return (ARROW_ITEMS as readonly string[]).includes(nameOf(id));
}
