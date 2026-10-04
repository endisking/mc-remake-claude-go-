/**
 * Ground and cave blocks placed by world generation: podzol, mycelium, ices, terracotta,
 * sandstones, the 1.17 cave set (amethyst, calcite, tuff, smooth basalt, dripstone, glow
 * lichen, moss, rooted dirt), stone variants, obsidian, spawner, chest, Nether and End
 * terrain. All original pixel art.
 */
import { Tex, pal, hex, rng, fbm, shade, mix, noiseTex, paint, grain, ore, cells, type Palette, type RGBA } from '../lib';
import type { TexDef } from '../registry';
import { dirt, stone, ORE_COLORS } from './terrain';
import { WOODS, planks } from './flora';

// ------------------------------------------------------------------ soils
function podzolTop(): Tex {
  const t = paint(grain(1001, [0.5, 0.3, 0.2]), pal('#3e2a12', '#4e3618', '#5e421e', '#6e5026', '#7c5c30'), { emboss: 1, dither: 1, seed: 1001 });
  // needle litter: short diagonal strokes
  const r = rng(1002);
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    const c = r() < 0.5 ? hex('#8a6a34') : hex('#2e1e0c');
    t.set(x, y, c);
    t.set(x + 1, y + (r() < 0.5 ? 1 : 0), c);
  }
  return t;
}
function sideWithTop(top: Tex, seed: number, minLen = 2, extra = 3): Tex {
  const t = dirt();
  const r = rng(seed);
  for (let x = 0; x < 16; x++) {
    const len = minLen + Math.floor(r() * extra);
    for (let y = 0; y < len; y++) t.set(x, y, y === len - 1 ? shade(top.get(x, y), 0.8) : top.get(x, y));
  }
  return t;
}
function myceliumTop(): Tex {
  const t = paint(grain(1011, [0.5, 0.3, 0.2]), pal('#574b54', '#645761', '#71636d', '#7e6f79', '#8b7b85'), { emboss: 1, dither: 1.2, seed: 1011 });
  const r = rng(1012);
  for (let i = 0; i < 12; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), r() < 0.5 ? hex('#b4a4b0') : hex('#9a7a9a'));
  return t;
}
function rootedDirt(): Tex {
  const t = dirt();
  const p = pal('#8a6644', '#a8825a');
  const r = rng(1021);
  for (let k = 0; k < 5; k++) {
    let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    for (let i = 0; i < 5; i++) {
      t.set(x, y, p[i & 1]!);
      x += r() < 0.5 ? 1 : -1;
      y += r() < 0.6 ? 1 : 0;
    }
  }
  return t;
}
function moss(seed: number): Tex {
  const t = paint(grain(seed, [0.45, 0.35, 0.2]), pal('#3a5a1c', '#4a6e22', '#5a822a', '#6c9634', '#80aa40'), { emboss: 1.2, dither: 1, seed });
  return t;
}

// ------------------------------------------------------------------ ice
function packedIce(): Tex {
  const t = noiseTex(pal('#6e96d8', '#7ea4e0', '#8eb2e6', '#a0c0ec', '#b4d0f2'), { seed: 1031, octaves: [2, 4, 8], weights: [0.5, 0.3, 0.2], emboss: 1.6, dither: 0.6 });
  const r = rng(1032);
  for (let k = 0; k < 4; k++) {
    let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    for (let i = 0; i < 6; i++) { t.set(x, y, hex('#d8e8ff')); x += r() < 0.5 ? 1 : -1; y += r() < 0.7 ? 1 : 0; }
  }
  return t;
}
function blueIce(): Tex {
  const t = noiseTex(pal('#3a72d8', '#4682e2', '#5492ea', '#64a2f0', '#7ab4f6'), { seed: 1041, octaves: [2, 4, 8], weights: [0.5, 0.3, 0.2], emboss: 1.8, dither: 0.5 });
  const r = rng(1042);
  for (let k = 0; k < 5; k++) {
    let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    for (let i = 0; i < 5; i++) { t.set(x, y, hex('#b8dcff')); x += 1; y += r() < 0.5 ? 1 : -1; }
  }
  return t;
}

