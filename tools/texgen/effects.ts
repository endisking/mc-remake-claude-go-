/**
 * Original Phase 7 GUI art: status effect icons (18×18 each, 8 per row, indexed by effect
 * id − 1), the effect HUD/inventory frames, the scrolling enchantment glint and the
 * enchanting table window. All designs are drawn here from hand-made glyphs.
 */
import { Tex, hex, mix, shade, rng, type RGBA } from './lib';

/** 9×9 glyphs (scaled 2× into the 18×18 icon). '#' = body, '+' = highlight, '-' = shade. */
const GLYPHS: Record<string, string[]> = {
  speed: ['.........', '..####...', '...####..', '....####.', '##...####', '....####.', '...####..', '..####...', '.........'],
  slowness: ['..#####..', '.#+++++#.', '..#+++#..', '...#+#...', '....#....', '...#-#...', '..#---#..', '.#-----#.', '..#####..'],
  haste: ['.....###.', '....#++#.', '...#++#..', '..#++#...', '.#--#....', '#--#.....', '.##......', '.........', '.........'],
  mining_fatigue: ['.###.....', '#+++#....', '#+++###..', '.#--#--#.', '..#.#--#.', '....#--#.', '.....##..', '.........', '.........'],
  strength: ['...###...', '..#+++#..', '..#+++#..', '...#+#...', '.#######.', '#+++++++#', '#-------#', '.#######.', '.........'],
  instant_health: ['.##...##.', '#++#.#++#', '#+++#+++#', '#+++++++#', '.#+++++#.', '..#---#..', '...#-#...', '....#....', '.........'],
  instant_damage: ['....#....', '...#+#...', '...#+#...', '..#+++#..', '..#+++#..', '.#+++++#.', '.#-----#.', '..#####..', '.........'],
  jump_boost: ['....#....', '...#+#...', '..#+++#..', '.#++#++#.', '...#+#...', '...#+#...', '...#-#...', '..#####..', '.........'],
  nausea: ['..#####..', '.#.....#.', '#..###..#', '#.#...#.#', '#.#.#.#.#', '#.#..#..#', '#..##..#.', '.#....#..', '..####...'],
  regeneration: ['.##...##.', '#++#.#++#', '#+++#+++#', '#+#+#+#+#', '.#+#+#+#.', '..#+#+#..', '...#+#...', '....#....', '.........'],
  resistance: ['.#######.', '#+++++++#', '#+++#+++#', '#++###++#', '#+++#+++#', '.#+++++#.', '..#---#..', '...###...', '.........'],
  fire_resistance: ['....#....', '...#+#...', '..#+#+#..', '.#+#+#+#.', '#+#####+#', '#+#---#+#', '.#-----#.', '..#####..', '.........'],
  water_breathing: ['...##....', '..#++#...', '..#++#.##', '...##.#+#', '.##...#+#', '#++#...#.', '#++#.....', '.##..##..', '....#++#.'],
  invisibility: ['.........', '..#####..', '.#.....#.', '#..#.#..#', '#.......#', '.#.....#.', '..#.#.#..', '.#.#.#.#.', '.........'],
  blindness: ['.........', '..#####..', '.#-----#.', '#--###--#', '#-#####-#', '#--###--#', '.#-----#.', '..#####..', '#.......#'],
  night_vision: ['.........', '..#####..', '.#+++++#.', '#++###++#', '#+#+#+#+#', '#++###++#', '.#+++++#.', '..#####..', '.........'],
  hunger: ['....###..', '...#+++#.', '..#++++#.', '.#++++#..', '#-+++#...', '#--+#....', '.##-#....', '...##....', '.........'],
  weakness: ['...###...', '..#---#..', '..#---#..', '...#-#...', '.##...##.', '#--#.#--#', '.##...##.', '.........', '.........'],
  poison: ['...###...', '..#+++#..', '.#+#+#+#.', '.#+++++#.', '..#+#+#..', '...###...', '..#.#.#..', '.#..#..#.', '.........'],
  wither: ['..#####..', '.#-----#.', '#-#---#-#', '#-------#', '.#--#--#.', '..#---#..', '..#-#-#..', '...###...', '.........'],
  health_boost: ['.##...##.', '#++#.#++#', '#+++#+++#', '#++###++#', '.#+###+#.', '..#+#+#..', '...#+#...', '....#....', '.........'],
  absorption: ['.##...##.', '#--#.#--#', '#+--#--+#', '#++---++#', '.#+++++#.', '..#+++#..', '...#+#...', '....#....', '.........'],
  saturation: ['..##.##..', '.#++#++#.', '#++++++-#', '#+++++--#', '#++++---#', '.#+----#.', '..#####..', '.........', '.........'],
  glowing: ['#...#...#', '.#..#..#.', '..#####..', '..#+++#..', '###+++###', '..#+++#..', '..#####..', '.#..#..#.', '#...#...#'],
  levitation: ['....#....', '...#+#...', '..#+#+#..', '....#....', '...#+#...', '..#+#+#..', '....#....', '...###...', '..#####..'],
  luck: ['...#.#...', '..#+#+#..', '.#+#+#+#.', '..#+++#..', '.#+#+#+#.', '..#+#+#..', '...#.#...', '....#....', '...#.....'],
  unluck: ['...#.#...', '..#-#-#..', '.#-#-#-#.', '..#---#..', '.#-#-#-#.', '..#-#-#..', '...#.#...', '....#....', '.....#...'],
  slow_falling: ['.#######.', '#+++++++#', '#-#-#-#-#', '.#.....#.', '..#...#..', '...#.#...', '...###...', '...#+#...', '...###...'],
  conduit_power: ['...###...', '..#+++#..', '.#+#-#+#.', '#+#---#+#', '#+-----+#', '#+#---#+#', '.#+#-#+#.', '..#+++#..', '...###...'],
  dolphins_grace: ['.........', '.....##..', '...##++#.', '.##++++#.', '#++++++##', '.#--++#..', '..##-#...', '....#....', '.........'],
  bad_omen: ['.#######.', '#-------#', '#-#####-#', '#-#---#-#', '#-#####-#', '#---#---#', '.#--#--#.', '..##-##..', '....#....'],
  hero_of_the_village: ['#.#.#.#.#', '#########', '.#+++++#.', '.#+#+#+#.', '.#+++++#.', '..#+++#..', '...#+#...', '....#....', '.........'],
};

