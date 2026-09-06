# Browser fullscreen and mobile shell

The web client supports the fullest presentation each browser permits without changing game-space
geometry or packaging content assets into the engine distribution.

## Runtime behavior

| Environment | Full action |
| --- | --- |
| Browser exposing `Element.requestFullscreen()` | Requests fullscreen on the document root, then best-effort landscape orientation lock. |
| Installed Home Screen web app | Already active; the redundant fullscreen control is omitted. |
| iPhone browser without arbitrary-element fullscreen | Explains Share -> Add to Home Screen. If the browser omits that action, the instructions direct the user to install once through Safari. |
| Other browser without the API | Reports that browser/window installation controls are required. |

Where it is useful, the action is available from the archive gate and as the non-closing
**Fullscreen** button in the in-world Options popup. It is omitted when fullscreen is already
active/installed or when the browser has neither a direct API nor the iPhone Home Screen route.
The manifest requests `display: fullscreen` and landscape orientation; legacy Apple web-app
metadata keeps older Home Screen installations on the same path. No service worker or offline
archive cache is introduced.

The shell icon is content-neutral artwork owned by the web player. The manifest publishes explicit
192x192 and 512x512 PNGs plus a separately padded 512x512 maskable variant; iOS receives a
180x180 `apple-touch-icon`, and ordinary tabs receive a 32x32 favicon. These five PNGs are the only
shell images admitted through the distribution boundary: `check-content-boundary.mjs` binds each
stable output path to its reviewed SHA-256, so the exception cannot admit archive artwork or an
arbitrary renamed PNG.

The outer page remains edge-to-edge black. Once content is acquired, the source loading bridge and
Pixi canvas are moved into `.game-viewport`, whose four edges follow the CSS safe-area environment
variables. `FixedStage` continues to own all scaling and letterboxing inside that usable rectangle,
so neither source point geometry nor the iPhone/iPad display tier is changed.

The page does not rely on `100dvh` as its sole size authority. Normal tabs follow VisualViewport so
collapsing browser chrome and the software keyboard cannot leave content under the visible edge;
installed Home Screen apps prefer the window dimensions because iOS can briefly retain the prior
orientation's dynamic-viewport measurement. Resize, VisualViewport, orientation, Fullscreen API,
page-return, and visibility events are sampled immediately, across animation frames, and after
short mobile settling intervals. `FixedStage` separately observes the real safe-area host because
Pixi's built-in resize plugin only reacts to `window.resize`. Thus CSS canvas size, renderer screen,
letterbox transform, and pointer mapping converge on the same rectangle after every rotation.

## Storage boundary

A Home Screen web app is a separate browser storage context. iOS copies login cookies at install
time, but not `localStorage`; this app's offline saves and port settings therefore do not migrate
from the originating browser automatically. The install guidance tells players to export existing
offline saves first. Resource archives remain deliberately tab/session-local and must be selected
again after launching the installed app.

## iPhone limitation

As of 2026-08-10, WebKit's arbitrary-element Fullscreen API issue for iPhone remains open:
<https://bugs.webkit.org/show_bug.cgi?id=206854>. Installed `display: fullscreen` web apps also do
not consistently hide all system status/home UI:
<https://bugs.webkit.org/show_bug.cgi?id=264220>. The supported promise is therefore
**browser-chrome-free Home Screen presentation**, not native-app-exclusive screen ownership.

## Verification

Automated browser execution is opt-in. With a fresh strict Vite server running on an unused port:

```powershell
$env:DIB_WEB_URL = "http://localhost:<port>"
pnpm scenario:fullscreen-shell
pnpm scenario:mobile-viewport
```

The first muted scenario needs no content archive. It checks the emitted manifest, the iPhone
install/storage warning, installed-shell rotation sizing, hidden redundant action, and the direct
Fullscreen API/orientation call path. The second uses a compatible local archive and checks repeated
iPhone- and Android-shaped portrait/landscape transitions through the live Pixi renderer, including
complete canvas fill, renderer-screen dimensions, uniform letterboxing, centering, and page overflow.

On physical devices, confirm the same sequence in both a normal tab and an installed app: rotate
portrait -> landscape -> portrait -> landscape, wait briefly at each stop, and verify the complete
game frame remains visible and centered outside the notch/home-indicator. Also cover Android browser
fullscreen entry/exit and split-screen or resizable-window changes. The authored scenarios remain
unrun until browser verification is explicitly authorized.
