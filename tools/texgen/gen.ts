/**
 * Texture generator entry point: writes every block texture as a PNG to
 * client/public/textures/block/, plus a packed atlas strip and manifest the client loads.
 *
 * Run: pnpm texgen
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Tex } from './lib';
import type { TexDef } from './registry';
import { terrainTextures } from './blocks/terrain';
import { floraTextures } from './blocks/flora';
import { miscTextures } from './blocks/misc';
import { bedTextures } from './blocks/beds';
import { animatedTextures } from './blocks/animated';
import { grassColormap, foliageColormap } from './colormap';
import { widgets, optionsBackground, icons, spectatorWidgets } from './gui';
import { allSkins } from './skins';
import { allArmorTextures } from './armor';
import { mobEffects } from './effects';
import { writeItemTextures } from './items';
import { sun, moonPhases, clouds, rain, snowflakes, destroyStages, underwater, experienceOrbs, powderSnowOutline } from './environment';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'client', 'public', 'textures');
const blockDir = join(outDir, 'block');
mkdirSync(blockDir, { recursive: true });
mkdirSync(join(outDir, 'overrides'), { recursive: true });
mkdirSync(join(outDir, 'colormap'), { recursive: true });

export function writePng(file: string, t: Tex): void {
  const png = new PNG({ width: t.w, height: t.h });
  png.data = Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength);
  writeFileSync(file, PNG.sync.write(png));
}

export const ALL_BLOCK_TEXTURES: TexDef[] = [
  ...terrainTextures,
  ...floraTextures,
  ...miscTextures,
  ...bedTextures,
  ...animatedTextures,
  ...destroyStages().map((t, i): TexDef => ({ name: `destroy_stage_${i}`, make: () => t, cutout: true })),
];

function main(): void {
  const seen = new Set<string>();
  const entries: { name: string; frames: number; frametime?: number; interpolate?: boolean; tint?: string; cutout?: boolean; translucent?: boolean }[] = [];
  const images: Tex[] = [];
  for (const def of ALL_BLOCK_TEXTURES) {
    if (seen.has(def.name)) throw new Error(`duplicate texture ${def.name}`);
    seen.add(def.name);
    const t = def.make();
    if (t.w !== 16 || t.h % 16 !== 0) throw new Error(`${def.name}: textures must be 16 wide and a multiple of 16 tall`);
    writePng(join(blockDir, `${def.name}.png`), t);
    images.push(t);
    entries.push({
      name: def.name,
      frames: t.h / 16,
      ...(def.frametime ? { frametime: def.frametime } : {}),
      ...(def.interpolate ? { interpolate: true } : {}),
      ...(def.tint ? { tint: def.tint } : {}),
      ...(def.cutout ? { cutout: true } : {}),
      ...(def.translucent ? { translucent: true } : {}),
    });
  }
  // packed atlas: all frames of all textures stacked vertically (16 × 16·N)
  const totalFrames = images.reduce((n, t) => n + t.h / 16, 0);
  const atlas = new Tex(16, 16 * totalFrames);
  let y = 0;
  for (const t of images) {
    atlas.over(t, 0, y);
    y += t.h;
  }
  writePng(join(outDir, 'blocks_atlas.png'), atlas);
  writeFileSync(join(outDir, 'blocks.json'), JSON.stringify({ textures: entries }, null, 1));
  writePng(join(outDir, 'colormap', 'grass.png'), grassColormap());
  writePng(join(outDir, 'colormap', 'foliage.png'), foliageColormap());
  mkdirSync(join(outDir, 'environment'), { recursive: true });
  writePng(join(outDir, 'environment', 'sun.png'), sun());
  writePng(join(outDir, 'environment', 'moon_phases.png'), moonPhases());
  writePng(join(outDir, 'environment', 'clouds.png'), clouds());
  writePng(join(outDir, 'environment', 'rain.png'), rain());
  mkdirSync(join(outDir, 'gui'), { recursive: true });
  writePng(join(outDir, 'gui', 'widgets.png'), widgets());
  writePng(join(outDir, 'gui', 'options_background.png'), optionsBackground());
  writePng(join(outDir, 'gui', 'icons.png'), icons());
  writePng(join(outDir, 'gui', 'spectator_widgets.png'), spectatorWidgets());
  writePng(join(outDir, 'gui', 'mob_effects.png'), mobEffects());
  mkdirSync(join(outDir, 'skins'), { recursive: true });
  const skins = allSkins();
  for (const sk of skins) writePng(join(outDir, 'skins', `${sk.name}.png`), sk.tex);
  writeFileSync(join(outDir, 'skins', 'skins.json'), JSON.stringify(skins.map((s) => s.name)));
  writePng(join(outDir, 'environment', 'snow.png'), snowflakes());
  writePng(join(outDir, 'environment', 'underwater.png'), underwater());
  writePng(join(outDir, 'environment', 'powder_snow_outline.png'), powderSnowOutline());
  mkdirSync(join(outDir, 'entity'), { recursive: true });
  writePng(join(outDir, 'entity', 'experience_orb.png'), experienceOrbs());
  mkdirSync(join(outDir, 'entity', 'armor'), { recursive: true });
  for (const a of allArmorTextures()) writePng(join(outDir, 'entity', 'armor', `${a.name}.png`), a.tex);
  const itemCount = writeItemTextures(outDir);
  const overrides = existsSync(join(outDir, 'overrides')) ? readdirSync(join(outDir, 'overrides')).filter((f) => f.endsWith('.png')) : [];
  console.log(`texgen: ${entries.length} textures (${totalFrames} frames), ${itemCount} item sprites, ${overrides.length} overrides present`);
}

main();
