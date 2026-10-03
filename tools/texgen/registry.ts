import type { Tex } from './lib';

export interface TexDef {
  name: string;
  make: () => Tex;
  /** Ticks per animation frame (vertical strips). */
  frametime?: number;
  interpolate?: boolean;
  /** Grayscale texture meant to be tinted per biome. */
  tint?: 'grass' | 'foliage' | 'water';
  cutout?: boolean;
  translucent?: boolean;
}
