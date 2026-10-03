/** Natural terrain textures: stone family, soils, sands, ores, fluids. */
import { Tex, pal, hex, noiseTex, ore, cells, strip, gray, shade, mix, rng, fbm, tileNoise, CLEAR, type Palette } from '../lib';
import type { TexDef } from '../registry';

const STONE: Palette = pal('#55565a', '#66676b', '#737478', '#7f8084', '#8c8d90', '#9a9b9e');
const DEEPSLATE: Palette = pal('#2a2a30', '#34343b', '#3d3d45', '#47474f', '#52525a', '#5c5c65');
const DIRT: Palette = pal('#5a3c24', '#6b4a2e', '#7a5636', '#8a6340', '#99704a');
const SAND: Palette = pal('#c8b47c', '#d4c08a', '#ddca95', '#e6d4a2', '#efdeb0');
const RED_SAND: Palette = pal('#9a4f1d', '#ab5a23', '#b9652a', '#c77233', '#d27f3d');

export function stone(): Tex {
  return noiseTex(STONE, { seed: 11, octaves: [2, 4, 8, 16], weights: [0.35, 0.3, 0.2, 0.15], emboss: 2, dither: 0.7, contrast: 0.75 });
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
  const t = noiseTex(DIRT, { seed: 21, octaves: [4, 8, 16], weights: [0.3, 0.4, 0.3], emboss: 1.5, dither: 1.4 });
  // a few lighter pebbles
  const r = rng(22);
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(r() * 16), y = Math.floor(r() * 16);
    t.set(x, y, hex('#a8825c'));
    t.set(x + 1, y + 1, hex('#4e331e'));
  }
  return t;
}

export function sand(palette = SAND, seed = 31): Tex {
  return noiseTex(palette, { seed, octaves: [4, 8, 16], weights: [0.25, 0.35, 0.4], emboss: 1, dither: 1.6 });
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

export function cobblestone(palette: Palette = pal('#4d4d4f', '#5f5f62', '#717174', '#838386', '#959598', '#a9a9ac'), seed = 71): Tex {
  const c = cells(seed, 9);
  const n = fbm(seed + 1, [4, 8], [0.6, 0.4]);
  const t = new Tex();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = y * 16 + x;
      if (c.edge[i]) {
        t.set(x, y, palette[0]!);
        continue;
      }
      const id = c.id[i]!;
      const left = c.id[y * 16 + ((x + 15) % 16)] !== id || c.edge[y * 16 + ((x + 15) % 16)];
      const up = c.id[((y + 15) % 16) * 16 + x] !== id || c.edge[((y + 15) % 16) * 16 + x];
      let v = 2 + Math.round(n[i]! * 2);
      if (left || up) v += 1;
      t.set(x, y, palette[Math.min(palette.length - 1, v)]!);
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
  coal: pal('#1a1a1a', '#2b2b2b', '#3e3e3e'),
  iron: pal('#a7704e', '#d39b74', '#e8c0a0'),
  copper: pal('#7c4a2f', '#c06c45', '#5fa38c', '#e39a6e'),
  gold: pal('#a07a16', '#e4c22f', '#fff38a'),
  redstone: pal('#7a0000', '#c40e0e', '#ff4a3d'),
  emerald: pal('#0b6b31', '#17c45c', '#9ef5b8'),
  lapis: pal('#102f8a', '#1e4fc9', '#4f7ff0'),
  diamond: pal('#16867e', '#3fe0d4', '#bffbf6'),
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
  { name: 'mossy_cobblestone', make: () => { const t = cobblestone(); const n = fbm(74, [2, 4], [0.6, 0.4]); return t.map((c, x, y) => (n[y * 16 + x]! > 0.55 ? mix(c, hex('#4f7a2b'), 0.75) : c)); } },
  { name: 'grass_block_top', make: grassTop, tint: 'grass' },
  { name: 'grass_block_side', make: grassSide },
  { name: 'grass_block_side_overlay', make: grassSideOverlay, tint: 'grass', cutout: true },
  { name: 'grass_block_snow', make: () => { const t = dirt(); const s = snow(); const r = rng(92); for (let x = 0; x < 16; x++) { const l = 3 + Math.floor(r() * 3); for (let y = 0; y < l; y++) t.set(x, y, s.get(x, y)); } return t; } },
  { name: 'snow', make: snow },
  { name: 'clay', make: clay },
  { name: 'ice', make: ice, translucent: true },
  { name: 'coal_ore', make: () => ore(STONE_TEX(), ORE_COLORS.coal!, 101, 6) },
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
  { name: 'water_still', make: () => fluid(201, 32, pal('#8a8a8a', '#9a9a9a', '#a8a8a8', '#b6b6b6', '#c6c6c6'), 2, 0.75), frametime: 2, tint: 'water', translucent: true },
  { name: 'water_flow', make: () => fluidFlow(202, 32, pal('#8a8a8a', '#9a9a9a', '#a8a8a8', '#b6b6b6', '#c6c6c6'), 0.75), frametime: 1, tint: 'water', translucent: true },
  { name: 'lava_still', make: () => fluid(203, 20, pal('#b33a05', '#d65a0a', '#ec7d12', '#f7a225', '#ffc94a', '#fff08a'), 2, 1), frametime: 3 },
  { name: 'lava_flow', make: () => fluidFlow(204, 16, pal('#b33a05', '#d65a0a', '#ec7d12', '#f7a225', '#ffc94a', '#fff08a'), 1), frametime: 3 },
];

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
