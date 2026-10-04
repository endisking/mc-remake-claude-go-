/**
 * Redstone components, workstations and other special blocks: redstone dust, powered /
 * detector / activator rails, repeaters, comparators, pistons, hoppers, cauldrons,
 * enchanting table, anvil, brewing stand, cake, campfires, barrel, smoker, blast furnace,
 * job-site tables, signs, banners, skulls, candles, End blocks and more. Original pixel art.
 */
import { Tex, pal, hex, rng, shade, mix, paint, grain, noiseTex, type Palette, type RGBA } from '../lib';
import type { TexDef } from '../registry';
import { WOODS, planks, logSide, logTop } from './flora';

const IRON = pal('#3a3a3e', '#5e5e64', '#8a8a90', '#b4b4ba', '#dcdce0');
const STONE = pal('#5a5a5d', '#6a6a6d', '#7b7b7e', '#8c8c8f', '#a0a0a3');
const COBBLE = pal('#3e3e40', '#535356', '#68686b', '#7b7b7e', '#8f8f92');
const DYES: Record<string, string> = {
  white: '#e9ecec', orange: '#f07613', magenta: '#bd44b3', light_blue: '#3aafd9', yellow: '#f8c627', lime: '#70b919', pink: '#ed8dac', gray: '#3e4447',
  light_gray: '#8e8e86', cyan: '#158991', purple: '#792aac', blue: '#35399d', brown: '#724728', green: '#546d1b', red: '#a12722', black: '#141519',
};
const clamp = (c: RGBA): RGBA => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), c[3]];
function frame(t: Tex, light: RGBA, dark: RGBA): Tex {
  for (let i = 0; i < 16; i++) { t.set(i, 0, light); t.set(0, i, light); t.set(i, 15, dark); t.set(15, i, dark); }
  return t;
}
function base(p: Palette, seed: number): Tex {
  return paint(grain(seed, [0.4, 0.4, 0.2]), p.slice(1, 4), { emboss: 0.6, dither: 0.6, seed });
}

