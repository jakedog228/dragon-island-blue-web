import { describe, it, expect, vi } from "vitest";


vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));
import {
  ENEMY_NAME_COLORS,
  ENEMY_NAME_COLOR_FALLBACK,
  enemyNameColor,
  portraitFrameKey,
  shrinkToFitScale,
  ENEMY_ABILITY_PULSE_SCALE,
  ENEMY_ABILITY_PULSE_LEG_MS,
  automaticTurnActivationMotion,
} from "../src/battle/displayShared.js";

describe("enemy ability activation pulse (EnemyMonsterDisplay @ 0x99418)", () => {
  it("uses the raw 1.5x, 0.5s-per-leg CCScaleTo sequence", () => {
    expect(ENEMY_ABILITY_PULSE_SCALE).toBe(1.5);
    expect(ENEMY_ABILITY_PULSE_LEG_MS).toBe(500);
  });
});

describe("automaticTurnActivationMotion (battle.md §1 disabled→state-3 skip)", () => {
  it("suppresses both teams' forced status-skip LooseTurn motion", () => {
    expect(automaticTurnActivationMotion(0, "Utility.LooseTurn")).toBe("none");
    expect(automaticTurnActivationMotion(1, "Utility.LooseTurn")).toBe("none");
  });

  it("routes ordinary automatic turns to the actor team's source motion", () => {
    expect(automaticTurnActivationMotion(0, "Offensive.Attack")).toBe("friendlyPopForward");
    expect(automaticTurnActivationMotion(1, "Offensive.Sleep.Sleep")).toBe("enemyPulse");
  });

  it("keeps AI fallback Delay motion because it still traverses state 2", () => {
    expect(automaticTurnActivationMotion(0, "Utility.Delay")).toBe("friendlyPopForward");
    expect(automaticTurnActivationMotion(1, "Utility.Delay")).toBe("enemyPulse");
  });
});

describe("enemyNameColor (sub_98420 @ 0x98420, team-displays.md §2)", () => {
  it("slot 0 -> (150,150,255) light blue", () => {
    expect(enemyNameColor(0)).toBe(0x9696ff);
  });

  it("slot 1 -> (255,100,100) light red", () => {
    expect(enemyNameColor(1)).toBe(0xff6464);
  });

  it("slot 2 -> (100,255,100) light green", () => {
    expect(enemyNameColor(2)).toBe(0x64ff64);
  });

  it("matches the exported table in order", () => {
    expect(ENEMY_NAME_COLORS).toEqual([0x9696ff, 0xff6464, 0x64ff64]);
  });

  it("any other slot index falls back to white (displayColorForMonster: @ 0x9b570, 0x1f591a)", () => {
    expect(enemyNameColor(3)).toBe(ENEMY_NAME_COLOR_FALLBACK);
    expect(enemyNameColor(-1)).toBe(0xffffff);
    expect(enemyNameColor(99)).toBe(0xffffff);
  });
});

describe("portraitFrameKey (MonsterPortraits-hd atlas naming)", () => {
  it("appends _icon.png to the shortType", () => {
    expect(portraitFrameKey("Minotaur")).toBe("Minotaur_icon.png");
    expect(portraitFrameKey("Spark")).toBe("Spark_icon.png");
  });
});

describe("shrinkToFitScale (sub_65d50 @ 0x65d50, followup-consts.md §2)", () => {
  it("shrinks proportionally to fit the tighter of width/height", () => {
    expect(shrinkToFitScale(200, 100, 100, 100)).toBeCloseTo(0.5);
  });

  it("never upscales past 1.0 when content is already smaller than the target", () => {
    expect(shrinkToFitScale(50, 50, 100, 100)).toBe(1.0);
  });

  it("picks the smaller of the two axis ratios", () => {
    // width ratio 0.5, height ratio 0.25 -> the tighter constraint (height) wins.
    expect(shrinkToFitScale(200, 400, 100, 100)).toBeCloseTo(0.25);
  });

  it("is exactly min(1.0, targetW/contentW, targetH/contentH)", () => {
    const contentW = 173;
    const contentH = 88;
    const targetW = 118;
    const targetH = 140;
    expect(shrinkToFitScale(contentW, contentH, targetW, targetH)).toBeCloseTo(
      Math.min(1.0, targetW / contentW, targetH / contentH),
    );
  });
});

