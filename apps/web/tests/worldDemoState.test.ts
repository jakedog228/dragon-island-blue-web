import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata/browser";
import { baseStat, mulberry32 } from "@dib/engine";
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
const items = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Items.json", import.meta.url), "utf8"));
const licenses = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Licenses.json", import.meta.url), "utf8"));
import {
  createRandomDemoParty,
  createSourceNewGameParty,
  createWorldTrip,
} from "../src/world/worldDemoState.js";
import {
  BASELINE_WORLD_POI_ROUTING,
  createWorldPoiRoutingPolicy,
  worldArrivalContinuation,
} from "../src/world/worldPoiRouting.js";
import type { WorldData } from "@dib/gamedata/browser";

const gd = GameData.fromRaw({ monsters, jobs, abilities, abilityComponents, buffs, items, licenses });

describe("world demo state", () => {
  it("creates the exact one-member level-1 starter party selected by PickDragon", () => {
    const party = createSourceNewGameParty(gd, "BlueBabyDragon");
    const members = party.monsters();
    expect(party.battingOrderSize).toBe(gd.license("Novice").battingOrderSize);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      instanceId: "new-game-starter-BlueBabyDragon",
      shortType: "BlueBabyDragon",
      level: 1,
      cumulativeXp: 0,
    });
    expect(members[0]!.currentHp).toBe(
      baseStat(gd.monsterByShortType("BlueBabyDragon"), "MaxHP", 1),
    );
  });

  const point = (
    demoSkipped: WorldData["pointsOfInterest"][number]["demoSkipped"],
    options: {
      zoneChange?: WorldData["pointsOfInterest"][number]["zoneChange"];
      ordinary?: boolean;
      supportedInteraction?: {
        readonly kind: "monsterCollection";
        readonly collectionType: string;
      };
      town?: boolean;
    } = {},
  ): WorldData["pointsOfInterest"][number] => ({
    name: "poi", type: "Outdoor.Generic", sourceClass: "PointOfInterest",
    position: { x: 0, y: 0 }, renderer: { className: "POINode", spriteFile: "empty.png" },
    hasEncounterTable: options.ordinary === true,
    unusedEncounterFixedEncounters: [],
    randomPopulators: options.ordinary ? [{
      tier: 1, encounterLevelScalor: 1, itterationScalor: 0, populatorLevelScalor: 1,
      minMonstersPerPack: 1, maxMonstersPerPack: 1,
      types: [{ type: "FireCub", chance: 100 }], fixedEncounters: [],
    }] : [],
    ...(options.zoneChange ? { zoneChange: options.zoneChange } : {}),
    ...(options.supportedInteraction
      ? { supportedInteraction: options.supportedInteraction }
      : {}),
    ...(options.town ? {
      town: {
        zoom: 3,
        buildings: [{
          sourceIndex: 0,
          className: "StoreMenuItem" as const,
          position: { x: 0, y: 0 },
          spriteFile: "house.png",
          iconSpriteFile: "shop.png",
          nameLabel: "StoreNameKey",
          fake: false,
          hasConditions: false,
        }],
        exit: { position: { x: -20, y: 0 }, spriteFile: "exit.png" },
        enterChats: [],
      },
    } : {}),
    demoSkipped,
  });

  it("routes world exits, routes town spaces into the retained-map town scene, and leaves other omitted interactions inert", () => {
    expect(BASELINE_WORLD_POI_ROUTING.route(point([], {
      zoneChange: { kind: "world", targetWorld: "World_3-2", targetZoneChange: "Entry" },
    }))).toEqual({ kind: "worldExit", targetWorld: "World_3-2", targetPoi: "Entry" });
    expect(BASELINE_WORLD_POI_ROUTING.route(point(["town"], { town: true })))
      .toEqual({
        kind: "scene",
        sceneId: "town",
        arrivalPresentation: "immediate-hidden-marker",
      });
    expect(BASELINE_WORLD_POI_ROUTING.route(
      point(["town", "fixedEncounter", "customInteraction"], { town: true }),
    ))
      .toEqual({
        kind: "scene",
        sceneId: "town",
        arrivalPresentation: "immediate-hidden-marker",
      });
    expect(BASELINE_WORLD_POI_ROUTING.route(point(["town"])))
      .toEqual({ kind: "navigate" });
    expect(BASELINE_WORLD_POI_ROUTING.route(point(["dungeon"], {
      zoneChange: { kind: "dungeon", dungeon: "Cave", dungeonFile: "Dungeon.plist", targetZoneChange: "Entry" },
    }))).toEqual({ kind: "blocked", system: "dungeon" });
    expect(BASELINE_WORLD_POI_ROUTING.route(point(["customInteraction"])))
      .toEqual({ kind: "blocked", system: "customInteraction" });
    expect(BASELINE_WORLD_POI_ROUTING.route(point(["fixedEncounter"])))
      .toEqual({ kind: "navigate" });
    expect(BASELINE_WORLD_POI_ROUTING.route(point(["fixedEncounter"], { ordinary: true })))
      .toEqual({ kind: "navigate" });
    expect(BASELINE_WORLD_POI_ROUTING.route(point([]))).toEqual({ kind: "navigate" });
  });

  it("gates the retained Collection interaction on an explicit mounted capability", () => {
    const collectionPoi = point(["customInteraction"], {
      supportedInteraction: { kind: "monsterCollection", collectionType: "Base" },
    });
    expect(BASELINE_WORLD_POI_ROUTING.route(collectionPoi))
      .toEqual({ kind: "blocked", system: "customInteraction" });
    expect(createWorldPoiRoutingPolicy({ collections: false }).route(collectionPoi))
      .toEqual({ kind: "blocked", system: "customInteraction" });

    const route = createWorldPoiRoutingPolicy({ collections: true }).route(collectionPoi);
    expect(route).toEqual({ kind: "collection", collectionType: "Base" });
    expect(worldArrivalContinuation(route, {
      kind: "none",
      poiName: "poi",
      reason: "no-encounter-table",
      movement: { adjacent: true, kind: "walk" },
    })).toBe("immediateCollection");
  });

  it("keeps an unknown custom interaction blocked even when Collections are mounted", () => {
    const unknown = createWorldPoiRoutingPolicy({ collections: true })
      .route(point(["customInteraction"]));
    expect(unknown).toEqual({ kind: "blocked", system: "customInteraction" });
  });

  it("gives an encounter arrival precedence over town and world-exit continuations", () => {
    const arrival = {
      kind: "encounter" as const,
      poiName: "poi",
      movement: { adjacent: true, kind: "walk" as const },
      encounter: {
        kind: "ordinary" as const,
        poiName: "poi",
        forced: false,
        tableKey: "1",
        poiWinsBeforeEncounter: 0,
        challengeLevel: 1,
        monsters: [{ type: "FireCub", level: 1 }],
      },
    };
    expect(worldArrivalContinuation(
      BASELINE_WORLD_POI_ROUTING.route(point(["town", "fixedEncounter"], { town: true })),
      arrival,
    )).toBe("encounter");
    expect(worldArrivalContinuation(
      BASELINE_WORLD_POI_ROUTING.route(point([], {
        zoneChange: { kind: "world", targetWorld: "World_2-1", targetZoneChange: "Entry" },
      })),
      arrival,
    )).toBe("encounter");
    expect(worldArrivalContinuation(
      createWorldPoiRoutingPolicy({ collections: true }).route(point(["customInteraction"], {
        supportedInteraction: { kind: "monsterCollection", collectionType: "Base" },
      })),
      arrival,
    )).toBe("encounter");
  });

  it("assigns a seeded, distinct, normal-only full-HP party at XP boundaries", () => {
    const party = createRandomDemoParty(gd, mulberry32(77), {
      size: 6,
      battingOrderSize: 6,
      levelRange: [34, 36],
      members: [{ shortType: "FireCub", level: 35 }],
    });
    const members = party.monsters();
    expect(members).toHaveLength(6);
    expect(new Set(members.map((member) => member.shortType)).size).toBe(6);
    expect(members[0]).toMatchObject({ shortType: "FireCub", level: 35 });
    for (const member of members) {
      expect(gd.monsterByShortType(member.shortType).category).toBe("Normal");
      expect(member.currentHp).toBe(baseStat(gd.monsterByShortType(member.shortType), "MaxHP", member.level));
    }
  });

  it("accepts explicit demo-only HP and injury state for lifecycle browser fixtures", () => {
    const party = createRandomDemoParty(gd, mulberry32(77), {
      size: 1,
      battingOrderSize: 1,
      levelRange: [5, 5],
      members: [{
        shortType: "FireCub",
        currentHp: 1,
        injureTime: 10,
        healTime: 20,
      }],
    });
    expect(party.monsters()[0]).toMatchObject({
      shortType: "FireCub",
      level: 5,
      currentHp: 1,
      injureTime: 10,
      healTime: 20,
    });
  });

  it("accepts deterministic loose soul stones for inventory browser fixtures", () => {
    const soulStones = [
      { element: "Fire", level: 5, sourceType: "FireCub" },
      { element: "Water", level: 6, sourceType: "SnowCub" },
    ] as const;
    const party = createRandomDemoParty(gd, mulberry32(77), {
      size: 1,
      battingOrderSize: 1,
      levelRange: [5, 5],
      members: [{ shortType: "FireCub" }],
      soulStones,
    });
    expect(party.ownedSoulStones()).toEqual(soulStones);
  });

  it("adapts imported ordinary tiers with source population-before-occurrence draws", () => {
    const world = {
      name: "World_Test",
      map: { className: "CCSprite", spriteFile: "world_test.png", anchor: { x: 0, y: 0 } },
      challengeLevel: 1,
      combatBackground: "FieldCombat.png",
      defaultItemSpawnChance: 0.25,
      encounterChance: 1,
      pointsOfInterest: [
        {
          name: "a", type: "Outdoor.Generic", sourceClass: "PointOfInterest",
          position: { x: 0, y: 0 }, renderer: { className: "POINode", spriteFile: "empty.png" },
          hasEncounterTable: false,
          randomPopulators: [], unusedEncounterFixedEncounters: [], demoSkipped: [],
        },
        {
          name: "b", type: "Outdoor.Generic", sourceClass: "PointOfInterest",
          position: { x: 10, y: 10 }, renderer: { className: "POINode", spriteFile: "empty.png" },
          hasEncounterTable: true,
          unusedEncounterFixedEncounters: [],
          randomPopulators: [{
            tier: 1, encounterLevelScalor: 35, itterationScalor: 0,
            populatorLevelScalor: 1, minMonstersPerPack: 1, maxMonstersPerPack: 1,
            types: [{ type: "FireCub", chance: 100 }], fixedEncounters: [],
          }],
          demoSkipped: ["fixedEncounter"],
        },
      ],
      connections: [{ poi1: "a", poi2: "b", demoSkipped: [] }],
    } satisfies WorldData;
    const trip = createWorldTrip(world, "a", mulberry32(1), gd.allMonsters().map((m) => m.shortType));
    expect(trip.navigate("b", [35])).toMatchObject({
      kind: "encounter",
      encounter: { challengeLevel: 35, monsters: [{ type: "FireCub", level: 31 }] },
    });
  });

  it("preserves an authored empty encounter table as a completing no-battle visit", () => {
    const world = {
      name: "ModWorld",
      map: { className: "CCSprite", spriteFile: "world_test.png", anchor: { x: 0, y: 0 } },
      challengeLevel: 1,
      combatBackground: "FieldCombat.png",
      defaultItemSpawnChance: 0.25,
      encounterChance: 1,
      pointsOfInterest: [
        {
          name: "a", type: "Outdoor.Generic", sourceClass: "PointOfInterest",
          position: { x: 0, y: 0 }, renderer: { className: "POINode", spriteFile: "empty.png" },
          hasEncounterTable: false, randomPopulators: [], unusedEncounterFixedEncounters: [], demoSkipped: [],
        },
        {
          name: "b", type: "Outdoor.Generic", sourceClass: "PointOfInterest",
          position: { x: 10, y: 10 }, renderer: { className: "POINode", spriteFile: "empty.png" },
          hasEncounterTable: true, randomPopulators: [], unusedEncounterFixedEncounters: [], demoSkipped: [],
        },
      ],
      connections: [{ poi1: "a", poi2: "b", demoSkipped: [] }],
    } satisfies WorldData;
    const trip = createWorldTrip(world, "a", mulberry32(1), ["FireCub"]);
    expect(trip.navigate("b", [1])).toMatchObject({
      kind: "none",
      poiName: "b",
      reason: "no-eligible-encounter",
    });
    expect(trip.isCompletedThisRefresh("b")).toBe(true);
  });

  it("treats shipped dangling connection endpoints as the source's nil graph edge", () => {
    const world = {
      name: "World_Test",
      map: { className: "CCSprite", spriteFile: "world_test.png", anchor: { x: 0, y: 0 } },
      challengeLevel: 1,
      combatBackground: "FieldCombat.png",
      defaultItemSpawnChance: 0.25,
      encounterChance: 1,
      pointsOfInterest: ["a", "b"].map((name, index) => ({
        name,
        type: "Outdoor.Generic",
        sourceClass: "PointOfInterest" as const,
        position: { x: index * 10, y: index * 10 },
        renderer: { className: "POINode" as const, spriteFile: "empty.png" },
        hasEncounterTable: false,
        randomPopulators: [],
        unusedEncounterFixedEncounters: [],
        demoSkipped: [],
      })),
      connections: [
        { poi1: "a", poi2: "b", demoSkipped: [] },
        { poi1: "b", poi2: "Removed", missingPointNames: ["Removed"], demoSkipped: [] },
      ],
    } satisfies WorldData;
    const trip = createWorldTrip(world, "a", mulberry32(1), ["FireCub"]);
    expect(trip.unconditionalNeighbors("a")).toEqual(["b"]);
    expect(trip.unconditionalNeighbors("b")).toEqual(["a"]);
  });
});
