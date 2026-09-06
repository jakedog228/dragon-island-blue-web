import { SAVE_SLOT_IDS, type SaveSlotId } from "@dib/save-protocol";
import type { PlayerGameStateSnapshot } from "../player/gameState.js";
import { summarizeSaveSlot } from "../player/saveSlotPreview.js";
import { PRELOADER_PROGRESS_MAX, TITLE_PULSE_HALF_CYCLE_MS } from "./startupConstants.js";

export interface StartupSlotRecord {
  readonly slotId: SaveSlotId;
  /** True when a persistence record exists, even if its content fingerprint is incompatible. */
  readonly exists: boolean;
  readonly updatedAt?: string;
  readonly compatible: boolean;
  readonly state?: PlayerGameStateSnapshot;
}

export type SaveSelectAction =
  | {
      readonly kind: "slot";
      readonly slotId: SaveSlotId;
      readonly occupied: boolean;
      readonly enabled: boolean;
      readonly label: string;
    }
  | { readonly kind: "erase"; readonly label: string }
  | { readonly kind: "credits"; readonly label: string }
  | { readonly kind: "options"; readonly label: string }
  | { readonly kind: "back"; readonly label: string };


export function nextPreloaderDots(dotCount: number): { dotCount: number; text: string } {
  if (!Number.isInteger(dotCount) || dotCount < 0 || dotCount > 2) {
    throw new Error(`preloader dotCount must be 0..2, got ${dotCount}`);
  }
  const next = dotCount + 1 >= 3 ? 0 : dotCount + 1;
  return { dotCount: next, text: next === 0 ? "." : next === 1 ? ".." : "..." };
}


export function sourceLoadPercentage(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction < 0) {
    throw new Error(`load fraction must be finite and non-negative, got ${fraction}`);
  }
  return Math.min(PRELOADER_PROGRESS_MAX, fraction * 100);
}

/** `%d` truncates the positive progress float toward zero. */
export function sourceLoadPercentageText(fraction: number): string {
  return ` ${Math.trunc(sourceLoadPercentage(fraction))}%`;
}

/**
 * MainMenu starts white and sequences TintTo(white, 1s), TintTo(gray, 1s), then repeats. The first
 * second is therefore a white hold; subsequent cycles alternate one-second fades.
 */
export function titlePromptTint(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(`elapsedMs must be non-negative, got ${elapsedMs}`);
  }
  if (elapsedMs <= TITLE_PULSE_HALF_CYCLE_MS) return 0xffffff;
  const phase = (elapsedMs - TITLE_PULSE_HALF_CYCLE_MS) %
    (TITLE_PULSE_HALF_CYCLE_MS * 2);
  const t = (phase % TITLE_PULSE_HALF_CYCLE_MS) / TITLE_PULSE_HALF_CYCLE_MS;
  const from = phase < TITLE_PULSE_HALF_CYCLE_MS ? 255 : 128;
  const to = phase < TITLE_PULSE_HALF_CYCLE_MS ? 128 : 255;
  const channel = Math.round(from + (to - from) * t);
  return (channel << 16) | (channel << 8) | channel;
}

/**
 * MainMenuNode scans file existence rather than decoded content. An incompatible remote record
 * must therefore open the selector, preventing the all-empty shortcut from overwriting slot 1.
 */
export function sourceTitleDestination(records: readonly StartupSlotRecord[]):
  | { readonly kind: "save-select" }
  | { readonly kind: "slot"; readonly slotId: SaveSlotId } {
  return records.some((record) => record.exists)
    ? { kind: "save-select" }
    : { kind: "slot", slotId: SAVE_SLOT_IDS[0] };
}


export function sourceSaveSlotLabel(
  record: StartupSlotRecord,
  strings: Readonly<Record<string, string>>,
  locale?: string,
): string {
  if (!record.exists) return requiredString(strings, "NewGameButtonKey");
  const formattedDate = formatSaveDate(record.updatedAt, locale);
  if (!record.compatible) {
    return formattedDate.length > 0
      ? `Different Asset Archive @ ${formattedDate}`
      : "Different Asset Archive";
  }
  if (record.state === undefined) throw new Error(`${record.slotId} exists but has no decoded save state`);
  const level = summarizeSaveSlot(record.state).heroLevel;
  if (level < 1) return formattedDate;
  return formatPercentDAtString(
    requiredString(strings, "GameDisplayFormatKey"),
    level,
    formattedDate,
  );
}

/** Exact two-column order authored in PickSaveSlotNode. */
export function sourceSaveSelectColumns(
  records: readonly StartupSlotRecord[],
  strings: Readonly<Record<string, string>>,
  locale?: string,
  allowErase = true,
): readonly [readonly SaveSelectAction[], readonly SaveSelectAction[]] {
  const byId = new Map(records.map((record) => [record.slotId, record]));
  const slots = SAVE_SLOT_IDS.map((slotId): SaveSelectAction => {
    const record = byId.get(slotId) ?? { slotId, exists: false, compatible: true };
    const occupied = record.exists && record.compatible;
    return {
      kind: "slot",
      slotId,
      occupied,
      enabled: !record.exists || record.compatible,
      label: sourceSaveSlotLabel(record, strings, locale),
    };
  });
  const firstColumn: SaveSelectAction[] = [...slots];
  if (allowErase && slots.some((slot) => slot.kind === "slot" && slot.occupied)) {
    firstColumn.push({ kind: "erase", label: requiredString(strings, "EraseGameButtonKey") });
  }
  const secondColumn: SaveSelectAction[] = [
    { kind: "credits", label: requiredString(strings, "CreditsButtonKey") },
    { kind: "options", label: requiredString(strings, "OptionsKey") },
    { kind: "back", label: requiredString(strings, "BackButtonKey") },
  ];
  return [firstColumn, secondColumn];
}

export function formatPercentDAtString(format: string, value: number, date: string): string {
  return format.replace("%d", String(Math.trunc(value))).replace("%@", date);
}

function formatSaveDate(updatedAt: string | undefined, locale: string | undefined): string {
  if (updatedAt === undefined) return "";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function requiredString(strings: Readonly<Record<string, string>>, key: string): string {
  const value = strings[key];
  if (value === undefined) throw new Error(`startup localization is missing ${key}`);
  return value;
}
