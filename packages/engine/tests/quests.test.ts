import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadQuestCatalog,
  resolveDataDir,
  type QuestDataSource,
} from "@dib/gamedata";
import {
  GuildQuestRuntime,
  emptyGuildQuestStateSnapshot,
  parseGuildQuestStateSnapshot,
} from "../src/quests.js";

const treasureData = { items: [] };

const definitions = [
  {
    name: "Defeat",
    class: "DefeatMonstersQuest",
    source: "Town",
    challengeLevel: 1,
    quantity: 2,
    treasureData,
  },
  {
    name: "Battle",
    class: "WinBattleQuest",
    source: "Town",
    challengeLevel: 1,
    quantity: 1,
    questKey: "BattleKey",
    treasureData,
  },
  {
    name: "ResetDungeon",
    class: "ClearDungeonQuest",
    source: "Town",
    challengeLevel: 1,
    type: "Cave",
    startFloor: 1,
    endFloor: 2,
    eraseDataAtTown: true,
    treasureData,
  },
  {
    name: "Visit",
    class: "VisitTownQuest",
    source: "Town",
    challengeLevel: 1,
    townName: "Capital",
    treasureData,
  },
  {
    name: "Combine",
    class: "CombineMonstersQuest",
    source: "Town",
    challengeLevel: 1,
    quantity: 1,
    type1: "Wolf",
    type2: "Bat",
    treasureData,
  },
  {
    name: "List",
    class: "WinBattleListQuest",
    source: "Town",
    challengeLevel: 1,
    questKey: "ListKey",
    battleKeys: ["Fixed1", "Fixed2"],
    treasureData,
  },
  {
    name: "World",
    class: "ClearWorldQuest",
    source: "Elsewhere",
    challengeLevel: 1,
    percent: 0.5,
    type: "World",
    eraseDataAtTown: true,
    treasureData,
  },
  {
    name: "Soul",
    class: "MakeSoulstonesQuest",
    source: "Elsewhere",
    challengeLevel: 1,
    quantity: 1,
    treasureData,
  },
  {
    name: "Spirit",
    class: "GetSpiritTotemQuest",
    source: "Elsewhere",
    challengeLevel: 1,
    quantity: 1,
    type: "Fire",
    treasureData,
  },
  {
    name: "Promote",
    class: "PromoteMonsterQuest",
    source: "Elsewhere",
    challengeLevel: 1,
    quantity: 1,
    type: "Wolf",
    treasureData,
  },
  {
    name: "Catch",
    class: "CatchMonstersQuest",
    source: "Elsewhere",
    challengeLevel: 1,
    quantity: 1,
    type: "Slime",
    treasureData,
  },
  {
    name: "Reach",
    class: "ReachDungeonFloorQuest",
    source: "Elsewhere",
    challengeLevel: 1,
    type: "Cave",
    floor: 3,
    treasureData,
  },
] as const;

const source: QuestDataSource = {
  has: (path) => path === "Quests.plist",
  plist: () => definitions,
};

function runtime(
  snapshot = emptyGuildQuestStateSnapshot(),
): GuildQuestRuntime {
  return new GuildQuestRuntime(loadQuestCatalog(source), snapshot);
}

function shippedQuestRuntime(
  snapshot = emptyGuildQuestStateSnapshot(),
): GuildQuestRuntime {
  const dataDir = resolveDataDir();
  const catalog = loadQuestCatalog({
    has: (path) => path === "Quests.plist",
    plist: () => JSON.parse(readFileSync(resolve(dataDir, "Quests.json"), "utf8")) as unknown,
  });
  return new GuildQuestRuntime(catalog, snapshot);
}