// ------------------------------------------------------------------ terracotta
const TERRACOTTA: Record<string, string> = {
  terracotta: '#985e43', white: '#d1b2a1', orange: '#a15325', magenta: '#95576c', light_blue: '#706c8a', yellow: '#ba8523',
  lime: '#677534', pink: '#a14e4e', gray: '#392a23', light_gray: '#876a61', cyan: '#565a5a', purple: '#764656',
  blue: '#4a3b5b', brown: '#4d3323', green: '#4b522a', red: '#8f3d2e', black: '#251610',
};
function terracotta(base: string, seed: number): Tex {
  const b = hex(base);
  const p: Palette = [shade(b, 0.86), shade(b, 0.93), b, shade(b, 1.06), shade(b, 1.12)].map((c) => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), 255] as RGBA);
  return paint(grain(seed, [0.55, 0.3, 0.15]), p, { emboss: 0.5, contrast: 0.9, dither: 0.9, seed });
}

// ------------------------------------------------------------------ sandstone
const SANDSTONE = pal('#b8a46c', '#c8b47a', '#d4c088', '#dccb94', '#e6d6a2');
const RED_SANDSTONE = pal('#8c4618', '#a0521e', '#b05e24', '#be6a2c', '#ca7636');
function sandstoneSide(p: Palette, seed: number): Tex {
  const t = paint(grain(seed, [0.6, 0.3, 0.1]), p.slice(1, 5), { emboss: 0.6, dither: 0.8, seed });
  // horizontal strata: a lit top band and a darker base band
  for (let x = 0; x < 16; x++) {
    for (const y of [0, 1, 2]) t.set(x, y, p[y === 2 ? 1 : 4 - y]!);
    t.set(x, 11, p[1]!);
    t.set(x, 14, p[0]!);
    t.set(x, 15, p[1]!);
  }
  return t;
}
function sandstoneTop(p: Palette, seed: number): Tex {
  return paint(grain(seed, [0.6, 0.3, 0.1]), p.slice(1, 5), { emboss: 0.6, dither: 0.8, seed });
}
function sandstoneBottom(p: Palette, seed: number): Tex {
  const t = sandstoneTop(p, seed);
  const r = rng(seed + 1);
  for (let i = 0; i < 10; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), p[0]!);
  return t;
}
function cutSandstone(p: Palette, seed: number): Tex {
  const t = sandstoneTop(p, seed);
  for (let i = 0; i < 16; i++) { t.set(i, 0, p[4]!); t.set(0, i, p[4]!); t.set(i, 15, p[0]!); t.set(15, i, p[0]!); t.set(i, 7, p[1]!); }
  return t;
}
function chiseledSandstone(p: Palette, seed: number): Tex {
  const t = cutSandstone(p, seed);
  // carved glyph: an original stepped diamond motif
  const g = ['......XX......', '.....X..X.....', '....X.XX.X....', '...X.X..X.X...', '....X.XX.X....', '.....X..X.....', '......XX......'];
  g.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'X') { t.set(x + 1, y + 4, p[0]!); t.set(x + 2, y + 5, p[4]!); } }));
  return t;
}

