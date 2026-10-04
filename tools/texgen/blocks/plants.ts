/**
 * Plants placed by world generation: saplings, ferns, tall grass, every flower, sugar cane,
 * dead bushes, berry bushes, lily pads, mushrooms (plants and huge-mushroom blocks), bamboo,
 * cocoa, sea pickles, corals, pumpkins, melons, bee nests, azaleas and lush-cave plants.
 * All original pixel art (palette + hand-placed pixels / seeded noise).
 */
import { Tex, pal, hex, rng, fbm, grid, shade, noiseTex, paint, grain, type Palette, type RGBA } from '../lib';
import type { TexDef } from '../registry';
import { WOODS, leaves } from './flora';

const STEM = pal('#2b5a14', '#3a7a1c', '#4f9a28', '#68b83a');
const GRAY4 = pal('#454545', '#5e5e5e', '#787878', '#929292', '#adadad');

// ------------------------------------------------------------------ generic plant helpers
/** A stem from (x, 15) up to row `top`, with a couple of leaves. */
function stemWithLeaves(t: Tex, x: number, top: number, seed: number, p: Palette = STEM): void {
  const r = rng(seed);
  for (let y = 15; y >= top; y--) t.set(x, y, p[1]!);
  const leafRows = [top + 3 + Math.floor(r() * 2), top + 6 + Math.floor(r() * 3)].filter((y) => y < 15);
  leafRows.forEach((y, i) => {
    const dir = i % 2 === 0 ? -1 : 1;
    t.set(x + dir, y, p[2]!);
    t.set(x + dir * 2, y - 1, p[3]!);
    t.set(x + dir, y + 1, p[0]!);
  });
}

/** Draw `rows` (grid strings) onto t at offset. */
function stamp(t: Tex, rows: string[], key: Record<string, string>, ox: number, oy: number): void {
  t.over(grid(rows, key), ox, oy);
}

function flower(head: string[], key: Record<string, string>, opts: { stemX?: number; headY?: number; headX?: number; seed: number; stemTop?: number }): Tex {
  const t = new Tex();
  const sx = opts.stemX ?? 7;
  const hy = opts.headY ?? 3;
  stemWithLeaves(t, sx, opts.stemTop ?? hy + head.length - 1, opts.seed);
  stamp(t, head, key, opts.headX ?? sx - Math.floor(head[0]!.length / 2), hy);
  return t;
}

// ------------------------------------------------------------------ saplings
function sapling(leaf: Palette, trunk: RGBA, seed: number, shape: 'round' | 'cone' | 'flat' | 'tall'): Tex {
  const t = new Tex();
  const r = rng(seed);
  for (let y = 15; y >= 9; y--) t.set(7 + (y < 12 ? 1 : 0), y, trunk);
  t.set(6, 13, trunk);
  const rows = shape === 'cone' ? [[7, 9], [6, 10], [6, 10], [5, 11], [4, 12], [5, 11], [3, 13]]
    : shape === 'flat' ? [[3, 13], [2, 14], [4, 12], [6, 10]]
    : shape === 'tall' ? [[6, 9], [5, 11], [4, 12], [4, 12], [5, 11], [3, 13], [4, 12], [6, 10]]
    : [[6, 10], [4, 12], [3, 13], [3, 13], [4, 12], [5, 11]];
  const y0 = shape === 'flat' ? 5 : 2;
  rows.forEach(([a, b], i) => {
    for (let x = a; x < b; x++) {
      if (r() < 0.18) continue;
      const lit = i < 2 || x < 7;
      t.set(x, y0 + i, leaf[Math.max(0, Math.min(leaf.length - 1, (lit ? 2 : 1) + Math.round(r() * 1.2 - 0.6)))]!);
    }
  });
  return t;
}

// ------------------------------------------------------------------ grasses
function fern(seed: number, tall = 0): Tex {
  // fronds: a central rib with leaflets angled up-outward, grayscale for grass tint
  const t = new Tex();
  const r = rng(seed);
  const fronds: [number, number, number][] = [[7, 2, 0], [4, 5, -1], [11, 4, 1], [2, 9, -1], [13, 8, 1]];
  for (const [x0, top, lean] of fronds) {
    let x = x0;
    for (let y = top - tall; y < 16; y++) {
      if (y < 0) continue;
      t.set(x, y, GRAY4[1]!);
      if ((y - top) % 2 === 0 && y < 14) {
        t.set(x - 1, y, GRAY4[3]!);
        t.set(x + 1, y, GRAY4[2]!);
        if (r() < 0.6) t.set(x - 2, y - 1, GRAY4[4]!);
        if (r() < 0.6) t.set(x + 2, y - 1, GRAY4[3]!);
      }
      if (lean && (y - top) % 4 === 3) x -= lean;
    }
  }
  return t;
}

function tallGrass(top: boolean, seed: number): Tex {
  const t = new Tex();
  const r = rng(seed);
  const xs = [1, 2, 4, 5, 6, 7, 9, 10, 11, 13, 14];
  for (const bx of xs) {
    const tone = GRAY4[1 + Math.floor(r() * 3)]!;
    const h = top ? 4 + Math.floor((1 - Math.abs(bx - 7.5) / 8) * 9 + r() * 3) : 16;
    const bend = bx < 7 ? -1 : bx > 8 ? 1 : 0;
    for (let i = 0; i < h; i++) {
      const y = 15 - i;
      const x = bx + (top && i >= h - 3 ? bend : 0);
      t.set(x, y, i > h - 3 ? shade(tone, 1.15) : tone);
    }
  }
  return t;
}

function largeFern(top: boolean, seed: number): Tex {
  if (!top) {
    const t = fern(seed, 0);
    // fill the lower half densely with ribs that continue upward
    for (const x of [3, 7, 12]) for (let y = 0; y < 16; y++) t.set(x + (y < 8 ? (x < 7 ? -1 : x > 7 ? 1 : 0) : 0), y, GRAY4[1]!);
    return t;
  }
  return fern(seed + 1, 0);
}

