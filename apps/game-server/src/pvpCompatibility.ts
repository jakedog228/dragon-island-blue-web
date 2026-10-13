import {
  PvpClientSetupV1Schema,
  type PvpClientSetupV1,
  type PvpCompatibilityIssueV1,
  type PvpModSelectionV1,
} from "@dib/game-protocol";

/** Operator-reviewed metadata, never accepted from a player or inferred from a mod's name. */
export interface PvpModSupport {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly support:
    | { readonly kind: "presentation" }
    | { readonly kind: "rules"; readonly rulesId: string }
    | { readonly kind: "unsupported"; readonly path: string; readonly reason: string };
}

export interface PvpRulesProfile {
  readonly id: string;
  readonly logicPackId: string;
  /** Ordered mechanical adapters. Releases with identical mechanics can share a rulesId. */
  readonly rules: readonly string[];
}

export type PvpCompatibilityResult =
  | { readonly compatible: true; readonly profileId: string; readonly notes: readonly string[] }
  | { readonly compatible: false; readonly issues: readonly PvpCompatibilityIssueV1[] };

interface InspectedSetup {
  readonly cosmetic: readonly PvpModSelectionV1[];
  readonly issues: readonly PvpCompatibilityIssueV1[];
}

/** Only exact, operator-reviewed cosmetic releases may enter PvP. Mechanical adapters remain
 * dormant infrastructure; matching gameplay selections never confer admission. */
export class PvpCompatibilityRegistry {
  private readonly mods: ReadonlyMap<string, PvpModSupport>;
  private readonly profiles: readonly PvpRulesProfile[];

  constructor(mods: readonly PvpModSupport[], profiles: readonly PvpRulesProfile[]) {
    const indexed = new Map<string, PvpModSupport>();
    for (const mod of mods) {
      if (indexed.has(mod.digest)) throw new Error(`Duplicate PvP package digest ${mod.digest}`);
      indexed.set(mod.digest, structuredClone(mod));
    }
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error("Duplicate PvP profile id");
    const combinations = profiles.map((profile) => JSON.stringify([profile.logicPackId, profile.rules]));
    if (new Set(combinations).size !== combinations.length) throw new Error("Duplicate PvP rules combination");
    this.mods = indexed;
    this.profiles = structuredClone(profiles);
  }

  rulesForProfile(id: string): readonly string[] | undefined {
    const profile = this.profiles.find((candidate) => candidate.id === id);
    return profile ? [...profile.rules] : undefined;
  }

  private inspect(setup: PvpClientSetupV1, player: "host" | "guest"): InspectedSetup {
    const cosmetic: PvpModSelectionV1[] = [];
    const issues: PvpCompatibilityIssueV1[] = [];
    setup.mods.forEach((mod, index) => {
      const installed = this.mods.get(mod.digest);
      const path = `${player}.mods[${index}]`;
      if (!installed || installed.id !== mod.id || installed.version !== mod.version) {
        issues.push({ code: "MOD_UNSUPPORTED", path, modId: mod.id,
          message: `${mod.id} ${mod.version} is not a reviewed cosmetic PvP mod.`,
          suggestion: `Disable ${mod.id}. PvP currently permits reviewed cosmetic mods only.` });
      } else if (installed.support.kind === "unsupported") {
        issues.push({ code: "MOD_UNSUPPORTED", path: `${path}.${installed.support.path}`, modId: mod.id,
          message: `${mod.id}: ${installed.support.reason}`,
          suggestion: `Disable ${mod.id}. PvP currently permits reviewed cosmetic mods only.` });
      } else if (installed.support.kind === "rules") {
        issues.push({ code: "MOD_UNSUPPORTED", path, modId: mod.id,
          message: `${mod.id} changes gameplay. Gameplay mods are disabled in PvP, even when both players select the same release.`,
          suggestion: `Disable ${mod.id} before entering PvP.` });
      } else cosmetic.push(mod);
    });
    return { cosmetic, issues };
  }

  negotiate(hostInput: PvpClientSetupV1, guestInput: PvpClientSetupV1): PvpCompatibilityResult {
    const host = PvpClientSetupV1Schema.parse(hostInput);
    const guest = PvpClientSetupV1Schema.parse(guestInput);
    const a = this.inspect(host, "host");
    const b = this.inspect(guest, "guest");
    const issues = [...a.issues, ...b.issues];
    if (host.logicPackId !== guest.logicPackId) {
      issues.push({ code: "CONTENT_MISMATCH", path: "setup.logicPackId",
        message: "The selected content packages contain different game rules.",
        suggestion: "Select content packages with the same rules on both devices; artwork and translations may differ." });
    }
    if (issues.length > 0) return { compatible: false, issues };
    const profile = this.profiles.find((candidate) => candidate.logicPackId === host.logicPackId &&
      candidate.rules.length === 0);
    if (!profile) return { compatible: false, issues: [{ code: "PROFILE_UNAVAILABLE", path: "setup.rules",
      message: "The baseline rules for this content package are not installed on the PvP server.",
      suggestion: "Select the server's supported content package and disable gameplay mods." }] };
    const notes: string[] = [];
    if (JSON.stringify(a.cosmetic) !== JSON.stringify(b.cosmetic)) notes.push("Each player keeps their own supported cosmetic mods.");
    return { compatible: true, profileId: profile.id, notes };
  }
}
