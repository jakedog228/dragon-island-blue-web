export const LOGIC_PACK_SCHEMA_VERSION = "logic-pack-v1" as const;

export interface LogicPackResourceSource {
  list(): readonly string[];
  read(path: string): ReadonlyLogicValue;
}

export type ReadonlyLogicValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | Date
  | readonly ReadonlyLogicValue[]
  | { readonly [key: string]: ReadonlyLogicValue };

export interface LogicPackIdentityV1 {
  readonly schemaVersion: typeof LOGIC_PACK_SCHEMA_VERSION;
  readonly logicPackId: `logic-v1:${string}`;
  readonly mechanicalPaths: readonly string[];
}

export type LogicPackDigest = (bytes: Uint8Array) => Promise<Uint8Array>;

const REQUIRED_CORE = Object.freeze([
  "Monsters.plist",
  "Jobs.plist",
  "Abilities.plist",
  "AbilityComponents.plist",
  "Buffs.plist",
  "Items.plist",
  "Combines.plist",
  "Worlds.plist",
  "PointsOfInterest.plist",
]);

const MECHANICAL_ROOTS = new Set([
  ...REQUIRED_CORE,
  "Breeders.plist",
  "Chats.plist",
  "Collection.plist",
  "Dialogs.plist",
  "Dungeons.plist",
  "Heroes.plist",
  "Licenses.plist",
  "Menus.plist",
  "Plot.plist",
  "POIConnections.plist",
  "Quests.plist",
  "Rooms.plist",
  "ThingsInWorld.plist",
  "Tournaments.plist",
  "Towns.plist",
  "ZoneChanges.plist",
]);

/**
 * Presentation-only dictionary keys are removed before hashing. This list is intentionally narrow:
 * a newly encountered key remains identity-bearing until it is reviewed and classified.
 */
const PRESENTATION_KEYS = new Set([
  "audio",
  "audioFile",
  "background",
  "combatBackground",
  "font",
  "fontFile",
  "image",
  "music",
  "particle",
  "rendererData",
  "sound",
  "sprite",
  "spriteFile",
  "spritesheets",
  "texture",
]);

const MECHANICAL_FAMILY = /^(?:World|UnderWorld|Dungeon)_[A-Za-z0-9_-]+\.plist$/;
const SPECIAL_INSTANCE = /^[0-9]+-[0-9]+[A-Za-z0-9_-]+\.plist$/;

export async function compileLogicPackIdentityV1(
  source: LogicPackResourceSource,
  digest: LogicPackDigest,
): Promise<LogicPackIdentityV1> {
  const available = new Set(source.list());
  for (const path of REQUIRED_CORE) {
    if (!available.has(path)) throw new Error(`logic pack is missing required mechanical file ${path}`);
  }
  const paths = [...available]
    .filter(isMechanicalLogicPath)
    .sort(compareText);
  const files = paths.map((path) => [path, canonicalLogicValue(source.read(path))] as const);
  const bytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: LOGIC_PACK_SCHEMA_VERSION,
    files,
  }));
  const hash = await digest(bytes);
  if (hash.byteLength !== 32) throw new Error(`logic-pack digest returned ${hash.byteLength} bytes, expected 32`);
  const hex = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return Object.freeze({
    schemaVersion: LOGIC_PACK_SCHEMA_VERSION,
    logicPackId: `logic-v1:${hex}`,
    mechanicalPaths: Object.freeze(paths),
  });
}

export function isMechanicalLogicPath(path: string): boolean {
  return MECHANICAL_ROOTS.has(path) || MECHANICAL_FAMILY.test(path) || SPECIAL_INSTANCE.test(path);
}

/**
 * Media/binary suffixes that only ever name a shipped resource. Mechanical `.plist` paths are
 * deliberately absent: those are rules identity (they are hashed into the logic pack) and a
 * dungeon route legitimately names its own source file.
 */
const MEDIA_SUFFIXES = Object.freeze([
  ".png", ".jpg", ".jpeg", ".webp", ".pvr", ".pvr.ccz", ".ccz", ".pvr.gz",
  ".mp3", ".m4a", ".wav", ".caf", ".aiff", ".aif",
  ".fnt", ".ttf", ".otf", ".strings", ".ccbi", ".atlas",
]);

export interface PresentationLeak {
  /** Dotted/indexed path to the offending node, rooted at the value passed in. */
  readonly path: string;
  readonly reason: "media-reference" | "non-mechanical-plist" | "presentation-key";
  readonly detail: string;
}

/**
 * Reports presentation content reachable from an authoritative value — persisted slot state, a
 * projection, or a command result. The authority owns rules and outcomes; which sprite, sound, or
 * background renders them is the browser's business, resolved against the archive the player
 * selected locally. Anything this finds is server-held presentation and does not belong there.
 *
 * This is a suffix/key detector, so it cannot see an extensionless atlas frame name (`Forest-hd`).
 * It catches the shape presentation actually takes in shipped data — a file reference or one of the
 * classified `PRESENTATION_KEYS` — which is what has leaked in practice.
 */
export function findPresentationLeaks(value: unknown, rootPath = ""): readonly PresentationLeak[] {
  const leaks: PresentationLeak[] = [];
  walkForLeaks(value, rootPath, leaks, new Set());
  return leaks;
}

function walkForLeaks(
  value: unknown,
  path: string,
  leaks: PresentationLeak[],
  seen: Set<object>,
): void {
  if (typeof value === "string") {
    const leak = classifyLeakString(value, path);
    if (leak !== undefined) leaks.push(leak);
    return;
  }
  if (value === null || typeof value !== "object") return;
  // Authoritative payloads are JSON trees, but a cycle in a caller's in-memory object must not
  // hang the check.
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkForLeaks(entry, `${path}[${index}]`, leaks, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const child = path === "" ? key : `${path}.${key}`;
    if (PRESENTATION_KEYS.has(key)) {
      leaks.push({
        path: child,
        reason: "presentation-key",
        detail: `"${key}" is a classified presentation key`,
      });
    }
    walkForLeaks(entry, child, leaks, seen);
  }
}

function classifyLeakString(value: string, path: string): PresentationLeak | undefined {
  const lowered = value.toLowerCase();
  for (const suffix of MEDIA_SUFFIXES) {
    if (lowered.endsWith(suffix)) {
      return { path, reason: "media-reference", detail: `${value} names a shipped resource` };
    }
  }
  if (!lowered.endsWith(".plist")) return undefined;
  // A bare file name is the only form a mechanical path takes; a directory-qualified one is a
  // bundle reference rather than a rules identity.
  const name = value.slice(value.lastIndexOf("/") + 1);
  if (name === value && isMechanicalLogicPath(value)) return undefined;
  return {
    path,
    reason: "non-mechanical-plist",
    detail: `${value} is not a mechanical rules file`,
  };
}

export function canonicalLogicValue(value: ReadonlyLogicValue): unknown {
  if (value instanceof Uint8Array) {
    return { $bytes: [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
  }
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalLogicValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PRESENTATION_KEYS.has(key))
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalLogicValue(entry)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("logic pack cannot canonicalize a non-finite number");
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
