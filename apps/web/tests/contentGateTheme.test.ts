import { describe, expect, it, vi } from "vitest";
import {
  applyContentGateMode,
  CONTENT_GATE_MODE_STORAGE_KEY,
  installContentGateThemeToggle,
  parseContentGateMode,
  systemContentGateMode,
} from "../src/content/contentGateTheme.js";

describe("content-gate color mode", () => {
  it("parses only supported manual overrides and derives the system default", () => {
    expect(parseContentGateMode("dark")).toBe("dark");
    expect(parseContentGateMode("light")).toBe("light");
    expect(parseContentGateMode("system")).toBeUndefined();
    expect(parseContentGateMode(null)).toBeUndefined();
    expect(systemContentGateMode(true)).toBe("dark");
    expect(systemContentGateMode(false)).toBe("light");
  });

  it("projects the active mode onto the gate dataset", () => {
    const panel = { dataset: {} } as unknown as HTMLElement;
    applyContentGateMode(panel, "light");
    expect(panel.dataset).toEqual({ gateMode: "light" });
  });

  it("follows the system until the icon button establishes a persistent override", () => {
    const listeners = new Set<() => void>();
    const button = {
      dataset: {},
      title: "",
      setAttribute: vi.fn(),
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    const panel = {
      dataset: {},
      querySelector: () => button,
    } as unknown as HTMLElement;
    let systemListener: ((event: { readonly matches: boolean }) => void) | undefined;
    const colorScheme = {
      matches: false,
      addEventListener: (_type: "change", listener: typeof systemListener) => {
        systemListener = listener;
      },
      removeEventListener: vi.fn(),
    };
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    const dispose = installContentGateThemeToggle(panel, { storage, colorScheme });
    expect(panel.dataset).toEqual({ gateMode: "light" });
    systemListener?.({ matches: true });
    expect(panel.dataset).toEqual({ gateMode: "dark" });

    [...listeners][0]?.();
    expect(panel.dataset).toEqual({ gateMode: "light" });
    expect(values.get(CONTENT_GATE_MODE_STORAGE_KEY)).toBe("light");
    systemListener?.({ matches: true });
    expect(panel.dataset).toEqual({ gateMode: "light" });
    expect(button.setAttribute).toHaveBeenLastCalledWith("aria-label", "Switch to dark mode");

    dispose();
    expect(listeners.size).toBe(0);
  });
});
