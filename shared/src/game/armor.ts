/** Armour (vanilla CombatRules + ArmorMaterials, 1.17.1). */
import { ITEMS_BY_ID } from '../data';

/** CombatRules.getDamageAfterAbsorb: armour points and toughness reduce damage (max 80%). */
export function damageAfterArmor(damage: number, armor: number, toughness: number): number {
  const f = 2 + toughness / 4;
  const f1 = Math.max(0, Math.min(20, armor - damage / f));
  return damage * (1 - Math.max(armor / 5, f1) / 25);
}

/** CombatRules.getDamageAfterMagicAbsorb (Protection enchantments; max 20 points). */
export function damageAfterMagicAbsorb(damage: number, protection: number): number {
  const f = Math.max(0, Math.min(20, protection));
  return damage * (1 - f / 25);
}

// ArmorMaterials: defense per slot [boots, legs, chest, helmet], toughness, knockback resistance
const MATERIALS: Record<string, { def: [number, number, number, number]; tough: number; kb: number }> = {
  leather: { def: [1, 2, 3, 1], tough: 0, kb: 0 },
  chainmail: { def: [1, 4, 5, 2], tough: 0, kb: 0 },
  iron: { def: [2, 5, 6, 2], tough: 0, kb: 0 },
  golden: { def: [1, 3, 5, 2], tough: 0, kb: 0 },
  diamond: { def: [3, 6, 8, 3], tough: 2, kb: 0 },
  netherite: { def: [3, 6, 8, 3], tough: 3, kb: 0.1 },
  turtle: { def: [2, 5, 6, 2], tough: 0, kb: 0 },
};
const PIECES = ['boots', 'leggings', 'chestplate', 'helmet'] as const;

/** Armour points, toughness and knockback resistance of one armour item (null if not armour). */
export function armorValues(itemId: number): { slot: number; armor: number; toughness: number; knockbackResistance: number } | null {
  const n = ITEMS_BY_ID[itemId]?.name ?? '';
  if (n === 'turtle_helmet') return { slot: 3, armor: 2, toughness: 0, knockbackResistance: 0 };
  const m = n.match(/^(leather|chainmail|iron|golden|diamond|netherite)_(boots|leggings|chestplate|helmet)$/);
  if (!m) return null;
  const mat = MATERIALS[m[1]!]!;
  const slot = PIECES.indexOf(m[2] as (typeof PIECES)[number]);
  return { slot, armor: mat.def[slot]!, toughness: mat.tough, knockbackResistance: mat.kb };
}

/** Total armour attributes of worn items (ids for boots, legs, chest, head; 0 = none). */
export function totalArmor(items: number[]): { armor: number; toughness: number; knockbackResistance: number } {
  let armor = 0, toughness = 0, kb = 0;
  for (const id of items) {
    const v = id ? armorValues(id) : null;
    if (!v) continue;
    armor += v.armor;
    toughness += v.toughness;
    kb += v.knockbackResistance;
  }
  return { armor, toughness, knockbackResistance: kb };
}
