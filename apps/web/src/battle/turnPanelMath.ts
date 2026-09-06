


import type { Targeting } from "@dib/engine";
import type { Rect } from "@dib/renderer/scale9Math";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import {
  idiomPairPt,
  screenPointsForMode,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";
import { SCREEN_H } from "./displayShared.js";


export interface RawTargetPicker {
  enemyTargetsNeeded?: number;
  allEnemies?: boolean;
  friendlyTargetsNeeded?: number;
}


export function abilityIsSwipeable(tp: RawTargetPicker | undefined): boolean {
  if (!tp) return false;
  if (tp.enemyTargetsNeeded !== 1 && tp.allEnemies !== true) return false;
  return (tp.friendlyTargetsNeeded ?? 0) === 0;
}

/** Adapter from `@dib/engine`'s `Targeting` (the shape `PlayerChoice.targeting` actually carries)
 *  to `RawTargetPicker`, then delegates to `abilityIsSwipeable` — the single source of truth for
 *  the real predicate stays the function above; this only translates our narrower union into its
 *  input shape. This is what `monsterTurnPanel.ts` calls for a real `PanelChoice`. */
export function swipeableFromTargeting(targeting: Targeting): boolean {
  switch (targeting.kind) {
    case "self":
      return abilityIsSwipeable({ enemyTargetsNeeded: 0, allEnemies: false, friendlyTargetsNeeded: 0 });
    case "enemies":
      return abilityIsSwipeable({ enemyTargetsNeeded: targeting.count, allEnemies: false, friendlyTargetsNeeded: 0 });
    case "allEnemies":
      return abilityIsSwipeable({ enemyTargetsNeeded: 0, allEnemies: true, friendlyTargetsNeeded: 0 });
    case "friends":
      return abilityIsSwipeable({ enemyTargetsNeeded: 0, allEnemies: false, friendlyTargetsNeeded: targeting.count });
    case "allFriends":
      return abilityIsSwipeable({ enemyTargetsNeeded: 0, allEnemies: false, friendlyTargetsNeeded: 1 });
    case "mixed":
      return abilityIsSwipeable({
        enemyTargetsNeeded: targeting.enemyCount,
        allEnemies: targeting.allEnemies,
        friendlyTargetsNeeded: targeting.allFriends ? 1 : targeting.friendlyCount,
      });
  }
}

// --- slot <-> swipe direction (followup-layout.md §4.1/§4.2 + strokeGrid.ts's BATTLE_STROKES) ---

export type SwipeDirection = "leftToRight" | "rightToLeft" | "upToDown" | "downToUp";


export const SWIPE_DIRECTION_BY_SLOT: Readonly<Record<1 | 2 | 3 | 4, SwipeDirection>> = {
  1: "leftToRight",
  2: "rightToLeft",
  3: "upToDown",
  4: "downToUp",
};

/** `${slotSwipe}.png` (followup-layout.md §2.1c: `"%@.png"` format string) — asset-manifest key
 *  (loose sprite, `-hd` suffix per this port's convention, e.g. "leftToRight-hd"). */
export function swipeSpriteKey(direction: SwipeDirection): string {
  return `${direction}-hd`;
}

/** `"usableN"` -> `N` (`JobAbilityRef.slot`'s string key format, confirmed against every
 *  `Jobs.json` leaf — `session.ts`'s own `/^usable\d+$/` gate). This is exactly `ability.slot`
 *  (turn-panel.md §2/§9: the panel loops `i_1` 1..4 and matches `UsableAbility.slot == i_1`) —
 *  the job dictionary's `usableN` naming IS the slot assignment, not a separate ivar this port
 *  has to guess at. Throws on a shape session.ts itself would never produce (fail loudly rather
 *  than silently mis-slot a card). */
export function slotNumberOf(refSlot: string): 1 | 2 | 3 | 4 {
  const m = /^usable([1-4])$/.exec(refSlot);
  if (!m) throw new Error(`turnPanelMath.slotNumberOf: not a 1-4 usable slot: "${refSlot}"`);
  return Number(m[1]!) as 1 | 2 | 3 | 4;
}

// --- TU-cost label (followup-layout.md §2.1d) ---

/** `[NSBundle localizedStringForKey:value:table:]("ActivationLengthKey")` -> en `"TU"`, formatted
 *  `"%@:%d"` with `ability.activationLength` -> exactly the on-screen `"TU:130"`-style label.
 *  English-only, matching every other un-localized label format in this port (e.g.
 *  `formatTimeDelay`, `formatBarFraction`). */
export function formatTU(activationLength: number): string {
  return `TU:${activationLength}`;
}

// --- Locked ("???") slot algorithm (turn-panel.md §2a) ---

export interface LockedSlotOpts {

  unknownSkillsLeft: number;
  /** `monster.evolveType` (see file header) — `!= 0` overrides the counter to 999, i.e.
   *  "effectively always show '???'". Defaults to 0 (no override). */
  evolveType?: number;
}

/**
 * `label_9f5ea` (turn-panel.md §2a): loop slot 1..4; a decrementing counter starts at
 * `unknownSkillsLeft` (or 999 if `evolveType != 0`); for each slot with NO matching ability
 * (i.e. not in `occupiedSlots`), IF the counter is still `>= 1` it renders "???" and the counter
 * decrements — once the counter is exhausted, any further un-occupied slot renders NOTHING (no
 * card at all, not even a "???" one). Slots already covered by a real ability are untouched by
 * the counter regardless of position. Returns the slot numbers (1-4, ascending) that should
 * render the "???" placeholder.
 */
export function lockedSlotNumbers(occupiedSlots: readonly number[], opts: LockedSlotOpts): (1 | 2 | 3 | 4)[] {
  const occupied = new Set(occupiedSlots);
  let counter = (opts.evolveType ?? 0) !== 0 ? 999 : opts.unknownSkillsLeft;
  const locked: (1 | 2 | 3 | 4)[] = [];
  for (const slot of [1, 2, 3, 4] as const) {
    if (occupied.has(slot)) continue;
    if (counter < 1) continue;
    locked.push(slot);
    counter -= 1;
  }
  return locked;
}

// --- Swipe zone Y-axis flip (deferred from Task 7 — see strokeRecognizer.ts's own "Y-axis note") ---

/**
 * `strokeGrid.ts`'s `gridSequence` is documented to run in "POINTS space, Y-up" (its own header:
 * columns left-to-right, ROWS BOTTOM-UP — `followup-layout.md` §S1: `^852$` = "upToDown" ⇒ digit
 * 8 = top-middle, consistent with a stroke that starts at the top and descends). `gridSequence`'s
 * formula (`digit = col+1 + 3*row`, `row = floor((p.y - bounds.y) / (bounds.h/3))`) is monotonic
 * in `p.y` for a fixed positive `bounds.h`, so feeding it Pixi's native Y-DOWN pointer
 * coordinates unchanged (as `strokeRecognizer.ts` deliberately does — see its own "Y-axis note",
 * left unresolved for this task to settle) would make a physical top-to-bottom swipe (Pixi y
 * INCREASING) land on INCREASING `row`, producing "258" (`downToUp`'s pattern) instead of the
 * doc-pinned "852" (`upToDown`'s pattern) — backwards from the intended direction name.
 *
 * **Decision (this task): flip in the bounds-provider adapter, not the points.** `gridSequence`
 * only ever reads `p.y` relative to `bounds.y`/`bounds.h`; negating `h` and moving `y` to the
 * zone's PHYSICAL BOTTOM edge (in Pixi's native Y-down frame, i.e. `zone.y + zone.h`) makes that
 * same monotonic formula run backwards — `row` DEcreases as raw Pixi `p.y` increases — which
 * reproduces the doc's bottom-up row numbering directly from unflipped Pixi points, with no
 * per-point transform anywhere. Verified numerically (and pinned in turnPanel.test.ts) against
 * `followup-layout.md` §4.1's exact "852 = upToDown" pairing: a straight top-to-bottom drag
 * (Pixi y increasing) through the zone's middle column, run through `swipeZoneBounds`, produces
 * digits 8,8,5,5,2,2 -> collapsed "852". `strokeRecognizer.ts`'s `StrokeRecognizer.bounds` option
 * is exactly where `monsterTurnPanel.ts` plugs this in (a `bounds: () => swipeZoneBounds(zoneRect)`
 * provider), leaving `gridSequence`/`StrokeRecognizer` themselves untouched.
 */
export function swipeZoneBounds(zone: Rect): Rect {
  return { x: zone.x, y: zone.y + zone.h, w: zone.w, h: -zone.h };
}

// --- Panel geometry: the Cocos Y-up -> Pixi Y-down flip (review fix) ---
//
// Every cited layout constant below is transcribed in the ORIGINAL's Cocos frame (480x320 points,
// origin bottom-left, Y-UP) and flipped to this port's Pixi Y-DOWN screen frame in exactly one
// place (`panelLayoutY` / the two position helpers), the same convention every sibling file uses
// (displayShared.ts FRIENDLY_ROW_Y/SPIRIT_BKG_Y_COCOS, enemyTeamDisplay.ts
// `applyMembersBoxPosition`). Kept pure so the flip itself is pinned by turnPanel.test.ts — a
// future accidental unflip fails a test, not just the visual pass.

/** `-[MonsterTurnPanel initWithMonster:...]`'s acting `FriendlyMonsterDisplay` y (turn-panel.md
 *  §1/§4, cited exactly: y-component literal 5.0f): 5pt in the Cocos Y-up frame — the CARD'S
 *  BOTTOM edge sits 5pt above the screen bottom. `panelLayoutY(5) = 315` is that bottom edge's
 *  Pixi y; the card node's Pixi position (its content hangs DOWNWARD from its local origin) is
 *  that minus the card's own content height — see monsterTurnPanel.ts's call site. */
export const ACTING_CARD_Y_COCOS = 5;

/** Bottom-row (bench/retreat/delay) inset, iPhone `data_9fe28` = 5.0 (turn-panel.md §1/§3,
 *  followup-layout.md §1.7). */
export const BOTTOM_ROW_INSET = 5;


export const ABILITY_SLOT_BASE_X = 127.5;
export const ABILITY_SLOT_STEP = 75;
export const ABILITY_SLOT_TOP_Y_COCOS = 86;

function abilitySlotGeometry(mode: DisplayMode): { baseX: number; step: number; topY: number } {
  // Adjacent literal-pool pairs selected by the idiom branch in the ctor:
  // data_9fe30 = 90/180, data_9fe38 = 75/172; the integer y branch is (90-4)/(180-8).
  return {
    baseX: idiomPairPt(90, 180, mode),
    step: idiomPairPt(75, 172, mode),
    topY: idiomPairPt(86, 172, mode),
  };
}

/** `Box.setGap:` receives data_9fe20/24 = 15/20; pad normalizes to 10, not 15. */
export function bottomRowGap(mode: DisplayMode = DISPLAY_MODE): number {
  return idiomPairPt(15, 20, mode);
}

/** Ability-label offsets from data_a0254..a0270. The TU pair is intentionally 67/132, so its
 * normalized iPad value is 66; the other two pairs are exactly doubled. */
export function abilityCardLabelOffsets(mode: DisplayMode = DISPLAY_MODE): {
  nameY: number;
  tuY: number;
  infoCenterX: number;
} {
  return {
    nameY: idiomPairPt(40, 80, mode),
    tuY: idiomPairPt(67, 132, mode),
    infoCenterX: idiomPairPt(30, 60, mode),
  };
}

/** Capture button: bare x=4 plus data_a0274/78 y offset 7/20, converted to Pixi-local. */
export function captureCardPixiPosition(mode: DisplayMode = DISPLAY_MODE): { x: number; y: number } {
  return {
    x: unscaledIdiomPt(4, mode),
    y: -idiomPairPt(7, 20, mode),
  };
}

/** SCREEN_H − yCocos: converts a physical point's Cocos y (distance up from the screen bottom)
 *  to the SAME point's Pixi y (distance down from the screen top). A node whose local content
 *  hangs DOWNWARD from its origin (every Container in this kit) must additionally subtract its
 *  own content height when the Cocos value describes its BOTTOM edge. */
export function panelLayoutY(yCocos: number): number {
  return SCREEN_H - yCocos;
}


export function abilitySlotPixiPos(
  slot: 1 | 2 | 3 | 4,
  mode: DisplayMode = DISPLAY_MODE,
): { x: number; y: number } {
  const geometry = abilitySlotGeometry(mode);
  return {
    x: geometry.baseX + geometry.step * 0.5 + (slot - 1) * geometry.step,
    y: screenPointsForMode(mode).h - geometry.topY,
  };
}


export function abilityInfoButtonTopLeft(
  tuY: number,
  tuHeight: number,
  infoWidth: number,
  infoHeight: number,
  centerX: number = 30,
): { x: number; y: number } {
  return { x: centerX - infoWidth / 2, y: tuY + tuHeight / 2 - infoHeight / 2 };
}


export function bottomRowPixiPos(
  boxW: number,
  barH: number,
  boxH: number,
  mode: DisplayMode = DISPLAY_MODE,
): { x: number; y: number } {
  const inset = idiomPairPt(5, 10, mode);
  return {
    x: screenPointsForMode(mode).w - inset - boxW,
    y: screenPointsForMode(mode).h - barH - inset - boxH,
  };
}
