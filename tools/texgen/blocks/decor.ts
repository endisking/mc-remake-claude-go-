/**
 * Crafted and building blocks: wool, concrete, concrete powder, glazed terracotta, mineral
 * storage blocks, copper, quartz, deepslate/blackstone/nether/end brick families, purpur,
 * utility blocks (crafting table, furnaces, bookshelf, dispenser, dropper…), crops, doors,
 * trapdoors, torches, lanterns and more. Original pixel art.
 */
import { Tex, pal, hex, rng, shade, mix, noiseTex, paint, grain, cells, ore, grid, type Palette, type RGBA } from '../lib';
import type { TexDef } from '../registry';
import { WOODS, planks, type WoodColors } from './flora';
import { wool } from './misc';
import { deepslate } from './terrain';

const DYES: Record<string, string> = {
  white: '#e9ecec', orange: '#f07613', magenta: '#bd44b3', light_blue: '#3aafd9', yellow: '#f8c627', lime: '#70b919', pink: '#ed8dac', gray: '#3e4447',
  light_gray: '#8e8e86', cyan: '#158991', purple: '#792aac', blue: '#35399d', brown: '#724728', green: '#546d1b', red: '#a12722', black: '#141519',
};
const CONCRETE: Record<string, string> = {
  white: '#cfd5d6', orange: '#e06101', magenta: '#a9309f', light_blue: '#2489c7', yellow: '#f1af15', lime: '#5ea918', pink: '#d5658e', gray: '#36393d',
  light_gray: '#7d7d73', cyan: '#157788', purple: '#64209c', blue: '#2c2e8f', brown: '#603c20', green: '#495b24', red: '#8e2121', black: '#080a0f',
};

const clamp = (c: RGBA): RGBA => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), c[3]];
function ramp5(base: string): Palette {
  const c = hex(base);
  return [shade(c, 0.8), shade(c, 0.9), c, clamp(shade(c, 1.1)), clamp(mix(c, hex('#ffffff'), 0.18))];
}
function frame(t: Tex, light: RGBA, dark: RGBA): Tex {
  for (let i = 0; i < 16; i++) { t.set(i, 0, light); t.set(0, i, light); t.set(i, 15, dark); t.set(15, i, dark); }
  return t;
}

// ------------------------------------------------------------------ colours
function concrete(base: string, seed: number): Tex {
  const p = ramp5(base);
  return paint(grain(seed, [0.3, 0.4, 0.3]), [p[1]!, p[2]!, p[2]!, p[3]!], { dither: 0.6, seed });
}
function concretePowder(base: string, seed: number): Tex {
  const p = ramp5(base);
  return paint(grain(seed, [0.7, 0.2, 0.1]), p, { emboss: 0.6, dither: 1.2, seed });
}
/** Glazed terracotta: an original rotationally interlocking tile motif per colour. */
function glazed(base: string, seed: number): Tex {
  const p = ramp5(base);
  const accent = clamp(mix(hex(base), hex('#ffffff'), 0.5));
  const dark = shade(hex(base), 0.55);
  const t = new Tex();
  const r = rng(seed);
  const variant = seed % 4;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const u = x / 15, v = y / 15;
      let k: number;
      switch (variant) {
        case 0: k = Math.floor((Math.abs(u - 0.5) + Math.abs(v - 0.5)) * 6) % 3; break;
        case 1: k = (Math.floor(u * 4) + Math.floor(v * 4)) % 2 === 0 ? (x + y) % 3 : 2; break;
        case 2: k = Math.floor(Math.hypot(u, v) * 7) % 3; break;
        default: k = Math.floor((u * 3 + Math.sin(v * 6.3) * 0.6) * 2) % 3; break;
      }
      t.set(x, y, k === 0 ? p[1]! : k === 1 ? accent : p[3]!);
    }
  // corner swirl, which makes rotations visible
  for (let i = 0; i < 6; i++) { t.set(i, 0, dark); t.set(0, i, dark); t.set(i + 1, 2, dark); t.set(2, i + 1, dark); }
  t.set(3, 3, accent);
  void r;
  return t;
}

