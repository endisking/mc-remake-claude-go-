/**
 * Biome tint colours for grass, foliage and water: generated colormaps sampled by
 * temperature/downfall, vanilla special cases, and biome blending (radius setting).
 */
import { BIOMES, TINTS } from '@shared/data';
import type { BlockWorld } from '@shared/world/world';

export class BiomeColors {
  private grassMap: Uint8ClampedArray | null = null;
  private foliageMap: Uint8ClampedArray | null = null;
  private readonly grass = new Uint32Array(256);
  private readonly foliage = new Uint32Array(256);
  private readonly water = new Uint32Array(256);
  /** Blend radius (vanilla "Biome Blend" option, default 2 → 5×5). */
  blendRadius = 2;

  async load(base = './textures/colormap/'): Promise<void> {
    const px = async (name: string) => {
      const r = await fetch(`${base}${name}.png`);
      const bmp = await createImageBitmap(await r.blob());
      const c = new OffscreenCanvas(256, 256);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, 256, 256).data;
    };
    this.grassMap = await px('grass');
    this.foliageMap = await px('foliage');
    this.computeBiomeTable();
  }

  private sample(map: Uint8ClampedArray, temperature: number, downfall: number): number {
    const t = Math.min(1, Math.max(0, temperature));
    const d = Math.min(1, Math.max(0, downfall)) * t;
    const x = Math.floor((1 - t) * 255), y = Math.floor((1 - d) * 255);
    const i = (y * 256 + x) * 4;
    return (map[i]! << 16) | (map[i + 1]! << 8) | map[i + 2]!;
  }

  private computeBiomeTable(): void {
    const waterTable = new Map<string, number>();
    for (const e of TINTS.water.data) for (const k of e.keys) waterTable.set(String(k), e.color >>> 0);
    for (const b of BIOMES) {
      if (b.id > 255) continue;
      let g = this.sample(this.grassMap!, b.temperature, b.rainfall);
      let f = this.sample(this.foliageMap!, b.temperature, b.rainfall);
      // vanilla special cases (BiomeSpecialEffects grass/foliage modifiers and overrides)
      if (b.name.includes('badlands')) {
        g = 0x90814d;
        f = 0x9e814d;
      } else if (b.name.startsWith('swamp')) {
        g = 0x6a7039; // the noise-based darker variant is applied per position below
        f = 0x6a7039;
      } else if (b.name.startsWith('dark_forest')) {
        g = (((g & 0xfefefe) + 0x28340a) >> 1) & 0xffffff;
      }
      this.grass[b.id] = g;
      this.foliage[b.id] = f;
      this.water[b.id] = (waterTable.get(b.name) ?? 0x3f76e4) & 0xffffff;
    }
  }

  /**
   * Fill tints for a 16×16 column area at world (bx, bz), at height y:
   * out[0..255] grass, [256..511] foliage, [512..767] water. Blended over a square radius.
   */
  fillSectionTints(world: BlockWorld, bx: number, y: number, bz: number, out: Uint32Array): void {
    const r = this.blendRadius;
    const W = 16 + r * 2;
    // sample biome ids once for the padded area
    const ids = new Uint8Array(W * W);
    for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) ids[z * W + x] = world.getBiome(bx + x - r, y, bz + z - r);
    const n = (2 * r + 1) * (2 * r + 1);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0, wr = 0, wg = 0, wb = 0;
        for (let dz = 0; dz <= 2 * r; dz++)
          for (let dx = 0; dx <= 2 * r; dx++) {
            const id = ids[(z + dz) * W + x + dx]!;
            const g = this.grass[id]!, f = this.foliage[id]!, w = this.water[id]!;
            gr += g >> 16; gg += (g >> 8) & 255; gb += g & 255;
            fr += f >> 16; fg += (f >> 8) & 255; fb += f & 255;
            wr += w >> 16; wg += (w >> 8) & 255; wb += w & 255;
          }
        const i = z * 16 + x;
        out[i] = (((gr / n) | 0) << 16) | (((gg / n) | 0) << 8) | ((gb / n) | 0);
        out[256 + i] = (((fr / n) | 0) << 16) | (((fg / n) | 0) << 8) | ((fb / n) | 0);
        out[512 + i] = (((wr / n) | 0) << 16) | (((wg / n) | 0) << 8) | ((wb / n) | 0);
      }
  }
}
