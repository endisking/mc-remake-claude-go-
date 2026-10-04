/**
 * Original mob textures in the standard per-model box-unwrap layout (see
 * client/src/render/entities/mobmodels.ts for each model's boxes and UV offsets). Every mob is
 * designed here from its own palette and hand-placed features: same roles and silhouettes as
 * the vanilla mobs, but original faces, colours and patterns.
 *
 * Box layout for a w×h×d box at (u, v): top (u+d, v), bottom (u+d+w, v), then a row at v+d of
 * right side (d wide), front (w), left side (d), back (w).
 */
import { Tex, hex, rng, shade, mix, CLEAR, type RGBA } from './lib';

type Paint = (x: number, y: number, w: number, h: number) => RGBA | null;
type FaceName = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';

/** Face rectangles [x, y, w, h] of a box in the unwrap layout. */
export function faceRects(u: number, v: number, w: number, h: number, d: number): Record<FaceName, [number, number, number, number]> {
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + 2 * d + w, v + d, w, h],
  };
}

function rect(t: Tex, x: number, y: number, w: number, h: number, p: Paint): void {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const c = p(i, j, w, h);
      if (c) t.set(x + i, y + j, c);
    }
}

/** Paint every face of a box; per-face painters override the default. */
function box(t: Tex, u: number, v: number, w: number, h: number, d: number, all: Paint, faces: Partial<Record<FaceName, Paint>> = {}): Record<FaceName, [number, number, number, number]> {
  const r = faceRects(u, v, w, h, d);
  for (const k of Object.keys(r) as FaceName[]) {
    const [x, y, fw, fh] = r[k];
    rect(t, x, y, fw, fh, faces[k] ?? all);
  }
  return r;
}

/** Noisy fill around a colour, lit slightly from the top of each face. */
function noisy(c: RGBA, vary: number, seed: number, topLight = 0.08): Paint {
  const r = rng(seed);
  return (_x, y, _w, h) => shade(c, 1 + (r() - 0.5) * vary * 2 + topLight * (0.5 - y / Math.max(1, h - 1)));
}

/** Two-tone blotchy fill (value noise thresholded), used for hides, scales and patches. */
function blotches(a: RGBA, b: RGBA, seed: number, cell: number, threshold: number, vary = 0.06): Paint {
  const r = rng(seed);
  const grid = new Map<string, number>();
  const at = (i: number, j: number) => {
    const k = `${i},${j}`;
    let g = grid.get(k);
    if (g === undefined) grid.set(k, (g = r()));
    return g;
  };
  const r2 = rng(seed + 99);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const n = (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
    return shade(n > threshold ? b : a, 1 + (r2() - 0.5) * vary * 2);
  };
}

const px = (t: Tex, x: number, y: number, c: RGBA) => t.set(x, y, c);
const hline = (t: Tex, x: number, y: number, n: number, c: RGBA) => {
  for (let i = 0; i < n; i++) t.set(x + i, y, c);
};
const vline = (t: Tex, x: number, y: number, n: number, c: RGBA) => {
  for (let i = 0; i < n; i++) t.set(x, y + i, c);
};

// ------------------------------------------------------------------ undead (zombie family)

interface UndeadLook {
  skin: string; skinDark: string; shirt: string; shirtDark: string; pants: string; pantsDark: string;
  eye: string; seed: number; wraps?: string; weeds?: string;
}

/** Humanoid undead: patchy skin, sunken eyes, torn clothes (64×64 humanoid layout). */
function undead(look: UndeadLook, playerLimbs: boolean): Tex {
  const t = new Tex(64, 64);
  const S = hex(look.skin), SD = hex(look.skinDark), SH = hex(look.shirt), SHD = hex(look.shirtDark), P = hex(look.pants), PD = hex(look.pantsDark), E = hex(look.eye);
  const skin = blotches(S, SD, look.seed, 2.6, 0.68, 0.07);
  // head
  const head = box(t, 0, 0, 8, 8, 8, skin);
  const [fx, fy] = head.front;
  // brow ridge and sunken sockets with a pin-prick glow
  hline(t, fx + 1, fy + 2, 6, shade(SD, 0.8));
  for (const ex of [fx + 1, fx + 5]) {
    rect(t, ex, fy + 3, 2, 2, () => shade(SD, 0.45));
  }
  px(t, fx + 2, fy + 4, E);
  px(t, fx + 5, fy + 4, E);
  // nose slits and a crooked, stitched mouth
  px(t, fx + 3, fy + 5, shade(SD, 0.6));
  px(t, fx + 4, fy + 5, shade(SD, 0.6));
  hline(t, fx + 2, fy + 7, 4, shade(SD, 0.4));
  px(t, fx + 5, fy + 6, shade(SD, 0.4));
  px(t, fx + 3, fy + 6, mix(S, hex('#ffffff'), 0.4));
  // scalp: a few dark strands on the top and back
  const r = rng(look.seed + 5);
  const [tx, ty] = head.top;
  for (let i = 0; i < 10; i++) px(t, tx + Math.floor(r() * 8), ty + Math.floor(r() * 8), shade(SD, 0.6));
  // body: torn shirt, skin showing through rips
  const shirt = blotches(SH, SHD, look.seed + 1, 3, 0.62, 0.06);
  const body = box(t, 16, 16, 8, 12, 4, shirt);
  const [bx, by] = body.front;
  rect(t, bx + 5, by + 6, 2, 3, () => S);
  px(t, bx + 6, by + 9, S);
  rect(t, bx + 1, by + 10, 2, 2, () => S);
  hline(t, bx + 2, by, 4, shade(S, 0.9)); // neck
  hline(t, bx, by + 11, 8, shade(SHD, 0.8)); // hem
  px(t, bx + 3, by + 11, CLEAR);
  px(t, bx + 6, by + 11, CLEAR);
  // arms: short sleeves, bare forearms and grey-knuckled hands
  const arm = (u: number, v: number) => {
    const a = box(t, u, v, 4, 12, 4, skin);
    for (const k of ['right', 'front', 'left', 'back'] as const) {
      const [x, y, w] = a[k];
      rect(t, x, y, w, 4, shirt);
      hline(t, x, y + 4, w, shade(SHD, 0.7));
      hline(t, x, y + 11, w, shade(SD, 0.8));
    }
    rect(t, a.bottom[0], a.bottom[1], 4, 4, () => shade(SD, 0.8));
  };
  arm(40, 16);
  if (playerLimbs) arm(32, 48);
  // legs: trousers with a frayed cuff
  const pants = blotches(P, PD, look.seed + 2, 3, 0.6, 0.06);
  const leg = (u: number, v: number) => {
    const l = box(t, u, v, 4, 12, 4, pants);
    for (const k of ['right', 'front', 'left', 'back'] as const) {
      const [x, y, w] = l[k];
      for (let i = 0; i < w; i++) if ((i + u) % 3 === 0) px(t, x + i, y + 9, shade(PD, 0.8));
      rect(t, x, y + 10, w, 2, () => S);
    }
    rect(t, l.bottom[0], l.bottom[1], 4, 4, () => shade(SD, 0.7));
  };
  leg(0, 16);
  if (playerLimbs) leg(16, 48);
  if (look.wraps) {
    // husk: sun-bleached cloth wraps around the head and forearms
    const W = hex(look.wraps);
    for (const k of ['right', 'front', 'left', 'back'] as const) {
      const [x, y, w] = head[k];
      hline(t, x, y, w, W);
      hline(t, x, y + 1, w, shade(W, 0.85));
    }
    rect(t, head.top[0], head.top[1], 8, 8, noisy(W, 0.08, look.seed + 9));
    const a = faceRects(40, 16, 4, 12, 4);
    for (const k of ['right', 'front', 'left', 'back'] as const) {
      const [x, y, w] = a[k];
      for (let j = 6; j < 10; j += 2) hline(t, x, y + j, w, W);
    }
  }
  if (look.weeds) {
    // drowned: strands of kelp clinging to the head and shoulders
    const K = hex(look.weeds);
    for (const k of ['right', 'left', 'back'] as const) {
      const [x, y, w] = head[k];
      for (let i = 0; i < w; i += 3) vline(t, x + i + (look.seed % 2), y, 3 + (i % 4), K);
    }
    vline(t, fx, fy, 3, K);
    vline(t, fx + 7, fy, 2, K);
    rect(t, head.top[0], head.top[1], 8, 8, blotches(K, shade(K, 0.75), look.seed + 3, 2, 0.5));
    const [sx, sy] = body.back;
    vline(t, sx + 2, sy, 5, K);
    vline(t, sx + 5, sy, 3, K);
  }
  return t;
}

export const zombie = () => undead({ skin: '#5f8a4c', skinDark: '#45683a', shirt: '#7a4a32', shirtDark: '#5c3626', pants: '#4b5560', pantsDark: '#3a424b', eye: '#e8e070', seed: 11 }, false);
export const husk = () => undead({ skin: '#a08a5c', skinDark: '#7d6a44', shirt: '#6b5a3a', shirtDark: '#54462c', pants: '#5a4f3e', pantsDark: '#463d30', eye: '#f2c35a', seed: 23, wraps: '#d8ccaa' }, false);
export const drowned = () => undead({ skin: '#4f8f8a', skinDark: '#3a6e6c', shirt: '#2f5a6a', shirtDark: '#244654', pants: '#3e4a6a', pantsDark: '#2f3954', eye: '#7af0d8', seed: 37, weeds: '#3f7a2e' }, true);

// ------------------------------------------------------------------ skeletons

interface BoneLook { bone: string; boneDark: string; hollow: string; seed: number; crack?: boolean }

function skeletonTex(look: BoneLook): Tex {
  const t = new Tex(64, 32);
  const B = hex(look.bone), BD = hex(look.boneDark), HO = hex(look.hollow);
  const bone = noisy(B, 0.05, look.seed);
  const head = box(t, 0, 0, 8, 8, 8, bone);
  const [fx, fy] = head.front;
  // round eye holes (each 2×2 with a ragged corner) and a heart-shaped nose hole
  for (const ex of [fx + 1, fx + 5]) {
    rect(t, ex, fy + 2, 2, 2, () => HO);
    px(t, ex + (ex === fx + 1 ? 0 : 1), fy + 4, HO);
  }
  px(t, fx + 3, fy + 5, HO);
  px(t, fx + 4, fy + 5, HO);
  // teeth: alternating gaps along the jaw
  for (let i = 1; i < 7; i++) px(t, fx + i, fy + 7, i % 2 ? BD : shade(HO, 1.4));
  hline(t, fx + 1, fy + 6, 6, BD);
  if (look.crack) {
    px(t, fx + 6, fy, BD);
    px(t, fx + 6, fy + 1, BD);
    px(t, fx + 7, fy + 1, BD);
  }
  // cheekbone shading on the sides
  for (const k of ['right', 'left'] as const) {
    const [x, y] = head[k];
    hline(t, x + 2, y + 5, 4, BD);
  }
  // body: spine and ribs over a dark hollow
  const body = box(t, 16, 16, 8, 12, 4, () => HO);
  for (const k of ['front', 'back'] as const) {
    const [x, y] = body[k];
    vline(t, x + 3, y, 12, B);
    vline(t, x + 4, y, 12, BD);
    for (let j = 1; j < 8; j += 2) {
      hline(t, x + 1, y + j, 6, B);
      px(t, x, y + j + 1, BD);
      px(t, x + 7, y + j + 1, BD);
    }
    hline(t, x + 1, y + 10, 6, B); // pelvis
    hline(t, x + 2, y + 11, 4, BD);
  }
  for (const k of ['right', 'left'] as const) {
    const [x, y] = body[k];
    for (let j = 1; j < 8; j += 2) hline(t, x, y + j, 4, B);
    hline(t, x, y + 10, 4, B);
  }
  rect(t, body.top[0], body.top[1], 8, 4, (i) => (i === 3 || i === 4 ? B : HO));
  // thin limbs: bone with knobbly joints
  const limb = (u: number, v: number) => {
    const l = box(t, u, v, 2, 12, 2, bone);
    for (const k of ['right', 'front', 'left', 'back'] as const) {
      const [x, y] = l[k];
      hline(t, x, y + 5, 2, BD);
      hline(t, x, y + 6, 2, shade(B, 1.08));
      hline(t, x, y + 11, 2, BD);
    }
  };
  limb(40, 16);
  limb(0, 16);
  return t;
}

