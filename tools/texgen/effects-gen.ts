/** Writes only the Phase 7 GUI textures (`npx tsx tools/texgen/effects-gen.ts`); gen.ts writes them too. */
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mobEffects, effectFrames, glint, enchantingTable } from './effects';
import type { Tex } from './lib';

const out = join(import.meta.dirname, '../../client/public/textures');
const write = (file: string, t: Tex) => {
  const png = new PNG({ width: t.w, height: t.h });
  png.data = Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength);
  writeFileSync(file, PNG.sync.write(png));
};
mkdirSync(join(out, 'gui'), { recursive: true });
mkdirSync(join(out, 'misc'), { recursive: true });
write(join(out, 'gui', 'mob_effects.png'), mobEffects());
write(join(out, 'gui', 'effect_frames.png'), effectFrames());
write(join(out, 'gui', 'enchanting_table.png'), enchantingTable());
write(join(out, 'misc', 'enchanted_item_glint.png'), glint());
