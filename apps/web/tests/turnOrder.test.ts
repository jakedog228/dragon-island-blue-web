import { describe, it, expect, vi } from "vitest";


vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));
import {
  turnOrderEntryY,
  turnOrderLayout,
  turnOrderEntryChildLayout,
  heroDisplayPosition,
  formatTimeDelay,
  TURN_ORDER_STEP,
  TURN_ORDER_ENTRY_X,
  TURN_ORDER_ROOT_Y,
  TURN_ORDER_CAPTURE_REMOVAL_DELAY_MS,
  TURN_ORDER_DEATH_REMOVAL_DELAY_MS,
  TURN_ORDER_REMOVAL_FALL_MS,
  TURN_ORDER_REMOVAL_TARGET,
  TURN_ORDER_REMOVAL_ROTATION_DEG,
  TURN_ORDER_WARP_MS,
  TURN_ORDER_FLIP_MS,
  TURN_ORDER_SLIDE_MS,
  TURN_ORDER_RESTORE_MS,
  turnOrderMembershipChanges,
  turnOrderLabelFill,
  enemyNameColor,
  ENEMY_NAME_COLOR_FALLBACK,
} from "../src/battle/displayShared.js";


describe("turnOrderEntryY (updateOrder @ 0xef180, step 34/iPhone)", () => {
  it("step is 34 (iPhone, data_ef458/data_efd7c)", () => {
    expect(TURN_ORDER_STEP).toBe(34);
  });

  it("entry 0 (queue-front) sits one step down from the column's own origin", () => {
    expect(turnOrderEntryY(0)).toBe(34);
  });

  it("steps downward by 34pt per index: 34, 68, 102, ...", () => {
    expect([0, 1, 2, 3, 4].map(turnOrderEntryY)).toEqual([34, 68, 102, 136, 170]);
  });

  it("is exactly (index+1)*34", () => {
    for (let i = 0; i < 8; i++) {
      expect(turnOrderEntryY(i)).toBe((i + 1) * 34);
    }
  });
});

describe("turnOrderLayout (pure column snapshot for N entries)", () => {
  it("places every entry at x = TURN_ORDER_ENTRY_X (12pt, data_efd84/iPhone)", () => {
    expect(TURN_ORDER_ENTRY_X).toBe(12);
    const slots = turnOrderLayout(["a", "b", "c"]);
    expect(slots.every((s) => s.x === 12)).toBe(true);
  });

  it("sort = provider order: id at array index i keeps index i's y, no re-sorting", () => {
    const order = ["zeta", "alpha", "mid"]; // deliberately NOT alphabetical -- queOrder decides
    const slots = turnOrderLayout(order);
    expect(slots.map((s) => s.id)).toEqual(order);
    expect(slots.map((s) => s.y)).toEqual([34, 68, 102]);
  });

  it("handles 0, 1, and many entries", () => {
    expect(turnOrderLayout([])).toEqual([]);
    expect(turnOrderLayout(["solo"])).toEqual([{ id: "solo", x: 12, y: 34 }]);
    const many = turnOrderLayout(["a", "b", "c", "d", "e", "f"]);
    expect(many.map((s) => s.y)).toEqual([34, 68, 102, 136, 170, 204]);
  });

  it("re-deriving the layout from a reordered array reflects the new order, not stale positions", () => {
    const before = turnOrderLayout(["a", "b", "c"]);
    const after = turnOrderLayout(["b", "a", "c"]);
    expect(before.find((s) => s.id === "a")!.y).toBe(34);
    expect(after.find((s) => s.id === "a")!.y).toBe(68);
  });
});

describe("TURN_ORDER_ROOT_Y (battle-node.md scene table: (0, winSize.height-5) iPhone)", () => {
  it("is 5 (320 - (320-5), this port's Y-flip convention)", () => {
    expect(TURN_ORDER_ROOT_Y).toBe(5);
  });
});


describe("turnOrderEntryChildLayout (addNodeForMonster: @ 0xef460, Cocos anchor(0,0)/Y-up)", () => {
  it("extends the icon UP from the entry origin (Y-down local top = -height)", () => {
    expect(turnOrderEntryChildLayout(24, 6.5).iconY).toBe(-24);
  });

  it("centers the label on the icon vertically (Cocos y = scaledH*0.5)", () => {
    expect(turnOrderEntryChildLayout(24, 6.5).labelCenterY).toBe(-12);
  });

  it("rides the bar over the icon's bottom: Cocos (0,-3) anchor (0,0) -> Y-down bar top -3.5", () => {
    // Regression: a prior revision floated the bar at an uncited +2 BELOW the icon, stretching
    // every entry to ~32.5pt of the 34pt pitch — the user-reported "smushed" column. The cited
    // placement spans Cocos -3..+3.5, leaving ~7pt of air between entries (IMG_1952.PNG).
    expect(turnOrderEntryChildLayout(24, 6.5).barY).toBe(-3.5);
  });

  it("puts entry 0's 24pt icon top at screen y=15 (root 5 + step 34 - icon 24 = Cocos 320-305)", () => {
    expect(TURN_ORDER_ROOT_Y + turnOrderEntryY(0) + turnOrderEntryChildLayout(24, 6.5).iconY).toBe(15);
  });

  it("keeps a six-entry column's last 24pt icon fully above the combat bar top (224pt)", () => {
    // Regression: the pre-fix downward composition put this icon's bottom at 233pt, sinking it
    // behind the 96pt combatBottomBar (appstore_2.jpg shows six entries fully clear of it).
    const lastIconBottom = TURN_ORDER_ROOT_Y + turnOrderEntryY(5) + turnOrderEntryChildLayout(24, 6.5).iconY + 24;
    expect(lastIconBottom).toBe(209);
    expect(lastIconBottom).toBeLessThan(224);
  });

  it("leaves clear air between entries: entry N's bar bottom sits 7pt above entry N+1's icon top", () => {
    const layout = turnOrderEntryChildLayout(24, 6.5);
    const barBottom = turnOrderEntryY(0) + layout.barY + 6.5; // Y-down: top + height
    const nextIconTop = turnOrderEntryY(1) + layout.iconY;
    expect(nextIconTop - barBottom).toBe(7);
  });
});