// ------------------------------------------------------------------ redstone
function dust(kind: 'dot' | 'line'): Tex {
  // grayscale, tinted by signal strength
  const t = new Tex();
  const g = pal('#9a9a9a', '#c8c8c8', '#f0f0f0');
  if (kind === 'dot') {
    for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if (Math.hypot(x - 7.5, y - 7.5) < 3.3) t.set(x, y, g[(x + y) % 3]!);
  } else {
    for (let y = 0; y < 16; y++) for (let x = 6; x < 10; x++) if ((x === 6 || x === 9) ? (y * 7 + x) % 3 !== 0 : true) t.set(x, y, g[(x + y) % 3]!);
  }
  return t;
}
function specialRail(kind: 'powered' | 'detector' | 'activator', on: boolean): Tex {
  const t = new Tex();
  const tie = WOODS.oak!.plank, r = rng(2001);
  for (let y = 0; y < 16; y++) if (y % 4 === 1 || y % 4 === 2) for (let x = 1; x < 15; x++) t.set(x, y, tie[1 + Math.floor(r() * 3)]!);
  const railCol = kind === 'powered' ? pal('#8a6a10', '#e8c430') : IRON.slice(2, 4);
  for (let y = 0; y < 16; y++) for (const x of [2, 3, 12, 13]) t.set(x, y, railCol[x === 2 || x === 12 ? 0 : 1]!);
  const mid = kind === 'detector' ? (on ? hex('#ff3020') : hex('#6a1a1a')) : on ? hex('#ff4020') : hex('#5a1414');
  for (let y = 0; y < 16; y++) for (const x of [7, 8]) if (y % 4 !== 3) t.set(x, y, kind === 'detector' ? (y > 5 && y < 10 ? mid : IRON[1]!) : mid);
  return t;
}
function diode(kind: 'repeater' | 'comparator', on: boolean): Tex {
  const t = base(STONE, 2011);
  frame(t, STONE[4]!, STONE[0]!);
  const dustC = on ? hex('#ff3018') : hex('#6a1010');
  if (kind === 'repeater') { for (let y = 2; y < 14; y++) t.set(8, y, dustC); for (let x = 5; x < 12; x++) t.set(x, 14, dustC); }
  else { for (let y = 2; y < 14; y++) { t.set(5, y, dustC); t.set(10, y, dustC); } for (let x = 5; x < 11; x++) t.set(x, 4, dustC); }
  return t;
}
function piston(face: 'top' | 'top_sticky' | 'side' | 'bottom' | 'inner'): Tex {
  const w = WOODS.oak!;
  if (face === 'top' || face === 'top_sticky') {
    const t = planks(w, 2021);
    frame(t, w.plank[4]!, w.plank[0]!);
    if (face === 'top_sticky') for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, hex(['#5aa040', '#78c058', '#4a8a34'][(x * 3 + y) % 3]!));
    else for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, IRON[3]!);
    return t;
  }
  const t = base(COBBLE, 2022);
  frame(t, COBBLE[4]!, COBBLE[0]!);
  if (face === 'side') { const p = planks(w, 2023); for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) t.set(x, y, p.get(x, y)); for (let y = 4; y < 16; y++) for (const x of [7, 8]) t.set(x, y, IRON[x === 7 ? 3 : 1]!); }
  if (face === 'bottom') for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, IRON[1]!);
  if (face === 'inner') for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, IRON[3]!);
  return t;
}
function hopper(face: 'outside' | 'inside' | 'top'): Tex {
  const t = base(IRON, face === 'inside' ? 2032 : 2031);
  frame(t, IRON[4]!, IRON[0]!);
  if (face === 'top') for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, (x === 2 || y === 2) ? IRON[0]! : IRON[1]!);
  if (face === 'inside') return t.map((c) => shade(c, 0.7));
  return t;
}
function cauldron(face: 'side' | 'top' | 'inner' | 'bottom'): Tex {
  const t = base(IRON.map((c) => shade(c, 0.8)), 2041);
  if (face === 'side') { for (let y = 13; y < 16; y++) for (let x = 4; x < 12; x++) t.set(x, y, [0, 0, 0, 0]); frame(t, IRON[3]!, IRON[0]!); for (let y = 13; y < 16; y++) for (let x = 4; x < 12; x++) t.set(x, y, [0, 0, 0, 0]); }
  if (face === 'top') for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, [0, 0, 0, 0]);
  return t;
}
function observerBack(on: boolean): Tex {
  const t = base(COBBLE, 2051);
  frame(t, COBBLE[4]!, COBBLE[0]!);
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, on ? hex('#ff3018') : hex('#4a1010'));
  return t;
}
function daylight(inverted: boolean): Tex {
  const t = new Tex();
  const glass = inverted ? pal('#2a4060', '#3a5a80') : pal('#c8d8e0', '#e8f4f8');
  const w = WOODS.oak!;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, (x % 5 === 0 || y % 5 === 0) ? w.plank[1]! : glass[(x + y) % 2]!);
  return t;
}
function lightningRod(): Tex {
  const t = new Tex();
  const p = pal('#8a4a30', '#c06c48', '#eaa47e');
  for (let y = 0; y < 16; y++) { t.set(0, y, p[2]!); t.set(1, y, p[1]!); }
  for (let y = 0; y < 4; y++) for (let x = 2; x < 6; x++) t.set(x, y, p[y === 0 ? 2 : 1]!);
  return t;
}
function tripwireHook(): Tex {
  const t = new Tex();
  const w = WOODS.oak!;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) t.set(x, y, w.plank[x === 0 ? 3 : 1]!);
  for (let y = 0; y < 5; y++) t.set(6, y, IRON[3]!);
  for (let x = 6; x < 10; x++) t.set(x, 5, IRON[2]!);
  return t;
}
function tripwire(): Tex {
  const t = new Tex();
  for (let x = 0; x < 16; x++) t.set(x, 7, hex(x % 2 ? '#e0e0e0' : '#b0b0b0'));
  return t;
}

