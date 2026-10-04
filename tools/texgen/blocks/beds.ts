/**
 * Bed textures (original designs): per dye colour a blanket top for each half, side and end
 * bands (the mattress is 6 px tall, drawn in rows 7–12), plus a shared wooden underside/legs.
 */
import { Tex, hex, rng, shade, mix, type RGBA } from '../lib';
import type { TexDef } from '../registry';
import { WOODS, planks } from './flora';

/** DyeColor texture diffuse colours (vanilla values, used for wool/beds/banners). */
export const DYES: Record<string, string> = {
  white: '#f9fffe', orange: '#f9801d', magenta: '#c74ebd', light_blue: '#3ab3da', yellow: '#fed83d', lime: '#80c71f',
  pink: '#f38baa', gray: '#474f52', light_gray: '#9d9d97', cyan: '#169c9c', purple: '#8932b8', blue: '#3c44aa',
  brown: '#835432', green: '#5e7c16', red: '#b02e26', black: '#1d1d21',
};

const SHEET: RGBA = hex('#e8e4dc');
const SHEET_DARK: RGBA = hex('#c9c3b8');

function blanket(c: RGBA, x: number, y: number, r: () => number): RGBA {
  // soft quilted weave with a little noise
  const q = (x + y) % 6 === 0 || (x - y + 18) % 6 === 0 ? 0.9 : 1;
  return shade(c, q * (0.94 + r() * 0.1));
}

function topHead(color: string, seed: number): Tex {
  const t = new Tex();
  const c = hex(color), r = rng(seed);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let p: RGBA;
      if (y >= 9) p = y === 9 ? shade(c, 1.12) : blanket(c, x, y, r); // folded-back edge of the blanket
      else if (y >= 1 && y <= 6 && x >= 2 && x <= 13) {
        // pillow
        const edge = y === 1 || y === 6 || x === 2 || x === 13;
        p = edge ? SHEET_DARK : mix(SHEET, hex('#ffffff'), 0.4 * (1 - Math.abs(x - 7.5) / 8));
      } else p = shade(SHEET, 0.96 + r() * 0.05);
      if (x === 0 || x === 15) p = shade(p, 0.85);
      t.set(x, y, p);
    }
  return t;
}

function topFoot(color: string, seed: number): Tex {
  const t = new Tex();
  const c = hex(color), r = rng(seed);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let p = blanket(c, x, y, r);
      if (x === 0 || x === 15 || y === 15) p = shade(p, 0.85);
      t.set(x, y, p);
    }
  return t;
}

/** Side band (rows 7–12): the blanket hangs over the mattress; `sheetFrom` columns show the sheet. */
function side(color: string, seed: number, sheetFrom: number): Tex {
  const t = new Tex();
  const c = hex(color), r = rng(seed);
  for (let y = 7; y <= 12; y++)
    for (let x = 0; x < 16; x++) {
      const sheet = x >= sheetFrom;
      let p = sheet ? shade(SHEET, 0.92 + r() * 0.06) : blanket(c, x, y, r);
      if (!sheet && y === 12) p = shade(c, 0.75); // blanket hem
      if (y === 12 && sheet) p = SHEET_DARK;
      t.set(x, y, p);
    }
  return t;
}

function end(color: string | null, seed: number): Tex {
  const t = new Tex();
  const r = rng(seed);
  for (let y = 7; y <= 12; y++)
    for (let x = 0; x < 16; x++) {
      let p: RGBA;
      if (color) {
        const c = hex(color);
        p = y === 12 ? shade(c, 0.75) : blanket(c, x, y, r);
      } else p = y >= 11 ? SHEET_DARK : shade(SHEET, 0.9 + r() * 0.06);
      t.set(x, y, p);
    }
  return t;
}

function legs(): Tex {
  const t = planks(WOODS.oak!, 777);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shade(t.get(x, y), 0.78));
  return t;
}

export const bedTextures: TexDef[] = [
  ...Object.entries(DYES).flatMap(([name, c], i): TexDef[] => [
    { name: `${name}_bed_top_head`, make: () => topHead(c, 1200 + i) },
    { name: `${name}_bed_top_foot`, make: () => topFoot(c, 1300 + i) },
    { name: `${name}_bed_side_head`, make: () => side(c, 1400 + i, 7), cutout: true },
    { name: `${name}_bed_side_foot`, make: () => side(c, 1500 + i, 99), cutout: true },
    { name: `${name}_bed_end_foot`, make: () => end(c, 1600 + i), cutout: true },
  ]),
  { name: 'bed_end_head', make: () => end(null, 1700), cutout: true },
  { name: 'bed_wood', make: legs },
];
