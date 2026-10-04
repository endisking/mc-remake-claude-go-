/** Buckets, dyes, spawn eggs, discs, potions, books, maps, compass/clock frames and other items. */
import { Tex, hex, mix, rng, type Palette, type RGBA } from '../lib';
import { at, mat, maskOf, paintGrid, px, rampOf, shadeMask, fillMask, type Mask } from './lib';
import type { ItemTexDef } from './registry';
import { TIERS } from './tools';

// ------------------------------------------------------------------ buckets

const BUCKET: Mask = maskOf([
  '................',
  '................',
  '................',
  '...##########...',
  '..############..',
  '..############..',
  '...##########...',
  '...##########...',
  '....########....',
  '....########....',
  '....########....',
  '.....######.....',
  '.....######.....',
]);

function bucket(fill: Palette | null, extra?: (t: Tex) => void): Tex {
  const t = new Tex();
  shadeMask(t, BUCKET, TIERS.iron!, { seed: 801, dither: 0 });
  // handle
  px(t, '2,2 3,1 4,0 5,0 10,0 11,0 12,1 13,2', '#8e8e94');
  for (let x = 6; x < 10; x++) t.set(x, 0, hex('#8e8e94'));
  // opening
  for (let x = 4; x < 12; x++) t.set(x, 4, fill ? fill[2]! : hex('#4a4a50'));
  for (let x = 3; x < 13; x++) t.set(x, 3, TIERS.iron![0]!);
  if (fill) {
    px(t, '5,4 6,4', fill[4]!);
    px(t, '9,4 10,4', fill[1]!);
    for (let x = 4; x < 12; x++) t.set(x, 5, fill[1]!);
  }
  extra?.(t);
  return t;
}

const WATER = mat('#10285a', '#1e4aa8', '#2e66d8', '#5a8af0', '#a8c8ff');
const LAVA = mat('#5a1000', '#b83a00', '#f06a00', '#ff9a20', '#ffe070');
const MILK = mat('#a8a8a8', '#dcdcdc', '#f0f0f0', '#fafafa', '#ffffff');
const POWDER = mat('#a8b8c8', '#d8e4f0', '#eef4fa', '#f8fbff', '#ffffff');

function fishBucket(body: string, accent: string): Tex {
  return bucket(WATER, (t) => {
    px(t, '6,6 7,6 8,6 9,6 6,7 7,7 8,7 9,7 10,7 11,6 11,8', body);
    px(t, '7,7', accent);
  });
}

// ------------------------------------------------------------------ dyes (a little cloth pouch of pigment)

export const DYE_COLORS: Record<string, string> = {
  white: '#f9fffe', orange: '#f9801d', magenta: '#c74ebd', light_blue: '#3ab3da', yellow: '#fed83d', lime: '#80c71f',
  pink: '#f38baa', gray: '#474f52', light_gray: '#9d9d97', cyan: '#169c9c', purple: '#8932b8', blue: '#3c44aa',
  brown: '#835432', green: '#5e7c16', red: '#b02e26', black: '#1d1d21',
};

const DYE_MASK = maskOf([
  '................',
  '................',
  '................',
  '......####......',
  '.......##.......',
  '.....######.....',
  '....########....',
  '...##########...',
  '...##########...',
  '...##########...',
  '...##########...',
  '....########....',
  '.....######.....',
]);

function dye(color: string): Tex {
  const t = new Tex();
  const p = rampOf(color, 5, color === '#1d1d21' ? 0.5 : 0.45, color === '#f9fffe' ? 1.0 : 1.45);
  if (color === '#f9fffe') p.splice(0, 5, ...mat('#8a9090', '#c8d0d0', '#e8eeee', '#f4fafa', '#ffffff'));
  if (color === '#1d1d21') p.splice(0, 5, ...mat('#050508', '#141418', '#222228', '#34343c', '#50505a'));
  shadeMask(t, DYE_MASK, p, { seed: 811, dither: 0.1 });
  // tied neck
  px(t, '6,4 7,4 8,4 9,4', '#c8b088');
  px(t, '6,3 9,3', '#e0cca8');
  px(t, '5,7 6,6', p[4]!);
  return t;
}

// ------------------------------------------------------------------ spawn eggs (vanilla egg colours)

