/** Wood, leaves, plants, glass, torches. */
import { Tex, pal, hex, rng, fbm, grid, shade, mix, type Palette, type RGBA } from '../lib';
import type { TexDef } from '../registry';

export interface WoodColors {
  plank: Palette; // 5 dark→light
  bark: Palette; // 4 dark→light
  ring: Palette; // 3 colours for log tops
}

export const WOODS: Record<string, WoodColors> = {
  oak: { plank: pal('#6b5230', '#7f6239', '#8f7043', '#a07e4d', '#b08c58'), bark: pal('#3f3020', '#4f3d27', '#614b30', '#6f5838'), ring: pal('#7d6338', '#9a7d48', '#b29558') },
  spruce: { plank: pal('#4a3218', '#583c1f', '#654626', '#71502c', '#7d5a33'), bark: pal('#24170c', '#2f1f10', '#3a2815', '#46311b'), ring: pal('#5a3f22', '#6c4e2c', '#7f5e36') },
  birch: { plank: pal('#a99b66', '#bcae76', '#c8bb82', '#d4c88f', '#ded39b'), bark: pal('#2b2b2b', '#d6d6d0', '#e6e6e0', '#f2f2ec'), ring: pal('#b3a26e', '#c9b980', '#ddd093') },
  jungle: { plank: pal('#6d4a31', '#7e5739', '#8e6442', '#9d714b', '#ac7e55'), bark: pal('#3b2c10', '#4a3815', '#59451b', '#665122'), ring: pal('#8a6340', '#a3784e', '#b98c5c') },
  acacia: { plank: pal('#8c4524', '#a1512a', '#b25c30', '#c26836', '#d0743e'), bark: pal('#4a4640', '#5a564f', '#6a655d', '#7a756c'), ring: pal('#a8532c', '#c06536', '#d77a42') },
  dark_oak: { plank: pal('#2e1d0c', '#3a2510', '#452d14', '#503519', '#5b3e1e'), bark: pal('#231a0e', '#2d2212', '#382b17', '#43341c'), ring: pal('#3f2a13', '#523819', '#64461f') },
  crimson: { plank: pal('#4a1e30', '#5a2539', '#6a2c43', '#7a344d', '#8a3c57'), bark: pal('#3d0f16', '#5a1520', '#7b1d2a', '#a32a36'), ring: pal('#5f2238', '#7c2e49', '#9b3a5b') },
  warped: { plank: pal('#1c4a44', '#225750', '#28645c', '#2e7268', '#358074'), bark: pal('#1c1530', '#2a1f45', '#164f4a', '#21706a'), ring: pal('#24584f', '#2d6c61', '#378275') },
};

export function planks(w: WoodColors, seed: number): Tex {
  const t = new Tex();
  const r = rng(seed);
  const n = fbm(seed + 3, [2, 8], [0.5, 0.5]);
  // four boards of 4 px; seams on rows 3, 7, 11, 15; staggered vertical joints
  const joints = [5, 12, 2, 9];
  for (let y = 0; y < 16; y++) {
    const board = y >> 2;
    for (let x = 0; x < 16; x++) {
      const row = y & 3;
      let v = 2 + Math.round((n[y * 16 + x]! - 0.5) * 2 + (r() - 0.5) * 0.8);
      if (row === 0) v += 1; // lit top edge
      if (row === 3) v = 0; // seam
      if (x === joints[board]) v = row === 3 ? 0 : 1;
      if (x === joints[board]! + 1 && row !== 3) v = Math.min(4, v + 1);
      t.set(x, y, w.plank[Math.max(0, Math.min(4, v))]!);
    }
  }
  // grain specks
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    if ((y & 3) !== 3) t.set(x, y, shade(t.get(x, y), 0.88));
  }
  return t;
}

