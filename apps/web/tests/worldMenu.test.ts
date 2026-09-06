import { describe, expect, it } from "vitest";
import {
  loadRawJson,
  loadSourceTutorialTopics,
  resolveDataDir,
} from "@dib/gamedata";
import type { LocalizedStrings } from "../src/localization.js";
import {
  buildWorldMenuItems,
  enabledDungeonMenuActions,
  worldMenuColumns,
  worldMenuGeometry,
  worldMenuLayout,
} from "../src/world/worldMenuMath.js";
import {
  BIG_MAP_UNVISITED_ALPHA,
  bigMapCellLayout,
  bigMapCurrentWorldLayout,
  bigMapViewportPosition,
  parseWorldCell,
} from "../src/world/bigMapMath.js";
import { optionsLayout } from "../src/world/optionsMath.js";
import {
  buildTutorialMenuModel,
  TUTORIAL_MENU_TITLE_COLOR,
  TUTORIAL_MENU_TITLE_FONT_SIZE,
} from "../src/world/tutorialMenuMath.js";
import {
  popupMenuButtonAt,
  popupMenuHorizontalItemLayout,
} from "../src/ui/popupMenuMath.js";

const strings = loadRawJson(resolveDataDir(), "LocalizableStrings.json") as LocalizedStrings;

