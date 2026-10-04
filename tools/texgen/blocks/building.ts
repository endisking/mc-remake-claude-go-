/**
 * Building blocks that structures and a few features place: hay bales, bricks, polished
 * stones, smooth stone, stained glass and candles. Original pixel art.
 */
import { Tex, pal, hex, rng, shade, mix, paint, grain, type Palette, type RGBA } from '../lib';
import type { TexDef } from '../registry';

function hay(top: boolean): Tex {
  const t = new Tex();
  const r = rng(top ? 1402 : 1401);
  const p = pal('#8a6a10', '#a8861a', '#c4a028', '#d8b83a', '#e8cc52');
  const band = pal('#5a3e10', '#7a5418');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (top) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        t.set(x, y, p[d > 7 ? 1 : 2 + Math.round((r() - 0.5) * 2)]!);
      } else {
        const straw = (x * 3 + Math.floor(r() * 3)) % 5;
        t.set(x, y, p[Math.min(4, 1 + straw % 4)]!);
      }
    }
  if (!top) for (const y of [3, 4, 11, 12]) for (let x = 0; x < 16; x++) t.set(x, y, band[y % 2 === 0 ? 1 : 0]!);
  else for (let i = 0; i < 16; i++) { t.set(i, 0, p[0]!); t.set(0, i, p[0]!); t.set(i, 15, p[0]!); t.set(15, i, p[0]!); }
  return t;
}

function bricks(): Tex {
  const t = new Tex();
  const r = rng(1411);
  const brick = pal('#7a3a2a', '#8e4634', '#a0523e', '#b05e48');
  const mortar = pal('#8a847c', '#a8a29a');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const row = y >> 2, offs = row % 2 ? 4 : 0;
      const bx = (x + offs) % 8;
      if (y % 4 === 3 || bx === 7) { t.set(x, y, mortar[(x + y) % 3 === 0 ? 1 : 0]!); continue; }
      const top = y % 4 === 0 || bx === 0;
      t.set(x, y, brick[top ? 3 : 1 + Math.floor(r() * 2)]!);
    }
  return t;
}

function polished(p: Palette, seed: number): Tex {
  const t = paint(grain(seed, [0.3, 0.4, 0.3]), p.slice(1, 4), { emboss: 0.4, dither: 0.5, seed });
  for (let i = 0; i < 16; i++) { t.set(i, 0, p[4]!); t.set(0, i, p[4]!); t.set(i, 15, p[0]!); t.set(15, i, p[0]!); }
  return t;
}

function smoothStone(side: boolean): Tex {
  const p = pal('#8a8a8c', '#949496', '#9e9ea0', '#a8a8aa', '#b4b4b6');
  const t = paint(grain(side ? 1422 : 1421, [0.2, 0.4, 0.4]), p.slice(1, 4), { emboss: 0.3, dither: 0.4, seed: 1421 });
  for (let i = 0; i < 16; i++) { t.set(i, 0, p[4]!); t.set(i, 15, p[0]!); t.set(0, i, side ? t.get(0, i) : p[4]!); t.set(15, i, side ? t.get(15, i) : p[0]!); }
  if (side) for (let x = 0; x < 16; x++) { t.set(x, 7, p[0]!); t.set(x, 8, p[4]!); }
  return t;
}

const DYES: Record<string, string> = {
  white: '#f0f0f0', orange: '#e07a1e', magenta: '#c050c0', light_blue: '#6aa0e0', yellow: '#e8d040', lime: '#80c828', pink: '#f090b0', gray: '#4c4c4c',
  light_gray: '#9a9a9a', cyan: '#2a8a9a', purple: '#7a3ab0', blue: '#3448b0', brown: '#6a4628', green: '#5a7a28', red: '#a02a2a', black: '#1a1a1a',
};

function stainedGlass(color: string): Tex {
  const c = hex(color);
  const t = new Tex();
  const fill: RGBA = [c[0], c[1], c[2], 110];
  const frame: RGBA = [...shade(c, 1.15).slice(0, 3).map((v) => Math.min(255, v)), 230] as RGBA;
  const frameDark: RGBA = [...shade(c, 0.75).slice(0, 3), 230] as RGBA;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, fill);
  for (let i = 0; i < 16; i++) { t.set(i, 0, frame); t.set(0, i, frame); t.set(i, 15, frameDark); t.set(15, i, frameDark); }
  const glint: RGBA = [...mix(c, hex('#ffffff'), 0.6).slice(0, 3), 200] as RGBA;
  for (const [x, y] of [[3, 3], [4, 4], [5, 5], [3, 5], [4, 6], [11, 9], [12, 10]] as [number, number][]) t.set(x, y, glint);
  return t;
}