// ------------------------------------------------------------------ flowers
const FLOWERS: Record<string, () => Tex> = {
  blue_orchid: () => flower(['.b.b.', 'bBwBb', '.BBB.', 'b.B.b'], { b: '#1f6fd0', B: '#3aa3f0', w: '#c9ecff' }, { seed: 701, headY: 3 }),
  allium: () => flower(['.pPp.', 'pPLPp', 'PLPLP', 'pPLPp', '.pPp.'], { p: '#7a3aa8', P: '#a656d6', L: '#d6a0f4' }, { seed: 702, headY: 1 }),
  azure_bluet: () => {
    const t = new Tex();
    stemWithLeaves(t, 5, 6, 703);
    stemWithLeaves(t, 10, 8, 704);
    const key = { w: '#e8eef0', W: '#ffffff', y: '#e8d640' };
    stamp(t, ['.w.', 'wyW', '.W.'], key, 4, 5);
    stamp(t, ['.w.', 'Wyw', '.w.'], key, 9, 7);
    stamp(t, ['.W.', 'wyw', '.w.'], key, 6, 2);
    for (let y = 5; y < 9; y++) t.set(7, y, STEM[1]!);
    return t;
  },
  red_tulip: () => tulip('#a01818', '#d8302a', '#f06050', 705),
  orange_tulip: () => tulip('#b8520e', '#e6801c', '#ffb048', 706),
  white_tulip: () => tulip('#a8b0b0', '#dde4e4', '#ffffff', 707),
  pink_tulip: () => tulip('#c0608a', '#eb98bc', '#fcd0e2', 708),
  oxeye_daisy: () => flower(['.WwW.', 'WwYwW', 'wYyYw', 'WwYwW', '.WwW.'], { W: '#ffffff', w: '#d8dcdc', Y: '#f0c020', y: '#c08a10' }, { seed: 709, headY: 2 }),
  cornflower: () => flower(['b.B.b', '.BbB.', 'BbdbB', '.BbB.', 'b.B.b'], { b: '#2c4cc8', B: '#5a80f0', d: '#1a2470' }, { seed: 710, headY: 2 }),
  lily_of_the_valley: () => {
    const t = new Tex();
    // arching stalk with hanging white bells and two broad leaves
    for (let y = 15; y >= 4; y--) t.set(7, y, STEM[1]!);
    for (let x = 8; x <= 11; x++) t.set(x, 4 + (x - 8 >> 1), STEM[1]!);
    for (const [x, y] of [[8, 6], [10, 7], [12, 7], [6, 8]] as [number, number][]) {
      t.set(x, y, hex('#ffffff'));
      t.set(x, y + 1, hex('#dfe6e6'));
      t.set(x + 1, y + 1, hex('#c8d0d0'));
    }
    for (let y = 9; y < 16; y++) {
      t.set(5 - (y > 12 ? 1 : 0), y, STEM[2]!);
      t.set(9 + (y > 12 ? 1 : 0), y, STEM[2]!);
      t.set(4 - (y > 12 ? 1 : 0), y + 1, STEM[0]!);
    }
    return t;
  },
  wither_rose: () => flower(['.kKk.', 'kKrKk', 'KrKrK', '.kKk.'], { k: '#141414', K: '#2a2a2a', r: '#3c1a1a' }, { seed: 711, headY: 3 }),
};

function tulip(dark: string, mid: string, light: string, seed: number): Tex {
  return flower(['L.M.L', 'LMLMD', 'MMLMD', 'DMMMD', '.DMD.'], { D: dark, M: mid, L: light }, { seed, headY: 2 });
}

/** Tall flowers: bottom half (stalk + leaves) and top half (blooms). */
function tallFlower(name: string, half: 'top' | 'bottom', seed: number): Tex {
  const t = new Tex();
  const r = rng(seed);
  if (half === 'bottom') {
    for (const x of [6, 9]) for (let y = 0; y < 16; y++) t.set(x + (y > 10 ? (x === 6 ? -1 : 1) : 0), y, STEM[1]!);
    for (let k = 0; k < 6; k++) {
      const y = 2 + k * 2 + Math.floor(r() * 2), dir = k % 2 ? 1 : -1, x = dir < 0 ? 5 : 10;
      t.set(x + dir, y, STEM[2]!);
      t.set(x + dir * 2, y - 1, STEM[3]!);
      t.set(x + dir * 3, y - 2, STEM[2]!);
      t.set(x + dir, y + 1, STEM[0]!);
    }
    return t;
  }
  const blooms: Record<string, [string, string, string]> = {
    lilac: ['#8a4c9c', '#b67ac8', '#e0b4ec'],
    rose_bush: ['#8a0e18', '#c8202a', '#f04848'],
    peony: ['#b06a9a', '#e0a0c8', '#f8d4ea'],
  };
  for (const x of [6, 9]) for (let y = 8; y < 16; y++) t.set(x, y, STEM[1]!);
  const [d, m, l] = blooms[name]!.map((c) => hex(c));
  if (name === 'rose_bush') {
    // many leaves with several roses dotted among them
    for (let y = 3; y < 16; y++)
      for (let x = 2; x < 14; x++) {
        const dx = (x - 7.5) / 6, dy = (y - 9) / 6.5;
        if (dx * dx + dy * dy > 1 || r() < 0.2) continue;
        t.set(x, y, STEM[Math.floor(r() * 3)]!);
      }
    for (const [x, y] of [[4, 5], [9, 4], [7, 8], [11, 9], [4, 11], [9, 12]] as [number, number][]) {
      t.set(x, y, m); t.set(x + 1, y, l); t.set(x, y + 1, d); t.set(x + 1, y + 1, m);
    }
    return t;
  }
  // clustered florets forming a rounded/conical head
  for (let y = 1; y < 12; y++)
    for (let x = 2; x < 14; x++) {
      const w = name === 'lilac' ? 2 + y * 0.45 : 5.5;
      const dx = (x - 7.5) / w, dy = name === 'lilac' ? 0 : (y - 6) / 5.5;
      if (dx * dx + dy * dy > 1 || r() < 0.15) continue;
      const v = r();
      t.set(x, y, v < 0.3 ? d : v < 0.75 ? m : l);
    }
  return t;
}