// ------------------------------------------------------------------ 1.17 cave blocks
const AMETHYST = pal('#4e2a7e', '#64389c', '#7c4cb8', '#9a68d2', '#b88ce6', '#dcc0f8');
function amethystBlock(budding: boolean): Tex {
  const c = cells(budding ? 1102 : 1101, 9);
  const r = rng(budding ? 1104 : 1103);
  const t = new Tex();
  const tone = new Map<number, number>();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const id = c.id[y * 16 + x]!;
      if (!tone.has(id)) tone.set(id, 1 + Math.floor(r() * 3));
      const up = c.id[((y + 15) % 16) * 16 + x] !== id || c.id[y * 16 + ((x + 15) % 16)] !== id;
      t.set(x, y, AMETHYST[c.edge[y * 16 + x] ? 0 : up ? 5 : tone.get(id)!]!);
    }
  if (budding) for (const [x, y] of [[4, 4], [11, 3], [7, 9], [3, 12], [12, 12]] as [number, number][]) {
    t.set(x, y, hex('#2a1444')); t.set(x + 1, y, hex('#3a1e5c')); t.set(x, y + 1, hex('#3a1e5c'));
  }
  return t;
}
/** Amethyst growth stages drawn as crystals rising from the bottom of the texture. */
function amethystBud(size: number): Tex {
  const t = new Tex();
  const r = rng(1110 + size);
  const shards: [number, number][] = size === 0 ? [[7, 3], [9, 2]] : size === 1 ? [[5, 3], [8, 5], [10, 3]] : size === 2 ? [[4, 5], [7, 8], [10, 6], [12, 4]] : [[3, 7], [5, 11], [8, 14], [11, 10], [13, 6]];
  for (const [x, h] of shards) {
    const w = size >= 2 ? 2 : 1;
    for (let i = 0; i < h; i++) {
      const y = 15 - i;
      for (let k = 0; k < w; k++) t.set(x + k, y, AMETHYST[k === 0 ? 4 : 2 + (i & 1)]!);
      if (i === h - 1) t.set(x, y, AMETHYST[5]!);
    }
    if (size > 0) t.set(x - 1, 15, AMETHYST[1]!);
  }
  r();
  return t;
}
function calcite(): Tex {
  const t = noiseTex(pal('#c6c8c4', '#d2d4d0', '#dcdeda', '#e6e8e4', '#f0f2ee'), { seed: 1121, octaves: [4, 8, 16], weights: [0.4, 0.3, 0.3], emboss: 1.2, dither: 0.9 });
  const r = rng(1122);
  for (let i = 0; i < 6; i++) { const x = Math.floor(r() * 16), y = Math.floor(r() * 16); t.set(x, y, hex('#a8aaa6')); t.set(x + 1, y, hex('#b8bab6')); }
  return t;
}
function tuff(): Tex {
  const t = paint(grain(1131, [0.5, 0.3, 0.2]), pal('#4e5048', '#5a5c54', '#666860', '#72746b', '#7e8076'), { emboss: 1.2, dither: 0.9, seed: 1131 });
  const r = rng(1132);
  for (let i = 0; i < 10; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), r() < 0.5 ? hex('#8e9086') : hex('#3c3e38'));
  return t;
}
function smoothBasalt(): Tex {
  return noiseTex(pal('#3a3a40', '#424248', '#4a4a50', '#525258', '#5a5a61'), { seed: 1141, octaves: [2, 4, 16], weights: [0.4, 0.3, 0.3], emboss: 0.8, dither: 0.7 });
}
const DRIP = pal('#6a4e3e', '#7a5a48', '#8a6854', '#9a7660', '#aa846c', '#ba947a');
function dripstoneBlock(): Tex {
  const t = new Tex();
  const n = fbm(1151, [2, 8, 16], [0.3, 0.4, 0.3]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = n[y * 16 + x]! * 0.6 + (Math.sin(x * 1.3 + n[y * 16 + x]! * 4) * 0.5 + 0.5) * 0.4;
    t.set(x, y, DRIP[Math.max(0, Math.min(5, Math.round(v * 5)))]!);
  }
  return t;
}
/** Pointed dripstone: thickness from the base (widest) to the tip; drawn pointing up or down. */
function pointedDripstone(thickness: string, up: boolean): Tex {
  const t = new Tex();
  const width = (r: number): number => {
    switch (thickness) {
      case 'base': return 10;
      case 'middle': return 8;
      case 'frustum': return 4 + Math.round((r / 15) * 4);
      case 'tip': return r < 3 ? 0 : Math.max(1, Math.round(((r - 3) / 12) * 4));
      default: return Math.max(1, Math.round(Math.abs(r - 7.5) / 2)); // tip_merge: two tips meeting
    }
  };
  // drawn with the point toward the top of the texture ("up"); "down" is mirrored vertically
  for (let row = 0; row < 16; row++) {
    const w = width(row);
    const x0 = Math.round(8 - w / 2);
    for (let x = x0; x < x0 + w; x++) {
      const c = DRIP[w === 1 ? 4 : x === x0 ? 5 : x === x0 + w - 1 ? 0 : 2 + ((x + row) % 3 === 0 ? 1 : 0)]!;
      t.set(x, up ? row : 15 - row, c);
    }
  }
  return t;
}
function glowLichen(): Tex {
  const t = new Tex();
  const r = rng(1161);
  const p = pal('#3e6a5a', '#5a8a72', '#7aa88a', '#a8d4a0');
  for (let k = 0; k < 16; k++) {
    const cx = 1 + Math.floor(r() * 14), cy = 1 + Math.floor(r() * 14);
    for (let i = 0; i < 9; i++) {
      const x = cx + Math.floor(r() * 3) - 1, y = cy + Math.floor(r() * 3) - 1;
      t.set(x, y, p[Math.floor(r() * 3)]!);
    }
    if (r() < 0.6) t.set(cx, cy, hex('#e8f8b0'));
  }
  return t;
}

