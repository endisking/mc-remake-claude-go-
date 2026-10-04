/** Every item sprite, in atlas order, and the writer for the item atlas the client loads. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Tex } from '../lib';
import type { ItemTexDef } from './registry';
import { toolItems } from './tools';
import { materialItems } from './materials';
import { foodItems } from './food';
import { miscItems } from './misc';
import { blockItemSprites } from './blockitems';

export const ALL_ITEM_TEXTURES: ItemTexDef[] = [...toolItems, ...materialItems, ...foodItems, ...miscItems, ...blockItemSprites];

/** Columns of the packed item atlas (16 px cells). */
export const ITEM_ATLAS_COLUMNS = 32;

function png(file: string, t: Tex): void {
  const p = new PNG({ width: t.w, height: t.h });
  p.data = Buffer.from(t.data.buffer, t.data.byteOffset, t.data.byteLength);
  writeFileSync(file, PNG.sync.write(p));
}

/**
 * Write every item sprite to textures/item/<name>.png, plus the packed atlas
 * (items_atlas.png, ITEM_ATLAS_COLUMNS cells per row) and its manifest items.json.
 * PNGs in textures/overrides/item/<name>.png replace sprites at load time (client + viewer).
 */
export function writeItemTextures(outDir: string): number {
  const dir = join(outDir, 'item');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(outDir, 'overrides', 'item'), { recursive: true });
  const seen = new Set<string>();
  const rows = Math.ceil(ALL_ITEM_TEXTURES.length / ITEM_ATLAS_COLUMNS);
  const atlas = new Tex(16 * ITEM_ATLAS_COLUMNS, 16 * rows);
  const entries: { name: string; handheld?: boolean | 'rod' }[] = [];
  ALL_ITEM_TEXTURES.forEach((def, i) => {
    if (seen.has(def.name)) throw new Error(`duplicate item texture ${def.name}`);
    seen.add(def.name);
    const t = def.make();
    if (t.w !== 16 || t.h !== 16) throw new Error(`${def.name}: item textures must be 16×16`);
    png(join(dir, `${def.name}.png`), t);
    atlas.over(t, (i % ITEM_ATLAS_COLUMNS) * 16, Math.floor(i / ITEM_ATLAS_COLUMNS) * 16);
    entries.push({ name: def.name, ...(def.handheld ? { handheld: def.handheld } : {}) });
  });
  png(join(outDir, 'items_atlas.png'), atlas);
  writeFileSync(join(outDir, 'items.json'), JSON.stringify({ columns: ITEM_ATLAS_COLUMNS, size: 16, textures: entries }, null, 1));
  return entries.length;
}