export const skeleton = () => skeletonTex({ bone: '#d8d4c4', boneDark: '#a8a290', hollow: '#3a3632', seed: 41, crack: true });
export const stray = () => skeletonTex({ bone: '#cfe0e4', boneDark: '#93aeb6', hollow: '#2c3a40', seed: 43 });
export const witherSkeleton = () => skeletonTex({ bone: '#3a3a3c', boneDark: '#262628', hollow: '#121214', seed: 47, crack: true });

/** Stray clothing layer: a ragged hooded cloak (humanoid layout, 64×32). */
export function strayOverlay(): Tex {
  const t = new Tex(64, 32);
  const C = hex('#5d7478'), CD = hex('#45585c');
  const cloth = blotches(C, CD, 51, 2.5, 0.6, 0.08);
  // hood: top, sides and back only (face open)
  const head = box(t, 0, 0, 8, 8, 8, cloth);
  rect(t, head.front[0], head.front[1], 8, 8, (x, y) => (y < 2 || x === 0 || x === 7 ? cloth(x, y, 8, 8) : CLEAR));
  rect(t, head.bottom[0], head.bottom[1], 8, 8, () => CLEAR);
  // body: cloak with tattered hem and a rope belt
  const body = box(t, 16, 16, 8, 12, 4, cloth);
  for (const k of ['right', 'front', 'left', 'back'] as const) {
    const [x, y, w] = body[k];
    hline(t, x, y + 7, w, hex('#8a7a56'));
    for (let i = 0; i < w; i++) if ((i * 7 + 3) % 5 < 2) px(t, x + i, y + 11, CLEAR);
  }
  // sleeves to the elbow, leggings to the knee
  for (const [u, v, n] of [[40, 16, 6], [0, 16, 7]] as const) {
    const l = box(t, u, v, 4, 12, 4, cloth);
    for (const k of ['right', 'front', 'left', 'back'] as const) {
      const [x, y, w, h] = l[k];
      rect(t, x, y + n, w, h - n, () => CLEAR);
      for (let i = 0; i < w; i++) if ((i + k.length) % 3 === 0) px(t, x + i, y + n, CLEAR);
    }
    rect(t, l.bottom[0], l.bottom[1], 4, 4, () => CLEAR);
  }
  return t;
}

// ------------------------------------------------------------------ creeper

/** The green walking explosive: scaly mottled hide, slit eyes and a jagged grimace. */
export function creeper(): Tex {
  const t = new Tex(64, 32);
  const G = hex('#4f9a3a'), GL = hex('#7cc45a'), GD = hex('#2f6a26'), K = hex('#18240f');
  const r = rng(61);
  const hide: Paint = (x, y) => {
    // diamond scale pattern with random light/dark scales
    const s = ((x + (y % 2)) >> 1) + y * 3;
    const n = Math.abs(Math.sin(s * 12.9898 + 61) * 43758.5453) % 1;
    const base = n > 0.78 ? GL : n < 0.2 ? GD : G;
    return shade(base, 1 + (r() - 0.5) * 0.08);
  };
  const head = box(t, 0, 0, 8, 8, 8, hide);
  const [fx, fy] = head.front;
  // angry slanted eyes (inner corners low) with a pale glint, under a lighter brow plate
  hline(t, fx + 1, fy + 1, 6, shade(GL, 1.05));
  for (const [x, y] of [[1, 2], [2, 2], [1, 3], [2, 3], [3, 3], [6, 2], [5, 2], [6, 3], [5, 3], [4, 3]] as const) px(t, fx + x, fy + y, K);
  px(t, fx + 2, fy + 3, hex('#d8f080'));
  px(t, fx + 5, fy + 3, hex('#d8f080'));
  // a stitched jaw line with interlocking teeth
  hline(t, fx + 1, fy + 6, 6, K);
  for (const x of [2, 4, 6]) px(t, fx + x, fy + 5, K);
  for (const x of [1, 3, 5]) px(t, fx + x, fy + 7, K);
  // body: darker belly stripe
  const body = box(t, 16, 16, 8, 12, 4, hide);
  rect(t, body.front[0] + 2, body.front[1] + 1, 4, 10, (x, y) => shade(GD, 1.05 + ((x + y) % 2) * 0.08));
  // feet: dark toes
  const leg = box(t, 0, 16, 4, 6, 4, hide);
  for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, leg[k][0], leg[k][1] + 5, 4, GD);
  rect(t, leg.bottom[0], leg.bottom[1], 4, 4, () => GD);
  return t;
}

// ------------------------------------------------------------------ spiders

interface SpiderLook { body: string; bodyDark: string; stripe: string; seed: number }

const SPIDER_EYES: [number, number, number][] = [
  // [x, y, size] on the 8×8 head front: two big eyes, four small ones in an arc
  [2, 3, 2], [4, 3, 2], [1, 2, 1], [6, 2, 1], [1, 5, 1], [6, 5, 1],
];

function spiderTex(look: SpiderLook): Tex {
  const t = new Tex(64, 32);
  const B = hex(look.body), BD = hex(look.bodyDark), ST = hex(look.stripe);
  const hair = blotches(B, BD, look.seed, 1.6, 0.55, 0.1);
  const head = box(t, 32, 4, 8, 8, 8, hair);
  const [fx, fy] = head.front;
  for (const [x, y, s] of SPIDER_EYES) rect(t, fx + x, fy + y, s, s, () => hex('#8a1010'));
  // fangs
  px(t, fx + 2, fy + 7, hex('#d8c8a0'));
  px(t, fx + 5, fy + 7, hex('#d8c8a0'));
  box(t, 0, 0, 6, 6, 6, hair);
  // abdomen with a chevron stripe down the back (back face is the top in the unwrap)
  const ab = box(t, 0, 12, 10, 8, 12, hair);
  const [ax, ay] = ab.top;
  for (let j = 1; j < 12; j += 3) {
    for (let i = 0; i < 3; i++) {
      px(t, ax + 4 - i, ay + j + i, ST);
      px(t, ax + 5 + i, ay + j + i, ST);
    }
  }
  // legs: banded joints
  const leg = box(t, 18, 0, 16, 2, 2, hair);
  for (const k of ['front', 'back', 'top', 'bottom'] as const) {
    const [x, y, w, h] = leg[k];
    for (const j of [5, 11]) rect(t, x + j, y, 1, h, () => ST);
    void w;
  }
  return t;
}

export const spider = () => spiderTex({ body: '#3a302c', bodyDark: '#241c1a', stripe: '#6a2a20', seed: 71 });
export const caveSpider = () => spiderTex({ body: '#1f3a44', bodyDark: '#142630', stripe: '#3a8a8a', seed: 73 });

/** Spider eye glow layer: only the eyes, bright red (drawn full-bright). */
export function spiderEyes(): Tex {
  const t = new Tex(64, 32);
  const [fx, fy] = faceRects(32, 4, 8, 8, 8).front;
  for (const [x, y, s] of SPIDER_EYES) {
    rect(t, fx + x, fy + y, s, s, () => hex('#ff2a1a'));
    if (s === 2) px(t, fx + x, fy + y, hex('#ffb0a0'));
  }
  return t;
}

// ------------------------------------------------------------------ farm animals

/** Pink pig: freckled hide, round snout with nostrils, little hooves. */
export function pig(): Tex {
  const t = new Tex(64, 32);
  const P = hex('#e8a0a0'), PD = hex('#d08486'), PL = hex('#f4bcb8');
  const hide = blotches(P, PD, 81, 2.2, 0.72, 0.05);
  const head = box(t, 0, 0, 8, 8, 8, hide);
  const [fx, fy] = head.front;
  // eyes: dark with a light lid, set high and wide
  for (const ex of [fx + 1, fx + 6]) {
    px(t, ex, fy + 3, hex('#2a1a1a'));
    px(t, ex, fy + 2, PL);
  }
  // cheeks
  px(t, fx + 1, fy + 5, shade(PD, 0.95));
  px(t, fx + 6, fy + 5, shade(PD, 0.95));
  // snout (4×3 front at 17,17 within the 16,16 box)
  const sn = box(t, 16, 16, 4, 3, 1, () => PL);
  const [sx, sy] = sn.front;
  px(t, sx + 1, sy + 1, hex('#9a5a5c'));
  px(t, sx + 2, sy + 1, hex('#9a5a5c'));
  hline(t, sx, sy + 2, 4, shade(PL, 0.9));
  // body
  const body = box(t, 28, 8, 10, 16, 8, hide);
  rect(t, body.front[0], body.front[1], 10, 16, noisy(PL, 0.04, 82)); // belly
  // a curl of darker hair along the spine
  vline(t, body.back[0] + 5, body.back[1] + 2, 12, shade(PD, 0.95));
  // legs with dark hooves
  const leg = box(t, 0, 16, 4, 6, 4, hide);
  for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, leg[k][0], leg[k][1] + 5, 4, hex('#7a4a4a'));
  rect(t, leg.bottom[0], leg.bottom[1], 4, 4, () => hex('#6a3e3e'));
  return t;
}

