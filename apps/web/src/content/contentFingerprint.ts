import type { ImportedContentPackage, ReadonlyPlistValue } from "./archivePackage.js";
import {
  CONTENT_FINGERPRINT_SCOPE,
  LEGACY_CONTENT_FINGERPRINT_SCOPE,
  PREVIOUS_CONTENT_FINGERPRINT_SCOPE,
  PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V3,
  PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V4,
  PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V5,
  PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V6,
  type ContentFingerprintInput,
  type ContentFingerprintScope,
} from "@dib/save-protocol";

export interface ContentFingerprint
  extends ContentFingerprintInput<typeof CONTENT_FINGERPRINT_SCOPE> {
  /** Exact pre-Collection identity projection used to migrate v6-bound slots. */
  readonly previousV6: ContentFingerprintInput<typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V6>;
  /** Exact pre-Towns identity projection used to migrate v5-bound slots. */
  readonly previousV5: ContentFingerprintInput<typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V5>;
  /** Exact pre-Tournament identity projection used to migrate v4-bound slots. */
  readonly previousV4: ContentFingerprintInput<typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V4>;
  /** Exact pre-license identity projection used to migrate v3-bound slots. */
  readonly previousV3: ContentFingerprintInput<typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V3>;
  /** Exact pre-quest identity projection used to migrate v2-bound slots. */
  readonly previousV2: ContentFingerprintInput<typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE>;
  /** Exact pre-Combines identity projection, sent only so existing v1-bound slots can migrate. */
  readonly legacyV1: ContentFingerprintInput<typeof LEGACY_CONTENT_FINGERPRINT_SCOPE>;
}

const LEGACY_CORE_IDENTITY_FILES = new Set([
  "Monsters.plist",
  "Jobs.plist",
  "Abilities.plist",
  "AbilityComponents.plist",
  "Buffs.plist",
  "Items.plist",
  "Worlds.plist",
  "PointsOfInterest.plist",
]);
const CORE_IDENTITY_FILES = new Set([
  ...LEGACY_CORE_IDENTITY_FILES,
  "Combines.plist",
  "Quests.plist",
  "Licenses.plist",
  "Tournaments.plist",
  "Towns.plist",
  "Collection.plist",
]);

const RUNTIME_IDENTITY_DATA = new Map<string, keyof ImportedContentPackage["data"]>([
  ["Monsters.plist", "monsters"],
  ["Combines.plist", "combines"],
  ["Jobs.plist", "jobs"],
  ["Abilities.plist", "abilities"],
  ["AbilityComponents.plist", "abilityComponents"],
  ["Buffs.plist", "buffs"],
  ["Items.plist", "items"],
  ["Licenses.plist", "licenses"],
  ["Tournaments.plist", "tournaments"],
]);
const RUNTIME_IDENTITY_FILES = new Set(RUNTIME_IDENTITY_DATA.keys());

/** Hash semantic, identity-bearing data rather than the ZIP container. Repacking or renaming an
 * archive therefore does not strand its saves, while changing species/jobs/abilities/world graph
 * does. Images and audio intentionally do not enter this compatibility identity. */
