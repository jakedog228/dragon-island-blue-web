import {
  CurrentGameCommandV1Schema,
  GAME_PROTOCOL_VERSION,
  GameCommandEnvelopeV1Schema,
  GameCommandResultV1Schema,
  OfficialGameCommandResultV12Schema,
  OfficialGameCommandResultV13Schema,
  OfficialGameCommandResultV14Schema,
  OfficialGameCommandResultV15Schema,
  OfficialGameCommandResultV16Schema,
  OfficialGameCommandResultV17Schema,
  OfficialGameCommandResultV18Schema,
  OfficialGameCommandResultV19Schema,
  OfficialGameCommandResultV20Schema,
  OfficialGameCommandResultV21Schema,
  OfficialGameCommandResultV22Schema,
  OfficialGameCommandResultV23Schema,
  OfficialGameCommandResultV24Schema,
  OfficialGameCommandResultV25Schema,
  OfficialGameProjectionV12Schema,
  OfficialGameProjectionV13Schema,
  OfficialGameProjectionV14Schema,
  OfficialGameProjectionV15Schema,
  OfficialGameProjectionV16Schema,
  OfficialGameProjectionV17Schema,
  OfficialGameProjectionV18Schema,
  OfficialGameProjectionV19Schema,
  OfficialGameProjectionV20Schema,
  OfficialGameProjectionV21Schema,
  OfficialGameProjectionV22Schema,
  OfficialGameProjectionV23Schema,
  OfficialGameProjectionV24Schema,
  OfficialGameProjectionV25Schema,
  OFFICIAL_GAME_V12_SIMULATION_VERSION,
  LogicPackDescriptorV1Schema,
  SlotProjectionV1Schema,
  type AuthoritativeSlotSummaryV1,
  type GameCommandEnvelopeV1,
  type GameCommandResultV1,
  type GameErrorCodeV1,
  type LogicPackDescriptorV1,
  OFFICIAL_GAME_V13_SIMULATION_VERSION,
  OFFICIAL_GAME_V14_SIMULATION_VERSION,
  OFFICIAL_GAME_V15_SIMULATION_VERSION,
  OFFICIAL_GAME_V16_SIMULATION_VERSION,
  OFFICIAL_GAME_V17_SIMULATION_VERSION,
  OFFICIAL_GAME_V18_SIMULATION_VERSION,
  OFFICIAL_GAME_V19_SIMULATION_VERSION,
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
  OFFICIAL_GAME_V21_SIMULATION_VERSION,
  OFFICIAL_GAME_V22_SIMULATION_VERSION,
  OFFICIAL_GAME_V23_SIMULATION_VERSION,
  OFFICIAL_GAME_V24_SIMULATION_VERSION,
  OFFICIAL_GAME_V25_SIMULATION_VERSION,
  type OfficialGameCommandResultV12,
  type OfficialGameCommandResultV13,
  type OfficialGameCommandResultV14,
  type OfficialGameCommandResultV15,
  type OfficialGameCommandResultV16,
  type OfficialGameCommandResultV17,
  type OfficialGameCommandResultV18,
  type OfficialGameCommandResultV19,
  type OfficialGameCommandResultV20,
  type OfficialGameCommandResultV21,
  type OfficialGameCommandResultV22,
  type OfficialGameCommandResultV23,
  type OfficialGameCommandResultV24,
  type OfficialGameCommandResultV25,
  type OfficialGameProjectionBodyV12,
  type OfficialGameProjectionBodyV13,
  type OfficialGameProjectionBodyV14,
  type OfficialGameProjectionBodyV15,
  type OfficialGameProjectionBodyV16,
  type OfficialGameProjectionBodyV17,
  type OfficialGameProjectionBodyV18,
  type OfficialGameProjectionBodyV19,
  type OfficialGameProjectionBodyV20,
  type OfficialGameProjectionBodyV21,
  type OfficialGameProjectionBodyV22,
  type OfficialGameProjectionBodyV23,
  type OfficialGameProjectionBodyV24,
  type OfficialGameProjectionBodyV25,
  type OfficialGameProjectionV12,
  type OfficialGameProjectionV13,
  type OfficialGameProjectionV14,
  type OfficialGameProjectionV15,
  type OfficialGameProjectionV16,
  type OfficialGameProjectionV17,
  type OfficialGameProjectionV18,
  type OfficialGameProjectionV19,
  type OfficialGameProjectionV20,
  type OfficialGameProjectionV21,
  type OfficialGameProjectionV22,
  type OfficialGameProjectionV23,
  type OfficialGameProjectionV24,
  type OfficialGameProjectionV25,
  type SlotProjectionV1,
  type UnsequencedPresentationEventV1,
} from "@dib/game-protocol";
import type { SaveSlotId } from "@dib/save-protocol";