/** Saddle layer for the pig (same layout, inflated mesh): leather seat on the back. */
export function pigSaddle(): Tex {
  const t = new Tex(64, 32);
  const L = hex('#7a4a26'), LD = hex('#5a3418'), M = hex('#b8b0a0');
  const r = faceRects(28, 8, 10, 16, 8);
  // seat across the back (the back face is the animal's top), rows 4..11
  rect(t, r.back[0], r.back[1] + 4, 10, 8, (x, y) => (y === 0 || y === 7 ? LD : x === 0 || x === 9 ? LD : shade(L, 1 + ((x * 3 + y) % 4) * 0.03)));
  // flaps down both sides next to the back, with a buckle
  rect(t, r.left[0] + 4, r.left[1] + 5, 4, 6, (x) => (x === 0 ? LD : L));
  rect(t, r.right[0], r.right[1] + 5, 4, 6, (x) => (x === 3 ? LD : L));
  px(t, r.left[0] + 5, r.left[1] + 8, M);
  px(t, r.right[0] + 2, r.right[1] + 8, M);
  // girth strap under the belly
  rect(t, r.front[0], r.front[1] + 7, 10, 2, () => LD);
  // headstall on the pig's head (head box 0,0 8×8×8, inflated)
  const h = faceRects(0, 0, 8, 8, 8);
  for (const k of ['right', 'left'] as const) vline(t, h[k][0] + 5, h[k][1] + 2, 6, LD);
  hline(t, h.front[0], h.front[1] + 4, 8, LD);
  px(t, h.front[0], h.front[1] + 4, M);
  px(t, h.front[0] + 7, h.front[1] + 4, M);
  return t;
}

/** Cow: chestnut hide with cream patches, pale muzzle, short curved horns, pink udder. */
export function cow(): Tex {
  const t = new Tex(64, 32);
  const C = hex('#7a4a2e'), CD = hex('#5e3822'), W = hex('#e6dcc4'), WD = hex('#cfc3a8');
  const hide = blotches(C, W, 91, 3.4, 0.66, 0.05);
  const head = box(t, 0, 0, 8, 8, 6, blotches(C, CD, 92, 2, 0.6));
  const [fx, fy] = head.front;
  // cream blaze down the face into a wide muzzle
  rect(t, fx + 3, fy, 2, 4, () => W);
  rect(t, fx + 1, fy + 5, 6, 3, (x, y) => (y === 0 && (x === 0 || x === 5) ? null : shade(W, 0.97 + ((x + y) % 2) * 0.03)));
  px(t, fx + 2, fy + 6, hex('#5a3a30'));
  px(t, fx + 5, fy + 6, hex('#5a3a30'));
  // eyes: dark with a lash line
  for (const ex of [fx + 1, fx + 6]) {
    px(t, ex, fy + 3, hex('#1a1210'));
    px(t, ex, fy + 2, CD);
  }
  // horns (22,0 1×3×1)
  box(t, 22, 0, 1, 3, 1, (_x, y) => (y === 0 ? hex('#8a8070') : hex('#d8d0b8')));
  // body + udder
  box(t, 18, 4, 12, 18, 10, hide);
  box(t, 52, 0, 4, 6, 1, (x, y) => ((x + y) % 3 === 0 ? hex('#d88a90') : hex('#eaa4a8')));
  // legs: patched with dark hooves
  const leg = box(t, 0, 16, 4, 12, 4, blotches(C, WD, 93, 2.5, 0.7));
  for (const k of ['right', 'front', 'left', 'back'] as const) {
    hline(t, leg[k][0], leg[k][1] + 10, 4, hex('#3a2a20'));
    hline(t, leg[k][0], leg[k][1] + 11, 4, hex('#2a1e18'));
  }
  rect(t, leg.bottom[0], leg.bottom[1], 4, 4, () => hex('#2a1e18'));
  return t;
}

/** Sheared sheep: cream skin with short stubble, tan face, dark hooves. */
export function sheep(): Tex {
  const t = new Tex(64, 32);
  const S = hex('#d8c8b0'), SD = hex('#c0ae94'), F = hex('#b89a7a'), FD = hex('#9a7e60');
  const head = box(t, 0, 0, 6, 6, 8, noisy(F, 0.05, 101));
  const [fx, fy] = head.front;
  // sleepy eyes with pale lids, dark nose pad and a small mouth
  for (const ex of [fx, fx + 5]) {
    px(t, ex, fy + 2, hex('#2a201a'));
    px(t, ex, fy + 1, mix(F, hex('#ffffff'), 0.35));
  }
  rect(t, fx + 2, fy + 3, 2, 1, () => hex('#5a4034'));
  hline(t, fx + 2, fy + 5, 2, FD);
  // ears on the sides
  for (const k of ['right', 'left'] as const) {
    const [x, y] = head[k];
    hline(t, x + 5, y + 1, 3, FD);
  }
  // body stubble
  box(t, 28, 8, 8, 16, 6, blotches(S, SD, 102, 1.5, 0.55, 0.05));
  const leg = box(t, 0, 16, 4, 12, 4, noisy(S, 0.05, 103));
  for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, leg[k][0], leg[k][1] + 11, 4, hex('#3a2e26'));
  rect(t, leg.bottom[0], leg.bottom[1], 4, 4, () => hex('#3a2e26'));
  return t;
}

/** Wool layer (grey-white, tinted per dye colour at render time): tight curls. */
export function sheepFur(): Tex {
  const t = new Tex(64, 32);
  const W = hex('#f4f4f4'), WD = hex('#d2d2d2'), WS = hex('#b8b8b8');
  const r = rng(111);
  const wool: Paint = (x, y) => {
    // little curl rings: a darker pixel ring every 3×3 cell, offset per row of cells
    const cx = (x + (Math.floor(y / 3) % 2) * 1) % 3, cy = y % 3;
    const n = r();
    if (cx === 1 && cy === 1) return n > 0.5 ? WD : WS;
    return shade(n > 0.85 ? WD : W, 1 + (n - 0.5) * 0.06);
  };
  box(t, 0, 0, 6, 6, 6, wool);
  box(t, 28, 8, 8, 16, 6, wool);
  box(t, 0, 16, 4, 6, 4, wool);
  return t;
}

/** Chicken: white plumage with soft grey edges, short yellow beak, red wattle, orange legs. */
export function chicken(): Tex {
  const t = new Tex(64, 32);
  const W = hex('#f6f4ee'), WD = hex('#d8d4c8'), Y = hex('#e8b030'), YD = hex('#c48a1c'), R = hex('#d43a2a'), O = hex('#e08a2a');
  const feathers = blotches(W, WD, 121, 1.8, 0.7, 0.04);
  const head = box(t, 0, 0, 4, 6, 3, feathers);
  const [fx, fy] = head.front;
  // eyes high on the head with a glint
  px(t, fx, fy + 1, hex('#1a1a1a'));
  px(t, fx + 3, fy + 1, hex('#1a1a1a'));
  // little red comb tuft on the top
  hline(t, head.top[0] + 1, head.top[1], 2, R);
  px(t, head.top[0] + 1, head.top[1] + 1, R);
  // beak and wattle
  box(t, 14, 0, 4, 2, 2, (_x, y) => (y === 0 ? Y : YD));
  box(t, 14, 4, 2, 2, 2, (x, y) => ((x + y) % 3 === 0 ? shade(R, 0.85) : R));
  // body: speckled breast, darker tail end (bottom face is the rear when rotated)
  const body = box(t, 0, 9, 6, 8, 6, feathers);
  rect(t, body.bottom[0], body.bottom[1], 6, 6, (x, y) => ((x + y) % 2 ? WD : shade(WD, 0.9)));
  // wings with layered feather tips
  const wing = box(t, 24, 13, 1, 4, 6, feathers);
  for (const k of ['right', 'left'] as const) hline(t, wing[k][0], wing[k][1] + 3, 6, WD);
  // legs: a thin shank with spread toes (the rest of the 3×5×3 box is see-through)
  box(t, 26, 0, 3, 5, 3, (x) => (x === 1 ? O : CLEAR), {
    front: (x, y) => (y === 4 ? shade(O, 0.85) : x === 1 ? O : CLEAR),
    top: (x, y) => (x === 1 && y === 1 ? O : CLEAR),
    bottom: (x, y) => (x === 1 || y === 1 ? shade(O, 0.85) : CLEAR),
  });
  return t;
}

// ------------------------------------------------------------------ enderman, slime, bat, squid

/** Tall void walker: near-black body with faint violet static. */
export function enderman(): Tex {
  const t = new Tex(64, 32);
  const B = hex('#161418'), BL = hex('#221d28');
  const r = rng(131);
  const body: Paint = () => (r() > 0.9 ? BL : shade(B, 1 + (r() - 0.5) * 0.1));
  const head = box(t, 0, 0, 8, 8, 8, body);
  // dim eye sockets (the glow is the eyes layer)
  const [fx, fy] = head.front;
  for (const [ex, ey] of EYE_PIXELS) px(t, fx + ex, fy + ey, hex('#3a1e48'));
  // jaw (hat layer, inflated −0.5): same body colour, a mouth line on the front
  const jaw = box(t, 0, 16, 8, 8, 8, body);
  hline(t, jaw.front[0] + 2, jaw.front[1] + 6, 4, hex('#0a080c'));
  box(t, 32, 16, 8, 12, 4, body);
  box(t, 56, 0, 2, 30, 2, body);
  return t;
}

/** Enderman eye slits: angled, magenta with a hot core. */
const EYE_PIXELS: [number, number][] = [[1, 4], [2, 4], [2, 3], [3, 3], [6, 4], [5, 4], [5, 3], [4, 3]];

export function endermanEyes(): Tex {
  const t = new Tex(64, 32);
  const [fx, fy] = faceRects(0, 0, 8, 8, 8).front;
  EYE_PIXELS.forEach(([x, y], i) => px(t, fx + x, fy + y, i % 4 === 1 || i % 4 === 2 ? hex('#f4a8ff') : hex('#c040e8')));
  return t;
}

/** Slime: translucent green jelly outer cube, darker core with a face. */
export function slime(): Tex {
  const t = new Tex(64, 32);
  const G = hex('#6cc24a', 150), GL = hex('#9ae070', 160);
  const r = rng(141);
  box(t, 0, 0, 8, 8, 8, (x, y) => (x === 0 || y === 0 ? GL : shade(G, 1 + (r() - 0.5) * 0.08)));
  // inner cube: denser green
  box(t, 0, 16, 6, 6, 6, noisy(hex('#4e9a36'), 0.06, 142));
  // eyes (2×2×2 boxes) and mouth (1×1×1)
  box(t, 32, 0, 2, 2, 2, (x, y) => (x === 1 && y === 0 ? hex('#3a5a2a') : hex('#1a2a12')));
  box(t, 32, 4, 2, 2, 2, (x, y) => (x === 0 && y === 0 ? hex('#3a5a2a') : hex('#1a2a12')));
  box(t, 32, 8, 1, 1, 1, () => hex('#1a2a12'));
  return t;
}

/** Bat: brown furry body, dark leathery wings with finger bones (64×64). */
export function bat(): Tex {
  const t = new Tex(64, 64);
  const F = hex('#4a3a2c'), FD = hex('#362a20'), M = hex('#2a2220'), ML = hex('#3a302c');
  const fur = blotches(F, FD, 151, 1.5, 0.55, 0.08);
  const head = box(t, 0, 0, 6, 6, 6, fur);
  const [fx, fy] = head.front;
  px(t, fx + 1, fy + 2, hex('#e8d050'));
  px(t, fx + 4, fy + 2, hex('#e8d050'));
  px(t, fx + 2, fy + 4, hex('#d8d0c0'));
  px(t, fx + 3, fy + 4, hex('#d8d0c0'));
  box(t, 24, 0, 3, 4, 1, (x, y) => (x === 1 && y > 0 ? hex('#6a4a40') : FD));
  box(t, 0, 16, 6, 12, 6, fur);
  box(t, 0, 34, 10, 6, 1, (x) => (x % 3 === 0 ? ML : M));
  const membrane: Paint = (x, y) => (x % 3 === 0 ? ML : (y + x) % 5 === 0 ? shade(M, 1.1) : M);
  box(t, 42, 0, 10, 16, 1, membrane);
  box(t, 24, 16, 8, 12, 1, membrane);
  return t;
}

