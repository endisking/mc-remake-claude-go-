/**
 * Pixel-art texture toolkit. Every texture is original: designed in code as a palette
 * plus a pixel grid, or a palette plus seeded noise with hand-placed details.
 *
 * Style rules: 16×16, no anti-aliasing, 4–8 colours per material, light from the
 * top-left (bumps get highlights on their top-left edge and shadows bottom-right),
 * subtle dithering noise.
 */

export type RGBA = [number, number, number, number];
export type Palette = RGBA[];

export class Tex {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w = 16,
    readonly h = 16,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  get(x: number, y: number): RGBA {
    const i = (((y % this.h) + this.h) % this.h) * this.w + (((x % this.w) + this.w) % this.w);
    const d = this.data;
    return [d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!, d[i * 4 + 3]!];
  }
  set(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }
  clone(): Tex {
    const t = new Tex(this.w, this.h);
    t.data.set(this.data);
    return t;
  }
  /** Draw `src` over this texture with alpha (binary alpha keeps pixel art crisp). */
  over(src: Tex, ox = 0, oy = 0): this {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const c = src.get(x, y);
        if (c[3] >= 128) this.set(x + ox, y + oy, c);
      }
    return this;
  }
  map(fn: (c: RGBA, x: number, y: number) => RGBA): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, fn(this.get(x, y), x, y));
    return this;
  }
}

// ------------------------------------------------------------------ colour helpers
export function hex(s: string, a = 255): RGBA {
  const v = parseInt(s.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}
export function pal(...cs: string[]): Palette {
  return cs.map((c) => hex(c));
}
export const CLEAR: RGBA = [0, 0, 0, 0];

export function shade(c: RGBA, f: number): RGBA {
  return [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f), c[3]];
}
export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}
/** Convert to grayscale (for biome-tinted textures). Keeps relative brightness. */
export function gray(c: RGBA): RGBA {
  const l = Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  return [l, l, l, c[3]];
}
/** Build a ramp of n colours from dark to light between two endpoints. */
export function ramp(dark: string, light: string, n: number): Palette {
  const a = hex(dark), b = hex(light);
  return Array.from({ length: n }, (_, i) => mix(a, b, n === 1 ? 0 : i / (n - 1)));
}

// ------------------------------------------------------------------ deterministic randomness
export function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Tileable value noise on a 16×16 torus with `cells` lattice cells per side. */
export function tileNoise(seed: number, cells: number, w = 16, h = 16): Float32Array {
  const r = rng(seed);
  const lat = new Float32Array(cells * cells).map(() => r());
  const out = new Float32Array(w * h);
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells, fy = (y / h) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = sm(fx - x0), ty = sm(fy - y0);
      const g = (i: number, j: number) => lat[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)]!;
      const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
      const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
      out[y * w + x] = a + (b - a) * ty;
    }
  return out;
}

/** Sum of tileable octaves, normalised to 0..1. */
export function fbm(seed: number, octaves: number[] = [2, 4, 8], weights: number[] = [0.5, 0.3, 0.2], w = 16, h = 16): Float32Array {
  const out = new Float32Array(w * h);
  octaves.forEach((c, i) => {
    const n = tileNoise(seed + i * 7919, c, w, h);
    for (let k = 0; k < out.length; k++) out[k]! += n[k]! * weights[i]!;
  });
  let mn = Infinity, mx = -Infinity;
  for (const v of out) {
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
  for (let k = 0; k < out.length; k++) out[k] = (out[k]! - mn) / (mx - mn || 1);
  return out;
}

export interface NoiseOpts {
  seed: number;
  octaves?: number[];
  weights?: number[];
  /** Strength of top-left emboss lighting (palette steps). */
  emboss?: number;
  /** Random per-pixel dithering (palette steps). */
  dither?: number;
  /** Bias added to the noise value before mapping (−1..1). */
  bias?: number;
  /** Contrast multiplier around 0.5. */
  contrast?: number;
}

/**
 * Fill a texture by mapping embossed noise onto a palette (dark → light).
 * The emboss compares each pixel to its bottom-right neighbour so raised areas catch
 * light from the top-left.
 */
export function noiseTex(palette: Palette, o: NoiseOpts, w = 16, h = 16): Tex {
  const n = fbm(o.seed, o.octaves, o.weights, w, h);
  const r = rng(o.seed ^ 0x9e3779b9);
  const t = new Tex(w, h);
  const P = palette.length;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = n[y * w + x]!;
      v = (v - 0.5) * (o.contrast ?? 1) + 0.5 + (o.bias ?? 0);
      const br = n[((y + 1) % h) * w + ((x + 1) % w)]!;
      const em = (n[y * w + x]! - br) * (o.emboss ?? 2);
      const d = (r() - 0.5) * (o.dither ?? 0.8);
      let idx = Math.round(v * (P - 1) + em + d);
      idx = Math.max(0, Math.min(P - 1, idx));
      t.set(x, y, palette[idx]!);
    }
  return t;
}

/**
 * Hand-drawn pixel grid. `rows` are strings; each char maps through `key` to a colour.
 * '.' or ' ' is transparent unless mapped.
 */
