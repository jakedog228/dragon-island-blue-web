import { describe, expect, it } from "vitest";
import { BattleSession, battleLivingId, mulberry32 } from "../src/index.js";
import { loadGameData } from "@dib/gamedata";

describe("battle participant identity", () => {
  it("preserves the established temporary id format", () => {
    expect(battleLivingId(0, 2, "WhiteDragonling")).toBe("t0m2:WhiteDragonling");
    expect(battleLivingId(1, 0, "Minotaur")).toBe("t1m0:Minotaur");
  });

  it("retains an optional durable source identity without changing the battle id", () => {
    const data = loadGameData();
    const session = new BattleSession(
      data,
      [
        [{ shortType: "FireCub", level: 12, sourceInstanceId: "save-monster-42" }],
        [{ shortType: "Spark", level: 12 }],
      ],
      mulberry32(1),
    );

    expect(session.sourceInstanceIdOf("t0m0:FireCub")).toBe("save-monster-42");
    expect(session.sourceInstanceIdOf("t1m0:Spark")).toBeUndefined();
  });
});
