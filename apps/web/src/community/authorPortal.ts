import type { AuthorProfile, CatalogMod, CommunityInfo } from "@dib/mod-kernel/catalog";
import { ACCOUNT_USERNAME_MAX_LENGTH, ACCOUNT_USERNAME_MIN_LENGTH } from "@dib/game-protocol";
import { communityInfo, communityJson, CommunityRequestError } from "../content/communityClient.js";
import { formatBytes, formatRelative } from "../content/modLibraryModel.js";
import { icon } from "../content/modIcons.js";
import { badge, button, el, emptyState, externalLink, iconButton, sheet, Toaster } from "../content/modUi.js";
import { loadRequiredLocalFonts } from "../localFonts.js";
import "../content/modLibrary.css";
import "./authorPortal.css";

const root = document.querySelector<HTMLElement>("#community")!;
root.className = "mlp";
const toaster = new Toaster();
const progress = el("div", "ml-progress"); progress.hidden = true;
const headerRight = el("div", "mlp-top__right");
const header = el("header", "mlp-top",
  el("h1", "mlp-top__title", el("span", "ml-title-face", "Mod authors"), el("small", "", "Dragon Island Blue")), headerRight, progress);
// Titles use the game's own face; the page stays usable in the fallback if it cannot load.
void loadRequiredLocalFonts();
const content = el("main", "mlp-main");
root.append(header, content, toaster.node);

// Deliberately memory-only. Password managers can save the login key; mods never share this origin.
let token = "";
let profile: AuthorProfile | undefined;
let info: CommunityInfo;
let busy = false;
const previewUrls: string[] = [];
const clearPreviews = (): void => { for (const url of previewUrls.splice(0)) URL.revokeObjectURL(url); };

async function task(work: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true; progress.hidden = false; root.setAttribute("aria-busy", "true");
  try { await work(); }
  catch (error) { toaster.show(error instanceof Error ? error.message : String(error), "error"); }
  finally { busy = false; progress.hidden = true; root.removeAttribute("aria-busy"); }
}
async function api<T>(path: string, method = "POST", body?: unknown, extra?: HeadersInit): Promise<T> {
  try {
    return await communityJson<T>(path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body instanceof Blob ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }), ...extra },
      ...(body === undefined ? {} : { body: body instanceof Blob ? body : JSON.stringify(body) }) });
  } catch (error) {
    if (token && error instanceof CommunityRequestError && error.status === 401) { login(); }
    throw error;
  }
}

// -------------------------------------------------------------------------------------------------
// Form primitives
// -------------------------------------------------------------------------------------------------
let fieldIds = 0;
/** Label bound by for/id; hints are descriptions, so each input's accessible name is just its label. */
function field(label: string, control: HTMLElement, hint?: string, counter?: number): HTMLElement {
  const input = control.matches("input, textarea") ? control as HTMLInputElement | HTMLTextAreaElement
    : control.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  const labelNode = el("label", "mlp-field__label", label);
  const wrapper = el("div", "mlp-field", labelNode, control);
  if (input) { input.id ||= `mlp-field-${++fieldIds}`; labelNode.htmlFor = input.id; }
  if (hint || counter) {
    const foot = el("span", "mlp-field__hint", hint ?? "");
    if (input) { foot.id = `${input.id}-hint`; input.setAttribute("aria-describedby", foot.id); }
    if (counter && input) {
      const count = el("span", "mlp-field__count");
      const update = (): void => { count.textContent = `${input.value.length} / ${counter}`; };
      input.addEventListener("input", update); update(); foot.append(count);
    }
    wrapper.append(foot);
  }
  return wrapper;
}
function textInput(value = "", options: { max?: number; placeholder?: string; autocomplete?: AutoFill; name?: string } = {}): HTMLInputElement {
  const input = el("input", "mlp-input"); input.value = value;
  if (options.max) input.maxLength = options.max;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.name) input.name = options.name;
  return input;
}
function secretInput(input: HTMLInputElement): HTMLElement {
  input.type = "password";
  const toggle = iconButton("eye", "Show key", () => {
    const shown = input.type === "text";
    input.type = shown ? "password" : "text";
    toggle.replaceChildren(icon(shown ? "eye" : "eyeOff"));
    toggle.title = shown ? "Show key" : "Hide key"; toggle.setAttribute("aria-label", toggle.title);
  });
  return el("span", "mlp-secret", input, toggle);
}
function card(title: string | Node, ...children: (Node | undefined)[]): HTMLElement {
  return el("section", "mlp-card", el("h2", "mlp-card__title", title), ...children);
}
function submitButton(label: string): HTMLButtonElement {
  const node = button(label, { tone: "primary" }); node.type = "submit"; return node;
}

