/** Ingots, nuggets, gems, raw ores, coal and crafting ingredients. */
import { Tex, hex, rng, type Palette } from '../lib';
import { mat, maskOf, paintGrid, px, shadeMask, rampOf, type Mask } from './lib';
import type { ItemTexDef } from './registry';
import { TIERS } from './tools';

// ------------------------------------------------------------------ ingots

/** A bar seen from the front-top: lit top face, mid front face, dark end face. */
const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '.....ooooooooo..',
  '....ohhhhhhhhlo.',
  '...ohllllllllmo.',
  '..ohllllllllmdo.',
  '.ooooooooooomdo.',
  '.ommmmmmmmmodo..',
  '.ommmmmmmmmoo...',
  '.ooooooooooo....',
];

function ingot(p: Palette): Tex {
  const t = new Tex();
  paintGrid(t, INGOT, { o: p[0]!, d: p[1]!, m: p[2]!, l: p[3]!, h: p[4]! });
  // a stamped notch and a glint
  px(t, '4,7 5,7', p[4]!);
  px(t, '6,10 7,10', p[1]!);
  return t;
}

/** A small rounded nugget cluster. */
function nugget(p: Palette): Tex {
  const t = new Tex();
  const m = maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '......###.......',
    '.....#####......',
    '....#######.....',
    '...#########....',
    '...##########...',
    '....#########...',
    '.....######.....',
  ]);
  shadeMask(t, m, p, { seed: 201, dither: 0 });
  px(t, '6,7 7,6', p[4]!);
  px(t, '9,9 8,10', p[1]!);
  return t;
}

/** Raw ore lump: knobbly rock-like chunk of the metal. */
function rawOre(p: Palette, seed: number): Tex {
  const t = new Tex();
  const m = maskOf([
    '................',
    '................',
    '.....####.......',
    '....######.##...',
    '...###########..',
    '..############..',
    '..#############.',
    '.##############.',
    '.##############.',
    '..#############.',
    '..############..',
    '...##########...',
    '....###..####...',
    '.........##.....',
  ]);
  shadeMask(t, m, p, { seed, dither: 0.25 });
  const r = rng(seed);
  for (let i = 0; i < 7; i++) {
    const x = 3 + Math.floor(r() * 10), y = 4 + Math.floor(r() * 7);
    t.set(x, y, p[1]!);
    t.set(x - 1, y - 1, p[4]!);
  }
  return t;
}

// ------------------------------------------------------------------ gems

const DIAMOND_GEM = maskOf([
  '................',
  '................',
  '.....######.....',
  '....########....',
  '...##########...',
  '..############..',
  '..############..',
  '...##########...',
  '....########....',
  '.....######.....',
  '......####......',
  '.......##.......',
]);

function diamond(): Tex {
  const t = new Tex();
  const p = TIERS.diamond!;
  shadeMask(t, DIAMOND_GEM, p, { seed: 211, dither: 0 });
  // facets
  for (let x = 3; x < 13; x++) t.set(x, 5, p[3]!);
  px(t, '5,3 6,3 4,4 5,4', p[4]!);
  px(t, '8,6 9,7 10,6 7,7 8,8', p[1]!);
  return t;
}

function emerald(): Tex {
  const t = new Tex();
  const p = mat('#06361a', '#118a3c', '#1fbf55', '#55e383', '#c6ffd8');
  shadeMask(t, maskOf([
    '................',
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
    '....########....',
    '.....######.....',
    '......####......',
    '.......##.......',
  ]), p, { seed: 221, dither: 0 });
  for (let y = 4; y < 10; y++) t.set(7, y, p[3]!);
  for (let y = 4; y < 10; y++) t.set(9, y, p[1]!);
  px(t, '6,3 5,4', p[4]!);
  return t;
}

