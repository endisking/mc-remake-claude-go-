/** GUI sprite sheets (original designs): buttons, sliders, hotbar, selection frame. */
import { Tex, hex, rng, mix, type RGBA } from './lib';

function bevelBox(t: Tex, x0: number, y0: number, w: number, h: number, face: RGBA[], light: RGBA, dark: RGBA, outline: RGBA, seed: number): void {
  const r = rng(seed);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c: RGBA;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c = outline;
      else if (x === 1 || y === 1) c = light;
      else if (x === w - 2 || y === h - 2) c = dark;
      else c = face[Math.floor(r() * face.length)]!;
      t.set(x0 + x, y0 + y, c);
    }
}

export function widgets(): Tex {
  const t = new Tex(256, 256);
  const face = [hex('#6f7176'), hex('#717378'), hex('#6c6e73'), hex('#737579')];
  bevelBox(t, 0, 0, 200, 20, face, hex('#a4a6ab'), hex('#4c4d51'), hex('#000000'), 1); // normal
  const hov = face.map((c) => mix(c, hex('#7f9cd6'), 0.35));
  bevelBox(t, 0, 20, 200, 20, hov, hex('#c7d6f7'), hex('#4f5f86'), hex('#ffffff'), 2); // hover
  const dis = face.map((c) => mix(c, hex('#2a2a2a'), 0.55));
  bevelBox(t, 0, 40, 200, 20, dis, hex('#3e3e3e'), hex('#262626'), hex('#000000'), 3); // disabled
  bevelBox(t, 0, 60, 8, 20, face, hex('#a4a6ab'), hex('#4c4d51'), hex('#000000'), 4); // slider handle
  bevelBox(t, 8, 60, 8, 20, hov, hex('#c7d6f7'), hex('#4f5f86'), hex('#ffffff'), 5); // slider handle hover
  // hotbar 182×22: nine 20×20 slots with dark wells
  const frame = hex('#1d1d1f'), well = hex('#8b8b8b');
  for (let y = 0; y < 22; y++)
    for (let x = 0; x < 182; x++) {
      const edge = x === 0 || y === 0 || x === 181 || y === 21;
      const slotX = (x - 1) % 20;
      const border = slotX === 0 || slotX === 19 || y === 1 || y === 20;
      t.set(x, 80 + y, edge ? frame : border ? hex('#2e2e31') : mix(well, frame, 0.55));
    }
  // offhand slot frames 29×24 (left variant at x=24, right at x=53): a single slot with a rim
  for (const [ox, rimLeft] of [[24, true], [53, false]] as const) {
    for (let y = 0; y < 24; y++)
      for (let x = 0; x < 29; x++) {
        // the 22-px tall slot box sits 1 px down, 22 px wide, on the side away from the hotbar
        const bx = rimLeft ? x : x - 7, by = y - 1;
        if (bx < 0 || bx >= 22 || by < 0 || by >= 22) continue;
        const edge = bx === 0 || by === 0 || bx === 21 || by === 21;
        const border = bx === 1 || by === 1 || bx === 20 || by === 20;
        t.set(ox + x, 104 + y, edge ? frame : border ? hex('#2e2e31') : mix(well, frame, 0.55));
      }
  }
  // selection frame 24×24
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 24; x++) {
      const outer = x === 0 || y === 0 || x === 23 || y === 23;
      const inner = x === 1 || y === 1 || x === 22 || y === 22;
      if (outer) t.set(x, 104 + y, hex('#000000'));
      else if (inner) t.set(x, 104 + y, hex('#f2f2f2'));
      else if (x === 2 || y === 2 || x === 21 || y === 21) t.set(x, 104 + y, hex('#9e9e9e'));
    }
  return t;
}

/** Tiled dirt-like menu background (darkened when drawn). */
export function optionsBackground(): Tex {
  const t = new Tex(16, 16);
  const r = rng(909);
  const p = [hex('#3b2c22'), hex('#45342a'), hex('#4f3c30'), hex('#5a4536')];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, p[Math.floor(r() * 4)]!);
  return t;
}

