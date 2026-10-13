import {
  GAME_PROTOCOL_VERSION,
  type GameCommandEnvelopeV1,
  type GameCommandResultV1,
  type GameCommandV1,
  type SlotProjectionV1,
} from "@dib/game-protocol";
import type { SaveSlotId } from "@dib/save-protocol";
import type { GameAuthority } from "./gameAuthorityClient.js";
import { RemoteGameAuthorityError } from "./gameAuthorityClient.js";
import type { InstalledCommandResult, InstalledSlotProjection } from "./gameAuthorityClient.js";
import { BattleChatHistory } from "./battleChatHistory.js";

export interface CommandCoordinatorHooks {
  /**
   * Runs synchronously before transport begins. Use only for reversible input acknowledgement:
   * pressed/disabled state, selection glow, or an animation wind-up. Never predict random/value
   * outcomes here.
   */
  readonly onIntentAccepted?: () => void;
  readonly onCommitted?: (result: InstalledCommandResult) => void;
  readonly onRejected?: (error: unknown) => void;
}

export interface CommandCoordinatorOptions {
  readonly commandId?: () => string;
  readonly retryAttempts?: number;
}

export class CommandBusyError extends Error {
  constructor() {
    super("an authoritative mutation is already pending for this slot");
    this.name = "CommandBusyError";
  }
}

export class CommandRecoveryRequiredError extends Error {
  constructor() {
    super("the previous authoritative command has an uncertain response and must be recovered first");
    this.name = "CommandRecoveryRequiredError";
  }
}

export class CommandRecoveredBeforeNewIntentError extends Error {
  constructor(readonly recovered: InstalledCommandResult) {
    super("the previous authoritative command was recovered; retry this interaction from fresh state");
    this.name = "CommandRecoveredBeforeNewIntentError";
  }
}

export class CommandStateResyncedError extends Error {
  readonly code: RemoteGameAuthorityError["code"];
  readonly retryable = false;
  readonly currentRevision: number | undefined;

  constructor(readonly cause: RemoteGameAuthorityError) {
    super("authoritative state changed elsewhere; the slot was resynchronized");
    this.name = "CommandStateResyncedError";
    this.code = cause.code;
    this.currentRevision = cause.currentRevision;
  }
}

/**
 * One outstanding mutation per slot. Input feedback is immediate, mechanics are not predicted,
 * and every retry reuses the byte-equivalent command envelope so a lost response cannot reroll.
 */
export class CommandCoordinator {
  readonly battleChatHistory: BattleChatHistory;
  private currentProjection: InstalledSlotProjection;
  private inFlight = false;
  private uncertainEnvelope: GameCommandEnvelopeV1 | undefined;
  private readonly commandId: () => string;
  private readonly retryAttempts: number;
  private readonly listeners = new Set<(pending: boolean) => void>();
  private readonly projectionListeners = new Set<(projection: InstalledSlotProjection) => void>();
  private readonly reconciliationListeners = new Set<() => void>();

  constructor(
    private readonly authority: GameAuthority,
    private readonly slotId: SaveSlotId,
    initialProjection: InstalledSlotProjection,
    options: CommandCoordinatorOptions = {},
  ) {
    if (initialProjection.slotId !== slotId) {
      throw new Error(`projection ${initialProjection.slotId} does not belong to ${slotId}`);
    }
    this.currentProjection = initialProjection;
    this.battleChatHistory = new BattleChatHistory(initialProjection);
    this.commandId = options.commandId ?? defaultCommandId;
    this.retryAttempts = options.retryAttempts ?? 1;
    if (!Number.isSafeInteger(this.retryAttempts) || this.retryAttempts < 0 || this.retryAttempts > 5) {
      throw new Error("retryAttempts must be an integer from 0 through 5");
    }
  }

  get projection(): InstalledSlotProjection {
    return this.currentProjection;
  }

  get pending(): boolean {
    return this.inFlight || this.uncertainEnvelope !== undefined;
  }

  subscribe(listener: (pending: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.pending);
    return () => { this.listeners.delete(listener); };
  }

  subscribeProjection(listener: (projection: InstalledSlotProjection) => void): () => void {
    this.projectionListeners.add(listener);
    listener(this.currentProjection);
    return () => { this.projectionListeners.delete(listener); };
  }

  /** A fresh projection replaced the live scene's decision; its owner must reconstruct that scene. */
  subscribeReconciliation(listener: () => void): () => void {
    this.reconciliationListeners.add(listener);
    return () => { this.reconciliationListeners.delete(listener); };
  }