function lapis(): Tex {
  const t = new Tex();
  const p = mat('#0c1a52', '#1d3a9c', '#2f5ad0', '#5b84ea', '#b0c8ff');
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '......####......',
    '....#######.....',
    '...#########....',
    '..###########...',
    '..############..',
    '...###########..',
    '...##########...',
    '....########....',
    '.....#####......',
  ]), p, { seed: 231, dither: 0.3 });
  px(t, '5,6 9,8 7,10 11,7', '#e6c84a');
  return t;
}

function quartz(): Tex {
  const t = new Tex();
  const p = mat('#6e6258', '#bdb2a6', '#ddd4ca', '#f0ebe4', '#ffffff');
  shadeMask(t, maskOf([
    '................',
    '................',
    '..........##....',
    '.........####...',
    '....##..#####...',
    '...####.####....',
    '...#########....',
    '....#######.....',
    '.....######.....',
    '.....#######....',
    '....########....',
    '....##...###....',
  ]), p, { seed: 241, dither: 0 });
  return t;
}

function amethystShard(): Tex {
  const t = new Tex();
  const p = mat('#2e1650', '#5c34a0', '#8a5ad0', '#b48cf0', '#ead8ff');
  // three crystal points growing from a common base
  shadeMask(t, maskOf([
    '................',
    '.......##.......',
    '......####......',
    '......####......',
    '..##..####......',
    '..###.####..##..',
    '..###.####.###..',
    '...##.####.###..',
    '...###.##.###...',
    '...###.##.###...',
    '....###..###....',
    '....########....',
    '.....######.....',
    '......####......',
  ]), p, { seed: 251, dither: 0 });
  px(t, '7,2 7,3 2,5 12,6', p[4]!);
  for (let y = 3; y < 10; y++) t.set(8, y, p[1]!);
  return t;
}

function coal(charcoal: boolean): Tex {
  const t = new Tex();
  const p = charcoal ? mat('#140e08', '#2e2216', '#443322', '#5c4630', '#78603e') : mat('#0e0e10', '#222226', '#323238', '#4a4a52', '#6a6a74');
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '.......###......',
    '.....#######....',
    '....#########...',
    '...##########...',
    '...###########..',
    '..############..',
    '..###########...',
    '...#########....',
    '....######......',
  ]), p, { seed: charcoal ? 262 : 261, dither: 0.3 });
  if (!charcoal) px(t, '6,5 9,7 5,9', '#7a7a86');
  else for (let x = 4; x < 12; x += 2) t.set(x, 8, p[1]!); // wood grain
  return t;
}

function netheriteScrap(): Tex {
  const t = new Tex();
  const p = mat('#1a1012', '#3e2a2c', '#5a3e3e', '#76564e', '#9a7a6a');
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '.....#####......',
    '....#######.##..',
    '...###########..',
    '..############..',
    '..###########...',
    '...##########...',
    '....########....',
    '....###..###....',
  ]), p, { seed: 271, dither: 0.3 });
  px(t, '5,6 8,8 10,5', '#c8a080');
  return t;
}

// ------------------------------------------------------------------ simple ingredients

function stringItem(): Tex {
  const t = new Tex();
  // a loosely wound skein with a trailing end
  const p = mat('#6a6a6a', '#a8a8a8', '#d4d4d4', '#ececec', '#ffffff');
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '......####......',
    '....########....',
    '...##########...',
    '...##########...',
    '..############..',
    '..############..',
    '...##########...',
    '...##########...',
    '....########....',
    '......####......',
  ]), p, { seed: 280, dither: 0 });
  // winding lines across the ball
  px(t, '4,6 5,5 6,5 7,4 9,6 8,7 7,8 6,9 5,10 11,6 10,8 9,9 8,10 7,11 4,8 12,8', p[1]!);
  // loose end
  px(t, '12,11 13,12 13,13 14,14 15,14', p[2]!);
  return t;
}