// -------------------------------------------------------------------------------------------------
// Sign in / register
// -------------------------------------------------------------------------------------------------
function login(mode: "signin" | "register" = "signin"): void {
  clearPreviews();
  token = ""; profile = undefined;
  headerRight.replaceChildren(externalLink("./modding.html#code-mods", "Modding guide", "external", "ml-btn ml-btn--ghost"));
  const switcher = el("div", "ml-segment mlp-auth__switch");
  for (const [id, label] of [["signin", "Sign in"], ["register", "Create account"]] as const) {
    if (id === "register" && !info.registrationEnabled) continue;
    const node = el("button", "ml-segment__item", label); node.type = "button";
    node.setAttribute("aria-checked", String(mode === id)); node.setAttribute("role", "radio");
    node.addEventListener("click", () => login(id));
    switcher.append(node);
  }
  const form = el("form", "mlp-form"); form.autocomplete = "on";
  if (mode === "signin") {
    form.method = "post"; form.action = "/api/community/session";
    const username = textInput("", { autocomplete: "username", name: "username", placeholder: "Your username" });
    const key = textInput("", { autocomplete: "current-password", name: "password", placeholder: "Paste your login key" }); key.required = true;
    form.append(field("Username", username, "Optional. Lets your password manager match the key."), field("Login key", secretInput(key)),
      submitButton("Sign in"));
    form.addEventListener("submit", (event) => { event.preventDefault(); void task(async () => {
      const result = await api<{ token: string; profile: AuthorProfile }>("/session", "POST", { loginToken: key.value });
      token = result.token; profile = result.profile; key.value = ""; await dashboard();
    }); });
  } else {
    const name = textInput("", { autocomplete: "username", name: "username", placeholder: "Pick a public username" });
    name.required = true; name.maxLength = ACCOUNT_USERNAME_MAX_LENGTH; name.minLength = ACCOUNT_USERNAME_MIN_LENGTH;
    form.append(field("Username", name, "Shown on your mods. It cannot be changed later."), submitButton("Create account"));
    form.addEventListener("submit", (event) => { event.preventDefault(); void task(async () => {
      const result = await api<{ token: string; loginToken: string; profile: AuthorProfile }>("/accounts", "POST", { username: name.value });
      token = result.token; profile = result.profile;
      revealKey(result.profile.username, result.loginToken);
    }); });
  }
  const hero = el("div", "mlp-auth__intro",
    el("h2", "ml-title-face", "Share a mod with other players"),
    el("p", "", "Upload a .dibmod package, describe it, add a few screenshots, and it appears under Browse in every player's Mod Manager. When you upload a new version, players who installed it are offered the update."),
    el("p", "", "Sign in with your Online login key, or create an account here. You don't need the game files, and your saves and scoreboard entry stay private."));
  content.replaceChildren(el("div", "mlp-auth", hero, el("div", "mlp-card mlp-auth__card", switcher, form,
    el("p", "mlp-fine", "You stay signed in for up to eight hours in this tab. Nothing is saved to the browser."))));
  (form.querySelector("input:not([type=hidden])") as HTMLInputElement | null)?.focus();
}
function revealKey(username: string, key: string): void {
  const name = textInput(username, { autocomplete: "username", name: "username" }); name.readOnly = true;
  const secret = textInput(key, { autocomplete: "new-password", name: "password" }); secret.readOnly = true;
  const form = el("form", "mlp-form", field("Username", name), field("Login key", secretInput(secret)),
    el("div", "mlp-form__row",
      button("Copy key", { tone: "secondary", onClick: () => task(async () => { await navigator.clipboard.writeText(key); toaster.show("Key copied. Store it somewhere safe.", "success"); }) }),
      button("I saved my key", { tone: "primary", onClick: () => task(dashboard) })));
  form.addEventListener("submit", (event) => event.preventDefault());
  content.replaceChildren(el("div", "mlp-narrow", card("Save your login key",
    el("p", "mlp-warning", "This key is also your Online game login. It is shown once and can't be recovered, so save it in a password manager now."),
    form)));
}

