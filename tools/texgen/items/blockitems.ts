/**
 * Block items that vanilla draws as flat sprites with their own item texture (doors, signs,
 * candles, lanterns, cauldron, hopper, repeater, …) rather than as a 3D block.
 */
import { Tex, hex, type Palette } from '../lib';
import { mat, maskOf, paintGrid, px, rampOf, shadeMask } from './lib';
import type { ItemTexDef } from './registry';
import { PLANK_RAMPS, DYE_COLORS } from './misc';
import { TIERS } from './tools';

const IRON = TIERS.iron!;

function door(p: Palette, iron = false): Tex {
  const t = new Tex();
  const m = maskOf(Array.from({ length: 16 }, () => '....########....'));
  shadeMask(t, m, p, { seed: 1101, dither: 0 });
  // panels / windows
  if (iron) {
    for (let y = 2; y < 6; y++) for (const x of [5, 7, 8, 10]) t.set(x, y, p[1]!);
    for (let y = 9; y < 14; y++) for (const x of [6, 9]) t.set(x, y, p[1]!);
    px(t, '10,8', p[0]!);
  } else {
    for (let y = 2; y < 6; y++) for (let x = 5; x < 11; x++) t.set(x, y, (x === 7 || x === 8) ? p[1]! : [0, 0, 0, 0]);
    for (let x = 5; x < 11; x++) t.set(x, 7, p[1]!);
    for (let y = 9; y < 14; y++) t.set(7, y, p[1]!);
    px(t, '10,9', '#c0c0c8');
  }
  return t;
}

function sign(p: Palette): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '.##############.',
    '................',
  ]), p, { seed: 1111, dither: 0 });
  for (let x = 3; x < 13; x++) {
    t.set(x, 4, p[1]!);
    t.set(x, 6, p[1]!);
  }
  for (let y = 9; y < 16; y++) {
    t.set(7, y, hex('#4d3418'));
    t.set(8, y, hex('#6d4a23'));
  }
  return t;
}

function candle(color: string | null): Tex {
  const t = new Tex();
  const p = color ? rampOf(color, 5, 0.5, 1.35) : mat('#7a6a4a', '#d8c8a0', '#e8dcb8', '#f4ecd4', '#ffffff');
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
    '......####......',
  ]), p, { seed: 1121, dither: 0 });
  px(t, '7,3 7,4', '#2a2a2a');
  px(t, '8,5', p[4]!);
  return t;
}

function lantern(soul: boolean): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '.......##.......',
    '......#..#......',
    '.....######.....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
  ]), mat('#1e1e24', '#3a3a44', '#4e4e5a', '#666674', '#8a8a98'), { seed: 1131, dither: 0 });
  const glow = soul ? ['#5ad8e0', '#c0fbff'] : ['#f0a030', '#fff0a0'];
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, hex(glow[x > 6 && x < 9 && y > 6 && y < 9 ? 1 : 0]!));
  for (let y = 5; y < 11; y++) t.set(8, y, hex('#3a3a44'));
  return t;
}

function chain(): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++) {
    if (y % 4 < 2) px(t, `7,${y} 8,${y}`, y % 4 === 0 ? '#5a5f6e' : '#3a3e4a');
    else px(t, `6,${y} 9,${y}`, '#4a4e5c');
  }
  return t;
}

function cauldron(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '.##############.',
    '.##############.',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '..###......###..',
    '..##........##..',
  ]), mat('#141418', '#2e2e34', '#3e3e46', '#52525c', '#6e6e7a'), { seed: 1141, dither: 0 });
  for (let x = 2; x < 14; x++) t.set(x, 4, hex('#0e0e12'));
  return t;
}

function hopper(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.##############.',
    '.##############.',
    '..############..',
    '...##########...',
    '....########....',
    '.....######.....',
    '......####......',
    '......####......',
    '.......##.......',
    '.......##.......',
  ]), mat('#141418', '#2e2e34', '#3e3e46', '#52525c', '#6e6e7a'), { seed: 1151, dither: 0 });
  for (let x = 3; x < 13; x++) t.set(x, 3, hex('#0e0e12'));
  return t;
}