// ------------------------------------------------------------------ minerals and metals
function storageBlock(p: Palette, seed: number, motif: 'gem' | 'ingot' | 'dust' | 'coal' | 'raw'): Tex {
  const t = paint(grain(seed, [0.3, 0.4, 0.3]), p.slice(1, 4), { emboss: 0.5, dither: 0.6, seed });
  const r = rng(seed + 1);
  if (motif === 'gem') {
    for (const [cx, cy] of [[4, 4], [11, 4], [4, 11], [11, 11]] as [number, number][]) {
      t.set(cx, cy - 1, p[4]!); t.set(cx - 1, cy, p[4]!); t.set(cx, cy, p[3]!); t.set(cx + 1, cy, p[2]!); t.set(cx, cy + 1, p[1]!);
    }
  } else if (motif === 'dust' || motif === 'coal') {
    for (let i = 0; i < 26; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), p[r() < 0.5 ? 0 : 4]!);
  } else if (motif === 'raw') {
    const c = cells(seed + 2, 7);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (c.edge[y * 16 + x]) t.set(x, y, p[0]!);
  }
  if (motif !== 'raw') frame(t, p[4]!, p[0]!);
  if (motif === 'ingot') for (let x = 1; x < 15; x++) t.set(x, 8, p[1]!);
  return t;
}
const COPPER: Record<string, Palette> = {
  '': pal('#8a4a30', '#a85c3c', '#c06c48', '#d88a62', '#eaa47e'),
  exposed_: pal('#7a6050', '#987660', '#a8826a', '#b8957a', '#caa88c'),
  weathered_: pal('#4a7a5a', '#5a8e6a', '#6a9e78', '#7cae88', '#92c09a'),
  oxidized_: pal('#2e7a68', '#3a9078', '#48a488', '#5cb898', '#76ccac'),
};
function copper(p: Palette, cut: boolean, seed: number): Tex {
  const t = paint(grain(seed, [0.3, 0.4, 0.3]), p.slice(1, 4), { emboss: 0.6, dither: 0.6, seed });
  if (cut) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (x % 8 === 7 || y % 8 === 7) t.set(x, y, p[0]!);
      else if (x % 8 === 0 || y % 8 === 0) t.set(x, y, p[4]!);
    }
  } else {
    frame(t, p[4]!, p[0]!);
    const r = rng(seed + 5);
    for (let i = 0; i < 6; i++) { const x = 2 + Math.floor(r() * 12), y = 2 + Math.floor(r() * 12); t.set(x, y, p[4]!); t.set(x + 1, y, p[0]!); }
  }
  return t;
}
const QUARTZ = pal('#c8c0b4', '#d8d2c8', '#e6e0d8', '#f0ece6', '#faf8f4');
function quartz(kind: 'side' | 'top' | 'smooth' | 'pillar' | 'pillar_top' | 'chiseled' | 'chiseled_top' | 'bricks'): Tex {
  const t = paint(grain(1501, [0.3, 0.4, 0.3]), QUARTZ.slice(1, 4), { dither: 0.5, seed: 1501 });
  if (kind === 'smooth') return t;
  if (kind === 'side' || kind === 'top') return frame(t, QUARTZ[4]!, QUARTZ[0]!);
  if (kind === 'pillar') { for (let y = 0; y < 16; y++) { t.set(0, y, QUARTZ[4]!); t.set(1, y, QUARTZ[3]!); t.set(14, y, QUARTZ[1]!); t.set(15, y, QUARTZ[0]!); t.set(7, y, QUARTZ[1]!); } return t; }
  if (kind === 'pillar_top') { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); if (Math.floor(d) % 3 === 0) t.set(x, y, QUARTZ[1]!); } return frame(t, QUARTZ[4]!, QUARTZ[0]!); }
  if (kind === 'bricks') {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const bx = (x + ((y >> 3) % 2 ? 4 : 0)) % 8; if (y % 8 === 7 || bx === 7) t.set(x, y, QUARTZ[0]!); else if (y % 8 === 0 || bx === 0) t.set(x, y, QUARTZ[4]!); }
    return t;
  }
  frame(t, QUARTZ[4]!, QUARTZ[0]!);
  if (kind === 'chiseled') for (const y of [3, 12]) for (let x = 2; x < 14; x++) { t.set(x, y, QUARTZ[0]!); t.set(x, y + 1, QUARTZ[4]!); }
  for (let i = 4; i < 12; i++) { t.set(i, 4 + ((i * 3) % 8), QUARTZ[1]!); }
  return t;
}

// ------------------------------------------------------------------ brick families
function bricksOf(p: Palette, seed: number, bw: number, bh: number, cracked = false): Tex {
  const t = paint(grain(seed, [0.5, 0.3, 0.2]), p.slice(1, 4), { emboss: 0.8, dither: 0.7, seed });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = Math.floor(y / bh), offs = row % 2 ? bw / 2 : 0;
    const bx = (x + offs) % bw;
    if (y % bh === bh - 1 || bx === bw - 1) t.set(x, y, p[0]!);
    else if (y % bh === 0 || bx === 0) t.set(x, y, p[4]!);
  }
  if (cracked) {
    const r = rng(seed + 9);
    for (let k = 0; k < 2; k++) { let x = 2 + Math.floor(r() * 12), y = 0; while (y < 16) { t.set(x, y, p[0]!); y++; x += r() < 0.4 ? (r() < 0.5 ? 1 : -1) : 0; } }
  }
  return t;
}
function tiles(p: Palette, seed: number, cracked = false): Tex {
  const t = paint(grain(seed, [0.5, 0.3, 0.2]), p.slice(1, 4), { emboss: 0.6, dither: 0.6, seed });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (x % 8 === 7 || y % 8 === 7) t.set(x, y, p[0]!);
    else if (x % 8 === 0 || y % 8 === 0) t.set(x, y, p[4]!);
  }
  if (cracked) { const r = rng(seed + 3); let x = 4, y = 0; while (y < 16) { t.set(x, y, p[0]!); y++; x += r() < 0.5 ? 1 : 0; } }
  return t;
}
function chiseled(p: Palette, seed: number): Tex {
  const t = paint(grain(seed, [0.5, 0.3, 0.2]), p.slice(1, 4), { emboss: 0.6, dither: 0.6, seed });
  frame(t, p[4]!, p[0]!);
  for (let i = 3; i < 13; i++) { t.set(i, 3, p[0]!); t.set(3, i, p[0]!); t.set(i, 12, p[4]!); t.set(12, i, p[4]!); }
  for (let i = 6; i < 10; i++) for (let k = 6; k < 10; k++) t.set(i, k, (i + k) % 2 ? p[0]! : p[3]!);
  return t;
}
const DEEP = pal('#26262c', '#34343b', '#40404a', '#4c4c56', '#5c5c66');
const POL_BLACK = pal('#1c181e', '#2a242c', '#36303a', '#423a46', '#524856');
const NETHER_BRICK = pal('#1e0e10', '#2c1418', '#3a1c20', '#48242a', '#583034');
const RED_NETHER_BRICK = pal('#3a0606', '#4c0a0a', '#5e0e0e', '#701414', '#841c1c');
const END_BRICK = pal('#b4b47e', '#c8c890', '#d8d8a0', '#e4e4ae', '#f0f0c0');
const PURPUR = pal('#7a5480', '#8e6494', '#a074a6', '#b086b6', '#c49ac8');

