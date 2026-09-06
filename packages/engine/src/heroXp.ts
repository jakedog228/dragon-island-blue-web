const HERO_LEVEL_POWER = 1.2999999523162842;


export function heroXpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error(`hero level must be a positive integer; got ${level}`);
  }
  if (level === 1) return 0;
  return Math.trunc(level * Math.pow(level, HERO_LEVEL_POWER) * 1.7);
}


export function heroLevelForXp(totalHighestLevels: number): number {
  if (!Number.isSafeInteger(totalHighestLevels) || totalHighestLevels < 0) {
    throw new Error(`hero highest-level sum must be a non-negative safe integer; got ${totalHighestLevels}`);
  }
  let low = 1;
  let high = 2;
  while (heroXpForLevel(high) < totalHighestLevels) {
    low = high;
    high *= 2;
    if (!Number.isSafeInteger(high)) throw new Error("hero level search overflow");
  }
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (heroXpForLevel(middle) < totalHighestLevels) low = middle;
    else high = middle;
  }
  return low;
}


export function heroXpPercent(level: number, totalHighestLevels: number): number {
  if (heroLevelForXp(totalHighestLevels) !== level) {
    throw new Error(
      `hero highest-level sum ${totalHighestLevels} is outside level ${level}'s ` +
      `(${heroXpForLevel(level)}, ${heroXpForLevel(level + 1)}] interval`,
    );
  }
  const start = heroXpForLevel(level);
  return (totalHighestLevels - start) / (heroXpForLevel(level + 1) - start);
}
