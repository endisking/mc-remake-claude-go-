/**
 * Enchantments (vanilla Enchantment / EnchantmentHelper / EnchantmentMenu / CombatRules),
 * Java Edition 1.17.1. Enchantment data (costs, weights, categories, exclusions) comes from
 * minecraft-data 1.17.1; registry order = id order.
 */
import { ENCHANTMENTS, ITEMS_BY_ID, ITEMS_BY_NAME, type EnchantmentData } from '../data';
import { JavaRandom } from '../util/random';
import type { ItemStack, EnchEntry, Inventory } from '../item/stack';

export type Ench = EnchantmentData;

export const ENCH_BY_NAME = new Map<string, Ench>(ENCHANTMENTS.map((e) => [e.name, e]));
export const ENCH_BY_ID: (Ench | undefined)[] = [];
for (const e of ENCHANTMENTS) ENCH_BY_ID[e.id] = e;

const BOOK = ITEMS_BY_NAME.get('book')?.id ?? -1;
const ENCHANTED_BOOK = ITEMS_BY_NAME.get('enchanted_book')?.id ?? -1;

export function enchByName(name: string): Ench {
  const e = ENCH_BY_NAME.get(name.replace(/^minecraft:/, ''));
  if (!e) throw new Error(`unknown enchantment ${name}`);
  return e;
}

/** Enchantment.getMinCost / getMaxCost (linear a·level + b, see minecraft-data). */
export const minCost = (e: Ench, lvl: number): number => e.minCost.a * lvl + e.minCost.b;
export const maxCost = (e: Ench, lvl: number): number => e.maxCost.a * lvl + e.maxCost.b;

/** Enchantment.isCompatibleWith (both directions of checkCompatibility). */
export function isCompatible(a: Ench, b: Ench): boolean {
  return a !== b && !a.exclude.includes(b.name) && !b.exclude.includes(a.name);
}

/** EnchantmentCategory.canEnchant for an item id. */
export function canEnchantItem(e: Ench, itemId: number): boolean {
  return (ITEMS_BY_ID[itemId]?.enchantCategories ?? []).includes(e.category);
}

// ------------------------------------------------------------------ item values

const TIER_VALUE: Record<string, number> = { wooden: 15, stone: 5, iron: 14, diamond: 10, golden: 22, netherite: 15 };
const ARMOR_VALUE: Record<string, number> = { leather: 15, chainmail: 12, iron: 9, golden: 25, diamond: 10, netherite: 15 };

/** Item.getEnchantmentValue (enchantability): 0 = cannot be enchanted at a table. */
export function enchantability(itemId: number): number {
  const n = ITEMS_BY_ID[itemId]?.name ?? '';
  let m = n.match(/^(wooden|stone|iron|diamond|golden|netherite)_(sword|pickaxe|axe|shovel|hoe)$/);
  if (m) return TIER_VALUE[m[1]!]!;
  m = n.match(/^(leather|chainmail|iron|diamond|golden|netherite)_(helmet|chestplate|leggings|boots)$/);
  if (m) return ARMOR_VALUE[m[1]!]!;
  if (n === 'turtle_helmet') return 9;
  if (n === 'bow' || n === 'crossbow' || n === 'trident' || n === 'fishing_rod' || n === 'book') return 1;
  return 0;
}

/** ItemStack.isEnchantable: a single damageable item without enchantments, or one book. */
export function isEnchantable(s: ItemStack): boolean {
  if (s.id === BOOK) return s.count === 1;
  const it = ITEMS_BY_ID[s.id];
  if (!it || it.stackSize !== 1 || !(it.maxDurability > 0)) return false;
  return !isEnchanted(s);
}

export function isEnchanted(s: ItemStack): boolean {
  return (s.tag?.Enchantments?.length ?? 0) > 0;
}

