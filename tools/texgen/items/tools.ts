/** Tools, weapons and armour for every tier — original sprites shaded from masks. */
import { Tex, hex, type Palette } from '../lib';
import { at, handle, mat, maskFn, maskOf, outlineOutside, paintGrid, px, shadeMask, union, type Mask } from './lib';
import type { ItemTexDef } from './registry';

/** Head/blade material ramps: rim, dark, mid, light, highlight. */
export const TIERS: Record<string, Palette> = {
  wooden: mat('#3a2712', '#6b4a24', '#8b6534', '#a77d46', '#c3985c'),
  stone: mat('#2b2b2d', '#58585b', '#76767a', '#929296', '#b4b4b8'),
  iron: mat('#3d3d40', '#8e8e94', '#c2c2c8', '#dddde2', '#ffffff'),
  golden: mat('#5a3a05', '#b5800e', '#e2b827', '#f6dc4e', '#fff8b8'),
  diamond: mat('#0c3634', '#1d9189', '#38cfc3', '#78ece2', '#dafffb'),
  netherite: mat('#161214', '#362e33', '#4b4146', '#655a5f', '#8b7f84'),
};

/** Stick/handle ramp: rim, dark, mid, light. */
export const STICK = mat('#2a1c0c', '#4d3418', '#6d4a23', '#8f6634');
const NETHERITE_STICK = mat('#1e1410', '#3d2a1e', '#5a3e2a', '#7a5638');

function stickFor(tier: string): Palette {
  return tier === 'netherite' ? NETHERITE_STICK : STICK;
}

// ------------------------------------------------------------------ shapes

/** Sword blade: 4 diagonals wide (rim, highlight, shade, rim) ending in a point at the top-right. */
const SWORD_BLADE: Mask = maskFn((x, y) => {
  const s = x + y, a = x - y;
  if (a < -3 || a > 13) return false;
  if (a >= 12) return s === 15 || s === 16 || (a === 12 && s === 14);
  return s >= 14 && s <= 17;
});
const SWORD_GUARD: Mask = maskFn((x, y) => {
  const s = x + y, a = x - y;
  return (a === -5 || a === -4) && s >= 10 && s <= 21;
});

function sword(tier: string): Tex {
  const t = new Tex();
  const st = stickFor(tier);
  // grip and pommel
  handle(t, 2, 5, st, 15);
  paintGrid(t, ['oo', 'oo'], { o: st[0]! }, 1, 14);
  t.set(2, 14, st[2]!);
  const p = TIERS[tier]!;
  shadeMask(t, SWORD_BLADE, p, { seed: 11, dither: 0 });
  // guard: wooden swords keep a wood guard, others a darker band of the material
  shadeMask(t, SWORD_GUARD, tier === 'wooden' ? STICK.concat([hex('#a77d46')]) : [p[0]!, p[1]!, p[1]!, p[2]!, p[3]!], { seed: 12, dither: 0 });
  // a glint near the tip
  t.set(12, 3, p[4]!);
  return t;
}

const PICK_HEAD = (() => {
  const half = maskOf([
    '................',
    '................',
    '.....######.....',
    '...#########....',
    '..###.....###...',
    '..#.........#...',
  ]);
  // mirror across the handle's diagonal: (x, y) → (15 − y, 15 − x)
  return union(half, maskFn((x, y) => at(half, 15 - y, 15 - x)));
})();

function pickaxe(tier: string): Tex {
  const t = new Tex();
  const p = TIERS[tier]!;
  // head: bevel-shaded band with its outline drawn outside it (keeps a 2 px band readable)
  const head = new Tex();
  shadeMask(head, PICK_HEAD, p, { seed: 21, rim: false, dither: 0 });
  handle(t, 1, 11, stickFor(tier));
  t.over(outlineOutside(head, p[0]!));
  return t;
}

/** Axe head: a broad blade on the upper-left of the handle top, with a short poll behind it. */
const AXE_HEAD = union(
  maskFn((x, y) => {
    const s = x + y, a = x - y;
    return s >= 6 && s <= 14 && Math.abs(a - 5) <= 3.8 - (s - 6) * 0.38;
  }),
  maskFn((x, y) => {
    const s = x + y, a = x - y;
    return s >= 17 && s <= 18 && a >= 6 && a <= 8;
  }),
);