// ------------------------------------------------------------------ utility blocks
function craftingTable(face: 'top' | 'side' | 'front'): Tex {
  const w = WOODS.oak!;
  const t = planks(w, 1601);
  const dark = w.plank[0]!, light = w.plank[4]!;
  if (face === 'top') {
    frame(t, light, dark);
    for (let i = 1; i < 15; i++) { t.set(i, 5, dark); t.set(i, 10, dark); t.set(5, i, dark); t.set(10, i, dark); }
    return t;
  }
  for (let x = 0; x < 16; x++) { t.set(x, 0, dark); t.set(x, 1, light); t.set(x, 2, dark); }
  const tool = pal('#3a3a3a', '#8a8a8a', '#c8c8c8');
  if (face === 'front') {
    // an original saw and a hammer hanging on the side
    for (let x = 3; x < 8; x++) { t.set(x, 6, tool[2]!); t.set(x, 7, tool[1]!); }
    for (let x = 3; x < 8; x += 2) t.set(x, 8, tool[1]!);
    t.set(8, 6, w.plank[1]!); t.set(9, 6, w.plank[1]!);
    for (let y = 5; y < 12; y++) t.set(12, y, w.plank[0]!);
    for (let x = 10; x < 15; x++) t.set(x, 5, tool[1]!);
  } else {
    for (let y = 6; y < 12; y++) { t.set(4, y, tool[1]!); t.set(11, y, tool[0]!); }
  }
  return t;
}
const COBBLE = pal('#3e3e40', '#535356', '#68686b', '#7b7b7e', '#8f8f92');
function stoneFront(kind: 'furnace' | 'furnace_on' | 'side' | 'top' | 'dispenser' | 'dropper' | 'observer'): Tex {
  const t = paint(grain(1611, [0.5, 0.3, 0.2]), COBBLE.slice(1, 5), { emboss: 0.8, dither: 0.6, seed: 1611 });
  frame(t, COBBLE[4]!, COBBLE[0]!);
  if (kind === 'side' || kind === 'top') { if (kind === 'top') for (let i = 3; i < 13; i++) { t.set(i, 3, COBBLE[0]!); t.set(i, 12, COBBLE[4]!); t.set(3, i, COBBLE[0]!); t.set(12, i, COBBLE[4]!); } return t; }
  if (kind === 'furnace' || kind === 'furnace_on') {
    for (let y = 8; y < 14; y++) for (let x = 3; x < 13; x++) {
      const edge = y === 8 || x === 3 || x === 12;
      t.set(x, y, edge ? COBBLE[0]! : kind === 'furnace_on' ? (y > 10 ? hex(y > 12 ? '#ffe070' : '#f8a020') : hex('#c04010')) : hex('#141414'));
    }
    for (let x = 4; x < 12; x++) t.set(x, 5, COBBLE[0]!);
  } else if (kind === 'dispenser' || kind === 'dropper') {
    // a dark round mouth (dispenser) or a square slot (dropper)
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
      const inside = kind === 'dispenser' ? Math.hypot(x - 7.5, y - 7.5) < 3.6 : x > 4 && x < 11 && y > 4 && y < 11;
      if (inside) t.set(x, y, hex('#0e0e0e'));
    }
  } else {
    for (let y = 4; y < 12; y++) for (let x = 2; x < 14; x++) if ((x < 7 || x > 8) && y > 5 && y < 10) t.set(x, y, hex('#1a1a1a'));
  }
  return t;
}
function bookshelf(): Tex {
  const w = WOODS.oak!;
  const t = planks(w, 1621);
  const r = rng(1622);
  const covers = ['#7a1c1c', '#1c3a7a', '#2a6a2a', '#7a6a1c', '#5a2a6a', '#6a4a2a'].map((c) => hex(c));
  for (const row of [1, 9]) {
    for (let y = row; y < row + 6; y++) for (let x = 1; x < 15; x++) t.set(x, y, hex('#2a1c10'));
    let x = 1;
    while (x < 15) {
      const bw = 1 + Math.floor(r() * 2), h = 4 + Math.floor(r() * 3);
      const c = covers[Math.floor(r() * covers.length)]!;
      for (let k = 0; k < bw && x + k < 15; k++) for (let y = row + 6 - h; y < row + 6; y++) t.set(x + k, y, k === 0 ? clamp(shade(c, 1.2)) : c);
      x += bw;
    }
  }
  return t;
}