/** Squid: deep blue-grey mantle with pale spots and a large original eye. */
export function squid(): Tex {
  const t = new Tex(64, 32);
  const B = hex('#2e4a6a'), BD = hex('#223852'), SP = hex('#5a7a9a');
  const body = box(t, 0, 0, 12, 16, 12, blotches(B, BD, 161, 2.5, 0.6));
  const r = rng(162);
  for (const k of ['right', 'front', 'left', 'back'] as const) {
    const [x, y, w, h] = body[k];
    for (let i = 0; i < 6; i++) px(t, x + Math.floor(r() * w), y + Math.floor(r() * (h - 6)), SP);
  }
  // eyes on the front, low on the mantle: pale ring with a horizontal pupil
  const [fx, fy] = body.front;
  for (const ex of [fx + 1, fx + 8]) {
    rect(t, ex, fy + 11, 3, 3, () => hex('#d8e4ea'));
    hline(t, ex, fy + 12, 3, hex('#101820'));
  }
  box(t, 48, 0, 2, 18, 2, (x, y) => (y % 4 === 3 ? SP : x ? BD : B));
  return t;
}

// ------------------------------------------------------------------ villager family

interface VillagerLook {
  skin: string; skinDark: string; hair: string; eye: string; robe: string; robeDark: string; trim: string; seed: number;
  h?: number; undead?: boolean;
}

/** Villager layout (64×64): tall head with a long nose, robe over a tunic, folded arms. */
function villagerTex(look: VillagerLook, t = new Tex(64, 64)): Tex {
  const S = hex(look.skin), SD = hex(look.skinDark), HA = hex(look.hair), E = hex(look.eye), R = hex(look.robe), RD = hex(look.robeDark), TR = hex(look.trim);
  const skin = look.undead ? blotches(S, SD, look.seed, 2.4, 0.66, 0.07) : noisy(S, 0.04, look.seed);
  const head = box(t, 0, 0, 8, 10, 8, skin);
  const [fx, fy] = head.front;
  // hair: a fringe ring around the sides and back, bald crown
  for (const k of ['right', 'left', 'back'] as const) {
    const [x, y, w] = head[k];
    hline(t, x, y + 1, w, HA);
    hline(t, x, y + 2, w, shade(HA, 0.9));
    if (k === 'back') rect(t, x, y + 3, w, 3, noisy(HA, 0.06, look.seed + 1));
  }
  // separate bushy brows over small round eyes, deep-set under the brow ridge
  hline(t, fx + 1, fy + 3, 2, shade(HA, 0.8));
  hline(t, fx + 5, fy + 3, 2, shade(HA, 0.8));
  px(t, fx + 1, fy + 4, hex('#f0ece0'));
  px(t, fx + 2, fy + 4, E);
  px(t, fx + 5, fy + 4, E);
  px(t, fx + 6, fy + 4, hex('#f0ece0'));
  // mouth and chin shadow below the nose
  hline(t, fx + 3, fy + 8, 2, shade(SD, 0.7));
  hline(t, fx + 2, fy + 9, 4, SD);
  if (look.undead) {
    rect(t, fx + 1, fy + 4, 2, 1, () => shade(SD, 0.5));
    rect(t, fx + 5, fy + 4, 2, 1, () => shade(SD, 0.5));
    px(t, fx + 2, fy + 4, E);
    px(t, fx + 5, fy + 4, E);
  }
  // nose (2×4×2) with a darker tip
  box(t, 24, 0, 2, 4, 2, (_x, y) => (y === 3 ? SD : shade(S, 0.95)));
  // tunic and robe
  const robe = blotches(R, RD, look.seed + 2, 2.5, 0.62, 0.05);
  const body = box(t, 16, 20, 8, 12, 6, robe);
  hline(t, body.front[0] + 2, body.front[1], 4, SD); // collar
  const jacket = box(t, 0, 38, 8, 18, 6, robe);
  for (const k of ['right', 'front', 'left', 'back'] as const) {
    const [x, y, w] = jacket[k];
    hline(t, x, y + 6, w, TR); // sash
    hline(t, x, y + 17, w, shade(RD, 0.8)); // hem
    if (look.undead) for (let i = 0; i < w; i += 3) px(t, x + i, y + 17, CLEAR);
  }
  // front placket with buttons
  vline(t, jacket.front[0] + 4, jacket.front[1] + 7, 10, shade(RD, 0.85));
  for (let j = 8; j < 17; j += 3) px(t, jacket.front[0] + 3, jacket.front[1] + j, TR);
  rect(t, jacket.top[0], jacket.top[1], 8, 6, () => CLEAR);
  // arms: sleeves with hands showing where they meet
  const sleeves = box(t, 44, 22, 4, 8, 4, robe);
  for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, sleeves[k][0], sleeves[k][1] + 7, 4, shade(RD, 0.85));
  rect(t, sleeves.bottom[0], sleeves.bottom[1], 4, 4, () => S);
  const hands = box(t, 40, 38, 8, 4, 4, skin);
  rect(t, hands.front[0], hands.front[1], 8, 4, (x) => (x === 3 || x === 4 ? SD : S));
  // legs: trousers and shoes
  const leg = box(t, 0, 22, 4, 12, 4, noisy(shade(RD, 0.8), 0.05, look.seed + 3));
  for (const k of ['right', 'front', 'left', 'back'] as const) rect(t, leg[k][0], leg[k][1] + 10, 4, 2, () => hex('#3a2e26'));
  return t;
}

export const villager = () => villagerTex({ skin: '#c99a74', skinDark: '#a87a58', hair: '#6a6a66', eye: '#3a6a8a', robe: '#6a5a7a', robeDark: '#54466a', trim: '#c8a05a', seed: 181 });
export const wanderingTrader = () => villagerTex({ skin: '#b88a64', skinDark: '#946a4a', hair: '#3a2e24', eye: '#4a3a24', robe: '#2f4f8a', robeDark: '#243c6c', trim: '#e0c050', seed: 183 });
export function zombieVillager(): Tex {
  const t = villagerTex({ skin: '#5f8a4c', skinDark: '#45683a', hair: '#3a4a30', eye: '#e8e070', robe: '#5a4a3a', robeDark: '#463a2c', trim: '#7a6a4a', seed: 187, undead: true });
  // ZombieVillagerModel arms are 4×12×4 (outstretched): torn sleeves over green forearms
  const S = hex('#5f8a4c'), R = hex('#5a4a3a');
  const arm = box(t, 44, 22, 4, 12, 4, blotches(S, hex('#45683a'), 188, 2.4, 0.66, 0.07));
  for (const k of ['right', 'front', 'left', 'back'] as const) {
    const [x, y, w] = arm[k];
    rect(t, x, y, w, 6, noisy(R, 0.06, 189));
    for (let i = 0; i < w; i += 2) px(t, x + i, y + 6, R);
  }
  return t;
}

/** Witch: villager layout (64×128) plus a crooked four-tier hat and a warty mole. */
export function witch(): Tex {
  const t = new Tex(64, 128);
  villagerTex({ skin: '#a8b49a', skinDark: '#86927a', hair: '#2a2a30', eye: '#8a2aa8', robe: '#3a2a4a', robeDark: '#2a1e38', trim: '#6aa83a', seed: 191 }, t);
  // mole (1×1×1 box at 0,0)
  box(t, 0, 0, 1, 1, 1, () => hex('#4a5a3a'));
  // hat tiers: brim 10×2×10, then 7×4×7, 4×4×4, 1×2×1 tip
  const H = hex('#2a1e30'), HD = hex('#1c1422'), BAND = hex('#8a3a2a');
  box(t, 0, 64, 10, 2, 10, noisy(H, 0.06, 192));
  const t2 = box(t, 0, 76, 7, 4, 7, noisy(H, 0.06, 193));
  for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, t2[k][0], t2[k][1] + 3, 7, BAND);
  px(t, t2.front[0] + 3, t2.front[1] + 3, hex('#d8c050'));
  box(t, 0, 87, 4, 4, 4, noisy(HD, 0.06, 194));
  box(t, 0, 95, 1, 2, 1, () => HD);
  return t;
}

/** Illagers: grey-skinned villager layout with a 20-tall coat and free arms (40,46). */
function illagerTex(look: VillagerLook, extra?: (t: Tex) => void): Tex {
  const t = villagerTex(look);
  const R = hex(look.robe), RD = hex(look.robeDark), TR = hex(look.trim), S = hex(look.skin);
  const robe = blotches(R, RD, look.seed + 7, 2.5, 0.62, 0.05);
  const coat = box(t, 0, 38, 8, 20, 6, robe);
  for (const k of ['right', 'front', 'left', 'back'] as const) {
    const [x, y, w] = coat[k];
    hline(t, x, y + 7, w, TR);
    hline(t, x, y + 19, w, shade(RD, 0.75));
  }
  rect(t, coat.top[0], coat.top[1], 8, 6, () => CLEAR);
  const arm = box(t, 40, 46, 4, 12, 4, robe);
  for (const k of ['right', 'front', 'left', 'back'] as const) {
    const [x, y, w] = arm[k];
    rect(t, x, y + 9, w, 3, noisy(S, 0.04, look.seed + 8));
    hline(t, x, y + 8, w, TR);
  }
  rect(t, arm.bottom[0], arm.bottom[1], 4, 4, () => S);
  extra?.(t);
  return t;
}

export const pillager = () => illagerTex({ skin: '#8a8f92', skinDark: '#6c7174', hair: '#2a2622', eye: '#3a7a5a', robe: '#4a4038', robeDark: '#3a322c', trim: '#7a5a3a', seed: 211 });
export const vindicator = () => illagerTex({ skin: '#8a8f92', skinDark: '#6c7174', hair: '#1e1c1a', eye: '#2a6a4a', robe: '#3a3a44', robeDark: '#2c2c34', trim: '#5a3a2a', seed: 213 });
export const evoker = () => illagerTex({ skin: '#8a8f92', skinDark: '#6c7174', hair: '#d8d8d0', eye: '#3a7a5a', robe: '#1e1e22', robeDark: '#141418', trim: '#c8a040', seed: 217 }, (t) => {
  // gold embroidery down the robe front
  const [x, y] = faceRects(0, 38, 8, 20, 6).front;
  for (let j = 9; j < 19; j += 2) { px(t, x + 2, y + j, hex('#c8a040')); px(t, x + 5, y + j, hex('#c8a040')); }
});

