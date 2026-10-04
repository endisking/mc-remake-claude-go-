/**
 * Original default player skins in the standard 64×64 skin layout (head 0,0; body 16,16;
 * right arm 40,16; right leg 0,16; left arm 32,48; left leg 16,48; outer layers at their
 * usual offsets). Each character is designed here from colour palettes and drawn features.
 */
import { Tex, hex, rng, shade, mix, type RGBA } from './lib';

interface Look {
  name: string;
  skin: string;
  hair: string;
  eyes: string;
  shirt: string;
  shirtTrim: string;
  pants: string;
  shoes: string;
  /** hair style: 'short' | 'long' | 'buzz' */
  style: 'short' | 'long' | 'buzz';
  /** 3-px arms (the slim model, like vanilla's second default skin); the unused 2-px columns stay transparent */
  slim?: boolean;
  seed: number;
}

export const LOOKS: Look[] = [
  { name: 'rowan', skin: '#c99a73', hair: '#5a3a22', eyes: '#3b6fb0', shirt: '#2f6f8f', shirtTrim: '#e2c26a', pants: '#3a3f5c', shoes: '#4a3424', style: 'short', seed: 1 },
  { name: 'ivy', skin: '#e3b894', hair: '#b4462a', eyes: '#3f8a3a', shirt: '#4c8c3a', shirtTrim: '#d9e6c8', pants: '#5b4a3a', shoes: '#2f2a28', style: 'long', seed: 2, slim: true },
  { name: 'kai', skin: '#8a5a3c', hair: '#1d1a1a', eyes: '#5a3b20', shirt: '#d9772a', shirtTrim: '#f0e6d8', pants: '#2c4a6e', shoes: '#e8e8e8', style: 'buzz', seed: 3 },
  { name: 'nova', skin: '#f0cfae', hair: '#e8d27a', eyes: '#6a4aa8', shirt: '#7b4ab0', shirtTrim: '#2a2a2a', pants: '#2a2a33', shoes: '#7b4ab0', style: 'long', seed: 4, slim: true },
];

function fill(t: Tex, x: number, y: number, w: number, h: number, c: RGBA, r: () => number, vary = 0.06): void {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = 1 + (r() - 0.5) * vary * 2;
      t.set(x + i, y + j, shade(c, k));
    }
}

/** Fill all six faces of a box region in the skin layout. */
function box(t: Tex, u: number, v: number, w: number, h: number, d: number, c: RGBA, r: () => number, vary = 0.06): void {
  fill(t, u + d, v, w, d, c, r, vary); // top
  fill(t, u + d + w, v, w, d, shade(c, 0.85), r, vary); // bottom
  fill(t, u, v + d, d + w + d + w, h, c, r, vary); // right, front, left, back
}

export function skin(look: Look): Tex {
  const t = new Tex(64, 64);
  const r = rng(look.seed * 977);
  const S = hex(look.skin), H = hex(look.hair), E = hex(look.eyes), SH = hex(look.shirt), TR = hex(look.shirtTrim), P = hex(look.pants), SO = hex(look.shoes);
  // ---- head (u0 v0, 8×8×8)
  box(t, 0, 0, 8, 8, 8, S, r, 0.04);
  // hair: top, back and sides
  fill(t, 8, 0, 8, 8, H, r, 0.12); // top
  fill(t, 24, 8, 8, look.style === 'buzz' ? 4 : look.style === 'long' ? 8 : 6, H, r, 0.12); // back
  for (const side of [0, 16]) fill(t, side, 8, 8, look.style === 'buzz' ? 2 : look.style === 'long' ? 7 : 4, H, r, 0.12);
  // face (front at 8,8): fringe, eyes, nose shadow, mouth
  const fringe = look.style === 'buzz' ? 1 : 2;
  fill(t, 8, 8, 8, fringe, H, r, 0.12);
  if (look.style === 'long') {
    fill(t, 8, 10, 1, 5, H, r, 0.1);
    fill(t, 15, 10, 1, 5, H, r, 0.1);
  }
  const eyeY = 12;
  t.set(9, eyeY, hex('#ffffff'));
  t.set(10, eyeY, E);
  t.set(13, eyeY, E);
  t.set(14, eyeY, hex('#ffffff'));
  t.set(10, eyeY - 1, shade(H, 0.9)); // brows
  t.set(13, eyeY - 1, shade(H, 0.9));
  t.set(11, eyeY + 1, shade(S, 0.85));
  t.set(12, eyeY + 1, shade(S, 0.85));
  t.set(11, eyeY + 2, shade(S, 0.65));
  t.set(12, eyeY + 2, shade(S, 0.65));
  // ---- body (u16 v16, 8×12×4)
  box(t, 16, 16, 8, 12, 4, SH, r);
  // collar + zip/trim on the front (front at 20,20)
  fill(t, 22, 20, 4, 1, shade(S, 0.95), r, 0.02);
  for (let y = 21; y < 32; y++) t.set(24, y, TR);
  fill(t, 20, 30, 8, 2, shade(SH, 0.8), r); // hem
  // ---- right arm (u40 v16, 4×12×4 or slim 3×12×4): sleeve then skin, hands
  const aw = look.slim ? 3 : 4, strip = 2 * (4 + aw);
  box(t, 40, 16, aw, 12, 4, S, r, 0.04);
  fill(t, 40, 20, strip, 5, SH, r);
  fill(t, 40, 25, strip, 1, TR, r, 0.02);
  // ---- left arm (u32 v48)
  box(t, 32, 48, aw, 12, 4, S, r, 0.04);
  fill(t, 32, 52, strip, 5, SH, r);
  fill(t, 32, 57, strip, 1, TR, r, 0.02);
  // ---- right leg (u0 v16) and left leg (u16 v48): pants + shoes
  box(t, 0, 16, 4, 12, 4, P, r);
  fill(t, 0, 29, 16, 3, SO, r);
  fill(t, 4, 16, 4, 4, SO, r); // sole (bottom)
  box(t, 16, 48, 4, 12, 4, P, r);
  fill(t, 16, 61, 16, 3, SO, r);
  fill(t, 24, 48, 4, 4, SO, r);
  // ---- outer layers: a hood/cap on the hat layer for some looks
  if (look.style !== 'long') {
    // a little hair tuft sticking out on the hat layer
    t.set(40 + 9, 8, mix(H, hex('#000000'), 0.1));
    t.set(40 + 10, 8, H);
  }
  return t;
}

export function allSkins(): { name: string; tex: Tex }[] {
  return LOOKS.map((l) => ({ name: l.name, tex: skin(l) }));
}
