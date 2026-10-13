# Executable offline mod examples

These `.dibmod` overlays contain JavaScript. They are selected alongside an operator-owned
compatible Dragon Island Blue resource archive and run only in Offline/scenario play.

Pirate now offers one guaranteed golden Egg on loading a save that lacks that character in its
party, bench, or stored/equipped soul stones. On a new save, character Eggs run after starter
selection and before Leslie's intro dialogue, one at a time in mod order. Keep or Feed consumes
the gift permanently for that save; already owning the character also consumes eligibility.
Ordinary golden-Egg levels apply and paid repeats are disabled. Companion saves are optional.
Use the updated client and rebuilt packages. Opt-in browser proof (not part of `pnpm test`):
`node apps/web/tests/browser/character-eggs.playwright.mjs`; set `DIB_EGG_DISPLAY_MODE=ipad` for
the experimental tier. Expect the gift hatch before dialogue, and none on a second load.

- `blue-dragon-overdrive` replaces imported monster data through `content:loaded`.
- `realtime-combat` changes battle scheduling to 50 TU/second, with immediate enemy actions,
  FIFO friendly readiness and overlapping animations. It includes no-battle-delay behavior,
  advances statuses on the same clock, and removes dead/switched actors before they can act.
  Load it after character mods; see its README for co-load semantics and the muted browser scenario.
- `fire-cub-inferno-barrage` is the complete Inferno move in one external package, with its original
  per-strike damage coefficient reduced to 0.06 (one-third below the previous 0.09). It adds
  one copy to the first empty `usable1`...`usable4` slot of every monster whose resolved moveset is
  incomplete, runs twenty 200ms strikes, and drives existing battle effects by intercepting generic
  engine and `BattleNode` methods. Aiming is a ring that follows the pointer or finger for the
  length of the move: each strike hits whichever enemy sits nearest the ring's centre, and falls
  back to the engine's random pick when the ring holds none. Defeated targets remain under the ring
  until the barrage ends; subsequent strikes show the normal animation and deal zero damage.

- `pirate-panic-dancer` adds Pirate as an independently selectable monster. Pirate copies
  Giant Turtle's Water stat progression and stars, has no usable moves, and combines the native
  Berserk control flag with a natural taunt. Every ordinary turn opens the real dialogue popup
  with the archive's own `PirateMan-hd.png`, advances a battle-randomized no-repeat panic-line
  cycle, shakes the whole screen according to the line, and then performs a package-animated
  version of the real zero-damage `Utility.Dance`. The package contains no copied game art; a
  compatible level-30 save is copied as `dist/pirate-savefile0`.


- `devtools` adds an external **Devtools** action to the master menu and owns a separate control
  panel. All modules start disabled; its persisted toggles can remove battle delays, run the central
  Pixi ticker at 3x, make every overworld location traversable while revealing every dungeon room
  *and letting the player walk to the revealed ones*, and set ordinary shop-goods prices to zero.
  **Fixed / Quest Encounters** is a session-only toggle: subsequent moves reactivate the fixed
  candidate in each destination's current encounter tier, bypassing trip completion, unique/quest
  eligibility, appearance chance and cadence. Encounters remain at their authored locations; ordinary
  locations retain normal checks. Turning it off or reloading restores eligibility. Battle outcomes
  and rewards still save normally. No game module knows the package exists.
- `mercy-stone` adds a whole new ITEM. It overlays one `Items` soul-stone leaf, bakes its atlas
  frames from the shipped art, sells itself in the town Shop for 100 silver, is equipped through
  the ordinary Insert Soul Stone picker, and stops its holder from ever landing a killing blow —
  announcing each spared life with a blue "Mercy!" floater in the shipped call-out slot.
- `wand-pointer-trail` adds a presentation-only sparkle trail for streams and recordings. It emits
  while the primary mouse button, a finger, or a pen is held on the game canvas, follows drags,
  keeps a bright wand tip visible during a stationary hold, and lets the existing sparkles fade
  briefly after release. While the mod is active, every shared Options popup gains a persisted
  **Trail** slider from 0.50x to 5.00x that changes both particle radius and density immediately.
  Its passive DOM listeners and non-interactive Pixi overlay do not claim game input.

No example uses a feature-specific mod endpoint. The same reflection, module loading,
lifecycle, file, and service primitives apply to battle, world, UI, save, renderer, and future code.

Selected together, these packages genuinely overlap: `devtools` and `fire-cub-inferno-barrage` both
intercept `BattleNode.renderGameState` (they compose, each adding its own `codeMods` key), and
devtools owns the `BattleNode.sleep` that the barrage paces itself with. `fire-cub-inferno-barrage`
therefore declares `optionalDependencies` and `loadAfter` on devtools, honours its delay-free
setting, and reports a measured `realElapsedMs` beside the scheduled `elapsedMs`. The Mod
Manager's Load order tab shows the resolved activation order and every shared seam; see the
"Managing multiple mods" section of `docs/code-mod-api.md`.

Build deterministic selectable archives from the repository root:

```sh
pnpm mods:examples
```

This writes `examples/mods/dist/*.dibmod`. Select a base IPA/ZIP at the content gate, open the
Mod Manager under it, import the mod files (or install the curated ones from Browse, below), apply,
choose Offline, and launch. The launcher warns because v4 code runs directly in the app page with
full client access. Only trusted mods should be loaded. Official online rejects all local mod
profiles.

A `listing.json` puts an example in the curated Official catalog, which `pnpm mods:examples`
writes to `dist/official/` (`start-dev.cmd` serves it locally through `pnpm mods:catalog`): `title`,
an optional `author` credit (otherwise the listing is by DIB Web), a one-line `summary` for cards,
`description` and `tags` (`Work in progress` flags an unfinished mod everywhere). The catalog is
Wand Pointer Trail, Realtime Combat (WIP), Mercy Stone, Less Rare Monsters (by wolfs0) and
Devtools; the other examples are still built into `dist/` for import. Gameplay screenshots are
generated, never committed, because they show the original game's art: `pnpm mods:screenshots`
captures `screenshots/<name>.png` for the catalog from your own IPA (opt-in, muted Chromium), and
`pnpm mods:examples` copies them into `dist/official/` and lists them.

See `docs/code-mod-api.md` for the manifest, lifecycle, runtime module catalog, generic
interception, bundle files, and shared service registry.
