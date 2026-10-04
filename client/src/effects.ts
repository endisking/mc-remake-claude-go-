/**
 * Client-side status effects (LocalPlayer active effects, Gui.renderEffects,
 * EffectRenderingInventoryScreen, potion swirl particles, nausea/night vision/blindness
 * screen effects, totem activation).
 */
import type { S2C } from '@shared/protocol/packets';
import { EFFECT_BY_ID, formatDuration, romanLevel, nightVisionScale, blindnessFogEnd, type MobEffect } from '@shared/game/effects';
import type { Gui } from './gui/gui';
import type { PhysicsEffects } from '@shared/entity/playerphysics';

export interface ClientEffect {
  effect: MobEffect;
  amplifier: number;
  duration: number;
  ambient: boolean;
  visible: boolean;
  showIcon: boolean;
}

/** MobEffectInstance.compareTo (reversed for drawing: Ordering.natural().reverse()). */
function compareEffects(a: ClientEffect, b: ClientEffect): number {
  if ((a.duration > 32147 || b.duration > 32147) && a.ambient && b.ambient) return Number(a.ambient) - Number(b.ambient);
  if (a.ambient !== b.ambient) return a.ambient ? 1 : -1;
  if (a.duration !== b.duration) return a.duration - b.duration;
  return a.effect.color - b.effect.color;
}

export class EffectsClient {
  readonly active = new Map<string, ClientEffect>();
  maxHealth = 20;
  absorption = 0;
  /** potion swirl colour per entity id (DATA_EFFECT_COLOR_ID), and ambience */
  readonly swirl = new Map<number, { color: number; ambient: boolean }>();
  /** LocalPlayer.portalTime driven by nausea (no portals yet) */
  portalTime = 0;
  oPortalTime = 0;
  /** GameRenderer.displayItemActivation: the totem pops up for 40 ticks */
  itemActivationTicks = 0;
  itemActivationOffX = 0;
  itemActivationOffY = 0;
  icons: ImageBitmap | null = null;
  frames: ImageBitmap | null = null;

  constructor(private readonly host: { entityId: number; localEffects: Map<string, number> }) {}

  async load(): Promise<void> {
    const img = async (u: string) => createImageBitmap(await (await fetch(u)).blob());
    try {
      [this.icons, this.frames] = await Promise.all([img('./textures/gui/mob_effects.png'), img('./textures/gui/effect_frames.png')]);
    } catch {
      // textures missing: icons are skipped
    }
  }

  handle(p: S2C): void {
    switch (p.t) {
      case 'updateEffect': {
        if (p.id !== this.host.entityId) return;
        const e = EFFECT_BY_ID[p.effect];
        if (!e) return;
        this.active.set(e.name, { effect: e, amplifier: p.amplifier, duration: p.duration, ambient: (p.flags & 1) !== 0, visible: (p.flags & 2) !== 0, showIcon: (p.flags & 4) !== 0 });
        this.syncLocal();
        break;
      }
      case 'removeEffect': {
        if (p.id !== this.host.entityId) return;
        const e = EFFECT_BY_ID[p.effect];
        if (e) this.active.delete(e.name);
        this.syncLocal();
        break;
      }
      case 'effectParticles':
        if (p.color === 0) this.swirl.delete(p.id);
        else this.swirl.set(p.id, { color: p.color, ambient: p.ambient });
        break;
      case 'playerAttributes':
        this.maxHealth = p.maxHealth;
        this.absorption = p.absorption;
        break;
    }
  }

  private syncLocal(): void {
    const m = this.host.localEffects;
    m.clear();
    for (const [n, e] of this.active) m.set(n, e.amplifier);
  }

  /** Respawn / dimension change: the new LocalPlayer has no effects. */
  reset(): void {
    this.active.clear();
    this.syncLocal();
    this.maxHealth = 20;
    this.absorption = 0;
    this.portalTime = this.oPortalTime = 0;
  }

