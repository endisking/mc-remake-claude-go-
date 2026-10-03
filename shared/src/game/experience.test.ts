import { describe, it, expect } from 'vitest';
import { giveExperiencePoints, xpNeededForNextLevel, deathExperience } from './experience';

const fresh = () => ({ experienceLevel: 0, experienceProgress: 0, totalExperience: 0, score: 0 });

describe('experience', () => {
  it('level costs follow the 1.17 formula', () => {
    expect(xpNeededForNextLevel(0)).toBe(7);
    expect(xpNeededForNextLevel(15)).toBe(37);
    expect(xpNeededForNextLevel(30)).toBe(112);
  });
  it('1395 points reach level 30 exactly', () => {
    const e = fresh();
    giveExperiencePoints(e, 1395);
    expect(e.experienceLevel).toBe(30);
    expect(e.experienceProgress).toBeCloseTo(0, 5);
    expect(e.totalExperience).toBe(1395);
  });
  it('partial progress and level 7 at 91 points (vanilla table)', () => {
    const e = fresh();
    giveExperiencePoints(e, 10);
    expect(e.experienceLevel).toBe(1);
    expect(e.experienceProgress).toBeCloseTo(3 / 9);
    const f = fresh();
    giveExperiencePoints(f, 91);
    expect(f.experienceLevel).toBe(7);
  });
  it('death drops 7 per level up to 100', () => {
    expect(deathExperience(3)).toBe(21);
    expect(deathExperience(30)).toBe(100);
  });
});
