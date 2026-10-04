import { describe, it, expect } from 'vitest';
import { loadingProgress } from './loadingscreen';
import { applyQueryOverrides, DEFAULT_SETTINGS } from '../settings';

describe('loading terrain progress', () => {
  it('is half received chunks (radius 2), half meshed columns (radius 1)', () => {
    const received = new Set<string>(), meshed = new Set<string>();
    const host = {
      center: (): [number, number] => [10, -3],
      received: (x: number, z: number) => received.has(`${x},${z}`),
      meshed: (x: number, z: number) => meshed.has(`${x},${z}`),
    };
    expect(loadingProgress(host)).toBe(0);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) received.add(`${10 + dx},${-3 + dz}`);
    expect(loadingProgress(host)).toBe(0.5);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) meshed.add(`${10 + dx},${-3 + dz}`);
    expect(loadingProgress(host)).toBe(1);
    // chunks outside the radii don't count
    received.add('20,20');
    expect(loadingProgress(host)).toBe(1);
  });
});

describe('video settings', () => {
  it('?fps=-1 (old VSync encoding) means VSync with no cap; ?fps=0 unlimited without VSync', () => {
    const v = applyQueryOverrides({ ...DEFAULT_SETTINGS }, new URLSearchParams('fps=-1'));
    expect(v.vsync).toBe(true);
    expect(v.maxFps).toBe(0);
    const u = applyQueryOverrides({ ...DEFAULT_SETTINGS }, new URLSearchParams('fps=0'));
    expect(u.vsync).toBe(false);
    expect(u.maxFps).toBe(0);
    expect(applyQueryOverrides({ ...DEFAULT_SETTINGS }, new URLSearchParams('fps=60')).maxFps).toBe(60);
    expect(applyQueryOverrides({ ...DEFAULT_SETTINGS }, new URLSearchParams('scale=0.1')).renderScale).toBe(0.25);
  });
});
