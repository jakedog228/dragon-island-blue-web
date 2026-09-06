import { describe, expect, it, vi } from "vitest";
import * as blackMarketDemoModel from "../src/world/blackMarketDemoModel.js";
import {
  BLACK_MARKET_DEMO_CARDS,
  openBlackMarketDemoCard,
  type BlackMarketDemoCard,
  type ExternalPageOpener,
} from "../src/world/blackMarketDemoModel.js";

const PRESERVATION_IMAGE_URL =
  "https://placehold.co/640x360/png?text=Preservation+Demo";
const COMMUNITY_IMAGE_URL =
  "https://placehold.co/640x360/png?text=Community+Demo";
const EXAMPLE_COM = "https://example.com/";
const EXAMPLE_ORG = "https://example.org/";

describe("Black Market demo card model", () => {
  it("keeps the approved DEMO CONTENT cards in their literal order", () => {
    expect(BLACK_MARKET_DEMO_CARDS.map((card) => card.id)).toEqual([
      "preservation",
      "community",
    ]);
    expect(BLACK_MARKET_DEMO_CARDS).toEqual([
      expect.objectContaining({
        id: "preservation",
        imageUrl: PRESERVATION_IMAGE_URL,
        destinationUrl: EXAMPLE_COM,
      }),
      expect.objectContaining({
        id: "community",
        imageUrl: COMMUNITY_IMAGE_URL,
        destinationUrl: EXAMPLE_ORG,
      }),
    ]);
  });

  it("contains only exact HTTPS image URLs from the fixed placeholder host", () => {
    expect(BLACK_MARKET_DEMO_CARDS.every((card) => {
      const imageUrl = new URL(card.imageUrl);
      return imageUrl.protocol === "https:" && imageUrl.hostname === "placehold.co";
    })).toBe(true);
    expect(BLACK_MARKET_DEMO_CARDS.map((card) => card.imageUrl)).toEqual([
      PRESERVATION_IMAGE_URL,
      COMMUNITY_IMAGE_URL,
    ]);
  });

  it("deeply freezes the catalog and every card", () => {
    expect(Object.isFrozen(BLACK_MARKET_DEMO_CARDS)).toBe(true);
    for (const card of BLACK_MARKET_DEMO_CARDS) {
      expect(Object.isFrozen(card)).toBe(true);
    }

    expect(() => {
      (BLACK_MARKET_DEMO_CARDS as BlackMarketDemoCard[]).push({
        id: "preservation",
        title: "authored",
        body: "authored",
        imageUrl: "https://evil.example/image.png",
        destinationUrl: EXAMPLE_COM,
      });
    }).toThrow(TypeError);
    expect(() => {
      (BLACK_MARKET_DEMO_CARDS[0] as unknown as {
        destinationUrl: BlackMarketDemoCard["destinationUrl"];
      }).destinationUrl = "https://evil.example/" as BlackMarketDemoCard["destinationUrl"];
    }).toThrow(TypeError);
  });

  it("opens only the fixed destination for a known card with exact flags", () => {
    const open = vi.fn();
    const opener: ExternalPageOpener = { open };

    openBlackMarketDemoCard("preservation", opener);
    openBlackMarketDemoCard("community", opener);

    expect(open.mock.calls).toEqual([
      [EXAMPLE_COM, "_blank", "noopener,noreferrer"],
      [EXAMPLE_ORG, "_blank", "noopener,noreferrer"],
    ]);
  });

  it.each([
    "unknown",
    "https://user:password@example.com/",
    "https://example.com.evil.example/",
    "https://example.com/?redirect=https%3A%2F%2Fevil.example%2F",
    "package-authored-url",
  ])("rejects an unrecognized or hostile runtime ID: %s", (cardId) => {
    const opener: ExternalPageOpener = { open: vi.fn() };

    expect(() => openBlackMarketDemoCard(
      cardId as BlackMarketDemoCard["id"],
      opener,
    )).toThrow(/unknown Black Market demo card/i);
    expect(opener.open).not.toHaveBeenCalled();
  });

  it("does not expose a runtime authored/package URL entry point", () => {
    expect(Object.keys(blackMarketDemoModel).sort()).toEqual([
      "BLACK_MARKET_DEMO_CARDS",
      "openBlackMarketDemoCard",
    ]);
  });
});