// ------------------------------------------------------------------ workstations
function enchantingTable(face: 'top' | 'side' | 'bottom'): Tex {
  const obs = pal('#0c0a14', '#14101e', '#1c1628', '#261e36', '#342848');
  if (face === 'bottom') return base(obs, 2061);
  const t = base(obs, 2062);
  if (face === 'top') {
    for (let y = 3; y < 13; y++) for (let x = 2; x < 14; x++) t.set(x, y, x === 7 || x === 8 ? hex('#5a3a20') : hex((x + y) % 2 ? '#e8dcc0' : '#d4c8a8'));
    for (let x = 2; x < 14; x++) { t.set(x, 3, hex('#8a1a1a')); t.set(x, 12, hex('#8a1a1a')); }
    return t;
  }
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex(['#8a1a1a', '#a82424', '#c03030'][(x + y) % 3]!));
  for (let x = 2; x < 14; x += 3) t.set(x, 2, hex('#f0c040'));
  return t;
}
function anvil(face: 'base' | 'top'): Tex {
  const t = base(pal('#262628', '#323236', '#3e3e44', '#4a4a50', '#5a5a62'), face === 'top' ? 2072 : 2071);
  if (face === 'top') for (let y = 2; y < 14; y++) for (let x = 3; x < 13; x++) if (x === 3 || x === 12 || y === 2 || y === 13) t.set(x, y, hex('#6a6a72'));
  return t;
}
function brewingStand(base: boolean): Tex {
  const t = new Tex();
  if (base) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (Math.hypot((x % 8) - 3.5, (y % 8) - 3.5) < 3.4) t.set(x, y, COBBLE[2 + ((x + y) % 2)]!); return t; }
  for (let y = 2; y < 16; y++) { t.set(7, y, hex('#e8c060')); t.set(8, y, hex('#a07a30')); }
  for (let x = 2; x < 14; x++) t.set(x, 4, hex('#c09a40'));
  for (const x of [2, 13]) for (let y = 4; y < 9; y++) t.set(x, y, hex('#a07a30'));
  return t;
}
function cake(face: 'top' | 'side' | 'bottom' | 'inner'): Tex {
  const t = new Tex();
  const sponge = pal('#a8642a', '#c07a38', '#d48e48');
  const frost = pal('#e8e0e0', '#f8f4f4', '#ffffff');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c: RGBA;
    if (face === 'top') c = frost[(x * 7 + y * 3) % 5 === 0 ? 0 : (x + y) % 2 ? 1 : 2]!;
    else if (face === 'bottom') c = sponge[0]!;
    else if (y < 9) c = [0, 0, 0, 0];
    else if (y < 11) c = frost[1]!;
    else c = sponge[(x + y) % 3]!;
    t.set(x, y, c);
  }
  if (face === 'top') for (const [x, y] of [[4, 4], [11, 5], [7, 9], [3, 11], [12, 12]] as [number, number][]) t.set(x, y, hex('#d02030'));
  if (face === 'side') for (let x = 1; x < 15; x += 3) t.set(x, 11, frost[2]!);
  if (face === 'inner') for (let y = 9; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, y < 11 ? frost[1]! : sponge[1 + (x % 2)]!);
  return t;
}
function campfire(kind: 'log' | 'log_lit' | 'fire' | 'soul_fire'): Tex {
  const w = WOODS.oak!;
  if (kind === 'log' || kind === 'log_lit') {
    const t = logSide(w, 2081);
    if (kind === 'log_lit') for (let x = 0; x < 16; x++) for (const y of [7, 8]) t.set(x, y, hex(x % 3 ? '#f08a20' : '#ffd040'));
    for (let y = 0; y < 16; y++) for (const x of [0, 15]) t.set(x, y, logTop(w, 2082).get(x, y));
    return t;
  }
  const t = new Tex();
  const p = kind === 'fire' ? pal('#c03a10', '#f07a20', '#ffc840', '#fff4b0') : pal('#1a6a7a', '#30a8c0', '#7ae8f0', '#e8ffff');
  const r = rng(kind === 'fire' ? 2083 : 2084);
  for (let x = 0; x < 16; x++) {
    const h = 6 + Math.floor((1 - Math.abs(x - 7.5) / 8) * 9 + r() * 3);
    for (let i = 0; i < h; i++) t.set(x, 15 - i, p[i < h * 0.3 ? 3 : i < h * 0.6 ? 2 : i < h * 0.85 ? 1 : 0]!);
  }
  return t;
}
function barrel(face: 'side' | 'top' | 'top_open' | 'bottom'): Tex {
  const w = WOODS.spruce!;
  const t = planks(w, 2091);
  if (face === 'side') { for (let x = 0; x < 16; x++) for (const y of [2, 13]) { t.set(x, y, IRON[1]!); t.set(x, y + 1, IRON[2]!); } return t; }
  frame(t, IRON[2]!, IRON[0]!);
  if (face === 'top_open') for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, hex('#1a120a'));
  if (face === 'top') for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) t.set(x, y, w.plank[0]!);
  return t;
}
function smokerLike(kind: 'smoker' | 'blast_furnace', face: 'front' | 'front_on' | 'side' | 'top'): Tex {
  const p = kind === 'smoker' ? pal('#2e2a26', '#46403a', '#5a524a', '#6e665c', '#847a6e') : pal('#323236', '#48484e', '#5c5c62', '#707078', '#868690');
  const t = base(p, kind === 'smoker' ? 2101 : 2102);
  frame(t, p[4]!, p[0]!);
  if (kind === 'smoker' && (face === 'side' || face === 'top')) { const w = WOODS.oak!; for (let y = 12; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, w.plank[(x + y) % 3 + 1]!); }
  if (kind === 'blast_furnace' && face !== 'top') for (let x = 1; x < 15; x++) t.set(x, 3, IRON[3]!);
  if (face === 'front' || face === 'front_on') {
    for (let y = 8; y < 14; y++) for (let x = 3; x < 13; x++) {
      const edge = y === 8 || x === 3 || x === 12;
      const grill = kind === 'blast_furnace' && x % 2 === 0;
      t.set(x, y, edge ? p[0]! : grill ? IRON[2]! : face === 'front_on' ? hex(y > 11 ? '#ffe070' : '#f08a20') : hex('#121212'));
    }
  }
  return t;
}
function table(kind: string, face: string): Tex {
  const woods: Record<string, keyof typeof WOODS> = { cartography_table: 'dark_oak', fletching_table: 'birch', smithing_table: 'dark_oak', loom: 'oak', lectern: 'oak', composter: 'oak' };
  const w = WOODS[woods[kind] ?? 'oak']!;
  const t = planks(w, 2111 + kind.length + face.length);
  frame(t, w.plank[4]!, w.plank[0]!);
  const r = rng(2120 + kind.length);
  if (face === 'top') {
    if (kind === 'cartography_table') for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, hex((x + y) % 5 === 0 ? '#6a8ac0' : (x * y) % 7 === 0 ? '#5a9a4a' : '#e8dcc0'));
    if (kind === 'fletching_table') for (let i = 3; i < 13; i++) { t.set(i, i, hex('#e8e8e8')); t.set(i, 15 - i, hex('#8a6a3a')); }
    if (kind === 'smithing_table') for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, IRON[1 + ((x + y) % 2)]!);
    if (kind === 'loom') for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) t.set(x, y, hex(['#c84040', '#e8e8e8'][(x + y) % 2]!));
    if (kind === 'lectern') for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, w.plank[x === 7 || x === 8 ? 0 : 3]!);
    if (kind === 'composter') for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) t.set(x, y, [0, 0, 0, 0]);
  } else if (face === 'front' || face === 'side') {
    if (kind === 'smithing_table') for (let x = 0; x < 16; x++) for (const y of [4, 5]) t.set(x, y, IRON[2]!);
    if (kind === 'cartography_table') for (let y = 6; y < 12; y++) t.set(4 + Math.floor(r() * 8), y, hex('#2a2a2a'));
    if (kind === 'loom' && face === 'front') for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) if (x % 2 === 0) t.set(x, y, hex('#e8e8e8'));
    if (kind === 'composter') for (let y = 0; y < 16; y++) for (const x of [3, 12]) t.set(x, y, w.plank[0]!);
  }
  return t;
}
function compost(ready: boolean): Tex {
  const p = ready ? pal('#4a3a22', '#5e4a2c', '#725a36', '#86683e') : pal('#3a5a1a', '#4a6e22', '#5a822a', '#6c9634');
  const t = paint(grain(ready ? 2132 : 2131, [0.6, 0.3, 0.1]), p, { dither: 1, seed: 2131 });
  if (ready) for (let i = 0; i < 10; i++) t.set((i * 7) % 16, (i * 5) % 16, hex('#e8e0c8'));
  return t;
}
function stonecutter(face: 'top' | 'side' | 'saw'): Tex {
  if (face === 'saw') {
    const t = new Tex();
    for (let x = 0; x < 16; x++) for (let y = 9; y < 16; y++) if (Math.hypot(x - 7.5, y - 16) < 7) t.set(x, y, IRON[(x + y) % 2 ? 3 : 2]!);
    return t;
  }
  const t = base(STONE, 2141);
  frame(t, STONE[4]!, STONE[0]!);
  if (face === 'top') for (let y = 1; y < 15; y++) t.set(8, y, IRON[0]!);
  return t;
}
function grindstone(face: 'side' | 'round' | 'pivot' | 'leg'): Tex {
  if (face === 'leg' || face === 'pivot') { const t = planks(WOODS.dark_oak!, 2151); return face === 'pivot' ? t.map((c) => shade(c, 0.85)) : t; }
  const t = base(STONE, 2152);
  if (face === 'round') for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (x % 4 === 0) t.set(x, y, STONE[1]!);
  return frame(t, STONE[4]!, STONE[0]!);
}
function bell(face: 'body' | 'bar'): Tex {
  const t = face === 'body' ? base(pal('#8a6510', '#c79a1d', '#ecc932', '#fff59a', '#fffad0'), 2161) : planks(WOODS.dark_oak!, 2162);
  if (face === 'body') for (let x = 0; x < 16; x++) t.set(x, 12, hex('#8a6510'));
  return t;
}
function lecternSide(): Tex { return table('lectern', 'side'); }

