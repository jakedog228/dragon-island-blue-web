# Dragon Island Blue status

## Boss battle fixes (2026-09-16)

Arkanis and Quetzalcoatl now initialize with species portraits and their special field art.
Automatic turns preserve the selected ability slot for the correct effects and sounds.
Official v24 restores boss names and artwork locally on reconnect, including dungeon survivors,
while preserving v23 mechanics and historical schemas. See [regression checks](boss-presentation-regressions.md).

Official v25 records Arena license and dungeon fixed-encounter chats in `dialogsSeen`, gates the
Relic zone change on `CaiusDefeated`, counts every enemy death for quest event 0 and accepts an
empty Drop Quests; its migration backfills provable license/dungeon chats. Every version now
accepts generator-domain Gem rewards (slot 3, level above 150) and positional Soul Stone ids, and
reducer faults are non-retryable.
Official v26 settles automatic battle-opening silver costs and migrates only replay-proven
unsettled opening wallets, preserving the v25 namespace. Cold logins of long-running saves share
one bounded slot-file read budget.

## Current system map

Multiplayer PvP: Arena invite/join mounts the ordinary `BattleNode` with native
ability cards, targeting/swipes, effects, queues, reserves and both players' spirits. Campaign state
stays untouched. Only exact reviewed cosmetic mods are admitted; gameplay mods and adapter commands
are rejected even with matching selections. The lobby closes when battle starts. Native retreat /
Escape requests confirmed surrender; native results return to Arena. Transport retries are automatic,
and disconnects retain the existing five-minute turn deadline. The demo now selects Wand Pointer
Trail only. The authorized cosmetic-only demo was recorded and inspected (192 seconds, 31 commands,
native results, matching transcripts and unchanged campaigns); the standalone Offline/Offline scenario also passes, including Escape, surrender cancellation,
confirmation and return to Arena. See `docs/pvp.md`.

Combat input correction: damage floaters and animation effects no longer participate
in pointer hit testing. A lingering damage number could cover a ready ability card and swallow
its click, reproduced after both players summoned at 844x390. The shared renderer fix covers
campaign and PvP controls/targets; real Pixi hit-test regressions and phone/tablet browser checks
verify input through still-visible effects.

PvP adapter infrastructure remains in the engine for development, but gameplay-adapter admission
and UI are disabled. Echo Strike and Turn Counter are dormant fixtures, not PvP demo material.
See `docs/pvp-adapter-api.md` for the historical API.

Save-neutral mods: v4 manifests may declare `saveCompatibility: "neutral"`.
The manager labels each release and Offline save comparisons ignore neutral package changes,
while retaining base-archive warnings, dependent-mod order/byte checks and all runtime
dependency/conflict rules. Missing declarations remain save-dependent. Devtools and Wand Pointer
Trail 1.1.2 and Less Rare Monsters 2.0.1 opt in. Pre-mod archive history separates harmless neutral
data overlays from archive changes; see `docs/code-mod-api.md` for the declaration's trust contract.

Community mods: the launcher's single Mod Manager button
(under the archive field) separates Installed (device: Official, Community and Imported files),
Load order (drag-and-drop activation order with recommended positions, conflict overrides, shared
seams) and Browse (operator-shipped Official mods via `DIB_OFFICIAL_MODS_DIR` beside community
uploads; `pnpm mods:catalog` serves the curated examples for Offline development) with grid/list
layouts, search, tags, sorting, a details window for every mod (imported files included, with
missing information marked), staged enable/apply, update detection and dependency-aware
install/disable. A separate-origin author dashboard uses existing
named login keys, profiles, immutable hosted releases and sanitized screenshots. The catalog is
outside Official simulation state. See `docs/mod-library.md` for setup, bounds, backup/takedown
commands and the opt-in browser scenario. Production activation requires the additional author
hostname.

The project is a broad playable local reimplementation, not an emulator.  It imports an
operator-selected compatible IPA/ZIP into browser memory and runs the typed game-data,
engine, PixiJS renderer, and browser shell without shipping game-content bytes.

