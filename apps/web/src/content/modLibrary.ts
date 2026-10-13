import type { AuthorProfile, CatalogMod, CatalogSort, CatalogTag, CommunityInfo, ModRelease } from "@dib/mod-kernel/catalog";
import { importCodeModArchive, matchesRange, modSaveCompatibilityLabel, resolveCodeModProfile, type CodeModPackage, type ModAdvisory } from "@dib/mod-kernel";
import {
  catalogImageUrl as remoteCatalogImageUrl, catalogLookup, catalogPage, catalogTags, communityInfo, communityJson, disableSelectedMod,
  enableInstalledMod, forgetInstalledDigest, installCatalogPlan, installedCatalogMods, planCatalogInstall, storeLocalMod,
  type InstalledCatalogMod,
} from "./communityClient.js";
import type { ModInterferenceReport } from "./codeModRuntime.js";
import { listCachedModArchives, type CachedModArchive, type ModArchiveCacheBackend } from "./modArchiveCache.js";
import {
  brokenRules, buildLibrary, describeRule, formatBytes, formatRelative, isOverridableConflict, isWorkInProgress, listingState,
  listPhrase, missingDetails, orderOfPriorities, orderRules, pendingChanges, placeInLoadOrder, readLibraryView,
  writeLibraryView,
  type LibraryEntry, type LibraryOrigin, type LibraryView, type ListingState, type LoadOrderChoice, type OrderRule, type SelectedPackage,
} from "./modLibraryModel.js";
import { icon, type IconName } from "./modIcons.js";
import { badge, button, coverImage, el, emptyState, externalLink, iconButton, sheet, Toaster } from "./modUi.js";
import { readPlayProfiles } from "./playProfiles.js";
import { loadRequiredLocalFonts } from "../localFonts.js";
import "./modLibrary.css";
import { PVP_MOD, pvpModEnabled, setPvpModEnabled } from "../pvp/pvpMod.js";
import { PVP_LISTING, PVP_BUILTIN_RELEASE, pvpLibraryEntry, pvpListingMatches } from "../pvp/pvpModListing.js";

// The built-in PvP listing ships without screenshots, so every image comes from the catalog.
const catalogImageUrl = (mod: CatalogMod, digest: string): string => remoteCatalogImageUrl(mod, digest);

/** What Apply hands back to the launcher: the files to enable and how they resolve. */
export interface ModManagerSelection extends LoadOrderChoice {
  readonly files: readonly File[];
}
export type ModManagerTab = "library" | "order" | "browse";
export interface ModManagerOptions {
  cache: ModArchiveCacheBackend;
  /** The selection the launcher currently holds. */
  selected: () => readonly File[];
  /** The load-order choices the launcher currently holds. */
  order: () => LoadOrderChoice;
  /** Where the applied profile overlapped itself, once its code has run in this page. */
  interference?: () => Pick<ModInterferenceReport, "seams" | "warnings"> | undefined;
  /** Commits a new selection; may reload the page when mod code already ran. */
  select: (selection: ModManagerSelection) => Promise<void>;
  /** Refresh launcher presentation even when only a built-in mod changed. */
  onApplied?: () => void;
  /** True when applying must reload (full-trust code already executed in this page). */
  applyReloads?: () => boolean;
  /** Opens on a specific tab, e.g. Load order when the current selection cannot resolve. */
  initialTab?: ModManagerTab;
}
type LibraryFilter = "all" | "enabled" | "updates";
const TABS: readonly { id: ModManagerTab; label: string; hint: string }[] = [
  { id: "library", label: "Installed", hint: "Mods on this device" },
  { id: "order", label: "Load order", hint: "The order enabled mods activate in, and how they overlap" },
  { id: "browse", label: "Browse", hint: "Official and community mods you can install" },
];
const ORIGIN_META: Record<LibraryOrigin, { label: string; hint: string; source: string }> = {
  official: { label: "Official", hint: "from the game and this server", source: "Official" },
  community: { label: "Community", hint: "shared by players", source: "Community" },
  local: { label: "Imported files", hint: "added from this device", source: "Imported file" },
};
const SORTS: readonly { id: CatalogSort; label: string }[] = [
  { id: "updated", label: "Recently updated" }, { id: "newest", label: "Newest" }, { id: "name", label: "Name A\u2013Z" },
];
const VIEWS: readonly { id: LibraryView; label: string; icon: IconName }[] = [
  { id: "grid", label: "Grid", icon: "grid" }, { id: "list", label: "List", icon: "list" },
];
const TRUST_ACK_KEY = "dib.mods.official-trust-ack.v1";
/** The launcher lists the most severe seams; the rest stay in the console it already logs to. */
const MAX_LISTED_SEAMS = 8;
/** Pointer travel before a press on a Load order row becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;
/** The launcher can open the manager before game startup registers the title face. */
let titleFace: Promise<unknown> | undefined;
const MOD_TRUST_NOTE = "Mods run with full access to the game page. Only enable mods from authors you trust.";

/** The resolved activation order of the staged selection, or why it cannot resolve. */
interface StagedOrder {
  readonly packages: readonly CodeModPackage[];
  readonly advisories: readonly ModAdvisory[];
  readonly error: string | undefined;
  readonly overridable: boolean;
}
const EMPTY_ORDER: StagedOrder = { packages: [], advisories: [], error: undefined, overridable: false };
async function resolveOrder(packages: readonly CodeModPackage[], choice: LoadOrderChoice): Promise<StagedOrder> {
  if (!packages.length) return EMPTY_ORDER;
  try {
    const profile = await resolveCodeModProfile(packages, choice);
    return { packages: profile.packages, advisories: profile.advisories, error: undefined, overridable: false };
  } catch (error) {
    return { packages: [], advisories: [], error: error instanceof Error ? error.message : String(error), overridable: isOverridableConflict(error) };
  }
}
const orderIds = (order: StagedOrder): string[] => order.packages.map((pkg) => pkg.manifest.id);

/**
 * The mod a details window describes. A catalog listing supplies the store page; an imported file
 * (or an installed catalog mod whose page cannot be fetched) has only its manifest, which is
 * loaded from the device copy, so every section can say plainly what it does not know.
 */
interface Detail {
  readonly modId: string;
  mod: CatalogMod | undefined;
  pkg: CodeModPackage | undefined;
  /** Still fetching the store page. */
  loading: boolean;
  /** Why the store page is not shown for a mod that should have one. */
  note: string | undefined;
  /** Where focus returns when the window closes. */
  readonly opener: { readonly node: HTMLElement | undefined; readonly modId: string | undefined; readonly role: string | undefined };
}

