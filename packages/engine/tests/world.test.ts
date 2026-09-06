import { describe, expect, it } from "vitest";
import { touchHleArc4Random, type Rng } from "../src/rng.js";
import type { WorldFixedEncounter } from "@dib/gamedata";
import type { GuildQuestEvent } from "../src/quests.js";
import {
  DEFAULT_WORLD_ENCOUNTER_CHANCE,
  UnsupportedWorldEncounterError,
  WorldDataError,
  WorldTrip,
  createWorldTripSharedState,
  advanceWorldDay,
  refreshWorldTripAtTown,
  allowSkipWorldEncounter,
  populateOrdinaryWorldEncounter,
  selectEncounterTableEntry,
  worldEncounterChallengeLevel,
  fixedEncounterCompletionKey,
  type PointOfInterestEncounterDefinition,
  type WorldDefinition,
} from "../src/world.js";

class ScriptedRng implements Rng {
  readonly calls: string[] = [];

  constructor(
    private readonly nextValues: number[] = [],
    private readonly integerValues: number[] = [],
  ) {}

  next(): number {
    this.calls.push("next");
    const value = this.nextValues.shift();
    if (value === undefined) throw new Error("unexpected next() draw");
    return value;
  }

  intBelow(n: number): number {
    this.calls.push(`intBelow(${n})`);
    const value = this.integerValues.shift();
    if (value === undefined) throw new Error(`unexpected intBelow(${n}) draw`);
    if (!Number.isInteger(value) || value < 0 || value >= n) {
      throw new Error(`scripted value ${value} is outside intBelow(${n})`);
    }
    return value;
  }

  chance(p: number): boolean {
    this.calls.push(`chance(${p})`);
    return this.next() < p;
  }
}

const populator = (type: string, levelScalor = 1) => ({
  class: "DefaultMonsterPopulator" as const,
  minMonstersPerPack: 1,
  maxMonstersPerPack: 1,
  levelScalor,
  types: [type],
});

const encounter = (
  type: string,
  overrides: Partial<PointOfInterestEncounterDefinition> = {},
): PointOfInterestEncounterDefinition => ({
  table: { "1": { monsterPopulator: populator(type) } },
  ...overrides,
});

const simpleWorld = (overrides: Partial<WorldDefinition> = {}): WorldDefinition => ({
  pointsOfInterest: [
    { instanceName: "A" },
    { instanceName: "B", encounter: encounter("Slime") },
    { instanceName: "C", encounter: encounter("Bat") },
  ],
  connections: [
    { poi1: "A", poi2: "B" },
    { poi1: "B", poi2: "C", requiredCompletedPoiNames: ["StoryGate"] },
  ],
  ...overrides,
});

describe("source encounter constants, tables, and float32 challenge", () => {
  it("pins the shipped default encounter chance's exact float32 bits", () => {
    const bits = new Uint32Array(new Float32Array([DEFAULT_WORLD_ENCOUNTER_CHANCE]).buffer)[0];
    expect(bits).toBe(0x3eaa7efa);
    expect(DEFAULT_WORLD_ENCOUNTER_CHANCE).toBe(0.3330000042915344);
  });

  it("uses wins+1, numeric key order, nil skipping, and the first nonnil fallback", () => {
    const table: PointOfInterestEncounterDefinition["table"] = {
      "20": { monsterPopulator: populator("Late") },
      "3": { monsterPopulator: populator("Middle") },
      "1": undefined,
      "10": null,
    };

    expect(selectEncounterTableEntry(table, 0)?.entry.monsterPopulator).toMatchObject({
      types: ["Middle"],
    });
    expect(selectEncounterTableEntry(table, 2)?.key).toBe("3");
    expect(selectEncounterTableEntry(table, 18)?.key).toBe("3");
    expect(selectEncounterTableEntry(table, 19)?.key).toBe("20");
  });

  it("reproduces float32 multiply/add/multiply followed by roundf", () => {
    expect(worldEncounterChallengeLevel(16, 3, 1.25, 0.75)).toBe(23);
    // Signed-int-to-float loses the +1 before the remaining operations.
    expect(worldEncounterChallengeLevel(16_777_217, 0, 1, 0)).toBe(16_777_216);
    expect(worldEncounterChallengeLevel(1, 1, -0.5, 0)).toBe(-1);
  });

  it("fails loudly on invalid table data", () => {
    expect(() => selectEncounterTableEntry({ nope: undefined }, 0)).toThrow(WorldDataError);
    expect(selectEncounterTableEntry({}, 0)).toBeUndefined();
    expect(selectEncounterTableEntry({ "1": null }, 0)).toBeUndefined();
  });
});

