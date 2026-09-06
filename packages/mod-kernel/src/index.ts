import { unzipSync, type UnzipFileInfo, type Unzipped } from "fflate";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_COUNT = 512;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 250;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;
const MAX_PRIORITY = 1_000_000;

export const CODE_MOD_API_VERSION = 4 as const;

export interface CodeModManifestV4 {
  readonly schemaVersion: 4;
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly apiVersion: 4;
  readonly mode: "offline";
  /** Hard requirements. Absence or a version outside the range refuses the profile. Implies order. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** Version-checked and ordered only when the named package is also selected. */
  readonly optionalDependencies: Readonly<Record<string, string>>;
  /** Declared incompatibility. Selecting both is refused unless the player overrides it. */
  readonly conflicts: Readonly<Record<string, string>>;
  /** Soft ordering. Applies only when the named package is also selected; no version check. */
  readonly loadAfter: readonly string[];
  readonly loadBefore: readonly string[];
  /** Tie-break inside the topological order. Higher loads later, so its overwrites win. */
  readonly priority: number;
  readonly entry: string;
}

export interface CodeModPackage {
  readonly archiveName: string;
  readonly digest: string;
  readonly manifest: CodeModManifestV4;
  /** Every non-directory bundle file, isolated from the caller's ZIP bytes. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly source: string;
}

export type ModAdvisoryKind =
  | "optional-missing"
  | "priority-override"
  | "declared-conflict-overridden";

/** A non-fatal resolution fact worth showing the player before they commit to a profile. */
export interface ModAdvisory {
  readonly kind: ModAdvisoryKind;
  readonly modId: string;
  readonly message: string;
}

export interface ResolvedCodeModProfile {
  readonly schemaVersion: 4;
  readonly digest: string;
  readonly packages: readonly CodeModPackage[];
  readonly advisories: readonly ModAdvisory[];
}

export interface ResolveCodeModProfileOptions {
  /**
   * Player-supplied load-order overrides keyed by mod id, replacing the manifest `priority`.
   * Declared dependency and load-order edges still win: this only breaks ties.
   */
  readonly priorityOverrides?: Readonly<Record<string, number>>;
  /**
   * Loads a profile whose authors declared each other incompatible. Full trust means the player
   * is allowed to insist; the refusal is an author's statement, not a capability boundary.
   */
  readonly allowDeclaredConflicts?: boolean;
}

export class ModPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModPackageError";
  }
}

class FrozenReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  readonly #values: Map<K, V>;
  constructor(entries: Iterable<readonly [K, V]>) {
    this.#values = new Map(entries);
    Object.freeze(this);
  }
  get size(): number { return this.#values.size; }
  get(key: K): V | undefined { return this.#values.get(key); }
  has(key: K): boolean { return this.#values.has(key); }
  entries(): MapIterator<[K, V]> { return this.#values.entries(); }
  keys(): MapIterator<K> { return this.#values.keys(); }
  values(): MapIterator<V> { return this.#values.values(); }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.#values[Symbol.iterator](); }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#values) callbackfn.call(thisArg, value, key, this);
  }
}

/** Reads and validates a full-trust bundle without executing it. */
export async function importCodeModArchive(
  bytes: Uint8Array,
  archiveName: string,
): Promise<CodeModPackage> {
  if (bytes.byteLength === 0) throw new ModPackageError(`${archiveName}: mod archive is empty`);
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ModPackageError(`${archiveName}: archive exceeds ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB`);
  }
  const unzipped = unzipArchive(bytes, archiveName);
  const manifest = parseManifest(parseJsonFile(unzipped, "manifest.json", archiveName), archiveName);
  const entryBytes = unzipped[manifest.entry];
  if (entryBytes === undefined) throw new ModPackageError(`${archiveName}: missing ${manifest.entry}`);
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(entryBytes);
  } catch (error) {
    throw new ModPackageError(`${archiveName}: entry script is not UTF-8: ${message(error)}`);
  }
  if (source.trim().length === 0) throw new ModPackageError(`${archiveName}: entry script is empty`);
  const files = new FrozenReadonlyMap(
    Object.entries(unzipped)
      .filter(([path]) => !path.endsWith("/"))
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, value]) => [path, value.slice()] as const),
  );
  return Object.freeze({
    archiveName,
    digest: await sha256Hex(bytes),
    manifest,
    files,
    source,
  });
}

