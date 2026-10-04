/** Sun, moon phases and cloud textures (original designs). */
import { Tex, hex, rng, mix, type RGBA } from './lib';

/** 32×32 sun: a bright square core with a softer glow ring (rendered additively). */
export function sun(): Tex {
  const t = new Tex(32, 32);
  const core = hex('#fffbe0'), mid = hex('#ffe98a'), glow = hex('#d9a93a');
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = Math.max(Math.abs(x - 15.5), Math.abs(y - 15.5));
      let c: RGBA = [0, 0, 0, 255];
      if (d < 5) c = core;
      else if (d < 7) c = mid;
      else if (d < 9) c = mix(glow, [0, 0, 0, 255], 0.35);
      else if (d < 11) c = mix(glow, [0, 0, 0, 255], 0.75);
      t.set(x, y, c);
    }
  return t;
}

/** 4×2 grid of 32×32 moon phases (full → waning → new → waxing), additive on black. */
export function moonPhases(): Tex {
  const t = new Tex(128, 64);
  const r = rng(77);
  // craters shared by all phases
  const craters: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) craters.push([10 + Math.floor(r() * 12), 10 + Math.floor(r() * 12), 1 + Math.floor(r() * 2)]);
  const lit = hex('#e8ecf4'), dim = hex('#aeb6c6'), crater = hex('#8c94a6');
  for (let phase = 0; phase < 8; phase++) {
    const ox = (phase % 4) * 32, oy = Math.floor(phase / 4) * 32;
    // illuminated fraction: phase 0 full, 4 new; terminator moves across the disc
    const k = phase <= 4 ? phase / 4 : (8 - phase) / 4; // 0 full .. 1 new
    const waning = phase > 0 && phase < 4;
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const dx = x - 15.5, dy = y - 15.5;
        const inDisc = Math.max(Math.abs(dx), Math.abs(dy)) < 8;
        let c: RGBA = [0, 0, 0, 255];
        if (inDisc) {
          // terminator position in -8..8 along x
          const u = waning ? dx : -dx;
          const edge = 8 - k * 16;
          if (u < edge) {
            c = lit;
            for (const [cx, cy, cr] of craters) if (Math.abs(x - cx - 8) <= cr - 1 && Math.abs(y - cy - 8 + 8) <= cr - 1) c = crater;
            if (Math.abs(dx) > 6 || Math.abs(dy) > 6) c = dim;
          }
        }
        t.set(ox + x, oy + y, c);
      }
  }
  return t;
}

/** 256×256 cloud map: white blobs on transparent, tiled across the sky. */
export function clouds(): Tex {
  const t = new Tex(256, 256);
  const r = rng(123);
  const cells = new Uint8Array(256 * 256);
  // grow blobs from random seeds
  for (let i = 0; i < 260; i++) {
    let x = Math.floor(r() * 256), y = Math.floor(r() * 256);
    const n = 6 + Math.floor(r() * 40);
    for (let j = 0; j < n; j++) {
      const w = 2 + Math.floor(r() * 6), h = 2 + Math.floor(r() * 4);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) cells[((y + yy) & 255) * 256 + ((x + xx) & 255)] = 1;
      x = (x + Math.floor(r() * 5) - 2 + 256) & 255;
      y = (y + Math.floor(r() * 3) - 1 + 256) & 255;
    }
  }
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (cells[y * 256 + x]) t.set(x, y, [255, 255, 255, 255]);
  return t;
}

/** 64×256 rain streak sheet: 4 variants of 16 px columns, scrolled vertically in game. */
export function rain(): Tex {
  const t = new Tex(64, 256);
  const r = rng(301);
  for (let col = 0; col < 4; col++)
    for (let i = 0; i < 9; i++) {
      const x = col * 16 + Math.floor(r() * 16);
      const y0 = Math.floor(r() * 256), len = 10 + Math.floor(r() * 14);
      for (let k = 0; k < len; k++) {
        const a = Math.round(90 + 120 * (k / len));
        t.set(x, (y0 + k) & 255, [120 + Math.floor(r() * 30), 150 + Math.floor(r() * 30), 230, a]);
      }
    }
  return t;
}

/** 64×256 snowflake sheet. */
export function snowflakes(): Tex {
  const t = new Tex(64, 256);
  const r = rng(302);
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(r() * 63), y = Math.floor(r() * 255);
    const big = r() < 0.3;
    t.set(x, y, [255, 255, 255, 235]);
    if (big) {
      t.set(x + 1, y, [235, 240, 255, 200]);
      t.set(x, y + 1, [235, 240, 255, 200]);
    }
  }
  return t;
}

/**
 * 10 block-breaking crack stages (16×16 each, grayscale on transparent), drawn with
 * multiplicative blending. Cracks grow from the centre outward in a branching pattern.
 */
