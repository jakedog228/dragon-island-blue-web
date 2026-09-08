import { probeOnlineServer, type OnlineServerStatus } from "../authority/serverAvailability.js";
import { installOfflineShellStatus } from "../platform/offlineShell.js";
import { importContentArchive, type ImportedContentPackage } from "./archivePackage.js";
import { fingerprintContentPackage, type ContentFingerprint } from "./contentFingerprint.js";
import {
  importCodeModArchive,
  ModPackageError,
  resolveCodeModProfile,
  type CodeModPackage,
  type ResolvedCodeModProfile,
} from "@dib/mod-kernel";
import { applyFullTrustModsToContent, hasImportedModProfile } from "./moddedContent.js";
import type { ModSeam } from "./codeModRuntime.js";
import { BrowserSaveConnection } from "../player/browserSaveClient.js";
import type { SaveSlotStore } from "../player/saveStore.js";
import { installSaveBackupPanel } from "./saveBackupPanel.js";
import { nativeSaveContextFor } from "./nativeSaveContext.js";
import { identifyContentLogicPack } from "./logicPackIdentity.js";
import {
  createOnlineAccount,
  fetchRegistrationInfo,
  OFFICIAL_CLIENT_SIMULATION_VERSION,
  RemoteGameAuthority,
} from "../authority/gameAuthorityClient.js";
import { OfficialAuthoritySaveStore } from "../authority/officialAuthoritySaveStore.js";
import {
  prepareSourceLandingBackdrop,
  prepareSourceLoadingScreen,
  type PreparedSourceLandingBackdrop,
} from "./sourceLoadingScreen.js";
import { AccountUsernameV1Schema, normalizeAccountUsername } from "@dib/game-protocol";
import type { ScenarioConfiguration } from "../debug/scenarioMode.js";
import type { ScenarioSaveStore } from "../debug/scenarioSaveStore.js";
import { OnlineLoginSession } from "./onlineLoginSession.js";
import { installContentGateThemeToggle } from "./contentGateTheme.js";
import {
  BrowserContentArchiveCache,
  hasRememberedAttestation,
  loadRememberedContentArchive,
  readContentGateMemory,
  rememberContentArchive,
  sha256ArchiveBytes,
  shouldRestoreLastModProfile,
  withRememberedAttestation,
  withRememberedModProfileRestore,
  withRememberedMode,
  writeContentGateMemory,
  type ContentGateMemory,
  type KeyValueStorage,
  type RememberedPlayMode,
} from "./contentArchiveMemory.js";
import { requestPersistentStorage } from "../player/storagePersistence.js";
import {
  BrowserModArchiveCache,
  listCachedModArchives,
  rememberModArchives,
  type CachedModArchive,
} from "./modArchiveCache.js";
import {
  composePlayProfileViews,
  describePlayProfileLabel,
  dismissPlayProfile,
  forgetPlayProfile,
  formatShortFileSize,
  lastUsedPlayProfile,
  readDismissedProfiles,
  readPlayProfiles,
  readSaveSlotIndex,
  rememberPlayProfile,
  type PlayProfileRecord,
  type PlayProfileView,
} from "./playProfiles.js";
import {
  activateFullscreenExperience,
  browserFullscreenRuntime,
  fullscreenState,
  shouldOfferFullscreenAction,
} from "../platform/fullscreenShell.js";
import {
  assertOfficialContentBoundary,
  assertOnlinePlayAvailable,
  onlinePlayAvailability,
} from "./onlineModBoundary.js";

interface TestArchiveHook {
  name: string;
  bytes: Uint8Array | ArrayBuffer;
}

interface TestModArchiveHook {
  name: string;
  bytes: Uint8Array | ArrayBuffer;
}

const MIN_TOKEN_LENGTH = 16;
// Manual load order survives reselecting the same mods. Recently-used mod archives are cached
// separately and the last played Offline profile repopulates this selection on reload.
const MOD_ORDER_STORAGE_KEY = "dib.mods.loadOrder.v1";
const MOD_TRUST_WARNING =
  "Full trust: mods run inside this page and may replace any game code, read or change local " +
  "saves and browser storage, use the network, and alter the page. Only load code you trust " +
  "completely.";
// The gate lists the most severe seams and defers the tail to the console rather than growing an
// unbounded wall of text above the play button.
const MAX_LISTED_SEAMS = 8;

function readModOrderOverrides(): Record<string, number> {
  try {
    const stored = localStorage.getItem(MOD_ORDER_STORAGE_KEY);
    if (stored === null) return {};
    const parsed = JSON.parse(stored) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => typeof value === "number" && Number.isInteger(value))) as
      Record<string, number>;
  } catch {
    return {};
  }
}

