/** Food, crops and seeds. */
import { Tex, hex, rng, type Palette } from '../lib';
import { mat, maskOf, paintGrid, px, shadeMask, type Mask } from './lib';
import type { ItemTexDef } from './registry';

function apple(kind: 'red' | 'golden' | 'enchanted'): Tex {
  const t = new Tex();
  const p = kind === 'red' ? mat('#4a0808', '#9a1414', '#cc2222', '#ee4a3a', '#ffb0a0') : mat('#5a3a05', '#b5800e', '#e2b827', '#f6dc4e', '#fff8b8');
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '....###..###....',
    '...##########...',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '...##########...',
    '....###..###....',
  ]), p, { seed: 601, dither: 0 });
  px(t, '4,5 4,6 5,5', p[4]!);
  // stem and leaf
  px(t, '7,1 7,2 8,3', '#5a3a1a');
  px(t, '8,1 9,1 9,2 10,1', kind === 'red' ? '#4a9a2a' : '#c8a020');
  if (kind === 'enchanted') px(t, '10,6 6,9 11,10', '#fff8e8');
  return t;
}

function bread(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '.........#####..',
    '......#########.',
    '....###########.',
    '..#############.',
    '.##############.',
    '.#############..',
    '.###########....',
    '..########......',
    '....###.........',
  ]), mat('#5a2e08', '#9a5a1a', '#c08030', '#d8a050', '#f0c880'), { seed: 611, dither: 0 });
  px(t, '4,8 5,7 7,7 8,6 10,6 11,5', '#e8c080');
  px(t, '5,8 8,7 11,6', '#9a5a1a');
  return t;
}

/** A cut of meat with a fat rim; `bone` adds a bone end. */
const MEAT: Mask = maskOf([
  '................',
  '................',
  '................',
  '.....######.....',
  '...#########....',
  '..###########...',
  '..############..',
  '.#############..',
  '.#############..',
  '..############..',
  '..###########...',
  '...#########....',
  '.....#####......',
]);

function meat(p: Palette, fat: string, marbling: string, seed: number, bone = false): Tex {
  const t = new Tex();
  shadeMask(t, MEAT, p, { seed, dither: 0.15 });
  const r = rng(seed);
  for (let i = 0; i < 5; i++) {
    const x = 4 + Math.floor(r() * 8), y = 5 + Math.floor(r() * 6);
    t.set(x, y, hex(marbling));
  }
  px(t, '5,4 6,4 7,4 4,5 3,6', fat);
  if (bone) px(t, '12,10 13,11 14,12 13,12 14,11 15,12 14,13', '#ece6d0');
  return t;
}

function drumstick(p: Palette, seed: number): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.....#####......',
    '....#######.....',
    '...#########....',
    '...#########....',
    '...#########....',
    '....########....',
    '.....#######....',
    '......#####.....',
    '........###.....',
  ]), p, { seed, dither: 0.15 });
  px(t, '9,10 10,11 11,12 12,12 12,13 11,13', '#ece6d0');
  px(t, '12,14 13,13 13,14', '#c8c2a8');
  return t;
}

function fish(body: Palette, belly: string, seed: number, cooked = false): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '.............##.',
    '.....######.###.',
    '...###########..',
    '..############..',
    '.#############..',
    '..############..',
    '...###########..',
    '.....######.###.',
    '.............##.',
  ]), body, { seed, dither: 0.1 });
  for (let x = 3; x < 12; x++) t.set(x, 10, hex(belly));
  if (!cooked) {
    px(t, '3,7', '#101010');
    px(t, '4,7', '#f0f0f0');
  } else {
    px(t, '3,7', '#3a2010');
    for (let x = 5; x < 12; x += 2) t.set(x, 8, body[1]!);
  }
  return t;
}

function tropicalFish(): Tex {
  const t = fish(mat('#6a2a00', '#d06010', '#f08a20', '#ffb050', '#fff0c0'), '#ffe0b0', 641);
  for (let y = 5; y < 12; y++) {
    if (t.get(6, y)[3] > 128) t.set(6, y, hex('#f8f8f8'));
    if (t.get(10, y)[3] > 128) t.set(10, y, hex('#f8f8f8'));
  }
  return t;
}

