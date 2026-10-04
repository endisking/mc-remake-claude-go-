/**
 * Server-side status effects for players (vanilla LivingEntity / ServerPlayer effect handling):
 * add/update/remove with the client sync packets, per-tick application, attribute side effects
 * (absorption, health boost), potion swirl colour, milk, and the Totem of Undying.
 *
 * Mobs can reuse ActiveEffects + applyEffectTick from @shared/game/effects directly.
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { ActiveEffects, EffectInstance, applyEffectTick, effectByName, EFFECT_BY_NAME, type EffectInstance as Inst, type EffectOptions, type EffectTarget } from '@shared/game/effects';
import { commandHooks } from './commands/hooks';
import { isPlayer, type Target } from './commands/source';
import { ITEMS_BY_NAME } from '@shared/data';

export const MAGIC_DAMAGE = { id: 'magic', bypassArmor: true, magic: true } as const;
export const WITHER_DAMAGE = { id: 'wither', bypassArmor: true } as const;

const TOTEM = ITEMS_BY_NAME.get('totem_of_undying')?.id ?? -1;

/** Per-player effect bookkeeping that is not part of vanilla's MobEffectInstance. */
interface Sync {
  color: number;
  ambient: boolean;
  maxHealth: number;
  absorption: number;
}

export class ServerEffects {
  private readonly sync = new WeakMap<ActiveEffects, Sync>();

  constructor(private readonly s: GameServer) {
    // /effect give|clear
    commandHooks.applyEffect = (t: Target, effect, duration, amplifier, showParticles) => {
      if (!isPlayer(t)) return false;
      return this.addEffect(t, effect, duration, amplifier, { visible: showParticles, showIcon: true });
    };
    commandHooks.removeEffect = (t: Target, effect) => {
      if (!isPlayer(t)) return false;
      return effect === null ? this.removeAll(t) : this.removeEffect(t, effect);
    };
  }

  /** The player's ActiveEffects, wired to this player's sync packets. */
  of(p: ServerPlayer): ActiveEffects {
    const fx = p.living.effects;
    if (!fx.listener) {
      fx.listener = {
        added: (inst) => this.onAdded(p, inst),
        updated: (inst, refresh) => this.onUpdated(p, inst, refresh),
        removed: (inst) => this.onRemoved(p, inst),
      };
    }
    return fx;
  }

  /** LivingEntity.addEffect: the clean API for food, potions, beacons, commands, … */
  addEffect(p: ServerPlayer, effect: string, duration: number, amplifier = 0, opts: EffectOptions = {}): boolean {
    if (p.living.dead) return false;
    return this.of(p).add(new EffectInstance(effectByName(effect), duration, amplifier, opts));
  }

  removeEffect(p: ServerPlayer, effect: string): boolean {
    return this.of(p).remove(effect.replace(/^minecraft:/, ''));
  }

  /** Milk, totems, /effect clear. */
  removeAll(p: ServerPlayer): boolean {
    return this.of(p).removeAll();
  }

  has(p: ServerPlayer, effect: string): boolean {
    return p.living.effects.has(effect);
  }

  /** amplifier or −1 */
  amp(p: ServerPlayer, effect: string): number {
    return p.living.effects.amplifier(effect);
  }

  private flags(inst: Inst): number {
    return (inst.ambient ? 1 : 0) | (inst.visible ? 2 : 0) | (inst.showIcon ? 4 : 0);
  }

  private sendUpdate(p: ServerPlayer, inst: Inst): void {
    this.s.send(p, { t: 'updateEffect', id: p.id, effect: inst.effect.id, amplifier: inst.amplifier & 255, duration: Math.max(0, Math.min(inst.duration, 0x7fffffff)), flags: this.flags(inst) });
  }

  private onAdded(p: ServerPlayer, inst: Inst): void {
    this.addModifiers(p, inst);
    this.sendUpdate(p, inst);
  }

  private onUpdated(p: ServerPlayer, inst: Inst, refresh: boolean): void {
    if (refresh) {
      this.removeModifiers(p, inst, true);
      this.addModifiers(p, inst);
    }
    this.sendUpdate(p, inst);
  }

  private onRemoved(p: ServerPlayer, inst: Inst): void {
    this.removeModifiers(p, inst, false);
    this.s.send(p, { t: 'removeEffect', id: p.id, effect: inst.effect.id });
  }

  /** MobEffect.addAttributeModifiers (+ AbsorptionMobEffect). */
  private addModifiers(p: ServerPlayer, inst: Inst): void {
    const l = p.living;
    if (inst.effect.name === 'absorption') l.absorption = l.absorption + 4 * (inst.amplifier + 1);
    this.recomputeMaxHealth(p);
    if (inst.effect.name === 'invisibility' || inst.effect.name === 'glowing') p.stateDirty = true;
  }

  /** MobEffect.removeAttributeModifiers (+ Absorption/HealthBoost overrides). */
  private removeModifiers(p: ServerPlayer, inst: Inst, refreshing: boolean): void {
    const l = p.living;
    if (inst.effect.name === 'absorption') l.absorption = Math.max(0, l.absorption - 4 * (inst.amplifier + 1));
    if (!refreshing) {
      // the instance is gone from the map already, so this recomputes without it
      this.recomputeMaxHealth(p);
      if (inst.effect.name === 'health_boost' && l.health > l.maxHealth) l.health = l.maxHealth;
    }
    if (inst.effect.name === 'invisibility' || inst.effect.name === 'glowing') p.stateDirty = true;
  }

