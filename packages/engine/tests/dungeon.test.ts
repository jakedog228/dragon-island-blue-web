import { describe, expect, it } from "vitest";
import type { DungeonDefinition, DungeonTreasureData } from "@dib/gamedata";
import {
  DungeonSession,
  dungeonAdjustedTreasureLevel,
  dungeonChallengeLevel,
  dungeonDirectedRoomChoiceWeights,
  dungeonExtremalWeightPool,
  dungeonGemBonusForStat,
  dungeonGemItemTier,
  dungeonGemPresentationProjection,
  dungeonGemSlotWeights,
  dungeonGoldQuantityForLevel,
  dungeonPointIsReserved,
  dungeonPopulationForFloor,
  dungeonRandomGemForLevel,
  dungeonRandomTreasureKind,
  dungeonRoundf,
  dungeonSilverQuantityForLevel,
  dungeonTargetRoomCount,
  dungeonTreasureChallengeLevel,
  dungeonTreasureSpawnChance,
  dungeonWeightedMonsterType,
  dungeonZoneChangesForFloor,
  directionForRoomLink,
  generateDungeonFloor,
  generateQuestRewards,
} from "../src/dungeon.js";
import type { ForkableRng, Rng } from "../src/rng.js";
import { touchHleArc4Random } from "../src/rng.js";

const definition = (): DungeonDefinition => ({
  typeName: "Test", sourceFile: "Dungeon_Test.plist", instanceName: "TestDungeon", startFloor: 1,
  mustClearFloor: false,
  presentation: {
    typeName: "Test", atlasNames: ["TestDungeonRoomFrames"], floorFrameFormat: "floor%d.png", floorFrameCount: 1,
    wallFrameFormat: "walls%d_%dx%d.png", wallFrameCount: 1, wallItemCount: 0,
    doorFrameFormat: "door%d.png", doorFrameCount: 1, northDoorFrame: "northDoor.png",
    combatBackgroundFile: "CaveCombat.png", chestFrame: "chest.png", portalFrame: "portal.png",
    stairsUpFrame: "stairsUp.png", stairsDownFrame: "stairsDown.png",
  },
  creation: {
    lastFloor: 5, density: 3, roomsMin: 8, roomsMax: 8, retryChance: .3, doorCycleAttempts: 1,
    nonHallwaysNeeded: 1, waypointEvery: 1, monsterLevelBase: 18, monsterLevelFloorScalor: 2,
    defaultItemSpawnChance: .25, roomChoiceBiasClass: "DefaultRoomChoiceBias",
    roomChoiceBiasDirection: { x: 0, y: 0 }, roomChoiceBiasRandom: false,
    roomTemplates: [{ key: "2x2", width: 2, height: 2, frequency: 10, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } }],
  },
  floorPopulations: [{ sourceFloor: 1,
    monsterPopulator: {
      className: "DefaultMonsterPopulator", minMonstersPerPack: 1, maxMonstersPerPack: 2,
      levelScalor: 1, density: .5, types: [{ type: "Slime", chance: 100 }],
      fixedEncounters: [{ sourceIndex: 0, monsters: [{ type: "Bat", levelScalor: 1 }], exactFloor: 1, chanceToAppear: 1, uniqueKey: "boss" }],
    },
    treasurePopulator: { className: "DefaultTreasurePopulator", unguardedTreasureChance: .25,
      treasureData: { levelScalor: 1, items: [{ kind: "silver", chance: 1, levelScalor: 1 }] } },
    zoneChanges: [{ kind: "stairsDown", sourceType: "Down" }, { kind: "stairsUp", sourceType: "Up" }],
  }],
});

const saveMeDefinition = (): DungeonDefinition => {
  const source = definition();
  const population = source.floorPopulations[0]!;
  const fixed = population.monsterPopulator!.fixedEncounters[0]!;
  return {
    ...source,
    floorPopulations: [{
      ...population,
      monsterPopulator: {
        ...population.monsterPopulator!,
        fixedEncounters: [{
          ...fixed,
          treasureData: { levelScalor: 1, items: [{ kind: "silver", chance: 1, levelScalor: 1 }] },
          monsters: [
            { type: "Bat", levelScalor: 1, extraLivingArguments: { boss: true, nested: { depth: 1 } } },
            { type: "Slime", levelScalor: 1 },
            { type: "Bat", levelScalor: 1 },
          ],
          startEvent: { className: "DungeonStartEvent", data: { nested: { depth: 1 } } },
          winEvent: { className: "DungeonWinEvent", data: { nested: { depth: 2 } } },
          breeder: { type: "DungeonBreeder", arguments: { nested: { depth: 3 } } },
        }],
      },
    }],
  };
};

class MaxRng implements Rng {
  next(): number { return .999999; }
  intBelow(n: number): number { return n - 1; }
  chance(p: number): boolean { return p > .999998; }
}

class ScriptedRng implements Rng {
  constructor(private readonly values: number[]) {}
  private draw(): number {
    const value = this.values.shift();
    if (value === undefined) throw new Error("ScriptedRng exhausted");
    return value;
  }
  next(): number { return this.draw(); }
  intBelow(n: number): number { return Math.floor(this.draw() * n); }
  chance(p: number): boolean { return this.draw() < p; }
}

function walkTo(session: DungeonSession, targetRoomId: string): void {
  // A real run enters its start room before it can move (`DungeonNode.prepareStart` ->
  // `enterCurrentRoom`). Fixtures that walk from the start need that too: when the target is the
  // start room itself the path below is empty, and the room would otherwise stay unexplored.
  session.enterCurrentRoom();
  const floor = session.state;
  const queue: string[] = [floor.currentRoomId];
  const prev = new Map<string, string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === targetRoomId) break;
    const room = floor.rooms.find((entry) => entry.id === id)!;
    for (const link of room.links) {
      const next = link.targetRoomId;
      if (!prev.has(next) && next !== floor.currentRoomId) { prev.set(next, id); queue.push(next); }
    }
  }
  const path: string[] = [];
  for (let id = targetRoomId; id !== floor.currentRoomId;) { path.push(id); id = prev.get(id)!; }
  for (const id of path.reverse()) session.moveToRoom(id);
}

