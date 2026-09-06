


import type { Targeting } from "@dib/engine";
import { idiomPairPt, truncateSourcePoint, unscaledIdiomPt, type DisplayMode } from "../displayMode.js";

export interface TargetPickerRequest {
  enemiesNeeded: number;
  friendsNeeded: number;
  allEnemies: boolean;
  allFriends: boolean;
}


export function requestFromTargeting(targeting: Targeting): TargetPickerRequest {
  switch (targeting.kind) {
    case "self":
      return { enemiesNeeded: 0, friendsNeeded: 0, allEnemies: false, allFriends: false };
    case "enemies":
      return { enemiesNeeded: targeting.count, friendsNeeded: 0, allEnemies: false, allFriends: false };
    case "allEnemies":
      return { enemiesNeeded: 0, friendsNeeded: 0, allEnemies: true, allFriends: false };
    case "friends":
      return { enemiesNeeded: 0, friendsNeeded: targeting.count, allEnemies: false, allFriends: false };
    case "allFriends":
      return { enemiesNeeded: 0, friendsNeeded: 0, allEnemies: false, allFriends: true };
    case "mixed":
      return {
        enemiesNeeded: targeting.enemyCount,
        friendsNeeded: targeting.friendlyCount,
        allEnemies: targeting.allEnemies,
        allFriends: targeting.allFriends,
      };
  }
}

export type TargetPickerPhase = "enemies" | "friends" | "done" | "cancelled";

export type TargetPickOutcome = "picked" | "duplicate" | "miss" | "ignored";

export interface TargetPickerState {
  readonly phase: TargetPickerPhase;
  /** Post-clamp (step 1 above) — never exceeds `validEnemyIds.length`/`validFriendIds.length`. */
  readonly enemiesNeeded: number;
  readonly friendsNeeded: number;
  readonly allEnemies: boolean;
  readonly allFriends: boolean;
  readonly validEnemyIds: readonly string[];
  readonly validFriendIds: readonly string[];
  readonly pickedEnemies: readonly string[];
  readonly pickedFriends: readonly string[];
}


export function beginTargetPicking(
  request: TargetPickerRequest,
  validEnemyIds: readonly string[],
  validFriendIds: readonly string[],
): TargetPickerState {
  const enemiesNeeded = Math.min(request.enemiesNeeded, validEnemyIds.length);
  const friendsNeeded = Math.min(request.friendsNeeded, validFriendIds.length);
  const needsEnemyPick = !request.allEnemies && enemiesNeeded > 0;
  const needsFriendPick = !request.allFriends && friendsNeeded > 0;
  const phase: TargetPickerPhase = needsEnemyPick ? "enemies" : needsFriendPick ? "friends" : "done";
  return {
    phase,
    enemiesNeeded,
    friendsNeeded,
    allEnemies: request.allEnemies,
    allFriends: request.allFriends,
    validEnemyIds,
    validFriendIds,
    pickedEnemies: [],
    pickedFriends: [],
  };
}


export function pickTarget(
  state: TargetPickerState,
  id: string,
): { state: TargetPickerState; outcome: TargetPickOutcome } {
  if (state.phase !== "enemies" && state.phase !== "friends") {
    return { state, outcome: "ignored" }; // done/cancelled: no longer accepting picks
  }

  const validIds = state.phase === "enemies" ? state.validEnemyIds : state.validFriendIds;
  const picked = state.phase === "enemies" ? state.pickedEnemies : state.pickedFriends;

  if (picked.includes(id)) return { state, outcome: "duplicate" };
  if (!validIds.includes(id)) return { state, outcome: "miss" }; // "A miss plays notAllowed.m4a"

  if (state.phase === "enemies") {
    const pickedEnemies = [...state.pickedEnemies, id];
    const enemyQuotaMet = pickedEnemies.length >= state.enemiesNeeded;
    const needsFriendPick = !state.allFriends && state.friendsNeeded > 0;
    const phase: TargetPickerPhase = !enemyQuotaMet ? "enemies" : needsFriendPick ? "friends" : "done";
    return { state: { ...state, pickedEnemies, phase }, outcome: "picked" };
  }

  const pickedFriends = [...state.pickedFriends, id];
  const phase: TargetPickerPhase = pickedFriends.length >= state.friendsNeeded ? "done" : "friends";
  return { state: { ...state, pickedFriends, phase }, outcome: "picked" };
}