function feather(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '...........###..',
    '.........#####..',
    '........######..',
    '.......######...',
    '......######....',
    '.....######.....',
    '....######......',
    '...######.......',
    '...#####........',
    '..####..........',
    '..##............',
  ]), mat('#8a8a8a', '#c4c4c4', '#e4e4e4', '#f4f4f4', '#ffffff'), { seed: 281, dither: 0 });
  for (let k = 0; k < 12; k++) t.set(2 + k, 13 - k, hex('#9a9a9a'));
  px(t, '1,14 0,15', '#7a7a7a');
  return t;
}

function gunpowder(): Tex {
  const t = new Tex();
  const r = rng(291);
  const m = maskOf([
    '................',
    '................',
    '................',
    '................',
    '.......##.......',
    '.....######.....',
    '....########....',
    '...##########...',
    '..############..',
    '..############..',
    '...##########...',
  ]);
  shadeMask(t, m, mat('#1e1e1e', '#3a3a3a', '#505050', '#686868', '#848484'), { seed: 291, dither: 0.5 });
  for (let i = 0; i < 6; i++) t.set(3 + Math.floor(r() * 10), 6 + Math.floor(r() * 4), hex('#9a9a9a'));
  return t;
}

function flint(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '...#########....',
    '...##########...',
    '..###########...',
    '..###########...',
    '...#########....',
    '....#######.....',
  ]), mat('#141416', '#2e2e32', '#46464c', '#64646a', '#8a8a90'), { seed: 301 });
  px(t, '6,5 7,4', '#a0a0a8');
  return t;
}

function bone(): Tex {
  const t = new Tex();
  const p = mat('#8a8470', '#c8c2a8', '#e2dcc4', '#f2eed8', '#ffffff');
  const m: Mask = maskOf([
    '................',
    '...........##...',
    '..........####..',
    '..........#####.',
    '.........#####..',
    '........###.....',
    '.......###......',
    '......###.......',
    '.....###........',
    '....###.........',
    '..#####.........',
    '.#####..........',
    '..####..........',
    '...##...........',
  ]);
  shadeMask(t, m, p, { seed: 311, dither: 0 });
  return t;
}

function boneMeal(): Tex {
  const t = new Tex();
  const m = maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '......###.......',
    '....#######.....',
    '...#########....',
    '..###########...',
    '..############..',
    '...##########...',
  ]);
  shadeMask(t, m, mat('#9a9888', '#cfcdbc', '#e6e4d6', '#f4f2ea', '#ffffff'), { seed: 321, dither: 0.4 });
  return t;
}

function leather(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '...##.....##....',
    '..##########....',
    '...##########...',
    '...##########...',
    '..###########...',
    '..############..',
    '...##########...',
    '...##########...',
    '..###########...',
    '..###....####...',
  ]), mat('#3e2210', '#6e3f1f', '#8f5530', '#a86a3e', '#c1844f'), { seed: 331, dither: 0.2 });
  return t;
}

function rabbitHide(): Tex {
  const t = leather();
  return t.map((c) => (c[3] < 128 ? c : [Math.min(255, c[0] + 40), Math.min(255, c[1] + 30), Math.min(255, c[2] + 20), 255]));
}

function brick(nether: boolean): Tex {
  const t = new Tex();
  const p = nether ? mat('#1a0a0c', '#3a1418', '#521c22', '#6a262c', '#843238') : mat('#4a1c10', '#8a3a24', '#a84a30', '#c4603e', '#dc8460');
  paintGrid(t, [
    '................',
    '................',
    '................',
    '................',
    '....oooooooooo..',
    '...ohhhhhhhhlo..',
    '..ohllllllllmo..',
    '.oooooooooooddo.',
    '.ommmmmmmmmmodo.',
    '.ommmmmmmmmmoo..',
    '.oooooooooooo...',
  ], { o: p[0]!, d: p[1]!, m: p[2]!, l: p[3]!, h: p[4]! });
  return t;
}

