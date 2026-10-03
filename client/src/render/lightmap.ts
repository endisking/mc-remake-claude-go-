/**
 * 16×16 lightmap (sky × block light → RGB), rebuilt every frame like vanilla's light
 * texture: sky light is scaled by the sky brightness of the time of day, block light is
 * warm and flickers slightly, gamma (brightness setting) brightens dark values.
 */
export interface LightmapParams {
  /** Sky darkening factor 0.2..1 (vanilla getSkyDarken). */
  skyDarken: number;
  /** Dimension ambient light (0 overworld/end, 0.1 nether). */
  ambient: number;
  /** Brightness option 0 (moody) .. 1 (bright). */
  gamma: number;
  nightVision: number;
  /** Lightning flash: sky fully bright. */
  flash: boolean;
  /** The End uses a fixed light colour. */
  end: boolean;
}

export class Lightmap {
  readonly tex: WebGLTexture;
  private readonly data = new Uint8Array(16 * 16 * 4);
  private flicker = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Called once per game tick (vanilla updates flicker per tick). */
  tick(): void {
    this.flicker += (Math.random() - Math.random()) * Math.random() * Math.random() * 0.1;
    this.flicker *= 0.9;
  }

  update(p: LightmapParams): void {
    const sky = p.flash ? 1 : p.skyDarken * 0.95 + 0.05;
    const blockFactor = this.flicker + 1.5;
    const bright = (lvl: number) => {
      const f = lvl / 15;
      const curve = f / (4 - 3 * f);
      return p.ambient + (1 - p.ambient) * curve;
    };
    const skyTint = [p.skyDarken * 0.65 + 0.35, p.skyDarken * 0.65 + 0.35, 1];
    for (let s = 0; s < 16; s++)
      for (let b = 0; b < 16; b++) {
        const fs = bright(s) * sky;
        const fb = bright(b) * blockFactor;
        let r = fb, g = fb * ((fb * 0.6 + 0.4) * 0.6 + 0.4), bl = fb * (fb * fb * 0.6 + 0.4);
        if (p.end) {
          r = r + (0.99 - r) * 0.25;
          g = g + (1.12 - g) * 0.25;
          bl = bl + (1.0 - bl) * 0.25;
        } else {
          r += skyTint[0]! * fs;
          g += skyTint[1]! * fs;
          bl += skyTint[2]! * fs;
          r = r + (0.75 - r) * 0.04;
          g = g + (0.75 - g) * 0.04;
          bl = bl + (0.75 - bl) * 0.04;
        }
        r = Math.min(1, Math.max(0, r));
        g = Math.min(1, Math.max(0, g));
        bl = Math.min(1, Math.max(0, bl));
        if (p.nightVision > 0) {
          const m = Math.max(r, g, bl);
          if (m < 1) {
            const k = 1 / m;
            r = r + (r * k - r) * p.nightVision;
            g = g + (g * k - g) * p.nightVision;
            bl = bl + (bl * k - bl) * p.nightVision;
          }
        }
        const ng = (x: number) => 1 - Math.pow(1 - x, 4);
        r = r + (ng(r) - r) * p.gamma;
        g = g + (ng(g) - g) * p.gamma;
        bl = bl + (ng(bl) - bl) * p.gamma;
        r = r + (0.75 - r) * 0.04;
        g = g + (0.75 - g) * 0.04;
        bl = bl + (0.75 - bl) * 0.04;
        const i = (s * 16 + b) * 4;
        this.data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
        this.data[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
        this.data[i + 2] = Math.round(Math.min(1, Math.max(0, bl)) * 255);
        this.data[i + 3] = 255;
      }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
  }
}

/** Vanilla sky darkening for a time of day (0..1 fraction), rain and thunder levels. */
export function skyDarken(timeOfDay: number, rain: number, thunder: number): number {
  let f = 1 - (Math.cos(timeOfDay * Math.PI * 2) * 2 + 0.2);
  f = Math.min(1, Math.max(0, f));
  f = 1 - f;
  f *= 1 - (rain * 5) / 16;
  f *= 1 - (thunder * 5) / 16;
  return f * 0.8 + 0.2;
}

/** Vanilla celestial angle (DimensionType.timeOfDay) for a day time in ticks. */
export function timeOfDay(dayTime: number): number {
  const d = ((dayTime / 24000) % 1 + 1) % 1 - 0.25;
  const frac = d < 0 ? d + 1 : d;
  const e = 0.5 - Math.cos(frac * Math.PI) / 2;
  return (frac * 2 + e) / 3;
}
