import { createHash } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  GameCommandEnvelopeV1Schema,
  GameCommandResultV1Schema,
  LogicPackDescriptorV1Schema,
  SlotProjectionV1Schema,
  type GameCommandV1,
} from "@dib/game-protocol";
import {
  GameServiceError,
  readStoredReceipt,
  type StoredReceipt,
  type AuthoritativeRecordValidationInput,
  type AuthoritativeSlotRecord,
  type AuthoritativeSlotStore,
  type CommandResultForBody,
  type ProjectionBody,
  type ProjectionBodyV1,
  type ProjectionForBody,
} from "@dib/game-service";
import { SAVE_SLOT_IDS, type SaveSlotId } from "@dib/save-protocol";
import { durableWriteFile } from "./durableWrite.js";

// The store is generic over every installed projection body, so these must be the service's own
// definitions: a local restatement silently drifts the moment a new simulation version lands.
type ResultForBody<P extends ProjectionBody> = CommandResultForBody<P>;
const RESULT_DIGESTS = new WeakMap<object, string>();
const DEFERRED_DIGESTS = new WeakMap<object, string>();
const RECEIPT_WRITE_CONCURRENCY = 8;
// A cold long-running campaign has thousands of sidecars. Share the read budget across slots
// and migrations: Promise.all over every receipt exhausted Windows file handles on real saves.
const RECEIPT_READ_CONCURRENCY = 8;
let activeReceiptReads = 0;
const waitingReceiptReads: (() => void)[] = [];

async function readReceiptFile(path: string): Promise<string> {
  await new Promise<void>((resolve) => {
    if (activeReceiptReads < RECEIPT_READ_CONCURRENCY) {
      activeReceiptReads++;
      resolve();
    } else waitingReceiptReads.push(resolve);
  });
  try {
    return await readFile(path, "utf8");
  } finally {
    const next = waitingReceiptReads.shift();
    if (next === undefined) activeReceiptReads--;
    else next();
  }
}

interface StoredSlotFileV1 {
  readonly schemaVersion: 1;
  readonly playerId: string;
  readonly slotId: SaveSlotId;
  readonly logicPackId: string;
  readonly simulationVersion: string;
  readonly revision: number;
  readonly eventCursor: number;
  readonly updatedAt: string;
  readonly state: unknown;
  readonly projection: unknown;
  readonly receipts: readonly {
    readonly commandId: string;
    readonly canonicalEnvelope: string;
    readonly result: unknown;
  }[];
}

interface StoredSlotFileV2 {
  readonly schemaVersion: 2;
  readonly playerId: string;
  readonly slotId: SaveSlotId;
  readonly logicPackId: string;
  readonly simulationVersion: string;
  readonly revision: number;
  readonly eventCursor: number;
  readonly updatedAt: string;
  readonly state: unknown;
  readonly projection: unknown;
  /**
   * Only the idempotency index remains in the mutable slot snapshot. Immutable command results
   * live beside it, one per sidecar, so committing command N never rewrites results 1..N-1.
   */
  readonly receipts: readonly StoredReceiptReferenceV2[];
}

interface StoredReceiptReferenceV2 {
  readonly commandId: string;
  readonly canonicalEnvelope: string;
  readonly resultSha256: string;
}

interface StoredReceiptSidecarV1 {
  readonly schemaVersion: 1;
  readonly commandId: string;
  readonly result: unknown;
}

type StoredLayout = "v1" | "v2" | "migration";

interface FileFingerprint {
  readonly size: bigint;
  readonly modifiedNs: bigint;
}

interface CachedRecord<S, P extends ProjectionBody> {
  readonly fingerprint: FileFingerprint;
  readonly record: AuthoritativeSlotRecord<S, P>;
}

/**
 * The projection identity this store verifies before handing a legacy record to its migration.
 * Every simulation's projection envelope carries these fields; a migration's own parser returns
 * that simulation's full shape.
 */
export interface SourceProjectionIdentityV1 {
  readonly slotId: string;
  readonly revision: number;
  readonly updatedAt?: string | undefined;
  readonly logicPackId: string;
  readonly simulationVersion: string;
  readonly trustTier: string;
}

/** The receipt identity this store verifies when reading a legacy record's committed commands. */
export interface SourceCommandResultIdentityV1 {
  readonly commandId: string;
  readonly revision: number;
  readonly projection: SourceProjectionIdentityV1;
}

/**
 * One operator-owned upgrade from an immutable source simulation into the installed one.
 *
 * Both source parsers are required and neither has a default. A source namespace was written by a
 * *different* simulation than the one now running, and assuming a shape for it is exactly the
 * mistake that made every pre-v14 slot unreadable: this store parsed v12 and v13 files with the
 * frozen v11 projection schema, which rejected their required `collectionClaims` sibling as an
 * unrecognized key. Listing slots reads every namespace, so it surfaced as a login failure for
 * every account that already had a save.
 */
