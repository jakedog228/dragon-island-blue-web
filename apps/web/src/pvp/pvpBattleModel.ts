import type { PvpErrorV1, PvpMatchViewV1 } from "@dib/game-protocol";

export function pvpRulesMismatch(logicPackId: string, match: PvpMatchViewV1): PvpErrorV1 | undefined {
  if (match.logicPackId === logicPackId) return undefined;
  return { code: "INCOMPATIBLE", message: "This match uses different rules from your currently selected content package.",
    issues: [{ code: "CONTENT_MISMATCH", path: "setup.logicPackId", message: "Replaying this match with the current package would produce different battle state.",
      suggestion: "Reopen the content package used to start this match, or forfeit/cancel it before starting a new match." }] };
}
