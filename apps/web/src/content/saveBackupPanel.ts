import { SAVE_SLOT_IDS, type SaveSlotId } from "@dib/save-protocol";
import {
  looksLikeNativeSave,
  nativeSaveFileName,
  readNativeSave,
  writeNativeSave,
  type NativeSaveContext,
  type NativeSaveWarning,
} from "../player/nativeSave/index.js";
import { summarizeSaveSlot } from "../player/saveSlotPreview.js";
import {
  describeStoragePersistence,
  requestPersistentStorage,
} from "../player/storagePersistence.js";
import type { SaveSlotStore } from "../player/saveStore.js";
import {
  backupSlotRowView,
  parseSlotChoice,
  saveBackupPanelCapabilities,
  type SaveBackupPanelMode,
} from "./saveBackupPanelMath.js";

export interface SaveBackupPanelOptions {
  readonly container: HTMLElement;
  readonly store: SaveSlotStore;
  /** Archive-resolved identities. Import/export both translate against the loaded content. */
  readonly nativeSave: NativeSaveContext;
  readonly mode: SaveBackupPanelMode;
}

interface SlotRow {
  readonly slotId: SaveSlotId;
  readonly detail: HTMLElement;
  readonly exportButton: HTMLButtonElement;
  readonly restoreButton?: HTMLButtonElement;
}


export async function installSaveBackupPanel(options: SaveBackupPanelOptions): Promise<void> {
  const { container, store, nativeSave, mode } = options;
  const capabilities = saveBackupPanelCapabilities(mode);
  container.replaceChildren();
  container.hidden = false;

  const heading = document.createElement("p");
  heading.className = "content-gate__backup-heading";
  heading.textContent = `${mode === "offline" ? "Offline" : "Online"} save slots`;
  container.appendChild(heading);

  const format = document.createElement("p");
  format.className = "content-gate__backup-note";
  format.textContent =
    "Saves use the original game's own format, so an exported file works in an iPhone emulator " +
    "and a save made there can be imported here.";
  container.appendChild(format);

  const note = document.createElement("p");
  note.className = "content-gate__backup-note";
  container.appendChild(note);

  const list = document.createElement("div");
  list.className = "content-gate__backup-slots";
  container.appendChild(list);

  const importInput = document.createElement("input");
  importInput.type = "file";
  // A native save has no file extension, so nothing can usefully be filtered on.
  importInput.hidden = true;
  if (capabilities.canImport) {
    const importBar = document.createElement("div");
    importBar.className = "content-gate__backup-import";
    const importButton = iconButton(
      "import",
      "Import save file",
      "Import a savefile0/1/2 into an Offline slot",
    );
    importButton.classList.add("content-gate__backup-import-button");
    importButton.addEventListener("click", () => importInput.click());
    importBar.append(importButton, importInput);
    container.appendChild(importBar);
  }

  const status = document.createElement("p");
  status.className = "content-gate__backup-status";
  status.setAttribute("aria-live", "polite");
  container.appendChild(status);

  const setStatus = (message: string, isError = false): void => {
    status.textContent = message;
    status.classList.toggle("content-gate__backup-status--error", isError);
  };

  const setStatusWithWarnings = (
    message: string,
    warnings: readonly NativeSaveWarning[],
  ): void => {
    setStatus(warnings.length === 0
      ? message
      : `${message} ${warnings.map(({ message: text }) => text).join(" ")}`);
  };

  const rows = new Map<SaveSlotId, SlotRow>();
  for (const slotId of SAVE_SLOT_IDS) {
    const row = document.createElement("div");
    row.className = "content-gate__backup-slot";
    const title = document.createElement("span");
    title.className = "content-gate__backup-slot-title";
    title.textContent = slotId.replace("slot-", "Slot ");
    const detail = document.createElement("span");
    detail.className = "content-gate__backup-slot-detail";
    const actions = document.createElement("span");
    actions.className = "content-gate__backup-slot-actions";
    const exportButton = iconButton(
      "export",
      `Export ${title.textContent}`,
      `Download ${title.textContent} as ${nativeSaveFileName(slotId)}`,
    );
    const restoreButton = capabilities.canRollBack
      ? iconButton(
        "restore",
        `Undo last save in ${title.textContent}`,
        "Replace this slot with the revision the last save overwrote",
      )
      : undefined;
    actions.append(exportButton);
    if (restoreButton !== undefined) actions.append(restoreButton);
    row.append(title, detail, actions);
    list.appendChild(row);
    rows.set(slotId, {
      slotId,
      detail,
      exportButton,
      ...(restoreButton === undefined ? {} : { restoreButton }),
    });
  }

  const refresh = async (): Promise<void> => {
    for (const row of rows.values()) {
      const summary = store.summary(row.slotId);
      let preview: ReturnType<typeof summarizeSaveSlot> | undefined;
      let unreadable = false;
      if (summary?.compatible === true) {
        try {
          const state = await store.loadSlotState(row.slotId);
          if (state !== undefined) preview = summarizeSaveSlot(state);
        } catch {
          unreadable = true;
        }
      }
      const view = backupSlotRowView({
        summary,
        preview,
        previous: store.previousRevision?.(row.slotId),
        unreadable,
        formatStamp,
      });
      row.detail.textContent = view.detail;
      // Unlike the old JSON envelope, an unreadable slot cannot be exported: the native format is
      // built from decoded state, so there is no raw payload to hand back.
      row.exportButton.disabled = !view.canExport || unreadable;
      if (row.restoreButton !== undefined) {
        row.restoreButton.hidden = store.restorePreviousRevision === undefined;
        row.restoreButton.disabled = !view.canRollBack;
        row.restoreButton.title = view.rollBackTitle;
      }
    }
  };

  for (const row of rows.values()) {
    row.exportButton.addEventListener("click", () => {
      void (async () => {
        try {
          const state = await store.loadSlotState(row.slotId);
          if (state === undefined) {
            setStatus(`${row.slotId} is empty.`, true);
            return;
          }
          const file = writeNativeSave(row.slotId, state, nativeSave);
          downloadSave(file.bytes, file.fileName);
          setStatusWithWarnings(
            `Exported ${row.slotId} as ${file.fileName}.`,
            file.warnings,
          );
        } catch (error) {
          setStatus(`Export failed: ${describe(error)}`, true);
        }
      })();
    });

    row.restoreButton?.addEventListener("click", () => {
      void (async () => {
        const previous = store.previousRevision?.(row.slotId);
        if (previous === undefined || store.restorePreviousRevision === undefined) return;
        const preview = summarizeSaveSlot(previous.state);
        const confirmed = globalThis.confirm(
          `Replace ${row.slotId} with the revision saved at ${formatStamp(previous.updatedAt)} ` +
            `(level ${preview.heroLevel}, ${preview.partySize} in party)?\n\n` +
            "The current contents become the new undo point.",
        );
        if (!confirmed) return;
        try {
          await store.restorePreviousRevision(row.slotId);
          await refresh();
          setStatus(`${row.slotId} rolled back to the previous revision.`);
        } catch (error) {
          setStatus(`Rollback failed: ${describe(error)}`, true);
        }
      })();
    });
  }

  if (capabilities.canImport) importInput.addEventListener("change", () => {
    void (async () => {
      const file = importInput.files?.[0];
      if (file === undefined) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!looksLikeNativeSave(bytes)) {
          throw new Error(
            `"${file.name}" is not a Dragon Island save file. Pick a savefile0, savefile1 or ` +
              "savefile2 from the game's Documents folder.",
          );
        }
        // Resolving before the slot prompt means an incompatible archive is reported without the
        // player first choosing what to overwrite.
        const imported = readNativeSave(bytes, nativeSave);
        const target = promptForSlot(imported.summary.heroLevel, imported.summary.partySize);
        if (target === undefined) return;
        const occupied = store.summary(target);
        if (occupied !== undefined && !globalThis.confirm(
          `${target} already holds a save from ${formatStamp(occupied.updatedAt)}. Overwrite it?`,
        )) return;
        await store.open(target).save(imported.state);
        await refresh();
        setStatusWithWarnings(`Imported the save into ${target}.`, imported.warnings);
      } catch (error) {
        setStatus(`Import failed: ${describe(error)}`, true);
      } finally {
        importInput.value = "";
      }
    })();
  });

  await refresh();
  if (capabilities.requestsPersistentStorage) {
    note.textContent = describeStoragePersistence(await requestPersistentStorage());
  } else {
    note.remove();
  }
}