// ------------------------------------------------------------------ stones
function igneous(p: Palette, seed: number, flecks: RGBA[]): Tex {
  const t = paint(grain(seed, [0.55, 0.3, 0.15]), p, { emboss: 1.2, dither: 0.8, seed });
  const r = rng(seed + 1);
  for (let i = 0; i < 18; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), flecks[Math.floor(r() * flecks.length)]!);
  return t;
}
function obsidian(): Tex {
  const t = noiseTex(pal('#0c0a14', '#14101e', '#1c1628', '#261e36', '#342848'), { seed: 1171, octaves: [2, 4, 8], weights: [0.4, 0.3, 0.3], emboss: 2, dither: 0.8 });
  const r = rng(1172);
  for (let i = 0; i < 6; i++) { const x = Math.floor(r() * 15), y = Math.floor(r() * 15); t.set(x, y, hex('#5a4682')); t.set(x + 1, y + 1, hex('#3e3060')); }
  return t;
}
function stoneBricks(variant: 'plain' | 'mossy' | 'cracked'): Tex {
  const base = stone();
  const t = new Tex();
  const mortar = hex('#4a4a4c'), lit = hex('#9c9c9f');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 3, offs = row ? 8 : 0;
    const bx = (x + offs) % 16;
    const seam = y % 8 === 7 || bx === 15;
    const top = y % 8 === 0 || bx === 0;
    t.set(x, y, seam ? mortar : top ? mix(base.get(x, y), lit, 0.4) : base.get(x, y));
  }
  const r = rng(1181);
  if (variant === 'mossy') for (let i = 0; i < 40; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    if (y % 8 > 3 || r() < 0.4) t.set(x, y, [hex('#4a6a24'), hex('#5a7e2c'), hex('#3c5a1c')][Math.floor(r() * 3)]!);
  }
  if (variant === 'cracked') {
    let x = 3, y = 0;
    while (y < 16) { t.set(x, y, hex('#38383a')); y++; x += r() < 0.5 ? 1 : 0; if (r() < 0.2) x -= 1; }
    x = 12; y = 9;
    while (y < 16) { t.set(x, y, hex('#38383a')); y++; x -= r() < 0.5 ? 1 : 0; }
  }
  return t;
}