function axe(tier: string): Tex {
  const t = new Tex();
  const p = TIERS[tier]!;
  handle(t, 1, 12, stickFor(tier));
  const head = new Tex();
  shadeMask(head, AXE_HEAD, p, { seed: 31, rim: false, dither: 0 });
  // bright cutting edge down the far side
  for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if (x + y === 6 && at(AXE_HEAD, x, y)) head.set(x, y, p[4]!);
  t.over(outlineOutside(head, p[0]!));
  return t;
}

const SHOVEL_HEAD = maskFn((x, y) => {
  const a = x - y, p = x + y - 15.5;
  const hw = a < 3 ? -1 : a < 5 ? 0.6 : a <= 11 ? 3.1 : a <= 13 ? 2.2 : a <= 14 ? 1 : -1;
  return Math.abs(p) <= hw;
});

function shovel(tier: string): Tex {
  const t = new Tex();
  handle(t, 1, 9, stickFor(tier));
  paintGrid(t, ['oo'], { o: stickFor(tier)[1]! }, 1, 15);
  shadeMask(t, SHOVEL_HEAD, TIERS[tier]!, { seed: 41 });
  return t;
}

const HOE_HEAD = maskOf([
  '................',
  '................',
  '.......######...',
  '......#######...',
  '......##........',
  '......#.........',
  '......#.........',
]);

function hoe(tier: string): Tex {
  const t = new Tex();
  const p = TIERS[tier]!;
  const head = new Tex();
  shadeMask(head, HOE_HEAD, p, { seed: 51, rim: false, dither: 0 });
  handle(t, 1, 11, stickFor(tier));
  t.over(outlineOutside(head, p[0]!));
  return t;
}

// ------------------------------------------------------------------ armour

const ARMOR_MAT: Record<string, Palette> = {
  leather: mat('#3e2210', '#6e3f1f', '#8f5530', '#a86a3e', '#c1844f'),
  chainmail: mat('#2a2a2e', '#5d5d63', '#8a8a91', '#b1b1b8', '#d8d8de'),
  iron: TIERS.iron!,
  golden: TIERS.golden!,
  diamond: TIERS.diamond!,
  netherite: TIERS.netherite!,
  turtle: mat('#14361a', '#2c6a33', '#43914a', '#5fb365', '#93d58f'),
};

const HELMET = maskOf([
  '................',
  '................',
  '................',
  '....########....',
  '...##########...',
  '..############..',
  '..############..',
  '..####....####..',
  '..###......###..',
  '..###......###..',
  '..##........##..',
]);
const CHEST = maskOf([
  '................',
  '................',
  '..####....####..',
  '.######..######.',
  '.##############.',
  '.##############.',
  '.##.########.##.',
  '.##.########.##.',
  '.##.########.##.',
  '....########....',
  '....########....',
  '....########....',
  '....########....',
  '....########....',
]);
const LEGS = maskOf([
  '................',
  '................',
  '...##########...',
  '...##########...',
  '...##########...',
  '...##########...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
]);
const BOOTS = maskOf([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '...####..####...',
  '..#####..#####..',
  '.######..######.',
  '.######..######.',
]);

