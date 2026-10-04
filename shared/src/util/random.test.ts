import { describe, it, expect } from 'vitest';
import { JavaRandom } from './random';

describe('JavaRandom matches java.util.Random', () => {
  it('nextInt()', () => {
    expect(new JavaRandom(0).nextInt()).toBe(-1155484576);
    expect(new JavaRandom(42).nextInt()).toBe(-1170105035);
  });
  it('nextInt(bound)', () => {
    const r = new JavaRandom(42);
    expect([r.nextInt(10), r.nextInt(10), r.nextInt(10)]).toEqual([0, 3, 8]);
    expect(new JavaRandom(0).nextInt(16)).toBe(11);
  });
  it('nextDouble / nextGaussian / nextLong', () => {
    expect(new JavaRandom(0).nextDouble()).toBeCloseTo(0.730967787376657, 14);
    expect(new JavaRandom(0).nextGaussian()).toBeCloseTo(0.8025330637390305, 14);
    expect(new JavaRandom(0).nextLong()).toBe(-4962768465676381896n);
  });
  it('next(bits) matches a BigInt reference LCG for every width', () => {
    for (let seed = -50; seed < 50; seed++) {
      const r = new JavaRandom(seed * 7919);
      let st = (BigInt.asUintN(64, BigInt(seed * 7919)) ^ 0x5deece66dn) & ((1n << 48n) - 1n);
      for (let i = 0; i < 200; i++) {
        const bits = 1 + ((i * 7 + seed + 50) % 32);
        st = (st * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n);
        expect(r.next(bits)).toBe(Number(BigInt.asIntN(32, st >> BigInt(48 - bits))));
      }
    }
  });
});
