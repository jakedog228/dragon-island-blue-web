# Multiplayer PvP

PvP uses the Tournament background and the shared popup/MenuButton2 artwork from the selected
content package. Invite entry, waiting, reconnect, forfeit and results use the same framed visual
style; input remains a real accessible text field for paste and mobile keyboards. The exhibition
board uses Arena scenery, native menu buttons, popup card frames and the shared tinted HP bars.
All new geometry is responsive port-extension layout, not a claim about shipped PvP behavior.
The Mod Manager screenshot shows the real lobby layout with labeled neutral preview artwork:
imported game artwork stays in the tab and is never copied into the distribution.

Status (2026-10-05): engine, protocol, durable service, CLI composition, built-in mod selection,
Arena lobby and two-human battle board are connected. Workspace tests/typecheck, production
builds and content boundary pass. Authorized muted browser checks cover baseline
play and composed example adapters in both display tiers. No deployment has been performed.

The goal is an official selectable mod adding invite-code multiplayer to the tournament UI
in both Offline and Official play. Both players bring their parties and the server owns
combat and outcomes. PvP is a port extension, not a baseline fidelity claim.

## Match rules and trust

- Matches are exhibitions. Monsters enter at full HP with equipment and permanent bonuses.
  Campaign IDs and trip HP are removed. Capture is disabled, the exhibition wallet starts at
  zero, and matches award no campaign rewards or durable injuries.
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

`PvpCompatibilityRegistry` uses operator-reviewed package digests and installed mechanical
profiles. Names, official-looking IDs and client manifest claims do not confer trust.

Different cosmetic selections and package releases with identical reviewed mechanics can
reconcile. Gameplay-mod order remains significant. Different content rules, unsupported
releases/hooks, conflicting gameplay rules/order and missing server combinations return
structured issues with the mod ID, affected path, explanation and suggested fix. Party
construction errors identify missing monsters or unsupported mechanics without consuming
the invitation. The server never silently drops gameplay mods or guesses equivalence.

The first-party mod activates built-in client code so selecting it alone does not
execute arbitrary packages or weaken `onlineModBoundary`. Existing Offline code mods retain
Official isolation. A `saveCompatibility: neutral` declaration is not proof of PvP compatibility.

The installed registry currently recognizes Wand Pointer Trail 1.1.1/1.1.2 only when its exact
reviewed script, entry point and two-file package shape match `pvpSupportedMods.ts`. The descriptor
is bound to the installed archive digest. This supports an unequal cosmetic selection without
trusting the mod's name or a save-neutral claim. Other packages need reviewed descriptors and,
when they change battles, a server profile; unsupported selections identify their ID/version/path.

The executable [PvP adapter API](pvp-adapter-api.md) now supplies per-match rules, strict custom
intents, replayed state, dependency/conflict checks, and client buttons/custom canvas controls.
Operators install explicitly reviewed combinations through `DIB_PVP_ADAPTERS_MODULE`. The runnable
Echo Strike + Turn Counter examples demonstrate composition. Existing special-monster mods
remain unsupported until their own adapters and necessary timing
protocols exist; the previous cosmetic checks did not establish gameplay-mod compatibility.

## Playing

Open **Mod Manager → Browse → Multiplayer PvP**, choose Enable, and Apply (Installed works too). It is included
with the engine and does not need a `.dibmod` download. Enabling it alone does not restrict Official
launch. In a town's Arena menu, choose **PvP** directly below **Tournament**, then **Create invite** or enter a friend's
eight-character code and **Join match**. The menu remains available after completing tournaments.

Both players see the same committed battle with their own team below their opponent. Choose an
ability, select targets when prompted, and confirm. Delay is available on your turn; Match menu
offers reconnect, resume and confirmed forfeit. After disconnecting or leaving the scene, reopen
PvP to recover the current match. Failed writes retain their request ID for Retry pending action.
Guest credentials remain separate from Official login and are cached locally (tab-local if storage
is blocked). Clearing browser storage loses the guest identity.

Background polling does not lock the controls: one submitted move waits for an outstanding read,
and duplicate taps remain suppressed. An unchanged revision preserves lobby focus and code selection.
Reopening after a match ended recovers the most recent retained result, with a live match taking
precedence. The client refuses to replay a recovered battle if the current package's rules identity
differs; it still permits cancellation/forfeit so the player can leave that match.

The new exhibition board uses window-relative layout in both display tiers, local archive monster
art/names, committed HP/status/queue state and ticker-driven damage/heal feedback. It is a port
extension rather than the original single-human BattleNode presentation. Gameplay-mod callbacks
that alter that original presentation are not implicitly supported by this board.

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
| POST | `/api/pvp/matches/:id/commands` | Ability, delay or forfeit |
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

On 2026-10-05, authorized muted browser checks passed against an isolated file-backed API and
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
transcripts, reconnects and forfeits. Inspect `output/pvp-iphone` screenshots and JSON; repeat with
`DIB_DISPLAY_MODE=ipad`.

By default both sides are Offline. Use **disposable, initially empty** Official accounts on the
isolated server with `DIB_PVP_HOST_TOKEN` and/or `DIB_PVP_GUEST_TOKEN` for mixed/Official runs.
Initialize those disposable accounts at the real Arena by configuring the isolated API with
`DIB_GAME_START_WORLD=World_1-2` and `DIB_GAME_START_TOWN=Capital_City` before creating their slots.
The scenario creates/reopens slot 1 and forfeits/cancels retained test matches; it never deletes a
campaign slot. For unequal cosmetics,
install the reviewed archive in the API's `DIB_OFFICIAL_MODS_DIR` and set `DIB_PVP_HOST_MOD` to
that archive for the Offline host. Set `DIB_PVP_GUEST_MOD` and `DIB_PVP_EXPECT_INCOMPATIBLE=1` for
the unsupported guest/cancel check. Other switches are `DIB_PVP_FULL_BATTLE=1` (natural victory),
`DIB_PVP_ROSTER=1` (six-monster Offline fixtures), and `DIB_PVP_LOST_RESPONSE=1` (committed but
unreadable response/retry). `DIB_PVP_OUTPUT` keeps each run's screenshots and JSON separate.
