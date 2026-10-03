/** Experience levels (vanilla Player.giveExperiencePoints / giveExperienceLevels). */

export interface Experience {
  experienceLevel: number;
  experienceProgress: number;
  totalExperience: number;
  score: number;
}

/** Points needed to go from `level` to the next level. */
export function xpNeededForNextLevel(level: number): number {
  if (level >= 30) return 112 + (level - 30) * 9;
  return level >= 15 ? 37 + (level - 15) * 5 : 7 + level * 2;
}

export function giveExperienceLevels(e: Experience, levels: number): void {
  e.experienceLevel += levels;
  if (e.experienceLevel < 0) {
    e.experienceLevel = 0;
    e.experienceProgress = 0;
    e.totalExperience = 0;
  }
}

export function giveExperiencePoints(e: Experience, xp: number): void {
  e.score += xp;
  e.experienceProgress += xp / xpNeededForNextLevel(e.experienceLevel);
  e.totalExperience = Math.max(0, Math.min(0x7fffffff, e.totalExperience + xp));
  while (e.experienceProgress < 0) {
    const f = e.experienceProgress * xpNeededForNextLevel(e.experienceLevel);
    if (e.experienceLevel > 0) {
      giveExperienceLevels(e, -1);
      e.experienceProgress = 1 + f / xpNeededForNextLevel(e.experienceLevel);
    } else {
      giveExperienceLevels(e, -1);
      e.experienceProgress = 0;
    }
  }
  while (e.experienceProgress >= 1) {
    e.experienceProgress = (e.experienceProgress - 1) * xpNeededForNextLevel(e.experienceLevel);
    giveExperienceLevels(e, 1);
    e.experienceProgress /= xpNeededForNextLevel(e.experienceLevel);
  }
}

/** XP dropped on death (Player.getExperienceReward): 7 per level, at most 100. */
export function deathExperience(level: number): number {
  return Math.min(100, level * 7);
}
