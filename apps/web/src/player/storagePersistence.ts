export interface StoragePersistenceReport {
  /** Whether the origin is exempt from eviction. `undefined` when the browser has no opinion. */
  readonly persisted?: boolean;
  /** True when this call is what made the origin persistent. */
  readonly newlyGranted: boolean;
  readonly usageBytes?: number;
  readonly quotaBytes?: number;
  /** Fraction of quota in use, when both figures are known. */
  readonly usedFraction?: number;
  readonly supported: boolean;
  readonly error?: string;
}

/** Warn once usage crosses this share of the origin quota; writes start failing near the top. */
export const STORAGE_PRESSURE_THRESHOLD = 0.8;

/**
 * Asks the browser to exempt this origin from eviction, and measures how much of the quota the
 * save data is using.
 *
 * Without the `persist()` call, browser-local saves live in best-effort storage that Chromium is
 * free to evict under disk pressure. The request is silent and non-blocking: Chromium grants it
 * automatically for installed//engaged origins and denies it otherwise, and a denial is worth
 * reporting rather than treating as an error.
 */
export async function requestPersistentStorage(
  storage: StorageManager | undefined = globalThis.navigator?.storage,
): Promise<StoragePersistenceReport> {
  if (storage === undefined) return { supported: false, newlyGranted: false };
  try {
    const alreadyPersisted = typeof storage.persisted === "function"
      ? await storage.persisted()
      : undefined;
    const persisted = alreadyPersisted === true || typeof storage.persist !== "function"
      ? alreadyPersisted
      : await storage.persist();
    const estimate = typeof storage.estimate === "function" ? await storage.estimate() : undefined;
    const usageBytes = estimate?.usage;
    const quotaBytes = estimate?.quota;
    return {
      supported: true,
      newlyGranted: alreadyPersisted === false && persisted === true,
      ...(persisted === undefined ? {} : { persisted }),
      ...(usageBytes === undefined ? {} : { usageBytes }),
      ...(quotaBytes === undefined ? {} : { quotaBytes }),
      ...(usageBytes === undefined || quotaBytes === undefined || quotaBytes === 0
        ? {}
        : { usedFraction: usageBytes / quotaBytes }),
    };
  } catch (error) {
    return {
      supported: true,
      newlyGranted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function describeStoragePersistence(report: StoragePersistenceReport): string {
  if (!report.supported) return "Storage manager is unavailable; saves use best-effort storage.";
  if (report.error !== undefined) return `Storage persistence check failed: ${report.error}`;
  const durability = report.persisted === true
    ? report.newlyGranted ? "persistent (granted just now)" : "persistent"
    : report.persisted === false
      ? "best-effort"
      : "unknown";
  if (report.usageBytes === undefined || report.quotaBytes === undefined) {
    return `Save storage is ${durability}.`;
  }
  const percent = report.usedFraction === undefined
    ? ""
    : ` (${(report.usedFraction * 100).toFixed(1)}%)`;
  return `Save storage is ${durability}; using ${formatBytes(report.usageBytes)} of ` +
    `${formatBytes(report.quotaBytes)}${percent}.`;
}

export function isUnderStoragePressure(report: StoragePersistenceReport): boolean {
  return report.usedFraction !== undefined && report.usedFraction >= STORAGE_PRESSURE_THRESHOLD;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return String(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