function armor(m: string, piece: 'helmet' | 'chestplate' | 'leggings' | 'boots'): Tex {
  const t = new Tex();
  const p = ARMOR_MAT[m]!;
  const mask = piece === 'helmet' ? HELMET : piece === 'chestplate' ? CHEST : piece === 'leggings' ? LEGS : BOOTS;
  shadeMask(t, mask, p, { seed: 61 + piece.length });
  // details per piece
  if (piece === 'chestplate') {
    // collar and a centre seam
    px(t, '6,3 7,4 8,4 9,3', p[0]!);
    for (let y = 6; y < 13; y++) if (y % 2 === 0) t.set(8, y, p[1]!);
  } else if (piece === 'leggings') {
    for (let x = 4; x < 12; x++) t.set(x, 4, p[1]!); // belt line
    t.set(8, 3, p[4]!);
  } else if (piece === 'helmet') {
    for (let x = 4; x < 12; x++) t.set(x, 6, p[1]!); // brow band
  } else {
    // sole
    for (const x of [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14]) t.set(x, 12, p[0]!);
  }
  if (m === 'chainmail') {
    // open links: punch a checker of holes into the interior
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (!at(mask, x, y) || !at(mask, x - 1, y) || !at(mask, x + 1, y) || !at(mask, x, y - 1) || !at(mask, x, y + 1)) continue;
        if ((x + y) % 2 === 0 && y % 2 === 1) t.set(x, y, [0, 0, 0, 0]);
        else if ((x + y) % 2 === 0) t.set(x, y, p[1]!);
      }
  }
  if (m === 'leather') {
    // stitching
    if (piece === 'chestplate') px(t, '5,10 5,12 10,10 10,12', p[4]!);
    if (piece === 'boots') px(t, '4,8 11,8', p[4]!);
  }
  if (m === 'turtle') px(t, '5,4 8,4 11,4 6,5 9,5 4,6 7,6 10,6', p[1]!);
  return t;
}

// ------------------------------------------------------------------ ranged + misc tools

/** Bow: limb arc on the left/top with the string on the diagonal; `pull` 0–3 draws an arrow back. */
function bow(pull: number): Tex {
  const t = new Tex();
  const wood = mat('#2e1d0b', '#5a3a17', '#7a5326', '#9a6c35', '#b98a4c');
  const d = pull === 0 ? 0 : pull; // the limbs bend more as the string is pulled
  // limb: arc around (12,12)-ish from the top-right tip (14,1) to the bottom-left tip (1,14)
  const limb = maskFn((x, y) => {
    const cx = 15.5 + d * 0.5, cy = 15.5 + d * 0.5;
    const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const R = 13.6 + d * 0.4;
    return r >= R - 1.6 && r <= R && x + y <= 17 + d && x < 15 && y < 15;
  });
  shadeMask(t, limb, wood, { seed: 71, dither: 0 });
  // grip in the middle of the limb
  px(t, '4,4 5,4 4,5 3,5 5,3', '#c8c8c8');
  px(t, '4,5 5,4', '#8a8a8a');
  // string: from tip to tip, pulled toward the bottom-right
  const tipA: [number, number] = [14 - Math.floor(d / 2), 1 + Math.floor(d / 2)];
  const tipB: [number, number] = [1 + Math.floor(d / 2), 14 - Math.floor(d / 2)];
  const mid: [number, number] = [9 + d, 9 + d];
  const line = (a: [number, number], b: [number, number]) => {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n), y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
      if (t.get(x, y)[3] < 128) t.set(x, y, hex('#e8e8e8'));
    }
  };
  line(tipA, mid);
  line(mid, tipB);
  if (pull > 0) {
    // arrow nocked on the string, pointing to the top-left
    const back = 9 + d;
    for (let k = 0; k <= back - 3; k++) {
      const x = back - k, y = back - k;
      t.set(x, y, hex(k === 0 ? '#e8e8e8' : '#6d4a23'));
    }
    px(t, `${back + 1},${back} ${back},${back + 1}`, '#f0f0f0');
    px(t, '2,2 3,2 2,3', '#9a9a9a');
    t.set(1, 1, hex('#5a5a5a'));
  }
  return t;
}

function arrow(kind: 'arrow' | 'spectral' | 'tipped'): Tex {
  const t = new Tex();
  // shaft from bottom-left fletching to the top-right head
  for (let k = 0; k < 10; k++) {
    t.set(3 + k, 12 - k, hex('#6d4a23'));
    t.set(4 + k, 12 - k, hex('#3e2a12'));
  }
  const head = kind === 'spectral' ? mat('#5a4300', '#a88a10', '#e6c22e', '#fbe66a', '#fffbd0') : mat('#2b2b2d', '#58585b', '#76767a', '#a4a4a8', '#d0d0d4');
  paintGrid(t, [
    '..ab',
    '.abc',
    'abcc',
    '.cc.',
  ], { a: head[1]!, b: head[3]!, c: head[0]! }, 12, 1);
  t.set(14, 1, head[4]!);
  const fl = kind === 'tipped' ? '#e8e8e8' : kind === 'spectral' ? '#f4e9a8' : '#f2f2f2';
  const fd = kind === 'tipped' ? '#9a9a9a' : kind === 'spectral' ? '#c9b34a' : '#b8b8b8';
  paintGrid(t, [
    '.f..',
    'fFf.',
    '.dFf',
    '..d.',
  ], { f: fl, F: fd, d: '#7a7a7a' }, 1, 11);
  px(t, '1,14 2,13 0,15', fd);
  if (kind === 'tipped') {
    // potion tip band baked in a neutral purple (the potion colour is per stack)
    px(t, '11,4 12,3 11,3 12,4 10,5', '#b46ad8');
  }
  return t;
}

