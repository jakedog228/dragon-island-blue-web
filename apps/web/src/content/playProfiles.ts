import { SAVE_SLOT_IDS, type SaveSlotId } from "@dib/save-protocol";
import type { KeyValueStorage } from "./contentArchiveMemory.js";

export const PLAY_PROFILE_STORAGE_KEY = "dib.playProfiles.v1";
/**
 * Namespaces the player removed from the list. Dismissal is a LIST concern only: the save slots
 * stay exactly where they are, because the alternative — making a tidy-up button destroy a
 * playthrough whose label is only a hash — is not a trade this menu gets to make.
 */
export const PLAY_PROFILE_DISMISSED_STORAGE_KEY = "dib.playProfiles.dismissed.v1";
/** Must match `BrowserSaveConnection`'s key prefix; slots are the ground truth for what exists. */
const SAVE_STORAGE_PREFIX = "dib-save-v1";
const MAX_REMEMBERED_PROFILES = 32;

export interface PlayProfileModRef {
  readonly digest: string;
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  /** Compressed `.dibmod` size. Undefined only for records written before size tracking. */
  readonly byteLength: number | undefined;
}

/**
 * One asset archive plus one exact ordered mod profile, recorded when it is launched Offline. The
 * `namespace` is the save namespace that pairing produces, which is what ties a profile to slots.
 */
export interface PlayProfileRecord {
  readonly schemaVersion: 1;
  readonly namespace: string;
  readonly archiveDigest: string;
  readonly archiveName: string;
  /** Compressed IPA/ZIP size. Undefined only for records written before size tracking. */
  readonly archiveByteLength: number | undefined;
  readonly mods: readonly PlayProfileModRef[];
  readonly lastUsedAt: string;
}

export interface PlayProfileSaveSlot {
  readonly slotId: SaveSlotId;
  readonly updatedAt: string | undefined;
  readonly revision: number | undefined;
}

export interface PlayProfileContentRef {
  readonly kind: "archive" | "mod";
  readonly digest: string;
  readonly label: string;
  readonly detail: string | undefined;
  /** Last known compressed file size, retained even if the cache entry has been evicted. */
  readonly byteLength: number | undefined;
  /** False renders a ghost row: the profile is known, but these bytes are not on this device. */
  readonly cached: boolean;
}

export interface PlayProfileView {
  readonly namespace: string;
  readonly label: string;
  readonly record: PlayProfileRecord | undefined;
  readonly saveSlots: readonly PlayProfileSaveSlot[];
  readonly contents: readonly PlayProfileContentRef[];
  /** Every referenced package is cached, so the gate can be populated from this device alone. */
  readonly restorable: boolean;
  readonly lastUsedAt: string | undefined;
}

interface StoredSlotShape {
  readonly revision?: unknown;
  readonly updatedAt?: unknown;
}

export function readPlayProfiles(storage: KeyValueStorage | undefined): readonly PlayProfileRecord[] {
  if (storage === undefined) return [];
  let parsed: unknown;
  try {
    const stored = storage.getItem(PLAY_PROFILE_STORAGE_KEY);
    if (stored === null) return [];
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return Object.freeze(
    parsed
      .map((entry) => parsePlayProfileRecord(entry))
      .filter((entry): entry is PlayProfileRecord => entry !== undefined),
  );
}

export function writePlayProfiles(
  storage: KeyValueStorage | undefined,
  records: readonly PlayProfileRecord[],
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(PLAY_PROFILE_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // A storage-disabled browser simply forgets profiles; play is never blocked on this.
  }
}

/** Records or refreshes one profile, newest first, and forgets the oldest beyond the ceiling. */
export function rememberPlayProfile(
  storage: KeyValueStorage | undefined,
  record: Omit<PlayProfileRecord, "schemaVersion" | "lastUsedAt"> & { readonly lastUsedAt?: string },
): readonly PlayProfileRecord[] {
  const entry: PlayProfileRecord = {
    schemaVersion: 1,
    namespace: record.namespace,
    archiveDigest: record.archiveDigest,
    archiveName: record.archiveName,
    archiveByteLength: record.archiveByteLength,
    mods: Object.freeze([...record.mods]),
    lastUsedAt: record.lastUsedAt ?? new Date().toISOString(),
  };
  const next = [
    entry,
    ...readPlayProfiles(storage).filter((row) => row.namespace !== entry.namespace),
  ].slice(0, MAX_REMEMBERED_PROFILES);
  writePlayProfiles(storage, next);
  const dismissed = readDismissedProfiles(storage);
  if (dismissed.has(entry.namespace)) {
    const remaining = new Set(dismissed);
    remaining.delete(entry.namespace);
    writeDismissedProfiles(storage, remaining);
  }
  return Object.freeze(next);
}

export function readDismissedProfiles(
  storage: KeyValueStorage | undefined,
): ReadonlySet<string> {
  if (storage === undefined) return new Set();
  try {
    const stored = storage.getItem(PLAY_PROFILE_DISMISSED_STORAGE_KEY);
    if (stored === null) return new Set();
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => isNonEmptyString(entry)));
  } catch {
    return new Set();
  }
}

