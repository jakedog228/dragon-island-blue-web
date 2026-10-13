


import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import {
  idiomPairPt,
  roundSourcePoint,
  screenPointsForMode,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";

export const ENEMY_NAME_COLORS: readonly number[] = [
  0x9696ff, // slot 0: (150,150,255) light blue/periwinkle
  0xff6464, // slot 1: (255,100,100) light red/salmon
  0x64ff64, // slot 2: (100,255,100) light green
];


export const ENEMY_NAME_COLOR_FALLBACK = 0xffffff;


export function enemyNameColor(slot: number): number {
  return ENEMY_NAME_COLORS[slot] ?? ENEMY_NAME_COLOR_FALLBACK;
}

/** PvP extension: fit four source-sized slots in the same field band; art is never rescaled. */
export function multiplayerEnemyGap(count: number, mode: DisplayMode): number {
  if (count === 2) return enemyTeamLayoutMetrics(mode).gapTwo;
  if (count <= 3) return 0;
  return (screenPointsForMode(mode).w - enemyTeamLayoutMetrics(mode).offsetX - count * idiomPairPt(128, 256, mode)) / (count - 1);
}


export function turnOrderLabelFill(team: 0 | 1, colorTint?: number): number {
  if (team === 0) return 0xffffff;
  const base = colorTint ?? ENEMY_NAME_COLOR_FALLBACK;
  return (
    (Math.floor(((base >> 16) & 0xff) * 0.75) << 16) |
    (Math.floor(((base >> 8) & 0xff) * 0.75) << 8) |
    Math.floor((base & 0xff) * 0.75)
  );
}

/** `MonsterPortraits-hd` atlas frame-naming convention (verified directly against
 *  `extracted/assets/atlases/MonsterPortraits-hd.json`). */
export function portraitFrameKey(name: string): string {
  return `${name}_icon.png`;
}


export function shrinkToFitScale(contentW: number, contentH: number, targetW: number, targetH: number): number {
  return Math.min(1.0, targetW / contentW, targetH / contentH);
}


export let SCREEN_W = screenPointsForMode(DISPLAY_MODE).w;
export let SCREEN_H = screenPointsForMode(DISPLAY_MODE).h;

/** `EnemyMonsterDisplay.contentSize.width`, `data_98c10` (team-displays.md §2) — the fixed slot
 *  width `Box` packs against. */
export let ENEMY_SLOT_WIDTH = idiomPairPt(128, 256, DISPLAY_MODE);


export const MEMBERS_BOX_OFFSET_X = 70;
export const MEMBERS_BOX_OFFSET_Y = 90;
export const MEMBERS_BOX_MARGIN_TOP = 20;

export function enemyTeamLayoutMetrics(mode: DisplayMode): {
  offsetX: number;
  offsetY: number;
  marginTop: number;
  gapTwo: number;
} {
  return {


    offsetX: idiomPairPt(70, 160, mode),
    offsetY: idiomPairPt(90, 180, mode),
    marginTop: idiomPairPt(20, 40, mode),
    gapTwo: idiomPairPt(64, 128, mode),
  };
}

/** `EnemyMonsterDisplay.contentSize` height: "computed height from winSize minus 90/180 and
 *  20/40 margins" (team-displays.md §2) = 320 − 90 − 20 = 210pt on iPhone. The cited iPad idiom
 *  pair (180/40 at content scale 1) halves to the same 90/20 point values, so the winSize
 *  formula below is exact for BOTH device idioms. Read together with
 *  `calculateMembersBoxPosition`'s y = 195 (the exact midpoint of the [90, 300] band) as the
 *  box's vertical CENTER — the only reading that keeps a 210pt-tall widget on the 320pt screen
 *  AND matches all reference footage (enemy name plates at the very top of the screen, monster
 *  feet just above the bottom bar: appstore_2, video frames 005/013/021/027). A prior revision
 *  read y=195 as the widget's TOP edge, sinking the whole enemy row ~105pt so the monsters were
 *  half-hidden behind the bottom bar (confirmed in port-shots 01/02). */
export function enemySlotHeightForMode(mode: DisplayMode): number {
  const screen = screenPointsForMode(mode);
  const metrics = enemyTeamLayoutMetrics(mode);
  return screen.h - metrics.offsetY - metrics.marginTop;
}
export let ENEMY_SLOT_HEIGHT = enemySlotHeightForMode(DISPLAY_MODE);

/** `calculateMembersBoxGap`: 0 unless the team has exactly 2 living members, then this (iPhone
 *  `data_9a894`) (team-displays.md §1). */
export let MEMBERS_BOX_GAP_TWO = enemyTeamLayoutMetrics(DISPLAY_MODE).gapTwo;


export let BENCH_BOX_INSET = idiomPairPt(5, 10, DISPLAY_MODE);


export function membersBoxXCocos(boxWidth: number, mode: DisplayMode = DISPLAY_MODE): number {
  const screen = screenPointsForMode(mode);
  const { offsetX } = enemyTeamLayoutMetrics(mode);
  return offsetX + 0.5 * (screen.w - boxWidth - offsetX);
}
export function membersBoxYCocos(mode: DisplayMode = DISPLAY_MODE): number {
  const screen = screenPointsForMode(mode);
  const { offsetY, marginTop } = enemyTeamLayoutMetrics(mode);
  return offsetY + 0.5 * (screen.h - marginTop - offsetY);
}


export const ENEMY_ENTRANCE_DELAY_BASE_MS = 500;
export const ENEMY_ENTRANCE_DELAY_STEP_MS = 250;
export const ENEMY_ENTRANCE_MOVE_MS = 1000;

export function enemyEntranceDelayMs(index: number): number {
  return ENEMY_ENTRANCE_DELAY_BASE_MS + ENEMY_ENTRANCE_DELAY_STEP_MS * index;
}


export function enemyEntranceDropPts(mode: DisplayMode = DISPLAY_MODE): number {
  return screenPointsForMode(mode).h - membersBoxYCocos(mode);
}


export const ENEMY_ADDED_REORDER_DELAY_MS = 1000;


export const ENEMY_REORDER_MOVE_MS = 1000;


export function reorderEntranceStart(
  newLocal: { x: number; y: number },
  boxNewX: number,
  boxOldX: number,
  mode: DisplayMode = DISPLAY_MODE,
): { x: number; y: number } {
  const screen = screenPointsForMode(mode);
  const worldX = boxNewX + newLocal.x;
  const x = (worldX > screen.w ? screen.w * 0.5 : newLocal.x) - (boxNewX - boxOldX);
  return { x, y: newLocal.y - enemyEntranceDropPts(mode) };
}

// --- EnemyMonsterDisplay (team-displays.md §2, followup-consts.md §2) ---

/** Name label `CCLabelTTF` font size, iPhone `data_98c28` (team-displays.md §2). */
export let ENEMY_NAME_LABEL_SIZE = idiomPairPt(15, 30, DISPLAY_MODE);


export const ENEMY_HP_BAR_SCALE = 0.75;

/** `data_98c30/34` = 6/12 native points; normalized spacing is 6pt on either idiom. */
export let ENEMY_ELEMENT_ICON_GAP = idiomPairPt(6, 12, DISPLAY_MODE);


export const IDLE_BOB_LEG_MS = 2000;
export function enemyIdleBobAmplitude(mode: DisplayMode): number {
  return unscaledIdiomPt(20, mode);
}
export let IDLE_BOB_AMPLITUDE = enemyIdleBobAmplitude(DISPLAY_MODE);


export const ENEMY_ABILITY_PULSE_SCALE = 1.5;
export const ENEMY_ABILITY_PULSE_LEG_MS = 500;

export type AutomaticTurnActivationMotion = "none" | "enemyPulse" | "friendlyPopForward";


export function automaticTurnActivationMotion(
  actorTeam: 0 | 1,
  abilityPath: string,
): AutomaticTurnActivationMotion {
  if (abilityPath === "Utility.LooseTurn") return "none";
  return actorTeam === 0 ? "friendlyPopForward" : "enemyPulse";
}


export const DEATH_SHAKE_MS = 1000;


export function enemyDeathShakeOffset(mode: DisplayMode): number {
  return unscaledIdiomPt(3, mode);
}
export let DEATH_SHAKE_OFFSET = enemyDeathShakeOffset(DISPLAY_MODE);
export const DEATH_SPIN_SHRINK_MS = 1000;
export const DEATH_SPIN_DEGREES = 720;
export const DEATH_WIDGET_REMOVE_MS = 2000;


export const CAPTURE_REMOVE_MS = 1000;


export const RARITY_STAR_DELAY_MS = 2500;


export const RARITY_STAR_LIFETIME_MS = 10000;
/** Gap between stars, iPhone `data_99b44` (1.0pt). */
export let RARITY_STAR_GAP = idiomPairPt(1, 2, DISPLAY_MODE);
/** `showStars` x: `contentSize.width*0.5 - 35`, iPhone `data_99104` (team-displays.md §2). */
export let RARITY_STAR_X_OFFSET = idiomPairPt(35, 70, DISPLAY_MODE);


export const RARITY_STAR_SCALE = 0.35;
/** Star fly-in facts (same raw read as RARITY_STAR_SCALE): */
export const RARITY_STAR_ENTRY_DELAY_BASE_MS = 100;
export const RARITY_STAR_ENTRY_DELAY_STEP_MS = 300;


export let RARITY_STAR_ENTRY_START_Y_COCOS = idiomPairPt(300, 700, DISPLAY_MODE);
export const RARITY_STAR_MOVE_MS = 1500;
export const RARITY_STAR_SCALE_MS = 2500;


export let RARITY_STAR_BAND_TOP_PIXI_Y = idiomPairPt(15, 30, DISPLAY_MODE);


export const CAPTURE_CARD_IDLE_DELAY_MIN_MS = 6000;
export const CAPTURE_CARD_IDLE_DELAY_RANGE_MS = 3000;
export const CAPTURE_CARD_SHAKE_MS = 500;
export function captureCardShakeOffset(mode: DisplayMode): number {
  return unscaledIdiomPt(2, mode);
}
export let CAPTURE_CARD_SHAKE_OFFSET = captureCardShakeOffset(DISPLAY_MODE);

/** One fixed per-card idle delay draw (source: one arc4random per button — exact iOS RNG values
 *  not required per the project RNG rule; the [6s, 9s) distribution is what's preserved). */
export function captureCardIdleDelayMs(unitRandom: number): number {
  return CAPTURE_CARD_IDLE_DELAY_MIN_MS + CAPTURE_CARD_IDLE_DELAY_RANGE_MS * unitRandom;
}


export const NEW_OVERLAY_GLOW_SCALE = 1 / 0.75;
export const NEW_OVERLAY_GLOW_FADE_LEG_MS = 500;
export let NEW_OVERLAY_LABEL_SIZE = idiomPairPt(14, 20, DISPLAY_MODE);
export const NEW_OVERLAY_LABEL_START_SCALE = NEW_OVERLAY_GLOW_SCALE * 0.5;
export const NEW_OVERLAY_LABEL_POP_MS = 2000;
export const NEW_OVERLAY_LABEL_FADE_REMOVE_MS = 500;


export let FRIENDLY_SLOT_WIDTH = SCREEN_W / 5; // 96

/** Both CGPoint lanes in `positionForSlot:` end in the same bare native 5pt literal. */
export let FRIENDLY_CARD_EDGE_INSET = unscaledIdiomPt(5, DISPLAY_MODE);
export let FRIENDLY_ROW_Y_COCOS = FRIENDLY_CARD_EDGE_INSET;

export function positionForSlotForMode(slotIndex: number, mode: DisplayMode): number {
  return slotIndex * (screenPointsForMode(mode).w / 5) + unscaledIdiomPt(5, mode);
}


export function positionForSlot(slotIndex: number): number {
  return positionForSlotForMode(slotIndex, DISPLAY_MODE);
}

/** Party card i (0-based fighter index) sits at positionForSlot(i + 1) — see above. */
export function partyCardX(fighterIndex: number): number {
  return positionForSlot(fighterIndex + 1);
}

/** `initWithMonster:slotWidth:`'s divisor for the turn-panel's *acting* card (brief: "w/6 for the
 *  turn-panel acting card") — Task 12 owns actually instantiating one at this width. */
export let TURN_PANEL_CARD_WIDTH = SCREEN_W / 6; // 80

/** "summon uses slot 0 ... matching how a summon temporarily takes the front/battling spot"
 *  (team-displays.md §4). */
export const SUMMON_SLOT_INDEX = 0;


export const SUMMON_EVICT_DELAY_MS = 1000;
export const SUMMON_EVICT_REMOVE_MS = 500;

/** `combatBottomBar.png` (1024×192px = 512×96pt) — FriendlyTeamDisplay's background sprite,
 *  anchor (0,0) i.e. flush to the screen bottom (team-displays.md §4). */
export const BOTTOM_BAR_HEIGHT = 96;


export const FRIENDLY_CARD_SPRITE_MAX_H = 80;
export const FRIENDLY_CARD_SPRITE_W_INSET = 10;


export let SPIRIT_BKG_Y_COCOS = idiomPairPt(45, 90, DISPLAY_MODE);
export const SPIRIT_BKG_OPACITY = 130 / 255;

/** Name label `CCLabelTTF` size, iPhone `data_9be20` (team-displays.md §4) — unlike the enemy
 *  name label, no per-monster `setColor:` call exists for this one. */
export let FRIENDLY_NAME_LABEL_SIZE = idiomPairPt(12, 24, DISPLAY_MODE);


export const FRIENDLY_HP_BAR_SCALE = 0.8;


export const FRIENDLY_HP_LABEL_SIZE = 14;
export const FRIENDLY_HP_LABEL_BOLD = false;

export interface FriendlyCardChromeLayout {
  barCenterX: number;
  barCenterY: number;
  nameX: number;
  nameBottomY: number;
}


export function friendlyCardChromeLayout(
  slotWidth: number,
  hpContentHeight: number,
  mode: DisplayMode = DISPLAY_MODE,
): FriendlyCardChromeLayout {
  const barCenterX = roundSourcePoint(slotWidth * 0.5, mode);
  const barCenterY = roundSourcePoint(hpContentHeight * 0.5, mode);
  const nameX = unscaledIdiomPt(5, mode);
  const nameGap = unscaledIdiomPt(2, mode);
  const nameBottomY = roundSourcePoint(barCenterY + hpContentHeight * 0.5 + nameGap, mode);
  return { barCenterX, barCenterY, nameX, nameBottomY };
}

export interface ChildRect {
  x: number;
  y: number;
  w: number;
  h: number;
}


export function contentSizeFromChildUnion(children: readonly ChildRect[]): { w: number; h: number } {
  if (children.length === 0) return { w: 0, h: 0 };
  const minX = Math.min(...children.map((child) => child.x));
  const minY = Math.min(...children.map((child) => child.y));
  const maxX = Math.max(...children.map((child) => child.x + child.w));
  const maxY = Math.max(...children.map((child) => child.y + child.h));
  return {
    w: maxX - Math.max(0, minX),
    h: maxY - Math.max(0, minY),
  };
}

/** Monster-sprite vertical placement band: **90.0pt − 10.0pt = 80pt** (team-displays.md §4: "the
 *  same 90-10/180-20 pattern seen in EnemyMonsterDisplay's init... a shared 'portrait vertical
 *  placement' convention"). The exact target box beyond that band is this port's own composition
 *  (mirrors enemyMonsterDisplay.ts's SPRITE_TARGET_W/H disclosure). */
export const FRIENDLY_SPRITE_BAND = 80;


export const FRIENDLY_DEATH_SPIN_MS = 1000;
export const FRIENDLY_DEATH_SPIN_DEGREES = 960;

/** The team node independently runs `Sequence(Delay(1.0), adjustMonsterSlots)` at the same time
 * the card runs its 1.0s death spawn. Both complete one second after the notification. */
export const FRIENDLY_DEATH_COMPACT_DELAY_MS = 1000;


export const FRIENDLY_DEATH_REMOVE_MS = 1000;


export const FRIENDLY_SLOT_REFLOW_MS = 1000;

export type DeathCompactPhase = "dying" | "compact" | "remove";

export interface DeathCompactStep {
  phase: DeathCompactPhase;
  atMs: number;
  durationMs: number;
}

/**
 * Pure source timeline. Both actions start from the same notification; compact fires when the
 * death animation reaches its one-second endpoint, not one second after it. That compact call
 * starts the dying card's independent one-second RemoveFromParentAction.
 */
export function deathThenCompactSchedule(): readonly DeathCompactStep[] {
  return [
    { phase: "dying", atMs: 0, durationMs: FRIENDLY_DEATH_SPIN_MS },
    { phase: "compact", atMs: FRIENDLY_DEATH_COMPACT_DELAY_MS, durationMs: 0 },
    {
      phase: "remove",
      atMs: FRIENDLY_DEATH_COMPACT_DELAY_MS,
      durationMs: FRIENDLY_DEATH_REMOVE_MS,
    },
  ];
}


export const POP_FORWARD_X_FRACTION = 0.5;
export const POP_FORWARD_Y_COCOS = 90;


export const POP_FORWARD_ENTRY_MS = 450;
export const POP_FORWARD_HOLD_MS = 1000;
export const POP_FORWARD_EXIT_MS = 450;


export const TURN_ORDER_ROOT_Y = 5;


export let TURN_ORDER_STEP = idiomPairPt(34, 68, DISPLAY_MODE);

/** x-coordinate every entry warps/rests at, iPhone `data_efd84` (followup-consts.md §4: 12.0
 *  iPhone / 24.0 iPad) — NOT 0; every entry sits inset 12pt from the TurnOrderDisplay's own x=0
 *  origin, per the literal `CCMoveTo` target `warpNodesExcludingObject:` uses for every node. */
export let TURN_ORDER_ENTRY_X = idiomPairPt(12, 24, DISPLAY_MODE);


export const TURN_ORDER_BAR_SCALE = 0.5;

/** Time-delay label `CCLabelTTF` font size, iPhone `data_ef910` (followup-consts.md §4: 14.0
 *  iPhone / 28.0 iPad). */
export let TURN_ORDER_LABEL_SIZE = idiomPairPt(14, 28, DISPLAY_MODE);


export const TURN_ORDER_FLIP_MS = 500;
export const TURN_ORDER_SLIDE_MS = 500;
/** Final mirrored-to-normal leg; spawned with the callback that starts the other entries' warp. */
export const TURN_ORDER_RESTORE_MS = 500;

export const TURN_ORDER_WARP_MS = 500;


export const TURN_ORDER_CAPTURE_REMOVAL_DELAY_MS = 2000;
export const TURN_ORDER_DEATH_REMOVAL_DELAY_MS = 0;
export const TURN_ORDER_REMOVAL_FALL_MS = 3000;
/** World Cocos `(120,-100)` converted through the display root at Cocos `(0,315)` to local Pixi. */
export const TURN_ORDER_REMOVAL_TARGET = { x: 120, y: 415 } as const;

export const TURN_ORDER_REMOVAL_ROTATION_DEG = 90;

/** Replacement is one removal plus one addition; the source defines no separate entrance action. */
export function turnOrderMembershipChanges(previous: readonly string[], next: readonly string[]): {
  removed: string[];
  added: string[];
} {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    removed: previous.filter((id) => !nextSet.has(id)),
    added: next.filter((id) => !previousSet.has(id)),
  };
}