function crossbow(state: 'standby' | 'pulling_0' | 'pulling_1' | 'pulling_2' | 'arrow' | 'firework'): Tex {
  const t = new Tex();
  const wood = mat('#2e1d0b', '#5a3a17', '#7a5326', '#9a6c35', '#b98a4c');
  // stock along the diagonal from the bottom-left butt to the top-right
  const stock = maskFn((x, y) => {
    const s = x + y, a = x - y;
    return a >= -13 && a <= 11 && s >= (a < -5 ? 14 : 15) && s <= 16 + (a < -6 ? 1 : 0);
  });
  shadeMask(t, stock, wood, { seed: 81, dither: 0 });
  const pulled = state === 'standby' ? 0 : state === 'pulling_0' ? 1 : state === 'pulling_1' ? 2 : 3;
  const loaded = state === 'arrow' || state === 'firework';
  // limbs: an arc across the stock near its front, bowing toward the top-right
  const A0 = 6;
  const limbs = maskFn((x, y) => {
    const s = x + y, a = x - y;
    if (s < 5 || s > 25) return false;
    const f = A0 + 2.4 - ((s - 15) * (s - 15)) / 26;
    return a >= f - 1.4 && a <= f + 0.5;
  });
  shadeMask(t, limbs, mat('#202024', '#4a4a50', '#707078', '#9a9aa2', '#c8c8d0'), { seed: 82, dither: 0 });
  // string between the limb tips, drawn back toward the butt when pulled or loaded
  const back = loaded ? 3 : pulled;
  for (let s = 6; s <= 24; s++) {
    const tipA = A0 + 2.4 - (81 / 26) - 1.2;
    const a = Math.round(tipA - back * (1 - Math.abs(s - 15) / 9.5) * 1.4);
    if ((s + a) % 2 !== 0) continue;
    const x = (s + a) / 2, y = (s - a) / 2;
    if (t.get(x, y)[3] < 128) t.set(x, y, hex('#e2e2e2'));
  }
  // trigger guard
  px(t, '4,12 5,13 4,13', '#3a3a40');
  if (loaded) {
    for (let k = 0; k < 6; k++) t.set(8 + k, 6 - k + 1, hex(state === 'arrow' ? '#a4a4a8' : '#c8402c'));
    if (state === 'firework') px(t, '13,1 14,1 14,2 13,0', '#f0d040');
    else px(t, '13,1 14,1 14,2', '#e0e0e4');
  }
  return t;
}

function fishingRod(cast: boolean): Tex {
  const t = new Tex();
  for (let x = 1; x <= 13; x++) {
    t.set(x, 15 - x, hex(x < 5 ? '#4d3418' : '#8f6634'));
    if (x < 9) t.set(x, 16 - x, hex('#4d3418'));
  }
  if (!cast) {
    // line hangs from the tip with a bobber
    for (let y = 3; y < 11; y++) t.set(14, y, hex('#d8d8d8'));
    px(t, '13,11 14,11 13,12 14,12', '#e03a2a');
    px(t, '13,11', '#ff8a7a');
    px(t, '13,13 14,13', '#e8e8e8');
  } else {
    t.set(14, 1, hex('#d8d8d8'));
  }
  return t;
}

function stick(): Tex {
  const t = new Tex();
  for (let x = 3; x <= 12; x++) {
    t.set(x, 15 - x, STICK[3]!);
    t.set(x, 16 - x, STICK[1]!);
  }
  t.set(3, 13, STICK[0]!);
  t.set(12, 3, STICK[2]!);
  px(t, '6,9 9,6', STICK[2]!);
  return t;
}