export async function fingerprintContentPackage(content: ImportedContentPackage): Promise<ContentFingerprint> {
  const paths = content.resources.list().filter((path) =>
    CORE_IDENTITY_FILES.has(path) || /^World_[^/]+\.plist$/.test(path),
  ).sort(compareText);
  for (const required of [
    "Monsters.plist",
    "Jobs.plist",
    "Abilities.plist",
    "AbilityComponents.plist",
    "Combines.plist",
  ]) {
    if (!paths.includes(required)) throw new Error(`content fingerprint is missing ${required}`);
  }
  const canonicalByPath = new Map(
    paths.map((path) => [path, canonicalPlist(content.resources.plist(path))] as const),
  );
  const current = await fingerprintProjection(CONTENT_FINGERPRINT_SCOPE, paths, canonicalByPath);
  const previousV6Paths = paths.filter((path) => path !== "Collection.plist");
  const previousV6 = await fingerprintProjection(
    PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V6,
    previousV6Paths,
    canonicalByPath,
  );
  const previousV5Paths = previousV6Paths.filter((path) => path !== "Towns.plist");
  const previousV5 = await fingerprintProjection(
    PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V5,
    previousV5Paths,
    canonicalByPath,
  );
  const previousV4Paths = previousV5Paths.filter((path) => path !== "Tournaments.plist");
  const previousV4 = await fingerprintProjection(
    PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V4,
    previousV4Paths,
    canonicalByPath,
  );
  const previousV3Paths = previousV4Paths.filter((path) => path !== "Licenses.plist");
  const previousV3 = await fingerprintProjection(
    PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V3,
    previousV3Paths,
    canonicalByPath,
  );
  const previousPaths = previousV3Paths.filter((path) =>
    (CORE_IDENTITY_FILES.has(path) && path !== "Quests.plist") ||
    /^World_[^/]+\.plist$/.test(path),
  );
  const previousV2 = await fingerprintProjection(
    PREVIOUS_CONTENT_FINGERPRINT_SCOPE,
    previousPaths,
    canonicalByPath,
  );
  // Preserve the old path set and scope byte-for-byte. Combines.plist must not leak into this
  // projection: its only purpose is to authorize migration of a slot already bound under v1.
  const legacyPaths = paths.filter((path) =>
    LEGACY_CORE_IDENTITY_FILES.has(path) || /^World_[^/]+\.plist$/.test(path),
  );
  const legacyV1 = await fingerprintProjection(
    LEGACY_CONTENT_FINGERPRINT_SCOPE,
    legacyPaths,
    canonicalByPath,
  );
  const archiveIdentity = {
    ...current,
    previousV6,
    previousV5,
    previousV4,
    previousV3,
    previousV2,
    legacyV1,
  };
  if (!("modProfile" in content)) return archiveIdentity;
  // A full-trust mod's ZIP bytes are not themselves save data. Binding the exact package digest
  // stranded saves after harmless visual/debugging updates and made removing a code-only mod look
  // like a new game. Instead, bind only effective runtime data that differs from the selected
  // archive. Two profiles that produce the same mechanics-bearing data therefore share saves;
  // profiles that patch executable code are warned about separately by the content gate.
  return {
    ...await bindRuntimeDataOverlay(current, runtimeDataOverlay(content, RUNTIME_IDENTITY_FILES)),
    previousV6: await bindRuntimeDataOverlay(
      previousV6,
      runtimeDataOverlay(content, withoutRuntimeFiles("Collection.plist")),
    ),
    previousV5: await bindRuntimeDataOverlay(
      previousV5,
      runtimeDataOverlay(content, withoutRuntimeFiles("Collection.plist", "Towns.plist")),
    ),
    previousV4: await bindRuntimeDataOverlay(
      previousV4,
      runtimeDataOverlay(
        content,
        withoutRuntimeFiles("Collection.plist", "Towns.plist", "Tournaments.plist"),
      ),
    ),
    previousV3: await bindRuntimeDataOverlay(
      previousV3,
      runtimeDataOverlay(
        content,
        withoutRuntimeFiles(
          "Collection.plist",
          "Towns.plist",
          "Tournaments.plist",
          "Licenses.plist",
        ),
      ),
    ),
    previousV2: await bindRuntimeDataOverlay(
      previousV2,
      runtimeDataOverlay(
        content,
        withoutRuntimeFiles(
          "Collection.plist",
          "Towns.plist",
          "Tournaments.plist",
          "Licenses.plist",
          "Quests.plist",
        ),
      ),
    ),
    legacyV1: await bindRuntimeDataOverlay(
      legacyV1,
      runtimeDataOverlay(
        content,
        new Set([...RUNTIME_IDENTITY_FILES].filter((path) => LEGACY_CORE_IDENTITY_FILES.has(path))),
      ),
    ),
  };
}

function withoutRuntimeFiles(...excluded: string[]): ReadonlySet<string> {
  const blocked = new Set(excluded);
  return new Set([...RUNTIME_IDENTITY_FILES].filter((path) => !blocked.has(path)));
}

function runtimeDataOverlay(
  content: ImportedContentPackage,
  projectionPaths: ReadonlySet<string>,
): readonly (readonly [string, unknown])[] {
  const overlay: Array<readonly [string, unknown]> = [];
  for (const [path, key] of RUNTIME_IDENTITY_DATA) {
    // An optional mechanics family introduced by a mod must enter modern projections even though
    // the base archive has no corresponding path. Historical scopes include only their own files.
    if (!projectionPaths.has(path)) continue;
    const effective = content.data[key];
    const archived = content.resources.has(path) ? content.resources.plist(path) : undefined;
    if (effective === undefined && archived === undefined) continue;
    // The importer represents an absent optional Buffs.plist as the runtime's empty dictionary.
    if (
      path === "Buffs.plist" && archived === undefined &&
      effective !== null && typeof effective === "object" && !Array.isArray(effective) &&
      Object.keys(effective).length === 0
    ) {
      continue;
    }
    const canonicalEffective = effective === undefined
      ? { $missing: true }
      : canonicalPlist(effective as ReadonlyPlistValue);
    const canonicalArchived = archived === undefined
      ? { $missing: true }
      : canonicalPlist(archived);
    if (JSON.stringify(canonicalEffective) !== JSON.stringify(canonicalArchived)) {
      overlay.push([path, canonicalEffective]);
    }
  }
  return Object.freeze(overlay);
}

async function bindRuntimeDataOverlay<Scope extends ContentFingerprintScope>(
  base: ContentFingerprintInput<Scope>,
  overlay: readonly (readonly [string, unknown])[],
): Promise<ContentFingerprintInput<Scope>> {
  if (overlay.length === 0) return base;
  const bytes = new TextEncoder().encode(JSON.stringify({
    scope: "dib-effective-runtime-data-overlay-v1",
    content: base,
    overlay,
  }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return {
    ...base,
    digest: [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join(""),
  };
}

async function fingerprintProjection<Scope extends ContentFingerprintScope>(
  scope: Scope,
  paths: readonly string[],
  canonicalByPath: ReadonlyMap<string, unknown>,
): Promise<ContentFingerprintInput<Scope>> {
  const canonical = paths.map((path) => {
    if (!canonicalByPath.has(path)) {
      throw new Error(`content fingerprint projection is missing canonical data for ${path}`);
    }
    return [path, canonicalByPath.get(path)];
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ scope, files: canonical }));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return {
    algorithm: "SHA-256",
    scope,
    digest: [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join(""),
  };
}

function canonicalPlist(value: ReadonlyPlistValue): unknown {
  if (value instanceof Uint8Array) {
    return { $bytes: [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
  }
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalPlist);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalPlist(entry)]),
    );
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
