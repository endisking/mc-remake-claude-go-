/** Natural terrain textures: stone family, soils, sands, ores, fluids. */
import { Tex, pal, hex, noiseTex, ore, cells, strip, gray, shade, mix, rng, fbm, tileNoise, grain, paint, CLEAR, type Palette } from '../lib';
import type { TexDef } from '../registry';

const STONE: Palette = pal('#5a5a5d', '#666669', '#717174', '#7b7b7e', '#858588', '#919194');
const DEEPSLATE: Palette = pal('#2a2a30', '#34343b', '#3d3d45', '#47474f', '#52525a', '#5c5c65');
const DIRT: Palette = pal('#5b3d25', '#6a492d', '#795535', '#86603d', '#946c46');
const SAND: Palette = pal('#c8b47c', '#d4c08a', '#ddca95', '#e6d4a2', '#efdeb0');
const RED_SAND: Palette = pal('#9a4f1d', '#ab5a23', '#b9652a', '#c77233', '#d27f3d');

export function stone(): Tex {
  const t = paint(grain(11, [0.55, 0.3, 0.15]), STONE, { emboss: 1.4, contrast: 0.95, dither: 0.5, seed: 11 });
  // a few darker flecks and lighter chips, hand-placed for character
  const flecks: [number, number, number][] = [[3, 4, 0], [4, 4, 1], [11, 2, 0], [12, 9, 0], [12, 10, 1], [6, 12, 0], [1, 9, 5], [8, 7, 5], [14, 14, 5]];
  for (const [x, y, i] of flecks) t.set(x, y, STONE[i]!);
  return t;
}

export function deepslate(): Tex {
  // horizontal strata: squash the noise vertically by sampling rows of a stretched field
  const n = fbm(41, [2, 4, 8], [0.4, 0.35, 0.25]);
  const r = rng(42);
  const t = new Tex();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const band = Math.sin((y + n[y * 16 + x]! * 3) * 1.4) * 0.5 + 0.5;
      const v = band * 0.6 + n[y * 16 + x]! * 0.4 + (r() - 0.5) * 0.15;
      t.set(x, y, DEEPSLATE[Math.max(0, Math.min(5, Math.round(v * 5)))]!);
    }
  return t;
}

export function dirt(): Tex {
  const t = paint(grain(21, [0.6, 0.28, 0.12]), DIRT, { emboss: 1, contrast: 1.1, dither: 0.7, seed: 21 });
  // pebbles: a light pixel with a shadow below-right
  const r = rng(22);
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(r() * 15), y = Math.floor(r() * 15);
    t.set(x, y, hex('#a07a54'));
    t.set(x + 1, y + 1, hex('#4a311d'));
  }
  return t;
}

export function sand(palette = SAND, seed = 31): Tex {
  return paint(grain(seed, [0.65, 0.25, 0.1]), palette, { emboss: 0.8, contrast: 1, dither: 0.9, seed });
}

export function gravel(): Tex {
  const c = cells(51, 18);
  const r = rng(52);
  const stones = [pal('#6d6866', '#7e7977', '#8f8a87', '#a19b98'), pal('#5d5554', '#6e6563', '#807675', '#918785'), pal('#7a7672', '#8c8884', '#9e9a95', '#b0aca7')];
  const t = new Tex();
  const tone = new Map<number, number>();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const id = c.id[y * 16 + x]!;
      if (!tone.has(id)) tone.set(id, Math.floor(r() * stones.length));
      const p = stones[tone.get(id)!]!;
      const left = c.id[y * 16 + ((x + 15) % 16)] !== id, up = c.id[((y + 15) % 16) * 16 + x] !== id;
      let i = 2;
      if (c.edge[y * 16 + x]) i = 0;
      else if (left || up) i = 3;
      else i = 1 + Math.floor(r() * 2);
      t.set(x, y, p[i]!);
    }
  return t;
}

export function bedrock(): Tex {
  return noiseTex(pal('#1e1e1e', '#353535', '#4c4c4c', '#666666', '#7d7d7d', '#959595'), {
    seed: 61, octaves: [4, 8], weights: [0.6, 0.4], emboss: 2.5, dither: 1.2, contrast: 1.6,
  });
}

