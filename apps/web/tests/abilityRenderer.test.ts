import { describe, it, expect } from "vitest";
import {
  rectMid,
  rectFromCorners,
  parseCocosPoint,
  effectPosition,
  frameDelaySeconds,
  frameDelayMs,
  effectAnimationLifetimeMs,
  DEFAULT_FPS,
  DAMAGE_FLOATER_COLOR,
  HEAL_FLOATER_COLOR,
  MESSAGE_DEFAULT_COLOR,
  MISS_FLOATER_COLOR,
  FRAME_SLIDE_MS,
  FRAME_SLIDE_FADE_MS,
  FLOATER_FONT_SIZE_PT,
  FLOATER_DISTANCE_PT,
  floaterFontSizePt,
  floaterDistancePt,
  parameterMessageOffsetPt,
  parameterRowStepPt,
  parameterFloaterPosition,
  effectTextPresentation,
  CAPTURE_INITIAL_FLIGHT_MS,
  CAPTURE_SHAKE_MS,
  CAPTURE_FAILURE_ACTION_MS,
  CAPTURE_FAILURE_MOVE_MS,
  CAPTURE_FAIL_SOUND_AT_MS,
  captureCardStarRowPosition,
  floaterAlphaAt,
  floaterLifetimeMs,
  FLOATER_MIN_LIFETIME_MS,
  FLOATER_MAX_LIFETIME_MS,
  damageFloaterText,
  healFloaterText,
  resolveMeleeAttack,
  requireImplementedEffectBuilder,
  UnimplementedEffectBuilderError,
  MOTHER_FLY_MS,
  MOTHER_SCALE_MS,
  MOTHER_SCALE_PEAK,
  MOTHER_FLASH_MS,
  MOTHER_FLASH_COUNT,
  type MeleeAttacksData,
} from "../src/battle/abilityRendererMath.js";

describe("CaptureEffectBuilder failure timing", () => {
  it("plays CaptureFail after the full sequence, not when its shorter MoveTo child ends", () => {
    expect(CAPTURE_INITIAL_FLIGHT_MS).toBe(750);
    expect(CAPTURE_SHAKE_MS).toBe(800);
    expect(CAPTURE_FAILURE_MOVE_MS).toBe(500);
    expect(CAPTURE_FAILURE_ACTION_MS).toBe(750);
    expect(CAPTURE_FAIL_SOUND_AT_MS).toBe(2300);
  });
});

describe("captured MonsterCardNode rarity-row placement", () => {
  it("centers the row on the source 42pt line instead of placing its top edge there", () => {
    expect(captureCardStarRowPosition(120, 150, 35, 9.5)).toEqual({
      x: 43,
      y: 103.25,
    });
  });
});

describe("frameSlide raw action durations", () => {
  it("slides each frame for 0.25s and fades once for 0.2s", () => {
    expect(FRAME_SLIDE_MS).toBe(250);
    expect(FRAME_SLIDE_FADE_MS).toBe(200);
  });
});


describe("effectPosition — target rect mid + offset (§1)", () => {
  const rect = { x: 100, y: 50, width: 40, height: 20 };

  it("rectMid returns the geometric center of a rect", () => {
    expect(rectMid(rect)).toEqual({ x: 120, y: 60 });
  });

  it("no offset -> exactly the rect's mid", () => {
    expect(effectPosition(rect)).toEqual({ x: 120, y: 60 });
  });

  it("offset present -> mid.x + offset.x, mid.y - offset.y (Cocos Y-up offset flipped into Y-down)", () => {
    // Cocos offset {5,-10}: +5 right, -10 = 10pt DOWN in Cocos Y-up -> +10 in Pixi Y-down.
    expect(effectPosition(rect, "{5,-10}")).toEqual({ x: 125, y: 70 });
  });

  it("a positive Cocos y offset (up in-game) moves the effect UP on screen (negative Pixi y delta)", () => {
    // {0,10}: 10pt up in Cocos -> mid.y - 10 in Pixi.
    expect(effectPosition(rect, "{0,10}")).toEqual({ x: 120, y: 50 });
  });

  it("parseCocosPoint parses a Cocos2d point string", () => {
    expect(parseCocosPoint("{ 12.5 , -3 }")).toEqual({ x: 12.5, y: -3 });
  });

  it("parseCocosPoint fails loudly on a malformed string (never guesses)", () => {
    expect(() => parseCocosPoint("not-a-point")).toThrow(/malformed Cocos2d point string/);
  });
});