function sunflower(part: 'bottom' | 'top' | 'front' | 'back'): Tex {
  const t = new Tex();
  if (part === 'bottom' || part === 'top') {
    for (let y = part === 'top' ? 8 : 0; y < 16; y++) t.set(7, y, STEM[1]!);
    if (part === 'bottom') {
      for (const [y, dir] of [[3, -1], [7, 1], [11, -1]] as [number, number][]) {
        for (let k = 1; k <= 4; k++) t.set(7 + dir * k, y - (k >> 1), STEM[k === 4 ? 3 : 2]!);
        t.set(7 + dir, y + 1, STEM[0]!);
      }
    } else {
      for (let k = 1; k <= 3; k++) t.set(7 - k, 12 - (k >> 1), STEM[2]!);
    }
    return t;
  }
  // flower head (front: petals + seeds, back: green backing with petal tips)
  const P = pal('#c08a10', '#ecbc20', '#ffe04a');
  const S = pal('#3a2410', '#5a3a18', '#7a5420');
  const r = rng(part === 'front' ? 721 : 722);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 7.6) continue;
      if (part === 'front') {
        if (d < 4.2) t.set(x, y, S[(x + y) % 3 === 0 ? 2 : Math.floor(r() * 2)]!);
        else if (d < 7.6 - ((Math.atan2(y - 7.5, x - 7.5) * 8 / Math.PI) % 1 < 0.35 ? 1.2 : 0)) t.set(x, y, P[x + y < 15 ? 2 : r() < 0.5 ? 1 : 0]!);
      } else {
        t.set(x, y, d < 6 ? STEM[1 + Math.floor(r() * 2)]! : P[1]!);
      }
    }
  return t;
}

// ------------------------------------------------------------------ misc plants
function sugarCane(): Tex {
  const t = new Tex();
  const p = pal('#5a5a5a', '#7e7e7e', '#a2a2a2', '#c4c4c4');
  for (const [x0, off] of [[3, 0], [8, 5], [12, 2]] as [number, number][]) {
    for (let y = 0; y < 16; y++) {
      const node = (y + off) % 7 === 0;
      t.set(x0, y, node ? p[3]! : p[2]!);
      t.set(x0 + 1, y, node ? p[2]! : p[1]!);
      if (node) t.set(x0 + 2, y, p[0]!);
    }
    t.set(x0 - 1, (off + 3) % 16, p[2]!);
    t.set(x0 - 2, (off + 2) % 16, p[3]!);
  }
  return t;
}

function deadBush(): Tex {
  const t = new Tex();
  const p = pal('#4a2e14', '#6b4520', '#8a5c2c', '#a8743a');
  const r = rng(731);
  const branch = (x: number, y: number, dx: number, len: number, depth: number) => {
    for (let i = 0; i < len; i++) {
      t.set(x, y, p[Math.min(3, depth + (i & 1))]!);
      y--;
      if (i % 2 === 1) x += dx;
      if (depth < 2 && i === Math.floor(len / 2)) branch(x, y, -dx, Math.max(2, len - 3), depth + 1);
    }
  };
  branch(7, 15, -1, 9, 0);
  branch(8, 15, 1, 10, 0);
  branch(7, 13, 0, 9, 1);
  for (let i = 0; i < 4; i++) t.set(2 + Math.floor(r() * 12), 2 + Math.floor(r() * 6), p[3]!);
  return t;
}

function berryBush(stage: number): Tex {
  const t = new Tex();
  const r = rng(740 + stage);
  const L = pal('#1e4a1a', '#2c6424', '#3c7e30', '#52983e');
  const h = [6, 11, 14, 15][stage]!;
  for (let y = 15; y > 15 - h; y--)
    for (let x = 1; x < 15; x++) {
      const dx = (x - 7.5) / (stage === 0 ? 4 : 7), dy = (y - (15 - h / 2)) / (h / 2 + 0.5);
      if (dx * dx + dy * dy > 1 || r() < 0.3) continue;
      t.set(x, y, L[Math.floor(r() * 4)]!);
    }
  if (stage >= 2) {
    const berry = stage === 3 ? pal('#7a0a14', '#c01c28', '#ff5a60') : pal('#3a5a1a', '#6a9a2a', '#a8d050');
    const n = stage === 3 ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const x = 3 + Math.floor(r() * 10), y = 16 - h + 2 + Math.floor(r() * (h - 4));
      t.set(x, y, berry[1]!); t.set(x + 1, y, berry[2]!); t.set(x, y + 1, berry[0]!); t.set(x + 1, y + 1, berry[1]!);
    }
  }
  return t;
}

function lilyPad(): Tex {
  // grayscale pad with a notch and veins (tinted green in world)
  const t = new Tex();
  const r = rng(751);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5, d = Math.hypot(dx, dy);
      if (d > 7.4) continue;
      const ang = Math.atan2(dy, dx);
      if (ang > 1.05 && ang < 1.45 && d > 1) continue; // notch toward the bottom
      let v = 2 + Math.round((r() - 0.5) * 1.2);
      if (d > 6.3) v = 1;
      if (Math.abs(dx) < 0.6 && dy < 0 || Math.abs(dx - dy) < 0.6 || Math.abs(dx + dy) < 0.6 && dy < 0) v = 4;
      t.set(x, y, GRAY4[Math.max(0, Math.min(4, v))]!);
    }
  return t;
}

