import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { braceTier, parseAbilityArgument, TIER_TABLE } from "../src/abilityArgs.js";

describe("parseAbilityArgument", () => {

  it("has the 7-entry tier table from the RE", () => {
    expect(TIER_TABLE).toEqual([50, 70, 100, 130, 160, 200, 250]);
  });

  it("parses '{N}' brace-tier strings via the TIER_TABLE", () => {
    expect(parseAbilityArgument("{1}")).toBe(50);
    expect(parseAbilityArgument("{2}")).toBe(70);
    expect(parseAbilityArgument("{3}")).toBe(100);
    expect(parseAbilityArgument("{4}")).toBe(130);
    expect(parseAbilityArgument("{5}")).toBe(160);
    expect(parseAbilityArgument("{6}")).toBe(200);
    expect(parseAbilityArgument("{7}")).toBe(250);
  });

  it("parses a plain numeric string directly via intValue (no tier lookup)", () => {
    expect(parseAbilityArgument("120")).toBe(120);
  });

  it("parses a plain number directly (truncating toward zero)", () => {
    expect(parseAbilityArgument(120)).toBe(120);
    expect(parseAbilityArgument(120.9)).toBe(120);
  });

  it("defaults to 100 when the value is entirely missing (undefined/null)", () => {
    // Binary: logs "Missing activationLength for an ability in both args and dict" and falls
    // back to NSNumber(100) -> 100 directly (not a tier lookup).
    expect(parseAbilityArgument(undefined)).toBe(100);
    expect(parseAbilityArgument(null)).toBe(100);
  });

  it("throws on an out-of-range tier (fail loudly, deviation from the binary's log-and-ignore)", () => {
    expect(() => parseAbilityArgument("{0}")).toThrow(/unexpected activationLength tier/i);
    expect(() => parseAbilityArgument("{8}")).toThrow(/unexpected activationLength tier/i);
    expect(() => parseAbilityArgument("{99}")).toThrow(/unexpected activationLength tier/i);
  });

  it("preserves native zero for the real fullwidth-digit Jobs.json authoring bug", () => {
    // Undead.LightCrawler.jobAbilities.usable1.arguments.activationLength == "{３}"
    // (U+FF13 FULLWIDTH DIGIT THREE, not ASCII "3"). ASCII-only intValue digit-scanning finds
    // no digit after stripping "{", so tier parses to 0 -> out of TIER_TABLE's 1..7 range.
    expect(parseAbilityArgument("{３}")).toBe(0);
  });
});

describe("parseAbilityArgument against every real brace-string literal in Jobs.json", () => {


  const jobsPath = fileURLToPath(new URL("../../../extracted/data/Jobs.json", import.meta.url));
  const jobsRaw: unknown = JSON.parse(readFileSync(jobsPath, "utf-8"));

  function collectBraceStrings(node: unknown, out: Set<string>): void {
    if (typeof node === "string") {
      if (node.startsWith("{") && node.endsWith("}")) out.add(node);
      return;
    }
    if (node && typeof node === "object") {
      for (const v of Object.values(node as Record<string, unknown>)) collectBraceStrings(v, out);
    }
  }

  const braceStrings = new Set<string>();
  collectBraceStrings(jobsRaw, braceStrings);

  it("found at least the 7 tier strings plus the known fullwidth-digit bug", () => {
    expect(braceStrings.size).toBeGreaterThanOrEqual(8);
  });

  for (const raw of braceStrings) {
    const asciiTierMatch = /^\{([1-7])\}$/.exec(raw);
    if (asciiTierMatch) {
      const tier = Number(asciiTierMatch[1]);
      it(`parses real value ${JSON.stringify(raw)} as TIER_TABLE[${tier - 1}]`, () => {
        expect(parseAbilityArgument(raw)).toBe(TIER_TABLE[tier - 1]);
      });
    } else {
      it(`preserves native zero for real non-tier-1..7 value ${JSON.stringify(raw)} (data bug)`, () => {
        expect(parseAbilityArgument(raw)).toBe(0);
      });
    }
  }
});

describe("braceTier", () => {
  it("extracts the tier from a brace string", () => {
    expect(braceTier("{4}")).toBe(4);
    expect(braceTier("{7}")).toBe(7);
  });
  it("returns undefined for non-brace values", () => {
    expect(braceTier(100)).toBeUndefined();
    expect(braceTier("100")).toBeUndefined();
    expect(braceTier(undefined)).toBeUndefined();
  });
});