/** One column slot: `id` at array index `i` -> `(TURN_ORDER_ENTRY_X, turnOrderEntryY(i))`. */
export interface TurnOrderSlot {
  id: string;
  x: number;
  y: number;
}

/** `turnOrderEntryY`'s index is 0-based, matching `Battle.queOrder`/the engine provider's own
 *  soonest-first ordering — no independent sort exists anywhere in `TurnOrderDisplay`; the column
 *  is positioned in exactly that array's sequence (turn-order-input.md §1: "Order source of truth
 *  is Battle.queOrder"). */
export function turnOrderEntryY(index: number): number {
  return (index + 1) * TURN_ORDER_STEP;
}

/** Pure per-index layout for a whole column snapshot — the "sort" is simply `order`'s own
 *  sequence (see `turnOrderEntryY`'s citation); exposed as one call so `turnOrderDisplay.ts` and
 *  its tests share one source of truth for "id at index i -> (x, y)". */
export function turnOrderLayout(order: readonly string[]): TurnOrderSlot[] {
  return order.map((id, i) => ({ id, x: TURN_ORDER_ENTRY_X, y: turnOrderEntryY(i) }));
}


export let TURN_ORDER_BAR_BOTTOM_Y_COCOS = unscaledIdiomPt(-3, DISPLAY_MODE);

