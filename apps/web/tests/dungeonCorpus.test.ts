




import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import {
  loadDungeonData,
  type DungeonDefinition,
  type DungeonResourceSource,
} from "@dib/gamedata/dungeon";
import {
  DungeonSession,
  dungeonDefinitionId,
  dungeonPopulationForFloor,
  dungeonZoneChangesForFloor,
  generateDungeonFloor,
} from "@dib/engine/dungeon";
import type { DungeonEncounter } from "@dib/engine/dungeon";
import { DungeonRuntimeController } from "@dib/engine/dungeon-runtime";
import { touchHleArc4Random } from "@dib/engine";
import {
  buildDungeonBattle,
  dungeonBattleRewardKey,
} from "../src/dungeon/dungeonBattle.js";
import { dungeonCollectionMonsterTypes } from "../src/dungeon/dungeonHudMath.js";
import {
  dungeonForestTreeKey,
  dungeonForestTreePlacements,
} from "../src/dungeon/dungeonDisplayMath.js";

const DATA_DIR = resolve(import.meta.dirname, "../../../extracted/data");
const ATLAS_DIR = resolve(import.meta.dirname, "../../../extracted/assets/atlases");



const dataNames = new Set(readdirSync(DATA_DIR));
const atlasNames = new Set(readdirSync(ATLAS_DIR));
const cache = new Map<string, unknown>();
const asJson = (relative: string): string => relative.replace(/\.plist$/, ".json");

const source: DungeonResourceSource = {
  has: (relative) =>
    dataNames.has(asJson(relative)) ||
    atlasNames.has(asJson(relative)) ||
    /\.(png|mp3|m4a)$/.test(relative),
  list: () => [...dataNames].map((name) => name.replace(/\.json$/, ".plist")),
  plist: (relative) => {
    const name = asJson(relative);
    if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(resolve(DATA_DIR, name), "utf8")));
    return cache.get(name);
  },
};

// Monsters.json nests short types arbitrarily deep (Slime.Metal.KingMetal is authored by
// Dungeon_12), so the real GameData walk is the only correct source of the known-type set.
const gameData = loadGameData();
const monsterTypes = gameData.allMonsters().map((monster) => monster.shortType);
const knownMonsterTypes = new Set(monsterTypes);

const EXPECTED_THEMES = ["Cave", "Dungeon", "Forest", "Water"] as const;
const INSTANCE_THEME = {
  "Dungeon_1.plist": "Cave",
  "Dungeon_3.plist": "Dungeon",
  "Dungeon_4.plist": "Cave",
  "Dungeon_6a.plist": "Water",
  "Dungeon_6b.plist": "Dungeon",
  "Dungeon_7.plist": "Water",
  "Dungeon_9.plist": "Forest",
  "Dungeon_11.plist": "Cave",
  "Dungeon_12.plist": "Dungeon",
  "Dungeon_13.plist": "Water",
  "Dungeon_14.plist": "Dungeon",
  "Dungeon_15.plist": "Cave",
  "Dungeon_15b.plist": "Cave",
  "Dungeon_16.plist": "Dungeon",
  "Dungeon_17.plist": "Dungeon",
} as const;
const INSTANCE_NAME = {
  "Dungeon_1.plist": "NorthCave",
  "Dungeon_3.plist": "NoMansCastle",
  "Dungeon_4.plist": "PiratesCave",
  "Dungeon_6a.plist": "IgneousPassageNorth",
  "Dungeon_6b.plist": "IgneousPassageSouth",
  "Dungeon_7.plist": "FloodedLightHouse",
  "Dungeon_9.plist": "GiantMangal",
  "Dungeon_11.plist": "HolyCave",
  "Dungeon_12.plist": "NorthEarlsome",
  "Dungeon_13.plist": "Endergate",
  "Dungeon_14.plist": "Larden",
  "Dungeon_15.plist": "Volcano",
  "Dungeon_15b.plist": "VolcanoB",
  "Dungeon_16.plist": "Relic",
  "Dungeon_17.plist": "UnderworldCave",
} as const;
const themeNames = Object.keys(
  JSON.parse(readFileSync(resolve(DATA_DIR, "Dungeons.json"), "utf8")) as Record<string, unknown>,
);