/**
 * Resolves declared relations into one deterministic activation order plus a save-binding identity.
 *
 * Order is what decides who wins an overwrite, so it is derived, never taken from selection order:
 * hard and soft edges first, then effective priority, then id. Later activation wins, matching the
 * conventional "higher priority overwrites" reading from file-based mod managers.
 */
export async function resolveCodeModProfile(
  packages: readonly CodeModPackage[],
  options: ResolveCodeModProfileOptions = {},
): Promise<ResolvedCodeModProfile> {
  if (packages.length === 0) throw new ModPackageError("mod profile must contain at least one package");
  const byId = new Map<string, CodeModPackage>();
  for (const pkg of packages) {
    const previous = byId.get(pkg.manifest.id);
    if (previous !== undefined) {
      throw new ModPackageError(
        `duplicate mod id ${pkg.manifest.id}: ${previous.archiveName}, ${pkg.archiveName}`,
      );
    }
    byId.set(pkg.manifest.id, pkg);
  }
  const advisories: ModAdvisory[] = [];
  const overrides = options.priorityOverrides ?? {};

  const outgoing = new Map([...byId.keys()].map((id) => [id, new Set<string>()]));
  const incoming = new Map([...byId.keys()].map((id) => [id, new Set<string>()]));
  /** `before` activates ahead of `after`. Duplicate edges are collapsed so indegrees stay exact. */
  const order = (before: string, after: string): void => {
    if (before === after) return;
    if (outgoing.get(before)!.has(after)) return;
    outgoing.get(before)!.add(after);
    incoming.get(after)!.add(before);
  };

  for (const pkg of byId.values()) {
    const { id, dependencies, optionalDependencies, conflicts, loadAfter, loadBefore } = pkg.manifest;
    for (const [dependencyId, range] of Object.entries(dependencies)) {
      const dependency = byId.get(dependencyId);
      if (dependency === undefined) {
        throw new ModPackageError(`${id}: missing dependency ${dependencyId}@${range}`);
      }
      if (!matchesRange(dependency.manifest.version, range)) {
        throw new ModPackageError(
          `${id}: requires ${dependencyId}@${range}, got ${dependency.manifest.version}`,
        );
      }
      order(dependencyId, id);
    }
    for (const [dependencyId, range] of Object.entries(optionalDependencies)) {
      const dependency = byId.get(dependencyId);
      if (dependency === undefined) {
        advisories.push({
          kind: "optional-missing",
          modId: id,
          message: `${id}: optional ${dependencyId}@${range} is not selected; loading without it`,
        });
        continue;
      }
      if (!matchesRange(dependency.manifest.version, range)) {
        throw new ModPackageError(
          `${id}: optional ${dependencyId}@${range} is selected at the incompatible ` +
          `version ${dependency.manifest.version}`,
        );
      }
      order(dependencyId, id);
    }
    for (const [conflictId, range] of Object.entries(conflicts)) {
      const other = byId.get(conflictId);
      if (other === undefined || !matchesRange(other.manifest.version, range)) continue;
      const detail =
        `${id} declares a conflict with ${conflictId}@${other.manifest.version} (incompatible ${range})`;
      if (options.allowDeclaredConflicts !== true) {
        throw new ModPackageError(`${detail}. Remove one, or load the profile anyway to override.`);
      }
      advisories.push({ kind: "declared-conflict-overridden", modId: id, message: detail });
    }
    for (const otherId of loadAfter) if (byId.has(otherId)) order(otherId, id);
    for (const otherId of loadBefore) if (byId.has(otherId)) order(id, otherId);
  }

  for (const [id, priority] of Object.entries(overrides)) {
    const pkg = byId.get(id);
    if (pkg === undefined || pkg.manifest.priority === priority) continue;
    advisories.push({
      kind: "priority-override",
      modId: id,
      message: `${id}: load order forced to priority ${priority} (manifest asks for ${pkg.manifest.priority})`,
    });
  }

  const rank = (id: string): number => {
    const override = overrides[id];
    return typeof override === "number" && Number.isFinite(override)
      ? override
      : byId.get(id)!.manifest.priority;
  };
  const byRankThenId = (left: string, right: string): number =>
    rank(left) - rank(right) || compareText(left, right);

  const indegree = new Map([...incoming].map(([id, sources]) => [id, sources.size]));
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort(byRankThenId);
  const ordered: CodeModPackage[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);
    for (const dependent of outgoing.get(id)!) {
      const next = indegree.get(dependent)! - 1;
      indegree.set(dependent, next);
      if (next === 0) ready.push(dependent);
    }
    ready.sort(byRankThenId);
  }
  if (ordered.length !== packages.length) {
    const cycle = [...indegree].filter(([, count]) => count > 0).map(([id]) => id).sort(compareText);
    throw new ModPackageError(`mod load order contains a cycle: ${cycle.join(" -> ")}`);
  }

  const identity = {
    schemaVersion: 4,
    packages: ordered.map((pkg) => ({
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      digest: pkg.digest,
    })),
  };
  return Object.freeze({
    schemaVersion: 4,
    digest: await sha256Hex(new TextEncoder().encode(JSON.stringify(identity))),
    packages: Object.freeze(ordered),
    advisories: Object.freeze(advisories),
  });
}