/** Draw a sprite from rows of characters; each character maps to a colour ('.' = transparent). */
function sprite(t: Tex, x0: number, y0: number, rows: string[], pal: Record<string, RGBA>): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]!];
      if (c) t.set(x0 + x, y0 + y, c);
    }
  });
}

// 9×9 masks: o = outline, f = fill, h = highlight, s = shade
const HEART = [
  '.ooo.ooo.',
  'ohhfofffo',
  'ohffffffo',
  'offfffffo',
  'offffffso',
  '.offffso.',
  '..offso..',
  '...oso...',
  '....o....',
];
const HEART_HARDCORE = [
  'o.oo.oo.o',
  'ohhfofffo',
  'ohfofofso',
  'offfffffo',
  'offffffso',
  '.offffso.',
  '..offso..',
  '...oso...',
  '....o....',
];
const CONTAINER = [
  '.ooo.ooo.',
  'o...o...o',
  'o.......o',
  'o.......o',
  'o.......o',
  '.o.....o.',
  '..o...o..',
  '...o.o...',
  '....o....',
];
const SHANK = [
  '....oooo.',
  '...offfso',
  '..offhffo',
  '..ofhfffo',
  '..offffo.',
  '.oossoo..',
  'obbo.....',
  'obo......',
  '.o.......',
];
const SHANK_EMPTY = [
  '....oooo.',
  '...o....o',
  '..o.....o',
  '..o.....o',
  '..o....o.',
  '.ooooo...',
  'o..o.....',
  'o.o......',
  '.o.......',
];
const SHANK_HALF = SHANK.map((r) => '.....' .slice(0, 0) + r.slice(0, 5) + '....');
const CHEST = [
  '.oo...oo.',
  'ohfoooffo',
  'ohfffffso',
  '.ofhfffo.',
  '.offfffo.',
  '.ofhfffo.',
  '.offfffo.',
  '.osssss o'.replace(' ', 'o'),
  '..ooooo..',
];
const CHEST_EMPTY = [
  '.oo...oo.',
  'o..ooo..o',
  'o.......o',
  '.o.....o.',
  '.o.....o.',
  '.o.....o.',
  '.o.....o.',
  '.o.....o.',
  '..ooooo..',
];
const BUBBLE = [
  '..ooooo..',
  '.ohhfffo.',
  'ohhfffffo',
  'ohffffffo',
  'offfffffo',
  'offfffsfo',
  'offffssfo',
  '.offfffo.',
  '..ooooo..',
];
const BUBBLE_POP = [
  '.........',
  '..o...o..',
  '...h.h...',
  '.o.....o.',
  '.........',
  '.o.....o.',
  '...h.h...',
  '..o...o..',
  '.........',
];