export interface LegacySimulationMigration<
  S,
  P extends ProjectionBody,
  SP extends SourceProjectionIdentityV1 = SourceProjectionIdentityV1,
> {
  readonly sourceSimulationVersion: string;
  /** Strict parser for the *source* simulation's full projection envelope. */
  readonly parseSourceProjection: (value: unknown) => SP;
  /** Strict parser for receipts in the *source* simulation's own namespace. */
  readonly parseSourceCommandResult: (value: unknown) => SourceCommandResultIdentityV1;
  /**
   * Declared as a method rather than a function property deliberately: one store holds migrations
   * from several source simulations whose `SP` differ, and method parameters are bivariant where a
   * property's are not. The store only ever calls this with the value returned by this same entry's
   * `parseSourceProjection`, so the widened element type cannot actually be violated.
   */
  migrate(input: {
    readonly state: unknown;
    readonly projection: SP;
    readonly updatedAt: string;
    readonly lastLocationCommand?: GameCommandV1;
  }): {
    readonly state: S;
    readonly projection: P;
  };
}

/**
 * Preserves each entry's own source projection type at its definition site while letting one store
 * hold entries for several source simulations. Declaring the array directly would contextually
 * widen every entry's `migrate` projection to the bare identity surface above.
 */
export function legacySimulationMigration<
  S,
  P extends ProjectionBody,
  SP extends SourceProjectionIdentityV1,
>(migration: LegacySimulationMigration<S, P, SP>): LegacySimulationMigration<S, P> {
  return migration;
}

export interface FileAuthoritativeSlotStoreOptions<S, P extends ProjectionBody = ProjectionBodyV1> {
  readonly dataDirectory: string;
  readonly logicPackId: string;
  readonly simulationVersion: string;
  readonly worldId: string;
  /** Pack-specific fail-loud parser; storage never trusts arbitrary persisted aggregate JSON. */
  readonly parseState: (value: unknown) => S;
  /** Strict parser for the current simulation's full projection envelope. */
  readonly parseProjection?: (value: unknown) => ProjectionForBody<P>;
  /** Strict parser for receipts in the current simulation's namespace. */
  readonly parseCommandResult?: (value: unknown) => ResultForBody<P>;
  /** Installed-resource semantic validator. Structural parsing alone is insufficient for Official. */
  readonly validateRecord?: (record: AuthoritativeRecordValidationInput<S, P>) => void;
  /**
   * Explicit operator-owned simulation upgrades, built with `legacySimulationMigration`. The prior
   * file remains untouched; the upgraded aggregate is copied into the current immutable simulation
   * namespace on its next mutation. Sources are consulted in order, so callers must list the newest
   * trustworthy immutable generation first when more than one may coexist.
   */
  readonly legacyMigrations?: readonly LegacySimulationMigration<S, P>[];
  /** Failure-injection seam for deletion crash-safety tests. Production uses `fs.rm`. */
  readonly removePath?: typeof rm;
}

/**
 * Restart-safe single-process authority store. Transactions are serialized per player/slot and
 * committed through fsync + atomic rename. Multi-instance deployments must provide a database
 * AuthoritativeSlotStore with row locking; this adapter intentionally makes no distributed-lock
 * claim.
 */
export class FileAuthoritativeSlotStore<
  S,
  P extends ProjectionBody = ProjectionBodyV1,