export const EGG_COLORS: Record<string, [number, number]> = {
  axolotl: [0xfbc1e3, 0xa62d74], bat: [0x4c3e30, 0x0f0f0f], bee: [0xedc343, 0x43241b], blaze: [0xf6b201, 0xfff87e],
  cat: [0xefc88e, 0x957256], cave_spider: [0x0c424e, 0xa80e0e], chicken: [0xa1a1a1, 0xff0000], cod: [0xc1a76a, 0xe5c48b],
  cow: [0x443626, 0xa1a1a1], creeper: [0x0da70b, 0x000000], dolphin: [0x223b4d, 0xf9f9f9], donkey: [0x534539, 0x867566],
  drowned: [0x8ff1d7, 0x799c65], elder_guardian: [0xceccba, 0x747693], enderman: [0x161616, 0x000000], endermite: [0x161616, 0x6e6e6e],
  evoker: [0x959b9b, 0x1e1c1a], fox: [0xd5b69f, 0xcc6920], ghast: [0xf9f9f9, 0xbcbcbc], glow_squid: [0x095656, 0x85f1bc],
  goat: [0xa5947c, 0x55493e], guardian: [0x5a8272, 0xf17d30], hoglin: [0xc66e55, 0x5f6464], horse: [0xc09e7d, 0xeee500],
  husk: [0x797061, 0xe6cc94], llama: [0xc09e7d, 0x995f40], magma_cube: [0x340000, 0xfcfc00], mooshroom: [0xa00f10, 0xb7b7b7],
  mule: [0x1b0200, 0x51331d], ocelot: [0xefde7d, 0x564434], panda: [0xe7e7e7, 0x1b1b22], parrot: [0x0da70b, 0xff0000],
  phantom: [0x43518a, 0x88ff00], pig: [0xf0a5a2, 0xdb635f], piglin: [0x995f40, 0xf9f3a4], piglin_brute: [0x592a10, 0xf9f3a4],
  pillager: [0x532f36, 0x959b9b], polar_bear: [0xf2f2f2, 0x959590], pufferfish: [0xf6b201, 0x37c3f2], rabbit: [0x995f40, 0x734831],
  ravager: [0x757470, 0x5b5049], salmon: [0xa00f10, 0x0e8474], sheep: [0xe7e7e7, 0xffb5b5], shulker: [0x946794, 0x4d3852],
  silverfish: [0x6e6e6e, 0x303030], skeleton: [0xc1c1c1, 0x494949], skeleton_horse: [0x68684f, 0xe5e5d8], slime: [0x51a03e, 0x7ebf6e],
  spider: [0x342d27, 0xa80e0e], squid: [0x223b4d, 0x708899], stray: [0x617677, 0xddeaea], strider: [0x9c3436, 0x4d494d],
  trader_llama: [0xeaa430, 0x456296], tropical_fish: [0xef6915, 0xfff9ef], turtle: [0xe7e7e7, 0x00afaf], vex: [0x7a90a4, 0xe8edf1],
  villager: [0x563c33, 0xbd8b72], vindicator: [0x959b9b, 0x275e61], wandering_trader: [0x456296, 0xeaa430], witch: [0x340000, 0x51a03e],
  wither_skeleton: [0x141414, 0x474d4d], wolf: [0xd7d3d3, 0xceaf96], zoglin: [0xc66e55, 0xe6e6e6], zombie: [0x00afaf, 0x799c65],
  zombie_horse: [0x315234, 0x97c284], zombie_villager: [0x563c33, 0x799c65], zombified_piglin: [0xea9393, 0x4c7129],
};

const EGG: Mask = maskOf([
  '................',
  '................',
  '......####......',
  '.....######.....',
  '....########....',
  '....########....',
  '...##########...',
  '...##########...',
  '...##########...',
  '...##########...',
  '...##########...',
  '....########....',
  '.....######.....',
]);
/** Spot layout (original): speckles in the secondary colour. */
const EGG_SPOTS = '7,3 8,4 5,5 10,6 11,7 6,8 7,8 4,9 9,10 10,10 8,12 5,11';

