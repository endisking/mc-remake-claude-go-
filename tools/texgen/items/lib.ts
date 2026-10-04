/**
 * Item sprite toolkit. Item icons are original 16×16 pixel art: a shape is described as a
 * mask (hand-drawn grid or procedural), then shaded automatically in the house style —
 * a dark rim in the material's own darkest shade, a bevel highlight on the top-left inner
 * edge, shadow on the bottom-right inner edge and a little dithering.
 */
import { Tex, hex, mix, rng, shade, type Palette, type RGBA } from '../lib';

export type Mask = Uint8Array; // 16×16, 1 = filled

export function emptyMask(): Mask {
  return new Uint8Array(256);
}

/** Mask from a grid of strings; any char in `on` (default: not '.' or ' ') is filled. */
export function maskOf(rows: string[], on?: string): Mask {
  const m = emptyMask();
  rows.forEach((r, y) => {
    for (let x = 0; x < 16; x++) {
      const ch = r[x] ?? '.';
      if (on ? on.includes(ch) : ch !== '.' && ch !== ' ') m[y * 16 + x] = 1;
    }
  });
  return m;
}

export function maskFn(fn: (x: number, y: number) => boolean): Mask {
  const m = emptyMask();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (fn(x, y)) m[y * 16 + x] = 1;
  return m;
}

export function at(m: Mask, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < 16 && y < 16 && m[y * 16 + x] === 1;
}

export function union(...ms: Mask[]): Mask {
  const o = emptyMask();
  for (const m of ms) for (let i = 0; i < 256; i++) if (m[i]) o[i] = 1;
  return o;
}

export function subtract(a: Mask, b: Mask): Mask {
  const o = emptyMask();
  for (let i = 0; i < 256; i++) if (a[i] && !b[i]) o[i] = 1;
  return o;
}

export function shiftMask(m: Mask, dx: number, dy: number): Mask {
  return maskFn((x, y) => at(m, x - dx, y - dy));
}

/** Material ramp: [rim, dark, mid, light, highlight]. */
export function mat(...cs: string[]): Palette {
  return cs.map((c) => hex(c));
}

export interface ShadeOpts {
  seed?: number;
  /** dithering strength (fraction of pixels nudged one step) */
  dither?: number;
  /** whether the edge pixels use the rim colour (default true) */
  rim?: boolean;
  /** draw only where this extra mask is set (for multi-material shapes sharing a silhouette) */
  clip?: Mask;
}

/**
 * Paint a mask with a 5-colour ramp in bevel style. Edge pixels → rim (index 0). Interior
 * pixels next to the rim on their top/left → light/highlight; on their bottom/right → dark.
 */
export function shadeMask(t: Tex, m: Mask, p: Palette, o: ShadeOpts = {}): Tex {
  const r = rng(o.seed ?? 7);
  const P = p.length;
  const rimOn = o.rim ?? true;
  const edge = (x: number, y: number) => at(m, x, y) && (!at(m, x - 1, y) || !at(m, x + 1, y) || !at(m, x, y - 1) || !at(m, x, y + 1));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (!at(m, x, y)) continue;
      if (o.clip && !at(o.clip, x, y)) continue;
      let idx: number;
      if (rimOn && edge(x, y)) {
        // the rim is lighter on the lit top-left side so silhouettes keep their volume
        const litSide = !at(m, x - 1, y) || !at(m, x, y - 1);
        const darkSide = !at(m, x + 1, y) || !at(m, x, y + 1);
        idx = litSide && !darkSide ? Math.min(1, P - 1) : 0;
      } else {
        const solid = (dx: number, dy: number) => at(m, x + dx, y + dy) && !(rimOn && edge(x + dx, y + dy));
        const hl = (solid(-1, 0) ? 0 : 1) + (solid(0, -1) ? 0 : 1) + (solid(-1, -1) ? 0 : 0.5);
        const sh = (solid(1, 0) ? 0 : 1) + (solid(0, 1) ? 0 : 1) + (solid(1, 1) ? 0 : 0.5);
        const mid = Math.floor((P - 1) / 2) + (P > 4 ? 0 : 0);
        idx = P >= 5 ? 2 : mid;
        if (hl > sh) idx = hl >= 2 ? P - 1 : P - 2;
        else if (sh > hl) idx = 1;
        if (o.dither !== 0 && r() < (o.dither ?? 0.12)) idx = Math.max(1, Math.min(P - 1, idx + (r() < 0.5 ? -1 : 1)));
      }
      t.set(x, y, p[idx]!);
    }
  return t;
}

