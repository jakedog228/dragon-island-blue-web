# Emulator ↔ web Fidelity Lab

The Fidelity Lab is a local-only debugging surface for comparing the maintained TouchHLE build
with the web port. It never ships with the game and does not alter an Official server. It attaches
to TouchHLE, opens a controlled Chromium instance for the port, and treats input as normalized points in
the 480×320 game surface. Live mode captures each complete dashboard gesture before replaying its
ordered phases to both runtimes. Scripted mode calibrates against TouchHLE's `HSCENE` clock and
dispatches the matching port phases at the same native harness deadlines.

The dashboard provides four views:

- **Side by side** for ordinary play and layout comparison.
- **Wipe** with an adjustable vertical split for alignment work.
- **Overlay** with adjustable port opacity for movement and tween comparison.
- **Difference heat map** with configurable per-pixel and whole-frame thresholds. Differences must
  persist for the configured number of samples before the lab raises a notice, which filters most
  single-frame capture jitter without hiding stable layout, text, value, or lifecycle differences.

The workspace has separate viewer and evidence clocks. Live comparison requests frames continuously:
the controlled port publishes its Pixi canvas directly through a loopback WebRTC video track, while
the managed TouchHLE build publishes its direct framebuffer through a streaming encoder. By default
those panels remain independent, which gives the port pane its real delivered cadence instead of
passing it through Chromium's lower-rate DevTools screencast. If direct canvas video is unavailable,
the dashboard identifies and uses that screencast as a fallback. The optional **Wait for both panels
to sync** setup choice deliberately uses buffered Chromium screencast frames, matches the one captured
nearest each completed native source frame, and releases both panes at the native boundary.
Wait mode makes visible timing easier to compare, but intentionally caps both panes at the slower
native capture cadence. The status chips and line below the panes identify the mode, delivered rate,
and (in Wait mode) latest source-time skew. Durable PNG checkpoints, semantic state, and ordinary
comparison evidence stay at 2 Hz by default. **Live pixel analysis** samples the latest decoded
stream frames at 10 Hz, **Difference heat map** enables the same analyzed path automatically, and
**Refresh frames** requests a new durable evidence pair without changing viewer cadence.

It can record the paired frames and mirrored input phases, replay the last input macro, save an
immediate checkpoint, and retain both automatic and operator-authored observations in NDJSON.
Generated evidence is written under `output/fidelity-lab/` and remains gitignored.

## Start a comparison

Run one command:

```powershell
pnpm fidelity:lab
```

The setup dashboard opens automatically. It discovers the maintained TouchHLE package, local
compatible archives, native save slots, the matched Fidelity Lab fixture, and reviewed tasks. An
archive or save that is not listed can be selected with the adjacent file button; bytes travel only
to the loopback-only local launcher.

Choose one workflow:

- **Live comparison** launches both games at the chosen save. Taps and drags on either dashboard
  surface are captured through pointer-up, then replayed phase-for-phase into both runtimes. This
  keeps one shared gesture clock even though TouchHLE polls input on its native main loop. Managed
  sessions inject normalized phases through the emulator's opt-in background harness, without
  moving the physical cursor or changing foreground focus. Sub-frame browser clicks use the
  harness's 120 ms tap hold so TouchHLE observes and processes distinct down/up frames. Record,
  replay, checkpoint, overlay, wipe, and heat-map controls remain available throughout the session.
  Only one gesture may be in flight. While the Input chip says **mirroring to both panels**, the
  canvases show a wait cursor and reject additional pointer-downs instead of queuing clicks made
  against stale panel frames. Retry after Input returns to **synced**.
  Its **Wait for both panels to sync** checkbox is off by default. Enable it when comparing the
  visible instant of an action: the lab holds the faster web image until TouchHLE's closest-time
  framebuffer is ready, then advances the panels together. Leave it off for normal responsive play.
  **Hear web port audio** is on by default and passes through the port's source-default 25% effects
  and 50% music settings; the in-world Options popup can change them normally. This is web-port
  audio only; the managed TouchHLE reference keeps its null audio driver.
- **Automated task** shows the task purpose, setup, review focus, and matched-save readiness before
  launch. **Start and run task** creates both runtimes, executes the reviewed schedule, evaluates
  semantic expectations, and opens the comparison workspace while it runs.

