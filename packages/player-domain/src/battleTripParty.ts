// Narrow party mutation port shared by both authority modes.
import type { WorldTripParty } from "@dib/engine";

/** Narrow mutation/read surface a battle needs from durable party state. Keeping this structural
 * lets PlayerRuntimeState wrap commands that also update collection history without exposing the
 * full player aggregate to presentation code. */
export type BattleTripParty = Pick<
  WorldTripParty,
  | "battingOrderSize"
  | "battingOrderLength"
  | "battingOrderMonsters"
  | "monsters"
  | "monster"
  | "commitBattleSnapshot"
  | "addCapturedMonster"
  | "awardXp"
  | "evolve"
>;