function writeModOrderOverrides(overrides: Record<string, number>): void {
  try {
    localStorage.setItem(MOD_ORDER_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // A storage-disabled browser still gets a tab-lived manual order.
  }
}

/**
 * The only production entry into user content. The validated last-used archive may be retained in
 * disposable browser-local storage; expanded resources and blob URLs remain session-scoped. The
 * gate establishes a storage connection only; the Pixi loading/title/save-select sequence owns
 * slot discovery and selection.
 */
/** `localStorage` as both a key/value store and an enumerable one, for the save-slot scan. */
type KeyValueStorageWithIndex = KeyValueStorage & {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
};

export interface AcquiredContent {
  readonly content: ImportedContentPackage;
  readonly saveStore: SaveSlotStore;
  readonly official?: OfficialAuthoritySaveStore;
  /** Development-only, tab-local fixture request. Production builds never render its selector. */
  readonly scenario?: {
    readonly configuration: ScenarioConfiguration;
    readonly store: ScenarioSaveStore;
  };
}

export async function acquireLocalContent(host: HTMLElement): Promise<AcquiredContent> {
  const scenarioFeature = import.meta.env.DEV
    ? await import("../debug/scenarioGate.js")
    : undefined;
  const testArchive = (globalThis as Record<string, unknown>)["__DIB_TEST_CONTENT_ARCHIVE__"] as
    | TestArchiveHook
    | undefined;
  if (testArchive) {
    const bytes = testArchive.bytes instanceof Uint8Array
      ? testArchive.bytes
      : new Uint8Array(testArchive.bytes);
    const testMods = (globalThis as Record<string, unknown>)["__DIB_TEST_MOD_ARCHIVES__"] as
      | readonly TestModArchiveHook[]
      | undefined;
    let content = importContentArchive(bytes, testArchive.name);
    try {
      if (testMods !== undefined && testMods.length > 0) {
        const packages = await Promise.all(testMods.map((mod) => importCodeModArchive(
          mod.bytes instanceof Uint8Array ? mod.bytes : new Uint8Array(mod.bytes),
          mod.name,
        )));
        content = await applyFullTrustModsToContent(content, packages);
      }
      const fingerprint = await fingerprintContentPackage(content);
      const firstLoadScreen = await prepareSourceLoadingScreen(content);
      firstLoadScreen.mount(host);
      return {
        content,
        saveStore: BrowserSaveConnection.forContent(fingerprint),
      };
    } catch (error) {
      content.dispose();
      throw error;
    }
  }

  const archiveCache = new BrowserContentArchiveCache();
  const modCache = new BrowserModArchiveCache();
  const releaseRememberedArchive = async (): Promise<boolean> => {
    try {
      return await archiveCache.clear();
    } catch {
      return false;
    }
  };

  return new Promise((resolve) => {
    host.replaceChildren();
    const panel = document.createElement("main");
    const offerFullscreen = shouldOfferFullscreenAction(fullscreenState(browserFullscreenRuntime()));
    panel.className = offerFullscreen
      ? "content-gate"
      : "content-gate content-gate--without-fullscreen";
    panel.innerHTML = `
      <section class="content-gate__card" aria-labelledby="content-title">
        <h1 id="content-title">DIB Engine</h1>
        <button class="content-gate__fullscreen-toggle" type="button" data-fullscreen-action
                aria-label="Fullscreen" title="Fullscreen"${offerFullscreen ? "" : " hidden"}>
          ${fullscreenIcon()}
        </button>
        <button class="content-gate__theme-toggle" type="button" data-gate-theme-toggle
                aria-label="Toggle color mode" title="Toggle color mode">
          <svg class="content-gate__theme-icon" viewBox="0 0 24 24" aria-hidden="true">
            <g class="content-gate__theme-sun">
              <circle cx="12" cy="12" r="3.5"></circle>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path>
            </g>
            <path class="content-gate__theme-moon"
                  d="M19.4 15.1A8 8 0 0 1 8.9 4.6 8 8 0 1 0 19.4 15.1Z"></path>
          </svg>
        </button>
        <div class="content-gate__privacy" role="note">
          <div class="content-gate__privacy-content">
            <strong>All assets stay on this device.</strong>
            <span>Compatible asset archives are read agnostically within the browser, as long as they match the expected format.</span>
          </div>
        </div>
        <section class="content-gate__section content-gate__archive" data-gate-section="archive">
          <div class="content-gate__section-heading">
            <span class="content-gate__section-mark">${archiveIcon()}</span>
            <span>
              <strong>Game content</strong>
            </span>
            <button class="content-gate__profiles-open content-gate__icon-button content-gate__icon-button--quiet"
                    type="button"
                    data-profiles-action aria-label="Saved profiles" title="Saved profiles">
              ${starIcon()}
            </button>
          </div>
          <label class="content-gate__drop">
            <span class="content-gate__file-label">Choose asset archive (IPA/ZIP)</span>
            <input type="file" name="asset-archive"
                   accept=".ipa,.zip,application/zip,application/octet-stream">
          </label>
          <div class="content-gate__mods">
            <div class="content-gate__mods-header">
              <button class="content-gate__mods-toggle" type="button" aria-expanded="false"
                      aria-controls="content-gate-mods-body">
                <span class="content-gate__mods-chevron">${chevronIcon()}</span>
                <span class="content-gate__mods-label">Optional Offline Mods (.dibmod)</span>
              </button>
              <span class="content-gate__mods-warning" role="note" tabindex="0"
                    title="${MOD_TRUST_WARNING}" aria-label="${MOD_TRUST_WARNING}"
                    hidden>${warningIcon()}</span>
              <a class="content-gate__mods-guide" href="./modding.html#code-mods"
                 target="_blank" rel="noopener noreferrer" title="Open the modding guide in a new tab">Modding guide ↗</a>
            </div>
            <div class="content-gate__mods-body" id="content-gate-mods-body" hidden>
              <label class="content-gate__mods-picker">
                <input type="file" name="mod-archives" multiple
                       accept=".dibmod,application/zip,application/octet-stream">
              </label>
              <span class="content-gate__mods-actions">
                <button class="content-gate__mods-detail content-gate__icon-button content-gate__icon-button--quiet"
                        type="button" data-selection-action aria-label="Load order and conflicts"
                        title="Load order and conflicts" hidden>${tuneIcon()}</button>
                <button class="content-gate__mods-clear content-gate__icon-button content-gate__icon-button--quiet"
                        type="button" aria-label="Clear mods" title="Clear mods" hidden>${trashIcon()}</button>
              </span>
              <small class="content-gate__mods-status"></small>
            </div>
          </div>
        </section>
        <fieldset class="content-gate__save-mode content-gate__section"
                  data-gate-section="storage" disabled>
          <legend>Play and save</legend>
          <p class="content-gate__step-hint">Choose game content to unlock play modes.</p>
          <div class="content-gate__save-mode-row">
            <label><input type="radio" name="save-mode" value="local"> Offline</label>
            <button class="content-gate__settings-button" type="button"
                    data-storage-settings="local" aria-label="Offline settings"
                    title="Offline save settings">${settingsIcon()}</button>
          </div>
          <div class="content-gate__mode-detail" data-mode-detail="local" hidden>
            <div class="content-gate__mode-detail-heading">
              <strong>Offline saves</strong>
              <span>Stored locally in this browser.</span>
            </div>
            <p class="content-gate__mode-detail-status" data-local-save-status
               aria-live="polite">Checking browser saves</p>
          </div>
          <div class="content-gate__save-mode-row" data-mode-row="official">
            <label><input type="radio" name="save-mode" value="official"> Online (Beta)</label>
            <button class="content-gate__settings-button" type="button"
                    data-storage-settings="official" aria-label="Online settings"
                    title="Online save settings">${settingsIcon()}</button>
            <small class="content-gate__mode-unavailable" hidden></small>
          </div>
          <div class="content-gate__mode-detail content-gate__credentials"
               data-mode-detail="official" hidden>
            <div class="content-gate__mode-detail-heading">
              <strong>Log in to Online</strong>
              <span>Server-side saves stay pinned to the installed authoritative rules.</span>
            </div>
            <form id="official-login-form" class="content-gate__login-row"
                  action="/api/game/session" method="post" autocomplete="on">
              <input class="content-gate__credential-username" type="text"
                     id="official-login-username" name="username" autocomplete="username"
                     aria-hidden="true" tabindex="-1">
              <label class="content-gate__token" for="official-login-token">Login token
                <input type="password" id="official-login-token" name="password"
                       autocomplete="current-password" minlength="16" required
                       placeholder="Paste your login token">
              </label>
              <button class="content-gate__login" type="submit" disabled>Log in</button>
            </form>
            <p class="content-gate__login-status" aria-live="polite"> </p>
            <div class="content-gate__register" hidden>
              <span class="content-gate__register-hint">New?</span>
              <button class="content-gate__register-open" type="button">Create account</button>
            </div>
            <p class="content-gate__registration-status" data-registration-status
               aria-live="polite"></p>
            <button class="content-gate__registration-retry content-gate__register-open"
                    type="button" hidden>Retry account availability</button>
          </div>
          ${scenarioFeature?.scenarioGateMarkup(settingsIcon()) ?? ""}
        </fieldset>
        <section class="content-gate__section content-gate__finish content-gate__section--blocked"
                 data-gate-section="finish">
          <label class="content-gate__rights">
            <input type="checkbox" disabled>
            <span>I have the right to use the content in this archive on this device.</span>
          </label>
          <button type="button" disabled>Choose play mode</button>
          <p class="content-gate__finish-hint">Choose an archive to continue.</p>
        </section>
        <p class="content-gate__status" aria-live="polite"></p>
        <p class="content-gate__guide" data-offline-shell aria-live="polite"></p>
        <p class="content-gate__guide">
          Build asset archives and Offline code mods with the <a href="./modding.html">modding guide</a>.
        </p>
      </section>`;
    installContentGateThemeToggle(panel);
    host.appendChild(panel);
    const disposeOfflineShellStatus = installOfflineShellStatus(
      requiredElement<HTMLElement>(panel, "[data-offline-shell]"),
    );

    const fullscreenButton = requiredElement<HTMLButtonElement>(panel, "[data-fullscreen-action]");
    if (offerFullscreen) {
      fullscreenButton.addEventListener("click", () => {
        void activateFullscreenExperience();
      });
    }

    // Named because the save-backup panel adds a second file input to this card; every selector
    // reaching the archive picker (including the browser harness) must stay unambiguous.
    const fileInput = requiredElement<HTMLInputElement>(panel, 'input[name="asset-archive"]');
    const fileLabel = requiredElement<HTMLElement>(panel, ".content-gate__file-label");
    const modInput = requiredElement<HTMLInputElement>(panel, 'input[name="mod-archives"]');
    const modLabel = requiredElement<HTMLElement>(panel, ".content-gate__mods-label");
    const modStatus = requiredElement<HTMLElement>(panel, ".content-gate__mods-status");
    const modWarning = requiredElement<HTMLElement>(panel, ".content-gate__mods-warning");
    const clearModsButton = requiredElement<HTMLButtonElement>(panel, ".content-gate__mods-clear");
    const modDetailButton = requiredElement<HTMLButtonElement>(panel, ".content-gate__mods-detail");
    const modActions = requiredElement<HTMLElement>(panel, ".content-gate__mods-actions");
    const modToggle = requiredElement<HTMLButtonElement>(panel, ".content-gate__mods-toggle");
    const modBody = requiredElement<HTMLElement>(panel, ".content-gate__mods-body");
    const rightsInput = requiredElement<HTMLInputElement>(
      panel,
      '.content-gate__rights input[type="checkbox"]',
    );
    const button = requiredElement<HTMLButtonElement>(panel, ".content-gate__finish > button");
    const status = requiredElement<HTMLParagraphElement>(panel, ".content-gate__status");
    const drop = requiredElement<HTMLElement>(panel, ".content-gate__drop");
    const archiveSection = requiredElement<HTMLElement>(panel, '[data-gate-section="archive"]');
    const saveModeFieldset = requiredElement<HTMLFieldSetElement>(panel, ".content-gate__save-mode");
    const localSaveDetail = requiredElement<HTMLElement>(panel, '[data-mode-detail="local"]');
    const localSaveStatus = requiredElement<HTMLElement>(panel, "[data-local-save-status]");
    const credentials = requiredElement<HTMLElement>(panel, ".content-gate__credentials");
    const loginForm = requiredElement<HTMLFormElement>(panel, "#official-login-form");
    const loginUsernameInput = requiredElement<HTMLInputElement>(
      loginForm,
      'input[name="username"]',
    );
    const tokenInput = requiredElement<HTMLInputElement>(loginForm, 'input[name="password"]');
    const loginButton = requiredElement<HTMLButtonElement>(panel, ".content-gate__login");
    const loginStatus = requiredElement<HTMLElement>(panel, ".content-gate__login-status");
    const register = requiredElement<HTMLElement>(panel, ".content-gate__register");
    const registerButton = requiredElement<HTMLButtonElement>(panel, ".content-gate__register-open");
    const registrationStatus = requiredElement<HTMLParagraphElement>(
      panel,
      "[data-registration-status]",
    );
    const registrationRetry = requiredElement<HTMLButtonElement>(
      panel,
      ".content-gate__registration-retry",
    );
    const finishSection = requiredElement<HTMLElement>(panel, '[data-gate-section="finish"]');
    const finishHint = requiredElement<HTMLElement>(panel, ".content-gate__finish-hint");
    const saveModeInputs = [...panel.querySelectorAll<HTMLInputElement>('input[name="save-mode"]')];
    const localModeInput = requiredElement<HTMLInputElement>(
      panel,
      'input[name="save-mode"][value="local"]',
    );
    const officialModeInput = requiredElement<HTMLInputElement>(
      panel,
      'input[name="save-mode"][value="official"]',
    );
    const officialModeRow = requiredElement<HTMLElement>(panel, '[data-mode-row="official"]');
    const onlineUnavailableNote = requiredElement<HTMLElement>(
      officialModeRow,
      ".content-gate__mode-unavailable",
    );
    const settingsButtons = [
      ...panel.querySelectorAll<HTMLButtonElement>("[data-storage-settings]"),
    ];

    const scenarioGate = scenarioFeature?.installScenarioGate(panel);
    let gateMemory: ContentGateMemory = readContentGateMemory();
    if (gateMemory.lastMode !== undefined) {
      const rememberedInput = saveModeInputs.find(
        (input) => input.value === gateMemory.lastMode,
      );
      if (rememberedInput !== undefined) rememberedInput.checked = true;
    }
    const selectedMode = (): "local" | "official" | "scenario" | undefined =>
      saveModeInputs.find((input) => input.checked)?.value as
        | "local"
        | "official"
        | "scenario"
        | undefined;
    const networkMode = (): boolean => selectedMode() === "official";

    // Import once per selected File and reuse the parsed archive for hashing, fingerprinting, and
    // final load. `selectedFile` may be reconstructed from the client-only IndexedDB cache, so it
    // deliberately does not depend on the native picker retaining a value across reloads.
    let selectedFile: File | undefined;
    let selectedModFiles: readonly File[] = Object.freeze([]);
    // Which mod wins an overwrite is decided by activation order, so the order is derived from
    // declared relations rather than from the picker. These are the player's manual tie-breaks.
    let modPriorityOverrides: Record<string, number> = readModOrderOverrides();
    let allowDeclaredConflicts = false;
    let modPackages: readonly CodeModPackage[] = Object.freeze([]);
    let modProfile: ResolvedCodeModProfile | undefined;
    let modResolutionError: string | undefined;
    let modConflictOverridable = false;
    // Disposal restores registered host seams, but arbitrary same-realm mod side effects are not
    // reversible. Once code starts, only a document reload can establish a clean Online client.
    let modCodeWasActivated = false;
    let serverStatus: OnlineServerStatus = "checking";
    let profilesDialog: HTMLDialogElement | undefined;
    let profileViews: readonly PlayProfileView[] = Object.freeze([]);
    let cachedModArchives: readonly CachedModArchive[] = Object.freeze([]);
    let cachedArchiveDigest: string | undefined;
    let cachedArchiveByteLength: number | undefined;
    let profilesGeneration = 0;
    let selectionDialog: HTMLDialogElement | undefined;
    /** Collapsed until this device is known to hold cached packages, or the player selects some. */
    let modsExpanded = false;
    let importedContent: ImportedContentPackage | undefined;
    let importPromise: Promise<ImportedContentPackage> | undefined;
    let importedFor: File | undefined;
    let importedModsFor: readonly File[] | undefined;
    let importedBytes: Uint8Array<ArrayBuffer> | undefined;
    let importedBytesFor: File | undefined;
    let archiveDigestPromise: Promise<string> | undefined;
    let archiveDigestFor: File | undefined;
    let archiveDigest: string | undefined;
    let fingerprint: ContentFingerprint | undefined;
    let landingBackdrop: PreparedSourceLandingBackdrop | undefined;
    let localSaveProbe:
      | { readonly phase: "idle" }
      | { readonly phase: "checking"; readonly file: File }
      | {
          readonly phase: "ready";
          readonly file: File;
          readonly store: BrowserSaveConnection;
        }
      | { readonly phase: "error"; readonly file: File; readonly message: string } = {
        phase: "idle",
      };
    let localSaveProbeGeneration = 0;
    let busy = false;
    let archiveGeneration = 0;

    let storageDialogGeneration = 0;
    let activeStorageDialog: {
      readonly dialog: HTMLDialogElement;
    } | undefined;

    const closeStorageDialog = (): void => {
      storageDialogGeneration++;
      const active = activeStorageDialog;
      activeStorageDialog = undefined;
      if (active === undefined) return;
      if (active.dialog.open) active.dialog.close();
      active.dialog.remove();
    };

    const discardImport = (): void => {
      localSaveProbeGeneration++;
      localSaveProbe = { phase: "idle" };
      landingBackdrop?.dismiss();
      landingBackdrop = undefined;
      panel.classList.remove("content-gate--themed");
      importedContent?.dispose();
      importedContent = undefined;
      importPromise = undefined;
      importedFor = undefined;
      importedModsFor = undefined;
      importedBytes = undefined;
      importedBytesFor = undefined;
      archiveDigestPromise = undefined;
      archiveDigestFor = undefined;
      archiveDigest = undefined;
      fingerprint = undefined;
      scenarioGate?.setContent(undefined);
    };
    const ensureImported = (): Promise<ImportedContentPackage> => {
      const file = selectedFile;
      if (!file) return Promise.reject(new Error("Select an asset archive first."));
      const modFiles = selectedModFiles;
      if (importPromise && importedFor === file && importedModsFor === modFiles) return importPromise;
      discardImport();
      importedFor = file;
      importedModsFor = modFiles;
      const pending = file.arrayBuffer()
        .then((buffer) => {
          const bytes = new Uint8Array(buffer);
          if (selectedFile === file) {
            importedBytes = bytes;
            importedBytesFor = file;
          }
          return importContentArchive(bytes, file.name);
        })
        .then(async (baseContent) => {
          let backdrop: PreparedSourceLandingBackdrop | undefined;
          try {
            if (modFiles.length > 0 && modProfile === undefined) {
              throw new Error(modResolutionError ?? "Selected mods could not be resolved.");
            }
            let content: ImportedContentPackage;
            if (modFiles.length === 0) {
              content = baseContent;
            } else {
              // Latch before invoking user code, including a package that throws partway through
              // activation after already changing the shared page realm.
              modCodeWasActivated = true;
              content = await applyFullTrustModsToContent(baseContent, modPackages, {
                priorityOverrides: modPriorityOverrides,
                allowDeclaredConflicts,
              });
            }
            backdrop = await prepareSourceLandingBackdrop(content);
            if (importedFor !== file || importedModsFor !== modFiles) {
              backdrop.dismiss();
              content.dispose();
              return content;
            }
            backdrop.mount(panel);
            importedContent = content;
            landingBackdrop = backdrop;
            panel.classList.add("content-gate--themed");
            scenarioGate?.setContent(content);
            return content;
          } catch (error) {
            backdrop?.dismiss();
            baseContent.dispose();
            throw error;
          }
        });
      pending.catch(() => {
        if (importedFor === file && importedModsFor === modFiles) {
          importPromise = undefined;
          importedFor = undefined;
          importedModsFor = undefined;
        }
      });
      importPromise = pending;
      return pending;
    };

    const ensureArchiveDigest = async (): Promise<string> => {
      const file = selectedFile;
      if (file === undefined) throw new Error("Select an asset archive first.");
      if (archiveDigest !== undefined && archiveDigestFor === file) return archiveDigest;
      if (archiveDigestPromise !== undefined && archiveDigestFor === file) {
        return await archiveDigestPromise;
      }
      await ensureImported();
      if (selectedFile !== file) throw new Error("The selected archive changed while hashing.");
      const bytes = importedBytesFor === file && importedBytes !== undefined
        ? importedBytes
        : new Uint8Array(await file.arrayBuffer());
      archiveDigestFor = file;
      const pending = sha256ArchiveBytes(bytes).then((digest) => {
        if (selectedFile === file) archiveDigest = digest;
        return digest;
      });
      pending.catch(() => {
        if (archiveDigestFor === file) {
          archiveDigestPromise = undefined;
          archiveDigestFor = undefined;
        }
      });
      archiveDigestPromise = pending;
      return await pending;
    };

    const loginRequests = new Map<string, { readonly file: File; readonly token: string }>();
    let pendingCreatedCredential:
      | { readonly username: string; readonly loginToken: string }
      | undefined;
    const loginSession = new OnlineLoginSession<RemoteGameAuthority>(async (key) => {
      assertOnlinePlayAvailable({
        selectedModCount: selectedModFiles.length,
        modCodeWasActivated,
        serverStatus,
      });
      const request = loginRequests.get(key);
      if (request === undefined) throw new Error("This login attempt is no longer current.");
      const content = await ensureImported();
      if (selectedFile !== request.file) {
        throw new Error("The selected archive changed while logging in. Try again.");
      }
      const identity = await identifyContentLogicPack(content);
      return await RemoteGameAuthority.authenticate({
        endpoint: "",
        loginToken: request.token,
        logicPackId: identity.logicPackId,
        expectedSimulationVersion: OFFICIAL_CLIENT_SIMULATION_VERSION,
      });
    });
    const currentLoginKey = (): string | undefined => {
      if (
        selectedFile === undefined ||
        !onlinePlayAvailability({
          selectedModCount: selectedModFiles.length,
          modCodeWasActivated,
          serverStatus,
        }).available ||
        tokenInput.value.length < MIN_TOKEN_LENGTH
      ) {
        return undefined;
      }
      return JSON.stringify([archiveGeneration, tokenInput.value]);
    };
    const authenticatedAuthority = (): RemoteGameAuthority | undefined => {
      const key = currentLoginKey();
      const snapshot = loginSession.snapshot();
      return key !== undefined && snapshot.phase === "authenticated" && snapshot.key === key
        ? snapshot.authority
        : undefined;
    };
    const authenticateOnline = async (): Promise<void> => {
      const file = selectedFile;
      const key = currentLoginKey();
      if (file === undefined || key === undefined || busy) return;
      loginRequests.set(key, { file, token: tokenInput.value });
      const attempt = loginSession.authenticate(key);
      update();
      await attempt;
      loginRequests.delete(key);
      if (authenticatedAuthority() !== undefined) pendingCreatedCredential = undefined;
      update();
    };
    const invalidateLogin = (): void => {
      void loginSession.invalidate().finally(update);
      update();
    };

    const openStorageDialog = (mode: "local" | "official"): void => {
      closeStorageDialog();
      const generation = ++storageDialogGeneration;
      const dialog = document.createElement("dialog");
      dialog.className = "content-gate__storage-dialog";
      dialog.setAttribute("aria-labelledby", `storage-dialog-title-${mode}`);
      dialog.innerHTML = `
        <div class="content-gate__storage-dialog-card">
          <header class="content-gate__storage-dialog-header">
            <span class="content-gate__storage-dialog-mark">${saveIcon()}</span>
            <span>
              <span class="content-gate__storage-dialog-eyebrow">Save storage</span>
              <strong id="storage-dialog-title-${mode}">${
                mode === "local" ? "Offline settings" : "Online settings"
              }</strong>
            </span>
            <button class="content-gate__dialog-close content-gate__icon-button" type="button"
                    aria-label="Close save settings" title="Close">${closeIcon()}</button>
          </header>
          <section class="content-gate__backup">
            <div class="content-gate__storage-loading" role="status">
              <span class="content-gate__storage-loading-icon">${storageIcon(mode)}</span>
              <strong>Preparing save slots…</strong>
              <span>${
                mode === "local"
                  ? "Select a compatible archive to manage its Offline saves."
                  : "Select a compatible archive and enter your login token to view Online exports."
              }</span>
            </div>
          </section>
        </div>`;
      panel.appendChild(dialog);
      activeStorageDialog = { dialog };
      const body = requiredElement<HTMLElement>(dialog, ".content-gate__backup");
      const closeButton = requiredElement<HTMLButtonElement>(
        dialog,
        ".content-gate__dialog-close",
      );
      closeButton.addEventListener("click", closeStorageDialog);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeStorageDialog();
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) closeStorageDialog();
      });
      dialog.showModal();
      closeButton.focus();

      void (async () => {
        const file = selectedFile;
        if (file === undefined) {
          throw new Error("Select a compatible game-content archive first.");
        }
        if (mode === "official") {
          assertOnlinePlayAvailable({
            selectedModCount: selectedModFiles.length,
            modCodeWasActivated,
            serverStatus,
          });
        }
        const content = await ensureImported();
        const contentFingerprint = fingerprint ?? await fingerprintContentPackage(content);
        fingerprint = contentFingerprint;
        let store: SaveSlotStore;
        if (mode === "official") {
          const authority = authenticatedAuthority();
          if (authority === undefined) {
            throw new Error("Log in before opening Online save exports.");
          }
          store = new OfficialAuthoritySaveStore(authority);
        } else {
          if (localSaveProbe.phase === "ready" && localSaveProbe.file === file) {
            store = localSaveProbe.store;
          } else {
            // Save settings and startup must share one connection: BrowserSaveConnection caches
            // slot summaries, so importing/deleting/restoring through a sibling instance would
            // leave the subsequently mounted save selector stale.
            localSaveProbeGeneration++;
            const connection = BrowserSaveConnection.forContent(
              contentFingerprint,
              undefined,
              releaseRememberedArchive,
            );
            store = connection;
            localSaveProbe = { phase: "ready", file, store: connection };
            update();
          }
        }
        if (generation !== storageDialogGeneration || activeStorageDialog?.dialog !== dialog) return;
        await installSaveBackupPanel({
          container: body,
          store,
          nativeSave: nativeSaveContextFor(content),
          mode: mode === "local" ? "offline" : "online",
        });
      })().catch((error: unknown) => {
        if (generation !== storageDialogGeneration || activeStorageDialog?.dialog !== dialog) return;
        body.innerHTML = `
          <div class="content-gate__storage-loading content-gate__storage-loading--error"
               role="alert">
            <span class="content-gate__storage-loading-icon">${warningIcon()}</span>
            <strong>Save settings unavailable</strong>
            <span></span>
          </div>`;
        requiredElement<HTMLElement>(body, ".content-gate__storage-loading span:last-child")
          .textContent = describeError(error);
      });
    };

    // The probe is unauthenticated and cheap, but it still only runs once the player actually asks
    // for Online play: an offline session must reach the game without touching the network at all.
    let registrationProbe: Promise<void> | undefined;
    let registerDialog: HTMLDialogElement | undefined;
    const closeRegisterDialog = (): void => {
      const dialog = registerDialog;
      registerDialog = undefined;
      if (dialog === undefined) return;
      if (dialog.open) dialog.close();
      dialog.remove();
    };

    const openRegisterDialog = (limits: {
      readonly usernameMinLength: number;
      readonly usernameMaxLength: number;
    }): void => {
      closeStorageDialog();
      closeRegisterDialog();
      const dialog = document.createElement("dialog");
      dialog.className = "content-gate__storage-dialog";
      dialog.setAttribute("aria-labelledby", "register-dialog-title");
      dialog.innerHTML = `
        <div class="content-gate__storage-dialog-card">
          <header class="content-gate__storage-dialog-header">
            <span class="content-gate__storage-dialog-mark">${keyIcon()}</span>
            <span>
              <span class="content-gate__storage-dialog-eyebrow">Online play</span>
              <strong id="register-dialog-title">Create your account</strong>
            </span>
            <button class="content-gate__dialog-close content-gate__icon-button" type="button"
                    aria-label="Close account creation" title="Close">${closeIcon()}</button>
          </header>
          <form id="official-account-registration-form"
                class="content-gate__backup content-gate__register-body"
                action="/api/game/accounts" method="post" autocomplete="on">
            <label class="content-gate__token" for="official-account-username">Username
              <input type="text" id="official-account-username" name="username"
                     autocomplete="username" spellcheck="false" required
                     minlength="${limits.usernameMinLength}" maxlength="${limits.usernameMaxLength}"
                     placeholder="How other players see you">
            </label>
            <label class="content-gate__register-check">
              <input type="checkbox" name="publicScoreboard" autocomplete="off">
              <span>
                Show me on public scoreboards.
                <small>You can change this any time from the in-game menu, under
                Options &rarr; Scoreboard.</small>
              </span>
            </label>
            <div class="content-gate__register-actions">
              <button class="content-gate__register-cancel content-gate__register-open"
                      type="button">Cancel</button>
              <button class="content-gate__register-submit" type="submit" disabled>Create account</button>
            </div>
            <p class="content-gate__backup-status" aria-live="polite"></p>
          </form>
        </div>`;
      panel.appendChild(dialog);
      registerDialog = dialog;
      const body = requiredElement<HTMLFormElement>(dialog, ".content-gate__register-body");
      const usernameInput = requiredElement<HTMLInputElement>(
        dialog,
        'input[name="username"]',
      );
      const scoreboardInput = requiredElement<HTMLInputElement>(
        dialog,
        'input[name="publicScoreboard"]',
      );
      const submit = requiredElement<HTMLButtonElement>(dialog, ".content-gate__register-submit");
      const cancel = requiredElement<HTMLButtonElement>(dialog, ".content-gate__register-cancel");
      const dialogStatus = requiredElement<HTMLParagraphElement>(
        dialog,
        ".content-gate__backup-status",
      );
      const closeButton = requiredElement<HTMLButtonElement>(dialog, ".content-gate__dialog-close");
      let creating = false;
      const requestClose = (): void => {
        // The server returns a newly minted login token only once. Once the POST is in flight it
        // may commit even if the browser abandons the dialog, so keep the reveal surface alive
        // until success or failure is known.
        if (creating) return;
        const continueToLogin = pendingCreatedCredential !== undefined;
        closeRegisterDialog();
        if (continueToLogin) tokenInput.focus();
      };
      closeButton.addEventListener("click", requestClose);
      cancel.addEventListener("click", requestClose);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        requestClose();
      });
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) requestClose();
      });

      /**
       * The same rule the server applies, checked before the request rather than after it. Length
       * alone is not the rule — `ab!` is the right length and still rejected — and a name that
       * fails only on the wire comes back as a generic protocol error, which tells the player
       * nothing about what to change. Returns `undefined` for an empty field: nothing typed yet is
       * not a mistake to report, it is just not submittable.
       */
      const describeUsernameProblem = (raw: string): string | undefined => {
        const value = normalizeAccountUsername(raw);
        if (value.length === 0) return undefined;
        // The probe's limits win over the compiled-in ones: this client may be older than the
        // server it is talking to, and the server is the side that actually decides.
        if (value.length < limits.usernameMinLength) {
          return `Usernames need at least ${limits.usernameMinLength} characters.`;
        }
        if (value.length > limits.usernameMaxLength) {
          return `Usernames are at most ${limits.usernameMaxLength} characters.`;
        }
        const parsed = AccountUsernameV1Schema.safeParse(value);
        if (parsed.success) return undefined;
        // Prefer the shape complaint over zod's own length text: length was already settled above
        // against the authoritative limits, so a length issue here only means the server allows a
        // width this build does not, which is not something the player can act on.
        return parsed.error.issues.find(
          (issue) => issue.code !== "too_small" && issue.code !== "too_big",
        )?.message ?? "That username cannot be used.";
      };
      const refreshSubmit = (): void => {
        const value = normalizeAccountUsername(usernameInput.value);
        const problem = describeUsernameProblem(usernameInput.value);
        submit.disabled = creating || value.length === 0 || problem !== undefined;
        // Leave the status line alone mid-request: it is carrying "Creating your account…", and
        // the failure handler writes the server's own message over whatever this puts there.
        if (creating) return;
        dialogStatus.classList.toggle("content-gate__backup-status--error", problem !== undefined);
        dialogStatus.textContent = problem ?? "";
      };
      usernameInput.addEventListener("input", refreshSubmit);

      // The token is minted once and never recoverable, so the reveal replaces the form outright
      // rather than leaving a Create button that could burn the player's rate-limit window. The
      // player then pastes it into the stable login form: password managers see a real password
      // input event and successful form submission instead of an invisible script assignment.
      const revealToken = (loginToken: string, username: string): void => {
        body.innerHTML = `
          <div class="content-gate__register-result">
            <strong>Save this login token now.</strong>
            <p class="content-gate__register-warning"></p>
            <div class="content-gate__register-token">
              <code></code>
              <button class="content-gate__register-copy content-gate__register-open"
                      type="button">Copy</button>
            </div>
            <div class="content-gate__register-actions">
              <button class="content-gate__register-submit" type="button">Continue to login</button>
            </div>
            <p class="content-gate__backup-status" aria-live="polite"></p>
          </div>`;
        requiredElement<HTMLElement>(body, ".content-gate__register-warning").textContent =
          `It is shown only this once — the server keeps a hash of it, not the token, so it ` +
          `cannot be resent. Anyone holding it plays as ${username}. Copy it, continue, then ` +
          `paste it into Login token so your password manager can offer to save it.`;
        requiredElement<HTMLElement>(body, ".content-gate__register-token code").textContent =
          loginToken;
        const result = requiredElement<HTMLElement>(body, ".content-gate__register-result");
        result.setAttribute("role", "status");
        result.tabIndex = -1;
        const resultStatus = requiredElement<HTMLElement>(body, ".content-gate__backup-status");
        requiredElement<HTMLButtonElement>(body, ".content-gate__register-copy")
          .addEventListener("click", () => {
            void navigator.clipboard.writeText(loginToken).then(
              () => {
                resultStatus.classList.remove("content-gate__backup-status--error");
                resultStatus.textContent = "Token copied to the clipboard.";
              },
              (error: unknown) => {
                resultStatus.classList.add("content-gate__backup-status--error");
                resultStatus.textContent =
                  `Copy failed (${describeError(error)}). Select the token above and copy it.`;
              },
            );
          });
        requiredElement<HTMLButtonElement>(body, ".content-gate__register-submit")
          .addEventListener("click", requestClose);
        result.focus();
      };

      body.addEventListener("submit", (event) => {
        event.preventDefault();
        if (creating || submit.disabled) return;
        creating = true;
        refreshSubmit();
        closeButton.disabled = true;
        cancel.disabled = true;
        usernameInput.disabled = true;
        scoreboardInput.disabled = true;
        dialogStatus.classList.remove("content-gate__backup-status--error");
        dialogStatus.textContent = "Creating your account…";
        void createOnlineAccount({
          endpoint: "",
          // Normalized, not merely trimmed: the server stores the canonical form, so sending the
          // raw text would let "Ada  Lovelace" read back as a name the player did not type.
          username: normalizeAccountUsername(usernameInput.value),
          publicScoreboard: scoreboardInput.checked,
        }).then(
          (created) => {
            if (registerDialog !== dialog) return;
            creating = false;
            closeButton.disabled = false;
            pendingCreatedCredential = {
              username: created.account.username,
              loginToken: created.loginToken,
            };
            loginUsernameInput.value = created.account.username;
            tokenInput.value = "";
            invalidateLogin();
            revealToken(created.loginToken, created.account.username);
          },
          (error: unknown) => {
            if (registerDialog !== dialog) return;
            creating = false;
            closeButton.disabled = false;
            cancel.disabled = false;
            usernameInput.disabled = false;
            scoreboardInput.disabled = false;
            refreshSubmit();
            dialogStatus.classList.add("content-gate__backup-status--error");
            dialogStatus.textContent = describeError(error);
          },
        );
      });

      dialog.showModal();
      usernameInput.focus();
    };

    let registrationLimits: {
      readonly usernameMinLength: number;
      readonly usernameMaxLength: number;
    } | undefined;
    registerButton.addEventListener("click", () => {
      if (busy || registrationLimits === undefined) return;
      openRegisterDialog(registrationLimits);
    });
    registrationRetry.addEventListener("click", () => {
      if (busy) return;
      registrationProbe = undefined;
      ensureRegistrationProbe();
    });

    const ensureRegistrationProbe = (): void => {
      if (registrationProbe !== undefined) return;
      registrationStatus.classList.remove("content-gate__registration-status--error");
      registrationStatus.textContent = "Checking account availabilityâ€¦";
      registrationRetry.hidden = true;
      registrationProbe = fetchRegistrationInfo("").then(
        (info) => {
          registrationLimits = info.enabled ? info : undefined;
          register.hidden = !info.enabled;
          registrationStatus.textContent = info.enabled
            ? ""
            : "Account creation is disabled on this server.";
        },
        (error: unknown) => {
          // Pasting an existing token still works, so this is a note rather than a gate failure —
          // but it is reported, never swallowed.
          registrationLimits = undefined;
          register.hidden = true;
          registrationStatus.classList.add("content-gate__registration-status--error");
          registrationStatus.textContent =
            `Account creation is unavailable: ${describeError(error)}`;
          registrationRetry.hidden = false;
        },
      );
    };

    const update = (announceFile = false): void => {
      const file = selectedFile;
      const hasFile = file !== undefined;
      panel.classList.toggle("content-gate--has-file", hasFile);
      const onlineAvailability = onlinePlayAvailability({
        selectedModCount: selectedModFiles.length,
        modCodeWasActivated,
        serverStatus,
      });
      // A remembered or currently selected Online mode must never remain the active UI choice once
      // the server is absent or mods make it unavailable. This only changes the launcher choice;
      // an Official save is never converted to Offline. Preserve remembered Online while probing.
      if (!onlineAvailability.available && serverStatus !== "checking" && officialModeInput.checked) {
        officialModeInput.checked = false;
        localModeInput.checked = true;
      }
      const mode = selectedMode();
      const key = currentLoginKey();
      const login = loginSession.snapshot();
      const authenticating = key !== undefined && login.phase === "authenticating" &&
        login.key === key;
      const authority = authenticatedAuthority();
      const loggedIn = authority !== undefined;
      const hasMods = selectedModFiles.length > 0;
      const localSaveReady =
        mode === "local" &&
        localSaveProbe.phase === "ready" &&
        localSaveProbe.file === file;
      const modeReady = mode === "local"
        ? localSaveReady
        : mode === "official"
          ? loggedIn && onlineAvailability.available
          : mode === "scenario";

      fileInput.disabled = busy;
      modInput.disabled = busy;
      clearModsButton.disabled = busy;
      clearModsButton.hidden = !hasMods;
      modLabel.textContent = hasMods
        ? `${selectedModFiles.length} Offline ${selectedModFiles.length === 1 ? "Mod" : "Mods"} selected`
        : "Optional Offline Mods (.dibmod)";
      // One package names itself; beyond that the list is noise the Load order view owns, and an
      // empty selection needs no sentence at all — the picker below already says so.
      modStatus.textContent = !hasMods
        ? ""
        : mode === "official"
          ? "Full-trust mods are local-only. Clear them or choose Offline."
          : selectedModFiles.length === 1
            ? selectedModFiles[0]!.name
            : "";
      // Selecting packages always reveals them; the remembered default only decides the resting
      // state of an untouched gate.
      if (hasMods) modsExpanded = true;
      modToggle.setAttribute("aria-expanded", String(modsExpanded));
      modToggle.classList.toggle("content-gate__mods-toggle--open", modsExpanded);
      modBody.hidden = !modsExpanded;
      modStatus.hidden = modStatus.textContent === "";
      modWarning.hidden = !modsExpanded;
      modDetailButton.hidden = !hasMods || mode === "official";
      modDetailButton.disabled = busy;
      modActions.hidden = modDetailButton.hidden && !hasMods;
      renderProfilesDialog();
      renderSelectionDialog();
      saveModeFieldset.disabled = !hasFile || busy;
      officialModeInput.disabled = busy || !onlineAvailability.available;
      officialModeRow.classList.toggle(
        "content-gate__save-mode-row--unavailable",
        !onlineAvailability.available,
      );
      officialModeRow.setAttribute("aria-disabled", String(!onlineAvailability.available));
      onlineUnavailableNote.hidden = onlineAvailability.available;
      onlineUnavailableNote.textContent = onlineAvailability.available
        ? ""
        : onlineAvailability.reason;
      localSaveDetail.hidden = mode !== "local";
      credentials.hidden = mode !== "official" || !onlineAvailability.available;
      if (mode === "official" && onlineAvailability.available) ensureRegistrationProbe();
      scenarioGate?.update(mode === "scenario");
      for (const input of saveModeInputs) {
        input.closest(".content-gate__save-mode-row")?.classList.toggle(
          "content-gate__save-mode-row--selected",
          input.checked,
        );
      }
      saveModeFieldset.classList.toggle(
        "content-gate__section--complete",
        hasFile && modeReady,
      );
      localSaveDetail.classList.toggle("content-gate__mode-detail--complete", localSaveReady);
      credentials.classList.toggle("content-gate__mode-detail--complete", loggedIn);

      archiveSection.classList.toggle("content-gate__section--complete", hasFile);

      localSaveStatus.classList.remove(
        "content-gate__mode-detail-status--success",
        "content-gate__mode-detail-status--error",
      );
      if (mode === "local") {
        if (localSaveProbe.phase === "ready" && localSaveProbe.file === file) {
          const count = localSaveProbe.store.slots.length;
          localSaveStatus.classList.add("content-gate__mode-detail-status--success");
          localSaveStatus.textContent = count === 0
            ? "No browser saves found for this content. Click the gear icon to import existing save files."
            : `${count} browser save ${count === 1 ? "slot was" : "slots were"} detected.`;
        } else if (localSaveProbe.phase === "error" && localSaveProbe.file === file) {
          localSaveStatus.classList.add("content-gate__mode-detail-status--error");
          localSaveStatus.textContent =
            `Browser saves could not be checked: ${localSaveProbe.message}`;
        } else {
          localSaveStatus.textContent = "Checking browser savesâ€¦";
        }
      }

      tokenInput.disabled = busy || authenticating || !onlineAvailability.available;
      // Removing or hiding the submitted password form is the success signal used by browser
      // password managers for fetch-driven logins. It returns if the archive or token changes.
      loginForm.hidden = loggedIn;
      loginButton.disabled = busy || !hasFile || !onlineAvailability.available ||
        key === undefined || authenticating || loggedIn;
      loginButton.textContent = authenticating ? "Logging in…" : loggedIn ? "Logged in" : "Log in";
      registerButton.disabled = busy || authenticating || !onlineAvailability.available;
      credentials.setAttribute("aria-busy", String(authenticating));
      loginStatus.classList.remove(
        "content-gate__login-status--success",
        "content-gate__login-status--error",
      );
      if (loggedIn) {
        const username = authority.account?.current()?.username;
        loginStatus.classList.add("content-gate__login-status--success");
        loginStatus.textContent = username === undefined
          ? "Login token accepted."
          : `Logged in as ${username}.`;
      } else if (authenticating) {
        loginStatus.textContent = "Checking your token and archive…";
      } else if (key !== undefined && login.phase === "error" && login.key === key) {
        loginStatus.classList.add("content-gate__login-status--error");
        loginStatus.textContent = describeError(login.error);
      } else if (!hasFile) {
        loginStatus.textContent = "Choose an archive before logging in.";
      } else {
        loginStatus.textContent = "";
      }

      const canConfirmRights = hasFile && modeReady;
      rightsInput.disabled = busy || !canConfirmRights;
      const ready = canConfirmRights && rightsInput.checked;
      finishSection.classList.toggle("content-gate__section--blocked", !canConfirmRights);
      finishSection.classList.toggle("content-gate__section--complete", ready);
      button.textContent = mode === "official"
        ? "Play Online"
        : mode === "scenario"
          ? "Run Scenario"
          : mode === "local"
            ? "Play Offline"
            : "Choose play mode";
      button.disabled = !ready || busy;
      finishHint.textContent = !hasFile
        ? "Choose an archive to continue."
        : mode === undefined
          ? "Choose a play mode to continue."
          : mode === "official" && !onlineAvailability.available
            ? onlineAvailability.reason
          : mode === "official" && !loggedIn
            ? "Log in successfully before continuing."
            : mode === "local" && !localSaveReady
              ? "Browser saves must be checked before continuing."
              : "";
      finishHint.hidden = finishHint.textContent.length === 0;

      for (const settingsButton of settingsButtons) {
        const requiresLogin = settingsButton.dataset["storageSettings"] === "official";
        settingsButton.disabled = busy || !hasFile ||
          (requiresLogin && (!onlineAvailability.available || !loggedIn));
      }

      if (announceFile && file !== undefined) {
        status.classList.remove("content-gate__status--error");
        status.textContent = "";
      }
    };

    const inspectLocalSaves = async (): Promise<void> => {
      const file = selectedFile;
      if (file === undefined) return;
      localSaveProbe = { phase: "checking", file };
      update();
      let content: ImportedContentPackage;
      try {
        content = await ensureImported();
      } catch (error) {
        if (selectedFile !== file) return;
        localSaveProbe = { phase: "error", file, message: describeError(error) };
        update();
        return;
      }
      if (selectedFile !== file) return;
      const generation = ++localSaveProbeGeneration;
      localSaveProbe = { phase: "checking", file };
      update();
      try {
        const contentFingerprint = fingerprint ?? await fingerprintContentPackage(content);
        fingerprint = contentFingerprint;
        const store = BrowserSaveConnection.forContent(
          contentFingerprint,
          undefined,
          releaseRememberedArchive,
        );
        if (generation !== localSaveProbeGeneration || selectedFile !== file) return;
        localSaveProbe = { phase: "ready", file, store };
      } catch (error) {
        if (generation !== localSaveProbeGeneration || selectedFile !== file) return;
        localSaveProbe = { phase: "error", file, message: describeError(error) };
      }
      update();
    };

    const selectArchive = async (
      file: File | undefined,
      source: "picker" | "cache",
      expectedDigest?: string,
    ): Promise<void> => {
      closeStorageDialog();
      const generation = ++archiveGeneration;
      selectedFile = file;
      fileLabel.textContent = source === "cache" && file !== undefined
        ? `Remembered asset archive: ${file.name}`
        : "Choose asset archive (IPA/ZIP)";
      // The attestation names "this archive". It is restored only after the exact raw digest has
      // been recomputed, never from a matching filename or content/gameplay fingerprint.
      rightsInput.checked = false;
      invalidateLogin();
      discardImport();
      update(source === "picker");
      if (file === undefined) return;
      await ensureImported();
      const digest = await ensureArchiveDigest();
      if (generation !== archiveGeneration || selectedFile !== file) return;
      if (expectedDigest !== undefined && digest !== expectedDigest) {
        throw new Error("The remembered archive did not match its stored digest.");
      }
      rightsInput.checked = hasRememberedAttestation(gateMemory, digest);
      update();
      if (selectedMode() === "local") await inspectLocalSaves();
    };

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      void selectArchive(file, "picker").catch((error: unknown) => {
        if (selectedFile !== file) return;
        status.classList.add("content-gate__status--error");
        status.textContent = describeError(error);
        update();
      });
    });
    /**
     * Reads every selected archive and derives the activation order. No mod code runs here, so a
     * missing dependency, an incompatible pair, or a cycle is reported before anything executes.
     */
    async function resolveSelectedMods(files: readonly File[]): Promise<void> {
      modProfile = undefined;
      modResolutionError = undefined;
      modConflictOverridable = false;
      if (files.length === 0) {
        modPackages = Object.freeze([]);
        return;
      }
      try {
        modPackages = Object.freeze(await Promise.all(files.map(async (file) =>
          await importCodeModArchive(new Uint8Array(await file.arrayBuffer()), file.name))));
      } catch (error) {
        modPackages = Object.freeze([]);
        modResolutionError = describeError(error);
        return;
      }
      try {
        modProfile = await resolveCodeModProfile(modPackages, {
          priorityOverrides: modPriorityOverrides,
          allowDeclaredConflicts,
        });
      } catch (error) {
        modResolutionError = describeError(error);
        // A declared conflict is one author's claim about another package, not an integrity
        // failure, so the player may insist. Missing dependencies and cycles are not overridable.
        modConflictOverridable = error instanceof ModPackageError &&
          error.message.includes("declares a conflict with");
      }
    }

    const applyModSelection = async (): Promise<void> => {
      discardImport();
      await resolveSelectedMods(selectedModFiles);
      update();
      if (selectedFile === undefined) return;
      // Selection is allowed so the warning remains visible, but Official mode never evaluates
      // local code. Switching to Offline below will import and execute the selected profile.
      if (selectedMode() === "official") return;
      await ensureImported();
      update();
      if (selectedMode() === "local") await inspectLocalSaves();
    };

    const reapplyModSelection = (): void => {
      void applyModSelection().catch((error: unknown) => {
        status.classList.add("content-gate__status--error");
        status.textContent = describeError(error);
        update();
      });
    };

    /**
     * Moves one package within the resolved order. The whole order is rewritten as explicit
     * priorities so the result is total and predictable; declared dependency and load-order edges
     * still win, so a move the relations forbid visibly snaps back.
     */
    function moveSelectedMod(id: string, delta: number): void {
      const ids = (modProfile?.packages ?? []).map((pkg) => pkg.manifest.id);
      const index = ids.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target]!, ids[index]!];
      modPriorityOverrides = Object.fromEntries(ids.map((entry, at) => [entry, at * 10]));
      writeModOrderOverrides(modPriorityOverrides);
      reapplyModSelection();
    }

    const gateStorage = ((): (KeyValueStorageWithIndex) | undefined => {
      try {
        return globalThis.localStorage as unknown as KeyValueStorageWithIndex;
      } catch {
        return undefined;
      }
    })();


    const refreshProfileViews = async (): Promise<void> => {
      const generation = ++profilesGeneration;
      const [mods, archive] = await Promise.all([
        listCachedModArchives(modCache).catch(() => Object.freeze([]) as readonly CachedModArchive[]),
        loadRememberedContentArchive(archiveCache).catch(() => undefined),
      ]);
      if (generation !== profilesGeneration) return;
      cachedModArchives = mods;
      cachedArchiveDigest = archive?.digest;
      cachedArchiveByteLength = archive?.byteLength;
      profileViews = composePlayProfileViews(
        readPlayProfiles(gateStorage),
        readSaveSlotIndex(gateStorage),
        {
          archiveDigest: cachedArchiveDigest,
          ...(cachedArchiveByteLength === undefined
            ? {}
            : { archiveByteLength: cachedArchiveByteLength }),
          modDigests: new Set(mods.map((mod) => mod.digest)),
          modByteLengths: new Map(mods.map((mod) => [mod.digest, mod.byteLength])),
        },
        readDismissedProfiles(gateStorage),
      );
    };

    const cachedModFilesForProfile = (record: PlayProfileRecord): readonly File[] | undefined => {
      const files: File[] = [];
      for (const mod of record.mods) {
        const cached = cachedModArchives.find((entry) => entry.digest === mod.digest);
        if (cached === undefined) return undefined;
        files.push(new File([cached.bytes], cached.archiveName, {
          type: cached.bytes.type || "application/zip",
          lastModified: new Date(cached.cachedAt).getTime(),
        }));
      }
      return Object.freeze(files);
    };

    /**
     * Restores a remembered pairing from this device alone. Cached mod bytes are executable, so
     * this only repopulates the pickers — the player still launches deliberately.
     */
    const usePlayProfile = async (view: PlayProfileView): Promise<void> => {
      const record = view.record;
      if (record === undefined || !view.restorable) return;
      const remembered = await loadRememberedContentArchive(archiveCache);
      if (remembered === undefined || remembered.digest !== record.archiveDigest) {
        await refreshProfileViews();
        renderProfilesDialog();
        throw new Error("This profile's game content is no longer on this device.");
      }
      const modFiles = cachedModFilesForProfile(record);
      if (modFiles === undefined) {
        await refreshProfileViews();
        renderProfilesDialog();
        throw new Error("One or more mods in this profile are no longer cached on this device.");
      }
      closeProfilesDialog();
      const archiveFile = new File([remembered.bytes], remembered.archiveName, {
        type: remembered.bytes.type || "application/zip",
        lastModified: new Date(remembered.cachedAt).getTime(),
      });
      // Restoring the mods first keeps the single archive import from running twice.
      selectedModFiles = Object.freeze(modFiles);
      allowDeclaredConflicts = false;
      modInput.value = "";
      gateMemory = withRememberedModProfileRestore(gateMemory, true);
      writeContentGateMemory(gateMemory);
      await selectArchive(archiveFile, "cache", remembered.digest);
      status.classList.remove("content-gate__status--error");
      status.textContent = `Restored ${view.label} from this device.`;
      update();
    };

    const currentModSummary = (): string => {
      const packages = modProfile?.packages ?? [];
      if (packages.length === 0) return "no mods";
      return packages.length === 1
        ? `${packages[0]!.manifest.displayName} ${packages[0]!.manifest.version}`
        : `${packages.length} mods`;
    };

    /** Clone, never move, one foreign-profile slot into the currently selected Offline identity. */
    const trySaveWithCurrentSelection = async (
      view: PlayProfileView,
      slotId: (typeof view.saveSlots)[number]["slotId"],
    ): Promise<void> => {
      const probe = localSaveProbe;
      if (selectedFile === undefined || probe.phase !== "ready" || probe.file !== selectedFile) {
        throw new Error("Wait for the selected Offline content to finish checking its saves.");
      }
      if (probe.store.saveNamespace === view.namespace) {
        throw new Error("That save already belongs to the selected Offline content.");
      }
      if (probe.store.summary(slotId) !== undefined) {
        throw new Error(`${slotId} already has a save under the selected content; it was not overwritten.`);
      }
      const accepted = globalThis.confirm(
        `DANGEROUS SAVE COMPATIBILITY OVERRIDE\n\n` +
        `Try ${slotId} from “${view.label}” with the current ${currentModSummary()} setup?\n\n` +
        `The game will clone the save and attempt to load it. The original stays untouched. ` +
        `Items that no longer exist will be ignored, but removed monsters, worlds, quests, or ` +
        `unforeseen mod state can still crash the game or corrupt the cloned copy after it saves.\n\n` +
        `Keep the original and a backup. Continue only if you accept that risk.`,
      );
      if (!accepted) return;
      await probe.store.cloneSlotFromNamespace(view.namespace, slotId);
      await refreshProfileViews();
      renderProfilesDialog();
      status.classList.remove("content-gate__status--error");
      status.textContent = `${slotId} was cloned for a risky compatibility attempt; the original was preserved.`;
      update();
    };

    /** Permanently removes one explicitly confirmed slot without touching its content profile. */
    const deleteProfileSaveSlot = async (
      view: PlayProfileView,
      slotId: (typeof view.saveSlots)[number]["slotId"],
    ): Promise<void> => {
      const accepted = globalThis.confirm(
        `DELETE OFFLINE SAVE PERMANENTLY\n\n` +
        `Delete ${slotId} from "${view.label}"?\n\n` +
        `This deletes the current save and its retained rollback revision from this browser. ` +
        `The game-content archive, mods, other slots, and profile cache are not deleted.\n\n` +
        `This cannot be undone unless you exported a backup.`,
      );
      if (!accepted) return;
      const activeProbe = localSaveProbe;
      const store = activeProbe.phase === "ready" &&
          activeProbe.store.saveNamespace === view.namespace
        ? activeProbe.store
        : (() => {
            if (gateStorage === undefined) {
              throw new Error("Browser save storage is unavailable.");
            }
            return BrowserSaveConnection.forNamespace(view.namespace, gateStorage);
          })();
      await store.deleteSlot(slotId);
      await refreshProfileViews();
      renderProfilesDialog();
      status.classList.remove("content-gate__status--error");
      status.textContent = `${slotId} was permanently deleted from ${view.label}.`;
      update();
    };

    const forgetCachedContent = async (view: PlayProfileView, digest: string): Promise<void> => {
      if (view.record?.archiveDigest === digest) await releaseRememberedArchive();
      else await modCache.delete(digest);
      await refreshProfileViews();
      renderProfilesDialog();
    };

    /**
     * Takes one row out of the list. The pairing record is dropped and the namespace is dismissed,
     * so an unidentified row can be tidied away too, but the save slots are deliberately untouched:
     * a cleanup button must not be able to destroy a playthrough whose label is only a hash. Saves
     * are removed from the save-storage dialog, and playing the pairing again brings the row back.
     */
    const removeProfileFromList = async (view: PlayProfileView): Promise<void> => {
      if (view.record !== undefined) forgetPlayProfile(gateStorage, view.namespace);
      dismissPlayProfile(gateStorage, view.namespace);
      await refreshProfileViews();
      renderProfilesDialog();
    };

    function textRow(className: string, text: string): HTMLElement {
      const node = document.createElement("p");
      node.className = className;
      node.textContent = text;
      return node;
    }

    /** Icon-only affordance. `icon` is one of this module's own SVG constants, never author text. */
    function iconButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "content-gate__profile-action content-gate__profile-action--icon";
      button.innerHTML = icon;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.disabled = busy;
      button.addEventListener("click", onClick);
      return button;
    }

    function textButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "content-gate__profile-action";
      button.textContent = label;
      button.title = title;
      button.disabled = busy;
      button.addEventListener("click", onClick);
      return button;
    }

    const reportProfileError = (error: unknown): void => {
      status.classList.add("content-gate__status--error");
      status.textContent = describeError(error);
      update();
    };

    /** The current picker selection: resolved activation order, advisories, and shared seams. */
    function renderCurrentSelection(root: HTMLElement): void {
      root.replaceChildren();
      const packages = modProfile?.packages ?? [];
      const archiveRow = document.createElement("div");
      archiveRow.className = "content-gate__profile-content";
      const archiveName = document.createElement("span");
      archiveName.className = "content-gate__profile-content-name";
      archiveName.textContent = selectedFile?.name ?? "No asset archive selected";
      archiveRow.append(archiveName);
      if (selectedFile !== undefined) {
        const archiveSize = document.createElement("span");
        archiveSize.className = "content-gate__profile-content-state";
        archiveSize.textContent = formatShortFileSize(selectedFile.size);
        archiveRow.append(archiveSize);
      }
      root.append(archiveRow);

      if (packages.length === 0 && modResolutionError === undefined) {
        root.append(textRow("content-gate__profile-note", "No mods selected."));
      }

      if (packages.length > 0) {
        const list = document.createElement("ol");
        list.className = "content-gate__mods-order";
        for (const pkg of packages) {
          const row = document.createElement("li");
          row.className = "content-gate__mods-row";
          const name = document.createElement("span");
          name.className = "content-gate__mods-name";
          // Manifest text is untrusted author input and is only ever set as a text node.
          name.textContent = pkg.manifest.displayName;
          const version = document.createElement("small");
          const sourceIndex = modPackages.findIndex((entry) => entry.digest === pkg.digest);
          const byteLength = sourceIndex < 0 ? undefined : selectedModFiles[sourceIndex]?.size;
          version.textContent = byteLength === undefined
            ? pkg.manifest.version
            : `${pkg.manifest.version} · ${formatShortFileSize(byteLength)}`;
          name.append(" ", version);
          const moves = document.createElement("span");
          moves.className = "content-gate__mods-move";
          const controls = [[-1, "\u2191", "earlier"], [1, "\u2193", "later"]] as const;
          for (const [delta, glyph, action] of controls) {
            const move = document.createElement("button");
            move.type = "button";
            move.textContent = glyph;
            move.title = `Load ${pkg.manifest.id} ${action}`;
            move.disabled = busy || packages.length < 2;
            move.addEventListener("click", () => { moveSelectedMod(pkg.manifest.id, delta); });
            moves.append(move);
          }
          row.append(name, moves);
          list.append(row);
        }
        root.append(list);
      }

      const interference = importedContent !== undefined && hasImportedModProfile(importedContent)
        ? importedContent.modProfile.interference
        : undefined;
      if (packages.length > 1) {
        root.append(textRow(
          "content-gate__mods-note",
          "Activation order above. A later mod overwrites an earlier one.",
        ));
      }
      if (modResolutionError !== undefined) {
        root.append(textRow("content-gate__mods-note content-gate__mods-note--error", modResolutionError));
      }
      for (const advisory of modProfile?.advisories ?? []) {
        root.append(textRow("content-gate__mods-note", advisory.message));
      }
      const seams = interference?.seams ?? [];
      if (seams.length > 0) {
        root.append(textRow(
          "content-gate__mods-note",
          `${seams.length} shared ${seams.length === 1 ? "seam" : "seams"}; ` +
          `${interference?.warnings.length ?? 0} where a later mod discards an earlier one.`,
        ));
        for (const seam of seams.slice(0, MAX_LISTED_SEAMS)) {
          root.append(textRow(
            `content-gate__mods-note content-gate__mods-note--${seam.severity === "warning" ? "warn" : "info"}`,
            `${seam.target} - ${seam.summary}`,
          ));
        }
        if (seams.length > MAX_LISTED_SEAMS) {
          root.append(textRow(
            "content-gate__mods-note",
            `+${seams.length - MAX_LISTED_SEAMS} more in the browser console.`,
          ));
        }
      }
      if (modConflictOverridable) {
        const override = document.createElement("button");
        override.type = "button";
        override.className = "content-gate__mods-override";
        override.textContent = "Load anyway";
        override.disabled = busy;
        override.addEventListener("click", () => {
          allowDeclaredConflicts = true;
          reapplyModSelection();
        });
        root.append(override);
      }
    }

    /** Remembered archive+mod pairings that own an Offline save on this device. */
    function renderSavedProfiles(root: HTMLElement): void {
      root.replaceChildren();
      if (profileViews.length === 0) {
        root.append(textRow(
          "content-gate__profile-note",
          "No Offline saves yet. Launch once and the pairing is remembered here.",
        ));
        return;
      }
      for (const view of profileViews) {
        const card = document.createElement("article");
        card.className = view.restorable
          ? "content-gate__profile"
          : "content-gate__profile content-gate__profile--partial";

        const header = document.createElement("header");
        header.className = "content-gate__profile-header";
        const label = document.createElement("strong");
        label.textContent = view.label;
        const saves = document.createElement("span");
        saves.className = "content-gate__profile-saves";
        saves.textContent = `${view.saveSlots.length} ${view.saveSlots.length === 1 ? "save" : "saves"}`;
        header.append(label, saves);
        if (view.restorable) {
          header.append(textButton("Use", `Restore ${view.label}`, () => {
            void usePlayProfile(view).catch(reportProfileError);
          }));
        }
        header.append(iconButton(trashIcon(), "Remove this pairing from the list; saves are kept", () => {
          void removeProfileFromList(view).catch(reportProfileError);
        }));
        card.append(header);

        for (const entry of view.contents) {
          const row = document.createElement("div");
          row.className = entry.cached
            ? "content-gate__profile-content"
            : "content-gate__profile-content content-gate__profile-content--ghost";
          const name = document.createElement("span");
          name.className = "content-gate__profile-content-name";
          name.textContent = entry.detail === undefined
            ? entry.label
            : `${entry.label} ${entry.detail}`;
          const state = document.createElement("span");
          state.className = "content-gate__profile-content-state";
          state.textContent = entry.byteLength === undefined
            ? entry.cached ? "cached" : "missing"
            : `${entry.cached ? "cached" : "missing"} · ${formatShortFileSize(entry.byteLength)}`;
          row.append(name, state);
          if (entry.cached) {
            row.append(iconButton(closeIcon(), `Remove the cached ${entry.kind}`, () => {
              void forgetCachedContent(view, entry.digest).catch(reportProfileError);
            }));
          } else {
            const upload = document.createElement("label");
            upload.className =
              "content-gate__profile-action content-gate__profile-action--icon content-gate__profile-upload";
            upload.title = `Upload this ${entry.kind}`;
            upload.innerHTML = uploadIcon();
            const input = document.createElement("input");
            input.type = "file";
            input.hidden = true;
            input.accept = entry.kind === "archive"
              ? ".ipa,.zip,application/zip,application/octet-stream"
              : ".dibmod,application/zip,application/octet-stream";
            input.addEventListener("change", () => {
              const file = input.files?.[0];
              if (file === undefined) return;
              closeProfilesDialog();
              if (entry.kind === "archive") {
                void selectArchive(file, "picker").catch(reportProfileError);
                return;
              }
              void selectMods([...selectedModFiles, file]).catch(reportProfileError);
            });
            upload.append(input);
            row.append(upload);
          }
          card.append(row);
        }

        const currentNamespace = localSaveProbe.phase === "ready" &&
            localSaveProbe.file === selectedFile
          ? localSaveProbe.store.saveNamespace
          : undefined;
        for (const save of view.saveSlots) {
          const row = document.createElement("div");
          row.className = "content-gate__profile-content";
          const name = document.createElement("span");
          name.className = "content-gate__profile-content-name";
          name.textContent = save.slotId.replace("slot-", "Slot ");
          const state = document.createElement("span");
          state.className = "content-gate__profile-content-state";
          state.textContent = save.updatedAt ?? "saved";
          row.append(name, state);
          if (currentNamespace !== undefined && currentNamespace !== view.namespace) {
            const destinationOccupied = localSaveProbe.phase === "ready" &&
              localSaveProbe.store.summary(save.slotId) !== undefined;
            const tryButton = textButton(
              "Try here",
              destinationOccupied
                ? `${save.slotId} is already occupied under the selected content`
                : `Clone ${save.slotId} and try it with the selected content`,
              () => { void trySaveWithCurrentSelection(view, save.slotId).catch(reportProfileError); },
            );
            tryButton.disabled = busy || destinationOccupied;
            row.append(tryButton);
          }
          const deleteButton = textButton(
            "Delete",
            `Permanently delete ${save.slotId} from ${view.label}`,
            () => { void deleteProfileSaveSlot(view, save.slotId).catch(reportProfileError); },
          );
          deleteButton.disabled = busy;
          row.append(deleteButton);
          card.append(row);
        }

        if (view.record === undefined) {
          card.append(textRow(
            "content-gate__profile-note",
            "Launch this content once to identify it.",
          ));
        }
        root.append(card);
      }
    }

    function renderProfilesDialog(): void {
      const dialog = profilesDialog;
      if (dialog === undefined) return;
      renderSavedProfiles(requiredElement<HTMLElement>(dialog, "[data-profiles-saved]"));
    }

    function renderSelectionDialog(): void {
      const dialog = selectionDialog;
      if (dialog === undefined) return;
      renderCurrentSelection(requiredElement<HTMLElement>(dialog, "[data-selection-current]"));
    }

    function closeProfilesDialog(): void {
      const dialog = profilesDialog;
      profilesDialog = undefined;
      dismissDialog(dialog);
    }

    function closeSelectionDialog(): void {
      const dialog = selectionDialog;
      selectionDialog = undefined;
      dismissDialog(dialog);
    }

    function dismissDialog(dialog: HTMLDialogElement | undefined): void {
      if (dialog === undefined) return;
      if (dialog.open) dialog.close();
      dialog.remove();
    }

    /**
     * Both gate dialogs share this chrome. They are deliberately separate surfaces: profiles are
     * about content this device remembers, load order is about the selection in hand.
     */
    function buildDialog(
      id: string,
      eyebrow: string,
      title: string,
      mark: string,
      body: string,
      onClose: () => void,
    ): HTMLDialogElement {
      const dialog = document.createElement("dialog");
      dialog.className = "content-gate__profiles-dialog";
      dialog.setAttribute("aria-labelledby", `${id}-title`);
      dialog.innerHTML = `
        <div class="content-gate__profiles-card">
          <header class="content-gate__storage-dialog-header">
            <span class="content-gate__storage-dialog-mark">${mark}</span>
            <span>
              <span class="content-gate__storage-dialog-eyebrow">${eyebrow}</span>
              <strong id="${id}-title">${title}</strong>
            </span>
            <button class="content-gate__dialog-close content-gate__icon-button" type="button"
                    aria-label="Close ${title}" title="Close">${closeIcon()}</button>
          </header>
          ${body}
        </div>
      `;
      panel.append(dialog);
      requiredElement<HTMLButtonElement>(dialog, ".content-gate__dialog-close")
        .addEventListener("click", onClose);
      dialog.addEventListener("cancel", onClose);
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) onClose();
      });
      dialog.showModal();
      return dialog;
    }

    const openProfilesDialog = (): void => {
      closeStorageDialog();
      closeSelectionDialog();
      closeProfilesDialog();
      profilesDialog = buildDialog(
        "profiles-dialog",
        "Offline",
        "Profiles",
        starIcon(),
        `<div class="content-gate__profiles-list" data-profiles-saved></div>`,
        () => { closeProfilesDialog(); },
      );
      renderProfilesDialog();
      void refreshProfileViews().then(renderProfilesDialog).catch(reportProfileError);
    };

    const openSelectionDialog = (): void => {
      closeStorageDialog();
      closeProfilesDialog();
      closeSelectionDialog();
      selectionDialog = buildDialog(
        "selection-dialog",
        "Mods",
        "Load order",
        tuneIcon(),
        `<div data-selection-current></div>`,
        () => { closeSelectionDialog(); },
      );
      renderSelectionDialog();
    };

    for (const trigger of panel.querySelectorAll<HTMLElement>("[data-profiles-action]")) {
      trigger.addEventListener("click", () => { openProfilesDialog(); });
    }
    for (const trigger of panel.querySelectorAll<HTMLElement>("[data-selection-action]")) {
      trigger.addEventListener("click", () => { openSelectionDialog(); });
    }
    modToggle.addEventListener("click", () => {
      modsExpanded = !modsExpanded;
      update();
    });

    const selectMods = async (files: readonly File[]): Promise<void> => {
      closeStorageDialog();
      selectedModFiles = Object.freeze([...files]);
      allowDeclaredConflicts = false;
      if (files.length > 0) {
        console.warn(
          "Full-trust .dibmod files selected. They run inside the game page with the same access as the app:",
          files.map((file) => file.name),
        );
      }
      invalidateLogin();
      await applyModSelection();
    };
    modInput.addEventListener("change", () => {
      const files = [...(modInput.files ?? [])];
      void selectMods(files).catch((error: unknown) => {
        status.classList.add("content-gate__status--error");
        status.textContent = describeError(error);
        update();
      });
    });
    clearModsButton.addEventListener("click", () => {
      modInput.value = "";
      // Clearing is an explicit selection choice. Keep cached packages for save-linked profiles,
      // but do not immediately repopulate this same profile when the required clean-tab reload
      // happens after full-trust code has run.
      gateMemory = withRememberedModProfileRestore(gateMemory, false);
      writeContentGateMemory(gateMemory);
      if (modCodeWasActivated) {
        // Same-realm mod effects are not generally reversible. Reload immediately so the player
        // arrives at an actually clean, Online-eligible document instead of a dead-end message.
        globalThis.location.reload();
        return;
      }
      void selectMods([]).catch((error: unknown) => {
        status.classList.add("content-gate__status--error");
        status.textContent = describeError(error);
        update();
      });
    });
    rightsInput.addEventListener("change", () => {
      const file = selectedFile;
      const attested = rightsInput.checked;
      update();
      if (file === undefined) return;
      void ensureArchiveDigest().then((digest) => {
        if (selectedFile !== file || rightsInput.checked !== attested) return;
        gateMemory = withRememberedAttestation(gateMemory, digest, attested);
        writeContentGateMemory(gateMemory);
      }).catch(() => {
        // Hashing/storage memory is an acceleration only. The live affirmative choice still works.
      });
    });
    tokenInput.addEventListener("input", () => {
      if (
        pendingCreatedCredential !== undefined &&
        tokenInput.value !== pendingCreatedCredential.loginToken
      ) {
        const pendingUsername = pendingCreatedCredential.username;
        pendingCreatedCredential = undefined;
        // Do not erase a different username that a manager filled alongside a saved token.
        if (loginUsernameInput.value === pendingUsername) loginUsernameInput.value = "";
      }
      invalidateLogin();
    });
    loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (loginButton.disabled) return;
      void authenticateOnline();
    });
    for (const settingsButton of settingsButtons) {
      settingsButton.addEventListener("click", () => {
        if (
          scenarioGate !== undefined &&
          settingsButton.dataset["storageSettings"] === "scenario"
        ) {
          invalidateLogin();
          scenarioGate.selectAndFocus();
          closeStorageDialog();
          update();
          return;
        }
        openStorageDialog(
          settingsButton.dataset["storageSettings"] === "official" ? "official" : "local",
        );
      });
    }
    for (const input of saveModeInputs) {
      input.addEventListener("change", () => {
        closeStorageDialog();
        closeRegisterDialog();
        invalidateLogin();
        const mode = selectedMode();
        if (mode === "local" || mode === "official") {
          gateMemory = withRememberedMode(gateMemory, mode);
          writeContentGateMemory(gateMemory);
        }
        update();
        if (selectedMode() === "local") void inspectLocalSaves();
        if (networkMode()) tokenInput.focus();
      });
    }
    for (const eventName of ["dragenter", "dragover"]) {
      drop.addEventListener(eventName, (event) => {
        event.preventDefault();
        drop.classList.add("content-gate__drop--active");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      drop.addEventListener(eventName, (event) => {
        event.preventDefault();
        drop.classList.remove("content-gate__drop--active");
      });
    }
    drop.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      void selectArchive(file, "picker").catch((error: unknown) => {
        if (selectedFile !== file) return;
        status.classList.add("content-gate__status--error");
        status.textContent = describeError(error);
        update();
      });
    });

    const rememberCurrentSelection = async (
      file: File,
      mode: RememberedPlayMode,
    ): Promise<void> => {
      const digest = await ensureArchiveDigest();
      if (selectedFile !== file) throw new Error("The selected archive changed before launch.");
      gateMemory = withRememberedMode(gateMemory, mode);
      gateMemory = withRememberedAttestation(gateMemory, digest, true);
      writeContentGateMemory(gateMemory);
      const storageReport = await requestPersistentStorage();
      const result = await rememberContentArchive(
        archiveCache,
        { archiveName: file.name, digest, bytes: file },
        storageReport,
      );
      if (result === "skipped-storage-pressure" || result === "quota-rejected") {
        console.warn(
          `[content] Last archive was not remembered (${result}); offline saves retain priority.`,
        );
      }
      if (selectedFile === file) {
        // The File/IndexedDB record now owns the compressed input. The importer owns independent
        // retained resource copies, so the temporary hashing buffer can be released before boot.
        importedBytes = undefined;
        importedBytesFor = undefined;
      }
      if (mode === "local") await rememberOfflineProfile(file, digest, storageReport);
    };






    const rememberOfflineProfile = async (
      file: File,
      archiveDigest: string,
      storageReport: Awaited<ReturnType<typeof requestPersistentStorage>>,
    ): Promise<void> => {
      const contentFingerprint = fingerprint;
      if (contentFingerprint === undefined) return;
      const packages = modPackages;
      const ordered = modProfile?.packages ?? [];
      // `modPackages` is built from `selectedModFiles` in order, so index pairs them exactly;
      // matching on archive name would break for two files that happen to share one.
      const bytesByDigest = new Map(
        packages.flatMap((pkg, index) => {
          const source = selectedModFiles[index];
          return source === undefined ? [] : [[pkg.digest, source] as const];
        }),
      );
      rememberPlayProfile(gateStorage, {
        namespace:
          `${contentFingerprint.algorithm}:${contentFingerprint.scope}:${contentFingerprint.digest}`,
        archiveDigest,
        archiveName: file.name,
        archiveByteLength: file.size,
        mods: ordered.map((pkg) => ({
          digest: pkg.digest,
          id: pkg.manifest.id,
          version: pkg.manifest.version,
          displayName: pkg.manifest.displayName,
          byteLength: bytesByDigest.get(pkg.digest)?.size,
        })),
      });
      // A successful Offline launch makes this profile the deliberate selection to restore next
      // time. This also reverses an earlier Clear mods choice when the player opts into mods again.
      gateMemory = withRememberedModProfileRestore(gateMemory, true);
      writeContentGateMemory(gateMemory);
      if (packages.length === 0) return;
      const result = await rememberModArchives(
        modCache,
        ordered.flatMap((pkg) => {
          const source = bytesByDigest.get(pkg.digest);
          return source === undefined ? [] : [{
            digest: pkg.digest,
            archiveName: pkg.archiveName,
            modId: pkg.manifest.id,
            version: pkg.manifest.version,
            displayName: pkg.manifest.displayName,
            bytes: source,
          }];
        }),
        storageReport,
      );
      if (result === "skipped-storage-pressure" || result === "quota-rejected") {
        console.warn(`[content] Mods were not cached (${result}); offline saves retain priority.`);
      }
    };

    const confirmChangedModProfileForExistingSaves = (): boolean => {
      const probe = localSaveProbe;
      if (probe.phase !== "ready" || probe.file !== selectedFile || probe.store.slots.length === 0) {
        return true;
      }
      const previous = readPlayProfiles(gateStorage)
        .find((record) => record.namespace === probe.store.saveNamespace);
      const current = (modProfile?.packages ?? []).map((pkg) => pkg.digest);
      if (previous === undefined) {
        if (current.length === 0) return true;
        return globalThis.confirm(
          `MODS WITH UNIDENTIFIED OFFLINE SAVES\n\n` +
          `This namespace already contains Offline saves, but the game cannot identify the exact ` +
          `profile that last opened them. You are now using ${currentModSummary()}.\n\n` +
          `This is often safe for visual or debugging mods, but mods have full access and may ` +
          `change the meaning of saved fields. Missing items will be ignored; larger mismatches ` +
          `may crash or damage later revisions. Export a backup first.\n\nContinue with these saves?`,
        );
      }
      const prior = previous.mods.map((mod) => mod.digest);
      if (current.length === prior.length && current.every((digest, index) => digest === prior[index])) {
        return true;
      }
      return globalThis.confirm(
        `MOD PROFILE CHANGED FOR THESE SAVES\n\n` +
        `The selected content has the same effective save data, but these Offline saves were last ` +
        `opened as “${describePlayProfileLabel(previous, previous.namespace)}”. You are now using ` +
        `${currentModSummary()}.\n\n` +
        `This is often safe for visual, debugging, or behavior-only mods, but code mods have full ` +
        `access and may give the same saved fields a different meaning. Missing items will be ` +
        `ignored; larger mismatches may crash or damage later revisions. Export a backup first.\n\n` +
        `Continue with these saves?`,
      );
    };

    button.addEventListener("click", () => {
      const file = selectedFile;
      const mode = selectedMode();
      if (!file || mode === undefined || !rightsInput.checked || busy) return;
      busy = true;
      update();
      status.classList.remove("content-gate__status--error");
      status.textContent = mode === "official"
        ? "Opening Online play…"
        : "Reading and validating locally…";
      void (async (): Promise<AcquiredContent> => {
        if (mode === "official") {
          assertOnlinePlayAvailable({
            selectedModCount: selectedModFiles.length,
            modCodeWasActivated,
            serverStatus,
          });
        }
        const content = await ensureImported();
        let acquired: AcquiredContent;
        if (mode === "official") {
          const key = currentLoginKey();
          const authority = key === undefined ? undefined : loginSession.claim(key);
          if (authority === undefined) throw new Error("Log in before starting Online play.");
          const official = new OfficialAuthoritySaveStore(authority);
          acquired = { content, saveStore: official, official };
        } else if (mode === "scenario" && scenarioGate !== undefined) {
          acquired = scenarioGate.acquire(content);
        } else {
          if (localSaveProbe.phase !== "ready" || localSaveProbe.file !== file) {
            throw new Error("Browser saves were not checked for the selected content.");
          }
          if (!confirmChangedModProfileForExistingSaves()) {
            throw new Error("Offline launch cancelled; the saves were not changed.");
          }
          acquired = { content, saveStore: localSaveProbe.store };
        }
        assertOfficialContentBoundary(acquired);
        if (mode === "local" || mode === "official") {
          try {
            await rememberCurrentSelection(file, mode);
          } catch (error) {
            console.warn(`[content] Could not remember the last archive: ${describeError(error)}`);
          }
        }
        return acquired;
      })()
        .then(async (acquired) => {
          closeStorageDialog();
          closeRegisterDialog();
          closeProfilesDialog();
          closeSelectionDialog();
          const firstLoadScreen = await prepareSourceLoadingScreen(acquired.content);
          await fadeOutContentGate(panel);
          disposeOfflineShellStatus();
          firstLoadScreen.mount(host);
          landingBackdrop?.dismiss();
          landingBackdrop = undefined;
          resolve(acquired);
        })
        .catch((error: unknown) => {
          busy = false;
          status.classList.add("content-gate__status--error");
          status.textContent = describeError(error);
          update();
        });
    });

    update();
    void probeOnlineServer().then((result) => {
      serverStatus = result;
      if (panel.isConnected) update();
    });
    if (archiveCache.supported) {
      const restoreGeneration = archiveGeneration;
      status.textContent = "Checking this device for remembered game content…";
      void Promise.all([
        loadRememberedContentArchive(archiveCache),
        listCachedModArchives(modCache).catch(() => Object.freeze([]) as readonly CachedModArchive[]),
      ]).then(async ([remembered, mods]) => {
        if (archiveGeneration !== restoreGeneration || selectedFile !== undefined) return;
        cachedModArchives = mods;
        cachedArchiveDigest = remembered?.digest;
        cachedArchiveByteLength = remembered?.byteLength;
        profileViews = composePlayProfileViews(
          readPlayProfiles(gateStorage),
          readSaveSlotIndex(gateStorage),
          {
            archiveDigest: cachedArchiveDigest,
            ...(cachedArchiveByteLength === undefined
              ? {}
              : { archiveByteLength: cachedArchiveByteLength }),
            modDigests: new Set(mods.map((mod) => mod.digest)),
            modByteLengths: new Map(mods.map((mod) => [mod.digest, mod.byteLength])),
          },
          readDismissedProfiles(gateStorage),
        );
        if (mods.length > 0) modsExpanded = true;
        if (remembered === undefined) {
          status.textContent = "";
          update();
          return;
        }
        const lastProfile = shouldRestoreLastModProfile(gateMemory)
          ? lastUsedPlayProfile(readPlayProfiles(gateStorage))
          : undefined;
        const restoredProfileFiles = lastProfile?.archiveDigest === remembered.digest
          ? cachedModFilesForProfile(lastProfile)
          : undefined;
        let profileRestoreError: string | undefined;
        if (restoredProfileFiles !== undefined) {
          selectedModFiles = restoredProfileFiles;
          allowDeclaredConflicts = false;
          modInput.value = "";
          await resolveSelectedMods(restoredProfileFiles);
          if (modResolutionError !== undefined) {
            profileRestoreError = modResolutionError;
            selectedModFiles = Object.freeze([]);
            await resolveSelectedMods(selectedModFiles);
          }
        } else if (lastProfile?.archiveDigest === remembered.digest && lastProfile.mods.length > 0) {
          profileRestoreError = "One or more mods from the last Offline profile are no longer cached.";
        }
        const file = new File([remembered.bytes], remembered.archiveName, {
          type: remembered.bytes.type || "application/zip",
          lastModified: new Date(remembered.cachedAt).getTime(),
        });
        await selectArchive(file, "cache", remembered.digest);
        if (selectedFile !== file) return;
        status.classList.toggle("content-gate__status--error", profileRestoreError !== undefined);
        status.textContent = profileRestoreError !== undefined
          ? `Restored the asset archive, but not its last Offline profile: ${profileRestoreError}`
          : restoredProfileFiles !== undefined && lastProfile !== undefined
            ? `Restored ${describePlayProfileLabel(lastProfile, lastProfile.namespace)} from this device.`
            : "Restored the last asset archive from this device.";
        update();
      }).catch(async (error: unknown) => {
        await releaseRememberedArchive();
        if (archiveGeneration !== restoreGeneration && selectedFile === undefined) return;
        if (selectedFile !== undefined && fileInput.files?.[0] === selectedFile) return;
        archiveGeneration++;
        selectedFile = undefined;
        rightsInput.checked = false;
        fileLabel.textContent = "Choose asset archive (IPA/ZIP)";
        discardImport();
        status.classList.add("content-gate__status--error");
        status.textContent =
          `The remembered archive could not be restored: ${describeError(error)} Choose it again.`;
        update();
      });
    } else {
      // A device that holds only mod packages still opens the disclosure so the cache is visible.
      void refreshProfileViews().then(() => {
        if (cachedModArchives.length > 0) modsExpanded = true;
        update();
      }).catch(() => undefined);
    }
  });
}