function brewingStand(): Tex {
  const t = new Tex();
  for (let y = 2; y < 14; y++) px(t, `7,${y} 8,${y}`, y % 2 ? '#c8a040' : '#a07a20');
  px(t, '7,1 8,1', '#e0c060');
  shadeMask(t, maskOf(['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '.##############.', '.##############.']), mat('#1a1a1e', '#3a3a40', '#505058', '#666670', '#80808a'), { seed: 1161 });
  for (const ox of [2, 11]) {
    px(t, `${ox},10 ${ox + 1},10 ${ox},11 ${ox + 1},11 ${ox},12 ${ox + 1},12`, '#d8e4f0');
    px(t, `${ox},9 ${ox + 1},9`, '#a8b8c8');
  }
  px(t, '4,7 5,6 6,5 9,5 10,6 11,7', '#c8a040');
  return t;
}

function flowerPot(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '....########....',
    '....########....',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '.....######.....',
  ]), mat('#4a1c10', '#8a3a24', '#a84a30', '#c4603e', '#dc8460'), { seed: 1171, dither: 0 });
  for (let x = 5; x < 11; x++) t.set(x, 8, hex('#3a2010'));
  return t;
}

function cake(): Tex {
  const t = new Tex();
  paintGrid(t, [
    '................',
    '................',
    '................',
    '................',
    '.......r........',
    '...wwwwwwwwww...',
    '..wWWWWWWWWWWw..',
    '..wWWrWWWWrWWw..',
    '..wwwwwwwwwwww..',
    '..bBBBBBBBBBBb..',
    '..wwwwwwwwwwww..',
    '..bBBBBBBBBBBb..',
    '..bbbbbbbbbbbb..',
  ], { w: '#e8e0d8', W: '#ffffff', r: '#d02a2a', b: '#8a4a20', B: '#b06a30' });
  return t;
}

function diode(comparator: boolean): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.##############.',
    '.##############.',
    '.##############.',
    '................',
  ]), mat('#3a3a3e', '#6a6a70', '#8a8a90', '#a4a4aa', '#c4c4ca'), { seed: 1181, dither: 0 });
  const torch = (x: number, lit: boolean) => {
    px(t, `${x},6 ${x},7 ${x},8`, '#8a6234');
    px(t, `${x},5`, lit ? '#ff4a2a' : '#7a2a1a');
  };
  if (comparator) {
    torch(3, false);
    torch(12, false);
    torch(8, true);
  } else {
    torch(4, true);
    torch(11, true);
  }
  for (let x = 2; x < 14; x++) t.set(x, 10, hex(comparator ? '#9a3a2a' : '#7a2a1a'));
  return t;
}

function campfire(soul: boolean): Tex {
  const t = new Tex();
  const log = mat('#2a1c0c', '#4d3418', '#6d4a23', '#8f6634', '#a87c48');
  for (let x = 1; x < 15; x++) {
    t.set(x, 11, log[x % 4 === 0 ? 1 : 3]!);
    t.set(x, 12, log[1]!);
    t.set(x, 14, log[2]!);
    t.set(x, 15, log[0]!);
  }
  px(t, '3,13 4,13 11,13 12,13', log[1]!);
  const f = soul ? ['#2ab8c8', '#8af0f8', '#e0ffff'] : ['#e0500a', '#f8a020', '#fff070'];
  paintGrid(t, [
    '......a.....',
    '.....ab..a..',
    '..a..abb.ab.',
    '..ab.abcbab.',
    '.abbabccbbba',
    '.abccbcccbba',
  ], { a: f[0]!, b: f[1]!, c: f[2]! }, 2, 5);
  return t;
}

function bell(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.......##.......',
    '......####......',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '....########....',
    '....########....',
    '...##########...',
    '...##########...',
  ]), TIERS.golden!, { seed: 1191, dither: 0 });
  px(t, '7,1 8,1 7,0 8,0', '#5a5a60');
  px(t, '7,12 8,12', '#3a3a40');
  return t;
}

function barrier(): Tex {
  const t = new Tex();
  for (let i = 2; i < 14; i++) {
    t.set(i, i, hex('#e02020'));
    t.set(i + 1, i, hex('#e02020'));
  }
  for (let y = 2; y < 14; y++)
    for (let x = 2; x < 14; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 >= 25 && (x - 7.5) ** 2 + (y - 7.5) ** 2 < 36) t.set(x, y, hex('#e02020'));
  return t;
}