export function cobblestone(palette: Palette = pal('#3e3e40', '#535356', '#68686b', '#7b7b7e', '#8f8f92', '#a5a5a8'), seed = 71): Tex {
  // irregular rounded stones: each Voronoi cell is shaded like a bump lit from the top-left
  const w = 16;
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) pts.push([r() * 16, r() * 16]);
  const id = new Int32Array(256), edge = new Float32Array(256);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let best = Infinity, second = Infinity, bi = 0;
      pts.forEach(([px, py], i) => {
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const d = Math.hypot(x + 0.5 - (px + ox * 16), y + 0.5 - (py + oy * 16));
            if (d < best) { second = best; best = d; bi = i; } else if (d < second) second = d;
          }
      });
      id[y * w + x] = bi;
      edge[y * w + x] = second - best;
    }
  const tone = pts.map(() => Math.floor(r() * 2));
  const n = grain(seed + 1, [0.6, 0.3, 0.1]);
  const t = new Tex();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = y * w + x;
      const e = edge[i]!;
      if (e < 0.75) {
        t.set(x, y, palette[0]!);
        continue;
      }
      // light from the top-left: compare with the pixel up-left; shade the down-right rim
      const ul = edge[((y + 15) % 16) * w + ((x + 15) % 16)]!;
      const dr = edge[((y + 1) % 16) * w + ((x + 1) % 16)]!;
      let v = 3 + tone[id[i]!]! + Math.round((n[i]! - 0.5) * 1.4);
      if (ul < 1.2) v += 1;
      if (dr < 1.2) v -= 1;
      if (e > 2.5) v += 0;
      t.set(x, y, palette[Math.max(1, Math.min(palette.length - 1, v))]!);
    }
  return t;
}

export function grassTop(): Tex {
  // grayscale, biome-tinted at render time
  const p = pal('#6e6e6e', '#808080', '#8f8f8f', '#9c9c9c', '#a9a9a9', '#b6b6b6');
  return noiseTex(p, { seed: 81, octaves: [8, 16], weights: [0.4, 0.6], emboss: 1.2, dither: 1.8 });
}

/** Grass fringe overlay for the side of grass blocks (grayscale, tinted). */
export function grassSideOverlay(): Tex {
  const top = grassTop();
  const r = rng(82);
  const t = new Tex();
  for (let x = 0; x < 16; x++) {
    const len = 3 + Math.floor(r() * 3) + (r() < 0.25 ? 2 : 0);
    for (let y = 0; y < len; y++) t.set(x, y, y === len - 1 ? shade(top.get(x, y), 0.85) : top.get(x, y));
  }
  return t;
}

/** Side of a grass block: dirt with a darker band where the fringe sits (untinted base). */
export function grassSide(): Tex {
  const t = dirt();
  const o = grassSideOverlay();
  // where the overlay will be drawn, keep the base slightly darker so gaps look natural
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (o.get(x, y)[3] > 0) t.set(x, y, shade(t.get(x, y), 0.9));
  return t;
}

export function snow(): Tex {
  return noiseTex(pal('#d6e0e6', '#e2eaef', '#edf3f6', '#f7fbfc', '#ffffff'), { seed: 91, octaves: [4, 8], weights: [0.5, 0.5], emboss: 1, dither: 1.2 });
}

export function clay(): Tex {
  return noiseTex(pal('#8c919c', '#979ca8', '#a1a6b2', '#acb1bc', '#b7bcc6'), { seed: 95, octaves: [2, 4, 8], weights: [0.4, 0.4, 0.2], emboss: 1, dither: 1 });
}

export function ice(): Tex {
  const t = noiseTex(pal('#7fa7e8', '#8fb3ec', '#9ebff0', '#afcbf3', '#c3d9f7'), { seed: 97, octaves: [2, 4], weights: [0.6, 0.4], emboss: 2, dither: 0.6 });
  // a couple of bright cracks
  const r = rng(98);
  for (let k = 0; k < 3; k++) {
    let x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    for (let i = 0; i < 5; i++) {
      t.set(x, y, hex('#e4efff'));
      x += r() < 0.5 ? 1 : 0;
      y += 1;
    }
  }
  return t.map((c) => [c[0], c[1], c[2], 190]);
}

