import { SAVE_SLOT_IDS, type SaveSlotId, type SaveSlotSummary } from "@dib/save-protocol";
import type { SaveSlotPreview } from "../player/saveSlotPreview.js";
import type { StoredRevision } from "../player/saveStore.js";

export type SaveBackupPanelMode = "offline" | "online";

export interface SaveBackupPanelCapabilities {
  readonly canImport: boolean;
  readonly canRollBack: boolean;
  readonly requestsPersistentStorage: boolean;
}

export function saveBackupPanelCapabilities(
  mode: SaveBackupPanelMode,
): SaveBackupPanelCapabilities {
  return mode === "offline"
    ? { canImport: true, canRollBack: true, requestsPersistentStorage: true }
    : { canImport: false, canRollBack: false, requestsPersistentStorage: false };
}

export interface BackupSlotRowView {
  readonly detail: string;
  readonly canExport: boolean;
  readonly canRollBack: boolean;
  readonly rollBackTitle: string;
}

export interface BackupSlotRowInput {
  readonly summary?: SaveSlotSummary | undefined;
  readonly preview?: SaveSlotPreview | undefined;
  readonly previous?: Pick<StoredRevision, "revision" | "updatedAt"> | undefined;
  /** Set when the slot exists but its state could not be decoded. */
  readonly unreadable?: boolean;
  readonly formatStamp: (iso: string) => string;
}

/** Pure row projection; `apps/web` has no DOM test environment, so the decisions live here. */
export function backupSlotRowView(input: BackupSlotRowInput): BackupSlotRowView {
  const empty: BackupSlotRowView = {
    detail: "Empty",
    canExport: false,
    canRollBack: false,
    rollBackTitle: "No earlier revision is retained for this slot",
  };
  if (input.summary === undefined) return empty;
  if (!input.summary.compatible) {
    return { ...empty, detail: "Bound to a different archive" };
  }
  const stamp = input.formatStamp(input.summary.updatedAt);
  const detail = input.unreadable === true
    ? `Revision ${input.summary.revision} (unreadable) · ${stamp}`
    : input.preview === undefined
      ? `Revision ${input.summary.revision} · ${stamp}`
      : `Level ${input.preview.heroLevel} · ${input.preview.partySize} in party · ${stamp}`;
  return {
    detail,
    // An unreadable slot still exports: the raw envelope is exactly what a recovery attempt needs.
    canExport: true,
    canRollBack: input.previous !== undefined,
    rollBackTitle: input.previous === undefined
      ? empty.rollBackTitle
      : `Roll back to revision ${input.previous.revision} from ` +
        `${input.formatStamp(input.previous.updatedAt)}`,
  };
}

/** Parses the 1/2/3 answer from the import prompt. `undefined` means the player cancelled. */
export function parseSlotChoice(answer: string | null): SaveSlotId | undefined {
  if (answer === null) return undefined;
  const trimmed = answer.trim();
  if (trimmed.length === 0) return undefined;
  const index = Number(trimmed);
  if (!Number.isInteger(index)) throw new Error(`"${answer}" is not a slot number.`);
  const slotId = SAVE_SLOT_IDS[index - 1];
  if (slotId === undefined) {
    throw new Error(`There is no slot ${trimmed}; enter 1, 2 or ${SAVE_SLOT_IDS.length}.`);
  }
  return slotId;
}