function clayBall(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '......####......',
    '....########....',
    '...##########...',
    '...##########...',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
    '......####......',
  ]), mat('#5a5e6c', '#8c92a2', '#a4aaba', '#bcc2d0', '#dadfea'), { seed: 341, dither: 0.2 });
  return t;
}

function paper(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '..###########...',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...###########..',
  ]), mat('#9a9a8a', '#d8d8cc', '#eeeee4', '#f8f8f0', '#ffffff'), { seed: 351, dither: 0.1 });
  for (let y = 4; y < 11; y += 2) for (let x = 4; x < 12; x++) t.set(x, y, hex('#d8d8cc'));
  return t;
}

function slimeBall(magma: boolean): Tex {
  const t = new Tex();
  const p = magma ? mat('#3a0e04', '#8a2a08', '#d0560e', '#f69a2a', '#ffe070') : mat('#2a5a1e', '#4a9a38', '#68c050', '#8ede72', '#c8ffb0');
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
  ]), p, { seed: magma ? 362 : 361, dither: 0 });
  px(t, '5,5 6,4', p[4]!);
  if (magma) px(t, '7,7 9,6 8,8 10,8', '#3a0e04');
  return t;
}

function rod(p: Palette, glow = false): Tex {
  const t = new Tex();
  for (let x = 3; x <= 12; x++) {
    t.set(x, 15 - x, p[3]!);
    t.set(x, 16 - x, p[1]!);
  }
  px(t, '3,13 12,3', p[4]!);
  if (glow) px(t, '6,9 9,6', p[4]!);
  return t;
}

function powder(p: Palette, seed: number): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......###......',
    '.....#######....',
    '....#########...',
    '...###########..',
    '..############..',
    '...##########...',
  ]), p, { seed, dither: 0.5 });
  const r = rng(seed);
  for (let i = 0; i < 4; i++) t.set(3 + Math.floor(r() * 10), 2 + Math.floor(r() * 3), p[3]!);
  return t;
}

function tear(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.......##.......',
    '.......##.......',
    '......####......',
    '......####......',
    '.....######.....',
    '.....######.....',
    '....########....',
    '....########....',
    '....########....',
    '.....######.....',
    '......####......',
  ]), mat('#6a8a9a', '#a8c8d8', '#cce4f0', '#e4f4fc', '#ffffff'), { seed: 371, dither: 0 });
  return t;
}

function pearl(eye: boolean): Tex {
  const t = new Tex();
  const p = eye ? mat('#0c2a1e', '#1c5a40', '#2e8a62', '#4cb888', '#9ae8c4') : mat('#06201e', '#0e4a44', '#16706a', '#2a9a92', '#7ad8d0');
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '......####......',
    '....########....',
    '....########....',
    '...##########...',
    '...##########...',
    '...##########...',
    '...##########...',
    '....########....',
    '....########....',
    '......####......',
  ]), p, { seed: eye ? 382 : 381, dither: 0 });
  if (eye) {
    px(t, '6,7 7,7 8,7 9,7 6,8 7,8 8,8 9,8', '#d8e86a');
    px(t, '7,7 8,7 7,8 8,8', '#141a0a');
  } else px(t, '5,5 6,4', p[4]!);
  return t;
}

function shard(p: Palette, crystal: boolean): Tex {
  const t = new Tex();
  const m = crystal
    ? maskOf(['................', '................', '....##....##....', '...####..####...', '...####..####...', '....##....##....', '.......##.......', '......####......', '......####......', '.......##.......', '...##......##...', '..####....####..', '...##......##...'])
    : maskOf(['................', '................', '..........###...', '.........####...', '........####....', '.......####.....', '......####......', '.....####.......', '....####........', '...####.........', '...###..........', '...##...........']);
  shadeMask(t, m, p, { seed: crystal ? 392 : 391, dither: 0 });
  return t;
}