export function showModManager(options: ModManagerOptions): void {
  const appliedPvp = pvpModEnabled();
  let stagedPvp = appliedPvp;
  titleFace ??= loadRequiredLocalFonts();
  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------
  let tab: ModManagerTab = options.initialTab ?? "library";
  let detail: Detail | undefined;
  let query = "";
  let sort: CatalogSort = "updated";
  let tag: string | undefined;
  let author: { id: string; name: string } | undefined;
  let libraryFilter: LibraryFilter = "all";
  const viewStorage = ((): Storage | undefined => { try { return localStorage; } catch { return undefined; } })();
  let view: LibraryView = readLibraryView(viewStorage);
  let info: CommunityInfo | undefined;
  let catalogError: string | undefined;
  let device: CachedModArchive[] = [];
  let inventory: InstalledCatalogMod[] = [];
  let listings: CatalogMod[] = [];
  let library: LibraryEntry[] = [];
  let stagedFiles: File[] = [...options.selected()];
  let staged: SelectedPackage[] = [];
  let applied: SelectedPackage[] = [];
  const appliedOrder = options.order();
  let stagedOverrides: Record<string, number> = { ...appliedOrder.priorityOverrides };
  let stagedAllow = appliedOrder.allowDeclaredConflicts;
  let order: StagedOrder = EMPTY_ORDER;
  /** Where each mod's own priority and load rules would put it, ignoring manual moves. */
  let recommended: StagedOrder = EMPTY_ORDER;
  let rules: OrderRule[] = [];
  let stagedPackages: CodeModPackage[] = [];
  let orderChanged = false;
  let browseCount = 1; // The included PvP listing is available without a remote catalog.
  let results: { mods: CatalogMod[]; next: number | null; total: number } | undefined;
  let tags: CatalogTag[] = [];
  let tagsExpanded = false;
  let browseGeneration = 0;
  let busy = false;
  const packages = new WeakMap<Blob, CodeModPackage>();

  // ---------------------------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------------------------
  const dialog = el("dialog", "ml");
  dialog.setAttribute("aria-label", "Mod Manager");
  // Follow the launcher's explicit light/dark choice; otherwise the stylesheet follows the system.
  const gateMode = document.querySelector<HTMLElement>(".content-gate")?.dataset["gateMode"];
  if (gateMode === "light" || gateMode === "dark") dialog.dataset["theme"] = gateMode;
  const toaster = new Toaster();
  const search = el("input", "ml-search__input");
  search.type = "search"; search.placeholder = "Search mods"; search.setAttribute("aria-label", "Search mods");
  search.autocomplete = "off"; search.spellcheck = false;
  // "/" still focuses search (see the keydown handler); it just is not advertised in the chrome.
  const searchBox = el("label", "ml-search", icon("search"), search);
  const publish = el("span", "ml-top__publish");
  const progress = el("div", "ml-progress"); progress.hidden = true;
  const tabBar = el("nav", "ml-tabs"); tabBar.setAttribute("role", "tablist"); tabBar.setAttribute("aria-label", "Mod Manager sections");
  const top = el("header", "ml-top", el("h2", "ml-top__title ml-title-face", "Mod Manager"), tabBar,
    searchBox, publish, iconButton("close", "Close", () => close()), progress);
  const main = el("main", "ml-main"); main.tabIndex = -1;
  const body = el("div", "ml-body", main);
  const applyBar = el("footer", "ml-apply"); applyBar.hidden = true;
  const fileInput = el("input"); fileInput.type = "file"; fileInput.multiple = true; fileInput.hidden = true;
  fileInput.accept = ".dibmod,application/zip,application/octet-stream";
  const dropHint = el("div", "ml-drop", "Drop .dibmod files to import them");
  // Keyboard reordering is announced here; a toast for every arrow press would be noise.
  const live = el("div", "ml-visually-hidden"); live.setAttribute("aria-live", "polite");
  // Details open in their own window over the manager; the manager underneath is inert meanwhile.
  const detailTitleId = `ml-detail-${Math.random().toString(36).slice(2)}`;
  const modalSource = el("div", "ml-modal__source");
  const modalProgress = el("div", "ml-progress"); modalProgress.hidden = true;
  const modalScroll = el("div", "ml-modal__scroll");
  const modalPanel = el("section", "ml-modal",
    el("header", "ml-modal__bar", modalSource, iconButton("close", "Close details", () => closeDetail()), modalProgress), modalScroll);
  modalPanel.setAttribute("role", "dialog"); modalPanel.setAttribute("aria-modal", "true");
  modalPanel.setAttribute("aria-labelledby", detailTitleId); modalPanel.tabIndex = -1;
  const modal = el("div", "ml-modal-backdrop", modalPanel); modal.hidden = true;
  dialog.append(top, body, applyBar, modal, toaster.node, fileInput, dropHint, live);

  // ---------------------------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------------------------
  const packageOf = async (blob: Blob, name = blob instanceof File ? blob.name : "mod.dibmod"): Promise<CodeModPackage> => {
    const known = packages.get(blob);
    if (known) return known;
    const pkg = await importCodeModArchive(new Uint8Array(await blob.arrayBuffer()), name);
    packages.set(blob, pkg);
    return pkg;
  };
  const identify = async (file: File): Promise<SelectedPackage> => {
    const pkg = await packageOf(file);
    return { digest: pkg.digest, modId: pkg.manifest.id };
  };
  const stagedChoice = (): LoadOrderChoice => ({ priorityOverrides: stagedOverrides, allowDeclaredConflicts: stagedAllow });
  /** Device bytes plus launcher-held files that were never cached (e.g. storage disabled). */
  const refreshDevice = async (lookup = false): Promise<void> => {
    const cached = [...await listCachedModArchives(options.cache)];
    for (const file of options.selected()) {
      const pkg = await packageOf(file);
      if (!cached.some((row) => row.digest === pkg.digest)) cached.push({ schemaVersion: 1, digest: pkg.digest, archiveName: file.name,
        modId: pkg.manifest.id, version: pkg.manifest.version, displayName: pkg.manifest.displayName, byteLength: file.size,
        cachedAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), bytes: file });
    }
    device = cached;
    inventory = installedCatalogMods();
    staged = await Promise.all(stagedFiles.map(identify));
    applied = await Promise.all(options.selected().map(identify));
    if (lookup && info?.enabled && inventory.length) {
      try { listings = await catalogLookup(inventory.map((row) => row.listingId)); } catch { /* offline: no update hints */ }
    }
    const classifiedDevice = await Promise.all(device.map(async row => {
      // Read the actual release's manifest, including older cache entries lacking metadata.
      // Invalid packages remain visible/removable and can never claim neutrality.
      const pkg = await packageOf(row.bytes, row.archiveName).catch(() => undefined);
      return { ...row, saveCompatibility: pkg?.manifest.saveCompatibility ?? "dependent" as const };
    }));
    library = buildLibrary({ device: classifiedDevice, inventory, staged, applied, listings });
    await refreshOrder();
  };
  /**
   * Resolves the staged selection under the staged choices, and again under the applied ones so
   * an order edit counts as a change only when it actually changes the activation order. The
   * recommended order is the same selection with every manual move forgotten.
   */
  const refreshOrder = async (): Promise<void> => {
    stagedPackages = await Promise.all(stagedFiles.map((file) => packageOf(file)));
    rules = orderRules(stagedPackages.map((pkg) => pkg.manifest));
    // "Load anyway" lasts only while the selection still needs it.
    if (stagedAllow && !(await resolveOrder(stagedPackages, { ...stagedChoice(), allowDeclaredConflicts: false })).error) stagedAllow = false;
    order = await resolveOrder(stagedPackages, stagedChoice());
    recommended = await resolveOrder(stagedPackages, { priorityOverrides: {}, allowDeclaredConflicts: stagedAllow });
    const baseline = await resolveOrder(stagedPackages, appliedOrder);
    orderChanged = order.error !== baseline.error || orderIds(order).join("\n") !== orderIds(baseline).join("\n");
  };
  const loadInfo = async (): Promise<void> => {
    try { info = await communityInfo(); catalogError = info.enabled ? undefined : "This server does not host a mod catalog. Installed and imported mods still work."; }
    catch (error) { info = undefined; catalogError = error instanceof Error ? error.message : String(error); }
    publish.replaceChildren();
    if (info?.authorOrigin) {
      const link = externalLink(`${info.authorOrigin}/community.html`, "Publish", "external", "ml-btn ml-btn--ghost ml-top__publish-link");
      link.title = "Publish and manage your own mods on the author site";
      publish.append(link);
    }
    if (info?.enabled) {
      try { browseCount = (await catalogPage({})).total + 1; } catch { /* shown on the tab itself */ }
    }
  };
  /** Display name for a mod ID, wherever it is best known; the raw ID only for mods seen nowhere. */
  const nameOf = (id: string): string => library.find((row) => row.modId === id)?.displayName
    ?? stagedPackages.find((pkg) => pkg.manifest.id === id)?.manifest.displayName
    ?? [...listings, ...results?.mods ?? []].find((mod) => mod.modId === id)?.title ?? id;

  // ---------------------------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------------------------
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true; progress.hidden = false; modalProgress.hidden = false; dialog.setAttribute("aria-busy", "true");
    // run() rejects concurrent mutations. Reflect that ownership on already-rendered switches,
    // including the initial catalog load, so a visible enabled toggle never drops its click.
    for (const toggle of dialog.querySelectorAll<HTMLButtonElement>(".ml-switch")) toggle.disabled = true;
    try { await work(); }
    catch (error) { toaster.show(error instanceof Error ? error.message : String(error), "error"); }
    finally { busy = false; progress.hidden = true; modalProgress.hidden = true; dialog.removeAttribute("aria-busy"); render(); }
  };
  const stage = async (files: File[]): Promise<void> => {
    stagedFiles = files;
    await refreshDevice();
  };
  /**
   * Adds one stored version (and its required dependencies) to the staged selection. A declared
   * conflict is the authors' claim, not an integrity failure, so the player may insist once.
   * Returns false when the player backed out.
   */
  const stageEnabled = async (digest: string, cached: readonly CachedModArchive[] = device): Promise<boolean> => {
    // Missing dependencies and cycles still throw here; only declared conflicts are let through,
    // and every one this change adds is put to the player, even after an earlier "Enable anyway".
    const next = await enableInstalledMod(stagedFiles, cached, digest, { allowDeclaredConflicts: true });
    const conflicts = async (files: readonly File[]): Promise<string[]> =>
      (await resolveOrder(await Promise.all(files.map((file) => packageOf(file))), { ...stagedChoice(), allowDeclaredConflicts: true })).advisories
        .filter((advisory) => advisory.kind === "declared-conflict-overridden").map((advisory) => advisory.message);
    const known = new Set(await conflicts(stagedFiles));
    const added = (await conflicts(next)).filter((message) => !known.has(message));
    if (added.length) {
      const choice = await sheet(dialog, {
        tone: "warning", title: added.length === 1 ? "These mods say they conflict" : "These mods say they conflict with each other",
        body: [...added.map((message) => el("p", "", `${message}.`)),
          el("p", "ml-sheet__note", "Loading them together can break any of them. You can still change which one loads last in Load order.")],
        actions: [{ id: "enable", label: "Enable anyway" }],
      });
      if (choice !== "enable") return false;
      stagedAllow = true;
    }
    await stage(next);
    return true;
  };
  const enable = async (digest: string): Promise<void> => {
    if (digest === PVP_BUILTIN_RELEASE) { stagedPvp = true; return; }
    if (!await stageEnabled(digest)) return;
    const entry = library.find((row) => row.stagedDigest === digest);
    toaster.show(`${entry?.displayName ?? "Mod"} will be enabled when you apply.`, "success");
  };
  const disable = async (entry: LibraryEntry): Promise<void> => {
    if (entry.modId === PVP_MOD.id) { stagedPvp = false; return; }
    const result = await disableSelectedMod(stagedFiles, entry.modId, { allowDeclaredConflicts: stagedAllow });
    await stage(result.files);
    toaster.show(result.cascaded.length
      ? `${entry.displayName} disabled, along with ${result.cascaded.join(", ")} which require${result.cascaded.length === 1 ? "s" : ""} it.`
      : `${entry.displayName} will be disabled when you apply.`);
  };
  const disableAll = async (): Promise<void> => {
    stagedPvp = false;
    await stage([]);
    toaster.show("Every mod will be disabled when you apply.");
  };
  const install = async (mod: CatalogMod, release: ModRelease, isUpdate = false): Promise<void> => {
    const plan = await planCatalogInstall(mod, release.digest);
    const fresh = plan.filter((entry) => !device.some((row) => row.digest === entry.digest));
    const extra = plan.filter((entry) => entry.mod.modId !== mod.modId);
    const everyOfficial = plan.every((entry) => entry.mod.source === "official");
    let acknowledged = false;
    try { acknowledged = everyOfficial && localStorage.getItem(TRUST_ACK_KEY) === "1"; } catch { /* storage disabled */ }
    if (!acknowledged || extra.length > 0) {
      const total = fresh.reduce((sum, entry) => sum + (entry.mod.releases.find((item) => item.digest === entry.digest)?.byteLength ?? 0), 0);
      const items = el("ul", "ml-plan");
      for (const entry of plan) {
        const version = entry.mod.releases.find((item) => item.digest === entry.digest)!;
        items.append(el("li", "", el("span", "ml-plan__name", entry.mod.title),
          entry.mod.modId === mod.modId ? undefined : badge("required", "muted"),
          el("span", "ml-plan__meta", `v${version.version}`), el("span", "ml-plan__meta", formatBytes(version.byteLength))));
      }
      const choice = await sheet(dialog, {
        tone: everyOfficial ? "info" : "warning",
        title: isUpdate ? `Update ${mod.title} to v${release.version}?` : `Install ${mod.title}?`,
        body: [el("p", "", extra.length ? `It needs ${extra.length === 1 ? "one other mod" : `${extra.length} other mods`}, installed along with it.` : `Version ${release.version}.`),
          items, el("p", "ml-sheet__note", `${formatBytes(total)} to download. ${MOD_TRUST_NOTE} Nothing runs until you apply.`)],
        actions: [{ id: "install", label: isUpdate ? "Update" : "Install" }],
      });
      if (choice !== "install") return;
      if (everyOfficial) try { localStorage.setItem(TRUST_ACK_KEY, "1"); } catch { /* storage disabled */ }
    }
    await installCatalogPlan(plan, options.cache);
    await refreshDevice();
    listings = [...listings.filter((entry) => !plan.some((item) => item.mod.id === entry.id)), ...plan.map((item) => item.mod)];
    // An install is almost always followed by enabling; an update keeps an enabled mod enabled.
    const previous = library.find((row) => row.modId === mod.modId);
    let enabled = false;
    if (!isUpdate || previous?.stagedDigest) enabled = await stageEnabled(release.digest);
    toaster.show(isUpdate ? `${mod.title} updated to v${release.version}.`
      : enabled ? `${mod.title} installed and enabled. Apply to play with it.` : `${mod.title} installed. Enable it from Installed.`, "success");
  };
  const installLatest = (mod: CatalogMod, isUpdate = false): Promise<void> => {
    const latest = mod.releases[0];
    if (!latest) throw new Error("This mod has no downloadable release.");
    return install(mod, latest, isUpdate);
  };
  const remove = async (entry: LibraryEntry, digest?: string): Promise<void> => {
    const targets = entry.versions.filter((version) => digest === undefined || version.digest === digest);
    if (targets.some((version) => version.digest === entry.appliedDigest)) {
      throw new Error(`${entry.displayName} is in use. Disable it and apply before removing it.`);
    }
    const profiles = readPlayProfiles(localStorage).filter((profile) => profile.mods.some((mod) => targets.some((version) => version.digest === mod.digest)));
    const choice = await sheet(dialog, {
      tone: "danger",
      title: digest ? `Remove ${entry.displayName} v${targets[0]?.version}?` : `Remove ${entry.displayName}?`,
      body: [el("p", "", `${targets.length === 1 ? "This version is" : `${targets.length} versions are`} deleted from this device. Your saves are kept.`),
        profiles.length ? el("p", "ml-sheet__note", `${profiles.length} saved profile${profiles.length === 1 ? " uses" : "s use"} ${targets.length === 1 ? "this version" : "these versions"}; they will ask for it again.`) : "",
        entry.listingId ? el("p", "ml-sheet__note", "You can reinstall it from the catalog while it stays published.") : ""],
      actions: [{ id: "remove", label: "Remove", tone: "danger" }],
    });
    if (choice !== "remove") return;
    if (entry.stagedDigest && targets.some((version) => version.digest === entry.stagedDigest)) {
      stagedFiles = (await disableSelectedMod(stagedFiles, entry.modId, { allowDeclaredConflicts: stagedAllow })).files;
    }
    for (const version of targets) { await options.cache.delete(version.digest); forgetInstalledDigest(version.digest); }
    await refreshDevice();
    // An imported file has nothing left to describe once it is gone.
    if (detail?.modId === entry.modId && !library.some((row) => row.modId === entry.modId) && !detail.mod) detail = undefined;
    toaster.show(`${entry.displayName} removed from this device.`);
  };
  const importFiles = async (files: readonly File[]): Promise<void> => {
    const chosen = files.filter((file) => /\.(dibmod|zip)$/i.test(file.name) || file.type === "application/zip");
    if (!chosen.length) throw new Error("Choose .dibmod files to import.");
    const names: string[] = [];
    for (const file of chosen) {
      const result = await storeLocalMod(file, options.cache);
      await refreshDevice();
      const cached = device.some((row) => row.digest === result.pkg.digest) ? device
        : [...device, { schemaVersion: 1 as const, digest: result.pkg.digest, archiveName: file.name, modId: result.pkg.manifest.id, version: result.pkg.manifest.version,
          displayName: result.pkg.manifest.displayName, byteLength: file.size, cachedAt: "", lastUsedAt: "", bytes: file }];
      if (await stageEnabled(result.pkg.digest, cached)) names.push(result.pkg.manifest.displayName);
      if (!result.stored) toaster.show("Browser storage is unavailable, so imported files last only until you close this tab.", "info");
    }
    // Show the new rows: a search left over from Browse would hide them.
    tab = "library"; detail = undefined; libraryFilter = "all"; query = ""; search.value = "";
    if (names.length) toaster.show(`Imported and enabled ${names.join(", ")}. Apply to play with ${names.length === 1 ? "it" : "them"}.`, "success");
  };
  /** Drops (or arrow-keys) one mod to a new position; declared rules may refuse part of the move. */
  const place = async (id: string, index: number): Promise<boolean> => {
    const before = orderIds(order);
    const next = placeInLoadOrder(before, id, index);
    if (!next) return false;
    const wanted = orderOfPriorities(next);
    stagedOverrides = next;
    await refreshOrder();
    const now = orderIds(order);
    if (now.join("\n") === wanted.join("\n")) return true;
    const broken = brokenRules(rules, wanted);
    const reason = broken.find((rule) => rule.before === id || rule.after === id) ?? broken[0];
    const outcome = now.join("\n") === before.join("\n") ? `so ${nameOf(id)} stays where it was` : "so it moved as far as that allows";
    toaster.show(reason ? `${describeRule(reason, nameOf)}, ${outcome}.` : `A load-order rule keeps ${nameOf(id)} where it is.`);
    return now.join("\n") !== before.join("\n");
  };
  const resetOrder = async (): Promise<void> => {
    stagedOverrides = {};
    await refreshOrder();
    toaster.show("Back to the recommended order.");
  };
  const loadAnyway = async (): Promise<void> => {
    stagedAllow = true;
    await refreshOrder();
  };
  const totalChanges = (): number => pendingChanges(staged, applied) + (orderChanged ? 1 : 0) + (stagedPvp !== appliedPvp ? 1 : 0);
  const enabledCount = (): number => staged.length + Number(stagedPvp);
  const apply = async (): Promise<void> => {
    if (order.error) throw new Error("These mods cannot load together yet. Fix it in Load order first.");
    setPvpModEnabled(stagedPvp);
    try {
      if (pendingChanges(staged, applied) || orderChanged) {
        await options.select({ files: stagedFiles, priorityOverrides: stagedOverrides, allowDeclaredConflicts: stagedAllow });
      }
    } catch (error) { setPvpModEnabled(appliedPvp); throw error; }
    options.onApplied?.();
    dialog.close();
  };
  const discard = async (): Promise<void> => {
    stagedPvp = appliedPvp;
    stagedOverrides = { ...appliedOrder.priorityOverrides };
    stagedAllow = appliedOrder.allowDeclaredConflicts;
    await stage([...options.selected()]);
    toaster.show("Changes discarded.");
  };
  const close = async (): Promise<void> => {
    const changes = totalChanges();
    if (changes > 0) {
      const choice = await sheet(dialog, {
        tone: "warning", title: `Apply ${changes} change${changes === 1 ? "" : "s"} before closing?`,
        body: [el("p", "", order.error
          ? "These mods cannot load together yet, so they cannot be applied. Discarding keeps the mods you had before."
          : "You changed which mods are on, or their load order, without applying. Discarding keeps the mods you had before.")],
        actions: order.error ? [{ id: "discard", label: "Discard changes", tone: "secondary" }]
          : [{ id: "discard", label: "Discard changes", tone: "secondary" }, { id: "apply", label: applyLabel() }],
      });
      if (choice === "cancel") return;
      if (choice === "apply") { await run(apply); return; }
    }
    dialog.close();
  };
  const applyLabel = (): string => (pendingChanges(staged, applied) || orderChanged) && options.applyReloads?.() ? "Apply & reload" : "Apply";

  // ---------------------------------------------------------------------------------------------
  // Details window
  // ---------------------------------------------------------------------------------------------
  /**
   * Opens the details window at once with what is known, then fills in the fresh store page
   * (releases may have changed since the list was fetched) and, for an installed mod, the
   * manifest's load rules from the device copy.
   */
  const openDetail = async (modId: string, mod: CatalogMod | undefined, listingId: string | undefined): Promise<void> => {
    const active = document.activeElement instanceof HTMLElement && main.contains(document.activeElement) ? document.activeElement : undefined;
    if (modId === PVP_MOD.id) { mod = PVP_LISTING; listingId = undefined; }
    const subject: Detail = { modId, mod, pkg: undefined, loading: listingId !== undefined, note: undefined,
      opener: { node: active, modId: active?.closest("[data-mod-id]")?.getAttribute("data-mod-id") ?? undefined, role: active?.classList[0] } };
    detail = subject;
    modalScroll.scrollTop = 0;
    render();
    modalPanel.focus({ preventScroll: true });
    const listing = listingId === undefined ? Promise.resolve() : communityJson<CatalogMod>(`/mods/${encodeURIComponent(listingId)}`)
      .then((fresh) => { subject.mod = fresh; })
      .catch((error: unknown) => {
        if (subject.mod) return; // keep the list copy
        const reason = error instanceof Error ? error.message : String(error);
        subject.note = `Its store page could not be loaded (${reason.replace(/\.$/, "")}). What is shown comes from the file on this device.`;
      })
      .finally(() => { subject.loading = false; });
    const entry = library.find((row) => row.modId === modId);
    const version = entry?.versions.find((item) => item.stored && item.digest === entry.stagedDigest) ?? entry?.versions.find((item) => item.stored);
    const row = version && device.find((item) => item.digest === version.digest);
    const manifest = row ? packageOf(row.bytes, row.archiveName).then((pkg) => { subject.pkg = pkg; }, () => { /* Installed already flags unreadable files */ })
      : Promise.resolve();
    await Promise.all([listing, manifest]);
    if (detail === subject && !busy) render();
  };
  const openEntry = (entry: LibraryEntry): Promise<void> => openDetail(entry.modId, entry.listing, entry.listingId);
  const openListing = (mod: CatalogMod): Promise<void> => openDetail(mod.modId, mod, mod.id);
  const openModId = (modId: string): Promise<void> => {
    const entry = library.find((row) => row.modId === modId);
    return entry ? openEntry(entry) : openDetail(modId, undefined, undefined);
  };
  const closeDetail = (): void => {
    if (!detail) return;
    const { opener } = detail;
    detail = undefined;
    render();
    const scope = opener.modId ? main.querySelector<HTMLElement>(`[data-mod-id="${CSS.escape(opener.modId)}"]`) : null;
    const target = opener.node?.isConnected ? opener.node
      : scope && opener.role ? (scope.classList.contains(opener.role) ? scope : scope.querySelector<HTMLElement>(`.${CSS.escape(opener.role)}`)) : null;
    (target ?? main).focus({ preventScroll: true });
  };
  /** Tag and author links leave the details window for a filtered Browse list. */
  const browseFiltered = (filter: { tag?: string; author?: AuthorProfile }): void => {
    detail = undefined;
    tag = filter.tag; author = filter.author ? { id: filter.author.id, name: filter.author.displayName } : undefined;
    query = ""; search.value = ""; tab = "browse";
    render(); main.scrollTop = 0; main.focus({ preventScroll: true });
    void loadBrowse();
  };

  // ---------------------------------------------------------------------------------------------
  // Browse data
  // ---------------------------------------------------------------------------------------------
  const loadBrowse = async (append = false): Promise<void> => {
    if (tab !== "browse") return;
    if (!info?.enabled) { results = { mods: [], next: null, total: 0 }; render(); return; }
    const generation = ++browseGeneration;
    if (!append) { results = undefined; render(); }
    try {
      const [page, tagList] = await Promise.all([
        catalogPage({ q: query, sort, ...(tag ? { tag } : {}), ...(author ? { author: author.id } : {}), offset: append ? results?.next ?? 0 : 0 }),
        append ? Promise.resolve(tags) : catalogTags().catch(() => []),
      ]);
      if (generation !== browseGeneration) return;
      results = append && results ? { mods: [...results.mods, ...page.mods], next: page.next, total: page.total } : page;
      tags = tagList;
      if (!query && !tag && !author) browseCount = page.total + 1;
      catalogError = undefined;
    } catch (error) {
      if (generation !== browseGeneration) return;
      catalogError = error instanceof Error ? error.message : String(error);
      results = undefined;
    }
    render();
  };
  const switchTab = (next: ModManagerTab): void => {
    if (tab === next) return;
    tab = next; tag = undefined; author = undefined; tagsExpanded = false;
    render(); main.scrollTop = 0;
    if (tab === "browse") void loadBrowse();
  };

  // ---------------------------------------------------------------------------------------------
  // Rendering helpers
  // ---------------------------------------------------------------------------------------------
  const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
  const stateAction = (mod: CatalogMod, state: ListingState, large = false): HTMLButtonElement => {
    const entry = library.find((row) => row.modId === mod.modId);
    const small = !large;
    switch (state) {
      case "available": return button("Install", { tone: "primary", small, onClick: () => run(() => installLatest(mod)) });
      case "update": return button("Update", { tone: "primary", small, title: `Update to v${mod.releases[0]?.version}`, onClick: () => run(() => installLatest(mod, true)) });
      case "enabled": {
        const node = button("Enabled", { icon: "check", tone: "success", small, title: "Disable", onClick: () => run(() => disable(entry!)) });
        node.setAttribute("aria-pressed", "true");
        return node;
      }
      case "installed": {
        const newest = entry!.versions.find((version) => version.stored)!;
        const node = button("Enable", { tone: "secondary", small, title: "Installed on this device", onClick: () => run(() => enable(newest.digest)) });
        node.setAttribute("aria-pressed", "false");
        return node;
      }
    }
  };
  /** Enable/disable for a mod that has no listing to install from. */
  const entryAction = (entry: LibraryEntry, large = false): HTMLElement => {
    const stored = entry.versions.find((version) => version.stored && version.digest === entry.stagedDigest) ?? entry.versions.find((version) => version.stored);
    if (entry.stagedDigest) {
      const node = button("Enabled", { icon: "check", tone: "success", small: !large, title: "Disable", onClick: () => run(() => disable(entry)) });
      node.setAttribute("aria-pressed", "true");
      return node;
    }
    if (!stored) return badge("Not on this device", "warning", undefined, "The browser cleared these files.");
    const node = button("Enable", { tone: "secondary", small: !large, onClick: () => run(() => enable(stored.digest)) });
    node.setAttribute("aria-pressed", "false");
    return node;
  };
  /** Grid or list; remembered per device. */
  const viewToggle = (): HTMLElement => {
    const group = el("div", "ml-view"); group.setAttribute("role", "radiogroup"); group.setAttribute("aria-label", "Layout");
    for (const entry of VIEWS) {
      const node = el("button", "ml-view__item", icon(entry.icon));
      node.type = "button"; node.title = `${entry.label} view`; node.setAttribute("aria-label", `${entry.label} view`);
      node.setAttribute("role", "radio"); node.setAttribute("aria-checked", String(view === entry.id));
      node.addEventListener("click", () => { view = entry.id; writeLibraryView(viewStorage, view); render(); });
      group.append(node);
    }
    return group;
  };
  /** Mouse users can open a tile anywhere; keyboard and screen readers use its title button. */
  const openable = (node: HTMLElement, label: string, open: () => void): HTMLButtonElement => {
    node.classList.add("ml-tile--openable");
    node.addEventListener("click", (event) => { if (!(event.target as HTMLElement).closest("button, a, input, label")) open(); });
    const title = el("button", "ml-tile__title ml-title-face", label);
    title.type = "button"; title.title = "Details";
    title.addEventListener("click", (event) => { event.stopPropagation(); open(); });
    return title;
  };
  const sourceLabel = (origin: LibraryOrigin): HTMLElement => el("span", `ml-source ml-source--${origin}`, ORIGIN_META[origin].source);
  /** Unfinished mods say so on every card, not just in their title. */
  const wipFlag = (tags: readonly string[] | undefined): HTMLElement | undefined =>
    tags && isWorkInProgress(tags) ? el("span", "ml-wip-flag", icon("alert", "ml-icon ml-icon--small"), "Work in progress") : undefined;
  const visibleTags = (tags: readonly string[]): string[] => tags.filter((value) => !isWorkInProgress([value]));
  /** Shown in place of what a details window does not know, so the gap is obvious rather than blank. */
  const missing = (text: string, tagName: "p" | "span" = "p"): HTMLElement => el(tagName, "ml-missing", text);

  const renderTabs = (): void => {
    tabBar.replaceChildren();
    for (const entry of TABS) {
      const count = entry.id === "library" ? library.length : entry.id === "order" ? enabledCount() : browseCount;
      const updates = entry.id === "library" ? library.filter((row) => row.update).length : 0;
      const node = el("button", "ml-tab", el("span", "ml-tab__label", entry.label),
        count !== undefined ? el("span", "ml-tab__count", String(count)) : undefined,
        updates ? el("span", "ml-tab__updates", plural(updates, "update")) : undefined,
        entry.id === "order" && order.error ? el("span", "ml-tab__problem", "needs attention") : undefined);
      node.type = "button"; node.setAttribute("role", "tab"); node.dataset["tab"] = entry.id;
      node.setAttribute("aria-selected", String(tab === entry.id));
      node.title = entry.hint;
      node.addEventListener("click", () => switchTab(entry.id));
      tabBar.append(node);
    }
  };

  const renderApplyBar = (): void => {
    const changes = totalChanges();
    applyBar.hidden = changes === 0;
    if (!changes) return;
    const applyButton = button(applyLabel(), { tone: "primary", onClick: () => run(apply) });
    applyButton.disabled = order.error !== undefined;
    const detailText = order.error
      ? "These mods cannot load together yet. Open Load order to fix it."
      : `${plural(enabledCount(), "mod")} will be enabled${orderChanged ? " in the new order" : ""}. Changes take effect after you apply.`;
    applyBar.replaceChildren(
      el("div", "ml-apply__text", el("strong", "", `${plural(changes, "change")} to apply`), el("small", "", detailText)),
      button("Discard", { tone: "ghost", onClick: () => run(discard) }),
      applyButton);
  };

  // ---------------------------------------------------------------------------------------------
  // Installed
  // ---------------------------------------------------------------------------------------------
  /** Shared by the Installed row and tile so both offer exactly the same controls. */
  const libraryParts = (entry: LibraryEntry) => {
    const current = entry.versions.find((version) => version.digest === entry.stagedDigest) ?? entry.versions.find((version) => version.stored) ?? entry.versions[0]!;
    const storedAny = entry.versions.some((version) => version.stored);
    const enabled = entry.stagedDigest !== undefined;
    const meta = el("div", "ml-row__meta", el("span", "", `v${current.version}`));
    if (entry.listing) meta.append(el("span", "", `by ${entry.listing.author.displayName}`));
    if (current.byteLength) meta.append(el("span", "", formatBytes(current.byteLength)));
    if (entry.versions.length > 1) meta.append(el("span", "", plural(entry.versions.length, "version")));
    const badges = el("div", "ml-row__badges");
    const wip = wipFlag(entry.listing?.tags);
    if (wip) badges.append(wip);
    if (entry.update) badges.append(badge(`v${entry.update.version} available`, "update"));
    if (!storedAny) badges.append(badge("Not on this device", "warning", undefined, "The browser cleared these files. Download it again to use it."));
    const pendingHint = "Takes effect when you apply";
    if (entry.appliedDigest && entry.appliedDigest !== entry.stagedDigest) {
      badges.append(entry.stagedDigest ? badge(`Switching to v${current.version} on apply`, "pending", undefined, pendingHint) : badge("Disabling on apply", "pending", undefined, pendingHint));
    } else if (!entry.appliedDigest && entry.stagedDigest) badges.append(badge("Enabling on apply", "pending", undefined, pendingHint));
    const actions = el("div", "ml-row__actions");
    if (entry.update && entry.listing) actions.append(button("Update", { tone: "primary", small: true, onClick: () => run(() => installLatest(entry.listing!, true)) }));
    if (!storedAny && entry.listingId) actions.append(button("Download", { tone: "primary", small: true, onClick: () => openEntry(entry) }));
    actions.append(iconButton("info", "Details", () => openEntry(entry)));
    if (entry.modId !== PVP_MOD.id) actions.append(iconButton("trash", "Remove from device", () => run(() => remove(entry)), "danger"));
    const toggle = el("button", "ml-switch", el("span", "ml-switch__thumb"));
    toggle.type = "button"; toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-checked", String(enabled));
    toggle.setAttribute("aria-label", entry.displayName); toggle.title = enabled ? "Enabled" : "Disabled";
    toggle.disabled = busy || !storedAny;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      void run(() => enabled ? disable(entry) : enable(current.stored ? current.digest : entry.versions.find((version) => version.stored)!.digest));
    });
    return { current, enabled, meta, badges, actions, toggle };
  };
  const libraryRow = (entry: LibraryEntry): HTMLElement => {
    const parts = libraryParts(entry);
    const row = el("article", `ml-row ${parts.enabled ? "ml-row--on" : "ml-row--off"}`);
    row.dataset["modId"] = entry.modId;
    const name = el("button", "ml-row__name", entry.displayName);
    name.type = "button"; name.title = "Details";
    name.addEventListener("click", () => void openEntry(entry));
    row.append(parts.toggle, el("div", "ml-row__main", el("div", "ml-row__title", el("h4", "", name), parts.badges), parts.meta), parts.actions);
    return row;
  };
  const libraryTile = (entry: LibraryEntry): HTMLElement => {
    const parts = libraryParts(entry);
    const shot = entry.listing?.screenshots[0];
    const wip = entry.listing && isWorkInProgress(entry.listing.tags);
    const node = el("article", `ml-tile ${parts.enabled ? "ml-tile--on" : "ml-tile--off"}${shot ? " ml-tile--art" : ""}${wip ? " ml-tile--flagged" : ""}`);
    node.dataset["modId"] = entry.modId;
    const title = openable(node, entry.displayName, () => void openEntry(entry));
    const badges = [...parts.badges.childNodes].filter((child) => !(child instanceof HTMLElement && child.classList.contains("ml-wip-flag")));
    node.append(
      shot ? coverImage(catalogImageUrl(entry.listing!, shot), "", "ml-tile__art") : "",
      wip ? el("div", "ml-tile__flag", wipFlag(entry.listing!.tags)) : "",
      el("div", "ml-tile__corner", parts.toggle),
      el("div", "ml-tile__body",
        el("div", "ml-tile__eyebrow", el("span", "", ORIGIN_META[entry.origin].label)),
        title,
        entry.listing?.summary ? el("p", "ml-tile__summary", entry.listing.summary)
          : entry.origin === "local" ? el("p", "ml-tile__summary ml-missing", "No description. Imported files carry only their manifest.") : undefined,
        badges.length ? el("div", "ml-tile__badges", ...badges) : undefined,
        el("div", "ml-tile__foot", parts.meta, parts.actions)));
    return node;
  };

  const renderLibrary = (): void => {
    const text = query.trim().toLowerCase();
    const visible = library.filter((entry) => (!text || `${entry.displayName} ${entry.modId}`.toLowerCase().includes(text)) &&
      (libraryFilter === "all" || (libraryFilter === "enabled" ? entry.stagedDigest !== undefined : entry.update !== undefined)));
    const segment = el("div", "ml-segment"); segment.setAttribute("role", "radiogroup"); segment.setAttribute("aria-label", "Filter installed mods");
    for (const [id, label, count] of [["all", "All", library.length], ["enabled", "Enabled", library.filter((entry) => entry.stagedDigest).length],
      ["updates", "Updates", library.filter((entry) => entry.update).length]] as const) {
      const node = el("button", "ml-segment__item", label, el("span", "ml-segment__count", String(count)));
      node.type = "button"; node.setAttribute("role", "radio"); node.setAttribute("aria-checked", String(libraryFilter === id));
      node.addEventListener("click", () => { libraryFilter = id; render(); });
      segment.append(node);
    }
    const importButton = button("Import file", { tone: "secondary", small: true, title: "Add .dibmod files from this device. You can also drop them anywhere here.", onClick: () => fileInput.click() });
    if (!library.length && !text && libraryFilter === "all") {
      main.replaceChildren(emptyState("No mods installed yet", "Find some under Browse, or import a .dibmod file you already have.",
        button("Browse mods", { tone: "primary", onClick: () => switchTab("browse") }),
        button("Import file", { tone: "secondary", onClick: () => fileInput.click() })));
      return;
    }
    const disableAllButton = staged.length > 0 || stagedPvp
      ? button("Disable all", { tone: "ghost", small: true, title: "Turn every mod off. Takes effect when you apply.", onClick: () => run(disableAll) }) : undefined;
    main.replaceChildren(el("div", "ml-toolbar", segment, el("span", "ml-toolbar__spacer"), disableAllButton, importButton, viewToggle()));
    if (!visible.length) {
      main.append(emptyState(text ? "Nothing matches" : libraryFilter === "updates" ? "Everything is up to date" : "No mods are enabled",
        text ? `None of your installed mods match \u201c${query}\u201d.` : libraryFilter === "enabled" ? "Use the switch next to a mod to enable it." : "Updates are checked each time you open this list."));
      return;
    }
    for (const origin of ["official", "community", "local"] as const) {
      const rows = visible.filter((entry) => entry.origin === origin);
      if (!rows.length) continue;
      const meta = ORIGIN_META[origin];
      main.append(el("section", `ml-group ml-group--${origin}`,
        el("h3", "ml-group__title", meta.label, el("small", "", `${rows.length} ${meta.hint}`)),
        view === "grid" ? el("div", "ml-tiles", ...rows.map(libraryTile)) : el("div", "ml-rows", ...rows.map(libraryRow))));
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Load order
  // ---------------------------------------------------------------------------------------------
  const ordinal = (n: number): string => {
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
    return `${n}${suffix}`;
  };
  const renderOrder = (): void => {
    const count = enabledCount();
    if (!staged.length) {
      main.replaceChildren(emptyState(stagedPvp ? "1 mod enabled" : "No mods enabled", stagedPvp ? "Multiplayer PvP is enabled and needs no load order. Enable other mods to arrange their load order." : "Enable mods in Installed, then drag them into the order they activate in here.",
        button("Go to installed mods", { tone: "primary", onClick: () => switchTab("library") })));
      return;
    }
    const recommendedIds = recommended.error ? [] : orderIds(recommended);
    const drifted = !order.error && recommendedIds.length > 0 && orderIds(order).join("\n") !== recommendedIds.join("\n");
    main.replaceChildren(el("div", "ml-toolbar",
      el("span", "ml-toolbar__summary", el("strong", "", String(count)), ` enabled ${count === 1 ? "mod" : "mods"}`,
        stagedPvp ? ". Multiplayer PvP needs no load order. Other mods activate top to bottom." : ", activated top to bottom.",
        staged.length > 1 && !order.error ? " Drag to reorder." : ""),
      el("span", "ml-toolbar__spacer"),
      drifted ? button("Use recommended order", { tone: "secondary", small: true, title: "Forget manual moves and use each mod's own priority and load rules", onClick: () => run(resetOrder) })
        : staged.length > 1 && !order.error ? el("span", "ml-order__status", icon("check", "ml-icon ml-icon--small"), "Recommended order") : undefined));
    if (order.error) {
      const problem = el("div", "ml-problem", el("strong", "", "These mods cannot load together yet"), el("p", "", order.error));
      if (order.overridable) {
        problem.append(el("p", "ml-problem__hint", "One author says their mod is incompatible with another. You can load them anyway; either may misbehave."),
          el("div", "ml-problem__actions", button("Load anyway", { tone: "secondary", small: true, onClick: () => run(loadAnyway) })));
      } else {
        problem.append(el("p", "ml-problem__hint", "Enable what it needs from Installed, or disable the mod that needs it."));
      }
      main.append(problem);
    }
    if (drifted) {
      main.append(el("p", "ml-note ml-note--drift", "Your order differs from the recommended one. Each mod's recommended spot comes from its own load priority and the rules mods declare about each other."));
    }
    const rows = order.error ? stagedPackages : order.packages;
    const ids = rows.map((pkg) => pkg.manifest.id);
    const hintId = `${detailTitleId}-order-hint`;
    const list = el("ol", "ml-order");
    list.setAttribute("aria-describedby", hintId);
    rows.forEach((pkg, at) => {
      const id = pkg.manifest.id;
      const entry = library.find((row) => row.modId === id);
      const name = nameOf(id);
      const handle = iconButton("grip", `Reorder ${name}`);
      handle.className = "ml-order__handle ml-icon-btn ml-icon-btn--ghost";
      handle.setAttribute("aria-describedby", hintId);
      handle.disabled = order.error !== undefined || rows.length < 2;
      handle.addEventListener("keydown", (event) => {
        const target = event.key === "ArrowUp" ? at - 1 : event.key === "ArrowDown" ? at + 1 : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : undefined;
        if (target === undefined) return;
        event.preventDefault();
        void run(async () => {
          if (await place(id, target)) live.textContent = `${name}, now ${orderIds(order).indexOf(id) + 1} of ${rows.length}.`;
        });
      });
      const nameButton = el("button", "ml-order__name", name);
      nameButton.type = "button"; nameButton.title = "Details";
      nameButton.addEventListener("click", () => void openModId(id));
      const declared = rules.filter((rule) => rule.declaredBy === id).map((rule) => rule.after === id ? `after ${nameOf(rule.before)}` : `before ${nameOf(rule.after)}`);
      const meta = el("small", "ml-order__meta", el("span", "", `v${pkg.manifest.version}`), el("span", "", ORIGIN_META[entry?.origin ?? "local"].label),
        el("span", "", `Recommended priority: ${pkg.manifest.priority}`),
        declared.length ? el("span", "", `loads ${listPhrase(declared, "and")}`) : undefined,
        order.advisories.some((advisory) => advisory.modId === id && advisory.kind === "declared-conflict-overridden")
          ? badge("conflict overridden", "warning") : undefined);
      const spot = recommendedIds.indexOf(id);
      const rec = spot < 0 ? undefined : el("span", `ml-order__rec ${spot === at || order.error ? "ml-order__rec--match" : "ml-order__rec--off"}`,
        spot === at ? "Recommended spot" : `Recommended: ${ordinal(spot + 1)}`);
      if (rec) rec.title = "Where this mod's own load priority and declared rules place it";
      const row = el("li", `ml-order__row${spot >= 0 && spot !== at && !order.error ? " ml-order__row--moved" : ""}`,
        handle, el("span", "ml-order__index", String(at + 1)), el("div", "ml-order__main", nameButton, meta), rec);
      row.dataset["modId"] = id;
      list.append(row);
    });
    if (!order.error && rows.length > 1) sortable(list, ids);
    const hint = el("p", "ml-visually-hidden", "Drag a mod by its handle to reorder it. With the keyboard, focus the handle and use the up and down arrow keys; Home and End move it to the top or bottom.");
    hint.id = hintId;
    main.append(list, hint);
    if (rows.length > 1 && !order.error) {
      main.append(el("p", "ml-note", "A later mod overwrites an earlier one where both change the same thing. Declared dependencies and load-order rules always win, so a move they forbid snaps back."));
    }
    for (const advisory of order.advisories) {
      // Manual moves are the player's own choice; the drift note already covers them.
      if (advisory.kind !== "priority-override") main.append(el("p", "ml-note", advisory.message));
    }
    // Seams are what the applied profile actually did, so they only describe an unchanged selection.
    const report = totalChanges() === 0 ? options.interference?.() : undefined;
    if (rows.length < 2 || order.error) return;
    if (totalChanges() > 0) { main.append(el("p", "ml-note", "Apply to see where these mods touch the same parts of the game.")); return; }
    if (!report) { main.append(el("p", "ml-note", "Choose game content to see where these mods touch the same parts of the game.")); return; }
    const seams = el("section", "ml-section ml-seams", el("h3", "", "Shared seams", el("small", "", String(report.seams.length))));
    if (!report.seams.length) seams.append(el("p", "ml-muted", "These mods never change the same thing."));
    else {
      seams.append(el("p", "ml-muted", `${plural(report.warnings.length, "place")} where a later mod discards an earlier one's change.`));
      const items = el("ul", "ml-seams__list");
      for (const seam of report.seams.slice(0, MAX_LISTED_SEAMS)) {
        items.append(el("li", seam.severity === "warning" ? "ml-seams__item ml-seams__item--warn" : "ml-seams__item", el("code", "", seam.target), el("span", "", seam.summary)));
      }
      seams.append(items);
      if (report.seams.length > MAX_LISTED_SEAMS) seams.append(el("p", "ml-muted", `+${report.seams.length - MAX_LISTED_SEAMS} more in the browser console.`));
    }
    main.append(seams);
  };
  /**
   * Pointer drag-and-drop for the Load order list. Mouse can grab a row anywhere; touch and pen
   * grab the handle so the list still scrolls. The other rows slide aside to show the drop slot,
   * and the list scrolls when the pointer nears its edge. Escape cancels a drag in progress.
   */
  const sortable = (list: HTMLOListElement, ids: readonly string[]): void => {
    let suppressClick = false;
    list.addEventListener("click", (event) => { if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopPropagation(); } }, true);
    list.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || busy) return;
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>(".ml-order__row");
      if (!row || !list.contains(row)) return;
      const onHandle = target.closest(".ml-order__handle") !== null;
      if (!onHandle && (event.pointerType !== "mouse" || target.closest("button, a, input, select"))) return;
      if (onHandle) event.preventDefault();
      const rows = [...list.querySelectorAll<HTMLElement>(":scope > .ml-order__row")];
      const from = rows.indexOf(row);
      const listTop = list.getBoundingClientRect().top;
      // Content-relative geometry stays valid while the list scrolls under the pointer.
      const boxes = rows.map((item) => { const rect = item.getBoundingClientRect(); return { top: rect.top - listTop, height: rect.height }; });
      const height = boxes[from]!.height;
      const startY = event.clientY;
      const startScroll = main.scrollTop;
      let lastY = startY;
      let slot = from;
      let dragging = false;
      let done = false;
      let frame = 0;
      const offset = (): number => lastY - startY + (main.scrollTop - startScroll);
      const layout = (): void => {
        const dy = offset();
        row.style.transform = `translateY(${dy}px)`;
        const centre = boxes[from]!.top + height / 2 + dy;
        slot = 0;
        boxes.forEach((box, at) => { if (at !== from && box.top + box.height / 2 < centre) slot++; });
        rows.forEach((item, at) => {
          if (at === from) return;
          const shift = from < at && at <= slot ? -height : slot <= at && at < from ? height : 0;
          item.style.transform = shift ? `translateY(${shift}px)` : "";
        });
      };
      const autoScroll = (): void => {
        const box = main.getBoundingClientRect();
        const edge = 56;
        const speed = lastY < box.top + edge ? -(box.top + edge - lastY) / 4 : lastY > box.bottom - edge ? (lastY - (box.bottom - edge)) / 4 : 0;
        if (speed) { main.scrollTop += Math.round(speed); layout(); }
        frame = requestAnimationFrame(autoScroll);
      };
      const onMove = (move: PointerEvent): void => {
        if (move.pointerId !== event.pointerId) return;
        lastY = move.clientY;
        if (!dragging) {
          if (Math.abs(lastY - startY) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          list.classList.add("ml-order--sorting"); row.classList.add("ml-order__row--dragging");
          frame = requestAnimationFrame(autoScroll);
        }
        move.preventDefault();
        layout();
      };
      const finish = (commit: boolean): void => {
        if (done) return;
        done = true;
        row.removeEventListener("pointermove", onMove);
        row.removeEventListener("pointerup", onUp);
        row.removeEventListener("pointercancel", onCancel);
        row.removeEventListener("lostpointercapture", onLost);
        window.removeEventListener("keydown", onKey, true);
        cancelAnimationFrame(frame);
        if (row.hasPointerCapture(event.pointerId)) row.releasePointerCapture(event.pointerId);
        if (!dragging) return;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);

        if (commit && slot !== from) {
          const others = rows.filter((item) => item !== row);
          list.insertBefore(row, others[slot] ?? null);
        }
        for (const item of rows) item.style.transform = "";
        list.classList.remove("ml-order--sorting"); row.classList.remove("ml-order__row--dragging");
        if (commit && slot !== from) {
          const id = ids[from]!;
          const to = slot;
          // Another action got there first; redraw rather than leave the row where it was dropped.
          if (busy) { render(); return; }
          void run(async () => { if (await place(id, to)) live.textContent = `${nameOf(id)}, now ${orderIds(order).indexOf(id) + 1} of ${ids.length}.`; });
        }
      };
      const onUp = (up: PointerEvent): void => { if (up.pointerId === event.pointerId) finish(true); };
      const onCancel = (cancel: PointerEvent): void => { if (cancel.pointerId === event.pointerId) finish(false); };

      const onLost = (): void => finish(false);
      const onKey = (key: KeyboardEvent): void => {
        if (key.key !== "Escape" || !dragging) return;
        key.preventDefault(); key.stopPropagation();
        finish(false);
      };
      row.setPointerCapture(event.pointerId);
      row.addEventListener("pointermove", onMove);
      row.addEventListener("pointerup", onUp);
      row.addEventListener("pointercancel", onCancel);
      row.addEventListener("lostpointercapture", onLost);
      window.addEventListener("keydown", onKey, true);
    });
  };

  // ---------------------------------------------------------------------------------------------
  // Browse
  // ---------------------------------------------------------------------------------------------
  const card = (mod: CatalogMod): HTMLElement => {
    const state = listingState(mod, library);
    const latest = mod.releases[0];
    const shot = mod.screenshots[0];
    const node = el("article", `ml-card ml-card--${state}${shot ? " ml-card--shot" : ""}`);
    node.tabIndex = 0; node.setAttribute("role", "button"); node.setAttribute("aria-label", `${mod.title} details`);
    node.dataset["modId"] = mod.modId;
    const open = (): void => void openListing(mod);
    node.addEventListener("click", open);
    node.addEventListener("keydown", (event) => { if (event.target === node && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open(); } });
    const meta = el("div", "ml-card__meta", sourceLabel(mod.source));
    const shown = visibleTags(mod.tags);
    if (shown.length) meta.append(el("span", "", shown.slice(0, 4).join(", ")));
    meta.append(el("span", "", `Updated ${formatRelative(mod.updatedAt)}`));
    node.append(
      shot ? coverImage(catalogImageUrl(mod, shot), "", "ml-card__shot") : "",
      el("div", "ml-card__body",
        el("div", "ml-card__head", el("h4", "", mod.title), el("span", "ml-card__author", `by ${mod.author.displayName}`), wipFlag(mod.tags)),
        mod.summary ? el("p", "ml-card__summary", mod.summary) : el("p", "ml-card__summary ml-missing", "No description yet."), meta),
      el("div", "ml-card__side", latest ? el("span", "ml-card__version", `v${latest.version}`) : undefined, latest ? stateAction(mod, state) : badge("No release yet", "muted")));
    return node;
  };
  /** Grid entry: the first screenshot is the backdrop, with the essentials laid over it. */
  const tile = (mod: CatalogMod): HTMLElement => {
    const state = listingState(mod, library);
    const latest = mod.releases[0];
    const shot = mod.screenshots[0];
    const wip = isWorkInProgress(mod.tags);
    const node = el("article", `ml-tile ml-tile--${state}${shot ? " ml-tile--art" : ""}${wip ? " ml-tile--flagged" : ""}`);
    node.dataset["modId"] = mod.modId;
    const title = openable(node, mod.title, () => void openListing(mod));
    const shown = visibleTags(mod.tags);
    node.append(
      shot ? coverImage(catalogImageUrl(mod, shot), "", "ml-tile__art") : "",
      wip ? el("div", "ml-tile__flag", wipFlag(mod.tags)) : "",
      el("div", "ml-tile__body",
        el("div", "ml-tile__eyebrow",
          el("div", "ml-tile__categories", sourceLabel(mod.source),
            ...shown.slice(0, 2).map(tag => el("span", "ml-tile__tag", tag))),
          latest ? el("span", "ml-tile__version", `v${latest.version}`) : undefined),
        title,
        mod.summary ? el("p", "ml-tile__summary", mod.summary) : el("p", "ml-tile__summary ml-missing", "No description yet."),
        el("div", "ml-tile__foot",
          el("span", "ml-tile__author", `by ${mod.author.displayName}`),
          latest ? stateAction(mod, state) : badge("No release yet", "muted"))));
    return node;
  };

  const renderBrowse = (): void => {
    const included = pvpListingMatches(query, tag, author?.id) ? [PVP_LISTING] : [];
    const shownMods = [...included, ...(results?.mods ?? []).filter(mod => mod.modId !== PVP_MOD.id)];
    shownMods.sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) :
      (sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
    const total = (results?.total ?? 0) + included.length;
    const sortSelect = el("select", "ml-select__input"); sortSelect.setAttribute("aria-label", "Sort mods");
    for (const entry of SORTS) { const option = el("option", "", entry.label); option.value = entry.id; option.selected = entry.id === sort; sortSelect.append(option); }
    sortSelect.addEventListener("change", () => { sort = sortSelect.value as CatalogSort; void loadBrowse(); });
    const filtered = Boolean(query || tag || author);
    const summary = el("span", "ml-toolbar__summary");
    summary.append(el("strong", "", String(total)), filtered ? ` ${total === 1 ? "match" : "matches"}` : ` ${total === 1 ? "mod" : "mods"}`);
    const toolbar = el("div", "ml-toolbar", summary);
    if (author) {
      const chip = el("button", "ml-chip ml-chip--active", `by ${author.name}`, icon("close", "ml-icon ml-icon--small"));
      chip.type = "button"; chip.title = "Show every author";
      chip.addEventListener("click", () => { author = undefined; void loadBrowse(); });
      toolbar.append(chip);
    }
    toolbar.append(el("span", "ml-toolbar__spacer"), el("label", "ml-select", "Sort", sortSelect), viewToggle());
    main.replaceChildren(toolbar);
    if (catalogError) main.append(el("div", "ml-note", el("p", "", "The online catalog is unavailable. Included mods are still available."),
      button("Try again", { tone: "secondary", onClick: () => run(async () => { await loadInfo(); await loadBrowse(); }) })));
    const shownTags = tags.map(entry => ({ ...entry }));
    for (const value of PVP_LISTING.tags) {
      const existing = shownTags.find(entry => entry.tag === value);
      if (existing) existing.count++;
      else shownTags.push({ tag: value, count: 1 });
    }
    if (shownTags.length) {
      const chips = el("div", "ml-chips"); chips.setAttribute("aria-label", "Filter by tag");
      const chipFor = (label: string, value: string | undefined, count?: number): HTMLButtonElement => {
        const node = el("button", `ml-chip${tag === value ? " ml-chip--active" : ""}`, label,
          count !== undefined ? el("span", "ml-chip__count", String(count)) : undefined);
        node.type = "button"; node.setAttribute("aria-pressed", String(tag === value));
        node.addEventListener("click", () => { tag = tag === value ? undefined : value; void loadBrowse(); });
        return node;
      };
      // Keep the filter row to one line; the long tail sits behind a toggle (an active tag always shows).
      const limit = 8;
      const shown = tagsExpanded ? shownTags : shownTags.filter((entry, at) => at < limit || entry.tag === tag);
      chips.append(chipFor("All tags", undefined), ...shown.map((entry) => chipFor(entry.tag, entry.tag, entry.count)));
      if (shownTags.length > limit) {
        const more = el("button", "ml-chip ml-chip--more", tagsExpanded ? "Fewer tags" : `${shownTags.length - shown.length} more`);
        more.type = "button"; more.setAttribute("aria-expanded", String(tagsExpanded));
        more.addEventListener("click", () => { tagsExpanded = !tagsExpanded; render(); });
        chips.append(more);
      }
      main.append(chips);
    }
    if (!results && info?.enabled) main.append(el("p", "ml-loading", "Loading more mods\u2026"));
    if (!shownMods.length) {
      main.append(emptyState(filtered ? "No mods match" : "Nothing to browse yet",
        filtered ? "Try a different search, or clear the filters." : "This server has not published any mods, and nobody has shared one here yet.",
        ...(filtered ? [button("Clear filters", { tone: "secondary", onClick: () => { query = ""; search.value = ""; tag = undefined; author = undefined; void loadBrowse(); } })] : [])));
      return;
    }
    main.append(view === "grid" ? el("div", "ml-tiles", ...shownMods.map(tile)) : el("div", "ml-list", ...shownMods.map(card)));
    if (results && results.next !== null) {
      main.append(el("div", "ml-more", button(`Show ${Math.min(results.total - results.mods.length, results.mods.length)} more`, { tone: "secondary", onClick: () => run(() => loadBrowse(true)) })));
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Details
  // ---------------------------------------------------------------------------------------------
  const gallery = (mod: CatalogMod): HTMLElement => {
    if (!mod.screenshots.length) return el("div", "ml-gallery ml-gallery--missing", icon("image"), el("span", "", "No screenshots"));
    let index = 0;
    const image = el("img", ""); image.alt = `${mod.title} screenshot`; image.decoding = "async";
    const frame = el("button", "ml-gallery__main", image); frame.type = "button"; frame.title = "View full size";
    const thumbs = el("div", "ml-gallery__thumbs");
    const show = (next: number): void => {
      index = (next + mod.screenshots.length) % mod.screenshots.length;
      image.src = catalogImageUrl(mod, mod.screenshots[index]!);
      for (const [at, thumb] of [...thumbs.children].entries()) thumb.setAttribute("aria-current", String(at === index));
    };
    mod.screenshots.forEach((digest, at) => {
      const thumb = el("button", "ml-gallery__thumb", Object.assign(el("img", ""), { src: catalogImageUrl(mod, digest), alt: "", loading: "lazy" }));
      thumb.type = "button"; thumb.setAttribute("aria-label", `Screenshot ${at + 1}`);
      thumb.addEventListener("click", () => show(at));
      thumbs.append(thumb);
    });
    frame.addEventListener("click", () => lightbox(mod, index));
    const wrapper = el("div", "ml-gallery", frame);
    if (mod.screenshots.length > 1) {
      wrapper.append(el("div", "ml-gallery__nav", iconButton("left", "Previous screenshot", () => show(index - 1)), iconButton("right", "Next screenshot", () => show(index + 1))), thumbs);
    }
    show(0);
    return wrapper;
  };
  const lightbox = (mod: CatalogMod, start: number): void => {
    let index = start;
    const image = el("img", ""); image.alt = `${mod.title} screenshot`;
    const counter = el("span", "ml-lightbox__count");
    const show = (next: number): void => {
      index = (next + mod.screenshots.length) % mod.screenshots.length;
      image.src = catalogImageUrl(mod, mod.screenshots[index]!); counter.textContent = `${index + 1} of ${mod.screenshots.length}`;
    };
    const box = el("div", "ml-lightbox", image, el("div", "ml-lightbox__bar", iconButton("left", "Previous", () => show(index - 1)), counter,
      iconButton("right", "Next", () => show(index + 1)), iconButton("close", "Close", () => done())));
    box.setAttribute("role", "dialog"); box.setAttribute("aria-label", `${mod.title} screenshots`);
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); done(); }
      else if (event.key === "ArrowLeft") show(index - 1);
      else if (event.key === "ArrowRight") show(index + 1);
    };
    const done = (): void => { box.remove(); dialog.removeEventListener("keydown", onKey, true); previous?.focus?.(); };
    box.addEventListener("click", (event) => { if (event.target === box) done(); });
    dialog.addEventListener("keydown", onKey, true);
    dialog.append(box); show(index);
    (box.querySelector(".ml-icon-btn:last-child") as HTMLElement).focus();
  };

  const renderDetail = (subject: Detail): void => {
    const mod = subject.mod;
    const entry = library.find((row) => row.modId === subject.modId);
    const manifest = subject.pkg?.manifest;
    const origin: LibraryOrigin = mod?.source ?? entry?.origin ?? "local";
    const title = mod?.title ?? entry?.displayName ?? manifest?.displayName ?? subject.modId;
    const latest = mod?.releases[0];
    const stored = entry?.versions.find((version) => version.stored && version.digest === entry.stagedDigest) ?? entry?.versions.find((version) => version.stored);
    const deviceRow = stored ? device.find((row) => row.digest === stored.digest) : undefined;
    modalSource.replaceChildren(sourceLabel(origin), mod?.source === "official" ? el("span", "", mod.modId === PVP_MOD.id ? " \u00b7 included with the game" : " \u00b7 shipped by this server") : "");

    // What this window cannot show, said once up front.
    const notices: HTMLElement[] = [];
    if (mod && isWorkInProgress(mod.tags)) {
      notices.push(el("div", "ml-wip", icon("alert"), el("div", "", el("strong", "", "Work in progress"),
        el("p", "", "This mod is unfinished. Expect rough edges, missing pieces and the occasional broken battle while it is being built."))));
    }
    if (!mod) {
      const heading = subject.loading ? "Loading its store page\u2026" : subject.note ? "Store page unavailable" : "No store page";
      const text = subject.loading ? "Showing what the file on this device says in the meantime."
        : subject.note ?? "This mod was imported from a file, so it has no description, screenshots, author or tags. Everything below comes from its manifest.";
      notices.push(el("div", "ml-gaps", icon("info"), el("div", "", el("strong", "", heading), el("p", "", text))));
    } else {
      const gaps = missingDetails({ description: mod.description, screenshots: mod.screenshots.length, tags: visibleTags(mod.tags).length, author: true, releases: mod.releases.length });
      if (gaps.length) {
        const words = gaps.map((gap) => gap === "description" ? "a description" : gap === "downloadable release" ? "a downloadable release" : gap);
        notices.push(el("div", "ml-gaps", icon("info"), el("div", "", el("strong", "", "Some details are missing"),
          el("p", "", `${mod.source === "official" ? "This listing does" : "The author has"} not ${mod.source === "official" ? "include" : "added"} ${listPhrase(words)} yet.`))));
      }
    }

    // Heading, byline and the one primary action.
    const heading = el("h2", "ml-detail__title ml-title-face", title); heading.id = detailTitleId;
    let byline: HTMLElement;
    if (mod) {
      const authorLink = el("button", "ml-link", mod.author.displayName);
      authorLink.type = "button"; authorLink.title = `More mods by ${mod.author.displayName}`;
      authorLink.addEventListener("click", () => browseFiltered({ author: mod.author }));
      byline = el("p", "ml-detail__byline", "by ", authorLink, mod.source === "official" ? "" : ` (@${mod.author.username})`);
    } else {
      byline = el("p", "ml-detail__byline", "by ", missing("unknown author", "span"));
    }
    const state = mod ? listingState(mod, library) : undefined;
    const actions = el("div", "ml-detail__actions",
      mod && state ? (latest ? stateAction(mod, state, true) : badge("No release to download", "warning")) : entry ? entryAction(entry, true) : undefined);
    if (entry && entry.modId !== PVP_MOD.id && entry.versions.some((version) => version.stored)) {
      actions.append(iconButton("trash", "Remove from device", () => run(() => remove(entry)), "danger"));
    }
    const head = el("header", "ml-detail__head",
      el("div", "", heading, mod?.summary ? el("p", "ml-detail__summary", mod.summary) : el("p", "ml-detail__summary ml-missing", "No summary provided."), byline),
      actions,
      entry?.update ? el("p", "ml-detail__hint", `You have v${entry.versions[0]?.version}. Version ${entry.update.version} is out.`) : undefined);
    const facts = el("dl", "ml-facts");
    const fact = (label: string, value: Node | string): void => { facts.append(el("div", "", el("dt", "", label), el("dd", "", value))); };
    fact("Version", latest?.version ?? stored?.version ?? manifest?.version ?? missing("unknown", "span"));
    fact("Save compatibility", modSaveCompatibilityLabel(latest ? latest.saveCompatibility : manifest?.saveCompatibility));
    if (mod) fact("Updated", formatRelative(mod.updatedAt));
    else if (deviceRow?.cachedAt) fact("Added", formatRelative(deviceRow.cachedAt));
    const size = latest?.byteLength ?? stored?.byteLength;
    if (size) fact(mod ? "Download" : "Size", formatBytes(size));
    fact("Mod ID", el("span", "ml-facts__id", el("code", "", subject.modId), iconButton("copy", "Copy mod ID", async () => {
      try { await navigator.clipboard.writeText(subject.modId); toaster.show("Mod ID copied.", "success"); } catch { toaster.show("This browser blocked copying. Select the ID instead.", "error"); }
    })));
    if (!mod && deviceRow) fact("File", deviceRow.archiveName);
    head.append(facts);
    head.append(el("p", "ml-muted", "Save-neutral is the author's declaration that the mod can be added or removed without requiring changes to your save. Dependencies and conflicts still apply. Unclassified mods are treated as save-dependent."));

    const about = el("section", "ml-section", el("h3", "", "About"),
      mod?.description ? el("p", "ml-prose", mod.description)
        : missing(mod ? "No description provided." : "No description. A .dibmod file carries only its manifest: name, version, ID and load rules."));

    // Versions: catalog releases when there is a listing, otherwise the copies on this device.
    const versions = el("section", "ml-section", el("h3", "", "Versions", el("small", "", String(mod ? mod.releases.length : entry?.versions.length ?? 0))));
    const list = el("ol", "ml-versions");
    if (mod) {
      for (const [at, release] of mod.releases.entries()) {
        const copy = entry?.versions.find((version) => version.digest === release.digest && version.stored);
        const on = entry?.stagedDigest === release.digest;
        const rowActions = el("div", "ml-versions__actions");
        if (on) rowActions.append(button("In use", { icon: "check", tone: "success", small: true, title: "Disable", onClick: () => run(() => disable(entry!)) }));
        else if (copy && mod.modId === PVP_MOD.id) rowActions.append(button("Use this", { tone: "secondary", small: true, onClick: () => run(() => enable(PVP_BUILTIN_RELEASE)) }));
        else if (copy) rowActions.append(button("Use this", { tone: "secondary", small: true, title: "Switch to this version", onClick: () => run(() => enable(release.digest)) }),
          iconButton("trash", `Remove v${release.version}`, () => run(() => remove(entry!, release.digest)), "danger"));
        else rowActions.append(button("Install", { small: true, tone: at === 0 ? "primary" : "secondary", onClick: () => run(() => install(mod, release)) }));
        const deps = Object.keys(release.dependencies).length;
        list.append(el("li", `ml-versions__row${on ? " ml-versions__row--on" : ""}`,
          el("div", "ml-versions__main", el("strong", "", `v${release.version}`), at === 0 ? badge("latest", "update") : undefined,
            copy ? badge("on this device", "muted") : undefined),
          el("small", "ml-versions__meta", el("span", "", formatRelative(release.createdAt)), el("span", "", mod.modId === PVP_MOD.id ? "Included with the game" : formatBytes(release.byteLength)),
            el("span", "", `API ${release.apiVersion}`), el("span", "", modSaveCompatibilityLabel(release.saveCompatibility)), deps ? el("span", "", plural(deps, "requirement")) : undefined),
          rowActions));
      }
      if (!mod.releases.length) list.append(el("li", "ml-versions__row", missing("No release has been uploaded yet.")));
    } else if (entry) {
      for (const version of entry.versions) {
        const on = entry.stagedDigest === version.digest;
        const rowActions = el("div", "ml-versions__actions");
        if (on) rowActions.append(button("In use", { icon: "check", tone: "success", small: true, title: "Disable", onClick: () => run(() => disable(entry)) }));
        else if (version.stored) rowActions.append(button("Use this", { tone: "secondary", small: true, onClick: () => run(() => enable(version.digest)) }),
          iconButton("trash", `Remove v${version.version}`, () => run(() => remove(entry, version.digest)), "danger"));
        list.append(el("li", `ml-versions__row${on ? " ml-versions__row--on" : ""}`,
          el("div", "ml-versions__main", el("strong", "", `v${version.version}`), version.stored ? badge("on this device", "muted") : badge("files cleared", "warning")),
          el("small", "ml-versions__meta", version.byteLength ? el("span", "", formatBytes(version.byteLength)) : undefined, el("span", "", "no release notes")),
          rowActions));
      }
    }
    versions.append(list);

    // Requirements: the latest release's, or the manifest's for a file.
    const deps = Object.entries(latest?.dependencies ?? manifest?.dependencies ?? {});
    const requirements = el("section", "ml-section", el("h3", "", "Needs"));
    if (!latest && !manifest) requirements.append(missing(subject.loading ? "Loading\u2026" : "Unknown until it is on this device."));
    else if (!deps.length) requirements.append(el("p", "ml-muted", "Nothing else. It works on its own."));
    else {
      const items = el("ul", "ml-deps");
      for (const [id, range] of deps) {
        const have = library.find((row) => row.modId === id)?.versions.some((version) => version.stored && matchesRange(version.version, range));
        items.append(el("li", have ? "ml-deps--ok" : "", el("code", "", id),
          el("small", "", `${range === "*" ? "any version" : range}, ${have ? "installed" : mod ? "installed with this mod" : "not installed"}`)));
      }
      requirements.append(items);
    }
    const side = el("aside", "", requirements);
    // How it orders itself; known only from the manifest, i.e. once it is on this device.
    if (manifest) {
      const rows = el("ul", "ml-rules");
      const line = (label: string, value: string): void => { rows.append(el("li", "", el("span", "ml-rules__label", label), el("span", "", value))); };
      line("Recommended priority", manifest.priority === 0 ? "0 (default)" : `${manifest.priority} (${manifest.priority > 0 ? "loads late" : "loads early"})`);
      const after = [...Object.keys(manifest.optionalDependencies), ...manifest.loadAfter];
      if (after.length) line("Loads after", listPhrase([...new Set(after)].map(nameOf), "and"));
      if (manifest.loadBefore.length) line("Loads before", listPhrase(manifest.loadBefore.map(nameOf), "and"));
      const conflicts = Object.entries(manifest.conflicts);
      if (conflicts.length) line("Conflicts with", conflicts.map(([id, range]) => `${nameOf(id)}${range === "*" ? "" : ` ${range}`}`).join(", "));
      side.append(el("section", "ml-section", el("h3", "", "Load order"), rows));
    }
    const shownTags = mod ? visibleTags(mod.tags) : [];
    const tagSection = el("section", "ml-section", el("h3", "", "Tags"));
    if (shownTags.length) {
      const tagList = el("div", "ml-taglist");
      for (const value of shownTags) {
        const link = el("button", "ml-link", value); link.type = "button"; link.title = `More ${value} mods`;
        link.addEventListener("click", () => browseFiltered({ tag: value }));
        tagList.append(link);
      }
      tagSection.append(tagList);
    } else tagSection.append(missing("No tags."));
    side.append(tagSection);
    const authorSection = el("section", "ml-section", el("h3", "", "Author"));
    if (mod) {
      authorSection.append(el("p", "ml-author-card__name", mod.author.displayName));
      if (mod.author.bio) authorSection.append(el("p", "ml-prose", mod.author.bio));
      const links = el("div", "ml-author-card__links");
      if (mod.author.website) links.append(externalLink(mod.author.website, new URL(mod.author.website).host));
      const more = el("button", "ml-link", `More by ${mod.author.displayName}`); more.type = "button";
      more.addEventListener("click", () => browseFiltered({ author: mod.author }));
      links.append(more);
      authorSection.append(links);
    } else authorSection.append(missing("No author information. Files don't say who made them."));
    side.append(authorSection);

    modalScroll.replaceChildren(el("div", "ml-detail", ...notices, head, mod ? gallery(mod) : el("div", "ml-gallery ml-gallery--missing", icon("image"), el("span", "", "No screenshots")),
      el("div", "ml-detail__cols", el("div", "", about, versions), side)));
  };

  const render = (): void => {
    library = [pvpLibraryEntry(stagedPvp, appliedPvp), ...library.filter(entry => entry.modId !== PVP_MOD.id)];
    browseCount ??= 1;
    // Rendering replaces nodes; put focus back on the equivalent control so keyboard users (and
    // the dialog's own key handling) never fall out to <body>.
    const active = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement) ? document.activeElement : undefined;
    const inModal = active !== undefined && modal.contains(active);
    const tabKey = active?.closest("[data-tab]")?.getAttribute("data-tab");
    const modKey = active?.closest("[data-mod-id]")?.getAttribute("data-mod-id");
    const role = active?.classList[0];
    const label = active?.getAttribute("aria-label") ?? active?.textContent;
    const mainScroll = main.scrollTop;
    const detailScroll = modalScroll.scrollTop;
    renderTabs();
    renderApplyBar();
    // Load order has nothing to search; the box keeps its place in the header layout.
    searchBox.classList.toggle("ml-search--idle", tab === "order");
    search.placeholder = tab === "library" ? "Search installed mods" : tab === "order" ? "" : "Search mods";
    if (tab === "library") renderLibrary();
    else if (tab === "order") renderOrder();
    else renderBrowse();
    main.scrollTop = mainScroll;
    modal.hidden = detail === undefined;
    for (const node of [top, body, applyBar]) node.inert = detail !== undefined;
    if (detail) { renderDetail(detail); modalScroll.scrollTop = detailScroll; }
    else modalScroll.replaceChildren();
    if (active && !active.isConnected) {
      let restored: HTMLElement | null | undefined;
      if (inModal && detail) {
        const candidates = role ? [...modalScroll.querySelectorAll<HTMLElement>(`.${CSS.escape(role)}`)] : [];
        restored = candidates.find((node) => (node.getAttribute("aria-label") ?? node.textContent) === label) ?? candidates[0] ?? modalPanel;
      } else {
        const scope = modKey ? main.querySelector<HTMLElement>(`[data-mod-id="${CSS.escape(modKey)}"]`) : undefined;
        restored = tabKey ? tabBar.querySelector<HTMLElement>(`[data-tab="${tabKey}"]`)
          : scope && role ? (scope.classList.contains(role) ? scope : scope.querySelector<HTMLElement>(`.${CSS.escape(role)}`)) : undefined;
      }
      (restored ?? (detail ? modalPanel : main)).focus({ preventScroll: true });
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------------------------
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener("input", () => {
    query = search.value;
    clearTimeout(searchTimer);
    if (tab === "library" || tab === "order") { render(); return; }
    searchTimer = setTimeout(() => { void loadBrowse(); }, 250);
  });
  fileInput.addEventListener("change", () => {
    const files = [...(fileInput.files ?? [])]; fileInput.value = "";
    if (files.length) void run(() => importFiles(files));
  });
  dialog.addEventListener("keydown", (event) => {
    if (detail) return;
    const target = event.target as HTMLElement;
    if (event.key === "/" && tab !== "order" && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) { event.preventDefault(); search.focus(); search.select(); }
    if (event.key === "Escape" && target === search && search.value) {
      event.preventDefault(); searchCleared = true; search.value = ""; search.dispatchEvent(new Event("input"));
    }
  });
  // Escape inside the details window closes just that window.
  modal.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation();
    closeDetail();
  });
  // A press that starts inside the window and ends on the backdrop (selecting text) is not a dismissal.
  let pressedBackdrop = false;
  modal.addEventListener("pointerdown", (event) => { pressedBackdrop = event.target === modal; });
  modal.addEventListener("click", (event) => { if (event.target === modal && pressedBackdrop) closeDetail(); });
  // Escape first clears a search, then closes (asking about unapplied changes).
  let searchCleared = false;
  dialog.addEventListener("cancel", (event) => {
    // A dismissed file picker fires a bubbling `cancel` on its <input>; only the dialog's own counts.
    if (event.target !== dialog) return;
    event.preventDefault();
    if (detail) { closeDetail(); return; }
    if (searchCleared) { searchCleared = false; return; }
    void close();
  });
  dialog.addEventListener("keyup", () => { searchCleared = false; });
  tabBar.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const at = TABS.findIndex((entry) => entry.id === tab);
    const next = TABS[(at + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : TABS.length - 1)) % TABS.length]!;
    switchTab(next.id);
    (tabBar.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus();
  });
  let dragDepth = 0;
  dialog.addEventListener("dragenter", (event) => { if (event.dataTransfer?.types.includes("Files")) { dragDepth++; dialog.classList.add("ml--dragging"); } });
  dialog.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dialog.classList.remove("ml--dragging"); });
  dialog.addEventListener("dragover", (event) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); });
  dialog.addEventListener("drop", (event) => {
    event.preventDefault(); dragDepth = 0; dialog.classList.remove("ml--dragging");
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) void run(() => importFiles(files));
  });

  document.body.append(dialog);
  // Desktop starts in the search box; touch devices should not open the keyboard unasked.
  if (globalThis.matchMedia?.("(pointer: coarse)").matches || tab === "order") main.autofocus = true;
  else search.autofocus = true;
  dialog.showModal();
  dialog.addEventListener("close", () => { clearTimeout(searchTimer); dialog.remove(); }, { once: true });
  render();
  void run(async () => {
    await refreshDevice();
    render();
    await loadInfo();
    await refreshDevice(true);
    // First visit with nothing installed: show what is available instead of an empty page.
    if (!options.initialTab && library.every(entry => entry.modId === PVP_MOD.id) && info?.enabled && (browseCount ?? 0) > 0) { tab = "browse"; void loadBrowse(); }
    else if (tab === "browse") void loadBrowse();
  });
}
