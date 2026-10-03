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
});
