/**
 * 2D GUI layer: a canvas over the 3D view, drawn in scaled GUI pixels (vanilla GUI scale),
 * with sprite sheets and the bitmap font.
 */

export interface Sprite {
  img: CanvasImageSource;
  sx: number;
  sy: number;
  w: number;
  h: number;
}

export class BitmapFont {
  private tinted = new Map<number, HTMLCanvasElement>();
  readonly lineHeight = 9;
  constructor(
    private sheet: HTMLImageElement | ImageBitmap,
    private widths: number[],
  ) {}

  static async load(base = './textures/font/'): Promise<BitmapFont> {
    const [img, meta] = await Promise.all([
      createImageBitmap(await (await fetch(`${base}ascii.png`)).blob()),
      (await fetch(`${base}ascii.json`)).json() as Promise<{ widths: number[] }>,
    ]);
    return new BitmapFont(img, meta.widths);
  }

  charWidth(ch: string): number {
    const c = ch.charCodeAt(0);
    const w = c < 256 ? this.widths[c] ?? 0 : 0;
    return (w || 5) + 1;
  }

  width(s: string): number {
    let w = 0;
    for (const ch of stripFormatting(s)) w += this.charWidth(ch);
    return w;
  }

  private sheetFor(color: number): HTMLCanvasElement {
    let c = this.tinted.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.sheet, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
    ctx.fillRect(0, 0, 128, 128);
    this.tinted.set(color, c);
    return c;
  }

  /** Draw text at GUI coordinates; supports § colour codes. Returns the end x. */
  draw(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color = 0xffffff, shadow = true): number {
    if (shadow) this.drawRun(ctx, s, x + 1, y + 1, color, true);
    return this.drawRun(ctx, s, x, y, color, false);
  }

  private drawRun(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, base: number, isShadow: boolean): number {
    let color = base;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (ch === '§' && i + 1 < s.length) {
        const code = s[++i]!.toLowerCase();
        const idx = '0123456789abcdef'.indexOf(code);
        if (idx >= 0) color = FORMAT_COLORS[idx]!;
        else if (code === 'r') color = base;
        continue;
      }
      const c = ch.charCodeAt(0);
      if (c !== 32 && c < 256) {
        const sheet = this.sheetFor(isShadow ? (color & 0xfcfcfc) >> 2 : color);
        ctx.drawImage(sheet, (c % 16) * 8, Math.floor(c / 16) * 8, 8, 8, x, y, 8, 8);
      }
      x += this.charWidth(ch);
    }
    return x;
  }
}

/** Vanilla chat formatting colours §0–§f. */
export const FORMAT_COLORS = [
  0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xffaa00, 0xaaaaaa,
  0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
];

export function stripFormatting(s: string): string {
  return s.replace(/§./g, '');
}

export class Gui {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Current scale factor (screen pixels per GUI pixel). */
  scale = 2;
  /** Size in GUI pixels. */
  width = 0;
  height = 0;
  font!: BitmapFont;
  widgets!: ImageBitmap;
  background!: ImageBitmap;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  async load(): Promise<void> {
    const img = async (u: string) => createImageBitmap(await (await fetch(u)).blob());
    [this.font, this.widgets, this.background] = await Promise.all([
      BitmapFont.load(),
      img('./textures/gui/widgets.png'),
      img('./textures/gui/options_background.png'),
    ]);
  }

  /** Vanilla auto GUI scale: largest scale keeping at least 320×240 GUI pixels (capped by the option). */
  static computeScale(w: number, h: number, setting: number): number {
    let i = 1;
    while (i !== setting && i < w && i < h && w / (i + 1) >= 320 && h / (i + 1) >= 240) i++;
    return i;
  }

  /** Resize to the window and prepare a frame. */
  begin(guiScaleSetting: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.scale = Gui.computeScale(w, h, guiScaleSetting);
    this.width = Math.ceil(w / this.scale);
    this.height = Math.ceil(h / this.scale);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  /** CSS colour strings by ARGB, so HUD fills don't build a string every call every frame */
  private readonly fillStyles = new Map<number, string>();

  fill(x: number, y: number, w: number, h: number, argb: number): void {
    let style = this.fillStyles.get(argb);
    if (style === undefined) {
      const a = ((argb >>> 24) & 255) / 255;
      style = `rgba(${(argb >> 16) & 255},${(argb >> 8) & 255},${argb & 255},${a})`;
      if (this.fillStyles.size > 512) this.fillStyles.clear();
      this.fillStyles.set(argb, style);
    }
    this.ctx.fillStyle = style;
    this.ctx.fillRect(x, y, w, h);
  }

  text(s: string, x: number, y: number, color = 0xffffff, shadow = true): number {
    return this.font.draw(this.ctx, s, x, y, color, shadow);
  }

  centeredText(s: string, cx: number, y: number, color = 0xffffff): void {
    this.font.draw(this.ctx, s, Math.round(cx - this.font.width(s) / 2), y, color, true);
  }

  blit(img: CanvasImageSource, sx: number, sy: number, w: number, h: number, x: number, y: number, dw = w, dh = h): void {
    this.ctx.drawImage(img, sx, sy, w, h, x, y, dw, dh);
  }

  /** Draw a 200×20 button sprite stretched to width w (left part + right 2px cap, like vanilla). */
  button(x: number, y: number, w: number, h: number, state: 0 | 1 | 2): void {
    const sy = state * 20;
    const half = Math.floor(w / 2);
    this.blit(this.widgets, 0, sy, half, h, x, y);
    this.blit(this.widgets, 200 - (w - half), sy, w - half, h, x + half, y);
  }

  /** Dark tiled background for option screens (vanilla renderDirtBackground). */
  dirtBackground(): void {
    const ctx = this.ctx;
    const tile = 32;
    for (let y = 0; y < this.height; y += tile) for (let x = 0; x < this.width; x += tile) ctx.drawImage(this.background, 0, 0, 16, 16, x, y, tile, tile);
    this.fill(0, 0, this.width, this.height, 0x80000000);
  }

  /** Translucent gradient over the world (vanilla in-game screen background). */
  worldBackground(): void {
    const g = this.ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, 'rgba(16,16,16,0.75)');
    g.addColorStop(1, 'rgba(16,16,16,0.82)');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }
}