> implements AuthoritativeSlotStore<S, P> {
  private readonly root: string;
  private readonly migrationSources: readonly {
    readonly root: string;
    readonly migration: NonNullable<FileAuthoritativeSlotStoreOptions<S, P>["legacyMigrations"]>[number];
  }[];
  private readonly parseState: (value: unknown) => S;
  private readonly parseProjection: (value: unknown) => ProjectionForBody<P>;
  private readonly parseCommandResult: (value: unknown) => ResultForBody<P>;
  private readonly validateRecord:
    ((record: AuthoritativeRecordValidationInput<S, P>) => void) | undefined;
  private readonly removePath: typeof rm;
  private readonly legacyRoot: string;
  private readonly logicPackId: string;
  private readonly simulationVersion: string;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly loading = new Map<string, Promise<AuthoritativeSlotRecord<S, P> | undefined>>();
  private readonly currentCache = new Map<string, CachedRecord<S, P>>();
  private readonly migrationCache = new Map<string, CachedRecord<S, P>>();
  private readonly layouts = new WeakMap<object, StoredLayout>();

  constructor(options: FileAuthoritativeSlotStoreOptions<S, P>) {
    this.legacyRoot = resolve(options.dataDirectory);
    this.root = join(
      this.legacyRoot,
      "authoritative-slots",
      namespaceSegment("pack", options.logicPackId),
      namespaceSegment("simulation", options.simulationVersion),
      namespaceSegment("world", options.worldId),
    );
    const migrations = options.legacyMigrations ?? [];
    if (new Set(migrations.map(({ sourceSimulationVersion }) => sourceSimulationVersion)).size !== migrations.length) {
      throw new Error("legacy simulation migrations must have unique source versions");
    }
    this.migrationSources = migrations.map((migration) => ({
      migration,
      root: join(
          this.legacyRoot,
          "authoritative-slots",
          namespaceSegment("pack", options.logicPackId),
          namespaceSegment("simulation", migration.sourceSimulationVersion),
          namespaceSegment("world", options.worldId),
      ),
    }));
    this.logicPackId = options.logicPackId;
    this.simulationVersion = options.simulationVersion;
    this.parseState = options.parseState;
    this.parseProjection = options.parseProjection ?? ((value) =>
      SlotProjectionV1Schema.parse(value) as ProjectionForBody<P>);
    this.parseCommandResult = options.parseCommandResult ?? ((value) =>
      GameCommandResultV1Schema.parse(value) as ResultForBody<P>);
    this.validateRecord = options.validateRecord;
    this.removePath = options.removePath ?? rm;
  }

  async transact<T>(
    playerId: string,
    slotId: SaveSlotId,
    operation: (
      current: AuthoritativeSlotRecord<S, P> | undefined,
    ) => Promise<{
      readonly record: AuthoritativeSlotRecord<S, P> | undefined;
      readonly value: T;
    }>,
  ): Promise<T> {
    validateSlotId(slotId);
    validatePlayerId(playerId);
    const key = slotKey(playerId, slotId);
    return await this.serialized(key, async () => {
      const current = await this.readFile(playerId, slotId);
      const completed = await operation(current);
      const path = this.pathFor(playerId, slotId);
      if (completed.record === undefined) {
        // Immutable migration sources must disappear while the current snapshot still wins every
        // restart. If cleanup fails/crashes, the latest current revision remains authoritative;
        // only after every resurrection source is gone may the current snapshot be removed.
        const legacyPath = this.legacyPathFor(playerId, slotId);
        await this.removePath(legacyPath, { force: true });
        await this.removePath(receiptDirectoryFor(legacyPath), { force: true, recursive: true });
        for (const { root } of this.migrationSources) {
          const sourcePath = join(root, "players", playerId, `${slotId}.json`);
          await this.removePath(sourcePath, { force: true });
          await this.removePath(receiptDirectoryFor(sourcePath), { force: true, recursive: true });
        }
        await this.removePath(path, { force: true });
        this.currentCache.delete(key);
        // Once the snapshot is absent, orphaned current-generation receipts cannot resurrect it.
        await this.removePath(receiptDirectoryFor(path), { force: true, recursive: true });
      } else if (completed.record === current) {
        // Exact idempotent replay is read-only. Rewriting even the small v2 snapshot would add a
        // needless durability barrier to the retry path and change its mtime without a revision.
        return completed.value;
      } else {
        const materializing = current === undefined || this.layouts.get(current) !== "v2";
        const priorReceiptIds = materializing
          ? new Set<string>()
          : new Set(current.receipts.keys());
        const pendingReceipts = [...completed.record.receipts]
          .filter(([commandId]) => !priorReceiptIds.has(commandId));
        for (let index = 0; index < pendingReceipts.length; index += RECEIPT_WRITE_CONCURRENCY) {
          await Promise.all(pendingReceipts
            .slice(index, index + RECEIPT_WRITE_CONCURRENCY)
            .map(async ([commandId, receipt]) => {
              const result = await readStoredReceipt(receipt);
              await this.writeReceipt(path, commandId, result);
              DEFERRED_DIGESTS.set(receipt, resultDigest(result));
            }));
        }
        await this.atomicWrite(path, `${JSON.stringify(serializeV2(completed.record))}\n`);
        this.layouts.set(completed.record, "v2");
        this.currentCache.set(key, {
          fingerprint: await fingerprint(path),
          record: completed.record,
        });
      }
      return completed.value;
    });
  }

  async read(
    playerId: string,
    slotId: SaveSlotId,
  ): Promise<AuthoritativeSlotRecord<S, P> | undefined> {
    validateSlotId(slotId);
    validatePlayerId(playerId);
    await (this.pending.get(slotKey(playerId, slotId)) ?? Promise.resolve());
    return await this.readFile(playerId, slotId);
  }

  async list(playerId: string): Promise<readonly AuthoritativeSlotRecord<S, P>[]> {
    validatePlayerId(playerId);
    await Promise.all(
      SAVE_SLOT_IDS.map((slotId) => this.pending.get(slotKey(playerId, slotId)) ?? Promise.resolve()),
    );
    const records = await Promise.all(SAVE_SLOT_IDS.map((slotId) => this.readFile(playerId, slotId)));
    return records.filter((record): record is AuthoritativeSlotRecord<S, P> => record !== undefined);
  }

  private pathFor(playerId: string, slotId: SaveSlotId): string {
    validateSlotId(slotId);
    return join(this.root, "players", playerId, `${slotId}.json`);
  }

  private legacyPathFor(playerId: string, slotId: SaveSlotId): string {
    validateSlotId(slotId);
    return join(this.legacyRoot, "players", playerId, `${slotId}.json`);
  }

  private async writeReceipt(path: string, commandId: string, result: ResultForBody<P>): Promise<void> {
    const sidecar: StoredReceiptSidecarV1 = { schemaVersion: 1, commandId, result };
    await durableWriteFile(
      receiptPathFor(path, commandId),
      `${JSON.stringify(sidecar)}\n`,
    );
  }

  private async readFile(
    playerId: string,
    slotId: SaveSlotId,
  ): Promise<AuthoritativeSlotRecord<S, P> | undefined> {
    validateSlotId(slotId);
    const key = slotKey(playerId, slotId);
    const existing = this.loading.get(key);
    if (existing !== undefined) return await existing;
    // Reconnects/list requests may overlap before the durable cache is warm. Share the
    // full validation (including migrations), not a second copy of every receipt.
    const loading = this.loadFile(playerId, slotId);
    this.loading.set(key, loading);
    try {
      return await loading;
    } finally {
      if (this.loading.get(key) === loading) this.loading.delete(key);
    }
  }

  private async loadFile(
    playerId: string,
    slotId: SaveSlotId,
  ): Promise<AuthoritativeSlotRecord<S, P> | undefined> {
    const current = await this.readPath(this.pathFor(playerId, slotId), playerId, slotId, false);
    if (current !== undefined) return current;
    for (const source of this.migrationSources) {
      const migrated = await this.readMigrationPath(
        join(source.root, "players", playerId, `${slotId}.json`),
        playerId,
        slotId,
        source.migration,
      );
      if (migrated !== undefined) return migrated;
    }
    return await this.readPath(this.legacyPathFor(playerId, slotId), playerId, slotId, true);
  }

  private async readMigrationPath(
    path: string,
    playerId: string,
    slotId: SaveSlotId,
    migration: NonNullable<FileAuthoritativeSlotStoreOptions<S, P>["legacyMigrations"]>[number],
  ): Promise<AuthoritativeSlotRecord<S, P> | undefined> {
    try {
      const sourceFingerprint = await optionalFingerprint(path);
      if (sourceFingerprint === undefined) {
        this.migrationCache.delete(path);
        return undefined;
      }
      const cached = this.migrationCache.get(path);
      if (cached !== undefined && sameFingerprint(cached.fingerprint, sourceFingerprint)) return cached.record;
      const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
      const migrated = await this.migrateLegacyFile(
        await expandStoredFile(path, raw, slotId),
        playerId,
        slotId,
        migration,
      );
      this.layouts.set(migrated, "migration");
      this.migrationCache.set(path, { fingerprint: sourceFingerprint, record: migrated });
      return migrated;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if (error instanceof GameServiceError) throw error;
      // Name the source simulation: a migration failure is otherwise indistinguishable from a
      // corrupt current-namespace record, and the source is the first thing worth knowing.
      throw new GameServiceError(
        "STATE_CORRUPT",
        `corrupt authoritative slot ${slotId} migrating from ` +
        `${migration.sourceSimulationVersion}` +
        `${error instanceof Error ? `: ${error.message}` : ""}`,
      );
    }
  }

  private async readPath(
    path: string,
    playerId: string,
    slotId: SaveSlotId,
    ignoreForeignLegacy: boolean,
  ): Promise<AuthoritativeSlotRecord<S, P> | undefined> {
    try {
      const currentPath = this.pathFor(playerId, slotId);
      const isCurrentPath = path === currentPath;
      const currentFingerprint = await optionalFingerprint(path);
      if (currentFingerprint === undefined) {
        if (isCurrentPath) this.currentCache.delete(slotKey(playerId, slotId));
        return undefined;
      }
      if (isCurrentPath) {
        const cached = this.currentCache.get(slotKey(playerId, slotId));
        if (cached !== undefined && sameFingerprint(cached.fingerprint, currentFingerprint)) {
          return cached.record;
        }
      }
      const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
      const layout: StoredLayout = isStoredSlotFileV2(raw) ? "v2" : "v1";
      // Current v2 snapshots own a strict receipt index. Read individual historical
      // results only for exact retries; migrations still inspect their frozen source history.
      const deferred = isCurrentPath && isStoredSlotFileV2(raw);
      const expanded = deferred ? { ...raw, schemaVersion: 1, receipts: [] }
        : await expandStoredFile(path, raw, slotId);
      if (
        ignoreForeignLegacy &&
        expanded !== null &&
        typeof expanded === "object" &&
        ((expanded as { logicPackId?: unknown }).logicPackId !== this.logicPackId ||
          (expanded as { simulationVersion?: unknown }).simulationVersion !== this.simulationVersion)
      ) {
        const migration = this.migrationSources.find(({ migration: candidate }) =>
          (expanded as { logicPackId?: unknown }).logicPackId === this.logicPackId &&
          (expanded as { simulationVersion?: unknown }).simulationVersion ===
            candidate.sourceSimulationVersion)?.migration;
        if (migration !== undefined) {
          const migrated = await this.migrateLegacyFile(expanded, playerId, slotId, migration);
          this.layouts.set(migrated, "migration");
          return migrated;
        }
        return undefined;
      }
      const parsed = await parseFile(
        expanded,
        playerId,
        slotId,
        this.parseState,
        this.parseProjection,
        this.parseCommandResult,
        this.validateRecord,
      );
      const record = deferred ? Object.freeze({ ...parsed,
        receipts: deferredReceipts(path, raw, parsed, this.parseCommandResult) }) : parsed;
      this.layouts.set(record, layout);
      if (isCurrentPath) {
        this.currentCache.set(slotKey(playerId, slotId), {
          fingerprint: currentFingerprint,
          record,
        });
      }
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error
          ? error.message
          : `corrupt authoritative slot ${slotId}`,
      );
    }
  }

  private async migrateLegacyFile(
    value: unknown,
    playerId: string,
    slotId: SaveSlotId,
    migration: NonNullable<FileAuthoritativeSlotStoreOptions<S, P>["legacyMigrations"]>[number],
  ): Promise<AuthoritativeSlotRecord<S, P>> {
    if (value === null || typeof value !== "object") {
      throw corrupt(slotId, "legacy migration input is unavailable");
    }
    assertStoredFileKeys(value, slotId);
    const file = value as Partial<StoredSlotFileV1>;
    if (
      file.schemaVersion !== 1 ||
      file.playerId !== playerId ||
      file.slotId !== slotId ||
      file.logicPackId !== this.logicPackId ||
      file.simulationVersion !== migration.sourceSimulationVersion ||
      !Number.isSafeInteger(file.revision) ||
      (file.revision ?? 0) < 1 ||
      !Number.isSafeInteger(file.eventCursor) ||
      (file.eventCursor ?? -1) < 0 ||
      typeof file.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(file.updatedAt)) ||
      !Array.isArray(file.receipts)
    ) {
      throw corrupt(slotId, "invalid legacy migration envelope");
    }
    const priorProjection = migration.parseSourceProjection(file.projection);
    if (
      priorProjection.slotId !== slotId ||
      priorProjection.revision !== file.revision ||
      priorProjection.updatedAt !== file.updatedAt ||
      priorProjection.trustTier !== "official" ||
      priorProjection.logicPackId !== this.logicPackId ||
      priorProjection.simulationVersion !== migration.sourceSimulationVersion
    ) {
      throw corrupt(slotId, "legacy projection does not match its source simulation");
    }
    let lastLocationCommand: GameCommandV1 | undefined;
    let lastLocationRevision = -1;
    const receiptIds = new Set<string>();
    let receiptIndex = 0;
    for (const entry of file.receipts) {
      if (++receiptIndex % 32 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      if (entry === null || typeof entry !== "object") {
        throw corrupt(slotId, "invalid legacy migration receipt");
      }
      const receipt = entry as {
        readonly commandId?: unknown;
        readonly canonicalEnvelope?: unknown;
        readonly result?: unknown;
      };
      assertReceiptKeys(entry, slotId);
      if (typeof receipt.canonicalEnvelope !== "string") {
        throw corrupt(slotId, "invalid legacy migration receipt envelope");
      }
      if (typeof receipt.commandId !== "string" || receiptIds.has(receipt.commandId)) {
        throw corrupt(slotId, "duplicate or invalid legacy migration receipt command id");
      }
      receiptIds.add(receipt.commandId);
      const envelope = GameCommandEnvelopeV1Schema.parse(JSON.parse(receipt.canonicalEnvelope));
      if (envelope.commandId !== receipt.commandId) {
        throw corrupt(slotId, "legacy migration receipt command id disagrees with its envelope");
      }
      const result = migration.parseSourceCommandResult(receipt.result);
      if (
        result.commandId !== receipt.commandId ||
        result.revision > file.revision! ||
        result.projection.slotId !== slotId ||
        result.projection.revision !== result.revision ||
        result.projection.logicPackId !== this.logicPackId ||
        result.projection.simulationVersion !== migration.sourceSimulationVersion
      ) {
        throw corrupt(slotId, `legacy migration receipt ${receipt.commandId} is not from its source generation`);
      }
      if (
        result.revision > lastLocationRevision &&
        (
          envelope.command.type === "world.navigate" ||
          envelope.command.type === "world.selectCurrentPoi" ||
          envelope.command.type === "world.leaveTown"
        )
      ) {
        lastLocationRevision = result.revision;
        lastLocationCommand = envelope.command;
      }
    }
    const migrated = migration.migrate({
      state: file.state,
      projection: priorProjection,
      updatedAt: file.updatedAt,
      ...(lastLocationCommand === undefined ? {} : { lastLocationCommand }),
    });
    const projection = this.parseProjection({
      ...migrated.projection,
      slotId,
      revision: file.revision!,
      updatedAt: file.updatedAt,
      logicPackId: this.logicPackId,
      simulationVersion: this.simulationVersion,
      trustTier: "official",
    });
    const record = Object.freeze({
      playerId,
      slotId,
      logicPackId: this.logicPackId,
      simulationVersion: this.simulationVersion,
      revision: file.revision!,
      eventCursor: file.eventCursor!,
      updatedAt: file.updatedAt,
      state: this.parseState(migrated.state),
      projection,
      // Command IDs belong to the immutable source simulation. The upgraded simulation starts a
      // new receipt namespace while preserving revision/event ordering and the untouched source.
      receipts: new Map(),
    });
    this.validateRecord?.(record);
    return record;
  }

  private async atomicWrite(path: string, body: string): Promise<void> {
    await durableWriteFile(path, body);
  }

  private serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const before = this.pending.get(key) ?? Promise.resolve();
    const current = before.catch(() => {}).then(operation);
    const marker = current.then(() => {}, () => {});
    this.pending.set(key, marker);
    void marker.finally(() => {
      if (this.pending.get(key) === marker) this.pending.delete(key);
    });
    return current;
  }
}

