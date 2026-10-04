/**
 * Container window art, drawn procedurally in GUI pixels (original designs in the familiar
 * bevelled-panel style): window panels, slot wells, result frames, arrows, the furnace flame
 * and empty-armour-slot silhouettes.
 */
import type { Gui } from './gui';

export const PANEL = 0xffc6c6c6;
const BLACK = 0xff000000;
const WHITE = 0xffffffff;
const SHADOW = 0xff555555;
const SLOT_DARK = 0xff373737;
const SLOT_FILL = 0xff8b8b8b;

/** A window panel with rounded black outline, light top-left and dark bottom-right bevel. */
export function panel(g: Gui, x: number, y: number, w: number, h: number): void {
  g.fill(x + 1, y + 2, w - 2, h - 4, PANEL);
  g.fill(x + 2, y + 1, w - 4, h - 2, PANEL);
  g.fill(x + 2, y, w - 4, 1, BLACK);
  g.fill(x + 2, y + h - 1, w - 4, 1, BLACK);
  g.fill(x, y + 2, 1, h - 4, BLACK);
  g.fill(x + w - 1, y + 2, 1, h - 4, BLACK);
  for (const [px, py] of [[x + 1, y + 1], [x + w - 2, y + 1], [x + 1, y + h - 2], [x + w - 2, y + h - 2]] as const) g.fill(px, py, 1, 1, BLACK);
  g.fill(x + 2, y + 1, w - 5, 2, WHITE);
  g.fill(x + 1, y + 2, 2, h - 5, WHITE);
  g.fill(x + 3, y + 3, 1, 1, WHITE);
  g.fill(x + 3, y + h - 3, w - 5, 2, SHADOW);
  g.fill(x + w - 3, y + 3, 2, h - 5, SHADOW);
  g.fill(x + w - 4, y + h - 4, 1, 1, SHADOW);
}

/** An inset well: dark top-left edge, white bottom-right edge (slots, the player box). */
export function inset(g: Gui, x: number, y: number, w: number, h: number, fill = SLOT_FILL): void {
  g.fill(x, y, w - 1, 1, SLOT_DARK);
  g.fill(x, y, 1, h - 1, SLOT_DARK);
  g.fill(x + 1, y + h - 1, w - 1, 1, WHITE);
  g.fill(x + w - 1, y + 1, 1, h - 1, WHITE);
  g.fill(x + w - 1, y, 1, 1, SLOT_FILL);
  g.fill(x, y + h - 1, 1, 1, SLOT_FILL);
  g.fill(x + 1, y + 1, w - 2, h - 2, fill);
}

/** An 18×18 slot well around the 16×16 item position (x, y). */
export function slot(g: Gui, x: number, y: number): void {
  inset(g, x - 1, y - 1, 18, 18);
}

/** The 26×26 frame around a result slot. */
export function resultSlot(g: Gui, x: number, y: number): void {
  inset(g, x - 5, y - 5, 26, 26);
}

/** A right-pointing arrow w×h; `fillW` columns drawn in `fill` (progress), the rest in the empty colour. */
export function arrow(g: Gui, x: number, y: number, w: number, h: number, fillW = 0, fill = WHITE): void {
  const head = Math.ceil(h / 2) + 1;
  const shaftH = Math.max(2, Math.round(h / 3));
  const shaftY = Math.floor((h - shaftH) / 2);
  for (let c = 0; c < w; c++) {
    const color = c < fillW ? fill : SLOT_FILL;
    if (c < w - head) g.fill(x + c, y + shaftY, 1, shaftH, color);
    else {
      const k = c - (w - head);
      const half = Math.floor(h / 2) - Math.floor((k * h) / 2 / head);
      g.fill(x + c, y + Math.floor(h / 2) - half, 1, half * 2 + (h % 2), color);
    }
  }
}

const FLAME = [
  '......a.......',
  '......aa......',
  '.....aaa......',
  '.....aaaa.....',
  '....aaaaa..a..',
  '....aaaaaa.a..',
  '...aaaaaaaaa..',
  '...aaaaaaaaa..',
  '..aaaaaaaaaaa.',
  '..aaaaaaaaaaa.',
  '.aaaaaaaaaaaa.',
  '.aaaaaaaaaaaa.',
  '..aaaaaaaaaa..',
  '...aaaaaaaa...',
];
const FLAME_COLORS = [0xfffff4a0, 0xfffff080, 0xffffe060, 0xffffd040, 0xffffc030, 0xffffb020, 0xffffa018, 0xffff9010, 0xffff8010, 0xffff7008, 0xfff06008, 0xffe05008, 0xffd04008, 0xffc03008];