// ------------------------------------------------------------------ ores
const STONE_TEX = () => stone();
const DEEP_TEX = () => deepslate();
export const ORE_COLORS: Record<string, Palette> = {
  coal: pal('#0f0f10', '#1e1e20', '#2c2c2f', '#4a4a4e'),
  iron: pal('#8a5a3c', '#b78462', '#d6a585', '#efcfb6'),
  copper: pal('#6d3c24', '#a8593a', '#c97148', '#4f9d83', '#ec9c6f'),
  gold: pal('#8a6510', '#c79a1d', '#ecc932', '#fff59a'),
  redstone: pal('#650000', '#a30a0a', '#d91414', '#ff5a4a'),
  emerald: pal('#06592a', '#0f9446', '#1fc461', '#a6f7c3'),
  lapis: pal('#0b2672', '#163fae', '#2559da', '#6d97f5'),
  diamond: pal('#0f6f69', '#22b3a9', '#4be6da', '#d3fdf9'),
};

export const terrainTextures: TexDef[] = [
  { name: 'missing', make: () => { const t = new Tex(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, ((x >> 3) ^ (y >> 3)) & 1 ? hex('#f800f8') : hex('#000000')); return t; } },
  { name: 'stone', make: stone },
  { name: 'deepslate', make: deepslate },
  { name: 'deepslate_top', make: () => noiseTex(DEEPSLATE, { seed: 43, octaves: [4, 8], weights: [0.5, 0.5], emboss: 2, dither: 1 }) },
  { name: 'dirt', make: dirt },
  { name: 'coarse_dirt', make: () => { const t = dirt(); const g = gravel(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x * 7 + y * 13) % 5 === 0) t.set(x, y, mix(g.get(x, y), t.get(x, y), 0.4)); return t; } },
  { name: 'sand', make: () => sand() },
  { name: 'red_sand', make: () => sand(RED_SAND, 33) },
  { name: 'gravel', make: gravel },
  { name: 'bedrock', make: bedrock },
  { name: 'cobblestone', make: () => cobblestone() },
  { name: 'mossy_cobblestone', make: () => {
    const t = cobblestone();
    const n = fbm(74, [4, 8, 16], [0.45, 0.35, 0.2]);
    const moss = pal('#34501f', '#41622a', '#4e7332', '#5d843a');
    return t.map((c, x, y) => {
      const v = n[y * 16 + x]!;
      return v > 0.6 ? moss[Math.min(3, Math.floor((v - 0.6) * 12) + ((x + y) % 3 === 0 ? 1 : 0))]! : c;
    });
  } },
  { name: 'grass_block_top', make: grassTop, tint: 'grass' },
  { name: 'grass_block_side', make: grassSide },
  { name: 'grass_block_side_overlay', make: grassSideOverlay, tint: 'grass', cutout: true },
  { name: 'grass_block_snow', make: () => { const t = dirt(); const s = snow(); const r = rng(92); for (let x = 0; x < 16; x++) { const l = 3 + Math.floor(r() * 3); for (let y = 0; y < l; y++) t.set(x, y, s.get(x, y)); } return t; } },
  { name: 'snow', make: snow },
  { name: 'clay', make: clay },
  { name: 'ice', make: ice, translucent: true },
  { name: 'coal_ore', make: () => ore(STONE_TEX(), ORE_COLORS.coal!, 101, 5) },
  { name: 'iron_ore', make: () => ore(STONE_TEX(), ORE_COLORS.iron!, 102, 5) },
  { name: 'copper_ore', make: () => ore(STONE_TEX(), ORE_COLORS.copper!, 103, 6) },
  { name: 'gold_ore', make: () => ore(STONE_TEX(), ORE_COLORS.gold!, 104, 5) },
  { name: 'redstone_ore', make: () => ore(STONE_TEX(), ORE_COLORS.redstone!, 105, 6) },
  { name: 'emerald_ore', make: () => ore(STONE_TEX(), ORE_COLORS.emerald!, 106, 4) },
  { name: 'lapis_ore', make: () => ore(STONE_TEX(), ORE_COLORS.lapis!, 107, 6) },
  { name: 'diamond_ore', make: () => ore(STONE_TEX(), ORE_COLORS.diamond!, 108, 5) },
  { name: 'deepslate_coal_ore', make: () => ore(DEEP_TEX(), ORE_COLORS.coal!, 111, 6) },
  { name: 'deepslate_iron_ore', make: () => ore(DEEP_TEX(), ORE_COLORS.iron!, 112, 5) },
  { name: 'deepslate_copper_ore', make: () => ore(DEEP_TEX(), ORE_COLORS.copper!, 113, 6) },
  { name: 'deepslate_gold_ore', make: () => ore(DEEP_TEX(), ORE_COLORS.gold!, 114, 5) },
  { name: 'deepslate_redstone_ore', make: () => ore(DEEP_TEX(), ORE_COLORS.redstone!, 115, 6) },
  { name: 'deepslate_emerald_ore', make: () => ore(DEEP_TEX(), ORE_COLORS.emerald!, 116, 4) },
  { name: 'deepslate_lapis_ore', make: () => ore(DEEP_TEX(), ORE_COLORS.lapis!, 117, 6) },
  { name: 'deepslate_diamond_ore', make: () => ore(DEEP_TEX(), ORE_COLORS.diamond!, 118, 5) },
  { name: 'water_still', make: () => waterStill(201, 32), frametime: 2, tint: 'water', translucent: true },
  { name: 'water_flow', make: () => fluidFlow(202, 32, pal('#8a8a8a', '#9a9a9a', '#a8a8a8', '#b6b6b6', '#c6c6c6'), 0.75), frametime: 1, tint: 'water', translucent: true },
  { name: 'lava_still', make: () => lava(203, 20), frametime: 2 },
  { name: 'lava_flow', make: () => lavaFlow(204, 32), frametime: 1 },
];

