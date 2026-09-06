import { describe, it, expect } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { HeadlessBattle, mulberry32 } from "../src/index.js";
import type { TeamMemberSetup } from "../src/index.js";
import { baseStat } from "../src/stats.js";


const TEAM_A: TeamMemberSetup[] = [
  { shortType: "FireCub", level: 12 },
  { shortType: "SnowCub", level: 12 },
  { shortType: "WhiteDragonling", level: 12 },
];
const TEAM_B: TeamMemberSetup[] = [
  { shortType: "Minotaur", level: 12 },
  { shortType: "Spark", level: 12 },
  { shortType: "UnhappyBird", level: 12 },
];

describe("vertical slice: full seeded 3v3 battle (plan Task 10)", () => {
  const gd = loadGameData();

  it("battle is deterministic for a fixed seed", () => {
    const run = () =>
      new HeadlessBattle(gd, [[...TEAM_A], [...TEAM_B]], mulberry32(20260706)).runToCompletion();
    expect(run()).toEqual(run());
  });

  it("seeded battle event log matches snapshot", () => {
    const report = new HeadlessBattle(
      gd,
      [[...TEAM_A], [...TEAM_B]],
      mulberry32(20260706),
    ).runToCompletion();
    expect(report.winner).not.toBe("draw");
    expect(report.events).toMatchSnapshot();
  });

  // Every living's true starting/max hp, keyed by its stable battle id — lets the invariant
  // sweep verify the FIRST hit against each target too (not just event-to-event deltas) and
  // bound hp above by MaxHP throughout.
  const maxHpById = new Map<string, number>();
  for (const [teamNum, team] of [TEAM_A, TEAM_B].entries()) {
    team.forEach((setup, idx) => {
      const monster = gd.monsterByShortType(setup.shortType);
      maxHpById.set(
        `t${teamNum}m${idx}:${setup.shortType}`,
        baseStat(monster, "MaxHP", setup.level),
      );
    });
  }

  it("invariants hold across 50 random seeds", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = new HeadlessBattle(gd, [[...TEAM_A], [...TEAM_B]], mulberry32(seed)).runToCompletion();
      const last = r.events.at(-1);
      expect(last?.type).toBe("battleEnded");
      if (last?.type === "battleEnded") expect(last.winner).toBe(r.winner);

      let sawEnd = false;
      const dead = new Set<string>();
      const hpTrack = new Map<string, number>(maxHpById);
      for (const e of r.events) {
        if (sawEnd) throw new Error("events after battleEnded");
        switch (e.type) {
          case "battleEnded":
            sawEnd = true;
            break;
          case "damageDealt":
          case "healed": {
            expect(e.hpAfter).toBeGreaterThanOrEqual(0);
            const max = maxHpById.get(e.target);
            expect(max).toBeDefined();
            expect(e.hpAfter).toBeLessThanOrEqual(max!);
            // hpAfter must be exactly the running hp minus/plus the reported (post-clamp) amount.
            const prev = hpTrack.get(e.target);
            expect(prev).toBeDefined();
            expect(e.hpAfter).toBe(e.type === "damageDealt" ? prev! - e.amount : prev! + e.amount);
            hpTrack.set(e.target, e.hpAfter);
            break;
          }
          case "died":
            // a living dies at most once, at exactly 0 hp, and never acts again
            expect(dead.has(e.living)).toBe(false);
            expect(hpTrack.get(e.living)).toBe(0);
            dead.add(e.living);
            break;
          case "turnStarted":
            expect(dead.has(e.living)).toBe(false);
            break;
        }
      }
      expect(sawEnd).toBe(true);
    }
  });
});
