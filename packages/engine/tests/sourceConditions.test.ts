import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadTownPortalDestinations,
  resolveDataDir,
  type WorldResourceSource,
} from "@dib/gamedata";
import { sourceConditionsAreMet, type SourceConditionContext } from "../src/sourceConditions.js";

function shippedTownPortals() {
  const dataDir = resolveDataDir();
  const source: WorldResourceSource = {
    has: (path) => path.endsWith(".plist")
      ? existsSync(resolve(dataDir, `${path.slice(0, -6)}.json`))
      : true,
    plist: (path) => JSON.parse(readFileSync(
      resolve(dataDir, `${path.slice(0, -6)}.json`),
      "utf8",
    )) as unknown,
  };
  return loadTownPortalDestinations(source);
}

function context(overrides: Partial<SourceConditionContext> = {}): SourceConditionContext {
  return {
    hasSeenChat: () => false,
    hasCompletedBattle: () => false,
    hasCompletedQuest: () => false,
    canUseQuest: () => false,
    hasCompletedPoi: () => false,
    goldPurchased: 0,
    ...overrides,
  };
}

describe("source Conditions", () => {
  it("applies negated predicates and IAP bounds conjunctively", () => {
    expect(sourceConditionsAreMet({
      chats: ["Seen", "!Hidden"],
      minIAPMade: 2,
      maxIAPMade: 4,
    }, context({
      hasSeenChat: (name) => name === "Seen",
      goldPurchased: 3,
    }))).toBe(true);
  });

  it("uses source and/or recursive short-circuit order", () => {
    const runtime = context({ hasCompletedQuest: () => false });
    expect(sourceConditionsAreMet({
      quests: ["Missing"],
      orCondition: { chats: ["!NeverSeen"] },
    }, runtime)).toBe(true);
    expect(sourceConditionsAreMet({
      orCondition: { chats: ["!NeverSeen"] },
      andCondition: { battles: ["Missing"] },
    }, runtime)).toBe(false);
  });

  it("matches the shipped liberation portal truth table", () => {
    const normalTown = {
      quests: ["LiberateTownsQuest"],
      orCondition: {
        battles: ["RenderableTownNameKey"],
        inProgressQuests: ["LiberateTownsQuest"],
        orCondition: { inProgressQuests: ["!LiberateTownsQuest"] },
      },
    } as const;
    const secretTown = {
      quests: ["LiberateTownsQuest"],
      orCondition: { inProgressQuests: ["LiberateTownsQuest"] },
    } as const;
    const state = (active: boolean, battle: boolean, finished: boolean) => context({
      canUseQuest: () => active,
      hasCompletedBattle: () => battle,
      hasCompletedQuest: () => finished,
    });
    expect(sourceConditionsAreMet(normalTown, state(false, false, false))).toBe(true);
    expect(sourceConditionsAreMet(normalTown, state(true, false, false))).toBe(false);
    expect(sourceConditionsAreMet(normalTown, state(true, true, false))).toBe(true);
    expect(sourceConditionsAreMet(normalTown, state(false, false, true))).toBe(true);
    expect(sourceConditionsAreMet(secretTown, state(false, false, false))).toBe(false);
    expect(sourceConditionsAreMet(secretTown, state(true, false, false))).toBe(true);
    expect(sourceConditionsAreMet(secretTown, state(false, false, true))).toBe(true);
  });

  it("evaluates every shipped Town Warp portal, including Longdale and Secret_City", () => {
    const portals = shippedTownPortals();
    const normal = portals.filter(({ townName }) => townName !== "Secret_City");
    expect(normal).toHaveLength(8);
    const activeIncomplete = context({
      canUseQuest: (name) => name === "LiberateTownsQuest",
      hasCompletedQuest: () => false,
      hasCompletedBattle: () => false,
    });
    const activeLongdaleBattleDone = context({
      canUseQuest: (name) => name === "LiberateTownsQuest",
      hasCompletedQuest: () => false,
      hasCompletedBattle: (name) => name === "RenderableLongdale_CityNameKey",
    });
    const complete = context({
      canUseQuest: () => false,
      hasCompletedQuest: (name) => name === "LiberateTownsQuest",
    });
    for (const { portalConditions } of normal) {
      expect(sourceConditionsAreMet(portalConditions, activeIncomplete)).toBe(false);
    }
    expect(sourceConditionsAreMet(
      portals.find(({ townName }) => townName === "Longdale_City")!.portalConditions,
      activeIncomplete,
    )).toBe(false);
    expect(sourceConditionsAreMet(
      portals.find(({ townName }) => townName === "Longdale_City")!.portalConditions,
      activeLongdaleBattleDone,
    )).toBe(true);
    expect(sourceConditionsAreMet(
      portals.find(({ townName }) => townName === "Secret_City")!.portalConditions,
      activeIncomplete,
    )).toBe(true);
    expect(normal.every(({ portalConditions }) =>
      sourceConditionsAreMet(portalConditions, complete))).toBe(true);
    expect(sourceConditionsAreMet(
      portals.find(({ townName }) => townName === "Secret_City")!.portalConditions,
      complete,
    )).toBe(true);
  });
});
