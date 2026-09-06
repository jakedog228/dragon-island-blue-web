import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  baseStat,
  createWorldTripSharedState,
  emptyGuildQuestStateSnapshot,
  GuildQuestRuntime,
  jobXpForLevel,
  replayableRng,
  WorldTrip,
  WorldTripParty,
} from "@dib/engine";
import type { DungeonDefinition } from "@dib/gamedata/dungeon";
import { GameData } from "@dib/gamedata/browser";
import { loadQuestCatalog, resolveDataDir } from "@dib/gamedata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
const items = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Items.json", import.meta.url), "utf8"));
const combines = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Combines.json", import.meta.url), "utf8"));
const licenses = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Licenses.json", import.meta.url), "utf8"));
import { PlayerRuntimeState } from "../src/player/playerRuntimeState.js";
import { DungeonRuntimeController } from "@dib/engine/dungeon-runtime";
import {
  commitOfficialProjectionAdoption,
  prepareOfficialProjectionAdoption,
  type OfficialProjectionAdoptionPreparation,
} from "../src/authority/officialProjectionAdoption.js";

const data = GameData.fromRaw({
  monsters, jobs, abilities, abilityComponents, buffs, items, combines, licenses,
});
const questCatalog = loadQuestCatalog({
  has: (path) => path === "Quests.plist",
  plist: (path) => {
    if (path !== "Quests.plist") throw new Error(`unexpected quest path ${path}`);
    return JSON.parse(readFileSync(resolve(resolveDataDir(), "Quests.json"), "utf8")) as unknown;
  },
});

function realPlayer(): PlayerRuntimeState {
  const party = new WorldTripParty(data, [{
    instanceId: "official-party-1",
    shortType: "FireCub",
    level: 10,
    cumulativeXp: jobXpForLevel(10, data.jobXpPenalty("FireCub")),
    currentHp: baseStat(data.monsterByShortType("FireCub"), "MaxHP", 10),
  }], data.license("Novice").battingOrderSize);
  return PlayerRuntimeState.world({
    heroLevel: 9,
    monsterPartyLevels: [10],
    silver: 300,
    gold: 150,
    captureCards: { 1: 1, 2: 0, 3: 0 },
    highestCapturedLevels: {},
    spiritReadiness: 1,
    spiritTierLevels: { Resistance: 0 },
  }, party);
}

function dungeonDefinition(): DungeonDefinition {
  return {
    typeName: "OfficialTest",
    sourceFile: "Dungeon_OfficialTest.plist",
    instanceName: "OfficialTestDungeon",
    startFloor: 1,
    mustClearFloor: false,
    presentation: {
      typeName: "OfficialTest",
      atlasNames: ["OfficialTest"],
      floorFrameFormat: "floor%d.png",
      floorFrameCount: 1,
      wallFrameFormat: "walls%d_%dx%d.png",
      wallFrameCount: 1,
      wallItemCount: 0,
      doorFrameFormat: "door%d.png",
      doorFrameCount: 1,
      northDoorFrame: "north.png",
      combatBackgroundFile: "CaveCombat.png",
      chestFrame: "chest.png",
      portalFrame: "portal.png",
      stairsUpFrame: "stairsUp.png",
      stairsDownFrame: "stairsDown.png",
    },
    creation: {
      lastFloor: 1,
      density: 1,
      roomsMin: 6,
      roomsMax: 6,
      retryChance: 0,
      doorCycleAttempts: 0,
      nonHallwaysNeeded: 0,
      waypointEvery: 1,
      monsterLevelBase: 1,
      monsterLevelFloorScalor: 1,
      defaultItemSpawnChance: 0,
      roomChoiceBiasClass: "DefaultRoomChoiceBias",
      roomChoiceBiasDirection: { x: 0, y: 0 },
      roomChoiceBiasRandom: false,
      roomTemplates: [{
        key: "2x2",
        width: 2,
        height: 2,
        frequency: 1,
        rotations: [0],
        rendererClass: "RoomNode",
        anchor: { x: 0, y: 0 },
      }],
    },
    floorPopulations: [{
      sourceFloor: 1,
      zoneChanges: [],
      monsterPopulator: {
        className: "DefaultMonsterPopulator",
        minMonstersPerPack: 1,
        maxMonstersPerPack: 1,
        levelScalor: 1,
        density: 1,
        types: [{ type: "Slime", chance: 100 }],
        fixedEncounters: [],
      },
    }],
  };
}

function realDungeon(): DungeonRuntimeController {
  const definition = dungeonDefinition();
  return DungeonRuntimeController.enter({
    resources: { has: () => false, plist: () => undefined },
    monsterTypes: ["Slime"],
    runSeed: 17,
    definitionFor: () => definition,
  }, { typeName: definition.typeName, sourceFile: definition.sourceFile, floor: 1 });
}