/** Independently derive the instance corpus and route theme from shipped source JSON. The reviewed
 * map below is an assertion target only; it is never used to decide which files load or which
 * theme a definition receives. */
const actualInstanceFiles = [...dataNames]
  .filter((name) => /^Dungeon_.*\.json$/.test(name))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  .map((name) => name.replace(/\.json$/, ".plist"));
const actualRouteThemes = new Map<string, string>();
function collectDungeonRoutes(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectDungeonRoutes(entry);
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const dungeon = record.dungeon;
  if (
    dungeon !== null && typeof dungeon === "object" && !Array.isArray(dungeon) &&
    typeof (dungeon as Record<string, unknown>).arguments === "string" &&
    /^Dungeon_.*\.plist$/.test((dungeon as Record<string, unknown>).arguments as string) &&
    typeof (dungeon as Record<string, unknown>).type === "string"
  ) {
    actualRouteThemes.set(
      (dungeon as Record<string, unknown>).arguments as string,
      (dungeon as Record<string, unknown>).type as string,
    );
  }
  for (const entry of Object.values(record)) collectDungeonRoutes(entry);
}
for (const name of [...dataNames].filter((candidate) =>
  /^(?:World|UnderWorld|Dungeon)_.*\.json$/.test(candidate))) {
  collectDungeonRoutes(JSON.parse(readFileSync(resolve(DATA_DIR, name), "utf8")));
}
const instanceFiles = actualInstanceFiles;

/** World data owns the theme->instance pairing; this suite exercises the instance corpus itself, so
 * it accepts the first declared theme whose merged creation data parses. All four shipped themes
 * share one creation schema, which is exactly why the merge in §7.1 is well defined. */
function loadInstance(file: string, floor: number): DungeonDefinition {
  const theme = actualRouteThemes.get(file);
  if (theme === undefined) throw new Error(`unreviewed dungeon instance ${file}`);
  return loadDungeonData(source, theme, file, floor, knownMonsterTypes);
}

