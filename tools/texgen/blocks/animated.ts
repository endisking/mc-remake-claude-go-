/** Animated block textures: fire, soul fire, nether portal, sea lantern, magma, prismarine, kelp, seagrass. */
import { Tex, pal, hex, rng, fbm, strip, mix, shade, type Palette, type RGBA } from '../lib';
import type { TexDef } from '../registry';

/**
 * Classic heat-propagation fire: random hot spots along the bottom, heat rises and cools;
 * mapped to a palette with transparency for cool cells. Runs a warm-up so the strip starts
 * in a steady state.
 */
function fireStrip(seed: number, frames: number, palette: Palette): Tex {
  const W = 16, H = 20;
  let heat = new Float32Array(W * H);
  const r = rng(seed);
  const step = () => {
    const next = new Float32Array(W * H);
    for (let x = 0; x < W; x++) heat[(H - 1) * W + x] = r() < 0.45 ? 1.1 + r() * 0.5 : r() * 0.3;
    for (let y = 0; y < H - 1; y++)
      for (let x = 0; x < W; x++) {
        const below = (y + 1) * W;
        const sum = heat[below + x]! * 2 + heat[below + ((x + W - 1) % W)]! + heat[below + ((x + 1) % W)]! + heat[y * W + x]!;
        next[y * W + x] = Math.max(0, (sum / 5) * 0.995 - 0.004 - r() * 0.036);
      }
    for (let x = 0; x < W; x++) next[(H - 1) * W + x] = heat[(H - 1) * W + x]!;
    heat = next;
  };
  for (let i = 0; i < 40; i++) step();
  const out: Tex[] = [];
  for (let f = 0; f < frames; f++) {
    step();
    const t = new Tex();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < W; x++) {
        const v = heat[(y + 3) * W + x]!;
        if (v < 0.27) continue;
        const idx = Math.min(palette.length - 1, Math.floor((v - 0.27) * palette.length * 2.3));
        t.set(x, y, palette[idx]!);
      }
    out.push(t);
  }
  return strip(out);
}

const FIRE = pal('#8a1b02', '#b83204', '#e05a08', '#f2840e', '#fab121', '#ffd54a', '#fff2a6');
const SOUL_FIRE = pal('#0c3a4a', '#11606e', '#1b8f98', '#33b8c0', '#62dbe0', '#a8f3f3', '#e8ffff');

/** Swirling nether portal: two counter-rotating noise fields in purple tones. */
function portal(seed: number, frames: number): Tex {
  const p = pal('#2b0a5c', '#43128c', '#5c1fb5', '#7a33d6', '#9a55ec', '#c38bff');
  const A = fbm(seed, [4, 8], [0.6, 0.4]);
  const out: Tex[] = [];
  for (let f = 0; f < frames; f++) {
    const ph = (f / frames) * Math.PI * 2;
    const t = new Tex();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5, dy = y - 7.5;
        const ang = Math.atan2(dy, dx), rad = Math.hypot(dx, dy);
        const sw = Math.sin(ang * 3 + rad * 0.9 - ph * 2) * 0.5 + 0.5;
        const n = A[(((y + Math.round(Math.sin(ph) * 3)) % 16) + 16) % 16 * 16 + ((((x + Math.round(Math.cos(ph) * 3)) % 16) + 16) % 16)]!;
        const v = sw * 0.55 + n * 0.45;
        const c = p[Math.max(0, Math.min(5, Math.round(v * 5)))]!;
        t.set(x, y, [c[0], c[1], c[2], 200]);
      }
    out.push(t);
  }
  return strip(out);
}

/** Sea lantern: pale cyan tiles with a glowing core that pulses over 5 frames. */
function seaLantern(): Tex {
  const out: Tex[] = [];
  for (let f = 0; f < 5; f++) {
    const t = new Tex();
    const glow = 0.5 + 0.5 * Math.sin((f / 5) * Math.PI * 2);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const edge = x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || y === 7 || x === 8 || y === 8;
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let c: RGBA = edge ? hex('#9cc7c2') : mix(hex('#d6efe9'), hex('#fdfff8'), Math.max(0, 1 - d / 8) * (0.6 + 0.4 * glow));
        if (!edge && (x + y + f) % 7 === 0) c = hex('#f4fffb');
        t.set(x, y, c);
      }
    out.push(t);
  }
  return strip(out);
}

