import { describe, expect, it } from "vitest";
import {
  dungeonCameraBounds, dungeonCameraTransform, dungeonConnectorGridPosition,
  dungeonConnectorPixiPosition, dungeonConnectorTiles, dungeonContentCenter, dungeonDoorPosition,
  dungeonDoorWalkTarget,
  advanceDungeonBreederPulse,
  dungeonEncounterOutline, dungeonEncounterRoomFitScale, dungeonEncounterRoomPosition,
  dungeonForestTreeKey, dungeonForestTreePlacements, dungeonForestTreeScale,
  dungeonHeroFrameName,
  dungeonLootDisplayMetrics, dungeonRoomLinkDoorPosition, dungeonRoomRect, dungeonHudLayout,
  dungeonRoomTouchRadiusPt, dungeonRoomZ, dungeonTileSizePt, dungeonVisibleRoomIds,
  nearestMaterializedRoom, DUNGEON_LAYER_Z,
  initialDungeonBreederPulseState,
} from "../src/dungeon/dungeonDisplayMath.js";

const rooms = [
  { id: "a", sourceIndex: 0, templateKey: "2x2", x: 1, y: 2, width: 2, height: 2, rotation: 0,
    links: [{ targetRoomId: "b", offset: { x: 2, y: 0 } }], zones: [], waypoint: false, explored: true },
  { id: "b", sourceIndex: 1, templateKey: "2x2", x: 4, y: 2, width: 2, height: 2, rotation: 0,
    links: [
      { targetRoomId: "a", offset: { x: -1, y: 0 } },
      { targetRoomId: "c", offset: { x: 0, y: 2 } },
    ], zones: [], waypoint: false, explored: true },
  { id: "c", sourceIndex: 2, templateKey: "2x2", x: 4, y: 5, width: 2, height: 2, rotation: 0,
    links: [{ targetRoomId: "b", offset: { x: 0, y: -1 } }], zones: [], waypoint: false, explored: false },
] as const;

