import { describe, expect, it } from "vitest";
import { PVP_LISTING, pvpLibraryEntry, pvpListingMatches } from "../src/pvp/pvpModListing.js";
import { listingState } from "../src/content/modLibraryModel.js";

describe("included PvP listing", () => {
  it("has real gallery metadata and uses normal installed/enabled listing states", () => {
    expect(PVP_LISTING.screenshots).toEqual([]);
    expect(PVP_LISTING.description).toContain("Arena");
    expect(PVP_LISTING.description).toContain("Only reviewed cosmetic mods are allowed");
    expect(PVP_LISTING.description).toContain("even when both players select the same mod");
    expect(listingState(PVP_LISTING, [pvpLibraryEntry(false, false)])).toBe("installed");
    expect(listingState(PVP_LISTING, [pvpLibraryEntry(true, false)])).toBe("enabled");
  });
  it("honors search, tag and author filters", () => {
    expect(pvpListingMatches("pVp")).toBe(true);
    expect(pvpListingMatches("", "Multiplayer", PVP_LISTING.author.id)).toBe(true);
    expect(pvpListingMatches("missing-mod")).toBe(false);
    expect(pvpListingMatches("", "Cosmetic")).toBe(false);
    expect(pvpListingMatches("", undefined, "someone-else")).toBe(false);
  });
});