// ------------------------------------------------------------------ spawner & chest
function spawner(): Tex {
  const t = new Tex();
  const bar = pal('#1e2428', '#2e383e', '#46525a', '#62707a');
  for (let i = 0; i < 16; i++) for (const k of [0, 15]) { t.set(i, k, bar[k ? 1 : 3]!); t.set(k, i, bar[k ? 1 : 3]!); }
  for (const g of [4, 8, 11]) for (let i = 1; i < 15; i++) { t.set(g, i, bar[2]!); t.set(i, g, bar[2]!); }
  for (const [x, y] of [[4, 4], [8, 8], [11, 11], [4, 11], [11, 4]] as [number, number][]) t.set(x, y, bar[3]!);
  return t;
}
function chestTex(part: 'top' | 'side' | 'front', trapped = false): Tex {
  const w = WOODS.oak!;
  const t = planks(w, part === 'top' ? 1191 : 1192);
  const rim = w.plank[0]!;
  const metal = trapped ? pal('#5a1a1a', '#8a2a2a', '#c04040') : pal('#4a4a4a', '#7a7a7a', '#b8b8b8');
  for (let i = 0; i < 16; i++) { t.set(i, 0, rim); t.set(i, 15, rim); t.set(0, i, rim); t.set(15, i, rim); }
  if (part !== 'top') {
    for (let x = 0; x < 16; x++) { t.set(x, 5, rim); t.set(x, 6, w.plank[1]!); }
  }
  if (part === 'front') {
    for (let y = 4; y < 9; y++) for (let x = 7; x < 9; x++) t.set(x, y, metal[y === 4 ? 2 : y === 8 ? 0 : 1]!);
  }
  if (trapped) for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]] as [number, number][]) t.set(x, y, metal[1]!);
  return t;
}

