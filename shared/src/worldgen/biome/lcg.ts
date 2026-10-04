/**
 * The layer system's 64-bit linear congruential seed mixing (vanilla LinearCongruentialGenerator)
 * without BigInt: a 64-bit value is a pair (hi: int32, lo: uint32). The hot functions write their
 * result to module registers (H, L) to avoid allocating.
 */

/** low/high 32 bits of 6364136223846793005 and 1442695040888963407 */
const M_HI = 0x5851f42d, M_LO = 0x4c957f2d;
const A_HI = 0x14057b7e, A_LO = 0xf767814f;

/** result registers of the last operation */
export let H = 0;
export let L = 0;

/** High 32 bits of the unsigned 64-bit product of two uint32. */
function mulhi(a: number, b: number): number {
  const a0 = a & 0xffff, a1 = a >>> 16, b0 = b & 0xffff, b1 = b >>> 16;
  const t = a0 * b0;
  const m1 = a1 * b0 + (t >>> 16);
  const m2 = a0 * b1 + (m1 & 0xffff);
  return (a1 * b1 + Math.floor(m1 / 65536) + Math.floor(m2 / 65536)) | 0;
}

/** (ah:al) × (bh:bl) mod 2^64 → H, L */
function mul(ah: number, al: number, bh: number, bl: number): void {
  const lo = Math.imul(al, bl) >>> 0;
  H = (mulhi(al >>> 0, bl >>> 0) + Math.imul(ah, bl) + Math.imul(al, bh)) | 0;
  L = lo;
}

/** (ah:al) + (bh:bl) mod 2^64 → H, L */
function add(ah: number, al: number, bh: number, bl: number): void {
  const lo = (al >>> 0) + (bl >>> 0);
  L = lo >>> 0;
  H = (ah + bh + (lo > 0xffffffff ? 1 : 0)) | 0;
}

/** LinearCongruentialGenerator.next(s, salt) = s × (s × M + A) + salt → H, L */
export function step(sh: number, sl: number, th: number, tl: number): void {
  mul(sh, sl, M_HI, M_LO);
  add(H, L, A_HI, A_LO);
  mul(sh, sl, H, L);
  add(H, L, th, tl);
}

/** step with a small signed int salt (a coordinate) */
export function stepInt(sh: number, sl: number, v: number): void {
  step(sh, sl, v < 0 ? -1 : 0, v >>> 0);
}

/** Math.floorMod(s >> 24, bound) for the 64-bit s = (h:l) */
export function floorModShift24(h: number, l: number, bound: number): number {
  const v = (h | 0) * 256 + (l >>> 24);
  const r = v % bound;
  return r < 0 ? r + bound : r;
}

export function splitBig(v: bigint): [number, number] {
  const u = BigInt.asUintN(64, v);
  return [Number(BigInt.asIntN(32, u >> 32n)), Number(u & 0xffffffffn)];
}

export function joinBig(h: number, l: number): bigint {
  return BigInt.asIntN(64, (BigInt(h) << 32n) | BigInt(l >>> 0));
}