function hexOf(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

function spawnEgg(primary: number, secondary: number): Tex {
  const t = new Tex();
  const base = hexOf(primary);
  const p = rampOf(base, 5, 0.5, 1.35);
  shadeMask(t, EGG, p, { seed: 821, dither: 0 });
  const s = rampOf(hexOf(secondary), 3, 0.7, 1.15);
  for (const pt of EGG_SPOTS.split(' ')) {
    const [x, y] = pt.split(',').map(Number) as [number, number];
    t.set(x, y, s[1]!);
  }
  px(t, '6,3 5,4', p[4]!);
  return t;
}

// ------------------------------------------------------------------ music discs

const DISC_LABELS: Record<string, string> = {
  '13': '#e8d040', cat: '#4ad040', blocks: '#e86a2a', chirp: '#d83a3a', far: '#8ad83a', mall: '#7a5ae0', mellohi: '#e070e0',
  stal: '#2a2a2a', strad: '#f0f0f0', ward: '#3aa86a', '11': '#5a5a5a', wait: '#3ab8e0', pigstep: '#d8902a',
};

function disc(label: string, cracked = false): Tex {
  const t = new Tex();
  const m = maskOf([
    '................',
    '................',
    '.....######.....',
    '....########....',
    '...##########...',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
    '.....######.....',
  ]);
  shadeMask(t, m, mat('#08080a', '#16161a', '#202026', '#34343c', '#5a5a66'), { seed: 831, dither: 0 });
  // grooves
  px(t, '4,5 3,7 3,9 4,11 11,4 12,6 12,9 11,11', '#2c2c34');
  // label
  const l = rampOf(label, 3, 0.7, 1.2);
  px(t, '6,6 7,6 8,6 9,6 6,7 9,7 6,8 9,8 6,9 7,9 8,9 9,9', l[1]!);
  px(t, '7,7 8,8', l[2]!);
  px(t, '8,7 7,8', '#0a0a0a');
  px(t, '6,6', l[2]!);
  if (cracked) px(t, '10,3 9,4 10,5 11,10 12,11', '#000000');
  return t;
}

// ------------------------------------------------------------------ bottles

const BOTTLE: Mask = maskOf([
  '................',
  '................',
  '......####......',
  '.......##.......',
  '.......##.......',
  '......####......',
  '.....######.....',
  '....########....',
  '...##########...',
  '...##########...',
  '...##########...',
  '...##########...',
  '....########....',
  '.....######.....',
]);

function bottle(liquid: string | null, opts: { splash?: boolean; lingering?: boolean; sparkle?: boolean } = {}): Tex {
  const t = new Tex();
  // glass outline + empty interior
  const glass = mat('#5a6a7a', '#a8b8c8', '#d8e4f0', '#e8f0f8', '#ffffff');
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (!at(BOTTLE, x, y)) continue;
      const edge = !at(BOTTLE, x - 1, y) || !at(BOTTLE, x + 1, y) || !at(BOTTLE, x, y - 1) || !at(BOTTLE, x, y + 1);
      if (edge) t.set(x, y, glass[1]!);
    }
  // cork
  px(t, '6,2 7,2 8,2 9,2', '#9a6a3a');
  px(t, '7,1 8,1', '#b8844a');
  if (opts.splash) px(t, '5,6 10,6 4,7 11,7', glass[2]!);
  if (liquid) {
    const l = rampOf(liquid, 5, 0.55, 1.35);
    for (let y = 7; y < 14; y++)
      for (let x = 0; x < 16; x++) {
        if (!at(BOTTLE, x, y)) continue;
        const edge = !at(BOTTLE, x - 1, y) || !at(BOTTLE, x + 1, y) || !at(BOTTLE, x, y + 1);
        if (edge) continue;
        t.set(x, y, l[y === 7 ? 3 : x <= 5 ? 3 : x >= 11 ? 1 : 2]!);
      }
    px(t, '5,9 5,10', l[4]!);
    if (opts.lingering) px(t, '7,5 8,4 9,5', l[3]!);
  }
  px(t, '4,9 4,10', glass[4]!);
  if (opts.sparkle) px(t, '9,9 7,11 10,11 8,8', '#fffbe0');
  return t;
}

// ------------------------------------------------------------------ books, paper goods

function book(cover: Palette, extra?: (t: Tex) => void): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '...#########....',
    '..##########....',
    '..###########...',
    '..###########...',
    '..###########...',
    '..###########...',
    '..###########...',
    '..###########...',
    '..###########...',
    '..###########...',
    '..##########....',
    '...########.....',
  ]), cover, { seed: 841, dither: 0 });
  // pages on the right edge
  for (let y = 4; y < 13; y++) t.set(12, y, hex(y % 2 ? '#f0ecdc' : '#d8d2bc'));
  // spine
  for (let y = 3; y < 13; y++) t.set(3, y, cover[1]!);
  extra?.(t);
  return t;
}

