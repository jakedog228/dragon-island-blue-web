import { SAVE_SLOT_IDS, type SaveSlotId, type SaveSlotSummary } from "@dib/save-protocol";
import type { ContentFingerprint } from "../content/contentFingerprint.js";
import { parsePlayerGameStateSnapshot, type PlayerGameStateSnapshot } from "./gameState.js";
import { isHistoricalContentStateEligible } from "./contentEligibility.js";
import { SaveConflictError, SaveQuotaError, isQuotaExceeded } from "./saveErrors.js";
import type { SaveSession, SaveSlotStore, StoredRevision } from "./saveStore.js";

const STORAGE_PREFIX = "dib-save-v1";


const PREVIOUS_SUFFIX = "previous";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ReleaseDisposableBrowserStorage = () => Promise<boolean>;

const NO_DISPOSABLE_STORAGE: ReleaseDisposableBrowserStorage = async () => false;

interface StoredSlot {
  readonly revision: number;
  readonly updatedAt: string;
  readonly state: PlayerGameStateSnapshot;
}

interface LocatedSlot {
  readonly stored: StoredSlot;
  readonly compatible: boolean;
}

/**
 * Three-slot browser-local store. Keys are namespaced by the semantic content fingerprint, so
 * independently-authored archives cannot see or overwrite one another's state. Only validated
 * JSON snapshots enter storage.
 */
export class BrowserSaveConnection implements SaveSlotStore {
  private readonly summaries = new Map<SaveSlotId, SaveSlotSummary>();

  private constructor(
    private readonly storage: StorageLike,
    private readonly namespace: string,
    private readonly legacyNamespaces: readonly string[] = [],
    private readonly releaseDisposableStorage: ReleaseDisposableBrowserStorage =
      NO_DISPOSABLE_STORAGE,
  ) {
    this.refreshSummaries();
  }

  static forContent(
    fingerprint: ContentFingerprint,
    storage: StorageLike = requiredLocalStorage(),
    releaseDisposableStorage: ReleaseDisposableBrowserStorage = NO_DISPOSABLE_STORAGE,
  ): BrowserSaveConnection {
    return new BrowserSaveConnection(
      storage,
      `${fingerprint.algorithm}:${fingerprint.scope}:${fingerprint.digest}`,
      [
        `${fingerprint.previousV6.algorithm}:${fingerprint.previousV6.scope}:${fingerprint.previousV6.digest}`,
        `${fingerprint.previousV5.algorithm}:${fingerprint.previousV5.scope}:${fingerprint.previousV5.digest}`,
        `${fingerprint.previousV4.algorithm}:${fingerprint.previousV4.scope}:${fingerprint.previousV4.digest}`,
        `${fingerprint.previousV3.algorithm}:${fingerprint.previousV3.scope}:${fingerprint.previousV3.digest}`,
        `${fingerprint.previousV2.algorithm}:${fingerprint.previousV2.scope}:${fingerprint.previousV2.digest}`,
        `${fingerprint.legacyV1.algorithm}:${fingerprint.legacyV1.scope}:${fingerprint.legacyV1.digest}`,
      ],
      releaseDisposableStorage,
    );
  }

  /** Test seam that retains the production envelope and optimistic revision behavior. */
  static forNamespace(
    namespace: string,
    storage: StorageLike,
    releaseDisposableStorage: ReleaseDisposableBrowserStorage = NO_DISPOSABLE_STORAGE,
  ): BrowserSaveConnection {
    if (namespace.length === 0) throw new Error("browser save namespace cannot be empty");
    return new BrowserSaveConnection(storage, namespace, [], releaseDisposableStorage);
  }

  get slots(): readonly SaveSlotSummary[] {
    return SAVE_SLOT_IDS.flatMap((slotId) => {
      const summary = this.summaries.get(slotId);
      return summary === undefined ? [] : [summary];
    });
  }

  summary(slotId: SaveSlotId): SaveSlotSummary | undefined {
    return this.summaries.get(slotId);
  }

  /** The semantic destination used by the profile manager's explicit cross-content clone. */
  get saveNamespace(): string {
    return this.namespace;
  }