interface LiveState {
  player: string;
  quests: string;
  world: string;
  dungeon: string;
}

function commit(
  live: LiveState,
  prepared: OfficialProjectionAdoptionPreparation<string>,
): void {
  live.player = prepared.player;
  live.quests = prepared.quests;
  live.world = prepared.world;
  live.dungeon = prepared.dungeon;
}

describe("Official projection adoption prepare/commit boundary", () => {
  it.each(["player", "quests", "world", "dungeon"] as const)(
    "does not swap live references when the %s preflight builder fails",
    (failed) => {
      const live: LiveState = {
        player: "live-player",
        quests: "live-quests",
        world: "live-world",
        dungeon: "live-dungeon",
      };
      let commits = 0;
      expect(() => {
        const prepared = prepareOfficialProjectionAdoption<string>({
          player: () => {
            if (failed === "player") throw new Error("player preflight failed");
            return "prepared-player";
          },
          quests: () => {
            if (failed === "quests") throw new Error("quest preflight failed");
            return "prepared-quests";
          },
          world: () => {
            if (failed === "world") throw new Error("world preflight failed");
            return "prepared-world";
          },
          dungeon: () => {
            if (failed === "dungeon") throw new Error("dungeon/resource preflight failed");
            return "prepared-dungeon";
          },
        });
        commits += 1;
        commitOfficialProjectionAdoption(prepared, (aggregate) => commit(live, aggregate));
      }).toThrow(/preflight failed/);
      expect(commits).toBe(0);
      expect(live).toEqual({
        player: "live-player",
        quests: "live-quests",
        world: "live-world",
        dungeon: "live-dungeon",
      });
    },
  );

  it("builds every replacement before the single live swap", () => {
    const live: LiveState = {
      player: "live-player",
      quests: "live-quests",
      world: "live-world",
      dungeon: "live-dungeon",
    };
    const order: string[] = [];
    const prepared = prepareOfficialProjectionAdoption<string>({
      player: () => { order.push("player"); return "prepared-player"; },
      quests: () => { order.push("quests"); return "prepared-quests"; },
      world: () => { order.push("world"); return "prepared-world"; },
      dungeon: () => { order.push("dungeon"); return "prepared-dungeon"; },
    });
    order.push("commit");
    commitOfficialProjectionAdoption(prepared, (aggregate) => commit(live, aggregate));

    expect(order).toEqual(["player", "quests", "world", "dungeon", "commit"]);
    expect(live).toEqual({
      player: "prepared-player",
      quests: "prepared-quests",
      world: "prepared-world",
      dungeon: "prepared-dungeon",
    });
  });

  it.each(["player", "quests", "world", "dungeon"] as const)(
    "leaves real owner references and listeners untouched when %s adoption preflight fails",
    (failed) => {
      const player = realPlayer();
      const quests = new GuildQuestRuntime(questCatalog, {
        ...emptyGuildQuestStateSnapshot(),
        activeQuestNames: ["BeatRigel"],
      });
      const shared = createWorldTripSharedState();
      const rng = replayableRng([0.25]);
      const trip = new WorldTrip({
        pointsOfInterest: [{ instanceName: "First_City" }],
        connections: [],
      }, "First_City", rng, { randomMonsterTypes: [], sharedState: shared });
      trip.begin();
      const dungeon = realDungeon();
      const live = { player, quests, world: { trip, shared, rng }, dungeon };
      const before = {
        player,
        playerSnapshot: player.stateSnapshot(),
        quests,
        questsSnapshot: quests.stateSnapshot(),
        trip,
        shared,
        rng,
        dungeon,
      };

      expect(() => {
        const prepared = prepareOfficialProjectionAdoption({
          player: () => {
            if (failed === "player") throw new Error("player preflight failed");
            return PlayerRuntimeState.fromStateSnapshot(data, player.stateSnapshot(), player.collection);
          },
          quests: () => {
            if (failed === "quests") throw new Error("quest preflight failed");
            return new GuildQuestRuntime(questCatalog, quests.stateSnapshot());
          },
          world: () => {
            if (failed === "world") throw new Error("world preflight failed");
            const preparedShared = createWorldTripSharedState();
            const preparedRng = replayableRng([...rng.draws]);
            const preparedTrip = new WorldTrip({
              pointsOfInterest: [{ instanceName: "First_City" }],
              connections: [],
            }, "First_City", preparedRng, {
              randomMonsterTypes: [],
              sharedState: preparedShared,
            });
            preparedTrip.begin();
            return { trip: preparedTrip, shared: preparedShared, rng: preparedRng };
          },
          dungeon: () => {
            if (failed === "dungeon") throw new Error("dungeon preflight failed");
            return { run: DungeonRuntimeController.restore({
              resources: { has: () => false, plist: () => undefined },
              monsterTypes: ["Slime"],
              definitionFor: () => dungeonDefinition(),
            }, dungeon.snapshot()), transientTransfer: { activeBattle: false } };
          },
        });
        commitOfficialProjectionAdoption(prepared, (aggregate) => {
          live.player = aggregate.player;
          live.quests = aggregate.quests;
          live.world = aggregate.world;
          live.dungeon = aggregate.dungeon.run;
        });
      }).toThrow(/preflight failed/);

      expect(live).toEqual({
        player: before.player,
        quests: before.quests,
        world: { trip: before.trip, shared: before.shared, rng: before.rng },
        dungeon: before.dungeon,
      });
      expect(player.stateSnapshot()).toEqual(before.playerSnapshot);
      expect(quests.stateSnapshot()).toEqual(before.questsSnapshot);
    },
  );

  it.each(["victory", "retreat", "defeat"] as const)(
    "successfully swaps the prepared real aggregate for a dungeon %s projection",
    (outcome) => {
      const player = realPlayer();
      const quests = new GuildQuestRuntime(questCatalog, emptyGuildQuestStateSnapshot());
      const shared = createWorldTripSharedState();
      const rng = replayableRng([]);
      const trip = new WorldTrip({
        pointsOfInterest: [{ instanceName: "First_City" }],
        connections: [],
      }, "First_City", rng, { randomMonsterTypes: [], sharedState: shared });
      trip.begin();
      const dungeon = realDungeon();
      const live = { player, quests, world: { trip, shared, rng }, dungeon };
      const prepared = prepareOfficialProjectionAdoption({
        player: () => PlayerRuntimeState.fromStateSnapshot(data, player.stateSnapshot(), player.collection),
        quests: () => new GuildQuestRuntime(questCatalog, quests.stateSnapshot()),
        world: () => ({
          trip: new WorldTrip({ pointsOfInterest: [{ instanceName: "First_City" }], connections: [] },
            "First_City", replayableRng([]), { randomMonsterTypes: [] }),
          shared: createWorldTripSharedState(),
          rng: replayableRng([]),
        }),
        dungeon: () => ({ run: realDungeon(), transientTransfer: { outcome } }),
      });
      commitOfficialProjectionAdoption(prepared, (aggregate) => {
        live.player = aggregate.player;
        live.quests = aggregate.quests;
        live.world = aggregate.world;
        live.dungeon = aggregate.dungeon.run;
      });

      expect(live.player).not.toBe(player);
      expect(live.quests).not.toBe(quests);
      expect(live.world.trip).not.toBe(trip);
      expect(live.world.rng).not.toBe(rng);
      expect(live.dungeon).not.toBe(dungeon);
    },
  );

  it("regenerates a cached synthetic dungeon projection before web adoption", () => {
    const native = realDungeon().snapshot();
    const legacyFloor = (entry: typeof native.current) => {
      const {
        previousRoomId: _previousRoomId,
        encounterRosters: _encounterRosters,
        generationGateDecisions: _generationGateDecisions,
        ...withoutNativeFields
      } = entry.session;
      return {
        ...entry,
        session: {
          ...withoutNativeFields,
          currentRoomId: "room-0",
          exploredRoomIds: ["room-0"],
          clearedEncounterIds: [],
          collectedTreasureIds: [],
          registeredWaypointFloors: [entry.route.floor],
        },
      };
    };
    const legacy = {
      ...native,
      current: legacyFloor(native.current),
      cachedFloors: native.cachedFloors.map(legacyFloor),
      registeredWaypoints: [{ route: native.current.route }],
    };
    let adopted: DungeonRuntimeController | undefined;
    const prepared = prepareOfficialProjectionAdoption({
      player: () => "player",
      quests: () => "quests",
      world: () => "world",
      dungeon: () => {
        const run = DungeonRuntimeController.restore({
          resources: { has: () => false, plist: () => undefined },
          monsterTypes: ["Slime"],
          definitionFor: () => dungeonDefinition(),
        }, legacy);
        adopted = run;
        return { run, transientTransfer: { activeBattle: false } };
      },
    });
    commitOfficialProjectionAdoption(prepared, (aggregate) => {
      adopted = aggregate.dungeon.run;
    });

    expect(adopted?.migratedLegacyTopology).toBe(true);
    expect(adopted?.session.snapshot().currentRoomId).not.toBe("room-0");
    expect(adopted?.snapshot().registeredWaypoints).toEqual([{ route: native.current.route }]);
    expect(adopted?.snapshot().cachedFloors).toHaveLength(native.cachedFloors.length);
  });
});
