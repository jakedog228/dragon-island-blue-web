import { describe, expect, it } from "vitest";
import {
  characterSkillsLayout,
  storeCarouselLayout,
} from "./playerScreenLayoutMath.js";

describe("source player-screen layouts", () => {
  it("preserves CharacterSkills native phone and normalized iPad geometry", () => {
    expect(characterSkillsLayout("iphone")).toEqual({
      freeInset: 10,
      rowX: 30,
      rowCocosY: [70, 190],
      rowGap: 50,
      adjustGap: 12,
      cellGap: 2,
    });
    expect(characterSkillsLayout("ipad")).toEqual({
      freeInset: 5,
      rowX: 30,
      rowCocosY: [90, 230],
      rowGap: 50,
      adjustGap: 12,
      cellGap: 2,
    });
  });

  it("places Store CFlow at the source win-size fraction in both tiers", () => {
    expect(storeCarouselLayout("iphone")).toEqual({
      center: { x: 240, y: 176 },
      topBuffer: 40,
      bottomBuffer: 80,
      descriptionInset: 10,
    });
    expect(storeCarouselLayout("ipad")).toEqual({
      center: { x: 256, y: 211.2 },
      topBuffer: 40,
      bottomBuffer: 80,
      descriptionInset: 5,
    });
  });
});
