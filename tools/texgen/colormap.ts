/**
 * Original biome colormaps (256×256), indexed like the vanilla scheme:
 * x = (1 - temperature) * 255, y = (1 - downfall * temperature) * 255.
 * Colours come from inverse-distance blending of hand-picked anchors.
 */
import { Tex, hex, type RGBA } from './lib';

type Anchor = { t: number; d: number; c: RGBA };

function build(anchors: Anchor[]): Tex {
  const t = new Tex(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const temp = 1 - x / 255;
      const td = 1 - y / 255; // downfall * temperature
      if (td > temp + 1e-6) {
        t.set(x, y, [0, 0, 0, 0]); // outside the valid triangle
        continue;
      }
      const down = temp > 0 ? td / temp : 0;
      let wr = 0, wg = 0, wb = 0, ws = 0;
      for (const a of anchors) {
        const dt = a.t - temp, dd = (a.d - down) * 0.6;
        const w = 1 / Math.pow(dt * dt + dd * dd + 1e-4, 1.5);
        wr += a.c[0] * w;
        wg += a.c[1] * w;
        wb += a.c[2] * w;
        ws += w;
      }
      t.set(x, y, [Math.round(wr / ws), Math.round(wg / ws), Math.round(wb / ws), 255]);
    }
  return t;
}

export function grassColormap(): Tex {
  return build([
    { t: 1, d: 0, c: hex('#bdb558') }, // hot & dry: olive yellow
    { t: 1, d: 1, c: hex('#4ec83a') }, // hot & wet: saturated green
    { t: 0.8, d: 0.4, c: hex('#92be5b') }, // temperate meadow
    { t: 0.7, d: 0.8, c: hex('#7bc05c') }, // woodland
    { t: 0.5, d: 0.5, c: hex('#88ba68') },
    { t: 0.25, d: 0.8, c: hex('#85b682') }, // cool conifer
    { t: 0.2, d: 0.3, c: hex('#8bb588') }, // highlands
    { t: 0, d: 0.5, c: hex('#7fb498') }, // frozen: blue-green
  ]);
}

export function foliageColormap(): Tex {
  return build([
    { t: 1, d: 0, c: hex('#ada32c') },
    { t: 1, d: 1, c: hex('#2dbb0d') },
    { t: 0.8, d: 0.4, c: hex('#76aa31') },
    { t: 0.7, d: 0.8, c: hex('#5aad32') },
    { t: 0.6, d: 0.6, c: hex('#6aa842') },
    { t: 0.25, d: 0.8, c: hex('#67a465') },
    { t: 0.2, d: 0.3, c: hex('#6ca26c') },
    { t: 0, d: 0.5, c: hex('#5fa07c') },
  ]);
}