function mushroomPlant(cap: Palette, spots: RGBA | null, seed: number): Tex {
  const t = new Tex();
  const r = rng(seed);
  const stem = pal('#b8ad98', '#d6ccb8', '#ece4d4');
  for (let y = 9; y < 16; y++) { t.set(7, y, stem[2]!); t.set(8, y, stem[1]!); }
  t.set(6, 15, stem[0]!); t.set(9, 15, stem[0]!);
  const rows: [number, number][] = spots ? [[6, 10], [5, 11], [4, 12], [4, 12]] : [[6, 10], [5, 11], [4, 12]];
  rows.forEach(([a, b], i) => {
    for (let x = a; x < b; x++) t.set(x, 5 + i + (spots ? 0 : 2), cap[x < 7 ? (i === 0 ? 3 : 2) : i === rows.length - 1 ? 0 : 1]!);
  });
  if (spots) for (const [x, y] of [[6, 6], [9, 7], [5, 8]] as [number, number][]) t.set(x, y, spots);
  r();
  return t;
}

function mushroomCap(base: Palette, seed: number, spotted: boolean): Tex {
  const t = paint(grain(seed, [0.5, 0.3, 0.2]), base, { emboss: 0.8, dither: 0.8, seed });
  if (spotted) {
    const r = rng(seed + 1);
    const spot = pal('#d8d0c8', '#f4eee8', '#ffffff');
    const pts: [number, number][] = [];
    while (pts.length < 6) {
      const x = Math.floor(r() * 14), y = Math.floor(r() * 14);
      if (pts.every(([a, b]) => Math.abs(a - x) + Math.abs(b - y) > 4)) pts.push([x, y]);
    }
    for (const [x, y] of pts) {
      t.set(x, y, spot[2]!); t.set(x + 1, y, spot[1]!); t.set(x, y + 1, spot[1]!); t.set(x + 1, y + 1, spot[0]!);
      if (r() < 0.5) t.set(x + 2, y + 1, spot[0]!);
    }
  }
  return t;
}

function mushroomStem(): Tex {
  const t = noiseTex(pal('#bcb3a1', '#cbc3b1', '#d8d1c1', '#e4dece', '#efeadc'), { seed: 761, octaves: [16, 4], weights: [0.3, 0.7], emboss: 1, dither: 0.8 });
  // vertical fibres
  for (const x of [2, 6, 11, 14]) for (let y = 0; y < 16; y++) if ((y + x) % 5 !== 0) t.set(x, y, shade(t.get(x, y), 0.9));
  return t;
}

function mushroomInside(): Tex {
  return noiseTex(pal('#c4ad8e', '#d0bb9c', '#dcc8aa', '#e6d4b8'), { seed: 762, octaves: [8, 16], weights: [0.5, 0.5], emboss: 0.6, dither: 1 });
}

// ------------------------------------------------------------------ bamboo
function bambooStalk(): Tex {
  // side strip in u 0..3 (all rows), top cap at u 13..16 v 0..3
  const t = new Tex();
  const p = pal('#3e6a10', '#5a8e1c', '#79b02a', '#9ccc44');
  for (let y = 0; y < 16; y++) {
    const node = y === 4 || y === 12;
    t.set(0, y, node ? p[0]! : p[3]!);
    t.set(1, y, node ? p[1]! : p[2]!);
    t.set(2, y, node ? p[0]! : p[1]!);
  }
  for (let y = 0; y < 3; y++) for (let x = 13; x < 16; x++) t.set(x, y, (x + y) % 2 ? p[2]! : p[1]!);
  t.set(14, 1, hex('#c8d878'));
  return t;
}

function bambooLeaves(large: boolean): Tex {
  const t = new Tex();
  const r = rng(large ? 772 : 771);
  const p = pal('#2e6410', '#3e8018', '#56a024', '#76bc34');
  const n = large ? 7 : 4;
  for (let k = 0; k < n; k++) {
    const x0 = 2 + Math.floor(r() * 12), y0 = 1 + Math.floor(r() * (large ? 12 : 9)), dir = r() < 0.5 ? -1 : 1;
    for (let i = 0; i < 5; i++) {
      const x = x0 + dir * i, y = y0 + (i >> 1);
      t.set(x, y, p[i < 2 ? 3 : 2]!);
      t.set(x, y + 1, p[1]!);
      if (i === 2) t.set(x, y - 1, p[2]!);
    }
  }
  return t;
}

function bambooSapling(): Tex {
  const t = new Tex();
  const p = pal('#3e6a10', '#5a8e1c', '#79b02a', '#9ccc44');
  for (let y = 8; y < 16; y++) t.set(7, y, p[2]!);
  for (const [x, y] of [[6, 8], [5, 7], [4, 7], [8, 9], [9, 8], [10, 8], [11, 7], [6, 11], [5, 10]] as [number, number][]) t.set(x, y, p[3]!);
  return t;
}

// ------------------------------------------------------------------ cocoa
/** Cocoa pod stage: side at uv (0,0,w,h), top at (16-w,0,16,w), stem plane at (12,12,16,16). */
function cocoa(stage: number): Tex {
  const t = new Tex();
  const w = [4, 6, 8][stage]!, h = [5, 7, 9][stage]!;
  const P = stage === 0 ? pal('#4c6a14', '#6a8a20', '#8aa832', '#a8c44a') : stage === 1 ? pal('#7a5414', '#a07020', '#c08c30', '#d8a848') : pal('#5a2c10', '#7c3e18', '#9a5224', '#b86a32');
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === h - 1;
      const ridge = x % 2 === 0 && y > 0 && y < h - 1;
      t.set(x, y, edge ? P[0]! : ridge ? P[3]! : P[1 + ((x + y) & 1)]!);
    }
  for (let y = 0; y < w; y++)
    for (let x = 16 - w; x < 16; x++) {
      const edge = x === 16 - w || y === w - 1 || x === 15 || y === 0;
      t.set(x, y, edge ? P[1]! : P[2]!);
    }
  t.set(16 - w / 2 - 1, w / 2 - 1, P[3]!);
  // stem (attached to the log): a short brown/green stalk
  for (let i = 0; i < 4; i++) { t.set(12 + i, 12 + (i >> 1), P[1]!); t.set(12 + i, 13 + (i >> 1), P[0]!); }
  return t;
}