export type ProjectionBodyV1 = Omit<
  SlotProjectionV1,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;
export type ProjectionBody =
  | ProjectionBodyV1
  | OfficialGameProjectionBodyV12
  | OfficialGameProjectionBodyV13
  | OfficialGameProjectionBodyV14
  | OfficialGameProjectionBodyV15
  | OfficialGameProjectionBodyV16
  | OfficialGameProjectionBodyV17
  | OfficialGameProjectionBodyV18
  | OfficialGameProjectionBodyV19
  | OfficialGameProjectionBodyV20
  | OfficialGameProjectionBodyV21
  | OfficialGameProjectionBodyV22
  | OfficialGameProjectionBodyV23
  | OfficialGameProjectionBodyV24
  | OfficialGameProjectionBodyV25;
// v13+ bodies share their core shape; their envelope version is added only after reduction. Keep
// their correlated wire as a union while selecting the exact parser from the installed pack.
export type ProjectionForBody<P extends ProjectionBody> = P extends OfficialGameProjectionBodyV13
  ? P extends OfficialGameProjectionBodyV25
    ? OfficialGameProjectionV25
    : P extends OfficialGameProjectionBodyV24
    ? OfficialGameProjectionV24
    : P extends OfficialGameProjectionBodyV23
    ? OfficialGameProjectionV23
    : P extends OfficialGameProjectionBodyV22
    ? OfficialGameProjectionV22
    : P extends OfficialGameProjectionBodyV21
    ? OfficialGameProjectionV21
    : P extends OfficialGameProjectionBodyV20
      ? OfficialGameProjectionV20
    : P extends OfficialGameProjectionBodyV19
      ? OfficialGameProjectionV19
      : OfficialGameProjectionV13 | OfficialGameProjectionV14 | OfficialGameProjectionV15 | OfficialGameProjectionV16 | OfficialGameProjectionV17 | OfficialGameProjectionV18
  : P extends OfficialGameProjectionBodyV12
    ? OfficialGameProjectionV12
    : SlotProjectionV1;
export type CommandResultForBody<P extends ProjectionBody> = P extends OfficialGameProjectionBodyV13
  ? P extends OfficialGameProjectionBodyV25
    ? OfficialGameCommandResultV25
    : P extends OfficialGameProjectionBodyV24
    ? OfficialGameCommandResultV24
    : P extends OfficialGameProjectionBodyV23
    ? OfficialGameCommandResultV23
    : P extends OfficialGameProjectionBodyV22
    ? OfficialGameCommandResultV22
    : P extends OfficialGameProjectionBodyV21
    ? OfficialGameCommandResultV21
    : P extends OfficialGameProjectionBodyV20
      ? OfficialGameCommandResultV20
    : P extends OfficialGameProjectionBodyV19
      ? OfficialGameCommandResultV19
      : OfficialGameCommandResultV13 | OfficialGameCommandResultV14 | OfficialGameCommandResultV15 | OfficialGameCommandResultV16 | OfficialGameCommandResultV17 | OfficialGameCommandResultV18
  : P extends OfficialGameProjectionBodyV12
    ? OfficialGameCommandResultV12
    : GameCommandResultV1;