function serializeV2<S, P extends ProjectionBody>(
  record: AuthoritativeSlotRecord<S, P>,
): StoredSlotFileV2 {
  return {
    schemaVersion: 2,
    playerId: record.playerId,
    slotId: record.slotId,
    logicPackId: record.logicPackId,
    simulationVersion: record.simulationVersion,
    revision: record.revision,
    eventCursor: record.eventCursor,
    updatedAt: record.updatedAt,
    state: record.state,
    projection: record.projection,
    receipts: [...record.receipts].map(([commandId, receipt]) => ({
      commandId,
      canonicalEnvelope: receipt.canonicalEnvelope,
      resultSha256: DEFERRED_DIGESTS.get(receipt) ?? resultDigest(receipt.result),
    })),
  };
}

function deferredReceipts<S, P extends ProjectionBody>(path: string, value: unknown,
  record: AuthoritativeSlotRecord<S, P>, parseResult: (value: unknown) => ResultForBody<P>,
): ReadonlyMap<string, StoredReceipt<P>> {
  if (!isStoredSlotFileV2(value)) throw corrupt(record.slotId, "invalid deferred receipt layout");
  assertStoredFileKeys(value, record.slotId);
  if (!Array.isArray(value.receipts)) throw corrupt(record.slotId, "invalid receipt index");
  const receipts = new Map<string, StoredReceipt<P>>();
  for (const entry of value.receipts) {
    if (entry === null || typeof entry !== "object") throw corrupt(record.slotId, "invalid receipt reference");
    assertReceiptReferenceKeys(entry, record.slotId);
    const ref = entry as Partial<StoredReceiptReferenceV2>;
    if (typeof ref.commandId !== "string" || typeof ref.canonicalEnvelope !== "string" ||
      typeof ref.resultSha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.resultSha256) || receipts.has(ref.commandId))
      throw corrupt(record.slotId, "duplicate or invalid command receipt reference");
    const envelope = GameCommandEnvelopeV1Schema.parse(JSON.parse(ref.canonicalEnvelope));
    if (envelope.commandId !== ref.commandId) throw corrupt(record.slotId, "receipt envelope command id disagrees");
    const reference = ref as StoredReceiptReferenceV2;
    let pending: Promise<ResultForBody<P>> | undefined;
    const receipt: StoredReceipt<P> = Object.freeze({ canonicalEnvelope: reference.canonicalEnvelope,
      loadResult: () => {
        if (pending !== undefined) return pending;
        pending = (async () => {
          try {
            const expanded = await expandStoredFile(path, { ...value, receipts: [reference] }, record.slotId) as StoredSlotFileV1;
            const result = parseResult(expanded.receipts[0]!.result);
            if (result.commandId !== reference.commandId || result.revision > record.revision ||
              result.projection.slotId !== record.slotId || result.projection.revision !== result.revision ||
              result.projection.logicPackId !== record.logicPackId ||
              result.projection.simulationVersion !== record.simulationVersion)
              throw corrupt(record.slotId, "receipt does not belong to this slot generation");
            resultDigest(result);
            return result;
          } catch (error) {
            pending = undefined; // Repairs may be retried; do not cache a rejected read forever.
            if (error instanceof GameServiceError) throw error;
            throw new GameServiceError("STATE_CORRUPT", error instanceof Error ? error.message : "invalid receipt result");
          }
        })();
        return pending;
      },
    });
    DEFERRED_DIGESTS.set(receipt, reference.resultSha256);
    receipts.set(reference.commandId, receipt);
  }
  return receipts;
}