// ------------------------------------------------------------------ sea pickles
/** Sea pickle: side at uv (0,0,4,7), top at (4,0,8,4), crown leaves at (8,0,12,4). */
function seaPickle(dead: boolean): Tex {
  const t = new Tex();
  const P = dead ? pal('#4a4a2a', '#5e5e36', '#727242', '#86864e') : pal('#3e5a14', '#587a20', '#729a30', '#94bc46');
  for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) t.set(x, y, P[x === 0 ? 3 : x === 3 ? 0 : (y & 1) ? 1 : 2]!);
  for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) t.set(x, y, P[(x === 4 || y === 0) ? 3 : 2]!);
  if (!dead) {
    t.set(5, 1, hex('#e8ffa0'));
    t.set(6, 2, hex('#c8f070'));
    for (const [x, y] of [[8, 3], [9, 2], [9, 1], [10, 3], [11, 2], [11, 0]] as [number, number][]) t.set(x, y, P[3]!);
  }
  return t;
}

// ------------------------------------------------------------------ corals
const CORALS: Record<string, [string, string, string, string]> = {
  tube: ['#1c2f9c', '#2e4ac8', '#4766e6', '#7a96ff'],
  brain: ['#a03c78', '#c85a96', '#e27cb2', '#f8a8d0'],
  bubble: ['#7a1c8c', '#a02cb0', '#c048d0', '#de7cec'],
  fire: ['#8a1414', '#b82424', '#d83a32', '#f4685a'],
  horn: ['#9c8a14', '#c8b024', '#e0c836', '#f4e070'],
};
const DEAD = pal('#6a645e', '#827c76', '#99938c', '#b0aaa2');

function coralBlock(p: Palette, seed: number): Tex {
  const t = paint(grain(seed, [0.45, 0.35, 0.2]), p, { emboss: 1.4, dither: 0.8, seed });
  const r = rng(seed + 3);
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    t.set(x, y, p[0]!);
    t.set(x + 1, y + 1, p[3]!);
  }
  return t;
}

function coralPlant(kind: string, p: Palette, seed: number): Tex {
  const t = new Tex();
  const r = rng(seed);
  if (kind === 'tube') {
    for (const [x, top] of [[3, 5], [6, 2], [9, 4], [12, 6]] as [number, number][]) {
      for (let y = top; y < 16; y++) { t.set(x, y, p[1]!); t.set(x + 1, y, p[2]!); }
      t.set(x, top, p[3]!); t.set(x + 1, top, p[0]!);
    }
  } else if (kind === 'brain') {
    for (let y = 4; y < 16; y++)
      for (let x = 2; x < 14; x++) {
        const dx = (x - 7.5) / 6, dy = (y - 10) / 6.5;
        if (dx * dx + dy * dy > 1) continue;
        t.set(x, y, p[((x * 3 + y * 5) >> 2) % 3 + (r() < 0.2 ? 1 : 0)]!);
      }
  } else if (kind === 'bubble') {
    for (const [x, y] of [[3, 3], [9, 2], [6, 6], [11, 7], [3, 9], [8, 10]] as [number, number][]) {
      t.set(x, y, p[3]!); t.set(x + 1, y, p[2]!); t.set(x, y + 1, p[2]!); t.set(x + 1, y + 1, p[0]!);
      for (let yy = y + 2; yy < 16; yy++) if ((yy + x) % 3) t.set(x + ((yy >> 2) & 1), yy, p[1]!);
    }
  } else {
    // branching (fire: thin flame-like, horn: broad antlers)
    const w = kind === 'horn' ? 2 : 1;
    const grow = (x: number, y: number, dx: number, len: number, d: number) => {
      for (let i = 0; i < len && y >= 0; i++) {
        for (let k = 0; k < w; k++) t.set(x + k, y, p[Math.min(3, 1 + d)]!);
        y--;
        if (i % 3 === 2) x += dx;
        if (d < 2 && i === 2) grow(x, y, -dx, len - 3, d + 1);
      }
    };
    grow(7, 15, -1, 12, 0);
    grow(8, 15, 1, 11, 0);
  }
  return t;
}

function coralFan(p: Palette, seed: number): Tex {
  const t = new Tex();
  const r = rng(seed);
  // a fan radiating from the bottom-centre: ribs with webbing
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = 16 - y;
      const d = Math.hypot(dx, dy);
      if (d > 15.5 || d < 1) continue;
      const a = Math.atan2(dx, dy);
      const rib = Math.abs(((a * 7) % 1 + 1) % 1 - 0.5) < 0.14;
      if (!rib && r() < 0.3) continue;
      t.set(x, y, rib ? p[3]! : p[d > 12 ? 2 : 1]!);
    }
  return t;
}

