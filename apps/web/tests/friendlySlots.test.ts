import { describe, it, expect, vi } from "vitest";


vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));


import { formatBarFraction } from "@dib/renderer/barMath";
import {
  positionForSlot,
  positionForSlotForMode,
  partyCardX,
  FRIENDLY_SLOT_WIDTH,
  friendlyCardChromeLayout,
  contentSizeFromChildUnion,
  deathThenCompactSchedule,
  FRIENDLY_DEATH_REMOVE_MS,
  FRIENDLY_DEATH_SPIN_MS,
  FRIENDLY_DEATH_COMPACT_DELAY_MS,
  SUMMON_SLOT_INDEX,
  SUMMON_EVICT_DELAY_MS,
  SUMMON_EVICT_REMOVE_MS,
} from "../src/battle/displayShared.js";


describe("positionForSlot", () => {
  it("slot 0 -> 5 (the summon/spirit fifth)", () => {
    expect(positionForSlot(0)).toBe(5);
  });

  it("slots 1..3 (the party cards) -> 101/197/293", () => {
    expect(positionForSlot(1)).toBe(101);
    expect(positionForSlot(2)).toBe(197);
    expect(positionForSlot(3)).toBe(293);
  });

  it("is exactly slot * (480/5) + 5", () => {
    expect(FRIENDLY_SLOT_WIDTH).toBe(96);
    for (let i = 0; i < 4; i++) {
      expect(positionForSlot(i)).toBe(i * 96 + 5);
    }
  });

  it("party card i maps to slot i+1 (partyCardX)", () => {
    expect(partyCardX(0)).toBe(101);
    expect(partyCardX(2)).toBe(293);
  });
});

describe("normalized iPad friendly-card geometry", () => {
  it("halves the bare native five-point inset on both positionForSlot lanes", () => {
    expect(positionForSlotForMode(0, "ipad")).toBe(2.5);
    expect(positionForSlotForMode(1, "ipad")).toBeCloseTo(104.9);
  });

  it("rounds HP/name placement in native coordinates", () => {
    expect(friendlyCardChromeLayout(80, 13, "iphone")).toEqual({
      barCenterX: 40,
      barCenterY: 7,
      nameX: 5,
      nameBottomY: 16,
    });
    expect(friendlyCardChromeLayout(512 / 6, 13, "ipad")).toEqual({
      barCenterX: 42.5,
      barCenterY: 6.5,
      nameX: 2.5,
      nameBottomY: 14,
    });
  });

  it("derives card size from the child union instead of forcing slot width", () => {
    const size = contentSizeFromChildUnion([
      { x: 10, y: 4, w: 70, h: 70 },
      { x: 2.5, y: 1.3, w: 80, h: 10.4 },
      { x: 2.5, y: 14, w: 42, h: 16 },
    ]);
    expect(size.w).toBe(80);
    expect(size.h).toBeCloseTo(72.7);
  });
});


describe("deathThenCompactSchedule (pure scheduling helper, team-displays.md §4)", () => {
  it("starts dying immediately and compacts at its one-second endpoint", () => {
    const steps = deathThenCompactSchedule();
    expect(steps.map((s) => s.phase)).toEqual(["dying", "compact", "remove"]);
    expect(steps.map((s) => s.atMs)).toEqual([0, 1000, 1000]);
  });

  it("the 'dying' phase lasts the card's own 1.0s scale+spin animation", () => {
    const [dying] = deathThenCompactSchedule();
    expect(dying!.durationMs).toBe(FRIENDLY_DEATH_SPIN_MS);
    expect(dying!.durationMs).toBe(1000);
  });

  it("'compact' fires at 1.0s with no additional duration", () => {
    const [, compact] = deathThenCompactSchedule();
    expect(compact!.phase).toBe("compact");
    expect(compact!.atMs).toBe(FRIENDLY_DEATH_COMPACT_DELAY_MS);
    expect(compact!.durationMs).toBe(0);
  });

  it("retains the scale-zero dying node for the source's further 1.0s removal action", () => {
    const [, , remove] = deathThenCompactSchedule();
    expect(remove).toEqual({ phase: "remove", atMs: 1000, durationMs: FRIENDLY_DEATH_REMOVE_MS });
    expect(remove!.atMs + remove!.durationMs).toBe(2000);
  });

  it("returns a fresh timeline on every call (no shared mutable state across dying cards)", () => {
    const a = deathThenCompactSchedule();
    const b = deathThenCompactSchedule();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});


describe("summon slot constants (soulstones.md §10.11)", () => {
  it("the summon occupies unified-grid slot 0 (positionForSlot x = 5)", () => {
    expect(SUMMON_SLOT_INDEX).toBe(0);
    expect(positionForSlot(SUMMON_SLOT_INDEX)).toBe(5);
  });

  it("eviction lingers 1.0s + an inert 0.5s removal action = hard cut at 1.5s total", () => {
    expect(SUMMON_EVICT_DELAY_MS).toBe(1000);
    expect(SUMMON_EVICT_REMOVE_MS).toBe(500);
    expect(SUMMON_EVICT_DELAY_MS + SUMMON_EVICT_REMOVE_MS).toBe(1500);
  });
});

// ProgressBar's own "%d/%d" fraction label (team-displays.md §5, followup-consts.md §3):
// FriendlyMonsterDisplay is the first (and, per the doc, only) consumer that actually renders
// this label -- EnemyMonsterDisplay opts out with a null labelFontFile.
describe("formatBarFraction (ProgressBar's %d/%d label, team-displays.md §5)", () => {
  it("formats floor(currentPercent*max) over trunc(max)", () => {
    expect(formatBarFraction(1.0, 178)).toBe("178/178");
    expect(formatBarFraction(0, 178)).toBe("0/178");
  });

  it("floors a fractional eased percent rather than rounding", () => {
    // 117/158 was mid-ease at ~0.7405...; floor(0.7405*158) = floor(116.99..) = 116, not 117 --
    // pins the eased-percent-vs-raw-hp distinction (followup-consts.md §1 sanity check number).
    expect(formatBarFraction(117 / 158, 158)).toBe("116/158");
  });

  it("truncates a non-integer max toward zero", () => {
    expect(formatBarFraction(0.5, 99.9)).toBe("49/99");
  });
});
