import type { SaveSlotId } from "@dib/save-protocol";
import { SaveConflictError, SaveQuotaError } from "./saveErrors.js";

export type SaveFailureKind = "conflict" | "quota" | "unknown";

export interface SaveHealthState {
  /** No write has failed since the last success. */
  readonly healthy: boolean;
  readonly failureKind?: SaveFailureKind;
  /** Consecutive failed writes; resets to zero on the next success. */
  readonly consecutiveFailures: number;
  readonly detail?: string;
  /** ISO timestamp of the last write that landed, if any has during this session. */
  readonly lastSuccessAt?: string;
  /** True once a conflict has been observed and the player has not chosen to take the slot over. */
  readonly conflicted: boolean;
}

const HEALTHY: SaveHealthState = Object.freeze({
  healthy: true,
  consecutiveFailures: 0,
  conflicted: false,
});

/**
 * Tracks whether autosaves are actually landing.
 *
 * Before this existed, `main.ts` sent every save rejection to `console.error` and carried on, so a
 * full origin or a second tab taking the slot looked exactly like a working game right up until the
 * player reloaded and found their progress missing. Failures are now observable state that the
 * shell can render.
 */
export class SaveHealthMonitor {
  private state: SaveHealthState = HEALTHY;
  private readonly listeners = new Set<(state: SaveHealthState) => void>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  get current(): SaveHealthState {
    return this.state;
  }

  subscribe(listener: (state: SaveHealthState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  recordSuccess(): void {
    this.publish({
      healthy: true,
      consecutiveFailures: 0,
      conflicted: false,
      lastSuccessAt: this.now().toISOString(),
    });
  }

  recordFailure(slotId: SaveSlotId, error: unknown): void {
    const kind = classify(error);
    this.publish({
      healthy: false,
      failureKind: kind,
      consecutiveFailures: this.state.consecutiveFailures + 1,
      detail: describeFailure(slotId, kind, error),
      conflicted: kind === "conflict" || this.state.conflicted,
      ...(this.state.lastSuccessAt === undefined ? {} : { lastSuccessAt: this.state.lastSuccessAt }),
    });
  }

  /** The player has chosen to take the slot over; clear the latch so the next write is attempted. */
  clearConflict(): void {
    if (!this.state.conflicted) return;
    this.publish({ ...this.state, conflicted: false });
  }

  private publish(state: SaveHealthState): void {
    this.state = Object.freeze(state);
    // The durable save has already resolved before success is reported. Health UI is an
    // observer of that fact, never part of the write's acceptance boundary: one broken banner or
    // diagnostics listener must not turn a landed checkpoint into a retryable save failure.
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // Observer failures are intentionally isolated. The state remains committed and later
        // observers still receive the same transition.
      }
    }
  }
}

function classify(error: unknown): SaveFailureKind {
  if (error instanceof SaveConflictError) return "conflict";
  if (error instanceof SaveQuotaError) return "quota";
  return "unknown";
}

/** Player-facing text. Each kind names the cause and the one action that resolves it. */
export function describeFailure(slotId: SaveSlotId, kind: SaveFailureKind, error: unknown): string {
  switch (kind) {
    case "conflict":
      return `Another tab or window is saving to ${slotId}. Progress in this tab is NOT being ` +
        "saved, so it is not overwriting the other one.";
    case "quota":
      return error instanceof Error
        ? error.message
        : `Browser storage is full, so ${slotId} could not be saved.`;
    default:
      return `Could not save ${slotId}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
