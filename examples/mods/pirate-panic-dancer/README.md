# Pirate: Panic Dancer

An Offline mod that adds **Pirate**, a Water monster built from Giant
Turtle's exact natural stat progression, quality, rarity stars, and renderer scale.

Version 1.0.1 offers one Pirate-only golden Egg when absent from the party, bench, and
stored/equipped soul stones. New saves receive it after starter selection and before Leslie's
intro dialogue. Keep or Feed consumes the gift for that save, with no paid repeat. Requires the
updated client; companion saves are optional.

Pirate has no usable moves. His one passive, **Panic**, combines the engine's Berserk control
handoff with the native Easy Target taunt value. Whenever he receives an ordinary turn, the mod
queues the game's real `Utility.Dance` transaction (100 TU, no damage and no targets) instead of
letting the normal AI choose a move. Sleep, stun, confusion, death, queue advancement, haste, and
all unrelated monsters continue through the ordinary battle engine.

Before each dance, Pirate opens the real shipped chat presenter with `PirateMan.png` and one line
from a battle-scoped shuffled cycle. Every line appears once before the same cycle wraps. The
dialogue uses the presenter's native bold BMFont and `^#RRGGBB...^^` color spans. Each line also
declares a mild, medium, or strong whole-screen shake. After dismissal, a full-size clone of the
real Pirate sprite hops, spins, squashes, and throws package-drawn confetti while the normal Dance
status text and scheduler complete underneath it.

Tap/click anywhere to dismiss Pirate's dialogue immediately, including during the opening fade.
During the dance, another tap/click skips the animation and acknowledges its status line, so an
early tap is remembered instead of requiring a second click after the animation finishes. Without
input, the full dance still plays. Each tap advances only the current presentation.

## Assets

This package intentionally contains **no copied game art**. It requires `PirateMan-hd.png` in the
player-selected content archive and loads that archive-local sprite through `AssetLibrary`. The
same texture supplies the battle sprite, the source-style dialogue portrait, and a runtime-rendered
48x48 turn-order portrait. The confetti and dance shadow are Pixi vector graphics created by the
mod. If the selected archive lacks `PirateMan-hd`, the mod fails at content loading with a specific
compatibility error.

## Build and play

From the repository root:

```sh
pnpm mods:examples
```

Select a compatible IPA/ZIP and `examples/mods/dist/pirate-panic-dancer.dibmod`, choose Offline,
and launch. `examples/mods/dist/pirate-savefile0` is a native-format level-30 save for quick play.

The muted visual fixture is
`apps/web/tests/browser/offline-pirate-panic-dancer.playwright.mjs`. Browser execution remains
operator opt-in. It captures the real chat portrait and the subsequent dance, then checks several
turns for a no-repeat dialogue cycle, immediate dialogue dismissal, and early dance skipping.