describe("rarity-star band position (showStars @ 0x98f40, raw disasm y lane)", () => {
  it("Cocos origin y = contentHeight - 15 = 195 -> Pixi band TOP = 15 (stars hang below)", async () => {
    const { RARITY_STAR_BAND_TOP_PIXI_Y, ENEMY_SLOT_HEIGHT } = await import("../src/battle/displayShared.js");


    expect(ENEMY_SLOT_HEIGHT).toBe(210);
    expect(RARITY_STAR_BAND_TOP_PIXI_Y).toBe(15);
  });
});


describe("enemy team entrance constants (initWithTeam: @ 0x99b80, raw ARM 0x99ec0-0x9a076)", () => {
  it("staggers members at 0.5s + 0.25s*i (0x3f000000 vadd @ 0x99ff6, 0x3e800000 vmul @ 0x99fe8)", async () => {
    const { enemyEntranceDelayMs } = await import("../src/battle/displayShared.js");
    expect(enemyEntranceDelayMs(0)).toBe(500);
    expect(enemyEntranceDelayMs(1)).toBe(750);
    expect(enemyEntranceDelayMs(2)).toBe(1000);
  });

  it("selects the asymmetric 70/160 x pair and doubled y/gap pairs before normalizing", async () => {
    const {
      enemyTeamLayoutMetrics,
      enemySlotHeightForMode,
      membersBoxXCocos,
      membersBoxYCocos,
      enemyEntranceDropPts,
    } = await import("../src/battle/displayShared.js");
    expect(enemyTeamLayoutMetrics("iphone")).toEqual({ offsetX: 70, offsetY: 90, marginTop: 20, gapTwo: 64 });
    expect(enemyTeamLayoutMetrics("ipad")).toEqual({ offsetX: 80, offsetY: 90, marginTop: 20, gapTwo: 64 });
    expect(membersBoxXCocos(3 * 128, "iphone")).toBe(83);
    expect(membersBoxXCocos(3 * 128, "ipad")).toBe(104);
    expect(membersBoxYCocos("iphone")).toBe(195);
    expect(membersBoxYCocos("ipad")).toBe(227);
    expect(enemySlotHeightForMode("iphone")).toBe(210);
    expect(enemySlotHeightForMode("ipad")).toBe(274);
    expect(enemyEntranceDropPts("iphone")).toBe(125);
    expect(enemyEntranceDropPts("ipad")).toBe(157);
  });

  it("drops from winH - boxYCocos = 125pt above rest (vsub d13,d0 @ 0x99fac; boxY=195 iPhone)", async () => {
    const { enemyEntranceDropPts, membersBoxYCocos } = await import("../src/battle/displayShared.js");
    expect(membersBoxYCocos()).toBe(195);
    expect(enemyEntranceDropPts()).toBe(125);
  });

  it("moves for 1.0s (mov r2,#0x3f800000 @ 0x9a010); reorder move + deferral are also 1.0s", async () => {
    const { ENEMY_ENTRANCE_MOVE_MS, ENEMY_REORDER_MOVE_MS, ENEMY_ADDED_REORDER_DELAY_MS } = await import(
      "../src/battle/displayShared.js"
    );
    expect(ENEMY_ENTRANCE_MOVE_MS).toBe(1000);
    expect(ENEMY_REORDER_MOVE_MS).toBe(1000);
    expect(ENEMY_ADDED_REORDER_DELAY_MS).toBe(1000);
  });
});

describe("reorderEntranceStart (reorderMonsters @ 0x9aaa8 new-child branch, raw 0x9aea0-0x9af0a)", () => {
  it("drops the promoted reserve from 125pt above rest, x compensated by the box shift", async () => {
    const { reorderEntranceStart } = await import("../src/battle/displayShared.js");
    // Box moved left 64pt to make room (boxNew < boxOld); child rest (256, 0) box-local, world
    // x = 19+256 = 275 <= 480, so x keeps its layout value minus the (negative) shift.
    const start = reorderEntranceStart({ x: 256, y: 0 }, 19, 83);
    expect(start.x).toBe(256 - (19 - 83)); // 320
    expect(start.y).toBe(0 - 125);
  });

  it("clamps to winW/2 when the new child's world x would exceed the screen (vcmpe @ 0x9aec2)", async () => {
    const { reorderEntranceStart } = await import("../src/battle/displayShared.js");
    const start = reorderEntranceStart({ x: 470, y: 0 }, 83, 83);
    expect(start.x).toBe(240); // 480*0.5, no box shift
  });
});