export function logSide(w: WoodColors, seed: number, birch = false): Tex {
  const t = new Tex();
  const r = rng(seed);
  const n = fbm(seed + 1, [2, 4, 16], [0.3, 0.3, 0.4]);
  // vertical bark ridges
  const ridge = Array.from({ length: 16 }, () => r());
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (birch) {
        let c = w.bark[2 + Math.round(n[y * 16 + x]!)]!;
        t.set(x, y, c);
        continue;
      }
      const v = ridge[x]! * 0.6 + n[(y * 16 + x)]! * 0.4;
      let i = Math.round(v * 3);
      if (ridge[(x + 15) % 16]! > ridge[x]! + 0.35) i = 0; // groove shadow
      t.set(x, y, w.bark[Math.max(0, Math.min(3, i))]!);
    }
  if (birch) {
    // dark horizontal bark marks
    for (let k = 0; k < 7; k++) {
      const y = Math.floor(r() * 16), x0 = Math.floor(r() * 16), len = 2 + Math.floor(r() * 4);
      for (let i = 0; i < len; i++) t.set((x0 + i) % 16, y, w.bark[0]!);
      t.set(x0, (y + 1) % 16, mix(w.bark[0]!, w.bark[2]!, 0.5));
    }
  }
  return t;
}

export function logTop(w: WoodColors, seed: number): Tex {
  const t = new Tex();
  const r = rng(seed);
  const n = fbm(seed + 7, [4, 8], [0.6, 0.4]);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (x === 0 || y === 0 || x === 15 || y === 15) {
        t.set(x, y, w.bark[1 + Math.floor(r() * 3)]!);
        continue;
      }
      // rounded, slightly wobbly growth rings (between square and circle), 2 px apart
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.hypot(dx, dy) * 0.45 + (n[y * 16 + x]! - 0.5) * 1.2;
      const ring = Math.floor(d / 1.6);
      let c = w.ring[ring % 2 === 0 ? 2 : 1]!;
      if (ring >= 5) c = w.ring[0]!;
      if (d < 1.2) c = w.ring[0]!; // pith
      if (r() < 0.08) c = shade(c, 0.92);
      t.set(x, y, c);
    }
  return t;
}

/** Leaves: grayscale (biome-tinted) with transparent gaps for Fancy graphics. */
export function leaves(seed: number, density = 0.7, base = pal('#4e4e4e', '#686868', '#828282', '#9a9a9a', '#b4b4b4')): Tex {
  // leaf clumps: 2–4 px blobs lit top-left, with see-through gaps between them
  const t = new Tex();
  const r = rng(seed);
  const n = fbm(seed + 1, [8, 16, 4], [0.45, 0.35, 0.2]);
  const holeCut = 1 - density;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = n[y * 16 + x]!;
      if (v < holeCut + 0.08 && r() < 0.85) continue;
      const ul = n[((y + 15) % 16) * 16 + ((x + 15) % 16)]!;
      let idx = Math.round(v * 3 + (v - ul) * 2.5 + (r() - 0.5));
      idx = Math.max(0, Math.min(4, idx));
      t.set(x, y, base[idx]!);
    }
  return t;
}

/** Opaque variant of leaves used by Fast graphics. */
export function opaqueOf(src: Tex, fill: RGBA): Tex {
  return src.clone().map((c) => (c[3] < 128 ? fill : c));
}

export function grassPlant(): Tex {
  const t = new Tex();
  const r = rng(303);
  const tones = [pal('#4a4a4a', '#5f5f5f', '#767676', '#8d8d8d'), pal('#565656', '#6d6d6d', '#848484', '#a0a0a0'), pal('#3f3f3f', '#585858', '#707070', '#868686')];
  // thin 1 px blades, taller toward the middle; tips bend outward one pixel
  const xs = [1, 2, 4, 5, 6, 8, 9, 10, 11, 13, 14];
  for (const bx of xs) {
    const centre = 1 - Math.abs(bx - 7.5) / 8;
    const h = Math.min(15, Math.round(6 + centre * 7 + r() * 3));
    const tone = tones[Math.floor(r() * tones.length)]!;
    const bend = bx < 7 ? -1 : bx > 8 ? 1 : 0;
    for (let i = 0; i < h; i++) {
      const x = bx + (i >= h - 2 ? bend : 0);
      t.set(x, 15 - i, tone[Math.min(3, Math.floor((i / h) * 4))]!);
    }
  }
  return t;
}

