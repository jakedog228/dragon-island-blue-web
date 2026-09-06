import { DungeonSnapshotCompatibilityError } from "@dib/engine";
import type { PlayerGameStateSnapshot } from "../player/gameState.js";

export interface LocalDungeonSaveRecovery {
  readonly state: PlayerGameStateSnapshot;
  readonly detail: string;
}


export function recoverIncompatibleLocalDungeonSave(
  state: PlayerGameStateSnapshot,
  error: unknown,
): LocalDungeonSaveRecovery | undefined {
  if (!(error instanceof DungeonSnapshotCompatibilityError) || state.dungeon === undefined) {
    return undefined;
  }
  const {
    dungeon: _dungeon,
    pendingBattleRewardKeys: _pendingBattleRewardKeys,
    ...preserved
  } = state;
  return Object.freeze({
    state: Object.freeze(preserved) as PlayerGameStateSnapshot,
    detail: error.message,
  });
}
