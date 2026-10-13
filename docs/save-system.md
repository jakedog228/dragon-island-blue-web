# Player state, save slots, and authenticated persistence

Last updated: 2026-10-05

## Supported modes

Dragon Island Blue supports two persistence modes:

| Mode | Authority | Persistence |
| --- | --- | --- |
| Offline | Browser | Paged, named browser-local saves |
| Online | `apps/game-server` | Command-derived authoritative slots |

The former client-authored `/api/saves` snapshot service has been retired. Official online never
accepts a player-state document, state diff, random seed, outcome, reward, or caller-created
durable ID. Existing browser-local saves remain readable, including their schema and content-
fingerprint migrations; they are not promoted into official trust.



### Development-only Scenario storage

The Vite development client adds a third, non-persistent `Scenario` choice to the archive gate.
It is a debugging launcher rather than another trust tier or save backend:

- Egg spinning starts a rich town fixture and opens a Silver or Gold reel.
- Arena starts a qualified, funded party in a town and opens the license menu.
- Fixed combat starts either the six-on-six reserve fixture, a starter-dragon duel, or a seeded
  random roster without entering the world.
- A fixed unsigned seed makes the party/encounter reproducible; `Randomize on each load` chooses a
  fresh seed.
- `Offline` resolves its in-memory save boundary immediately. `Online simulation` adds an
  asynchronous 80 ms boundary so latency-sensitive presentation can be exercised. It is not
  Official authority and performs no HTTP request.

`ScenarioSaveStore` owns one immutable fixture slot. Loads return defensive copies; autosave and
flush calls deliberately discard their inputs. It does not wrap or delegate to
`BrowserSaveConnection`, `OfficialAuthoritySaveStore`, IndexedDB/localStorage, backup import/export,
or `apps/game-server`. Returning to the main menu rebuilds the initial fixture, and a document
reload loses both the selected archive and the entire Scenario state.

The selector and configuration markup are guarded by `import.meta.env.DEV`; production builds have
no Scenario storage control. The prepared, opt-in muted browser matrix is:

```powershell
pnpm --filter @dib/web dev
# In another terminal, with DIB_CONTENT_ARCHIVE pointing at an operator-owned compatible archive:
pnpm scenario:storage
```

## Browser-local state

Player state is owned above scenes by `PlayerRuntimeState`. Battle, world, renderer, and storage
receive narrow interfaces or JSON snapshots; none owns a second roster/profile copy. The versioned
root is `PlayerGameStateSnapshot` (`apps/web/src/player/gameState.ts`):

- `player`: profile and party domains;
- `world`: optional current world/POI, per-refresh occurrence/completion caches, POI win counts,
  and permanent completion registration; and
- `quests`: optional Guild/story state containing objective progress, dialogs, fixed-encounter
  completion keys, and received battle-reward keys.

Offline settings presents one ordered library in pages of three. The selected page supplies the
existing in-game three-slot picker; Online retains its own three authoritative slots. Players can
add pages, jump directly between pages, and click a save's name to edit it in place. Enter or
the checkmark saves the name; Escape or cancel discards the edit. **Manage** opens the move,
undo and delete controls. **Move save** applies the chosen destination; intervening slots shift.
Names affect
only the settings list and export filename. Imports adopt the filename and carry unknown mod
history because the native file does not contain that information.

`OfflineSaveLibrary` stores an index at `dib.offlineSaves.v1`: stable record addresses, labels,
last-used ordered mod digests/names/versions, last content identity, and the selected page.
New records use UUID-backed `offline-library:` namespaces beneath the existing `dib-save-v1`
prefix. The snapshot parser, defensive copies, ordered writes, revision conflict checks and
one-generation undo remain in `BrowserSaveConnection`. Sessions capture their record address,
so moving a slot in another tab cannot redirect an ongoing autosave.

Migration indexes every old `dib-save-v1:<namespace>:slot-1/2/3` group, including previously
hidden profiles and v1-v6 content identities, preserving original slot positions and gaps.
It does not rewrite, promote, deduplicate, delete or move live/rollback bytes. Existing profile
metadata supplies the best available previous mod selection; missing metadata is shown as
unknown. Unreadable records remain visible without blocking other slots. An invalid index or
failed index write fails explicitly and preserves saves. Reopening also discovers saves written
by older clients. The old content-bound helper retains its historical eligibility rules for
legacy callers; production Offline paging uses explicit stable addresses instead.

