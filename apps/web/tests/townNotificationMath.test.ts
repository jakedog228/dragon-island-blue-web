import { describe, expect, it } from "vitest";
import {
  TOWN_DAY_BANNER_COLOR,
  TOWN_DAY_BANNER_LIFETIME_MS,
  TOWN_DAY_BANNER_TOP_COLOR,
  townDayBannerLayout,
  townDayBannerTouchActive,
  townDayBannerY,
} from "../src/world/townNotificationMath.js";

describe("town day notification", () => {
  it("normalizes the native phone/iPad banner geometry independently", () => {
    expect(townDayBannerLayout("iphone")).toEqual({
      width: 480,
      height: 50,
      imageSlot: 50,
      imageCenter: { x: 30, y: 25 },
      textX: 65,
      titleY: 3,
      messageY: 47,
      titleFontSize: 14,
      messageFontSize: 16,
    });
    expect(townDayBannerLayout("ipad")).toEqual({
      width: 512,
      height: 50,
      imageSlot: 50,
      imageCenter: { x: 27.5, y: 25 },
      textX: 57.5,
      titleY: 1.5,
      messageY: 48.5,
      titleFontSize: 14,
      messageFontSize: 16,
    });
    expect(TOWN_DAY_BANNER_COLOR).toBe(0x2a4494);
    expect(TOWN_DAY_BANNER_TOP_COLOR).toBe(0x003264);
  });

  it("slides down from above for .5s, holds 2s, then exits upward for .5s", () => {
    expect(TOWN_DAY_BANNER_LIFETIME_MS).toBe(3_000);
    expect(townDayBannerY(0, "iphone")).toBe(-50);
    expect(townDayBannerY(250, "iphone")).toBe(-25);
    expect(townDayBannerY(500, "iphone")).toBe(0);
    expect(townDayBannerY(2_500, "iphone")).toBe(0);
    expect(townDayBannerY(2_750, "iphone")).toBe(-25);
    expect(townDayBannerY(3_000, "iphone")).toBe(-50);

    expect(townDayBannerY(0, "ipad")).toBe(-50);
    expect(townDayBannerY(500, "ipad")).toBe(0);
  });

  it("swallows banner touches only during the fully shown hold interval", () => {
    expect(townDayBannerTouchActive(499)).toBe(false);
    expect(townDayBannerTouchActive(500)).toBe(true);
    expect(townDayBannerTouchActive(2_499)).toBe(true);
    expect(townDayBannerTouchActive(2_500)).toBe(false);
    expect(townDayBannerTouchActive(1_000, true)).toBe(false);
  });
});