/** ItemStack.hasFoil: enchanted items and enchanted books glint (plus a few always-foil items). */
export function hasFoil(s: { id: number; tag?: ItemStack['tag'] }): boolean {
  if ((s.tag?.Enchantments?.length ?? 0) > 0 || (s.tag?.StoredEnchantments?.length ?? 0) > 0) return true;
  const n = ITEMS_BY_ID[s.id]?.name ?? '';
  return n === 'enchanted_golden_apple' || n === 'experience_bottle' || n === 'nether_star' || n === 'end_crystal' || n === 'written_book' || n === 'enchanted_book' || n === 'debug_stick';
}

// ------------------------------------------------------------------ reading / writing stacks

/** EnchantmentHelper.getEnchantments (stored enchantments for enchanted books). */
export function enchantmentsOf(s: ItemStack | null | undefined): EnchEntry[] {
  if (!s) return [];
  if (s.id === ENCHANTED_BOOK) return s.tag?.StoredEnchantments ?? [];
  return s.tag?.Enchantments ?? [];
}

/** EnchantmentHelper.getItemEnchantmentLevel (Enchantments list only; books don't count). */
export function enchLevel(name: string, s: ItemStack | null | undefined): number {
  if (!s || !s.tag?.Enchantments) return 0;
  for (const e of s.tag.Enchantments) if (e.id === name || e.id === `minecraft:${name}`) return Math.max(0, Math.min(255, e.lvl));
  return 0;
}

/** ItemStack.enchant */
export function enchantStack(s: ItemStack, name: string, lvl: number): void {
  s.tag ??= {};
  (s.tag.Enchantments ??= []).push({ id: name, lvl });
}

/** EnchantedBookItem.addEnchantment: keeps the higher level of a duplicate. */
export function addStoredEnchantment(s: ItemStack, name: string, lvl: number): void {
  s.tag ??= {};
  const list = (s.tag.StoredEnchantments ??= []);
  const cur = list.find((e) => e.id === name);
  if (cur) cur.lvl = Math.max(cur.lvl, lvl);
  else list.push({ id: name, lvl });
}

/** EnchantmentHelper.isEnchantmentCompatible */
export function compatibleWithAll(existing: EnchEntry[], e: Ench): boolean {
  for (const x of existing) {
    const o = ENCH_BY_NAME.get(x.id.replace(/^minecraft:/, ''));
    if (o && !isCompatible(o, e)) return false;
  }
  return true;
}

/** Display line for an enchantment ("Sharpness V"; curses are red in the tooltip). */
export function enchantmentLine(name: string, lvl: number): string {
  const e = ENCH_BY_NAME.get(name.replace(/^minecraft:/, ''));
  const label = e?.displayName ?? name;
  if (e && e.maxLevel === 1 && lvl === 1) return label;
  const R = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return `${label} ${R[lvl] ?? `enchantment.level.${lvl}`}`;
}

// ------------------------------------------------------------------ equipment helpers

/** Enchantment slot sets (Enchantment constructor slots). */
type SlotSet = 'mainhand' | 'armor' | 'feet' | 'head' | 'all';
const SLOTS: Record<string, SlotSet> = {
  protection: 'armor', fire_protection: 'armor', feather_falling: 'armor', blast_protection: 'armor', projectile_protection: 'armor',
  respiration: 'head', aqua_affinity: 'head', thorns: 'armor', depth_strider: 'feet', frost_walker: 'feet', binding_curse: 'armor',
  soul_speed: 'feet', mending: 'all', vanishing_curse: 'all',
};

/** Equipment of a player inventory for a slot set (main hand, off hand, feet, legs, chest, head). */
function slotItems(inv: Inventory, set: SlotSet): (ItemStack | null)[] {
  switch (set) {
    case 'mainhand': return [inv.get(inv.selected)];
    case 'armor': return [inv.get(36), inv.get(37), inv.get(38), inv.get(39)];
    case 'feet': return [inv.get(36)];
    case 'head': return [inv.get(39)];
    case 'all': return [inv.get(inv.selected), inv.get(40), inv.get(36), inv.get(37), inv.get(38), inv.get(39)];
  }
}