/** Fill a mask with flat colour. */
export function fillMask(t: Tex, m: Mask, c: RGBA): Tex {
  for (let i = 0; i < 256; i++) if (m[i]) t.set(i & 15, i >> 4, c);
  return t;
}

/** Set pixels listed as "x,y x,y ..." to one colour. */
export function px(t: Tex, list: string, c: RGBA | string): Tex {
  const col = typeof c === 'string' ? hex(c) : c;
  for (const s of list.trim().split(/\s+/)) {
    if (!s) continue;
    const [x, y] = s.split(',').map(Number);
    t.set(x!, y!, col);
  }
  return t;
}

/** Draw a grid with a colour key over a texture ('.'/' ' are skipped). */
export function paintGrid(t: Tex, rows: string[], key: Record<string, RGBA | string>, ox = 0, oy = 0): Tex {
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const c = key[r[x]!];
      if (c === undefined) continue;
      t.set(x + ox, y + oy, typeof c === 'string' ? hex(c) : c);
    }
  });
  return t;
}

/** Recolour: map each pixel's luminance onto a palette (dark → light). Keeps alpha. */
export function recolor(src: Tex, p: Palette): Tex {
  const t = new Tex(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (c[3] < 128) continue;
      const l = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
      t.set(x, y, p[Math.max(0, Math.min(p.length - 1, Math.round(l * (p.length - 1))))]!);
    }
  return t;
}

/** Ramp of n shades around a base colour (dark rim → bright highlight). */
export function rampOf(base: string, n = 5, lo = 0.42, hi = 1.45): Palette {
  const c = hex(base);
  const out: Palette = [];
  for (let i = 0; i < n; i++) {
    const f = lo + ((hi - lo) * i) / (n - 1);
    if (f <= 1) out.push(shade(c, f));
    else out.push(mix(c, [255, 255, 255, 255], Math.min(0.85, (f - 1) * 0.9)));
  }
  return out;
}

/**
 * Diagonal handle from the bottom-left corner toward the top-right: 2 px thick staircase
 * (x + y = s and s + 1), lit upper pixel and darker lower one, with a grip band.
 */
export function handle(t: Tex, x0: number, x1: number, p: Palette, s = 15): Tex {
  for (let x = x0; x <= x1; x++) {
    const y = s - x;
    const k = x - x0;
    t.set(x, y, p[k === 0 ? 1 : k % 4 === 2 ? 2 : 3]!);
    t.set(x, y + 1, p[k === 0 ? 0 : k % 4 === 2 ? 0 : 1]!);
  }
  return t;
}

/** Copy of a texture recoloured by multiplying with a colour (for tinted overlays baked in). */
export function multiply(src: Tex, c: string): Tex {
  const m = hex(c);
  return src.clone().map((p) => (p[3] < 128 ? p : [Math.round((p[0] * m[0]) / 255), Math.round((p[1] * m[1]) / 255), Math.round((p[2] * m[2]) / 255), p[3]]));
}

/** Outline every opaque region with a 1px darker border outside it. */
export function outlineOutside(src: Tex, c: RGBA): Tex {
  const t = src.clone();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (src.get(x, y)[3] >= 128) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const xx = x + dx!, yy = y + dy!;
        return xx >= 0 && yy >= 0 && xx < 16 && yy < 16 && src.get(xx, yy)[3] >= 128;
      });
      if (n) t.set(x, y, c);
    }
  return t;
}

export { Tex, hex, mix, rng, shade, type Palette, type RGBA };
