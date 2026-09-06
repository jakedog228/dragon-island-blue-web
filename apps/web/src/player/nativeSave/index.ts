


import { SAVE_SLOT_IDS, type SaveSlotId } from "@dib/save-protocol";
import type { PlayerGameStateSnapshot } from "../gameState.js";
import { BinaryPlistError, type PlistLimits } from "./binaryPlist.js";
import {
  NativeSaveFormatError,
  decodeNativeSaveDocument,
  encodeNativeSaveDocument,
} from "./nativeSaveDocument.js";
import {
  exportNativeSave,
  importNativeSave,
  type NativeSaveContext,
  type NativeSaveImportResult,
  type NativeSaveSummary,
  type NativeSaveWarning,
} from "./nativeSaveTranslate.js";

export { BinaryPlistError, NativeSaveFormatError };
export type { NativeSaveContext, NativeSaveImportResult, NativeSaveSummary, NativeSaveWarning };
export type { NativeSaveDocument } from "./nativeSaveDocument.js";

export interface NativeSaveExportFile {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly warnings: readonly NativeSaveWarning[];
}

/** Zero-based slot number, matching the `savefile%d` the original writes. */
export function nativeSlotNumber(slotId: SaveSlotId): number {
  const index = SAVE_SLOT_IDS.indexOf(slotId);
  if (index < 0) throw new NativeSaveFormatError(`unknown save slot ${slotId}`);
  return index;
}

/** The exact name TouchHLE expects in the game's `Documents` directory. */
export function nativeSaveFileName(slotId: SaveSlotId): string {
  return `savefile${nativeSlotNumber(slotId)}`;
}

/**
 * Recognises a file the player picked as a native save without decoding it.
 *
 * Used only to give a better message than "malformed"; the real check is the decode.
 */
export function looksLikeNativeSave(bytes: Uint8Array): boolean {
  const header = "bplist00";
  if (bytes.length < header.length) return false;
  for (let index = 0; index < header.length; index += 1) {
    if (bytes[index] !== header.charCodeAt(index)) return false;
  }
  return true;
}

export function readNativeSave(
  bytes: Uint8Array,
  context: NativeSaveContext,
  limits?: PlistLimits,
): NativeSaveImportResult {
  return importNativeSave(decodeNativeSaveDocument(bytes, limits), context);
}

export function writeNativeSave(
  slotId: SaveSlotId,
  state: PlayerGameStateSnapshot,
  context: NativeSaveContext,
): NativeSaveExportFile {
  const { document, warnings } = exportNativeSave(state, context);
  return Object.freeze({
    bytes: encodeNativeSaveDocument(document),
    fileName: nativeSaveFileName(slotId),
    warnings,
  });
}
