/**
 * Status effects (vanilla MobEffect / MobEffects / MobEffectInstance / LivingEntity effect
 * handling), Java Edition 1.17.1. Pure logic shared by the server (authoritative ticking) and
 * the client (HUD, particles, screen effects).
 *
 * The effect table (ids, colours, categories, attribute modifiers) follows MobEffects.java;
 * ids match minecraft-data 1.17.1 effects.json.
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

/** MobEffect.isDurationEffectTick. */
export function isDurationEffectTick(effect: MobEffect, duration: number, amplifier: number): boolean {
  switch (effect.name) {
    case 'regeneration': { const k = 50 >> amplifier; return k > 0 ? duration % k === 0 : true; }
    case 'poison': { const k = 25 >> amplifier; return k > 0 ? duration % k === 0 : true; }
    case 'wither': { const k = 40 >> amplifier; return k > 0 ? duration % k === 0 : true; }
    case 'hunger': return true;
    case 'bad_omen': return true;
    default: return effect.instantenous ? duration >= 1 : false;
  }
}

/** MobEffect.getAttributeModifierValue (AttackDamageMobEffect uses the same product). */
export function modifierValue(mod: AttributeMod, amplifier: number): number {
  return mod.amount * (amplifier + 1);
}

export interface EffectOptions {
  ambient?: boolean;
  visible?: boolean;
  showIcon?: boolean;
}

/** MobEffectInstance. */
export class EffectInstance {
  ambient: boolean;
  visible: boolean;
  showIcon: boolean;
  /** a weaker, longer effect hidden behind a stronger, shorter one */
  hiddenEffect: EffectInstance | null = null;

  constructor(
    readonly effect: MobEffect,
    public duration: number,
    public amplifier = 0,
    opts: EffectOptions = {},
  ) {
    this.ambient = opts.ambient ?? false;
    this.visible = opts.visible ?? true;
    this.showIcon = opts.showIcon ?? this.visible;
  }

  copy(): EffectInstance {
    const c = new EffectInstance(this.effect, this.duration, this.amplifier, { ambient: this.ambient, visible: this.visible, showIcon: this.showIcon });
    c.hiddenEffect = this.hiddenEffect ? this.hiddenEffect.copy() : null;
    return c;
  }

  private setDetailsFrom(o: EffectInstance): void {
    this.duration = o.duration;
    this.amplifier = o.amplifier;
    this.ambient = o.ambient;
    this.visible = o.visible;
    this.showIcon = o.showIcon;
  }

  /** MobEffectInstance.update: merge a newly applied instance; true when something changed. */
  update(o: EffectInstance): boolean {
    let changed = false;
    if (o.amplifier > this.amplifier) {
      if (o.duration < this.duration) {
        const old = this.hiddenEffect;
        this.hiddenEffect = new EffectInstance(this.effect, this.duration, this.amplifier, this);
        this.hiddenEffect.hiddenEffect = old;
      }
      this.amplifier = o.amplifier;
      this.duration = o.duration;
      changed = true;
    } else if (o.duration > this.duration) {
      if (o.amplifier === this.amplifier) {
        this.duration = o.duration;
        changed = true;
      } else if (this.hiddenEffect === null) {
        this.hiddenEffect = new EffectInstance(o.effect, o.duration, o.amplifier, o);
      } else {
        this.hiddenEffect.update(o);
      }
    }
    if ((!o.ambient && this.ambient) || changed) {
      this.ambient = o.ambient;
      changed = true;
    }
    if (o.visible !== this.visible) {
      this.visible = o.visible;
      changed = true;
    }
    if (o.showIcon !== this.showIcon) {
      this.showIcon = o.showIcon;
      changed = true;
    }
    return changed;
  }

  private tickDownDuration(): void {
    if (this.hiddenEffect) this.hiddenEffect.tickDownDuration();
    this.duration--;
  }

