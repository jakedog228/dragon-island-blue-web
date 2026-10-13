import { SAVE_SLOT_IDS } from "@dib/save-protocol";
import { probeOnlineServer, type OnlineServerStatus } from "../authority/serverAvailability.js";
import { showModManager, type ModManagerSelection } from "./modLibrary.js";
import { PVP_MOD, pvpModEnabled } from "../pvp/pvpMod.js";
import {
  stageModSelectionForReload, takePendingModSelection, restorePendingModSelection, PendingModSelectionError,
  type PendingModSelection,
} from "./communityClient.js";
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
import { OfflineSaveLibrary } from "../player/offlineSaveLibrary.js";
import { isQuotaExceeded } from "../player/saveErrors.js";
import type { SaveSlotStore } from "../player/saveStore.js";
import { installSaveBackupPanel } from "./saveBackupPanel.js";
import { compactModNames } from "./saveModComparison.js";
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
  describePlayProfileLabel,
  lastUsedPlayProfile,
  readPlayProfiles,
  rememberPlayProfile,
  type PlayProfileRecord,
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
          </div>
          <label class="content-gate__drop">
            <span class="content-gate__file-label">Choose asset archive (IPA/ZIP)</span>
            <input type="file" name="asset-archive"
                   accept=".ipa,.zip,application/zip,application/octet-stream">
          </label>
          <div class="content-gate__mods">
            <button class="content-gate__mod-manager" type="button"
                    title="Browse, install, enable and order Offline mods">
              <span class="content-gate__mod-manager-mark">${modLibraryIcon()}</span>
              <span class="content-gate__mod-manager-text">
                <strong>Mod Manager</strong>
                <small class="content-gate__mods-label">Optional Offline mods</small>
              </span>
              <span class="content-gate__mod-manager-chevron">${chevronIcon()}</span>
            </button>
            <span class="content-gate__mods-warning" role="note" tabindex="0"
                  title="${MOD_TRUST_WARNING}" aria-label="${MOD_TRUST_WARNING}"
                  hidden>${warningIcon()}</span>
            <small class="content-gate__mods-status" hidden></small>
            <!-- Replaces the whole selection with chosen files. The Mod Manager is the player's
                 route; this stays for scripted sessions (browser scenarios use setInputFiles). -->
            <input type="file" name="mod-archives" multiple hidden tabindex="-1" aria-hidden="true"
                   accept=".dibmod,application/zip,application/octet-stream">
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
    const modManagerButton = requiredElement<HTMLButtonElement>(panel, ".content-gate__mod-manager");
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
    let cachedModArchives: readonly CachedModArchive[] = Object.freeze([]);
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
    let baseFingerprint: ContentFingerprint | undefined;
    let landingBackdrop: PreparedSourceLandingBackdrop | undefined;
    let localSaveProbe:
      | { readonly phase: "idle" }
      | { readonly phase: "checking"; readonly file: File }
      | {
          readonly phase: "ready";
          readonly file: File;
          readonly store: OfflineSaveLibrary;
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
      baseFingerprint = undefined;
      scenarioGate?.setContent(undefined);
    };
    const ensureImported = (): Promise<ImportedContentPackage> => {
      const file = selectedFile;
      if (!file) return Promise.reject(new Error("Select an asset archive first."));
      const modFiles = selectedModFiles;
      if (importPromise && importedFor === file && importedModsFor === modFiles) return importPromise;
      const profileForImport = modProfile;
      const packagesForImport = modPackages;
      const optionsForImport = { priorityOverrides: { ...modPriorityOverrides }, allowDeclaredConflicts };
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
            if (modFiles.length > 0 && profileForImport === undefined) {
              throw new Error(modResolutionError ?? "Selected mods could not be resolved.");
            }
            let content: ImportedContentPackage;
            // Capture the archive's semantic identity before even a mod entry can mutate it.
            const originalFingerprint = await fingerprintContentPackage(baseContent);
            if (modFiles.length === 0) {
              content = baseContent;
            } else {
              // Latch before invoking user code, including a package that throws partway through
              // activation after already changing the shared page realm.
              modCodeWasActivated = true;
              content = await applyFullTrustModsToContent(baseContent, packagesForImport, optionsForImport);
            }
            backdrop = await prepareSourceLandingBackdrop(content);
            if (importedFor !== file || importedModsFor !== modFiles) {
              backdrop.dismiss();
              content.dispose();
              return content;
            }
            backdrop.mount(panel);
            importedContent = content;
            baseFingerprint = originalFingerprint;
            if (modFiles.length === 0) fingerprint = originalFingerprint;
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
            // Save settings and startup share the selected page and its stable save addresses.
            localSaveProbeGeneration++;
            const connection = await createOfflineLibrary(contentFingerprint);
            if (generation !== storageDialogGeneration || activeStorageDialog?.dialog !== dialog) return;
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
          onChange: update,
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
      registrationStatus.textContent = "Checking account availability…";
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
      const hasFullTrustMods = selectedModFiles.length > 0;
      const pvpEnabled = pvpModEnabled();
      const enabledModCount = selectedModFiles.length + Number(pvpEnabled);
      const hasMods = enabledModCount > 0;
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
      modManagerButton.disabled = busy;
      modLabel.textContent = hasMods
        ? `${enabledModCount} ${enabledModCount === 1 ? "mod" : "mods"} enabled`
        : "Optional Offline mods";
      // Names in activation order; the Mod Manager owns the full list, versions and order.
      const enabledNames = (modProfile?.packages ?? []).map((pkg) => pkg.manifest.displayName);
      if (pvpEnabled) enabledNames.push(PVP_MOD.name);
      modStatus.textContent = !hasMods
        ? ""
        : hasFullTrustMods && mode === "official"
          ? "Full-trust mods are local-only. Disable them in the Mod Manager or choose Offline."
          : modResolutionError !== undefined
            ? "These mods cannot load together. Open the Mod Manager's Load order to fix it."
            : compactModNames(enabledNames);
      modStatus.classList.toggle(
        "content-gate__mods-status--error",
        hasFullTrustMods && (mode === "official" || modResolutionError !== undefined),
      );
      modStatus.hidden = modStatus.textContent === "";
      modWarning.hidden = !hasFullTrustMods;
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
          const library = localSaveProbe.store;
          const warnings = SAVE_SLOT_IDS.filter(slot => library.warning(slot) !== undefined);
          localSaveStatus.textContent =
            `Page ${localSaveProbe.store.page + 1} of ${localSaveProbe.store.pageCount}: ${count} saved games. ` +
            (warnings.length > 0 ? `${warnings.length} save(s) need a mod/content compatibility check. ` : "") +
            "Manage pages in Offline settings.";
        } else if (localSaveProbe.phase === "error" && localSaveProbe.file === file) {
          localSaveStatus.classList.add("content-gate__mode-detail-status--error");
          localSaveStatus.textContent =
            `Browser saves could not be checked: ${localSaveProbe.message}`;
        } else {
          localSaveStatus.textContent = "Checking browser saves…";
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
        const store = await createOfflineLibrary(contentFingerprint);
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

    const gateStorage = ((): (KeyValueStorageWithIndex) | undefined => {
      try {
        return globalThis.localStorage as unknown as KeyValueStorageWithIndex;
      } catch {
        return undefined;
      }
    })();

    const createOfflineLibrary = async (identity: ContentFingerprint): Promise<OfflineSaveLibrary> => {
      if (gateStorage === undefined) throw new Error("Browser local storage is unavailable.");
      const storage = gateStorage;
      const create = () => new OfflineSaveLibrary(
        storage,
        `${identity.algorithm}:${identity.scope}:${identity.digest}`,
        (modProfile?.packages ?? []).map(pkg => ({
          digest: pkg.digest, id: pkg.manifest.id, version: pkg.manifest.version,
          displayName: pkg.manifest.displayName, byteLength: undefined,
          saveCompatibility: pkg.manifest.saveCompatibility,
        })),
        releaseRememberedArchive,
        baseFingerprint === undefined ? undefined
          : `${baseFingerprint.algorithm}:${baseFingerprint.scope}:${baseFingerprint.digest}`,
      );
      try { return create(); }
      catch (error) {
        if (!isQuotaExceeded(error) || !await releaseRememberedArchive()) throw error;
        return create();
      }
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

    function dismissDialog(dialog: HTMLDialogElement | undefined): void {
      if (dialog === undefined) return;
      if (dialog.open) dialog.close();
      dialog.remove();
    }

    const selectMods = async (
      files: readonly File[],
      options: { readonly allowDeclaredConflicts?: boolean } = {},
    ): Promise<void> => {
      closeStorageDialog();
      selectedModFiles = Object.freeze([...files]);
      allowDeclaredConflicts = options.allowDeclaredConflicts ?? false;
      if (files.length > 0) {
        console.warn(
          "Full-trust .dibmod files selected. They run inside the game page with the same access as the app:",
          files.map((file) => file.name),
        );
      }
      invalidateLogin();
      await applyModSelection();
    };
    /**
     * The Mod Manager stages a selection plus its load-order choices and hands them back on Apply.
     * Once full-trust code has run in this page, applying goes through a clean reload instead.
     */
    const applyModManagerSelection = async (selection: ModManagerSelection): Promise<void> => {
      modPriorityOverrides = { ...selection.priorityOverrides };
      writeModOrderOverrides(modPriorityOverrides);
      if (modCodeWasActivated || selection.files.length === 0) {
        // An explicit choice: the next page must not repopulate the last played profile's mods.
        gateMemory = withRememberedModProfileRestore(gateMemory, false);
        writeContentGateMemory(gateMemory);
      }
      if (modCodeWasActivated) {
        await stageModSelectionForReload(selection.files, modCache, sessionStorage, {
          allowDeclaredConflicts: selection.allowDeclaredConflicts,
        });
        globalThis.location.reload();
        return;
      }
      modInput.value = "";
      await selectMods(selection.files, { allowDeclaredConflicts: selection.allowDeclaredConflicts });
    };
    modManagerButton.addEventListener("click", () => {
      if (busy) return;
      closeStorageDialog();
      showModManager({
        cache: modCache,
        selected: () => selectedModFiles,
        order: () => ({ priorityOverrides: modPriorityOverrides, allowDeclaredConflicts }),
        interference: () => importedContent !== undefined && hasImportedModProfile(importedContent) &&
            importedModsFor === selectedModFiles
          ? importedContent.modProfile.interference
          : undefined,
        applyReloads: () => modCodeWasActivated,
        select: applyModManagerSelection,
        onApplied: () => update(),
        ...(selectedModFiles.length > 0 && modResolutionError !== undefined ? { initialTab: "order" as const } : {}),
      });
    });
    modInput.addEventListener("change", () => {
      const files = [...(modInput.files ?? [])];
      void selectMods(files).catch((error: unknown) => {
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

    /**
     * Retains the last archive/mod selection for convenience on reload. Save ownership and
     * per-slot mod history are independent, in OfflineSaveLibrary.
     */
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
          saveCompatibility: pkg.manifest.saveCompatibility,
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
      let pendingModSelection: PendingModSelection | undefined;
      let pendingModError: string | undefined;
      try { pendingModSelection = takePendingModSelection(sessionStorage); }
      catch (error) {
        // Disabled sessionStorage is not a failure of the pre-existing archive/profile restore.
        // An actual malformed pending selection does fail closed instead of restoring older mods.
        if (error instanceof PendingModSelectionError) pendingModError = error.message;
      }
      const restoreGeneration = archiveGeneration;
      status.textContent = "Checking this device for remembered game content…";
      void Promise.all([
        loadRememberedContentArchive(archiveCache),
        listCachedModArchives(modCache).catch(() => Object.freeze([]) as readonly CachedModArchive[]),
      ]).then(async ([remembered, mods]) => {
        if (archiveGeneration !== restoreGeneration || selectedFile !== undefined) return;
        cachedModArchives = mods;
        if (pendingModSelection !== undefined) {
          try {
            allowDeclaredConflicts = pendingModSelection.allowDeclaredConflicts;
            selectedModFiles = await restorePendingModSelection(pendingModSelection.digests, mods);
            await resolveSelectedMods(selectedModFiles);
            if (modResolutionError) throw new Error(modResolutionError);
          } catch (error) {
            pendingModError = describeError(error);
            selectedModFiles = Object.freeze([]);
            await resolveSelectedMods(selectedModFiles);
          }
        }
        if (remembered === undefined) {
          status.textContent = pendingModError ?? (pendingModSelection !== undefined ? "Applied your mod selection. Choose a game archive to continue." : "");
          update();
          return;
        }
        const lastProfile = pendingModSelection === undefined && !pendingModError && shouldRestoreLastModProfile(gateMemory)
          ? lastUsedPlayProfile(readPlayProfiles(gateStorage))
          : undefined;
        const restoredProfileFiles = lastProfile?.archiveDigest === remembered.digest
          ? cachedModFilesForProfile(lastProfile)
          : undefined;
        let profileRestoreError: string | undefined = pendingModError;
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
          profileRestoreError = "One or more previously selected mods are no longer cached.";
        }
        const file = new File([remembered.bytes], remembered.archiveName, {
          type: remembered.bytes.type || "application/zip",
          lastModified: new Date(remembered.cachedAt).getTime(),
        });
        await selectArchive(file, "cache", remembered.digest);
        if (selectedFile !== file) return;
        status.classList.toggle("content-gate__status--error", profileRestoreError !== undefined);
        status.textContent = profileRestoreError !== undefined
          ? `Restored the asset archive, but not its previous mods: ${profileRestoreError}`
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

function modLibraryIcon(): string {
  return svgIcon(
    '<path d="M9 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h1.5a2 2 0 1 1 0 4H17v3a1 1 0 0 1-1 1h-3v-1.5' +
      'a2 2 0 1 0-4 0V18H6a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H5V7a1 1 0 0 1 1-1h3Z"/>',
  );
}

function chevronIcon(): string {
  return svgIcon('<path d="m9 6 6 6-6 6"/>');
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
