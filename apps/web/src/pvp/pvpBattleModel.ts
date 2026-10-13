import type { BattleSession, PlayerChoice } from "@dib/engine";
import { screenPointsForMode, type DisplayMode } from "../displayMode.js";
import type { PvpErrorV1, PvpMatchViewV1 } from "@dib/game-protocol";

export function pvpRulesMismatch(logicPackId: string, match: PvpMatchViewV1): PvpErrorV1 | undefined {
  if (match.logicPackId === logicPackId) return undefined;
  return { code: "INCOMPATIBLE", message: "This match uses different rules from your currently selected content package.",
    issues: [{ code: "CONTENT_MISMATCH", path: "setup.logicPackId", message: "Replaying this match with the current package would produce different battle state.",
      suggestion: "Reopen the content package used to start this match, or forfeit/cancel it before starting a new match." }] };
}

/** New PvP UI, entirely winSize-relative. These dimensions make no source-fidelity claim. */
export function pvpLayout(mode: DisplayMode) {
  const { w, h } = screenPointsForMode(mode);
  return { w, h, margin: w * 0.025, titleFont: h * 0.045, font: h * 0.034,
    buttonH: h * 0.082, top: h * 0.13, rowH: h * 0.235, controlsY: h * 0.735,
    monsterW: w * 0.19, monsterH: h * 0.155, cellW: w * 0.2325,
    tournamentButton: { x: w * 0.025, y: h * 0.045, font: h * 0.05 },
  };
}
export interface PvpTargetRequirement { enemies: readonly string[]; friends: readonly string[]; enemyCount: number; friendCount: number }
export function pvpTargets(session: BattleSession, actorId: string, choice: PlayerChoice): PvpTargetRequirement {
  const own = session.teamOf(actorId);
  const friends = session.targetableIdsOf(own);
  const enemies = session.targetableIdsOf(own === 0 ? 1 : 0);
  const t = choice.targeting;
  return { friends, enemies,
    enemyCount: t.kind === "enemies" ? Math.min(t.count, enemies.length) : t.kind === "mixed" ? Math.min(t.allEnemies ? enemies.length : t.enemyCount, enemies.length) : 0,
    friendCount: t.kind === "friends" ? Math.min(t.count, friends.length) : t.kind === "mixed" ? Math.min(t.allFriends ? friends.length : t.friendlyCount, friends.length) : 0,
  };
}
export function pvpChosenTargets(requirement: PvpTargetRequirement, selected: readonly string[]): string[] | undefined {
  if (new Set(selected).size !== selected.length) return undefined;
  const enemies = selected.filter((id) => requirement.enemies.includes(id));
  const friends = selected.filter((id) => requirement.friends.includes(id));
  if (enemies.length + friends.length !== selected.length || enemies.length !== requirement.enemyCount || friends.length !== requirement.friendCount) return undefined;
  return [...enemies, ...friends];
}