/** Candle: body at uv (0,8,2,14), wick at (0,5,1,8) (unlit) — lit flame drawn by particles. */
function candle(): Tex {
  const t = new Tex();
  const body = pal('#c8c0a8', '#e4dcc4', '#f4eedc');
  for (let y = 8; y < 14; y++) { t.set(0, y, body[2]!); t.set(1, y, body[1]!); }
  t.set(0, 8, body[2]!); t.set(1, 13, body[0]!);
  for (let y = 5; y < 8; y++) t.set(0, y, hex('#2a2420'));
  // top face of the body (2×2) at (0,6)..(2,8) is shared with the body colour
  for (let x = 2; x < 4; x++) for (let y = 8; y < 10; y++) t.set(x, y, body[2]!);
  return t;
}

export const buildingTextures: TexDef[] = [
  { name: 'hay_block_side', make: () => hay(false) },
  { name: 'hay_block_top', make: () => hay(true) },
  { name: 'bricks', make: bricks },
  { name: 'polished_andesite', make: () => polished(pal('#6e6e70', '#7c7c7e', '#88888a', '#949496', '#a4a4a6'), 1431) },
  { name: 'polished_diorite', make: () => polished(pal('#a8a8a6', '#bcbcba', '#c8c8c6', '#d4d4d2', '#e6e6e4'), 1432) },
  { name: 'polished_granite', make: () => polished(pal('#7a5244', '#8c6050', '#9a6c5a', '#a87866', '#bc8a78'), 1433) },
  { name: 'smooth_stone', make: () => smoothStone(false) },
  { name: 'smooth_stone_slab_side', make: () => smoothStone(true) },
  ...Object.entries(DYES).map(([n, c]): TexDef => ({ name: `${n}_stained_glass`, make: () => stainedGlass(c), translucent: true })),
  { name: 'candle', make: candle, cutout: true },
  { name: 'cobweb', make: cobweb, cutout: true },
  { name: 'dirt_path_top', make: () => pathTop() },
  { name: 'dirt_path_side', make: () => pathSide() },
  { name: 'tnt_side', make: () => tnt('side') },
  { name: 'tnt_top', make: () => tnt('top') },
  { name: 'tnt_bottom', make: () => tnt('bottom') },
  { name: 'prismarine_bricks', make: () => brickGrid(pal('#3c6e60', '#4c8a78', '#5ea490', '#76bca6', '#9ad4c0'), 1451, 8, 4) },
  { name: 'dark_prismarine', make: () => brickGrid(pal('#1e3a30', '#284a3e', '#335a4c', '#3e6a5a', '#4e7e6c'), 1452, 8, 8) },
  { name: 'sponge', make: () => sponge(false) },
  { name: 'wet_sponge', make: () => sponge(true) },
  { name: 'gold_block', make: () => metalBlock(pal('#a0780e', '#d0a41c', '#eccc34', '#fae46a', '#fff8b8'), 1461) },
  { name: 'iron_block', make: () => metalBlock(pal('#9a9a9a', '#b8b8b8', '#d0d0d0', '#e2e2e2', '#f4f4f4'), 1462) },
  { name: 'iron_bars', make: ironBars, cutout: true },
];

function cobweb(): Tex {
  const t = new Tex();
  const c: RGBA = [230, 234, 236, 255];
  const d: RGBA = [190, 196, 200, 255];
  // radial threads and two rings of spiral silk
  for (let i = 0; i < 16; i++) { t.set(i, i, c); t.set(15 - i, i, c); t.set(i, 8, d); t.set(8, i, d); }
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    for (const rad of [3.5, 6.5]) t.set(Math.round(7.5 + Math.cos(a) * rad), Math.round(7.5 + Math.sin(a) * rad), k % 3 ? c : d);
  }
  return t;
}