describe("frame delay — exactly 1/fps, default 24 (§3)", () => {
  it("DEFAULT_FPS is 24", () => {
    expect(DEFAULT_FPS).toBe(24);
  });

  it("frameDelaySeconds(24) === 1/24", () => {
    expect(frameDelaySeconds(24)).toBeCloseTo(1 / 24, 12);
  });

  it("frameDelayMs(24) === 1000/24", () => {
    expect(frameDelayMs(24)).toBeCloseTo(1000 / 24, 9);
  });

  it("fps absent -> defaults to 24", () => {
    expect(frameDelaySeconds(undefined)).toBeCloseTo(1 / 24, 12);
  });

  it("fps <= 0 -> defaults to 24", () => {
    expect(frameDelaySeconds(0)).toBeCloseTo(1 / 24, 12);
    expect(frameDelaySeconds(-5)).toBeCloseTo(1 / 24, 12);
  });

  it("a real authored fps (45) is used as-is, not defaulted", () => {
    expect(frameDelayMs(45)).toBeCloseTo(1000 / 45, 9);
  });

  it("effectAnimationLifetimeMs = numFrames * frameDelayMs (net on-screen duration, §3)", () => {
    expect(effectAnimationLifetimeMs(7, 15)).toBeCloseTo(7 * (1000 / 15), 9);
    // fps absent -> default 24 applies to the total too, not just the per-frame delay.
    expect(effectAnimationLifetimeMs(24, undefined)).toBeCloseTo(1000, 9);
  });
});


describe("ParameterEffectBuilder floater parameter transcription pins (§6)", () => {
  it('damage floater text is CONFIRMED format "-%d"', () => {
    expect(damageFloaterText(42)).toBe("-42");
  });

  it('heal floater text is CONFIRMED format "+%d"', () => {
    expect(healFloaterText(17)).toBe("+17");
  });

  it("damage floater color is RED (byte-mask sets only the R byte, §6 branch 1)", () => {
    expect(DAMAGE_FLOATER_COLOR).toBe(0xff0000);
  });

  it("heal floater color is GREEN (byte-mask sets only the G byte, §6 branch 2)", () => {
    expect(HEAL_FLOATER_COLOR).toBe(0x00ff00);
  });

  it("message default color is the CONFIRMED literal 0xFFFFFF (§6 branch 4)", () => {
    expect(MESSAGE_DEFAULT_COLOR).toBe(0xffffff);
  });

  it("uses the recovered iPhone label and float/remove action constants", () => {
    expect(FLOATER_FONT_SIZE_PT).toBe(16);
    expect(FLOATER_DISTANCE_PT).toBe(30);

    expect(floaterLifetimeMs("-37")).toBe(2000);
    expect(floaterAlphaAt(1499, 2000)).toBe(1);
    expect(floaterAlphaAt(1750, 2000)).toBeCloseTo(0.5);
    expect(floaterAlphaAt(2000, 2000)).toBe(0);
  });

  it("clamps floater lifetime into `sub_64fdc`'s [2s, 15s] band", () => {
    expect(FLOATER_MIN_LIFETIME_MS).toBe(2000);
    expect(FLOATER_MAX_LIFETIME_MS).toBe(15000);
    // Under the floor: every damage/heal number and every short message.
    expect(floaterLifetimeMs("-9")).toBe(2000);
    expect(floaterLifetimeMs("Stun")).toBe(2000);
    // 6 characters is still 1.8s raw -- the floor binds right up to the 7th.
    expect(floaterLifetimeMs("123456")).toBe(2000);
    expect(floaterLifetimeMs("1234567")).toBe(2100);
    // Inside the band: the stat-change messages are the only shipped strings that clear it.
    expect(floaterLifetimeMs("Attack UP:37")).toBe(3600);
    // Above the ceiling (no shipped string reaches it; the cap is transcribed, not exercised).
    expect(floaterLifetimeMs("x".repeat(60))).toBe(15000);
  });

  it("selects and normalizes every recovered iPhone/iPad idiom pair", () => {
    expect(floaterFontSizePt("iphone")).toBe(16);
    expect(floaterFontSizePt("ipad")).toBe(12); // source 24 iPad points / port CSF-2 space
    expect(floaterDistancePt("iphone")).toBe(30);
    expect(floaterDistancePt("ipad")).toBe(30); // source 60 / 2
    expect(parameterMessageOffsetPt("iphone")).toBe(20);
    expect(parameterMessageOffsetPt("ipad")).toBe(20); // source 40 / 2
    expect(parameterRowStepPt("iphone")).toBe(20);
    expect(parameterRowStepPt("ipad")).toBe(15); // asymmetric source 30 / 2
  });

  it("places numeric rows at center/upward and message rows 20 points below their baseline", () => {
    const rect = { x: 100, y: 50, width: 40, height: 20 };
    expect(parameterFloaterPosition(rect, 0, "numeric", "iphone")).toEqual({ x: 120, y: 60 });
    expect(parameterFloaterPosition(rect, 0, "message", "iphone")).toEqual({ x: 120, y: 80 });
    expect(parameterFloaterPosition(rect, 1, "message", "iphone")).toEqual({ x: 120, y: 60 });
    expect(parameterFloaterPosition(rect, 1, "message", "ipad")).toEqual({ x: 120, y: 65 });
    expect(parameterFloaterPosition(rect, 7, "blocked", "ipad")).toEqual({ x: 120, y: 60 });
  });

  it("formats only source-produced messages with their exact localized words and colors", () => {
    const localize = (key: string) => ({
      HasteKey: "Haste",
      MissKey: "Miss",
      StatDefenseInfoTitleKey: "Defense",
    } as Record<string, string>)[key] ?? key;
    expect(effectTextPresentation({ kind: "haste", direction: "up", amount: 37 }, localize)).toEqual({
      text: "Haste UP:37", color: HEAL_FLOATER_COLOR,
    });
    expect(effectTextPresentation({
      kind: "stat", stat: "Defense", direction: "down", amount: 10,
    }, localize)).toEqual({ text: "Defense DOWN:10", color: DAMAGE_FLOATER_COLOR });


    expect(effectTextPresentation({ kind: "miss" }, localize)).toEqual({
      text: "Miss", color: MISS_FLOATER_COLOR,
    });
    expect(MISS_FLOATER_COLOR).not.toBe(MESSAGE_DEFAULT_COLOR);
  });
});