function map(filled: boolean): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
  ]), mat('#6a5a3a', '#c8b48a', '#e4d4a8', '#f0e4c0', '#faf2dc'), { seed: 851, dither: 0.1 });
  if (filled) {
    const r = rng(852);
    for (let y = 3; y < 13; y++)
      for (let x = 4; x < 12; x++) {
        const v = Math.sin(x * 0.9 + y * 0.4) + Math.cos(y * 0.8 - x * 0.3) + r() * 0.6;
        t.set(x, y, hex(v > 1 ? '#6a9a4a' : v > 0 ? '#a8c070' : v > -0.8 ? '#e4d4a8' : '#5a8ad0'));
      }
    px(t, '7,7', '#d02020');
  } else {
    px(t, '5,5 6,5 7,6 8,6 9,5 10,5 5,9 6,10 7,10 8,9 9,9 10,10', '#a8946a');
  }
  return t;
}

// ------------------------------------------------------------------ compass and clock (angle frames)

/** Compass: 32 frames, needle angle frame·(360/32), frame 0 pointing up (north on the sprite). */
function compass(frame: number): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.....######.....',
    '....########....',
    '...##########...',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
    '.....######.....',
  ]), TIERS.iron!, { seed: 861, dither: 0 });
  // face
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 < 15) t.set(x, y, hex('#6a6a70'));
  const a = (frame / 32) * Math.PI * 2;
  const dx = Math.sin(a), dy = -Math.cos(a);
  for (let k = 0; k <= 3; k++) {
    const x = Math.round(7.5 + dx * k * 1.05 - 0.5 + 0.5), y = Math.round(7.5 + dy * k * 1.05 - 0.5 + 0.5);
    t.set(x, y, hex(k === 0 ? '#9a9aa0' : '#e02a2a'));
    const bx = Math.round(7.5 - dx * k * 0.9), by = Math.round(7.5 - dy * k * 0.9);
    if (k > 0 && k < 3) t.set(bx, by, hex('#d8d8e0'));
  }
  return t;
}

/** Clock: 64 frames; frame 0 = noon (sun at the top), the dial turns once per day. */
function clock(frame: number): Tex {
  const t = new Tex();
  const face = maskOf([
    '................',
    '................',
    '.....######.....',
    '....########....',
    '...##########...',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
    '.....######.....',
  ]);
  shadeMask(t, face, TIERS.golden!, { seed: 871, dither: 0 });
  // dial window: upper half shows sky with sun/moon rotating
  const a = (frame / 64) * Math.PI * 2;
  for (let y = 4; y < 12; y++)
    for (let x = 4; x < 12; x++) {
      if ((x - 7.5) ** 2 + (y - 7.5) ** 2 >= 15) continue;
      // rotate the dial: day half and night half
      const ang = Math.atan2(x - 7.5, -(y - 7.5)) - a;
      const day = Math.cos(ang) > 0;
      t.set(x, y, hex(day ? '#4a8ad8' : '#141a3a'));
    }
  // sun and moon on the dial
  const sx = Math.round(7.5 + Math.sin(a) * 2.6 - 0.5), sy = Math.round(7.5 - Math.cos(a) * 2.6 - 0.5);
  px(t, `${sx},${sy} ${sx + 1},${sy} ${sx},${sy + 1} ${sx + 1},${sy + 1}`, '#f8e040');
  const mx = Math.round(7.5 - Math.sin(a) * 2.6 - 0.5), my = Math.round(7.5 + Math.cos(a) * 2.6 - 0.5);
  px(t, `${mx},${my} ${mx + 1},${my} ${mx},${my + 1}`, '#e0e0f0');
  // the fixed lower half of the case covers the dial (only the top half is a window)
  for (let y = 8; y < 12; y++) for (let x = 3; x < 13; x++) if (at(face, x, y) && (x - 7.5) ** 2 + (y - 7.5) ** 2 < 15) t.set(x, y, TIERS.golden![y === 8 ? 1 : 2]!);
  px(t, '7,9 8,9', TIERS.golden![4]!);
  return t;
}

// ------------------------------------------------------------------ vehicles and decorations

function minecart(cargo: ((t: Tex) => void) | null): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '.##############.',
    '.##############.',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
  ]), mat('#2a2a2e', '#56565c', '#76767c', '#96969c', '#c0c0c6'), { seed: 881, dither: 0 });
  for (let x = 2; x < 14; x++) t.set(x, 6, hex('#3a3a40'));
  px(t, '3,11 4,11 3,12 4,12 11,11 12,11 11,12 12,12', '#1e1e22');
  px(t, '3,11 11,11', '#5a5a60');
  cargo?.(t);
  return t;
}

