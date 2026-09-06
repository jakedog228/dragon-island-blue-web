import type { BattleEvent } from "@dib/engine";
import { describe, expect, it } from "vitest";
import { enemyDefeatQuestEvents } from "../src/battle/battleQuestEvents.js";

describe("battle quest event adapter", () => {
  it("emits event 0 only for died livings retained in enemy deadMembers", () => {
    const events = [
      { type: "died", living: "enemy-ordinary" },
      { type: "died", living: "enemy-summon" },
      { type: "died", living: "friendly" },
      { type: "captured", living: "enemy-captured" },
      { type: "died", living: "enemy-second" },
    ] as BattleEvent[];
    const types: Record<string, string> = {
      "enemy-ordinary": "Slime",
      "enemy-second": "Bat",
    };

    expect(enemyDefeatQuestEvents(
      events,
      new Set(["enemy-ordinary", "enemy-second"]),
      (id) => types[id]!,
    )).toEqual([
      { id: 0, target: { shortType: "Slime", inEnemyDeadMembers: true } },
      { id: 0, target: { shortType: "Bat", inEnemyDeadMembers: true } },
    ]);
  });
});