function shears(): Tex {
  const t = new Tex();
  const blade = TIERS.iron!;
  // two crossed blades
  const m1 = maskFn((x, y) => x - y >= -1 && x - y <= 0 && x >= 6 && x <= 13);
  const m2 = maskFn((x, y) => x + y >= 15 && x + y <= 16 && y >= 6 && y <= 13 && x >= 3);
  shadeMask(t, union(m1, m2), blade, { seed: 91, dither: 0 });
  // handles: rings at bottom-left and top-left
  paintGrid(t, [
    '.rrr..',
    'r...r.',
    'r...r.',
    '.rrr..',
  ], { r: '#9a2a1e' }, 0, 1);
  paintGrid(t, [
    '.rrr..',
    'r...r.',
    'r...r.',
    '.rrr..',
  ], { r: '#9a2a1e' }, 1, 11);
  px(t, '4,4 5,5 4,11 5,10', '#6a1a12');
  return t;
}

function flintAndSteel(): Tex {
  const t = new Tex();
  // steel striker: a C-shaped loop
  shadeMask(t, maskOf([
    '................',
    '................',
    '..######........',
    '.########.......',
    '.##....###......',
    '.##.....##......',
    '.##.....##......',
    '.###...###......',
    '..#######.......',
    '...#####........',
  ]), TIERS.iron!, { seed: 101, dither: 0 });
  // flint chunk
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..........###...',
    '.........#####..',
    '........#######.',
    '........#######.',
    '.........######.',
    '..........####..',
    '...........##...',
  ]), mat('#141416', '#2e2e32', '#46464c', '#64646a', '#8a8a90'), { seed: 102 });
  return t;
}

function trident(): Tex {
  const t = new Tex();
  const p = mat('#14403a', '#2a7466', '#3f9e8c', '#5fc4ae', '#a8ecd8');
  for (let x = 1; x <= 10; x++) {
    t.set(x, 15 - x, p[2]!);
    t.set(x, 16 - x, p[1]!);
  }
  // three prongs fanning out at the top-right
  const prong = (pts: string) => px(t, pts, p[3]!);
  prong('10,3 11,2 12,1 9,3 8,2 7,1');
  prong('12,5 13,4 14,3 12,6 13,7 14,8');
  prong('11,4 12,3 13,2 14,1');
  px(t, '9,4 10,4 11,5 10,5 11,6', p[1]!);
  px(t, '7,1 14,1 14,8', p[4]!);
  return t;
}

function shield(): Tex {
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
    '...##########...',
    '...##########...',
    '....########....',
    '.....######.....',
    '......####......',
  ]), mat('#2a1c0c', '#5a3e1c', '#7a5530', '#946a3c', '#ae8450'), { seed: 111 });
  // iron rim + boss
  for (let x = 2; x < 14; x++) t.set(x, 1, hex('#8e8e94'));
  for (let y = 1; y < 9; y++) {
    t.set(2, y, hex('#8e8e94'));
    t.set(13, y, hex('#5d5d63'));
  }
  px(t, '7,6 8,6 7,7 8,7', '#c2c2c8');
  px(t, '8,7', '#5d5d63');
  // plank lines
  for (let y = 2; y < 13; y++) if (y % 3 === 0) { t.set(5, y, hex('#5a3e1c')); t.set(10, y, hex('#5a3e1c')); }
  return t;
}

function spyglass(): Tex {
  const t = new Tex();
  const cu = mat('#4a2414', '#8a4a2a', '#b8683e', '#d88a58', '#f2b088');
  shadeMask(t, maskFn((x, y) => {
    const s = x + y, a = x - y;
    return a >= -9 && a <= 9 && s >= (a > 2 ? 13 : 14) && s <= (a > 2 ? 18 : 17);
  }), cu, { seed: 121, dither: 0 });
  px(t, '12,4 13,5 12,3', '#bfe6f0');
  px(t, '5,9 6,10 4,10 5,11', '#3a2a20');
  return t;
}