describe("GuildQuestRuntime lifecycle", () => {
  it("preserves the four source quest states and three-active cap", () => {
    const quests = runtime();
    expect(quests.questsAvailableInTown("Town")).toBe(6);
    expect(quests.startFirstAvailableQuestInTown("Town")?.name).toBe("Defeat");
    expect(quests.startFirstAvailableQuestInTown("Town")?.name).toBe("Battle");
    expect(quests.startFirstAvailableQuestInTown("Town")?.name).toBe("ResetDungeon");
    expect(quests.startQuest("Visit")).toBe(false);

    expect(quests.canUseQuestKey("BattleKey")).toBe(true);
    quests.fireEvent({
      id: 9,
      battle: {
        questKey: "BattleKey",
        friendlyTeamCount: 1,
        battingOrderSize: 1,
        difficultyModifier: 0,
      },
    });
    expect(quests.completedActiveQuestNames()).toContain("Battle");
    expect(quests.activeQuestNames()).toContain("Battle");
    expect(quests.hasFinishedQuest("Battle")).toBe(false);
    expect(quests.canUseQuestKey("BattleKey")).toBe(false);

    expect(quests.claimFirstCompletedQuest()?.name).toBe("Battle");
    expect(quests.activeQuestNames()).not.toContain("Battle");
    expect(quests.hasFinishedQuest("Battle")).toBe(true);
  });

  it("uses separate Tavern availability and acceptance scans in authored order", () => {
    const quests = runtime();
    expect(quests.questsAvailableInTown("Town")).toBe(6);
    expect(quests.startFirstAvailableQuestInTown("Town")?.name).toBe("Defeat");
    expect(quests.questsAvailableInTown("Town")).toBe(5);
    expect(quests.startFirstAvailableQuestInTown("Town")?.name).toBe("Battle");
  });

  it("excludes active, reward-ready, and claimed quests from town availability forever", () => {
    const quests = runtime();
    expect(quests.questsAvailableInTown("Elsewhere")).toBe(6);
    expect(quests.questsAvailableInTown("MissingTown")).toBe(0);

    expect(quests.startFirstAvailableQuestInTown("Elsewhere")?.name).toBe("World");
    expect(quests.questsAvailableInTown("Elsewhere")).toBe(5);
    quests.fireEvent({
      id: 1,
      world: {
        instanceName: "World",
        encounterPoiCount: 2,
        completedEncounterPoiCount: 1,
      },
    });
    expect(quests.completedActiveQuestNames()).toEqual(["World"]);
    expect(quests.questsAvailableInTown("Elsewhere")).toBe(5);

    expect(quests.claimFirstCompletedQuest()?.name).toBe("World");
    expect(quests.questsAvailableInTown("Elsewhere")).toBe(5);
    expect(quests.firstAvailableQuestInTown("Elsewhere")?.name).toBe("Soul");
  });

  it("preserves the shipped stale Warp counts after Liberate is claimed", () => {
    const empty = shippedQuestRuntime();
    const names = empty.catalog.definitions.map(({ name }) => name);
    expect(names).toHaveLength(83);
    expect(names).toContain("LiberateTownsQuest");

    const warpDestinations = [
      "Ancient_City",
      "Capital_City",
      "First_City",
      "HolyCity",
      "Longdale_City",
      "Rainy_City",
      "SaintWesburn",
      "Secret_City",
      "Valley_City",
    ];
    const counts = (quests: GuildQuestRuntime) => Object.fromEntries(
      warpDestinations.map((townName) => [townName, quests.questsAvailableInTown(townName)]),
    );
    const liberateClaimedWithUnacceptedQuests = shippedQuestRuntime({
      schemaVersion: 1,
      activeQuestNames: [],
      finishedQuestNames: ["FinalBattle", "LiberateTownsQuest"],
      progressByQuestName: {},
      dialogsSeen: [],
      completedFixedEncounterKeys: [],
      receivedBattleRewardKeys: [],
    });
    const staleCounts = counts(liberateClaimedWithUnacceptedQuests);
    expect(staleCounts).toEqual({
      Ancient_City: 9,
      Capital_City: 11,
      First_City: 9,
      HolyCity: 10,
      Longdale_City: 24,
      Rainy_City: 5,
      SaintWesburn: 0,
      Secret_City: 2,
      Valley_City: 11,
    });
    // Capital, Rainy, Valley, Ancient, Longdale and Holy City all remove their Tavern through
    // the shipped `quests = !LiberateTownsQuest` building condition after this claim. These
    // definitions are consequently no longer acceptable even though the native Warp provider
    // still counts them. FinalBattle is already claimed, leaving 70 orphaned definitions.
    expect([
      "Capital_City",
      "Rainy_City",
      "Valley_City",
      "Ancient_City",
      "Longdale_City",
      "HolyCity",
    ].reduce((sum, townName) => sum + staleCounts[townName]!, 0)).toBe(70);
    // Corova and the Secret Guild survive the ending; their remaining 9 + 2 definitions are the
    // only counts in this minimal snapshot still backed by an authored Tavern.
    expect(staleCounts.First_City! + staleCounts.Secret_City!).toBe(11);

    const allQuestsAccountedFor = shippedQuestRuntime({
      schemaVersion: 1,
      activeQuestNames: ["LiberateTownsQuest"],
      finishedQuestNames: names.filter((name) => name !== "LiberateTownsQuest"),
      progressByQuestName: {},
      dialogsSeen: [],
      completedFixedEncounterKeys: [],
      receivedBattleRewardKeys: [],
    });
    expect(counts(allQuestsAccountedFor)).toEqual({
      Ancient_City: 0,
      Capital_City: 0,
      First_City: 0,
      HolyCity: 0,
      Longdale_City: 0,
      Rainy_City: 0,
      SaintWesburn: 0,
      Secret_City: 0,
      Valley_City: 0,
    });
  });

  it("drops unresolved active names during rehydration and preserves source duplicate-finished edge", () => {
    const quests = runtime({
      schemaVersion: 1,
      activeQuestNames: ["Removed", "Defeat"],
      finishedQuestNames: ["Defeat"],
      progressByQuestName: { Removed: { quantity: 9 }, Defeat: { quantity: 1 } },
      dialogsSeen: [],
      completedFixedEncounterKeys: [],
      receivedBattleRewardKeys: [],
    });
    expect(quests.droppedActiveQuestNamesDuringRestore).toEqual(["Removed"]);
    expect(quests.activeQuestNames()).toEqual(["Defeat"]);
    expect(quests.completeQuest("Defeat")).toBe(false);
    expect(quests.activeQuestNames()).toEqual([]);
    expect(quests.questProgress("Defeat")).toEqual({});
  });

  it("drops every active quest/progress at once and has no per-quest drop path", () => {
    const quests = runtime();
    quests.startQuest("Defeat");
    quests.startQuest("Battle");
    quests.fireEvent({ id: 0, target: { shortType: "Slime", inEnemyDeadMembers: true } });
    quests.clearAllQuests();
    expect(quests.activeQuestNames()).toEqual([]);
    expect(quests.questProgress("Defeat")).toEqual({});
  });
});