  private recomputeMaxHealth(p: ServerPlayer): void {
    const l = p.living;
    l.maxHealth = p.living.effects.attributeValue('max_health', 20);
    if (l.health > l.maxHealth) l.health = l.maxHealth;
  }

  /** The EffectTarget view of a player for MobEffect.applyEffectTick. */
  private target(p: ServerPlayer): EffectTarget {
    const s = this.s;
    return {
      get health() { return p.living.health; },
      get maxHealth() { return p.living.maxHealth; },
      heal: (a) => s.survival.heal(p, a),
      hurt: (src, a) => { s.survival.hurt(p, src === 'magic' ? MAGIC_DAMAGE : WITHER_DAMAGE, a); },
      causeFoodExhaustion: (a) => { if (p.gameMode === 0 || p.gameMode === 2) p.living.food.addExhaustion(a); },
      eat: (food, sat) => p.living.food.eat(food, sat),
      // no raids yet: the effect simply stays until it runs out (vanilla removes it when a raid starts)
      badOmen: () => false,
    };
  }

  /** LivingEntity.tickEffects (server side): apply, count down, sync colour and attributes. */
  tick(p: ServerPlayer): void {
    const fx = this.of(p);
    if (fx.size > 0 && !p.living.dead) {
      const t = this.target(p);
      fx.tick((inst) => applyEffectTick(t, inst));
    }
    let sy = this.sync.get(fx);
    if (!sy) {
      sy = { color: 0, ambient: false, maxHealth: 20, absorption: 0 };
      this.sync.set(fx, sy);
    }
    if (fx.dirty) {
      fx.dirty = false;
      // updateInvisibilityStatus: colour and ambience of the swirl particles
      const color = fx.particleColor(), ambient = fx.size > 0 && fx.allAmbient();
      if (color !== sy.color || ambient !== sy.ambient) {
        sy.color = color;
        sy.ambient = ambient;
        this.s.broadcastToTrackers(p, { t: 'effectParticles', id: p.id, color, ambient }, true);
      }
    }
    const l = p.living;
    if (l.maxHealth !== sy.maxHealth || l.absorption !== sy.absorption) {
      sy.maxHealth = l.maxHealth;
      sy.absorption = l.absorption;
      this.s.send(p, { t: 'playerAttributes', maxHealth: l.maxHealth, absorption: l.absorption });
    }
  }

  /** Send everything a newly tracking client needs (join, respawn, tracking start). */
  resend(p: ServerPlayer): void {
    const fx = this.of(p);
    for (const inst of fx.map.values()) this.sendUpdate(p, inst);
    const sy = this.sync.get(fx);
    if (sy) {
      sy.maxHealth = -1;
      sy.color = -1;
    }
    fx.dirty = true;
  }

  /**
   * LivingEntity.checkTotemDeathProtection: a totem in either hand (main hand first) saves the
   * player at 1 health. Returns true when the death was prevented.
   */
  checkTotem(p: ServerPlayer, bypassInvul: boolean): boolean {
    if (bypassInvul) return false;
    const inv = p.inventory;
    let slot = -1;
    if (inv.get(inv.selected)?.id === TOTEM) slot = inv.selected;
    else if (inv.get(40)?.id === TOTEM) slot = 40;
    if (slot < 0) return false;
    const st = inv.get(slot)!;
    st.count--;
    inv.set(slot, st.count > 0 ? st : null);
    this.s.syncSlot(p, slot);
    const l = p.living;
    l.health = 1;
    this.removeAll(p);
    this.addEffect(p, 'regeneration', 900, 1);
    this.addEffect(p, 'absorption', 100, 1);
    this.addEffect(p, 'fire_resistance', 800, 0);
    // entity event 35: totem particles + sound, and the item activation animation for the holder
    this.s.broadcastToTrackers(p, { t: 'entityEvent', id: p.id, event: 35 }, true);
    return true;
  }

  /** Milk bucket finished drinking (MilkBucketItem.finishUsingItem). */
  drinkMilk(p: ServerPlayer): void {
    this.removeAll(p);
  }
}

/** Saved form of the player's effects (vanilla ActiveEffects NBT list). */
export function saveEffects(p: ServerPlayer): { id: string; amp: number; dur: number; ambient: boolean; visible: boolean; icon: boolean }[] {
  return [...p.living.effects.map.values()].map((e) => ({ id: e.effect.name, amp: e.amplifier, dur: e.duration, ambient: e.ambient, visible: e.visible, icon: e.showIcon }));
}

/** Restore saved effects (before the player is announced; modifiers re-applied). */
export function loadEffects(p: ServerPlayer, list: unknown): void {
  if (!Array.isArray(list)) return;
  for (const e of list as { id?: unknown; amp?: unknown; dur?: unknown; ambient?: unknown; visible?: unknown; icon?: unknown }[]) {
    if (typeof e?.id !== 'string' || !EFFECT_BY_NAME.has(e.id) || typeof e.dur !== 'number' || e.dur <= 0) continue;
    const fx = p.living.effects;
    const inst = new EffectInstance(effectByName(e.id), e.dur, typeof e.amp === 'number' ? e.amp : 0, { ambient: !!e.ambient, visible: e.visible !== false, showIcon: e.icon !== false });
    fx.map.set(e.id, inst);
    fx.dirty = true;
  }
  p.living.maxHealth = p.living.effects.attributeValue('max_health', 20);
}
