/**
 * Nether terrain and plant textures (original designs): netherrack, nyliums, soul sand/soil,
 * basalt, blackstone, glowstone, wart blocks, shroomlight, nether ores, ancient debris, roots,
 * fungi, sprouts and vines.
 */
import { Tex, pal, hex, noiseTex, ore, grain, paint, rng, cells, shade, CLEAR, type Palette, type RGBA } from '../lib';
import type { TexDef } from '../registry';

const NETHERRACK: Palette = pal('#4a1414', '#5c1a1a', '#6e2020', '#7f2a27', '#93362f', '#a4443a');
const CRIMSON_N: Palette = pal('#6a0b0b', '#860f10', '#a11715', '#ba2620', '#d23a2c');
const WARPED_N: Palette = pal('#0f4a45', '#14625a', '#1a7a6c', '#22917f', '#36ad93');
const SOUL: Palette = pal('#2f2219', '#3c2c21', '#4a372a', '#584333', '#66503d');
const BASALT: Palette = pal('#2a2a2e', '#38383d', '#47474c', '#56565b', '#66666b', '#77777c');
const BLACKSTONE: Palette = pal('#141117', '#1e1a21', '#28232b', '#322c36', '#3e3742', '#4a424e');

export function netherrack(): Tex {
  const t = paint(grain(1301, [0.5, 0.32, 0.18]), NETHERRACK, { emboss: 1.6, contrast: 1.15, dither: 0.8, seed: 1301 });
  // fleshy cracks: short dark streaks with a lit pixel above
  const r = rng(1302);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 14), y = Math.floor(r() * 15);
    const len = 2 + Math.floor(r() * 2);
    for (let k = 0; k < len; k++) {
      t.set(x + k, y, NETHERRACK[0]!);
      t.set(x + k, y - 1, NETHERRACK[4]!);
    }
  }
  return t;
}

function nyliumTop(p: Palette, seed: number): Tex {
  const t = paint(grain(seed, [0.45, 0.35, 0.2]), p, { emboss: 1.2, contrast: 1.2, dither: 0.9, seed });
  const r = rng(seed + 1);
  for (let i = 0; i < 10; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), shade(p[4]!, 1.15));
  return t;
}

function nyliumSide(p: Palette, seed: number): Tex {
  const t = netherrack();
  const r = rng(seed);
  for (let x = 0; x < 16; x++) {
    // the moss hangs 3–6 pixels down the side, with drips
    const depth = 3 + Math.floor(r() * 3) + (r() < 0.2 ? 2 : 0);
    for (let y = 0; y < depth; y++) t.set(x, y, p[Math.min(4, Math.max(0, 3 - (y >> 1) + Math.floor(r() * 2)))]!);
    t.set(x, depth, shade(p[0]!, 0.8));
  }
  return t;
}

export function soulSand(): Tex {
  const t = paint(grain(1311, [0.6, 0.25, 0.15]), SOUL, { emboss: 1, contrast: 1, dither: 1, seed: 1311 });
  // faint faces in the sand: two eye pits and a mouth, three times
  const faces: [number, number][] = [[2, 3], [9, 1], [5, 10]];
  for (const [fx, fy] of faces) {
    t.set(fx, fy, SOUL[0]!);
    t.set(fx + 3, fy, SOUL[0]!);
    t.set(fx + 1, fy + 3, SOUL[0]!);
    t.set(fx + 2, fy + 3, SOUL[0]!);
    t.set(fx, fy + 1, SOUL[3]!);
    t.set(fx + 3, fy + 1, SOUL[3]!);
  }
  return t;
}

export function soulSoil(): Tex {
  return noiseTex(pal('#2b1f17', '#36281e', '#423126', '#4f3b2e', '#5c4637'), { seed: 1321, octaves: [4, 8], weights: [0.55, 0.45], emboss: 1.2, dither: 1.1, contrast: 1.2 });
}

export function basaltSide(): Tex {
  // vertical columns with dark seams
  const t = new Tex();
  const r = rng(1331);
  const seams = [0, 5, 11];
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 16; y++) {
      const seam = seams.includes(x);
      const v = seam ? 0 : Math.max(1, Math.min(5, 2 + Math.round((r() - 0.5) * 2.2) + (seams.includes(x - 1) ? 1 : 0)));
      t.set(x, y, BASALT[v]!);
    }
  for (let i = 0; i < 6; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), BASALT[1]!);
  return t;
}

export function basaltTop(): Tex {
  const c = cells(1341, 6);
  const t = new Tex();
  const r = rng(1342);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) t.set(x, y, c.edge[y * 16 + x] ? BASALT[0]! : BASALT[2 + Math.floor(r() * 3)]!);
  return t;
}