function writeDismissedProfiles(
  storage: KeyValueStorage | undefined,
  namespaces: ReadonlySet<string>,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(PLAY_PROFILE_DISMISSED_STORAGE_KEY, JSON.stringify([...namespaces].sort()));
  } catch {
    // A storage-disabled browser simply shows the row again next session.
  }
}

/** Hides one namespace from the list without touching a single save slot. */
export function dismissPlayProfile(
  storage: KeyValueStorage | undefined,
  namespace: string,
): ReadonlySet<string> {
  const next = new Set(readDismissedProfiles(storage));
  next.add(namespace);
  writeDismissedProfiles(storage, next);
  return next;
}

export function forgetPlayProfile(
  storage: KeyValueStorage | undefined,
  namespace: string,
): readonly PlayProfileRecord[] {
  const next = readPlayProfiles(storage).filter((row) => row.namespace !== namespace);
  writePlayProfiles(storage, next);
  return Object.freeze(next);
}

/**
 * Every save namespace that actually holds slots, read straight from storage keys. A profile
 * exists because a save exists, so this — not the profile list — decides what the modal shows.
 */
export function readSaveSlotIndex(
  storage: (KeyValueStorage & { readonly length: number; key(index: number): string | null }) | undefined,
): ReadonlyMap<string, readonly PlayProfileSaveSlot[]> {
  const found = new Map<string, PlayProfileSaveSlot[]>();
  if (storage === undefined) return found;
  const slotIds = new Set<string>(SAVE_SLOT_IDS);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key === null || !key.startsWith(`${SAVE_STORAGE_PREFIX}:`)) continue;
    const remainder = key.slice(SAVE_STORAGE_PREFIX.length + 1);
    const separator = remainder.lastIndexOf(":");
    if (separator < 0) continue;
    const slotId = remainder.slice(separator + 1);
    // `:previous` siblings share a namespace with their slot and must not create a second entry.
    if (!slotIds.has(slotId)) continue;
    const namespace = remainder.slice(0, separator);
    if (namespace.length === 0) continue;
    let stored: StoredSlotShape | undefined;
    try {
      const raw = storage.getItem(key);
      stored = raw === null ? undefined : JSON.parse(raw) as StoredSlotShape;
    } catch {
      stored = undefined;
    }
    if (stored === undefined) continue;
    const slots = found.get(namespace) ?? [];
    slots.push({
      slotId: slotId as SaveSlotId,
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : undefined,
      revision: typeof stored.revision === "number" ? stored.revision : undefined,
    });
    found.set(namespace, slots);
  }
  for (const slots of found.values()) {
    slots.sort((left, right) => compareText(left.slotId, right.slotId));
  }
  return found;
}

export interface PlayProfileCacheState {
  /** The single remembered asset archive, if any. */
  readonly archiveDigest: string | undefined;
  readonly archiveByteLength?: number;
  readonly modDigests: ReadonlySet<string>;
  readonly modByteLengths?: ReadonlyMap<string, number>;
}

/**
 * Joins remembered profiles against the saves that exist and the bytes this device still holds.
 * A namespace with saves but no record is kept as an unidentified profile rather than hidden:
 * the save is real, and saying so is more useful than pretending it is not there.
 */