describe("capture-card idle (MonsterTurnPanel @ 0x9eb08 capture loop, raw thumb2 0x9fdce-0x9ff0a)", () => {
  it("delay = rand*3s + 6s, one fixed draw per card (vmul 3.0 @ 0x9fedc, vadd 6.0 @ 0x9fee0)", async () => {
    const { captureCardIdleDelayMs } = await import("../src/battle/displayShared.js");
    expect(captureCardIdleDelayMs(0)).toBe(6000);
    expect(captureCardIdleDelayMs(0.5)).toBe(7500);
    expect(captureCardIdleDelayMs(0.999)).toBeLessThan(9000);
  });

  it("shakes 0.5s at offset (2,2) (r2=0x3f000000, r3/stack=0x40000000 @ 0x9ff0a)", async () => {
    const { CAPTURE_CARD_SHAKE_MS, CAPTURE_CARD_SHAKE_OFFSET, captureCardShakeOffset } = await import(
      "../src/battle/displayShared.js"
    );
    expect(CAPTURE_CARD_SHAKE_MS).toBe(500);
    expect(CAPTURE_CARD_SHAKE_OFFSET).toBe(2);
    expect(captureCardShakeOffset("iphone")).toBe(2);
    expect(captureCardShakeOffset("ipad")).toBe(1);
  });
});

describe("proven bare spatial animation literals", () => {
  it("halves native iPad bob and death-shake distances without changing durations", async () => {
    const { enemyIdleBobAmplitude, enemyDeathShakeOffset } = await import("../src/battle/displayShared.js");
    expect(enemyIdleBobAmplitude("iphone")).toBe(20);
    expect(enemyIdleBobAmplitude("ipad")).toBe(10);
    expect(enemyDeathShakeOffset("iphone")).toBe(3);
    expect(enemyDeathShakeOffset("ipad")).toBe(1.5);
  });
});

describe('capture-card "NEW!" overlay (raw thumb2 0x9ff50-0xa01de)', () => {
  it("glow: scale 1/0.75 (vdiv @ 0x9ff88), 0.5s fade legs (@ 0x9ffff-0xa0036)", async () => {
    const { NEW_OVERLAY_GLOW_SCALE, NEW_OVERLAY_GLOW_FADE_LEG_MS } = await import("../src/battle/displayShared.js");
    expect(NEW_OVERLAY_GLOW_SCALE).toBeCloseTo(1 / 0.75);
    expect(NEW_OVERLAY_GLOW_FADE_LEG_MS).toBe(500);
  });

  it("label: 14pt iPhone (0x41600000), starts at glowScale*0.5, pops 2.0s, fade-removes 0.5s", async () => {
    const {
      NEW_OVERLAY_LABEL_SIZE,
      NEW_OVERLAY_LABEL_START_SCALE,
      NEW_OVERLAY_GLOW_SCALE,
      NEW_OVERLAY_LABEL_POP_MS,
      NEW_OVERLAY_LABEL_FADE_REMOVE_MS,
    } = await import("../src/battle/displayShared.js");
    expect(NEW_OVERLAY_LABEL_SIZE).toBe(14); // suite pins DISPLAY_MODE "iphone"
    expect(NEW_OVERLAY_LABEL_START_SCALE).toBeCloseTo(NEW_OVERLAY_GLOW_SCALE * 0.5);
    expect(NEW_OVERLAY_LABEL_POP_MS).toBe(2000);
    expect(NEW_OVERLAY_LABEL_FADE_REMOVE_MS).toBe(500);
  });
});

describe("demoPlayerCollection (UserSavedData.highestLevelMonsterOfSimpleType: stand-in)", () => {
  it("reports captured types and defaults everything else to never-captured (NEW)", async () => {
    const { demoPlayerCollection } = await import("../src/player/playerCollection.js");
    const c = demoPlayerCollection(["Minotaur", "Spark"]);
    expect(c.hasCapturedSimpleType("Minotaur")).toBe(true);
    expect(c.hasCapturedSimpleType("Spark")).toBe(true);
    expect(c.hasCapturedSimpleType("UnhappyBird")).toBe(false);
    expect(c.hasCapturedSimpleType("FireCub")).toBe(false);
  });
});
