import { describe, expect, it, vi } from "vitest";
import {
  fullscreenGuidance,
  fullscreenState,
  isAppleMobileNavigator,
  performFullscreenAction,
  shouldOfferFullscreenAction,
  type FullscreenRuntime,
} from "../src/platform/fullscreenShell.js";

function runtime(overrides: Partial<FullscreenRuntime> = {}): FullscreenRuntime {
  return {
    standalone: false,
    appleMobile: false,
    fullscreenEnabled: true,
    target: { requestFullscreen: vi.fn(async () => {}) },
    ...overrides,
  };
}

describe("platform fullscreen shell", () => {
  it("prioritizes an active or installed presentation before API capability", () => {
    expect(fullscreenState(runtime({ fullscreenElement: {} }))).toBe("active");
    expect(fullscreenState(runtime({ standalone: true }))).toBe("standalone");
    expect(fullscreenState(runtime())).toBe("available");
  });

  it("routes unsupported Apple-mobile browsers to Home Screen installation guidance", () => {
    expect(fullscreenState(runtime({
      appleMobile: true,
      fullscreenEnabled: false,
      target: {},
    }))).toBe("install-required");
    expect(fullscreenState(runtime({
      fullscreenEnabled: false,
      target: {},
    }))).toBe("unavailable");
  });

  it("offers a control only when it has a useful action or install route", () => {
    expect(shouldOfferFullscreenAction("available")).toBe(true);
    expect(shouldOfferFullscreenAction("install-required")).toBe(true);
    expect(shouldOfferFullscreenAction("active")).toBe(false);
    expect(shouldOfferFullscreenAction("standalone")).toBe(false);
    expect(shouldOfferFullscreenAction("unavailable")).toBe(false);
  });

  it("enters fullscreen from the direct user action and treats orientation as best effort", async () => {
    const requestFullscreen = vi.fn(async () => {});
    const lockLandscape = vi.fn(async () => { throw new Error("orientation rejected"); });
    await expect(performFullscreenAction(runtime({
      target: { requestFullscreen },
      lockLandscape,
    }))).resolves.toEqual({ kind: "entered" });
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(lockLandscape).toHaveBeenCalledOnce();
  });

  it("turns browser request failures into a user-presentable result", async () => {
    await expect(performFullscreenAction(runtime({
      target: { requestFullscreen: vi.fn(async () => { throw new Error("permission denied"); }) },
    }))).resolves.toEqual({ kind: "failed", message: "permission denied" });
  });

  it("explains installation, Brave/Safari fallback, and the separate local-storage boundary", () => {
    const guidance = fullscreenGuidance({ kind: "install-guidance" });
    expect(guidance?.steps).toEqual([
      "Open the browser Share menu.",
      "Choose Add to Home Screen.",
      "Launch the new icon from the Home Screen.",
    ]);
    expect(guidance?.warning).toContain("open this page in Safari");
    expect(guidance?.warning).toContain("separate offline saves and settings");
    expect(guidance?.warning).toContain("wait for offline startup to be ready");
    expect(guidance?.warning).toContain("downloaded in Files");
  });

  it("recognizes current and desktop-UA Apple mobile presentations without naming browsers", () => {
    expect(isAppleMobileNavigator({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    })).toBe(true);
    expect(isAppleMobileNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    })).toBe(true);
    expect(isAppleMobileNavigator({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      platform: "MacIntel",
      maxTouchPoints: 0,
    })).toBe(false);
  });
});