/** EnchantmentHelper.getEnchantmentLevel(Enchantment, LivingEntity): the highest level among its slots. */
export function entityEnchLevel(name: string, inv: Inventory): number {
  let best = 0;
  for (const s of slotItems(inv, SLOTS[name] ?? 'mainhand')) best = Math.max(best, enchLevel(name, s));
  return best;
}

/** LivingEntity.getArmorSlots (feet, legs, chest, head). */
export function armorItems(inv: Inventory): (ItemStack | null)[] {
  return [inv.get(36), inv.get(37), inv.get(38), inv.get(39)];
}

/** EnchantmentHelper.getRandomItemWith: a random equipped item with the enchantment (and filter). */
export function randomItemWith(name: string, inv: Inventory, rand: { nextInt(n: number): number }, filter: (s: ItemStack) => boolean = () => true): { slot: number; stack: ItemStack } | null {
  const set = SLOTS[name] ?? 'mainhand';
  const slots = set === 'all' ? [inv.selected, 40, 36, 37, 38, 39] : set === 'armor' ? [36, 37, 38, 39] : set === 'feet' ? [36] : set === 'head' ? [39] : [inv.selected];
  const list: { slot: number; stack: ItemStack }[] = [];
  for (const slot of slots) {
    const s = inv.get(slot);
    if (s && enchLevel(name, s) > 0 && filter(s)) list.push({ slot, stack: s });
  }
  return list.length === 0 ? null : list[rand.nextInt(list.length)]!;
}

// ------------------------------------------------------------------ combat

export interface ProtectionSource {
  bypassInvul?: boolean;
  fire?: boolean;
  fall?: boolean;
  explosion?: boolean;
  projectile?: boolean;
}

/** ProtectionEnchantment.getDamageProtection */
export function protectionOf(name: string, lvl: number, src: ProtectionSource): number {
  if (src.bypassInvul) return 0;
  switch (name) {
    case 'protection': return lvl;
    case 'fire_protection': return src.fire ? lvl * 2 : 0;
    case 'feather_falling': return src.fall ? lvl * 3 : 0;
    case 'blast_protection': return src.explosion ? lvl * 2 : 0;
    case 'projectile_protection': return src.projectile ? lvl * 2 : 0;
    default: return 0;
  }
}

/** EnchantmentHelper.getDamageProtection over the armour slots: the EPF. */
export function damageProtection(armor: (ItemStack | null)[], src: ProtectionSource): number {
  let n = 0;
  for (const s of armor) for (const e of s?.tag?.Enchantments ?? []) n += protectionOf(e.id.replace(/^minecraft:/, ''), e.lvl, src);
  return n;
}

/** CombatRules.getDamageAfterMagicAbsorb: EPF capped at 20 (80%). */
export function magicAbsorb(damage: number, epf: number): number {
  const f = Math.max(0, Math.min(20, epf));
  return damage * (1 - f / 25);
}

/** CombatRules.getDamageAfterAbsorb (armour points and toughness). */
export function armorAbsorb(damage: number, armor: number, toughness: number): number {
  const f = 2 + toughness / 4;
  const f1 = Math.max(armor - damage / f, armor * 0.2);
  const f1c = Math.max(0, Math.min(20, f1));
  return damage * (1 - f1c / 25);
}

export type MobType = 'undefined' | 'undead' | 'arthropod' | 'illager' | 'water';

/** DamageEnchantment / ImpalerEnchantment getDamageBonus, summed over the stack (EnchantmentHelper.getDamageBonus). */
export function damageBonus(s: ItemStack | null | undefined, mobType: MobType = 'undefined'): number {
  let f = 0;
  for (const e of s?.tag?.Enchantments ?? []) {
    const n = e.id.replace(/^minecraft:/, ''), l = e.lvl;
    if (n === 'sharpness') f += 1 + Math.max(0, l - 1) * 0.5;
    else if (n === 'smite' && mobType === 'undead') f += l * 2.5;
    else if (n === 'bane_of_arthropods' && mobType === 'arthropod') f += l * 2.5;
    else if (n === 'impaling' && mobType === 'water') f += l * 2.5;
  }
  return f;
}