// ------------------------------------------------------------------ pumpkins & melons
const PUMPKIN = pal('#8a4a08', '#b8660c', '#d47e14', '#e8962a', '#f4ae48');
function pumpkinSide(face: 'plain' | 'carved' | 'lit'): Tex {
  const t = new Tex();
  const r = rng(781);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const groove = x % 4 === 0;
      const lit = x % 4 === 1;
      let v = groove ? 0 : lit ? 4 : 2 + Math.round(r() - 0.5);
      if (y === 0 || y === 15) v = Math.max(0, v - 1);
      t.set(x, y, PUMPKIN[v]!);
    }
  if (face !== 'plain') {
    const hole = face === 'lit' ? pal('#f8d030', '#ffe878') : pal('#2a1404', '#3e1e08');
    const rows = ['................', '................', '................', '................', '...XX......XX...', '...XXX....XXX...', '................', '.......XX.......',
      '................', '..X..........X..', '..XXXXXXXXXXXX..', '...XXX.XX.XXX...', '....XXXXXXXX....', '................', '................', '................'];
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') t.set(x, y, hole[(x + y) % 3 === 0 ? 1 : 0]!); }));
  }
  return t;
}
function pumpkinTop(): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const a = Math.atan2(y - 7.5, x - 7.5);
      const groove = Math.abs(((a * 4 / Math.PI) % 1 + 1) % 1 - 0.5) > 0.42;
      t.set(x, y, PUMPKIN[groove ? 1 : d > 6 ? 2 : 3]!);
    }
  for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8]] as [number, number][]) t.set(x, y, hex('#5a6a20'));
  t.set(8, 6, hex('#7a8a2a'));
  return t;
}
const MELON = pal('#3a6010', '#4e7c16', '#66981e', '#82b42c', '#a2cc44');
function melonSide(): Tex {
  const t = new Tex();
  const r = rng(791);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const stripe = ((x + (y >> 2)) % 5) < 2;
      t.set(x, y, MELON[stripe ? 3 + (r() < 0.4 ? 1 : 0) : 1 + (r() < 0.4 ? -1 : 0)]!);
    }
  return t;
}
function melonTop(): Tex {
  const t = new Tex();
  const r = rng(792);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const a = Math.atan2(y - 7.5, x - 7.5);
      const stripe = Math.abs(((a * 5 / Math.PI) % 1 + 1) % 1 - 0.5) < 0.2;
      t.set(x, y, MELON[stripe ? 3 : 1 + (r() < 0.3 ? 1 : 0)]!);
    }
  t.set(7, 7, hex('#6a5020')); t.set(8, 8, hex('#4a3410'));
  return t;
}

// ------------------------------------------------------------------ bee nest
const NEST = pal('#8a6420', '#b08430', '#cca040', '#e2bc58', '#f0d070');
function beeNestSide(): Tex {
  const t = new Tex();
  const r = rng(801);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const band = y % 4 === 3;
      t.set(x, y, NEST[band ? 0 : y % 4 === 0 ? 3 : 2 - (r() < 0.25 ? 1 : 0)]!);
    }
  return t;
}
function beeNestFront(honey: boolean): Tex {
  const t = beeNestSide();
  for (let y = 7; y < 12; y++) for (let x = 5; x < 11; x++) t.set(x, y, (x === 5 || y === 7) ? hex('#2a1806') : hex('#1a0e04'));
  if (honey) for (const [x, y] of [[5, 12], [6, 12], [6, 13], [9, 12], [10, 12], [10, 13], [10, 14]] as [number, number][]) t.set(x, y, hex(y > 12 ? '#f0a020' : '#ffc040'));
  return t;
}
function beeNestTop(bottom: boolean): Tex {
  const t = paint(grain(bottom ? 803 : 802, [0.5, 0.3, 0.2]), NEST.slice(bottom ? 0 : 1, bottom ? 4 : 5), { emboss: 0.8, dither: 0.6, seed: 802 });
  // honeycomb cells
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((y % 4 === 0 && (x + (y >> 2) * 2) % 4 !== 0) || ((x + ((y >> 2) & 1) * 2) % 4 === 0 && y % 4 !== 0)) t.set(x, y, NEST[bottom ? 0 : 1]!);
  return t;
}

// ------------------------------------------------------------------ azalea & lush caves
const AZ = pal('#3a5a1a', '#4c7222', '#5e8a2a', '#76a438', '#90bc4a');
const PINK = pal('#a8487c', '#cc68a0', '#ec94c4');
function azaleaLeaves(flowering: boolean, seed: number): Tex {
  const t = leaves(seed, 0.8, AZ);
  if (flowering) {
    const r = rng(seed + 9);
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
      t.set(x, y, PINK[2]!); t.set(x + 1, y, PINK[1]!); t.set(x, y + 1, PINK[1]!); t.set(x + 1, y + 1, PINK[0]!);
    }
  }
  return t;
}
function azaleaTop(flowering: boolean): Tex {
  return opaqueFill(azaleaLeaves(flowering, flowering ? 812 : 811), AZ[1]!);
}
function opaqueFill(t: Tex, c: RGBA): Tex {
  return t.map((p) => (p[3] < 128 ? c : p));
}
function azaleaSide(flowering: boolean): Tex {
  const t = new Tex();
  const top = azaleaLeaves(flowering, flowering ? 814 : 813);
  const r = rng(815);
  for (let x = 0; x < 16; x++) {
    const h = 5 + Math.floor(r() * 4);
    for (let y = 0; y < h; y++) t.set(x, y, y < h - 1 ? opaqueFill(top, AZ[1]!).get(x, y) : AZ[0]!);
  }
  // twigs
  const twig = pal('#4a3a20', '#6a5430');
  for (const x of [3, 8, 12]) for (let y = 7; y < 16; y++) t.set(x + (y > 11 ? (x < 8 ? 1 : -1) : 0), y, twig[(y & 1)]!);
  return t;
}
function azaleaPlant(): Tex {
  const t = new Tex();
  const twig = pal('#4a3a20', '#6a5430', '#806a40');
  for (let y = 4; y < 16; y++) t.set(7 + (y < 9 ? 1 : 0), y, twig[1]!);
  for (const [x0, y0, dx] of [[7, 10, -1], [8, 8, 1], [7, 6, -1]] as [number, number, number][]) for (let i = 0; i < 4; i++) t.set(x0 + dx * i, y0 - (i >> 1), twig[i & 1 ? 2 : 0]!);
  return t;
}

function caveVines(lit: boolean, plant: boolean): Tex {
  const t = new Tex();
  const r = rng(plant ? 821 : 822);
  const L = pal('#2c5014', '#3c6a1c', '#508626', '#68a034');
  for (const x0 of [5, 9]) {
    let x = x0;
    for (let y = 0; y < (plant ? 16 : 13); y++) {
      t.set(x, y, L[1]!);
      if (r() < 0.35) { t.set(x + 1, y, L[3]!); t.set(x + 2, y + 1, L[2]!); }
      if (r() < 0.35) { t.set(x - 1, y, L[2]!); t.set(x - 2, y + 1, L[0]!); }
      if (r() < 0.2) x += r() < 0.5 ? -1 : 1;
    }
  }
  if (lit) {
    const B = pal('#c8701a', '#f4a028', '#ffd060');
    for (const [x, y] of plant ? [[4, 4], [10, 10]] : [[5, 11], [9, 8]] as [number, number][]) {
      t.set(x, y, B[2]!); t.set(x + 1, y, B[1]!); t.set(x, y + 1, B[1]!); t.set(x + 1, y + 1, B[0]!);
    }
  }
  return t;
}

