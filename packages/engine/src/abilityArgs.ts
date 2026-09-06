


export const TIER_TABLE: readonly number[] = [50, 70, 100, 130, 160, 200, 250];

/**
 * NSString/NSNumber `.intValue`-style parse: for a string, skip leading whitespace, take an
 * optional sign, then a run of ASCII digits (stopping at the first non-digit — this is what
 * makes `"2}"` parse as `2`, and what makes a non-ASCII "digit" like a fullwidth numeral parse
 * as 0, since ASCII-only digit scanning finds none). No leading digit -> 0 (matches
 * `nil.intValue`/garbage-string `.intValue` both being 0 in ObjC). For a number, truncate toward
 * zero (NSNumber.intValue on a float truncates).
 */
function nsIntValue(v: unknown): number {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") {
    const m = /^\s*([+-]?\d+)/.exec(v);
    return m ? parseInt(m[1] as string, 10) : 0;
  }
  return 0;
}

/**
 * Parses an ability's `activationLength` argument per ability.md §1.
 *
 * - Missing (`undefined`/`null`): binary logs "Missing activationLength..." and defaults to
 *   `NSNumber(100)` -> 100. Our port: same default, no log.
 * - String starting with `"{"`: strip the leading brace, `intValue`-parse the remainder (stops
 *   at the trailing `"}"` or earlier), giving a tier digit. `TIER_TABLE[tier-1]` if tier is
 *   1..7; out-of-range tiers throw, except the exact shipped fullwidth-digit authoring bug below.
 * - Anything else (plain string/number): `intValue`-style parse used as-is.
 *
 * Real-data note: `extracted/data/Jobs.json` contains one authoring bug —
 * `Undead.LightCrawler.jobAbilities.usable1.arguments.activationLength` is `"{３}"`
 * (U+FF13 FULLWIDTH DIGIT THREE, not ASCII `"3"`). ASCII-only digit scanning finds no digit,
 * so `tier` parses to 0. Native logs and leaves the zero-initialized ivar unchanged; this port
 * returns that same 0 for the exact shipped literal so every shipped move remains inspectable.
 */
export function parseAbilityArgument(raw: unknown): number {
  if (raw === undefined || raw === null) return 100; // "Missing activationLength..." binary default

  if (typeof raw === "string" && raw.startsWith("{")) {
    const tier = nsIntValue(raw.slice(1));
    const idx = tier - 1;
    const value = TIER_TABLE[idx];
    if (value === undefined) {
      // Known shipped authoring bug: NSString.intValue parses the fullwidth digit as tier 0;
      // native logs and leaves the zero-initialized activationLength ivar unchanged.
      if (raw === "{３}") return 0;
      throw new Error(
        `parseAbilityArgument: unexpected activationLength tier ${tier} (raw=${JSON.stringify(raw)}); ` +
          `TIER_TABLE covers tiers 1..${TIER_TABLE.length}`,
      );
    }
    return value;
  }

  return nsIntValue(raw);
}

/** The `{N}` tier number of a brace-form argument, or undefined for any other shape.
 *  UI metadata only (animation/sound tier lookup) — parseAbilityArgument stays the
 *  value-of-record for game math. */
export function braceTier(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const m = /^\{(\d+)\}$/.exec(raw.trim());
  return m ? Number(m[1]) : undefined;
}
