export type WorldBattleCompletedOutcome = "victory" | "retreat" | "saveMe";







export function worldBattleReturnsToOriginTown(
  outcome: WorldBattleCompletedOutcome,
  originIsTown: boolean,
): boolean {
  return originIsTown && (
    outcome === "victory" || outcome === "retreat" || outcome === "saveMe"
  );
}