  amp(name: string): number {
    return this.active.get(name)?.amplifier ?? -1;
  }

  /** Client tick: durations count down locally (LivingEntity.tickEffects on the client). */
  tick(): void {
    for (const [n, e] of this.active) {
      if (e.duration > 0) e.duration--;
      if (e.duration <= 0 && !e.effect.instantenous) this.active.delete(n);
    }
    if (this.active.size !== this.host.localEffects.size) this.syncLocal();
    // LocalPlayer.handleNetherPortalClient: nausea ramps the portal wobble up while > 3 s remain
    this.oPortalTime = this.portalTime;
    const nausea = this.active.get('nausea');
    if (nausea && nausea.duration > 60) {
      this.portalTime += 0.006666667;
      if (this.portalTime > 1) this.portalTime = 1;
    } else if (this.portalTime > 0) {
      this.portalTime -= 0.05;
      if (this.portalTime < 0) this.portalTime = 0;
    }
    if (this.itemActivationTicks > 0) this.itemActivationTicks--;
  }

  /** Movement effects for the client-predicted physics. */
  applyPhysics(fx: PhysicsEffects, depthStrider: number): void {
    fx.speed = this.amp('speed') + 1;
    fx.slowness = this.amp('slowness') + 1;
    fx.jumpBoost = this.amp('jump_boost') + 1;
    fx.slowFalling = this.active.has('slow_falling');
    fx.levitation = this.amp('levitation') + 1;
    fx.dolphinsGrace = this.active.has('dolphins_grace');
    fx.depthStrider = depthStrider;
  }

  /** GameRenderer.getNightVisionScale, also used for Conduit Power underwater (0 = none). */
  nightVision(partial: number, underwater: boolean): number {
    const nv = this.active.get('night_vision');
    if (nv) return nightVisionScale(nv.duration, partial);
    if (underwater && this.active.has('conduit_power')) return 1;
    return 0;
  }

  /** Blindness fog distance (null when not blind). */
  blindFog(renderDistance: number): number | null {
    const b = this.active.get('blindness');
    return b ? blindnessFogEnd(b.duration, renderDistance) : null;
  }

  /** Nausea strength for GameRenderer.renderLevel's wobble (portalTime lerp). */
  wobble(partial: number, screenEffectScale: number): number {
    const f = this.oPortalTime + (this.portalTime - this.oPortalTime) * partial;
    return f * screenEffectScale * screenEffectScale;
  }

  /** Totem pop (entity event 35 for the local player). */
  totemActivated(rand: () => number): void {
    this.itemActivationTicks = 40;
    this.itemActivationOffX = rand() * 2 - 1;
    this.itemActivationOffY = rand() * 2 - 1;
  }

  // ------------------------------------------------------------------ drawing

  private iconAt(g: Gui, e: MobEffect, x: number, y: number, size = 18): void {
    if (!this.icons) return;
    const i = e.id - 1;
    g.blit(this.icons, (i % 8) * 18, Math.floor(i / 8) * 18, 18, 18, x, y, size, size);
  }

  /** Gui.renderEffects: beneficial icons on the top row, others below, right-aligned. */
  renderHud(g: Gui): void {
    if (this.active.size === 0 || !this.frames) return;
    const list = [...this.active.values()].sort(compareEffects).reverse();
    let good = 0, bad = 0;
    for (const e of list) {
      if (!e.showIcon) continue;
      let k = g.width, l = 1;
      if (e.effect.category === 'beneficial') {
        good++;
        k -= 25 * good;
      } else {
        bad++;
        k -= 25 * bad;
        l += 26;
      }
      let alpha = 1;
      if (e.ambient) g.blit(this.frames, 24, 0, 24, 24, k, l);
      else {
        g.blit(this.frames, 0, 0, 24, 24, k, l);
        if (e.duration <= 200) {
          const i1 = 10 - Math.floor(e.duration / 20);
          alpha = Math.max(0, Math.min(0.5, e.duration / 10 / 5 * 0.5)) + Math.cos((e.duration * Math.PI) / 5) * Math.max(0, Math.min(0.25, (i1 / 10) * 0.25));
        }
      }
      g.ctx.save();
      g.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      this.iconAt(g, e.effect, k + 3, l + 3);
      g.ctx.restore();
    }
  }

