import { describe, it, expect, vi } from "vitest";


vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));
import { gridSequence, matchStroke, BATTLE_STROKES } from "@dib/renderer/strokeGrid";
import {
  abilityIsSwipeable,
  swipeableFromTargeting,
  SWIPE_DIRECTION_BY_SLOT,
  swipeSpriteKey,
  slotNumberOf,
  formatTU,
  lockedSlotNumbers,
  swipeZoneBounds,
  panelLayoutY,
  abilitySlotPixiPos,
  abilityCardLabelOffsets,
  bottomRowGap,
  bottomRowPixiPos,
  captureCardPixiPosition,
  ACTING_CARD_Y_COCOS,
  ABILITY_SLOT_STEP,
  abilityInfoButtonTopLeft,
} from "../src/battle/turnPanelMath.js";


describe("abilityIsSwipeable (raw targetPickerData truth table, @0xa041c)", () => {
  it("self (nil targetPickerData) -> false", () => {
    expect(abilityIsSwipeable(undefined)).toBe(false);
  });

  it("single-enemy -> true", () => {
    expect(abilityIsSwipeable({ enemyTargetsNeeded: 1, allEnemies: false, friendlyTargetsNeeded: 0 })).toBe(true);
  });

  it("all-enemies -> true", () => {
    expect(abilityIsSwipeable({ enemyTargetsNeeded: 0, allEnemies: true, friendlyTargetsNeeded: 0 })).toBe(true);
  });

  it("single-friendly -> false", () => {
    expect(abilityIsSwipeable({ enemyTargetsNeeded: 0, allEnemies: false, friendlyTargetsNeeded: 1 })).toBe(false);
  });

  it("enemy+friendly -> false", () => {
    expect(abilityIsSwipeable({ enemyTargetsNeeded: 1, allEnemies: false, friendlyTargetsNeeded: 1 })).toBe(false);
  });

  it("multi-enemy (enemyTargetsNeeded > 1, not allEnemies) -> false", () => {
    expect(abilityIsSwipeable({ enemyTargetsNeeded: 2, allEnemies: false, friendlyTargetsNeeded: 0 })).toBe(false);
  });
});

describe("swipeableFromTargeting (adapter from @dib/engine's Targeting)", () => {
  it("self -> false", () => {
    expect(swipeableFromTargeting({ kind: "self" })).toBe(false);
  });
  it("single enemy -> true", () => {
    expect(swipeableFromTargeting({ kind: "enemies", count: 1 })).toBe(true);
  });
  it("multi enemy -> false", () => {
    expect(swipeableFromTargeting({ kind: "enemies", count: 2 })).toBe(false);
  });
  it("allEnemies -> true", () => {
    expect(swipeableFromTargeting({ kind: "allEnemies" })).toBe(true);
  });
  it("friends -> false", () => {
    expect(swipeableFromTargeting({ kind: "friends", count: 1 })).toBe(false);
  });
  it("allFriends -> false", () => {
    expect(swipeableFromTargeting({ kind: "allFriends" })).toBe(false);
  });
});


describe("SWIPE_DIRECTION_BY_SLOT / swipeSpriteKey", () => {
  it("maps slot 1-4 to leftToRight/rightToLeft/upToDown/downToUp in that order", () => {
    expect(SWIPE_DIRECTION_BY_SLOT[1]).toBe("leftToRight");
    expect(SWIPE_DIRECTION_BY_SLOT[2]).toBe("rightToLeft");
    expect(SWIPE_DIRECTION_BY_SLOT[3]).toBe("upToDown");
    expect(SWIPE_DIRECTION_BY_SLOT[4]).toBe("downToUp");
  });

  it("swipeSpriteKey appends the -hd asset suffix", () => {
    expect(swipeSpriteKey("leftToRight")).toBe("leftToRight-hd");
    expect(swipeSpriteKey("upToDown")).toBe("upToDown-hd");
  });
});

describe("slotNumberOf (JobAbilityRef.slot \"usableN\" -> N, = ability.slot per turn-panel.md §9)", () => {
  it("parses usable1..usable4", () => {
    expect(slotNumberOf("usable1")).toBe(1);
    expect(slotNumberOf("usable2")).toBe(2);
    expect(slotNumberOf("usable3")).toBe(3);
    expect(slotNumberOf("usable4")).toBe(4);
  });

  it("throws on anything else (fail loudly per repo convention)", () => {
    expect(() => slotNumberOf("usable5")).toThrow();
    expect(() => slotNumberOf("Charisma")).toThrow();
  });
});

