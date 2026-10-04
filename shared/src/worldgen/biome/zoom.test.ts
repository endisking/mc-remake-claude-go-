import { describe, it, expect } from 'vitest';
import { obfuscateSeed, zoomToQuart, zoomToQuartReference } from './zoom';

describe('biome zoom', () => {
  it('the allocation-free zoom matches the reference LCG implementation', () => {
    for (const seed of [20211n, -4172144997902289642n, 1n]) {
      const sha = obfuscateSeed(seed);
      const a: [number, number] = [0, 0], b: [number, number] = [0, 0];
      for (let n = 0; n < 4000; n++) {
        const x = ((n * 7919) % 20000) - 10000, z = ((n * 104729) % 20000) - 10000;
        zoomToQuart(sha, x, z, a);
        zoomToQuartReference(sha, x, z, b);
        expect(a).toEqual(b);
      }
    }
  });
});