// -------------------------------------------------------------------------------------------------
// Dashboard
// -------------------------------------------------------------------------------------------------
function signedInHeader(): void {
  if (!profile) return;
  const who = el("button", "ml-btn ml-btn--ghost mlp-who", el("span", "", profile.displayName), el("small", "", `@${profile.username}`));
  who.type = "button"; who.title = "Edit your public profile";
  who.addEventListener("click", () => editProfile());
  headerRight.replaceChildren(who, iconButton("logout", "Sign out", () => task(async () => { try { await api("/logout"); } finally { login(); } })));
}
function statusBadge(mod: CatalogMod): HTMLElement {
  return mod.published ? badge("Published", "success") : mod.releases.length ? badge("Draft", "warning") : badge("Needs a release", "muted");
}
async function dashboard(): Promise<void> {
  clearPreviews();
  const result = await api<{ profile: AuthorProfile; mods: CatalogMod[]; next: number | null }>("/me");
  profile = result.profile;
  signedInHeader();
  const published = result.mods.filter((mod) => mod.published).length;
  const releases = result.mods.reduce((sum, mod) => sum + mod.releases.length, 0);
  const count = (value: number, word: string): string => `${value} ${word}${value === 1 ? "" : "s"}`;
  const head = el("div", "mlp-head", el("div", "", el("h2", "ml-title-face", "Your mods"),
    el("p", "ml-muted", result.mods.length ? `${count(result.mods.length, "listing")}, ${published} published, ${count(releases, "release")} uploaded.` : "Nothing here yet.")),
    button("New mod", { tone: "primary", onClick: () => editMod() }));
  const list = el("div", "ml-rows");
  for (const mod of result.mods) {
    const row = el("article", "ml-row mlp-row",
      el("div", "ml-row__main", el("div", "ml-row__title", el("h4", "", mod.title), statusBadge(mod)),
        el("div", "ml-row__meta", el("code", "", mod.modId), el("span", "", mod.releases[0] ? `v${mod.releases[0].version}` : "no release"),
          el("span", "", count(mod.screenshots.length, "screenshot")), el("span", "", `updated ${formatRelative(mod.updatedAt)}`))),
      el("div", "ml-row__actions", button("Edit", { tone: "secondary", small: true, onClick: () => editMod(mod) })));
    row.addEventListener("click", () => editMod(mod));
    list.append(row);
  }
  content.replaceChildren(head, result.mods.length ? list
    : emptyState("Create your first listing", "A listing reserves your mod's ID. Use the id from your manifest, then upload the .dibmod file.", button("New mod", { tone: "primary", onClick: () => editMod() })));
}