/** The file itself carries no slot identity, so the player always chooses the destination. */
function promptForSlot(heroLevel: number, partySize: number): SaveSlotId | undefined {
  return parseSlotChoice(globalThis.prompt(
    `Import this save (level ${heroLevel}, ${partySize} in party) into which slot? ` +
      `Enter 1, 2 or ${SAVE_SLOT_IDS.length}.`,
    "1",
  ));
}

function downloadSave(bytes: Uint8Array, fileName: string): void {
  // `slice()` detaches a plain ArrayBuffer copy; `Uint8Array.buffer` is only `ArrayBufferLike`,
  // which Blob will not accept because it could in principle be shared.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Chromium needs the object URL to outlive the synchronous click before the download starts.
  globalThis.setTimeout(() => { URL.revokeObjectURL(url); }, 30_000);
}

function formatStamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type BackupIcon = "export" | "import" | "restore";

function iconButton(icon: BackupIcon, label: string, title: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "content-gate__icon-button";
  button.setAttribute("aria-label", label);
  button.title = title;
  button.innerHTML = `${iconSvg(icon)}<span class="content-gate__sr-only">${label}</span>`;
  return button;
}

function iconSvg(icon: BackupIcon): string {
  const paths: Record<BackupIcon, string> = {
    export: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 14v5h14v-5"/>',
    import: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M5 14v5h14v-5"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68"/><path d="M4 4v4.68h4.68"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round">${paths[icon]}</svg>`;
}