/** SweepingEdgeEnchantment.getSweepingDamageRatio */
export function sweepingRatio(level: number): number {
  return level > 0 ? 1 - 1 / (level + 1) : 0;
}

/** ThornsEnchantment.shouldHit / getDamage */
export function thornsShouldHit(level: number, r: JavaRandom | { nextFloat(): number }): boolean {
  return level > 0 && r.nextFloat() < 0.15 * level;
}
export function thornsDamage(level: number, r: { nextInt(n: number): number }): number {
  return level > 10 ? level - 10 : 1 + r.nextInt(4);
}

/** ProtectionEnchantment.getFireAfterDampener: Fire Protection shortens burning. */
export function fireAfterDampener(ticks: number, fireProtLevel: number): number {
  if (fireProtLevel > 0) ticks -= Math.floor(ticks * (fireProtLevel * 0.15));
  return ticks;
}

/** ProtectionEnchantment.getExplosionKnockbackAfterDampener */
export function explosionKnockbackAfterDampener(kb: number, blastLevel: number): number {
  if (blastLevel > 0) kb -= Math.floor(kb * (blastLevel * 0.15));
  return kb;
}

/** Arrow damage bonus from Power (AbstractArrow.setBaseDamage + level·0.5 + 0.5). */
export function powerBonus(level: number): number {
  return level > 0 ? level * 0.5 + 0.5 : 0;
}

// ------------------------------------------------------------------ durability

/** DigDurabilityEnchantment.shouldIgnoreDurabilityDrop */
export function ignoresDurabilityDrop(s: ItemStack, level: number, r: { nextFloat(): number; nextInt(n: number): number }): boolean {
  const n = ITEMS_BY_ID[s.id]?.name ?? '';
  const armor = /_(helmet|chestplate|leggings|boots)$/.test(n);
  if (armor && r.nextFloat() < 0.6) return false;
  return r.nextInt(level + 1) > 0;
}

/**
 * ItemStack.hurt: apply `amount` durability damage with Unbreaking. Returns true when the item
 * broke (the caller removes it and plays the break sound).
 */
export function hurtItem(s: ItemStack, amount: number, r: { nextFloat(): number; nextInt(n: number): number }): boolean {
  const max = ITEMS_BY_ID[s.id]?.maxDurability ?? 0;
  if (!(max > 0) || s.tag?.Unbreakable) return false;
  if (amount > 0) {
    const lvl = enchLevel('unbreaking', s);
    let skip = 0;
    for (let k = 0; lvl > 0 && k < amount; k++) if (ignoresDurabilityDrop(s, lvl, r)) skip++;
    amount -= skip;
    if (amount <= 0) return false;
  }
  s.damage += amount;
  return s.damage >= max;
}

/** ExperienceOrb.repairPlayerItems: Mending repairs 2 durability per XP point; returns the XP left. */
export function mendingRepair(inv: Inventory, xp: number, r: { nextInt(n: number): number }, onRepaired?: (slot: number) => void): number {
  while (xp > 0) {
    const hit = randomItemWith('mending', inv, r, (s) => s.damage > 0);
    if (!hit) break;
    const i = Math.min(xp * 2, hit.stack.damage);
    hit.stack.damage -= i;
    onRepaired?.(hit.slot);
    xp -= Math.floor(i / 2);
    if (i === 0) break;
  }
  return xp;
}

// ------------------------------------------------------------------ loot (Fortune)

/** ApplyBonusCount.OreDrops */
export function oreDropsBonus(count: number, fortune: number, r: () => number): number {
  if (fortune > 0) {
    let i = Math.floor(r() * (fortune + 2)) - 1;
    if (i < 0) i = 0;
    return count * (i + 1);
  }
  return count;
}

/** ApplyBonusCount.UniformBonusCount */
export function uniformBonus(count: number, multiplier: number, fortune: number, r: () => number): number {
  return count + Math.floor(r() * (multiplier * fortune + 1));
}

