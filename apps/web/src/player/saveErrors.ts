import type { SaveSlotId } from "@dib/save-protocol";


export class SaveConflictError extends Error {
  readonly slotId: SaveSlotId;
  readonly expectedRevision: number | null;
  readonly actualRevision: number | null;

  constructor(slotId: SaveSlotId, expectedRevision: number | null, actualRevision: number | null) {
    super(
      `save conflict for ${slotId}: expected revision ${String(expectedRevision)}, ` +
        `found ${String(actualRevision)}`,
    );
    this.name = "SaveConflictError";
    this.slotId = slotId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** Raised when the browser refuses the write because the origin is out of storage quota. */
export class SaveQuotaError extends Error {
  readonly slotId: SaveSlotId;

  constructor(slotId: SaveSlotId, cause: unknown) {
    super(
      `browser storage is full, so ${slotId} could not be saved. Free space by erasing an unused ` +
        "save slot, or export this one and switch to the save server.",
    );
    this.name = "SaveQuotaError";
    this.slotId = slotId;
    this.cause = cause;
  }
}

/**
 * `QuotaExceededError` (code 22) and Firefox's `NS_ERROR_DOM_QUOTA_REACHED` (code 1014) are the two
 * shapes a full origin produces. Safari in private mode throws the former with a zero code.
 */
export function isQuotaExceeded(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014;
  }
  return error instanceof Error && /quota/i.test(error.message);
}