function pufferfish(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '....########....',
    '...##########...',
    '..############..',
    '..############.#',
    '..##############',
    '..############.#',
    '..############..',
    '...##########...',
    '....########....',
  ]), mat('#5a4000', '#b89000', '#e4c020', '#f8e050', '#fffbb0'), { seed: 651, dither: 0 });
  px(t, '4,2 7,2 10,2 1,6 1,9 4,13 7,13 10,13 13,2 13,13', '#5a7a2a');
  px(t, '4,6', '#101010');
  px(t, '5,6', '#f0f0f0');
  for (let x = 4; x < 12; x++) t.set(x, 10, hex('#f8f0d0'));
  return t;
}

function root(p: Palette, leaf: string | null, seed: number): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '..........###...',
    '.........#####..',
    '........######..',
    '.......######...',
    '......######....',
    '.....######.....',
    '....######......',
    '...#####........',
    '..####..........',
    '..##............',
  ]), p, { seed, dither: 0 });
  for (let k = 0; k < 4; k++) t.set(5 + k * 2, 11 - k * 2, p[1]!);
  if (leaf) px(t, '12,2 13,1 14,2 13,3 14,0 15,1 12,1', leaf);
  return t;
}

function potato(p: Palette, seed: number, eyes: string): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '.......####.....',
    '.....#######....',
    '....#########...',
    '...##########...',
    '...###########..',
    '...###########..',
    '...##########...',
    '....#########...',
    '.....#######....',
    '.......###......',
  ]), p, { seed, dither: 0.15 });
  px(t, '6,6 10,8 7,10 9,5', eyes);
  return t;
}

function beetroot(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '.....######.....',
    '....########....',
    '...##########...',
    '...##########...',
    '...##########...',
    '....########....',
    '.....######.....',
    '......####......',
    '.......##.......',
    '.......#........',
  ]), mat('#3a0414', '#7a0c2c', '#a8183e', '#cc3a5a', '#f08aa0'), { seed: 671, dither: 0 });
  px(t, '6,1 6,2 7,3 9,1 9,2 8,3 7,2 8,2', '#3a8a2a');
  return t;
}

function melonSlice(glistering: boolean): Tex {
  const t = new Tex();
  paintGrid(t, [
    '................',
    '................',
    '................',
    '................',
    '..g.............',
    '..gr............',
    '..grr...........',
    '..grrr..........',
    '..grrRr.........',
    '..grrrrr........',
    '..grRrrRr.......',
    '..grrrrrrr......',
    '..ggggggggg.....',
    '...hhhhhhhh.....',
  ], { g: '#4a8a2a', h: '#2a5a1a', r: '#e03a3a', R: '#2a1010' });
  px(t, '4,8 6,11 4,10', '#ff7a6a');
  if (glistering) px(t, '3,5 5,7 7,9 4,11 8,11 6,9', '#f8d838');
  return t;
}

function berries(glow: boolean): Tex {
  const t = new Tex();
  const p = glow ? mat('#6a3a00', '#c87a00', '#f0a820', '#ffd450', '#fff8b0') : mat('#3a0414', '#7a0c1c', '#b01a2a', '#d8404a', '#ff9a9a');
  const ball = maskOf(['.##.', '####', '####', '.##.']);
  for (const [ox, oy] of [[3, 8], [8, 9], [6, 4]] as const) {
    const m = maskOf(Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x - ox >= 0 && x - ox < 4 && y - oy >= 0 && y - oy < 4 && ball[(y - oy) * 16 + (x - ox)] ? '#' : '.')).join('')));
    shadeMask(t, m, p, { seed: 681 + ox, dither: 0 });
  }
  px(t, '8,3 8,2 9,1 10,1 5,7 10,8', '#3a6a2a');
  return t;
}

function cookie(): Tex {
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
    '...##########...',
    '....########....',
    '.....######.....',
  ]), mat('#5a2e08', '#a8641e', '#c88034', '#dca050', '#f0c880'), { seed: 691, dither: 0.1 });
  px(t, '5,5 9,6 6,8 10,9 7,10 11,7', '#3a1a08');
  return t;
}

function pie(): Tex {
  const t = new Tex();
  paintGrid(t, [
    '................',
    '................',
    '................',
    '................',
    '.....cccccc.....',
    '...cccccccccc...',
    '..cCppppppppCc..',
    '..cppPppPpppPc..',
    '..cpppppPpppPc..',
    '..ccCppppppCcc..',
    '..dccccccccccd..',
    '...dddddddddd...',
  ], { c: '#e0b070', C: '#f0d090', p: '#e07a20', P: '#f8a040', d: '#9a6a30' });
  return t;
}

