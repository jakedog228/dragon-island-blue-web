# Web keyboard controls

The port keeps every original pointer/touch control and adds a small web-native keyboard layer.
Shortcuts are contextual: only the active scene handles them, and a nested popup or sub-flow gets
priority over the screen beneath it.

| Context | Key | Action |
| --- | --- | --- |
| Title | Enter or Space | Continue through the normal title action |
| Credits | Escape, Enter, or Space | Return to the title |
| Save/erase screens | Escape | Close the top confirmation/options popup, or go back one screen |
| World or town | Escape | Open/close the Master Menu; inside an overlay, close/back one layer |
| Dungeon | Escape | Close/back one layer, or open/close the Master Menu |
| Dungeon | W / A / S / D | Move north / west / south / east through an available room link |
| Dungeon floor notice | Enter or Space | Advance the live text notice |
| Dungeon waypoint selector | Enter or Space | Confirm the displayed floor |
| Battle player turn | 1 / 2 / 3 / 4 | Activate the matching visible ability slot |
| Battle target picker or popup | Escape | Close the top popup first, then cancel targeting |
| Battle status text | Enter or Space | Advance the queued status page |

Arrow keys are intentionally not assigned. This avoids page-navigation conflicts and follows the
approved scope for the first keyboard pass.

The router ignores held-key repeats, modified shortcuts (Ctrl/Alt/Command), and input from editable
HTML fields. Keyboard actions call the same semantic callbacks as their visible controls, including
locked/blocked ability feedback, options reload handling, party-order commit, and target-picker
cleanup. They do not bypass confirmations or post-battle continuation callbacks.

Prepared opt-in browser checks are part of `scenario:world-menu`, `scenario:ability-info`,
`scenario:battle-end-audio`, `scenario:dungeon`, and
`apps/web/tests/browser/dungeon-waypoint.playwright.mjs`. As with all browser automation in this
repository, run them only with operator authorization and muted audio.