/** HUD icon sheet (original art in the vanilla icons.png layout: hearts, armour, air, food, XP bar). */
export function icons(): Tex {
  const t = new Tex(256, 256);
  const outline = hex('#1a0b0b');
  const heart = (fill: RGBA, hi: RGBA, sh: RGBA, ol = outline) => ({ o: ol, f: fill, h: hi, s: sh });
  const types: Record<string, Record<string, RGBA>> = {
    normal: heart(hex('#d8202a'), hex('#ff9a9a'), hex('#981018')),
    poisoned: heart(hex('#7d8a1f'), hex('#c4d06a'), hex('#4f5a10')),
    withered: heart(hex('#2b2b2b'), hex('#6a6a6a'), hex('#141414'), hex('#000000')),
    absorbing: heart(hex('#e8b414'), hex('#fff09a'), hex('#a8780a')),
    frozen: heart(hex('#7cc8f0'), hex('#e6f8ff'), hex('#3e88b8'), hex('#14304a')),
  };
  const blinkOf = (p: Record<string, RGBA>) => ({ o: hex('#ffffff'), f: mix(p.f!, hex('#ffffff'), 0.45), h: hex('#ffffff'), s: mix(p.s!, hex('#ffffff'), 0.3) });
  for (const [row, shape] of [[0, HEART], [45, HEART_HARDCORE]] as const) {
    sprite(t, 16, row, CONTAINER.map((r) => r.replace(/\./g, '.')), { o: hex('#000000') });
    // container interior is dark, the blinking container is white-outlined
    sprite(t, 16, row, HEART.map((r) => r.replace(/[hfs]/g, 'd')), { d: hex('#3a1414') });
    sprite(t, 25, row, HEART.map((r) => r.replace(/[hfs]/g, 'd')), { o: hex('#ffffff'), d: hex('#5a2a2a') });
    const order: [string, number, boolean][] = [['normal', 2, true], ['poisoned', 4, true], ['withered', 6, true], ['absorbing', 8, false], ['frozen', 9, false]];
    for (const [name, index, blinks] of order) {
      const pal = types[name]!;
      const half = (rows: string[]) => rows.map((r) => r.slice(0, 5) + '....');
      const x = (i: number) => 16 + (index * 2 + i) * 9;
      sprite(t, x(0), row, shape, pal);
      sprite(t, x(1), row, half(shape), pal);
      if (blinks) {
        sprite(t, x(2), row, shape, blinkOf(pal));
        sprite(t, x(3), row, half(shape), blinkOf(pal));
      }
    }
  }
  // armour (v=9): empty, half, full
  const steel = { o: hex('#1c1c1c'), f: hex('#c9c9c9'), h: hex('#f4f4f4'), s: hex('#7e7e7e') };
  sprite(t, 16, 9, CHEST_EMPTY, { o: hex('#1c1c1c') });
  sprite(t, 25, 9, CHEST_EMPTY, { o: hex('#1c1c1c') });
  sprite(t, 25, 9, CHEST.map((r) => r.slice(0, 5) + '....'), steel);
  sprite(t, 34, 9, CHEST, steel);
  // air (v=18): bubble, popping bubble
  sprite(t, 16, 18, BUBBLE, { o: hex('#0d3d73'), f: hex('#3f8fe0'), h: hex('#d8f0ff'), s: hex('#2266b0') });
  sprite(t, 25, 18, BUBBLE_POP, { o: hex('#3f8fe0'), h: hex('#d8f0ff') });
  // food (v=27): background, then full/half; hunger-effect variants 36 px further right
  const meat = { o: hex('#2a1408'), f: hex('#b4602a'), h: hex('#f0a868'), s: hex('#6e3412'), b: hex('#f2e8d8') };
  const rotten = { o: hex('#16200a'), f: hex('#6f7f2a'), h: hex('#b0c060'), s: hex('#3e4a14'), b: hex('#d8dcb8') };
  sprite(t, 16, 27, SHANK_EMPTY, { o: hex('#1a1a1a') });
  sprite(t, 16 + 13 * 9, 27, SHANK_EMPTY, { o: hex('#16200a') });
  sprite(t, 52, 27, SHANK, meat);
  sprite(t, 61, 27, SHANK_HALF, meat);
  sprite(t, 88, 27, SHANK, rotten);
  sprite(t, 97, 27, SHANK_HALF, rotten);
  // XP bar (v=64 background, v=69 progress), 182×5
  for (let x = 0; x < 182; x++)
    for (let y = 0; y < 5; y++) {
      const edge = y === 0 || y === 4 || x === 0 || x === 181;
      const notch = x % 20 === 0 || (x % 20 === 19 && x < 180);
      t.set(x, 64 + y, edge || notch ? hex('#0e1a08') : hex('#2b3a1c'));
      t.set(x, 69 + y, edge ? hex('#123a04') : notch ? hex('#3c8a10') : y === 1 ? hex('#b8ff5a') : hex('#78e020'));
    }
  return t;
}
