/**
 * Status effect reference data (vanilla MobEffects, 1.17.1): ids, display names, categories,
 * colours and attribute modifiers, plus the potion swirl colour mix and duration formatting.
 * The effect state machine itself lives in ./effects.ts (EffectMap).
 */

export type EffectCategory = 'beneficial' | 'harmful' | 'neutral';

export interface AttributeMod {
  attribute: 'movement_speed' | 'attack_speed' | 'attack_damage' | 'max_health' | 'luck';
  /** amount per level (multiplied by amplifier + 1) */
  amount: number;
  op: 'addition' | 'multiply_total';
}

export interface MobEffect {
  id: number;
  /** registry path, e.g. "night_vision" */
  name: string;
  displayName: string;
  category: EffectCategory;
  color: number;
  instantenous: boolean;
  mods: AttributeMod[];
}

const E = (id: number, name: string, displayName: string, category: EffectCategory, color: number, mods: AttributeMod[] = [], instantenous = false): MobEffect =>
  ({ id, name, displayName, category, color, instantenous, mods });

/** MobEffects (1.17.1), in registry order. */
export const MOB_EFFECTS: MobEffect[] = [
  E(1, 'speed', 'Speed', 'beneficial', 8171462, [{ attribute: 'movement_speed', amount: 0.2, op: 'multiply_total' }]),
  E(2, 'slowness', 'Slowness', 'harmful', 5926017, [{ attribute: 'movement_speed', amount: -0.15, op: 'multiply_total' }]),
  E(3, 'haste', 'Haste', 'beneficial', 14270531, [{ attribute: 'attack_speed', amount: 0.1, op: 'multiply_total' }]),
  E(4, 'mining_fatigue', 'Mining Fatigue', 'harmful', 4866583, [{ attribute: 'attack_speed', amount: -0.1, op: 'multiply_total' }]),
  // AttackDamageMobEffect: the modifier value is multiplier × (amplifier + 1) (3 / −4)
  E(5, 'strength', 'Strength', 'beneficial', 9643043, [{ attribute: 'attack_damage', amount: 3, op: 'addition' }]),
  E(6, 'instant_health', 'Instant Health', 'beneficial', 16262179, [], true),
  E(7, 'instant_damage', 'Instant Damage', 'harmful', 4393481, [], true),
  E(8, 'jump_boost', 'Jump Boost', 'beneficial', 2293580),
  E(9, 'nausea', 'Nausea', 'harmful', 5578058),
  E(10, 'regeneration', 'Regeneration', 'beneficial', 13458603),
  E(11, 'resistance', 'Resistance', 'beneficial', 10044730),
  E(12, 'fire_resistance', 'Fire Resistance', 'beneficial', 14981690),
  E(13, 'water_breathing', 'Water Breathing', 'beneficial', 3035801),
  E(14, 'invisibility', 'Invisibility', 'beneficial', 8356754),
  E(15, 'blindness', 'Blindness', 'harmful', 2039587),
  E(16, 'night_vision', 'Night Vision', 'beneficial', 2039713),
  E(17, 'hunger', 'Hunger', 'harmful', 5797459),
  E(18, 'weakness', 'Weakness', 'harmful', 4738376, [{ attribute: 'attack_damage', amount: -4, op: 'addition' }]),
  E(19, 'poison', 'Poison', 'harmful', 5149489),
  E(20, 'wither', 'Wither', 'harmful', 3484199),
  E(21, 'health_boost', 'Health Boost', 'beneficial', 16284963, [{ attribute: 'max_health', amount: 4, op: 'addition' }]),
  E(22, 'absorption', 'Absorption', 'beneficial', 2445989),
  E(23, 'saturation', 'Saturation', 'beneficial', 16262179, [], true),
  E(24, 'glowing', 'Glowing', 'neutral', 9740385),
  E(25, 'levitation', 'Levitation', 'harmful', 13565951),
  E(26, 'luck', 'Luck', 'beneficial', 3381504, [{ attribute: 'luck', amount: 1, op: 'addition' }]),
  E(27, 'unluck', 'Bad Luck', 'harmful', 12624973, [{ attribute: 'luck', amount: -1, op: 'addition' }]),
  E(28, 'slow_falling', 'Slow Falling', 'beneficial', 16773073),
  E(29, 'conduit_power', 'Conduit Power', 'beneficial', 1950417),
  E(30, 'dolphins_grace', 'Dolphin\'s Grace', 'beneficial', 8954814),
  E(31, 'bad_omen', 'Bad Omen', 'neutral', 745784),
  E(32, 'hero_of_the_village', 'Hero of the Village', 'beneficial', 4521796),
];

export const EFFECT_BY_NAME = new Map(MOB_EFFECTS.map((e) => [e.name, e]));
export const EFFECT_BY_ID: (MobEffect | undefined)[] = [];
for (const e of MOB_EFFECTS) EFFECT_BY_ID[e.id] = e;

export function effectByName(name: string): MobEffect {
  const e = EFFECT_BY_NAME.get(name.replace(/^minecraft:/, ''));
  if (!e) throw new Error(`unknown effect ${name}`);
  return e;
}

/** MobEffect.getAttributeModifierValue (AttackDamageMobEffect uses the same product). */
export function modifierValue(mod: AttributeMod, amplifier: number): number {
  return mod.amount * (amplifier + 1);
}

/** MobEffectUtil.formatDuration: "m:ss", or "**:**" for effects lasting ≥ 32767 ticks (no-duration potions). */
export function formatDuration(inst: { duration: number }, durationFactor = 1): string {
  if (inst.duration >= 32767) return '**:**';
  const total = Math.floor(inst.duration * durationFactor / 20);
  const m = Math.floor(total / 60), s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Roman numerals used by effect/enchantment names ("enchantment.level.N"). */
export function romanLevel(n: number): string {
  const R = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  return R[n] ?? String(n);
}

/** PotionUtils.getColor(Collection<MobEffectInstance>): only visible effects count, weighted by level. */
export function effectsColor(effects: Iterable<{ effect: MobEffect; amplifier: number; visible: boolean }>, emptyColor = 3694022): number {
  let r = 0, g = 0, b = 0, j = 0, any = false;
  for (const e of effects) {
    any = true;
    if (!e.visible) continue;
    const c = e.effect.color, k = e.amplifier + 1;
    r += (k * ((c >> 16) & 255)) / 255;
    g += (k * ((c >> 8) & 255)) / 255;
    b += (k * (c & 255)) / 255;
    j += k;
  }
  if (!any) return emptyColor;
  if (j === 0) return 0;
  r = (r / j) * 255;
  g = (g / j) * 255;
  b = (b / j) * 255;
  return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
}