// ------------------------------------------------------------------ signs, banners, skulls, candles
function signTex(wood: string): Tex {
  const w = WOODS[wood]!;
  const t = planks(w, 2171 + wood.length);
  frame(t, w.plank[4]!, w.plank[0]!);
  return t;
}
function bannerCloth(color: string): Tex {
  const c = hex(color);
  const t = new Tex();
  const r = rng(2181);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, (x + y) % 4 === 0 ? shade(c, 0.9) : r() < 0.1 ? clamp(shade(c, 1.08)) : c);
  return t;
}
function skull(kind: string): Tex {
  const cols: Record<string, [string, string, string]> = {
    skeleton: ['#c8c8c0', '#a8a8a0', '#3a3a3a'], wither_skeleton: ['#2a2a2a', '#1a1a1a', '#5a5a5a'], zombie: ['#5a8a4a', '#4a7a3a', '#1a2a1a'],
    creeper: ['#5aa050', '#4a8a40', '#101a10'], player: ['#c8946a', '#a87a54', '#3a2414'], dragon: ['#2a2230', '#1c1620', '#a040c0'],
  };
  const [a, b, eye] = cols[kind]!.map((c) => hex(c));
  const t = new Tex();
  const r = rng(2191 + kind.length);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, r() < 0.3 ? b! : a!);
  // an original face: two eyes and a mouth on the front region (u 4..12, v 4..12)
  for (const [x, y] of [[5, 7], [6, 7], [9, 7], [10, 7], [5, 8], [10, 8]] as [number, number][]) t.set(x, y, eye!);
  for (let x = 6; x < 10; x++) t.set(x, 10, eye!);
  return t;
}
function candleOf(color: string): Tex {
  const t = new Tex();
  const c = hex(color);
  const body = [shade(c, 0.8), c, clamp(mix(c, hex('#ffffff'), 0.25))];
  for (let y = 8; y < 14; y++) { t.set(0, y, body[2]!); t.set(1, y, body[1]!); }
  t.set(1, 13, body[0]!);
  for (let y = 5; y < 8; y++) t.set(0, y, hex('#2a2420'));
  for (let x = 2; x < 4; x++) for (let y = 8; y < 10; y++) t.set(x, y, body[2]!);
  return t;
}