// ------------------------------------------------------------------ nether & end terrain
const NETHERRACK = pal('#4a1414', '#601c1c', '#722424', '#842e2e', '#963a38');
function netherrack(): Tex {
  const t = paint(grain(1201, [0.55, 0.3, 0.15]), NETHERRACK, { emboss: 1.6, dither: 0.9, seed: 1201 });
  return t;
}
function soulSand(): Tex {
  const t = paint(grain(1211, [0.5, 0.3, 0.2]), pal('#3a2a20', '#4a3628', '#584232', '#664e3c', '#745a46'), { emboss: 1, dither: 1, seed: 1211 });
  for (const [x, y] of [[3, 3], [10, 5], [5, 11], [12, 12]] as [number, number][]) {
    t.set(x, y, hex('#1e140e')); t.set(x + 1, y, hex('#1e140e')); t.set(x, y + 2, hex('#2a1c14')); t.set(x + 1, y + 2, hex('#2a1c14'));
  }
  return t;
}
function soulSoil(): Tex {
  return paint(grain(1221, [0.5, 0.3, 0.2]), pal('#2e2218', '#3a2c20', '#463628', '#524030', '#5e4a38'), { emboss: 1, dither: 1, seed: 1221 });
}
const BASALT = pal('#2e2e34', '#3a3a40', '#46464e', '#52525a', '#5e5e66');
function basaltSide(): Tex {
  const t = new Tex();
  const n = fbm(1231, [16, 4], [0.5, 0.5]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = x % 4 === 3 ? 0 : x % 4 === 0 ? 4 : 2;
    t.set(x, y, BASALT[Math.max(0, Math.min(4, col + Math.round((n[y * 16 + x]! - 0.5) * 2)))]!);
  }
  return t;
}
function basaltTop(): Tex {
  const t = noiseTex(BASALT, { seed: 1232, octaves: [4, 8], weights: [0.5, 0.5], emboss: 1.4, dither: 0.8 });
  for (let i = 0; i < 16; i++) { t.set(i, 0, BASALT[0]!); t.set(0, i, BASALT[4]!); t.set(i, 15, BASALT[0]!); t.set(15, i, BASALT[0]!); }
  return t;
}
const BLACKSTONE = pal('#1c181e', '#262028', '#302832', '#3a323c', '#463c48');
function nylium(top: boolean, crimson: boolean): Tex {
  const p = crimson ? pal('#6a0e0e', '#8a1414', '#a81c1c', '#c42a26', '#d63c34') : pal('#14584e', '#1a6e60', '#208474', '#2a9a86', '#3aae98');
  const topTex = paint(grain(crimson ? 1241 : 1242, [0.5, 0.3, 0.2]), p, { emboss: 1.2, dither: 1, seed: 1241 });
  if (top) return topTex;
  const t = netherrack();
  const r = rng(crimson ? 1243 : 1244);
  for (let x = 0; x < 16; x++) {
    const len = 3 + Math.floor(r() * 3);
    for (let y = 0; y < len; y++) t.set(x, y, topTex.get(x, y));
  }
  return t;
}
function fungus(crimson: boolean): Tex {
  const t = new Tex();
  const cap = crimson ? pal('#7a1010', '#a81c1c', '#d03030', '#f06a3a') : pal('#0e5a50', '#14806e', '#1ca88e', '#f0882a');
  const stem = pal('#d8c8a8', '#f0e4c8');
  for (let y = 9; y < 16; y++) t.set(7 + (y > 12 ? 1 : 0), y, stem[y & 1]!);
  for (const [a, b, y] of [[5, 11, 5], [4, 12, 6], [3, 13, 7], [5, 11, 8]] as [number, number, number][]) for (let x = a; x < b; x++) t.set(x, y, cap[x < 7 ? 2 : 1]!);
  t.set(6, 6, cap[3]!); t.set(9, 7, cap[3]!); t.set(4, 7, cap[3]!);
  return t;
}
function roots(crimson: boolean, sprouts = false): Tex {
  const t = new Tex();
  const p = crimson ? pal('#6a0e0e', '#9a1818', '#c42a26') : pal('#0e5a50', '#14806e', '#26a890');
  const r = rng(crimson ? 1251 : sprouts ? 1253 : 1252);
  const xs = sprouts ? [3, 5, 8, 10, 12] : [2, 4, 7, 9, 11, 13];
  for (const x0 of xs) {
    const h = sprouts ? 2 + Math.floor(r() * 3) : 5 + Math.floor(r() * 8);
    let x = x0;
    for (let i = 0; i < h; i++) { t.set(x, 15 - i, p[i === h - 1 ? 2 : i & 1]!); if (i % 3 === 2) x += r() < 0.5 ? 1 : -1; }
  }
  return t;
}
function wartBlock(crimson: boolean): Tex {
  const p = crimson ? pal('#5e0a0a', '#760e0e', '#8c1414', '#a01c1a', '#b42622') : pal('#0a4e46', '#0e6258', '#14766a', '#1a8a7c', '#24a090');
  return paint(grain(crimson ? 1261 : 1262, [0.4, 0.35, 0.25]), p, { emboss: 1.8, dither: 1, seed: 1261 });
}
function shroomlight(): Tex {
  const t = paint(grain(1271, [0.4, 0.4, 0.2]), pal('#c8641a', '#e07c24', '#f09a34', '#fab84c', '#ffd47a'), { emboss: 1.4, dither: 0.8, seed: 1271 });
  return t;
}
function glowstone(): Tex {
  const c = cells(1281, 10);
  const r = rng(1282);
  const p = pal('#6a4a1e', '#a0742c', '#d0a040', '#f0c860', '#fff0a8');
  const t = new Tex();
  const tone = new Map<number, number>();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const id = c.id[y * 16 + x]!;
    if (!tone.has(id)) tone.set(id, 2 + Math.floor(r() * 3));
    t.set(x, y, p[c.edge[y * 16 + x] ? 1 : tone.get(id)!]!);
  }
  return t;
}
function ancientDebris(top: boolean): Tex {
  const p = pal('#3a2a24', '#4a362e', '#5a4238', '#6a5044', '#7a5e50');
  if (top) {
    const t = noiseTex(p, { seed: 1291, octaves: [4, 8], weights: [0.5, 0.5], emboss: 1.4, dither: 0.8 });
    for (let i = 0; i < 16; i++) for (let k = 0; k < 16; k++) if (Math.max(Math.abs(i - 7.5), Math.abs(k - 7.5)) % 4 < 1) t.set(i, k, p[0]!);
    return t;
  }
  const t = new Tex();
  const n = fbm(1292, [2, 8], [0.5, 0.5]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const swirl = Math.sin((x + y * 0.5) * 0.9 + n[y * 16 + x]! * 5) * 0.5 + 0.5;
    t.set(x, y, p[Math.round(swirl * 4)]!);
  }
  return t;
}
function netherVines(weeping: boolean, plant: boolean): Tex {
  const t = new Tex();
  const p = weeping ? pal('#6a0e0e', '#9a1818', '#c42a26') : pal('#0e5a50', '#14806e', '#26a890');
  const r = rng((weeping ? 1301 : 1302) + (plant ? 2 : 0));
  for (const x0 of [5, 9]) {
    let x = x0;
    const from = plant ? 0 : weeping ? 0 : 4, to = plant ? 16 : weeping ? 12 : 16;
    for (let y = from; y < to; y++) {
      t.set(x, y, p[1]!);
      if (r() < 0.4) t.set(x + (r() < 0.5 ? 1 : -1), y, p[r() < 0.5 ? 2 : 0]!);
      if (r() < 0.2) x += r() < 0.5 ? 1 : -1;
    }
  }
  return t;
}
function endStone(): Tex {
  const t = paint(grain(1311, [0.55, 0.3, 0.15]), pal('#c8c890', '#d4d49c', '#dedea8', '#e6e6b2', '#eeeebe'), { emboss: 1, dither: 0.9, seed: 1311 });
  const r = rng(1312);
  for (let i = 0; i < 8; i++) { const x = Math.floor(r() * 15), y = Math.floor(r() * 15); t.set(x, y, hex('#a8a874')); t.set(x + 1, y + 1, hex('#f8f8d0')); }
  return t;
}

