import { describe, expect, it } from "vitest";
import type { ImportedContentPackage } from "../src/content/archivePackage.js";
import {
  assertOfficialContentBoundary,
  assertOnlinePlayAvailable,
  ONLINE_MODS_ACTIVATED_MESSAGE,
  ONLINE_MODS_SELECTED_MESSAGE,
  onlinePlayAvailability,
} from "../src/content/onlineModBoundary.js";

const baseContent = {} as ImportedContentPackage;
const moddedContent = {
  modProfile: {},
  mods: {},
} as unknown as ImportedContentPackage;

describe("Offline mod / Online authority boundary", () => {
  it("makes Online unavailable while mod files are selected", () => {
    expect(onlinePlayAvailability({
      selectedModCount: 2,
      modCodeWasActivated: false,
    })).toEqual({ available: false, reason: ONLINE_MODS_SELECTED_MESSAGE });
    expect(() => assertOnlinePlayAvailable({
      selectedModCount: 1,
      modCodeWasActivated: false,
    })).toThrow(ONLINE_MODS_SELECTED_MESSAGE);
  });

  it("keeps Online unavailable for the tab after full-trust code has run", () => {
    expect(onlinePlayAvailability({
      selectedModCount: 0,
      modCodeWasActivated: true,
    })).toEqual({ available: false, reason: ONLINE_MODS_ACTIVATED_MESSAGE });
    expect(() => assertOnlinePlayAvailable({
      selectedModCount: 0,
      modCodeWasActivated: true,
    })).toThrow(ONLINE_MODS_ACTIVATED_MESSAGE);
  });

  it("allows a clean tab with no selected mods", () => {
    expect(onlinePlayAvailability({
      selectedModCount: 0,
      modCodeWasActivated: false,
    })).toEqual({ available: true });
    expect(() => assertOnlinePlayAvailable({
      selectedModCount: 0,
      modCodeWasActivated: false,
    })).not.toThrow();
  });

  it("rejects an activated mod profile at the final Official boot boundary", () => {
    expect(() => assertOfficialContentBoundary({
      content: moddedContent,
      official: {},
    })).toThrow("Online cannot start with an activated Offline mod profile.");
    expect(() => assertOfficialContentBoundary({ content: moddedContent })).not.toThrow();
    expect(() => assertOfficialContentBoundary({
      content: baseContent,
      official: {},
    })).not.toThrow();
  });
});
