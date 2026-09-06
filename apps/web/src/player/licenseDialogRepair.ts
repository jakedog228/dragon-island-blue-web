import { buildLicenseChallengeEncounter } from "@dib/engine";
import type { GameData } from "@dib/gamedata/browser";
import {
  PLAYER_LICENSE_ORDER,
  type PlayerLicenseType,
} from "@dib/player-domain";

/**
 * A native save cannot hold an earned license without the preceding challenge's win chat:
 * `BattleNode` records the `ChatGameFlowEvent` before presenting it, then awards the license.
 * Early port saves violated that ordering by presenting the chat without persisting it. Return
 * the source-implied records so those already-created saves can be repaired at load.
 */
export function earnedLicenseWinDialogs(
  data: GameData,
  currentLicense: PlayerLicenseType,
): readonly string[] {
  const ordinal = PLAYER_LICENSE_ORDER.indexOf(currentLicense);
  if (ordinal < 0) throw new Error(`Unknown player license ${currentLicense}`);
  const dialogs: string[] = [];
  for (let index = 1; index <= ordinal; index += 1) {
    const type = PLAYER_LICENSE_ORDER[index]!;
    const winChat = buildLicenseChallengeEncounter(data.license(type)).winChatKey;
    if (winChat !== undefined) dialogs.push(winChat);
  }
  return Object.freeze(dialogs);
}
