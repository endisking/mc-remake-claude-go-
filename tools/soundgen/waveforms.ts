/** Waveform contact sheet of every generated clip (for visual checks): tools/bench/out/sound-waveforms.png */
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { decode, RATE } from './audio';

const root = new URL('../../', import.meta.url).pathname;
const dir = join(root, 'client/public/sounds');
const sets = readdirSync(dir).filter((d) => !d.endsWith('.json')).sort();
const W = 160, H = 40, COLS = 6, LABEL = 0;
const rows = sets.map((s) => readdirSync(join(dir, s)).sort((a, b) => parseInt(a) - parseInt(b)));
const png = new PNG({ width: COLS * (W + 4) + 4, height: sets.length * (H + 4) + 4 + LABEL });
png.data.fill(30);
for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
const lines: string[] = [];
sets.forEach((set, r) => {
  rows[r]!.slice(0, COLS).forEach((f, c) => {
    const s = decode(join(dir, set, f));
    const x0 = 4 + c * (W + 4), y0 = 4 + r * (H + 4);
    const secs = s.length / RATE;
    // background tint by duration (darker = longer)
    for (let x = 0; x < W; x++) {
      const a = Math.floor((x / W) * s.length), b = Math.floor(((x + 1) / W) * s.length);
      let pk = 0;
      for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(s[i]!));
      const h = Math.round(pk * (H / 2));
      for (let y = 0; y < H; y++) {
        const o = ((y0 + y) * png.width + x0 + x) * 4;
        const on = Math.abs(y - H / 2) <= h;
        png.data[o] = on ? 120 : 50;
        png.data[o + 1] = on ? 220 : 50;
        png.data[o + 2] = on ? 140 : 60;
      }
    }
    lines.push(`${set}/${f}\t${secs.toFixed(2)}s`);
  });
});
mkdirSync(join(root, 'tools/bench/out'), { recursive: true });
writeFileSync(join(root, 'tools/bench/out/sound-waveforms.png'), PNG.sync.write(png));
console.log(sets.map((s, i) => `${i}: ${s}`).join('\n'));
console.log(lines.join('\n'));
