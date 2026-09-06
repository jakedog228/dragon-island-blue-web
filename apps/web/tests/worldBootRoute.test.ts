import { describe, expect, it } from "vitest";
import {
  initialWorldBootRoute,
  resolveRestoredTownDestination,
  restoredTownMetadata,
} from "../src/world/worldBootRoute.js";

const restoredTownDestinations = [
  { townName: "OldTown", worldName: "Demo", sortOrder: 0 },
  { townName: "NewTown", worldName: "Demo", sortOrder: 1 },
] as const;

describe("world-only boot routing", () => {
  it("resumes the explicit world POI when town capability is absent", () => {
    expect(initialWorldBootRoute({
      hasTownCapability: false,
      townName: undefined,
      fixturePoiName: "ScenarioStart",
      fixturePoiIsTown: false,
      presentationResumeMode: "other",
    })).toEqual({ kind: "resumeWorld" });
  });

  it("retains the prior fail-loud startup error for town-capable content without a destination", () => {
    expect(() => initialWorldBootRoute({
      hasTownCapability: true,
      townName: undefined,
      fixturePoiName: undefined,
      fixturePoiIsTown: undefined,
      presentationResumeMode: "other",
    })).toThrow("resolved town destination");
  });

  it("keeps town resume and initial routes distinct for town-capable content", () => {
    expect(initialWorldBootRoute({
      hasTownCapability: true,
      townName: "First_City",
      fixturePoiName: "ScenarioStart",
      fixturePoiIsTown: true,
      presentationResumeMode: "town",
    })).toEqual({ kind: "resumeTown", townName: "ScenarioStart" });
    expect(initialWorldBootRoute({
      hasTownCapability: true,
      townName: "First_City",
      fixturePoiName: undefined,
      fixturePoiIsTown: undefined,
      presentationResumeMode: "other",
    })).toEqual({ kind: "initial", fade: false, townName: "First_City" });
  });

  it("resumes an explicit parsed non-town fixture POI in a town-capable archive", () => {
    expect(initialWorldBootRoute({
      hasTownCapability: true,
      townName: "First_City",
      fixturePoiName: "Collection_Hut",
      fixturePoiIsTown: false,
      presentationResumeMode: "other",
    })).toEqual({ kind: "resumeWorld" });
  });

  it("drops stale restored town metadata only for world-only content", () => {
    expect(restoredTownMetadata(false, "OldTown")).toBeUndefined();
    expect(restoredTownMetadata(true, "OldTown")).toBe("OldTown");
    expect(restoredTownMetadata(true, undefined)).toBeUndefined();
  });

  it("resolves valid restored town metadata unchanged through the production resolver", () => {
    expect(resolveRestoredTownDestination(true, "OldTown", restoredTownDestinations))
      .toBe(restoredTownDestinations[0]);
  });

  it("fails loudly for an invalid restored town through the production resolver", () => {
    expect(() => resolveRestoredTownDestination(true, "MissingTown", restoredTownDestinations))
      .toThrow("Town Portal saved town MissingTown is unavailable");
  });

  it("ignores invalid restored town metadata for townless content through the same path", () => {
    expect(resolveRestoredTownDestination(false, "MissingTown", restoredTownDestinations)).toBeUndefined();
  });
});