export class GameServiceError extends Error {
  constructor(
    readonly code: GameErrorCodeV1,
    message: string,
    readonly options: { retryable?: boolean; currentRevision?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GameServiceError";
  }
}

/**
 * An unexpected exception raised while reducing a command. The reducer is pure and storage is
 * replaced only after it (and the post-reduction projection/receipt validation) succeeds, so the
 * command is certainly NOT committed and replaying the same envelope deterministically fails again.
 * It is therefore reported non-retryable: a retryable error tells the browser coordinator the
 * outcome is uncertain, and it then retains and replays that envelope before every later intent,
 * which turned one reducer defect into a permanently wedged slot (audit M7 / C1). Transport and
 * persistence failures are outside this boundary and keep the generic retryable mapping.
 */
export class ReducerFaultError extends GameServiceError {
  constructor(cause: unknown) {
    super("INTERNAL", "the authoritative reducer rejected this command before committing it", {
      retryable: false,
      cause,
    });
    this.name = "ReducerFaultError";
  }
}

export interface CommandReducerContext<S> {
  readonly playerId: string;
  readonly slotId: SaveSlotId;
  readonly pack: LogicPackDescriptorV1;
  readonly state: S | undefined;
  readonly previousRevision: number;
  readonly now: string;
}

export interface CommandReducerResult<S, P extends ProjectionBody = ProjectionBodyV1> {
  readonly state: S;
  readonly projection: P;
  readonly events: readonly UnsequencedPresentationEventV1[];
}

/**
 * Pure application boundary. A reducer receives only trusted installed-pack metadata, the locked
 * prior aggregate, server time, and a validated intent. It returns a replacement aggregate; it
 * cannot partially commit because storage is updated only after the reducer resolves successfully.
 */
export interface GameCommandReducer<S, P extends ProjectionBody = ProjectionBodyV1> {
  apply(
    context: CommandReducerContext<S>,
    command: GameCommandEnvelopeV1["command"],
  ): Promise<CommandReducerResult<S, P>> | CommandReducerResult<S, P>;
}

interface StoredReceipt<P extends ProjectionBody = ProjectionBodyV1> {
  readonly canonicalEnvelope: string;
  readonly result: CommandResultForBody<P>;
}

export interface AuthoritativeSlotRecord<S, P extends ProjectionBody = ProjectionBodyV1> {
  readonly playerId: string;
  readonly slotId: SaveSlotId;
  readonly logicPackId: string;
  readonly simulationVersion: string;
  readonly revision: number;
  readonly eventCursor: number;
  readonly updatedAt: string;
  readonly state: S;
  readonly projection: ProjectionForBody<P>;
  readonly receipts: ReadonlyMap<string, StoredReceipt<P>>;
}

export type AuthoritativeRecordValidationInput<
  S,
  P extends ProjectionBody = ProjectionBodyV1,
> = Pick<
  AuthoritativeSlotRecord<S, P>,
  "state" | "projection"
>;

export interface AuthoritativeSlotStore<S, P extends ProjectionBody = ProjectionBodyV1> {
  /**
   * Records are immutable identity values. A store may return the same object repeatedly, but it
   * must never mutate a returned record or its receipt map: the service caches the successful
   * validation of that immutable receipt history by object identity.
   */
  transact<T>(
    playerId: string,
    slotId: SaveSlotId,
    operation: (
      current: AuthoritativeSlotRecord<S, P> | undefined,
    ) => Promise<{ readonly record: AuthoritativeSlotRecord<S, P> | undefined; readonly value: T }>,
  ): Promise<T>;
  read(playerId: string, slotId: SaveSlotId): Promise<AuthoritativeSlotRecord<S, P> | undefined>;
  list(playerId: string): Promise<readonly AuthoritativeSlotRecord<S, P>[]>;
}

export class InMemoryAuthoritativeSlotStore<
  S,
  P extends ProjectionBody = ProjectionBodyV1,
> implements AuthoritativeSlotStore<S, P> {
  private readonly records = new Map<string, AuthoritativeSlotRecord<S, P>>();
  private readonly pending = new Map<string, Promise<void>>();

  async transact<T>(
    playerId: string,
    slotId: SaveSlotId,
    operation: (
      current: AuthoritativeSlotRecord<S, P> | undefined,
    ) => Promise<{ readonly record: AuthoritativeSlotRecord<S, P> | undefined; readonly value: T }>,
  ): Promise<T> {
    const key = slotKey(playerId, slotId);
    const predecessor = this.pending.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = predecessor.then(() => gate);
    this.pending.set(key, tail);
    await predecessor;
    try {
      const committed = await operation(this.records.get(key));
      if (committed.record === undefined) this.records.delete(key);
      else this.records.set(key, committed.record);
      return committed.value;
    } finally {
      release();
      if (this.pending.get(key) === tail) this.pending.delete(key);
    }
  }

  async read(playerId: string, slotId: SaveSlotId): Promise<AuthoritativeSlotRecord<S, P> | undefined> {
    const key = slotKey(playerId, slotId);
    await (this.pending.get(key) ?? Promise.resolve());
    return this.records.get(key);
  }

  async list(playerId: string): Promise<readonly AuthoritativeSlotRecord<S, P>[]> {
    await Promise.all(this.pending.values());
    return [...this.records.values()]
      .filter((record) => record.playerId === playerId)
      .sort((left, right) => left.slotId.localeCompare(right.slotId));
  }
}

export interface AuthoritativeGameServiceOptions<S, P extends ProjectionBody = ProjectionBodyV1> {
  readonly pack: LogicPackDescriptorV1;
  readonly reducer: GameCommandReducer<S, P>;
  readonly store?: AuthoritativeSlotStore<S, P>;
  readonly now?: () => number;
  /** Monotonic diagnostic clock. Its values never enter authoritative state or wire results. */
  readonly timingNow?: () => number;
  /** Fail-closed semantic validation for the installed authoritative aggregate. */
  readonly validateRecord?: (record: AuthoritativeRecordValidationInput<S, P>) => void;
}

export interface CommandExecutionTiming {
  readonly queueAndReadMs: number;
  readonly validationMs: number;
  readonly reductionMs: number;
  readonly finalizeMs: number;
  readonly persistenceMs: number;
  readonly totalMs: number;
  readonly idempotentReplay: boolean;
}

export interface TimedCommandResult<P extends ProjectionBody = ProjectionBodyV1> {
  readonly result: CommandResultForBody<P>;
  readonly timing: CommandExecutionTiming;
}

export class AuthoritativeGameService<S, P extends ProjectionBody = ProjectionBodyV1> {
  readonly pack: LogicPackDescriptorV1;
  private readonly reducer: GameCommandReducer<S, P>;
  private readonly store: AuthoritativeSlotStore<S, P>;
  private readonly now: () => number;
  private readonly timingNow: () => number;
  private readonly validateRecord:
    ((record: AuthoritativeRecordValidationInput<S, P>) => void) | undefined;
  /** Receipt histories grow monotonically. Validate an externally loaded identity once, then mark
   * each service-created successor after its already-validated receipt is appended. */
  private readonly validatedReceiptHistories = new WeakSet<object>();

