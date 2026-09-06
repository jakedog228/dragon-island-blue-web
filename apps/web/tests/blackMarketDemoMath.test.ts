import { describe, expect, it } from "vitest";
import { screenPointsForMode } from "../src/displayMode.js";
import { blackMarketDemoLayout } from "../src/world/blackMarketDemoMath.js";

describe("Black Market demo layout", () => {
  it("pins the phone PORT ADAPTATION geometry", () => {
    expect(blackMarketDemoLayout("iphone")).toEqual({
      label: { x: 240, y: 24, fontSize: 22 },
      cards: [
        { x: 18, y: 50, width: 214, height: 254 },
        { x: 248, y: 50, width: 214, height: 254 },
      ],
    });
  });

  it("pins the iPad PORT ADAPTATION geometry", () => {
    expect(blackMarketDemoLayout("ipad")).toEqual({
      label: { x: 256, y: 27, fontSize: 24 },
      cards: [
        { x: 22, y: 58, width: 229, height: 304 },
        { x: 261, y: 58, width: 229, height: 304 },
      ],
    });
  });

  it.each(["iphone", "ipad"] as const)("keeps the two adaptation cards on-screen: %s", (mode) => {
    const screen = screenPointsForMode(mode);
    const layout = blackMarketDemoLayout(mode);
    expect(layout.cards).toHaveLength(2);
    expect(layout.cards[0]!.x + layout.cards[0]!.width).toBeLessThanOrEqual(screen.w);
    expect(layout.cards[1]!.x + layout.cards[1]!.width).toBeLessThanOrEqual(screen.w);
    expect(layout.cards[0]!.y + layout.cards[0]!.height).toBeLessThanOrEqual(screen.h);
    expect(layout.cards[1]!.y + layout.cards[1]!.height).toBeLessThanOrEqual(screen.h);
    expect(layout.cards[0]!.x + layout.cards[0]!.width).toBeLessThan(layout.cards[1]!.x);
  });
});