describe("GuildQuestRuntime objective/event contracts", () => {
  it("counts only enemy-dead-member defeats and clamps quantity at the target", () => {
    const quests = runtime();
    quests.startQuest("Defeat");
    quests.fireEvent({ id: 0, target: { shortType: "Slime", inEnemyDeadMembers: false } });
    expect(quests.questProgress("Defeat")).toEqual({});
    quests.fireEvent({ id: 0, target: { shortType: "Slime", inEnemyDeadMembers: true } });
    quests.fireEvent({ id: 0, target: { shortType: "Slime", inEnemyDeadMembers: true } });
    quests.fireEvent({ id: 0, target: { shortType: "Slime", inEnemyDeadMembers: true } });
    expect(quests.questProgress("Defeat")).toEqual({ quantity: 2 });
    expect(quests.isComplete("Defeat")).toBe(true);
  });

  it("matches combine ingredients as an unordered pair", () => {
    const quests = runtime();
    quests.startQuest("Combine");
    quests.fireEvent({
      id: 8,
      firstIngredientShortType: "Bat",
      secondIngredientShortType: "Wolf",
    });
    expect(quests.isComplete("Combine")).toBe(true);
  });

  it("recounts every room, records each floor independently, and resets only while incomplete", () => {
    const quests = runtime();
    quests.startQuest("ResetDungeon");
    quests.fireEvent({
      id: 4,
      dungeon: { instanceName: "Cave", floor: 1, survivingMonstersByRoom: [0, 1, 2] },
    });
    expect(quests.questProgress("ResetDungeon")).toEqual({ "monstersLeftOnFloor:1": 3 });
    quests.enteredTown("Town");
    expect(quests.questProgress("ResetDungeon")).toEqual({});

    quests.fireEvent({
      id: 4,
      dungeon: { instanceName: "Cave", floor: 1, survivingMonstersByRoom: [0, 0] },
    });
    quests.fireEvent({
      id: 4,
      dungeon: { instanceName: "Cave", floor: 2, survivingMonstersByRoom: [] },
    });
    expect(quests.isComplete("ResetDungeon")).toBe(true);
    quests.enteredTown("Town");
    expect(quests.questProgress("ResetDungeon")).toEqual({
      "monstersLeftOnFloor:1": 0,
      "monstersLeftOnFloor:2": 0,
    });
  });

  it("applies reset before event 11 so a resettable objective may advance during the visit", () => {
    const customSource: QuestDataSource = {
      has: () => true,
      plist: () => [{
        name: "Return",
        class: "VisitTownQuest",
        source: "Town",
        challengeLevel: 1,
        townName: "Town",
        eraseDataAtTown: true,
        treasureData,
      }],
    };
    const quests = new GuildQuestRuntime(loadQuestCatalog(customSource));
    quests.startQuest("Return");
    quests.enteredTown("Town");
    expect(quests.isComplete("Return")).toBe(true);
  });

  it("marks fixed completion before event 9 and keeps WinBattleList progress global", () => {
    const quests = runtime();
    quests.startQuest("List");
    const first = quests.recordBattleWin({
      id: 9,
      battle: {
        questKey: "ListKey",
        uniqueKey: "Fixed1",
        friendlyTeamCount: 1,
        battingOrderSize: 1,
        difficultyModifier: 0,
      },
    });
    expect(first.notificationQuestNames).toEqual(["List"]);
    expect(first.changedQuestNames).toEqual([]);
    expect(quests.questProgress("List")).toEqual({});
    expect(quests.isComplete("List")).toBe(false);

    quests.recordBattleWin({
      id: 9,
      battle: {
        questKey: "ListKey",
        uniqueKey: "Fixed2",
        friendlyTeamCount: 1,
        battingOrderSize: 1,
        difficultyModifier: 0,
      },
    });
    expect(quests.isComplete("List")).toBe(true);
    expect(quests.canUseQuestKey("ListKey")).toBe(false);
  });

  it("reports truthful integer presentation counts for each progress storage shape", () => {
    const quantity = runtime();
    quantity.startQuest("Defeat");
    quantity.fireEvent({
      id: 0,
      target: { shortType: "Slime", inEnemyDeadMembers: true },
    });
    expect(quantity.questProgressCount("Defeat")).toEqual({ current: 1, required: 2 });

    const world = runtime();
    world.startQuest("World");
    world.fireEvent({
      id: 1,
      world: { instanceName: "World", encounterPoiCount: 4, completedEncounterPoiCount: 1 },
    });
    expect(world.questProgressCount("World")).toEqual({ current: 25, required: 50 });

    const dungeon = runtime();
    dungeon.startQuest("ResetDungeon");
    dungeon.fireEvent({
      id: 4,
      dungeon: { instanceName: "Cave", floor: 1, survivingMonstersByRoom: [] },
    });
    expect(dungeon.questProgressCount("ResetDungeon")).toEqual({ current: 1, required: 2 });

    const visit = runtime();
    visit.startQuest("Visit");
    visit.recordTownVisit("Capital");
    expect(visit.questProgressCount("Visit")).toEqual({ current: 1, required: 1 });

    const list = runtime();
    list.startQuest("List");
    list.recordBattleWin({
      id: 9,
      battle: {
        uniqueKey: "Fixed1",
        friendlyTeamCount: 1,
        battingOrderSize: 1,
        difficultyModifier: 0,
      },
    });
    expect(list.questProgressCount("List")).toEqual({ current: 1, required: 2 });
  });

  it("treats WinBattleQuest questKey as an optional source filter", () => {
    const anyBattleSource: QuestDataSource = {
      has: () => true,
      plist: () => [{
        name: "AnyBattle",
        class: "WinBattleQuest",
        source: "Town",
        challengeLevel: 1,
        quantity: 1,
        treasureData,
      }],
    };
    const quests = new GuildQuestRuntime(loadQuestCatalog(anyBattleSource));
    quests.startQuest("AnyBattle");
    quests.fireEvent({
      id: 9,
      battle: {
        questKey: "SomeAuthoredEncounter",
        friendlyTeamCount: 1,
        battingOrderSize: 1,
        difficultyModifier: 0,
      },
    });
    expect(quests.isComplete("AnyBattle")).toBe(true);
  });

  it("stores monotonic float32 world progress and uses the source completion tolerance", () => {
    const quests = runtime();
    quests.startQuest("World");
    quests.fireEvent({
      id: 1,
      world: { instanceName: "World", encounterPoiCount: 3, completedEncounterPoiCount: 1 },
    });
    const first = quests.questProgress("World")["percent"];
    quests.fireEvent({
      id: 1,
      world: { instanceName: "World", encounterPoiCount: 4, completedEncounterPoiCount: 1 },
    });
    expect(quests.questProgress("World")["percent"]).toBe(first);
    quests.fireEvent({
      id: 1,
      world: { instanceName: "World", encounterPoiCount: 2, completedEncounterPoiCount: 1 },
    });
    expect(quests.isComplete("World")).toBe(true);
  });

  it("routes the remaining source event IDs to their exact objective/payload types", () => {
    const cases = [
      {
        name: "Soul",
        miss: {
          id: 2,
          world: { instanceName: "World", encounterPoiCount: 1, completedEncounterPoiCount: 1 },
        } as const,
        hit: { id: 3 } as const,
      },
      {
        name: "Spirit",
        miss: { id: 5, spiritShortType: "Water" } as const,
        hit: { id: 5, spiritShortType: "Fire" } as const,
      },
      {
        name: "Promote",
        miss: { id: 6, monsterShortType: "Bat" } as const,
        hit: { id: 6, monsterShortType: "Wolf" } as const,
      },
      {
        name: "Catch",
        miss: { id: 7, monsterShortType: "Bat" } as const,
        hit: { id: 7, monsterShortType: "Slime" } as const,
      },
      {
        name: "Reach",
        miss: { id: 10, dungeon: { instanceName: "Cave", floor: 2 } } as const,
        hit: { id: 10, dungeon: { instanceName: "Cave", floor: 3 } } as const,
      },
    ];
    for (const testCase of cases) {
      const quests = runtime();
      quests.startQuest(testCase.name);
      quests.fireEvent(testCase.miss);
      expect(quests.isComplete(testCase.name), `${testCase.name} miss`).toBe(false);
      quests.fireEvent(testCase.hit);
      expect(quests.isComplete(testCase.name), `${testCase.name} hit`).toBe(true);
    }
  });

  it("records visit event 11 directly without running full entered-town reset", () => {
    const quests = runtime();
    quests.startQuest("Visit");
    quests.recordTownVisit("Town");
    expect(quests.isComplete("Visit")).toBe(false);
    quests.recordTownVisit("Capital");
    expect(quests.questProgress("Visit")).toEqual({ reachedTown: true });
  });
});

