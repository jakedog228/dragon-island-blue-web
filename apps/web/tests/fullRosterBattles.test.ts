// The user-facing acceptance sweep for the full move-diversity pass: EVERY random 9v9 sample
// from the complete monster roster must play to a terminal state with no fail-loud throw — no
// UnimplementedComponentError, no unimplemented-mechanic guard, no crash in any monster's kit.
// This drives the REAL BattleSession loop (player turns auto-piloted with the simplest valid
// choice) over seeded rosterSampler draws, exactly the composition path a real page load takes.

import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { BattleSession, mulberry32, type PlayerChoice, type Targeting } from "@dib/engine";
import { RANDOM_TEAM_SIZE, rosterRng, sampleEncounter } from "../src/battle/rosterSampler.js";
import { DEMO_FEATURE_ROLLS } from "../src/battle/encounter.js";

const gd = loadGameData();

/** Deterministic minimal auto-player: first unblocked choice, first-N valid targets. */
function autoTargets(session: BattleSession, actorId: string, targeting: Targeting): string[] {
  const enemies = session.activeIdsOf(1).filter((id) => id !== actorId);
  const friends = session.activeIdsOf(0);
  switch (targeting.kind) {
    case "self":
    case "allEnemies":
    case "allFriends":
      return [];
    case "enemies":
      return enemies.slice(0, Math.min(targeting.count, enemies.length));
    case "friends":
      return friends.slice(0, Math.min(targeting.count, friends.length));
    case "mixed": {
      const enemyN = targeting.allEnemies ? enemies.length : Math.min(targeting.enemyCount, enemies.length);
      const friendN = targeting.allFriends ? friends.length : Math.min(targeting.friendlyCount, friends.length);
      return [...enemies.slice(0, enemyN), ...friends.slice(0, friendN)];
    }
  }
}

function pickChoice(choices: PlayerChoice[]): PlayerChoice | undefined {
  return choices.find((c) => c.blockReason === undefined);
}

describe("full-roster 9v9 battles (acceptance sweep for the move-diversity pass)", () => {
  it("30 seeded random rosters all run to a terminal state without any fail-loud throw", () => {
    let wins = 0;
    let losses = 0;
    let retreats = 0;
    for (let seed = 0; seed < 30; seed++) {
      // The demo composition path (see main.ts) — opt into the boss / soul-stone feature rolls so
      // those kits get real exercise in the sweep.
      const enc = sampleEncounter(gd, rosterRng(seed), { featureRolls: DEMO_FEATURE_ROLLS });
      expect(enc.playerTeam).toHaveLength(RANDOM_TEAM_SIZE);
      const session = new BattleSession(
        gd,
        [enc.playerTeam, enc.enemyTeam],
        mulberry32(0xd1b0 + seed),
        { silver: 10_000 }, // funded so MoneySlap's silverSpent path gets real exercise
      );

      let terminal: "won" | "lost" | "retreated" | undefined;
      for (let turn = 0; turn < 4000; turn++) {
        const step = session.advance();
        if (step.type === "ended") {
          terminal = step.report.winner === 0 ? "won" : "lost";
          break;
        }
        if (session.retreated) {
          terminal = "retreated"; // an auto-picked Utility.Escape ended the battle mid-submit
          break;
        }
        if (step.type === "awaitingPlayer") {
          const choice = pickChoice(step.choices);
          if (!choice) {
            session.submitDelayAction(); // every usable blocked (bench-gated kits) — pass the turn
            continue;
          }
          session.submitPlayerAction(choice.slot, autoTargets(session, step.actorId, choice.targeting));
          if (session.retreated) {
            terminal = "retreated";
            break;
          }
        }
      }
      if (terminal === undefined) throw new Error(`seed ${seed}: battle did not terminate in 4000 steps`);
      if (terminal === "won") wins++;
      else if (terminal === "lost") losses++;
      else retreats++;
    }
    // Sanity that the sweep exercised real variety, not one degenerate outcome 30 times.
    expect(wins + losses + retreats).toBe(30);
    expect(wins).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
  }, 120_000);
});