const BOWL_ROWS = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.bbbbbbbbbbbbbb.',
  '.BbbbbbbbbbbbbB.',
  '..Bbbbbbbbbbbb..',
  '..BBbbbbbbbbBB..',
  '...BBbbbbbbBB...',
  '....BBBBBBBB....',
];

function bowl(soup: string | null, bits: string[] = []): Tex {
  const t = new Tex();
  paintGrid(t, BOWL_ROWS, { b: '#8a6234', B: '#5a3e1c' });
  if (soup) {
    for (let x = 2; x < 14; x++) t.set(x, 7, hex(soup));
    for (let x = 3; x < 13; x++) t.set(x, 6, hex(soup));
    px(t, '4,6 5,6', '#ffffff40'.slice(0, 7));
    bits.forEach((c, i) => px(t, `${4 + i * 3},6 ${5 + i * 3},7`, c));
  } else {
    for (let x = 2; x < 14; x++) t.set(x, 7, hex('#3a2610'));
  }
  return t;
}

function seeds(p: Palette, seed: number, flat = false): Tex {
  const t = new Tex();
  const r = rng(seed);
  const spots: [number, number][] = flat ? [[4, 5], [9, 4], [6, 8], [10, 9], [5, 11], [8, 12]] : [[4, 6], [8, 5], [11, 7], [5, 10], [9, 10], [7, 13]];
  for (const [x, y] of spots) {
    const dx = Math.floor(r() * 2);
    t.set(x + dx, y, p[3]!);
    t.set(x + dx + 1, y, p[2]!);
    t.set(x + dx, y + 1, p[2]!);
    t.set(x + dx + 1, y + 1, p[1]!);
    if (flat) t.set(x + dx + 2, y + 1, p[1]!);
  }
  return t;
}

function wheat(): Tex {
  const t = new Tex();
  // a tied sheaf: grain heads fanning out on top, stalks spreading below the band
  paintGrid(t, [
    '......gG........',
    '...gG.gG..gG....',
    '...gG.gG..gG....',
    '.gG.gG.s.gG.gG..',
    '.gG..s.s.s..gG..',
    '..s..s.s.s..s...',
    '...s.s.s.s.s....',
    '....s.sss.s.....',
    '.....sssss......',
    '.....ttttt......',
    '.....sssss......',
    '....s.sSs.s.....',
    '...s..s.S..s....',
    '..s...s..S..s...',
    '..S...S..S..S...',
  ], { g: '#f4d870', G: '#c8a03a', s: '#b8963a', S: '#8a6a22', t: '#7a4a1a' });
  return t;
}

function eggItem(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
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
    '....########....',
    '.....######.....',
  ]), mat('#8a7a60', '#d8c8a8', '#ece0c4', '#f8f0dc', '#ffffff'), { seed: 701, dither: 0 });
  px(t, '6,7 9,9 7,10', '#c8b48a');
  return t;
}

function chorus(popped: boolean): Tex {
  const t = new Tex();
  const p = popped ? mat('#4a2a4a', '#9a6a9a', '#c08ac0', '#dcaadc', '#f8e0f8') : mat('#2a0e3a', '#5a2a7a', '#8a4aa8', '#ac70c8', '#dcb0f0');
  shadeMask(t, maskOf([
    '................',
    '................',
    '.....##..##.....',
    '....########....',
    '...##########...',
    '...##########...',
    '..############..',
    '..############..',
    '...##########...',
    '...##########...',
    '....########....',
    '.....##..##.....',
  ]), p, { seed: popped ? 712 : 711, dither: 0.2 });
  px(t, '5,5 9,7 6,9', p[4]!);
  return t;
}

function spiderEye(fermented: boolean): Tex {
  const t = new Tex();
  const p = fermented ? mat('#3a1a20', '#7a3a44', '#a8505e', '#c8707c', '#eaa8b0') : mat('#3a0610', '#7a1020', '#b01c32', '#d83a50', '#ff9aa8');
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
  ]), p, { seed: 721, dither: 0 });
  px(t, '6,6 7,6 6,7 7,7', '#101010');
  px(t, '9,8', '#101010');
  if (fermented) px(t, '4,3 11,4 5,10 10,11 8,2', '#7a5a3a');
  return t;
}

function rottenFlesh(): Tex {
  const t = meat(mat('#2a2008', '#5a4a1a', '#7a6a2a', '#968a40', '#b8ac60'), '#4a6a20', '#3a2a10', 731);
  px(t, '6,6 9,9 4,9', '#4a7a2a');
  return t;
}

