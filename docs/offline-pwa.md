# Offline web-app startup

The production engine can start from a service-worker cache without contacting the website.
Gameplay uses the existing Offline simulation and local save protocol. Official sessions continue
to require the authority; they are never converted to local saves during an outage.

## Player setup and device check

1. Open the HTTPS site in Safari and choose Share → Add to Home Screen.
2. Open the installed app while connected. Wait for **App ready for offline startup**.
3. Select a compatible IPA/ZIP and launch Offline once. This validates and remembers compressed
   game content separately from the engine. Keep that archive downloaded in Files as well.
4. Close the app, enable airplane mode, explicitly disable Wi-Fi, and reopen from its Home Screen
   icon. Expect the launcher to load, Online to be unavailable, and Offline to reach the title
   screen using remembered content. Continue a local save and verify that progress survives another
   close/reopen. Select the downloaded archive again if the disposable archive cache is missing.

Safari and the installed app have separate local storage. Export/import local saves when moving
between them. Keep independent native-save exports: clearing website data or browser eviction can
remove caches and saves. The existing persistent-storage request remains best-effort; iOS uses
browser heuristics, including Home Screen installation, to decide whether to grant it.
See [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/) and
[Home Screen storage isolation](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/).

## Build, update and content boundary

`apps/web/build/offlineShell.ts` emits `sw.js` after the final HTML and assets. Its manifest covers
every emitted engine file, including lazy chunks, shell icons, the licensed font and authoring
documents, with SHA-256 integrity. Installation precaches the whole version atomically; a failed
download, integrity mismatch or quota failure does not replace the active version. The revision
includes worker code as well as resource hashes.

The worker serves only those exact same-origin files, plus the root-to-index alias. Query strings
on those paths reuse the same file. There is no catch-all navigation fallback, runtime cache write,
API cache, archive download cache, imported blob cache, or remote resource cache. Player-selected
archives remain in the existing disposable IndexedDB store and pass through the same importer on
every startup. Mods retain their existing local cache and trust rules.

An active worker serves one consistent version even while online. A newer worker waits for the
browser's normal activation boundary: close every controlled game/guide window, then reopen. It
never calls `skipWaiting` or claims an already-loaded page. Activation deletes only older engine
caches in its own registration scope. The launcher checks actual cache completeness before
announcing readiness, and can repair missing files while connected using the pinned integrity.
No worker operation deletes saves or archive records.

Serve the complete production build over HTTPS (localhost is suitable for preview testing), with
`sw.js` served as JavaScript and revalidated, not given immutable caching. The maintained Caddy
configuration already supplies `Cache-Control: no-cache` outside `/assets/`. `updateViaCache: none`
also avoids a stale HTTP-cached worker script. Upload complete releases atomically; integrity rejects
mixed releases. Rollback uses the same worker update lifecycle and requires closing game windows.
Development Vite does not register the worker; use a separate origin/port from production preview.

## Verification

`pnpm content:boundary` now also checks that the worker manifest includes every emitted file and
that every integrity value matches final disk bytes. Unit tests exercise cache routing, install
failure, update cleanup, eviction repair, readiness lifecycle and offline authority-probe bypass.

The opt-in browser scenario uses a temporary persistent Chromium profile and muted audio. It warms
the production build and archive, closes the browser, restarts it with networking disabled before
navigation, and checks remembered-content startup and manual local-file recovery. It records
screenshots and `render_game_to_text` under `output/offline-pwa/`. It does not prove iOS behavior;
run the device check above before claiming iPhone offline compatibility verified.

```powershell
pnpm content:boundary
pnpm --filter @dib/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort
# In a second terminal, set DIB_CONTENT_ARCHIVE to your compatible local IPA/ZIP:
$env:DIB_CONTENT_ARCHIVE = 'C:/path/to/your/game.ipa'
pnpm scenario:offline-pwa
```

On 2026-09-08, authorized muted Chromium checks passed for cold browser restart with both the
operator-owned original archive and maintained custom archive, plus offline local-file recovery.
The run caught and fixed a launcher CSS rule hiding readiness after archive selection. Screenshots
of both title screens, the launcher, update message, save selection and battle were inspected.

`pnpm scenario:offline-pwa-lifecycle` passes against the actual production worker with two
test-server revisions: API GET/POST bypass, offline guide, deferred activation while a guide is
open, scoped old-cache cleanup, preserved local data, and offline startup of the new version.

With `DIB_OFFLINE_PWA_JOURNEY=1`, `pnpm scenario:offline-journey` runs a focused PWA gameplay
proof with networking disabled after engine installation: new game, starter selection, town
checkpoint, physical save-slot reload, tutorial inputs, first battle and victory checkpoint.
That focused proof passed. Without the flag the existing full journey retains all later checks;
its post-Goblin Guild-unlock assertion fails identically on deployed baseline `554af294ff54` and
the offline candidate. This pre-existing issue was not changed or counted as a passing full journey.
Physical iOS Home Screen/airplane-mode validation remains pending.

Production verification at `https://dib.opq.sh/` also checks that no API response is received and
no gameplay command is submitted while offline. Chromium's network emulator can leave
`navigator.onLine` true for the external HTTPS origin; in that case the bounded readiness probe
may be attempted and must fail with `ERR_INTERNET_DISCONNECTED`. When the browser reports offline,
the test additionally requires no readiness attempt. Neither case permits a cached API response.