| Layer | Responsibility | Location |
| --- | --- | --- |
| Content | Local extraction, strict runtime import, inherited typed data | `tools/dib_extract`, `packages/gamedata`, `apps/web/src/content` |
| Simulation | Pure battle/world/dungeon mechanics and player state | `packages/engine`, `packages/player-domain` |
| Presentation | Pixi primitives, game scenes, startup and browser shell | `packages/renderer`, `apps/web` |
| Persistence | Local slots and native save interchange | `packages/save-protocol`, `apps/web/src/player` |
| Official authority | Intent protocol, immutable rules, reducers, storage and HTTP service | `packages/game-protocol`, `packages/logic-pack`, `packages/official-game`, `packages/game-service`, `apps/game-server` |
| Offline extension | Full-trust executable mod loading and composition | `packages/mod-kernel`, `examples/mods` |
| Comparison tooling | Managed TouchHLE/web sessions and evidence | `apps/fidelity-lab` |

The dependency direction remains data → pure engine → renderer/web. The legacy snapshot
service is retired; `apps/game-server` is the Official authority implementation.

### Local play

- Battle is playable with source-derived data, timing, effects, target selection, reserve
  promotion, party-order viewing, secondary actions, and the reviewed swipe surface.
- World play includes imported worlds, POIs, connections, encounters, dialogue/quest seams, and
  browser-local state.
- Dungeon play is capability-gated and includes deterministic runs, routes, room interactions,
  encounters, rewards, persistence, and return to world/town.
- Town and player surfaces include retained-map town entry, party and inventory management,
  Monsterpedia/ordered combining, Guild quest surfaces, Store transactions with earned currency,
  Arena license challenges, and the local four-round Tournament flow.
- Standard Egg rewards use the local slot-machine presentation and may offer a repeat spin paid
  from the profile's gold balance. This is not an external platform purchase implementation.

### Content and Official boundaries

The browser accepts structurally valid resource packages and keeps their bytes client-local.
Validated compressed archives may be remembered in a disposable IndexedDB cache; expanded
resources and blob URLs remain session-local. Offline saves take precedence over this cache on
quota failure. Offline settings now owns one paged, named save library with cross-page ordering
and per-save mod/content warnings; legacy browser saves and undo copies are indexed in place.
The selected page supplies the in-game three-slot picker. Native import/export provides independent
backups. See `docs/save-system.md` and `../apps/web/asset-archive-spec.md` for exact storage and
identity rules.
`ThingsInWorld.plist` supplies display-only text data. Collection is integrated in both modes with
strict promoted-route archive validation and unit/component coverage. Online claims submit
`collection.claim`, mirror only committed rewards and authority-minted monster IDs, restore claimed
goal IDs from the projection, and route Egg rewards through the existing continuation.

V27 pins the source 1..150 Job-construction rule in new battle replays and preserves
active historical replay prefixes during migration. Future captures from those old battles
receive a valid bounded durable level; the older namespace remains untouched.

Official online is a token-gated, server-owned command subset with immutable logic identity and
no client-authored state snapshots. Tokens are self-service: `POST /api/game/accounts` mints one
per client address per five minutes with a username and a server-owned public-scoreboard
preference (editable in-game under Options → Scores), and `pnpm game:cli invite` still issues
them directly. The raw token is never stored either way. The shipped stack (`apps/game-server/src/cli.ts` installs the
v27 descriptor over its immutable historical delegates) advertises 45 command types covering selected world, dungeon,
player, economy, Store, Arena, Tournament, quest, and Egg-hatch operations; anything else throws
`CAPABILITY_UNSUPPORTED`. That is the count when operator data supplies every optional system —
`dungeon.*`, `world.usePortal`, `tournament.*`, and `collection.claim` drop out of the advertised
list when the imported data carries no such content.

Official defeat recovery no longer leaves a slot pinned on `pendingDefeat`: every ordinary loss
submits `battle.resolveDefeat { recovery: "return" }` before projection adoption. Eligible world,
Tournament, and non-Infinite-dungeon battles offer Save Me online. `official-game-v22` retains
v20's exact 100-gold debit and full-party recovery. Tournament Save Me follows the source saved-town
return without advancing or resetting the bracket. World Save Me returns to its origin POI, and
ordinary-Dungeon Save Me synchronizes surviving enemies and returns to the immediately previous
room without replacing the battle. V21 and earlier retain their immutable replacement behavior.
Ordinary return performs the source town-entry
full-party restore before the slot can leave town, and Official reconnects retain the recovery
choice across reload. Active world-battle projections also retain semantic win-chat metadata across
reconnect while the portrait remains archive-local.