function unzipArchive(bytes: Uint8Array, archiveName: string): Unzipped {
  const seen = new Set<string>();
  let count = 0;
  let expanded = 0;
  try {
    return unzipSync(bytes, {
      filter: (entry) => {
        validateArchiveEntry(entry, seen, archiveName);
        count++;
        expanded += entry.originalSize;
        if (count > MAX_ENTRY_COUNT) throw new ModPackageError(`${archiveName}: too many entries`);
        if (expanded > MAX_UNCOMPRESSED_BYTES) {
          throw new ModPackageError(
            `${archiveName}: archive expands beyond ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MiB`,
          );
        }
        return !entry.name.endsWith("/");
      },
    });
  } catch (error) {
    if (error instanceof ModPackageError) throw error;
    throw new ModPackageError(`${archiveName}: could not read .dibmod ZIP: ${message(error)}`);
  }
}

const REQUIRED_MANIFEST_FIELDS = [
  "schemaVersion", "id", "version", "displayName", "apiVersion", "mode", "dependencies", "entry",
] as const;
const OPTIONAL_MANIFEST_FIELDS = [
  "optionalDependencies", "conflicts", "loadAfter", "loadBefore", "priority",
] as const;

function parseManifest(value: unknown, label: string): CodeModManifestV4 {
  const manifest = strictRecord(
    value,
    { required: REQUIRED_MANIFEST_FIELDS, optional: OPTIONAL_MANIFEST_FIELDS },
    `${label}:manifest.json`,
  );
  if (manifest["schemaVersion"] !== 4) {
    throw new ModPackageError(`${label}: unsupported manifest schema ${String(manifest["schemaVersion"])}`);
  }
  if (manifest["apiVersion"] !== CODE_MOD_API_VERSION) {
    throw new ModPackageError(`${label}: unsupported mod API ${String(manifest["apiVersion"])}`);
  }
  const id = requiredString(manifest["id"], `${label}: manifest id`);
  if (!ID_PATTERN.test(id)) throw new ModPackageError(`${label}: invalid reverse-DNS mod id ${id}`);
  const version = requiredString(manifest["version"], `${label}: manifest version`);
  if (!VERSION_PATTERN.test(version)) {
    throw new ModPackageError(`${label}: invalid semantic version ${version}`);
  }
  const displayName = requiredString(manifest["displayName"], `${label}: displayName`);
  if (displayName.length > 80) throw new ModPackageError(`${label}: displayName is too long`);
  if (manifest["mode"] !== "offline") throw new ModPackageError(`${label}: mods must declare offline mode`);
  const entry = requiredString(manifest["entry"], `${label}: entry`);
  validatePath(entry, `${label}: entry`);
  if (!/\.(?:js|mjs)$/i.test(entry)) {
    throw new ModPackageError(`${label}: entry must be a JavaScript .js or .mjs file`);
  }
  const relations = {
    dependencies: parseRanges(manifest["dependencies"], id, "dependencies", label),
    optionalDependencies: parseRanges(manifest["optionalDependencies"], id, "optionalDependencies", label),
    conflicts: parseRanges(manifest["conflicts"], id, "conflicts", label),
    loadAfter: parseIdList(manifest["loadAfter"], id, "loadAfter", label),
    loadBefore: parseIdList(manifest["loadBefore"], id, "loadBefore", label),
  };
  for (const conflictId of Object.keys(relations.conflicts)) {
    if (relations.dependencies[conflictId] !== undefined ||
        relations.optionalDependencies[conflictId] !== undefined) {
      throw new ModPackageError(`${label}: ${conflictId} is both depended on and declared incompatible`);
    }
  }
  return Object.freeze({
    schemaVersion: 4,
    id,
    version,
    displayName,
    apiVersion: 4,
    mode: "offline",
    ...relations,
    priority: parsePriority(manifest["priority"], label),
    entry,
  });
}

