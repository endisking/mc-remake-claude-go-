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