describe("DefaultMonsterPopulator ordinary draw schedule", () => {
  it("keeps inclusive count, weighted type, Random, and variance draws interleaved per monster", () => {
    const rng = new ScriptedRng([], [0, 1, 1, 3, 0, 0]);
    const monsters = populateOrdinaryWorldEncounter(
      {
        minMonstersPerPack: 2,
        maxMonstersPerPack: 3,
        types: [
          { type: "Wolf", chance: 1 },
          { type: "Random", chance: 2 },
        ],
      },
      20,
      ["Bat", "Dragon"],
      rng,
    );

    expect(monsters).toEqual([
      { type: "Dragon", level: 21 },
      { type: "Wolf", level: 18 },
    ]);
    expect(rng.calls).toEqual([
      "intBelow(2)",
      "intBelow(3)",
      "intBelow(2)",
      "intBelow(4)",
      "intBelow(3)",
      "intBelow(4)",
    ]);
  });

  it("can draw the inclusive maximum pack size", () => {
    const rng = new ScriptedRng([], [2, 0, 0, 0, 0]);
    const monsters = populateOrdinaryWorldEncounter(
      { minMonstersPerPack: 1, maxMonstersPerPack: 3, types: ["Slime"] },
      1,
      [],
      rng,
    );
    expect(monsters).toHaveLength(3);
    expect(rng.calls[0]).toBe("intBelow(3)");
  });

  it("consumes neither a count draw for an exact pack nor level draws below variance two", () => {
    const rng = new ScriptedRng([], [0, 0]);
    expect(
      populateOrdinaryWorldEncounter(
        { minMonstersPerPack: 2, maxMonstersPerPack: 2, types: ["Slime"] },
        14,
        [],
        rng,
      ),
    ).toEqual([
      { type: "Slime", level: 14 },
      { type: "Slime", level: 14 },
    ]);
    expect(rng.calls).toEqual(["intBelow(100)", "intBelow(100)"]);
  });

  it("pins weighted cumulative boundaries and clamps a nonpositive generated level to one", () => {
    const first = new ScriptedRng([], [0]);
    const second = new ScriptedRng([], [1]);
    const definition = {
      minMonstersPerPack: 1,
      maxMonstersPerPack: 1,
      levelScalor: 0,
      types: [
        { type: "First", chance: 1 },
        { type: "Second", chance: 1 },
      ],
    };
    expect(populateOrdinaryWorldEncounter(definition, 1, [], first)).toEqual([
      { type: "First", level: 1 },
    ]);
    expect(populateOrdinaryWorldEncounter(definition, 1, [], second)).toEqual([
      { type: "Second", level: 1 },
    ]);
  });

  it("rejects invalid ranges, weights, and an unresolved Random type", () => {
    expect(() =>
      populateOrdinaryWorldEncounter(
        { minMonstersPerPack: 2, maxMonstersPerPack: 1, types: ["Slime"] },
        1,
        [],
        new ScriptedRng(),
      ),
    ).toThrow(WorldDataError);
    expect(() =>
      populateOrdinaryWorldEncounter(
        { minMonstersPerPack: 1, maxMonstersPerPack: 1, types: [{ type: "Slime", chance: 0 }] },
        1,
        [],
        new ScriptedRng(),
      ),
    ).toThrow(WorldDataError);
    expect(() =>
      populateOrdinaryWorldEncounter(
        { minMonstersPerPack: 1, maxMonstersPerPack: 1, types: ["Random"] },
        1,
        [],
        new ScriptedRng([], [0]),
      ),
    ).toThrow('the special "Random" type requires a nonempty monster roster');
  });
});