/** Iron golem (128×128): riveted pale metal, rust streaks, moss tufts, amber eyes. */
export const illusioner = () => illagerTex({ skin: '#8a8f92', skinDark: '#6c7174', hair: '#2a2a3a', eye: '#4a6ad8', robe: '#2a3a6a', robeDark: '#1e2c54', trim: '#a8b8e0', seed: 219 });

/** Vex (64×64 humanoid layout): small pale-blue spirit with translucent-looking wings. */
export function vex(): Tex {
  const t = new Tex(64, 64);
  const B = hex('#a8c0d8'), BD = hex('#8aa4c0'), K = hex('#2a3448');
  const body: Paint = blotches(B, BD, 391, 1.6, 0.6, 0.05);
  const head = box(t, 0, 0, 8, 8, 8, body);
  const [fx, fy] = head.front;
  rect(t, fx + 1, fy + 3, 2, 2, () => K);
  rect(t, fx + 5, fy + 3, 2, 2, () => K);
  px(t, fx + 2, fy + 3, hex('#f0f8ff'));
  px(t, fx + 5, fy + 3, hex('#f0f8ff'));
  hline(t, fx + 3, fy + 6, 2, K);
  box(t, 16, 16, 8, 12, 4, body);
  box(t, 40, 16, 4, 12, 4, body);
  box(t, 32, 0, 6, 10, 4, (x, y) => ((x + y) % 3 === 0 ? BD : B));
  box(t, 0, 32, 20, 12, 1, (x, y) => (x % 5 === 0 || y === 0 ? hex('#d8e8f8') : hex('#b8d0ec', 190)));
  return t;
}

export function ironGolem(): Tex {
  const t = new Tex(128, 128);
  const M = hex('#cfc8bc'), MD = hex('#a8a094'), RU = hex('#a8623a'), MO = hex('#4f7a32');
  const metal: Paint = blotches(M, MD, 221, 3, 0.66, 0.05);
  const r = rng(222);
  const dress = (f: [number, number, number, number], rivets: boolean) => {
    const [x, y, w, h] = f;
    if (rivets) for (let j = 2; j < h; j += 5) { px(t, x + 1, y + j, shade(MD, 0.8)); px(t, x + w - 2, y + j, shade(MD, 0.8)); }
    for (let i = 0; i < Math.max(1, (w * h) / 40); i++) {
      // rust streak running down
      const sx = x + Math.floor(r() * w), sy = y + Math.floor(r() * h), n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) px(t, sx, sy + k, k === 0 ? RU : shade(RU, 1.1));
    }
    for (let i = 0; i < Math.max(1, (w * h) / 90); i++) {
      const mx = x + Math.floor(r() * w), my = y + Math.floor(r() * h);
      px(t, mx, my, MO);
      px(t, mx + 1, my, shade(MO, 1.15));
      if (my + 1 < y + h) px(t, mx, my + 1, shade(MO, 0.85));
    }
  };
  const head = box(t, 0, 0, 8, 10, 8, metal);
  const [fx, fy] = head.front;
  hline(t, fx, fy + 3, 8, shade(MD, 0.75)); // heavy brow
  rect(t, fx + 1, fy + 4, 2, 1, () => hex('#2a2018'));
  rect(t, fx + 5, fy + 4, 2, 1, () => hex('#2a2018'));
  px(t, fx + 2, fy + 4, hex('#f0b030'));
  px(t, fx + 5, fy + 4, hex('#f0b030'));
  hline(t, fx + 2, fy + 8, 4, shade(MD, 0.7)); // mouth slot
  box(t, 24, 0, 2, 4, 2, metal);
  const body = box(t, 0, 40, 18, 12, 11, metal);
  for (const k of ['front', 'back', 'right', 'left'] as const) dress(body[k], true);
  // chest plate seams
  vline(t, body.front[0] + 9, body.front[1] + 1, 10, shade(MD, 0.8));
  hline(t, body.front[0] + 2, body.front[1] + 6, 14, shade(MD, 0.85));
  box(t, 0, 70, 9, 5, 6, metal);
  for (const [u, v] of [[60, 21], [60, 58]] as const) {
    const arm = box(t, u, v, 4, 30, 6, metal);
    for (const k of ['front', 'back', 'right', 'left'] as const) {
      dress(arm[k], false);
      hline(t, arm[k][0], arm[k][1] + 12, arm[k][2], shade(MD, 0.75)); // elbow joint
    }
    rect(t, arm.bottom[0], arm.bottom[1], 4, 6, () => shade(MD, 0.8));
  }
  for (const u of [37, 60]) {
    const leg = box(t, u, 0, 6, 16, 5, metal);
    for (const k of ['front', 'back', 'right', 'left'] as const) {
      dress(leg[k], false);
      hline(t, leg[k][0], leg[k][1] + 7, leg[k][2], shade(MD, 0.8));
    }
  }
  return t;
}

/** Wolf: sandy coat with a smoky grey saddle, pale muzzle and dark nose. */
export function wolf(): Tex {
  const t = new Tex(64, 32);
  const F = hex('#c8b08a'), FD = hex('#a8906c'), G = hex('#6a6460'), W = hex('#ece4d4');
  const fur = blotches(F, FD, 231, 1.6, 0.6, 0.06);
  const head = box(t, 0, 0, 6, 6, 4, fur);
  const [fx, fy] = head.front;
  px(t, fx + 1, fy + 2, hex('#2a1e14'));
  px(t, fx + 4, fy + 2, hex('#2a1e14'));
  px(t, fx + 1, fy + 1, G);
  px(t, fx + 4, fy + 1, G);
  rect(t, fx + 2, fy + 3, 2, 3, () => W); // blaze down to the muzzle
  rect(t, head.top[0], head.top[1], 6, 4, blotches(G, shade(G, 0.85), 232, 1.5, 0.5));
  box(t, 16, 14, 2, 2, 1, (x, y) => (y === 1 && x === 0 ? hex('#8a6a5a') : G));
  const snout = box(t, 0, 10, 3, 3, 4, () => W);
  px(t, snout.front[0] + 1, snout.front[1], hex('#1a1414'));
  hline(t, snout.front[0], snout.front[1] + 2, 3, shade(W, 0.85));
  // body: grey saddle along the spine (back face), pale belly (front face)
  const body = box(t, 18, 14, 6, 9, 6, fur);
  rect(t, body.back[0], body.back[1], 6, 9, blotches(G, shade(G, 0.85), 233, 1.5, 0.5));
  rect(t, body.front[0], body.front[1], 6, 9, noisy(W, 0.04, 234));
  for (const k of ['right', 'left'] as const) {
    const [x, y, w, h] = body[k];
    rect(t, k === 'left' ? x + w - 2 : x, y, 2, h, blotches(G, shade(G, 0.85), 235, 1.5, 0.5));
  }
  // mane: thick ruff, grey on top
  const mane = box(t, 21, 0, 8, 6, 7, blotches(F, W, 236, 1.5, 0.65, 0.06));
  rect(t, mane.back[0], mane.back[1], 8, 6, blotches(G, F, 237, 1.5, 0.6));
  // legs and tail
  const leg = box(t, 0, 18, 2, 8, 2, fur);
  for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, leg[k][0], leg[k][1] + 7, 2, W);
  const tail = box(t, 9, 18, 2, 8, 2, fur);
  for (const k of ['right', 'front', 'left', 'back'] as const) { hline(t, tail[k][0], tail[k][1] + 6, 2, G); hline(t, tail[k][0], tail[k][1] + 7, 2, shade(G, 0.8)); }
  return t;
}

/** Phantom: slate-blue leathery flyer with bony wing ribs. */
export function phantom(): Tex {
  const t = new Tex(64, 64);
  const B = hex('#3e4a6e'), BD = hex('#2c3654'), BONE = hex('#a8b0a0'), M = hex('#5a6488');
  const hide = blotches(B, BD, 241, 1.8, 0.6, 0.06);
  const head = box(t, 0, 0, 7, 3, 5, hide);
  hline(t, head.front[0], head.front[1] + 2, 7, BD);
  box(t, 0, 8, 5, 3, 9, hide);
  box(t, 3, 20, 3, 2, 6, hide);
  box(t, 4, 29, 1, 1, 6, () => BD);
  const membrane: Paint = (x, y) => (y % 3 === 0 ? BONE : (x + y) % 4 === 0 ? shade(M, 0.9) : M);
  box(t, 23, 12, 6, 2, 9, hide, { top: membrane, bottom: membrane });
  box(t, 16, 24, 13, 1, 9, hide, { top: membrane, bottom: membrane });
  return t;
}

export function phantomEyes(): Tex {
  const t = new Tex(64, 64);
  const [fx, fy] = faceRects(0, 0, 7, 3, 5).front;
  for (const x of [1, 2, 4, 5]) px(t, fx + x, fy + 1, x === 2 || x === 4 ? hex('#f0ff9a') : hex('#a8e050'));
  return t;
}

/** Mooshroom: brick-red hide with cream patches (cow layout). */
export function mooshroom(): Tex {
  const t = cow();
  const R = hex('#a8302a'), RD = hex('#8a2420');
  // recolour the chestnut to red, keep the cream
  return t.map((c) => {
    const [r, g, b, a] = c;
    if (a === 0 || r + g + b > 520) return c;
    if (r > g * 1.3 && r > 80) return mix(shade(R, (r + g + b) / 300), RD, 0.2);
    return c;
  });
}

/** Cod: speckled olive-brown back fading to a pale belly (32×32). */
export function cod(): Tex {
  const t = new Tex(32, 32);
  const B = hex('#8a7a52'), BD = hex('#6a5c3c'), W = hex('#d8d0b4');
  const side: Paint = (x, y, _w, h) => (y >= h - 1 ? W : ((x * 5 + y * 3) % 7 === 0 ? BD : B));
  box(t, 0, 0, 2, 4, 7, side, { top: noisy(BD, 0.06, 251), bottom: () => W });
  const head = box(t, 11, 0, 2, 4, 3, side, { top: noisy(BD, 0.06, 252), bottom: () => W });
  for (const k of ['right', 'left'] as const) px(t, head[k][0] + 1, head[k][1] + 1, hex('#101010'));
  box(t, 0, 11, 2, 3, 1, () => shade(B, 0.9));
  const fin: Paint = (x) => (x % 2 ? hex('#a89870') : hex('#c0b088'));
  box(t, 22, 1, 2, 0, 2, fin);
  box(t, 22, 4, 2, 0, 2, fin);
  box(t, 22, 3, 0, 4, 4, fin);
  box(t, 20, 10, 0, 1, 6, fin);
  return t;
}

