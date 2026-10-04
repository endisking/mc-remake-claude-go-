/** Melee combat values (vanilla item attribute modifiers, Player.attack). */
import { ITEMS_BY_ID } from '../data';

const TIERS = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'] as const;
/** Attack damage of a held item including the player's base 1 (what the tooltip shows). */
const DAMAGE: Record<string, number[]> = {
  sword: [4, 5, 6, 4, 7, 8],
  axe: [7, 9, 9, 7, 9, 10],
  pickaxe: [2, 3, 4, 2, 5, 6],
  shovel: [2.5, 3.5, 4.5, 2.5, 5.5, 6.5],
  hoe: [1, 1, 1, 1, 1, 1],
};
const SPEED: Record<string, number[]> = {
  sword: [1.6, 1.6, 1.6, 1.6, 1.6, 1.6],
  axe: [0.8, 0.8, 0.9, 1, 1, 1],
  pickaxe: [1.2, 1.2, 1.2, 1.2, 1.2, 1.2],
  shovel: [1, 1, 1, 1, 1, 1],
  hoe: [1, 2, 3, 1, 4, 4],
};

function tool(id: number): { kind: string; tier: number } | null {
  const n = ITEMS_BY_ID[id]?.name ?? '';
  const m = n.match(/^(wooden|stone|iron|golden|diamond|netherite)_(sword|axe|pickaxe|shovel|hoe)$/);
  if (!m) return null;
  return { kind: m[2]!, tier: TIERS.indexOf(m[1] as (typeof TIERS)[number]) };
}

/** ATTACK_DAMAGE attribute value with this item in the main hand (fist = 1). */
export function attackDamageOf(id: number): number {
  if ((ITEMS_BY_ID[id]?.name ?? '') === 'trident') return 9;
  const t = tool(id);
  return t ? DAMAGE[t.kind]![t.tier]! : 1;
}

/** ATTACK_SPEED attribute value with this item in the main hand (empty hand / other items = 4). */
export function attackSpeedOf(id: number): number {
  if ((ITEMS_BY_ID[id]?.name ?? '') === 'trident') return 1.1;
  const t = tool(id);
  return t ? SPEED[t.kind]![t.tier]! : 4;
}

/** Player.getCurrentItemAttackStrengthDelay: ticks to recharge. */
export function attackStrengthDelay(id: number, speedMul = 1): number {
  return (1 / (attackSpeedOf(id) * speedMul)) * 20;
}

/** Player.getAttackStrengthScale. */
export function attackStrengthScale(ticker: number, id: number, partial: number, speedMul = 1): number {
  return Math.max(0, Math.min(1, (ticker + partial) / attackStrengthDelay(id, speedMul)));
}

export interface AttackContext {
  item: number;
  attackStrengthTicker: number;
  sprinting: boolean;
  fallDistance: number;
  onGround: boolean;
  onClimbable: boolean;
  inWater: boolean;
  /** walkDist − walkDistO and LivingEntity.getSpeed, for the sword sweep check */
  walked: number;
  speed: number;
  /** ATTACK_DAMAGE modifiers from effects: Strength +3 per level, Weakness −4 per level */
  damageBonus?: number;
  /** ATTACK_SPEED multiplier from effects: Haste +10% per level, Mining Fatigue −10% per level */
  speedMul?: number;
  /** EnchantmentHelper.getDamageBonus for the target (Sharpness/Smite/Bane/Impaling) */
  enchantBonus?: number;
  /** Knockback enchantment level */
  knockbackBonus?: number;
  /** Blindness prevents critical hits */
  blind?: boolean;
  /** Sweeping Edge level */
  sweeping?: number;
}

export interface AttackResult {
  damage: number;
  /** strong enough (> 0.9 charged) for crits/knockback/sweep */
  charged: boolean;
  critical: boolean;
  /** extra knockback levels (sprint + Knockback enchantment) */
  knockback: number;
  sweep: boolean;
  /** damage dealt to entities caught by the sweep (1 + ratio × damage) */
  sweepDamage: number;
}

/** Player.attack damage/flags (enchantments arrive in Phase 7). */
export function computeAttack(c: AttackContext): AttackResult {
  let f = Math.max(0, attackDamageOf(c.item) + (c.damageBonus ?? 0));
  let f1 = c.enchantBonus ?? 0;
  const f2 = attackStrengthScale(c.attackStrengthTicker, c.item, 0.5, c.speedMul ?? 1);
  f *= 0.2 + f2 * f2 * 0.8;
  f1 *= f2;
  const charged = f2 > 0.9;
  let knockback = c.knockbackBonus ?? 0;
  const sprintHit = c.sprinting && charged;
  if (sprintHit) knockback++;
  const critical = charged && c.fallDistance > 0 && !c.onGround && !c.onClimbable && !c.inWater && !c.blind && !c.sprinting;
  if (critical) f *= 1.5;
  f += f1;
  const isSword = /_sword$/.test(ITEMS_BY_ID[c.item]?.name ?? '');
  const sweep = charged && !critical && !sprintHit && c.onGround && c.walked < c.speed && isSword;
  const lvl = c.sweeping ?? 0;
  const ratio = lvl > 0 ? 1 - 1 / (lvl + 1) : 0;
  return { damage: f, charged, critical, knockback, sweep, sweepDamage: 1 + ratio * f };
}