describe("WorldEncounter allowSkip", () => {
  it("requires an ordinary encounter, player average seven, and at least twice enemy average", () => {
    expect(allowSkipWorldEncounter(false, [7, 7], [3, 4])).toBe(true);
    expect(allowSkipWorldEncounter(false, [6, 7], [3])).toBe(false);
    expect(allowSkipWorldEncounter(false, [7], [4])).toBe(false);
    expect(allowSkipWorldEncounter(true, [100], [1])).toBe(false);
  });

  it("averages only the first three fighting enemies and excludes a fourth reserve", () => {
    expect(allowSkipWorldEncounter(false, [10], [5, 5, 5, 100])).toBe(true);
    expect(allowSkipWorldEncounter(false, [10], [5, 5, 5])).toBe(true);
    // Including the reserve would average 28.75 and incorrectly reject the skip.
    expect(allowSkipWorldEncounter(false, [10], [29])).toBe(false);
  });
});

describe("DefaultMonsterPopulator fixed encounter gates", () => {
  const fixed = (
    overrides: Partial<WorldFixedEncounter> = {},
  ): WorldFixedEncounter => ({
    sourceIndex: 0,
    monsters: [{ type: "Slime", levelScalor: 0.5 }],
    chanceToAppear: 1,
    ...overrides,
  });
  const worldWithFixed = (
    candidate: WorldFixedEncounter,
    ordinaryTypes: readonly string[] = [],
  ): WorldDefinition => ({
    challengeLevel: 10,
    encounterChance: 0,
    pointsOfInterest: [
      { instanceName: "A" },
      {
        instanceName: "B",
        encounter: {
          table: {
            "1": {
              monsterPopulator: {
                class: "DefaultMonsterPopulator",
                minMonstersPerPack: 1,
                maxMonstersPerPack: 1,
                levelScalor: 2,
                types: ordinaryTypes,
                fixedEncounters: [candidate],
              },
            },
          },
        },
      },
    ],
    connections: [{ poi1: "A", poi2: "B" }],
  });

  it("rejects completed and inactive-quest candidates before consuming the chance draw", () => {
    const completedRng = new ScriptedRng();
    const completed = new WorldTrip(
      worldWithFixed(fixed({ uniqueKey: "Won" })),
      "A",
      completedRng,
      {
        randomMonsterTypes: [],
        hasCompletedFixedEncounter: (key) => key === "Won",
      },
    );
    completed.begin();
    expect(completed.navigate("B", [1])).toMatchObject({
      kind: "none",
      reason: "no-eligible-encounter",
    });
    expect(completedRng.calls).toEqual([]);

    const questRng = new ScriptedRng();
    const quest = new WorldTrip(
      worldWithFixed(fixed({ questKey: "Rescue" })),
      "A",
      questRng,
      { randomMonsterTypes: [], canUseQuestKey: () => false },
    );
    quest.begin();
    expect(quest.navigate("B", [1])).toMatchObject({
      kind: "none",
      reason: "no-eligible-encounter",
    });
    expect(questRng.calls).toEqual([]);
  });

  it("bypasses the ordinary occurrence and auto-skip gates and preserves fixed metadata", () => {
    const startChat = {
      className: "ChatGameFlowEvent" as const,
      chat: {
        name: "Felix",
        alwaysShow: true,
        imageFile: "nobleboy.png",
        messageKeys: [],
      },
    };
    const rng = new ScriptedRng([0.25]);
    const trip = new WorldTrip(
      worldWithFixed(fixed({
        questKey: "Liberate",
        uniqueKey: "FelixFinal",
        battleRewardKey: "RewardFelix",
        breeder: { type: "Normal", arguments: { stats: { MaxHP: 1 } } },
        startEvent: startChat,
      })),
      "A",
      rng,
      {
        randomMonsterTypes: [],
        canUseQuestKey: (key) => key === "Liberate",
      },
    );
    trip.begin();
    expect(trip.navigate("B", [100])).toMatchObject({
      kind: "encounter",
      encounter: {
        kind: "fixed",
        completionKey: "FelixFinal",
        questKey: "Liberate",
        battleRewardKey: "RewardFelix",
        monsters: [{ type: "Slime", level: 10 }],
        startEvent: startChat,
        breeder: { type: "Normal" },
      },
    });
    expect(rng.calls).toEqual(["next"]);
  });

  it("falls through to ordinary population after chance/floor rejection", () => {
    const rng = new ScriptedRng([0.5, 0], [0, 2]);
    const trip = new WorldTrip(
      { ...worldWithFixed(fixed({ exactFloor: 2 }), ["Bat"]), encounterChance: 1 },
      "A",
      rng,
      { randomMonsterTypes: [] },
    );
    trip.begin();
    expect(trip.navigate("B", [1])).toMatchObject({
      kind: "encounter",
      encounter: { kind: "ordinary", monsters: [{ type: "Bat", level: 20 }] },
    });
    // Fixed chance is tested before its floor; the ordinary candidate is then fully built before
    // `hasRandomEncounterThisRefreshInWorld:` rolls occurrence.
    expect(rng.calls).toEqual(["next", "intBelow(100)", "intBelow(4)", "next"]);
  });

  it("derives separately completable cadence keys from the source floor quotient", () => {
    const candidate = fixed({ uniqueKey: "CrazyDragon", exactFloor: 5, everyXFloors: 10 });
    expect(fixedEncounterCompletionKey(candidate, 5)).toBe("CrazyDragon0");
    expect(fixedEncounterCompletionKey(candidate, 15)).toBe("CrazyDragon1");
    expect(fixedEncounterCompletionKey(candidate, 25)).toBe("CrazyDragon2");
  });

  it("keeps unrestricted questless fights eligible but exact-floor fights disappear after a win", () => {
    const persistent = new WorldTrip(
      worldWithFixed(fixed()),
      "A",
      new ScriptedRng([0]),
      { randomMonsterTypes: [], initialPoiWins: { B: 1 } },
    );
    persistent.begin();
    expect(persistent.navigate("B", [1])).toMatchObject({
      kind: "encounter",
      encounter: { kind: "fixed", poiWinsBeforeEncounter: 1 },
    });

    const exact = new WorldTrip(
      worldWithFixed(fixed({ exactFloor: 1 })),
      "A",
      new ScriptedRng([0]),
      { randomMonsterTypes: [], initialPoiWins: { B: 1 } },
    );
    exact.begin();
    expect(exact.navigate("B", [1])).toMatchObject({
      kind: "none",
      reason: "no-eligible-encounter",
    });
  });
});

