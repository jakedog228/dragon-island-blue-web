import { describe, expect, it } from "vitest";
import {
  monsterpediaIngredientFlashAlpha,
  monsterpediaIngredientFlashOpacity,
  monsterpediaSelectedLabelChannel,
  monsterpediaSelectedLabelTint,
  stepMonsterpediaCocosInterval,
  waitForMonsterpediaInputLock,
} from "../src/world/monsterpediaAnimationMath.js";

describe("Monsterpedia Cocos interval clock", () => {
  it("holds the first scheduled tick at progress zero", () => {
    const first = stepMonsterpediaCocosInterval(0, 1000 / 60, true);
    expect(first).toEqual({ elapsedMs: 0, firstTick: false });
    const second = stepMonsterpediaCocosInterval(first.elapsedMs, 1000 / 60, first.firstTick);
    expect(second.elapsedMs).toBeCloseTo(1000 / 60, 10);
  });

  it("holds input for the full interval and detaches its ticker callback", async () => {
    const callbacks = new Set<() => void>();
    const ticker = {
      deltaMS: 50,
      add: (callback: () => void) => callbacks.add(callback),
      remove: (callback: () => void) => callbacks.delete(callback),
    };
    const wait = waitForMonsterpediaInputLock(ticker, 200, new AbortController().signal);
    for (let index = 0; index < 5; index += 1) {
      for (const callback of [...callbacks]) callback();
    }
    await expect(wait).resolves.toBe(true);
    expect(callbacks.size).toBe(0);
  });

  it("cancels and detaches the lock when its owning flow is disposed", async () => {
    const callbacks = new Set<() => void>();
    const ticker = {
      deltaMS: 16,
      add: (callback: () => void) => callbacks.add(callback),
      remove: (callback: () => void) => callbacks.delete(callback),
    };
    const controller = new AbortController();
    const wait = waitForMonsterpediaInputLock(ticker, 200, controller.signal);
    controller.abort();
    await expect(wait).resolves.toBe(false);
    expect(callbacks.size).toBe(0);
  });
});

describe("Monsterpedia recipe ingredient flash", () => {
  it("matches the repeated linear fade sequence and 8-bit truncation", () => {
    expect([
      monsterpediaIngredientFlashOpacity(0),
      monsterpediaIngredientFlashOpacity(1),
      monsterpediaIngredientFlashOpacity(250),
      monsterpediaIngredientFlashOpacity(499),
      monsterpediaIngredientFlashOpacity(500),
      monsterpediaIngredientFlashOpacity(501),
      monsterpediaIngredientFlashOpacity(750),
      monsterpediaIngredientFlashOpacity(999),
      monsterpediaIngredientFlashOpacity(1000),
    ]).toEqual([255, 254, 127, 0, 0, 0, 127, 254, 255]);
    expect(monsterpediaIngredientFlashAlpha(250)).toBe(127 / 255);
    expect(monsterpediaIngredientFlashOpacity(-250)).toBe(127);
  });
});

describe("Monsterpedia Complete List selected-label tint", () => {
  it("runs the source black-to-white-to-black byte sequence", () => {
    expect([
      monsterpediaSelectedLabelChannel(0),
      monsterpediaSelectedLabelChannel(1),
      monsterpediaSelectedLabelChannel(250),
      monsterpediaSelectedLabelChannel(499),
      monsterpediaSelectedLabelChannel(500),
      monsterpediaSelectedLabelChannel(501),
      monsterpediaSelectedLabelChannel(750),
      monsterpediaSelectedLabelChannel(999),
      monsterpediaSelectedLabelChannel(1000),
    ]).toEqual([0, 0, 127, 254, 255, 254, 127, 0, 0]);
    expect(monsterpediaSelectedLabelTint(250)).toBe(0x7f7f7f);
  });
});