async function expandStoredFile(
  path: string,
  value: unknown,
  slotId: SaveSlotId,
): Promise<unknown> {
  if (!isStoredSlotFileV2(value)) return value;
  assertStoredFileKeys(value, slotId);
  if (!Array.isArray(value.receipts)) throw corrupt(slotId, "invalid envelope fields");
  const ids = new Set<string>();
  const receipts = await Promise.all(value.receipts.map(async (entry) => {
    if (entry === null || typeof entry !== "object") {
      throw corrupt(slotId, "invalid command receipt reference");
    }
    assertReceiptReferenceKeys(entry, slotId);
    const reference = entry as Partial<StoredReceiptReferenceV2>;
    if (
      typeof reference.commandId !== "string" ||
      typeof reference.canonicalEnvelope !== "string" ||
      typeof reference.resultSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(reference.resultSha256) ||
      ids.has(reference.commandId)
    ) {
      throw corrupt(slotId, "duplicate or invalid command receipt reference");
    }
    ids.add(reference.commandId);
    let sidecar: unknown;
    try {
      sidecar = JSON.parse(await readReceiptFile(receiptPathFor(path, reference.commandId)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw corrupt(slotId, `receipt ${reference.commandId} sidecar is missing`);
      }
      throw error;
    }
    if (sidecar === null || typeof sidecar !== "object") {
      throw corrupt(slotId, `receipt ${reference.commandId} sidecar is not an object`);
    }
    assertReceiptSidecarKeys(sidecar, slotId);
    const stored = sidecar as Partial<StoredReceiptSidecarV1>;
    if (stored.schemaVersion !== 1 || stored.commandId !== reference.commandId) {
      throw corrupt(slotId, `receipt ${reference.commandId} sidecar identity disagrees`);
    }
    if (resultDigest(stored.result) !== reference.resultSha256) {
      throw corrupt(slotId, `receipt ${reference.commandId} sidecar digest disagrees`);
    }
    return {
      commandId: reference.commandId,
      canonicalEnvelope: reference.canonicalEnvelope,
      result: stored.result,
    };
  }));
  return {
    ...value,
    schemaVersion: 1,
    receipts,
  } satisfies StoredSlotFileV1;
}

async function parseFile<S, P extends ProjectionBody>(
  value: unknown,
  playerId: string,
  slotId: SaveSlotId,
  parseState: (value: unknown) => S,
  parseProjection: (value: unknown) => ProjectionForBody<P>,
  parseCommandResult: (value: unknown) => ResultForBody<P>,
  validateRecord: ((record: AuthoritativeRecordValidationInput<S, P>) => void) | undefined,
): Promise<AuthoritativeSlotRecord<S, P>> {
  if (value === null || typeof value !== "object") throw corrupt(slotId, "root is not an object");
  assertStoredFileKeys(value, slotId);
  const file = value as Partial<StoredSlotFileV1>;
  if (
    file.schemaVersion !== 1 ||
    file.playerId !== playerId ||
    file.slotId !== slotId ||
    typeof file.logicPackId !== "string" ||
    typeof file.simulationVersion !== "string" ||
    !Number.isSafeInteger(file.revision) ||
    (file.revision ?? 0) < 1 ||
    !Number.isSafeInteger(file.eventCursor) ||
    (file.eventCursor ?? -1) < 0 ||
    typeof file.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(file.updatedAt)) ||
    !Array.isArray(file.receipts)
  ) {
    throw corrupt(slotId, "invalid envelope fields");
  }
  const projection = parseProjection(file.projection);
  if (
    projection.slotId !== slotId ||
    projection.revision !== file.revision ||
    projection.logicPackId !== file.logicPackId ||
    projection.simulationVersion !== file.simulationVersion
  ) {
    throw corrupt(slotId, "projection does not match its stored envelope");
  }
  LogicPackDescriptorV1Schema.shape.logicPackId.parse(file.logicPackId);
  const receipts = new Map();
  let receiptIndex = 0;
  for (const entry of file.receipts) {
    if (++receiptIndex % 32 === 0) await new Promise<void>(resolve => setImmediate(resolve));
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof (entry as { commandId?: unknown }).commandId !== "string" ||
      typeof (entry as { canonicalEnvelope?: unknown }).canonicalEnvelope !== "string"
    ) {
      throw corrupt(slotId, "invalid command receipt");
    }
    assertReceiptKeys(entry, slotId);
    const commandId = (entry as { commandId: string }).commandId;
    if (receipts.has(commandId)) throw corrupt(slotId, `duplicate receipt ${commandId}`);
    let envelope: ReturnType<typeof GameCommandEnvelopeV1Schema.parse>;
    try {
      envelope = GameCommandEnvelopeV1Schema.parse(
        JSON.parse((entry as { canonicalEnvelope: string }).canonicalEnvelope),
      );
    } catch (error) {
      throw corrupt(
        slotId,
        error instanceof Error ? `invalid command receipt envelope: ${error.message}` : "invalid command receipt envelope",
      );
    }
    if (envelope.commandId !== commandId) {
      throw corrupt(slotId, `receipt ${commandId} envelope command id disagrees`);
    }
    const result = parseCommandResult((entry as { result?: unknown }).result);
    if (
      result.commandId !== commandId ||
      result.revision > file.revision! ||
      result.projection.slotId !== slotId ||
      result.projection.revision !== result.revision ||
      result.projection.logicPackId !== file.logicPackId ||
      result.projection.simulationVersion !== file.simulationVersion
    ) {
      throw corrupt(slotId, `receipt ${commandId} does not belong to this slot generation`);
    }
    resultDigest(result);
    receipts.set(commandId, {
      canonicalEnvelope: (entry as { canonicalEnvelope: string }).canonicalEnvelope,
      result,
    });
  }
  const record = Object.freeze({
    playerId,
    slotId,
    logicPackId: file.logicPackId,
    simulationVersion: file.simulationVersion,
    revision: file.revision,
    eventCursor: file.eventCursor,
    updatedAt: file.updatedAt,
    state: parseState(file.state),
    projection,
    receipts,
  }) as AuthoritativeSlotRecord<S, P>;
  validateRecord?.(record);
  return record;
}

