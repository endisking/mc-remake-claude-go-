/**
 * Contact sheet of item sprites at 6× zoom on a checker background, for reviewing art.
 * Run: pnpm tsx tools/texgen/items/preview.ts [nameRegex] [out.png]
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { ALL_ITEM_TEXTURES } from './index';

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const defs = ALL_ITEM_TEXTURES.filter((d) => !filter || filter.test(d.name));
const Z = 6, C = 12, cell = 16 * Z + 6;
const rows = Math.max(1, Math.ceil(defs.length / C));
const png = new PNG({ width: C * cell, height: rows * cell });
for (let i = 0; i < png.data.length; i += 4) {
  png.data[i] = 60;
  png.data[i + 1] = 66;
  png.data[i + 2] = 76;
  png.data[i + 3] = 255;
}
defs.forEach((d, i) => {
  const t = d.make();
  const ox = (i % C) * cell + 3, oy = Math.floor(i / C) * cell + 3;
  for (let y = 0; y < 16 * Z; y++)
    for (let x = 0; x < 16 * Z; x++) {
      const c = t.get(Math.floor(x / Z), Math.floor(y / Z));
      const chk = ((x >> 3) + (y >> 3)) & 1 ? 150 : 120;
      const a = c[3] / 255;
      const o = ((oy + y) * png.width + ox + x) * 4;
      png.data[o] = c[0] * a + chk * (1 - a);
      png.data[o + 1] = c[1] * a + chk * (1 - a);
      png.data[o + 2] = c[2] * a + chk * (1 - a);
    }
});
writeFileSync(process.argv[3] ?? 'item-sheet.png', PNG.sync.write(png));
console.log(defs.map((d, i) => `${i}:${d.name}`).join(' '));