const LAVA: Palette = pal('#8f1f05', '#b3330a', '#cf4b0e', '#e26812', '#f2891c', '#fbab2c', '#ffcc49', '#fff07c');

/**
 * Animated lava: granular orange with dark crust patches and bright yellow speckles that
 * churn slowly. Two grainy fields drift in opposite circles and cross-fade over the loop.
 */
function lava(seed: number, frames: number): Tex {
  const A = fbm(seed, [8, 4, 16], [0.45, 0.35, 0.2]);
  const B = fbm(seed + 9, [8, 4, 16], [0.45, 0.35, 0.2]);
  const sp = rng(seed + 3);
  const speck = new Float32Array(256).map(() => sp());
  const fs: Tex[] = [];
  for (let f = 0; f < frames; f++) {
    const ph = (f / frames) * Math.PI * 2;
    const ax = Math.round(Math.cos(ph) * 3), ay = Math.round(Math.sin(ph) * 3);
    const t = new Tex();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const a = A[((y + ay + 32) % 16) * 16 + ((x + ax + 32) % 16)]!;
        const b = B[((y - ay + 32) % 16) * 16 + ((x - ax + 32) % 16)]!;
        const k = 0.5 + 0.5 * Math.cos(ph);
        let v = a * k + b * (1 - k);
        // bright speckles flicker on the hottest areas
        if (v > 0.55 && speck[((y * 16 + x + f * 37) % 256)]! > 0.9) v += 0.25;
        const idx = Math.max(0, Math.min(LAVA.length - 1, Math.round(Math.pow(Math.max(0, v - 0.1) / 0.9, 1.6) * (LAVA.length - 1) + 0.6)));
        t.set(x, y, LAVA[idx]!);
      }
    fs.push(t);
  }
  return strip(fs);
}