The content-rights checkbox is required before launch. The launcher then:

1. copies only the required emulator runtime into a new gitignored output directory;
2. copies the selected save into disposable native slot 1 and imports the same bytes into web slot
   1, while clearing only disposable native slots 2–3 to match the port's empty comparison slots;
3. starts a fresh strict Vite server, controlled port browser, and silent disposable
   TouchHLE process;
4. captures TouchHLE directly from its framebuffer rather than from whatever happens to cover its
   desktop window; the harness writes each frame under a partial name and atomically publishes the
   final PPM only after it is complete; Wait mode pairs the nearest Chromium source frame, while the
   default mode publishes both streams independently, and the 2 Hz evidence loop deletes converted
   predecessors so the session remains bounded; and
5. redirects to the active comparison workspace.

**Back to setup** retains the active session so it can be reopened. **End session** closes the
controlled browser, native copy, and worker while retaining all evidence. `Ctrl+C` at the launcher
terminal ends every launcher-owned session. The packaged TouchHLE sandbox is read-only throughout.
The setup process fingerprints the launcher modules it loaded. If either changes while that
long-lived process is running, it refuses to create another comparison and asks for a launcher
restart; this prevents a stale native environment from being paired with a freshly loaded web
worker. Each managed session records the applied native overrides and launcher fingerprint in
`launcher-environment.json` beside its evidence. The launcher and worker also exchange a versioned
managed-comparison policy. A freshly loaded worker rejects a missing or different policy before it
boots Chromium, so even a setup process old enough to predate the source-fingerprint guard cannot
silently pair randomized native Foundation traversal with lexical port traversal.

## Automated machine tasks

Task JSON is deliberately reviewable. Every schema-v1 task declares its purpose, setup, manual
review focus, ordered waits/inputs/checkpoints, and explicit expectations. There is no learned or
heuristic correspondence between native and port state. Supported expectation targets are:

- `port`: an exact `render_game_to_text` path assertion;
- `native`: a TouchHLE scene node class/text/visibility assertion; and
- `lab`: an exact lab status path assertion.

Waits can require a predicate to remain true for a stated sample count. Anchor them to static
semantic state or static native nodes rather than flashing labels. Checkpoints save `native.png`,
`port.png`, comparison metrics, and the evaluated state.

Two core tasks are maintained under `apps/fidelity-lab/tasks/`:

- `01-load-saved-town.json` loads slot 1 and compares the settled Corova town screen.
- `02-leave-town-transition.json` loads Corova, checkpoints it, selects Leave Town, and compares
  the settled world map.

Both declare the SHA-256 of their known matched save. The dashboard selects that fixture
automatically when it is available and refuses to call a different state “Corova” merely because
it happens to show a town. Their `nativeAtMs` fields schedule native taps; normalized `x`/`y`
fields drive the port and remain readable in the task file. The worker continuously calibrates the
native clock from completed `HSCENE` dumps, sends port down/up at the same scripted deadlines, and
records the measured schedule skew in each tap result. The native harness's fixed tap duration is
120 ms, so maintained tasks use that same hold on the port. Dashboard gestures are disabled while
an automated task owns input. Maintained tasks leave a generous margin after normal archive
startup so the high-rate viewer remains enabled without racing their first native deadline. Each
run writes `task.json`, `result.json`, and paired checkpoint
directories under the managed session's `evidence/` folder.

The workspace's **Input** chip reports the largest measured registration skew from the latest
gesture or task tap. Live input is green at `±32ms` or lower, and the browser proof uses that same
bound for each phase because post-UIKit ACK-time RNG anchoring adds a page-evaluation round trip
before CDP registration. Scripted tasks retain their
`±100ms` schedule gate. Exact shared deadlines, native registration times, controlled-page pointer
event times, and per-phase skew remain available from `/api/status` and automated-task evidence.

Live gesture phases use a post-UIKit registration barrier. Before the gesture clock starts, the lab
prepares the controlled Chromium input marker and writes timestamped normalized phases to the
session-private TouchHLE channel. When a phase becomes due, TouchHLE captures the pre-input RNG
position, queues the normal `Event::Touches*` value, and synchronously dispatches it through UIKit
to the guest. Only after that guest callback returns does TouchHLE write the ACK. The lab anchors
the port to the carried pre-input RNG position and releases the already prepared trusted Chromium
phase at that ACK. The previous dequeue-time ACK could release Chromium one native frame before
UIKit handled the touch; the post-UIKit barrier makes both displayed runtimes begin reacting at the
same registration boundary whenever host scheduling permits.

