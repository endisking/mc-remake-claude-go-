/**
 * Deterministic random number generators.
 *
 * JavaRandom reproduces java.util.Random's 48-bit linear congruential generator
 * (a public, documented algorithm) so world generation can follow the same
 * sequences the 1.17.1 generator design relies on. Implemented with BigInt-free
 * 24-bit limb arithmetic for speed.
 */

const MULT_HI = 0x5de; // 0x5DEECE66D = 0x5DE * 2^24 + 0xECE66D
const MULT_LO = 0xece66d;
const ADD = 0xb;
const TWO24 = 0x1000000;
const MASK24 = 0xffffff;

export class JavaRandom {
  private hi = 0; // upper 24 bits of the 48-bit seed
  private lo = 0; // lower 24 bits
  private nextNextGaussian = 0;
  private haveNextNextGaussian = false;

  constructor(seed: number | bigint = Date.now()) {
    this.setSeed(seed);
  }

  /** Seed with a 64-bit value (number or bigint); only the low 48 bits are used after scrambling. */
  setSeed(seed: number | bigint): void {
    const s = (BigInt.asUintN(64, BigInt(seed)) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
    this.hi = Number(s >> 24n);
    this.lo = Number(s & 0xffffffn);
    this.haveNextNextGaussian = false;
  }

  /** Raw access to the 48-bit state, as [hi24, lo24]. */
  getState(): [number, number] {
    return [this.hi, this.lo];
  }

  /** seed = (seed * 0x5DEECE66D + 0xB) mod 2^48, computed in 24-bit limbs (both stay small ints). */
  private advance(): void {
    // (Math.imul gives the low 32 bits of a product exactly, enough for the low 24-bit limb)
    const lo = this.lo, hi = this.hi;
    const carry = Math.floor((lo * MULT_LO + ADD) / TWO24); // product < 2^48: exact
    this.lo = (Math.imul(lo, MULT_LO) + ADD) & MASK24;
    this.hi = (Math.imul(hi, MULT_LO) + Math.imul(lo, MULT_HI) + carry) & MASK24;
  }

  next(bits: number): number {
    this.advance();
    const p0lo = this.lo, p1 = this.hi;
    // result = seed >>> (48 - bits), as a signed 32-bit int
    if (bits <= 24) return p1 >>> (24 - bits);
    if (bits === 32) return ((p1 << 8) | (p0lo >>> 16)) | 0;
    return p1 * (1 << (bits - 24)) + (p0lo >>> (48 - bits));
  }

  nextInt(bound?: number): number {
    if (bound === undefined) return this.next(32);
    if (bound <= 0) throw new Error('bound must be positive');
    // next(31) computed inline (p1 << 7 | lo >>> 17): a 31-bit result returned from next() would
    // be boxed as a heap number on every call; locals here stay unboxed
    if ((bound & -bound) === bound) {
      // (bound * next(31)) >> 31 for a power-of-two bound
      this.advance();
      return Math.floor(((this.hi << 7) | (this.lo >>> 17)) / (2147483648 / bound));
    }
    let bits: number, val: number;
    do {
      this.advance();
      bits = (this.hi << 7) | (this.lo >>> 17);
      val = bits % bound;
    } while (bits - val + (bound - 1) >= 2147483648);
    return val;
  }

  nextLong(): bigint {
    const a = BigInt(this.next(32));
    const b = BigInt(this.next(32));
    return BigInt.asIntN(64, (a << 32n) + b);
  }

  nextBoolean(): boolean {
    return this.next(1) !== 0;
  }

  nextFloat(): number {
    return this.next(24) / TWO24;
  }

  nextDouble(): number {
    return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992;
  }

  nextGaussian(): number {
    if (this.haveNextNextGaussian) {
      this.haveNextNextGaussian = false;
      return this.nextNextGaussian;
    }
    let v1: number, v2: number, s: number;
    do {
      v1 = 2 * this.nextDouble() - 1;
      v2 = 2 * this.nextDouble() - 1;
      s = v1 * v1 + v2 * v2;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.nextNextGaussian = v2 * m;
    this.haveNextNextGaussian = true;
    return v1 * m;
  }

  /** Advance the generator n steps (equivalent to calling next(32) n times). */
  skip(n: number): void {
    for (let i = 0; i < n; i++) this.next(32);
  }
}

/** Small fast PRNG (mulberry32) for non-worldgen randomness (particles, sound variants). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 64-bit seed the way Java's String.hashCode does (for text seeds). */
export function javaStringHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
