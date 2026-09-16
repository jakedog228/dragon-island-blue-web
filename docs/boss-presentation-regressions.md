# Boss presentation regression checks

In the source repository, focused browser checks ran on 2026-09-16 against an isolated v24 authority service and an
operator-owned original archive. Chromium was muted; captured frames were inspected.
Those checks have not been rerun against this public checkout. The fixtures below are ready for manual verification.

## Enemy move effects

Import `enemyInstanceEffectFixtures` and `installEnemyInstanceFixture` from
`apps/web/tests/browser/fixtures/enemy-instance-effects.mjs`. Before navigating, call
`page.addInitScript(installEnemyInstanceFixture, enemyInstanceEffectFixtures.LightDragon)`.
Select the archive and start standalone combat. Advance deterministic time in short bursts and
inspect `render_game_to_text()`, console errors, and screenshots around the first enemy impact.
Seed 4 (including the browser's opening music RNG draw) selects `usable4`: MetalSlash must show MetalCut. Repeat with FireDragon: ManEater must
show DoubleBlackHardClaw. Neither may use usable1's BlueHardClaw. Damage and turn order are unchanged.

The neighboring startup fixtures remain in `fixtures/overlord-startup.mjs`: both bosses must
reach a usable player turn with special field art and species portraits.

## Official reconnect

Use matching v24 web/server revisions and an isolated test account with its own game state directory.
Through normal gameplay, enter Arkanis or Quetzalcoatl, then reload while awaiting a player move.
Expected: Arkanis retains MegaDragon art, Quetzalcoatl retains GreenDragon art; their names and
FireDragon/LightDragon portraits remain correct. HP, queue, and available commands remain those
of the committed replay. Repeat after one completed command, including an idempotent retry.

Repeat for Fafnir in Volcano floor 100 and Volcano Infinite floor 220: BlackDragon field art,
BoneDragon portrait, and Fafnir name must survive reload. Also reload after a retreat/Save Me
has persisted surviving enemies, then re-enter; current and cached room rosters must restore.
No test may promote a client-authored save into Official authority.

Automated non-browser coverage lives in `battleAppearance.test.ts`, `preloadPlan.test.ts`,
`battleNode.test.ts`, engine `session.test.ts`, authority `officialGame.test.ts`, and server
`fileSlotStore.test.ts`. It covers all 15 named world encounters, both Fafnir definitions,
mechanical-state preservation, repeat species, survivor alignment, migration, and receipt replay.

## Focused run scope

Passed: MetalCut and DoubleBlackHardClaw exact effect labels; Arkanis/Quetzalcoatl startup;
Official initial reconnect for both world bosses and both Fafnir definitions; a browser-selected
attack followed by reload for Arkanis and Fafnir floor 100. HP, effective stats,
queue, available moves, names, special field sprites, and species portraits were checked.
Idle animation phase and temporary rarity stars are intentionally transient across reload.
Survivor/cached roster alignment and idempotent receipt replay also have unit coverage.

## Browser findings corrected before release

The server resource adapter now removes encounter `extraLivingArguments.rendererData` before
constructing its rules. Historical migration still validates against the original source, then v24
removes those dictionaries from persisted active and cached encounters. Current v24 parsing rejects
them. Names and mechanical arguments remain unchanged; the browser resolves artwork locally.
Real Arkanis, Quetzalcoatl, and both Fafnir definitions cover this boundary in the authority tests.

Official dungeon restoration explicitly uses the authority's pinned historical generation rules.
Using Offline's current generator produced different room identities on Fafnir floors and blocked
reconnect before artwork could be restored. The strict room/roster validation remains enabled.
The Fafnir unit fixtures now use those authoritative rules, including materialized survivor and
cached rosters, instead of testing only Offline generation.
