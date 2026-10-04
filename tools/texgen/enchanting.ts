/**
 * Original Phase 7 GUI art: the scrolling enchantment glint and the enchanting table window
 * (offer buttons and level orbs).
 */
import { Tex, hex, rng, type RGBA } from './lib';

/** 64×64 tileable glint: diagonal violet streaks (scrolled and blended additively). */
export function glint(): Tex {
  const t = new Tex(64, 64);
  const r = rng(7331);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const d = (x + y * 2) % 64;
      const band = Math.max(0, 1 - Math.abs(d - 20) / 9) + 0.55 * Math.max(0, 1 - Math.abs(d - 46) / 5);
      const v = Math.min(1, band * (0.85 + r() * 0.15));
      const q = Math.round(v * 6) / 6; // posterised: no smooth gradients
      t.set(x, y, [Math.round(130 * q), Math.round(70 * q), Math.round(255 * q), 255]);
    }
  return t;
}

/** 176×166 enchanting window plus offer buttons at (0,166): 108×19 normal/hover/disabled. */
export function enchantingTable(): Tex {
  const t = new Tex(256, 256);
  const face = hex('#c6c6c6'), light = hex('#ffffff'), dark = hex('#555555'), edge = hex('#000000');
  for (let y = 0; y < 166; y++)
    for (let x = 0; x < 176; x++) {
      const corner = (x < 2 || x > 173) && (y < 2 || y > 163);
      if (corner && !((x === 1 || x === 174) && (y === 1 || y === 164))) continue;
      let c = face;
      if (x === 0 || y === 0 || x === 175 || y === 165) c = edge;
      else if (x <= 2 || y <= 2) c = light;
      else if (x >= 173 || y >= 163) c = dark;
      t.set(x, y, c);
    }
  const slot = (x0: number, y0: number) => {
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 18; x++) {
        let c = hex('#8b8b8b');
        if (x === 0 || y === 0) c = hex('#373737');
        else if (x === 17 || y === 17) c = hex('#ffffff');
        t.set(x0 + x, y0 + y, c);
      }
  };
  slot(14, 46); // item
  slot(34, 46); // lapis
  for (let row = 0; row < 3; row++) for (let col = 0; col < 9; col++) slot(7 + col * 18, 83 + row * 18);
  for (let col = 0; col < 9; col++) slot(7 + col * 18, 141);
  // offer panel well
  for (let y = 0; y < 57; y++) for (let x = 0; x < 108; x++) t.set(59 + x, 13 + y, hex('#8b8b8b'));
  // faint lapis outline in the lapis slot
  const lapis = ['..##..', '.#++#.', '#++++#', '#++++#', '.#++#.', '..##..'];
  lapis.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && t.set(40 + x, 52 + y, ch === '#' ? hex('#6f7486') : hex('#9aa0b4'))));
  // offer buttons 108×19: enabled, hover, disabled
  const btn = (y0: number, f: RGBA, l: RGBA, d: RGBA) => {
    for (let y = 0; y < 19; y++)
      for (let x = 0; x < 108; x++) {
        let c = f;
        if (x === 0 || y === 0) c = l;
        else if (x === 107 || y === 18) c = d;
        t.set(x, y0 + y, c);
      }
  };
  btn(166, hex('#b9a77f'), hex('#e8dcbc'), hex('#6d5f40'));
  btn(185, hex('#d9c9a0'), hex('#fff5d8'), hex('#86764f'));
  btn(204, hex('#6c6658'), hex('#8e8878'), hex('#3d392f'));
  // level orbs 16×16 at (0,223): three sizes, lit and dim
  for (let k = 0; k < 3; k++)
    for (const lit of [true, false]) {
      const ox = k * 16 + (lit ? 0 : 48), oy = 223;
      const rr = 3 + k * 2;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const dx = x - 7.5, dy = y - 7.5;
          if (dx * dx + dy * dy > rr * rr) continue;
          const c = lit ? (dx + dy < -2 ? hex('#d8ff8a') : hex('#7fd13a')) : (dx + dy < -2 ? hex('#7d8a68') : hex('#4c5640'));
          t.set(ox + x, oy + y, c);
        }
    }
  void r0;
  return t;
}
const r0 = 0;