function validatePlayerId(playerId: string): void {
  if (!/^[a-f0-9]{64}$/.test(playerId)) {
    throw new Error("authoritative player ID must be a 64-character lowercase hex digest");
  }
}

function validateSlotId(slotId: unknown): asserts slotId is SaveSlotId {
  if (!(SAVE_SLOT_IDS as readonly string[]).includes(slotId as string)) {
    throw new Error(`invalid authoritative slot ID ${String(slotId)}`);
  }
}

function assertStoredFileKeys(value: object, slotId: SaveSlotId): void {
  exactKeys(
    value,
    [
      "schemaVersion", "playerId", "slotId", "logicPackId", "simulationVersion", "revision",
      "eventCursor", "updatedAt", "state", "projection", "receipts",
    ],
    slotId, "unknown file envelope field",
  );
}

function assertReceiptKeys(value: object, slotId: SaveSlotId): void {
  exactKeys(
    value,
    ["commandId", "canonicalEnvelope", "result"],
    slotId, "unknown command receipt field",
  );
}

function assertReceiptReferenceKeys(value: object, slotId: SaveSlotId): void {
  exactKeys(
    value,
    ["commandId", "canonicalEnvelope", "resultSha256"],
    slotId, "unknown command receipt reference field",
  );
}

function assertReceiptSidecarKeys(value: object, slotId: SaveSlotId): void {
  exactKeys(
    value,
    ["schemaVersion", "commandId", "result"],
    slotId, "unknown command receipt sidecar field",
  );
}

