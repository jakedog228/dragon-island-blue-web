import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, screenPointsForMode, unscaledIdiomPt } from "../displayMode.js";
import type { PopupMenuButtonLayout, PopupMenuGeometry } from "../ui/popupMenuMath.js";

export interface TournamentRoundLayout {
  /** Shared horizontal centre of the round's two matchup cards. */
  readonly x: number;
  /** Bottom edge of the hero card's portrait, in Pixi top-left points. */
  readonly heroBottomY: number;
  /** Bottom edge of the opponent card's portrait. */
  readonly opponentBottomY: number;









  readonly unknownBottomY: number;
  readonly glow: { readonly x: number; readonly y: number };
}





















const BRACKET_HALF_WIDTH_PT = 208;
/** Hero portrait's lower edge above the vertical centre, before the per-round step. */
const HERO_BOTTOM_ABOVE_CENTRE_PT = 61;
const ROUND_STEP_X_PT = 84;
const ROUND_STEP_Y_PT = 38;
const CARD_INSET_X_PT = 29;
/** `q6:8`: the opponent's lower edge sits this far below the hero's. */
const OPPONENT_DROP_PT = 79;
/** `15 - 79`: the placeholder's own drop, 15 idiom points shallower than the opponent's. */
const UNKNOWN_DROP_PT = OPPONENT_DROP_PT - 15;
const GLOW_OFFSET_X_PT = 14;
const GLOW_OFFSET_Y_PT = 32;








export const TOURNAMENT_PORTRAIT_WIDTH_PT = 58;
export const TOURNAMENT_PORTRAIT_MAX_HEIGHT_PT = 67;


export const TOURNAMENT_UNKNOWN_SCALE = 0.7;

export function tournamentPortraitWidth(mode: DisplayMode): number {
  return idiomPairPt(TOURNAMENT_PORTRAIT_WIDTH_PT, TOURNAMENT_PORTRAIT_WIDTH_PT * 2, mode);
}

export function tournamentPortraitMaxHeight(mode: DisplayMode): number {
  return idiomPairPt(
    TOURNAMENT_PORTRAIT_MAX_HEIGHT_PT,
    TOURNAMENT_PORTRAIT_MAX_HEIGHT_PT * 2,
    mode,
  );
}

export function tournamentRoundLayout(round: number, mode: DisplayMode): TournamentRoundLayout {
  if (!Number.isSafeInteger(round) || round < 0 || round > 3) {
    throw new Error(`invalid tournament display round ${round}`);
  }
  const screen = screenPointsForMode(mode);
  const pt = (value: number): number => idiomPairPt(value, value * 2, mode);
  const x = screen.w / 2
    - pt(BRACKET_HALF_WIDTH_PT)
    + pt(CARD_INSET_X_PT)
    + pt(ROUND_STEP_X_PT) * round;
  const heroBottomY = screen.h / 2
    - pt(HERO_BOTTOM_ABOVE_CENTRE_PT)
    + pt(ROUND_STEP_Y_PT) * round;
  return {
    x,
    heroBottomY,
    opponentBottomY: heroBottomY + pt(OPPONENT_DROP_PT),
    unknownBottomY: heroBottomY + pt(UNKNOWN_DROP_PT),
    glow: {
      x: x + pt(GLOW_OFFSET_X_PT),
      y: heroBottomY - pt(GLOW_OFFSET_Y_PT),
    },
  };
}

export interface TournamentRewardLayout {
  /** Pixi centre of the `setAnchorPoint:(0.5,0.5)` RendererFactory node. */
  readonly center: { readonly x: number; readonly y: number };
  /** The `min(maxW/contentW, maxH/contentH)` box. Note there is NO `1.0` clamp — it upscales. */
  readonly maxWidth: number;
  readonly maxHeight: number;
}























export function tournamentRewardLayout(mode: DisplayMode): TournamentRewardLayout {
  const screen = screenPointsForMode(mode);
  return {
    center: {
      x: screen.w / 2 + idiomPairPt(172, 344, mode),
      // Cocos `h/2 - 60*idiom` is BELOW centre in a y-up frame, so Pixi y-down adds it.
      y: screen.h / 2 + idiomPairPt(60, 120, mode),
    },
    maxWidth: idiomPairPt(60, 120, mode),
    maxHeight: idiomPairPt(80, 160, mode),
  };
}

/** The one gap literal the title group uses three times: screen edge -> letter -> captions. */
const TITLE_GAP_PT = 5;
/** Distance from the screen's top edge to the letter's / first caption's top edge. */
const TITLE_TOP_INSET_PT = 20;


































export interface TournamentTitleLayout {
  /** Left edge of the big class letter — the source's `{0,1}`-anchored label. */
  readonly letterX: number;
  /** Top edge shared by the class letter and the first caption line. */
  readonly topY: number;
  /** Right edge both `{1,1}`-anchored caption lines align to. */
  readonly captionRight: number;
}

/** `letterWidthPt` is the letter label's source `contentSize.width` (outline EXCLUDED). */
export function tournamentTitleLayout(
  letterWidthPt: number,
  mode: DisplayMode,
): TournamentTitleLayout {
  const screen = screenPointsForMode(mode);
  const gap = unscaledIdiomPt(TITLE_GAP_PT, mode);
  const letterX = screen.w - gap - letterWidthPt - gap;
  return {
    letterX,
    topY: unscaledIdiomPt(TITLE_TOP_INSET_PT, mode),
    captionRight: letterX - gap,
  };
}

/** `Menus.json.Tournament`: menu/screen anchors `{0,0}`, offset 10/20 native points. */
export function tournamentMenuGeometry(
  centered: PopupMenuGeometry,
  mode: DisplayMode,
): PopupMenuGeometry {
  const screen = screenPointsForMode(mode);
  const offset = idiomPairPt(10, 20, mode);
  const dx = offset - centered.content.x;
  const dy = screen.h - offset - centered.content.h - centered.content.y;
  const move = <T extends { x: number; y: number }>(value: T): T => ({
    ...value,
    x: value.x + dx,
    y: value.y + dy,
  });
  return {
    content: move(centered.content),
    title: centered.title === null ? null : move(centered.title),
    buttons: centered.buttons.map((column) => column.map((button) => ({
      ...button,
      label: move(button.label),
      background: move(button.background),
    }))),
  };
}








export function tournamentRewardsButtonLayout(
  flowed: PopupMenuGeometry,
  reward: PopupMenuButtonLayout,
  mode: DisplayMode,
): PopupMenuButtonLayout {
  const center = {
    x: flowed.content.x + flowed.content.w / 2 + idiomPairPt(316, 665, mode),
    y: flowed.content.y + flowed.content.h / 2 - idiomPairPt(-20, 10, mode),
  };
  return {
    ...reward,
    label: {
      ...reward.label,
      x: center.x - reward.label.w / 2,
      y: center.y - reward.label.h / 2,
    },
    background: {
      ...reward.background,
      x: center.x - reward.background.w / 2,
      y: center.y - reward.background.h / 2,
    },
  };
}
