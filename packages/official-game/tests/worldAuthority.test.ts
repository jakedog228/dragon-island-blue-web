import { describe, expect, it } from "vitest";
import type { DungeonEncounter, WorldTripParty } from "@dib/engine";
import { buildOfficialDungeonBattle } from "../src/worldAuthority.js";

describe("Official battle breeder projection", () => {
  it("projects Breeder's native 1.0 XP default so reconnect retains breeder presence", () => {
    const encounter: DungeonEncounter = {
      id: "fixed:breeder-without-boss",
      kind: "fixed",
      monsters: [{ type: "BlackDragon", level: 12 }],
      breeder: { type: "Normal", arguments: {} },
    };
    const party = {
      projectAliveBattingPrefix: () => [{ shortType: "Slime", level: 5 }],
    } as unknown as WorldTripParty;

    const built = buildOfficialDungeonBattle(encounter, party);

    expect(built.encounter.breederXpBonus).toBe(1);
    expect(built.teams[1][0]?.boss).toBeUndefined();
  });
});
