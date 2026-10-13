# Mod Manager and author profiles

**Multiplayer PvP** is included as a normal Official listing in Browse and Installed, with search,
tags, author filtering, grid/list layouts, a description, and an actual in-game lobby screenshot.
The capture uses the selected package's popup frames and menu buttons, as they appear in play.
Enable/disable uses the shared staged Apply/Discard flow. It remains available without the remote
catalog and counts as one mod in the Installed, enabled, Load order, Apply and launcher totals.
PvP needs no load-order position; the Load order screen counts it alongside the sortable mods.
The launcher updates immediately after Apply, including when PvP is the only changed mod.
It remains compatible with Official play.
There is no download or Remove action for this built-in release. It adds **PvP** directly
below **Tournament** in the Arena menu. The listing explains that PvP accepts reviewed cosmetic mods only and rejects
gameplay mods and does not claim native support for other gameplay mods. Its local release token is presentation metadata,
never a downloadable digest or a relaxation of archive/trust checks.

The opt-in `apps/web/tests/browser/pvp-listing.playwright.mjs` covers desktop/phone Browse,
details/gallery, staged changes, Installed, PvP-only and mixed mod counts, and unavailable-catalog
search against `DIB_WEB_URL`.

The launcher's **Mod Manager** button, directly under the asset archive field, opens the one place
for Offline mods: browsing, installing, enabling, disabling, removing, load order and conflicts.
None of it requires an account. The button's second line says how many mods are enabled, and the
line under it names them in activation order, or says why they cannot load. **Publish** (header,
shown only when the server accepts uploads) opens a separate trusted site for publishing and
profile management.

The launcher keeps no other mod controls. The former collapsible "Optional Offline Mods" section,
its file picker, its Load order dialog and its Clear button are all inside the manager now (Import
file, Load order, Disable all). A hidden `input[name="mod-archives"]` remains for scripted sessions:
setting files on it replaces the whole selection, exactly as the old picker did, and the browser
scenarios use it.

This is a port feature. It does not change original-game fidelity or permit mods in Official play.