const ORDER = [
  'speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost', 'nausea', 'regeneration',
  'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision', 'hunger', 'weakness', 'poison', 'wither',
  'health_boost', 'absorption', 'saturation', 'glowing', 'levitation', 'luck', 'unluck', 'slow_falling', 'conduit_power', 'dolphins_grace',
  'bad_omen', 'hero_of_the_village',
];

const COLORS: number[] = [
  8171462, 5926017, 14270531, 4866583, 9643043, 16262179, 4393481, 2293580, 5578058, 13458603, 10044730, 14981690, 3035801, 8356754, 2039587,
  2039713, 5797459, 4738376, 5149489, 3484199, 16284963, 2445989, 16262179, 9740385, 13565951, 3381504, 12624973, 16773073, 1950417, 8954814,
  745784, 4521796,
];

const rgb = (c: number): RGBA => [(c >> 16) & 255, (c >> 8) & 255, c & 255, 255];

/** 144×72 sheet: 8 icons per row, 18×18, index = effect id − 1. */
export function mobEffects(): Tex {
  const t = new Tex(144, 72);
  ORDER.forEach((name, i) => {
    const g = GLYPHS[name]!;
    // lift dark colours so every icon reads on the dark HUD frame
    let base = rgb(COLORS[i]!);
    const lum = (base[0] * 0.3 + base[1] * 0.59 + base[2] * 0.11) / 255;
    if (lum < 0.35) base = mix(base, hex('#c8c8d0'), 0.35 - lum + 0.15);
    const hi = mix(base, hex('#ffffff'), 0.45), lo = shade(base, 0.6), outline = shade(base, 0.25);
    const ox = (i % 8) * 18, oy = Math.floor(i / 8) * 18;
    const r = rng(1000 + i);
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++) {
        const ch = g[y]![x]!;
        if (ch === '.') continue;
        for (let sy = 0; sy < 2; sy++)
          for (let sx = 0; sx < 2; sx++) {
            let c = ch === '+' ? hi : ch === '-' ? lo : base;
            // light from the top-left inside each 2×2 cell, with a little dither
            if (sx === 0 && sy === 0 && ch !== '-') c = mix(c, hex('#ffffff'), 0.15);
            if (sx === 1 && sy === 1) c = shade(c, 0.88);
            if (r() < 0.12) c = shade(c, 0.93);
            t.set(ox + x * 2 + sx, oy + y * 2 + sy, c);
          }
      }
    // 1 px dark outline around the glyph
    const copy = t.clone();
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 18; x++) {
        if (copy.get(ox + x, oy + y)[3] > 0) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const xx = x + dx!, yy = y + dy!;
          return xx >= 0 && yy >= 0 && xx < 18 && yy < 18 && copy.get(ox + xx, oy + yy)[3] > 0;
        });
        if (n) t.set(ox + x, oy + y, [outline[0], outline[1], outline[2], 255]);
      }
  });
  return t;
}

/**
 * 256×64 effect frames: (0,0) 24×24 HUD frame, (24,0) 24×24 ambient (beacon) HUD frame,
 * (0,32) 120×32 inventory list entry.
 */
export function effectFrames(): Tex {
  const t = new Tex(256, 64);
  const frame = (x0: number, y0: number, w: number, h: number, face: RGBA, light: RGBA, dark: RGBA, edge: RGBA) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
        if (corner) continue;
        let c = face;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c = edge;
        else if (x === 1 || y === 1) c = light;
        else if (x === w - 2 || y === h - 2) c = dark;
        t.set(x0 + x, y0 + y, c);
      }
  };
  frame(0, 0, 24, 24, hex('#2b2d36'), hex('#5a5e70'), hex('#17181d'), hex('#0b0b0e'));
  frame(24, 0, 24, 24, hex('#2a3640'), hex('#7fd1e0'), hex('#16323a'), hex('#0b0b0e'));
  frame(0, 32, 120, 32, hex('#c3c3c8'), hex('#f4f4f7'), hex('#6e6e76'), hex('#16161a'));
  return t;
}

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