function boat(plank: Palette): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.##............#',
    '.###..........##',
    '.##############.',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
  ]), plank, { seed: 891, dither: 0 });
  for (let x = 3; x < 13; x++) t.set(x, 10, plank[1]!);
  // paddle
  for (let k = 0; k < 6; k++) t.set(9 + k, 7 - k, hex('#6d4a23'));
  px(t, '14,1 15,0 14,0', '#8a6234');
  return t;
}

export const PLANK_RAMPS: Record<string, Palette> = {
  oak: mat('#4a3418', '#8a6a3a', '#a8844c', '#c09a5c', '#d8b474'),
  spruce: mat('#2a1a0a', '#5a3c1f', '#6e4a28', '#7e5a33', '#9a7448'),
  birch: mat('#6a5e3a', '#bcae76', '#ccc086', '#dcd29a', '#ece4b8'),
  jungle: mat('#3a2410', '#7e5739', '#946848', '#a87c58', '#c09474'),
  acacia: mat('#4a200c', '#a1512a', '#b85e32', '#cc6e3e', '#e08a58'),
  dark_oak: mat('#1a0e04', '#3a2510', '#4a3016', '#5a3c1e', '#74502c'),
  crimson: mat('#2a0a18', '#5a2539', '#6e2e46', '#843a56', '#a05070'),
  warped: mat('#0a2a26', '#225750', '#2a6a60', '#327c70', '#4a9a8a'),
};

function frameItem(glow: boolean): Tex {
  const t = new Tex();
  const w = PLANK_RAMPS.birch!;
  shadeMask(t, maskOf(Array(14).fill('.##############.').map((r, i) => (i < 1 ? '................' : r)).concat(['.##############.', '................'])), w, { seed: 901, dither: 0 });
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) t.set(x, y, hex(glow ? '#3a5a4a' : '#7a5a3a'));
  for (let x = 3; x < 13; x++) t.set(x, 3, hex(glow ? '#2a3a32' : '#5a3e24'));
  if (glow) px(t, '1,1 14,1 1,14 14,14 7,0 0,7 15,8 8,15', '#7af0c8');
  return t;
}

function painting(): Tex {
  const t = frameItem(false);
  for (let y = 3; y < 13; y++)
    for (let x = 3; x < 13; x++) t.set(x, y, hex(y < 7 ? '#6aa8e0' : y < 9 ? '#4a8a3a' : '#3a6a2a'));
  px(t, '10,4 11,4 10,5 11,5', '#f8e060');
  px(t, '5,7 6,6 7,7 6,8', '#2a4a1e');
  return t;
}

function saddle(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '..##.......##...',
    '..####...####...',
    '...#########....',
    '...##########...',
    '..###########...',
    '..###########...',
    '...#########....',
  ]), mat('#2a1408', '#5a2e14', '#7a4220', '#9a5a30', '#b87a48'), { seed: 911, dither: 0 });
  px(t, '4,10 4,11 4,12 10,10 10,11 10,12', '#3a2210');
  px(t, '3,13 4,13 5,13 9,13 10,13 11,13', '#8e8e94');
  return t;
}

function lead(): Tex {
  const t = new Tex();
  // a coiled rope: a thick ring with a twisted pattern, the loose end ending in a clasp
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 7, y + 0.5 - 7);
      if (d < 3.4 || d > 6.2) continue;
      const a = Math.atan2(y + 0.5 - 7, x + 0.5 - 7);
      const twist = Math.floor((a / Math.PI) * 8 + d) % 2 === 0;
      const lit = x + y < 13;
      t.set(x, y, hex(d > 5.4 ? '#5a4220' : twist ? (lit ? '#e0c890' : '#b89a60') : lit ? '#c8a870' : '#8a6a3a'));
    }
  px(t, '11,11 12,12 13,12', '#8a6a3a');
  px(t, '12,11 13,13 14,13', '#c8a870');
  px(t, '14,14 15,14 14,15 15,15', '#a8a8b0');
  px(t, '15,15', '#5d5d63');
  return t;
}

function nameTag(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '.....#########..',
    '....##########..',
    '...###########..',
    '..############..',
    '..############..',
    '...###########..',
    '....##########..',
    '.....#########..',
  ]), mat('#5a4a30', '#c8b088', '#e0cca8', '#ece0c4', '#faf2e0'), { seed: 921, dither: 0 });
  px(t, '4,7 4,8', '#3a3020');
  px(t, '0,6 1,7 2,7 1,5 0,4', '#c0c0c8');
  for (let x = 7; x < 12; x++) t.set(x, 8, hex('#7a6a50'));
  return t;
}

