import type { BattleReplaySnapshotV1, TeamMemberSetup } from "@dib/engine";
import type { BattleTeamMemberSetup, EncounterConfig } from "./encounter.js";

/**
 * Official battle mechanics come exclusively from the committed replay. The locally constructed
 * encounter may be ahead of an older server record (or behind a freshly migrated one), so it is
 * retained only as a source of archive-local presentation overrides for the same type in the same
 * construction slot.
 */
export function officialEncounterRoster(
  encounter: EncounterConfig,
  replay: BattleReplaySnapshotV1,
): EncounterConfig {
  return {
    ...encounter,
    playerTeam: alignTeam(encounter.playerTeam, replay.teams[0]),
    enemyTeam: alignTeam(encounter.enemyTeam, replay.teams[1]),
  };
}

function alignTeam(
  local: readonly BattleTeamMemberSetup[],
  committed: readonly TeamMemberSetup[],
): BattleTeamMemberSetup[] {
  return committed.map((setup, index) => {
    const authoritative = structuredClone(setup) as BattleTeamMemberSetup;
    const presentation = local[index];
    if (presentation?.shortType !== setup.shortType) return authoritative;
    return {
      ...authoritative,
      ...(presentation.displayName === undefined
        ? {}
        : { displayName: presentation.displayName }),
      ...(presentation.rendererData === undefined
        ? {}
        : { rendererData: structuredClone(presentation.rendererData) }),
    };
  });
}