// ------------------------------------------------------------------ crops & stems
function cropStage(kind: 'carrots' | 'potatoes' | 'beetroots' | 'nether_wart', stage: number): Tex {
  const t = new Tex();
  const r = rng(1630 + stage + kind.length * 7);
  const green = kind === 'nether_wart' ? pal('#5a0e12', '#8a1a1e', '#b42a2a') : pal('#2c6a14', '#3e8a1e', '#56a82c');
  const max = kind === 'nether_wart' ? 2 : 3;
  const h = 3 + Math.round((stage / max) * 9);
  for (const bx of [2, 5, 8, 11, 13]) {
    const hh = Math.min(15, h + Math.floor(r() * 2));
    for (let i = 0; i < hh; i++) {
      const y = 15 - i;
      t.set(bx + (i > hh / 2 && bx % 2 ? 1 : 0), y, green[i % 3]!);
      if (i === hh - 1 && kind !== 'nether_wart') { t.set(bx - 1, y, green[2]!); t.set(bx + 1, y + 1, green[1]!); }
    }
    if (stage === max) {
      const crop = kind === 'carrots' ? hex('#e8801c') : kind === 'potatoes' ? hex('#c8a050') : kind === 'beetroots' ? hex('#8a1a2a') : hex('#d03030');
      t.set(bx, 15, crop); t.set(bx, 14, clamp(shade(crop, 1.15)));
      if (kind === 'nether_wart') for (let i = 0; i < 3; i++) t.set(bx + (i % 2), 15 - h + i, crop);
    }
  }
  return t;
}
function stem(attached: boolean): Tex {
  const t = new Tex();
  const g = pal('#6a6a6a', '#9a9a9a', '#c8c8c8');
  if (attached) {
    for (let x = 0; x < 11; x++) t.set(x, 8 + (x >> 2), g[1]!);
    t.set(11, 10, g[2]!);
  } else {
    for (let y = 0; y < 16; y++) t.set(8, y, g[1]!);
    for (const y of [4, 9, 13]) { t.set(7, y, g[2]!); t.set(9, y - 1, g[0]!); }
  }
  return t;
}

// ------------------------------------------------------------------ doors & trapdoors per wood
function doorTex(w: WoodColors, top: boolean, style: number, seed: number): Tex {
  const t = planks(w, seed);
  const d = w.plank[0]!, m = w.plank[2]!, l = w.plank[4]!;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (x === 0 || x === 15 || (top && y === 0) || (!top && y === 15)) t.set(x, y, d);
    else if (style === 1 && (x === 5 || x === 10)) t.set(x, y, w.plank[1]!);
    else if (style === 2 && (y % 5 === 0)) t.set(x, y, w.plank[1]!);
    else t.set(x, y, (x + y * 3) % 7 === 0 ? l : m);
  }
  if (top) {
    const holes: [number, number, number, number][] = style === 0 ? [[3, 3, 5, 5], [8, 3, 5, 5]] : style === 1 ? [[3, 3, 10, 3], [3, 8, 10, 3]] : [[4, 3, 8, 8]];
    for (const [x0, y0, ww, hh] of holes) for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) t.set(x, y, x === x0 || y === y0 ? d : [0, 0, 0, 0]);
  } else {
    t.set(12, 1, hex('#8a8a8a')); t.set(12, 2, hex('#c0c0c0'));
  }
  return t;
}
function trapdoorTex(w: WoodColors, style: number): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const hole = style === 0 ? (x % 5 !== 0 && y % 5 !== 0 && x > 1 && y > 1 && x < 14 && y < 14 && (x + y) % 2 === 0)
      : style === 1 ? (y >= 3 && y <= 12 && (x === 4 || x === 11))
      : ((x >= 3 && x <= 6) || (x >= 9 && x <= 12)) && ((y >= 3 && y <= 6) || (y >= 9 && y <= 12));
    if (hole) continue;
    t.set(x, y, edge ? w.plank[0]! : w.plank[2 + ((x * 3 + y) % 5 === 0 ? 1 : 0)]!);
  }
  return t;
}
function ironDoor(top: boolean): Tex {
  const p = pal('#6a6a6a', '#9a9a9a', '#c4c4c4', '#dedede', '#f4f4f4');
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, p[x === 0 || x === 15 ? 1 : (x % 4 === 1 ? 4 : 2)]!);
  if (top) for (let y = 3; y < 9; y++) for (let x = 3; x < 13; x++) t.set(x, y, (x === 3 || y === 3) ? p[0]! : [0, 0, 0, 0]);
  else { t.set(11, 2, p[0]!); t.set(12, 2, p[0]!); }
  return t;
}
function ironTrapdoor(): Tex {
  const p = pal('#6a6a6a', '#9a9a9a', '#c4c4c4', '#e6e6e6');
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (x > 1 && x < 14 && y > 1 && y < 14 && (x % 3 === 0 || y % 3 === 0) === false && (x + y) % 2) continue;
    t.set(x, y, p[(x === 0 || y === 0) ? 3 : (x === 15 || y === 15) ? 0 : 2]!);
  }
  return t;
}

