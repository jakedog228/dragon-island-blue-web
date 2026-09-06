import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORT_SETTINGS,
  loadPortSettings,
  savePortSettings,
} from "../src/portSettings.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe("port settings", () => {
  it("uses the established defaults without browser storage", () => {
    expect(loadPortSettings(undefined)).toEqual(DEFAULT_PORT_SETTINGS);
  });

  it("round-trips the discrete source audio levels and port display choices", () => {
    const store = new MemoryStorage();
    const settings = {
      displayMode: "iphone" as const,
      textResolutionMode: "original" as const,
      sound: 0.75 as const,
      music: 1 as const,
    };
    savePortSettings(settings, store);
    expect(loadPortSettings(store)).toEqual(settings);
  });

  it("rejects malformed or out-of-vocabulary saved fields independently", () => {
    const store = new MemoryStorage();
    store.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "television",
      textResolutionMode: "blurry",
      sound: 0.3,
      music: 0,
    }));
    expect(loadPortSettings(store)).toEqual({ ...DEFAULT_PORT_SETTINGS, music: 0 });
  });
});
