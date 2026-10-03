/**
 * Block textures as a WebGL2 2D texture array (one layer per texture, 16×16), with
 * alpha-aware CPU mipmaps and animated textures (frame strips updated per game tick).
 * PNGs in /textures/overrides/ replace generated textures of the same name.
 */
import overrideNames from 'virtual:texture-overrides';
import type { TextureManifest } from './blockmodels';

const SIZE = 16;

interface Animated {
  layer: number;
  frames: Uint8Array[][]; // [frame][mipLevel] pixel data
  frametime: number;
  current: number;
}

export async function loadManifest(base = './textures/'): Promise<TextureManifest> {
  const r = await fetch(`${base}blocks.json`);
  return (await r.json()) as TextureManifest;
}

async function imagePixels(url: string): Promise<{ w: number; h: number; data: Uint8ClampedArray } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
  } catch {
    return null;
  }
}

/** Box-filter mip chain; colour is alpha-weighted so transparent texels don't darken edges. */
export function mipChain(base: Uint8Array, levels: number): Uint8Array[] {
  const out = [base];
  let size = SIZE, src = base;
  for (let l = 1; l <= levels; l++) {
    const ns = size >> 1;
    const dst = new Uint8Array(ns * ns * 4);
    for (let y = 0; y < ns; y++)
      for (let x = 0; x < ns; x++) {
        let r = 0, g = 0, b = 0, a = 0, cr = 0, cg = 0, cb = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const i = ((y * 2 + dy) * size + (x * 2 + dx)) * 4;
            const al = src[i + 3]!;
            r += src[i]! * al; g += src[i + 1]! * al; b += src[i + 2]! * al; a += al;
            cr += src[i]!; cg += src[i + 1]!; cb += src[i + 2]!;
          }
        const o = (y * ns + x) * 4;
        if (a > 0) {
          dst[o] = r / a; dst[o + 1] = g / a; dst[o + 2] = b / a;
        } else {
          dst[o] = cr / 4; dst[o + 1] = cg / 4; dst[o + 2] = cb / 4;
        }
        dst[o + 3] = a / 4;
      }
    out.push(dst);
    src = dst;
    size = ns;
  }
  return out;
}

export class BlockTextureArray {
  readonly tex: WebGLTexture;
  readonly layers: number;
  private animated: Animated[] = [];
  readonly mipLevels: number;

  private constructor(
    private gl: WebGL2RenderingContext,
    layers: number,
    mipLevels: number,
  ) {
    this.layers = layers;
    this.mipLevels = mipLevels;
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, mipLevels + 1, gl.RGBA8, SIZE, SIZE, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, mipLevels > 0 ? gl.NEAREST_MIPMAP_LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, mipLevels);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  static async load(gl: WebGL2RenderingContext, manifest: TextureManifest, mipLevels: number, base = './textures/'): Promise<BlockTextureArray> {
    const atlas = await imagePixels(`${base}blocks_atlas.png`);
    if (!atlas) throw new Error('missing blocks_atlas.png — run pnpm texgen');
    const arr = new BlockTextureArray(gl, manifest.textures.length, mipLevels);
    const overrides = new Set(overrideNames);
    let row = 0;
    for (let layer = 0; layer < manifest.textures.length; layer++) {
      const t = manifest.textures[layer]!;
      let frames: Uint8Array[] = [];
      for (let f = 0; f < t.frames; f++) {
        const start = (row + f) * SIZE * SIZE * 4;
        frames.push(new Uint8Array(atlas.data.buffer.slice(start, start + SIZE * SIZE * 4)));
      }
      row += t.frames;
      if (overrides.has(`${t.name}.png`)) {
        const o = await imagePixels(`${base}overrides/${t.name}.png`);
        if (o && o.w === SIZE && o.h % SIZE === 0) {
          frames = [];
          for (let f = 0; f < o.h / SIZE; f++) frames.push(new Uint8Array(o.data.buffer.slice(f * 1024, f * 1024 + 1024)));
        }
      }
      const chains = frames.map((fr) => mipChain(fr, mipLevels));
      arr.upload(layer, chains[0]!);
      if (chains.length > 1) arr.animated.push({ layer, frames: chains, frametime: t.frametime ?? 1, current: 0 });
    }
    return arr;
  }

  private upload(layer: number, chain: Uint8Array[]): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    for (let l = 0; l < chain.length; l++) {
      const s = SIZE >> l;
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, l, 0, 0, layer, s, s, 1, gl.RGBA, gl.UNSIGNED_BYTE, chain[l]!);
    }
  }

  /** Advance animations; call once per game tick with the client tick counter. */
  tick(ticks: number): void {
    for (const a of this.animated) {
      const f = Math.floor(ticks / a.frametime) % a.frames.length;
      if (f !== a.current) {
        a.current = f;
        this.upload(a.layer, a.frames[f]!);
      }
    }
  }
}
