/**
 * Server hooks for enchantment and effect gameplay (Phase 7): mining speed (Efficiency, Aqua
 * Affinity, Haste, Conduit Power, Mining Fatigue), Silk Touch / Fortune loot, durability with
 * Unbreaking, melee bonuses (Sharpness family, Knockback, Fire Aspect, Sweeping Edge,
 * Strength/Weakness), Thorns, Mending, Curse of Vanishing and /enchant.
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { commandHooks } from './commands/hooks';
import { isPlayer } from './commands/source';
import { enchLevel, entityEnchLevel, hurtItem, mendingRepair, randomItemWith, thornsShouldHit, thornsDamage, compatibleWithAll, enchByName, enchantStack, canEnchantItem } from '@shared/game/enchantments';
import { ITEMS_BY_ID } from '@shared/data';
import { FLUID } from '@shared/world/blockinfo';
import { hardness } from '@shared/game/mining';
import { blockNameOf } from '@shared/world/blockstate';
import type { MinerState } from '@shared/game/mining';

/** Player.getDestroySpeed inputs for the held item and active effects. */
export function minerStateOf(p: ServerPlayer, eyeState: number): MinerState {
  const held = p.inventory.selectedStack;
  const fx = p.living.effects;
  const dig = Math.max(fx.amplifier('haste'), fx.amplifier('conduit_power'));
  return {
    item: held?.id ?? 0,
    efficiency: enchLevel('efficiency', held),
    haste: dig + 1,
    miningFatigue: fx.amplifier('mining_fatigue') + 1,
    underwater: FLUID[eyeState] === 1,
    aquaAffinity: entityEnchLevel('aqua_affinity', p.inventory) > 0,
    onGround: p.onGround || p.flying,
  };
}

/** Loot context additions from the breaking tool. */
export function toolLoot(p: ServerPlayer): { silkTouch: boolean; fortune: number } {
  const held = p.inventory.selectedStack;
  return { silkTouch: enchLevel('silk_touch', held) > 0, fortune: enchLevel('fortune', held) };
}

const EQUIP_BREAK_EVENT: Record<number, number> = { 40: 48, 36: 52, 37: 51, 38: 50, 39: 49 };

/** ItemStack.hurtAndBreak for a player's slot (survival/adventure only). */
export function hurtAndBreak(s: GameServer, p: ServerPlayer, slot: number, amount: number): void {
  if (p.gameMode === 1 || p.gameMode === 3) return;
  const st = p.inventory.get(slot);
  if (!st || !(ITEMS_BY_ID[st.id]?.maxDurability ?? 0)) return;
  const broke = hurtItem(st, amount, s.rand);
  if (broke) {
    p.inventory.set(slot, null);
    // LivingEntity.broadcastBreakEvent: 47 main hand, 48 off hand, 49–52 armour
    s.broadcastToTrackers(p, { t: 'entityEvent', id: p.id, event: slot === p.inventory.selected ? 47 : EQUIP_BREAK_EVENT[slot] ?? 47 }, true);
    s.playSound(null, 'entity.item.break', 'player', p.x, p.y, p.z, 0.8, 0.8 + s.rand.nextFloat() * 0.4);
  }
  s.syncSlot(p, slot);
}

/** Item.mineBlock durability: tools 1, swords/tridents 2, only for blocks that aren't instant. */
export function afterMine(s: GameServer, p: ServerPlayer, state: number): void {
  const held = p.inventory.selectedStack;
  if (!held) return;
  const n = ITEMS_BY_ID[held.id]?.name ?? '';
  if (n === 'shears') {
    if (!blockNameOf(state).endsWith('fire')) hurtAndBreak(s, p, p.inventory.selected, 1);
    return;
  }
  if (hardness(state) === 0) return;
  if (/_sword$/.test(n) || n === 'trident') hurtAndBreak(s, p, p.inventory.selected, 2);
  else if (/_(pickaxe|axe|shovel|hoe)$/.test(n)) hurtAndBreak(s, p, p.inventory.selected, 1);
}

/** Melee extras for Player.attack: enchantment damage bonus, knockback levels, fire aspect, sweep ratio, attribute bonus. */
export function attackExtras(p: ServerPlayer): { attackBonus: number; knockback: number; fireAspect: number; sweeping: number; blind: boolean } {
  const fx = p.living.effects;
  return {
    attackBonus: fx.attributeValue('attack_damage', 0),
    knockback: entityEnchLevel('knockback', p.inventory),
    fireAspect: entityEnchLevel('fire_aspect', p.inventory),
    sweeping: entityEnchLevel('sweeping', p.inventory),
    blind: fx.has('blindness'),
  };
}

/** Weapon wear after a hit (SwordItem/DiggerItem.hurtEnemy: swords 1, tools 2). */
export function afterHit(s: GameServer, p: ServerPlayer): void {
  const held = p.inventory.selectedStack;
  if (!held) return;
  const n = ITEMS_BY_ID[held.id]?.name ?? '';
  if (/_sword$/.test(n) || n === 'trident') hurtAndBreak(s, p, p.inventory.selected, 1);
  else if (/_(pickaxe|axe|shovel|hoe)$/.test(n)) hurtAndBreak(s, p, p.inventory.selected, 2);
}

/** ThornsEnchantment.doPostHurt (victim's armour hurts the attacker; the armour wears by 2). */
export function thorns(s: GameServer, victim: ServerPlayer, attacker: ServerPlayer): void {
  const level = entityEnchLevel('thorns', victim.inventory);
  const r = s.rand;
  const item = randomItemWith('thorns', victim.inventory, r);
  if (thornsShouldHit(level, r)) {
    s.survival.hurt(attacker, { id: 'thorns', magic: true, entity: { name: victim.name, player: true } } as never, thornsDamage(level, r));
    if (item) hurtAndBreak(s, victim, item.slot, 2);
  }
}

/** ExperienceOrb.repairPlayerItems before the XP is added; returns the XP left. */
export function mending(s: GameServer, p: ServerPlayer, xp: number): number {
  return mendingRepair(p.inventory, xp, s.rand, (slot) => s.syncSlot(p, slot));
}

/** Player.destroyVanishingCursedItems before the inventory drops on death. */
export function destroyVanishing(s: GameServer, p: ServerPlayer): void {
  for (let i = 0; i < 41; i++) {
    const st = p.inventory.get(i);
    if (st && enchLevel('vanishing_curse', st) > 0) {
      p.inventory.set(i, null);
      s.syncSlot(p, i);
    }
  }
}

/** /enchant: add to the main-hand item when compatible with what is already there. */
export function installEnchantCommand(): void {
  commandHooks.enchant = (t, name, level) => {
    if (!isPlayer(t)) return 'entity';
    const held = t.inventory.selectedStack;
    if (!held) return 'itemless';
    const e = enchByName(name);
    if (!canEnchantItem(e, held.id) || !compatibleWithAll(held.tag?.Enchantments ?? [], e)) return 'incompatible';
    enchantStack(held, e.name, level);
    resync?.(t, t.inventory.selected);
    return 'ok';
  };
}

let resync: ((p: ServerPlayer, slot: number) => void) | null = null;
export function setEnchantResync(f: (p: ServerPlayer, slot: number) => void): void {
  resync = f;
}