// ------------------------------------------------------------------ End and misc
function endPortalFrame(face: 'top' | 'side' | 'eye'): Tex {
  if (face === 'eye') {
    const t = new Tex();
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) t.set(x, y, Math.hypot(x - 7.5, y - 7.5) < 2 ? hex('#102010') : hex('#3a8a6a'));
    return t;
  }
  const p = pal('#4a6a5a', '#5a7e6c', '#6a927e', '#80a690', '#98bca6');
  const t = base(p, 2201);
  if (face === 'top') for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) t.set(x, y, hex('#1a2a22'));
  else for (let x = 0; x < 16; x++) t.set(x, 3, p[0]!);
  return t;
}
function starfield(): Tex {
  const t = new Tex();
  const r = rng(2211);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, r() < 0.06 ? hex(['#4adab0', '#a0f0ff', '#e0e0ff'][Math.floor(r() * 3)]!) : hex('#06080e'));
  return t;
}
function respawnAnchor(face: 'top' | 'top_off' | 'side0' | 'side1' | 'side2' | 'side3' | 'side4' | 'bottom'): Tex {
  const obs = pal('#0c0a14', '#14101e', '#1c1628', '#261e36', '#342848');
  const t = base(obs, 2221);
  if (face === 'top' || face === 'top_off') for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) t.set(x, y, face === 'top' ? hex('#a040f0') : hex('#2a1a3a'));
  if (face.startsWith('side')) {
    const n = Number(face.slice(4));
    for (let i = 0; i < 4; i++) for (let x = 2 + i * 3; x < 4 + i * 3; x++) for (let y = 1; y < 3; y++) t.set(x, y, i < n ? hex('#c060ff') : hex('#3a2a4a'));
  }
  return t;
}
function beaconCore(): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, Math.hypot(x - 7.5, y - 7.5) < 5 ? hex((x + y) % 2 ? '#a8f8f0' : '#e8fffc') : hex('#4ac8c0'));
  return t;
}
function chorus(kind: 'plant' | 'flower' | 'flower_dead'): Tex {
  const p = kind === 'plant' ? pal('#4a2a4a', '#5e3a5e', '#734a73', '#8a5e8a', '#a87aa8') : kind === 'flower' ? pal('#8a5e8a', '#a87aa8', '#c49ac4', '#dcbadc', '#f0d8f0') : pal('#4a3a4a', '#5a4a5a', '#6a5a6a', '#7a6a7a', '#8a7a8a');
  const t = base(p, kind === 'plant' ? 2231 : 2232);
  return frame(t, p[4]!, p[0]!);
}
function dragonEgg(): Tex {
  const t = noiseTex(pal('#0a060e', '#140c1a', '#1e1226', '#2a1a34'), { seed: 2241, octaves: [4, 8], weights: [0.5, 0.5], emboss: 1, dither: 0.8 });
  const r = rng(2242);
  for (let i = 0; i < 10; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), hex('#a050d0'));
  return t;
}
function turtleEgg(stage: number): Tex {
  const t = new Tex();
  const shell = pal('#d8d4b8', '#ece8d0', '#fcfaec');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, shell[(x * 3 + y) % 5 === 0 ? 0 : (x + y) % 2 ? 1 : 2]!);
  for (const [x, y] of [[3, 3], [10, 5], [6, 10], [12, 12]] as [number, number][]) t.set(x, y, hex('#5aa060'));
  if (stage > 0) for (let i = 0; i < stage * 4; i++) t.set((i * 5) % 16, (i * 3) % 16, hex('#6a6a5a'));
  return t;
}
function conduit(): Tex {
  const t = new Tex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, hex((x + y) % 3 ? '#8a6a3a' : '#a8885a'));
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, hex('#4ad0e0'));
  return t;
}
function sculk(face: 'top' | 'side' | 'bottom' | 'tendril'): Tex {
  const p = pal('#06161a', '#0c2a32', '#123c46', '#1a5260', '#2a7484');
  if (face === 'tendril') { const t = new Tex(); for (let y = 4; y < 16; y++) for (const x of [4, 11]) t.set(x + (y < 8 ? 1 : 0), y, p[y < 6 ? 4 : 3]!); return t; }
  const t = base(p, 2251);
  if (face === 'top') for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) t.set(x, y, hex('#38d0e0'));
  if (face === 'side') for (let x = 0; x < 16; x++) t.set(x, 7, p[4]!);
  return t;
}
function commandBlock(kind: 'command' | 'repeating' | 'chain', face: 'front' | 'back' | 'side'): Tex {
  const c = { command: '#b88a5a', repeating: '#6a4ab0', chain: '#5a9a7a' }[kind];
  const p: Palette = [shade(hex(c), 0.6), shade(hex(c), 0.8), hex(c), clamp(shade(hex(c), 1.2)), clamp(shade(hex(c), 1.4))];
  const t = base(p, 2261);
  frame(t, p[4]!, p[0]!);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) t.set(x, y, hex('#1a1a1a'));
  if (face !== 'back') for (let i = 0; i < 4; i++) t.set(6 + i, face === 'front' ? 6 + (i % 2) : 9, hex('#c0f0c0'));
  return t;
}
function structureBlock(kind: string): Tex {
  const p = pal('#2a2430', '#3a3242', '#4a4054', '#5a4e66', '#6e6080');
  const t = base(p, 2271 + kind.length);
  frame(t, p[4]!, p[0]!);
  for (let i = 4; i < 12; i++) { t.set(i, 4, hex('#c0b0d0')); t.set(4, i, hex('#c0b0d0')); }
  return t;
}
function enderChest(face: 'top' | 'side' | 'front'): Tex {
  const p = pal('#0e1a1a', '#16282a', '#1e3638', '#284648', '#38605e');
  const t = base(p, 2281);
  frame(t, p[4]!, p[0]!);
  if (face !== 'top') for (let x = 0; x < 16; x++) t.set(x, 5, p[0]!);
  if (face === 'front') for (let y = 4; y < 9; y++) for (let x = 7; x < 9; x++) t.set(x, y, hex('#2ac090'));
  return t;
}

