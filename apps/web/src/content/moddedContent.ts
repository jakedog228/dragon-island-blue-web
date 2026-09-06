import {
  resolveCodeModProfile,
  type CodeModPackage,
  type ResolveCodeModProfileOptions,
  type ResolvedCodeModProfile,
} from "@dib/mod-kernel";
import {
  createFullTrustCodeModRuntime,
  type FullTrustModRuntime,
  type ModInterferenceReport,
} from "./codeModRuntime.js";
import type { ImportedContentPackage } from "./archivePackage.js";

export interface ImportedModProfile {
  readonly schemaVersion: 4;
  readonly digest: string;
  readonly packages: readonly {
    readonly id: string;
    readonly version: string;
    readonly displayName: string;
    readonly digest: string;
    readonly priority: number;
  }[];
  readonly advisories: readonly string[];
  /** Where the activated profile overlapped itself. Carried so callers need not hold the runtime. */
  readonly interference: ModInterferenceReport;
}

export interface ModdedImportedContentPackage extends ImportedContentPackage {
  readonly modProfile: ImportedModProfile;
  readonly mods: FullTrustModRuntime;
}

/**
 * Executes a dependency-resolved profile in the application realm, then lets its open-ended
 * `content:loaded` lifecycle replace or mutate the imported package before fingerprinting.
 */
export async function applyFullTrustModsToContent(
  base: ImportedContentPackage,
  packages: readonly CodeModPackage[],
  options: ResolveCodeModProfileOptions = {},
  createRuntime: (
    profile: ResolvedCodeModProfile,
    initialServices: Readonly<Record<string, unknown>>,
  ) => Promise<FullTrustModRuntime> = async (profile, initialServices) =>
    await createFullTrustCodeModRuntime(profile, { initialServices }),
): Promise<ModdedImportedContentPackage> {
  const profile = await resolveCodeModProfile(packages, options);
  const runtime = await createRuntime(profile, { content: base });
  try {
    const content = await runtime.runPhase("content:loaded", base);
    assertImportedContent(content);
    runtime.host.set("content", content);
    const owned = new Set<ImportedContentPackage>([base, content]);
    let disposed = false;
    return {
      ...content,
      modProfile: profileProjection(profile, runtime.interference()),
      mods: runtime,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        runtime.dispose();
        for (const entry of owned) entry.dispose();
      },
    };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

export function hasImportedModProfile(
  content: ImportedContentPackage,
): content is ModdedImportedContentPackage {
  return "modProfile" in content && "mods" in content;
}

function profileProjection(
  profile: ResolvedCodeModProfile,
  interference: ModInterferenceReport,
): ImportedModProfile {
  return Object.freeze({
    schemaVersion: 4,
    digest: profile.digest,
    packages: Object.freeze(profile.packages.map((pkg) => Object.freeze({
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      displayName: pkg.manifest.displayName,
      digest: pkg.digest,
      priority: pkg.manifest.priority,
    }))),
    advisories: Object.freeze(profile.advisories.map((advisory) => advisory.message)),
    interference,
  });
}

function assertImportedContent(value: unknown): asserts value is ImportedContentPackage {
  if (typeof value !== "object" || value === null) {
    throw new Error("content:loaded must retain or return an imported content package");
  }
  const content = value as Partial<ImportedContentPackage>;
  if (content.sourceKind !== "app-archive" || typeof content.dispose !== "function" ||
      typeof content.urlFor !== "function" || content.resources === undefined ||
      content.data === undefined || content.manifest === undefined) {
    throw new Error("content:loaded returned an invalid imported content package");
  }
}