/** Magma: dark crust with glowing orange cracks that brighten and dim. */
function magma(): Tex {
  const n = fbm(781, [4, 8, 16], [0.45, 0.35, 0.2]);
  const crust = pal('#2a0e06', '#3e150a', '#55200f');
  const glowP = pal('#8c2a05', '#c4470a', '#ef7a14', '#ffb43a');
  const out: Tex[] = [];
  for (let f = 0; f < 3; f++) {
    const t = new Tex();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const v = n[y * 16 + x]!;
        const crack = Math.abs(v - 0.5) < 0.07;
        if (crack) t.set(x, y, glowP[Math.min(3, 1 + f + ((x + y) % 2))]!);
        else t.set(x, y, crust[Math.min(2, Math.floor(v * 3))]!);
      }
    out.push(t);
  }
  return strip(out);
}

/** Prismarine: mossy teal stone whose hue slowly shifts over 22 frames. */
function prismarine(): Tex {
  const n = fbm(791, [8, 16], [0.5, 0.5]);
  const out: Tex[] = [];
  for (let f = 0; f < 22; f++) {
    const k = 0.5 + 0.5 * Math.sin((f / 22) * Math.PI * 2);
    const p = [mix(hex('#3f7a6a'), hex('#4c6f86'), k), mix(hex('#5a9a84'), hex('#628aa4'), k), mix(hex('#77b49c'), hex('#7ea4bb'), k), mix(hex('#9cd0b7'), hex('#a0c3d4'), k)];
    const t = new Tex();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t.set(x, y, p[Math.min(3, Math.floor(n[y * 16 + x]! * 4))]!);
    out.push(t);
  }
  return strip(out);
}

/** Underwater plants that sway: a stem drawn with a sideways offset varying by height and frame. */
function swaying(seed: number, frames: number, colors: Palette, kind: 'kelp' | 'kelp_plant' | 'seagrass' | 'tall_top' | 'tall_bottom'): Tex {
  const r = rng(seed);
  const out: Tex[] = [];
  const blades = kind === 'kelp' || kind === 'kelp_plant' ? [5, 9] : [2, 5, 8, 11, 13];
  const heights = blades.map(() => 9 + Math.floor(r() * 7));
  for (let f = 0; f < frames; f++) {
    const t = new Tex();
    blades.forEach((bx, i) => {
      const h = kind === 'kelp_plant' || kind === 'tall_bottom' ? 16 : heights[i]!;
      for (let k = 0; k < h; k++) {
        const y = 15 - k;
        const sway = Math.round(Math.sin((f / frames) * Math.PI * 2 + k * 0.35 + i) * (k / 16) * 1.5);
        const x = bx + sway;
        t.set(x, y, colors[(k + i) % colors.length]!);
        if (kind.startsWith('kelp') && k % 4 === 1) t.set(x + 1, y, shade(colors[2]!, 1.1));
      }
    });
    out.push(t);
  }
  return strip(out);
}

const KELP = pal('#3c6b1f', '#4d8226', '#5f962e', '#71a83a');
const SEAGRASS = pal('#2f7a2a', '#3a8d31', '#48a03b', '#58b046');

export const animatedTextures: TexDef[] = [
  { name: 'fire_0', make: () => fireStrip(901, 32, FIRE), cutout: true },
  { name: 'fire_1', make: () => fireStrip(902, 32, FIRE), cutout: true },
  { name: 'soul_fire_0', make: () => fireStrip(903, 32, SOUL_FIRE), cutout: true },
  { name: 'soul_fire_1', make: () => fireStrip(904, 32, SOUL_FIRE), cutout: true },
  { name: 'nether_portal', make: () => portal(905, 32), translucent: true },
  { name: 'sea_lantern', make: seaLantern, frametime: 5 },
  { name: 'magma', make: magma, frametime: 8 },
  { name: 'prismarine', make: prismarine, frametime: 300 },
  { name: 'kelp', make: () => swaying(906, 20, KELP, 'kelp'), frametime: 2, cutout: true },
  { name: 'kelp_plant', make: () => swaying(907, 20, KELP, 'kelp_plant'), frametime: 2, cutout: true },
  { name: 'seagrass', make: () => swaying(908, 18, SEAGRASS, 'seagrass'), frametime: 2, cutout: true },
  { name: 'tall_seagrass_top', make: () => swaying(909, 18, SEAGRASS, 'tall_top'), frametime: 2, cutout: true },
  { name: 'tall_seagrass_bottom', make: () => swaying(910, 18, SEAGRASS, 'tall_bottom'), frametime: 2, cutout: true },
];