  async submit(
    command: GameCommandV1,
    hooks: CommandCoordinatorHooks = {},
  ): Promise<InstalledCommandResult> {
    if (this.inFlight) throw new CommandBusyError();
    if (this.uncertainEnvelope !== undefined) {
      const recovered = await this.recoverPending();
      if (recovered !== undefined) {
        for (const listener of this.reconciliationListeners) listener();
        throw new CommandRecoveredBeforeNewIntentError(recovered);
      }
    }
    const decision = this.currentProjection.decision;
    const envelope: GameCommandEnvelopeV1 = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: this.commandId(),
      expectedRevision: this.currentProjection.revision,
      ...(decision.type === "none" ? {} : { expectedDecisionId: decision.decisionId }),
      command,
    };
    this.setPending(true);
    let reconciled = false;
    hooks.onIntentAccepted?.();
    try {
      const result = await this.sendWithRetry(envelope);
      this.setProjection(result.projection);
      hooks.onCommitted?.(result);
      return result;
    } catch (error) {
      if (isRetryableTransportFailure(error)) {
        this.uncertainEnvelope = envelope;
      } else if (isRevisionConflict(error)) {
        this.setProjection(await this.authority.bootstrap(this.slotId));
        reconciled = true;
        const resynced = new CommandStateResyncedError(error);
        hooks.onRejected?.(resynced);
        throw resynced;
      }
      hooks.onRejected?.(error);
      throw error;
    } finally {
      this.setPending(false);
      if (reconciled) for (const listener of this.reconciliationListeners) listener();
    }
  }

  async resync(): Promise<InstalledSlotProjection> {
    if (this.inFlight) throw new CommandBusyError();
    if (this.uncertainEnvelope !== undefined) await this.recoverPending();
    this.setProjection(await this.authority.bootstrap(this.slotId));
    return this.currentProjection;
  }

  /** Replays the exact uncertain envelope; no new command ID, revision, decision, or RNG is used. */
  async recoverPending(): Promise<InstalledCommandResult | undefined> {
    if (this.inFlight) throw new CommandBusyError();
    const envelope = this.uncertainEnvelope;
    if (envelope === undefined) return undefined;
    this.setPending(true);
    let reconciled = false;
    try {
      const result = await this.sendWithRetry(envelope);
      this.setProjection(result.projection);
      this.uncertainEnvelope = undefined;
      return result;
    } catch (error) {
      if (!isRetryableTransportFailure(error)) this.uncertainEnvelope = undefined;
      if (isRevisionConflict(error)) {
        this.setProjection(await this.authority.bootstrap(this.slotId));
        reconciled = true;
        throw new CommandStateResyncedError(error);
      }
      throw error;
    } finally {
      this.setPending(false);
      if (reconciled) for (const listener of this.reconciliationListeners) listener();
    }
  }

  /** Resume a scene whose rejected command ended its presentation coroutine. */
  async recoverScene(error: RemoteGameAuthorityError): Promise<never> {
    await this.resync();
    for (const listener of this.reconciliationListeners) listener();
    throw new CommandStateResyncedError(error);
  }

  private async sendWithRetry(envelope: GameCommandEnvelopeV1): Promise<InstalledCommandResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.authority.command(this.slotId, envelope);
      } catch (error) {
        if (!isRetryableTransportFailure(error) || attempt >= this.retryAttempts) throw error;
        attempt += 1;
        // Deliberately no artificial delay: retry is an idempotent response recovery, and the
        // source animation wind-up is already the latency mask. Long backoff belongs to reconnect UI.
      }
    }
  }

  private setPending(pending: boolean): void {
    this.inFlight = pending;
    for (const listener of this.listeners) listener(this.pending);
  }

  private setProjection(projection: InstalledSlotProjection): void {
    if (projection.slotId !== this.slotId) {
      throw new Error(`projection ${projection.slotId} does not belong to ${this.slotId}`);
    }
    this.battleChatHistory.observe(projection);
    this.currentProjection = projection;
    for (const listener of this.projectionListeners) listener(projection);
  }
}

export function isCommandReconciliation(error: unknown): boolean {
  return error instanceof CommandRecoveredBeforeNewIntentError || error instanceof CommandStateResyncedError;
}

function isRetryableTransportFailure(error: unknown): boolean {
  return error instanceof RemoteGameAuthorityError && error.retryable;
}

function isRevisionConflict(error: unknown): error is RemoteGameAuthorityError {
  return error instanceof RemoteGameAuthorityError &&
    (error.code === "REVISION_CONFLICT" || error.code === "DECISION_STALE");
}

function defaultCommandId(): string {
  return `cmd_${crypto.randomUUID().replaceAll("-", "")}`;
}