/** Furnace flame 14×14; `rows` = how many bottom rows burn (vanilla getLitProgress + 1), 0 = unlit. */
export function flame(g: Gui, x: number, y: number, rows: number): void {
  for (let r = 0; r < 14; r++) {
    const lit = r >= 14 - rows;
    const line = FLAME[r]!;
    for (let c = 0; c < 14; c++) if (line[c] === 'a') g.fill(x + c, y + r, 1, 1, lit ? FLAME_COLORS[r]! : SLOT_FILL);
  }
}

const SILHOUETTES: Record<string, string[]> = {
  head: [
    '................', '................', '................', '.....######.....', '....#......#....', '...#........#...', '...#........#...', '...#..####..#...',
    '...#.#....#.#...', '...###....###...', '................', '................', '................', '................', '................', '................',
  ],
  chest: [
    '................', '..####....####..', '.#....####....#.', '.#............#.', '.###........###.', '...#........#...', '...#........#...', '...#........#...',
    '...#........#...', '...#........#...', '...#........#...', '...##########...', '................', '................', '................', '................',
  ],
  legs: [
    '................', '................', '...##########...', '...#........#...', '...#........#...', '...#...##...#...', '...#..#..#..#...', '...#..#..#..#...',
    '...#..#..#..#...', '...#..#..#..#...', '...#..#..#..#...', '...####..####...', '................', '................', '................', '................',
  ],
  feet: [
    '................', '................', '................', '................', '................', '................', '...###....###...', '...#.#....#.#...',
    '...#.#....#.#...', '..##.#....#.##..', '.#...#....#...#.', '.#####....#####.', '................', '................', '................', '................',
  ],
  offhand: [
    '................', '..############..', '..#..........#..', '..#..........#..', '..#..........#..', '..#..........#..', '..#..........#..', '..#..........#..',
    '...#........#...', '...#........#...', '....#......#....', '.....#....#.....', '......####......', '................', '................', '................',
  ],
};

/** Faint outline of the item an empty equipment slot takes. */
export function silhouette(g: Gui, x: number, y: number, kind: 'head' | 'chest' | 'legs' | 'feet' | 'offhand'): void {
  const rows = SILHOUETTES[kind]!;
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) if (rows[r]![c] === '#') g.fill(x + c, y + r, 1, 1, 0xff6f6f6f);
}

/** Vanilla tooltip box (TooltipRenderUtil colours). */
export function tooltip(g: Gui, lines: string[], mx: number, my: number): void {
  if (!lines.length) return;
  const w = Math.max(...lines.map((l) => g.font.width(l)));
  const h = 8 + (lines.length > 1 ? (lines.length - 1) * 10 + 2 : 0);
  let x = Math.floor(mx) + 12, y = Math.floor(my) - 12;
  if (x + w > g.width) x -= 28 + w;
  if (y + h + 6 > g.height) y = g.height - h - 6;
  const bg = 0xf0100010, b1 = 0x505000ff, b2 = 0x5028007f;
  g.fill(x - 3, y - 4, w + 6, 1, bg);
  g.fill(x - 3, y + h + 3, w + 6, 1, bg);
  g.fill(x - 3, y - 3, w + 6, h + 6, bg);
  g.fill(x - 4, y - 3, 1, h + 6, bg);
  g.fill(x + w + 3, y - 3, 1, h + 6, bg);
  // border gradient
  const grad = g.ctx.createLinearGradient(0, y - 2, 0, y + h + 2);
  grad.addColorStop(0, 'rgba(80,0,255,0.31)');
  grad.addColorStop(1, 'rgba(40,0,127,0.31)');
  g.ctx.fillStyle = grad;
  g.ctx.fillRect(x - 3, y - 2, 1, h + 4);
  g.ctx.fillRect(x + w + 2, y - 2, 1, h + 4);
  g.fill(x - 3, y - 3, w + 6, 1, b1);
  g.fill(x - 3, y + h + 2, w + 6, 1, b2);
  let ty = y;
  lines.forEach((l, i) => {
    g.text(l, x, ty, 0xffffff, true);
    ty += i === 0 ? 12 : 10;
  });
}