// Valid long-lived slots have thousands of receipts. Build the corruption error only
// when validation fails, rather than capturing three unused Error stacks per receipt.
function exactKeys(value: object, allowed: readonly string[], slotId: SaveSlotId, detail: string): void {
  if (Object.getPrototypeOf(value) !== Object.prototype) throw corrupt(slotId, detail);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw corrupt(slotId, detail);
  }
}

function slotKey(playerId: string, slotId: SaveSlotId): string {
  return `${playerId}\0${slotId}`;
}

function isStoredSlotFileV2(value: unknown): value is StoredSlotFileV2 {
  return value !== null && typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion === 2;
}

function receiptDirectoryFor(slotPath: string): string {
  return `${slotPath.slice(0, -".json".length)}.receipts`;
}

function receiptPathFor(slotPath: string, commandId: string): string {
  const file = createHash("sha256").update(commandId).digest("hex");
  return join(receiptDirectoryFor(slotPath), `${file}.receipt`);
}

function resultDigest(value: unknown): string {
  if (value !== null && typeof value === "object") {
    const cached = RESULT_DIGESTS.get(value);
    if (cached !== undefined) return cached;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("command receipt result is not JSON-serializable");
  const digest = createHash("sha256").update(serialized).digest("hex");
  if (value !== null && typeof value === "object") RESULT_DIGESTS.set(value, digest);
  return digest;
}

async function fingerprint(path: string): Promise<FileFingerprint> {
  const info = await stat(path, { bigint: true });
  return { size: info.size, modifiedNs: info.mtimeNs };
}

async function optionalFingerprint(path: string): Promise<FileFingerprint | undefined> {
  try {
    return await fingerprint(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function sameFingerprint(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.size === right.size && left.modifiedNs === right.modifiedNs;
}

function corrupt(slotId: SaveSlotId, detail: string): Error {
  return new Error(`corrupt authoritative slot ${slotId}: ${detail}`);
}

function namespaceSegment(label: string, value: string): string {
  if (value.length === 0) throw new Error(`${label} storage identity must not be empty`);
  const readable = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  return `${label}-${readable.length === 0 ? "value" : readable}-${digest}`;
}