  /**
   * EffectRenderingInventoryScreen.renderEffects: the list left of an inventory window whose
   * left edge is `left` (needs 120 + 2 px of room, else nothing is drawn — 1.17.1 has no
   * compact mode).
   */
  renderInventoryList(g: Gui, left: number, top: number): void {
    if (this.active.size === 0 || !this.frames) return;
    const x = left - 124;
    if (x < 0) return;
    const list = [...this.active.values()].filter((e) => e.showIcon || true).sort(compareEffects);
    let step = 33;
    if (list.length > 5) step = Math.floor(132 / (list.length - 1));
    let y = top;
    for (const e of list) {
      g.blit(this.frames, 0, 32, 120, 32, x, y);
      this.iconAt(g, e.effect, x + 6, y + 7);
      const name = e.amplifier >= 1 && e.amplifier <= 9 ? `${e.effect.displayName} ${romanLevel(e.amplifier + 1)}` : e.effect.displayName;
      g.text(name, x + 10 + 18, y + 6, 0xffffff);
      g.text(formatDuration(e), x + 10 + 18, y + 6 + 10, 0x7f7f7f);
      y += step;
    }
  }

  /** Swirl particles for every entity with effects (LivingEntity.tickEffects client half). */
  tickParticles(rand: () => number, entities: Iterable<{ id: number; x: number; y: number; z: number; width: number; height: number; invisible: boolean }>, spawn: (x: number, y: number, z: number, r: number, g: number, b: number, ambient: boolean) => void): void {
    for (const e of entities) {
      const s = this.swirl.get(e.id);
      if (!s || s.color <= 0) continue;
      let show = e.invisible ? Math.floor(rand() * 15) === 0 : rand() < 0.5;
      if (s.ambient) show = show && Math.floor(rand() * 5) === 0;
      if (!show) continue;
      const r = ((s.color >> 16) & 255) / 255, g = ((s.color >> 8) & 255) / 255, b = (s.color & 255) / 255;
      spawn(e.x + (2 * rand() - 1) * e.width * 0.5, e.y + e.height * rand(), e.z + (2 * rand() - 1) * e.width * 0.5, r, g, b, s.ambient);
    }
  }
}

/** Rotation by `rad` about a unit axis, column-major 4×4. */
function axisRotation(ax: number, ay: number, az: number, rad: number): number[] {
  const c = Math.cos(rad), s = Math.sin(rad), t = 1 - c;
  return [
    t * ax * ax + c, t * ax * ay + s * az, t * ax * az - s * ay, 0,
    t * ax * ay - s * az, t * ay * ay + c, t * ay * az + s * ax, 0,
    t * ax * az + s * ay, t * ay * az - s * ax, t * az * az + c, 0,
    0, 0, 0, 1,
  ];
}

function mul(a: number[], b: number[]): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

/**
 * GameRenderer.renderLevel nausea/portal wobble: rotate about (0, √½, √½) by (ticks)·speed,
 * stretch x by 1/f1, rotate back. `f` = wobble strength, `speed` 7 with nausea (20 in portals).
 */
export function nauseaMatrix(f: number, ticks: number, speed = 7): number[] | null {
  if (f <= 0) return null;
  let f1 = 5 / (f * f + 5) - f * 0.04;
  f1 *= f1;
  const k = Math.SQRT1_2;
  const ang = ((ticks * speed) * Math.PI) / 180;
  const scale = [1 / f1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return mul(mul(axisRotation(0, k, k, ang), scale), axisRotation(0, k, k, -ang));
}