// followup-layout.md §2.1d: localized "ActivationLengthKey" ("TU") + "%@:%d".
describe("formatTU", () => {
  it('formats "TU:<activationLength>"', () => {
    expect(formatTU(130)).toBe("TU:130"); // the doc's own cited on-screen example
    expect(formatTU(50)).toBe("TU:50");
  });
});

describe("ability info-button alignment (@0x9fa48-0x9faa8)", () => {
  it("centers the icon at row x + 30 and on the TU label's vertical center", () => {
    expect(abilityInfoButtonTopLeft(67, 12, 16, 16)).toEqual({ x: 22, y: 65 });
    expect(22 + 16 / 2).toBe(30);
    expect(65 + 16 / 2).toBe(67 + 12 / 2);
  });

  it("uses the complete phone/iPad label-offset pairs", () => {
    expect(abilityCardLabelOffsets("iphone")).toEqual({ nameY: 40, tuY: 67, infoCenterX: 30 });
    expect(abilityCardLabelOffsets("ipad")).toEqual({ nameY: 40, tuY: 66, infoCenterX: 30 });
    expect(abilityInfoButtonTopLeft(66, 12, 16, 16, 30)).toEqual({ x: 22, y: 64 });
  });
});

// turn-panel.md §2a's label_9f5ea algorithm.
describe("lockedSlotNumbers (turn-panel.md §2a)", () => {
  it("locks every unoccupied slot when unknownSkillsLeft covers them all", () => {
    expect(lockedSlotNumbers([1, 2], { unknownSkillsLeft: 2 })).toEqual([3, 4]);
  });

  it("stops locking once the counter is exhausted -- further unoccupied slots render nothing", () => {
    expect(lockedSlotNumbers([1], { unknownSkillsLeft: 1 })).toEqual([2]); // slots 3,4 render NOTHING
  });

  it("a fully-occupied slot list never consumes the counter", () => {
    expect(lockedSlotNumbers([1, 2, 3, 4], { unknownSkillsLeft: 3 })).toEqual([]);
  });

  it("evolveType != 0 overrides the counter to 999 (\"effectively always show '???'\")", () => {
    expect(lockedSlotNumbers([], { unknownSkillsLeft: 0, evolveType: 1 })).toEqual([1, 2, 3, 4]);
  });

  it("evolveType 0 (or omitted) leaves unknownSkillsLeft in effect", () => {
    expect(lockedSlotNumbers([], { unknownSkillsLeft: 0, evolveType: 0 })).toEqual([]);
    expect(lockedSlotNumbers([2], { unknownSkillsLeft: 1 })).toEqual([1]);
  });

  it("counter of 0 locks nothing", () => {
    expect(lockedSlotNumbers([], { unknownSkillsLeft: 0 })).toEqual([]);
  });
});

// Deferred from Task 7 (strokeRecognizer.ts's "Y-axis note") -- settled here: flip in the
// bounds-provider adapter. Pins followup-layout.md §4.1's exact "852 = upToDown" pairing against
// a PHYSICAL downward swipe expressed in Pixi's native Y-DOWN coordinates (y increasing).
describe("swipeZoneBounds (Y-axis flip decision, deferred from Task 7)", () => {
  const zone = { x: 0, y: 0, w: 90, h: 90 }; // Pixi Y-down local rect, 30x30pt cells

  it("a physical top-to-bottom swipe (Pixi y increasing) through the middle column matches upToDown", () => {
    const midX = zone.x + zone.w / 2;
    const path = [5, 20, 35, 50, 65, 80].map((y) => ({ x: midX, y })); // y INCREASING = downward on screen
    const seq = gridSequence(path, swipeZoneBounds(zone));
    expect(seq).toBe("852"); // followup-layout.md §4.1's own cited pairing for "upToDown"
    expect(matchStroke(seq, BATTLE_STROKES)).toBe("upToDown");
  });

  it("a physical bottom-to-top swipe (Pixi y decreasing) through the middle column matches downToUp", () => {
    const midX = zone.x + zone.w / 2;
    const path = [80, 65, 50, 35, 20, 5].map((y) => ({ x: midX, y }));
    const seq = gridSequence(path, swipeZoneBounds(zone));
    expect(seq).toBe("258");
    expect(matchStroke(seq, BATTLE_STROKES)).toBe("downToUp");
  });

  it("left-to-right / right-to-left swipes are unaffected by the Y-flip (column math untouched)", () => {
    const midY = zone.y + zone.h / 2;
    const rightward = [5, 20, 35, 50, 65, 80].map((x) => ({ x, y: midY }));
    expect(matchStroke(gridSequence(rightward, swipeZoneBounds(zone)), BATTLE_STROKES)).toBe("leftToRight");
    const leftward = [80, 65, 50, 35, 20, 5].map((x) => ({ x, y: midY }));
    expect(matchStroke(gridSequence(leftward, swipeZoneBounds(zone)), BATTLE_STROKES)).toBe("rightToLeft");
  });
});