// ------------------------------------------------------------------ registry
const SIGN_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped'];
export const techTextures: TexDef[] = [
  { name: 'redstone_dust_dot', make: () => dust('dot'), cutout: true },
  { name: 'redstone_dust_line', make: () => dust('line'), cutout: true },
  ...(['powered', 'detector', 'activator'] as const).flatMap((k): TexDef[] => [
    { name: `${k}_rail`, make: () => specialRail(k, false), cutout: true },
    { name: `${k}_rail_on`, make: () => specialRail(k, true), cutout: true },
  ]),
  { name: 'repeater', make: () => diode('repeater', false) },
  { name: 'repeater_on', make: () => diode('repeater', true) },
  { name: 'comparator', make: () => diode('comparator', false) },
  { name: 'comparator_on', make: () => diode('comparator', true) },
  { name: 'piston_top', make: () => piston('top') },
  { name: 'piston_top_sticky', make: () => piston('top_sticky') },
  { name: 'piston_side', make: () => piston('side') },
  { name: 'piston_bottom', make: () => piston('bottom') },
  { name: 'piston_inner', make: () => piston('inner') },
  { name: 'hopper_outside', make: () => hopper('outside') },
  { name: 'hopper_inside', make: () => hopper('inside') },
  { name: 'hopper_top', make: () => hopper('top'), cutout: true },
  { name: 'cauldron_side', make: () => cauldron('side'), cutout: true },
  { name: 'cauldron_top', make: () => cauldron('top'), cutout: true },
  { name: 'cauldron_inner', make: () => cauldron('inner') },
  { name: 'cauldron_bottom', make: () => cauldron('bottom') },
  { name: 'observer_back', make: () => observerBack(false) },
  { name: 'observer_back_on', make: () => observerBack(true) },
  { name: 'daylight_detector_top', make: () => daylight(false) },
  { name: 'daylight_detector_inverted_top', make: () => daylight(true) },
  { name: 'lightning_rod', make: lightningRod, cutout: true },
  { name: 'tripwire_hook', make: tripwireHook, cutout: true },
  { name: 'tripwire', make: tripwire, cutout: true },
  { name: 'enchanting_table_top', make: () => enchantingTable('top') },
  { name: 'enchanting_table_side', make: () => enchantingTable('side') },
  { name: 'enchanting_table_bottom', make: () => enchantingTable('bottom') },
  { name: 'anvil', make: () => anvil('base') },
  { name: 'anvil_top', make: () => anvil('top') },
  { name: 'brewing_stand', make: () => brewingStand(false), cutout: true },
  { name: 'brewing_stand_base', make: () => brewingStand(true), cutout: true },
  { name: 'cake_top', make: () => cake('top') },
  { name: 'cake_side', make: () => cake('side'), cutout: true },
  { name: 'cake_bottom', make: () => cake('bottom') },
  { name: 'cake_inner', make: () => cake('inner'), cutout: true },
  { name: 'campfire_log', make: () => campfire('log') },
  { name: 'campfire_log_lit', make: () => campfire('log_lit') },
  { name: 'campfire_fire', make: () => campfire('fire'), cutout: true },
  { name: 'soul_campfire_fire', make: () => campfire('soul_fire'), cutout: true },
  { name: 'barrel_side', make: () => barrel('side') },
  { name: 'barrel_top', make: () => barrel('top') },
  { name: 'barrel_top_open', make: () => barrel('top_open') },
  { name: 'barrel_bottom', make: () => barrel('bottom') },
  ...(['smoker', 'blast_furnace'] as const).flatMap((k): TexDef[] => (['front', 'front_on', 'side', 'top'] as const).map((f): TexDef => ({ name: `${k}_${f}`, make: () => smokerLike(k, f) }))),
  ...['cartography_table', 'fletching_table', 'smithing_table', 'loom', 'composter'].flatMap((k): TexDef[] => ['top', 'side', 'front', 'bottom'].map((f): TexDef => ({ name: `${k}_${f}`, make: () => table(k, f), ...(k === 'composter' && f === 'top' ? { cutout: true } : {}) }))),
  { name: 'compost', make: () => compost(false) },
  { name: 'compost_ready', make: () => compost(true) },
  { name: 'lectern_top', make: () => table('lectern', 'top') },
  { name: 'lectern_side', make: lecternSide },
  { name: 'stonecutter_top', make: () => stonecutter('top') },
  { name: 'stonecutter_side', make: () => stonecutter('side') },
  { name: 'stonecutter_saw', make: () => stonecutter('saw'), cutout: true },
  { name: 'grindstone_side', make: () => grindstone('side') },
  { name: 'grindstone_round', make: () => grindstone('round') },
  { name: 'grindstone_pivot', make: () => grindstone('pivot') },
  { name: 'grindstone_leg', make: () => grindstone('leg') },
  { name: 'bell_body', make: () => bell('body') },
  { name: 'bell_bar', make: () => bell('bar') },
  ...SIGN_WOODS.map((w): TexDef => ({ name: `${w}_sign`, make: () => signTex(w) })),
  ...Object.entries(DYES).map(([n, c]): TexDef => ({ name: `${n}_banner`, make: () => bannerCloth(c) })),
  ...['skeleton', 'wither_skeleton', 'zombie', 'creeper', 'player', 'dragon'].map((k): TexDef => ({ name: `${k}_skull`, make: () => skull(k) })),
  ...Object.entries(DYES).map(([n, c]): TexDef => ({ name: `${n}_candle`, make: () => candleOf(c), cutout: true })),
  { name: 'end_portal_frame_top', make: () => endPortalFrame('top') },
  { name: 'end_portal_frame_side', make: () => endPortalFrame('side') },
  { name: 'end_portal_frame_eye', make: () => endPortalFrame('eye'), cutout: true },
  { name: 'end_portal', make: starfield },
  ...(['top', 'top_off', 'side0', 'side1', 'side2', 'side3', 'side4', 'bottom'] as const).map((f): TexDef => ({ name: `respawn_anchor_${f}`, make: () => respawnAnchor(f) })),
  { name: 'beacon', make: beaconCore },
  { name: 'chorus_plant', make: () => chorus('plant') },
  { name: 'chorus_flower', make: () => chorus('flower') },
  { name: 'chorus_flower_dead', make: () => chorus('flower_dead') },
  { name: 'dragon_egg', make: dragonEgg },
  ...[0, 1, 2].map((s): TexDef => ({ name: `turtle_egg${s === 0 ? '' : s === 1 ? '_slightly_cracked' : '_very_cracked'}`, make: () => turtleEgg(s) })),
  { name: 'conduit', make: conduit },
  ...(['top', 'side', 'bottom', 'tendril'] as const).map((f): TexDef => ({ name: `sculk_sensor_${f}`, make: () => sculk(f), ...(f === 'tendril' ? { cutout: true } : {}) })),
  ...(['command', 'repeating', 'chain'] as const).flatMap((k): TexDef[] => (['front', 'back', 'side'] as const).map((f): TexDef => ({ name: `${k}_command_block_${f}`, make: () => commandBlock(k, f) }))),
  { name: 'structure_block', make: () => structureBlock('structure') },
  { name: 'jigsaw', make: () => structureBlock('jigsaw') },
  { name: 'ender_chest_top', make: () => enderChest('top') },
  { name: 'ender_chest_side', make: () => enderChest('side') },
  { name: 'ender_chest_front', make: () => enderChest('front') },
];