  /**
   * Player-authorized escape hatch for trying a save with different Offline content. The source
   * record is never moved or edited. The destination must be empty so this cannot turn a
   * compatibility experiment into an accidental overwrite.
   */
  async cloneSlotFromNamespace(
    sourceNamespace: string,
    slotId: SaveSlotId,
  ): Promise<void> {
    if (sourceNamespace.length === 0) throw new Error("source save namespace cannot be empty");
    if (sourceNamespace === this.namespace) {
      throw new Error(`${slotId} already belongs to the selected content`);
    }
    if (this.readNamespace(slotId, this.namespace) !== undefined) {
      throw new Error(`${slotId} already has a save for the selected content`);
    }
    const source = this.readNamespace(slotId, sourceNamespace);
    if (source === undefined) throw new Error(`${slotId} is missing from the source profile`);
    await this.writePrioritizingState(slotId, null, source.state);
  }

  async loadSlotState(slotId: SaveSlotId): Promise<PlayerGameStateSnapshot | undefined> {
    const located = this.locate(slotId);
    if (located === undefined) {
      this.summaries.delete(slotId);
      return undefined;
    }
    this.summaries.set(slotId, summaryOf(slotId, located.stored, located.compatible));
    return located.compatible ? cloneState(located.stored.state) : undefined;
  }

  async deleteSlot(slotId: SaveSlotId): Promise<void> {
    const expectedRevision = this.summary(slotId)?.revision;
    const located = this.locate(slotId);
    if (located === undefined) {
      this.summaries.delete(slotId);
      return;
    }
    if (!located.compatible) {
      throw new Error(`${slotId} belongs to an incompatible historical content identity`);
    }
    const current = located.stored;
    if (expectedRevision === undefined || current.revision !== expectedRevision) {
      throw new SaveConflictError(slotId, expectedRevision ?? null, current.revision);
    }
    this.storage.removeItem(this.key(slotId));
    this.storage.removeItem(this.previousKey(slotId));
    this.removeEligibleHistoricalRecords(slotId);
    this.refreshSummary(slotId);
  }

  /**
   * The revision the most recent write replaced, if one is still retained. Erasing a slot drops it,
   * and storage pressure may have prevented it from ever being kept.
   */
  previousRevision(slotId: SaveSlotId): StoredRevision | undefined {
    if (this.locate(slotId)?.compatible === false) return undefined;
    const stored = this.readPrevious(slotId);
    return stored === undefined
      ? undefined
      : { revision: stored.revision, updatedAt: stored.updatedAt, state: cloneState(stored.state) };
  }

  /**
   * Promotes the retained prior revision back to current. The revision counter keeps advancing, so
   * this reads as a new write rather than rewinding history, and the state being replaced becomes
   * the new prior revision — a rollback is therefore itself undoable exactly once.
   */
  async restorePreviousRevision(slotId: SaveSlotId): Promise<void> {
    const located = this.locate(slotId);
    if (located?.compatible === false) {
      throw new Error(`${slotId} belongs to an incompatible historical content identity`);
    }
    const previous = this.readPrevious(slotId);
    if (previous === undefined) throw new Error(`${slotId} has no retained previous revision`);
    const current = located?.stored;
    await this.writePrioritizingState(slotId, current?.revision ?? null, previous.state);
  }

  open(slotId: SaveSlotId, preloadedState?: PlayerGameStateSnapshot): BrowserSaveSession {
    const revision = this.summary(slotId)?.revision ?? null;
    return new BrowserSaveSession(this, slotId, revision, preloadedState);
  }

  readForSession(slotId: SaveSlotId): StoredSlot | undefined {
    const located = this.locate(slotId);
    return located?.compatible === true ? located.stored : undefined;
  }

