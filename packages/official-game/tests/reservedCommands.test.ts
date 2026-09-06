import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadCollectionCatalog,
  loadGameData,
  loadQuestCatalog,
  loadWorldData,
  resolveDataDir,
  type WorldResourceSource,
} from "@dib/gamedata";
import {
  GAME_COMMAND_TYPES_V1,
  HISTORICAL_GAME_COMMAND_TYPES_V1,
  RESERVED_GAME_COMMAND_TYPES_V1,
} from "@dib/game-protocol";
import {
  createOfficialGameV12Support,
  createOfficialGameV13LogicPackDescriptor,
  validateOfficialCollectionCatalog,
  validateOfficialGameSupport,
} from "../src/index.js";

/**
 * The fully-featured descriptor: every world, the dungeon resources, the quest catalog, and a
 * proved Collection catalog. Data-conditional capabilities (dungeon.*, world.usePortal,
 * tournament.*, collection.claim) are therefore all present, so anything still missing from
 * `commandTypes` is missing for a structural reason rather than a thin fixture.
 */
const data = loadGameData();
const dataDirectory = resolveDataDir();
const source: WorldResourceSource = {
  has: (path) => path.endsWith(".plist")
    ? existsSync(resolve(dataDirectory, `${path.slice(0, -6)}.json`)) ||
      /-hd\.plist$/.test(path)
    : true,
  plist: (path) => JSON.parse(readFileSync(
    resolve(dataDirectory, `${path.slice(0, -6)}.json`),
    "utf8",
  )) as unknown,
};
const shortTypes = new Set(data.allMonsters().map((monster) => monster.shortType));
const world = loadWorldData(source, "World_1-1", shortTypes);
const worlds = Object.keys(source.plist("Worlds.plist") as Record<string, unknown>)
  .sort()
  .map((name) => name === world.name ? world : loadWorldData(source, name, shortTypes));
const quests = loadQuestCatalog(source);
const support = validateOfficialGameSupport({
  data,
  world,
  worlds,
  resources: source,
  quests,
  startTownId: "First_City",
});
const collectionProof = validateOfficialCollectionCatalog(
  loadCollectionCatalog(source, data),
  data,
  support,
);
const pack = createOfficialGameV13LogicPackDescriptor(
  `logic-v1:${"e".repeat(64)}`,
  createOfficialGameV12Support({ support, collectionCatalog: collectionProof }),
);

describe("reserved command registry", () => {
  it("accounts for every wire command type", () => {
    const advertised = new Set<string>(pack.capabilities.commandTypes);
    const unaccounted = GAME_COMMAND_TYPES_V1.filter(
      (type) => !advertised.has(type) && RESERVED_GAME_COMMAND_TYPES_V1[type] === undefined,
    );
    // A new command type that nobody wired up fails here rather than surfacing to a player as a
    // runtime CAPABILITY_UNSUPPORTED. Either advertise it, or record why it never will be.
    expect(unaccounted).toEqual([]);
  });

  it("does not reserve a command the authority actually admits", () => {
    const advertised = new Set<string>(pack.capabilities.commandTypes);
    const contradictory = Object.keys(RESERVED_GAME_COMMAND_TYPES_V1)
      .filter((type) => advertised.has(type));
    expect(contradictory).toEqual([]);
  });

  it("reserves only types the wire vocabulary can name", () => {
    const nameable = new Set<string>(HISTORICAL_GAME_COMMAND_TYPES_V1);
    const unknown = Object.keys(RESERVED_GAME_COMMAND_TYPES_V1)
      .filter((type) => !nameable.has(type));
    expect(unknown).toEqual([]);
  });

  it("records the three unreachable commands and the one retired command", () => {
    const byReason = (reason: "unreachable" | "retired"): readonly string[] =>
      Object.entries(RESERVED_GAME_COMMAND_TYPES_V1)
        .filter(([, entry]) => entry.reason === reason)
        .map(([type]) => type)
        .sort();
    expect(byReason("unreachable")).toEqual([
      "plot.advance",
      "quest.abandon",
      "world.enterTown",
    ]);
    expect(byReason("retired")).toEqual(["tournament.settlePrize"]);
    for (const entry of Object.values(RESERVED_GAME_COMMAND_TYPES_V1)) {
      expect(entry.note.length).toBeGreaterThan(40);
    }
  });
});