function armorStand(): Tex {
  const t = new Tex();
  const w = PLANK_RAMPS.oak!;
  const s = maskOf([
    '................',
    '.......##.......',
    '.......##.......',
    '...##########...',
    '...##########...',
    '.......##.......',
    '.......##.......',
    '.....######.....',
    '.....#....#.....',
    '.....#....#.....',
    '.....#....#.....',
    '.....#....#.....',
    '.....#....#.....',
    '..############..',
    '..############..',
  ]);
  shadeMask(t, s, w, { seed: 931, rim: false, dither: 0 });
  fillMask(t, maskOf(['................', '................', '................', '................', '...##########...']), w[1]!);
  px(t, '2,14 3,14 4,14 5,14 6,14 7,14 8,14 9,14 10,14 11,14 12,14 13,14', '#8a8a8a');
  return t;
}

function horseArmor(p: Palette): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '...........###..',
    '..........#####.',
    '.........######.',
    '..##########.##.',
    '.###########....',
    '.###########....',
    '.###########....',
    '..##########....',
    '..##.....##.....',
    '..##.....##.....',
  ]), p, { seed: 941, dither: 0 });
  px(t, '12,3 13,4', '#202020');
  return t;
}

function endCrystal(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '....########....',
    '.....######.....',
    '......####......',
    '.......##.......',
  ]), mat('#5a1e5a', '#b04ab0', '#e07ae0', '#f4a8f4', '#ffe0ff'), { seed: 951, dither: 0 });
  shadeMask(t, maskOf(['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '...##########...', '..############..', '..############..', '...##########...']), mat('#0a0a0e', '#1e1e26', '#2a2a34', '#3a3a46', '#50505e'), { seed: 952 });
  return t;
}

function fireCharge(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '.....######.....',
    '....########....',
    '...##########...',
    '...##########...',
    '...##########...',
    '...##########...',
    '....########....',
    '.....######.....',
  ]), mat('#0a0606', '#2a1810', '#3e2414', '#5a341c', '#7a4a28'), { seed: 961, dither: 0.2 });
  px(t, '5,5 9,6 6,8 10,9 7,7 4,8', '#f07a10');
  px(t, '6,5 9,7 5,8', '#ffd040');
  return t;
}

function firework(star: boolean): Tex {
  const t = new Tex();
  if (star) {
    shadeMask(t, maskOf(['................', '................', '................', '.....######.....', '....########....', '...##########...', '...##########...', '...##########...', '...##########...', '....########....', '.....######.....']), mat('#1e1e1e', '#3a3a3a', '#505050', '#686868', '#848484'), { seed: 971, dither: 0.4 });
    px(t, '6,6 9,5 7,8 10,8 5,9', '#d8d8d8');
    return t;
  }
  shadeMask(t, maskOf([
    '................',
    '................',
    '.......##.......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
  ]), mat('#5a0a0a', '#a81a1a', '#d02a2a', '#e85050', '#ff9a9a'), { seed: 972, dither: 0 });
  for (let x = 6; x < 10; x++) t.set(x, 6, hex('#f0f0f0'));
  px(t, '7,11 7,12 8,13 7,14', '#8a6234');
  px(t, '7,1 8,0', '#d8d8d8');
  return t;
}

function bannerPattern(motif: string): Tex {
  const t = new Tex();
  shadeMask(t, maskOf(Array(14).fill('...##########...').concat(['................'])), mat('#6a5a3a', '#c8b48a', '#e4d4a8', '#f0e4c0', '#faf2dc'), { seed: 981, dither: 0.1 });
  const ink = '#4a3a2a';
  const shapes: Record<string, string> = {
    flower: '7,4 8,4 6,5 9,5 7,6 8,6 7,7 8,7 7,8 7,9 8,10 6,11',
    creeper: '5,4 6,4 9,4 10,4 5,5 6,5 9,5 10,5 7,6 8,6 6,7 7,7 8,7 9,7 6,8 9,8',
    skull: '6,4 7,4 8,4 9,4 5,5 10,5 5,6 6,6 9,6 10,6 5,7 10,7 6,8 7,8 8,8 9,8 6,10 9,10 7,11 8,11',
    thing: '7,3 8,3 6,4 9,4 5,5 7,5 8,5 10,5 5,6 10,6 6,7 9,7 7,8 8,8 7,10 8,10',
    globe: '6,4 7,4 8,4 9,4 5,5 10,5 5,6 7,6 10,6 5,7 8,7 10,7 5,8 10,8 6,9 7,9 8,9 9,9',
    piglin: '5,5 10,5 6,6 7,6 8,6 9,6 6,7 9,7 6,8 7,8 8,8 9,8 7,9 8,9',
  };
  px(t, shapes[motif]!, ink);
  return t;
}

