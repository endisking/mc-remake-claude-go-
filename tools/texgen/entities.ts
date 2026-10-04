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
  rect(t, head.front[0], head.front[1], 8, 8, (x, y) => (y < 2 || x === 0 || x === 7 ? cloth(x, y, 8, 8) : null));
  rect(t, head.bottom[0], head.bottom[1], 8, 8, () => null);
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
      rect(t, x, y + n, w, h - n, () => null);
      for (let i = 0; i < w; i++) if ((i + k.length) % 3 === 0) px(t, x + i, y + n, CLEAR);
    }
    rect(t, l.bottom[0], l.bottom[1], 4, 4, () => null);
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
  // tall slanted slit eyes with a pale glint, set wide
  for (const [ex, dir] of [[fx + 1, 1], [fx + 5, -1]] as const) {
    vline(t, ex, fy + 2, 3, K);
    vline(t, ex + 1, fy + 2, 3, K);
    px(t, ex + (dir > 0 ? 1 : 0), fy + 1, K);
    px(t, ex + (dir > 0 ? 0 : 1), fy + 2, hex('#c8f070'));
  }
  // jagged zigzag grimace across the lower face
  const mouth: [number, number][] = [[1, 6], [2, 5], [3, 6], [4, 5], [5, 6], [6, 5], [1, 7], [3, 7], [5, 7], [6, 6]];
  for (const [mx, my] of mouth) px(t, fx + mx, fy + my, K);
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
  px(t, fx, fy + 2, hex('#1a1a1a'));
  px(t, fx + 3, fy + 2, hex('#1a1a1a'));
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
  // legs: orange with toes
  const leg = box(t, 26, 0, 3, 5, 3, (_x, y) => (y > 3 ? shade(O, 0.85) : O));
  rect(t, leg.top[0], leg.top[1], 3, 3, () => null);
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

export const ENTITY_TEXTURES: Record<string, () => Tex> = {
  zombie, husk, drowned, skeleton, stray, wither_skeleton: witherSkeleton, stray_overlay: strayOverlay,
  creeper, spider, cave_spider: caveSpider, spider_eyes: spiderEyes, pig, pig_saddle: pigSaddle, cow, sheep, sheep_fur: sheepFur,
  chicken, enderman, enderman_eyes: endermanEyes, slime, bat, squid,
};