Input geometry is independent of the 2 Hz evidence sampler. A transient screenshot/state read
failure retains the last valid controlled-canvas bounds, so it cannot silently turn the next
mirrored gesture into a native-only action.

The old parameter-level entry point remains available for harness debugging as
`pnpm fidelity:lab:advanced -- <options>`. It is not the normal operator workflow.

## Aligning state

Choose the same save once in the setup dashboard. The launcher copies it into both disposable
runtimes; it never points an experiment at the only copy or overwrites the packaged sandbox.

Begin the compared route from a stable decision boundary: a settled menu, town, room, or player
battle choice. Press **Record**, interact through the dashboard, then stop recording. Reset both
runtimes to the same boundary and press **Replay last macro** for a repeatable automatic pass.
Macros store down/move/up phases and their relative times, so swipes are reproduced rather than
collapsed into taps.

## Native semantic state and numeric rules

The modified TouchHLE harness can dump its cocos scene graph. Generate a DUMP-only observer script:

```powershell
pnpm --filter @dib/fidelity-lab native:observer -- `
  output/fidelity-lab/native-observer.txt 120 250
```

Before launching TouchHLE, set the generated script and then pass its log to the lab:

```powershell
$env:TOUCHHLE_INPUT_SCRIPT = (Resolve-Path output/fidelity-lab/native-observer.txt)
# Launch TouchHLE from the operator's intended package/sandbox after backing up its save.

pnpm fidelity:lab:advanced -- `
  --native-log .\path\to\touchHLE_log.txt `
  --rules .\path\to\comparison-rules.json `
  --headed-port
```

An optional rules file turns visible native numbers into exact/toleranced semantic comparisons:

```json
{
  "rules": [
    {
      "id": "example-visible-value",
      "label": "Example visible value",
      "nativeText": "Value: (?<value>\\d+)",
      "portPath": "player.exampleValue",
      "absoluteTolerance": 0,
      "relativeTolerance": 0
    }
  ]
}
```

`nativeText` is a JavaScript regular expression matched against visible native label text and must
capture the numeric value as `(?<value>...)` or capture group 1. `portPath` addresses the structured
port state (`a.b[0].c` syntax). A rule becomes a deterministic error only when
`abs(port-native) > max(absoluteTolerance, abs(native)*relativeTolerance)` for three consecutive
dashboard samples. Missing native text or port state is `pending`, not silently treated as equal.

Rules are intentionally explicit. Inferring that two unrelated numbers on a crowded screen are the
same quantity would manufacture evidence; add a rule only after its native label and port state path
are known to represent the same source value.

## Reading a recording

Each timestamped recording contains:

- `manifest.json`: web URL, capture cadence, and RNG starting position;
- `frames/*-native.png` and `frames/*-port.png`: paired samples;
- `events.ndjson`: input phases (including native RNG position, anchor correction, and measured
  registration timing), frame ids, checkpoints, visual notices, numeric rule failures, and manual
  observations; and
- `macro.json`: the replayable normalized input timeline.

## Verification

The non-browser checks are safe to run by default:

```powershell
pnpm --filter @dib/fidelity-lab test
pnpm --filter @dib/fidelity-lab typecheck
pnpm --filter @dib/engine test
pnpm --filter @dib/web typecheck
```

Starting the lab is active browser/emulator validation and remains opt-in. Live operator sessions
pass through web-port audio by default, while dashboard-managed TouchHLE uses null audio. Automated
tasks force the controlled port browser to `--mute-audio`; the managed-live browser acceptance
fixture unchecks **Hear web port audio** before launch, so automated validation remains inaudible.
The maintained acceptance checks are:

```powershell
pnpm scenario:fidelity-launcher      # setup workflow and task/save preview
pnpm scenario:fidelity-managed-live  # direct-canvas live launch, checkpoint review, and teardown
pnpm scenario:fidelity-managed-task  # one-click matched automated comparison
```

To exercise the optional source-time-paired screencast path instead, set
`DIB_FIDELITY_WAIT=1` for `scenario:fidelity-managed-live`.