const CONTENT_GATE_EXIT_MS = 280;

async function fadeOutContentGate(panel: HTMLElement): Promise<void> {
  panel.classList.add("content-gate--leaving");
  panel.inert = true;
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reduceMotion) return;
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, CONTENT_GATE_EXIT_MS));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`content gate is missing ${selector}`);
  return element;
}

function settingsIcon(): string {
  return svgIcon(
    '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06' +
      'a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08' +
      'A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06' +
      'A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08' +
      'A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06' +
      'A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08' +
      'A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06' +
      'A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08' +
      'A1.7 1.7 0 0 0 19.4 15Z"/>',
  );
}

function fullscreenIcon(): string {
  return svgIcon(
    '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
  );
}

function archiveIcon(): string {
  return svgIcon(
    '<path d="M4 7.5h6l2 2h8v8.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>' +
      '<path d="M4 10V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1.5"/>',
  );
}

function storageIcon(mode: "local" | "official"): string {
  return mode === "local"
    ? svgIcon(
      '<rect x="3" y="5" width="18" height="14" rx="3"/>' +
        '<path d="M7 9h10M8 15h.01M12 15h4"/>',
    )
    : svgIcon(
      '<path d="M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.2 8.7' +
        ' 4.7 4.7 0 0 0 7 18Z"/><path d="M12 11v5m0 0 2-2m-2 2-2-2"/>',
    );
}