registerRuntimeSettingsRefresh(() => {
  const screen = screenPointsForMode(DISPLAY_MODE);
  SCREEN_W = screen.w;
  SCREEN_H = screen.h;
  ENEMY_SLOT_WIDTH = idiomPairPt(128, 256, DISPLAY_MODE);
  ENEMY_SLOT_HEIGHT = enemySlotHeightForMode(DISPLAY_MODE);
  MEMBERS_BOX_GAP_TWO = enemyTeamLayoutMetrics(DISPLAY_MODE).gapTwo;
  BENCH_BOX_INSET = idiomPairPt(5, 10, DISPLAY_MODE);
  ENEMY_NAME_LABEL_SIZE = idiomPairPt(15, 30, DISPLAY_MODE);
  ENEMY_ELEMENT_ICON_GAP = idiomPairPt(6, 12, DISPLAY_MODE);
  IDLE_BOB_AMPLITUDE = enemyIdleBobAmplitude(DISPLAY_MODE);
  DEATH_SHAKE_OFFSET = enemyDeathShakeOffset(DISPLAY_MODE);
  RARITY_STAR_GAP = idiomPairPt(1, 2, DISPLAY_MODE);
  RARITY_STAR_X_OFFSET = idiomPairPt(35, 70, DISPLAY_MODE);
  RARITY_STAR_ENTRY_START_Y_COCOS = idiomPairPt(300, 700, DISPLAY_MODE);
  RARITY_STAR_BAND_TOP_PIXI_Y = idiomPairPt(15, 30, DISPLAY_MODE);
  CAPTURE_CARD_SHAKE_OFFSET = captureCardShakeOffset(DISPLAY_MODE);
  NEW_OVERLAY_LABEL_SIZE = idiomPairPt(14, 20, DISPLAY_MODE);
  FRIENDLY_CARD_EDGE_INSET = unscaledIdiomPt(5, DISPLAY_MODE);
  FRIENDLY_SLOT_WIDTH = SCREEN_W / 5;
  FRIENDLY_ROW_Y_COCOS = FRIENDLY_CARD_EDGE_INSET;
  TURN_PANEL_CARD_WIDTH = SCREEN_W / 6;
  SPIRIT_BKG_Y_COCOS = idiomPairPt(45, 90, DISPLAY_MODE);
  FRIENDLY_NAME_LABEL_SIZE = idiomPairPt(12, 24, DISPLAY_MODE);
  TURN_ORDER_STEP = idiomPairPt(34, 68, DISPLAY_MODE);
  TURN_ORDER_ENTRY_X = idiomPairPt(12, 24, DISPLAY_MODE);
  TURN_ORDER_LABEL_SIZE = idiomPairPt(14, 28, DISPLAY_MODE);
  TURN_ORDER_BAR_BOTTOM_Y_COCOS = unscaledIdiomPt(-3, DISPLAY_MODE);
});