// Review fix: the panel's cited Cocos Y-up values must go through the SCREEN_H − yCocos flip
// before being used as Pixi y (the same convention as displayShared.ts's FRIENDLY_ROW_Y /
// SPIRIT_BKG_Y_COCOS). These pins make a future accidental unflip fail a test rather than only
// the visual pass. combatBottomBar-hd is 96pt tall (1024x192px / 2), the bottom-row Box packs to
// (124, 30)pt (followup-layout.md §1.7).
describe("panel Y-frame flip (Cocos Y-up -> Pixi Y-down, turnPanelMath geometry helpers)", () => {
  const BAR_H = 96;

  it("panelLayoutY flips through SCREEN_H=320 (monotonic decreasing, identity endpoints)", () => {
    expect(panelLayoutY(0)).toBe(320);
    expect(panelLayoutY(320)).toBe(0);
  });

  it("acting card: Cocos bottom edge y=5 (turn-panel.md §1/§4) -> Pixi 315, near the SCREEN BOTTOM", () => {
    expect(panelLayoutY(ACTING_CARD_Y_COCOS)).toBe(315);
  });

  it("bottom row Box: floats just ABOVE the bar at the right -> Pixi (351, 189) for a (124,30) box", () => {
    // x = SCREEN_W − 5 − 124 = 351 (the documented formula's unambiguous lane, turn-panel.md §1);
    // y: footage-settled (frame_005 + appstore_2 — the three ~30pt round buttons sit in a row
    // just above the bar's top edge): Cocos box bottom = barH + 5, so Pixi top =
    // 320 − 96 − 5 − 30 = 189. See bottomRowPixiPos's doc for the tiebreak history.
    expect(bottomRowPixiPos(124, BAR_H, 30)).toEqual({ x: 351, y: 189 });
  });

  it("normalizes the bottom-row 15/20 gap pair and capture-card bare/pair offsets on iPad", () => {
    expect(bottomRowGap("iphone")).toBe(15);
    expect(bottomRowGap("ipad")).toBe(10);
    // Same three buttons: 124pt phone box becomes 114pt when two 15pt gaps become 10pt.
    expect(bottomRowPixiPos(114, BAR_H, 30, "ipad")).toEqual({ x: 393, y: 253 });
    expect(captureCardPixiPosition("iphone")).toEqual({ x: 4, y: -7 });
    expect(captureCardPixiPosition("ipad")).toEqual({ x: 2, y: -10 });
  });

  it("ability slots: anchors at (127.5 + 75·(i−1), Cocos 86) — literal-pool-resolved @ 0x9eb08 (2026-07-10)", () => {


    const s1 = abilitySlotPixiPos(1);
    const s4 = abilitySlotPixiPos(4);
    expect(ABILITY_SLOT_STEP).toBe(75);
    expect(s1).toEqual({ x: 127.5, y: 234 }); // panelLayoutY(86); base x = 90 + 75/2
    expect(s4).toEqual({ x: 127.5 + 3 * ABILITY_SLOT_STEP, y: 234 }); // = 352.5
    // All four cards share one anchored y and hang DOWN toward the 96pt bar (224..320).
    expect(s1.y).toBeGreaterThan(320 - BAR_H);
    // Slot 4's card (≤80pt wide, center 352.5, right edge ≤392.5) now clears the right-side
    // bottom-row box (left edge 480−5−124 = 351 at Pixi y 189, ABOVE the bar) — the historical
    // slot-4/button-cluster overlap was a wrong-step artifact.
    expect(s4.x + 40).toBeLessThan(480 - 5);
  });

  it("uses the ctor's 180/172 iPad pair before normalizing into port points", () => {
    const s1 = abilitySlotPixiPos(1, "ipad");
    const s4 = abilitySlotPixiPos(4, "ipad");
    expect(s1).toEqual({ x: 133, y: 298 });
    expect(s4).toEqual({ x: 391, y: 298 });
    expect(s4.x - s1.x).toBe(3 * 86);
  });
});