// ------------------------------------------------------------------ torches, lanterns, misc shapes
function torchTex(flame: [string, string, string], stick: [string, string]): Tex {
  return grid(
    ['................', '................', '................', '................', '................', '................',
      '.......WY.......', '.......YO.......', '.......cb.......', '.......cb.......', '.......cb.......', '.......cb.......',
      '.......cb.......', '.......cb.......', '.......cb.......', '.......cb.......'],
    { W: flame[0], Y: flame[1], O: flame[2], c: stick[0], b: stick[1] },
  );
}
/** Lantern: body side at uv (0,2,6,9), top/bottom at (0,9,6,15), handle at (11,1,14,7). */
function lantern(soul: boolean): Tex {
  const t = new Tex();
  const iron = pal('#2e3238', '#4a5058', '#6e767e');
  const glow = soul ? pal('#4ac8d0', '#a8f0f4') : pal('#f0a030', '#ffe890');
  for (let y = 2; y < 9; y++) for (let x = 0; x < 6; x++) t.set(x, y, (y === 2 || y === 8 || x === 0 || x === 5) ? iron[y === 2 ? 2 : 1]! : glow[(x + y) % 2]!);
  for (let y = 9; y < 15; y++) for (let x = 0; x < 6; x++) t.set(x, y, (x === 0 || y === 9 || x === 5 || y === 14) ? iron[0]! : iron[1]!);
  for (let y = 1; y < 7; y++) for (let x = 11; x < 14; x++) if (y === 1 || x === 11 || x === 13) t.set(x, y, iron[2]!);
  return t;
}
function chain(): Tex {
  const t = new Tex();
  const p = pal('#2e3238', '#4a5058', '#7a8288');
  for (let y = 0; y < 16; y++) {
    const link = Math.floor(y / 4) % 2;
    if (link === 0) { t.set(1, y, p[2]!); t.set(2, y, p[1]!); if (y % 4 === 0 || y % 4 === 3) t.set(1, y, p[1]!); }
    else { t.set(4, y, p[2]!); t.set(5, y, p[0]!); }
  }
  return t;
}
function endRod(): Tex {
  const t = new Tex();
  for (let y = 0; y < 15; y++) { t.set(0, y, hex('#ffffff')); t.set(1, y, hex('#e4dcd0')); }
  for (let y = 0; y < 3; y++) for (let x = 2; x < 6; x++) t.set(x, y, hex(y === 0 ? '#b8a8c8' : '#7a6a8a'));
  return t;
}
function flowerPot(): Tex {
  const t = new Tex();
  const p = pal('#6a3424', '#8a4630', '#a8583c', '#c06a48');
  for (let y = 10; y < 16; y++) for (let x = 5; x < 11; x++) t.set(x, y, p[x === 5 ? 3 : x === 10 ? 0 : 2]!);
  for (let x = 5; x < 11; x++) t.set(x, 10, p[3]!);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) t.set(x, y, hex(['#3a2414', '#4a2e1a'][(x + y) % 2]!));
  return t;
}
function slime(honey: boolean): Tex {
  const base = honey ? pal('#c87a14', '#e8961c', '#f8b030', '#ffcc5a') : pal('#4a9a38', '#62b84a', '#7ccc5c', '#a0e080');
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const core = x >= 4 && x <= 11 && y >= 4 && y <= 11;
    const c = edge ? base[2]! : core ? base[1]! : base[3]!;
    t.set(x, y, [c[0], c[1], c[2], edge || core ? 230 : 150]);
  }
  return t;
}
function lamp(on: boolean): Tex {
  const t = paint(grain(1651, [0.4, 0.4, 0.2]), on ? pal('#c88a3a', '#f0b850', '#ffd878', '#fff0b0') : pal('#4a2e1c', '#6a4228', '#7e5232', '#90603a'), { dither: 0.6, seed: 1651 });
  const fr = on ? pal('#a0703a', '#ffe8b0') : pal('#2e1c10', '#a07850');
  for (let i = 0; i < 16; i++) for (const k of [0, 15, 7]) { t.set(i, k, fr[k === 15 ? 0 : 1]!); t.set(k, i, fr[k === 15 ? 0 : 1]!); }
  return t;
}
function boneBlock(top: boolean): Tex {
  const p = pal('#bab4a0', '#cec8b4', '#ddd8c6', '#ece8d8', '#f8f6ec');
  const t = paint(grain(1661, [0.3, 0.4, 0.3]), p.slice(1, 4), { dither: 0.5, seed: 1661 });
  if (top) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot((x % 8) - 3.5, (y % 8) - 3.5); if (d < 1.6) t.set(x, y, p[0]!); else if (d > 3.4) t.set(x, y, p[4]!); } return t; }
  for (let y = 0; y < 16; y++) { t.set(0, y, p[4]!); t.set(15, y, p[0]!); t.set(8, y, p[1]!); }
  return t;
}
function driedKelp(face: 'side' | 'top' | 'bottom'): Tex {
  const p = pal('#1e2414', '#2a321a', '#363e22', '#444e2c');
  const t = paint(grain(1671, [0.5, 0.3, 0.2]), p, { dither: 0.6, seed: 1671 });
  if (face === 'side') for (let y = 0; y < 16; y++) for (const x of [3, 8, 12]) t.set(x, y, p[0]!);
  else for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.floor(Math.hypot(x - 7.5, y - 7.5)) % 3 === 0) t.set(x, y, p[face === 'top' ? 3 : 0]!);
  for (let i = 0; i < 16; i++) { t.set(i, 4, hex('#5a4a2a')); t.set(i, 11, hex('#5a4a2a')); }
  return t;
}
function target(top: boolean): Tex {
  const t = paint(grain(1681, [0.6, 0.3, 0.1]), pal('#d0c8a8', '#e0d8b8', '#ece6c8', '#f4f0dc'), { dither: 0.6, seed: 1681 });
  const red = hex('#c02828');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if ((d > 1 && d < 2) || (d > 4 && d < 5) || d > 7) t.set(x, y, red);
    if (d < 1) t.set(x, y, red);
  }
  void top;
  return t;
}
function cryingObsidian(): Tex {
  const t = noiseTex(pal('#0c0a14', '#14101e', '#1c1628', '#261e36', '#342848'), { seed: 1171, octaves: [2, 4, 8], weights: [0.4, 0.3, 0.3], emboss: 2, dither: 0.8 });
  const r = rng(1691);
  for (let i = 0; i < 9; i++) { const x = Math.floor(r() * 15), y = Math.floor(r() * 14); t.set(x, y, hex('#a040f0')); t.set(x, y + 1, hex('#6a20b0')); }
  return t;
}
function jukebox(top: boolean): Tex {
  const w = WOODS.jungle!;
  const t = planks(w, 1701);
  frame(t, w.plank[4]!, w.plank[0]!);
  if (top) for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) t.set(x, y, (y === 4 || y === 11) ? hex('#1a1a1a') : hex('#2a2a2a'));
  return t;
}
function noteBlock(): Tex {
  const w = WOODS.jungle!;
  const t = planks(w, 1702);
  frame(t, w.plank[4]!, w.plank[0]!);
  // an original speaker-grille pattern
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if ((x + y) % 2 === 0) t.set(x, y, w.plank[0]!);
  return t;
}
function shulker(base: string, top: boolean): Tex {
  const p = ramp5(base);
  const t = paint(grain(1711, [0.3, 0.4, 0.3]), p.slice(1, 4), { dither: 0.5, seed: 1711 });
  frame(t, p[4]!, p[0]!);
  if (!top) for (let x = 0; x < 16; x++) { t.set(x, 7, p[0]!); t.set(x, 8, p[4]!); }
  else for (let i = 4; i < 12; i++) { t.set(i, 4, p[0]!); t.set(4, i, p[0]!); t.set(i, 11, p[4]!); t.set(11, i, p[4]!); }
  return t;
}
function powderSnow(): Tex {
  return noiseTex(pal('#dae4ea', '#e6eef2', '#f0f6f8', '#fafcfd', '#ffffff'), { seed: 1721, octaves: [8, 16], weights: [0.5, 0.5], emboss: 0.6, dither: 1.4 });
}
function tintedGlass(): Tex {
  const t = new Tex();
  const fill: RGBA = [44, 36, 50, 200], edge: RGBA = [72, 60, 80, 240];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, x === 0 || y === 0 || x === 15 || y === 15 ? edge : fill);
  for (const [x, y] of [[3, 3], [4, 4], [5, 5]] as [number, number][]) t.set(x, y, [120, 104, 132, 230]);
  return t;
}
function honeycomb(): Tex {
  const t = new Tex();
  const p = pal('#b06a10', '#d88a1c', '#f0a42c', '#ffc04a');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const wall = y % 4 === 0 || (x + ((y >> 2) % 2) * 2) % 4 === 0;
    t.set(x, y, wall ? p[0]! : p[(x + y) % 3 === 0 ? 3 : 2]!);
  }
  return t;
}
function lodestone(top: boolean): Tex {
  const t = paint(grain(1731, [0.4, 0.4, 0.2]), pal('#6a6a6e', '#7a7a7e', '#8a8a8e', '#9a9a9e'), { dither: 0.6, seed: 1731 });
  frame(t, hex('#b0b0b4'), hex('#4a4a4e'));
  if (top) for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, (x + y) % 2 ? hex('#3a3a3e') : hex('#5a4a4a'));
  return t;
}
function beehive(face: 'front' | 'front_honey' | 'side' | 'end'): Tex {
  const w = WOODS.oak!;
  const t = planks(w, 1741);
  if (face === 'end') { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.floor(Math.hypot(x - 7.5, y - 7.5)) % 3 === 0) t.set(x, y, w.plank[1]!); return t; }
  for (let x = 0; x < 16; x++) for (const y of [0, 15]) t.set(x, y, w.plank[0]!);
  if (face !== 'side') {
    for (let y = 7; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, hex('#1a1006'));
    if (face === 'front_honey') for (const [x, y] of [[5, 11], [6, 11], [6, 12], [10, 11], [10, 12]] as [number, number][]) t.set(x, y, hex('#ffb020'));
  }
  return t;
}

