import test from "node:test";
import assert from "node:assert/strict";
import { pvpClockStepMs } from "./pvpCombatDriver.mjs";

test("terminal automatic tails advance both devices without changing input cadence", () => {
  for (const state of ["turnLeadIn", "phaseDelay", "impact", "deathResolution", "turnComplete", "abilityQueued", "battleEndDelay", "battleEnded"]) {
    const board = { status: "ended", presentation: { state } };
    assert.equal(pvpClockStepMs(board), 100);
    assert.equal(pvpClockStepMs({ ...board, status: "active" }), 25);
    for (const blocker of [{ rendering: true }, { statusText: { visible: true } }, { activePopup: "confirm" }, { picking: true }])
      assert.equal(pvpClockStepMs({ ...board, ...blocker }), 25);
  }
});

test("decisions and unknown states never receive terminal batching", () => {
  for (const state of ["awaitingPlayerChoice", "awaitingOpponent", "building", "unknown", undefined])
    assert.equal(pvpClockStepMs({ status: "ended", presentation: { state } }), 25);
  assert.equal(pvpClockStepMs(), 25);
});