const NETHER_STONE = () => netherrack();

export const mineralTextures: TexDef[] = [
  { name: 'podzol_top', make: podzolTop },
  { name: 'podzol_side', make: () => sideWithTop(podzolTop(), 1003) },
  { name: 'mycelium_top', make: myceliumTop },
  { name: 'mycelium_side', make: () => sideWithTop(myceliumTop(), 1013, 2, 3) },
  { name: 'rooted_dirt', make: rootedDirt },
  { name: 'moss_block', make: () => moss(1025) },
  { name: 'packed_ice', make: packedIce },
  { name: 'blue_ice', make: blueIce },
  ...Object.entries(TERRACOTTA).map(([n, c], i): TexDef => ({ name: n === 'terracotta' ? 'terracotta' : `${n}_terracotta`, make: () => terracotta(c, 1050 + i) })),
  { name: 'sandstone', make: () => sandstoneSide(SANDSTONE, 1071) },
  { name: 'sandstone_top', make: () => sandstoneTop(SANDSTONE, 1072) },
  { name: 'sandstone_bottom', make: () => sandstoneBottom(SANDSTONE, 1073) },
  { name: 'cut_sandstone', make: () => cutSandstone(SANDSTONE, 1074) },
  { name: 'chiseled_sandstone', make: () => chiseledSandstone(SANDSTONE, 1075) },
  { name: 'red_sandstone', make: () => sandstoneSide(RED_SANDSTONE, 1081) },
  { name: 'red_sandstone_top', make: () => sandstoneTop(RED_SANDSTONE, 1082) },
  { name: 'red_sandstone_bottom', make: () => sandstoneBottom(RED_SANDSTONE, 1083) },
  { name: 'cut_red_sandstone', make: () => cutSandstone(RED_SANDSTONE, 1084) },
  { name: 'chiseled_red_sandstone', make: () => chiseledSandstone(RED_SANDSTONE, 1085) },
  { name: 'amethyst_block', make: () => amethystBlock(false) },
  { name: 'budding_amethyst', make: () => amethystBlock(true) },
  { name: 'small_amethyst_bud', make: () => amethystBud(0), cutout: true },
  { name: 'medium_amethyst_bud', make: () => amethystBud(1), cutout: true },
  { name: 'large_amethyst_bud', make: () => amethystBud(2), cutout: true },
  { name: 'amethyst_cluster', make: () => amethystBud(3), cutout: true },
  { name: 'calcite', make: calcite },
  { name: 'tuff', make: tuff },
  { name: 'smooth_basalt', make: smoothBasalt },
  { name: 'dripstone_block', make: dripstoneBlock },
  ...['up', 'down'].flatMap((d) => ['tip_merge', 'tip', 'frustum', 'middle', 'base'].map((th): TexDef => ({ name: `pointed_dripstone_${d}_${th}`, make: () => pointedDripstone(th, d === 'up'), cutout: true }))),
  { name: 'glow_lichen', make: glowLichen, cutout: true },
  { name: 'andesite', make: () => igneous(pal('#6e6e70', '#7a7a7c', '#868688', '#929294', '#9e9ea0'), 1191, [hex('#5a5a5c'), hex('#b0b0b2')]) },
  { name: 'diorite', make: () => igneous(pal('#a8a8a6', '#b6b6b4', '#c4c4c2', '#d0d0ce', '#dcdcda'), 1192, [hex('#6a6a68'), hex('#4e4e4c'), hex('#f4f4f2')]) },
  { name: 'granite', make: () => igneous(pal('#7a5244', '#8a5e4e', '#986a58', '#a67664', '#b48270'), 1193, [hex('#c8a090'), hex('#5a3a30'), hex('#d8b4a4')]) },
  { name: 'obsidian', make: obsidian },
  { name: 'stone_bricks', make: () => stoneBricks('plain') },
  { name: 'mossy_stone_bricks', make: () => stoneBricks('mossy') },
  { name: 'cracked_stone_bricks', make: () => stoneBricks('cracked') },
  { name: 'spawner', make: spawner, cutout: true },
  { name: 'chest_top', make: () => chestTex('top') },
  { name: 'chest_side', make: () => chestTex('side') },
  { name: 'chest_front', make: () => chestTex('front') },
  { name: 'trapped_chest_front', make: () => chestTex('front', true) },
  { name: 'netherrack', make: netherrack },
  { name: 'nether_gold_ore', make: () => ore(NETHER_STONE(), ORE_COLORS.gold!, 1205, 6) },
  { name: 'nether_quartz_ore', make: () => ore(NETHER_STONE(), pal('#a89c90', '#d8d0c4', '#ece6dc', '#ffffff'), 1206, 6) },
  { name: 'soul_sand', make: soulSand },
  { name: 'soul_soil', make: soulSoil },
  { name: 'basalt_side', make: basaltSide },
  { name: 'basalt_top', make: basaltTop },
  { name: 'blackstone', make: () => paint(grain(1235, [0.55, 0.3, 0.15]), BLACKSTONE, { emboss: 1.4, dither: 0.9, seed: 1235 }) },
  { name: 'blackstone_top', make: () => noiseTex(BLACKSTONE, { seed: 1236, octaves: [4, 8], weights: [0.5, 0.5], emboss: 1.4, dither: 0.9 }) },
  { name: 'crimson_nylium', make: () => nylium(true, true) },
  { name: 'crimson_nylium_side', make: () => nylium(false, true) },
  { name: 'warped_nylium', make: () => nylium(true, false) },
  { name: 'warped_nylium_side', make: () => nylium(false, false) },
  { name: 'crimson_fungus', make: () => fungus(true), cutout: true },
  { name: 'warped_fungus', make: () => fungus(false), cutout: true },
  { name: 'crimson_roots', make: () => roots(true), cutout: true },
  { name: 'warped_roots', make: () => roots(false), cutout: true },
  { name: 'nether_sprouts', make: () => roots(false, true), cutout: true },
  { name: 'nether_wart_block', make: () => wartBlock(true) },
  { name: 'warped_wart_block', make: () => wartBlock(false) },
  { name: 'shroomlight', make: shroomlight },
  { name: 'glowstone', make: glowstone },
  { name: 'ancient_debris_side', make: () => ancientDebris(false) },
  { name: 'ancient_debris_top', make: () => ancientDebris(true) },
  { name: 'weeping_vines', make: () => netherVines(true, false), cutout: true },
  { name: 'weeping_vines_plant', make: () => netherVines(true, true), cutout: true },
  { name: 'twisting_vines', make: () => netherVines(false, false), cutout: true },
  { name: 'twisting_vines_plant', make: () => netherVines(false, true), cutout: true },
  { name: 'end_stone', make: endStone },
];
