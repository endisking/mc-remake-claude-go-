/** Day/night helpers shared by client and server (vanilla DimensionType / Level). */

/** Vanilla celestial angle (DimensionType.timeOfDay) for a day time in ticks. */
export function timeOfDay(dayTime: number): number {
  const d = ((dayTime / 24000) % 1 + 1) % 1 - 0.25;
  const frac = d < 0 ? d + 1 : d;
  const e = 0.5 - Math.cos(frac * Math.PI) / 2;
  return (frac * 2 + e) / 3;
}

// Mth.sin/cos use a 65536-entry float table; gameplay thresholds depend on its rounding
const SIN = new Float32Array(65536);
for (let i = 0; i < 65536; i++) SIN[i] = Math.sin((i * Math.PI * 2) / 65536);
const f = Math.fround;
/** Mth.cos (table lookup, float precision). */
export function mthCos(x: number): number {
  return SIN[(Math.trunc(f(f(x) * f(10430.378)) + 16384) | 0) & 65535]!;
}
/** Mth.sin (table lookup, float precision). */
export function mthSin(x: number): number {
  return SIN[(Math.trunc(f(f(x) * f(10430.378))) | 0) & 65535]!;
}

/** DimensionType.timeOfDay as the float vanilla stores. */
function timeOfDayF(dayTime: number): number {
  const d0 = (((dayTime / 24000 - 0.25) % 1) + 1) % 1;
  const d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
  return f(f(d0 * 2 + d1) / 3);
}

/**
 * Level.updateSkyBrightness: the integer sky darkening (0 = full day … 11), which reduces
 * sky light for gameplay (sleeping, mob spawning). `thunder` is thunderLevel × rainLevel.
 */
export function skyDarkenLevel(dayTime: number, rain: number, thunder: number): number {
  const d0 = 1 - (rain * 5) / 16;
  const d1 = 1 - (thunder * 5) / 16;
  const d2 = 0.5 + 2 * Math.max(-0.25, Math.min(0.25, mthCos(f(timeOfDayF(dayTime) * f(Math.PI * 2)))));
  return Math.floor((1 - d2 * d0 * d1) * 11);
}

/** Level.isDay (overworld): you can only sleep when this is false. */
export function isDay(dayTime: number, rain: number, thunder: number): boolean {
  return skyDarkenLevel(dayTime, rain, thunder) < 4;
}