describe("WorldTrip navigation and refresh cadence", () => {
  it("completes an authored empty encounter table without RNG or a battle", () => {
    const rng = new ScriptedRng();
    const questEvents: GuildQuestEvent[] = [];
    const trip = new WorldTrip({
      instanceName: "ModWorld",
      pointsOfInterest: [
        { instanceName: "A" },
        { instanceName: "B", encounter: { table: {} } },
      ],
      connections: [{ poi1: "A", poi2: "B" }],
    }, "A", rng, {
      randomMonsterTypes: [],
      onQuestEvent: (event) => { questEvents.push(event); },
    });

    trip.begin();
    questEvents.length = 0;
    expect(trip.navigate("B", [1])).toEqual({
      kind: "none",
      poiName: "B",
      reason: "no-eligible-encounter",
      movement: { adjacent: true, kind: "walk" },
    });
    expect(trip.isCompletedThisRefresh("B")).toBe(true);
    expect(rng.calls).toEqual([]);
    expect(questEvents).toEqual([{
      id: 2,
      world: {
        instanceName: "ModWorld",
        encounterPoiCount: 1,
        completedEncounterPoiCount: 1,
      },
    }]);
  });

  it("suppresses the first arrival without RNG and exposes only undirected unconditional edges", () => {
    const rng = new ScriptedRng();
    const trip = new WorldTrip(simpleWorld(), "A", rng, { randomMonsterTypes: [] });
    expect(trip.begin()).toEqual({ kind: "none", poiName: "A", reason: "first-arrival" });
    expect(trip.unconditionalNeighbors("A")).toEqual(["B"]);
    expect(trip.unconditionalNeighbors("B")).toEqual(["A"]);
    expect(trip.isUnconditionallyAdjacent("B", "A")).toBe(true);
    expect(trip.isUnconditionallyAdjacent("B", "C")).toBe(false);
    expect(Object.fromEntries(trip.poiStates())).toEqual({ A: 2, B: 4, C: 3 });
    expect(trip.selectablePoiNames()).toEqual(["A", "B"]);
    expect(rng.calls).toEqual([]);
    expect(() => trip.navigate("C", [1])).toThrow("unavailable (state 3)");
  });

  it("propagates exact states through completed paths and teleports to selectable non-neighbors", () => {
    const world: WorldDefinition = {
      pointsOfInterest: [
        { instanceName: "A" },
        { instanceName: "B", encounter: encounter("B") },
        { instanceName: "C", encounter: encounter("C") },
        { instanceName: "D" },
        { instanceName: "Locked" },
      ],
      connections: [
        { poi1: "A", poi2: "B" },
        { poi1: "B", poi2: "C" },
        { poi1: "C", poi2: "D" },
        { poi1: "A", poi2: "Locked", requiredCompletedPoiNames: ["StoryGate"] },
      ],
    };
    const trip = new WorldTrip(world, "A", new ScriptedRng(), { randomMonsterTypes: [] });
    trip.begin();
    expect(Object.fromEntries(trip.poiStates())).toEqual({ A: 2, B: 4, C: 3, D: 3, Locked: 3 });

    trip.recordEncounterWin("B");
    expect(Object.fromEntries(trip.poiStates())).toEqual({ A: 2, B: 4, C: 1, D: 3, Locked: 3 });
    trip.recordEncounterWin("C");
    expect(Object.fromEntries(trip.poiStates())).toEqual({ A: 2, B: 4, C: 0, D: 1, Locked: 3 });

    expect(trip.navigate("D", [1])).toMatchObject({
      kind: "none",
      movement: { adjacent: false, kind: "teleport" },
    });
    expect(trip.currentPoiName).toBe("D");
  });

  it("reports the source walking path only for adjacent selection", () => {
    const rng = new ScriptedRng([0.9], [0]);
    const trip = new WorldTrip(simpleWorld(), "A", rng, { randomMonsterTypes: [] });
    trip.begin();
    expect(trip.navigate("B", [1])).toMatchObject({
      movement: { adjacent: true, kind: "walk" },
    });
  });

  it("uses a strict occurrence boundary, caches failure once, and completion blocks later arrival", () => {
    const rng = new ScriptedRng([DEFAULT_WORLD_ENCOUNTER_CHANCE], [0]);
    const trip = new WorldTrip(simpleWorld(), "A", rng, { randomMonsterTypes: [] });
    trip.begin();
    expect(trip.navigate("B", [1])).toMatchObject({
      kind: "none",
      reason: "occurrence-roll-failed",
    });
    expect(trip.navigate("A", [1])).toMatchObject({ kind: "none", reason: "no-encounter-table" });
    expect(trip.navigate("B", [1])).toMatchObject({
      kind: "none",
      reason: "completed-this-refresh",
    });
    expect(rng.calls).toEqual(["intBelow(100)", "next"]);
  });

  it("validates an occurrence draw before float32 narrowing permits a top-end draw to round to one", () => {
    const topUint32Draw = 0xffff_ffff / 0x1_0000_0000;
    expect(topUint32Draw).toBeLessThan(1);
    expect(Math.fround(topUint32Draw)).toBe(1);

    const rng = new ScriptedRng([topUint32Draw], [0]);
    const trip = new WorldTrip(simpleWorld(), "A", rng, { randomMonsterTypes: [] });
    trip.begin();
    expect(trip.navigate("B", [1])).toMatchObject({
      kind: "none",
      reason: "occurrence-roll-failed",
    });
    expect(rng.calls).toEqual(["intBelow(100)", "next"]);
  });

  it("rejects non-finite and truly out-of-range raw occurrence draws", () => {
    for (const draw of [Number.NaN, Number.POSITIVE_INFINITY, -Number.EPSILON, 1]) {
      const trip = new WorldTrip(simpleWorld(), "A", new ScriptedRng([draw], [0]), {
        randomMonsterTypes: [],
      });
      trip.begin();
      expect(() => trip.navigate("B", [1])).toThrow("Rng.next() returned out-of-range value");
    }
  });

  it("ignores source-tolerated connections whose opposite endpoint has no POI", () => {
    const world = simpleWorld({
      connections: [
        { poi1: "A", poi2: "MissingFromData" },
        { poi1: "MissingFromData", poi2: "B" },
        { poi1: "A", poi2: "B" },
      ],
    });
    const trip = new WorldTrip(world, "A", new ScriptedRng(), { randomMonsterTypes: [] });
    trip.begin();

    expect(trip.unconditionalNeighbors("A")).toEqual(["B"]);
    expect(trip.unconditionalNeighbors("B")).toEqual(["A"]);
    expect(Object.fromEntries(trip.poiStates())).toEqual({ A: 2, B: 4, C: 3 });
  });

  it("still rejects malformed and self-referential connections", () => {
    expect(
      () =>
        new WorldTrip(simpleWorld({ connections: [{ poi1: "A", poi2: "A" }] }), "A", new ScriptedRng(), {
          randomMonsterTypes: [],
        }),
    ).toThrow("cannot join POI A to itself");
    expect(
      () =>
        new WorldTrip(simpleWorld({ connections: [{ poi1: "A", poi2: "" }] }), "A", new ScriptedRng(), {
          randomMonsterTypes: [],
        }),
    ).toThrow("connection poi2 must be a nonempty string");
  });

  it("caches a successful roll but regenerates the encounter after retreat-style return", () => {
    const rng = new ScriptedRng([0], [0, 0]);
    const trip = new WorldTrip(simpleWorld(), "A", rng, { randomMonsterTypes: [] });
    trip.begin();
    expect(trip.navigate("B", [1])).toMatchObject({
      kind: "encounter",
      encounter: { forced: false, monsters: [{ type: "Slime", level: 1 }] },
    });
    trip.navigate("A", [1]);
    expect(trip.navigate("B", [1])).toMatchObject({ kind: "encounter" });
    expect(rng.calls).toEqual(["intBelow(100)", "next", "intBelow(100)"]);
  });

  it("same-POI selection forces an encounter past occurrence, completion, and auto-skip", () => {
    const rng = new ScriptedRng([0.9], [0]);
    const trip = new WorldTrip(simpleWorld(), "B", rng, { randomMonsterTypes: [] });
    trip.begin();
    trip.recordEncounterWin();
    const result = trip.navigate("B", [100]);
    expect(result).toMatchObject({ kind: "encounter", encounter: { forced: true } });
    expect(rng.calls).toEqual(["intBelow(100)"]);
  });

  it("auto-skips an easy ordinary arrival only after fully generating it", () => {
    const rng = new ScriptedRng([0], [0]);
    const trip = new WorldTrip(simpleWorld(), "A", rng, { randomMonsterTypes: [] });
    trip.begin();
    expect(trip.navigate("B", [7])).toMatchObject({
      kind: "skipped",
      reason: "easy-ordinary-encounter",
      encounter: { monsters: [{ level: 1 }] },
    });
    expect(trip.isCompletedThisRefresh("B")).toBe(true);
    expect(rng.calls).toEqual(["intBelow(100)", "next"]);
  });

  it("refreshAtTown clears occurrence/completion caches but preserves POI wins", () => {
    const rng = new ScriptedRng([0.9, 0], [0, 0]);
    const trip = new WorldTrip(simpleWorld(), "A", rng, { randomMonsterTypes: [] });
    trip.begin();
    trip.navigate("B", [1]);
    trip.recordEncounterWin("B");
    trip.navigate("A", [1]);
    trip.refreshAtTown();
    expect(trip.navigate("B", [1])).toMatchObject({
      kind: "encounter",
      encounter: { poiWinsBeforeEncounter: 1 },
    });
    expect(trip.poiWins("B")).toBe(1);
    expect(rng.calls).toEqual(["intBelow(100)", "next", "intBelow(100)", "next"]);
  });

  it("matches the traced native Forest2 population-before-occurrence stream", () => {
    const rng = touchHleArc4Random(0x25b2_331a);
    const trip = new WorldTrip({
      encounterChance: 0.8,
      pointsOfInterest: [
        { instanceName: "A" },
        {
          instanceName: "Forest2",
          encounter: {
            table: {
              "1": {
                monsterPopulator: {
                  minMonstersPerPack: 1,
                  maxMonstersPerPack: 2,
                  types: [{ type: "BatSquirrel", chance: 100 }],
                },
              },
            },
          },
        },
      ],
      connections: [{ poi1: "A", poi2: "Forest2" }],
    }, "A", rng, { randomMonsterTypes: [] });

    trip.begin();
    expect(trip.navigate("Forest2", [1])).toMatchObject({
      kind: "encounter",
      encounter: { monsters: [{ type: "BatSquirrel", level: 1 }] },
    });


    expect(rng.cursor).toBe(3);
    expect(rng.rawState).toBe(0xadd0_2374);
  });

  it("unconditionally completes a refreshed town with a quest-gated fixed encounter", () => {
    const rng = new ScriptedRng();
    const trip = new WorldTrip(
      {
        pointsOfInterest: [
          {
            instanceName: "First_City",
            encounter: {
              table: {
                "1": {
                  monsterPopulator: {
                    types: [],
                    fixedEncounters: [{
                      sourceIndex: 0,
                      monsters: [{ type: "Doki", levelScalor: 10 }],
                      chanceToAppear: 1,
                      questKey: "LiberateTownsQuest",
                      uniqueKey: "RenderableFirst_CityNameKey",
                    }],
                  },
                },
              },
            },
          },
          { instanceName: "1-1_Turtorial_Hut_1" },
          { instanceName: "1-1_Forest_1" },
        ],
        connections: [
          { poi1: "First_City", poi2: "1-1_Turtorial_Hut_1" },
          {
            poi1: "First_City",
            poi2: "1-1_Forest_1",
            requiredCompletedPoiNames: ["1-1_Field_1"],
          },
        ],
      },
      "First_City",
      rng,
      {
        randomMonsterTypes: [],
        canUseQuestKey: () => false,
      },
    );
    trip.begin();
    expect(Object.fromEntries(trip.poiStates())).toEqual({
      First_City: 2,
      "1-1_Turtorial_Hut_1": 3,
      "1-1_Forest_1": 3,
    });

    trip.refreshAtTown();

    expect(Object.fromEntries(trip.poiStates())).toEqual({
      First_City: 2,
      "1-1_Turtorial_Hut_1": 4,
      "1-1_Forest_1": 3,
    });
    expect(rng.calls).toEqual([]);
  });

  it("durably opens the first-town forest route after winning the staged Field 1 encounter", () => {
    const sharedState = createWorldTripSharedState();
    const world: WorldDefinition = {
      pointsOfInterest: [
        { instanceName: "First_City" },
        { instanceName: "1-1_Turtorial_Hut_1" },
        {
          instanceName: "1-1_Field_1",
          encounter: encounter("1-1_Field_1", {
            table: {
              "1": {
                monsterPopulator: {
                  class: "DefaultMonsterPopulator",
                  minMonstersPerPack: 1,
                  maxMonstersPerPack: 1,
                  levelScalor: 1,
                  types: [],
                  fixedEncounters: [{
                    sourceIndex: 0,
                    monsters: [{ type: "Goblin", levelScalor: 1 }],
                    chanceToAppear: 1,
                    startChatKey: "Leslie",
                    winChatKey: "LeslieSaved",
                  }],
                },
              },
            },
          }),
        },
        { instanceName: "1-1_Forest_1" },
      ],
      connections: [
        { poi1: "First_City", poi2: "1-1_Turtorial_Hut_1" },
        { poi1: "1-1_Turtorial_Hut_1", poi2: "1-1_Field_1" },
        {
          poi1: "First_City",
          poi2: "1-1_Forest_1",
          requiredCompletedPoiNames: ["1-1_Field_1"],
        },
      ],
    };
    const trip = new WorldTrip(world, "First_City", new ScriptedRng([0]), {
      randomMonsterTypes: [],
      sharedState,
    });
    trip.begin();

    expect(trip.unconditionalNeighbors("First_City")).toEqual(["1-1_Turtorial_Hut_1"]);
    trip.navigate("1-1_Turtorial_Hut_1", [1]);
    expect(trip.navigate("1-1_Field_1", [1])).toMatchObject({
      kind: "encounter",
      encounter: {
        kind: "fixed",
        monsters: [{ type: "Goblin", level: 1 }],
      },
    });

    trip.recordEncounterWin("1-1_Field_1");
    expect(trip.hasEverCompletedPoi("1-1_Field_1")).toBe(true);
    expect(trip.unconditionalNeighbors("First_City"))
      .toEqual(["1-1_Turtorial_Hut_1", "1-1_Forest_1"]);

    trip.refreshAtTown();
    const restoredWorldNode = new WorldTrip(
      world,
      "First_City",
      new ScriptedRng(),
      { randomMonsterTypes: [], sharedState },
    );
    restoredWorldNode.begin();
    expect(restoredWorldNode.unconditionalNeighbors("First_City"))
      .toEqual(["1-1_Turtorial_Hut_1", "1-1_Forest_1"]);
    expect(Object.fromEntries(restoredWorldNode.poiStates())["1-1_Forest_1"]).toBe(4);
  });

  it("shares occurrence/completion/win state across world-screen instances in one town trip", () => {
    const sharedState = createWorldTripSharedState();
    const firstRng = new ScriptedRng([0], [0]);
    const first = new WorldTrip(simpleWorld(), "A", firstRng, {
      randomMonsterTypes: [],
      sharedState,
    });
    first.begin();
    expect(first.navigate("B", [1]).kind).toBe("encounter");
    first.recordEncounterWin("B");

    const secondWorld = simpleWorld({
      pointsOfInterest: [
        { instanceName: "C" },
        simpleWorld().pointsOfInterest[1]!,
      ],
      connections: [{ poi1: "C", poi2: "B" }],
    });
    const secondRng = new ScriptedRng();
    const second = new WorldTrip(secondWorld, "C", secondRng, {
      randomMonsterTypes: [],
      sharedState,
    });
    second.begin();
    expect(second.poiWins("B")).toBe(1);
    expect(second.navigate("B", [1])).toMatchObject({
      kind: "none",
      reason: "completed-this-refresh",
    });
    expect(secondRng.calls).toEqual([]);
  });

  it("advances the persisted town day from the shipped day-one default", () => {
    const sharedState = createWorldTripSharedState();
    expect(sharedState.dayNumber).toBe(1);
    expect(advanceWorldDay(sharedState)).toBe(2);
    expect(advanceWorldDay(sharedState)).toBe(3);
    sharedState.dayNumber = 0;
    expect(() => advanceWorldDay(sharedState)).toThrow(/dayNumber/);
  });

  it("clears the prior day's POI caches when town entry starts a new refresh", () => {
    const sharedState = createWorldTripSharedState();
    sharedState.occurrenceThisRefresh.set("Field", true);
    sharedState.completedThisRefresh.add("Field");
    sharedState.everCompletedPois.add("Field");
    refreshWorldTripAtTown(sharedState, "First_City");
    expect([...sharedState.occurrenceThisRefresh]).toEqual([]);
    expect([...sharedState.completedThisRefresh]).toEqual(["First_City"]);
    expect([...sharedState.everCompletedPois].sort()).toEqual(["Field", "First_City"]);
  });

  it("selects later numeric tables from incremented POI wins", () => {
    const world = simpleWorld({
      pointsOfInterest: [
        { instanceName: "A" },
        {
          instanceName: "B",
          encounter: {
            table: {
              "1": { monsterPopulator: populator("Early") },
              "3": { monsterPopulator: populator("Late") },
            },
          },
        },
      ],
      connections: [{ poi1: "A", poi2: "B" }],
    });
    const rng = new ScriptedRng([], [0]);
    const trip = new WorldTrip(world, "B", rng, { randomMonsterTypes: [] });
    trip.begin();
    trip.recordEncounterWin();
    trip.recordEncounterWin();
    expect(trip.navigate("B", [1])).toMatchObject({
      kind: "encounter",
      encounter: { tableKey: "3", monsters: [{ type: "Late" }] },
    });
  });

  it("explicitly rejects custom encounter populators instead of randomizing them", () => {
    const customWorld = simpleWorld({
      pointsOfInterest: [
        {
          instanceName: "A",
          encounter: {
            table: { "1": { monsterPopulator: { class: "CustomBossPopulator" } } },
          },
        },
      ],
      connections: [],
    });

    const trip = new WorldTrip(customWorld, "A", new ScriptedRng(), { randomMonsterTypes: [] });
    trip.begin();
    expect(() => trip.navigate("A", [1])).toThrow(UnsupportedWorldEncounterError);
  });
});
