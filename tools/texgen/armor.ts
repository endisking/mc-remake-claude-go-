/**
 * Original armour layer textures in the 64×32 humanoid layout (head 0,0; body 16,16; arm
 * 40,16; leg 0,16). layer_1 holds the helmet, chestplate and boots, layer_2 the leggings
 * (drawn on the inner, less inflated model). Each material is painted from its own palette:
 * plates lit from the top-left with darker seams, plus a per-material detail (stitches,
 * chain links, rivets, facets, scutes).
 */
import { Tex, hex, rng, shade, mix, type RGBA } from './lib';

interface Mat {
  name: string;
  base: string;
  light: string;
  dark: string;
  detail: 'stitch' | 'chain' | 'rivet' | 'shine' | 'facet' | 'grain' | 'scute';
  seed: number;
}

export const ARMOR_MATERIALS: Mat[] = [
  { name: 'leather', base: '#8d5a33', light: '#b07a4a', dark: '#5e3a20', detail: 'stitch', seed: 11 },
  { name: 'chainmail', base: '#8e939a', light: '#c4c9cf', dark: '#4e5258', detail: 'chain', seed: 12 },
  { name: 'iron', base: '#c6c8cb', light: '#eeeff0', dark: '#7d8085', detail: 'rivet', seed: 13 },
  { name: 'gold', base: '#e8bf32', light: '#fff19a', dark: '#a87a14', detail: 'shine', seed: 14 },
  { name: 'diamond', base: '#3fc7c0', light: '#a9f4ee', dark: '#1d7f7c', detail: 'facet', seed: 15 },
  { name: 'netherite', base: '#463c41', light: '#6e5f67', dark: '#2a2427', detail: 'grain', seed: 16 },
  { name: 'turtle', base: '#4a9a3a', light: '#7cc95e', dark: '#2c6424', detail: 'scute', seed: 17 },
];

type Mask = (i: number, j: number, w: number, h: number) => boolean;
const all: Mask = () => true;
const rows = (a: number, b: number): Mask => (_i, j) => j >= a && j <= b;

/** Paint one face rectangle with plate shading and the material detail. */
function face(t: Tex, m: Mat, x: number, y: number, w: number, h: number, mask: Mask, r: () => number): void {
  const B = hex(m.base), L = hex(m.light), D = hex(m.dark);
  // find the covered band to place edge highlights relative to it
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (!mask(i, j, w, h)) continue;
      const up = j === 0 || !mask(i, j - 1, w, h), down = j === h - 1 || !mask(i, j + 1, w, h);
      const left = i === 0 || !mask(i - 1, j, w, h), right = i === w - 1 || !mask(i + 1, j, w, h);
      let c: RGBA = shade(B, 1 + (r() - 0.5) * 0.12);
      if (up || left) c = mix(c, L, 0.55);
      if (down || right) c = mix(c, D, 0.6);
      switch (m.detail) {
        case 'stitch':
          if (!up && !down && (j === 1 || j === h - 2) && i % 2 === 0) c = mix(c, hex('#d9b88a'), 0.7);
          break;
        case 'chain':
          if ((i + (j >> 1)) % 2 === 1 && j % 2 === 1 && !up && !down) c = [0, 0, 0, 0];
          else if ((i + j) % 2 === 0) c = mix(c, L, 0.25);
          break;
        case 'rivet':
          if (!up && !down && !left && !right && (i === 1 || i === w - 2) && (j === 1 || j === h - 2)) c = L;
          if (j % 4 === 3 && !down) c = mix(c, D, 0.35);
          break;
        case 'shine':
          if ((i - j + 64) % 7 === 0) c = mix(c, L, 0.6);
          break;
        case 'facet':
          if ((i + j) % 5 === 0) c = mix(c, L, 0.5);
          else if ((i + 2 * j) % 7 === 0) c = mix(c, D, 0.3);
          break;
        case 'grain':
          if (r() < 0.12) c = mix(c, L, 0.5);
          if ((i * 3 + j) % 9 === 0) c = mix(c, hex('#5a3d55'), 0.4);
          break;
        case 'scute':
          if ((i % 4 === 0 || j % 3 === 0) && !up && !left) c = mix(c, D, 0.45);
          break;
      }
      t.set(x + i, y + j, c);
    }
}

/** All six faces of a box at (u,v) with size w×h×d; `side` masks the side strip faces (rows of h). */
function box(t: Tex, m: Mat, u: number, v: number, w: number, h: number, d: number, r: () => number, o: { top?: boolean; bottom?: boolean; side?: Mask; front?: Mask; back?: Mask }): void {
  if (o.top) face(t, m, u + d, v, w, d, all, r);
  if (o.bottom) face(t, m, u + d + w, v, w, d, all, r);
  const side = o.side ?? all;
  face(t, m, u, v + d, d, h, side, r); // character's right
  face(t, m, u + d, v + d, w, h, o.front ?? side, r); // front
  face(t, m, u + d + w, v + d, d, h, side, r); // left
  face(t, m, u + 2 * d + w, v + d, w, h, o.back ?? side, r); // back
}

/** layer_1: helmet, chestplate (body + shoulders) and boots. */
export function armorLayer1(m: Mat): Tex {
  const t = new Tex(64, 32);
  const r = rng(m.seed * 131);
  // helmet: crown, sides down to the ears, back down to the neck, face left open
  box(t, m, 0, 0, 8, 8, 8, r, {
    top: true,
    side: (i, j) => j <= 4 || (j <= 6 && i >= 4),
    front: (i, j) => j <= 1 || ((i === 0 || i === 7) && j <= 4),
    back: rows(0, 6),
  });
  if (m.name === 'turtle') return t;
  // chestplate: body down to the belt line, shoulder pads on the arms
  box(t, m, 16, 16, 8, 12, 4, r, { top: true, bottom: true, side: rows(0, 10) });
  box(t, m, 40, 16, 4, 12, 4, r, { top: true, side: rows(0, 5) });
  // boots: the feet end of the legs
  box(t, m, 0, 16, 4, 12, 4, r, { bottom: true, side: rows(8, 11) });
  return t;
}

/** layer_2: leggings (hips on the body, legs down to the shin). */
export function armorLayer2(m: Mat): Tex {
  const t = new Tex(64, 32);
  const r = rng(m.seed * 257);
  box(t, m, 16, 16, 8, 12, 4, r, { bottom: true, side: rows(7, 11) });
  box(t, m, 0, 16, 4, 12, 4, r, { top: true, side: rows(0, 9) });
  return t;
}

export function allArmorTextures(): { name: string; tex: Tex }[] {
  const out: { name: string; tex: Tex }[] = [];
  for (const m of ARMOR_MATERIALS) {
    out.push({ name: `${m.name}_layer_1`, tex: armorLayer1(m) });
    if (m.name !== 'turtle') out.push({ name: `${m.name}_layer_2`, tex: armorLayer2(m) });
  }
  return out;
}
