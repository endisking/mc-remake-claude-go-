/**
 * Block colour tints (vanilla BlockColors equivalent): which tint source each block's
 * tintindex 0 uses.
 */
import { BLOCKS } from '@shared/data';

export const TINT_NONE = 0;
export const TINT_GRASS = 1;
export const TINT_FOLIAGE = 2;
export const TINT_WATER = 3;
export const TINT_CONST = 4;
export const TINT_REDSTONE = 5;
export const TINT_STEM = 6;

/** Per block id: tint kind. */
export const TINT_KIND = new Uint8Array(BLOCKS.length);
/** Per block id: constant colour for TINT_CONST. */
export const TINT_CONST_COLOR = new Uint32Array(BLOCKS.length);

const GRASS = ['grass_block', 'grass', 'tall_grass', 'fern', 'large_fern', 'potted_fern', 'sugar_cane'];
const FOLIAGE = ['oak_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'vine'];
// Fixed leaf colours (vanilla FoliageColor constants, facts from the game data).
const CONST: Record<string, number> = {
  spruce_leaves: 0x619961,
  birch_leaves: 0x80a755,
  lily_pad: 0x208030,
  attached_melon_stem: 0xe0c71c,
  attached_pumpkin_stem: 0xe0c71c,
};

for (const b of BLOCKS) {
  if (GRASS.includes(b.name)) TINT_KIND[b.id] = TINT_GRASS;
  else if (FOLIAGE.includes(b.name)) TINT_KIND[b.id] = TINT_FOLIAGE;
  else if (b.name === 'water' || b.name === 'bubble_column' || b.name === 'water_cauldron') TINT_KIND[b.id] = TINT_WATER;
  else if (b.name === 'redstone_wire') TINT_KIND[b.id] = TINT_REDSTONE;
  else if (b.name === 'melon_stem' || b.name === 'pumpkin_stem') TINT_KIND[b.id] = TINT_STEM;
  else if (CONST[b.name] !== undefined) {
    TINT_KIND[b.id] = TINT_CONST;
    TINT_CONST_COLOR[b.id] = CONST[b.name]!;
  }
}

/** Redstone wire colour by power 0..15 (vanilla formula). */
export function redstoneColor(power: number): number {
  const f = power / 15;
  const r = f * 0.6 + (f > 0 ? 0.4 : 0.3);
  const g = Math.max(0, Math.min(1, f * f * 0.7 - 0.5));
  const b = Math.max(0, Math.min(1, f * f * 0.6 - 0.7));
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

/** Stem colour by age 0..7 (vanilla formula). */
export function stemColor(age: number): number {
  const r = age * 32, g = 255 - age * 8, b = age * 4;
  return (r << 16) | (g << 8) | b;
}