Changing mods, their order or effective content no longer selects a different set of saves.
Each occupied slot warns if the selected ordered package digests differ from its last played
selection, if previous mods are unknown, or if its content identity differs. Warnings stay compact; **View setup** expands a bounded comparison with added, removed and
updated mods in load order. Warnings are advisory: the player is responsible for compatibility. Browsing, exporting and switching pages do not change
history; actual play does. Imports and rollback reset history to unknown. Missing optional items,
recipes and spirits retain the existing restore behavior, while essential missing data fails loudly.
Deleting a save removes its live and retained rollback record after confirmation; its position and
label remain available for a new game. A rollback becomes the next undo point as before.

The compressed last-used archive lives in a separate disposable IndexedDB cache. A quota-blocked
slot write clears that cache and retries once before reporting failure; automatic pressure handling
never deletes save records. Native export remains the independent backup.

Local Collection parses the v7-bound `Collection.plist` catalog and persists one-shot
`claimedCollectionGoalIds`. Official v12+ stores claims as a strict aggregate sibling and accepts
only semantic `collection.claim`; v14 is the current simulation. Fixed `egg` and `monsterEgg`
Collection rewards route through the owned local or authoritative hatch continuation, while
supported rewards preserve claim-before-generation.

The current player-profile snapshot is schema v8. In addition to the v6 inventory/skill/Tournament
surface, v7 corrected `hero.totalHighestLevels` to collapse evolution chains and v8 added Infinite
Dungeon best-floor progression and derived batting-order capacity. It stores independent durable usable-item, Gem,
and legacy-egg identities, four license Gem slots, the seven-step license type, and all six
allocated hero skills, plus Tournament index/round/status/last-attempt progress. Earlier
capture-card counters and encoded reward-bag keys migrate one way into the identity-backed
inventory; equipped Gems remain distinct from the loose collection. Dropping, equipping,
unequipping, skill changes, Tournament round results, and prize claims checkpoint through the same
aggregate listener as party/economy changes.

The containing `PlayerRuntimeStateSnapshot` is schema 2 and stores sorted, one-shot
`claimedCollectionGoalIds` separately from the profile. Profile-schema migrations remain
independent of the Offline list and historical fingerprint lineage.

## Save files

Export and import use the original game's own save file, not a port-specific envelope. A file is
the plain `bplist00` dictionary the original game writes. Offline exports use
the save's assigned name; Online uses `savefile0`, `savefile1` or `savefile2`. Rename a named export
to one of those source filenames before placing it in a TouchHLE sandbox's
`touchHLE_sandbox/jp.ne.goo.game.dragonislandblue/Documents/`, and a save made there imports here.
The exact captured-save regression corpus is intentionally opt-in because that directory is live,
operator-owned game state: set `DIB_NATIVE_SAVE_FIXTURES=1` only with the original three-save fixture
and its matching `.bak` files. Normal `pnpm test` still exercises the synthetic codec/import/export
coverage without treating a player's current saves as immutable test data.
This replaced the former JSON `dib-save-backup` format outright.

`player/nativeSave/` is three layers: `binaryPlist.ts` is a bounded plist codec (integers and reals
stay distinct, dictionaries decode to `Map` so a hostile key cannot reach a prototype, and size,
depth, object-count and string-length are all capped); `nativeSaveDocument.ts` validates the ten
root sections and the `Renderable` record shape without interpreting any identity; and
`nativeSaveTranslate.ts` resolves every species, item, recipe and POI against the loaded archive.

Because the format has no envelope, there is nowhere to stamp a slot id, a revision, or a content
fingerprint. Compatibility is checked by resolving the save instead, which names the offending
species or item rather than reporting a digest mismatch, and accepts a save from any archive that
still defines the same content. The importer always asks which slot to write.

Known one-way conversions, all reported as warnings at the time they happen:

- **Current HP is not stored.** `-[Living loadFinishedWithRootParent:] @ 0x84d14` sets `hp = MaxHP`,
  so an imported party is healed through `fullRestoreAndReapplyPermanentBuffs` and an export writes
  no HP. A knocked-out monster comes back alive, in both directions.
