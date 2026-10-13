import type { BattleEvent } from "@dib/engine";
import { describe, expect, it } from "vitest";
import { enemyDefeatQuestEvents } from "../src/battle/battleQuestEvents.js";

describe("battle quest event adapter", () => {
  it("counts a split clone that is created and dies before its display roster registers", () => {
    const parent = "t1m2:Sludge", clone = "t1m3:Sludge";
    const events: BattleEvent[] = [
      { type: "died", living: parent },
      { type: "monsterAdded", living: clone, shortType: "Sludge", level: 5, team: 1, summoner: parent },
      { type: "died", living: clone },
    ];
    const constructionType = (id: string) => {
      if (id !== parent) throw new Error(`Unregistered display identity: ${id}`);
      return "Sludge";
    };
    expect(enemyDefeatQuestEvents(events, new Set([parent, clone]), constructionType)).toEqual([
      { id: 0, target: { shortType: "Sludge", inEnemyDeadMembers: true } },
      { id: 0, target: { shortType: "Sludge", inEnemyDeadMembers: true } },
    ]);
  });

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
