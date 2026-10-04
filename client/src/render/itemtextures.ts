/**
 * Item sprites (textures/items_atlas.png + items.json from tools/texgen/items): a 2D canvas
 * atlas for GUI icons and a WebGL2 texture array (one 16×16 layer per sprite) for extruded
 * 3D item models. PNGs in /textures/overrides/item/<name>.png replace generated sprites.
 */
import overrideNames from 'virtual:texture-overrides';

export interface ItemManifest {
  columns: number;
  size: number;
  textures: { name: string; handheld?: boolean | 'rod' }[];
}

const SIZE = 16;

async function bitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    return null;
  }
}

export class ItemTextures {
  /** GUI atlas: sprite i at ((i % columns)·16, ⌊i / columns⌋·16). Overrides already applied. */
  readonly canvas: HTMLCanvasElement;
  readonly columns: number;
  private index = new Map<string, number>();
  private handheldBy: (boolean | 'rod' | undefined)[] = [];
  /** alpha of each sprite (16×16), for extrusion */
  readonly alpha: Uint8Array[] = [];
  private pixels: Uint8ClampedArray;
  private tex: WebGLTexture | null = null;

  private constructor(manifest: ItemManifest, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.columns = manifest.columns;
    manifest.textures.forEach((t, i) => {
      this.index.set(t.name, i);
      this.handheldBy[i] = t.handheld;
    });
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < manifest.textures.length; i++) {
      const a = new Uint8Array(SIZE * SIZE);
      const [sx, sy] = this.cell(i);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) a[y * SIZE + x] = this.pixels[((sy + y) * canvas.width + sx + x) * 4 + 3]!;
      this.alpha.push(a);
    }
  }

  static async load(base = './textures/'): Promise<ItemTextures> {
    let manifest: ItemManifest = { columns: 32, size: 16, textures: [] };
    try {
      const r = await fetch(`${base}items.json`);
      if (r.ok) manifest = (await r.json()) as ItemManifest;
    } catch {
      /* no item sprites generated: everything falls back to block icons / missing */
    }
    const rows = Math.max(1, Math.ceil(manifest.textures.length / manifest.columns));
    const canvas = document.createElement('canvas');
    canvas.width = manifest.columns * SIZE;
    canvas.height = rows * SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const atlas = manifest.textures.length ? await bitmap(`${base}items_atlas.png`) : null;
    if (atlas) ctx.drawImage(atlas, 0, 0);
    const overrides = new Set(overrideNames);
    await Promise.all(
      manifest.textures.map(async (t, i) => {
        if (!overrides.has(`item/${t.name}.png`)) return;
        const o = await bitmap(`${base}overrides/item/${t.name}.png`);
        if (!o || o.width !== SIZE || o.height < SIZE) return;
        const x = (i % manifest.columns) * SIZE, y = Math.floor(i / manifest.columns) * SIZE;
        ctx.clearRect(x, y, SIZE, SIZE);
        ctx.drawImage(o, 0, 0, SIZE, SIZE, x, y, SIZE, SIZE);
      }),
    );
    return new ItemTextures(manifest, canvas);
  }

  get count(): number {
    return this.alpha.length;
  }

  /** Sprite index of a texture name, or −1. */
  layer(name: string): number {
    return this.index.get(name) ?? -1;
  }

  handheld(layer: number): boolean | 'rod' {
    return this.handheldBy[layer] ?? false;
  }

  /** Top-left pixel of a sprite in the GUI atlas. */
  cell(layer: number): [number, number] {
    return [(layer % this.columns) * SIZE, Math.floor(layer / this.columns) * SIZE];
  }

  /** The sprites as a TEXTURE_2D_ARRAY (created on first use; nearest filtering, no mips). */
  texture(gl: WebGL2RenderingContext): WebGLTexture {
    if (this.tex) return this.tex;
    const n = Math.max(1, this.count);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, SIZE, SIZE, n);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const buf = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < this.count; i++) {
      const [sx, sy] = this.cell(i);
      for (let y = 0; y < SIZE; y++) buf.set(this.pixels.subarray(((sy + y) * this.canvas.width + sx) * 4, ((sy + y) * this.canvas.width + sx + SIZE) * 4), y * SIZE * 4);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, SIZE, SIZE, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    }
    this.tex = tex;
    return tex;
  }
}