  constructor(options: AuthoritativeGameServiceOptions<S, P>) {
    // Descriptor admission is part of the service boundary. In particular, the v11 historical
    // command exception may only use a descriptor that already passed the version-correlated
    // broad parser; never trust a raw version string and raw capability list together.
    const pack = parseInstalledLogicPackDescriptor(options.pack);
    if (
      pack.simulationVersion !== "official-game-v11" &&
      pack.simulationVersion !== OFFICIAL_GAME_V12_SIMULATION_VERSION &&
      pack.simulationVersion !== OFFICIAL_GAME_V13_SIMULATION_VERSION &&
      pack.simulationVersion !== OFFICIAL_GAME_V14_SIMULATION_VERSION &&
      pack.simulationVersion !== OFFICIAL_GAME_V15_SIMULATION_VERSION &&
      pack.simulationVersion !== OFFICIAL_GAME_V16_SIMULATION_VERSION &&
      pack.simulationVersion !== OFFICIAL_GAME_V17_SIMULATION_VERSION &&
      pack.simulationVersion !== OFFICIAL_GAME_V18_SIMULATION_VERSION
      && pack.simulationVersion !== OFFICIAL_GAME_V19_SIMULATION_VERSION
      && pack.simulationVersion !== OFFICIAL_GAME_V20_SIMULATION_VERSION
      && pack.simulationVersion !== OFFICIAL_GAME_V21_SIMULATION_VERSION
      && pack.simulationVersion !== OFFICIAL_GAME_V22_SIMULATION_VERSION
      && pack.simulationVersion !== OFFICIAL_GAME_V23_SIMULATION_VERSION
      && pack.simulationVersion !== OFFICIAL_GAME_V24_SIMULATION_VERSION
      && pack.simulationVersion !== OFFICIAL_GAME_V25_SIMULATION_VERSION
    ) {
      throw new GameServiceError(
        "PACK_UNAVAILABLE",
        `unsupported official simulation version ${pack.simulationVersion}`,
      );
    }
    this.pack = pack;
    this.reducer = options.reducer;
    this.store = options.store ?? new InMemoryAuthoritativeSlotStore<S, P>();
    this.now = options.now ?? Date.now;
    this.timingNow = options.timingNow ?? monotonicNow;
    this.validateRecord = options.validateRecord;
  }