function saveIcon(): string {
  return svgIcon(
    '<path d="M5 3h12l4 4v14H3V5a2 2 0 0 1 2-2Z"/>' +
      '<path d="M7 3v6h10V3M7 21v-8h10v8M14 5v2"/>',
  );
}

function keyIcon(): string {
  return svgIcon(
    '<circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 8-8"/><path d="m17 6 2 2"/>' +
      '<path d="m14.5 8.5 2 2"/>',
  );
}

function chevronIcon(): string {
  return svgIcon('<path d="m9 6 6 6-6 6"/>');
}

function uploadIcon(): string {
  return svgIcon('<path d="M12 16V4m-4 4 4-4 4 4M5 20h14"/>');
}

function trashIcon(): string {
  return svgIcon('<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v5M14 11v5"/>');
}

function tuneIcon(): string {
  return svgIcon('<path d="M4 8h9m4 0h3M4 16h3m4 0h9M15 5v6M9 13v6"/>');
}

function starIcon(): string {
  return svgIcon(
    '<path d="M12 3.6l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.88l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85Z"></path>',
  );
}

function closeIcon(): string {
  return svgIcon('<path d="m6 6 12 12M18 6 6 18"/>');
}

function warningIcon(): string {
  return svgIcon('<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5m0 3h.01"/>');
}

function svgIcon(paths: string): string {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round">${paths}</svg>`;
}
