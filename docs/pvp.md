# Multiplayer PvP

PvP uses the Tournament background and the shared popup/MenuButton2 artwork from the selected
content package. Invite entry and waiting use an accessible lobby with a real text field for paste
and mobile keyboards. Once combat starts the lobby is closed; surrender and results use the
existing native popup family. Combat mounts the same `BattleNode` as normal Offline and Official encounters: Arena scenery,
source monster scaling, friendly cards, ability cards, target picker, swipes, turn-order column,
HP/status displays, phase-timed effects, audio, death and reserve animations. The camera maps your
canonical team to the friendly side without changing IDs, engine ordering or committed random draws.
The only field geometry extension fits an opponent spirit into a fourth source-sized slot.
The ordinary single-player enemy summon behavior is unchanged.
The Mod Manager screenshot captures the actual in-game lobby with the selected package's popup
and button artwork. This one reviewed promotional capture is allowed by exact path and hash;
runtime game resources still come from the user's local archive.

Status (2026-10-06): PvP permits reviewed cosmetic mods only, removes the match menu during
combat, and uses native surrender/result popups. The authorized cosmetic-only demo was recorded
and inspected: host victory after 31 commands, 192 seconds, matching transcripts and unchanged
campaigns. The subsequent local stability pass covers native Offline/Official matches, retries,
client reopen, spirits and reserve promotion. The 844x390 post-spirit ability hit-test failure
found in that pass is fixed (2026-10-07): decorative damage/effect nodes no longer intercept
battle input. This stability pass does not operate the deployed service.

The goal is an official selectable mod adding invite-code multiplayer to the tournament UI
in both Offline and Official play. Both players bring their parties and the server owns
combat and outcomes. PvP is a port extension, not a baseline fidelity claim.

## Match rules and trust

- Matches are exhibitions. Monsters enter at full HP with equipment and permanent bonuses.
  Campaign IDs and trip HP are removed. Capture is disabled, the exhibition wallet starts at
  zero, and matches award no campaign rewards or durable injuries.
- Spirits retain each entrant?s captured energy and unlocked XP. Summoning uses the normal Hero
  menu, energy charge/spend, once-per-exhibition lock, combat level and automatic spirit AI.
  Each side has a separate summon slot outside its three frontline monsters. Official roster and
  spirit inputs are projected together from one committed slot; Offline inputs remain untrusted.
  The server validates availability, owns the summon and records it in the idempotent transcript.
  Spirit energy, XP and use locks never write back into the campaign.
- `BattleSession.humanTeams` is opt-in. Default control remains team-0 player versus team-1 AI.
  PvP marks both human; Berserk, status-driven lost turns and native spirits remain automatic.
- Committed command transcripts and random-draw prefixes reproduce both clients' battles.
  No future randomness is disclosed. Restoring committed state cannot roll new outcomes.
- Official entries contain only a slot ID. The composition root must verify the player's
  committed slot, rules and eligible location, then derive its party through `officialParty`.
  Client-authored Official rosters are rejected.
- Offline entrants submit bounded, explicitly untrusted exhibition rosters. These never reach
  Official reducers. Offline PvP needs a network connection, but no Official account.
- Offline tokens use a separate HMAC domain and cannot authorize `/api/game`. Official access
  is rechecked against the account allowlist on every PvP request. Uploaded mod JS never runs
  on the server.

## Compatibility

`PvpCompatibilityRegistry` admits baseline rules plus exact operator-reviewed cosmetic package
digests. Gameplay mods are rejected even when both players select the same release and the server
has its adapter installed. Unknown packages and client claims such as `saveCompatibility: neutral`
do not establish cosmetic safety. Rejection names the package and asks the player to disable it;
PvP never silently disables an active gameplay mod.

The installed registry recognizes Wand Pointer Trail 1.1.1/1.1.2 only when its reviewed script,
entry point and package shape match `pvpSupportedMods.ts`. Unequal reviewed cosmetic selections
are allowed. The built-in PvP toggle itself executes no arbitrary code and retains Official
isolation. Content packages still need the same server-supported rules identity.

Admission applies to invite, join and client reconnect (`POST /api/pvp/matches/current` with the
current setup). Custom `adapter` commands are rejected server-side. The [adapter API](pvp-adapter-api.md)
and Echo Strike/Turn Counter fixtures remain dormant development infrastructure; they are not
supported gameplay or demonstration material. Existing gameplay-adapter matches cannot continue
under this policy; their existing deadline still settles them, and server forfeit remains available.

## Playing

Open **Mod Manager → Browse → Multiplayer PvP**, choose Enable, and Apply (Installed works too). It is included
with the engine and does not need a `.dibmod` download. Enabling it alone does not restrict Official
launch. In a town's Arena menu, choose **PvP** directly below **Tournament**, then **Create invite** or enter a friend's
eight-character code and **Join match**. The menu remains available after completing tournaments.