function totem(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '.##############.',
    '.##############.',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '......####......',
    '......####......',
    '.....##..##.....',
  ]), mat('#5a3a05', '#b5800e', '#e2b827', '#f6dc4e', '#fff8b8'), { seed: 991, dither: 0 });
  px(t, '6,2 9,2', '#1a8a5a');
  px(t, '7,4 8,4', '#7a5205');
  return t;
}

function snowball(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf(['................', '................', '................', '.....######.....', '....########....', '...##########...', '...##########...', '...##########...', '...##########...', '....########....', '.....######.....']), mat('#9aa8b8', '#d0dcea', '#e8f0f8', '#f6fafe', '#ffffff'), { seed: 1001, dither: 0.1 });
  return t;
}

function bundle(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '.....######.....',
    '......####......',
    '....########....',
    '...##########...',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
  ]), mat('#3e2210', '#6e3f1f', '#8f5530', '#a86a3e', '#c1844f'), { seed: 1011, dither: 0.1 });
  px(t, '6,4 7,4 8,4 9,4', '#e0cca8');
  return t;
}

function debugStick(): Tex {
  const t = new Tex();
  for (let x = 3; x <= 12; x++) {
    t.set(x, 15 - x, hex('#c040c0'));
    t.set(x, 16 - x, hex('#802080'));
  }
  return t;
}

function experienceBottle(): Tex {
  const t = bottle('#a8e040', { sparkle: true });
  return t;
}

// ------------------------------------------------------------------ export

export const POTION_DEFAULT = '#385dc6'; // water bottle colour (PotionUtils default for water)