/** Salmon: silver-red flanks with a dark back and spotted tail (32×32). */
export function salmon(): Tex {
  const t = new Tex(32, 32);
  const R = hex('#b8483a'), RD = hex('#8a3028'), S = hex('#c8c0b8'), D = hex('#4a3a3a');
  const side: Paint = (x, y, _w, h) => (y === 0 ? D : y >= h - 1 ? S : (x + y) % 5 === 0 ? RD : R);
  box(t, 0, 0, 3, 5, 8, side, { top: noisy(D, 0.08, 261), bottom: () => S });
  box(t, 0, 13, 3, 5, 8, side, { top: noisy(D, 0.08, 262), bottom: () => S });
  const head = box(t, 22, 0, 2, 4, 3, side, { top: () => D });
  for (const k of ['right', 'left'] as const) px(t, head[k][0] + 1, head[k][1] + 1, hex('#101010'));
  const fin: Paint = (x, y) => ((x + y) % 3 === 0 ? D : RD);
  box(t, 20, 10, 0, 5, 6, fin);
  box(t, 2, 26, 0, 2, 3, fin);
  box(t, 8, 26, 0, 2, 4, fin);
  box(t, 22, 22, 2, 0, 2, fin);
  box(t, 26, 22, 2, 0, 2, fin);
  return t;
}

interface HorseLook { coat: string; coatDark: string; mane: string; muzzle: string; hoof: string; seed: number; bones?: boolean; stripes?: boolean }

/** Horse family (64×64 horse layout): coat, mane, muzzle, socks; skeleton horses show ribs. */
function horseTex(look: HorseLook): Tex {
  const t = new Tex(64, 64);
  const C = hex(look.coat), CD = hex(look.coatDark), M = hex(look.mane), MU = hex(look.muzzle), HO = hex(look.hoof);
  const coat = blotches(C, CD, look.seed, 2.2, 0.7, 0.05);
  const body = box(t, 0, 32, 10, 10, 22, coat);
  if (look.bones) {
    for (const k of ['right', 'left'] as const) {
      const [x, y, w, h] = body[k];
      for (let i = 3; i < w - 3; i += 3) vline(t, x + i, y + 2, h - 4, shade(CD, 0.7));
    }
  }
  if (look.stripes) {
    for (const k of ['right', 'left', 'top'] as const) {
      const [x, y, w, h] = body[k];
      for (let i = 1; i < w; i += 4) rect(t, x + i, y, 1, h, () => shade(CD, 0.85));
    }
  }
  box(t, 0, 35, 4, 12, 7, coat);
  const head = box(t, 0, 13, 6, 5, 7, coat);
  for (const k of ['right', 'left'] as const) px(t, head[k][0] + 2, head[k][1] + 2, hex('#141010'));
  const mouth = box(t, 0, 25, 4, 5, 5, () => MU);
  px(t, mouth.front[0] + 1, mouth.front[1] + 1, shade(MU, 0.6));
  px(t, mouth.front[0] + 2, mouth.front[1] + 1, shade(MU, 0.6));
  box(t, 56, 36, 2, 16, 2, blotches(M, shade(M, 0.8), look.seed + 1, 1.5, 0.5));
  box(t, 19, 16, 2, 3, 1, coat);
  box(t, 0, 12, 2, 7, 1, coat);
  const leg = box(t, 48, 21, 4, 11, 4, coat);
  for (const k of ['right', 'front', 'left', 'back'] as const) {
    rect(t, leg[k][0], leg[k][1] + 7, 4, 2, () => (look.bones ? shade(C, 0.9) : MU));
    rect(t, leg[k][0], leg[k][1] + 9, 4, 2, () => HO);
  }
  box(t, 42, 36, 3, 14, 4, blotches(M, shade(M, 0.8), look.seed + 2, 1.5, 0.5));
  return t;
}

export const horse = () => horseTex({ coat: '#8a5a34', coatDark: '#74482a', mane: '#2a1e18', muzzle: '#c8a888', hoof: '#3a2e26', seed: 271 });
export const donkey = () => horseTex({ coat: '#7a746c', coatDark: '#66605a', mane: '#3a3632', muzzle: '#c8c0b4', hoof: '#2a2622', seed: 273 });
export const mule = () => horseTex({ coat: '#5a3c26', coatDark: '#4a301e', mane: '#1e1612', muzzle: '#a88c70', hoof: '#2a2018', seed: 275, stripes: true });
export const skeletonHorse = () => horseTex({ coat: '#d8d4c4', coatDark: '#a8a290', mane: '#8a8678', muzzle: '#e8e4d8', hoof: '#6a665c', seed: 277, bones: true });
export const zombieHorse = () => horseTex({ coat: '#4f7a44', coatDark: '#3a5c34', mane: '#2a3a24', muzzle: '#6a8a5a', hoof: '#2a2a22', seed: 279 });

/** Cat / ocelot (64×32 feline layout). */
function felineTex(base: string, dark: string, spots: string, seed: number): Tex {
  const t = new Tex(64, 32);
  const B = hex(base), D = hex(dark), S = hex(spots);
  const fur = blotches(B, D, seed, 1.6, 0.62, 0.06);
  const head = box(t, 0, 0, 5, 4, 5, fur);
  const [fx, fy] = head.front;
  px(t, fx + 1, fy + 1, hex('#5ab040'));
  px(t, fx + 3, fy + 1, hex('#5ab040'));
  box(t, 0, 24, 3, 2, 2, () => shade(B, 1.1));
  box(t, 0, 10, 1, 1, 2, () => D);
  box(t, 6, 10, 1, 1, 2, () => D);
  const body = box(t, 20, 0, 4, 16, 6, fur);
  for (const k of ['right', 'left', 'back'] as const) {
    const [x, y, w, h] = body[k];
    for (let j = 1; j < h; j += 3) for (let i = (j % 2); i < w; i += 3) px(t, x + i, y + j, S);
  }
  box(t, 0, 15, 1, 8, 1, (_x, y) => (y % 3 === 0 ? S : B));
  box(t, 4, 15, 1, 8, 1, (_x, y) => (y % 3 === 0 ? S : B));
  box(t, 8, 13, 2, 6, 2, fur);
  box(t, 40, 0, 2, 10, 2, fur);
  return t;
}

export const cat = () => felineTex('#8a8278', '#6e6860', '#4a4642', 281);
export const ocelot = () => felineTex('#d8b060', '#c09848', '#5a3a1a', 283);

/** Polar bear (128×64): cream-white shaggy fur, dark nose and claws. */
export function polarBear(): Tex {
  const t = new Tex(128, 64);
  const W = hex('#ece8dc'), WD = hex('#d4cec0');
  const fur = blotches(W, WD, 291, 1.8, 0.62, 0.05);
  const head = box(t, 0, 0, 7, 7, 7, fur);
  px(t, head.front[0] + 1, head.front[1] + 2, hex('#1a1612'));
  px(t, head.front[0] + 5, head.front[1] + 2, hex('#1a1612'));
  const mouth = box(t, 0, 44, 5, 3, 3, fur);
  rect(t, mouth.front[0] + 1, mouth.front[1], 3, 1, () => hex('#2a2420'));
  box(t, 26, 0, 2, 2, 1, () => WD);
  box(t, 0, 19, 14, 14, 11, fur);
  box(t, 39, 0, 12, 12, 10, fur);
  for (const [u, v, d] of [[50, 22, 8], [50, 40, 6]] as const) {
    const leg = box(t, u, v, 4, 10, d, fur);
    for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, leg[k][0], leg[k][1] + 9, leg[k][2], WD);
    rect(t, leg.bottom[0], leg.bottom[1], 4, d, (x) => (x % 2 ? hex('#3a3430') : WD));
  }
  return t;
}

/** Snow golem (64×64): packed snow body, twig arms, a carved gourd head with an original face. */
export function snowGolem(): Tex {
  const t = new Tex(64, 64);
  const S = hex('#f2f6f8'), SD = hex('#d4dee4'), P = hex('#d8842a'), PD = hex('#b86a1c'), T = hex('#6a4a2a');
  const gourd: Paint = (x) => (x % 3 === 0 ? PD : P);
  const head = box(t, 0, 0, 8, 8, 8, gourd, { top: (x, y) => (x >= 3 && x <= 4 && y >= 3 && y <= 4 ? hex('#4a6a2a') : PD) });
  const [fx, fy] = head.front;
  const glow = hex('#ffd860'), dark = hex('#3a1e0a');
  rect(t, fx, fy, 8, 8, gourd);
  for (const [x, y] of [[1, 2], [2, 3], [5, 3], [6, 2]] as const) px(t, fx + x, fy + y, dark);
  px(t, fx + 2, fy + 2, glow);
  px(t, fx + 5, fy + 2, glow);
  for (let i = 1; i < 7; i++) px(t, fx + i, fy + 5 + (i % 2), dark);
  box(t, 32, 0, 12, 2, 2, (x) => (x % 4 === 3 ? shade(T, 0.8) : T));
  box(t, 0, 16, 10, 10, 10, blotches(S, SD, 301, 2, 0.6, 0.03));
  box(t, 0, 36, 12, 12, 12, blotches(S, SD, 302, 2, 0.6, 0.03));
  return t;
}

/** Silverfish (64×32): pale grey segmented shell with darker plate edges. */
export function silverfish(): Tex {
  const t = new Tex(64, 32);
  const G = hex('#9a9a9e'), GD = hex('#76767c'), GL = hex('#b8b8bc');
  const plate: Paint = (x, y) => (y === 0 ? GL : x % 3 === 0 ? GD : G);
  for (const [u, v, w, h, d] of [[0, 0, 3, 2, 2], [0, 4, 4, 3, 2], [0, 9, 6, 4, 3], [0, 16, 3, 3, 3], [0, 22, 2, 2, 3], [11, 0, 2, 1, 2], [13, 4, 1, 1, 2]] as const) box(t, u, v, w, h, d, plate);
  box(t, 20, 0, 10, 8, 3, plate);
  box(t, 20, 11, 6, 4, 3, plate);
  box(t, 20, 18, 6, 5, 2, plate);
  return t;
}

/** Endermite (64×32): dark violet-black mite with purple specks. */
export function endermite(): Tex {
  const t = new Tex(64, 32);
  const B = hex('#1e1824'), V = hex('#7a3a9a');
  const r = rng(311);
  const shell: Paint = () => (r() > 0.85 ? V : shade(B, 1 + (r() - 0.5) * 0.2));
  for (const [u, v, w, h, d] of [[0, 0, 4, 3, 2], [0, 5, 6, 4, 5], [0, 14, 3, 3, 1], [0, 18, 1, 2, 1]] as const) box(t, u, v, w, h, d, shell);
  return t;
}

/** Bee (64×64): amber and dark-brown banded body, pale wings, dark legs. */
export function bee(): Tex {
  const t = new Tex(64, 64);
  const Y = hex('#e8b030'), K = hex('#3a2a1a');
  const body = box(t, 0, 0, 7, 7, 10, (x) => (Math.floor(x / 2) % 2 ? K : Y), {
    front: (x, y) => (y === 2 && (x === 1 || x === 5) ? hex('#141010') : y === 2 && (x === 2 || x === 4) ? hex('#f0f0f0') : Y),
    back: (_x, y) => (y % 3 === 0 ? K : Y),
  });
  for (const k of ['top', 'bottom'] as const) {
    const [x, y, w, h] = body[k];
    rect(t, x, y, w, h, (_i, j) => (Math.floor(j / 2) % 2 ? K : Y));
  }
  box(t, 26, 7, 0, 1, 2, () => K);
  box(t, 2, 0, 1, 2, 3, () => K);
  box(t, 2, 3, 1, 2, 3, () => K);
  box(t, 0, 18, 9, 0, 6, (x, y) => ((x + y) % 4 === 0 ? hex('#d8e8f0', 200) : hex('#f0f8ff', 170)));
  for (const v of [1, 3, 5]) box(t, 26, v, 7, 2, 0, (x) => (x % 2 ? K : shade(K, 0.8)));
  return t;
}