Both players see the same committed battle with their own team below their opponent. Choose an
ability and pick targets through the ordinary encounter controls; the last target commits.
Delay retains its native confirmation. The existing retreat button now opens the native Yes/No
surrender popup. Yes forfeits the match; No keeps playing. Escape/Back dismisses a native popup or
picker first, then requests surrender at a player decision (including an opponent decision). There
is no match menu, Continue battle, mod-action screen, or Close escape once combat starts.

A match must finish through victory/defeat, confirmed surrender, or the existing five-minute turn
timeout. Leaving the app does not reset or pause the match. A reload can recover it before that
deadline and returns straight to combat. The client automatically retries uncertain commands with
their original envelope and polls through connection interruptions; it never simulates an outcome
locally. Native result acknowledgement returns to Arena; reopening after completion starts a lobby.

Guest credentials remain separate from Official login and are cached locally (tab-local if storage
is blocked). Clearing browser storage loses the guest identity. Background polling does not lock
normal controls: a submitted move waits for an outstanding read, and duplicate taps stay suppressed.

The scene persists across polls and appends committed command/draw suffixes. It waits for the server
before resolving mechanics, then feeds each action through the ordinary `playTurn` animation path.
Opponent commands and automatic turns share that same clock; there are no animation-frame requests.
Fresh fights present the automatic opening prefix. Reconnect hydrates historical roster/status/spirit
state without replaying past commands, then continues from the current decision. Terminal combat
finishes its animation before the native result popup, with no campaign reward flow.

## Service and persistence

`PvpService` uses serialized `PvpStore` transactions. `FilePvpStore` commits a strictly validated
`pvp.json` through the existing fsync/atomic-rename helper. This supports one server process;
replicas require a database-backed transactional store. Memory storage is test/development only.

Every replay rechecks the stored participant setups against the installed compatibility registry.
Reusing a profile name for a different logic pack cannot reinterpret a stored match. Current match
responses include the rules identity; older prototype receipts missing only that redundant field
derive it from the retained participant setup. A contradictory stored identity is rejected.
An already-connected participant can still forfeit using its retained decision if the old server
rules become unavailable: forfeit appends the terminal command without replaying mechanics.

Invite codes have eight characters and last ten minutes. One principal may own one waiting
invite or active match. Joining atomically admits one guest. Each turn has a five-minute
deadline; timeout loses to the waiting opponent. Either player may forfeit out of turn.
Two thousand resolved turns end a stalemate as a draw. These are new PvP rules, not recovered
source constants.

Commands contain a UUID, expected revision, server decision ID and semantic action. Reusing
an ID/body returns the exact accepted response; another body is rejected. Receipts retain
transcript-prefix lengths instead of quadratic copies of full histories. Terminal matches
and receipts remain for 24 hours. Admission is bounded to 1,024 retained matches. Failed
simulation or persistence leaves the previous record intact.

