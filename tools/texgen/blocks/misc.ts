/** Doors, trapdoors, rails, ladders, vines, crops, cactus, wool, lever, farmland, panes. */
import { Tex, pal, hex, rng, grid, shade, mix, noiseTex, type Palette } from '../lib';
import type { TexDef } from '../registry';
import { WOODS, planks } from './flora';
import { dirt } from './terrain';

const IRON = pal('#5a5a5a', '#8a8a8a', '#b9b9b9', '#dcdcdc');

function doorHalf(top: boolean): Tex {
  const w = WOODS.oak!;
  const t = planks(w, 600 + (top ? 1 : 0));
  // frame: darker 1px border on the sides, vertical boards inside
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (x === 0 || x === 15 || (top && y === 0) || (!top && y === 15)) t.set(x, y, w.plank[0]!);
      else if (x === 5 || x === 10) t.set(x, y, w.plank[1]!);
      else t.set(x, y, w.plank[2 + ((x + (y >> 2)) % 3 === 0 ? 1 : 0)]!);
    }
  if (top) {
    // two small windows
    for (let y = 3; y < 9; y++)
      for (const x0 of [2, 9])
        for (let x = x0; x < x0 + 5; x++) {
          const edge = y === 3 || y === 8 || x === x0 || x === x0 + 4;
          t.set(x, y, edge ? w.plank[0]! : [0, 0, 0, 0]);
        }
  } else {
    // handle
    t.set(12, 1, IRON[1]!);
    t.set(12, 2, IRON[2]!);
  }
  return t;
}

function trapdoor(): Tex {
  const w = WOODS.oak!;
  const t = new Tex();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const hole = (x >= 3 && x <= 6 || x >= 9 && x <= 12) && (y >= 3 && y <= 6 || y >= 9 && y <= 12);
      if (hole) continue;
      t.set(x, y, edge ? w.plank[0]! : w.plank[2 + ((x * 3 + y) % 4 === 0 ? 1 : 0)]!);
    }
  return t;
}

function rail(): Tex {
  const t = new Tex();
  const tie = WOODS.oak!.plank, r = rng(611);
  // wooden ties every 4 px
  for (let y = 0; y < 16; y++) {
    if (y % 4 === 1 || y % 4 === 2) for (let x = 1; x < 15; x++) t.set(x, y, tie[1 + Math.floor(r() * 3)]!);
  }
  // iron rails
  for (let y = 0; y < 16; y++)
    for (const x of [2, 3, 12, 13]) t.set(x, y, x === 2 || x === 12 ? IRON[1]! : IRON[3]!);
  return t;
}

function ladder(): Tex {
  const w = WOODS.oak!.plank;
  const t = new Tex();
  for (let y = 0; y < 16; y++) {
    for (const x of [1, 2, 13, 14]) t.set(x, y, x === 1 || x === 13 ? w[3]! : w[1]!);
    if (y % 4 === 2) for (let x = 3; x < 13; x++) t.set(x, y, w[3]!);
    if (y % 4 === 3) for (let x = 3; x < 13; x++) t.set(x, y, w[0]!);
  }
  return t;
}

function vine(): Tex {
  const t = new Tex();
  const r = rng(621);
  const p = pal('#4a4a4a', '#6a6a6a', '#8a8a8a', '#a8a8a8');
  // wandering stems with leaves
  for (let k = 0; k < 6; k++) {
    let x = Math.floor(r() * 16);
    for (let y = 0; y < 16; y++) {
      t.set(x, y, p[1]!);
      if (r() < 0.35) t.set(x + 1, y, p[3]!);
      if (r() < 0.35) t.set(x - 1, y, p[2]!);
      if (r() < 0.25) x = (x + (r() < 0.5 ? 1 : 15)) % 16;
    }
  }
  return t;
}

