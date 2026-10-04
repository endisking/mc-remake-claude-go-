/**
 * Potion swirl particles and effect-driven entity flags (Phase 7) on top of the EffectMap:
 * LivingEntity.updateInvisibilityStatus → DATA_EFFECT_COLOR_ID / DATA_EFFECT_AMBIENCE_ID
 * (sent as effectParticles), and Invisibility / Glowing in the shared flags.
 */
import type { GameServer } from './server';
import type { ServerPlayer } from './player';
import { effectsColor, EFFECT_BY_ID } from '@shared/game/effectdata';
import type { EffectMap } from '@shared/game/effects';

const last = new WeakMap<ServerPlayer, { key: string; inv: boolean; glow: boolean }>();

/** Swirl colour of an EffectMap (0 = none) and whether every visible effect is ambient. */
export function swirlOf(fx: EffectMap): { color: number; ambient: boolean } {
  if (fx.active.size === 0) return { color: 0, ambient: false };
  const list = [...fx.active.values()].map((e) => ({ effect: EFFECT_BY_ID[e.id]!, amplifier: e.amplifier, visible: e.visible, ambient: e.ambient })).filter((e) => e.effect);
  const color = effectsColor(list);
  const ambient = list.every((e) => !e.visible || e.ambient);
  return { color, ambient };
}

/** Per-tick sync after the effects ticked. */
export function syncSwirl(s: GameServer, p: ServerPlayer): void {
  const fx = p.living.effects;
  const { color, ambient } = swirlOf(fx);
  const key = `${color}:${ambient}`;
  const inv = fx.has('invisibility'), glow = fx.has('glowing');
  const prev = last.get(p);
  if (!prev || prev.key !== key) s.broadcastToTrackers(p, { t: 'effectParticles', id: p.id, color, ambient }, true);
  if (!prev || prev.inv !== inv || prev.glow !== glow) p.stateDirty = true;
  last.set(p, { key, inv, glow });
}

/** A player started tracking `p`: resend its swirl. */
export function resendSwirl(s: GameServer, viewer: ServerPlayer, p: ServerPlayer): void {
  const { color, ambient } = swirlOf(p.living.effects);
  if (color !== 0) s.send(viewer, { t: 'effectParticles', id: p.id, color, ambient });
}
