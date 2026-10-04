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
import { hasFoil } from '@shared/game/enchantments';
import { isPotionItem, potionColor } from '@shared/game/potions';
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

// ------------------------------------------------------------------ potion colours
const potionCache = new Map<string, HTMLCanvasElement>();

/**
 * Potion bottles: the liquid (baked in the water-bottle blue) is recoloured with the potion's
 * colour (PotionUtils.getColor, the item colour of layer 0 in vanilla), keeping its shading.
 */
function drawPotionIcon(g: Gui, stack: ItemStack, x: number, y: number): void {
  if (typeof document === 'undefined') return drawItemIcon(g, stack.id, x, y);
  const color = potionColor(stack);
  const key = `${stack.id}:${color}`;
  let c = potionCache.get(key);
  if (!c) {
    c = Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    drawItemIcon({ blit: (img: CanvasImageSource, sx: number, sy: number, w: number, h: number, dx: number, dy: number, dw = w, dh = h) => ctx.drawImage(img, sx, sy, w, h, dx, dy, dw, dh), fill: () => {} } as unknown as Gui, stack.id, 0, 0);
    const im = ctx.getImageData(0, 0, 16, 16), d = im.data;
    const base = 0.3 * 0x38 + 0.59 * 0x5d + 0.11 * 0xc6;
    const cr = (color >> 16) & 255, cg = (color >> 8) & 255, cb = color & 255;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]!, gg = d[i + 1]!, b = d[i + 2]!;
      if (d[i + 3]! < 128 || !(b > r + 40 && b > gg + 25)) continue; // only the blue liquid
      const k = (0.3 * r + 0.59 * gg + 0.11 * b) / base;
      d[i] = Math.min(255, cr * k);
      d[i + 1] = Math.min(255, cg * k);
      d[i + 2] = Math.min(255, cb * k);
    }
    ctx.putImageData(im, 0, 0);
    if (potionCache.size > 256) potionCache.clear();
    potionCache.set(key, c);
  }
  g.ctx.drawImage(c, x, y);
}

// ------------------------------------------------------------------ enchantment glint
let glintImg: HTMLImageElement | null = null;
let glintMask: HTMLCanvasElement | null = null;
let glintLayer: HTMLCanvasElement | null = null;

/**
 * ItemRenderer foil: the scrolling glint texture, masked to the icon's opaque pixels and added
 * on top (vanilla GLINT render type: additive, scrolling with time, rotated 10°).
 */
export function drawGlint(g: Gui, itemId: number, x: number, y: number, now = performance.now()): void {
  if (typeof document === 'undefined') return;
  if (!glintImg) {
    glintImg = new Image();
    glintImg.src = './textures/misc/enchanted_item_glint.png';
  }
  if (!glintImg.complete || glintImg.naturalWidth === 0) return;
  glintMask ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
  glintLayer ??= Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
  const mctx = glintMask.getContext('2d')!, lctx = glintLayer.getContext('2d')!;
  mctx.imageSmoothingEnabled = false;
  lctx.imageSmoothingEnabled = false;
  mctx.clearRect(0, 0, 16, 16);
  drawItemIcon({ blit: (img: CanvasImageSource, sx: number, sy: number, w: number, h: number, dx: number, dy: number, dw = w, dh = h) => mctx.drawImage(img, sx, sy, w, h, dx - x, dy - y, dw, dh), fill: () => {} } as unknown as Gui, itemId, x, y);
  // RenderStateShard.setupGlintTexturing: offsets cycle every 110 s / 30 s of (millis × 8)
  const t = now * 8;
  // the 64 px pattern is shrunk to one icon (GUI glint texture scale) and tiled while it scrolls
  const T = 24;
  const fx = ((t % 110000) / 110000) * T, fy = ((t % 30000) / 30000) * T;
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, 16, 16);
  lctx.save();
  lctx.rotate((10 * Math.PI) / 180);
  for (let ox = -2 * T; ox <= 2 * T; ox += T) for (let oy = -2 * T; oy <= 2 * T; oy += T) lctx.drawImage(glintImg, Math.floor(-fx + ox), Math.floor(fy + oy), T, T);
  lctx.restore();
  lctx.globalCompositeOperation = 'destination-in';
  lctx.drawImage(glintMask, 0, 0);
  const ctx = g.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.8;
  ctx.drawImage(glintLayer, x, y);
  ctx.restore();
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
 * (or `countText` instead, e.g. for drag-split previews). `pop` (popTime − partial, > 0 just
 * after a pickup) squashes the icon like vanilla Gui.renderSlot.
 */
export function drawItemStack(g: Gui, stack: ItemStack | null | undefined, x: number, y: number, countText?: string, pop = 0): void {
  if (!stack || stack.count <= 0) return;
  if (pop > 0) {
    const f1 = 1 + pop / 5;
    g.ctx.save();
    g.ctx.translate(x + 8, y + 12);
    g.ctx.scale(1 / f1, (f1 + 1) / 2);
    g.ctx.translate(-(x + 8), -(y + 12));
    drawItemIcon(g, stack.id, x, y);
    g.ctx.restore();
  } else if (stack.tag?.Potion !== undefined && isPotionItem(stack.id)) drawPotionIcon(g, stack, x, y);
  else drawItemIcon(g, stack.id, x, y);
  if (hasFoil(stack)) drawGlint(g, stack.id, x, y);
  const max = ITEMS_BY_ID[stack.id]?.maxDurability ?? 0;
  if (max > 0 && stack.damage > 0) {
    g.fill(x + 2, y + 13, 13, 2, 0xff000000);
    g.fill(x + 2, y + 13, durabilityWidth(stack.damage, max), 1, 0xff000000 | durabilityColor(stack.damage, max));
  }
  const s = countText ?? (stack.count !== 1 ? String(stack.count) : '');
  if (s) g.text(s, x + 19 - 2 - g.font.width(s), y + 6 + 3, 0xffffff, true);
}