  /**
   * MobEffectInstance.tick: apply the per-tick effect when due, count down, and fall back to the
   * hidden effect. Returns false when the effect has run out. `onUpdate` fires when a hidden
   * effect takes over.
   */
  tick(apply: (inst: EffectInstance) => void, onUpdate: () => void): boolean {
    if (this.duration > 0) {
      if (isDurationEffectTick(this.effect, this.duration, this.amplifier)) apply(this);
      this.tickDownDuration();
      if (this.duration === 0 && this.hiddenEffect) {
        this.setDetailsFrom(this.hiddenEffect);
        this.hiddenEffect = this.hiddenEffect.hiddenEffect;
        onUpdate();
      }
    }
    return this.duration > 0;
  }

  /** MobEffectInstance.toString-like description for commands. */
  describe(): string {
    return `${this.effect.name} x ${this.amplifier + 1}, Duration: ${this.duration}`;
  }
}

/** MobEffectUtil.formatDuration: "m:ss", or "**:**" for effects lasting ≥ 32767 ticks (no-duration potions). */
export function formatDuration(inst: EffectInstance | { duration: number }, durationFactor = 1): string {
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

/**
 * What an effect tick does to its holder (MobEffect.applyEffectTick). The server implements
 * this for players (and mobs) so the logic here stays pure.
 */
export interface EffectTarget {
  readonly health: number;
  readonly maxHealth: number;
  /** undead mobs swap instant health/damage and ignore regeneration/poison */
  readonly undead?: boolean;
  heal(amount: number): void;
  /** source: 'magic' | 'wither' | 'indirectMagic' */
  hurt(source: 'magic' | 'wither', amount: number): void;
  /** players only */
  causeFoodExhaustion?(amount: number): void;
  /** players only: FoodData.eat(food, saturationModifier) */
  eat?(food: number, saturationModifier: number): void;
  /** bad omen: try to start a raid; true to remove the effect */
  badOmen?(amplifier: number): boolean;
}

/** MobEffect.applyEffectTick (vanilla 1.17.1). */
export function applyEffectTick(t: EffectTarget, inst: EffectInstance): void {
  const amp = inst.amplifier;
  switch (inst.effect.name) {
    case 'regeneration':
      if (t.health < t.maxHealth) t.heal(1);
      break;
    case 'poison':
      if (t.health > 1) t.hurt('magic', 1);
      break;
    case 'wither':
      t.hurt('wither', 1);
      break;
    case 'hunger':
      t.causeFoodExhaustion?.(0.005 * (amp + 1));
      break;
    case 'saturation':
      t.eat?.(amp + 1, 1);
      break;
    case 'instant_health':
    case 'instant_damage': {
      const heals = (inst.effect.name === 'instant_health') !== !!t.undead;
      if (heals) t.heal(Math.max(4 << amp, 0));
      else t.hurt('magic', 6 << amp);
      break;
    }
  }
}

/**
 * MobEffect.applyInstantenousEffect for splash/lingering potions: `proximity` is the 0..1
 * distance factor (1 for drinking).
 */
export function applyInstantenousEffect(t: EffectTarget, inst: { effect: MobEffect; amplifier: number }, proximity: number): void {
  const amp = inst.amplifier;
  const n = inst.effect.name;
  if (n === 'instant_health' || n === 'instant_damage') {
    const heals = (n === 'instant_health') !== !!t.undead;
    if (heals) t.heal(Math.trunc(proximity * (4 << amp) + 0.5));
    else t.hurt('magic', Math.trunc(proximity * (6 << amp) + 0.5));
    return;
  }
  applyEffectTick(t, inst as EffectInstance);
}

/** Changes the holder sees as effects come and go (LivingEntity.onEffectAdded/Updated/Removed). */
export interface EffectListener {
  added(inst: EffectInstance): void;
  /** doRefresh: re-apply attribute modifiers (amplifier/duration replaced) */
  updated(inst: EffectInstance, doRefresh: boolean): void;
  removed(inst: EffectInstance): void;
}

/** LivingEntity.activeEffects with its add/remove/tick rules. */
export class ActiveEffects {
  readonly map = new Map<string, EffectInstance>();
  /** LivingEntity.effectsDirty: particle colour/ambience need recomputing */
  dirty = false;

  constructor(public listener: EffectListener | null = null) {}

  get size(): number {
    return this.map.size;
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  get(name: string): EffectInstance | undefined {
    return this.map.get(name);
  }

  /** amplifier, or −1 when absent */
  amplifier(name: string): number {
    return this.map.get(name)?.amplifier ?? -1;
  }

  /** LivingEntity.addEffect (canBeAffected is the caller's check). */
  add(inst: EffectInstance): boolean {
    const cur = this.map.get(inst.effect.name);
    if (!cur) {
      this.map.set(inst.effect.name, inst);
      this.dirty = true;
      this.listener?.added(inst);
      return true;
    }
    if (cur.update(inst)) {
      this.dirty = true;
      this.listener?.updated(cur, true);
      return true;
    }
    return false;
  }

  /** LivingEntity.forceAddEffect: replace outright. */
  forceAdd(inst: EffectInstance): void {
    const old = this.map.get(inst.effect.name);
    this.map.set(inst.effect.name, inst);
    this.dirty = true;
    if (old) this.listener?.updated(inst, true);
    else this.listener?.added(inst);
  }

  remove(name: string): boolean {
    const cur = this.map.get(name);
    if (!cur) return false;
    this.map.delete(name);
    this.dirty = true;
    this.listener?.removed(cur);
    return true;
  }

  /** LivingEntity.removeAllEffects (milk, totem, /effect clear). */
  removeAll(): boolean {
    if (this.map.size === 0) return false;
    for (const name of [...this.map.keys()]) this.remove(name);
    return true;
  }

  /** LivingEntity.tickEffects (effect half): tick each instance, removing those that ran out. */
  tick(apply: (inst: EffectInstance) => void): void {
    for (const [name, inst] of [...this.map]) {
      if (!this.map.has(name)) continue;
      const alive = inst.tick(apply, () => {
        this.dirty = true;
        this.listener?.updated(inst, true);
      });
      if (!alive) {
        if (this.map.get(name) === inst) {
          this.map.delete(name);
          this.dirty = true;
          this.listener?.removed(inst);
        }
      } else if (inst.duration % 600 === 0) {
        this.listener?.updated(inst, false);
      }
    }
  }

  /** LivingEntity.areAllEffectsAmbient. */
  allAmbient(): boolean {
    for (const e of this.map.values()) if (e.visible && !e.ambient) return false;
    return true;
  }

  /** DATA_EFFECT_COLOR_ID value: 0 when no effects. */
  particleColor(): number {
    return this.map.size === 0 ? 0 : effectsColor(this.map.values());
  }

  /** Sum of attribute modifiers from active effects for one attribute. */
  attributeValue(attribute: AttributeMod['attribute'], base: number): number {
    let add = 0, mult = 1;
    for (const e of this.map.values()) {
      for (const m of e.effect.mods) {
        if (m.attribute !== attribute) continue;
        if (m.op === 'addition') add += modifierValue(m, e.amplifier);
        else mult *= 1 + modifierValue(m, e.amplifier);
      }
    }
    return (base + add) * mult;
  }
}

/** LivingEntity.getDamageAfterMagicAbsorb (resistance half): damage after Resistance. */
export function resistanceReduce(amount: number, resistanceAmplifier: number): number {
  if (resistanceAmplifier < 0) return amount;
  const i = (resistanceAmplifier + 1) * 5;
  const j = 25 - i;
  return Math.max((amount * j) / 25, 0);
}

/** GameRenderer.getNightVisionScale: full strength, flickering in the last 10 seconds. */
export function nightVisionScale(duration: number, partial: number): number {
  return duration > 200 ? 1 : 0.7 + Math.sin((duration - partial) * Math.PI * 0.2) * 0.3;
}

/** FogRenderer blindness fog end distance (5 blocks, fading in over the last second). */
export function blindnessFogEnd(duration: number, renderDistance: number): number {
  let f = 5;
  if (duration < 20) f = f + (1 - duration / 20) * (renderDistance - f);
  return f;
}

/** Mining speed multiplier from haste/conduit power and mining fatigue (Player.getDestroySpeed). */
export function digSpeedFactor(hasteOrConduitAmp: number, fatigueAmp: number): number {
  let f = 1;
  if (hasteOrConduitAmp >= 0) f *= 1 + (hasteOrConduitAmp + 1) * 0.2;
  if (fatigueAmp >= 0) f *= [0.3, 0.09, 0.0027, 8.1e-4][Math.min(3, fatigueAmp)]!;
  return f;
}