function parsePriority(value: unknown, label: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > MAX_PRIORITY) {
    throw new ModPackageError(`${label}: priority must be an integer within ±${MAX_PRIORITY}`);
  }
  return value;
}

function parseRanges(
  value: unknown,
  selfId: string,
  field: string,
  label: string,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  const record = strictRecord(value, undefined, `${label}: ${field}`);
  const result: Record<string, string> = {};
  for (const [id, rawRange] of Object.entries(record)) {
    if (!ID_PATTERN.test(id)) throw new ModPackageError(`${label}: invalid ${field} id ${id}`);
    if (id === selfId) throw new ModPackageError(`${label}: ${field} may not name the package itself`);
    const range = requiredString(rawRange, `${label}: ${field} ${id}`);
    if (!isValidRange(range)) {
      throw new ModPackageError(`${label}: invalid ${field} version range ${id}@${range}`);
    }
    result[id] = range;
  }
  return Object.freeze(result);
}

function parseIdList(
  value: unknown,
  selfId: string,
  field: string,
  label: string,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new ModPackageError(`${label}: ${field} must be an array`);
  const seen = new Set<string>();
  for (const entry of value) {
    const id = requiredString(entry, `${label}: ${field} entry`);
    if (!ID_PATTERN.test(id)) throw new ModPackageError(`${label}: invalid ${field} id ${id}`);
    if (id === selfId) throw new ModPackageError(`${label}: ${field} may not name the package itself`);
    if (seen.has(id)) throw new ModPackageError(`${label}: duplicate ${field} id ${id}`);
    seen.add(id);
  }
  return Object.freeze([...seen].sort(compareText));
}

// -------------------------------------------------------------------------------------------
// Version ranges. Exact pins are brittle across a library mod's own patch releases, so the
// familiar comparator set is accepted and an exact version stays valid as the narrowest range.
// -------------------------------------------------------------------------------------------

interface ParsedVersion {
  readonly release: readonly [number, number, number];
  readonly prerelease: readonly string[];
}

const COMPARATOR_PATTERN = /^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?)$/;

export function isValidRange(range: string): boolean {
  const clauses = range.split("||").map((clause) => clause.trim());
  if (clauses.length === 0) return false;
  return clauses.every((clause) => {
    if (clause === "*" || clause === "any") return true;
    const comparators = clause.split(/\s+/).filter((part) => part.length > 0);
    return comparators.length > 0 && comparators.every((part) => COMPARATOR_PATTERN.test(part));
  });
}

/** `*`, an exact version, comparators (`>=1.2.0 <2.0.0`), `^`/`~`, and `||` alternatives. */
export function matchesRange(version: string, range: string): boolean {
  const target = parseVersion(version);
  return range.split("||").some((clause) => {
    const trimmed = clause.trim();
    if (trimmed === "*" || trimmed === "any") return true;
    return trimmed
      .split(/\s+/)
      .filter((part) => part.length > 0)
      .every((comparator) => satisfiesComparator(target, comparator));
  });
}