export function grid(rows: string[], key: Record<string, RGBA | string>): Tex {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const t = new Tex(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[y]![x] ?? '.';
      const c = key[ch];
      if (c === undefined) continue;
      t.set(x, y, typeof c === 'string' ? hex(c) : c);
    }
  return t;
}

/**
 * Scatter ore clusters on a base texture. Each cluster is a 4–7 pixel blob: a light
 * highlight on its top-left pixels, mid tones inside, and a dark rim on the bottom-right,
 * with a darkened stone pixel beneath for depth.
 */
export function ore(base: Tex, colors: Palette, seed: number, clusters = 5): Tex {
  const t = base.clone();
  const r = rng(seed);
  const shapes: [number, number][][] = [
    [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
    [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
    [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [2, 1]],
    [[1, 0], [0, 1], [1, 1], [2, 1]],
  ];
  const centres: [number, number][] = [];
  let tries = 0;
  while (centres.length < clusters && tries++ < 600) {
    const cx = Math.floor(r() * 13), cy = Math.floor(r() * 13);
    if (centres.every(([x, y]) => Math.max(Math.abs(x - cx), Math.abs(y - cy)) > 3)) centres.push([cx, cy]);
  }
  const dark = colors[0]!, light = colors[colors.length - 1]!;
  const mids = colors.slice(1, -1).length ? colors.slice(1, -1) : [colors[0]!];
  for (const [cx, cy] of centres) {
    const s = shapes[Math.floor(r() * shapes.length)]!;
    const cells = new Set(s.map(([dx, dy]) => `${cx + dx},${cy + dy}`));
    // shadow on stone below-right of the blob
    for (const [dx, dy] of s) {
      const sx = cx + dx + 1, sy = cy + dy + 1;
      if (!cells.has(`${sx},${sy}`)) t.set(sx, sy, shade(t.get(sx, sy), 0.72));
    }
    for (const [dx, dy] of s) {
      const x = cx + dx, y = cy + dy;
      const open = (ex: number, ey: number) => !cells.has(`${x + ex},${y + ey}`);
      let c: RGBA;
      if (open(-1, 0) && open(0, -1)) c = light;
      else if (open(1, 0) && open(0, 1)) c = dark;
      else c = mids[Math.floor(r() * mids.length)]!;
      t.set(x, y, c);
    }
  }
  return t;
}

/** Cells of irregular stones with mortar lines (cobblestone-like layouts). */
export function cells(seed: number, count: number, w = 16, h = 16): { id: Int32Array; edge: Uint8Array } {
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) pts.push([r() * w, r() * h]);
  const id = new Int32Array(w * h);
  const d2 = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = Infinity, second = Infinity, bi = 0;
      pts.forEach(([px, py], i) => {
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const dx = x + 0.5 - (px + ox * w), dy = y + 0.5 - (py + oy * h);
            const d = dx * dx + dy * dy;
            if (d < best) {
              second = best;
              best = d;
              bi = i;
            } else if (d < second) second = d;
          }
      });
      id[y * w + x] = bi;
      d2[y * w + x] = Math.sqrt(second) - Math.sqrt(best);
    }
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = id[y * w + x]!;
      const right = id[y * w + ((x + 1) % w)]!, down = id[((y + 1) % h) * w + x]!;
      if (i !== right || i !== down) edge[y * w + x] = 1;
    }
  return { id, edge };
}

/** Animated strip: frames stacked vertically. */
export function strip(frames: Tex[]): Tex {
  const w = frames[0]!.w, h = frames[0]!.h;
  const t = new Tex(w, h * frames.length);
  frames.forEach((f, i) => t.over(f, 0, i * h));
  return t;
}

export function flipX(src: Tex): Tex {
  const t = new Tex(src.w, src.h);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) t.set(src.w - 1 - x, y, src.get(x, y));
  return t;
}

export function rotate90(src: Tex): Tex {
  const t = new Tex(src.h, src.w);
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) t.set(src.h - 1 - y, x, src.get(x, y));
  return t;
}

/**
 * Grainy pixel-art noise: mostly per-pixel variation with some 2×2 and 4×4 clumping,
 * which reads as the classic blocky texture look (rather than smooth blobs).
 */
export function grain(seed: number, w = [0.5, 0.32, 0.18], width = 16, height = 16): Float32Array {
  return fbm(seed, [16, 8, 4], w, width, height);
}

/** Map a 0..1 field onto a palette with top-left emboss and dithering. */
export function paint(field: Float32Array, palette: Palette, o: { emboss?: number; dither?: number; contrast?: number; bias?: number; seed?: number } = {}, w = 16, h = 16): Tex {
  const t = new Tex(w, h);
  const r = rng((o.seed ?? 1) ^ 0x51ed);
  const P = palette.length;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v0 = field[y * w + x]!;
      const v = (v0 - 0.5) * (o.contrast ?? 1) + 0.5 + (o.bias ?? 0);
      const br = field[((y + 1) % h) * w + ((x + 1) % w)]!;
      const em = (v0 - br) * (o.emboss ?? 0);
      const d = (r() - 0.5) * (o.dither ?? 0);
      const idx = Math.max(0, Math.min(P - 1, Math.round(v * (P - 1) + em + d)));
      t.set(x, y, palette[idx]!);
    }
  return t;
}