The HTTP adapter retains the game's CORS policy and adds bounded JSON, address/session/player
rate limits, no-store responses and structured errors.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/pvp/info` | Feature availability |
| POST | `/api/pvp/session` | Isolated Offline identity; `{ name }` |
| POST | `/api/pvp/invites` | Capture entrant party and issue code |
| POST | `/api/pvp/join` | Pair against a code |
| GET | `/api/pvp/matches/current` | Recover current invite or match |
| GET | `/api/pvp/matches/:id` | Participant-only current state |
| POST | `/api/pvp/matches/current` | Validate current content/mod setup and recover current match |
| POST | `/api/pvp/matches/:id/commands` | Ability, delay, spirit or forfeit; adapter intents rejected |
| POST | `/api/pvp/matches/:id/cancel` | Cancel waiting invite |

`createGameServer({ pvp })` mounts the optional service. The maintained CLI constructs it from
installed rules and a read-only validated Official-slot projection. `DIB_PVP_ENABLED` defaults to
true; setting it to `0` removes the service. Without it, availability reports false and mutations
return explanatory 503 responses. Match state lives in `DIB_GAME_DATA_DIR/pvp/pvp.json` and is
covered by backups of that data directory. The maintained Caddy and Vite proxies route `/api/pvp/*`
to the same API as `/api/game/*`. File storage remains single-process only.

## Verification

Tests cover both human sides, target ownership, delay, reserves, full battles, deterministic
restore, forfeits, disabled/Berserk automation, unchanged campaign AI, Official/Offline
boundaries, simultaneous joins, exact retries after later moves, stale revisions, private
reads, timeout, cancellation, write rollback and file-store restart. HTTP tests complete a
two-client fight and verify authentication, revoked access, CORS, body bounds and rate limits.

Client tests additionally cover lost-response retry identity, reconnect revision monotonicity,
disposal during a pending request, structured incompatibility errors, blocked local storage,
both-team mixed targeting, phone/tablet geometry and Official credential renewal. Official
projection tests prove the campaign stays unchanged and town/healthy-party eligibility is enforced.
Additional regression checks cover input during polling, incompatible response retry, retained
terminal recovery, mismatched client/server rules, prototype receipt recovery, and strict PvP
request/response boundaries. Arena chat and popup presentation retains input ownership before
allowing PvP to open. Tournament entry no longer owns a PvP button.

Before the native-renderer replacement on 2026-10-05, authorized muted browser checks passed against an isolated file-backed API and
fresh production preview, using the operator-owned original archive. Screenshots and exported
state were opened and inspected. Coverage includes:

- Offline/Offline, Official/Official, and mixed Offline/Official invite/join and real canvas moves;
- iPhone and iPad display tiers, matching committed transcripts, scene reopen and forfeit;
- an unreadable response after a committed move, followed by an identical-envelope retry;
- unequal reviewed Wand Pointer Trail selections and a complete natural-victory battle;
- a rejected Blue Dragon Overdrive guest, with exact mod/path/remedy and the host invite intact;
- six-monster teams, reserve promotion, natural victory, and unchanged campaign state;
- pending first-entry tutorial claims and visible popups blocking PvP until dismissal.

Workspace tests and typechecks, the production build and content boundary passed.
The browser pass fixed a real tutorial ownership race; startup/slot/chat choreography and Windows
Chromium frame handling were corrected in the scenario. Forced SwiftShader stalled concurrent
clients on this host; the scenario uses Chromium's normal graphics path and disables frame limiting.
Run scenarios serially against one isolated API to avoid catalog/session rate limits.

To repeat `pnpm scenario:pvp`, start fresh isolated API/Vite servers from this checkout, set
`DIB_WEB_URL` and `DIB_CONTENT_ARCHIVE`, then run it when browser validation is authorized.
It launches two isolated muted contexts, enables the actual manager switch, enters Arena,
creates/joins an invite, submits moves through real canvas clicks, compares both committed
transcripts, asserts that no match menu is shown, and cancels/confirms native surrender. It asserts
`renderer: BattleNode` and uses native ability/target coordinates. Inspect `output/pvp-iphone` screenshots and JSON; repeat with
`DIB_DISPLAY_MODE=ipad`.

By default both sides are Offline. Use **disposable, initially empty** Official accounts on the
isolated server with `DIB_PVP_HOST_TOKEN` and/or `DIB_PVP_GUEST_TOKEN` for mixed/Official runs.
Initialize those disposable accounts at the real Arena by configuring the isolated API with
`DIB_GAME_START_WORLD=World_1-2` and `DIB_GAME_START_TOWN=Capital_City` before creating their slots.
The scenario creates/reopens slot 1 and forfeits/cancels retained test matches; it never deletes a
campaign slot. For unequal cosmetics,
install the reviewed archive in the API's `DIB_OFFICIAL_MODS_DIR` and set `DIB_PVP_HOST_MOD` to
that archive for the Offline host. Set `DIB_PVP_GUEST_MOD` and `DIB_PVP_EXPECT_INCOMPATIBLE=1` for
the gameplay-mod admission rejection check (before invite/join). Other switches are `DIB_PVP_FULL_BATTLE=1` (natural victory),
`DIB_PVP_TURN_LIMIT=200` (optional full-battle input budget, default 100, integer 1–1000;
large Official parties can exceed 100 choices; progress timeouts and terminal assertions stay unchanged),
`DIB_PVP_ROSTER=1` (six-monster Offline fixtures),
`DIB_PVP_SPIRITS=1` (balanced Offline parties, full energy and unlocked spirits; checks both native
spirit menus plus friendly/opponent field and queue membership), and `DIB_PVP_LOST_RESPONSE=1` (committed but
unreadable response/retry). `DIB_PVP_OUTPUT` keeps each run's screenshots and JSON separate.

Additional stability switches (all opt-in):

- `DIB_PVP_RECONNECT=1` closes the guest page after two moves, opens a new page with the same
  storage, enters through the content/title/Arena UI, and checks the recovered match ID, revision
  and complete transcript before continuing.
- `DIB_PVP_POLL_OUTAGE=1` corrupts at least three consecutive guest match-read responses,
  checks that committed state is retained, then restores responses and requires automatic recovery.
- `DIB_PVP_DELAYED_INPUT=1` delays command requests by 750 ms and repeats the target click while
  the write is pending. Each move must still advance exactly one revision.
- `DIB_PVP_LOBBY_CYCLES=3` creates and cancels three invites before joining the actual match
  (accepted range 0–10).

Every run writes `result.json`; successful matches also write `match.json`. The scenario compares
both clients' complete battle transcripts after every move and at settlement, and checks campaign
preservation and native result dismissal. A gameplay-mod rejection permits only its expected
409 console message from `/api/pvp/matches/current`; other browser errors still fail the run.
Status panels from sleep/skip chains are acknowledged with real battle-centre taps and counted
in `statusAcknowledgments`. Waiting only for ability controls can time out while these ordinary
continuation panels are visible.

The 2026-10-07 combined Offline/Offline stress rerun passed against the Reincarnation fix:
38 turns, natural defeat settlement, both spirits, lost response, three failed polls, delayed
duplicate clicks, cold reconnect and three invite cycles. Clients agreed after every move,
campaign saves were unchanged and browser errors were empty. Evidence is in
`output/pvp-reincarnation-recheck-status`; its earlier driver timeout remains separately in
`output/pvp-reincarnation-recheck`.

The subsequent summon-input-fix rerun also passed on iPad geometry: 32 turns to natural
defeat settlement, both spirits, four failed polls, lost-response retry, delayed duplicate
clicks, cold guest reconnect and three invite cycles. Both clients agreed on all 34 committed
commands (revision 35); campaign saves were unchanged and browser errors were empty. Evidence
is in `output/pvp-summon-input-recheck`; reconnect, outage and victory frames were inspected.

## Demo video

`pnpm demo:pvp-video` records a side-by-side video of one full match (host left, guest right) for
looking at PvP rather than testing it. It is a browser run, so it is opt-in like the scenarios. It
builds the web client from the current checkout, starts its own
isolated API (port 18889) and `vite preview` (port 15283), then drives two muted Chromium clients
through the real UI and tears everything down at the end. Rerun it after a layout or timing change;
the battle itself varies from run to run because the server owns the random draws.

The take shows archive/mod selection and the Mod Manager PvP switch, with our existing Wand
Pointer Trail cosmetic mod on the host only. It continues with Arena -> PvP, invite/join, then
ordinary ability cards, Delay, healing, buffs, multi-target attacks, statuses, reserves and a
natural victory. It uses no gameplay adapters, extra action UI, or voluntary leave/reopen sequence.
The header captions each move; the arrow cursor is a recording aid, not game UI. The latest take
was recorded on 2026-10-06 (`2026-10-06T21-52-41`): 192 seconds, host victory after 31 commands,
matching transcripts, unchanged campaigns and no browser console errors. Encoded frames from setup,
combat, healing and the native Victory/Defeat popups were inspected. `latest/` points to this take.

Output goes to `output/pvp-demo/<timestamp>/`: `pvp-demo.mp4`, `captions.srt`, `timeline.json`,
`match.json` and `logs/`. A complete take is also copied to `output/pvp-demo/latest/` (with
`source.txt` naming its run). A failed take never replaces it; it leaves a partial video plus
`failure-host/guest.png` and `.json` state dumps in its run directory. Each side is captured with
CDP screencast on one wall clock, so the opponent's polling delay appears as it does live. It
requires the operator-owned archive
(`DIB_CONTENT_ARCHIVE`, default the root `*.ipa`/`*.zip`), `examples/mods/dist/wand-pointer-trail.dibmod`
(`pnpm mods:examples`), and an ffmpeg with libx264 on `PATH` (or `FFMPEG`); ffmpeg is checked
before the build so a missing encoder fails immediately.

Keeping it regenerable: the recorder drives the battle through
`apps/web/tests/browser/pvpCombatDriver.mjs`, the same driver as the maintained `pvp` scenario.
When a PvP control, popup, layer or the Arena host changes, update that driver and rerun the demo
alongside the scenario. The recorder fails fast instead of timing out on the two drifts it has
already hit:

- It asserts that a tap at the battle's centre hit-tests into the mounted `BattleNode`.
  This check exists because of an earlier bug: the Arena lobby host, in the director popup band,
  covered the battle and swallowed its input.
- It treats an unclosed Skip Turn confirmation as an error. The popup's 0.2 s scale-in means a
  point read mid-animation misses Yes, so the driver waits for the button to settle and retries.

Options:

- `--keep-frames` keeps the raw frames, and `--stitch-only <run>` re-encodes them.
- `--serve-only` only starts the two servers.
- `DIB_DISPLAY_MODE=ipad` records the 512x384-point tier instead.
- `DIB_PVP_DEMO_PACE=1.5` slows every deliberate pause.
- `DIB_PVP_DEMO_PARTIES=<json>` supplies other `{ host, guest }` rosters.
- `DIB_PVP_DEMO_SEED` seeds the driver's own move choices.
- `DIB_PVP_DEMO_WAND_SCALE` sets the host's trail size; the default is 3, while the mod's own default of 1 is hard to see on video.