describe("World MasterMenu", () => {
  it("preserves the exact localized source order and requested availability", () => {
    const items = buildWorldMenuItems(strings, new Set(["monsters", "worldMap", "options"]));
    expect(items.map(({ label }) => label)).toEqual([
      "Items", "Monsters", "Monsterpedia", "Quests", "World Map", "Highscores",
      "Achievements", "Town Portal", "Tutorials", "Options", "Main Menu",
    ]);
    expect(items.filter(({ enabled }) => enabled).map(({ action }) => action)).toEqual([
      "monsters", "worldMap", "options",
    ]);
  });

  it("uses source round-robin columns, not a row-major reshuffle", () => {
    expect(worldMenuColumns(Array.from({ length: 11 }, (_, index) => index))).toEqual([
      [0, 3, 6, 9],
      [1, 4, 7, 10],
      [2, 5, 8],
    ]);
  });

  it("uses the dungeon-only capture challenge branch instead of World Map", () => {
    const items = buildWorldMenuItems(strings, enabledDungeonMenuActions(true), "dungeon");
    expect(items[4]).toMatchObject({ action: "catchQuest", label: "Challenge", enabled: true });
    expect(items.some((item) => item.action === "worldMap")).toBe(false);
    expect(items.filter(({ enabled }) => enabled).map(({ action }) => action)).toEqual([
      "items", "monsters", "monsterpedia", "catchQuest", "townPortal", "options", "mainMenu",
    ]);
    expect(
      buildWorldMenuItems(strings, enabledDungeonMenuActions(false), "dungeon")
        .find(({ action }) => action === "townPortal"),
    ).toMatchObject({ enabled: false });
    expect(buildWorldMenuItems(strings, new Set(), "dungeon")[4])
      .toMatchObject({ action: "catchQuest", label: "Challenge", enabled: false });
  });

  it("keeps the dungeon Quests row live, gated only on the port's quest-surface capability", () => {



    const withQuests = buildWorldMenuItems(strings, enabledDungeonMenuActions(true, false, true), "dungeon");
    expect(withQuests[3]).toMatchObject({ action: "quests", label: "Quests", enabled: true });
    expect(withQuests.filter(({ enabled }) => enabled).map(({ action }) => action)).toEqual([
      "items", "monsters", "monsterpedia", "quests", "catchQuest", "townPortal", "options", "mainMenu",
    ]);
    expect(
      buildWorldMenuItems(strings, enabledDungeonMenuActions(true, false, false), "dungeon")[3],
    ).toMatchObject({ action: "quests", enabled: false });
  });

  it("lights the Highscores row in a dungeon exactly as in a world, and only online", () => {



    const online = buildWorldMenuItems(
      strings,
      enabledDungeonMenuActions(true, false, false, true),
      "dungeon",
    );
    expect(online.find(({ action }) => action === "highscores"))
      .toMatchObject({ label: "Highscores", enabled: true });
    // Achievements sits beside it and stays inert: there is no first-party equivalent behind it.
    expect(online.find(({ action }) => action === "achievements"))
      .toMatchObject({ enabled: false });
    expect(
      buildWorldMenuItems(strings, enabledDungeonMenuActions(true, false, false, false), "dungeon")
        .find(({ action }) => action === "highscores"),
    ).toMatchObject({ enabled: false });
  });

  it("classifies and normalizes every MasterMenu constant for both idioms", () => {
    expect(worldMenuLayout("iphone")).toEqual({
      itemSize: 16,
      itemGap: 40,
      columnGap: 50,
      titleGap: 10,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
      closeInset: 10,
    });
    expect(worldMenuLayout("ipad")).toEqual({
      itemSize: 16,
      itemGap: 40,
      columnGap: 50,
      titleGap: 10,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
      closeInset: 5,
    });
  });

  it("centers the titleless columns and keeps per-column scale9 maxima out of Box size", () => {
    const geometry = worldMenuGeometry(
      { w: 480, h: 320 },
      [
        [{ w: 40, h: 16 }, { w: 80, h: 16 }],
        [{ w: 60, h: 16 }],
        [{ w: 50, h: 16 }],
      ],
      "iphone",
    );
    expect(geometry.title).toBeNull();
    expect(geometry.content.x + geometry.content.w / 2).toBe(240);
    expect(geometry.content.y + geometry.content.h / 2).toBe(160);
    expect(geometry.buttons[0]![1]!.label.y - geometry.buttons[0]![0]!.label.y).toBe(56);
    expect(geometry.buttons[0]![0]!.background.w).toBe(98);
    expect(geometry.buttons[1]![0]!.background.w).toBe(78);
    // The original accepts the complete visible brown plate, including its label overhang.
    const first = geometry.buttons[0]![0]!;
    expect(popupMenuButtonAt(
      [{ value: "first", layout: first, enabled: true }],
      { x: first.background.x + 0.01, y: first.background.y + 0.01 },
    )).toBe("first");
    expect(popupMenuButtonAt(
      [{ value: "first", layout: first, enabled: true }],
      { x: first.background.x - 0.01, y: first.background.y + first.background.h / 2 },
    )).toBeUndefined();
  });

  it("builds the exact retained two-column Tutorials catalog", () => {
    const topics = loadSourceTutorialTopics({
      has: (path) => path === "Plot.plist",
      plist: (path) => {
        if (path !== "Plot.plist") throw new Error(`unexpected resource ${path}`);
        return loadRawJson(resolveDataDir(), "Plot.json");
      },
    });
    const model = buildTutorialMenuModel(topics, strings);
    expect(model.title).toBe("Tutorial Topics");
    expect(TUTORIAL_MENU_TITLE_FONT_SIZE).toBe(25);
    expect(TUTORIAL_MENU_TITLE_COLOR).toBe(0xffff88);
    expect(model.columns.map((column) => column.map((entry) =>
      entry.kind === "topic" ? [entry.topic.key, entry.label] : ["back", entry.label],
    ))).toEqual([
      [
        ["Tutorial0", "Battle"],
        ["Tutorial2", "Worldmap"],
        ["Tutorial4", "Monster Management"],
        ["Tutorial6", "Insert Soulstone"],
        ["Tutorial8", "Combine Monsters"],
      ],
      [
        ["Tutorial1", "Capturing"],
        ["Tutorial3", "Dungeon"],
        ["Tutorial5", "Make Soulstone"],
        ["Tutorial7", "Spirit"],
        ["back", "Back"],
      ],
    ]);
  });

  it("measures PopupMenu icon accessories as part of their source Box", () => {
    expect(
      popupMenuHorizontalItemLayout(
        { w: 83.25, h: 20.5 },
        { w: 20, h: 20 },
        "right",
        10,
        "iphone",
      ),
    ).toEqual({
      content: { w: 113, h: 21 },
      label: { x: 0, y: 0 },
      accessory: { x: 93, y: 1 },
    });
    expect(
      popupMenuHorizontalItemLayout(
        { w: 83.25, h: 20.5 },
        { w: 20, h: 20 },
        "right",
        10,
        "ipad",
      ),
    ).toEqual({
      content: { w: 113.5, h: 20.5 },
      label: { x: 0, y: 0 },
      accessory: { x: 93.5, y: 0.5 },
    });
  });

  it("keeps the source 4x4 BigMap vocabulary and leaves Underworld without a marker", () => {
    expect(parseWorldCell("World_1-1")).toEqual({ column: 1, row: 1 });
    expect(parseWorldCell("World_4-4")).toEqual({ column: 4, row: 4 });
    expect(() => parseWorldCell("Harbor")).toThrow(/World_<1-4>/);
    expect(bigMapCellLayout("World_1-1")).toEqual({
      mask: { x: 0, y: 240, w: 120, h: 80 },
      heroCenter: { x: 60, y: 280 },
    });
    expect(bigMapCellLayout("World_4-4")).toEqual({
      mask: { x: 360, y: 0, w: 120, h: 80 },
      heroCenter: { x: 420, y: 40 },
    });
    expect(bigMapCurrentWorldLayout("World_3-2")).toEqual({
      mask: { x: 240, y: 160, w: 120, h: 80 },
      heroCenter: { x: 300, y: 200 },
    });


    expect(bigMapCurrentWorldLayout("UnderWorld_1-1")).toBeUndefined();
    expect(bigMapViewportPosition("iphone")).toEqual({ x: 0, y: 0 });
    expect(bigMapViewportPosition("ipad")).toEqual({ x: 16, y: 32 });
    expect(BIG_MAP_UNVISITED_ALPHA).toBe(120 / 255);
  });

  it("pins original OptionsNode layout constants in both display idioms", () => {
    expect(optionsLayout("iphone")).toEqual({
      fontSize: 16,
      labelX: 50,
      controlX: 120,
      rowGap: 40,
      numberGap: 40,
      portChoiceGap: 20,
      outlineWidth: 2,
    });
    expect(optionsLayout("ipad")).toEqual({
      fontSize: 15,
      labelX: 25,
      controlX: 120,
      rowGap: 40,
      numberGap: 30,
      portChoiceGap: 15,
      outlineWidth: 1,
    });
  });
});
