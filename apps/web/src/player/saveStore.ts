import type { SaveSlotId, SaveSlotSummary } from "@dib/save-protocol";
import type { PlayerGameStateSnapshot } from "./gameState.js";

/** One stored generation of a slot: the envelope fields plus its decoded state. */
export interface StoredRevision {
  readonly revision: number;
  readonly updatedAt: string;
  readonly state: PlayerGameStateSnapshot;
}

/**
 * Storage-neutral three-slot contract consumed by the startup/title/save-select scenes.
 * Implementations receive only the semantic content identity established by the content gate;
 * archive bytes and object URLs never cross this boundary.
 */
export interface SaveSlotStore {
  readonly slots: readonly SaveSlotSummary[];
  summary(slotId: SaveSlotId): SaveSlotSummary | undefined;
  loadSlotState(slotId: SaveSlotId): Promise<PlayerGameStateSnapshot | undefined>;
  /**
   * Optional player-facing slot deletion. Official authority deliberately omits this capability:
   * its startup and storage-settings surfaces are read-only except for save exports.
   */
  deleteSlot?(slotId: SaveSlotId): Promise<void>;
  open(slotId: SaveSlotId, preloadedState?: PlayerGameStateSnapshot): SaveSession;
  /**
   * Optional single-generation rollback. Present only on backends that keep their own history;
   * the save server does not, so callers must treat this as a capability, not a guarantee.
   */
  previousRevision?(slotId: SaveSlotId): StoredRevision | undefined;
  restorePreviousRevision?(slotId: SaveSlotId): Promise<void>;
}

/** A slot-bound, ordered autosave channel. */
export interface SaveSession {
  readonly slotId: SaveSlotId;
  load(): Promise<PlayerGameStateSnapshot | undefined>;
  save(state: PlayerGameStateSnapshot): Promise<void>;
  flush(): Promise<void>;


  adoptStoredRevision?(): Promise<void>;
}
