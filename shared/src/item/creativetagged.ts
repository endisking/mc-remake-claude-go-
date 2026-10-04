/**
 * Creative inventory entries that need item NBT (Phase 7): every potion, splash and lingering
 * potion in the Brewing tab (PotionItem.fillItemCategory, registry order), and enchanted books
 * at their maximum level in the Tools and Combat tabs by enchantment category
 * (EnchantedBookItem.fillItemCategory with CreativeModeTab.getEnchantmentCategories).
 */
import { ENCHANTMENTS, ITEMS_BY_NAME } from '../data';
import { POTIONS } from '../game/potions';
import type { ItemStack } from './stack';
import type { CreativeTab } from './creativetabs';

const TOOLS_CATS = new Set(['vanishable', 'digger', 'fishing_rod', 'breakable']);
const COMBAT_CATS = new Set(['vanishable', 'armor', 'armor_feet', 'armor_head', 'armor_legs', 'armor_chest', 'bow', 'weapon', 'wearable', 'breakable', 'trident', 'crossbow']);

export function creativeTaggedStacks(tab: CreativeTab): ItemStack[] {
  const out: ItemStack[] = [];
  if (tab === 'brewing') {
    for (const item of ['potion', 'splash_potion', 'lingering_potion']) {
      const id = ITEMS_BY_NAME.get(item)?.id;
      if (id === undefined) continue;
      for (const p of Object.keys(POTIONS)) if (p !== 'empty') out.push({ id, count: 1, damage: 0, tag: { Potion: p } });
    }
  }
  if (tab === 'tools' || tab === 'combat') {
    const cats = tab === 'tools' ? TOOLS_CATS : COMBAT_CATS;
    const book = ITEMS_BY_NAME.get('enchanted_book')?.id;
    if (book !== undefined) {
      for (const e of ENCHANTMENTS) if (cats.has(e.category)) out.push({ id: book, count: 1, damage: 0, tag: { StoredEnchantments: [{ id: e.name, lvl: e.maxLevel }] } });
    }
  }
  return out;
}