- **Gold is a ledger.** `goldAvailable = GlobalSavedData.goldPurchased + goldFound - goldSpent`, and
  `goldPurchased` lives in a separate per-install settings file. Import uses the save's own ledger;
  export writes the whole balance as `goldFound` with `goldSpent` 0, so a device with previously
  purchased gold adds that amount on top.
- **Per-trip state is not saved by the original either.** Refresh occurrence rolls, spirit energy,
  and spirits summoned this trip appear in no section and restore empty.
- **An in-progress dungeon run and unclaimed treasure have no section**, so an export made inside a
  dungeon resumes in town.
- **Sections the port does not model** (`options`, `variables`, `props.sparklesNeeded`,
  `monstersSeen`, `analyticsKeys`, `dealsSeen`, `dealsBought`, `infiniteHighestLevel`) are named on
  import and omitted on export. `-[UserSavedData loadFromFile] @ 0x92248` nil-guards every section
  read and `populateDefaults @ 0x92b80` refills `dungeonMod`, `questProgressData`, `spiritsData`,
  `activeQuests` and `finishedQuests`, so a file missing them still loads in the original game.
- **`props.visitedTowns` loses its chronology.** `+[Player recordTownVisit:] @ 0x8d920` appends in
  visit order and only reads the array back with `containsObject:`; the port's snapshot is
  canonically sorted, so import sorts and export writes sorted. Membership, which is all either game
  reads, is preserved.

Everything else round-trips exactly, including `JobLevelProp`: `-[Job levelAsDouble] @ 0x81038` and
its inverse in `-[Job loadFinishedWithRootParent:] @ 0x80dd0` reproduce each shipped save's stored
doubles bit-for-bit (`apps/web/tests/nativeSave.test.ts`).

The hero level an imported save resumes at is derived, never read from the file:
`-[UserSavedData sumHighestLevels] @ 0x94444` collapses each evolution chain to its highest
registered stage, and `-[HeroData currentLevelWithUserSavedData:] @ 0xdbc1c` reaches a level only
once its threshold is *passed*. Both rules are reproduced exactly , so `props.lastSavedLevel` round-trips on every save the game
itself wrote. A `hero-level-mismatch` warning names both numbers when a file disagrees — which a
save editor's output can, since the game only ever writes `savefile<N>`.

The batting order is likewise derived, from
`license + heroData.battingOrderSizeBonus + heroLevel / 3 + infiniteHighestLevel / 10`
(`-[Player battingOrderSize] @ 0x8b5b0`). The port has no Infinite Dungeon, so that last term is 0
and an imported save loses whatever slots its Infinite Dungeon depth was worth.

## Official online slots

Official slots are fresh, server-created, and pinned to one immutable `logicPackId` and
`simulationVersion`. The browser sends typed actions while `apps/game-server` derives mechanics,
randomness, economy, IDs, and settlement. The server stores a private aggregate and exact
idempotency receipts in `.dib-game-data/` by default. Slot files are namespaced beneath
`authoritative-slots/` by logic pack, simulation, and installed world. Matching legacy
`players/<player>/<slot>.json` files remain readable and are copied into the namespace on the next
mutation; ordinary migration does not delete the legacy file.

Official projections expose the same structured inventory/license/skill state for browser
reconstruction. Inventory, Gem, skill, and store mutations are typed commands; purchase price,
stock identity, random Gem stats, and resulting balances are derived by the reducer rather than
accepted from the browser. Arena license challenges are also intent-only: the server derives the
next license and its authored encounter, checks qualification, and upgrades the durable license
only after authoritative victory settlement.

Tournament progress is present in the shared projection for lossless reconstruction, and official
Tournament battle/claim flow is supported when the pack advertises `tournaments`. Tournament claim
still uses a pending-egg continuation (`tournament.claimPrize` then `tournament.settlePrize`) where
the local browser presents the non-authoritative egg flow before advancing.

The selected archive never reaches the server. The browser computes the shared `logic-v1` identity;
the operator independently compiles and installs matching mechanics from extracted data.

Each player has `slot-1`, `slot-2`, and `slot-3`. Revision and decision IDs gate mutations, one slot
has one serialized writer, and retrying the same command ID/body returns the exact committed result.