function carrotOnStick(fungus: boolean): Tex {
  const t = fishingRod(false);
  for (let y = 3; y < 10; y++) t.set(14, y, hex('#d8d8d8'));
  if (fungus) {
    paintGrid(t, ['.rr.', 'rRRr', '.ss.', '.s..'], { r: '#2c8a7a', R: '#4ab8a2', s: '#d07a3a' }, 12, 10);
  } else {
    paintGrid(t, ['g.g.', '.g..', 'oO..', 'oO..', '.o..'], { g: '#4a9a2a', o: '#e0761a', O: '#f8a040' }, 13, 9);
  }
  for (let y = 11; y < 14; y++) t.set(13, y, [0, 0, 0, 0]);
  return t;
}

function elytra(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '..####....####..',
    '.######..######.',
    '.######..######.',
    '.######..######.',
    '.#####....#####.',
    '.#####....#####.',
    '..####....####..',
    '..####....####..',
    '..###......###..',
    '...##......##...',
    '...#........#...',
  ]), mat('#2a2238', '#4e4268', '#6e6090', '#8e80b0', '#b8acd8'), { seed: 131 });
  for (let y = 3; y < 10; y++) {
    t.set(4, y, hex('#4e4268'));
    t.set(11, y, hex('#4e4268'));
  }
  return t;
}

const TOOL_TIERS = ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite'];
const ARMOR_TIERS = ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite'];

export const toolItems: ItemTexDef[] = [
  ...TOOL_TIERS.flatMap((tier): ItemTexDef[] => [
    { name: `${tier}_sword`, make: () => sword(tier), handheld: true },
    { name: `${tier}_shovel`, make: () => shovel(tier), handheld: true },
    { name: `${tier}_pickaxe`, make: () => pickaxe(tier), handheld: true },
    { name: `${tier}_axe`, make: () => axe(tier), handheld: true },
    { name: `${tier}_hoe`, make: () => hoe(tier), handheld: true },
  ]),
  ...ARMOR_TIERS.flatMap((m): ItemTexDef[] =>
    (['helmet', 'chestplate', 'leggings', 'boots'] as const).map((p) => ({ name: `${m}_${p}`, make: () => armor(m, p) })),
  ),
  { name: 'turtle_helmet', make: () => armor('turtle', 'helmet') },
  { name: 'stick', make: stick, handheld: true },
  { name: 'bow', make: () => bow(0) },
  { name: 'bow_pulling_0', make: () => bow(1) },
  { name: 'bow_pulling_1', make: () => bow(2) },
  { name: 'bow_pulling_2', make: () => bow(3) },
  { name: 'arrow', make: () => arrow('arrow') },
  { name: 'spectral_arrow', make: () => arrow('spectral') },
  { name: 'tipped_arrow', make: () => arrow('tipped') },
  { name: 'crossbow', make: () => crossbow('standby') },
  { name: 'crossbow_pulling_0', make: () => crossbow('pulling_0') },
  { name: 'crossbow_pulling_1', make: () => crossbow('pulling_1') },
  { name: 'crossbow_pulling_2', make: () => crossbow('pulling_2') },
  { name: 'crossbow_arrow', make: () => crossbow('arrow') },
  { name: 'crossbow_firework', make: () => crossbow('firework') },
  { name: 'fishing_rod', make: () => fishingRod(false), handheld: 'rod' },
  { name: 'fishing_rod_cast', make: () => fishingRod(true), handheld: 'rod' },
  { name: 'carrot_on_a_stick', make: () => carrotOnStick(false), handheld: 'rod' },
  { name: 'warped_fungus_on_a_stick', make: () => carrotOnStick(true), handheld: 'rod' },
  { name: 'shears', make: shears },
  { name: 'flint_and_steel', make: flintAndSteel },
  { name: 'trident', make: trident },
  { name: 'shield', make: shield },
  { name: 'spyglass', make: spyglass },
  { name: 'elytra', make: elytra },
  { name: 'broken_elytra', make: () => {
    const t = elytra();
    px(t, '3,4 4,6 12,5 11,7 3,8 12,9', [0, 0, 0, 0]);
    return t;
  } },
];
