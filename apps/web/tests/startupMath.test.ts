import { describe, expect, it } from "vitest";
import type { PlayerGameStateSnapshot } from "../src/player/gameState.js";
import {
  nextPreloaderDots,
  sourceLoadPercentage,
  sourceLoadPercentageText,
  sourceSaveSelectColumns,
  sourceSaveSlotLabel,
  sourceTitleDestination,
  titlePromptTint,
  type StartupSlotRecord,
} from "../src/startup/startupMath.js";
import {
  PRELOADER_DOT_INTERVAL_MS,
  PRELOADER_PROGRESS_MAX,
  SAVE_CONTINUE_DELAY_MS,
  SOURCE_FADE_TRANSITION_MS,
  TITLE_PULSE_HALF_CYCLE_MS,
  normalizeCreditSpacePt,
  startupLayout,
} from "../src/startup/startupConstants.js";

const strings = {
  NewGameButtonKey: "New Game",
  GameDisplayFormatKey: "Level %d @ %@",
  EraseGameButtonKey: "Erase Game",
  CreditsButtonKey: "Credits",
  OptionsKey: "Options",
  BackButtonKey: "Back",
};

function state(heroLevel: number): PlayerGameStateSnapshot {
  return {
    schemaVersion: 1,
    player: {
      schemaVersion: 1,
      profile: { schemaVersion: 1, heroLevel } as never,
      party: { kind: "standalone-levels", levels: [heroLevel] },
    },
  };
}

function record(
  slotId: StartupSlotRecord["slotId"],
  heroLevel: number,
  updatedAt = "source-mtime",
): StartupSlotRecord {
  return { slotId, exists: true, compatible: true, updatedAt, state: state(heroLevel) };
}

describe("source startup constants and pure logic", () => {
  it("pins recovered timing constants", () => {
    expect(PRELOADER_DOT_INTERVAL_MS).toBe(500);
    expect(PRELOADER_PROGRESS_MAX).toBe(98);
    expect(TITLE_PULSE_HALF_CYCLE_MS).toBe(1_000);
    expect(SOURCE_FADE_TRANSITION_MS).toBe(500);
    expect(SAVE_CONTINUE_DELAY_MS).toBe(100);
  });

  it("classifies phone/iPad values without invented doubling", () => {
    const phone = startupLayout("iphone");
    const pad = startupLayout("ipad");
    expect(phone.screen).toEqual({ w: 480, h: 320 });
    expect(pad.screen).toEqual({ w: 512, h: 384 });
    expect([phone.preloader.labelFont, pad.preloader.labelFont]).toEqual([16, 8]);
    expect([phone.preloader.dotsFont, pad.preloader.dotsFont]).toEqual([18, 9]);
    expect([phone.preloader.bottomInset, pad.preloader.bottomInset]).toEqual([10, 5]);
    expect([phone.title.promptFont, pad.title.promptFont]).toEqual([30, 30]);
    expect([phone.title.versionFont, pad.title.versionFont]).toEqual([14, 7]);
    expect([phone.title.versionInset, pad.title.versionInset]).toEqual([10, 5]);
    expect([normalizeCreditSpacePt(40, "iphone"), normalizeCreditSpacePt(40, "ipad")])
      .toEqual([40, 20]);
  });

  it("reproduces PreloaderScene's first-tick dot order", () => {
    const first = nextPreloaderDots(0);
    const second = nextPreloaderDots(first.dotCount);
    const third = nextPreloaderDots(second.dotCount);
    expect([first.text, second.text, third.text]).toEqual(["..", "...", "."]);
    expect(() => nextPreloaderDots(3)).toThrow(/0\.\.2/);
  });

  it("caps progress at 98 and truncates the positive %d display", () => {
    expect(sourceLoadPercentage(0.253)).toBeCloseTo(25.3);
    expect(sourceLoadPercentageText(0.253)).toBe(" 25%");
    expect(sourceLoadPercentage(1)).toBe(98);
    expect(sourceLoadPercentageText(1)).toBe(" 98%");
  });

  it("holds white for one second before alternating title fades", () => {
    expect(titlePromptTint(0)).toBe(0xffffff);
    expect(titlePromptTint(500)).toBe(0xffffff);
    expect(titlePromptTint(1_000)).toBe(0xffffff);
    expect(titlePromptTint(1_500)).toBe(0xc0c0c0);
    expect(titlePromptTint(2_000)).toBe(0x808080);
    expect(titlePromptTint(2_500)).toBe(0xc0c0c0);
    expect(titlePromptTint(3_000)).toBe(0xffffff);
  });

  it("skips save selection only when all three records are absent", () => {
    const empty = [
      { slotId: "slot-1", exists: false, compatible: true },
      { slotId: "slot-2", exists: false, compatible: true },
      { slotId: "slot-3", exists: false, compatible: true },
    ] as const;
    expect(sourceTitleDestination(empty)).toEqual({ kind: "slot", slotId: "slot-1" });
    expect(sourceTitleDestination([
      ...empty.slice(0, 2),
      { slotId: "slot-3", exists: true, compatible: false, updatedAt: "source-mtime" },
    ])).toEqual({ kind: "save-select" });
  });

  it("builds labels and the raw-verified two-column order", () => {
    const records: StartupSlotRecord[] = [
      record("slot-1", 7),
      { slotId: "slot-2", exists: false, compatible: true },
      { slotId: "slot-3", exists: true, compatible: false, updatedAt: "other-mtime" },
    ];
    expect(sourceSaveSlotLabel(records[0]!, strings)).toBe("Level 7 @ source-mtime");
    expect(sourceSaveSlotLabel(records[1]!, strings)).toBe("New Game");
    expect(sourceSaveSlotLabel(records[2]!, strings)).toBe(
      "Different Asset Archive @ other-mtime",
    );

    const [first, second] = sourceSaveSelectColumns(records, strings);
    expect(first.map((item) => item.kind)).toEqual(["slot", "slot", "slot", "erase"]);
    expect(first.slice(0, 3).map((item) =>
      item.kind === "slot" ? [item.slotId, item.occupied, item.enabled] : [])).toEqual([
      ["slot-1", true, true],
      ["slot-2", false, true],
      ["slot-3", false, false],
    ]);
    expect(second.map((item) => item.kind)).toEqual(["credits", "options", "back"]);
  });

  it("omits Erase Game when no compatible occupied slot exists", () => {
    const [first, second] = sourceSaveSelectColumns([
      { slotId: "slot-1", exists: false, compatible: true },
      { slotId: "slot-2", exists: true, compatible: false },
      { slotId: "slot-3", exists: false, compatible: true },
    ], strings);
    expect(first.map((item) => item.kind)).toEqual(["slot", "slot", "slot"]);
    expect(second.map((item) => item.kind)).toEqual(["credits", "options", "back"]);
  });

  it("omits Erase Game when the backing store is export-only", () => {
    const [first] = sourceSaveSelectColumns([
      record("slot-1", 7),
      { slotId: "slot-2", exists: false, compatible: true },
      { slotId: "slot-3", exists: false, compatible: true },
    ], strings, undefined, false);
    expect(first.map((item) => item.kind)).toEqual(["slot", "slot", "slot"]);
  });
});