  async execute(
    playerId: string,
    slotId: SaveSlotId,
    envelope: GameCommandEnvelopeV1,
  ): Promise<CommandResultForBody<P>> {
    return (await this.executeWithTiming(playerId, slotId, envelope)).result;
  }

  async executeWithTiming(
    playerId: string,
    slotId: SaveSlotId,
    envelope: GameCommandEnvelopeV1,
  ): Promise<TimedCommandResult<P>> {
    const startedAt = this.timingNow();
    let enteredTransactionAt = startedAt;
    let validationFinishedAt = startedAt;
    let reductionFinishedAt = startedAt;
    let transactionFinishedAt = startedAt;
    let idempotentReplay = false;
    const canonicalEnvelope = canonicalJson(envelope);
    const result = await this.store.transact(playerId, slotId, async (current) => {
      enteredTransactionAt = this.timingNow();
      this.validatePack(current);
      if (current !== undefined) this.validateStoredRecord(current);
      const priorReceipt = current?.receipts.get(envelope.commandId);
      if (priorReceipt !== undefined) {
        if (current === undefined) {
          throw new GameServiceError("STATE_CORRUPT", "a command receipt exists without its slot");
        }
        if (priorReceipt.canonicalEnvelope !== canonicalEnvelope) {
          throw new GameServiceError(
            "COMMAND_DUPLICATE_MISMATCH",
            `command ${envelope.commandId} was already used with a different body`,
            { currentRevision: current.revision },
          );
        }
        validationFinishedAt = this.timingNow();
        const replay = this.parseCommandResult(priorReceipt.result);
        reductionFinishedAt = validationFinishedAt;
        transactionFinishedAt = this.timingNow();
        idempotentReplay = true;
        return {
          record: current,
          value: { ...replay, idempotentReplay: true },
        };
      }

      const command = this.validateCapability(envelope.command);
      this.validateRevision(current, envelope);
      this.validateDecision(current, envelope);
      validationFinishedAt = this.timingNow();

      const now = new Date(this.now()).toISOString();
      const previousRevision = current?.revision ?? 0;
      const revision = previousRevision + 1;
      const previousCursor = current?.eventCursor ?? 0;
      // Everything from reduction through receipt construction is pure and precedes the store
      // write, so an unexpected exception here is a certain non-commit (see ReducerFaultError).
      // Typed domain rejections keep their own code and retryability.
      let reduced: CommandReducerResult<S, P>;
      let events: GameCommandResultV1["events"];
      let projection: ProjectionForBody<P>;
      let result: CommandResultForBody<P>;
      try {
        reduced = await this.reducer.apply({
          playerId,
          slotId,
          pack: this.pack,
          state: current?.state,
          previousRevision,
          now,
        }, command);
        reductionFinishedAt = this.timingNow();
        events = reduced.events.map((event, index) => ({
          ...event,
          seq: previousCursor + index + 1,
        })) as GameCommandResultV1["events"];
        const eventCursorStart = events.length === 0 ? previousCursor : previousCursor + 1;
        const eventCursorEnd = previousCursor + events.length;
        projection = this.parseProjection({
          slotId,
          revision,
          updatedAt: now,
          logicPackId: this.pack.logicPackId,
          simulationVersion: this.pack.simulationVersion,
          trustTier: "official",
          ...reduced.projection,
        });
        this.validatePersistedRecord({ state: reduced.state, projection });
        result = this.parseCommandResult({
          protocolVersion: GAME_PROTOCOL_VERSION,
          commandId: envelope.commandId,
          previousRevision,
          revision,
          eventCursorStart,
          eventCursorEnd,
          events,
          projection,
          idempotentReplay: false,
        });
      } catch (error) {
        if (error instanceof GameServiceError) throw error;
        throw new ReducerFaultError(error);
      }
      const eventCursorEnd = previousCursor + events.length;
      const receipts = new Map<string, StoredReceipt<P>>(current?.receipts ?? []);
      receipts.set(envelope.commandId, { canonicalEnvelope, result });
      const record: AuthoritativeSlotRecord<S, P> = Object.freeze({
        playerId,
        slotId,
        logicPackId: this.pack.logicPackId,
        simulationVersion: this.pack.simulationVersion,
        revision,
        eventCursor: eventCursorEnd,
        updatedAt: now,
        state: reduced.state,
        projection,
        receipts,
      });
      // `current` was validated above and `result` passed the installed generation's strict parser.
      // Mark this immutable successor now so command N+1 does not rescan N historical receipts.
      this.validatedReceiptHistories.add(record);
      transactionFinishedAt = this.timingNow();
      return { record, value: result };
    });
    const finishedAt = this.timingNow();
    return {
      result,
      timing: {
        queueAndReadMs: nonnegativeDuration(startedAt, enteredTransactionAt),
        validationMs: nonnegativeDuration(enteredTransactionAt, validationFinishedAt),
        reductionMs: nonnegativeDuration(validationFinishedAt, reductionFinishedAt),
        finalizeMs: nonnegativeDuration(reductionFinishedAt, transactionFinishedAt),
        persistenceMs: nonnegativeDuration(transactionFinishedAt, finishedAt),
        totalMs: nonnegativeDuration(startedAt, finishedAt),
        idempotentReplay,
      },
    };
  }