  writeForSession(
    slotId: SaveSlotId,
    expectedRevision: number | null,
    state: PlayerGameStateSnapshot,
  ): StoredSlot {
    const located = this.locate(slotId);
    if (located?.compatible === false) {
      throw new Error(`${slotId} belongs to an incompatible historical content identity`);
    }
    const current = located?.stored;
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== expectedRevision) {
      throw new SaveConflictError(slotId, expectedRevision, currentRevision);
    }
    const next: StoredSlot = {
      revision: (current?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
      state: cloneState(state),
    };
    try {
      this.storage.setItem(this.key(slotId), JSON.stringify(next));
    } catch (error) {
      if (isQuotaExceeded(error)) throw new SaveQuotaError(slotId, error);
      throw error;
    }
    // Only after the primary write has landed, so a full origin costs the rollback copy rather
    // than the save itself.
    this.retainPrevious(slotId, current);
    this.removeEligibleHistoricalRecords(slotId);
    this.summaries.set(slotId, summaryOf(slotId, next));
    return next;
  }

  async writePrioritizingState(
    slotId: SaveSlotId,
    expectedRevision: number | null,
    state: PlayerGameStateSnapshot,
  ): Promise<StoredSlot> {
    try {
      return this.writeForSession(slotId, expectedRevision, state);
    } catch (error) {
      if (!(error instanceof SaveQuotaError)) throw error;
      let released = false;
      try {
        released = await this.releaseDisposableStorage();
      } catch {
        // Preserve the save-specific quota failure. Archive-cache cleanup is best effort and must
        // never replace the actionable error the player sees.
      }
      if (!released) throw error;
      return this.writeForSession(slotId, expectedRevision, state);
    }
  }

  private retainPrevious(slotId: SaveSlotId, previous: StoredSlot | undefined): void {
    if (previous === undefined) return;
    const key = this.previousKey(slotId);
    try {
      this.storage.setItem(key, JSON.stringify(previous));
    } catch {
      // A rollback copy must never cost the player the save it was protecting. Drop the stale
      // retained revision rather than leaving a copy that no longer precedes the current one.
      try { this.storage.removeItem(key); } catch { /* storage is unusable; the save still stands */ }
    }
  }

  private readPrevious(slotId: SaveSlotId): StoredSlot | undefined {
    try {
      const current = this.readEnvelope(this.previousKey(slotId), slotId);
      if (current !== undefined) return current;
      for (const namespace of this.legacyNamespaces) {
        const stored = this.readEnvelope(this.previousKey(slotId, namespace), slotId);
        if (stored !== undefined) {
          return isHistoricalContentStateEligible(stored.state) ? stored : undefined;
        }
      }
    } catch {
      // A corrupt rollback copy must not block reading or writing the live slot.
      return undefined;
    }
    return undefined;
  }

  private refreshSummaries(): void {
    this.summaries.clear();
    for (const slotId of SAVE_SLOT_IDS) {
      this.refreshSummary(slotId);
    }
  }

  private refreshSummary(slotId: SaveSlotId): void {
    const located = this.locate(slotId);
    if (located === undefined) {
      this.summaries.delete(slotId);
    } else {
      this.summaries.set(slotId, summaryOf(slotId, located.stored, located.compatible));
    }
  }

  private locate(slotId: SaveSlotId): LocatedSlot | undefined {
    const current = this.readNamespace(slotId, this.namespace);
    if (current !== undefined) {
      return { stored: current, compatible: true };
    }
    for (const namespace of this.legacyNamespaces) {
      const stored = this.readNamespace(slotId, namespace);
      if (stored !== undefined) {
        return {
          stored,
          compatible: isHistoricalContentStateEligible(stored.state),
        };
      }
    }
    return undefined;
  }

  private readNamespace(slotId: SaveSlotId, namespace: string): StoredSlot | undefined {
    return this.readEnvelope(this.key(slotId, namespace), slotId);
  }