## Token-gated access

An Official online session needs a login token. There are two ways to hold one, and both write the
same durable registry, `.dib-game-data/invites.json`, which stores only
`HMAC(secret, "player\0" + token)` — never the raw token.

**Self-service.** The content gate offers "Create account" whenever the server reports
registration open. The player picks a username and whether to appear on public scoreboards; the
token is shown once, auto-filled into the login field, and authenticated against the selected
archive. The throttle is one account per client
address per five minutes, and `DIB_GAME_MAX_ACCOUNTS` caps the registry. Operators close it with
`DIB_GAME_REGISTRATION_ENABLED=0`, which stops new registrations without locking existing accounts
out of their settings. The scoreboard preference is server-owned and is edited later from the
in-game menu under **Options → Scores**, not from local port settings.

**Operator-issued.** `pnpm game:cli invite` still mints a token directly, optionally with
`--username <name>` to give it an account record too.

```powershell
# Canonical command
pnpm game:cli invite "my laptop"
pnpm game:cli invite:list
pnpm game:cli invite:revoke <player-id>

# Compatibility alias for the previously documented operator command
pnpm save:cli invite "my laptop"
```

The running server reloads the registry for each session login, so invite and revoke changes affect
new logins without a restart. Already-issued bearer sessions remain valid until their two-hour
expiry. `DIB_GAME_INVITE_TOKENS` can additionally authorize comma/space-separated tokens in memory
for one run.

The HMAC secret is load-bearing configuration. Keep it outside the repository and retain it across
restarts. Provide `DIB_GAME_HMAC_SECRET`, or put the value in the gitignored root `hmac.txt` (or
point `DIB_GAME_HMAC_SECRET_FILE` elsewhere).

Tokens issued by the retired `.dib-save-data` registry are not Official online credentials. Reissue
them once with `game:cli`/`save:cli`; legacy player-state snapshots are neither imported nor trusted.

## Local operation

Install compatible rules data first. From `tools/`, run:

```sh
python -m dib_extract data --ipa /path/to/game.ipa
```

The default rules directory is `extracted/data`; `DIB_GAME_EXTRACTED_DATA` selects another
location. Browser-selected archives do not install server rules.

Terminal 1:

```powershell
$env:DIB_GAME_HMAC_SECRET = '<at-least-32-byte-random-secret>'
$env:DIB_GAME_DATA_DIR = '.dib-game-data' # optional
pnpm game:cli invite "my laptop"
pnpm game:dev
```

Terminal 2:

```powershell
pnpm --filter @dib/web dev
```

Vite proxies `/api/game` to `127.0.0.1:8788`. Choose the matching archive, select **Online**, paste
the issued token, and press **Log in**. The gate reports the authenticated username (or confirms an
operator-issued token), then enables usage-rights confirmation and **Play Online**. Editing the
token, changing the archive, or changing storage mode clears that authenticated state. **Offline**
is an explicit choice rather than a preselected default and performs no API request. The settings
button beside Offline exposes local export/import/rollback recovery controls, in the native
`savefile<N>` format described above. Online settings are strictly read-only: each occupied slot can
be exported, but the panel cannot import, roll back, or erase server-owned slots. The Online startup
save selector also omits the erase route.

`start-dev.cmd` starts only the web client. Use `start-dev.cmd --online` to also start the
authoritative service when an HMAC secret is available. Offline requires no API; the client
disables Online when its readiness check finds no ready server. Refresh after starting the API.
The Vite proxy may log `ECONNREFUSED` when no API is running; that does not prevent Offline play.

## Verification

Tests requiring game data run when `extracted/data` is present; other tests run without it.
The ordinary suites cover strict local-state parsing/migration and the authoritative protocol,
service, invite registry, restart persistence, retries, and privacy boundary:

```powershell
pnpm test
pnpm typecheck
pnpm content:boundary
```

The opt-in muted browser contract is `pnpm scenario:official-online`. Its setup and environment
variables are documented at the top of
`apps/web/tests/browser/official-online.playwright.mjs`.
`pnpm scenario:official-dungeon` additionally drives a fresh semantic-command route to North Cave,
proves live Official world-to-dungeon entry, reloads the exact committed room topology, and checks
that the route battle's server-awarded item reaches the reconstructed browser profile.