function driedKelp(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '...##########...',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
  ]), mat('#141a0a', '#2a3a14', '#3a4e1e', '#4e662a', '#6a8a3a'), { seed: 741, dither: 0.3 });
  for (let x = 3; x < 13; x += 3) for (let y = 4; y < 10; y++) t.set(x, y, hex('#2a3a14'));
  return t;
}

function cocoa(): Tex {
  const t = new Tex();
  const p = mat('#2a1004', '#5a2a0e', '#7a3e1a', '#9a5a2a', '#c08050');
  for (const [ox, oy] of [[3, 5], [8, 7], [5, 10]] as const) {
    const m = maskOf(Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => {
      const dx = x - ox, dy = y - oy;
      return dx >= 0 && dx < 4 && dy >= 0 && dy < 3 && !((dx === 0 || dx === 3) && (dy === 0 || dy === 2)) ? '#' : '.';
    }).join('')));
    shadeMask(t, m, p, { seed: 751 + ox, dither: 0 });
  }
  return t;
}

function netherWart(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '.....##..##.....',
    '....###..###....',
    '...####.#####...',
    '...##########...',
    '....########....',
    '...##########...',
    '...##########...',
    '....###..###....',
    '.....#....#.....',
  ]), mat('#3a0408', '#6a0a12', '#901420', '#b42832', '#d85a60'), { seed: 761, dither: 0.3 });
  return t;
}

function sugarCane(): Tex {
  const t = new Tex();
  for (const ox of [3, 7, 11]) {
    for (let y = 2; y < 15; y++) {
      t.set(ox, y, hex(y % 4 === 0 ? '#5a8a3a' : '#9ad06a'));
      t.set(ox + 1, y, hex(y % 4 === 0 ? '#3a6a2a' : '#6aa84a'));
    }
  }
  px(t, '5,4 6,3 9,7 10,6 13,5 14,4 2,9 1,8', '#7ab858');
  return t;
}

function kelpItem(): Tex {
  const t = new Tex();
  for (let y = 1; y < 15; y++) {
    const x = 7 + Math.round(Math.sin(y * 0.8) * 1.5);
    t.set(x, y, hex('#4a8a2a'));
    t.set(x + 1, y, hex('#2e6a1e'));
    if (y % 3 === 0) {
      t.set(x - 1, y, hex('#6ab03a'));
      t.set(x - 2, y - 1, hex('#6ab03a'));
    }
    if (y % 3 === 1) {
      t.set(x + 2, y, hex('#3e7a24'));
      t.set(x + 3, y - 1, hex('#3e7a24'));
    }
  }
  return t;
}

function stew(): Tex {
  return bowl('#a87a50', ['#e0a060', '#d0d0a0']);
}

