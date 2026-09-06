import { describe, expect, it } from "vitest";
import type { BattleReplaySnapshotV1 } from "@dib/engine";
import { officialEncounterRoster } from "../src/battle/officialEncounterRoster.js";
import type { EncounterConfig } from "../src/battle/encounter.js";

const encounter: EncounterConfig = {
  backgroundKey: "ForestCombat-hd",
  allowRetreat: false,
  playerTeam: [
    { shortType: "BlueBabyDragon", level: 99, currentHp: 1, displayName: "Local Blue",
      rendererData: { scale: 0.5 } },
    { shortType: "Goblin", level: 4, displayName: "Wrong Local Type" },
    { shortType: "Slime", level: 5, displayName: "Local Reserve" },
  ],
  enemyTeam: [
    { shortType: "FireCub", level: 7, displayName: "Authored Fire" },
  ],
};

const replay: BattleReplaySnapshotV1 = {
  schemaVersion: 1,
  teams: [
    [
      { shortType: "BlueBabyDragon", level: 3, currentHp: 42, sourceInstanceId: "party-blue" },
      { shortType: "RedBabyDragon", level: 4, currentHp: 37, sourceInstanceId: "party-red" },
    ],
    [{ shortType: "FireCub", level: 8, boss: true }],
  ],
  options: {},
  commands: [],
};

describe("officialEncounterRoster", () => {
  it("uses replay mechanics and retains only same-type local presentation overrides", () => {
    const aligned = officialEncounterRoster(encounter, replay);

    expect(aligned).not.toBe(encounter);
    expect(aligned.playerTeam).toEqual([
      {
        shortType: "BlueBabyDragon",
        level: 3,
        currentHp: 42,
        sourceInstanceId: "party-blue",
        displayName: "Local Blue",
        rendererData: { scale: 0.5 },
      },
      { shortType: "RedBabyDragon", level: 4, currentHp: 37, sourceInstanceId: "party-red" },
    ]);
    expect(aligned.enemyTeam).toEqual([
      { shortType: "FireCub", level: 8, boss: true, displayName: "Authored Fire" },
    ]);
    expect(aligned.allowRetreat).toBe(false);
    expect(aligned.playerTeam).not.toBe(replay.teams[0]);
    expect(aligned.enemyTeam).not.toBe(replay.teams[1]);
  });
});
