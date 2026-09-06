import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadQuestCatalog,
  QuestDataError,
  type QuestDataSource,
} from "../src/quests.js";

function source(quests: unknown): QuestDataSource {
  return {
    has: (path) => path === "Quests.plist",
    plist: (path) => {
      if (path !== "Quests.plist") throw new Error(`missing ${path}`);
      return quests;
    },
  };
}

const base = {
  name: "Quest",
  class: "DefeatMonstersQuest",
  source: "Town",
  challengeLevel: 0,
  quantity: 2,
  treasureData: { items: [] },
};

describe("Quests.plist catalog", () => {
  it("loads the 83 shipped definitions in source order with exact class/reward fields", () => {
    const quests = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../extracted/data/Quests.json"), "utf8"),
    ) as unknown;
    const catalog = loadQuestCatalog(source(quests));
    expect(catalog.definitions).toHaveLength(83);
    expect(catalog.definitions.slice(0, 4).map(({ name }) => name)).toEqual([
      "MacworldCatch",
      "Defeat20Monsters",
      "BeatRigel",
      "BeatCyrus",
    ]);
    expect(catalog.requireQuest("Defeat20Monsters")).toMatchObject({
      className: "DefeatMonstersQuest",
      challengeLevel: 1,
      quantity: 10,
      treasureData: {
        items: [{
          spawnType: "fixed",
          data: {
            type: "DestroyOnPickup.MonsterJoin",
            arguments: { shortType: "Wolf", jobLevel: 2 },
          },
        }],
      },
    });
    expect(catalog.requireQuest("FinalBattle")).toMatchObject({
      className: "WinBattleListQuest",
      battleKeys: [
        "FinalBattle1",
        "FinalBattle2",
        "FinalBattle3",
        "FinalBattle4",
        "FinalBattle5",
        "FinalBattle6",
      ],
    });
    expect(Object.isFrozen(catalog.definitions)).toBe(true);
    expect(Object.isFrozen(catalog.requireQuest("Defeat20Monsters").treasureData)).toBe(true);
  });

  it("parses all binary-present objective shapes and source defaults", () => {
    const definitions = [
      base,
      {
        ...base,
        name: "World",
        class: "ClearWorldQuest",
        percent: 0.5,
        type: "World",
        quantity: undefined,
      },
      { ...base, name: "Soul", class: "MakeSoulstonesQuest" },
      {
        ...base,
        name: "Dungeon",
        class: "ClearDungeonQuest",
        type: "Dungeon",
        startFloor: 1,
        endFloor: 2,
        eraseDataAtTown: true,
        quantity: undefined,
      },
      { ...base, name: "Spirit", class: "GetSpiritTotemQuest", type: "Fire" },
      { ...base, name: "Promote", class: "PromoteMonsterQuest", type: "Wolf" },
      {
        ...base,
        name: "Combine",
        class: "CombineMonstersQuest",
        type1: "Wolf",
        type2: "Bat",
      },
      {
        ...base,
        name: "Battle",
        class: "WinBattleQuest",
        questKey: "BattleKey",
        allAlive: true,
        difficultyModifier: 2,
      },
      {
        ...base,
        name: "Reach",
        class: "ReachDungeonFloorQuest",
        type: "Dungeon",
        floor: 3,
        quantity: undefined,
      },
      { ...base, name: "Catch", class: "CatchMonstersQuest", type: "Slime" },
      {
        ...base,
        name: "Visit",
        class: "VisitTownQuest",
        townName: "Capital",
        quantity: undefined,
      },
      {
        ...base,
        name: "List",
        class: "WinBattleListQuest",
        battleKeys: ["One", "Two"],
        quantity: undefined,
      },
    ].map((entry) =>
      Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined))
    );
    const catalog = loadQuestCatalog(source(definitions));
    expect(catalog.definitions).toHaveLength(12);
    expect(catalog.requireQuest("Quest")).toMatchObject({ challengeLevel: 1, eraseDataAtTown: false });
    expect(catalog.requireQuest("Dungeon")).toMatchObject({ showMonsterCount: true });
  });

  it("fails loudly on factory/schema errors instead of fabricating a generic quest", () => {
    expect(() => loadQuestCatalog(source([{ ...base, class: "CounterQuest" }])))
      .toThrow(/unsupported Quest subclass/);
    expect(() => loadQuestCatalog(source([{ ...base, invented: true }])))
      .toThrow(/unsupported key invented/);
    expect(() => loadQuestCatalog(source([{ ...base, quantity: 0 }])))
      .toThrow(/quantity must be positive/);
    expect(() => loadQuestCatalog(source([{ ...base, name: "" }])))
      .toThrow(/name must be a non-empty string/);
    expect(() => loadQuestCatalog(source([base, base]))).toThrow(/duplicate quest name/);
    expect(() => loadQuestCatalog({ has: () => false, plist: () => [] }))
      .toThrow(QuestDataError);
  });
});
