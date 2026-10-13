import "./saveBackupPanel.css";
import { saveModDetails } from "./saveModDetails.js";
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
import { OfflineSaveLibrary } from "../player/offlineSaveLibrary.js";
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
  readonly onChange?: () => void;
}

let nextPanelId = 0;
const installations = new WeakMap<HTMLElement, object>();

interface SlotRow {
  readonly slotId: SaveSlotId;
  readonly detail: HTMLElement;
  readonly exportButton: HTMLButtonElement;
  readonly restoreButton?: HTMLButtonElement;
  readonly warning?: HTMLElement;
}












export async function installSaveBackupPanel(options: SaveBackupPanelOptions): Promise<void> {
  const { container, store, nativeSave, mode } = options;
  const installation = {};
  installations.set(container, installation);
  const panelId = ++nextPanelId;
  const capabilities = saveBackupPanelCapabilities(mode);
  const library = store instanceof OfflineSaveLibrary ? store : undefined;
  container.replaceChildren();
  container.hidden = false;
  container.classList.toggle("save-library", library !== undefined);

  const heading = document.createElement("p");
  heading.className = "content-gate__backup-heading";
  heading.textContent = library === undefined ? `${mode === "offline" ? "Offline" : "Online"} save slots` : "Save pages";
  container.appendChild(heading);

  const format = document.createElement("p");
  format.className = "content-gate__backup-note";
  format.textContent = library === undefined
    ? "Saves use the original game's own format and can be imported into Offline play."
    : "Each page holds three save slots. Select a page to use it in the game.";
  container.appendChild(format);

  const rebuild = async (focusSelector?: string, announcement?: string): Promise<void> => {
    options.onChange?.();
    const pending = installSaveBackupPanel(options);
    const next = installations.get(container);
    await pending;
    if (installations.get(container) !== next || !container.isConnected) return;
    if (focusSelector !== undefined) container.querySelector<HTMLElement>(focusSelector)?.focus();
    if (announcement !== undefined) setStatus(announcement);
  };
  if (library !== undefined) {
    const paging = document.createElement("nav");
    paging.className = "save-library__paging";
    paging.setAttribute("aria-label", "Offline save pages");
    const previous = textButton("");
    previous.innerHTML = iconSvg("previous");
    previous.classList.add("save-library__page-arrow");
    previous.setAttribute("aria-label", "Previous page");
    previous.disabled = library.page === 0;
    const next = textButton("");
    next.innerHTML = iconSvg("next");
    next.classList.add("save-library__page-arrow");
    next.setAttribute("aria-label", "Next page");
    next.disabled = library.page + 1 === library.pageCount;
    const pageSelect = document.createElement("select");
    pageSelect.dataset["savePage"] = "";
    pageSelect.setAttribute("aria-label", "Save page");
    for (let page = 0; page < library.pageCount; page++) {
      const option = document.createElement("option");
      option.value = String(page);
      option.textContent = `Page ${page + 1} of ${library.pageCount}`;
      option.selected = library.page === page;
      pageSelect.appendChild(option);
    }
    const changePage = (action: () => void): void => {
      try {
        action();
        void rebuild("[data-save-page]", `Page ${library.page + 1} of ${library.pageCount} selected.`)
          .catch(error => setStatus(describe(error), true));
      } catch (error) { setStatus(describe(error), true); }
    };
    pageSelect.addEventListener("change", () => changePage(() => library.selectPage(Number(pageSelect.value))));
    previous.addEventListener("click", () => changePage(() => library.selectPage(library.page - 1)));
    next.addEventListener("click", () => changePage(() => library.selectPage(library.page + 1)));
    const add = textButton("");
    add.classList.add("save-library__add-page");
    add.setAttribute("aria-label", "Add page");
    add.title = "Add page";
    add.innerHTML = `${iconSvg("add")}<span>Add page</span>`;
    add.addEventListener("click", () => changePage(() => library.addPage()));
    heading.appendChild(add);
    paging.append(previous, selectField(pageSelect), next);
    container.appendChild(paging);
  }

  const note = document.createElement("p");
  note.className = "content-gate__backup-note";


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
      "Import a save file into a slot on this page",
    );
    importButton.classList.add("content-gate__backup-import-button");
    if (library !== undefined) showButtonText(importButton, "Import save file");
    importButton.addEventListener("click", () => importInput.click());
    importBar.append(importButton, importInput);
    container.appendChild(importBar);
  }

  const status = document.createElement("p");
  status.className = "content-gate__backup-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-atomic", "true");
  container.appendChild(status);

  const setStatus = (message: string, isError = false): void => {
    const live = container.querySelector<HTMLElement>(".content-gate__backup-status") ?? status;
    live.textContent = message;
    live.classList.toggle("content-gate__backup-status--error", isError);
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
    const title = document.createElement("div");
    title.className = "content-gate__backup-slot-title";
    title.textContent = slotId.replace("slot-", "Slot ");
    row.dataset["saveSlot"] = slotId;
    const detail = document.createElement("span");
    detail.className = "content-gate__backup-slot-detail";
    const actions = document.createElement("div");
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
    let warning: HTMLElement | undefined;
    let management: HTMLElement | undefined;
    if (library !== undefined) {
      const slotLabel = slotId.replace("slot-", "Slot ");
      const nameHeading = document.createElement("h3");
      nameHeading.className = "save-library__name-heading";
      nameHeading.id = `save-heading-${panelId}-${slotId}`;
      const rename = textButton("");
      rename.className = "save-library__rename-trigger";
      rename.setAttribute("aria-label", `Rename ${slotLabel}`);
      rename.title = "Rename save";
      const nameText = document.createElement("span");
      nameText.className = "save-library__name";
      nameText.textContent = library.entry(slotId).name;
      const pencil = document.createElement("span");
      pencil.className = "save-library__pencil";
      pencil.setAttribute("aria-hidden", "true");
      pencil.innerHTML = iconSvg("edit");
      rename.append(nameText, pencil);
      nameHeading.appendChild(rename);
      title.appendChild(nameHeading);
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", `${slotLabel}: ${nameText.textContent}`);
      exportButton.title = `Download ${nameText.textContent}`;
      showButtonText(exportButton, "Export");
      management = document.createElement("section");
      management.className = "save-library__management";
      management.id = `save-management-${panelId}-${slotId}`;
      management.hidden = true;
      management.setAttribute("aria-label", `Manage ${slotLabel}`);
      const toggle = textButton("Manage");
      toggle.dataset["manageSave"] = "";
      toggle.setAttribute("aria-label", `Manage ${slotLabel}`);
      toggle.setAttribute("aria-controls", management.id);
      toggle.setAttribute("aria-expanded", "false");
      const nameForm = document.createElement("form");
      nameForm.className = "save-library__rename";
      nameForm.hidden = true;
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 80;
      name.required = true;
      name.value = library.entry(slotId).name;
      name.setAttribute("aria-label", `Name for ${slotLabel}`);
      name.id = `save-name-${panelId}-${slotId}`;
      const saveName = textButton("");
      saveName.innerHTML = iconSvg("check");
      saveName.setAttribute("aria-label", `Save name for ${slotLabel}`);
      saveName.title = "Save name (Enter)";
      saveName.type = "submit";
      const cancelName = textButton("");
      cancelName.innerHTML = iconSvg("close");
      cancelName.setAttribute("aria-label", `Cancel renaming ${slotLabel}`);
      cancelName.title = "Cancel (Escape)";
      const help = document.createElement("p");
      help.className = "save-library__help";
      help.id = `${name.id}-help`;
      help.textContent = "Also names the exported file.";
      name.setAttribute("aria-describedby", help.id);
      nameForm.append(name, saveName, cancelName, help);
      title.appendChild(nameForm);
      const finishRename = (): void => {
        nameForm.hidden = true;
        nameHeading.hidden = false;
        name.value = library.entry(slotId).name;
        name.removeAttribute("aria-invalid");
        rename.focus();
      };
      rename.addEventListener("click", () => {
        nameHeading.hidden = true;
        nameForm.hidden = false;
        name.focus();
        name.select();
        nameForm.scrollIntoView({ block: "nearest" });
      });
      cancelName.addEventListener("click", finishRename);
      nameForm.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        finishRename();
      });
      nameForm.addEventListener("submit", event => {
        event.preventDefault();
        try {
          library.rename(slotId, name.value);
          name.value = library.entry(slotId).name;
          nameText.textContent = name.value;
          row.setAttribute("aria-label", `${slotLabel}: ${name.value}`);
          exportButton.title = `Download ${name.value}`;
          name.removeAttribute("aria-invalid");
          options.onChange?.();
          setStatus(`Saved name: ${name.value}.`);
          finishRename();
        } catch (error) {
          name.setAttribute("aria-invalid", "true");
          setStatus(describe(error), true);
          name.focus();
        }
      });
      name.addEventListener("input", () => name.removeAttribute("aria-invalid"));
      const setExpanded = (expanded: boolean): void => {
        management!.hidden = !expanded;
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.textContent = expanded ? "Done" : "Manage";
        toggle.setAttribute("aria-label", expanded ? `Done managing ${slotLabel}` : `Manage ${slotLabel}`);
        if (expanded) pageChoice.focus();
        else {
          pageChoice.value = String(library.page);
          slotChoice.value = String(SAVE_SLOT_IDS.indexOf(slotId));
          updateMove();
          toggle.focus();
        }
      };
      toggle.addEventListener("click", () => setExpanded(management!.hidden));
      row.addEventListener("keydown", event => {
        if (event.key !== "Escape" || management!.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        setExpanded(false);
      });
      const moveForm = document.createElement("form");
      moveForm.className = "save-library__move";
      const moveHeading = document.createElement("p");
      moveHeading.className = "save-library__section-label";
      moveHeading.textContent = "Move to another slot";
      const pageChoice = document.createElement("select");
      pageChoice.setAttribute("aria-label", `Destination page for ${slotLabel}`);
      for (let page = 0; page < library.pageCount; page++) {
        pageChoice.add(new Option(`Page ${page + 1}`, String(page), false, page === library.page));
      }
      const slotChoice = document.createElement("select");
      slotChoice.setAttribute("aria-label", `Destination slot for ${slotLabel}`);
      SAVE_SLOT_IDS.forEach((id, index) => {
        slotChoice.add(new Option(id.replace("slot-", "Slot "), String(index), false, id === slotId));
      });
      const pageLabel = document.createElement("label");
      pageLabel.textContent = "Page";
      pageLabel.appendChild(selectField(pageChoice));
      const slotChoiceLabel = document.createElement("label");
      slotChoiceLabel.textContent = "Slot";
      slotChoiceLabel.appendChild(selectField(slotChoice));
      const moveButton = textButton("Move save");
      moveButton.type = "submit";
      const updateMove = (): void => {
        moveButton.disabled = Number(pageChoice.value) === library.page &&
          Number(slotChoice.value) === SAVE_SLOT_IDS.indexOf(slotId);
      };
      pageChoice.addEventListener("change", updateMove);
      slotChoice.addEventListener("change", updateMove);
      updateMove();
      const moveHelp = document.createElement("p");
      moveHelp.className = "save-library__help";
      moveHelp.textContent = "Other saves shift to make room. Nothing is overwritten.";
      moveForm.append(moveHeading, pageLabel, slotChoiceLabel, moveButton, moveHelp);
      moveForm.addEventListener("submit", event => {
        event.preventDefault();
        try {
          const destination = Number(pageChoice.value) * 3 + Number(slotChoice.value);
          const movedName = library.entry(slotId).name;
          library.move(slotId, destination);
          const targetSlot = SAVE_SLOT_IDS[destination % 3]!;
          void rebuild(`[data-save-slot="${targetSlot}"] [data-manage-save]`,
            `${movedName} moved to page ${library.page + 1}, ${targetSlot.replace("slot-", "slot ")}.`)
            .catch(error => setStatus(describe(error), true));
        } catch (error) { setStatus(describe(error), true); }
      });
      const maintenance = document.createElement("div");
      maintenance.className = "save-library__maintenance";
      if (restoreButton !== undefined) {
        showButtonText(restoreButton, "Undo last save");
        maintenance.appendChild(restoreButton);
      }
      const remove = textButton("Delete save");
      remove.classList.add("save-library__delete");
      remove.disabled = store.summary(slotId) === undefined;
      remove.addEventListener("click", () => {
        if (!globalThis.confirm(`Delete “${library.entry(slotId).name}” and its undo copy? Export a backup first if you want to keep it.`)) return;
        void library.deleteSlot(slotId).then(() => rebuild(
          `[data-save-slot="${slotId}"] [data-manage-save]`, `${slotLabel} deleted.`,
        )).catch(error => setStatus(describe(error), true));
      });
      maintenance.appendChild(remove);
      management.append(moveForm, maintenance);
      actions.appendChild(toggle);
      warning = document.createElement("div");
      warning.className = "save-library__mod-summary";
    } else if (restoreButton !== undefined) actions.append(restoreButton);
    row.append(title, detail, actions);
    if (warning !== undefined) row.appendChild(warning);
    if (management !== undefined) row.appendChild(management);
    list.appendChild(row);
    rows.set(slotId, {
      slotId,
      detail,
      exportButton,
      ...(restoreButton === undefined ? {} : { restoreButton }),
      ...(warning === undefined ? {} : { warning }),
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
      row.detail.textContent = library !== undefined && summary?.compatible === false
        ? "Unreadable save; original data preserved" : view.detail;
      if (installations.get(container) !== installation) return;
      if (row.warning !== undefined && library !== undefined) {
        row.warning.hidden = summary === undefined;
        const previous = library.entry(row.slotId);
        const open = row.warning.querySelector("details")?.open ?? false;
        const details = saveModDetails(previous.lastMods, library.selectedMods,
          previous.lastContent !== library.selectedContentNamespace);
        details.open = open;
        row.warning.replaceChildren(details);
      }
      // Unlike the old JSON envelope, an unreadable slot cannot be exported: the native format is
      // built from decoded state, so there is no raw payload to hand back.
      row.exportButton.disabled = !view.canExport || unreadable;
      row.exportButton.hidden = library !== undefined && summary === undefined;
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
          const fileName = library?.entry(row.slotId).name ?? file.fileName;
          downloadSave(file.bytes, fileName);
          setStatusWithWarnings(
            `Exported ${row.slotId} as ${fileName}.`,
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
          options.onChange?.();
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
        if (library !== undefined) {
          await library.importSave(target, imported.state, file.name);
          await rebuild(`[data-save-slot="${target}"] [data-manage-save]`);
          const newStatus = container.querySelector(".content-gate__backup-status");
          if (newStatus) newStatus.textContent = `Imported the save into ${target}. Name: ${file.name}. ${imported.warnings.map(w => w.message).join(" ")}`;
        } else {
          await store.open(target).save(imported.state);
          await refresh();
          setStatusWithWarnings(`Imported the save into ${target}.`, imported.warnings);
        }
      } catch (error) {
        setStatus(`Import failed: ${describe(error)}`, true);
      } finally {
        importInput.value = "";
      }
    })();
  });

  if (library !== undefined) {
    const help = document.createElement("details");
    help.className = "save-library__about";
    const summary = document.createElement("summary");
    summary.textContent = "About backups & browser storage";
    const backupHelp = document.createElement("p");
    backupHelp.textContent = "Exports use the original game's save format. For an emulator, rename the file to savefile0, savefile1 or savefile2. Importing uses the filename as the save name.";
    help.append(summary, backupHelp, note);
    container.appendChild(help);
  } else container.appendChild(note);
  await refresh();
  if (capabilities.requestsPersistentStorage) {
    // Storage estimates must not delay focus restoration after navigating or moving a save.
    void requestPersistentStorage().then(report => {
      if (installations.get(container) === installation) {
        note.textContent = describeStoragePersistence(report);
      }
    });
  } else {
    note.remove();
  }
}