export const foodItems: ItemTexDef[] = [
  { name: 'apple', make: () => apple('red') },
  { name: 'golden_apple', make: () => apple('golden') },
  { name: 'enchanted_golden_apple', make: () => apple('enchanted') },
  { name: 'bread', make: bread },
  { name: 'porkchop', make: () => meat(mat('#7a2a2a', '#c85a5a', '#e88080', '#f4a0a0', '#ffd0d0'), '#fff0e8', '#c04a4a', 621) },
  { name: 'cooked_porkchop', make: () => meat(mat('#3a1a08', '#8a4a20', '#b06a30', '#c88a48', '#e8b880'), '#f0d8a8', '#6a3010', 622) },
  { name: 'beef', make: () => meat(mat('#4a0808', '#9a1a1a', '#c82a2a', '#e04a4a', '#ff8a8a'), '#fff0e0', '#ffd0d0', 623, true) },
  { name: 'cooked_beef', make: () => meat(mat('#2a1004', '#5a2a10', '#7a3e1c', '#9a5a30', '#c08050'), '#d8b080', '#3a1a08', 624, true) },
  { name: 'chicken', make: () => drumstick(mat('#8a5a4a', '#e0a898', '#f4c4b4', '#fcdcd0', '#ffffff'), 625) },
  { name: 'cooked_chicken', make: () => drumstick(mat('#4a2004', '#a85a1a', '#d08030', '#e8a050', '#f8d090'), 626) },
  { name: 'mutton', make: () => meat(mat('#5a1414', '#a83a3a', '#d05858', '#e87a7a', '#ffc0c0'), '#ffffff', '#f0c0c0', 627) },
  { name: 'cooked_mutton', make: () => meat(mat('#3a1404', '#7a3a1a', '#9a522a', '#b87040', '#d89a6a'), '#e8c8a0', '#5a2a10', 628) },
  { name: 'rabbit', make: () => drumstick(mat('#7a3a3a', '#d08a80', '#e8a8a0', '#f4c4bc', '#fff0ec'), 629) },
  { name: 'cooked_rabbit', make: () => drumstick(mat('#3a1a04', '#9a5a22', '#c07a34', '#d89a50', '#f0c890'), 630) },
  { name: 'cod', make: () => fish(mat('#3a3020', '#8a7a5a', '#b0a07a', '#ccbc96', '#ece0c0'), '#ece4cc', 631) },
  { name: 'cooked_cod', make: () => fish(mat('#3a2408', '#a07038', '#c89050', '#dcaa6a', '#f4d098'), '#f4e0b0', 632, true) },
  { name: 'salmon', make: () => fish(mat('#3a0e0e', '#9a2a2a', '#c84a3a', '#e07050', '#f8b090'), '#f8c8a8', 633) },
  { name: 'cooked_salmon', make: () => fish(mat('#3a1404', '#a04a1a', '#c86a2a', '#e08a48', '#f8b878'), '#f8d0a0', 634, true) },
  { name: 'tropical_fish', make: tropicalFish },
  { name: 'pufferfish', make: pufferfish },
  { name: 'carrot', make: () => root(mat('#6a2a00', '#c05a08', '#e87a14', '#f8a040', '#ffd8a0'), '#4a9a2a', 661) },
  { name: 'golden_carrot', make: () => root(mat('#5a3a05', '#b5800e', '#e2b827', '#f6dc4e', '#fff8b8'), '#c8a020', 662) },
  { name: 'potato', make: () => potato(mat('#5a3a10', '#a8783a', '#c89a50', '#dcb470', '#f0d8a0'), 663, '#7a5220') },
  { name: 'baked_potato', make: () => potato(mat('#4a2408', '#a06020', '#c8842c', '#e0a84a', '#f8d888'), 664, '#f8e8b0') },
  { name: 'poisonous_potato', make: () => potato(mat('#3a4010', '#8a9a3a', '#a8b850', '#c0d070', '#e0f0a0'), 665, '#4a5a10') },
  { name: 'beetroot', make: beetroot },
  { name: 'melon_slice', make: () => melonSlice(false) },
  { name: 'glistering_melon_slice', make: () => melonSlice(true) },
  { name: 'sweet_berries', make: () => berries(false) },
  { name: 'glow_berries', make: () => berries(true) },
  { name: 'cookie', make: cookie },
  { name: 'pumpkin_pie', make: pie },
  { name: 'bowl', make: () => bowl(null) },
  { name: 'mushroom_stew', make: () => bowl('#b08a62', ['#d8c0a0', '#a87050']) },
  { name: 'rabbit_stew', make: () => bowl('#9a6a3a', ['#e87a14', '#c89a50', '#7a3e1c']) },
  { name: 'beetroot_soup', make: () => bowl('#a8183e', ['#cc3a5a']) },
  { name: 'suspicious_stew', make: stew },
  { name: 'dried_kelp', make: driedKelp },
  { name: 'chorus_fruit', make: () => chorus(false) },
  { name: 'popped_chorus_fruit', make: () => chorus(true) },
  { name: 'spider_eye', make: () => spiderEye(false) },
  { name: 'fermented_spider_eye', make: () => spiderEye(true) },
  { name: 'rotten_flesh', make: rottenFlesh },
  { name: 'wheat', make: wheat },
  { name: 'wheat_seeds', make: () => seeds(mat('#1e3a0a', '#3a6a1a', '#5a9a2a', '#7ac040', '#b0e070'), 771) },
  { name: 'pumpkin_seeds', make: () => seeds(mat('#5a4a20', '#b8a060', '#d8c488', '#ece0b0', '#fffbe0'), 772, true) },
  { name: 'melon_seeds', make: () => seeds(mat('#0a0a08', '#2a2418', '#3e3424', '#5a4a34', '#7a6a4a'), 773, true) },
  { name: 'beetroot_seeds', make: () => seeds(mat('#3a2a10', '#7a5a2a', '#a07a3e', '#c09a58', '#e0c080'), 774) },
  { name: 'cocoa_beans', make: cocoa },
  { name: 'nether_wart', make: netherWart },
  { name: 'egg', make: eggItem },
  { name: 'sugar_cane', make: sugarCane },
  { name: 'kelp', make: kelpItem },
];