export function blackstone(): Tex {
  const t = paint(grain(1351, [0.5, 0.3, 0.2]), BLACKSTONE, { emboss: 1.5, contrast: 1.2, dither: 0.6, seed: 1351 });
  const r = rng(1352);
  for (let i = 0; i < 5; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), hex('#5a4f60'));
  return t;
}

export function glowstone(): Tex {
  const c = cells(1361, 10);
  const r = rng(1362);
  const lit = pal('#8a5a20', '#c08a35', '#e8b84f', '#fbdc79', '#fff3b8');
  const t = new Tex();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const id = c.id[y * 16 + x]!;
      const v = c.edge[y * 16 + x] ? 0 : 1 + ((id * 7 + Math.floor(r() * 2)) % 4);
      t.set(x, y, lit[v]!);
    }
  return t;
}

function wartBlock(p: Palette, seed: number): Tex {
  const t = paint(grain(seed, [0.4, 0.35, 0.25]), p, { emboss: 1.8, contrast: 1.3, dither: 0.7, seed });
  const r = rng(seed + 1);
  for (let i = 0; i < 8; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
    t.set(x, y, p[p.length - 1]!);
    t.set(x + 1, y + 1, p[0]!);
  }
  return t;
}

export function shroomlight(): Tex {
  const p = pal('#a34418', '#d06624', '#f08d35', '#ffb956', '#ffe39a');
  const t = paint(grain(1371, [0.35, 0.4, 0.25]), p, { emboss: 1, contrast: 1.2, dither: 0.5, seed: 1371 });
  const r = rng(1372);
  for (let i = 0; i < 7; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), p[4]!);
  return t;
}

export function ancientDebris(): Tex {
  const p = pal('#3a2a26', '#4c3631', '#5e443c', '#6f5249', '#836457');
  const t = new Tex();
  const r = rng(1381);
  // concentric rings like a cut, scorched trunk
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const v = Math.floor(d * 0.9 + r() * 0.8) % 4;
      t.set(x, y, p[v + (d > 6.5 ? 0 : 1)]!);
    }
  return t;
}

/** A plant on a transparent background from a pixel grid. */
function plant(rows: string[], key: Record<string, string>): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const ch = rows[y]?.[x] ?? '.';
      t.set(x, y, ch === '.' ? CLEAR : (hex(key[ch]!) as RGBA));
    }
  return t;
}

const ROOTS = [
  '................',
  '..a.......a.....',
  '..a...a...a..a..',
  '...a..a..a...a..',
  '...a..a..a..a...',
  '.a.b..b..b..a...',
  '.a.b..b.b...b.a.',
  '..ab..b.b..b..a.',
  '..b...bb...b.b..',
  '...b..bb..b..b..',
  '...b...b..b.b...',
  '....b..b.b..b...',
  '....b..bbb.b....',
  '.....b.bb.b.....',
  '......bbbb......',
  '.......bb.......',
];
const FUNGUS = [
  '................',
  '................',
  '.....aaaaa......',
  '...aabbbbbaa....',
  '..abbbcbbbbba...',
  '..abcbbbbbcba...',
  '...aaaaaaaaa....',
  '.......d........',
  '.......d........',
  '......dd........',
  '......d.........',
  '......d.........',
  '.....dd.........',
  '......d.........',
  '......d.........',
  '................',
];
const SPROUTS = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..a.......a.....',
  '..a...a...a.....',
  '...a..a..a...a..',
  '.a.b..b..b..a...',
  '..ab..b.b...b...',
  '...b..bb...b....',
  '....b.bb..b.....',
  '.....bbbbb......',
];
const VINES = [
  '......a.........',
  '......ab........',
  '.....ab.........',
  '.....a..........',
  '.....ab.........',
  '......a.........',
  '......ab........',
  '.....ba.........',
  '.....a..........',
  '.....ab.........',
  '......a.........',
  '.....ba.........',
  '.....a..........',
  '......a.........',
  '......ab........',
  '.....ba.........',
];
const VINES_TIP = [
  '......a.........',
  '......ab........',
  '.....ab.........',
  '.....a..........',
  '.....ab.........',
  '......a.........',
  '......ab........',
  '.....ba.........',
  '.....a..........',
  '.....b..........',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];
const MUSHROOM = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......aaaa......',
  '....aabbcbaa....',
  '...abbcbbbbba...',
  '...abbbbbcbba...',
  '....aaaaaaaa....',
  '.......dd.......',
  '.......de.......',
  '.......dd.......',
  '......ddde......',
  '................',
  '................',
];
const flipY = (rows: string[]) => [...rows].reverse();