describe("dungeon source equations", () => {
  it("collects only the current RoomNode's visible treasure", () => {
    const base = definition();
    const source: DungeonDefinition = {
      ...base,
      floorPopulations: [{
        ...base.floorPopulations[0]!,
        treasurePopulator: {
          ...base.floorPopulations[0]!.treasurePopulator!,
          unguardedTreasureChance: 1,
        },
      }],
    };
    const session = DungeonSession.create(source, 1, 0x12345678, {
      monsterTypes: ["Slime", "Bat"],
    });
    const remote = session.state.rooms.find((room) =>
      room.id !== session.currentRoom.id && room.treasure !== undefined);
    if (remote?.treasure === undefined) throw new Error("fixture has no remote unguarded treasure");
    expect(() => session.collectTreasure(remote.treasure!.id)).toThrow(/current room/);
    expect(session.snapshot().collectedTreasureIds).toEqual([]);

    walkTo(session, remote.id);
    expect(session.collectTreasure(remote.treasure.id)).toEqual(remote.treasure.loot);
    expect(() => session.collectTreasure(remote.treasure!.id)).toThrow(/not available/);
  });

  it("uses Quest's all-items default and preserves fixed MonsterJoin rewards", () => {
    const data: DungeonTreasureData = {
      levelScalor: 1,
      items: [{
        kind: "fixed",
        levelScalor: 1,
        data: {
          kind: "monsterJoin",
          shortType: "Wolf",
          jobLevel: 2,
          rawType: "DestroyOnPickup.MonsterJoin",
        },
      }],
    };
    expect(generateQuestRewards(data, 1, new MaxRng())).toEqual([{
      kind: "monsterJoin",
      shortType: "Wolf",
      jobLevel: 2,
    }]);
  });

  it("pins roundf, inclusive room counts, challenge scaling, and reserved corners", () => {
    expect(dungeonRoundf(2.5)).toBe(3); expect(dungeonRoundf(-2.5)).toBe(-3);
    expect(dungeonTargetRoomCount({ roomsMin: 20, roomsMax: 30 }, new MaxRng())).toBe(30);
    expect(dungeonTargetRoomCount(
      { roomsMin: 8, roomsMax: 8 },
      new ScriptedRng([]),
    )).toBe(8);
    expect(dungeonChallengeLevel(definition(), 1)).toBe(18);
    expect(dungeonChallengeLevel(definition(), 3)).toBe(22);
    expect(dungeonPointIsReserved(2, 2, 0, 0)).toBe(false);
    expect(dungeonPointIsReserved(2, 2, 1, 0)).toBe(true);
    expect(dungeonPointIsReserved(1, 4, 0, 1)).toBe(true);
  });

  it("uses exact authored endpoint zones and synthesizes native intermediary stairs", () => {
    const endpointDefinition: DungeonDefinition = {
      ...definition(),
      creation: { ...definition().creation, lastFloor: 4 },
      floorPopulations: [
        {
          sourceFloor: 1,
          hasAuthoredZoneChanges: true,
          zoneChanges: [{ kind: "stairsDown", sourceType: "Down" }],
        },
        {
          sourceFloor: 4,
          hasAuthoredZoneChanges: true,
          zoneChanges: [{ kind: "stairsUp", sourceType: "Up" }],
        },
      ],
    };
    expect(dungeonZoneChangesForFloor(endpointDefinition, 1).map((change) => change.kind))
      .toEqual(["stairsDown"]);
    expect(dungeonZoneChangesForFloor(endpointDefinition, 2).map((change) => change.kind))
      .toEqual(["stairsUp", "stairsDown"]);
    expect(dungeonZoneChangesForFloor(endpointDefinition, 3).map((change) => change.kind))
      .toEqual(["stairsUp", "stairsDown"]);
    expect(dungeonZoneChangesForFloor(endpointDefinition, 4).map((change) => change.kind))
      .toEqual(["stairsUp"]);

    for (const floorNumber of [1, 2, 3, 4]) {
      const floor = generateDungeonFloor(endpointDefinition, floorNumber, floorNumber, {
        monsterTypes: ["Slime"],
      });
      expect(floor.rooms.flatMap((room) => room.zones.map((zone) => zone.change.kind)).sort())
        .toEqual(dungeonZoneChangesForFloor(endpointDefinition, floorNumber)
          .map((change) => change.kind).sort());
    }
  });

  it("inherits sparse monster and treasure populators independently", () => {
    const base = definition();
    const first = base.floorPopulations[0]!;
    const split: DungeonDefinition = {
      ...base,
      floorPopulations: [
        {
          sourceFloor: 1,
          treasurePopulator: {
            ...first.treasurePopulator!,
            unguardedTreasureChance: 1,
          },
          zoneChanges: [],
        },
        {
          sourceFloor: 4,
          monsterPopulator: first.monsterPopulator!,
          zoneChanges: [],
        },
      ],
    };
    expect(dungeonPopulationForFloor(split, 4, "monsterPopulator")?.sourceFloor).toBe(4);
    expect(dungeonPopulationForFloor(split, 4, "treasurePopulator")?.sourceFloor).toBe(1);
    expect(dungeonPopulationForFloor(split, 4)?.sourceFloor).toBe(4);
    expect(dungeonPopulationForFloor(split, 4)?.treasurePopulator).toBeUndefined();

    const sourceFloor = generateDungeonFloor(split, 4, 0x12345678, {
      monsterTypes: ["Slime", "Bat"],
    });
    const legacyFloor = generateDungeonFloor(split, 4, 0x12345678, {
      monsterTypes: ["Slime", "Bat"],
      legacyWholeRowPopulationSelection: true,
    });
    expect(sourceFloor.rooms.some(({ treasure }) => treasure !== undefined)).toBe(true);
    expect(legacyFloor.rooms.some(({ treasure }) => treasure !== undefined)).toBe(false);
  });

  it("pins native treasure scaling, currency quantities, weighted random categories, and Gem rolls", () => {
    expect(dungeonTreasureChallengeLevel(21, 0.5, undefined)).toBe(10);
    expect(dungeonTreasureChallengeLevel(21, 0.5, 7)).toBe(7);
    expect(dungeonAdjustedTreasureLevel(20, 0.5)).toBe(30);
    expect(dungeonAdjustedTreasureLevel(20, -0.5)).toBe(13);

    // Native converts the uint32-scaled unit draw to float32 before its strict chance comparison.
    expect(Math.fround(1 - 2 ** -24) < Math.fround(1)).toBe(true);
    expect(Math.fround(1 - 2 ** -26) < Math.fround(1)).toBe(false);

    expect(dungeonSilverQuantityForLevel(1, new ScriptedRng([0]))).toBe(13);
    expect(dungeonSilverQuantityForLevel(100, new ScriptedRng([0.5]))).toBe(604);
    expect(dungeonSilverQuantityForLevel(120, new MaxRng())).toBe(768);
    expect([1, 39, 40, 999].map(dungeonGoldQuantityForLevel)).toEqual([1, 1, 2, 20]);

    expect(dungeonRandomTreasureKind(new ScriptedRng([0]))).toBe("gold");
    expect(dungeonRandomTreasureKind(new ScriptedRng([1 / 17]))).toBe("silver");
    expect(dungeonRandomTreasureKind(new MaxRng())).toBe("gem");
    expect(dungeonGemSlotWeights(20)).toEqual([30, 0, 0, 0]);
    expect(dungeonGemSlotWeights(61)).toEqual([30, 13, 9, 7]);
    expect(dungeonRandomGemForLevel(63, new MaxRng())).toEqual({
      kind: "gem", level: 63, quality: 1, slot: 3, enabledStats: ["Resist", "MaxHP"],
    });
    const duplicateStatRng = new ScriptedRng([0.99, 0, 0, 0]);
    const gem = dungeonRandomGemForLevel(11, duplicateStatRng);
    expect(gem).toEqual({
      kind: "gem", level: 11, quality: 1, slot: 0, enabledStats: ["MaxHP", "Attack"],
    });
    expect(() => duplicateStatRng.next()).toThrow("ScriptedRng exhausted");
    expect(dungeonGemBonusForStat(gem, "MaxHP")).toBe(11);
    expect(dungeonGemBonusForStat(gem, "Defense")).toBe(0);
    expect(dungeonGemBonusForStat({ level: 11, enabledStats: ["Defense"] }, "Defense")).toBe(16.5);
    expect([1, 11, 12, 59, 60, 99].map(dungeonGemItemTier)).toEqual([1, 1, 2, 5, 6, 6]);
  });

  it("projects effective spawn chances without changing the generation path", () => {
    const data: DungeonTreasureData = {
      levelScalor: 1,
      defaultSpawnChance: 0.25,
      items: [
        { kind: "silver", chance: 0, levelScalor: 1 },
        { kind: "gold", levelScalor: 1 },
        { kind: "silver", chance: 0.75, levelScalor: 1 },
      ],
    };
    expect(data.items.map((spawn) => dungeonTreasureSpawnChance(data, spawn, 1)))
      .toEqual([0, 1, 0.75]);
    expect(dungeonTreasureSpawnChance(data, data.items[1]!)).toBe(0.25);
  });

  it("projects quest random and randomGem presentation through the source gem math", () => {
    expect(dungeonGemPresentationProjection(
      { levelScalor: 0.01 },
      { kind: "randomGem", levelScalor: 1 },
    )).toEqual({ level: 1, tier: 1, maxSlot: 0 });
    expect(dungeonGemPresentationProjection(
      { levelScalor: 20 },
      { kind: "random", levelScalor: 1 },
    )).toEqual({ level: 20, tier: 2, maxSlot: 0 });
    expect(dungeonGemPresentationProjection(
      { levelScalor: 21 },
      { kind: "randomGem", levelScalor: 1 },
    )).toEqual({ level: 21, tier: 2, maxSlot: 1 });
    expect(dungeonGemPresentationProjection(
      { levelScalor: 1, challengeLevelOverride: 41 },
      { kind: "randomGem", levelScalor: 1 },
    )).toEqual({ level: 41, tier: 4, maxSlot: 2 });
    expect(dungeonGemPresentationProjection(
      { levelScalor: 999, challengeLevelOverride: 61 },
      { kind: "random", levelScalor: 1 },
    )).toEqual({ level: 61, tier: 6, maxSlot: 3 });
    expect(dungeonGemPresentationProjection(
      { levelScalor: 999 },
      { kind: "randomGem", levelScalor: 999 },
    )).toEqual({ level: 998001, tier: 6, maxSlot: 3 });
  });

  it("generates the native spacer-grid tree with reciprocal offsets and populations", () => {
    const floor = generateDungeonFloor(definition(), 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    // The source checks the target before processing a parent, so density may overshoot it.
    expect(floor.rooms).toHaveLength(9);
    expect(floor.diagnostics.map((item) => item.code)).not.toContain("topology-order-approximation");
    expect(floor.rooms.every((room) =>
      room.rotation === 0 && room.id === `${room.templateKey}-{${room.x}, ${room.y}}`
    )).toBe(true);
    expect(floor.rooms.reduce((sum, room) => sum + room.links.length, 0)).toBe(
      2 * (floor.rooms.length - 1),
    );
    expect(floor.rooms.some((room) => room.encounter?.kind === "fixed")).toBe(true);
    const reachable = new Set<string>();
    const queue = [floor.startRoomId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const room = floor.rooms.find((candidate) => candidate.id === id)!;
      for (const link of room.links) queue.push(link.targetRoomId);
    }
    expect(reachable.size).toBe(floor.rooms.length);
    for (const room of floor.rooms) for (const link of room.links) {
      const target = floor.rooms.find((candidate) => candidate.id === link.targetRoomId)!;
      expect(target.links.some((reverse) => reverse.targetRoomId === room.id)).toBe(true);
      const onBoundary = link.offset.x === -1 || link.offset.x === room.width ||
        link.offset.y === -1 || link.offset.y === room.height;
      expect(onBoundary).toBe(true);
    }
  });

  it("always makes the first primary placement attempt before retryChance gates repeats", () => {
    const source = definition();
    const twoRoomDefinition: DungeonDefinition = {
      ...source,
      creation: {
        ...source.creation,
        roomsMin: 2,
        roomsMax: 2,
        waypointEvery: 0,
        density: 3,
        retryChance: 0.3,
        roomTemplates: [source.creation.roomTemplates[0]!],
      },
      floorPopulations: [],
    };
    const calls: Array<{ readonly kind: "next" | "intBelow"; readonly n?: number }> = [];
    const inner = touchHleArc4Random(0, 0);
    const recording = {
      next: () => { calls.push({ kind: "next" }); return inner.next(); },
      intBelow: (n: number) => {
        calls.push({ kind: "intBelow", n });
        return inner.intBelow(n);
      },
      chance: (p: number) => inner.chance(p),
      fork: () => inner.fork(),
    };

    const floor = generateDungeonFloor(twoRoomDefinition, 1, 0x20260821, {
      monsterTypes: ["Slime"],
      fidelityRng: recording,
    });

    // Calls 1/2 choose the sole initial room and parent. Call 3 is ~0.616, above the 0.3 retry
    // chance. Native still enters attempt zero and chooses one of the eight attachment points;
    // only a later attempt is refused. The old entry-gate port instead restarted in addMore and
    // made another one-element parent draw here.
    expect(calls.slice(0, 4)).toEqual([
      { kind: "intBelow", n: 1 },
      { kind: "intBelow", n: 1 },
      { kind: "next" },
      { kind: "intBelow", n: 8 },
    ]);
    expect(floor.rooms).toHaveLength(2);
  });

  it("uses removeRandomElement's inclusive cumulative boundary for topology templates", () => {
    const source = definition();
    const first = { ...source.creation.roomTemplates[0]!, key: "first", frequency: 1 };
    const second = { ...source.creation.roomTemplates[0]!, key: "second", frequency: 1 };
    const intReturns = [0, 0, 0, 1, 4, 0];
    const intCalls: Array<{ readonly n: number; readonly value: number }> = [];
    const scripted: ForkableRng = {
      next: () => 0.9,
      intBelow: (n: number) => {
        const value = intReturns.shift() ?? 0;
        if (value >= n) throw new Error(`scripted int ${value} is outside ${n}`);
        intCalls.push({ n, value });
        return value;
      },
      chance: () => false,
      fork: () => scripted,
    };
    const floor = generateDungeonFloor({
      ...source,
      creation: {
        ...source.creation,
        roomsMin: 2,
        roomsMax: 2,
        waypointEvery: 0,
        density: 1,
        retryChance: 0,
        roomTemplates: [first, second],
      },
      floorPopulations: [],
    }, 1, 0x20260821, {
      monsterTypes: ["Slime"],
      fidelityRng: scripted,
    });

    // The fourth integer draw is roll 1 over cumulative weights [1,2]. Native's destructive
    // picker selects the first cumulative value >= roll, so the boundary belongs to `first`.
    // A conventional strictly-greater weighted picker selects `second` here.
    expect(intCalls.slice(0, 4)).toEqual([
      { n: 2, value: 0 },
      { n: 1, value: 0 },
      { n: 8, value: 0 },
      { n: 2, value: 1 },
    ]);
    expect(floor.rooms[1]!.templateKey).toBe("first");
  });

  it("uses WeightedRandomList's modulo bucket for ordinary dungeon monster species", () => {
    const types = [
      { type: "BatSquirrel", chance: 100 },
      { type: "GiantWasp", chance: 100 },
      { type: "Bitewing", chance: 100 },
      { type: "Sludge", chance: 100 },
      { type: "Penguin", chance: 50 },
      { type: "GiantTurtle", chance: 50 },
      { type: "FireCub", chance: 10 },
      { type: "SnowCub", chance: 10 },
    ];
    const raw = 0xeb15d721;
    const calls: number[] = [];
    const rng: Rng = {
      // Scaling this unit value by 520 would pick GiantTurtle. Native does raw % 520 = 329,
      // which is Sludge's bucket.
      next: () => raw / 0x1_0000_0000,
      intBelow: (n) => { calls.push(n); return raw % n; },
      chance: () => false,
    };
    expect(dungeonWeightedMonsterType(types, rng)).toBe("Sludge");
    expect(calls).toEqual([520]);
  });

  it("preserves the native nonHallwaysNeeded counter inversion at the third child", () => {
    const source = definition();
    const calls: Array<{ readonly kind: "next" | "intBelow"; readonly n?: number }> = [];
    const inner = touchHleArc4Random(0xb4b84b8a);
    const recording: ForkableRng = {
      next: () => { calls.push({ kind: "next" }); return inner.next(); },
      intBelow: (n) => { calls.push({ kind: "intBelow", n }); return inner.intBelow(n); },
      chance: (p) => inner.chance(p),
      fork: () => recording,
    };
    generateDungeonFloor({
      ...source,
      creation: {
        ...source.creation,
        roomsMin: 20,
        roomsMax: 30,
        density: 3,
        retryChance: 0.3,
        nonHallwaysNeeded: 2,
        waypointEvery: 0,
        roomChoiceBiasClass: "DirectedRoomChoiceBias",
        roomChoiceBiasDirection: { x: 0, y: 2 },
        roomTemplates: [
          { key: "Cave.Cave1x2", width: 1, height: 2, frequency: 15, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
          { key: "Cave.Cave2x2", width: 2, height: 2, frequency: 10, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
          { key: "Cave.Cave2x4", width: 2, height: 4, frequency: 15, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
          { key: "Cave.Cave4x2", width: 4, height: 2, frequency: 15, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
          { key: "Cave.Cave4x4", width: 4, height: 4, frequency: 4, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
        ],
      },
      floorPopulations: [],
    }, 1, 271576668, {
      monsterTypes: ["Slime"],
      fidelityRng: recording,
      fidelityFoundationOrder: "lexicographic",
    });

    // Global calls 14..29 match the live managed North Cave trace. Both successful children are
    // non-hallways, so the source counter is still 2 and call 30 must be the `% 5` reselect gate.
    // The former port decremented for those rooms and used call 30 as a placement-origin `% 4`.
    expect(calls.slice(0, 17).map((entry) => entry.kind === "next" ? "next" : entry.n)).toEqual([
      11, 5, 1000, "next", 2576, 59, 5, 8, 1576, 59, 5, 4, 3, 1549, 549, 59, 5,
    ]);
  });

  it("pins the DirectedRoomChoiceBias inverse-square room weights", () => {
    const candidates = [0, 5, 10, 15].map((x) => ({ x, y: 0, width: 2, height: 2 }));
    expect(dungeonDirectedRoomChoiceWeights(candidates, { x: 1, y: 0 })).toEqual([
      3, 8, 27, 1000,
    ]);
    expect(dungeonDirectedRoomChoiceWeights(candidates, { x: 0, y: 0 })).toEqual([
      1000, 1000, 1000, 1000,
    ]);
    expect(dungeonDirectedRoomChoiceWeights(
      [0, 5, 10, 15].map((x) => ({ x, y: 0, width: 0, height: 0 })),
      { x: 1, y: 0 },
    )).toEqual([1, 1, 2, 1000]);
    // `buildRoomPointBias:` turns point keys into unit CGRects, not zero-area rectangles.
    expect(dungeonDirectedRoomChoiceWeights([
      { x: -2, y: 0, width: 1, height: 1 },
      { x: 0, y: -2, width: 1, height: 1 },
      { x: 0, y: 5, width: 1, height: 1 },
      { x: 5, y: 0, width: 1, height: 1 },
    ], { x: 0, y: 2 })).toEqual([58, 42, 1000, 58]);
    // `nextRoomToConnectTo:` supplies the first frontier room's center while the common helper
    // seeds its extrema with CGPointZero. These are the exact cumulative-list components observed
    // at global calls 41 and 50 in the managed North Cave native trace.
    expect(dungeonDirectedRoomChoiceWeights([
      { x: -3, y: 3, width: 2, height: 2 },
      { x: 0, y: 5, width: 2, height: 4 },
      { x: 3, y: 5, width: 2, height: 4 },
    ], { x: 0, y: 2 }, { x: 1, y: 7 })).toEqual([310, 1000, 692]);
    expect(dungeonDirectedRoomChoiceWeights([
      { x: -1, y: 10, width: 4, height: 2 },
      { x: -3, y: 3, width: 2, height: 2 },
      { x: 3, y: 5, width: 2, height: 4 },
    ], { x: 0, y: 2 }, { x: -2, y: 4 })).toEqual([1000, 277, 222]);
  });

  it("preserves reciprocal offset links without activating the dormant cycle-door helper", () => {
    const graphDefinition: DungeonDefinition = {
      ...definition(),
      creation: {
        ...definition().creation,
        roomsMin: 20, roomsMax: 20, doorCycleAttempts: 0.3, nonHallwaysNeeded: 2,
        roomChoiceBiasClass: "DirectedRoomChoiceBias",
        roomChoiceBiasDirection: { x: 0, y: 2 },
        roomTemplates: [
          { key: "1x2", width: 1, height: 2, frequency: 15, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
          { key: "2x2", width: 2, height: 2, frequency: 10, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
          { key: "2x4", width: 2, height: 4, frequency: 15, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
          { key: "4x2", width: 4, height: 2, frequency: 15, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
          { key: "4x4", width: 4, height: 4, frequency: 4, rotations: [0], rendererClass: "RoomNode", anchor: { x: 0, y: 0 } },
        ],
      },
    };
    const floor = generateDungeonFloor(graphDefinition, 4, 286657286, { monsterTypes: ["Slime", "Bat"] });


    expect(floor.rooms.slice(0, 6).map((room) => room.id)).toEqual([
      "4x2-{0, 0}",
      "2x4-{3, 3}",
      "2x2-{3, 8}",
      "1x2-{3, 11}",
      "2x4-{3, 14}",
      "1x2-{3, 19}",
    ]);
    const frozenOfficialFloor = generateDungeonFloor(graphDefinition, 4, 286657286, {
      monsterTypes: ["Slime", "Bat"],
      legacyDungeonGenerationSemantics: true,
    });
    expect(frozenOfficialFloor.rooms.slice(0, 6).map((room) => room.id)).toEqual([
      "4x2-{0, 0}",
      "4x2-{2, 3}",
      "2x4-{2, -5}",
      "2x4-{-1, 3}",
      "4x2-{-3, -3}",
      "2x2-{-3, 0}",
    ]);
    const labFloor = generateDungeonFloor(graphDefinition, 4, 286657286, {
      monsterTypes: ["Slime", "Bat"],
      fidelityFoundationOrder: "lexicographic",
    });
    expect(labFloor.rooms.slice(0, 6).map((room) => room.id)).toEqual(
      floor.rooms.slice(0, 6).map((room) => room.id),
    );
    const normalizedSeedZero = generateDungeonFloor(graphDefinition, 4, 0, {
      monsterTypes: ["Slime", "Bat"],
      fidelityFoundationOrder: "lexicographic",
    });
    expect(normalizedSeedZero.rooms.slice(0, 6).map((room) => room.id)).toEqual([
      "2x2-{0, 0}",
      "2x4-{-1, 3}",
      "4x2-{-5, -1}",
      "4x2-{3, 1}",
      "1x2-{-1, 8}",
      "2x4-{-1, 11}",
    ]);
    const reachable = new Set<string>();
    const queue = [floor.startRoomId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const room = floor.rooms.find((candidate) => candidate.id === id)!;
      for (const link of room.links) queue.push(link.targetRoomId);
    }
    expect(reachable.size).toBe(floor.rooms.length);
    expect(floor.rooms.reduce((sum, room) => sum + room.links.length, 0)).toBe(
      2 * (floor.rooms.length - 1),
    );
    for (const room of floor.rooms) for (const link of room.links) {
      expect(floor.rooms.find((candidate) => candidate.id === link.targetRoomId)?.links
        .some((reverse) => reverse.targetRoomId === room.id)).toBe(true);
    }
  });

  it("orders waypoint, encounter, then chest without inventing a global floor-clear gate", () => {
    const session = DungeonSession.create(definition(), 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    session.arriveAtWaypoint();
    const first = session.enterCurrentRoom();
    expect(first[0]?.kind).toBe("waypoint");
    const actionOrder = first.map((action) => action.kind);
    expect(actionOrder).toEqual([...actionOrder].sort((left, right) =>
      ["waypoint", "encounter", "treasure"].indexOf(left) -
      ["waypoint", "encounter", "treasure"].indexOf(right)));
    session.registerWaypoint();
    const zoneRoom = session.state.rooms.find((room) => room.zones.length > 0)!;
    walkTo(session, zoneRoom.id);
    expect(session.activateZone(zoneRoom.zones[0]!.id).kind).not.toBe("blocked");
  });

  it("drops a fixed reward whose chance failed and falls back to the floor's guarded treasure", () => {





    const source = definition();
    const missed: DungeonDefinition = { ...source, floorPopulations: [{ ...source.floorPopulations[0]!,
      monsterPopulator: { ...source.floorPopulations[0]!.monsterPopulator!,
        fixedEncounters: [{ ...source.floorPopulations[0]!.monsterPopulator!.fixedEncounters[0]!,
          treasureData: { levelScalor: 1, challengeLevelOverride: 200,
            items: [{ kind: "silver", chance: 0, levelScalor: 1 }] } }] } }] };
    const floor = generateDungeonFloor(missed, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const room = floor.rooms.find((entry) => entry.encounter?.kind === "fixed")!;
    expect(room.encounter?.treasure?.id).toMatch(/^treasure-random-/);
    expect(room.encounter?.treasure?.loot).toHaveLength(1);
    // The fallback is the floor populator's own level-1 scaling, never the authored 200.
    expect(room.encounter!.treasure!.loot[0]).toMatchObject({ kind: "silver" });
    expect((room.encounter!.treasure!.loot[0] as { amount: number }).amount)
      .toBeLessThan(dungeonSilverQuantityForLevel(200, new MaxRng()));

    // With the floor's own treasure silenced too, the room must end up with no chest whatsoever —
    // not a retained zero-loot one, which would render `chest.png` and open an empty loot page.
    const barren: DungeonDefinition = { ...missed, floorPopulations: [{ ...missed.floorPopulations[0]!,
      treasurePopulator: { ...missed.floorPopulations[0]!.treasurePopulator!,
        treasureData: { levelScalor: 1, items: [{ kind: "silver", chance: 0, levelScalor: 1 }] } } }] };
    const barrenFloor = generateDungeonFloor(barren, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const barrenRoom = barrenFloor.rooms.find((entry) => entry.encounter?.kind === "fixed")!;
    expect(barrenRoom.encounter?.treasure).toBeUndefined();
    expect(barrenRoom.treasure).toBeUndefined();
  });

  it("keeps an authored fixed reward instead of letting the ordinary treasure pass overwrite it", () => {
    const source = definition();
    const hit: DungeonDefinition = { ...source, floorPopulations: [{ ...source.floorPopulations[0]!,
      monsterPopulator: { ...source.floorPopulations[0]!.monsterPopulator!,
        fixedEncounters: [{ ...source.floorPopulations[0]!.monsterPopulator!.fixedEncounters[0]!,
          treasureData: { levelScalor: 1, challengeLevelOverride: 200,
            items: [{ kind: "silver", chance: 1, levelScalor: 1 }] } }] } }] };
    const floor = generateDungeonFloor(hit, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const room = floor.rooms.find((entry) => entry.encounter?.kind === "fixed")!;
    expect(room.encounter?.treasure?.id).toMatch(/^treasure-fixed-/);
    // `+[Silver quantityForLevel:200]` spans trunc(6000^0.8) * [0.9, 1.1) = 947..1157.
    const amount = (room.encounter!.treasure!.loot[0] as { amount: number }).amount;
    expect(amount).toBeGreaterThanOrEqual(947);
    expect(amount).toBeLessThanOrEqual(1157);
  });

  it("excludes waypoint and zone-change rooms from monster and treasure population", () => {
    // `customizeRooms:` removes these rooms from its mutable working list before both population
    // phases. The treasure loop's local dimension/items checks therefore never see them.
    for (const seed of [0x12345678, 77, 286657286, 20260724, 5]) {
      const source = definition();
      const population = source.floorPopulations[0]!;
      const floor = generateDungeonFloor({
        ...source,
        floorPopulations: [{
          ...population,
          treasurePopulator: {
            ...population.treasurePopulator!,
            unguardedTreasureChance: 1,
          },
        }],
      }, 1, seed, { monsterTypes: ["Slime", "Bat"] });
      const waypoint = floor.rooms.find((room) => room.waypoint);
      expect(waypoint, `seed ${seed}: waypointEvery 1 must place a waypoint`).toBeDefined();
      expect(waypoint!.encounter, `seed ${seed}: waypoint encounter`).toBeUndefined();
      expect(waypoint!.treasure, `seed ${seed}: waypoint treasure`).toBeUndefined();
      for (const zoneRoom of floor.rooms.filter((room) => room.zones.length > 0)) {
        expect(zoneRoom.encounter, `seed ${seed}: zone encounter`).toBeUndefined();
        expect(zoneRoom.treasure, `seed ${seed}: zone treasure`).toBeUndefined();
      }
    }
  });

  it("preserves WeightedRandomList extremal slot order for directed zone picks", () => {
    const descending = [5, 4, 3, 2].map((weight, index) => ({ index, weight }));
    expect(dungeonExtremalWeightPool(descending, 3, "lowest")).toEqual([
      { index: 3, weight: 2 },
    ]);
    const ascending = [2, 3, 4, 5].map((weight, index) => ({ index, weight }));
    expect(dungeonExtremalWeightPool(ascending, 3, "highest")).toEqual([
      { index: 3, weight: 5 },
      { index: 1, weight: 3 },
      { index: 2, weight: 4 },
    ]);
    // Strict source comparisons reject a later tie until a genuinely better value arrives; that
    // replacement occupies the original slot rather than producing a sorted output array.
    const tied = [1, 1, 1, 0].map((weight, index) => ({ index, weight }));
    expect(dungeonExtremalWeightPool(tied, 3, "lowest")).toEqual([
      { index: 3, weight: 0 },
      { index: 1, weight: 1 },
      { index: 2, weight: 1 },
    ]);
  });

  it("spends one pack slot per encounter so a fixed entry replaces an ordinary pack", () => {
    // The native loop runs exactly `numberOfMonsterPacksToAddWithRoomCount:` iterations and each
    // one calls `buildEncounterDataForChallengeLevel:` once, which returns either the next fixed
    // entry or a fresh ordinary pack — never both.  Placing fixed encounters *in addition to* a
    // full complement of ordinary packs overpopulates every floor in the game.
    for (const seed of [0x12345678, 77, 5, 20260724]) {
      const floor = generateDungeonFloor(definition(), 1, seed, { monsterTypes: ["Slime", "Bat"] });
      const eligible = floor.rooms.filter((room) => room.zones.length === 0 && !room.waypoint);
      const encounters = floor.rooms.filter((room) => room.encounter !== undefined);
      expect(encounters, `seed ${seed}: encounter count`)
        .toHaveLength(dungeonRoundf(eligible.length * 0.5));
      expect(encounters.filter((room) => room.encounter!.kind === "fixed"),
        `seed ${seed}: the single authored entry`).toHaveLength(1);
    }
  });

  it("tests only as many authored fixed entries as there are pack slots", () => {


    const source = definition();
    const crowded: DungeonDefinition = { ...source, floorPopulations: [{ ...source.floorPopulations[0]!,
      monsterPopulator: { ...source.floorPopulations[0]!.monsterPopulator!, density: .2,
        fixedEncounters: [
          { sourceIndex: 0, monsters: [{ type: "Bat", levelScalor: 1 }], exactFloor: 1, chanceToAppear: 1, uniqueKey: "first" },
          { sourceIndex: 1, monsters: [{ type: "Bat", levelScalor: 1 }], exactFloor: 1, chanceToAppear: 1, uniqueKey: "second" },
        ] } }] };
    const floor = generateDungeonFloor(crowded, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const encounters = floor.rooms.filter((room) => room.encounter !== undefined);
    const eligible = floor.rooms.filter((room) => room.zones.length === 0 && !room.waypoint);
    expect(encounters).toHaveLength(dungeonRoundf(eligible.length * .2));
    expect(encounters.map((room) => room.encounter!.completionKey)).toEqual(["first"]);
  });

  it("leaves a fixed encounter without an authored uniqueKey durably repeatable", () => {


    const source = definition();
    const keyless: DungeonDefinition = { ...source, floorPopulations: [{ ...source.floorPopulations[0]!,
      monsterPopulator: { ...source.floorPopulations[0]!.monsterPopulator!,
        fixedEncounters: [{ sourceIndex: 0, monsters: [{ type: "Bat", levelScalor: 1 }], exactFloor: 1, chanceToAppear: 1 }] } }] };
    const floor = generateDungeonFloor(keyless, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const fixed = floor.rooms.find((room) => room.encounter?.kind === "fixed");
    expect(fixed).toBeDefined();
    expect(fixed!.encounter!.completionKey).toBeUndefined();

    // A cadence entry still keys off the authored name plus its quotient.
    const cadence: DungeonDefinition = { ...source, floorPopulations: [{ ...source.floorPopulations[0]!,
      monsterPopulator: { ...source.floorPopulations[0]!.monsterPopulator!,
        fixedEncounters: [{ sourceIndex: 0, monsters: [{ type: "Bat", levelScalor: 1 }], exactFloor: 1,
          everyXFloors: 2, chanceToAppear: 1, uniqueKey: "Fafnir" }] } }] };
    const third = generateDungeonFloor(cadence, 3, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    expect(third.rooms.find((room) => room.encounter?.kind === "fixed")?.encounter?.completionKey)
      .toBe("Fafnir1");
    const second = generateDungeonFloor(cadence, 2, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    expect(second.rooms.some((room) => room.encounter?.kind === "fixed")).toBe(false);
  });

  it("keeps the dormant mustClearFloor branch limited to forward-floor zones", () => {
    const gated = { ...definition(), mustClearFloor: true };
    const downSession = DungeonSession.create(gated, 2, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const downRoom = downSession.state.rooms.find((room) =>
      room.zones.some((zone) => zone.change.kind === "stairsDown"))!;
    walkTo(downSession, downRoom.id);
    const down = downSession.currentRoom.zones.find((zone) => zone.change.kind === "stairsDown")!;
    expect(downSession.activateZone(down.id)).toMatchObject({
      kind: "blocked",
      reason: "mustClearFloor",
    });

    const upSession = DungeonSession.create(gated, 2, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const upRoom = upSession.state.rooms.find((room) =>
      room.zones.some((zone) => zone.change.kind === "stairsUp"))!;
    walkTo(upSession, upRoom.id);
    const up = upSession.currentRoom.zones.find((zone) => zone.change.kind === "stairsUp")!;
    expect(upSession.activateZone(up.id)).toMatchObject({ kind: "stairs", direction: "up" });
  });

  it("restores deterministic geometry and all durable floor state from a JSON-safe snapshot", () => {
    const original = DungeonSession.create(definition(), 1, 77, { monsterTypes: ["Slime", "Bat"] });
    original.arriveAtWaypoint(); original.enterCurrentRoom(); original.registerWaypoint();
    const snapshot = JSON.parse(JSON.stringify(original.snapshot()));
    const restored = DungeonSession.restore(definition(), snapshot, { monsterTypes: ["Slime", "Bat"] });
    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restored.state.rooms.map(({ id, x, y, links }) => ({ id, x, y, links })))
      .toEqual(original.state.rooms.map(({ id, x, y, links }) => ({ id, x, y, links })));
  });

  it("repositions arrivals without consuming room-entry actions", () => {
    const session = DungeonSession.create(definition(), 1, 88, { monsterTypes: ["Slime", "Bat"] });
    session.arriveFromStairs("down");
    expect(session.currentRoom.zones.some((zone) => zone.change.kind === "stairsUp")).toBe(true);
    session.arriveFromStairs("up");
    expect(session.currentRoom.zones.some((zone) => zone.change.kind === "stairsDown")).toBe(true);
    session.arriveAtWaypoint();
    expect(session.currentRoom.waypoint).toBe(true);
    expect(session.enterCurrentRoom()[0]?.kind).toBe("waypoint");
  });

  it("materializes the actual waypoint arrival trail rather than the generated start room", () => {
    const session = DungeonSession.create(definition(), 1, 88, { monsterTypes: ["Slime", "Bat"] });
    expect(session.state.rooms.some((room) => room.explored)).toBe(false);

    session.arriveAtWaypoint();
    const waypoint = session.currentRoom;
    expect(waypoint.waypoint).toBe(true);
    expect(session.state.rooms.some((room) => room.explored)).toBe(false);

    session.enterCurrentRoom();
    const expected = new Set([
      waypoint.id,
      ...(waypoint.encounter === undefined
        ? waypoint.links.map((link) => link.targetRoomId)
        : []),
    ]);
    expect(new Set(
      session.state.rooms.filter((room) => room.explored).map((room) => room.id),
    )).toEqual(expected);
  });

  it("selects any materialized room with native same-room, door-walk, and fade-teleport results", () => {
    const generated = DungeonSession.create(definition(), 1, 0x12345678, {
      monsterTypes: ["Slime", "Bat"],
    });
    const allRoomIds = generated.state.rooms.map((room) => room.id);
    const restoredSnapshot = {
      ...generated.snapshot(),
      exploredRoomIds: allRoomIds,
    };

    const directSession = DungeonSession.restore(definition(), restoredSnapshot, {
      monsterTypes: ["Slime", "Bat"],
    });
    const directId = directSession.currentRoom.links[0]!.targetRoomId;
    expect(directSession.selectMaterializedRoom(directId)).toMatchObject({
      kind: "changed-room",
      transition: "door-walk",
      fromRoomId: generated.state.currentRoomId,
      toRoomId: directId,
    });

    const remoteSession = DungeonSession.restore(definition(), restoredSnapshot, {
      monsterTypes: ["Slime", "Bat"],
    });
    const current = remoteSession.currentRoom;
    const directIds = new Set(current.links.map((link) => link.targetRoomId));
    const remote = remoteSession.state.rooms.find((room) =>
      room.id !== current.id && !directIds.has(room.id))!;
    expect(remoteSession.selectMaterializedRoom(current.id)).toEqual({
      kind: "same-room",
      roomId: current.id,
    });
    const selected = remoteSession.selectMaterializedRoom(remote.id);
    expect(selected).toMatchObject({
      kind: "changed-room",
      transition: "fade-teleport",
      fromRoomId: current.id,
      toRoomId: remote.id,
    });
    expect(selected.kind === "changed-room" && selected.actions.every((action) => action.roomId === remote.id))
      .toBe(true);
  });

  it("rejects unmaterialized room touches and retreats to the immediately previous remote selection", () => {
    const generated = DungeonSession.create(definition(), 1, 0x12345678, {
      monsterTypes: ["Slime", "Bat"],
    });
    const hidden = generated.state.rooms.find((room) => !room.explored);
    if (hidden !== undefined) {
      expect(() => generated.selectMaterializedRoom(hidden.id)).toThrow(/not materialized/);
      expect(generated.state.currentRoomId).toBe(generated.snapshot().currentRoomId);
    }

    const rooms = generated.state.rooms;
    const pair = rooms.flatMap((from) => {
      const direct = new Set(from.links.map((link) => link.targetRoomId));
      return rooms
        .filter((to) => to.encounter !== undefined && to.id !== from.id && !direct.has(to.id))
        .map((to) => ({ from, to }));
    })[0]!;
    const session = DungeonSession.restore(definition(), {
      ...generated.snapshot(),
      currentRoomId: pair.from.id,
      exploredRoomIds: rooms.map((room) => room.id),
    }, { monsterTypes: ["Slime", "Bat"] });
    expect(session.selectMaterializedRoom(pair.to.id)).toMatchObject({ transition: "fade-teleport" });
    session.resolveEncounter(pair.to.encounter!.id, "retreat");
    expect(session.state.currentRoomId).toBe(pair.from.id);
  });

  it("synchronizes dungeon survivors once and persists the full-healed roster", () => {
    const source = saveMeDefinition();
    const session = DungeonSession.create(source, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const room = session.state.rooms.find((entry) => entry.encounter?.monsters.length === 3)!;
    const prior = session.state.rooms.find((entry) => entry.links.some((link) => link.targetRoomId === room.id))!;
    walkTo(session, prior.id);
    session.moveToRoom(room.id);
    const encounter = session.currentRoom.encounter!;
    const survivor = encounter.monsters[1]!;

    expect(session.synchronizeEncounterRoomRoster(encounter.id, "flow-1", [survivor])).toBe(true);
    expect(() => session.synchronizeEncounterRoomRoster(encounter.id, "flow-1", [])).toThrow(/conflicts/);
    expect(session.currentRoom.encounter?.monsters).toEqual([survivor]);

    const restored = DungeonSession.restore(
      source,
      JSON.parse(JSON.stringify(session.snapshot())),
      { monsterTypes: ["Slime", "Bat"] },
    );
    expect(restored.currentRoom.encounter?.monsters).toEqual([survivor]);
    expect(() => restored.synchronizeEncounterRoomRoster(encounter.id, "flow-1", [])).toThrow(/conflicts/);
  });

  it("returns to the previous room through the distinct retreat resolution", () => {
    const source = saveMeDefinition();
    const session = DungeonSession.create(source, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const room = session.state.rooms.find((entry) => entry.encounter?.monsters.length === 3)!;
    const prior = session.state.rooms.find((entry) => entry.links.some((link) => link.targetRoomId === room.id))!;
    walkTo(session, prior.id);
    session.moveToRoom(room.id);

    session.resolveEncounter(room.encounter!.id, "retreat");
    expect(session.state.currentRoomId).toBe(prior.id);

    const restored = DungeonSession.restore(
      source,
      JSON.parse(JSON.stringify({
        ...session.snapshot(),
        currentRoomId: room.id,
        previousRoomId: prior.id,
        clearedEncounterIds: [],
      })),
      { monsterTypes: ["Slime", "Bat"] },
    );
    restored.resolveEncounter(room.encounter!.id, "retreat");
    expect(restored.state.currentRoomId).toBe(prior.id);
  });

  it("requires previousRoomId to be an explored room distinct from the current room", () => {
    const source = saveMeDefinition();
    const session = DungeonSession.create(source, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const target = session.state.rooms.find((room) => room.links.length > 0)!;
    const previous = session.state.rooms.find((room) =>
      room.id !== target.id && room.links.some((link) => link.targetRoomId === target.id))!;
    const hidden = session.state.rooms.find((room) => !room.explored && room.id !== target.id);
    const base = session.snapshot();
    const restore = (previousRoomId: string | undefined) => DungeonSession.restore(source, {
      ...base,
      currentRoomId: target.id,
      ...(previousRoomId === undefined ? {} : { previousRoomId }),
      exploredRoomIds: [...new Set([...base.exploredRoomIds, target.id, previous.id])],
    }, { monsterTypes: ["Slime", "Bat"] });

    expect(restore(previous.id).state.currentRoomId).toBe(target.id);
    expect(() => restore(target.id)).toThrow(/differ from current room/);
    if (hidden !== undefined) {
      expect(() => DungeonSession.restore(source, {
        ...base,
        currentRoomId: target.id,
        previousRoomId: hidden.id,
        exploredRoomIds: [...new Set([...base.exploredRoomIds, target.id])],
      }, { monsterTypes: ["Slime", "Bat"] })).toThrow(/not explored/);
    }
    expect(() => restore("missing-room")).toThrow(/previous room missing-room is missing/);

    const legacy = structuredClone(base) as unknown as Record<string, unknown>;
    delete legacy.previousRoomId;
    expect(DungeonSession.restore(source, legacy as unknown as typeof base, { monsterTypes: ["Slime", "Bat"] })).toBeDefined();
  });

  it("treats an empty survivor roster as resolved for entry, floor gates, guarded treasure, and restore", () => {
    const source: DungeonDefinition = {
      ...saveMeDefinition(),
      mustClearFloor: true,
      floorPopulations: [{
        ...saveMeDefinition().floorPopulations[0]!,
        monsterPopulator: {
          ...saveMeDefinition().floorPopulations[0]!.monsterPopulator!,
          density: .2,
        },
      }],
    };
    const session = DungeonSession.create(source, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const room = session.state.rooms.find((entry) => entry.encounter?.monsters.length === 3)!;
    const prior = session.state.rooms.find((entry) => entry.links.some((link) => link.targetRoomId === room.id))!;
    const zoneRoom = session.state.rooms.find((entry) => entry.zones.some((zone) =>
      zone.change.kind === "stairsDown"))!;
    const downZone = zoneRoom.zones.find((zone) => zone.change.kind === "stairsDown")!;
    walkTo(session, zoneRoom.id);
    expect(session.activateZone(downZone.id).kind).toBe("blocked");
    walkTo(session, prior.id);
    session.moveToRoom(room.id);
    const encounter = session.currentRoom.encounter!;
    const guardedTreasure = encounter.treasure!;
    expect(session.synchronizeEncounterRoomRoster(encounter.id, "flow-1", [])).toBe(true);
    expect(session.currentRoom.encounter?.monsters).toEqual([]);
    expect(session.enterCurrentRoom().map((action) => action.kind)).toEqual(["treasure"]);
    expect(session.remainingEncounterCount()).toBe(0);
    expect(session.collectTreasure(guardedTreasure.id)).toHaveLength(1);
    walkTo(session, zoneRoom.id);
    expect(session.activateZone(downZone.id).kind).not.toBe("blocked");

    const saved = session.snapshot();
    const restored = DungeonSession.restore(source, JSON.parse(JSON.stringify(saved)), {
      monsterTypes: ["Slime", "Bat"],
    });
    expect(restored.remainingEncounterCount()).toBe(0);
    expect(restored.state.rooms.find((entry) => entry.id === room.id)?.encounter?.monsters).toEqual([]);
    expect(restored.enterCurrentRoom().some((action) => action.kind === "encounter")).toBe(false);
  });

  it("rejects fabricated, conflicting, cleared, unexplored, unknown-field, and non-JSON rosters", () => {
    const source = saveMeDefinition();
    const context = { monsterTypes: ["Slime", "Bat"] };
    const session = DungeonSession.create(source, 1, 0x12345678, context);
    const room = session.state.rooms.find((entry) => entry.encounter?.monsters.length === 3)!;
    const prior = session.state.rooms.find((entry) => entry.links.some((link) => link.targetRoomId === room.id))!;
    walkTo(session, prior.id);
    session.moveToRoom(room.id);
    const encounter = session.currentRoom.encounter!;
    const authored = encounter.monsters;
    const base = session.snapshot();
    const valid = {
      ...base,
      encounterRosters: [{ encounterId: encounter.id, monsters: [authored[0]!, authored[2]!] }],
    };
    expect(DungeonSession.restore(source, valid, context).currentRoom.encounter?.monsters)
      .toEqual([authored[0], authored[2]]);
    expect(() => DungeonSession.restore(source, {
      ...valid,
      encounterRosters: [{ encounterId: encounter.id, monsters: [authored[0]!, authored[2]!, authored[1]!] }],
    }, context)).toThrow(/not an ordered subsequence/);
    expect(() => DungeonSession.restore(source, {
      ...valid,
      encounterRosters: [{ encounterId: encounter.id, monsters: [{ ...authored[0]!, level: 999 }] }],
    }, context)).toThrow(/not an ordered subsequence/);
    expect(() => DungeonSession.restore(source, {
      ...valid,
      encounterRosters: [{ encounterId: encounter.id, monsters: [{
        ...authored[0]!,
        forged: true,
      }] as unknown as typeof authored }],
    }, context)).toThrow(/unknown field/);
    expect(() => DungeonSession.restore(source, {
      ...valid,
      encounterRosters: [{ encounterId: encounter.id, monsters: [{
        ...authored[0]!,
        extraLivingArguments: { ...authored[0]!.extraLivingArguments!, bad: NaN },
      }] }],
    }, context)).toThrow(/JSON-safe/);
    expect(() => DungeonSession.restore(source, {
      ...valid,
      clearedEncounterIds: [encounter.id],
      encounterRosters: [{ encounterId: encounter.id, monsters: [] }],
    }, context)).toThrow(/cleared/);

    const unexplored = DungeonSession.create(source, 1, 0x12345678, context);
    const hidden = unexplored.state.rooms.find((entry) => entry.encounter !== undefined && !entry.explored)!;
    expect(() => DungeonSession.restore(source, {
      ...unexplored.snapshot(),
      encounterRosters: [{ encounterId: hidden.encounter!.id, monsters: [] }],
    }, context)).toThrow(/unexplored/);
  });

  it("deeply isolates generated input, prospective forks, and cached snapshot copies", () => {
    const source = saveMeDefinition();
    const session = DungeonSession.create(source, 1, 0x12345678, { monsterTypes: ["Slime", "Bat"] });
    const room = session.state.rooms.find((entry) => entry.encounter?.monsters.length === 3)!;
    const prior = session.state.rooms.find((entry) => entry.links.some((link) => link.targetRoomId === room.id))!;
    walkTo(session, prior.id);
    session.moveToRoom(room.id);
    const liveEncounter = session.currentRoom.encounter!;
    const liveTreasure = liveEncounter.treasure!;

    const sourceExtra = source.floorPopulations[0]!.monsterPopulator!.fixedEncounters[0]!.monsters[0]!
      .extraLivingArguments as { nested: { depth: number } };
    sourceExtra.nested.depth = 99;
    expect(liveEncounter.monsters[0]!.extraLivingArguments).toEqual({ boss: true, nested: { depth: 1 } });

    const fork = session.fork();
    const forkEncounter = fork.currentRoom.encounter!;
    expect(forkEncounter).not.toBe(liveEncounter);
    expect(forkEncounter.monsters).not.toBe(liveEncounter.monsters);
    expect(forkEncounter.monsters[0]!.extraLivingArguments).not.toBe(liveEncounter.monsters[0]!.extraLivingArguments);
    expect(forkEncounter.treasure).not.toBe(liveTreasure);
    expect(forkEncounter.treasure!.loot).not.toBe(liveTreasure.loot);
    expect(forkEncounter.startEvent).not.toBe(liveEncounter.startEvent);
    expect(forkEncounter.startEvent?.data).not.toBe(liveEncounter.startEvent?.data);
    expect(forkEncounter.winEvent).not.toBe(liveEncounter.winEvent);
    expect(forkEncounter.breeder).not.toBe(liveEncounter.breeder);
    expect(forkEncounter.breeder?.arguments).not.toBe(liveEncounter.breeder?.arguments);
    expect(fork.currentRoom.links).not.toBe(session.currentRoom.links);
    expect(fork.currentRoom.zones).not.toBe(session.currentRoom.zones);

    const survivors = [forkEncounter.monsters[0]!];
    const plan = fork.prepareEncounterRoomRoster(forkEncounter.id, "flow-isolated", survivors);
    survivors.length = 0;
    expect(plan.monsters).toHaveLength(1);
    plan.commit();
    expect(session.currentRoom.encounter?.monsters).toHaveLength(3);
    expect(fork.currentRoom.encounter?.monsters).toHaveLength(1);

    const cached = fork.snapshot();
    expect(cached.encounterRosters?.[0]?.monsters).not.toBe(plan.monsters);
    expect(cached.encounterRosters?.[0]?.monsters[0]?.extraLivingArguments)
      .not.toBe(plan.monsters[0]!.extraLivingArguments);
    expect(Object.isFrozen(cached.encounterRosters![0]!.monsters[0]!.extraLivingArguments)).toBe(true);
    expect(cached.generationGateDecisions).not.toBe(session.snapshot().generationGateDecisions);
  });

  it("reports catch-quest progress and awards omitted-chance reward items only once", () => {
    const questDefinition: DungeonDefinition = {
      ...definition(),
      catchQuest: {
        challengeLevel: 4,
        types: ["Slime", "Bat"],
        treasureData: {
          levelScalor: 1,
          // All eight shipped catch-quest rewards omit chance. The native claim path sets the
          // TreasureData default spawn chance to 1.0 before generating them.
          items: [{ kind: "silver", levelScalor: 1 }],
        },
      },
    };
    const session = DungeonSession.create(questDefinition, 1, 99, { monsterTypes: ["Slime", "Bat"] });
    expect(session.catchQuestProgress()).toMatchObject({ captured: [], complete: false, rewardCollected: false });
    expect(session.recordCapturedMonster("Slime")).toEqual([]);
    expect(session.catchQuestProgress()).toMatchObject({ captured: ["Slime"], complete: false });
    expect(session.recordCapturedMonster("Bat")).toEqual([]);
    expect(session.catchQuestProgress()).toMatchObject({
      captured: ["Slime", "Bat"], complete: true, rewardCollected: false,
    });
    expect(session.claimCatchQuestReward()).toEqual([{ kind: "silver", amount: 49 }]);
    expect(session.catchQuestProgress()).toMatchObject({ rewardCollected: true });
    expect(session.claimCatchQuestReward()).toEqual([]);
    expect(session.recordCapturedMonster("Bat")).toEqual([]);
  });

  it("preserves an explicitly authored zero reward chance while consuming the completed claim", () => {
    const questDefinition: DungeonDefinition = {
      ...definition(),
      catchQuest: {
        challengeLevel: 4,
        types: ["Slime"],
        treasureData: {
          levelScalor: 1,
          items: [{ kind: "silver", chance: 0, levelScalor: 1 }],
        },
      },
    };
    const session = DungeonSession.create(questDefinition, 1, 99, { monsterTypes: ["Slime"] });
    session.recordCapturedMonster("Slime");
    expect(session.claimCatchQuestReward()).toEqual([]);
    expect(session.catchQuestProgress()).toMatchObject({ complete: true, rewardCollected: true });
  });





  it("draws the zone room before the zone change", () => {
    const seven = Array.from({ length: 7 }, () => ({
      kind: "stairsDown" as const,
      sourceType: "Down" as const,
    }));
    const source = definition();
    const zoneDefinition: DungeonDefinition = {
      ...source,
      floorPopulations: [{ ...source.floorPopulations[0]!, zoneChanges: seven }],
    };

    const calls: Array<{ readonly kind: string; readonly n?: number }> = [];
    const inner = touchHleArc4Random(0, 0);
    const recording = {
      next: () => { calls.push({ kind: "next" }); return inner.next(); },
      intBelow: (n: number) => { calls.push({ kind: "intBelow", n }); return inner.intBelow(n); },
      chance: (p: number) => { calls.push({ kind: "chance" }); return inner.chance(p); },
      fork: () => inner.fork(),
    };
    const floor = generateDungeonFloor(zoneDefinition, 1, 0x2026, {
      monsterTypes: ["Slime", "Bat"],
      fidelityRng: recording,
    });

    // The zone-change pool is the only seven-element collection in this definition, so its first
    // draw is unambiguous; the room pool at that moment is still every generated room.
    const firstChangeDraw = calls.findIndex((call) => call.kind === "intBelow" && call.n === 7);
    expect(firstChangeDraw).toBeGreaterThan(0);
    expect(calls[firstChangeDraw - 1]).toEqual({ kind: "intBelow", n: floor.rooms.length });
    expect(floor.rooms.flatMap((room) => room.zones)).toHaveLength(7);
  });
});