/** The file itself carries no slot identity, so the player always chooses the destination. */
function promptForSlot(heroLevel: number, partySize: number): SaveSlotId | undefined {
  return parseSlotChoice(globalThis.prompt(
    `Import this save (level ${heroLevel}, ${partySize} in party) into which slot on this page? ` +
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

function showButtonText(button: HTMLButtonElement, label: string): void {
  button.classList.add("save-library__text-action");
  button.querySelector(".content-gate__sr-only")?.remove();
  const text = document.createElement("span");
  text.textContent = label;
  button.appendChild(text);
}

function textButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "content-gate__save-button";
  button.textContent = label;
  return button;
}

/** Keep the native select's keyboard/OS menu, with a consistently inset disclosure icon. */
function selectField(select: HTMLSelectElement): HTMLSpanElement {
  const field = document.createElement("span");
  field.className = "save-library__select";
  field.appendChild(select);
  field.insertAdjacentHTML("beforeend", iconSvg("down"));
  return field;
}

type BackupIcon = "export" | "import" | "restore" | "previous" | "next" | "down" | "add" | "edit" | "check" | "close";

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
    previous: '<path d="m14 6-6 6 6 6"/>',
    next: '<path d="m10 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    export: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 14v5h14v-5"/>',
    import: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M5 14v5h14v-5"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.68"/><path d="M4 4v4.68h4.68"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round">${paths[icon]}</svg>`;
}