/** Flowing lava: the grainy field scrolls down one pixel every other frame. */
function lavaFlow(seed: number, frames: number): Tex {
  const A = fbm(seed, [8, 4, 16], [0.45, 0.35, 0.2]);
  const fs: Tex[] = [];
  for (let f = 0; f < frames; f++) {
    const t = new Tex();
    const off = Math.floor((f * 16) / frames);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const v = A[((y - off + 32) % 16) * 16 + x]!;
        const idx = Math.max(0, Math.min(LAVA.length - 1, Math.round(Math.pow(Math.max(0, v - 0.1) / 0.9, 1.6) * (LAVA.length - 1) + 0.6)));
        t.set(x, y, LAVA[idx]!);
      }
    fs.push(t);
  }
  return strip(fs);
}

/**
 * Still water: grayscale (biome tinted), mostly flat with lighter wavy ripple lines that
 * drift diagonally, and subtle darker troughs.
 */
function waterStill(seed: number, frames: number): Tex {
  const p = pal('#7e7e7e', '#8c8c8c', '#999999', '#a7a7a7', '#b8b8b8', '#cfcfcf');
  const base = fbm(seed, [4, 8], [0.6, 0.4]);
  const fs: Tex[] = [];
  for (let f = 0; f < frames; f++) {
    const t = new Tex();
    const ph = (f / frames) * Math.PI * 2;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        // ripples: sine bands along a diagonal, phase-shifted over the loop and warped by noise
        const b = base[((y + Math.round(Math.sin(ph) * 2) + 16) % 16) * 16 + ((x + Math.round(Math.cos(ph) * 2) + 16) % 16)]!;
        const band = Math.sin(((x + y * 2) / 16) * Math.PI * 4 + ph * 2 + b * 3);
        let v = 1.6 + b * 1.4 + (band > 0.8 ? 2 : band > 0.55 ? 1 : band < -0.85 ? -1 : 0);
        v = Math.max(0, Math.min(5, Math.round(v)));
        const c = p[v]!;
        t.set(x, y, [c[0], c[1], c[2], 180]);
      }
    fs.push(t);
  }
  return strip(fs);
}

/** Looping animated fluid surface: two noise fields cross-faded over the cycle. */
function fluid(seed: number, frames: number, p: Palette, cellsN: number, alpha: number): Tex {
  const fs: Tex[] = [];
  const A = fbm(seed, [cellsN * 2, cellsN * 4], [0.6, 0.4]);
  const B = fbm(seed + 1, [cellsN * 2, cellsN * 4], [0.6, 0.4]);
  for (let f = 0; f < frames; f++) {
    const ph = (f / frames) * Math.PI * 2;
    const t = new Tex();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        // drift the fields diagonally so the surface appears to churn slowly
        const sx = Math.round(x + Math.sin(ph) * 2), sy = Math.round(y + Math.cos(ph) * 2);
        const a = A[((sy + 32) % 16) * 16 + ((sx + 32) % 16)]!;
        const b = B[((y - sy + 48) % 16) * 16 + ((x - sx + 48) % 16)]!;
        const v = a * (0.5 + 0.5 * Math.cos(ph)) + b * (0.5 - 0.5 * Math.cos(ph));
        const c = p[Math.max(0, Math.min(p.length - 1, Math.round(v * (p.length - 1))))]!;
        t.set(x, y, [c[0], c[1], c[2], Math.round(alpha * 255)]);
      }
    fs.push(t);
  }
  return strip(fs);
}

/** Flowing fluid: noise scrolling downward one pixel per frame (loops after 16·k frames). */
function fluidFlow(seed: number, frames: number, p: Palette, alpha: number): Tex {
  const n = fbm(seed, [4, 8], [0.6, 0.4]);
  const streak = tileNoise(seed + 5, 16);
  const fs: Tex[] = [];
  for (let f = 0; f < frames; f++) {
    const t = new Tex();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const yy = (y - Math.floor((f * 16) / frames) + 32) % 16;
        const v = n[yy * 16 + x]! * 0.7 + streak[x]! * 0.3;
        const c = p[Math.max(0, Math.min(p.length - 1, Math.round(v * (p.length - 1))))]!;
        t.set(x, y, [c[0], c[1], c[2], Math.round(alpha * 255)]);
      }
    fs.push(t);
  }
  return strip(fs);
}

export { gray, CLEAR };
