import { describe, expect, it } from "vitest";
// Pure "./barMath" subpath export, not the package root: the root index.ts pulls in PixiJS, which
// throws `navigator is not defined` under plain Node/vitest (see friendlySlots.test.ts).
import { cropTextureRect } from "@dib/renderer/barMath";
import {
  CHAINED_TEXT_CHAT_DIM_ALPHA,
  CHAINED_TEXT_CHAT_DIM_FADE_MS,
  CHAINED_TEXT_CHAT_PORTRAIT_TOASTER_MS,
  chainedTextChatDimAlpha,
  chainedTextChatPortraitRevealFraction,
} from "../src/ui/chainedTextChatMath.js";

describe("source ChainedTextLabel presenter dim", () => {
  it("fades a first chat to opacity 200 over exactly 0.5 seconds", () => {
    expect(chainedTextChatDimAlpha(0, false)).toBe(0);
    expect(chainedTextChatDimAlpha(CHAINED_TEXT_CHAT_DIM_FADE_MS / 2, false))
      .toBeCloseTo(100 / 255);
    expect(chainedTextChatDimAlpha(CHAINED_TEXT_CHAT_DIM_FADE_MS, false))
      .toBe(CHAINED_TEXT_CHAT_DIM_ALPHA);
    expect(chainedTextChatDimAlpha(5_000, false)).toBe(CHAINED_TEXT_CHAT_DIM_ALPHA);
  });

  it("starts an auto-presented stacked chat at the final dim opacity", () => {
    expect(chainedTextChatDimAlpha(0, true)).toBe(200 / 255);
  });

  it("rejects invalid elapsed time instead of fabricating an opacity", () => {
    expect(() => chainedTextChatDimAlpha(-1, false)).toThrow(/nonnegative/);
    expect(() => chainedTextChatDimAlpha(Number.NaN, false)).toThrow(/finite/);
  });
});

describe("source ChainedTextLabel portrait ToasterAction", () => {
  it("draws the portrait up from nothing to full over exactly 0.25 seconds", () => {
    expect(CHAINED_TEXT_CHAT_PORTRAIT_TOASTER_MS).toBe(250);
    expect(chainedTextChatPortraitRevealFraction(0)).toBe(0);
    expect(chainedTextChatPortraitRevealFraction(125)).toBeCloseTo(0.5);
    expect(chainedTextChatPortraitRevealFraction(250)).toBe(1);
  });

  it("holds the portrait at full size once the action is done", () => {
    expect(chainedTextChatPortraitRevealFraction(400)).toBe(1);
    expect(chainedTextChatPortraitRevealFraction(60_000)).toBe(1);
  });

  it("crops the cached textureRect from the bottom, never the top or the width", () => {


    const full = { x: 4, y: 8, w: 120, h: 160 };
    expect(cropTextureRect(full, chainedTextChatPortraitRevealFraction(0), false, false))
      .toEqual({ x: 4, y: 8, w: 120, h: 0 });
    expect(cropTextureRect(full, chainedTextChatPortraitRevealFraction(125), false, false))
      .toEqual({ x: 4, y: 8, w: 120, h: 80 });
    expect(cropTextureRect(full, chainedTextChatPortraitRevealFraction(250), false, false))
      .toEqual(full);
  });

  it("rejects invalid elapsed time instead of fabricating a reveal", () => {
    expect(() => chainedTextChatPortraitRevealFraction(-1)).toThrow(/nonnegative/);
    expect(() => chainedTextChatPortraitRevealFraction(Number.NaN)).toThrow(/finite/);
  });
});