export const POPPY = grid(
  [
    '................',
    '................',
    '................',
    '.....rRr........',
    '....rRRRr.......',
    '....RRkRR.......',
    '....rRRRr.......',
    '.....rrr........',
    '......g.........',
    '......g..l......',
    '......gll.......',
    '....llg.........',
    '.....lg.........',
    '......g.........',
    '......g.........',
    '......g.........',
  ],
  { r: '#a5121a', R: '#e0242a', k: '#2a1a10', g: '#3f7a1e', l: '#58a02c' },
);

export const DANDELION = grid(
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......yYy.......',
    '.....yYWYy......',
    '.....YWYWY......',
    '.....yYWYy......',
    '......yYy.......',
    '.......g........',
    '.......g.l......',
    '.....l.gl.......',
    '......lg........',
    '.......g........',
    '.......g........',
  ],
  { y: '#d1a514', Y: '#f2d22a', W: '#fff27a', g: '#3f7a1e', l: '#58a02c' },
);

export const TORCH = grid(
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......WY.......',
    '.......YO.......',
    '.......cb.......',
    '.......cb.......',
    '.......cb.......',
    '.......cb.......',
    '.......cb.......',
    '.......cb.......',
    '.......cb.......',
    '.......cb.......',
  ],
  { W: '#fffbd0', Y: '#ffd84a', O: '#f08a1c', c: '#8a6a3c', b: '#5e4626' },
);

export function glass(): Tex {
  const t = new Tex();
  const frame = hex('#d8eef0'), frameDark = hex('#9cc3c8');
  for (let i = 0; i < 16; i++) {
    t.set(i, 0, frame);
    t.set(0, i, frame);
    t.set(i, 15, frameDark);
    t.set(15, i, frameDark);
  }
  // diagonal glints
  const g = hex('#f4feff', 255);
  for (const [x, y] of [[3, 3], [4, 4], [5, 5], [3, 5], [4, 6], [11, 9], [12, 10]] as [number, number][]) t.set(x, y, g);
  return t;
}

export const floraTextures: TexDef[] = [
  ...Object.entries(WOODS).flatMap(([name, w], i): TexDef[] => {
    const stem = name === 'crimson' || name === 'warped';
    const log = stem ? `${name}_stem` : `${name}_log`;
    return [
      { name: `${name}_planks`, make: () => planks(w, 400 + i * 10) },
      { name: log, make: () => logSide(w, 401 + i * 10, name === 'birch') },
      { name: `${log}_top`, make: () => logTop(w, 402 + i * 10) },
    ];
  }),
  { name: 'oak_leaves', make: () => leaves(501, 0.7), tint: 'foliage', cutout: true },
  { name: 'spruce_leaves', make: () => leaves(502, 0.74), tint: 'foliage', cutout: true },
  { name: 'birch_leaves', make: () => leaves(503, 0.68, pal('#686868', '#848484', '#a0a0a0', '#bababa', '#d4d4d4')), tint: 'foliage', cutout: true },
  { name: 'jungle_leaves', make: () => leaves(504, 0.76), tint: 'foliage', cutout: true },
  { name: 'acacia_leaves', make: () => leaves(505, 0.66), tint: 'foliage', cutout: true },
  { name: 'dark_oak_leaves', make: () => leaves(506, 0.74), tint: 'foliage', cutout: true },
  { name: 'grass', make: grassPlant, tint: 'grass', cutout: true },
  { name: 'poppy', make: () => POPPY, cutout: true },
  { name: 'dandelion', make: () => DANDELION, cutout: true },
  { name: 'torch', make: () => TORCH, cutout: true },
  { name: 'glass', make: glass, cutout: true },
];