export function turnOrderEntryChildLayout(iconHeightPt: number, scaledBarHeightPt: number): {
  iconY: number;
  labelCenterY: number;
  barY: number;
} {
  return {
    iconY: -iconHeightPt,
    labelCenterY: -iconHeightPt / 2,
    barY: -(scaledBarHeightPt + TURN_ORDER_BAR_BOTTOM_Y_COCOS),
  };
}

/** `HeroDisplay` resting position `winSize - contentSize` (turn-panel.md §1, team-displays.md
 *  §4), where `contentSize` is `heroFrame.png`'s point size — team-displays.md §6: "its
 *  contentSize becomes the whole HeroDisplay's contentSize". Anchors the ornate frame flush to
 *  the screen's bottom-right (appstore_2.jpg). Both HeroDisplay owners (FriendlyTeamDisplay and
 *  MonsterTurnPanel) share this one conversion so neither can regress to Pixi's bounds union,
 *  which the 2pt-taller substituted portrait inflates (heroDisplay.ts header). */
export function heroDisplayPosition(contentWidthPt: number, contentHeightPt: number): {
  x: number;
  y: number;
} {
  return { x: SCREEN_W - contentWidthPt, y: SCREEN_H - contentHeightPt };
}

/** `"%3d"` (turn-order-input.md §1: the queue's time-delay label format, fed from `[Battle
 *  timeDelayForLiving:]`) — minimum-3-char, space-padded, right-aligned decimal. Truncates toward
 *  zero first (matching printf's `%d`, not rounding) since the time-delay value is itself an
 *  integer time-unit count; a value wider than 3 digits is NOT truncated (matches printf's "%3d"
 *  minimum-width, not fixed-width, semantics). */
export function formatTimeDelay(delayTu: number): string {
  return String(Math.trunc(delayTu)).padStart(3, " ");
}