function satisfiesComparator(target: ParsedVersion, comparator: string): boolean {
  const match = COMPARATOR_PATTERN.exec(comparator);
  if (match === null) return false;
  const operator = match[1] ?? "=";
  const bound = parseVersion(match[2]!);
  const order = compareVersions(target, bound);
  switch (operator) {
    case ">": return order > 0;
    case ">=": return order >= 0;
    case "<": return order < 0;
    case "<=": return order <= 0;
    case "^": {
      // Caret allows everything up to the next change in the leftmost nonzero release field.
      const [major, minor] = bound.release;
      const ceiling: ParsedVersion = major > 0
        ? { release: [major + 1, 0, 0], prerelease: [] }
        : minor > 0
          ? { release: [0, minor + 1, 0], prerelease: [] }
          : { release: [0, 0, bound.release[2] + 1], prerelease: [] };
      return order >= 0 && compareVersions(target, ceiling) < 0;
    }
    case "~": {
      const [major, minor] = bound.release;
      const ceiling: ParsedVersion = { release: [major, minor + 1, 0], prerelease: [] };
      return order >= 0 && compareVersions(target, ceiling) < 0;
    }
    default: return order === 0;
  }
}

function parseVersion(version: string): ParsedVersion {
  const [release, prerelease] = splitOnce(version, "-");
  const parts = release.split(".").map((part) => Number.parseInt(part, 10));
  return {
    release: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0],
    prerelease: prerelease === undefined ? [] : prerelease.split("."),
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left.release[index]! - right.release[index]!;
    if (difference !== 0) return difference;
  }
  // Semantic-version precedence: any prerelease sorts below the matching release.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return (left.prerelease.length === 0 ? 1 : 0) - (right.prerelease.length === 0 ? 1 : 0);
  }
  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const a = left.prerelease[index]!;
    const b = right.prerelease[index]!;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) {
      const difference = Number.parseInt(a, 10) - Number.parseInt(b, 10);
      if (difference !== 0) return difference;
    } else if (numericA !== numericB) {
      return numericA ? -1 : 1;
    } else if (a !== b) {
      return compareText(a, b);
    }
  }
  return left.prerelease.length - right.prerelease.length;
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  return index < 0 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)];
}

function validateArchiveEntry(entry: UnzipFileInfo, seen: Set<string>, archiveName: string): void {
  const canonical = entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name;
  validatePath(canonical, archiveName);
  if (seen.has(canonical)) throw new ModPackageError(`${archiveName}: duplicate entry ${canonical}`);
  seen.add(canonical);
  if (entry.originalSize > MAX_ENTRY_BYTES) {
    throw new ModPackageError(`${archiveName}: entry too large: ${canonical}`);
  }
  if (entry.size > 0 && entry.originalSize / entry.size > MAX_COMPRESSION_RATIO) {
    throw new ModPackageError(`${archiveName}: suspicious compression ratio: ${canonical}`);
  }
}

function validatePath(path: string, label: string): void {
  if (path.length === 0 || path.length > 240 || path.startsWith("/") || path.includes("\\") ||
      path.includes("\0") || /^[A-Za-z]:/.test(path)) {
    throw new ModPackageError(`${label}: unsafe archive path ${JSON.stringify(path)}`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new ModPackageError(`${label}: unsafe archive path ${JSON.stringify(path)}`);
  }
}

function parseJsonFile(files: Unzipped, path: string, label: string): unknown {
  const bytes = files[path];
  if (bytes === undefined) throw new ModPackageError(`${label}: missing ${path}`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new ModPackageError(`${label}: invalid ${path}: ${message(error)}`);
  }
}

function strictRecord(
  value: unknown,
  fields: { readonly required: readonly string[]; readonly optional: readonly string[] } | undefined,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ModPackageError(`${label} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (fields !== undefined) {
    const allowed = new Set([...fields.required, ...fields.optional]);
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) throw new ModPackageError(`${label}: unknown field ${key}`);
    }
    for (const key of fields.required) {
      if (!Object.hasOwn(record, key)) throw new ModPackageError(`${label}: missing field ${key}`);
    }
  }
  return record;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ModPackageError(`${label} must be a nonempty string`);
  }
  return value;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
