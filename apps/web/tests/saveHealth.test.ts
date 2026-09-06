import { describe, expect, it, vi } from "vitest";
import { SaveHealthMonitor, type SaveHealthState } from "../src/player/saveHealth.js";
import { SaveConflictError, SaveQuotaError, isQuotaExceeded } from "../src/player/saveErrors.js";

describe("save health monitor", () => {
  it("starts healthy and publishes the current state to new subscribers", () => {
    const monitor = new SaveHealthMonitor();
    const seen: SaveHealthState[] = [];
    monitor.subscribe((state) => seen.push(state));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ healthy: true, consecutiveFailures: 0, conflicted: false });
  });

  it("classifies each failure kind and counts consecutive failures", () => {
    const monitor = new SaveHealthMonitor();
    monitor.recordFailure("slot-1", new SaveQuotaError("slot-1", new Error("full")));
    expect(monitor.current).toMatchObject({
      healthy: false,
      failureKind: "quota",
      consecutiveFailures: 1,
      conflicted: false,
    });
    expect(monitor.current.detail).toMatch(/browser storage is full/i);

    monitor.recordFailure("slot-1", new SaveConflictError("slot-1", 4, 9));
    expect(monitor.current).toMatchObject({
      failureKind: "conflict",
      consecutiveFailures: 2,
      conflicted: true,
    });
    expect(monitor.current.detail).toMatch(/Another tab or window/);
  });

  it("falls back to the raw message for unrecognised failures", () => {
    const monitor = new SaveHealthMonitor();
    monitor.recordFailure("slot-3", new Error("disk on fire"));
    expect(monitor.current).toMatchObject({ failureKind: "unknown", conflicted: false });
    expect(monitor.current.detail).toContain("disk on fire");
  });

  it("clears the failure and records a timestamp once a write lands", () => {
    const monitor = new SaveHealthMonitor(() => new Date("2026-07-28T10:00:00.000Z"));
    monitor.recordFailure("slot-1", new Error("nope"));
    monitor.recordSuccess();
    expect(monitor.current).toEqual({
      healthy: true,
      consecutiveFailures: 0,
      conflicted: false,
      lastSuccessAt: "2026-07-28T10:00:00.000Z",
    });
  });

  it("latches the conflict until it is explicitly cleared, and keeps the last success time", () => {
    const monitor = new SaveHealthMonitor(() => new Date("2026-07-28T10:00:00.000Z"));
    monitor.recordSuccess();
    monitor.recordFailure("slot-1", new SaveConflictError("slot-1", 1, 2));
    // A later unrelated failure must not drop the conflict latch that hides the take-over action.
    monitor.recordFailure("slot-1", new Error("transient"));
    expect(monitor.current.conflicted).toBe(true);
    expect(monitor.current.lastSuccessAt).toBe("2026-07-28T10:00:00.000Z");

    monitor.clearConflict();
    expect(monitor.current.conflicted).toBe(false);
    expect(monitor.current.healthy).toBe(false);
  });

  it("notifies subscribers on every transition and stops after unsubscribe", () => {
    const monitor = new SaveHealthMonitor();
    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);
    monitor.recordFailure("slot-1", new Error("x"));
    monitor.recordSuccess();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    monitor.recordFailure("slot-1", new Error("y"));
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("does not let a throwing post-write listener reject success reporting", () => {
    const monitor = new SaveHealthMonitor();
    const seen: SaveHealthState[] = [];
    let throwOnUpdate = false;
    monitor.subscribe(() => {
      if (throwOnUpdate) throw new Error("banner observer failed");
    });
    monitor.subscribe((state) => seen.push(state));

    throwOnUpdate = true;
    expect(() => monitor.recordSuccess()).not.toThrow();
    expect(monitor.current).toMatchObject({ healthy: true, consecutiveFailures: 0 });
    expect(seen.at(-1)).toMatchObject({ healthy: true, consecutiveFailures: 0 });
  });
});

describe("quota detection", () => {
  it("recognises the DOMException shapes browsers actually throw", () => {
    expect(isQuotaExceeded(new DOMException("full", "QuotaExceededError"))).toBe(true);
    expect(isQuotaExceeded(new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED"))).toBe(true);
    expect(isQuotaExceeded(new DOMException("nope", "SecurityError"))).toBe(false);
  });

  it("recognises a plain Error whose message names the quota", () => {
    expect(isQuotaExceeded(new Error("QuotaExceededError: out of space"))).toBe(true);
    expect(isQuotaExceeded(new Error("network down"))).toBe(false);
    expect(isQuotaExceeded("quota")).toBe(false);
  });
});
