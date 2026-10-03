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