function scute(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '................',
    '....########....',
    '...##########...',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
    '......####......',
  ]), mat('#14361a', '#2c6a33', '#43914a', '#5fb365', '#93d58f'), { seed: 401, dither: 0 });
  px(t, '5,5 8,5 11,5 6,7 9,7', '#2c6a33');
  return t;
}

function membrane(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '...##......##...',
    '..####....####..',
    '..#####..#####..',
    '..############..',
    '...##########...',
    '...##########...',
    '....########....',
    '....###..###....',
    '.....#....#.....',
  ]), mat('#5a5a3a', '#a8a878', '#c8c894', '#dcdcae', '#f0f0d0'), { seed: 411, dither: 0.2 });
  return t;
}

function shell(nautilus: boolean): Tex {
  const t = new Tex();
  const p = nautilus ? mat('#5a3a2a', '#b88a6a', '#dcb898', '#efd8c0', '#ffffff') : mat('#3a1e3a', '#7a4a7a', '#9a6a9a', '#b88ab8', '#dcb8dc');
  shadeMask(t, maskOf([
    '................',
    '................',
    '.....######.....',
    '...##########...',
    '..############..',
    '..############..',
    '.##############.',
    '.##############.',
    '..############..',
    '..############..',
    '...##########...',
    '.....######.....',
  ]), p, { seed: nautilus ? 422 : 421, dither: 0 });
  if (nautilus) px(t, '6,6 7,5 8,5 9,6 9,7 8,8 7,8 6,7 4,8 5,10 10,10', p[1]!);
  else for (let x = 2; x < 14; x++) t.set(x, 7, p[1]!);
  return t;
}

function honeycomb(): Tex {
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
    '...##########...',
    '....########....',
    '.....######.....',
  ]), mat('#6a3a04', '#c07a10', '#e8a020', '#f8c43c', '#fff090'), { seed: 431, dither: 0 });
  px(t, '5,4 8,4 4,6 7,6 10,6 5,8 8,8 11,7', '#a05a08');
  return t;
}

function star(): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '.......##.......',
    '.......##.......',
    '......####......',
    '......####......',
    '##############..',
    '.############...',
    '..##########....',
    '...########.....',
    '...########.....',
    '..####..####....',
    '..###....###....',
    '.###......###...',
    '.##........##...',
  ]), mat('#8a8a6a', '#d8d8b8', '#f2f2dc', '#fafaee', '#ffffff'), { seed: 441, dither: 0 });
  px(t, '7,5 8,6 7,7', '#a0d8ff');
  return t;
}

const IRON = TIERS.iron!, GOLD = TIERS.golden!, NETH = TIERS.netherite!;
const COPPER = mat('#4a2010', '#9a4a2a', '#c86a40', '#e48a5c', '#ffc0a0');

