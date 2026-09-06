# Realtime Combat

Select `examples/mods/dist/realtime-combat.dibmod` alongside your resource archive and choose
Offline. Build the archive with `pnpm mods:examples`. Loading the package enables the mod for
every new battle; remove it and reload the page to return to ordinary combat.

- Every 20 ms of active battle time consumes 1 TU (50 TU/second), including while selecting
  moves, targets, capture cards or viewing information. Initial delays and haste-adjusted move
  costs come from the normal engine. Reserves begin their countdown when they enter the field.
- Enemies act as soon as ready. All allies share one readiness FIFO, including Berserk monsters,
  allied spirits and status-forced turns. An automatic ally chooses its own move only when it
  reaches the front, after the preceding choice/script finishes. Ties retain queue order.
  Waiting does not bank negative TU or shorten the next move's cooldown.
- Mechanics resolve in a deterministic sequence at the readiness timestamp. Attack effects,
  spotlight, death and queue animations overlap. The Devtools no-battle-delay behavior is built
  in; Devtools is not required, and its speed-up does not change the 50 TU/second combat clock.
  Decorative effects ignore pointer input so attacks cannot block the move cards beneath them.
- Poison and status expiry use the same TU clock. Deaths, captures, switches and summon
  replacement immediately remove old readiness. The engine promotes reserves normally. Invalid
  move/target selections close and the next valid ready friendly is prompted. Capture cards are
  spent only when a still-valid capture commits.
- Combat stops on victory, defeat, retreat or scene disposal. Hiding the browser tab suspends
  combat; returning does not fast-forward through the time hidden. Zero-cost custom abilities
  can activate at most once per tick.

This is an intentional Offline rules conversion using v4 full-trust reflection, not a fidelity
change to the engine or an Official capability. It bundles no game assets and adds no save fields.
It targets the current `BattleSession`/`BattleNode` implementations, including their internal
queue, status and display-construction methods; those are not a stable third-party API.

Load Realtime Combat **after your character mods**. The manifest has no conflict exclusions,
declares after-edges for Inferno Barrage, Leslie, Pirate, Cat, Sukuna and Devtools, and defaults to
priority 1000. For other packages, keep Realtime last in the load-order editor.

The current engine's generic `interceptBase` hook lets Realtime replace the underlying battle
loop without discarding earlier character wrappers' setup/cleanup. Committed HP, statuses,
wallet changes, deaths and reserve construction are reconciled once, independently of a mod's
dialogue, preload or animation promises. The mod's effects still run through its own wrappers;
late presentation cannot replay a death or spend money again. A human-directed scripted move
keeps its aiming input until completion, while enemies and TU continue and other friendly
readiness remains FIFO. Stale scripted targets are filtered, and a dead caster cannot keep dealing
damage. Devtools' delay and speed settings can coexist. This version requires the updated engine
runtime containing `interceptBase`; rebuilding only the ZIP against an older engine is insufficient.

Verification:

```powershell
pnpm --filter @dib/web exec vitest run tests/realtimeCombatMod.test.ts tests/realtimeCombatCompatibility.test.ts
pnpm mods:examples
# Against a fresh strict Vite server, with your original-format archive:
$env:DIB_WEB_URL = 'http://localhost:5189'
pnpm scenario:realtime-combat
$env:DIB_DISPLAY_MODE = 'ipad'
pnpm scenario:realtime-combat
# Standalone Berserk FIFO regression (unset companion mods first):
$env:DIB_REALTIME_BERSERK_QUEUE = '1'
pnpm scenario:realtime-combat
Remove-Item Env:DIB_REALTIME_BERSERK_QUEUE
# Co-load the character packages (paths separated by semicolons); no browser run is automatic:
$env:DIB_REALTIME_COMPANION_MODS = 'examples/mods/dist/pirate-panic-dancer.dibmod;examples/mods/dist/cat-berserk-dancer.dibmod;examples/mods/dist/leslie-circle-caster.dibmod'
pnpm scenario:realtime-combat
```

The muted browser scenario checks the live 50-TU/second rate, queued friendly choices, enemies
attacking during player indecision, real pointer selection, death cancellation, reserve
promotion and terminal clock shutdown. Screenshots and state are written to
`output/realtime-combat/iphone/` and `ipad/`. Engine tests also cover per-frame rounding, haste, status expiry,
poison, reflection, switches, summons, same-tick lethal ordering and full reserve battles.
The compatibility update has unit/runtime coverage, including the actual character scripts,
but has not been browser-run. The co-load smoke route checks that TU and enemy actions
continue while allies share one readiness FIFO; inspect the `co-load` screenshot and state.
The Berserk FIFO route holds Fire Cub's choice while Yeti waits at zero, then submits a move
and checks Yeti takes the next turn. Inspect `berserk-waits-in-line` and `berserk-takes-next-turn`.