/** Rabbit (64×32): grey-brown agouti fur, pale belly and tail, pink-lined ears. */
export function rabbit(): Tex {
  const t = new Tex(64, 32);
  const F = hex('#8a7058'), FD = hex('#6e5844'), W = hex('#e0d4c4');
  const fur = blotches(F, FD, 321, 1.4, 0.6, 0.07);
  box(t, 26, 24, 2, 1, 7, fur);
  box(t, 8, 24, 2, 1, 7, fur);
  box(t, 30, 15, 2, 4, 5, fur);
  box(t, 16, 15, 2, 4, 5, fur);
  const body = box(t, 0, 0, 6, 5, 10, fur);
  rect(t, body.bottom[0], body.bottom[1], 6, 10, noisy(W, 0.04, 322));
  box(t, 8, 15, 2, 7, 2, fur);
  box(t, 0, 15, 2, 7, 2, fur);
  const head = box(t, 32, 0, 5, 4, 5, fur);
  px(t, head.front[0], head.front[1] + 1, hex('#1a1210'));
  px(t, head.front[0] + 4, head.front[1] + 1, hex('#1a1210'));
  hline(t, head.front[0] + 1, head.front[1] + 3, 3, W);
  box(t, 52, 0, 2, 5, 1, fur, { front: (_x, y) => (y > 0 && y < 4 ? hex('#d8a0a0') : F) });
  box(t, 58, 0, 2, 5, 1, fur, { front: (_x, y) => (y > 0 && y < 4 ? hex('#d8a0a0') : F) });
  box(t, 52, 6, 3, 3, 2, () => W);
  box(t, 32, 9, 1, 1, 1, () => hex('#c88a8a'));
  return t;
}

/** Llama layout (128×64): long neck, fluffy coat. */
function llamaTex(coat: string, dark: string, blanket: string | null, seed: number): Tex {
  const t = new Tex(128, 64);
  const C = hex(coat), D = hex(dark);
  const wool = blotches(C, D, seed, 1.6, 0.62, 0.05);
  const head = box(t, 0, 0, 4, 4, 9, wool);
  px(t, head.front[0], head.front[1] + 1, hex('#1a1612'));
  px(t, head.front[0] + 3, head.front[1] + 1, hex('#1a1612'));
  hline(t, head.front[0] + 1, head.front[1] + 3, 2, shade(D, 0.7));
  box(t, 0, 14, 8, 18, 6, wool);
  box(t, 17, 0, 3, 3, 2, wool);
  const body = box(t, 29, 0, 12, 18, 10, wool);
  if (blanket) {
    const B = hex(blanket);
    rect(t, body.back[0], body.back[1] + 3, 12, 10, (x, y) => ((x + y) % 4 === 0 ? hex('#e8d050') : B));
    for (const k of ['right', 'left'] as const) {
      const [x, y, w] = body[k];
      rect(t, k === 'left' ? x + w - 4 : x, y + 3, 4, 10, (i, j) => ((i + j) % 4 === 0 ? hex('#e8d050') : B));
    }
  }
  const leg = box(t, 29, 29, 4, 14, 4, wool);
  for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, leg[k][0], leg[k][1] + 13, 4, hex('#3a3028'));
  return t;
}

export const llama = () => llamaTex('#d8c8a8', '#c0ae8c', null, 331);
export const traderLlama = () => llamaTex('#a88a64', '#8c7050', '#2f4f8a', 333);

/** Turtle (128×64): olive-green skin and a ridged dark-green shell. */
export function turtle(): Tex {
  const t = new Tex(128, 64);
  const S = hex('#7a9a4a'), SD = hex('#5e7c38'), SH = hex('#3a5a2a'), SL = hex('#5a7a3a');
  const skin = blotches(S, SD, 341, 1.5, 0.6, 0.05);
  const head = box(t, 3, 0, 6, 5, 6, skin);
  px(t, head.front[0] + 1, head.front[1] + 1, hex('#141410'));
  px(t, head.front[0] + 4, head.front[1] + 1, hex('#141410'));
  const shell: Paint = (x, y) => (x % 5 === 0 || y % 5 === 0 ? SH : SL);
  box(t, 7, 37, 19, 20, 6, shell);
  box(t, 31, 1, 11, 18, 3, () => hex('#c8c08a'));
  box(t, 1, 23, 4, 1, 10, skin);
  box(t, 1, 12, 4, 1, 10, skin);
  box(t, 27, 30, 13, 1, 5, skin);
  box(t, 27, 24, 13, 1, 5, skin);
  return t;
}

/** Fox (48×32): russet coat, cream cheeks and chest, dark socks, white-tipped tail. */
export function fox(): Tex {
  const t = new Tex(48, 32);
  const O = hex('#c8662a'), OD = hex('#a8521e'), W = hex('#f0e4d0'), K = hex('#2a201c');
  const fur = blotches(O, OD, 351, 1.5, 0.62, 0.05);
  const head = box(t, 1, 5, 8, 6, 6, fur);
  const [fx, fy] = head.front;
  rect(t, fx, fy + 3, 8, 3, (x) => (x < 2 || x > 5 ? W : O));
  px(t, fx + 2, fy + 2, K);
  px(t, fx + 5, fy + 2, K);
  box(t, 8, 1, 2, 2, 1, (_x, y) => (y === 0 ? K : O));
  box(t, 15, 1, 2, 2, 1, (_x, y) => (y === 0 ? K : O));
  const nose = box(t, 6, 18, 4, 2, 3, () => W);
  px(t, nose.front[0] + 1, nose.front[1], K);
  px(t, nose.front[0] + 2, nose.front[1], K);
  const body = box(t, 24, 15, 6, 11, 6, fur);
  rect(t, body.front[0], body.front[1], 6, 11, noisy(W, 0.04, 352));
  const tail = box(t, 30, 0, 4, 9, 5, fur);
  for (const k of ['right', 'front', 'left', 'back'] as const) rect(t, tail[k][0], tail[k][1] + 7, tail[k][2], 2, () => W);
  for (const u of [13, 4]) {
    const leg = box(t, u, 24, 2, 6, 2, () => K);
    for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, leg[k][0], leg[k][1], 2, OD);
  }
  return t;
}

/** Blaze (64×32): ember-gold head with smouldering eyes, glowing rods. */
export function blaze(): Tex {
  const t = new Tex(64, 32);
  const Y = hex('#e8a830'), YD = hex('#c07a18'), R = hex('#f0d060');
  const head = box(t, 0, 0, 8, 8, 8, blotches(Y, YD, 361, 1.5, 0.6, 0.06));
  const [fx, fy] = head.front;
  rect(t, fx + 1, fy + 3, 2, 1, () => hex('#2a1a0a'));
  rect(t, fx + 5, fy + 3, 2, 1, () => hex('#2a1a0a'));
  px(t, fx + 2, fy + 3, hex('#ff5020'));
  px(t, fx + 5, fy + 3, hex('#ff5020'));
  hline(t, fx + 2, fy + 6, 4, hex('#5a2a0a'));
  box(t, 0, 16, 2, 8, 2, (x, y) => ((x + y) % 3 === 0 ? R : y % 4 === 0 ? YD : Y));
  return t;
}

/** Magma cube (64×32): dark crust slices with lava seams and a glowing core. */
export function magmaCube(): Tex {
  const t = new Tex(64, 32);
  const C = hex('#3a1e14'), L = hex('#f07a1a'), LY = hex('#ffd040');
  const crust: Paint = (x, y) => ((x * 3 + y * 5) % 7 === 0 ? L : C);
  for (let i = 0; i < 8; i++) {
    let u = 0, v = i;
    if (i === 2) [u, v] = [24, 10];
    else if (i === 3) [u, v] = [24, 19];
    box(t, u, v, 8, 1, 8, crust, i === 3 || i === 4 ? { front: (x) => (x === 2 || x === 5 ? LY : C) } : {});
  }
  box(t, 0, 16, 4, 4, 4, (x, y) => ((x + y) % 2 ? LY : L));
  return t;
}

/** Ghast (64×32): pale floating cube, sad closed face; the shooting face opens wide. */
function ghastTex(shooting: boolean): Tex {
  const t = new Tex(64, 32);
  const W = hex('#f0f0ec'), WD = hex('#d8d8d4');
  const body = box(t, 0, 0, 16, 16, 16, blotches(W, WD, 371, 2.5, 0.68, 0.03));
  const [fx, fy] = body.front;
  const K = hex('#3a3a3c'), RED = hex('#a83030');
  if (shooting) {
    rect(t, fx + 3, fy + 5, 3, 3, () => K);
    rect(t, fx + 10, fy + 5, 3, 3, () => K);
    px(t, fx + 4, fy + 6, RED);
    px(t, fx + 11, fy + 6, RED);
    rect(t, fx + 5, fy + 10, 6, 4, (x, y) => (y === 0 || x === 0 || x === 5 ? K : RED));
  } else {
    hline(t, fx + 3, fy + 6, 3, K);
    hline(t, fx + 10, fy + 6, 3, K);
    for (const x of [4, 11]) { px(t, fx + x, fy + 7, hex('#a8c8e8')); px(t, fx + x, fy + 8, hex('#a8c8e8')); }
    hline(t, fx + 6, fy + 11, 4, K);
  }
  return t;
}

/** Piglin family (64×64 player layout): broad snouted head, tusks, leather and gold. */
function piglinTex(skin: string, skinDark: string, cloth: string, gold: boolean, zombie: boolean, seed: number): Tex {
  const t = new Tex(64, 64);
  const S = hex(skin), SD = hex(skinDark), C = hex(cloth), G = hex('#e8c040');
  const hide = zombie ? blotches(S, hex('#6a8a50'), seed, 2.2, 0.62, 0.06) : blotches(S, SD, seed, 2, 0.66, 0.05);
  const head = box(t, 0, 0, 10, 8, 8, hide);
  const [fx, fy] = head.front;
  px(t, fx + 2, fy + 3, hex('#f0e8d8'));
  px(t, fx + 3, fy + 3, hex('#3a1a1a'));
  px(t, fx + 6, fy + 3, hex('#3a1a1a'));
  px(t, fx + 7, fy + 3, hex('#f0e8d8'));
  hline(t, fx + 2, fy + 2, 2, SD);
  hline(t, fx + 6, fy + 2, 2, SD);
  if (zombie) rect(t, fx + 6, fy + 4, 3, 3, () => hex('#d8d0c0')); // exposed skull patch
  const snout = box(t, 31, 1, 4, 4, 1, () => shade(S, 1.08));
  px(t, snout.front[0] + 1, snout.front[1] + 2, SD);
  px(t, snout.front[0] + 2, snout.front[1] + 2, SD);
  box(t, 2, 4, 1, 2, 1, () => hex('#f0e8d0'));
  box(t, 2, 0, 1, 2, 1, () => hex('#f0e8d0'));
  box(t, 51, 6, 1, 5, 4, hide);
  box(t, 39, 6, 1, 5, 4, hide);
  const body = box(t, 16, 16, 8, 12, 4, hide);
  rect(t, body.front[0], body.front[1] + 4, 8, 8, () => C);
  if (gold) hline(t, body.front[0], body.front[1] + 7, 8, G);
  for (const [u, v] of [[40, 16], [32, 48]] as const) box(t, u, v, 4, 12, 4, hide);
  for (const [u, v] of [[0, 16], [16, 48]] as const) {
    const leg = box(t, u, v, 4, 12, 4, () => C);
    for (const k of ['right', 'front', 'left', 'back'] as const) rect(t, leg[k][0], leg[k][1] + 10, 4, 2, () => hex('#3a2a1a'));
  }
  if (gold) {
    // gold arm bands on the sleeve layer
    for (const [u, v] of [[40, 32], [48, 48]] as const) {
      const f = faceRects(u, v, 4, 12, 4);
      for (const k of ['right', 'front', 'left', 'back'] as const) hline(t, f[k][0], f[k][1] + 2, 4, G);
    }
  }
  return t;
}