  async bootstrap(
    playerId: string,
    slotId: SaveSlotId,
  ): Promise<ProjectionForBody<P>> {
    const record = await this.store.read(playerId, slotId);
    if (record === undefined) throw new GameServiceError("SLOT_NOT_FOUND", `${slotId} does not exist`);
    this.validatePack(record);
    this.validateStoredRecord(record);
    return this.parseProjection(record.projection);
  }

  async listSlots(playerId: string): Promise<readonly AuthoritativeSlotSummaryV1[]> {
    return (await this.store.list(playerId)).map((record) => {
      this.validatePack(record);
      this.validateStoredRecord(record);
      return {
        slotId: record.slotId,
        revision: record.revision,
        updatedAt: record.updatedAt,
        logicPackId: record.logicPackId,
        simulationVersion: record.simulationVersion,
        trustTier: "official",
        activeDomain: activeDomainOf(record.projection),
      };
    });
  }

  async deleteSlot(playerId: string, slotId: SaveSlotId, expectedRevision: number): Promise<void> {
    await this.store.transact(playerId, slotId, async (current) => {
      if (current === undefined) throw new GameServiceError("SLOT_NOT_FOUND", `${slotId} does not exist`);
      if (current.revision !== expectedRevision) {
        throw new GameServiceError(
          "REVISION_CONFLICT",
          `expected revision ${expectedRevision}, found ${current.revision}`,
          { currentRevision: current.revision },
        );
      }
      return { record: undefined, value: undefined };
    });
  }

  private validatePack(current: AuthoritativeSlotRecord<S, P> | undefined): void {
    if (current === undefined) return;
    if (current.logicPackId !== this.pack.logicPackId) {
      throw new GameServiceError("PACK_UNAVAILABLE", "slot is pinned to a different logic pack");
    }
    if (current.simulationVersion !== this.pack.simulationVersion) {
      throw new GameServiceError(
        "SIMULATION_VERSION_UNAVAILABLE",
        "slot simulation version is not installed",
      );
    }
  }