function editProfile(): void {
  if (!profile) return;
  const current = profile;
  const name = textInput(current.displayName, { max: 60 });
  const bio = el("textarea", "mlp-input mlp-textarea"); bio.value = current.bio; bio.maxLength = 1000;
  const website = textInput(current.website, { max: 300, placeholder: "https://…" }); website.type = "url";
  const form = el("form", "mlp-form",
    el("p", "ml-muted", "Your username, ", el("strong", "", `@${current.username}`), ", is permanent. Everything on this page is public once you publish a mod."),
    field("Display name", name, undefined, 60), field("About you", bio, "Shown on your mods' detail pages.", 1000),
    field("Website", website, "Optional. Must be an HTTPS link."),
    el("div", "mlp-form__row", button("Cancel", { tone: "ghost", onClick: () => task(dashboard) }), submitButton("Save profile")));
  form.addEventListener("submit", (event) => { event.preventDefault(); void task(async () => {
    profile = await api<AuthorProfile>("/me/profile", "PATCH", { displayName: name.value, bio: bio.value, website: website.value, revision: current.revision });
    await dashboard(); toaster.show("Profile saved.", "success");
  }); });
  content.replaceChildren(backBar(), el("div", "mlp-narrow", card("Public profile", form)));
}
function backBar(): HTMLElement {
  const back = button("Your mods", { icon: "back", tone: "ghost", small: true, onClick: () => task(dashboard) });
  back.classList.add("ml-detail__back");
  return back;
}

