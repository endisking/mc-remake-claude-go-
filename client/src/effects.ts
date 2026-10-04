/**
 * Client-side extras for status effects on top of ItemUse's effect state (Phase 7): potion
 * swirl particles around entities, the inventory-screen effect list
 * (EffectRenderingInventoryScreen) and the totem pop-up animation timer.
 */
import type { S2C } from '@shared/protocol/packets';
import { EFFECT_BY_ID, formatDuration, romanLevel } from '@shared/game/effectdata';
import type { Gui } from './gui/gui';
import type { ActiveEffect } from './itemuse';

export class EffectsClient {
  /** potion swirl colour per entity id (DATA_EFFECT_COLOR_ID), and ambience */
  readonly swirl = new Map<number, { color: number; ambient: boolean }>();
  /** GameRenderer.displayItemActivation: the totem pops up for 40 ticks */
  itemActivationTicks = 0;
  itemActivationOffX = 0;
  itemActivationOffY = 0;
  private atlas: ImageBitmap | null = null;

  constructor(private readonly host: { entityId: number }) {}

  async load(): Promise<void> {
    try {
      this.atlas = await createImageBitmap(await (await fetch('./textures/gui/mob_effects.png')).blob());
    } catch {
      // icons are skipped without the atlas
    }
  }

  handle(p: S2C): void {
    if (p.t !== 'effectParticles') return;
    if (p.color === 0) this.swirl.delete(p.id);
    else this.swirl.set(p.id, { color: p.color, ambient: p.ambient });
  }

  reset(): void {
    this.itemActivationTicks = 0;
    void this.host;
  }

  tick(): void {
    if (this.itemActivationTicks > 0) this.itemActivationTicks--;
  }

  /** Totem pop (entity event 35 for the local player). */
  totemActivated(rand: () => number): void {
    this.itemActivationTicks = 40;
    this.itemActivationOffX = rand() * 2 - 1;
    this.itemActivationOffY = rand() * 2 - 1;
  }

  /**
   * EffectRenderingInventoryScreen.renderEffects: entries (120×32) left of the inventory window
   * whose left edge is `left`; skipped when there is no room (1.17.1 has no compact mode).
   */
  renderInventoryList(g: Gui, left: number, top: number, effects: Iterable<ActiveEffect>): void {
    const list = [...effects].sort((a, b) => Number(a.ambient) - Number(b.ambient) || a.duration - b.duration || a.id - b.id);
    if (list.length === 0) return;
    const x = left - 124;
    if (x < 0) return;
    const step = list.length > 5 ? Math.floor(132 / (list.length - 1)) : 33;
    let y = top;
    for (const e of list) {
      const def = EFFECT_BY_ID[e.id];
      if (!def) continue;
      // panel: light bevelled box like the inventory background
      g.fill(x, y, 120, 32, 0xff16161a);
      g.fill(x + 1, y + 1, 118, 30, 0xfff4f4f7);
      g.fill(x + 2, y + 2, 117, 29, 0xff6e6e76);
      g.fill(x + 2, y + 2, 116, 28, 0xffc3c3c8);
      if (this.atlas) {
        const i = e.id - 1;
        g.blit(this.atlas, (i % 8) * 18, Math.floor(i / 8) * 18, 18, 18, x + 6, y + 7);
      }
      const name = e.amplifier >= 1 && e.amplifier <= 9 ? `${def.displayName} ${romanLevel(e.amplifier + 1)}` : def.displayName;
      g.text(name, x + 10 + 18, y + 6, 0xffffff);
      g.text(formatDuration(e), x + 10 + 18, y + 6 + 10, 0x7f7f7f);
      y += step;
    }
  }

  /** Swirl particles for entities with effects (LivingEntity.tickEffects, client half). */
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
