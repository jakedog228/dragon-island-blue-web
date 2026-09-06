import { describe, expect, it } from "vitest";
import { loadGameData, loadRawJson, resolveDataDir } from "@dib/gamedata";
import { PlayerProfile } from "../src/player/playerProfile.js";
import {
  buildSpiritMenuItems,
  spiritMenuColumns,
  spiritMenuGeometry,
  spiritMenuLayout,
} from "../src/battle/spiritMenuMath.js";
import type { LocalizedStrings } from "../src/localization.js";
import { DEMO_PLAYER_PROFILE_DEFAULTS } from "../src/player/demoPlayerProfile.js";

const gd = loadGameData();
const strings = loadRawJson(resolveDataDir(), "LocalizableStrings.json") as LocalizedStrings;

describe("HeroDisplay spirit menu model", () => {
  it("unlocks every shipped spirit at a configured tier", () => {
    const shipped = gd.allMonsters()
      .filter((monster) => monster.category === "Summon")
      .map((monster) => monster.shortType)
      .sort();
    // `spiritReadiness` is deliberately NOT asserted: it is a demo tuning knob (0 = empty gauge,
    // 0.9 = near-full for spirit-overlay verification) that carries no source-fidelity meaning,
    // and pinning it made every local demo tweak look like a regression.
    expect(Object.keys(DEMO_PLAYER_PROFILE_DEFAULTS.spiritTierLevels ?? {}).sort()).toEqual(shipped);
  });

  it("builds localized grades and source-derived combat levels, plus Back", () => {
    const profile = new PlayerProfile({
      heroLevel: 1,
      monsterPartyLevels: [1],
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      spiritReadiness: 1,
      spiritTierLevels: { Resistance: 0, Fire: 2, Time: 18 },
    });
    const items = buildSpiritMenuItems(profile.spiritSnapshot(), gd, strings);
    expect(items).toEqual([
      expect.objectContaining({ label: "Resistance [F-]", shortType: "Resistance", combatLevel: 12, enabled: true }),
      expect.objectContaining({ label: "Fire [F+]", shortType: "Fire", combatLevel: 23, enabled: true }),
      expect.objectContaining({ label: "Time [S]", shortType: "Time", combatLevel: 136, enabled: true }),
      { kind: "back", label: "Back", enabled: true },
    ]);
  });

  it("round-robins thirteen items into the exact three columns", () => {
    const values = Array.from({ length: 13 }, (_, i) => i);
    expect(spiritMenuColumns(values)).toEqual([
      [0, 3, 6, 9, 12],
      [1, 4, 7, 10],
      [2, 5, 8, 11],
    ]);
  });

  it("leaves the trailing columns of a first capture empty instead of dropping them", () => {


    expect(spiritMenuColumns(["Fire", "Back"])).toEqual([["Fire"], ["Back"], []]);
    expect(spiritMenuColumns(["Back"])).toEqual([["Back"], [], []]);
  });

  it("charges the empty third column's gap for a one-spirit menu", () => {
    const geometry = spiritMenuGeometry(
      { w: 480, h: 320 },
      { w: 100, h: 25 },
      [[{ w: 50, h: 12 }], [{ w: 40, h: 12 }], []],
      "iphone",
    );
    // Columns measure 50 + 30 + 40 + 30 + 0: the empty Box contributes no width but still consumes
    // one of the columns Box's N-1 gaps, so the stack is not centered on its two visible columns.
    expect(geometry.content).toEqual({ x: 165, y: 136.5, w: 150, h: 47 });
    expect(geometry.title).toEqual({ x: 190, y: 136.5, w: 100, h: 25 });
    expect(geometry.buttons[0]![0]).toEqual({
      column: 0,
      row: 0,
      label: { x: 165, y: 171.5, w: 50, h: 12 },
      background: { x: 156, y: 165.5, w: 68, h: 24 },
    });
    expect(geometry.buttons[1]![0]!.label.x).toBe(245);
    expect(geometry.buttons[2]).toEqual([]);
  });

  it("pins every new phone/iPad layout constant class", () => {
    expect(spiritMenuLayout("iphone")).toEqual({
      titleSize: 25,
      itemSize: 12,
      titleGap: 10,
      itemGap: 30,
      columnGap: 30,
      outlineWidth: 2,
      outlineAlpha: 128 / 255,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
    });
    expect(spiritMenuLayout("ipad")).toEqual({
      titleSize: 25,
      itemSize: 20,
      titleGap: 10,
      itemGap: 30,
      columnGap: 30,
      outlineWidth: 1,
      outlineAlpha: 128 / 255,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
    });
  });

  it("packs label content like nested Boxes while backgrounds overhang without changing gaps", () => {
    const geometry = spiritMenuGeometry(
      { w: 480, h: 320 },
      { w: 100, h: 25 },
      [
        [{ w: 50, h: 12 }, { w: 60, h: 12 }],
        [{ w: 40, h: 12 }],
        [{ w: 30, h: 12 }],
      ],
      "iphone",
    );
    expect(geometry.content).toEqual({ x: 145, y: 115.5, w: 190, h: 89 });
    expect(geometry.title).toEqual({ x: 190, y: 115.5, w: 100, h: 25 });
    expect(geometry.buttons[0]![0]).toEqual({
      column: 0,
      row: 0,
      label: { x: 150, y: 150.5, w: 50, h: 12 },
      background: { x: 136, y: 144.5, w: 78, h: 24 },
    });
    expect(geometry.buttons[0]![1]).toEqual({
      column: 0,
      row: 1,
      label: { x: 145, y: 192.5, w: 60, h: 12 },
      background: { x: 136, y: 186.5, w: 78, h: 24 },
    });
    // The one-row columns are vertically centered by the outer horizontal columns Box.
    expect(geometry.buttons[1]![0]!.label.y).toBe(171.5);
    // Column 0's second label starts exactly 30pt after the first label's bottom; its 24pt
    // background never participates in that calculation.
    expect(geometry.buttons[0]![1]!.label.y - (
      geometry.buttons[0]![0]!.label.y + geometry.buttons[0]![0]!.label.h
    )).toBe(30);
  });

  it("centers the full twelve-spirit plus Back stack instead of dropping its lower rows off-screen", () => {
    const geometry = spiritMenuGeometry(
      { w: 480, h: 320 },
      { w: 120, h: 25 },
      [
        Array.from({ length: 5 }, () => ({ w: 80, h: 12 })),
        Array.from({ length: 4 }, () => ({ w: 80, h: 12 })),
        Array.from({ length: 4 }, () => ({ w: 80, h: 12 })),
      ],
      "iphone",
    );
    expect(geometry.content).toEqual({ x: 90, y: 52.5, w: 300, h: 215 });
    expect(geometry.content.y + geometry.content.h / 2).toBe(160);
    const back = geometry.buttons[0]![4]!;
    expect(back.label.y + back.label.h).toBe(267.5);
    expect(back.background.y + back.background.h).toBe(273.5);
  });

  it("performs Box rounding in native iPad coordinates before normalization", () => {
    const geometry = spiritMenuGeometry(
      { w: 512, h: 384 },
      { w: 100.5, h: 25.5 },
      [
        [{ w: 50.5, h: 20.5 }, { w: 60.5, h: 20.5 }],
        [{ w: 40.5, h: 20.5 }],
        [{ w: 30.5, h: 20.5 }],
      ],
      "ipad",
    );
    expect(geometry.content).toEqual({ x: 160.25, y: 138.75, w: 191.5, h: 106.5 });
    expect(geometry.title).toEqual({ x: 205.75, y: 138.75, w: 100.5, h: 25.5 });
    expect(geometry.buttons[0]![0]).toEqual({
      column: 0,
      row: 0,
      label: { x: 165.25, y: 174.25, w: 50.5, h: 20.5 },
      background: { x: 151.25, y: 168.25, w: 78.5, h: 32.5 },
    });
    expect(geometry.buttons[1]![0]!.label.y).toBe(199.75);
  });
});
