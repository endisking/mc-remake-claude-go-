import { describe, it, expect } from 'vitest';
import { isDay, skyDarkenLevel } from './daylight';

describe('daylight', () => {
  it('beds work from tick 12542 to 23459 in clear weather (vanilla wiki)', () => {
    expect(isDay(12541, 0, 0)).toBe(true);
    expect(isDay(12542, 0, 0)).toBe(false);
    expect(isDay(23459, 0, 0)).toBe(false);
    expect(isDay(23460, 0, 0)).toBe(true);
  });
  it('thunderstorms allow sleeping during the day; rain alone does not', () => {
    expect(isDay(6000, 1, 0)).toBe(true);
    expect(isDay(6000, 1, 1)).toBe(false);
    expect(skyDarkenLevel(6000, 0, 0)).toBe(0);
    expect(skyDarkenLevel(18000, 0, 0)).toBe(11);
  });
});
