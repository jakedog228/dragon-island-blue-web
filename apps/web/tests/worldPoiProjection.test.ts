import { describe, expect, it } from "vitest";
import { projectWorldPoiState } from "../src/world/worldPoiProjection.js";

describe("projectWorldPoiState", () => {
  it("materializes each native flag identity", () => {
    expect(projectWorldPoiState(0, false)).toEqual({
      materialized: true,
      renderedState: 0,
      renderedTextureKey: "greenFlag-hd",
    });
    expect(projectWorldPoiState(1, false).renderedTextureKey).toBe("redFlag-hd");
    expect(projectWorldPoiState(2, false).renderedTextureKey).toBe("blueFlag-hd");
    expect(projectWorldPoiState(4, false).renderedTextureKey).toBe("walkArrow");
  });

  it("makes state 3 and blocked routes genuinely non-materialized", () => {
    const absent = {
      materialized: false,
      renderedState: null,
      renderedTextureKey: null,
    };
    expect(projectWorldPoiState(3, false)).toEqual(absent);
    expect(projectWorldPoiState(2, true)).toEqual(absent);
  });
});