function bamboo(): Tex {
  const t = new Tex();
  for (let k = 0; k < 12; k++) {
    const x = 3 + k, y = 13 - k;
    const joint = k % 4 === 3;
    t.set(x, y, hex(joint ? '#4a7a1a' : '#8ac83a'));
    t.set(x + 1, y, hex(joint ? '#3a6012' : '#6aa02a'));
    t.set(x, y + 1, hex(joint ? '#3a6012' : '#5a8a22'));
  }
  px(t, '8,5 9,4 10,4 6,9 5,9', '#7ab83a');
  return t;
}

function pointedDripstone(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '....########....',
    '....########....',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '......####......',
    '......####......',
    '......####......',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '.......#........',
  ]), mat('#3a2a20', '#6a5040', '#86684e', '#a08262', '#bca080'), { seed: 1201, dither: 0.2 });
  return t;
}

function turtleEgg(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.........####...',
    '........######..',
    '.......########.',
    '.......########.',
    '..####.########.',
    '.######.######..',
    '########.####...',
    '########........',
    '########........',
    '.######.........',
    '..####..........',
  ]), mat('#7a7a5a', '#cfcfb0', '#e6e6cc', '#f2f2e0', '#ffffff'), { seed: 1211, dither: 0 });
  px(t, '10,4 13,6 9,7 12,9 3,8 6,10 2,11', '#5a9a5a');
  return t;
}

function structureVoid(): Tex {
  const t = new Tex();
  for (let i = 4; i < 12; i++) {
    t.set(i, 4, hex('#d0d0ff'));
    t.set(i, 11, hex('#d0d0ff'));
    t.set(4, i, hex('#d0d0ff'));
    t.set(11, i, hex('#d0d0ff'));
  }
  return t;
}

function lightItem(): Tex {
  const t = new Tex();
  // a little light bulb
  shadeMask(t, maskOf([
    '................',
    '................',
    '......####......',
    '.....######.....',
    '....########....',
    '....########....',
    '....########....',
    '.....######.....',
    '......####......',
    '......####......',
  ]), mat('#8a7a20', '#e8d040', '#f8e870', '#fff4a8', '#ffffff'), { seed: 1221, dither: 0 });
  px(t, '6,10 7,10 8,10 9,10 6,12 7,12 8,12 9,12', '#8e8e94');
  px(t, '6,11 7,11 8,11 9,11', '#5d5d63');
  return t;
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped'];

export const blockItemSprites: ItemTexDef[] = [
  ...WOODS.map((w): ItemTexDef => ({ name: `${w}_door`, make: () => door(PLANK_RAMPS[w]!) })),
  { name: 'iron_door', make: () => door(IRON, true) },
  ...WOODS.map((w): ItemTexDef => ({ name: `${w}_sign`, make: () => sign(PLANK_RAMPS[w]!) })),
  { name: 'candle', make: () => candle(null) },
  ...Object.entries(DYE_COLORS).map(([n, c]): ItemTexDef => ({ name: `${n}_candle`, make: () => candle(c) })),
  { name: 'lantern', make: () => lantern(false) },
  { name: 'soul_lantern', make: () => lantern(true) },
  { name: 'chain', make: chain },
  { name: 'cauldron', make: cauldron },
  { name: 'hopper', make: hopper },
  { name: 'brewing_stand', make: brewingStand },
  { name: 'flower_pot', make: flowerPot },
  { name: 'cake', make: cake },
  { name: 'repeater', make: () => diode(false) },
  { name: 'comparator', make: () => diode(true) },
  { name: 'campfire', make: () => campfire(false) },
  { name: 'soul_campfire', make: () => campfire(true) },
  { name: 'bell', make: bell },
  { name: 'barrier', make: barrier },
  { name: 'bamboo', make: bamboo, handheld: true },
  { name: 'pointed_dripstone', make: pointedDripstone },
  { name: 'turtle_egg', make: turtleEgg },
  { name: 'structure_void', make: structureVoid },
  { name: 'light', make: lightItem },
];