// -------------------------------------------------------------------------------------------------
// Listing editor
// -------------------------------------------------------------------------------------------------
interface Draft { title: string; description: string; tags: string[] }
function editMod(initial?: CatalogMod, carried?: Draft): void {
  clearPreviews();
  let mod = initial;
  const draft: Draft = carried ?? { title: mod?.title ?? "", description: mod?.description ?? "", tags: [...(mod?.tags ?? [])] };
  const id = textInput(mod?.modId ?? "", { placeholder: "dev.yourname.my-mod", max: 160 }); id.readOnly = Boolean(mod); id.spellcheck = false;
  const title = textInput(draft.title, { max: 100, placeholder: "What players see in the browser" });
  const description = el("textarea", "mlp-input mlp-textarea mlp-textarea--tall"); description.value = draft.description; description.maxLength = 10000;
  description.placeholder = "First sentence becomes the card summary. Explain what it changes, how to use it, and known conflicts.";
  const tags = tagEditor(draft.tags);
  const sync = (): void => { draft.title = title.value; draft.description = description.value; draft.tags = tags.values(); };
  const dirty = (): boolean => { sync(); return !mod || draft.title !== mod.title || draft.description !== mod.description || draft.tags.join("\u0000") !== mod.tags.join("\u0000"); };
  const saveButton = submitButton(mod ? "Save changes" : "Create listing");
  const form = el("form", "mlp-form",
    field("Mod ID", id, mod ? "Fixed. Must match every uploaded manifest." : "Your manifest's reverse-DNS id. Reserved for you once created."),
    field("Title", title, undefined, 100), field("Description", description, undefined, 10000),
    field("Tags", tags.node, "Up to eight. Press Enter or comma to add."),
    el("div", "mlp-form__row", saveButton));
  const patch = async (overrides: { published?: boolean; screenshots?: string[] } = {}): Promise<CatalogMod> => {
    sync();
    return api<CatalogMod>(`/me/mods/${mod!.id}`, "PATCH", { title: draft.title, description: draft.description, tags: draft.tags,
      published: overrides.published ?? mod!.published, revision: mod!.revision, screenshots: overrides.screenshots ?? mod!.screenshots });
  };
  form.addEventListener("submit", (event) => { event.preventDefault(); void task(async () => {
    sync();
    mod = mod ? await patch() : await api<CatalogMod>("/me/mods", "POST", { ...draft, modId: id.value });
    editMod(mod); toaster.show(initial ? "Saved." : "Listing created. Upload your first release next.", "success");
  }); });
  const details = card(mod ? "Details" : "New mod", form);
  if (!mod) { content.replaceChildren(backBar(), el("div", "mlp-narrow", details)); return; }
  const current = mod;
  /** Uploads carry the revision; unsaved text is saved first so nothing typed is lost. */
  const beforeUpload = async (): Promise<number> => {
    if (dirty()) mod = await patch();
    return mod!.revision;
  };

  // Status
  const statusCard = card("Visibility",
    el("div", "mlp-status", statusBadge(current), el("p", "ml-muted", current.published
      ? "Players can find and install this mod under Browse in the Mod Manager."
      : current.releases.length ? "Only you can see this draft." : "Upload a release before publishing.")),
    el("div", "mlp-form__row",
      button(current.published ? "Unpublish" : "Publish", { tone: current.published ? "secondary" : "primary",
        onClick: () => task(async () => {
          if (!current.published) {
            const choice = await sheet(root, { title: `Publish ${current.title}?`, actions: [{ id: "publish", label: "Publish" }],
              body: [el("p", "", "Your listing and author profile become public."),
                el("p", "ml-sheet__note", "Confirm you have the rights to distribute the package and screenshots. Do not upload game IPAs or copied game assets.")] });
            if (choice !== "publish") return;
          }
          mod = await patch({ published: !current.published }); editMod(mod);
          toaster.show(current.published ? "Unpublished. Existing installs keep working." : "Published. Players can find it under Browse.", "success");
        }) }),
      button("Delete", { tone: "ghost", onClick: () => task(async () => {
        const choice = await sheet(root, { tone: "danger", title: `Delete ${current.title}?`, actions: [{ id: "delete", label: "Delete listing", tone: "danger" }],
          body: [el("p", "", "The listing and every hosted release are removed. Players' installed copies and saves are not affected."),
            el("p", "ml-sheet__note", `The mod ID ${current.modId} stays reserved to prevent takeovers.`)] });
        if (choice !== "delete") return;
        await api(`/me/mods/${current.id}`, "DELETE", undefined, { "If-Match": String(current.revision) });
        await dashboard(); toaster.show("Listing deleted.");
      }) })));

  // Releases
  const releaseDrop = dropZone("Upload a new version", "Choose or drop a .dibmod up to 64 MiB. The version number comes from its manifest.", ".dibmod", (file) => task(async () => {
    if (file.size > 64 * 1024 * 1024) throw new Error("Package exceeds 64 MiB.");
    const revision = await beforeUpload();
    mod = await api<CatalogMod>(`/me/mods/${current.id}/release`, "POST", file, { "If-Match": String(revision) });
    editMod(mod); toaster.show(`Version ${mod.releases[0]?.version} uploaded.${mod.published ? " Players will see the update." : " Publish when ready."}`, "success");
  }));
  const releases = el("ol", "ml-versions");
  for (const [at, release] of current.releases.entries()) {
    const deps = Object.keys(release.dependencies).length;
    releases.append(el("li", "ml-versions__row",
      el("div", "ml-versions__main", el("strong", "", `v${release.version}`), at === 0 ? badge("latest", "update") : undefined),
      el("small", "ml-versions__meta", el("span", "", formatRelative(release.createdAt)), el("span", "", formatBytes(release.byteLength)),
        el("span", "", `API ${release.apiVersion}`), deps ? el("span", "", `${deps} requirement${deps === 1 ? "" : "s"}`) : undefined),
      el("div", "ml-versions__actions")));
  }
  const releasesCard = card("Releases", releaseDrop, current.releases.length ? releases : el("p", "ml-muted", "No releases yet."),
    el("p", "mlp-fine", "A release can't be changed once uploaded. Raise the version in your manifest to ship a fix."));

  // Screenshots
  const shots = el("div", "mlp-shots");
  for (const [at, digest] of current.screenshots.entries()) {
    const img = el("img", ""); img.alt = `Screenshot ${at + 1}`;
    void fetch(`/api/community/me/mods/${current.id}/image/${digest}`, { method: "POST", credentials: "omit", headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Screenshot preview unavailable.");
        const blob = await response.blob();
        if (!img.isConnected) return;
        const url = URL.createObjectURL(blob); previewUrls.push(url); img.src = url;
      }).catch(() => { img.alt = "Preview unavailable"; });
    const remove = iconButton("trash", `Remove screenshot ${at + 1}`, () => task(async () => {
      mod = await patch({ screenshots: current.screenshots.filter((entry) => entry !== digest) }); editMod(mod, draft); toaster.show("Screenshot removed.");
    }), "danger");
    shots.append(el("figure", "mlp-shot", img, at === 0 ? el("figcaption", "", "Cover") : undefined, remove));
  }
  if (current.screenshots.length < 6) {
    shots.append(dropZone("Add a screenshot", "PNG, JPEG or WebP", "image/png,image/jpeg,image/webp", (file) => task(async () => {
      const png = await screenshotPng(file);
      const revision = await beforeUpload();
      mod = await api<CatalogMod>(`/me/mods/${current.id}/screenshot`, "POST", png, { "If-Match": String(revision) });
      editMod(mod); toaster.show("Screenshot added.", "success");
    }), "mlp-shot mlp-shot--add"));
  }
  const shotsCard = card(el("span", "", "Screenshots ", el("small", "", `${current.screenshots.length} of 6`)), shots,
    el("p", "mlp-fine", "The first screenshot leads the listing. Image metadata is removed on upload."));

  content.replaceChildren(backBar(), el("h2", "mlp-editor__title ml-title-face", current.title),
    el("div", "mlp-editor", el("div", "mlp-editor__main", details, shotsCard), el("div", "mlp-editor__side", statusCard, releasesCard)));
}

