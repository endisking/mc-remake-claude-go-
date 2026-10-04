import { describe, it, expect } from 'vitest';
import { endSkyVertices } from './endsky';
import { endFogColor } from '../world/dimension';

describe('End sky', () => {
  it('is a closed cube of six 200×200 faces at distance 100, 16 texture repeats each', () => {
    const v = endSkyVertices();
    expect(v.length).toBe(36 * 5);
    const faces = new Set<string>();
    for (let f = 0; f < 6; f++) {
      const pts = Array.from({ length: 6 }, (_, i) => Array.from(v.subarray((f * 6 + i) * 5, (f * 6 + i) * 5 + 5)));
      // one coordinate is ±100 on every vertex of the face
      const axis = [0, 1, 2].find((a) => pts.every((p) => Math.abs(Math.abs(p[a]!) - 100) < 1e-6 && Math.sign(p[a]!) === Math.sign(pts[0]![a]!)))!;
      expect(axis).toBeDefined();
      faces.add(`${axis}${Math.sign(pts[0]![axis]!)}`);
      for (const p of pts) {
        for (let a = 0; a < 3; a++) expect(Math.abs(Math.abs(p[a]!) - 100)).toBeLessThan(1e-6);
        expect([0, 16]).toContain(p[3]);
        expect([0, 16]).toContain(p[4]);
      }
    }
    expect(faces.size).toBe(6);
  });

  it('fog is the End biome fog colour × 0.15, pulled toward black by render distance', () => {
    const out: [number, number, number] = [0, 0, 0];
    endFogColor(64, 12, out);
    expect(Math.round(out[0] * 255)).toBe(20);
    expect(Math.round(out[1] * 255)).toBe(16);
    expect(Math.round(out[2] * 255)).toBe(20);
    // the void fade below y 32
    endFogColor(16, 12, out);
    expect(out[0] * 255).toBeCloseTo(20.49 / 4, 1);
  });
});
