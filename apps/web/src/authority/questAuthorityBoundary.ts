import type { GuildQuestEvent } from "@dib/engine";

export interface LocalGuildQuestEventOption {
  readonly onQuestEvent?: (event: GuildQuestEvent) => void;
}

/**
 * BattleNode emits source semantic quest events for local simulation. In Official mode the same
 * mutation is already reduced and returned by the command service, so installing this callback
 * would apply progress and enqueue its presentation twice before projection adoption reconverges.
 */
export function localGuildQuestEventOption(
  authorityActive: boolean,
  dispatch: (event: GuildQuestEvent) => void,
): LocalGuildQuestEventOption {
  return authorityActive ? {} : { onQuestEvent: dispatch };
}
