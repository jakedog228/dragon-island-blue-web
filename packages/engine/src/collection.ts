import type { CollectionGoalDefinition } from "@dib/gamedata/browser";

export interface CollectionGoalProgress {
  readonly goalId: string;
  readonly owned: number;
  readonly total: number;
  readonly percentComplete: number;
  readonly complete: boolean;
  readonly claimed: boolean;
}

/** Native `UserSavedData.properties` identity written by Collection claim settlement. */
export function collectionClaimId(goal: CollectionGoalDefinition): string {
  return `CollectionQuest${goal.key}`;
}


export function collectionGoalProgress(
  goal: CollectionGoalDefinition,
  highestCapturedLevel: (shortType: string) => number,
  claimedGoalIds: ReadonlySet<string>,
): CollectionGoalProgress {
  let owned = 0;
  for (const shortType of goal.monsterTypes) {
    const level = highestCapturedLevel(shortType);
    if (!Number.isSafeInteger(level) || level < 0) {
      throw new Error(
        `collectionGoalProgress: invalid highest captured level ${String(level)} for ${shortType}`,
      );
    }
    if (level !== 0) owned += 1;
  }

  const total = goal.monsterTypes.length;
  const percentComplete = total === 0 || owned === total
    ? 100
    : owned === 0
      ? 0
      : Math.max(1, Math.min(99, Math.round(Math.fround(
          Math.fround(Math.fround(owned) / Math.fround(total)) * Math.fround(100),
        ))));
  const goalId = collectionClaimId(goal);
  return Object.freeze({
    goalId,
    owned,
    total,
    percentComplete,
    complete: percentComplete === 100,
    claimed: claimedGoalIds.has(goalId),
  });
}