// ------------------------------------------------------------------ registry
const DOOR_STYLE: Record<string, number> = { spruce: 1, birch: 0, jungle: 2, acacia: 1, dark_oak: 2, crimson: 0, warped: 2 };

export const decorTextures: TexDef[] = [
  ...Object.entries(DYES).filter(([n]) => n !== 'white').map(([n, c], i): TexDef => ({ name: `${n}_wool`, make: () => wool(c, 1800 + i) })),
  ...Object.entries(CONCRETE).map(([n, c], i): TexDef => ({ name: `${n}_concrete`, make: () => concrete(c, 1820 + i) })),
  ...Object.entries(CONCRETE).map(([n, c], i): TexDef => ({ name: `${n}_concrete_powder`, make: () => concretePowder(c, 1840 + i) })),
  ...Object.entries(DYES).map(([n, c], i): TexDef => ({ name: `${n}_glazed_terracotta`, make: () => glazed(c, 1860 + i) })),
  ...Object.entries(DYES).map(([n, c]): TexDef[] => [
    { name: `${n}_shulker_box_side`, make: () => shulker(c, false) },
    { name: `${n}_shulker_box_top`, make: () => shulker(c, true) },
  ]).flat(),
  { name: 'shulker_box_side', make: () => shulker('#8a5e8a', false) },
  { name: 'shulker_box_top', make: () => shulker('#8a5e8a', true) },
  { name: 'lapis_block', make: () => storageBlock(pal('#14307a', '#1c42a0', '#2652be', '#3466d4', '#5a88ea'), 1881, 'dust') },
  { name: 'diamond_block', make: () => storageBlock(pal('#2a9a90', '#40c0b4', '#62dcd0', '#8aece2', '#c8fcf6'), 1882, 'gem') },
  { name: 'emerald_block', make: () => storageBlock(pal('#0e7a3a', '#16a04c', '#22c060', '#46da7e', '#9ef4bc'), 1883, 'gem') },
  { name: 'coal_block', make: () => storageBlock(pal('#0a0a0c', '#141416', '#1e1e22', '#2a2a2e', '#3c3c42'), 1884, 'coal') },
  { name: 'redstone_block', make: () => storageBlock(pal('#7a0a0a', '#a01010', '#c01a14', '#dc2a1e', '#f45a40'), 1885, 'dust') },
  { name: 'netherite_block', make: () => storageBlock(pal('#2a2428', '#3a3236', '#4a4044', '#5a4e52', '#6e6266'), 1886, 'ingot') },
  { name: 'raw_iron_block', make: () => storageBlock(pal('#7a5a44', '#a07a5e', '#bc967a', '#d4b094', '#e8ccb4'), 1887, 'raw') },
  { name: 'raw_copper_block', make: () => storageBlock(pal('#7a3e24', '#a0522e', '#c0663a', '#d8824e', '#eca06a'), 1888, 'raw') },
  { name: 'raw_gold_block', make: () => storageBlock(pal('#9a6a0e', '#c48e16', '#e0ae26', '#f2ca44', '#fce480'), 1889, 'raw') },
  ...Object.entries(COPPER).flatMap(([pre, p], i): TexDef[] => [
    { name: pre === '' ? 'copper_block' : `${pre}copper`, make: () => copper(p, false, 1900 + i) },
    { name: `${pre}cut_copper`, make: () => copper(p, true, 1910 + i) },
  ]),
  { name: 'quartz_block', make: () => quartz('side') },
  { name: 'quartz_block_top', make: () => quartz('top') },
  { name: 'smooth_quartz', make: () => quartz('smooth') },
  { name: 'quartz_pillar', make: () => quartz('pillar') },
  { name: 'quartz_pillar_top', make: () => quartz('pillar_top') },
  { name: 'chiseled_quartz_block', make: () => quartz('chiseled') },
  { name: 'chiseled_quartz_block_top', make: () => quartz('chiseled_top') },
  { name: 'quartz_bricks', make: () => quartz('bricks') },
  { name: 'cobbled_deepslate', make: () => { const t = deepslate(); const c = cells(1921, 9); for (let i = 0; i < 256; i++) if (c.edge[i]) t.set(i % 16, i >> 4, DEEP[0]!); return t; } },
  { name: 'polished_deepslate', make: () => frame(paint(grain(1922, [0.3, 0.4, 0.3]), DEEP.slice(1, 4), { dither: 0.5, seed: 1922 }), DEEP[4]!, DEEP[0]!) },
  { name: 'deepslate_tiles', make: () => tiles(DEEP, 1923) },
  { name: 'cracked_deepslate_tiles', make: () => tiles(DEEP, 1923, true) },
  { name: 'deepslate_bricks', make: () => bricksOf(DEEP, 1924, 8, 4) },
  { name: 'cracked_deepslate_bricks', make: () => bricksOf(DEEP, 1924, 8, 4, true) },
  { name: 'chiseled_deepslate', make: () => chiseled(DEEP, 1925) },
  { name: 'polished_blackstone', make: () => frame(paint(grain(1931, [0.3, 0.4, 0.3]), POL_BLACK.slice(1, 4), { dither: 0.5, seed: 1931 }), POL_BLACK[4]!, POL_BLACK[0]!) },
  { name: 'polished_blackstone_bricks', make: () => bricksOf(POL_BLACK, 1932, 8, 4) },
  { name: 'cracked_polished_blackstone_bricks', make: () => bricksOf(POL_BLACK, 1932, 8, 4, true) },
  { name: 'chiseled_polished_blackstone', make: () => chiseled(POL_BLACK, 1933) },
  { name: 'gilded_blackstone', make: () => ore(paint(grain(1235, [0.55, 0.3, 0.15]), POL_BLACK, { emboss: 1.4, dither: 0.9, seed: 1235 }), pal('#8a6510', '#c79a1d', '#ecc932', '#fff59a'), 1934, 7) },
  { name: 'nether_bricks', make: () => bricksOf(NETHER_BRICK, 1941, 8, 4) },
  { name: 'cracked_nether_bricks', make: () => bricksOf(NETHER_BRICK, 1941, 8, 4, true) },
  { name: 'chiseled_nether_bricks', make: () => chiseled(NETHER_BRICK, 1942) },
  { name: 'red_nether_bricks', make: () => bricksOf(RED_NETHER_BRICK, 1943, 8, 4) },
  { name: 'end_stone_bricks', make: () => bricksOf(END_BRICK, 1944, 8, 8) },
  { name: 'purpur_block', make: () => tiles(PURPUR, 1945) },
  { name: 'purpur_pillar', make: () => { const t = paint(grain(1946, [0.4, 0.4, 0.2]), PURPUR.slice(1, 4), { dither: 0.5, seed: 1946 }); for (let y = 0; y < 16; y++) { t.set(0, y, PURPUR[4]!); t.set(15, y, PURPUR[0]!); t.set(5, y, PURPUR[1]!); t.set(10, y, PURPUR[1]!); } return t; } },
  { name: 'purpur_pillar_top', make: () => chiseled(PURPUR, 1947) },
  { name: 'chiseled_stone_bricks', make: () => chiseled(pal('#5a5a5d', '#6e6e71', '#7b7b7e', '#88888b', '#9c9c9f'), 1948) },
  { name: 'polished_basalt_side', make: () => { const t = paint(grain(1951, [0.2, 0.4, 0.4]), pal('#3a3a40', '#46464e', '#52525a'), { dither: 0.4, seed: 1951 }); for (let y = 0; y < 16; y++) { t.set(0, y, hex('#62626a')); t.set(15, y, hex('#2a2a30')); } return t; } },
  { name: 'polished_basalt_top', make: () => chiseled(pal('#2a2a30', '#3a3a40', '#46464e', '#52525a', '#62626a'), 1952) },
  { name: 'crying_obsidian', make: cryingObsidian },
  { name: 'bone_block_side', make: () => boneBlock(false) },
  { name: 'bone_block_top', make: () => boneBlock(true) },
  { name: 'dried_kelp_side', make: () => driedKelp('side') },
  { name: 'dried_kelp_top', make: () => driedKelp('top') },
  { name: 'dried_kelp_bottom', make: () => driedKelp('bottom') },
  { name: 'slime_block', make: () => slime(false), translucent: true },
  { name: 'honey_block', make: () => slime(true), translucent: true },
  { name: 'honeycomb_block', make: honeycomb },
  { name: 'tinted_glass', make: tintedGlass, translucent: true },
  { name: 'powder_snow', make: powderSnow },
  { name: 'target_side', make: () => target(false) },
  { name: 'target_top', make: () => target(true) },
  { name: 'lodestone_side', make: () => lodestone(false) },
  { name: 'lodestone_top', make: () => lodestone(true) },
  { name: 'crafting_table_top', make: () => craftingTable('top') },
  { name: 'crafting_table_side', make: () => craftingTable('side') },
  { name: 'crafting_table_front', make: () => craftingTable('front') },
  { name: 'furnace_front', make: () => stoneFront('furnace') },
  { name: 'furnace_front_on', make: () => stoneFront('furnace_on') },
  { name: 'furnace_side', make: () => stoneFront('side') },
  { name: 'furnace_top', make: () => stoneFront('top') },
  { name: 'dispenser_front', make: () => stoneFront('dispenser') },
  { name: 'dropper_front', make: () => stoneFront('dropper') },
  { name: 'observer_front', make: () => stoneFront('observer') },
  { name: 'bookshelf', make: bookshelf },
  { name: 'jukebox_side', make: () => jukebox(false) },
  { name: 'jukebox_top', make: () => jukebox(true) },
  { name: 'note_block', make: noteBlock },
  { name: 'redstone_lamp', make: () => lamp(false) },
  { name: 'redstone_lamp_on', make: () => lamp(true) },
  { name: 'beehive_front', make: () => beehive('front') },
  { name: 'beehive_front_honey', make: () => beehive('front_honey') },
  { name: 'beehive_side', make: () => beehive('side') },
  { name: 'beehive_end', make: () => beehive('end') },
  ...(['carrots', 'potatoes', 'beetroots'] as const).flatMap((k) => [0, 1, 2, 3].map((s): TexDef => ({ name: `${k}_stage${s}`, make: () => cropStage(k, s), cutout: true }))),
  ...[0, 1, 2].map((s): TexDef => ({ name: `nether_wart_stage${s}`, make: () => cropStage('nether_wart', s), cutout: true })),
  { name: 'stem', make: () => stem(false), cutout: true },
  { name: 'attached_stem', make: () => stem(true), cutout: true },
  ...Object.entries(DOOR_STYLE).flatMap(([n, style], i): TexDef[] => [
    { name: `${n}_door_top`, make: () => doorTex(WOODS[n]!, true, style, 1960 + i * 2), cutout: true },
    { name: `${n}_door_bottom`, make: () => doorTex(WOODS[n]!, false, style, 1961 + i * 2), cutout: true },
    { name: `${n}_trapdoor`, make: () => trapdoorTex(WOODS[n]!, style), cutout: true },
  ]),
  { name: 'iron_door_top', make: () => ironDoor(true), cutout: true },
  { name: 'iron_door_bottom', make: () => ironDoor(false), cutout: true },
  { name: 'iron_trapdoor', make: ironTrapdoor, cutout: true },
  { name: 'soul_torch', make: () => torchTex(['#e8ffff', '#7ae8f0', '#30a8c0'], ['#8a6a3c', '#5e4626']), cutout: true },
  { name: 'redstone_torch', make: () => torchTex(['#ffb0a0', '#ff3020', '#b01010'], ['#8a6a3c', '#5e4626']), cutout: true },
  { name: 'redstone_torch_off', make: () => torchTex(['#6a2020', '#4a1010', '#3a0a0a'], ['#8a6a3c', '#5e4626']), cutout: true },
  { name: 'lantern', make: () => lantern(false), cutout: true },
  { name: 'soul_lantern', make: () => lantern(true), cutout: true },
  { name: 'chain', make: chain, cutout: true },
  { name: 'end_rod', make: endRod, cutout: true },
  { name: 'flower_pot', make: flowerPot, cutout: true },
];