// HeroDisplay resting position winSize - contentSize (turn-panel.md §1, team-displays.md §4),
// contentSize = heroFrame.png's point size (team-displays.md §6) — NOT the Pixi bounds union,
// which the 2pt-taller substituted heroBattlePortrait inflates (heroDisplay.ts header).
describe("heroDisplayPosition (winSize - heroFrame.contentSize, team-displays.md §4/§6)", () => {
  it("anchors the 79x96pt heroFrame flush to the screen's bottom-right: (401, 224)", () => {
    expect(heroDisplayPosition(79, 96)).toEqual({ x: 401, y: 224 });
  });

  it("would NOT be flush if fed the portrait-inflated 98pt union height (the pre-fix bug)", () => {
    expect(heroDisplayPosition(79, 98).y).toBe(222);
  });
});

describe("turn-order removal/addition lifecycle", () => {
  it("uses the recovered ordinary-death fall constants", () => {
    expect(TURN_ORDER_DEATH_REMOVAL_DELAY_MS).toBe(0);
    expect(TURN_ORDER_CAPTURE_REMOVAL_DELAY_MS).toBe(2000);
    expect(TURN_ORDER_REMOVAL_FALL_MS).toBe(3000);
    expect(TURN_ORDER_REMOVAL_TARGET).toEqual({ x: 120, y: 415 });
    expect(TURN_ORDER_REMOVAL_ROTATION_DEG).toBe(90);
  });

  it("uses a linear 500ms CCMoveTo for every non-excluded correction", () => {
    expect(TURN_ORDER_WARP_MS).toBe(500);
  });

  it("uses the three recovered 500ms actor legs", () => {
    expect(TURN_ORDER_FLIP_MS).toBe(500);
    expect(TURN_ORDER_SLIDE_MS).toBe(500);
    expect(TURN_ORDER_RESTORE_MS).toBe(500);
  });

  it("models a bench substitution as one removal and one immediate addition", () => {
    expect(turnOrderMembershipChanges(["actor", "dead", "other"], ["other", "bench", "actor"])).toEqual({
      removed: ["dead"],
      added: ["bench"],
    });
  });
});


describe("turnOrderLabelFill (addNodeForMonster: enemy-label × 0.75)", () => {
  it("team 0 is plain white regardless of any tint", () => {
    expect(turnOrderLabelFill(0)).toBe(0xffffff);
    expect(turnOrderLabelFill(0, 0x123456)).toBe(0xffffff);
  });

  it("dims each real slot color per-channel by 0.75 (floored)", () => {
    expect(turnOrderLabelFill(1, enemyNameColor(0))).toBe(0x7070bf); // (150,150,255) -> (112,112,191)
    expect(turnOrderLabelFill(1, enemyNameColor(1))).toBe(0xbf4b4b); // (255,100,100) -> (191,75,75)
    expect(turnOrderLabelFill(1, enemyNameColor(2))).toBe(0x4bbf4b); // (100,255,100) -> (75,191,75)
  });

  it("renders the white fallback as the reported 0xBFBFBF grey — the un-mapped-enemy signature", () => {


    expect(turnOrderLabelFill(1)).toBe(0xbfbfbf);
    expect(turnOrderLabelFill(1, ENEMY_NAME_COLOR_FALLBACK)).toBe(0xbfbfbf);
  });

  it("never equals a live slot's dimmed color (grey is visually distinguishable)", () => {
    for (const slot of [0, 1, 2]) {
      expect(turnOrderLabelFill(1, enemyNameColor(slot))).not.toBe(0xbfbfbf);
    }
  });
});

// turn-order-input.md §1: CCLabelTTF format string "%3d" fed from [Battle timeDelayForLiving:].
describe('formatTimeDelay ("%3d", turn-order-input.md §1)', () => {
  it("space-pads single digits to width 3", () => {
    expect(formatTimeDelay(0)).toBe("  0");
    expect(formatTimeDelay(7)).toBe("  7");
  });

  it("space-pads double digits to width 3", () => {
    expect(formatTimeDelay(21)).toBe(" 21");
  });

  it("does not pad triple digits", () => {
    expect(formatTimeDelay(125)).toBe("125");
    expect(formatTimeDelay(146)).toBe("146");
  });

  it("does not truncate values wider than 3 digits (printf minimum-width, not fixed-width)", () => {
    expect(formatTimeDelay(1234)).toBe("1234");
  });

  it("truncates a fractional delay toward zero (printf %d, not rounding)", () => {
    expect(formatTimeDelay(73.9)).toBe(" 73");
  });

  it("matches the footage-cited ascending sequence 0, 21, 73, 125, 146", () => {
    expect([0, 21, 73, 125, 146].map(formatTimeDelay)).toEqual(["  0", " 21", " 73", "125", "146"]);
  });
});