/** Obsidian: glassy near-black purple with lighter conchoidal flakes. */
export function obsidian(crying = false): Tex {
  const p = pal('#06040c', '#0f0a1a', '#1a1229', '#261a3a', '#3b2a55', '#5a4480');
  const t = noiseTex(p.slice(0, 4), { seed: 1401, octaves: [4, 8], weights: [0.6, 0.4], emboss: 1.6, dither: 0.6, contrast: 1.3 });
  const r = rng(1402);
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
    t.set(x, y, p[5]!);
    t.set(x + 1, y, p[4]!);
    t.set(x, y + 1, p[4]!);
  }
  if (crying) {
    const tears = pal('#5a17c9', '#8a35ff', '#b779ff');
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(r() * 16), y = Math.floor(r() * 14);
      t.set(x, y, tears[2]!);
      t.set(x, y + 1, tears[1]!);
      t.set(x, y + 2, tears[0]!);
    }
  }
  return t;
}

export const netherTextures: TexDef[] = [
  { name: 'obsidian', make: () => obsidian() },
  { name: 'crying_obsidian', make: () => obsidian(true) },
  { name: 'netherrack', make: netherrack },
  { name: 'crimson_nylium', make: () => nyliumTop(CRIMSON_N, 1303) },
  { name: 'crimson_nylium_side', make: () => nyliumSide(CRIMSON_N, 1304) },
  { name: 'warped_nylium', make: () => nyliumTop(WARPED_N, 1305) },
  { name: 'warped_nylium_side', make: () => nyliumSide(WARPED_N, 1306) },
  { name: 'soul_sand', make: soulSand },
  { name: 'soul_soil', make: soulSoil },
  { name: 'basalt_side', make: basaltSide },
  { name: 'basalt_top', make: basaltTop },
  { name: 'blackstone', make: blackstone },
  { name: 'glowstone', make: glowstone },
  { name: 'nether_wart_block', make: () => wartBlock(pal('#5a0606', '#760a0a', '#8f1010', '#a8191a', '#c22a28'), 1391) },
  { name: 'warped_wart_block', make: () => wartBlock(pal('#0a4b4a', '#0f6463', '#137a77', '#1b908b', '#2aa9a1'), 1393) },
  { name: 'shroomlight', make: shroomlight },
  { name: 'nether_quartz_ore', make: () => ore(netherrack(), pal('#b8aca2', '#d8cec6', '#efe8e2', '#ffffff'), 1395, 6) },
  { name: 'nether_gold_ore', make: () => ore(netherrack(), pal('#a5780f', '#d8a622', '#f1cc3a', '#fff087'), 1397, 7) },
  { name: 'ancient_debris', make: ancientDebris },
  { name: 'crimson_roots', make: () => plant(ROOTS, { a: '#d2333a', b: '#8c1420' }), cutout: true },
  { name: 'warped_roots', make: () => plant(ROOTS, { a: '#32c0a8', b: '#167566' }), cutout: true },
  { name: 'nether_sprouts', make: () => plant(SPROUTS, { a: '#3fd1b0', b: '#1d8a78' }), cutout: true },
  { name: 'crimson_fungus', make: () => plant(FUNGUS, { a: '#6e0d10', b: '#b8221f', c: '#f4b04a', d: '#d8a07a' }), cutout: true },
  { name: 'warped_fungus', make: () => plant(FUNGUS, { a: '#0c5a52', b: '#159c86', c: '#f08a2a', d: '#c08a6a' }), cutout: true },
  { name: 'red_mushroom', make: () => plant(MUSHROOM, { a: '#8a1010', b: '#d42a24', c: '#f2e4d8', d: '#d8ccb8', e: '#a89c88' }), cutout: true },
  { name: 'brown_mushroom', make: () => plant(MUSHROOM, { a: '#5e4030', b: '#9a7356', c: '#b48a6a', d: '#d8ccb8', e: '#a89c88' }), cutout: true },
  { name: 'weeping_vines_plant', make: () => plant(VINES, { a: '#a1141a', b: '#d6383a' }), cutout: true },
  { name: 'weeping_vines', make: () => plant(VINES_TIP, { a: '#a1141a', b: '#d6383a' }), cutout: true },
  { name: 'twisting_vines_plant', make: () => plant(VINES, { a: '#14917c', b: '#3ad1b0' }), cutout: true },
  { name: 'twisting_vines', make: () => plant(flipY(VINES_TIP), { a: '#14917c', b: '#3ad1b0' }), cutout: true },
];
