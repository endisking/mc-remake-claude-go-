/**
 * BossHealthOverlay (vanilla 1.17.1): boss bars stacked at the top centre of the screen, 182×5
 * each, the name above, 19 px apart, at most as many as fit in a third of the screen height.
 * Drawn with plain fills in an original style (no vanilla bars.png).
 */
import type { Gui } from './gui';

export interface BossBar {
  name: string;
  progress: number;
  color: number;
}

/** BossBarColor: pink, blue, red, green, yellow, purple, white — [fill, background] ARGB */
const COLORS: [number, number][] = [
  [0xffec4fd0, 0xff5a1f50], [0xff3ab4f0, 0xff163e58], [0xffe8402c, 0xff561812], [0xff4cd83a, 0xff1a5014],
  [0xffe8d43a, 0xff564c14], [0xffa04ce8, 0xff3a1a56], [0xffeeeeee, 0xff505050],
];

export class BossOverlay {
  readonly bars = new Map<number, BossBar>();

  /** ClientboundBossEventPacket: op 0 add, 1 remove, 2 update */
  handle(p: { op: number; id: number; name: string; progress: number; color: number }): void {
    if (p.op === 1) this.bars.delete(p.id);
    else this.bars.set(p.id, { name: p.name || this.bars.get(p.id)?.name || '', progress: Math.max(0, Math.min(1, p.progress)), color: p.color });
  }

  clear(): void {
    this.bars.clear();
  }

  render(g: Gui): void {
    if (this.bars.size === 0) return;
    const x = Math.floor(g.width / 2) - 91;
    let y = 12;
    for (const b of this.bars.values()) {
      const [fg, bg] = COLORS[b.color] ?? COLORS[0]!;
      g.fill(x - 1, y - 1, 184, 7, 0xff101010);
      g.fill(x, y, 182, 5, bg);
      const w = Math.floor(b.progress * 183);
      if (w > 0) {
        g.fill(x, y, Math.min(182, w), 5, fg);
        // top highlight row and notches every 1/10 (original styling)
        g.fill(x, y, Math.min(182, w), 1, 0x60ffffff);
      }
      for (let i = 1; i < 10; i++) g.fill(x + Math.floor((182 * i) / 10), y + 3, 1, 2, 0x50000000);
      g.centeredText(b.name, x + 91, y - 9);
      y += 19;
      if (y >= g.height / 3) break;
    }
  }
}
