/** Vanilla Mth helpers whose float rounding matters (sin/cos lookup table, floor). */
const SIN = new Float32Array(65536);
for (let i = 0; i < 65536; i++) SIN[i] = Math.sin((i * Math.PI * 2) / 65536);
const f = Math.fround;
const K = f(10430.378);

/** Mth.sin: SIN[(int)(x × 10430.378F) & 65535] */
export function mthSin(x: number): number {
  return SIN[Math.trunc(f(f(x) * K)) & 65535]!;
}

/** Mth.cos: SIN[(int)(x × 10430.378F + 16384.0F) & 65535] */
export function mthCos(x: number): number {
  return SIN[Math.trunc(f(f(f(x) * K) + 16384)) & 65535]!;
}

export const F_PI = f(Math.PI);
