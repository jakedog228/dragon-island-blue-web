import { describe, expect, it } from "vitest";

import {
  statusFinishWaitsForFollowingUpdate,
  state1ContinuationDelayMs,
} from "../src/battle/battleNodeScene.js";

describe("BattleNode state-1 continuation routes", () => {
  it("skips both team delays when statusTextAdvance: releases state 1", () => {
    expect(state1ContinuationDelayMs(0, "status-text-finish")).toBe(0);
    expect(state1ContinuationDelayMs(1, "status-text-finish")).toBe(0);
  });

  it("retains team pacing on notifyBattleStateChangedTo:'s empty-text route", () => {
    expect(state1ContinuationDelayMs(0, "empty-status")).toBe(1000);
    expect(state1ContinuationDelayMs(1, "empty-status")).toBe(2250);
  });

  it("waits one update after a manual finish, but not after the ordered wait-limit callback", () => {
    expect(statusFinishWaitsForFollowingUpdate("status-text-finish", "manual")).toBe(true);
    expect(statusFinishWaitsForFollowingUpdate("status-text-finish", "wait-limit")).toBe(false);
    expect(statusFinishWaitsForFollowingUpdate("status-text-finish", "none")).toBe(false);
    expect(statusFinishWaitsForFollowingUpdate("empty-status", "manual")).toBe(false);
  });
});
