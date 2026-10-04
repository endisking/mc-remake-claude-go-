/**
 * Status effect icons in the top-right corner (vanilla Gui.renderEffects): beneficial effects
 * on the first row, harmful ones on the second, longest first, ambient (beacon) frames tinted,
 * and icons blinking during their last 10 seconds.
 */
import type { Gui } from './gui';
import { isBeneficial } from '@shared/game/effects';
import type { ActiveEffect } from '../itemuse';

let atlas: ImageBitmap | null = null;
let loading = false;

function load(): void {
  if (loading) return;
  loading = true;
  fetch('./textures/gui/mob_effects.png')
    .then((r) => r.blob())
    .then((b) => createImageBitmap(b))
    .then((img) => (atlas = img))
    .catch(() => {});
}

export function renderEffects(g: Gui, effects: Iterable<ActiveEffect>): void {
  const list = [...effects].filter((e) => e.showIcon);
  if (!list.length) return;
  if (!atlas) return load();
  // MobEffectInstance.compareTo reversed: ambient first, then the longest duration
  list.sort((a, b) => Number(b.ambient) - Number(a.ambient) || b.duration - a.duration || b.id - a.id);
  const ctx = (g as unknown as { ctx: CanvasRenderingContext2D }).ctx;
  let good = 0, bad = 0;
  for (const e of list) {
    let x = g.width, y = 1;
    if (isBeneficial(e.id)) x -= 25 * ++good;
    else {
      x -= 25 * ++bad;
      y += 26;
    }
    let alpha = 1;
    g.blit(atlas, e.ambient ? 24 : 0, 72, 24, 24, x, y);
    if (!e.ambient && e.duration <= 200) {
      const i1 = 10 - Math.floor(e.duration / 20);
      alpha = Math.max(0, Math.min(0.5, (e.duration / 10 / 5) * 0.5)) + Math.cos((e.duration * Math.PI) / 5) * Math.max(0, Math.min(0.25, (i1 / 10) * 0.25));
    }
    const i = e.id - 1;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    g.blit(atlas, (i % 8) * 18, Math.floor(i / 8) * 18, 18, 18, x + 3, y + 3);
    ctx.globalAlpha = prev;
  }
}