/** BonusLevelTableCondition: chance indexed by enchantment level (capped at the table end). */
export function tableBonus(chances: number[], fortune: number): number {
  return chances[Math.min(fortune, chances.length - 1)]!;
}

/** EnchantmentHelper.getRespiration > 0 and the random roll: true when this tick's air is kept. */
export function respirationKeepsAir(inv: Inventory, r: { nextInt(n: number): number }): boolean {
  const i = entityEnchLevel('respiration', inv);
  return i > 0 && r.nextInt(i + 1) > 0;
}

// ------------------------------------------------------------------ the enchanting table

export interface EnchantmentInstance {
  ench: Ench;
  level: number;
}

/** Java Math.round(float) */
function roundF(x: number): number {
  return Math.floor(Math.fround(x + 0.5));
}

/** EnchantmentHelper.getEnchantmentCost */
export function getEnchantmentCost(r: JavaRandom, slot: number, bookshelves: number, itemId: number): number {
  const i = enchantability(itemId);
  if (i <= 0) return 0;
  if (bookshelves > 15) bookshelves = 15;
  const j = r.nextInt(8) + 1 + (bookshelves >> 1) + r.nextInt(bookshelves + 1);
  if (slot === 0) return Math.max(Math.trunc(j / 3), 1);
  return slot === 1 ? Math.trunc((j * 2) / 3) + 1 : Math.max(j, bookshelves * 2);
}

/** EnchantmentHelper.getAvailableEnchantmentResults */
export function availableEnchantments(level: number, itemId: number, treasure: boolean): EnchantmentInstance[] {
  const out: EnchantmentInstance[] = [];
  const book = itemId === BOOK;
  for (const e of ENCHANTMENTS) {
    if ((e.treasureOnly && !treasure) || !e.discoverable || !(book || canEnchantItem(e, itemId))) continue;
    for (let i = e.maxLevel; i > 0; i--) {
      if (level >= minCost(e, i) && level <= maxCost(e, i)) {
        out.push({ ench: e, level: i });
        break;
      }
    }
  }
  return out;
}

/** WeightedRandom.getRandomItem */
function weightedPick(r: JavaRandom, list: EnchantmentInstance[]): EnchantmentInstance | null {
  let total = 0;
  for (const x of list) total += x.ench.weight;
  if (total <= 0) return null;
  let i = r.nextInt(total);
  for (const x of list) {
    i -= x.ench.weight;
    if (i < 0) return x;
  }
  return null;
}

/** EnchantmentHelper.selectEnchantment */
export function selectEnchantment(r: JavaRandom, itemId: number, level: number, treasure: boolean): EnchantmentInstance[] {
  const list: EnchantmentInstance[] = [];
  const i = enchantability(itemId);
  if (i <= 0) return list;
  level += 1 + r.nextInt(Math.trunc(i / 4) + 1) + r.nextInt(Math.trunc(i / 4) + 1);
  const f = Math.fround((Math.fround(r.nextFloat() + r.nextFloat()) - 1) * 0.15);
  level = Math.max(1, roundF(Math.fround(level + Math.fround(level * f))));
  let avail = availableEnchantments(level, itemId, treasure);
  if (avail.length > 0) {
    const first = weightedPick(r, avail);
    if (first) list.push(first);
    while (r.nextInt(50) <= level) {
      if (list.length > 0) {
        const last = list[list.length - 1]!.ench;
        avail = avail.filter((x) => isCompatible(last, x.ench));
      }
      if (avail.length === 0) break;
      const next = weightedPick(r, avail);
      if (next) list.push(next);
      level = Math.trunc(level / 2);
    }
  }
  return list;
}

/** EnchantmentMenu.getEnchantmentList */
export function enchantmentList(seed: number, itemId: number, slot: number, cost: number): EnchantmentInstance[] {
  const r = new JavaRandom(BigInt((seed + slot) | 0));
  const list = selectEnchantment(r, itemId, cost, false);
  if (itemId === BOOK && list.length > 1) list.splice(r.nextInt(list.length), 1);
  return list;
}