const PATH = pal('#7a5c30', '#8a6a3a', '#987644', '#a6834e', '#b49058');
function pathTop(): Tex {
  return paint(grain(1441, [0.4, 0.4, 0.2]), PATH, { emboss: 0.8, dither: 0.8, seed: 1441 });
}
function pathSide(): Tex {
  const top = pathTop();
  const t = paint(grain(21, [0.6, 0.28, 0.12]), pal('#5b3d25', '#6a492d', '#795535', '#86603d', '#946c46'), { emboss: 1, contrast: 1.1, dither: 0.7, seed: 21 });
  // the path block is 15/16 tall: its side texture's top row is empty
  for (let x = 0; x < 16; x++) { t.set(x, 0, [0, 0, 0, 0]); for (let y = 1; y < 3; y++) t.set(x, y, top.get(x, y)); }
  return t;
}

function tnt(face: 'side' | 'top' | 'bottom'): Tex {
  const t = new Tex();
  const red = pal('#8a1a12', '#b4281c', '#d0402e');
  const paper = pal('#c8c4b4', '#e4e0d0', '#f4f2e8');
  if (face !== 'side') {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, red[(x % 4 === 0 || y % 4 === 0) ? 0 : 1]!);
    if (face === 'top') for (const [x, y] of [[2, 2], [6, 2], [10, 2], [2, 6], [6, 6], [10, 10], [14, 14], [6, 10], [10, 6]] as [number, number][]) { t.set(x, y, paper[2]!); t.set(x + 1, y + 1, hex('#2a2a2a')); }
    return t;
  }
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, red[x % 4 === 0 ? 0 : x % 4 === 1 ? 2 : 1]!);
  for (let y = 5; y < 11; y++) for (let x = 0; x < 16; x++) t.set(x, y, paper[y === 5 ? 2 : y === 10 ? 0 : 1]!);
  // an original warning mark on the label: a black flame-like glyph in a ring
  const g = ['..XX..', '.X..X.', 'X.XX.X', 'X.XX.X'];
  g.forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch === 'X') t.set(5 + dx, 6 + dy, hex('#222222')); }));
  return t;
}

function brickGrid(p: Palette, seed: number, bw: number, bh: number): Tex {
  const t = paint(grain(seed, [0.5, 0.3, 0.2]), p.slice(1, 4), { emboss: 0.6, dither: 0.6, seed });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = Math.floor(y / bh), offs = row % 2 ? bw / 2 : 0;
    const bx = (x + offs) % bw;
    if (y % bh === bh - 1 || bx === bw - 1) t.set(x, y, p[0]!);
    else if (y % bh === 0 || bx === 0) t.set(x, y, p[4]!);
  }
  return t;
}

function sponge(wet: boolean): Tex {
  const p = wet ? pal('#6a6a1e', '#82822a', '#9a9a36', '#b0b046', '#c4c45a') : pal('#9a8a26', '#b8a632', '#cec040', '#e0d252', '#eee26a');
  const t = paint(grain(wet ? 1472 : 1471, [0.5, 0.3, 0.2]), p, { emboss: 1.2, dither: 0.8, seed: 1471 });
  const r = rng(1473);
  for (let i = 0; i < 14; i++) { const x = Math.floor(r() * 15), y = Math.floor(r() * 15); t.set(x, y, p[0]!); t.set(x + 1, y + 1, p[4]!); }
  return t;
}

function metalBlock(p: Palette, seed: number): Tex {
  const t = paint(grain(seed, [0.2, 0.4, 0.4]), p.slice(1, 4), { emboss: 0.4, dither: 0.4, seed });
  for (let i = 0; i < 16; i++) { t.set(i, 0, p[4]!); t.set(0, i, p[4]!); t.set(i, 15, p[0]!); t.set(15, i, p[0]!); }
  for (let i = 2; i < 6; i++) t.set(i, 2 + (i >> 1), p[4]!);
  return t;
}

function ironBars(): Tex {
  const t = new Tex();
  const p = pal('#4a4a4a', '#7a7a7a', '#a8a8a8', '#d0d0d0');
  for (const x of [0, 4, 8, 12]) for (let y = 0; y < 16; y++) { t.set(x + 1, y, p[3]!); t.set(x + 2, y, p[1]!); }
  for (const y of [1, 14]) for (let x = 0; x < 16; x++) t.set(x, y, p[2]!);
  return t;
}