function sporeBlossom(): Tex {
  const t = new Tex();
  const P = pal('#9c3e82', '#c45ca6', '#e68cc8', '#f8b8e2');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const a = Math.atan2(y - 7.5, x - 7.5);
      const petal = Math.abs(((a * 3 / Math.PI) % 1 + 1) % 1 - 0.5) < 0.3;
      if (d < 2) t.set(x, y, hex('#d8e050'));
      else if (d < (petal ? 7.6 : 4.5)) t.set(x, y, P[d < 4 ? 3 : petal && d > 6 ? 0 : 1 + ((x + y) & 1)]!);
    }
  return t;
}
function sporeBlossomBase(): Tex {
  const t = new Tex();
  const L = pal('#2c5014', '#3c6a1c', '#508626', '#68a034');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 7 && d > 3 && ((x * 7 + y * 3) % 4) !== 0) t.set(x, y, L[(x + y) % 4]!);
  }
  return t;
}

function hangingRoots(): Tex {
  const t = new Tex();
  const p = pal('#6a4a30', '#8a6644', '#a8825a');
  const r = rng(831);
  for (const x0 of [3, 6, 8, 11, 13]) {
    let x = x0;
    const len = 6 + Math.floor(r() * 9);
    for (let y = 0; y < len; y++) {
      t.set(x, y, p[y === len - 1 ? 2 : (y & 1)]!);
      if (r() < 0.25) x += r() < 0.5 ? -1 : 1;
    }
  }
  return t;
}

function dripleafTop(): Tex {
  const t = new Tex();
  const L = pal('#3e6a18', '#548a22', '#6caa30', '#88c444');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      if (Math.abs(dx) + Math.abs(dy) * 0.7 > 10.5) continue;
      const vein = Math.abs(dx) < 0.6 || Math.abs(Math.abs(dx) - Math.abs(dy) * 0.8 - 2) < 0.5;
      t.set(x, y, L[vein ? 3 : x < 8 && y < 8 ? 2 : 1]!);
    }
  return t;
}
function dripleafSide(): Tex {
  const t = new Tex();
  const L = pal('#3e6a18', '#548a22', '#6caa30');
  for (let x = 0; x < 16; x++) { t.set(x, 15, L[0]!); t.set(x, 14, L[1]!); }
  return t;
}
function dripleafStem(): Tex {
  const t = new Tex();
  const L = pal('#3e6a18', '#548a22', '#6caa30');
  for (let y = 0; y < 16; y++) { t.set(7, y, L[1]!); t.set(8, y, L[2]!); if (y % 5 === 2) t.set(6, y, L[0]!); }
  return t;
}

// ------------------------------------------------------------------ registry
const SAPLINGS: Record<string, [Palette, RGBA, 'round' | 'cone' | 'flat' | 'tall']> = {
  oak: [pal('#2c5a14', '#3c7a1c', '#52982a', '#6ab03a'), hex('#5e4626'), 'round'],
  spruce: [pal('#1e3e22', '#2c5430', '#3c6a40', '#4e8050'), hex('#3a2815'), 'cone'],
  birch: [pal('#3e6a1e', '#548a28', '#6ca634', '#88c044'), hex('#d6d6d0'), 'round'],
  jungle: [pal('#1e5a10', '#2c7818', '#3e9822', '#58b030'), hex('#59451b'), 'tall'],
  acacia: [pal('#4a6a14', '#5e8a1a', '#76a424', '#90bc30'), hex('#6a655d'), 'flat'],
  dark_oak: [pal('#1c4010', '#285818', '#387020', '#4a882a'), hex('#382b17'), 'round'],
};

function strippedSide(w: (typeof WOODS)[string], seed: number): Tex {
  const t = new Tex();
  const n = fbm(seed, [2, 16], [0.4, 0.6]);
  const r = rng(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const streak = (x * 5 + Math.floor(n[y * 16 + x]! * 4)) % 7 === 0;
    t.set(x, y, w.plank[streak ? 1 : 2 + Math.round(n[y * 16 + x]! + (r() - 0.5) * 0.6)]!);
  }
  return t;
}
function strippedTop(w: (typeof WOODS)[string]): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    t.set(x, y, d > 7 ? w.plank[1]! : w.plank[Math.floor(d) % 3 === 0 ? 2 : 3]!);
  }
  return t;
}