describe("dungeon display normalization", () => {
  it("normalizes 60pt phone and 120pt tablet source tiles to the same logical stage", () => {
    expect(dungeonTileSizePt("iphone")).toBe(60);
    expect(dungeonTileSizePt("ipad")).toBe(60);
    expect(dungeonRoomTouchRadiusPt("iphone")).toBe(30);
    expect(dungeonRoomTouchRadiusPt("ipad")).toBe(30);
  });
  it("converts bottom-left source rooms to Pixi top-left coordinates and keeps source z", () => {
    expect(dungeonRoomRect(rooms[0])).toEqual({ x: 60, y: -240, w: 120, h: 120 });
    expect(dungeonRoomZ(rooms[0])).toBe(9997);
  });
  it("frames only the current room and directly linked neighbors", () => {
    const floor = { rooms, currentRoomId: "b" };
    expect(dungeonVisibleRoomIds(floor)).toEqual(["b", "a"]);
    expect(dungeonCameraBounds(floor)).toEqual({ x: 60, y: -240, w: 300, h: 120 });
  });
  it("normalizes every loot-display idiom pair and proven bare literal explicitly", () => {
    expect(dungeonLootDisplayMetrics("iphone")).toEqual({
      roundingScale: 1,
      mainGap: 10, pageColumnGap: 10, rowGap: 5, iconSide: 32,
      titleFontSize: 18, nameFontSize: 14, bonusValueFontSize: 10,
      bonusCellWidth: 24, bonusIconSide: 24, pageFontSize: 14, takeAllFontSize: 14,
      popupTopInset: 10, infoSpacer: 10, infoDescriptionFontSize: 16,
      infoIconSide: 20, infoValueFontSize: 14, infoButtonGap: 40,
    });
    expect(dungeonLootDisplayMetrics("ipad")).toEqual({
      roundingScale: 2,
      mainGap: 10, pageColumnGap: 10, rowGap: 2.5, iconSide: 32,
      titleFontSize: 18, nameFontSize: 10, bonusValueFontSize: 8,
      bonusCellWidth: 24, bonusIconSide: 24, pageFontSize: 14, takeAllFontSize: 14,
      popupTopInset: 5, infoSpacer: 10, infoDescriptionFontSize: 16,
      infoIconSide: 20, infoValueFontSize: 14, infoButtonGap: 20,
    });
  });
  it("centers the current room and fits the symmetric envelope rather than the raw union", () => {
    const current = { ...rooms[0], id: "current", x: 0, y: 0, links: [
      { targetRoomId: "left", offset: { x: -1, y: 0 } },
    ] };
    const left = {
      ...rooms[1],
      id: "left",
      x: -5,
      y: 0,
      width: 4,
      height: 4,
      links: [{ targetRoomId: "current", offset: { x: 4, y: 0 } }],
    };
    const floor = { rooms: [current, left], currentRoomId: "current" };
    const transform = dungeonCameraTransform(floor, { w: 480, h: 320 });
    expect(transform.focus).toEqual({ x: 60, y: -60 });
    expect(transform.scale).toBe(0.75);
    expect(transform.x + transform.focus.x * transform.scale).toBe(240);
    expect(transform.y + transform.focus.y * transform.scale).toBe(160);
    expect(transform.currentRect).toEqual({ x: 0, y: -120, w: 120, h: 120 });

    const ipad = dungeonCameraTransform(floor, { w: 512, h: 384 });
    expect(ipad.focus).toEqual({ x: 60, y: -60 });
    expect(ipad.x + ipad.focus.x * ipad.scale).toBe(256);
    expect(ipad.y + ipad.focus.y * ipad.scale).toBe(192);
  });
  it("keeps forced zoom centered and clamps ordinary zoom at both source limits", () => {
    const floor = { rooms: [rooms[0]], currentRoomId: "a" };
    expect(dungeonCameraTransform(floor, { w: 480, h: 320 }).scale).toBe(1);
    const forced = dungeonCameraTransform(floor, { w: 480, h: 320 }, 1.5);
    expect(forced.scale).toBe(1.5);
    expect(forced.x + forced.focus.x * forced.scale).toBe(240);
    expect(forced.y + forced.focus.y * forced.scale).toBe(160);

    const huge = [{
      ...rooms[0],
      id: "huge",
      x: -10,
      y: -10,
      width: 40,
      height: 40,
      links: [],
    }];
    expect(dungeonCameraTransform({ rooms: huge, currentRoomId: "huge" }, { w: 512, h: 384 }).scale)
      .toBe(0.75);
  });
  it("maps reciprocal links to the same tile while preserving the native ownership predicate", () => {
    const east = dungeonConnectorGridPosition(rooms[0], rooms[0].links[0]);
    const west = dungeonConnectorGridPosition(rooms[1], rooms[1].links[0]);
    expect(east).toEqual({ x: 3, y: 2 });
    expect(west).toEqual(east);
    expect(dungeonConnectorPixiPosition(east)).toEqual({ x: 180, y: -180 });

    const north = dungeonConnectorGridPosition(rooms[1], rooms[1].links[1]);
    const south = dungeonConnectorGridPosition(rooms[2], rooms[2].links[0]);
    expect(north).toEqual({ x: 4, y: 4 });
    expect(south).toEqual(north);
    expect(dungeonConnectorTiles(rooms as never)).toEqual([
      expect.objectContaining({ sourceRoomId: "a", targetRoomId: "b", gridX: 3, gridY: 2, x: 180, y: -180 }),
      expect.objectContaining({ sourceRoomId: "b", targetRoomId: "a", gridX: 3, gridY: 2, x: 180, y: -180 }),
      expect.objectContaining({ sourceRoomId: "c", targetRoomId: "b", gridX: 4, gridY: 4, x: 240, y: -300 }),
    ]);
  });
  it("does not collapse distinct connector coordinates for the same room pair", () => {
    const left = {
      ...rooms[0],
      links: [
        { targetRoomId: "b", offset: { x: 2, y: 0 } },
        { targetRoomId: "b", offset: { x: 2, y: 1 } },
      ],
    };
    const right = {
      ...rooms[1],
      links: [
        { targetRoomId: "a", offset: { x: -1, y: 0 } },
        { targetRoomId: "a", offset: { x: -1, y: 1 } },
      ],
    };
    expect(dungeonConnectorTiles([left, right] as never)).toHaveLength(3);
  });
  it("uses the authored content center and overwrites encounter scale with the absolute room fit", () => {
    expect(dungeonContentCenter({ x: 10, y: 4, w: 100, h: 40 })).toEqual({ x: 60, y: 24 });
    expect(dungeonEncounterRoomFitScale({ w: 156, h: 78 }, "iphone")).toBe(0.5);
    expect(dungeonEncounterRoomFitScale({ w: 156, h: 78 }, "ipad")).toBe(0.5);
    expect(dungeonEncounterRoomFitScale({ w: 40, h: 60 }, "iphone")).toBe(1);
    expect(dungeonEncounterRoomFitScale({ w: 40, h: 60 }, "ipad")).toBe(1);
    expect(dungeonEncounterRoomPosition({ width: 2, height: 4 }, false, false, "iphone"))
      .toEqual({ x: 60, y: 120 });
    expect(dungeonEncounterRoomPosition({ width: 2, height: 4 }, true, false, "iphone"))
      .toEqual({ x: 60, y: 60 });
    expect(dungeonEncounterRoomPosition({ width: 2, height: 4 }, false, true, "ipad"))
      .toEqual({ x: 60, y: 60 });
  });
  it("gives every encounter preview its source outline, red and pulsing for breeder rooms", () => {

    expect(dungeonEncounterOutline(false, "iphone"))
      .toEqual({ radiusPt: 2, color: 0x000000, alpha: 128 / 255, pulse: false });

    expect(dungeonEncounterOutline(true, "iphone"))
      .toEqual({ radiusPt: 3, color: 0xff0000, alpha: 1, pulse: true });
    // Both border widths are bare floats: halved in the normalized iPad space.
    expect(dungeonEncounterOutline(false, "ipad").radiusPt).toBe(1);
    expect(dungeonEncounterOutline(true, "ipad").radiusPt).toBe(1.5);
  });
  it("reproduces the Cocos first tick, 8-bit fades, half-cycle carry, and cycle restart", () => {
    let pulse = initialDungeonBreederPulseState();
    pulse = advanceDungeonBreederPulse(pulse, 17);
    expect(pulse).toEqual({ firstTick: false, elapsedSeconds: 0, alpha: 1 });

    pulse = advanceDungeonBreederPulse(pulse, 250);
    expect(pulse).toEqual({ firstTick: false, elapsedSeconds: 0.25, alpha: 127 / 255 });
    pulse = advanceDungeonBreederPulse(pulse, 260);
    expect(pulse.elapsedSeconds).toBeCloseTo(0.51);
    expect(pulse.alpha).toBe(5 / 255); // ten milliseconds into FadeIn, in the same source update.

    pulse = advanceDungeonBreederPulse(pulse, 490);
    expect(pulse).toEqual({ firstTick: false, elapsedSeconds: 0, alpha: 1 });
    pulse = advanceDungeonBreederPulse(pulse, 250);
    expect(pulse.alpha).toBe(127 / 255);
    expect(() => advanceDungeonBreederPulse(pulse, -1)).toThrow(/delta/);
  });
  it("uses native float32 cadence and discards even multi-cycle repeat overflow", () => {
    let pulse = advanceDungeonBreederPulse(initialDungeonBreederPulseState(), 1_000 / 60);
    for (let tick = 0; tick < 6; tick += 1) {
      pulse = advanceDungeonBreederPulse(pulse, 1_000 / 60);
    }
    expect(pulse.alpha).toBe(204 / 255);

    pulse = advanceDungeonBreederPulse(pulse, 2_500);
    expect(pulse).toEqual({ firstTick: false, elapsedSeconds: 0, alpha: 1 });
  });
  it("selects the nearest materialized room body without narrowing to direct links", () => {
    const floor = { rooms, currentRoomId: "a" };
    expect(nearestMaterializedRoom(floor, { x: 300, y: -180 }, 30)?.id).toBe("b");
    expect(nearestMaterializedRoom(floor, { x: 300, y: -360 }, 30)).toBeUndefined();
    expect(nearestMaterializedRoom(floor, { x: 390, y: -180 }, 29)).toBeUndefined();
    expect(nearestMaterializedRoom(floor, { x: 390, y: -180 }, 30)?.id).toBe("b");
  });
  it("pins hero atlas names and door rotations", () => {
    expect(dungeonHeroFrameName("north", 8)).toBe("herowalkBack_8.png");
    expect(dungeonDoorPosition(rooms[0], "west")).toEqual({ x: 0, y: 60, rotation: -Math.PI / 2 });
  });
  it("sinks link doors into the wall band instead of centering them on the floor edge", () => {


    const room = { width: 2, height: 2 };
    expect(dungeonRoomLinkDoorPosition(room, { offset: { x: -1, y: 0 } }))
      .toEqual({ x: -10, y: 90, rotation: Math.PI / 2, anchorY: 0.5 });

    expect(dungeonRoomLinkDoorPosition(room, { offset: { x: 2, y: 1 } }))
      .toEqual({ x: 130, y: 30, rotation: Math.PI / 2, anchorY: 0.5 });
    // The south branch never reaches `setRotation:`.
    expect(dungeonRoomLinkDoorPosition(room, { offset: { x: 1, y: -1 } }))
      .toEqual({ x: 90, y: 130, rotation: 0, anchorY: 0.5 });
    // North replaces the offset-derived y with `(height - 1) * tile + 2` under anchor `(0.5, 0)`.
    expect(dungeonRoomLinkDoorPosition(room, { offset: { x: 0, y: 2 } }))
      .toEqual({ x: 30, y: 58, rotation: 0, anchorY: 1 });
    expect(dungeonRoomLinkDoorPosition({ width: 4, height: 4 }, { offset: { x: 3, y: 4 } }))
      .toEqual({ x: 210, y: 58, rotation: 0, anchorY: 1 });
  });
  it("offsets the walk corner by the door's own half size, as the source walk does", () => {


    const room = { width: 2, height: 2 };
    const side = { width: 54, height: 20 };
    const west = dungeonRoomLinkDoorPosition(room, { offset: { x: -1, y: 0 } });
    expect(dungeonDoorWalkTarget({ ...west, ...side })).toEqual({ x: 17, y: 80 });
    const east = dungeonRoomLinkDoorPosition(room, { offset: { x: 2, y: 1 } });
    expect(dungeonDoorWalkTarget({ ...east, ...side })).toEqual({ x: 157, y: 20 });
    // South turns exactly on the floor edge (y 120), not 10 points out in the connector.
    const south = dungeonRoomLinkDoorPosition(room, { offset: { x: 1, y: -1 } });
    expect(dungeonDoorWalkTarget({ ...south, ...side })).toEqual({ x: 117, y: 120 });
    const north = dungeonRoomLinkDoorPosition(room, { offset: { x: 0, y: 2 } });
    expect(dungeonDoorWalkTarget({ ...north, width: 42, height: 50 })).toEqual({ x: 51, y: 33 });
  });
  it("builds forest boundaries as four keyed rows, not a ring, and shares the link offset space", () => {


    const trees = dungeonForestTreePlacements({ width: 2, height: 2 }, "iphone");
    expect(trees).toHaveLength(8);
    expect(trees.filter((tree) => tree.shadow)).toHaveLength(2);
    const byKey = new Map(trees.map((tree) => [dungeonForestTreeKey(tree.offsetX, tree.offsetY), tree]));
    // Back row sits on the top edge; the front row is half a tile past the bottom edge.
    expect(byKey.get("0,2")).toEqual({ offsetX: 0, offsetY: 2, x: 30, y: 0, shadow: false });
    expect(byKey.get("1,-1")).toEqual({ offsetX: 1, offsetY: -1, x: 90, y: 150, shadow: true });
    // Side columns run top-to-bottom in Cocos Y-up in the source loop; the east one is pulled in by a bare 1 point.
    expect(byKey.get("-1,0")).toEqual({ offsetX: -1, offsetY: 0, x: 0, y: 120, shadow: false });
    expect(byKey.get("2,1")).toEqual({ offsetX: 2, offsetY: 1, x: 119, y: 60, shadow: false });
    expect(dungeonForestTreePlacements({ width: 2, height: 2 }, "ipad")
      .find((tree) => tree.offsetX === 2 && tree.offsetY === 1)?.x).toBe(119.5);
    // Every door offset must find a tree, or the doorway gap has nothing to punch through.
    for (const offset of [{ x: -1, y: 1 }, { x: 2, y: 0 }, { x: 1, y: -1 }, { x: 0, y: 2 }]) {
      expect(byKey.has(dungeonForestTreeKey(offset.x, offset.y))).toBe(true);
    }

    expect(dungeonForestTreeScale(0)).toBe(0.75);
    expect(dungeonForestTreeScale(0.5)).toBeCloseTo(0.8, 10);
  });
  it("pins the retained menu control without inventing an iPad border or level counter", () => {
    expect(dungeonHudLayout({ w: 512, h: 384 })).toEqual({
      menu: { x: 512, y: 0 },
    });
    expect(dungeonHudLayout({ w: 480, h: 320 })).toEqual({ menu: { x: 480, y: 0 } });
  });
  it("keeps controls above the source background and rooms", () => {
    expect(DUNGEON_LAYER_Z.background).toBeLessThan(DUNGEON_LAYER_Z.world);
    expect(DUNGEON_LAYER_Z.world).toBeLessThan(DUNGEON_LAYER_Z.chrome);
  });
});