export function composePlayProfileViews(
  records: readonly PlayProfileRecord[],
  saveSlots: ReadonlyMap<string, readonly PlayProfileSaveSlot[]>,
  cache: PlayProfileCacheState,
  dismissed: ReadonlySet<string> = new Set(),
): readonly PlayProfileView[] {
  const byNamespace = new Map(records.map((record) => [record.namespace, record]));
  const views: PlayProfileView[] = [];
  for (const [namespace, slots] of saveSlots) {
    if (dismissed.has(namespace)) continue;
    const record = byNamespace.get(namespace);
    const contents = record === undefined ? [] : [
      {
        kind: "archive" as const,
        digest: record.archiveDigest,
        label: record.archiveName,
        detail: undefined,
        byteLength: record.archiveByteLength ?? (
          cache.archiveDigest === record.archiveDigest ? cache.archiveByteLength : undefined
        ),
        cached: cache.archiveDigest === record.archiveDigest,
      },
      ...record.mods.map((mod) => ({
        kind: "mod" as const,
        digest: mod.digest,
        label: mod.displayName,
        detail: mod.version,
        byteLength: mod.byteLength ?? cache.modByteLengths?.get(mod.digest),
        cached: cache.modDigests.has(mod.digest),
      })),
    ];
    views.push({
      namespace,
      label: describePlayProfileLabel(record, namespace),
      record,
      saveSlots: slots,
      contents: Object.freeze(contents),
      restorable: contents.length > 0 && contents.every((entry) => entry.cached),
      lastUsedAt: record?.lastUsedAt,
    });
  }
  views.sort((left, right) =>
    compareText(right.lastUsedAt ?? "", left.lastUsedAt ?? "") ||
    compareText(left.label, right.label));
  return Object.freeze(views);
}

export function describePlayProfileLabel(
  record: PlayProfileRecord | undefined,
  namespace: string,
): string {
  if (record === undefined) return `Unidentified content (${namespace.slice(-8)})`;
  const archive = record.archiveName.replace(/\.(?:ipa|zip)$/i, "");
  if (record.mods.length === 0) return `${archive} (no mods)`;
  if (record.mods.length === 1) return `${archive} + ${record.mods[0]!.displayName}`;
  return `${archive} + ${record.mods.length} mods`;
}

/** Newest actual launch, independent of storage-array ordering or whether it already has a save. */
export function lastUsedPlayProfile(
  records: readonly PlayProfileRecord[],
): PlayProfileRecord | undefined {
  return [...records].sort((left, right) =>
    compareText(right.lastUsedAt, left.lastUsedAt) ||
    compareText(left.namespace, right.namespace))[0];
}

/** Compact base-2 file size for the narrow profile/load-order rows. */
export function formatShortFileSize(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error(`Invalid file size ${String(byteLength)}`);
  }
  if (byteLength < 1024) return `${byteLength} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  const unitIndex = Math.min(Math.floor(Math.log(byteLength) / Math.log(1024)) - 1, units.length - 1);
  const value = byteLength / (1024 ** (unitIndex + 1));
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${units[unitIndex]}`;
}

function parsePlayProfileRecord(value: unknown): PlayProfileRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const mods = record["mods"];
  const archiveByteLength = record["archiveByteLength"];
  if (
    record["schemaVersion"] !== 1 ||
    !isNonEmptyString(record["namespace"]) ||
    !isSha256Digest(record["archiveDigest"]) ||
    !isNonEmptyString(record["archiveName"]) ||
    !isNonEmptyString(record["lastUsedAt"]) ||
    !Array.isArray(mods) ||
    (archiveByteLength !== undefined && !isByteLength(archiveByteLength))
  ) {
    return undefined;
  }
  const parsedMods: PlayProfileModRef[] = [];
  for (const entry of mods) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const mod = entry as Record<string, unknown>;
    const byteLength = mod["byteLength"];
    if (
      !isSha256Digest(mod["digest"]) ||
      !isNonEmptyString(mod["id"]) ||
      !isNonEmptyString(mod["version"]) ||
      !isNonEmptyString(mod["displayName"]) ||
      (byteLength !== undefined && !isByteLength(byteLength))
    ) {
      return undefined;
    }
    parsedMods.push({
      digest: mod["digest"],
      id: mod["id"],
      version: mod["version"],
      displayName: mod["displayName"],
      byteLength,
    });
  }
  return {
    schemaVersion: 1,
    namespace: record["namespace"],
    archiveDigest: record["archiveDigest"],
    archiveName: record["archiveName"],
    archiveByteLength,
    mods: Object.freeze(parsedMods),
    lastUsedAt: record["lastUsedAt"],
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isByteLength(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
