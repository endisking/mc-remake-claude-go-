/**
 * App icons for the installable web app (client/public/icons/icon-{192,512}.png): the grass block
 * side texture scaled up with nearest-neighbour filtering on a dark rounded tile.
 * Usage: pnpm tsx tools/pwa-icons.ts
 */
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const src = PNG.sync.read(readFileSync(`${root}client/public/textures/block/grass_block_side.png`));
mkdirSync(`${root}client/public/icons`, { recursive: true });
for (const size of [192, 512]) {
  const png = new PNG({ width: size, height: size });
  const pad = Math.round(size * 0.14), inner = size - 2 * pad, radius = size * 0.18;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded background tile
      const cx = Math.min(Math.max(x, radius), size - radius), cy = Math.min(Math.max(y, radius), size - radius);
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
      let c = inside ? [0x3b, 0x2c, 0x22, 255] : [0, 0, 0, 0];
      if (x >= pad && x < pad + inner && y >= pad && y < pad + inner) {
        const sx = Math.floor(((x - pad) / inner) * src.width), sy = Math.floor(((y - pad) / inner) * src.height);
        const j = (sy * src.width + sx) * 4;
        if (src.data[j + 3]! > 0) c = [src.data[j]!, src.data[j + 1]!, src.data[j + 2]!, 255];
      }
      png.data.set(c, i);
    }
  writeFileSync(`${root}client/public/icons/icon-${size}.png`, PNG.sync.write(png));
}
console.log('icons → client/public/icons');
