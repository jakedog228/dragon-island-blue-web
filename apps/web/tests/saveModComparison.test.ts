import { describe, expect, it } from "vitest";
import { compactModNames, compareSaveMods } from "../src/content/saveModComparison.js";
import type { PlayProfileModRef } from "../src/content/playProfiles.js";

const mod = (id: string, digest = id): PlayProfileModRef => ({
  id, digest, displayName: `${id} long name`, version: "1.0.0", byteLength: undefined,
});

describe("save setup summaries", () => {
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