export function destroyStages(): Tex[] {
  const r = rng(404);
  // grow a crack tree once, then reveal more of it per stage
  type P = { x: number; y: number; order: number };
  const pts: P[] = [];
  const seen = new Set<string>();
  let order = 0;
  const tips: { x: number; y: number; dx: number; dy: number }[] = [
    { x: 8, y: 8, dx: 1, dy: -1 }, { x: 7, y: 8, dx: -1, dy: 1 }, { x: 8, y: 7, dx: 1, dy: 1 }, { x: 7, y: 7, dx: -1, dy: -1 },
  ];
  while (tips.length && order < 200) {
    const i = Math.floor(r() * tips.length);
    const t = tips[i]!;
    const k = `${t.x},${t.y}`;
    if (!seen.has(k) && t.x >= 0 && t.y >= 0 && t.x < 16 && t.y < 16) {
      seen.add(k);
      pts.push({ x: t.x, y: t.y, order: order++ });
    }
    // wander: mostly keep direction, sometimes turn, sometimes branch
    const turn = r();
    if (turn < 0.3) t.dx = r() < 0.5 ? 0 : t.dx || (r() < 0.5 ? 1 : -1);
    else if (turn < 0.6) t.dy = r() < 0.5 ? 0 : t.dy || (r() < 0.5 ? 1 : -1);
    if (!t.dx && !t.dy) t.dx = 1;
    t.x += t.dx;
    t.y += t.dy;
    if (r() < 0.08) tips.push({ x: t.x, y: t.y, dx: -t.dy || 1, dy: t.dx });
    if (t.x < 0 || t.y < 0 || t.x > 15 || t.y > 15) tips.splice(i, 1);
  }
  const stages: Tex[] = [];
  for (let s = 0; s < 10; s++) {
    const t = new Tex();
    const n = Math.round(((s + 1) / 10) * pts.length);
    for (const p of pts.slice(0, n)) {
      t.set(p.x, p.y, [40, 40, 40, 255]);
      // lighter halo pixel for depth on later stages
      if (s > 4 && p.order % 3 === 0) t.set(p.x + 1, p.y, [110, 110, 110, 255]);
    }
    stages.push(t);
  }
  return stages;
}

/** 64×64 underwater overlay: soft dark tileable blotches (drawn at 10% opacity, scrolled with the view). */
export function underwater(): Tex {
  const t = new Tex(64, 64);
  const r = rng(4242);
  // a few octaves of tileable value noise
  const grid = (n: number) => Array.from({ length: n * n }, () => r());
  const octs = [grid(4), grid(8), grid(16)];
  const sample = (g: number[], n: number, x: number, y: number) => {
    const fx = (x / 64) * n, fy = (y / 64) * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const v = (i: number, j: number) => g[((j % n) + n) % n * n + (((i % n) + n) % n)]!;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const n = sample(octs[0]!, 4, x, y) * 0.5 + sample(octs[1]!, 8, x, y) * 0.3 + sample(octs[2]!, 16, x, y) * 0.2;
      const v = Math.round(Math.max(0, Math.min(1, n * 1.6 - 0.35)) * 255);
      t.set(x, y, [v, v, v, 255]);
    }
  return t;
}

/**
 * 64×64 experience orb sheet: 16 icons (4×4) of glowing orbs growing with the orb value; drawn
 * near-white so the renderer's green/yellow pulse tints it.
 */
export function experienceOrbs(): Tex {
  const t = new Tex(64, 64);
  for (let i = 0; i < 16; i++) {
    const ox = (i % 4) * 16, oy = Math.floor(i / 4) * 16;
    const r = 2 + Math.min(i, 10) * 0.5; // radius in px
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const dx = x - 7.5, dy = y - 7.5;
        const d = Math.max(Math.abs(dx), Math.abs(dy)) * 0.55 + Math.hypot(dx, dy) * 0.45;
        if (d > r + 0.5) continue;
        const k = d / (r + 0.5);
        let v: number;
        if (k < 0.35) v = 255;
        else if (k < 0.7) v = 225;
        else v = 165;
        // a highlight speck toward the top-left
        if (dx < -r * 0.2 && dy < -r * 0.2 && k > 0.3 && k < 0.6) v = 255;
        const edge = k >= 0.82;
        t.set(ox + x, oy + y, edge ? [70, 92, 20, 255] : [v, v, Math.round(v * 0.75), 255]);
      }
  }
  return t;
}

/** 128×128 frost vignette drawn over the screen while freezing (alpha scales with the frost). */
export function powderSnowOutline(): Tex {
  const t = new Tex(128, 128);
  const r = rng(5150);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      const dx = Math.min(x, 127 - x) / 64, dy = Math.min(y, 127 - y) / 64;
      const edge = Math.min(dx, dy);
      // icy crystals thicken toward the border, with some ragged noise
      const n = r();
      const a = Math.max(0, Math.min(1, (0.32 - edge) / 0.32 + (n - 0.5) * 0.35));
      if (a <= 0.02) continue;
      const bright = 200 + Math.round(n * 55);
      t.set(x, y, [bright, Math.min(255, bright + 15), 255, Math.round(a * 230)]);
    }
  return t;
}

/**
 * 128×128 End sky tile (original): a tileable field of muted violet-grey speckle and soft
 * streaks on near-black, drawn bright so the renderer's 40/255 tint brings it down to the dim,
 * grainy void the End sky box shows. Repeated 16 times across each face of the sky cube.
 */
export function endSky(): Tex {
  const N = 128;
  const t = new Tex(N, N);
  const r = rng(1717);
  const grid = (n: number) => Array.from({ length: n * n }, () => r());
  const octs: [number[], number][] = [[grid(8), 8], [grid(16), 16], [grid(32), 32]];
  const sample = (g: number[], n: number, x: number, y: number) => {
    const fx = (x / N) * n, fy = (y / N) * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const v = (i: number, j: number) => g[((j % n) + n) % n * n + (((i % n) + n) % n)]!;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };
  const dark = hex('#4a4352'), mid = hex('#9a8fa8'), light = hex('#f0e8f8');
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const n = sample(octs[0][0], 8, x, y) * 0.5 + sample(octs[1][0], 16, x, y) * 0.3 + sample(octs[2][0], 32, x, y) * 0.2;
      const grain = r();
      let c = mix(dark, mid, Math.max(0, Math.min(1, (n - 0.35) * 2.2)));
      if (grain > 0.985) c = mix(c, light, 0.8);
      else if (grain > 0.93) c = mix(c, mid, 0.5);
      t.set(x, y, [c[0], c[1], c[2], 255]);
    }
  return t;
}