export function cancelTargetPicking(state: TargetPickerState): TargetPickerState {
  return { ...state, phase: "cancelled" };
}

export function isTargetPickingDone(state: TargetPickerState): boolean {
  return state.phase === "done";
}

export function isTargetPickingCancelled(state: TargetPickerState): boolean {
  return state.phase === "cancelled";
}


export function pickedIds(state: TargetPickerState): string[] {
  const enemies = state.allEnemies ? [...state.validEnemyIds] : [...state.pickedEnemies];
  const friends = state.allFriends ? [...state.validFriendIds] : [...state.pickedFriends];
  return [...enemies, ...friends];
}


export const OUTLINE_ANGULAR_STEP_DEG = 30;

/** Base outline width passed by the friendly branch; the enemy branch passes `2 / scale`. */
export const OUTLINE_BORDER_WIDTH_PT = 2;

export function outlineStampAnglesDeg(stepDeg: number = OUTLINE_ANGULAR_STEP_DEG): number[] {
  if (!(stepDeg > 0)) throw new Error(`outlineStampAnglesDeg: non-positive step ${stepDeg}`);
  const angles: number[] = [];
  for (let deg = 0; deg < 360; deg += stepDeg) angles.push(deg);
  return angles;
}


export function outlineBorderWidthLocal(
  side: "enemy" | "friend",
  cocosScale: number,
  mode: DisplayMode = "iphone",
): number {
  const scale = Math.abs(cocosScale);
  if (!(scale > 0)) throw new Error(`outlineBorderWidthLocal: non-positive scale ${cocosScale}`);
  const base = unscaledIdiomPt(OUTLINE_BORDER_WIDTH_PT, mode);
  return side === "enemy" ? base / scale : base;
}


export function outlineRenderTextureGeometry(opts: {
  contentW: number;
  contentH: number;
  anchorX: number;
  anchorY: number;
  side: "enemy" | "friend";
  cocosScale: number;
  mode?: DisplayMode;
}): {
  border: number;
  textureW: number;
  textureH: number;
  spriteAnchorX: number;
  spriteAnchorY: number;
} {
  const mode = opts.mode ?? "iphone";
  const border = outlineBorderWidthLocal(opts.side, opts.cocosScale, mode);


  const textureW = truncateSourcePoint(opts.contentW + border * 2, mode);
  const textureH = truncateSourcePoint(opts.contentH + border * 2, mode);
  return {
    border,
    textureW,
    textureH,
    spriteAnchorX: (border + opts.anchorX * opts.contentW) / textureW,
    spriteAnchorY: (border + opts.anchorY * opts.contentH) / textureH,
  };
}

export const CANCEL_BUTTON_SCALE = 0.3;
export const CANCEL_BUTTON_MARGIN_PT = 5;


export function cancelButtonMarginPt(mode: DisplayMode): number {
  return unscaledIdiomPt(CANCEL_BUTTON_MARGIN_PT, mode);
}


export function cancelButtonCenterYCocos(mode: "iphone" | "ipad"): number {
  return idiomPairPt(120, 220, mode);
}

/** Source positions the center, while this port's ButtonSprite uses a top-left origin. */
export function cancelButtonPixiTopLeft(opts: {
  screenW: number;
  screenH: number;
  scaledW: number;
  scaledH: number;
  mode: "iphone" | "ipad";
}): { x: number; y: number } {
  const xCenter = opts.screenW - cancelButtonMarginPt(opts.mode) - opts.scaledW / 2;
  const yCenter = cancelButtonCenterYCocos(opts.mode);
  return {
    x: xCenter - opts.scaledW / 2,
    y: opts.screenH - yCenter - opts.scaledH / 2,
  };
}
