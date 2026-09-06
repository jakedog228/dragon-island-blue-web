import type { BattleExitOutcome } from "../battle/battleNode.js";

export type ArenaExitDisposition = "victory" | "defeat" | "sourceEscapeStall";

/**
 * `ArenaEncounter` has no `combatRetreatFinished:` override. Utility.Escape still reaches
 * Encounter state 6, but the inherited callback is a no-op: the generic Retreat/lost-captures
 * presentation tears the battle display down and no owner navigation follows.
 *
 * Keep that source bug explicit instead of letting a broad non-victory branch turn it into the
 * unrelated Arena loss path. `saveMe` is impossible because ArenaEncounter blocks it.
 */
export function arenaExitDisposition(outcome: BattleExitOutcome): ArenaExitDisposition {
  if (outcome === "victory") return "victory";
  if (outcome === "defeat") return "defeat";
  if (outcome === "retreat") return "sourceEscapeStall";
  throw new Error("Arena challenges block Save Me and cannot restart");
}
