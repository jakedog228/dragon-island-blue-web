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
  readonly rules: readonly { readonly rulesId: string; readonly mod: PvpModSelectionV1 }[];
  readonly cosmetic: readonly PvpModSelectionV1[];
  readonly issues: readonly PvpCompatibilityIssueV1[];
}

/**
 * Reconciliation uses mechanics identities instead of requiring identical modsets. Cosmetic
 * differences and mechanically identical releases are safe. Gameplay order remains meaningful.
 * Execution is always an installed server profile; the server never evaluates uploaded JS.
 */
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
    this.mods = indexed;
    this.profiles = structuredClone(profiles);
  }

  private inspect(setup: PvpClientSetupV1, player: "host" | "guest"): InspectedSetup {
    const rules: { rulesId: string; mod: PvpModSelectionV1 }[] = [];
    const cosmetic: PvpModSelectionV1[] = [];
    const issues: PvpCompatibilityIssueV1[] = [];
    setup.mods.forEach((mod, index) => {
      const installed = this.mods.get(mod.digest);
      const path = `${player}.mods[${index}]`;
      if (!installed || installed.id !== mod.id || installed.version !== mod.version) {
        issues.push({ code: "MOD_UNSUPPORTED", path, modId: mod.id,
          message: `${mod.id} ${mod.version} has no reviewed PvP adapter on this server.`,
          suggestion: `Disable ${mod.id} for this match, or ask the server operator to install support for this exact release.` });
      } else if (installed.support.kind === "unsupported") {
        issues.push({ code: "MOD_UNSUPPORTED", path: `${path}.${installed.support.path}`, modId: mod.id,
          message: `${mod.id}: ${installed.support.reason}`,
          suggestion: `Disable ${mod.id} for PvP or use a release with a server-supported battle adapter.` });
      } else if (installed.support.kind === "rules") {
        rules.push({ rulesId: installed.support.rulesId, mod });
      } else cosmetic.push(mod);
    });
    return { rules, cosmetic, issues };
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
    const aRules = a.rules.map((entry) => entry.rulesId);
    const bRules = b.rules.map((entry) => entry.rulesId);
    const length = Math.max(a.rules.length, b.rules.length);
    for (let index = 0; index < length; index++) {
      if (aRules[index] === bRules[index]) continue;
      const left = a.rules[index];
      const right = b.rules[index];
      const sameSet = aRules.length === bRules.length && [...aRules].sort().join("\0") === [...bRules].sort().join("\0");
      issues.push({ code: sameSet ? "MOD_ORDER_MISMATCH" : "MOD_VERSION_MISMATCH", path: `setup.rules[${index}]`,
        modId: (left ?? right)!.mod.id,
        message: `Battle rules differ at position ${index + 1}: host ${left ? `${left.mod.id} ${left.mod.version}` : "none"}; guest ${right ? `${right.mod.id} ${right.mod.version}` : "none"}.`,
        suggestion: sameSet ? "Use the same gameplay-mod load order on both devices. Cosmetic mods may stay different."
          : "Enable mechanically compatible gameplay-mod releases on both devices. Cosmetic mods may stay different." });
    }
    if (issues.length > 0) return { compatible: false, issues };
    const profile = this.profiles.find((candidate) => candidate.logicPackId === host.logicPackId &&
      candidate.rules.length === aRules.length && candidate.rules.every((rule, index) => rule === aRules[index]));
    if (!profile) return { compatible: false, issues: [{ code: "PROFILE_UNAVAILABLE", path: "setup.rules",
      message: "This gameplay-mod combination is not installed on the PvP server.",
      suggestion: "Use the server's supported gameplay setup, or disable gameplay mods for a baseline match." }] };
    const notes: string[] = [];
    if (JSON.stringify(a.cosmetic) !== JSON.stringify(b.cosmetic)) notes.push("Each player keeps their own supported cosmetic mods.");
    if (a.rules.some((entry, index) => entry.mod.digest !== b.rules[index]!.mod.digest)) {
      notes.push("Different mod releases were reconciled using identical server-reviewed battle rules.");
    }
    return { compatible: true, profileId: profile.id, notes };
  }
}