describe("real dungeon corpus", () => {
  it("pins the complete shipped instance set, theme mapping, and instance names", () => {
    expect(themeNames).toEqual([...EXPECTED_THEMES]);
    expect(actualInstanceFiles).toEqual([
      "Dungeon_1.plist", "Dungeon_3.plist", "Dungeon_4.plist", "Dungeon_6a.plist",
      "Dungeon_6b.plist", "Dungeon_7.plist", "Dungeon_9.plist", "Dungeon_11.plist",
      "Dungeon_12.plist", "Dungeon_13.plist", "Dungeon_14.plist", "Dungeon_15.plist",
      "Dungeon_15b.plist", "Dungeon_16.plist", "Dungeon_17.plist",
    ]);
    expect(Object.fromEntries([...actualRouteThemes.entries()].sort())).toEqual(INSTANCE_THEME);
    expect(instanceFiles).toEqual([
      "Dungeon_1.plist", "Dungeon_3.plist", "Dungeon_4.plist", "Dungeon_6a.plist",
      "Dungeon_6b.plist", "Dungeon_7.plist", "Dungeon_9.plist", "Dungeon_11.plist",
      "Dungeon_12.plist", "Dungeon_13.plist", "Dungeon_14.plist", "Dungeon_15.plist",
      "Dungeon_15b.plist", "Dungeon_16.plist", "Dungeon_17.plist",
    ]);
    expect(Object.values(INSTANCE_THEME).sort()).toEqual([
      "Cave", "Cave", "Cave", "Cave", "Cave", "Dungeon", "Dungeon", "Dungeon",
      "Dungeon", "Dungeon", "Dungeon", "Forest", "Water", "Water", "Water",
    ]);
    expect(Object.values(INSTANCE_NAME)).toHaveLength(15);
    for (const file of instanceFiles) {
      const definition = loadInstance(file, 1);
      expect(definition.typeName, file).toBe(actualRouteThemes.get(file));
      expect(definition.instanceName, file).toBe(INSTANCE_NAME[file as keyof typeof INSTANCE_NAME]);
    }
  });

  it("builds the native all-floor caught census and excludes breeder fixed encounters", () => {
    const types = dungeonCollectionMonsterTypes(
      loadInstance("Dungeon_1.plist", 1),
      (type, extra) =>
        extra?.capturable !== false &&
        gameData.monsterByShortType(type).category !== "Summon",
    );
    expect(new Set(types)).toEqual(new Set([
      "BatSquirrel",
      "Bitewing",
      "FireCub",
      "GiantTurtle",
      "GiantWasp",
      "Penguin",
      "Sludge",
      "SnowCub",
    ]));



    expect(types).not.toContain("Cockatrice");
    expect(types).not.toContain("MerWarrior");
    expect(types).not.toContain("Reptilo");
    // Floor 4's breeder-less Resistance encounter IS enumerated; it drops out on captureStatus
    // instead, because `Spirit.Resistance` is a Summon.
    expect(types).not.toContain("Resistance");
  });

  it("applies the source per-instance capturable and template capture-status filters", () => {
    const types = dungeonCollectionMonsterTypes(
      loadInstance("Dungeon_1.plist", 1),
      (type, extra) =>
        extra?.capturable !== false &&
        type !== "GiantWasp" &&
        gameData.monsterByShortType(type).category !== "Summon",
    );
    expect(types).not.toContain("GiantWasp");
    expect(types).not.toContain("Cockatrice");
    expect(types).toHaveLength(7);
  });

  it("parses all 15 shipped instances through the strict loader", () => {
    expect(instanceFiles).toHaveLength(15);
    for (const file of instanceFiles) {
      const definition = loadInstance(file, 1);
      expect(definition.instanceName.length).toBeGreaterThan(0);
      expect(definition.floorPopulations.length).toBeGreaterThan(0);
      // The executable reads these exact keys. Every shipped instance omits mustClearFloor and
      // misspells unguardedTreasureChance as Density, so native behavior is false and 5%.
      expect(definition.mustClearFloor, `${file}: shipped clear gate`).toBe(false);
      for (const population of definition.floorPopulations) {
        if (population.treasurePopulator !== undefined) {
          expect(
            population.treasurePopulator.unguardedTreasureChance,
            `${file} floor ${population.sourceFloor}: unguarded treasure chance`,
          ).toBe(0.05);
        }
      }
    }
  });

  it("inherits North Cave floor-4 ordinary treasure without merging it into Resistance's chest", () => {
    const definition = loadInstance("Dungeon_1.plist", 4);
    expect(dungeonPopulationForFloor(definition, 4, "monsterPopulator")?.sourceFloor).toBe(4);
    expect(dungeonPopulationForFloor(definition, 4, "treasurePopulator")?.sourceFloor).toBe(3);

    const generated = Array.from({ length: 64 }, (_, seed) =>
      generateDungeonFloor(definition, 4, seed, { monsterTypes }));
    const resistanceRoom = generated[0]!.rooms.find((room) =>
      room.encounter?.monsters.some((monster) => monster.type === "Resistance"));
    expect(resistanceRoom?.encounter?.treasure?.loot[0]?.kind)
      .toMatch(/^(gem|gold|silver)$/);
    expect(resistanceRoom?.encounter?.treasure?.loot[1])
      .toEqual({ kind: "spiritTotem", shortType: "Resistance" });
    expect(generated.some((floor) => floor.rooms.some((room) => room.treasure !== undefined)))
      .toBe(true);
  });

  it("preserves all eight shipped catch-reward item chances as omitted", () => {
    const rewards = instanceFiles
      .map((file) => ({ file, catchQuest: loadInstance(file, 1).catchQuest }))
      .filter((entry) => entry.catchQuest !== undefined);
    expect(rewards).toHaveLength(8);
    for (const { file, catchQuest } of rewards) {
      expect(catchQuest!.treasureData.items.length, `${file}: catch reward items`)
        .toBeGreaterThan(0);
      for (const item of catchQuest!.treasureData.items) {
        expect(item.chance, `${file}: omitted catch reward chance`).toBeUndefined();
      }
    }
  });

  it("audits every shipped fixed encounter against the runtime diagnostic vocabulary", () => {
    const counts = new Map<string, number>();
    let fixedCount = 0;
    let questCount = 0;
    let achievementCount = 0;
    let normalBreederCount = 0;
    let startEventCount = 0;
    let winEventCount = 0;
    const rewardKeys = new Set<string>();

    for (const file of instanceFiles) {
      const definition = loadInstance(file, 1);
      for (const population of definition.floorPopulations) {
        for (const [fixedIndex, fixed] of (population.monsterPopulator?.fixedEncounters ?? []).entries()) {
          fixedCount++;
          if (fixed.breeder?.type === "Normal") normalBreederCount++;
          if (fixed.questKey !== undefined) questCount++;
          if (fixed.achievement !== undefined) achievementCount++;
          if (fixed.battleRewardKey !== undefined) rewardKeys.add(fixed.battleRewardKey);
          for (const event of [fixed.startEvent, fixed.winEvent]) {
            if (event === undefined) continue;
            expect(event.className).toBe("ChatGameFlowEvent");
          }
          if (fixed.startEvent !== undefined) startEventCount++;
          if (fixed.winEvent !== undefined) winEventCount++;

          const encounter: DungeonEncounter = {
            id: `${file}:${population.sourceFloor}:${fixedIndex}`,
            kind: "fixed",
            ...(fixed.uniqueKey === undefined ? {} : { completionKey: fixed.uniqueKey }),
            ...(fixed.questKey === undefined ? {} : { questKey: fixed.questKey }),
            ...(fixed.battleRewardKey === undefined ? {} : { battleRewardKey: fixed.battleRewardKey }),
            ...(fixed.achievement === undefined ? {} : { achievement: fixed.achievement }),
            ...(fixed.startEvent === undefined ? {} : { startEvent: fixed.startEvent }),
            ...(fixed.winEvent === undefined ? {} : { winEvent: fixed.winEvent }),
            ...(fixed.breeder === undefined ? {} : { breeder: fixed.breeder }),
            monsters: fixed.monsters.map((monster) => ({
              type: monster.type === "Random" || monster.type === "Any" ? "Slime" : monster.type,
              level: 1,
              ...(monster.extraLivingArguments === undefined
                ? {}
                : { extraLivingArguments: monster.extraLivingArguments }),
            })),
          };
          const built = buildDungeonBattle(
            definition,
            encounter,
            [{ shortType: "Slime", level: 1 }],
          );
          const diagnostics = built.diagnostics;
          expect(built.encounter.questKey, encounter.id).toBe(fixed.questKey);
          expect(dungeonBattleRewardKey(encounter), encounter.id).toBe(
            fixed.battleRewardKey ?? fixed.questKey,
          );
          const codes = diagnostics.map((diagnostic) => diagnostic.code);
          expect(new Set(codes).size, encounter.id).toBe(codes.length);
          for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
        }
      }
    }

    expect(fixedCount).toBe(63);
    expect(normalBreederCount).toBe(53);
    expect(startEventCount).toBe(41);
    expect(winEventCount).toBe(51);
    expect(questCount).toBe(28);
    expect(achievementCount).toBe(4);
    expect([...rewardKeys].sort()).toEqual([
      "RewardFinalBattle1", "RewardFinalBattle2", "RewardFinalBattle3",
      "RewardFinalBattle4", "RewardFinalBattle5", "RewardFinalBattle6",
    ]);
    expect(rewardKeys.size).toBe(6);
    expect(counts).toEqual(new Map([["save-me-disabled", 3]]));
    expect(counts.get("unsupported-breeder-type") ?? 0).toBe(0);
    expect(counts.get("unsupported-breeder-argument") ?? 0).toBe(0);
    expect(counts.get("unsupported-breeder-stat") ?? 0).toBe(0);
    expect(counts.get("unsupported-living-argument") ?? 0).toBe(0);
    expect(counts.get("opaque-start-event") ?? 0).toBe(0);
    expect(counts.get("opaque-win-event") ?? 0).toBe(0);
    expect(counts.get("opaque-achievement") ?? 0).toBe(0);
    expect(counts.get("opaque-battle-reward") ?? 0).toBe(0);
  });

  it("pins the shipped Volcano entry, 210/211 seam, and 999 endpoint without broadening the runtime claim", () => {
    const world = JSON.parse(readFileSync(resolve(DATA_DIR, "World_3-2.json"), "utf8")) as {
      pointsOfInterest: Array<{ arguments?: Record<string, unknown> }>;
    };
    const volcanoPoi = world.pointsOfInterest.find((point) =>
      point.arguments?.instanceName === "Dungeon_15");
    expect(volcanoPoi?.arguments?.zoneChange).toMatchObject({
      arguments: {
        dungeon: { arguments: "Dungeon_15.plist", type: "Cave" },
        targetZoneChange: "VolcanoEntrance",
      },
    });
    expect((volcanoPoi?.arguments?.zoneChange as { arguments?: Record<string, unknown> })
      .arguments?.conditions).toBeUndefined();

    const volcano = loadInstance("Dungeon_15.plist", 210);
    expect(volcano.instanceName).toBe("Volcano");
    expect(volcano.creation.lastFloor).toBe(210);
    expect(dungeonZoneChangesForFloor(volcano, 210)).toContainEqual(expect.objectContaining({
      kind: "dungeonExit",
      instanceName: "VolcanoPassageSwitchNorth",
      targetZoneChange: "VolcanoPassageSwitchSouth",
      dungeonFile: "Dungeon_15b.plist",
      dungeonLevel: 211,
    }));

    const volcanoB = loadInstance("Dungeon_15b.plist", 211);
    expect(volcanoB.instanceName).toBe("VolcanoB");
    expect(dungeonZoneChangesForFloor(volcanoB, 211)).toContainEqual(expect.objectContaining({
      kind: "dungeonExit",
      instanceName: "VolcanoPassageSwitchSouth",
      targetZoneChange: "VolcanoPassageSwitchNorth",
      dungeonFile: "Dungeon_15.plist",
      dungeonLevel: 210,
    }));
    expect(dungeonZoneChangesForFloor(volcanoB, 211)).toContainEqual({
      kind: "stairsDown",
      sourceType: "Down",
    });

    expect(volcanoB.creation.lastFloor).toBe(999);
    expect(dungeonZoneChangesForFloor(volcanoB, 999)).toEqual([{
      kind: "stairsUp",
      sourceType: "Up",
    }]);
    // This deliberately documents the boundary: direct positive-floor normalization is not a
    // global 1000 rejection, even though the shipped authored/reachable route ends at 999.
    expect(dungeonZoneChangesForFloor(volcanoB, 1000)).toEqual([
      { kind: "stairsUp", sourceType: "Up" },
      { kind: "stairsDown", sourceType: "Down" },
    ]);
  });

  it("generates bounded, reachable, reciprocal, restorable floors for every authored threshold", () => {
    let generations = 0;
    let totalRooms = 0;
    for (const file of instanceFiles) {
      const probe = loadInstance(file, 1);
      const floors = [
        ...new Set([
          1,
          ...probe.floorPopulations.map((row) => row.sourceFloor),
          probe.creation.lastFloor,
        ]),
      ].filter((floor) => Number.isInteger(floor) && floor >= 1);
      for (const floor of floors) {
        const definition = loadInstance(file, floor);
        const context = { monsterTypes };
        for (let seed = 0; seed < 64; seed++) {
          const generated = generateDungeonFloor(definition, floor, seed, context);
          generations++;
          totalRooms += generated.rooms.length;
          const where = `${file} floor ${floor} seed ${seed}`;

          expect(generated.rooms.length, `${where}: room count`).toBeGreaterThanOrEqual(1);
          // Native checks the target only before processing a parent. The initial pass can add
          // `density` siblings and addMoreNonHallwayRooms can consume every attachment point on
          // its final parent, so a small bounded overshoot is source behavior.
          const maximumParentPoints = Math.max(...definition.creation.roomTemplates.map(
            (template) => 2 * (template.width + template.height),
          ));
          expect(generated.rooms.length, `${where}: room count`).toBeLessThanOrEqual(
            definition.creation.roomsMax +
              Math.max(definition.creation.density, maximumParentPoints),
          );
          expect(
            generated.rooms.reduce((sum, room) => sum + room.links.length, 0),
            `${where}: dormant cycle doors`,
          ).toBe(2 * (generated.rooms.length - 1));

          const byId = new Map(generated.rooms.map((room) => [room.id, room]));
          for (const room of generated.rooms) {
            expect(room.rotation, `${where}: topology rotation`).toBe(0);
            expect(room.id, `${where}: native generated id`).toBe(
              `${room.templateKey}-{${room.x}, ${room.y}}`,
            );
            const treeKeys = new Set(dungeonForestTreePlacements(room, "iphone")
              .map((tree) => dungeonForestTreeKey(tree.offsetX, tree.offsetY)));
            for (const link of room.links) {
              const peer = byId.get(link.targetRoomId);
              expect(peer, `${where}: dangling link ${room.id}->${link.targetRoomId}`).toBeDefined();
              expect(
                peer!.links.some((candidate) => candidate.targetRoomId === room.id),
                `${where}: non-reciprocal link ${room.id}<->${link.targetRoomId}`,
              ).toBe(true);
              // A forest doorway is a hidden tree, so every generated link offset must actually
              // name one of the room's boundary trees — corners would leave the gap unpunched.
              expect(
                treeKeys.has(dungeonForestTreeKey(link.offset.x, link.offset.y)),
                `${where}: link ${room.id}->${link.targetRoomId} has no forest boundary tree`,
              ).toBe(true);
            }
          }

          const seen = new Set<string>([generated.currentRoomId]);
          const queue = [generated.currentRoomId];
          while (queue.length > 0) {
            for (const link of byId.get(queue.pop()!)!.links) {
              if (!seen.has(link.targetRoomId)) {
                seen.add(link.targetRoomId);
                queue.push(link.targetRoomId);
              }
            }
          }
          expect(seen.size, `${where}: unreachable rooms`).toBe(generated.rooms.length);

          const session = DungeonSession.create(definition, floor, seed, context);
          const roundTripped = JSON.parse(JSON.stringify(session.snapshot())) as ReturnType<
            DungeonSession["snapshot"]
          >;
          expect(roundTripped.definitionId).toBe(dungeonDefinitionId(definition));
          expect(
            DungeonSession.restore(definition, roundTripped, context).snapshot(),
            `${where}: snapshot restore`,
          ).toEqual(session.snapshot());
        }
      }
    }
    // Guards against a silent enumeration regression quietly shrinking this matrix to nothing.
    expect(generations).toBeGreaterThan(3000);
    expect(totalRooms).toBeGreaterThan(70_000);
  }, 600_000);

  // The Fidelity Lab hands the port one shared TouchHLE stream instead of a seed-derived one so
  // both runtimes draw the same numbers. Entering North Cave that way regenerates its floor twice
  // — once for the run-progress overlay inside the controller — and the second pass has to
  // reproduce the first exactly, against the real shipped corpus rather than a synthetic fixture.
  it("enters every shipped instance under a shared Fidelity Lab stream", () => {
    for (const file of instanceFiles) {
      const definition = loadInstance(file, 1);
      const fidelityRng = touchHleArc4Random(0, 0);
      const run = DungeonRuntimeController.enter({
        resources: source,
        monsterTypes,
        runSeed: 0x517a,
        definitionFor: () => definition,
        fidelityRng,
      }, {
        typeName: definition.typeName,
        sourceFile: definition.sourceFile,
        floor: 1,
      });
      const floor = run.session.state;
      expect(floor.rooms.some((room) => room.id === floor.currentRoomId), `${file}: current room`)
        .toBe(true);
      expect(fidelityRng.cursor, `${file}: consumed native draws`).toBeGreaterThan(0);
    }
  }, 120_000);
});