  private readEnvelope(key: string, slotId: SaveSlotId): StoredSlot | undefined {
    const raw = this.storage.getItem(key);
    if (raw === null) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(`browser save ${slotId} is invalid JSON: ${describe(error)}`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`browser save ${slotId} has an invalid envelope`);
    }
    const record = value as Record<string, unknown>;
    const revision = record["revision"];
    const updatedAt = record["updatedAt"];
    if (!Number.isSafeInteger(revision) || (revision as number) < 1) {
      throw new Error(`browser save ${slotId} has an invalid revision`);
    }
    if (typeof updatedAt !== "string" || Number.isNaN(new Date(updatedAt).getTime())) {
      throw new Error(`browser save ${slotId} has an invalid updatedAt value`);
    }
    return {
      revision: revision as number,
      updatedAt,
      state: parsePlayerGameStateSnapshot(record["state"]),
    };
  }

  private removeEligibleHistoricalRecords(slotId: SaveSlotId): void {
    for (const namespace of this.legacyNamespaces) {
      this.removeHistoricalEnvelopeIfEligible(this.key(slotId, namespace), slotId);
      this.removeHistoricalEnvelopeIfEligible(this.previousKey(slotId, namespace), slotId);
    }
  }

  private removeHistoricalEnvelopeIfEligible(key: string, slotId: SaveSlotId): void {
    let stored: StoredSlot | undefined;
    try {
      stored = this.readEnvelope(key, slotId);
    } catch {
      // A corrupt hidden historical record is ambiguous too. Preserve it rather than turning a
      // successful current write into implicit data loss.
      return;
    }
    if (stored !== undefined && isHistoricalContentStateEligible(stored.state)) {
      this.storage.removeItem(key);
    }
  }

  private key(slotId: SaveSlotId, namespace = this.namespace): string {
    return `${STORAGE_PREFIX}:${namespace}:${slotId}`;
  }

  private previousKey(slotId: SaveSlotId, namespace = this.namespace): string {
    return `${this.key(slotId, namespace)}:${PREVIOUS_SUFFIX}`;
  }
}

export class BrowserSaveSession implements SaveSession {
  private pending: Promise<void> = Promise.resolve();
  /** Latest caller-visible write. `pending` deliberately recovers so later writes can proceed,
   * but `flush()` must still report the latest failure instead of certifying stale storage. */
  private latestOperation: Promise<void> = Promise.resolve();
  private preloadedState: PlayerGameStateSnapshot | undefined;

  constructor(
    private readonly connection: BrowserSaveConnection,
    readonly slotId: SaveSlotId,
    private revision: number | null,
    preloadedState?: PlayerGameStateSnapshot,
  ) {
    this.preloadedState = preloadedState === undefined ? undefined : cloneState(preloadedState);
  }

  async load(): Promise<PlayerGameStateSnapshot | undefined> {
    if (this.preloadedState !== undefined) {
      const state = this.preloadedState;
      this.preloadedState = undefined;
      return cloneState(state);
    }
    const stored = this.connection.readForSession(this.slotId);
    this.revision = stored?.revision ?? null;
    return stored === undefined ? undefined : cloneState(stored.state);
  }

  save(state: PlayerGameStateSnapshot): Promise<void> {
    const frozen = cloneState(state);
    const operation = this.pending.then(async () => {
      const stored = await this.connection.writePrioritizingState(
        this.slotId,
        this.revision,
        frozen,
      );
      this.revision = stored.revision;
    });
    this.pending = operation.catch(() => {});
    this.latestOperation = operation;
    return operation;
  }

  async flush(): Promise<void> {
    await this.latestOperation;
  }

  /** Explicit player-driven conflict recovery; see {@link SaveSession.adoptStoredRevision}. */
  async adoptStoredRevision(): Promise<void> {
    const stored = this.connection.readForSession(this.slotId);
    this.revision = stored?.revision ?? null;
  }
}

function summaryOf(
  slotId: SaveSlotId,
  stored: StoredSlot,
  compatible = true,
): SaveSlotSummary {
  return {
    slotId,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
    compatible,
  };
}

function cloneState(state: PlayerGameStateSnapshot): PlayerGameStateSnapshot {
  return parsePlayerGameStateSnapshot(JSON.parse(JSON.stringify(state)));
}

function requiredLocalStorage(): StorageLike {
  try {
    if (typeof localStorage === "undefined") throw new Error("browser local storage is unavailable");
    return localStorage;
  } catch (error) {
    throw new Error(`browser local storage is unavailable: ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
