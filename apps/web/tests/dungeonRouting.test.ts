import { describe, expect, it } from "vitest";
import type { WorldPointOfInterest } from "@dib/gamedata/browser";
import { createWorldPoiRoutingPolicy } from "../src/world/worldPoiRouting.js";

const dungeonPoi = (complete = true): WorldPointOfInterest => ({
  name: "Cave", type: "Outdoor.Cave", sourceClass: "PointOfInterest", position: { x: 1, y: 2 },
  renderer: { className: "POINode", spriteFile: "cave.png" }, hasEncounterTable: false,
  randomPopulators: [], demoSkipped: ["dungeon"],
  unusedEncounterFixedEncounters: [],
  zoneChange: { kind: "dungeon", ...(complete ? { dungeon: "Cave", dungeonFile: "Dungeon_1.plist" } : {}) },
});

const worldExitPoi = (): WorldPointOfInterest => ({
  ...dungeonPoi(),
  name: "WorldExit",
  demoSkipped: [],
  zoneChange: {
    kind: "world",
    targetWorld: "World_1-2",
    targetZoneChange: "1-2_Zone_Change_1",
  },
});

describe("world dungeon routing", () => {
  it("keeps unverified archives blocked and routes verified capability through the scene registry", () => {
    expect(createWorldPoiRoutingPolicy().route(dungeonPoi())).toEqual({ kind: "blocked", system: "dungeon" });
    // Unlike a town, a dungeon entrance is not a synchronous source arrival: the marker movement
    // stays visible and the scene mounts after it, so the route carries "after-marker-movement".
    expect(createWorldPoiRoutingPolicy({ dungeons: true }).route(dungeonPoi())).toEqual({
      kind: "scene",
      sceneId: "dungeon",
      arrivalPresentation: "after-marker-movement",
    });
  });
  it("fails loudly on a partial dungeon entrance descriptor", () => {
    expect(() => createWorldPoiRoutingPolicy({ dungeons: true }).route(dungeonPoi(false))).toThrow(/incomplete dungeon entrance/);
  });
  it("blocks cross-world exits when an authoritative pack owns only the current world", () => {
    expect(createWorldPoiRoutingPolicy({ worldExits: false }).route(worldExitPoi())).toEqual({
      kind: "blocked",
      system: "worldExit",
    });
    expect(createWorldPoiRoutingPolicy().route(worldExitPoi())).toMatchObject({
      kind: "worldExit",
      targetWorld: "World_1-2",
    });
  });
});