describe("GuildQuestRuntime adjacent global state", () => {
  it("marks an alwaysShow:false chat seen before first presentation and suppresses repeats", () => {
    const quests = runtime();
    expect(quests.requestChatPresentation("Story", false)).toBe(true);
    expect(quests.hasSeenDialog("Story")).toBe(true);
    expect(quests.requestChatPresentation("Story", false)).toBe(false);
    expect(quests.requestChatPresentation("Story", true)).toBe(true);
  });

  it("round-trips separate quest, dialog, fixed-completion, and reward registries", () => {
    const quests = runtime();
    quests.startQuest("Defeat");
    quests.fireEvent({ id: 0, target: { shortType: "Slime", inEnemyDeadMembers: true } });
    quests.requestChatPresentation("Story", false);
    quests.markFixedEncounterComplete("Boss");
    expect(quests.markBattleRewardReceived("BossReward")).toBe(true);
    expect(quests.markBattleRewardReceived("BossReward")).toBe(false);
    expect(quests.hasReceivedBattleReward("BossReward")).toBe(true);
    const snapshot = quests.stateSnapshot();
    expect(parseGuildQuestStateSnapshot(snapshot)).toEqual(snapshot);
    expect(new GuildQuestRuntime(loadQuestCatalog(source), snapshot).stateSnapshot()).toEqual(snapshot);
  });

  it("replaces an authoritative mirror in place without emitting local mutations", () => {
    const quests = runtime();
    const mutations: string[] = [];
    quests.setMutationListener(({ kind }) => mutations.push(kind));
    quests.startQuest("Defeat");
    mutations.length = 0;
    const committed = runtime();
    committed.startQuest("Battle");
    committed.requestChatPresentation("LeslieSaved", false);
    committed.markFixedEncounterComplete("Fixed1");
    quests.replaceStateSnapshot(committed.stateSnapshot());
    expect(quests.stateSnapshot()).toEqual(committed.stateSnapshot());
    expect(mutations).toEqual([]);
  });
});
