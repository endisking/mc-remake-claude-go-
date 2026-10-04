/**
 * Item icons in the 2D GUI (vanilla ItemRenderer.renderGuiItem + renderGuiItemDecorations).
 *
 * Use from any screen:
 *   drawItemIcon(gui, itemId, x, y)          — the 16×16 icon only
 *   drawItemStack(gui, stack, x, y)          — icon, durability bar and stack count
 *
 * Items with their own sprite (tools, food, ingots, doors, …) are blitted from the item atlas;
 * other block items use the 3D isometric block icon rendered by the game's BlockItemRenderer
 * (vanilla GUI transform: rotate [30, 225, 0], scale 0.625); anything else draws the
 * magenta/black missing texture. The game installs the backend once at startup.
 */
import { ITEMS_BY_ID } from '@shared/data';
import type { ItemStack } from '@shared/item/stack';
import type { Gui } from './gui';
import type { ItemTextures } from '../render/itemtextures';

export interface ItemIconBackend {
  sprites: ItemTextures;
  /** GUI icon of a block item: [image, sx, sy, size] in a square cell, or null. */
  blockIcon(itemId: number): [CanvasImageSource, number, number, number] | null;
}

/**
 * Animated item state, updated by the game every frame: compass needle frame (0–31, 0 =
 * pointing up/ahead) and clock dial frame (0–63, 0 = noon).
 */
export const itemAnim = { compass: 0, clock: 0 };

let backend: ItemIconBackend | null = null;
const spriteCache = new Map<number, number>();

export function setItemIconBackend(b: ItemIconBackend): void {
  backend = b;
  spriteCache.clear();
}

export function itemIconBackend(): ItemIconBackend | null {
  return backend;
}

/** Sprite texture name for an item (vanilla model overrides for compass/clock use the current frame). */
export function itemSpriteName(itemId: number): string {
  const name = ITEMS_BY_ID[itemId]?.name ?? 'air';
  if (name === 'compass') return `compass_${String(itemAnim.compass & 31).padStart(2, '0')}`;
  if (name === 'clock') return `clock_${String(itemAnim.clock & 63).padStart(2, '0')}`;
  return name;
}

/** Sprite layer (index into the item atlas/texture array) for an item, or −1 if it has none. */
export function spriteLayerFor(sprites: ItemTextures, itemId: number): number {
  const name = ITEMS_BY_ID[itemId]?.name;
  if (name === 'compass' || name === 'clock') return sprites.layer(itemSpriteName(itemId));
  let l = spriteCache.get(itemId);
  if (l === undefined) {
    l = name ? sprites.layer(name) : -1;
    spriteCache.set(itemId, l);
  }
  return l;
}

/** Draw a 16×16 item icon at GUI coordinates. */
export function drawItemIcon(g: Gui, itemId: number, x: number, y: number): void {
  if (backend) {
    const l = spriteLayerFor(backend.sprites, itemId);
    if (l >= 0) {
      const [sx, sy] = backend.sprites.cell(l);
      g.blit(backend.sprites.canvas, sx, sy, 16, 16, x, y, 16, 16);
      return;
    }
    const icon = backend.blockIcon(itemId);
    if (icon) {
      g.blit(icon[0], icon[1], icon[2], icon[3], icon[3], x, y, 16, 16);
      return;
    }
  }
  // missing texture: magenta/black checker like vanilla's
  g.fill(x, y, 8, 8, 0xfff800f8);
  g.fill(x + 8, y + 8, 8, 8, 0xfff800f8);
  g.fill(x + 8, y, 8, 8, 0xff000000);
  g.fill(x, y + 8, 8, 8, 0xff000000);
}

/** Vanilla durability bar colour: hue from green (full) to red (broken). */
export function durabilityColor(damage: number, max: number): number {
  const f = Math.max(0, (max - damage) / max);
  const h = f / 3; // 0..1/3
  // HSV → RGB with s = v = 1
  const i = Math.floor(h * 6), fr = h * 6 - i, q = 1 - fr;
  const [r, gg, b] = i === 0 ? [1, fr, 0] : i === 1 ? [q, 1, 0] : [0, 1, 0];
  return (Math.round(r * 255) << 16) | (Math.round(gg * 255) << 8) | Math.round(b * 255);
}

/** Durability bar width in pixels (0–13) for a damaged item. */
export function durabilityWidth(damage: number, max: number): number {
  return Math.round(13 - (damage * 13) / max);
}

/**
 * Icon plus decorations: the durability bar for damaged tools and the stack count
 * (or `countText` instead, e.g. for drag-split previews).
 */
export function drawItemStack(g: Gui, stack: ItemStack | null | undefined, x: number, y: number, countText?: string): void {
  if (!stack || stack.count <= 0) return;
  drawItemIcon(g, stack.id, x, y);
  const max = ITEMS_BY_ID[stack.id]?.maxDurability ?? 0;
  if (max > 0 && stack.damage > 0) {
    g.fill(x + 2, y + 13, 13, 2, 0xff000000);
    g.fill(x + 2, y + 13, durabilityWidth(stack.damage, max), 1, 0xff000000 | durabilityColor(stack.damage, max));
  }
  const s = countText ?? (stack.count !== 1 ? String(stack.count) : '');
  if (s) g.text(s, x + 19 - 2 - g.font.width(s), y + 6 + 3, 0xffffff, true);
}