export interface EnchantOffers {
  costs: [number, number, number];
  /** enchantment registry id shown as the hint, −1 none */
  clues: [number, number, number];
  levels: [number, number, number];
}

/** EnchantmentMenu.slotsChanged: the three offers for an item, bookshelf count and enchantment seed. */
export function enchantOffers(stack: ItemStack | null, bookshelves: number, seed: number): EnchantOffers {
  const o: EnchantOffers = { costs: [0, 0, 0], clues: [-1, -1, -1], levels: [-1, -1, -1] };
  if (!stack || stack.count <= 0 || !isEnchantable(stack)) return o;
  const r = new JavaRandom(BigInt(seed));
  for (let k = 0; k < 3; k++) {
    o.costs[k] = getEnchantmentCost(r, k, bookshelves, stack.id);
    if (o.costs[k]! < k + 1) o.costs[k] = 0;
  }
  for (let l = 0; l < 3; l++) {
    if (o.costs[l]! > 0) {
      const list = enchantmentList(seed, stack.id, l, o.costs[l]!);
      if (list.length > 0) {
        const inst = list[r.nextInt(list.length)]!;
        o.clues[l] = inst.ench.id;
        o.levels[l] = inst.level;
      }
    }
  }
  return o;
}

/** EnchantmentMenu bookshelf count (1.17.1 loop): air between the table and the shelf is required. */
export function countBookshelves(isAir: (dx: number, dy: number, dz: number) => boolean, isShelf: (dx: number, dy: number, dz: number) => boolean): number {
  let j = 0;
  for (let k = -1; k <= 1; k++) {
    for (let l = -1; l <= 1; l++) {
      if ((k !== 0 || l !== 0) && isAir(l, 0, k) && isAir(l, 1, k)) {
        if (isShelf(l * 2, 0, k * 2)) j++;
        if (isShelf(l * 2, 1, k * 2)) j++;
        if (l !== 0 && k !== 0) {
          if (isShelf(l * 2, 0, k)) j++;
          if (isShelf(l * 2, 1, k)) j++;
          if (isShelf(l, 0, k * 2)) j++;
          if (isShelf(l, 1, k * 2)) j++;
        }
      }
    }
  }
  return j;
}

export interface EnchantClickResult {
  ok: boolean;
  /** the enchanted item (an enchanted book for books) */
  result?: ItemStack;
  levelsSpent?: number;
  lapisSpent?: number;
}

/**
 * EnchantmentMenu.clickMenuButton: validate and perform the enchant for offer `id`. The caller
 * applies Player.onEnchantmentPerformed (levels, new seed) and the lapis/sound side effects.
 */
export function clickEnchant(stack: ItemStack | null, lapisCount: number, playerLevel: number, creative: boolean, offers: EnchantOffers, seed: number, id: number): EnchantClickResult {
  const i = id + 1;
  if (lapisCount < i && !creative) return { ok: false };
  const cost = offers.costs[id] ?? 0;
  if (cost <= 0 || !stack || stack.count <= 0 || ((playerLevel < i || playerLevel < cost) && !creative)) return { ok: false };
  const list = enchantmentList(seed, stack.id, id, cost);
  if (list.length === 0) return { ok: true };
  const book = stack.id === BOOK;
  const result: ItemStack = book ? { id: ENCHANTED_BOOK, count: 1, damage: 0 } : { ...stack };
  if (stack.tag) result.tag = JSON.parse(JSON.stringify(stack.tag)) as ItemStack['tag'];
  for (const inst of list) {
    if (book) addStoredEnchantment(result, inst.ench.name, inst.level);
    else enchantStack(result, inst.ench.name, inst.level);
  }
  return { ok: true, result, levelsSpent: i, lapisSpent: creative ? 0 : i };
}

// ------------------------------------------------------------------ grindstone

/** AnvilMenu.calculateIncreasedRepairCost */
export function increasedRepairCost(cost: number): number {
  return cost * 2 + 1;
}