function tagEditor(initial: readonly string[]): { node: HTMLElement; values: () => string[] } {
  let values = [...initial];
  const input = el("input", "mlp-tags__input"); input.placeholder = "Add tag"; input.maxLength = 24;
  const node = el("div", "mlp-input mlp-tags");
  const render = (): void => {
    node.replaceChildren(...values.map((tag) => el("span", "ml-chip ml-chip--active", tag,
      iconButton("close", `Remove ${tag}`, () => { values = values.filter((entry) => entry !== tag); render(); input.focus(); }))), input);
    input.hidden = values.length >= 8;
  };
  const commit = (): void => {
    const tag = input.value.replace(/,/g, "").trim();
    if (tag && values.length < 8 && !values.some((entry) => entry.toLowerCase() === tag.toLowerCase())) values.push(tag);
    input.value = ""; render(); input.focus();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commit(); }
    else if (event.key === "Backspace" && !input.value && values.length) { values.pop(); render(); input.focus(); }
  });
  input.addEventListener("blur", () => { if (input.value.trim()) commit(); });
  node.addEventListener("click", () => input.focus());
  render();
  return { node, values: () => { if (input.value.trim()) commit(); return [...values]; } };
}

function dropZone(title: string, hint: string, accept: string, onFile: (file: File) => void, className = "mlp-drop"): HTMLElement {
  const input = el("input"); input.type = "file"; input.accept = accept; input.hidden = true;
  const zone = el("button", className, el("strong", "", title), el("small", "", hint), input);
  zone.type = "button";
  zone.addEventListener("click", () => input.click());
  input.addEventListener("click", (event) => event.stopPropagation());
  input.addEventListener("change", () => { const file = input.files?.[0]; input.value = ""; if (file) onFile(file); });
  zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("mlp-drop--over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("mlp-drop--over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault(); zone.classList.remove("mlp-drop--over");
    const file = event.dataTransfer?.files[0]; if (file) onFile(file);
  });
  return zone;
}

async function screenshotPng(file: File): Promise<Blob> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP screenshot under 5 MiB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 8_000_000) throw new Error("Screenshot is too large. Use at most 4096px per side and 8 million pixels.");
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not convert screenshot.")), "image/png"));
    if (blob.size > 5 * 1024 * 1024) throw new Error("Converted screenshot exceeds 5 MiB. Resize it first.");
    return blob;
  } finally { bitmap.close(); }
}

void task(async () => {
  info = await communityInfo();
  if (!info.enabled || !info.authorOrigin) {
    content.replaceChildren(emptyState("This server doesn't accept uploads", "Community publishing is turned off here. Official mods can still be installed from the game's mod library."));
    return;
  }
  if (location.origin !== info.authorOrigin) {
    const link = externalLink(`${info.authorOrigin}/community.html`, "Open the author site", "external", "ml-btn ml-btn--primary");
    link.target = "_self";
    content.replaceChildren(emptyState("Continue on the author site", "Author sign-in lives on a separate site so installed mods, which run code in the game page, can never read your login key.", link));
    return;
  }
  login();
});