export const miscItems: ItemTexDef[] = [
  { name: 'bucket', make: () => bucket(null) },
  { name: 'water_bucket', make: () => bucket(WATER) },
  { name: 'lava_bucket', make: () => bucket(LAVA) },
  { name: 'milk_bucket', make: () => bucket(MILK) },
  { name: 'powder_snow_bucket', make: () => bucket(POWDER) },
  { name: 'cod_bucket', make: () => fishBucket('#b0a07a', '#101010') },
  { name: 'salmon_bucket', make: () => fishBucket('#c84a3a', '#101010') },
  { name: 'tropical_fish_bucket', make: () => fishBucket('#f08a20', '#f8f8f8') },
  { name: 'pufferfish_bucket', make: () => fishBucket('#e4c020', '#5a7a2a') },
  { name: 'axolotl_bucket', make: () => fishBucket('#f4a0c8', '#a62d74') },
  ...Object.entries(DYE_COLORS).map(([n, c]): ItemTexDef => ({ name: `${n}_dye`, make: () => dye(c) })),
  ...Object.entries(EGG_COLORS).map(([n, [a, b]]): ItemTexDef => ({ name: `${n}_spawn_egg`, make: () => spawnEgg(a, b) })),
  ...Object.entries(DISC_LABELS).map(([n, c]): ItemTexDef => ({ name: `music_disc_${n}`, make: () => disc(c, n === '11') })),
  { name: 'glass_bottle', make: () => bottle(null) },
  { name: 'potion', make: () => bottle(POTION_DEFAULT) },
  { name: 'splash_potion', make: () => bottle(POTION_DEFAULT, { splash: true }) },
  { name: 'lingering_potion', make: () => bottle(POTION_DEFAULT, { lingering: true }) },
  { name: 'experience_bottle', make: experienceBottle },
  { name: 'dragon_breath', make: () => bottle('#c060a0', { lingering: true }) },
  { name: 'honey_bottle', make: () => bottle('#f0a020') },
  { name: 'book', make: () => book(mat('#2a1408', '#5a2e14', '#7a4220', '#9a5a30', '#b87a48')) },
  { name: 'writable_book', make: () => book(mat('#2a1408', '#5a2e14', '#7a4220', '#9a5a30', '#b87a48'), (t) => {
    for (let k = 0; k < 7; k++) t.set(7 + k, 8 - k, hex(k < 1 ? '#202020' : '#f0f0f0'));
    px(t, '13,1 14,0', '#1a1a1a');
  }) },
  { name: 'written_book', make: () => book(mat('#2a1408', '#5a2e14', '#7a4220', '#9a5a30', '#b87a48'), (t) => px(t, '5,5 6,5 7,5 8,5 9,5 5,7 6,7 7,7 8,7', '#e8c040')) },
  { name: 'enchanted_book', make: () => book(mat('#2a0a1a', '#6a1a3e', '#8a2a54', '#a84070', '#d070a0'), (t) => px(t, '6,5 8,6 7,8 9,9 5,10', '#e8c040')) },
  { name: 'knowledge_book', make: () => book(mat('#2a0a0a', '#7a1a1a', '#a02a2a', '#c04040', '#e07070'), (t) => px(t, '6,6 7,6 8,6 7,7 7,8', '#e8c040')) },
  { name: 'map', make: () => map(false) },
  { name: 'filled_map', make: () => map(true) },
  ...Array.from({ length: 32 }, (_, i): ItemTexDef => ({ name: `compass_${String(i).padStart(2, '0')}`, make: () => compass(i) })),
  ...Array.from({ length: 64 }, (_, i): ItemTexDef => ({ name: `clock_${String(i).padStart(2, '0')}`, make: () => clock(i) })),
  { name: 'minecart', make: () => minecart(null) },
  { name: 'chest_minecart', make: () => minecart((t) => paintGrid(t, ['.cccccccccccc.', '.cCCCCCCCCCCc.', '.cCCCCkCCCCCc.'], { c: '#5a3a1a', C: '#a8783a', k: '#c0c0c0' }, 1, 2)) },
  { name: 'furnace_minecart', make: () => minecart((t) => paintGrid(t, ['.ssssssssssss.', '.sSSSffSSSSSs.', '.sSSSffSSSSSs.'], { s: '#3a3a3a', S: '#7a7a7a', f: '#f07a10' }, 1, 2)) },
  { name: 'tnt_minecart', make: () => minecart((t) => paintGrid(t, ['.rrrrrrrrrrrr.', '.rRRwwwwwwRRr.', '.rRRRRRRRRRRr.'], { r: '#7a1a10', R: '#d03a2a', w: '#f0f0f0' }, 1, 2)) },
  { name: 'hopper_minecart', make: () => minecart((t) => paintGrid(t, ['.gggggggggggg.', '..gGGGGGGGGg..', '...gGGGGGGg...'], { g: '#2a2a2e', G: '#4a4a50' }, 1, 2)) },
  { name: 'command_block_minecart', make: () => minecart((t) => paintGrid(t, ['.oooooooooooo.', '.oOOOOkkOOOOo.', '.oOOOOOOOOOOo.'], { o: '#6a3a1a', O: '#c08a5a', k: '#e0e0e0' }, 1, 2)) },
  ...Object.entries(PLANK_RAMPS).filter(([n]) => n !== 'crimson' && n !== 'warped').map(([n, p]): ItemTexDef => ({ name: `${n}_boat`, make: () => boat(p) })),
  { name: 'saddle', make: saddle },
  { name: 'lead', make: lead },
  { name: 'name_tag', make: nameTag },
  { name: 'item_frame', make: () => frameItem(false) },
  { name: 'glow_item_frame', make: () => frameItem(true) },
  { name: 'painting', make: painting },
  { name: 'armor_stand', make: armorStand },
  { name: 'leather_horse_armor', make: () => horseArmor(mat('#3e2210', '#6e3f1f', '#8f5530', '#a86a3e', '#c1844f')) },
  { name: 'iron_horse_armor', make: () => horseArmor(TIERS.iron!) },
  { name: 'golden_horse_armor', make: () => horseArmor(TIERS.golden!) },
  { name: 'diamond_horse_armor', make: () => horseArmor(TIERS.diamond!) },
  { name: 'end_crystal', make: endCrystal },
  { name: 'fire_charge', make: fireCharge },
  { name: 'firework_rocket', make: () => firework(false) },
  { name: 'firework_star', make: () => firework(true) },
  { name: 'flower_banner_pattern', make: () => bannerPattern('flower') },
  { name: 'creeper_banner_pattern', make: () => bannerPattern('creeper') },
  { name: 'skull_banner_pattern', make: () => bannerPattern('skull') },
  { name: 'mojang_banner_pattern', make: () => bannerPattern('thing') },
  { name: 'globe_banner_pattern', make: () => bannerPattern('globe') },
  { name: 'piglin_banner_pattern', make: () => bannerPattern('piglin') },
  { name: 'totem_of_undying', make: totem },
  { name: 'snowball', make: snowball },
  { name: 'bundle', make: bundle },
  { name: 'debug_stick', make: debugStick, handheld: true },
];

export { mix, type RGBA };
