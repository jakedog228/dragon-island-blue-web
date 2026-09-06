import type { SaveSlotId } from "@dib/save-protocol";
import type { SourcePopupMenuDebugState } from "./sourcePopupMenu.js";

export type StartupPhase =
  | "preloader"
  | "title"
  | "save-select"
  | "erase-select"
  | "erase-confirm"
  | "credits"
  | "options"
  | "new-game-plot"
  | "pick-dragon"
  | "launching"
  | "complete"
  | "error";

export interface StartupDiagnosticState {
  phase: StartupPhase;
  task?: { index: number; count: number; label: string; percentage: number } | undefined;
  dots?: string | undefined;
  slots?: Array<{
    slotId: SaveSlotId;
    occupied: boolean;
    compatible: boolean;
    label: string;
  }> | undefined;
  selectedSlot?: SaveSlotId | undefined;
  menu?: SourcePopupMenuDebugState | undefined;
  intro?: Record<string, unknown> | undefined;
  message?: string | undefined;
  /** Session-scoped durability facts; see {@link StartupDiagnostics.SESSION_KEYS}. */
  storage?: string | undefined;
  saveHealth?: string | undefined;
}

export class StartupDiagnostics {
  /**
   * Fields that describe the session rather than the current phase. `update` replaces the whole
   * state so each phase reports only its own fields, but these two answer "are saves durable and
   * landing?", which stays true across every phase and must survive that replacement.
   */
  private static readonly SESSION_KEYS = ["storage", "saveHealth"] as const;

  private value: StartupDiagnosticState = { phase: "preloader" };
  private readonly listeners = new Set<(state: StartupDiagnosticState) => void>();

  update(patch: Partial<StartupDiagnosticState> & Pick<StartupDiagnosticState, "phase">): void {
    const retained: Partial<StartupDiagnosticState> = {};
    for (const key of StartupDiagnostics.SESSION_KEYS) {
      if (this.value[key] !== undefined) retained[key] = this.value[key];
    }
    this.value = { ...retained, ...patch };
    this.emit();
  }

  patch(patch: Partial<StartupDiagnosticState>): void {
    this.value = { ...this.value, ...patch };
    this.emit();
  }

  snapshot(): StartupDiagnosticState {
    return JSON.parse(JSON.stringify(this.value)) as StartupDiagnosticState;
  }

  subscribe(listener: (state: StartupDiagnosticState) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