Arena `Utility.Escape` remains supported in v22 without converting it to a loss. The live browser
reproduces the native inherited-callback bug and remains on the torn-down state-6 battle after the
generic Retreat popup. Only reload/reconnect consumes the authority's recovery-only origin-town
projection; no ArenaLost chat, town-entry event, license change, or Tournament-style callback is
invented.

That public-scoreboard preference now has a consumer. `GET /api/game/scoreboard` (2026-08-08) is an
unauthenticated most-XP board: one entry per opted-in account, scored by the best of its three
slots, competition-ranked so ties share a place, capped at 50 entries, and served from a 30-second
cache. It reads persisted projections only and publishes nothing but rank, username, hero level, and
total XP — no player or slot id. In the client it fills in the source's own Master Menu
**Highscores** row, which had been left visibly disabled as a Game Center destination. That policy
is amended rather than broken: the row now reaches a real first-party leaderboard, **Achievements**
beside it stays inert, and offline and archive modes leave both disabled. See
`docs/save-system.md`.

Store Egg purchases, quest `egg`/`monsterEgg` rewards, and Tournament Egg prizes are authoritative
under that stack. V23 preserves Egg constructor and Casino RNG draws and source release-friction
arithmetic; earlier versions retain their immutable rules. The "requires the SlotMachine reducer" and "requires authoritative egg hatch
commands" throws are reachable only on a router-less v11 stack. What still fails closed online is
per-request domain validation rather than an absent feature: a prize outside its source-defined
domain (monster level outside 1–150, gold other than 50/150, silver other than 500/1500, an unloaded
recipe or Totem) is rejected instead of settled. External IAP is absent from both local and Official
play. A local save is never silently promoted to Official authority.

## Offline extension and developer tooling

The project also supports intentional user-authored changes to the baseline game. Full-trust v4
`.dibmod` JavaScript packages can load modules, intercept methods, extend imported data, supply
assets, and alter live UI and gameplay. Dependency/version constraints and ordering are resolved
at the content gate. Mod selection disables Official launch; after code runs, only a document
reload reestablishes a clean page realm. The authority never admits mod-authored state.

Examples include data overlays, new monsters and moves, a soul-stone item, pointer effects,
Devtools, and Realtime Combat. The latter changes scheduling to 50 TU/second, keeps ready allies
in FIFO order, and allows enemy actions during player indecision. These are mod behaviors. Examples and their individual validation limits are cataloged
in `examples/mods/README.md`; runtime and save-profile rules are in `docs/code-mod-api.md`.

The Fidelity Lab (`pnpm fidelity:lab`) manages local TouchHLE/web comparisons from matched saves.
It provides mirrored gestures, independent or synchronized live panes, overlays/wipes, pixel
comparison, checkpoints, recordings, and reviewed automated tasks. It is developer tooling,
separate from the distributed game and Official service. See `docs/fidelity-lab.md` for the
maintained launch workflow and evidence limits.

The browser shell also supplies contextual keyboard controls, persistent Options, safe-area and
orientation handling, and install/fullscreen support. See `docs/keyboard-controls.md` and
`docs/platform-shell.md`.

## Compatibility limits

- The Volcano Infinite Dungeon ("The Abyss") **is implemented**, offline, in
  Official play, and across native save import/export: best-floor tracking in profile schema v8,
  the `NewInfiniteMonsterSlot` tutorial and unlock banner, the recurring `Next bonus at floor: %d`
  corner label, and the best-floor party-capacity bonus. The only native step without a local equivalent is the
  GameKit `DIBlueInfiniteDungeon` score submission, reported as
  `leaderboard-platform-hook-unavailable` — the same treatment every platform-score site gets here.
- The platform shell publishes an installable landscape web-app manifest, keeps the Pixi host
  inside dynamic safe-area insets, and actively reconciles window/VisualViewport changes across
  orientation settling. The renderer observes that host so canvas size, letterboxing, and pointer
  mapping stay aligned after rotation. The **Fullscreen** action appears only where the browser can
  act or explain iPhone Home Screen installation; installed/no-capability no-ops are omitted.
  iPhone WebKit can still retain system status/home UI, depending on the browser and installation mode.
  Production builds cache a complete, integrity-checked engine version for offline startup,
  show readiness in the launcher, and defer updates until game windows close. Imported archives
  retain their separate local-cache/File API path. Authorized Chromium cold-start, archive
  recovery, save/battle and worker-update checks passed; physical iOS airplane-mode verification
  remains pending. See [offline setup and proof limits](offline-pwa.md).
