import { describe, expect, it } from "vitest";
import {
  SOURCE_BLACK_SCENE_FADE_HALF_MS,
  SOURCE_BLACK_SCENE_FADE_MS,
} from "../src/sourceSceneFadeMath.js";

describe("source black scene fade", () => {
  it("pins sub_66534's complete duration and opaque midpoint", () => {
    expect(SOURCE_BLACK_SCENE_FADE_MS).toBe(500);
    expect(SOURCE_BLACK_SCENE_FADE_HALF_MS).toBe(250);
  });
});