const isCurse = (id: string) => ENCH_BY_NAME.get(id.replace(/^minecraft:/, ''))?.curse === true;

/** GrindstoneMenu.removeNonCurses: strip every non-curse enchantment, reset the repair cost. */
export function removeNonCurses(s: ItemStack, damage: number, count: number): ItemStack {
  const out: ItemStack = { id: s.id, count, damage };
  const tag = s.tag ? (JSON.parse(JSON.stringify(s.tag)) as NonNullable<ItemStack['tag']>) : undefined;
  if (tag) {
    if (tag.Enchantments) tag.Enchantments = tag.Enchantments.filter((e) => isCurse(e.id));
    if (tag.StoredEnchantments) tag.StoredEnchantments = tag.StoredEnchantments.filter((e) => isCurse(e.id));
    if (tag.Enchantments?.length === 0) delete tag.Enchantments;
    if (tag.StoredEnchantments?.length === 0) delete tag.StoredEnchantments;
    delete tag.RepairCost;
    out.tag = tag;
  }
  // an enchanted book left with nothing becomes a plain book
  if (s.id === ENCHANTED_BOOK && !(out.tag?.StoredEnchantments?.length)) {
    out.id = BOOK;
    if (out.tag) delete out.tag.StoredEnchantments;
  }
  let cost = 0;
  const n = (out.tag?.Enchantments?.length ?? 0) + (out.tag?.StoredEnchantments?.length ?? 0);
  for (let i = 0; i < n; i++) cost = increasedRepairCost(cost);
  if (cost > 0) out.tag!.RepairCost = cost;
  if (out.tag && Object.keys(out.tag).length === 0) delete out.tag;
  return out;
}

/** GrindstoneMenu.createResult (1.17.1). */
export function grindstoneOutput(a: ItemStack | null, b: ItemStack | null): ItemStack | null {
  const ea = !!a && a.count > 0, eb = !!b && b.count > 0;
  if (!ea && !eb) return null;
  // a lone unenchanted item has nothing to grind off; stacks never go in
  const plain = (s: ItemStack | null, e: boolean) => e && s!.id !== ENCHANTED_BOOK && !isEnchanted(s!);
  if ((ea && a!.count > 1) || (eb && b!.count > 1) || (!(ea && eb) && (plain(a, ea) || plain(b, eb)))) return null;
  if (ea && eb) {
    if (a!.id !== b!.id) return null;
    const max = ITEMS_BY_ID[a!.id]?.maxDurability ?? 0;
    // mergeEnchants: curses of the second item are added to the first
    const merged: ItemStack = { id: a!.id, count: a!.count, damage: a!.damage };
    if (a!.tag) merged.tag = JSON.parse(JSON.stringify(a!.tag)) as ItemStack['tag'];
    for (const e of enchantmentsOf(b)) if (isCurse(e.id) && !enchantmentsOf(merged).some((x) => x.id === e.id)) enchantStack(merged, e.id, e.lvl);
    if (max > 0) {
      const k = max - a!.damage, l = max - b!.damage;
      const damage = Math.max(max - (k + l + Math.floor((max * 5) / 100)), 0);
      return removeNonCurses(merged, damage, 1);
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) return null;
    return removeNonCurses(merged, 0, 2);
  }
  const s = ea ? a! : b!;
  return removeNonCurses(s, s.damage, s.count);
}

/** GrindstoneMenu.getExperienceAmount: half to all of the inputs' non-curse enchantment min costs. */
export function grindstoneExperience(a: ItemStack | null, b: ItemStack | null, r: { nextInt(n: number): number }): number {
  let l = 0;
  for (const s of [a, b]) {
    for (const e of enchantmentsOf(s)) {
      const en = ENCH_BY_NAME.get(e.id.replace(/^minecraft:/, ''));
      if (en && !en.curse) l += minCost(en, e.lvl);
    }
  }
  if (l <= 0) return 0;
  const i = Math.ceil(l / 2);
  return i + r.nextInt(i);
}
