import { describe, expect, it } from "vitest";
import { compactModNames, compareSaveMods, saveContentChanged } from "../src/content/saveModComparison.js";
import type { PlayProfileModRef } from "../src/content/playProfiles.js";

const mod = (id: string, digest = id): PlayProfileModRef => ({
  id, digest, displayName: `${id} long name`, version: "1.0.0", byteLength: undefined,
});

describe("save setup summaries", () => {
  const neutral = (id: string, digest = id): PlayProfileModRef => ({ ...mod(id, digest), saveCompatibility: "neutral" });
  it("allows neutral data overlays when the pre-mod archive and dependent setup match", () => {
    const previous = { lastMods: [mod("content"), neutral("rates")], lastContent: "old-overlay", lastBaseContent: "archive" };
    for (const selected of [[mod("content")], [mod("content"), neutral("rates", "updated")], [neutral("rates"), mod("content")]]) {
      expect(saveContentChanged(previous, selected, "new-overlay", "archive")).toBe(false);
    }
    expect(saveContentChanged({ lastMods: [], lastContent: "archive" }, [neutral("rates")], "overlay", "archive")).toBe(false);
  });
  it("never attributes archive changes, dependent changes, unchanged selection output or unknown history to neutral mods", () => {
    const previous = { lastMods: [mod("content"), neutral("rates")], lastContent: "old-overlay", lastBaseContent: "archive" };
    expect(saveContentChanged(previous, [mod("content")], "new-overlay", "different-archive")).toBe(true);
    expect(saveContentChanged(previous, [], "archive", "archive")).toBe(true);
    expect(saveContentChanged(previous, [mod("content", "updated")], "new-overlay", "archive")).toBe(true);
    expect(saveContentChanged(previous, previous.lastMods, "new-overlay", "archive")).toBe(true);
    expect(saveContentChanged({ ...previous, lastBaseContent: null }, [mod("content")], "new-overlay", "archive")).toBe(true);
    expect(saveContentChanged({ ...previous, lastMods: null }, [neutral("rates")], "new-overlay", "archive")).toBe(true);
  });
  it("allows neutral mods to be added, removed, updated and reordered across any matching save setup", () => {
    for (const [before, after] of [
      [[], [neutral("hud")]], [[neutral("hud")], []],
      [[neutral("hud", "old")], [neutral("hud", "new")]],
      [[neutral("hud"), mod("content"), neutral("tools")], [neutral("tools"), neutral("hud"), mod("content")]],
    ] as const) {
      expect(compareSaveMods(before, after, false)).toMatchObject({ kind: "same", added: 0, removed: 0, updated: 0, reordered: false });
    }
  });
  it("retains content changes, unknown history and dependent order warnings in mixed profiles", () => {
    expect(compareSaveMods([], [neutral("hud")], true).kind).toBe("content");
    expect(compareSaveMods(null, [neutral("hud")], false).kind).toBe("unknown");
    expect(compareSaveMods([mod("a"), neutral("hud"), mod("b")], [mod("b"), mod("a")], false))
      .toMatchObject({ kind: "mods", reordered: true, removed: 0 });
    expect(compareSaveMods([mod("a")], [mod("a", "new"), neutral("hud")], false))
      .toMatchObject({ kind: "mods", updated: 1, added: 0 });
  });
  it("does not retrospectively bless legacy releases or ignore transitions to dependent", () => {
    expect(compareSaveMods([mod("hud", "old")], [neutral("hud", "new")], false))
      .toMatchObject({ kind: "mods", removed: 1 });
    expect(compareSaveMods([neutral("hud", "old")], [mod("hud", "new")], false))
      .toMatchObject({ kind: "mods", added: 1 });
  });
  it("keeps long mod histories out of collapsed warnings without losing change counts", () => {
    const previous = Array.from({ length: 80 }, (_, index) => mod(`old-${index}`));
    const selected = Array.from({ length: 80 }, (_, index) => mod(`new-${index}`));
    const result = compareSaveMods(previous, selected, false);
    expect(result).toMatchObject({ kind: "mods", label: "Mod setup changed", added: 80, removed: 80, updated: 0 });
    expect(result.description).toBe("80 added · 80 removed");
    expect(JSON.stringify(result)).not.toContain("long name");
  });
  it("distinguishes changed package bytes even when the displayed version is unchanged", () => {
    expect(compareSaveMods([mod("a", "old")], [mod("a", "new")], false))
      .toMatchObject({ kind: "mods", updated: 1, added: 0, removed: 0, reordered: false });
  });
  it("detects load-order changes, while insertions do not falsely report a reorder", () => {
    expect(compareSaveMods([mod("a"), mod("b")], [mod("b"), mod("a")], false))
      .toMatchObject({ kind: "mods", reordered: true, description: "Order changed" });
    expect(compareSaveMods([mod("a"), mod("b")], [mod("x"), mod("a"), mod("b")], false))
      .toMatchObject({ added: 1, reordered: false, description: "1 added" });
  });
  it("distinguishes unknown history from a known unmodded save", () => {
    expect(compareSaveMods(null, [mod("a")], true))
      .toMatchObject({ kind: "unknown", added: 0, removed: 0 });
    expect(compareSaveMods([], [], false)).toMatchObject({ kind: "same", label: "No mods" });
    expect(compareSaveMods([], [mod("a")], false)).toMatchObject({ kind: "mods", added: 1 });
  });
  it("reports changed content separately even with an identical mod selection", () => {
    expect(compareSaveMods([mod("a")], [mod("a")], true)).toMatchObject({ kind: "content" });
    expect(compareSaveMods([mod("a")], [mod("a")], false))
      .toMatchObject({ kind: "same", label: "1 mod" });
    expect(compareSaveMods([mod("a")], [mod("b")], true).description).toContain("Game content changed");
  });
  it("bounds the gate preview with many mods and extremely long names", () => {
    expect(compactModNames([])).toBe("");
    expect(compactModNames(["Devtools"])).toBe("Devtools");
    expect(compactModNames(["One", "Two", "Three", "Four"])).toBe("One, Two, +2 more");
    const summary = compactModNames(Array(80).fill("a".repeat(500)));
    expect(summary.length).toBeLessThan(100);
    expect(summary).toContain("+78 more");
  });
});