The detail modal shows each package/release's **Save-neutral** or **Save-dependent** label, taken from its
manifest's `saveCompatibility` declaration. Neutral mods can vary between save setups without
mod-mismatch warnings; dependent mods retain byte/order comparisons. The saved pre-mod archive
fingerprint also lets neutral data overlays (such as
Less Rare Monsters' encounter weights) vary without a content warning when the archive and
dependent setup still match. Missing declarations default
to dependent, including historical releases. Neutrality describes save portability, not whether a
mod changes gameplay, and does not override dependencies, conflicts or runtime interference.
See [the declaration contract](code-mod-api.md#save-compatibility-declarations). Official and
community catalog release metadata comes from the validated archive; labels are never inferred
from tags, names or publisher identity. Existing immutable releases are not relabeled.

For the opt-in save comparison smoke test, start a strict Vite dev server and run
`node apps/web/tests/browser/save-neutral-mods.playwright.mjs` (set `DIB_WEB_URL` if needed).
It uses isolated scenario saves, needs no IPA/API, and captures the neutral, dependent-change and
content-change disclosures at phone/desktop widths. Expect removing the neutral HUD to retain
the save and show **Save-compatible setup**; removing its content mod or changing content still
warns. The broader `mod-library.playwright.mjs` scenario also checks catalog/imported labels.

## Sources

The manager keeps three sources apart: a coloured source label on every Browse card and details
window, and a group each in Installed. Official and community listings share the one **Browse** tab.

- **Official**: read-only packages the server operator ships from `DIB_OFFICIAL_MODS_DIR`, never
  attributed to an account. They are "by DIB Web" unless the listing credits the original author
  (the sidecar's `author`, e.g. "by wolfs0" on a converted mod).
- **Community**: uploaded and maintained by signed-in authors through the author site.
- **Imported files**: `.dibmod` files the player added from their own device (Installed only).

Official and community listings never share a mod ID: an author cannot create a listing whose ID
an official mod already uses, and dependency lookups (`/mods/by-id`) prefer the official listing.

## Visual language

The manager and author site share `apps/web/src/content/modLibrary.css`. Keep them plain and
specific to this game rather than a generic app kit:

- Installed and Browse each offer a **Grid** and a **List** layout (toggle at the end of the
  toolbar, remembered per device in `dib.mods.view.v1`; grid by default). A grid tile *is* the
  mod's first screenshot, with source, tags, title, the one-line summary, author and the single
  primary action laid over a bottom scrim; hovering lowers the scrim to show more of the frame.
  Browse tiles keep only the version on the right of the source/tags row; tags wrap as whole
  labels. Save compatibility appears only in the detail modal, keeping cards and rows compact.
  Over art, tiles always read light-on-dark whatever the theme. List rows keep dividers and a small
  thumbnail. A mod without a screenshot gets a plain tile or row; there is no generated
  placeholder art.
- States are coloured words ("Enabling on apply", "v1.3.0 available"), not pill badges. The one
  exception is the gold **Work in progress** flag: a listing tagged `Work in progress` (or `WIP`)
  shows it on its tile, row and details window, so an unfinished mod cannot be mistaken for a
  finished one. Icons appear only on controls with no text (close, remove, copy, drag handle,
  gallery arrows).
- What a mod does not say is shown, not hidden: a details window draws each missing piece
  (summary, description, screenshots, author, tags, release) as an explicit dashed "missing"
  slot.
- Palette: open-sea blues, gold for the single primary action (the game's confirm buttons), and
  lagoon green for "enabled". Titles use Marker Felt, the face the shipped game requests (see
  `localFonts.ts`); all other text uses the platform UI face.
- No decorative motion: no hover lift, shimmer skeletons, or staggered entrances. Loading is a
  line of text plus the thin progress bar under the header.

## Player workflow

The manager has three tabs: **Installed**, **Load order** and **Browse**.

**Browse** lists official and community mods together: search (`/` focuses it), filter by tag
(the long tail sits behind "+N more") or author ("More by…" in a details window), sort by recently
updated, newest or name, and load more. Each entry has one primary action derived from device
state: **Install**, **Enable**, **Enabled** (click to disable), or **Update**.

**Details** open in their own window over the manager (the manager underneath is inert until it
closes; Escape, the close button or the backdrop closes just that window). Every mod opens one: a
tile's title (or anywhere on the tile with a mouse), a list row, an Installed name or its Details
button, or a name in Load order. A catalog listing shows the summary as a lead line, the screenshot
gallery and lightbox, description, requirements with installed status, facts (version, size,
update time, copyable mod ID), tags, the author, and every release with Install / Use this /
Remove; a notice up front names whatever the listing lacks. An imported file has no store page,
so its window says so first and then shows only what the manifest knows (name, version, size,
file name, mod ID, requirements, load rules, the copies on this device), with dashed "missing"
slots for summary, description, screenshots, author and tags. An installed catalog mod whose page
cannot be fetched (offline, withdrawn) falls back to the same manifest view and says why. For any
installed mod the window also lists its **Load order** rules: load priority, loads after/before
and declared conflicts.

Installing plans the release and its required dependencies, shows one confirmation with the full
plan, download size and the full-trust warning, validates SHA-256, manifest identity, version,
dependencies and package structure without evaluating JavaScript, and then stages the mod as
enabled. Official-only plans skip the confirmation after the first acknowledgement on this
device; community mods and any plan with extra dependencies always confirm.

**Installed** groups installed mods as Official, Community and Imported files, with All / Enabled /
Updates filters and local search. Each row or tile has a switch, an Update button when the catalog
has a newer release than any stored version, Details, and Remove; tiles use the catalog screenshot
when the listing answered. **Import file** (or dropping `.dibmod` files anywhere on the dialog)
validates, stores and enables local packages. **Disable all** stages an empty selection. Disabling
a mod also disables every enabled mod that requires it, and says so. Evicted catalog installs stay
listed as "Not on this device" with a Download action. Enabling a mod whose author declared a
conflict with another enabled mod asks first; **Enable anyway** stages both with the conflict
override, which lasts only while the selection still needs it.

**Load order** lists the enabled (staged) mods in resolved activation order, numbered. Drag a row
to reorder it (a mouse can grab the row anywhere; touch and pen use the grip handle so the list
still scrolls; Escape cancels a drag). With the keyboard, focus a row's handle and use the arrow
keys, Home and End; moves are announced to screen readers. A drop rewrites the whole order as
explicit priorities (the launcher's `dib.mods.loadOrder.v1`); declared dependency and load-order
edges still win, so a forbidden drop snaps back as far as the rules require and names the rule
("Realtime Combat (WIP) asks to load after Devtools"). Each row shows its **recommended**
position, the order the mods' own load priorities and declared rules produce with every manual
move forgotten: quiet ("Recommended spot") where the mod already is, gold ("Recommended: 3rd")
where a move took it elsewhere, plus a note above the list. Rows also show the author's recommended
priority (including the default 0; lower numbers load first) and the rules that mod declares
("loads after Devtools"). Manual moves do not change that recommendation. **Use recommended order**
forgets manual moves. When the selection cannot
resolve, the tab is marked "needs attention", the launcher opens the manager on it, Apply is
disabled, and the problem is shown with the fix: **Load anyway** for a declared conflict, or the
missing dependency to enable. Resolution advisories follow the list. Once the applied profile has
run in this page, the tab shows its shared seams (the eight most severe, the rest in the console);
with unapplied changes it says to apply first.

Nothing runs while choosing. Changes are staged; the footer shows the pending count (a changed
activation order counts as one change; a move that resolves to the same order does not) with
**Apply** (or **Apply & reload** once mod code has run in this page) and **Discard**. Applying commits the
choices together and can execute code while preparing the Offline archive. If mod code already
ran, it caches the exact chosen files and carries their digests (plus an explicit conflict
override, if any) through an automatic clean reload; manual order is already in localStorage. Closing with pending changes asks to apply or discard. Rows show "Enabling on apply",
"Disabling on apply" or "Switching to vX on apply" until applied. Remove deletes package bytes, never saves, reports how many
saved profiles use that version, and is refused for a version the launcher currently holds
(disable and apply first).

Updates are manual and old versions remain separately available. An update keeps an enabled mod
enabled on the new version. The library refuses installation beyond its 64 MiB device byte
budget; remove unused versions first. Existing launch-time cache retention may evict packages; a
separate small inventory preserves catalog provenance (including source) so Installed can offer
Download again. Browser storage is still disposable. If an author removes a release, local copies
continue working but redownload may be unavailable.

## Official mods

Point `DIB_OFFICIAL_MODS_DIR` at a read-only directory of `<name>.dibmod` files. Each may have a
`<name>.listing.json` beside it: `{ "title", "author", "summary", "description", "tags": [≤8],
"screenshots": ["<file>.png", ≤6] }`. `summary` (≤160 characters) is the card line; without it the
first sentence of the description is used. `author` (one line, ≤60 characters) credits the
original author of a mod the server ships; the listing is then "by" that name, with a public
profile derived from the name alone (so one credit across several listings is one author page).
Without it the listing is by the server's own profile, **DIB Web**. Several files with one manifest ID become releases of one listing; the
newest release's sidecar wins. The server validates every package with the same structural
importer (never executing it), sanitizes screenshots like uploads, and **refuses to start** on a
malformed package, duplicate version or sidecar. Listing IDs are derived from the mod ID, so they
are stable across restarts and redeploys. Official mods alone enable public catalog reads; the
author routes stay disabled (404) unless `DIB_COMMUNITY_ORIGIN` is also set.

`pnpm mods:examples` builds every example into `examples/mods/dist/` and publishes the curated
Official catalog into `examples/mods/dist/official/`: an example is in the catalog exactly when it
has a `listing.json`, which is copied beside its archive there (the sidecar is never packed into
the archive, so digests are unaffected). That folder is what development serves. The catalog is
Wand Pointer Trail, Realtime Combat (WIP), Mercy Stone, Less Rare Monsters (by wolfs0) and
Devtools; the other examples stay
importable from `dist/` but are not listed, and a test pins the set. Every listing ships a
hand-written `summary`. Screenshots are not committed: they render the original game's art, so they are
operator-generated from the operator's own IPA, like `output/`. `pnpm mods:screenshots` (opt-in,
muted Chromium; `DIB_WEB_URL`, `DIB_CONTENT_ARCHIVE`, optional mod names) drives each catalog
example to its feature and writes `examples/mods/screenshots/<name>.png` (gitignored; add
`<name>-2.png`... for more). `pnpm mods:examples` then copies them into `dist/official/` as `<name>.screenshot-<n>.png` and
lists them in the sidecar; a source `listing.json` that names screenshots itself is refused. Decide deliberately which examples a
deployed server should publish: several contain third-party material described in their READMEs.

## Author workflow

Use an existing named Online login key, or choose a username and create an account directly in
the portal. No archive selection or game session is required. New keys work for Official play
as well. Save the generated key in a password manager; it is returned once, cannot be recovered,
and is never stored raw on the server. No email, password or passkey enrollment is required.
Token-only operator invites need a named account before publication.

Author sessions last eight hours in the current tab and are memory-only. Reloading, closing the
tab, signing out or restarting the server requires login again. The key form uses password-manager
autocomplete. The server rechecks account existence on every private request, so registry
revocation immediately removes author access. Username is immutable; display name, bio and an
optional HTTPS website are editable. Public attribution shows both display name and username.
Publishing explicitly exposes the author profile; it never enables the scoreboard or exposes
player IDs, slots, saves or progress.

Create a draft with its manifest's exact reverse-DNS ID, title, description and tags. Upload a
`.dibmod`; its version and dependencies come from the validated manifest. Add up to six
screenshots. The browser converts PNG/JPEG/WebP to PNG; the server independently validates PNG
structure, CRC, dimensions and bounded decompression, and strips metadata. Preview, then publish.
Editing descriptions/screenshots does not change existing release bytes. Code updates require a
new manifest version. Unpublish hides downloads; Delete hides the listing and all releases and
removes their references. Deleted IDs stay reserved against takeover. Unreferenced blobs are
collected on the next upload. Existing downloaded copies cannot be remotely deleted.

## Boundaries and persistence

`CommunityHttp` is a separate HTTP surface in the existing Node service, under `/api/community`.
It shares the registry functions with Official accounts; all account writes retain the existing
registry queue and file lock. There is no replacement state route and no mod byte is added to
Official slots, command receipts or projections. The existing strict game account schemas remain
unchanged; profile DTOs are separate.

The game origin proxies only public catalog endpoints. Author endpoints require the configured
author Host, exact Origin, and an opaque author bearer token. Author tokens are held in portal
memory, stored hashed server-side, and rejected by Official authentication. No cookies or browser
storage contain author sessions. The portal does not run mods or serve the game/service worker;
its CSP forbids inline scripts, dynamic evaluation and framing. Uploaded code is served only as
an attachment, never as same-origin JavaScript or HTML. User descriptions use text nodes.

This protects the portal from game-page mods. It cannot protect a login key a user explicitly
gives to a malicious mod: mods remain full-trust code. The same existing login key authenticates
both account uses, as requested. Passkeys, credential rotation and unified trusted-origin game
sign-in are not implemented in this release.

Catalog state lives in `catalog.json` with immutable SHA-256 blob files. Mutations use the
existing durable-write mechanism and a cross-process file lock. Revisions reject stale edits;
published versions cannot be replaced. A failed upload does not publish partial metadata.
After an interrupted response, refresh the dashboard before retrying: an upload may already
have committed. Metadata revisions and version uniqueness prevent overwriting its result.

Limits: 2,000 total listing IDs (including tombstones), 50 IDs per author, 100 releases per
listing; 1 GiB referenced bytes per author, 10 GiB total blobs, 512 MiB disk free-space reserve;
64 MiB compressed / 128 MiB expanded / 512 entries / 32 MiB per archive entry. Screenshots:
5 MiB input, 4096 pixels per side, eight million pixels total, RGB/RGBA PNG. Upload processing
is serialized with a 60-second body timeout. Registry creation, sign-in, public reads and
authenticated requests are rate limited. Validation uses the same structural importer as
local mods and never executes package code. It is not a malware or copyright certification.

Only publish content you can redistribute. The publishing confirmation covers packages and
screenshots; full game IPAs are not accepted by this API. Operators handle takedowns with
`mods:hide <listing-id>` and can allow publishing again with `mods:restore <listing-id>`.
Hide blocks owner republishing; restore leaves the listing unpublished until its owner acts.

## Local development

Use isolated disposable state for testing. In the API terminal:

```powershell
$env:DIB_COMMUNITY_ORIGIN = 'http://localhost:5174'
$env:DIB_GAME_PUBLIC_ORIGIN = 'http://localhost:5173'
$env:DIB_COMMUNITY_DATA_DIR = "$PWD/working/community-dev"
# Configure DIB_GAME_HMAC_SECRET and the normal API's data/archive paths as usual.
pnpm game:dev
```

Start the game and author Vite origins in separate terminals:

```powershell
pnpm --filter @dib/web dev --port 5173 --strictPort
pnpm --filter @dib/web dev --port 5174 --strictPort
```

Add `$env:DIB_OFFICIAL_MODS_DIR = "$PWD/examples/mods/dist/official"` (after `pnpm mods:examples`)
to list the curated examples as Official mods under Browse.

For Offline work without the authoritative API, `pnpm mods:catalog` serves only the public catalog
(Official from `DIB_OFFICIAL_MODS_DIR`, default `examples/mods/dist/official`; any local community listings
read-only) on `DIB_GAME_PORT` (8788). It needs no HMAC secret or extracted data, refuses
`DIB_GAME_ENV=production`, keeps author routes closed, and answers every `/api/game` route with
503 so the launcher still reports Online as unavailable. `start-dev.cmd` builds the examples and
starts this catalog in its own window by default, so the Mod Manager no longer says "Couldn't
reach the mod catalog" in plain Offline development; `start-dev.cmd --online` instead starts the
game API with `DIB_OFFICIAL_MODS_DIR` pointed at the same examples. Visit `http://localhost:5174/community.html` to sign in. Both Vite servers proxy the API on
8788 (or `DIB_GAME_PROXY_PORT`). Use `localhost` consistently; `127.0.0.1` is a different origin.
Production restricts the author host to the portal and hashed static assets; the development
server is not a substitute for that deployment boundary. If `DIB_COMMUNITY_ORIGIN` is unset,
catalog reads serve only official mods (or report unavailable when there are none) while
installed/local mod management remains usable. The development server relaxes the portal's
`style-src` to allow Vite's injected `<style>` tags; production builds keep `style-src 'self'`.

## Deployment and backups

To publish the local curated catalog (including its existing screenshots) to the maintained VM:

```powershell
& .\deploy\azure-deploy.ps1 -PublishMods -DryRun
& .\deploy\azure-deploy.ps1 -PublishMods
```

This mode rebuilds the examples and snapshots only `examples/mods/dist/official/`. It validates
every archive, sidecar and screenshot with the server loader, rejects unexpected files, and
transfers a checksummed archive independently of the application image. It publishes exactly the
examples with a source `listing.json`; adding one is a publication decision. Screenshots are
optional and must already exist locally; this command does not drive a browser to generate them.
Adjacent example saves and unlisted packages are never transferred.

The VM keeps immutable catalogs at `/opt/dib/official-mods/releases/<archive-sha256>/` and a
Compose override at `/opt/dib/official-mods/compose.yaml`. The override mounts the active catalog
read-only at `/srv/official-mods` and sets `DIB_OFFICIAL_MODS_DIR`. Normal application deployments
through the updated `azure-deploy.ps1` preserve that override, including rollback. Both modes
share a deployment lock. Mod-only publication uses the already-running application image,
preflights its production configuration, then recreates only the game service; active API
connections may reconnect briefly. It does not rebuild the app or restart the shared proxy.
Unlike an application release, this mode intentionally publishes local operator artifacts and
does not require a clean worktree or deploy local application changes. `-SkipChecks` does not
skip its catalog validation.

Activation checks game readiness, listing metadata, every archive digest and every sanitized
screenshot digest before accepting the catalog. A failed activation restores the previous
override and game service. A second check uses public HTTPS from the operator machine; a failure
there reports the already-active catalog for investigation. Previous catalogs remain available
for rollback. Back up the override and active catalog directory as operator artifacts. For
manual Compose operations after publishing, also pass
`-f /opt/dib/official-mods/compose.yaml`; omitting it removes the catalog mount. To roll back just
the catalog, save a copy of the override, change its bind source to an existing prior catalog,
run `config:check`, then `up -d --no-build --no-deps --wait game` with both Compose files and verify
the catalog. No community or game-state restore is involved.

Read `docs/deployment.md` before operating production. The existing VM/Caddy deployment uses
`DIB_COMMUNITY_HOST` (placeholder default `community.example.com`) and a separate `community-state` volume.
Provision its DNS/TLS and set that hostname in `deploy/.env` before release. It must differ from
`DIB_PUBLIC_HOST`; the server refuses equal configured origins. `DIB_COMMUNITY_DATA_DIR` selects
the catalog location; Compose uses `/var/lib/dib-community`. Check the host's spare capacity
against the 10 GiB cap and existing game usage.
The volume separation is organizational; quotas and free-space checks protect shared disk.

The existing scheduled game-state backup does **not** include the separate community volume.
Create a consistent community snapshot with the CLI, then copy it to backup/offsite storage:

```sh
docker compose -f deploy/compose.yaml --env-file deploy/.env exec game \
  node /app/dib-game-server.mjs mods:backup /var/lib/dib-game/community-snapshot-$(date -u +%Y%m%dT%H%M%SZ)
```

The target must be a **new writable directory outside the catalog**. The example uses the
game-state volume, so its scheduled backup subsequently includes the completed snapshot. Copy
that backup off-host and remove superseded staging snapshots to avoid accumulating copies on
the game disk. A dedicated writable backup mount is preferable for larger catalogs. Back up before deployment/storage maintenance;
schedule this CLI from the operator's backup job for recurring community coverage. Keep the
registry and HMAC-secret backups: catalog snapshots alone cannot restore account ownership.

`mods:backup` captures catalog references while locked, then blocks upload-time garbage collection
with `backup.lock` while copying referenced immutable blobs. It writes `snapshot-complete.json`
last. Never restore an incomplete snapshot. Reads and metadata editing continue during copying;
uploads return a retryable error. A killed snapshot process can leave `backup.lock`; remove it
only after confirming no backup is running. On restore, stop the game process, restore the
snapshot's `catalog.json` and `blobs/` into the community volume, fix ownership to uid 1000,
then restart. Verify each blob's SHA-256 equals its filename before restoring. Do not restore a
catalog underneath live requests. Only snapshots containing `snapshot-complete.json` are usable;
the game backup may have observed an incomplete snapshot if the two jobs overlapped.

## Verification

`pnpm deploy:test` exercises the publication snapshot boundary and HTTP verification, including
pagination and corrupt/missing downloads. On Linux it also runs `python3 deploy/publish-mods.test.py`, which tests
preflight failure, first-publication rollback, replacement rollback and successful activation
using real temporary files and a fake Docker command; it cannot touch running containers.

Unit coverage: `apps/game-server/tests/{community,modCatalog,officialMods,devCatalog}.test.ts`
(including a check that every shipped example `listing.json` loads with its summary) and
`apps/web/tests/{communityClient,modLibraryModel}.test.ts` (load-order moves, conflict
classification, layout preference, the conflict-override reload format). Existing workspace tests, typechecks and the content boundary remain required. The prepared opt-in browser scenario is:

```powershell
node apps/web/tests/browser/mod-library.playwright.mjs
```

It uses the two local origins above, creates a scenario-owned account/listing, uploads/publishes
a harmless package, installs it from a Community grid tile, applies, switches Installed to the list
layout, disables with the switch, applies, removes it, checks code did not execute, deletes the listing, and writes screenshots
under `output/mod-library/`. It always mutes Chromium.
Use disposable API state: registration throttling intentionally limits rapid reruns. Inspect
the screenshots and manually check screenshot previews, profile editing, a multi-mod dependency
install, stale edits in two tabs, and Official launch exclusion. Browser execution is opt-in;
the existence of the scenario is not a claim that it ran.
