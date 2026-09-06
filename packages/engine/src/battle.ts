


import type { GameData } from "@dib/gamedata";
import type { Rng } from "./rng.js";
import { assignAbility, type AiDecision } from "./ai.js";
import { BattleCore } from "./core.js";
import type { BattleReport, TeamMemberSetup } from "./events.js";

export class HeadlessBattle {
  private readonly core: BattleCore;
  private readonly data: GameData;
  private readonly rng: Rng;
  private hasRun = false;

  constructor(
    data: GameData,
    teams: [TeamMemberSetup[], TeamMemberSetup[]],
    rng: Rng,
    opts?: { fightingGroupSize?: number; blockCapture?: boolean },
  ) {
    this.core = new BattleCore(data, teams, rng, opts);
    this.data = data;
    this.rng = rng;
  }

  /**
   * Runs the whole battle under `assignAbility` AI for both teams. `decide` optionally overrides
   * the decision for any actor (return undefined to fall through to the AI) — the same injection
   * seam as `BattleCore.resolveTurn`, used by scripted scenarios and by the maxTurns-guard tests
   * (under the corrected slot>=1 AI gate no shipped roster can stalemate on its own: every job
   * leaf in the corpus has at least one positive-aiChance usable ability).
   */
  runToCompletion(maxTurns = 1000, decide?: (actorId: string) => AiDecision | undefined): BattleReport {
    if (this.hasRun) throw new Error("HeadlessBattle.runToCompletion: a battle instance may only be run once");
    this.hasRun = true;
    this.core.seedAndStart();

    let turn = 0;
    while (this.core.winner === undefined) {
      turn++;
      if (turn > maxTurns) {
        throw new Error(
          `HeadlessBattle.runToCompletion: exceeded maxTurns=${maxTurns} without resolving — a non-terminating battle is a bug`,
        );
      }
      this.core.skipDeadFront();
      this.core.resolveTurn(
        (actorId) => decide?.(actorId) ?? assignAbility(actorId, this.core.aiWorld, this.data, this.rng),
      );
    }

    return this.core.report();
  }
}