function wheatStage(stage: number): Tex {
  const t = new Tex();
  const r = rng(631 + stage);
  const green = pal('#2f6f12', '#3f8a1c', '#55a62a');
  const gold = pal('#8a6a14', '#b8901f', '#d9b23a', '#efd060');
  const h = 3 + Math.round(stage * 1.7);
  for (const bx of [1, 4, 7, 10, 13]) {
    const hh = Math.min(15, h + Math.floor(r() * 2));
    for (let i = 0; i < hh; i++) {
      const y = 15 - i;
      const ripe = stage === 7 && i > hh - 5;
      t.set(bx + (i > hh / 2 && bx % 2 ? 1 : 0), y, ripe ? gold[1 + (i % 3)]! : green[i % 3]!);
      if (ripe && i % 2 === 0) t.set(bx + 1, y, gold[3]!);
    }
  }
  return t;
}

function cactusSide(): Tex {
  const t = noiseTex(pal('#0d4a1a', '#14602a', '#1b7434', '#24863e'), { seed: 641, octaves: [2, 8], weights: [0.5, 0.5], emboss: 1, dither: 0.6 });
  for (let y = 0; y < 16; y++) {
    // ridges
    for (const x of [4, 8, 12]) t.set(x, y, hex('#0a3a14'));
    if (y % 4 === 1) for (const x of [2, 6, 10, 14]) t.set(x, y, hex('#d9dfb0'));
  }
  return t;
}

function cactusTop(): Tex {
  const t = new Tex();
  const p = pal('#14602a', '#1b7434', '#24863e', '#3da35a');
  for (let y = 1; y < 15; y++)
    for (let x = 1; x < 15; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      t.set(x, y, p[d < 3 ? 3 : d < 5 ? 2 : d < 6.5 ? 1 : 0]!);
    }
  t.set(7, 7, hex('#d9dfb0'));
  t.set(8, 8, hex('#d9dfb0'));
  return t;
}

export function wool(base: string, seed: number): Tex {
  const c = hex(base);
  const palette: Palette = [shade(c, 0.78), shade(c, 0.88), c, mix(c, [255, 255, 255, 255], 0.12)];
  const t = new Tex();
  const r = rng(seed);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      // woven diagonal pattern
      const weave = ((x + y) % 4 === 0 ? -1 : 0) + ((x - y + 16) % 4 === 0 ? 1 : 0);
      const i = Math.max(0, Math.min(3, 2 + weave + Math.round((r() - 0.5) * 1.2)));
      t.set(x, y, palette[i]!);
    }
  return t;
}

const LEVER = grid(
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......ab.......',
    '.......ab.......',
    '.......ab.......',
    '.......ab.......',
    '.......ab.......',
    '.......ab.......',
    '.......ab.......',
    '.......ab.......',
    '.......ab.......',
    '.......ab.......',
  ],
  { a: '#8a6a3c', b: '#5e4626' },
);

function farmland(wet: boolean): Tex {
  const t = dirt();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (y % 4 === 0) t.set(x, y, shade(t.get(x, y), 0.7)); // furrows
      if (wet) t.set(x, y, shade(t.get(x, y), 0.62));
    }
  return t;
}

function paneTop(): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 7; x < 9; x++) t.set(x, y, hex(x === 7 ? '#d8eef0' : '#9cc3c8'));
  return t;
}

export const miscTextures: TexDef[] = [
  { name: 'oak_door_top', make: () => doorHalf(true), cutout: true },
  { name: 'oak_door_bottom', make: () => doorHalf(false), cutout: true },
  { name: 'oak_trapdoor', make: trapdoor, cutout: true },
  { name: 'rail', make: rail, cutout: true },
  { name: 'ladder', make: ladder, cutout: true },
  { name: 'vine', make: vine, tint: 'foliage', cutout: true },
  ...Array.from({ length: 8 }, (_, i): TexDef => ({ name: `wheat_stage${i}`, make: () => wheatStage(i), cutout: true })),
  { name: 'cactus_side', make: cactusSide, cutout: true },
  { name: 'cactus_top', make: cactusTop },
  { name: 'cactus_bottom', make: cactusTop },
  { name: 'white_wool', make: () => wool('#e9ecec', 651) },
  { name: 'lever', make: () => LEVER, cutout: true },
  { name: 'farmland', make: () => farmland(false) },
  { name: 'farmland_moist', make: () => farmland(true) },
  { name: 'glass_pane_top', make: paneTop, cutout: true },
];