export const plantTextures: TexDef[] = [
  ...Object.entries(SAPLINGS).map(([n, [leaf, trunk, shape]], i): TexDef => ({ name: `${n}_sapling`, make: () => sapling(leaf, trunk, 690 + i, shape), cutout: true })),
  ...Object.entries(WOODS).flatMap(([n, w], i): TexDef[] => {
    const log = n === 'crimson' || n === 'warped' ? `stripped_${n}_stem` : `stripped_${n}_log`;
    return [{ name: log, make: () => strippedSide(w, 850 + i) }, { name: `${log}_top`, make: () => strippedTop(w) }];
  }),
  { name: 'fern', make: () => fern(705), tint: 'grass', cutout: true },
  { name: 'tall_grass_bottom', make: () => tallGrass(false, 711), tint: 'grass', cutout: true },
  { name: 'tall_grass_top', make: () => tallGrass(true, 712), tint: 'grass', cutout: true },
  { name: 'large_fern_bottom', make: () => largeFern(false, 713), tint: 'grass', cutout: true },
  { name: 'large_fern_top', make: () => largeFern(true, 714), tint: 'grass', cutout: true },
  ...Object.entries(FLOWERS).map(([n, f]): TexDef => ({ name: n, make: f, cutout: true })),
  ...['lilac', 'rose_bush', 'peony'].flatMap((n, i): TexDef[] => [
    { name: `${n}_bottom`, make: () => tallFlower(n, 'bottom', 720 + i * 2), cutout: true },
    { name: `${n}_top`, make: () => tallFlower(n, 'top', 721 + i * 2), cutout: true },
  ]),
  { name: 'sunflower_bottom', make: () => sunflower('bottom'), cutout: true },
  { name: 'sunflower_top', make: () => sunflower('top'), cutout: true },
  { name: 'sunflower_front', make: () => sunflower('front'), cutout: true },
  { name: 'sunflower_back', make: () => sunflower('back'), cutout: true },
  { name: 'sugar_cane', make: sugarCane, tint: 'grass', cutout: true },
  { name: 'dead_bush', make: deadBush, cutout: true },
  ...[0, 1, 2, 3].map((s): TexDef => ({ name: `sweet_berry_bush_stage${s}`, make: () => berryBush(s), cutout: true })),
  { name: 'lily_pad', make: lilyPad, cutout: true },
  { name: 'brown_mushroom', make: () => mushroomPlant(pal('#6a4a30', '#8a6444', '#a07a56', '#b8926a'), null, 741), cutout: true },
  { name: 'red_mushroom', make: () => mushroomPlant(pal('#8a1010', '#b81c1c', '#d83030', '#f05050'), hex('#f4f0e8'), 742), cutout: true },
  { name: 'brown_mushroom_block', make: () => mushroomCap(pal('#6e4e34', '#7c5a3e', '#8a6648', '#987252', '#a67e5c'), 751, false) },
  { name: 'red_mushroom_block', make: () => mushroomCap(pal('#901414', '#a81a1a', '#be2020', '#d02828', '#de3434'), 752, true) },
  { name: 'mushroom_stem', make: mushroomStem },
  { name: 'mushroom_block_inside', make: mushroomInside },
  { name: 'bamboo_stalk', make: bambooStalk, cutout: true },
  { name: 'bamboo_small_leaves', make: () => bambooLeaves(false), cutout: true },
  { name: 'bamboo_large_leaves', make: () => bambooLeaves(true), cutout: true },
  { name: 'bamboo_stage0', make: bambooSapling, cutout: true },
  ...[0, 1, 2].map((s): TexDef => ({ name: `cocoa_stage${s}`, make: () => cocoa(s), cutout: true })),
  { name: 'sea_pickle', make: () => seaPickle(false), cutout: true },
  { name: 'dead_sea_pickle', make: () => seaPickle(true), cutout: true },
  ...Object.entries(CORALS).flatMap(([n, cs], i): TexDef[] => {
    const p = cs.map((c) => hex(c));
    return [
      { name: `${n}_coral_block`, make: () => coralBlock(p, 760 + i * 4) },
      { name: `dead_${n}_coral_block`, make: () => coralBlock(DEAD, 761 + i * 4) },
      { name: `${n}_coral`, make: () => coralPlant(n, p, 762 + i * 4), cutout: true },
      { name: `dead_${n}_coral`, make: () => coralPlant(n, DEAD, 762 + i * 4), cutout: true },
      { name: `${n}_coral_fan`, make: () => coralFan(p, 763 + i * 4), cutout: true },
      { name: `dead_${n}_coral_fan`, make: () => coralFan(DEAD, 763 + i * 4), cutout: true },
    ];
  }),
  { name: 'pumpkin_side', make: () => pumpkinSide('plain') },
  { name: 'pumpkin_top', make: pumpkinTop },
  { name: 'carved_pumpkin', make: () => pumpkinSide('carved') },
  { name: 'jack_o_lantern', make: () => pumpkinSide('lit') },
  { name: 'melon_side', make: melonSide },
  { name: 'melon_top', make: melonTop },
  { name: 'bee_nest_side', make: beeNestSide },
  { name: 'bee_nest_front', make: () => beeNestFront(false) },
  { name: 'bee_nest_front_honey', make: () => beeNestFront(true) },
  { name: 'bee_nest_top', make: () => beeNestTop(false) },
  { name: 'bee_nest_bottom', make: () => beeNestTop(true) },
  { name: 'azalea_leaves', make: () => azaleaLeaves(false, 816), cutout: true },
  { name: 'flowering_azalea_leaves', make: () => azaleaLeaves(true, 817), cutout: true },
  { name: 'azalea_top', make: () => azaleaTop(false), cutout: true },
  { name: 'flowering_azalea_top', make: () => azaleaTop(true), cutout: true },
  { name: 'azalea_side', make: () => azaleaSide(false), cutout: true },
  { name: 'flowering_azalea_side', make: () => azaleaSide(true), cutout: true },
  { name: 'azalea_plant', make: azaleaPlant, cutout: true },
  { name: 'cave_vines', make: () => caveVines(false, false), cutout: true },
  { name: 'cave_vines_lit', make: () => caveVines(true, false), cutout: true },
  { name: 'cave_vines_plant', make: () => caveVines(false, true), cutout: true },
  { name: 'cave_vines_plant_lit', make: () => caveVines(true, true), cutout: true },
  { name: 'spore_blossom', make: sporeBlossom, cutout: true },
  { name: 'spore_blossom_base', make: sporeBlossomBase, cutout: true },
  { name: 'hanging_roots', make: hangingRoots, cutout: true },
  { name: 'big_dripleaf_top', make: dripleafTop, cutout: true },
  { name: 'big_dripleaf_side', make: dripleafSide, cutout: true },
  { name: 'big_dripleaf_stem', make: dripleafStem, cutout: true },
  { name: 'small_dripleaf_top', make: dripleafTop, cutout: true },
  { name: 'small_dripleaf_stem', make: dripleafStem, cutout: true },
];
