/**
 * Status effects (vanilla MobEffect / MobEffectInstance / LivingEntity.tickEffects, 1.17.1):
 * adding with the upgrade rules, per-tick application (regeneration, poison, wither, hunger,
 * saturation), instant health/damage, absorption hearts, expiry and milk clearing.
 */
import { EFFECTS } from '../data';

/** snake_case registry name → numeric id (minecraft-data ids = vanilla registry ids). */
export const EFFECT_ID: Record<string, number> = {};
export const EFFECT_NAME: Record<number, string> = {};
for (const e of EFFECTS) {
  const snake = e.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  EFFECT_ID[snake] = e.id;
  EFFECT_NAME[e.id] = snake;
}

export function effectId(name: string): number {
  const id = EFFECT_ID[name];
  if (id === undefined) throw new Error(`unknown effect ${name}`);
  return id;
}

export interface EffectInstance {
  id: number;
  amplifier: number;
  duration: number;
  ambient: boolean;
  visible: boolean;
  showIcon: boolean;
}

/** What an effect acts on (a player's survival state). */
export interface EffectTarget {
  readonly health: number;
  readonly maxHealth: number;
  absorption: number;
  heal(amount: number): void;
  /** DamageSource.MAGIC (poison, instant damage) */
  hurtMagic(amount: number): void;
  /** DamageSource.WITHER */
  hurtWither(amount: number): void;
  addExhaustion(amount: number): void;
  eat(nutrition: number, saturationModifier: number): void;
}

const INSTANT = new Set(['instant_health', 'instant_damage', 'saturation']);

/** MobEffect.isDurationEffectTick. */
export function isDurationEffectTick(name: string, duration: number, amplifier: number): boolean {
  let k = -1;
  if (name === 'regeneration') k = 50 >> amplifier;
  else if (name === 'poison') k = 25 >> amplifier;
  else if (name === 'wither') k = 40 >> amplifier;
  else if (name === 'hunger') return true;
  else return INSTANT.has(name) ? duration >= 1 : false;
  return k > 0 ? duration % k === 0 : true;
}

/** MobEffect.applyEffectTick. */
export function applyEffectTick(name: string, t: EffectTarget, amplifier: number): void {
  switch (name) {
    case 'regeneration':
      if (t.health < t.maxHealth) t.heal(1);
      break;
    case 'poison':
      if (t.health > 1) t.hurtMagic(1);
      break;
    case 'wither':
      t.hurtWither(1);
      break;
    case 'hunger':
      t.addExhaustion(0.005 * (amplifier + 1));
      break;
    case 'saturation':
      t.eat(amplifier + 1, 1);
      break;
    case 'instant_health':
      t.heal(Math.max(4 << amplifier, 0));
      break;
    case 'instant_damage':
      t.hurtMagic(6 << amplifier);
      break;
  }
}

/** The beneficial/harmful flag (minecraft-data type). */
export function isBeneficial(id: number): boolean {
  return EFFECTS.find((e) => e.id === id)?.type === 'good';
}

export class EffectMap {
  readonly active = new Map<number, EffectInstance>();
  /** called when an effect is added, upgraded or removed (sync to clients) */
  onChange: ((e: EffectInstance, removed: boolean) => void) | null = null;

  has(name: string): boolean {
    return this.active.has(effectId(name));
  }

  get(name: string): EffectInstance | undefined {
    return this.active.get(effectId(name));
  }

  /** Amplifier of an active effect, −1 when absent. */
  amplifier(name: string): number {
    return this.get(name)?.amplifier ?? -1;
  }

  /**
   * LivingEntity.addEffect + MobEffectInstance.update: instant effects apply at once; a stronger
   * amplifier replaces the current one, an equal one only extends the duration. Absorption
   * modifiers are refreshed like onEffectUpdated (topping the hearts back up).
   */
  add(name: string, duration: number, amplifier: number, t: EffectTarget | null, ambient = false, visible = true): boolean {
    const id = effectId(name);
    if (name === 'instant_health' || name === 'instant_damage') {
      if (t) applyEffectTick(name, t, amplifier);
      return true;
    }
    const cur = this.active.get(id);
    if (!cur) {
      const inst: EffectInstance = { id, amplifier, duration, ambient, visible, showIcon: visible };
      this.active.set(id, inst);
      if (t) this.addModifiers(name, t, amplifier);
      this.onChange?.(inst, false);
      return true;
    }
    let changed = false;
    const oldAmp = cur.amplifier;
    if (amplifier > cur.amplifier) {
      cur.amplifier = amplifier;
      cur.duration = duration;
      changed = true;
    } else if (amplifier === cur.amplifier && cur.duration < duration) {
      cur.duration = duration;
      changed = true;
    }
    if (ambient !== cur.ambient) {
      cur.ambient = ambient;
      changed = true;
    }
    if (changed) {
      if (t) {
        this.removeModifiers(name, t, oldAmp);
        this.addModifiers(name, t, cur.amplifier);
      }
      this.onChange?.(cur, false);
    }
    return changed;
  }

  remove(name: string, t: EffectTarget | null): boolean {
    const id = effectId(name);
    const cur = this.active.get(id);
    if (!cur) return false;
    this.active.delete(id);
    if (t) this.removeModifiers(name, t, cur.amplifier);
    this.onChange?.(cur, true);
    return true;
  }

  /** LivingEntity.removeAllEffects (milk). */
  clear(t: EffectTarget | null): boolean {
    if (this.active.size === 0) return false;
    for (const id of [...this.active.keys()]) this.remove(EFFECT_NAME[id]!, t);
    return true;
  }

  /** LivingEntity.tickEffects: apply each effect, count it down, drop expired ones. */
  tick(t: EffectTarget): void {
    for (const [id, inst] of [...this.active]) {
      const name = EFFECT_NAME[id]!;
      if (inst.duration > 0) {
        if (isDurationEffectTick(name, inst.duration, inst.amplifier)) applyEffectTick(name, t, inst.amplifier);
        inst.duration--;
      }
      if (inst.duration <= 0 && this.active.get(id) === inst) this.remove(name, t);
    }
  }

  private addModifiers(name: string, t: EffectTarget, amp: number): void {
    if (name === 'absorption') t.absorption = t.absorption + 4 * (amp + 1);
  }

  private removeModifiers(name: string, t: EffectTarget, amp: number): void {
    if (name === 'absorption') t.absorption = Math.max(0, t.absorption - 4 * (amp + 1));
  }
}