export const ghast = () => ghastTex(false);
export const ghastShooting = () => ghastTex(true);
export const piglin = () => piglinTex('#e0a088', '#c08070', '#6a4a2a', true, false, 381);
export const piglinBrute = () => piglinTex('#d89080', '#b87060', '#2a2a2e', true, false, 383);
export const zombifiedPiglin = () => piglinTex('#e0a088', '#b88070', '#5a4a3a', false, true, 387);

/** Parrot (32×32): scarlet plumage, blue-and-yellow wings, hooked pale beak. */
export function parrot(): Tex {
  const t = new Tex(32, 32);
  const R = hex('#d02a20'), RD = hex('#a81e18'), B = hex('#2a5ab8'), Y = hex('#e8c030'), K = hex('#d8d0c0');
  box(t, 2, 8, 3, 6, 3, blotches(R, RD, 401, 1.2, 0.6, 0.05));
  box(t, 22, 1, 3, 4, 1, (_x, y) => (y > 1 ? B : R));
  box(t, 19, 8, 1, 5, 3, (x, y) => (y > 2 ? B : x === 1 ? Y : R));
  const head = box(t, 2, 2, 2, 3, 2, () => R);
  for (const k of ['right', 'left'] as const) px(t, head[k][0] + 1, head[k][1] + 1, hex('#101010'));
  box(t, 10, 0, 2, 1, 4, () => RD);
  box(t, 11, 7, 1, 2, 1, () => K);
  box(t, 16, 7, 1, 2, 1, () => shade(K, 0.8));
  box(t, 2, 18, 0, 5, 4, (x) => (x % 2 ? R : RD));
  box(t, 14, 18, 1, 2, 1, () => hex('#5a5a5a'));
  return t;
}

/** Dolphin (64×64): blue-grey back, pale belly, dark eye stripe. */
export function dolphin(): Tex {
  const t = new Tex(64, 64);
  const G = hex('#6a7e94'), GD = hex('#56687c'), W = hex('#d8dee4');
  const skin = blotches(G, GD, 411, 2.2, 0.66, 0.04);
  const body = box(t, 22, 0, 8, 7, 13, skin);
  rect(t, body.bottom[0], body.bottom[1], 8, 13, noisy(W, 0.03, 412));
  for (const k of ['right', 'left'] as const) {
    const [x, y, w, h] = body[k];
    rect(t, x, y + h - 2, w, 2, () => W);
  }
  box(t, 51, 0, 1, 4, 5, () => GD);
  box(t, 48, 20, 1, 4, 7, () => GD);
  const tail = box(t, 0, 19, 4, 5, 11, skin);
  rect(t, tail.bottom[0], tail.bottom[1], 4, 11, () => W);
  box(t, 19, 20, 10, 1, 6, () => GD);
  const head = box(t, 0, 0, 8, 7, 6, skin);
  for (const k of ['right', 'left'] as const) {
    px(t, head[k][0] + 3, head[k][1] + 3, hex('#141820'));
    hline(t, head[k][0], head[k][1] + 5, 6, W);
  }
  rect(t, head.front[0], head.front[1] + 5, 8, 2, () => W);
  box(t, 0, 13, 2, 2, 4, (_x, y) => (y === 1 ? W : G));
  return t;
}

// ------------------------------------------------------------------ misc layers

/** Charged creeper energy swirl (tileable, scrolled and drawn additively). */
export function creeperArmor(): Tex {
  const t = new Tex(64, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) {
      // interference of two diagonal waves, tileable on 64×32
      const a = Math.sin(((x + y * 2) / 64) * Math.PI * 4) + Math.sin(((x * 2 - y) / 32) * Math.PI * 2);
      const v = Math.max(0, a) / 2;
      const c = v > 0.55 ? hex('#a8c8ff') : v > 0.3 ? hex('#5a78d8') : v > 0.12 ? hex('#2a3a8a') : hex('#000000', 0);
      t.set(x, y, c);
    }
  return t;
}

/** Glow squid: teal mantle with bright cyan spots (drawn again full-bright). */
export function glowSquid(): Tex {
  const t = new Tex(64, 32);
  const B = hex('#1a6a6a'), BD = hex('#124e52'), G = hex('#7af0e0');
  const body = box(t, 0, 0, 12, 16, 12, blotches(B, BD, 201, 2.5, 0.6));
  const r = rng(202);
  for (const k of ['right', 'front', 'left', 'back', 'top'] as const) {
    const [x, y, w, h] = body[k];
    for (let i = 0; i < 8; i++) px(t, x + Math.floor(r() * w), y + Math.floor(r() * (h - 5)), G);
  }
  const [fx, fy] = body.front;
  for (const ex of [fx + 1, fx + 8]) {
    rect(t, ex, fy + 11, 3, 3, () => hex('#e0fff8'));
    hline(t, ex, fy + 12, 3, hex('#0a2a2a'));
  }
  box(t, 48, 0, 2, 18, 2, (x, y) => (y % 4 === 3 ? G : x ? BD : B));
  return t;
}

/** Placeholder for mobs without a model yet: a plain crate-like box with two eyes. */
export function unknownMob(): Tex {
  const t = new Tex(64, 32);
  const C = hex('#8a8a8a');
  const f = box(t, 0, 0, 16, 16, 16, (x, y, w, h) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? shade(C, 0.7) : shade(C, 1 + ((x * 7 + y * 3) % 5) * 0.02)));
  rect(t, f.front[0] + 4, f.front[1] + 5, 2, 3, () => hex('#1a1a1a'));
  rect(t, f.front[0] + 10, f.front[1] + 5, 2, 3, () => hex('#1a1a1a'));
  return t;
}

// ------------------------------------------------------------------ shadow, poof

/** Entity blob shadow: a soft dark disc (alpha falls off toward the edge). */
export function shadow(): Tex {
  const t = new Tex(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5) / 8;
      const a = d >= 1 ? 0 : Math.min(1, (1 - d) * 2.2);
      t.set(x, y, [0, 0, 0, Math.round(a * 255)]);
    }
  return t;
}

/** Poof particle: 8 frames (8×8 each) shrinking from a full puff to a wisp. */
export function poof(): Tex {
  const t = new Tex(64, 8);
  const L = hex('#ffffff'), M = hex('#dcdcdc'), D = hex('#a8a8a8');
  for (let f = 0; f < 8; f++) {
    const rad = 3.9 - f * 0.45;
    const r = rng(171 + f);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const dx = x - 3.5, dy = y - 3.5;
        const d = Math.hypot(dx, dy) + (r() - 0.5) * 0.6;
        if (d > rad) continue;
        const lit = dx + dy < -1 ? L : dx + dy > 2 ? D : M;
        t.set(f * 8 + x, y, lit);
      }
  }
  return t;
}

/** Boats (128×64, BoatModel UV layout): horizontal planks in each wood's colours, dark rims, seeded grain. */
const BOAT_PALETTES: Record<string, [string, string, string]> = {
  oak: ['#a8864f', '#8a6a3a', '#5e4524'],
  spruce: ['#7a5a36', '#624628', '#3e2c18'],
  birch: ['#d8c88c', '#bba96c', '#8a7a4a'],
  jungle: ['#a8784e', '#8a5e3a', '#5a3c24'],
  acacia: ['#b8643a', '#9a4e2a', '#66321a'],
  dark_oak: ['#4e3420', '#3c2716', '#24170c'],
};
function boatTex(wood: string): () => Tex {
  return () => {
    const [L, M, D] = BOAT_PALETTES[wood]!.map(hex) as [RGBA, RGBA, RGBA];
    const t = new Tex(128, 64);
    const r = rng(0xb0a7 + wood.length * 31 + wood.charCodeAt(0));
    for (let y = 0; y < 64; y++) {
      // planks 4 px tall with a dark seam; staggered butt joints every 16 px
      const row = y >> 2, seam = (y & 3) === 3;
      for (let x = 0; x < 128; x++) {
        const joint = ((x + (row % 2) * 8) & 15) === 15;
        const grain = r();
        const c = seam || joint ? D : grain < 0.18 ? M : grain > 0.93 ? shade(L, 1.08) : L;
        t.set(x, y, c);
      }
    }
    return t;
  };
}

export const ENTITY_TEXTURES: Record<string, () => Tex> = {
  boat_oak: boatTex('oak'), boat_spruce: boatTex('spruce'), boat_birch: boatTex('birch'), boat_jungle: boatTex('jungle'), boat_acacia: boatTex('acacia'), boat_dark_oak: boatTex('dark_oak'),
  zombie, husk, drowned, skeleton, stray, wither_skeleton: witherSkeleton, stray_overlay: strayOverlay,
  creeper, spider, cave_spider: caveSpider, spider_eyes: spiderEyes, pig, pig_saddle: pigSaddle, cow, sheep, sheep_fur: sheepFur,
  chicken, enderman, enderman_eyes: endermanEyes, slime, bat, squid,
  glow_squid: glowSquid, creeper_armor: creeperArmor, villager, wandering_trader: wanderingTrader, witch, zombie_villager: zombieVillager,
  unknown: unknownMob,
  blaze, magma_cube: magmaCube, ghast, ghast_shooting: ghastShooting, piglin, piglin_brute: piglinBrute, zombified_piglin: zombifiedPiglin, dolphin, parrot, rabbit, fox, llama, trader_llama: traderLlama, turtle, polar_bear: polarBear, snow_golem: snowGolem, silverfish, endermite, bee, horse, donkey, mule, skeleton_horse: skeletonHorse, zombie_horse: zombieHorse, cat, ocelot, cod, salmon, pillager, vindicator, evoker, illusioner, vex, iron_golem: ironGolem, wolf, phantom, phantom_eyes: phantomEyes, mooshroom,
};