describe("AbilityRenderer target display area (handleAbilityResults: @ 0x96b9c)", () => {
  it("forms the rect only from mapped origin and contentSize corner", () => {
    expect(rectFromCorners(
      { x: 176, y: 20 },
      { x: 176 + 128, y: 20 + 210 },
    )).toEqual({ x: 176, y: 20, width: 128, height: 210 });
  });
});

describe("resolveMeleeAttack — MeleeAttacks.json[key] lookup, fail-loud on unknown key (§6 branch 3)", () => {
  const table: MeleeAttacksData = {
    AirSlam: { effectData: { animationName: "AirSlam" }, soundFile: "Hit3.m4a", type: "animation" },
    BlackHardClaw: {
      frames: [
        {
          relativeEnd: "{{0,0},{1,1}}",
          relativeStart: "{{0,0},{0,1}}",
          scaleValues: "{1,1}",
          spriteFrameName: "BlackHardClaw.png",
        },
      ],
      soundFile: "Slash7.m4a",
      type: "frameSlide",
    },
  };

  it("resolves a known animation-type key", () => {
    expect(resolveMeleeAttack(table, "AirSlam")).toEqual(table["AirSlam"]);
  });

  it("resolves a known frameSlide-type key", () => {
    expect(resolveMeleeAttack(table, "BlackHardClaw")).toEqual(table["BlackHardClaw"]);
  });

  it("throws (fail-loud) on an unknown key rather than silently rendering nothing", () => {
    expect(() => resolveMeleeAttack(table, "NoSuchAttack")).toThrow(/unknown melee attack type/);
  });
});


describe("requireImplementedEffectBuilder — fail-loud on unimplemented builder classes", () => {
  it("passes AnimationEffectBuilder through (the one implemented class)", () => {
    expect(requireImplementedEffectBuilder("AnimationEffectBuilder", "Offensive.Fire.Fire")).toBe(
      "AnimationEffectBuilder",
    );
  });

  it.each(["ParticleEffectBuilder", "CaptureEffectBuilder", "ImageEffectBuilder", "MotherEffectBuilder"])(
    "passes implemented %s through",
    (cls) => {
      expect(requireImplementedEffectBuilder(cls, "Utility.Capture")).toBe(cls);
    },
  );

  it("throws UnimplementedEffectBuilderError for an unknown future class, naming class and ability", () => {
    expect(() => requireImplementedEffectBuilder("SparkleEffectBuilder", "Utility.Capture")).toThrow(
      UnimplementedEffectBuilderError,
    );
    expect(() => requireImplementedEffectBuilder("SparkleEffectBuilder", "Utility.Capture")).toThrow(
      /SparkleEffectBuilder.*Utility\.Capture/,
    );
  });

  it("MotherEffectBuilder fly-in timings match the decoded float32 literals (effects-info.md §2)", () => {
    expect(MOTHER_FLY_MS).toBe(500);
    expect(MOTHER_SCALE_MS).toBe(200);
    expect(MOTHER_SCALE_PEAK).toBe(1.3);
    expect(MOTHER_FLASH_MS).toBe(300);
    expect(MOTHER_FLASH_COUNT).toBe(6);
  });

  it("throws for a missing/undefined class key too (never silently dropped)", () => {
    expect(() => requireImplementedEffectBuilder(undefined, "Some.Ability")).toThrow(
      /not implemented in this port: undefined \(ability Some\.Ability\)/,
    );
  });
});