  private validateStoredRecord(record: AuthoritativeSlotRecord<S, P>): void {
    try {
      const projection = this.parseProjection(record.projection);
      if (
        projection.logicPackId !== this.pack.logicPackId ||
        projection.simulationVersion !== this.pack.simulationVersion
      ) {
        throw new Error("persisted projection is pinned to a different installed simulation");
      }
      // File storage validates sidecars while loading, but AuthoritativeSlotStore is also the
      // boundary implemented by future database adapters and test stores. Validate every receipt
      // once for each externally supplied immutable record identity; service-created successors
      // are marked at construction after their one new result has passed the same parser.
      if (!this.validatedReceiptHistories.has(record)) {
        for (const [commandId, receipt] of record.receipts) {
          const envelope = GameCommandEnvelopeV1Schema.parse(JSON.parse(receipt.canonicalEnvelope));
          if (
            envelope.commandId !== commandId ||
            canonicalJson(envelope) !== receipt.canonicalEnvelope
          ) {
            throw new Error(`persisted receipt ${commandId} has a mismatched canonical envelope`);
          }
          const result = this.parseCommandResult(receipt.result);
          if (result.commandId !== commandId) {
            throw new Error(`persisted receipt ${commandId} contains result ${result.commandId}`);
          }
          if (
            result.projection.logicPackId !== this.pack.logicPackId ||
            result.projection.simulationVersion !== this.pack.simulationVersion
          ) {
            throw new Error("persisted receipt is pinned to a different installed simulation");
          }
        }
        this.validatedReceiptHistories.add(record);
      }
      this.validatePersistedRecord({ state: record.state, projection });
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "authoritative wire cannot be validated",
      );
    }
  }

  private validatePersistedRecord(record: AuthoritativeRecordValidationInput<S, P>): void {
    if (this.validateRecord === undefined) return;
    try {
      this.validateRecord(record);
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "authoritative state cannot be validated",
      );
    }
  }

  private parseProjection(value: unknown): ProjectionForBody<P> {
    try {
      if (this.pack.simulationVersion === OFFICIAL_GAME_V23_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV23Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V24_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV24Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V25_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV25Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V22_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV22Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V21_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV21Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V20_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV20Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V19_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV19Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V18_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV18Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V17_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV17Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V16_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV16Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V15_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV15Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V14_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV14Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V13_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV13Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V12_SIMULATION_VERSION) {
        const parsed = OfficialGameProjectionV12Schema.parse(value);
        return parsed as ProjectionForBody<P>;
      }
      const parsed = SlotProjectionV1Schema.parse(value);
      return parsed as ProjectionForBody<P>;
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "authoritative projection is invalid",
      );
    }
  }

  private parseCommandResult(value: unknown): CommandResultForBody<P> {
    try {
      if (this.pack.simulationVersion === OFFICIAL_GAME_V23_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV23Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V24_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV24Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V25_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV25Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V22_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV22Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V21_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV21Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V20_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV20Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V19_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV19Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V18_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV18Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V17_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV17Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V16_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV16Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V15_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV15Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V14_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV14Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V13_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV13Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      if (this.pack.simulationVersion === OFFICIAL_GAME_V12_SIMULATION_VERSION) {
        const parsed = OfficialGameCommandResultV12Schema.parse(value);
        return parsed as CommandResultForBody<P>;
      }
      const parsed = GameCommandResultV1Schema.parse(value);
      return parsed as CommandResultForBody<P>;
    } catch (error) {
      if (error instanceof GameServiceError) throw error;
      throw new GameServiceError(
        "STATE_CORRUPT",
        error instanceof Error ? error.message : "authoritative command result is invalid",
      );
    }
  }

  private validateRevision(
    current: AuthoritativeSlotRecord<S, P> | undefined,
    envelope: GameCommandEnvelopeV1,
  ): void {
    const actual = current?.revision ?? 0;
    if (envelope.expectedRevision !== actual) {
      throw new GameServiceError(
        "REVISION_CONFLICT",
        `expected revision ${envelope.expectedRevision}, found ${actual}`,
        { currentRevision: actual },
      );
    }
    if (current === undefined && envelope.command.type !== "slot.create") {
      throw new GameServiceError("SLOT_NOT_FOUND", "slot must be created before gameplay commands");
    }
    if (current !== undefined && envelope.command.type === "slot.create") {
      throw new GameServiceError("SLOT_NOT_EMPTY", "slot already exists", { currentRevision: actual });
    }
  }

  private validateDecision(
    current: AuthoritativeSlotRecord<S, P> | undefined,
    envelope: GameCommandEnvelopeV1,
  ): void {
    const decision = current?.projection.decision;
    const currentDecisionId = decision !== undefined && decision.type !== "none"
      ? decision.decisionId
      : undefined;
    if (
      envelope.expectedDecisionId !== undefined &&
      envelope.expectedDecisionId !== currentDecisionId
    ) {
      throw new GameServiceError(
        "DECISION_STALE",
        `expected decision ${envelope.expectedDecisionId}, found ${currentDecisionId ?? "none"}`,
        current === undefined ? {} : { currentRevision: current.revision },
      );
    }
    if (
      currentDecisionId !== undefined &&
      envelope.command.type !== "slot.create" &&
      envelope.expectedDecisionId === undefined
    ) {
      throw new GameServiceError(
        "DECISION_STALE",
        "this command must name the current server decision",
        current === undefined ? {} : { currentRevision: current.revision },
      );
    }
  }

  private validateCapability(command: GameCommandEnvelopeV1["command"]): GameCommandEnvelopeV1["command"] {
    // The installed v11 service remains able to admit its historical settlement handshake. Every
    // other pack must pass the strict current command parser before descriptor membership is
    // checked, so a historical-only live submission cannot reach the reducer.
    const admitted = this.pack.simulationVersion === "official-game-v11"
      ? this.pack.capabilities.commandTypes.some((type) => type === command.type)
      : (() => {
          const parsed = CurrentGameCommandV1Schema.safeParse(command);
          return parsed.success && this.pack.capabilities.commandTypes.some(
            (type) => type === parsed.data.type,
          );
        })();
    if (!admitted) {
      throw new GameServiceError(
        "CAPABILITY_UNSUPPORTED",
        `${command.type} is not authoritative in ${this.pack.logicPackId}`,
      );
    }
    return command;
  }
}