export const materialItems: ItemTexDef[] = [
  { name: 'coal', make: () => coal(false) },
  { name: 'charcoal', make: () => coal(true) },
  { name: 'iron_ingot', make: () => ingot(IRON) },
  { name: 'gold_ingot', make: () => ingot(GOLD) },
  { name: 'copper_ingot', make: () => ingot(COPPER) },
  { name: 'netherite_ingot', make: () => ingot(NETH) },
  { name: 'iron_nugget', make: () => nugget(IRON) },
  { name: 'gold_nugget', make: () => nugget(GOLD) },
  { name: 'raw_iron', make: () => rawOre(mat('#4a3424', '#8a6a52', '#b8957a', '#d8b89c', '#f0dcc8'), 501) },
  { name: 'raw_gold', make: () => rawOre(GOLD, 502) },
  { name: 'raw_copper', make: () => rawOre(COPPER, 503) },
  { name: 'netherite_scrap', make: netheriteScrap },
  { name: 'diamond', make: diamond },
  { name: 'emerald', make: emerald },
  { name: 'lapis_lazuli', make: lapis },
  { name: 'quartz', make: quartz },
  { name: 'amethyst_shard', make: amethystShard },
  { name: 'string', make: stringItem },
  { name: 'feather', make: feather },
  { name: 'gunpowder', make: gunpowder },
  { name: 'flint', make: flint },
  { name: 'bone', make: bone, handheld: true },
  { name: 'bone_meal', make: boneMeal },
  { name: 'leather', make: leather },
  { name: 'rabbit_hide', make: rabbitHide },
  { name: 'brick', make: () => brick(false) },
  { name: 'nether_brick', make: () => brick(true) },
  { name: 'clay_ball', make: clayBall },
  { name: 'paper', make: paper },
  { name: 'slime_ball', make: () => slimeBall(false) },
  { name: 'magma_cream', make: () => slimeBall(true) },
  { name: 'blaze_rod', make: () => rod(mat('#5a2a00', '#c87a00', '#f0b000', '#ffd840', '#fff8b0'), true), handheld: true },
  { name: 'blaze_powder', make: () => powder(mat('#6a2a00', '#c86a00', '#f0a010', '#ffd040', '#fff4a0'), 451) },
  { name: 'glowstone_dust', make: () => powder(mat('#6a4a10', '#b88a30', '#e4c060', '#f8e090', '#fffbd8'), 452) },
  { name: 'redstone', make: () => powder(mat('#3a0000', '#7a0000', '#b00a0a', '#e02020', '#ff6a5a'), 453) },
  { name: 'sugar', make: () => powder(mat('#a8a8b0', '#dcdce4', '#eeeef4', '#f8f8fc', '#ffffff'), 454) },
  { name: 'ghast_tear', make: tear },
  { name: 'ender_pearl', make: () => pearl(false) },
  { name: 'ender_eye', make: () => pearl(true) },
  { name: 'prismarine_shard', make: () => shard(mat('#1a4a44', '#3a8a7a', '#5aac9a', '#80ccb8', '#bcece0'), false) },
  { name: 'prismarine_crystals', make: () => shard(mat('#4a6a5a', '#9acab4', '#c4e8d4', '#e0f8ec', '#ffffff'), true) },
  { name: 'scute', make: scute },
  { name: 'phantom_membrane', make: membrane },
  { name: 'nautilus_shell', make: () => shell(true) },
  { name: 'shulker_shell', make: () => shell(false) },
  { name: 'honeycomb', make: honeycomb },
  { name: 'nether_star', make: star },
  { name: 'rabbit_foot', make: () => {
    const t = new Tex();
    shadeMask(t, maskOf(['................', '................', '.........###....', '........####....', '.......####.....', '......####......', '.....####.......', '....#####.......', '...######.......', '..#######.......', '..######........', '...####.........']), mat('#5a4030', '#a08060', '#c0a07c', '#d8bc98', '#f0dcc0'), { seed: 461 });
    px(t, '3,11 5,11', '#f0c0b0');
    return t;
  } },
  { name: 'heart_of_the_sea', make: () => {
    const t = pearl(false);
    return t.map((c) => (c[3] < 128 ? c : [c[0] >> 1, Math.min(255, c[1] + 30), Math.min(255, c[2] + 90), 255]));
  } },
  { name: 'ink_sac', make: () => slimeBallAs(mat('#0a0a10', '#1e1e2a', '#2e2e40', '#44445a', '#6a6a86')) },
  { name: 'glow_ink_sac', make: () => slimeBallAs(mat('#0a3a34', '#1a7a6a', '#2ab49c', '#5ae0c8', '#c0fff0')) },
];

function slimeBallAs(p: Palette): Tex {
  const t = new Tex();
  shadeMask(t, maskOf([
    '................',
    '................',
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '...##########...',
    '...##########...',
    '....########....',
    '.....######.....',
    '....##.##.##....',
  ]), p, { seed: 471, dither: 0 });
  return t;
}

export { rampOf, COPPER };
