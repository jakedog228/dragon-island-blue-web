# Foreground audio checks

The conservative adapter pauses audio when the document becomes hidden, keeps music position
and decoded effects, and retries autoplay-denied music on a subsequent real tap or key press.
It does not change audio backends, track selection/RNG, volume scaling, audio-session category,
Silent Mode policy, page teardown, or system media metadata. A real media/decode error still fails
loudly. Browser interruption recovery remains best effort.

## Optional automated smoke test

With a strict local Vite server running:

```powershell
$env:DIB_WEB_URL = 'http://localhost:5173'
node apps/web/tests/browser/audio-lifecycle.playwright.mjs
```

The fixture imports the real adapter and uses a generated WAV. Chromium always launches with
`--mute-audio`, without disabling autoplay restrictions. It checks synthetic visibility changes
and recovery from an injected autoplay denial through a real click. This does not reproduce
iPhone system lifecycle events or prove audible output. No content archive is required.

## iPhone check

Use an ordinary Offline save in Safari, then repeat in the Home Screen app:

1. Load content and tap through the title. Confirm music and effects work normally.
2. Lock the screen while music is playing. Expect silence after the page becomes hidden.
3. Unlock and return. Expect the current music to resume; tap once if iOS requires a gesture.
4. Switch to another app and back, including a quick out-and-back. Expect the same recovery
   without a burst of old combat effects.
5. Change scenes and finish a battle. Music should still replace rather than overlap the old
   track. A completed victory jingle should not restart after a lock/unlock.
6. Check the existing music/effects options and Silent Mode behavior for regressions.

If recovery fails, record the iOS version, Safari versus Home Screen, whether music/effects/both
failed, and whether one additional tap helps. `JSON.parse(render_game_to_text()).audio` exposes
`hidden`, `contextState`, `musicPaused`, and `musicNeedsGesture` for diagnostics. System media
controls may still show the page title; this patch does not attempt to suppress them.
