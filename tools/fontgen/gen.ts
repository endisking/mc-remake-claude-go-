/**
 * Bitmap font generator: renders GLYPHS into a 128×128 sheet (16×16 cells of 8×8, cell
 * index = char code) plus per-glyph advance widths. Output: client/public/textures/font/.
 * Run: pnpm fontgen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { GLYPHS } from './glyphs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'client', 'public', 'textures', 'font');
mkdirSync(out, { recursive: true });

const png = new PNG({ width: 128, height: 128 });
png.data.fill(0);
const widths = new Array(256).fill(0);
for (const [ch, rows] of Object.entries(GLYPHS)) {
  const code = ch.charCodeAt(0);
  if (code > 255) continue;
  const cx = (code % 16) * 8, cy = Math.floor(code / 16) * 8;
  const w = Math.max(...rows.map((r) => r.length));
  if (rows.length !== 8) throw new Error(`glyph ${ch}: needs 8 rows`);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < w; x++) {
      if (rows[y]![x] !== '#') continue;
      const i = ((cy + y) * 128 + cx + x) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = png.data[i + 3] = 255;
    }
  widths[code] = ch === ' ' ? 3 : w; // advance = width + 1 spacing at render time
}
writeFileSync(join(out, 'ascii.png'), PNG.sync.write(png));
writeFileSync(join(out, 'ascii.json'), JSON.stringify({ cell: 8, widths }));
console.log(`fontgen: ${Object.keys(GLYPHS).length} glyphs`);