/**
 * Zod intentionally returns a fresh enumerable object. Operator-local authorities may also bind
 * a descriptor to an in-memory proof with a non-enumerable symbol property. Preserve those opaque
 * symbols on the canonical descriptor passed to the reducer, while keeping the wire descriptor
 * strict and ensuring no metadata can enter JSON, receipts, projections, or persistence.
 */
function parseInstalledLogicPackDescriptor(value: LogicPackDescriptorV1): LogicPackDescriptorV1 {
  const parsed = LogicPackDescriptorV1Schema.parse(value);
  const capabilities = Object.freeze({
    ...parsed.capabilities,
    commandTypes: Object.freeze([...parsed.capabilities.commandTypes]),
  });
  const canonical = { ...parsed, capabilities } as LogicPackDescriptorV1;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "symbol") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable) continue;
    Object.defineProperty(canonical, key, {
      value: descriptor.value,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return Object.freeze(canonical);
}

function activeDomainOf(
  projection: Pick<SlotProjectionV1 | OfficialGameProjectionV12, "location">,
): AuthoritativeSlotSummaryV1["activeDomain"] {
  switch (projection.location.kind) {
    case "world": return "world";
    case "town": return "town";
    case "battle": return "battle";
    case "dungeon": return "dungeon";
    case "none": return "none";
  }
}

function slotKey(playerId: string, slotId: SaveSlotId): string {
  return `${playerId}\0${slotId}`;
}

function canonicalJson(value: GameCommandEnvelopeV1): string {
  return JSON.stringify(sortJson(value));
}

function monotonicNow(): number {
  const clock = (globalThis as { performance?: { now(): number } }).performance;
  return clock?.now() ?? Date.now();
}

function nonnegativeDuration(start: number, end: number): number {
  return Math.max(0, end - start);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}
