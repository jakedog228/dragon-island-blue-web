























export const PACING_FRIENDLY_MS = 1000;
/** `data_c56a0` = 2.25s: state-1 pacing added when the new activeLiving is on any enemy team. */
export const PACING_ENEMY_MS = 2250;

/** `-[BattleNode notifyBattleStateChangedTo:]` state 1 (battle-node.md §6): the empty-status
 * branch's per-turn-start pacing delay, keyed on the actor's team. The separate finish callback
 * contributes no delay; `state1ContinuationDelayMs` owns that route selection. */
export function pacingDelayMs(actorTeam: 0 | 1): number {
  return actorTeam === 0 ? PACING_FRIENDLY_MS : PACING_ENEMY_MS;
}

export type State1ContinuationRoute = "empty-status" | "status-text-finish";

/** State-1 queue continuation is split across two source methods. The ordinary empty-status
 * branch in `notifyBattleStateChangedTo:` adds the team-keyed lead-in after advancing. A tap or
 * 5-second finish invocation reaches `statusTextAdvance:` instead, which advances and removes the
 * finish node without touching `timeDelay`. The queue/state-2 transition is synchronous; visible
 * panel/automatic-turn work is consumed by BattleNode's following per-frame update. */
export function state1ContinuationDelayMs(
  actorTeam: 0 | 1,
  route: State1ContinuationRoute,
): number {
  return route === "status-text-finish" ? 0 : pacingDelayMs(actorTeam);
}

/** A manual `statusTextAdvance:` runs between scheduler passes: queue/state mutation is synchronous,
 * while BattleNode's panel/automatic work belongs to the following update. The 5-second limit is
 * different: ChainedTextLabel is earlier than BattleNode in the equal-priority scheduler list, so
 * its inline finish callback feeds BattleNode later in that same pass and owes no extra update. */
export function statusFinishWaitsForFollowingUpdate(
  route: State1ContinuationRoute,
  acknowledgment: "manual" | "wait-limit" | "none",
): boolean {
  return route === "status-text-finish" && acknowledgment === "manual";
}



export const REMOVED_LIVING_LOGIC_HOLD_MS = 500;




export const VICTORY_AWARD_STATE_HOLD_MS = 1000;



export const DEFEAT_LOGIC_DELAY_MS = 1500;




export const FRIENDLY_ATTACK_SPOTLIGHT_Z = 2;

/** `-[BattleNode ccTouchBegan:] @ 0xc4788`'s "NOT YOUR TURN" banner is attached by `sub_6522c`
 * (`[[[CCDirector sharedDirector] runningScene] addChild:]`) — i.e. to the scene that OWNS the
 * BattleNode, added last, so it paints over the node's entire subtree by equal-z insertion order.
 * This port's battle scene sorts by `zIndex` instead, so the insertion rule becomes one z above
 * every `sceneManifest()` child (max is `statusText` at 11). It stays far below
 * `POPUP_HOST_Z_INDEX`, matching the source's popups living on `CCDirector.notificationNode`,
 * which is drawn after the running scene and therefore above this banner. */
export const NOT_YOUR_TURN_BANNER_Z = 12;

export function removalLogicHoldMs(removedLivingCount: number): number {
  if (!Number.isInteger(removedLivingCount) || removedLivingCount < 0) {
    throw new Error(`invalid removed-living count: ${removedLivingCount}`);
  }
  return removedLivingCount * REMOVED_LIVING_LOGIC_HOLD_MS;
}

























export function timeDelayGateFrames(pendingMs: number, frameMs: number): number {
  if (!Number.isFinite(pendingMs)) throw new Error(`invalid timeDelay: ${pendingMs}`);
  if (!(frameMs > 0) || !Number.isFinite(frameMs)) throw new Error(`invalid frame size: ${frameMs}`);
  return (pendingMs <= 0 ? 0 : Math.ceil(pendingMs / frameMs)) + 1;
}

/** The negative leftover `update:` carries into the next `+=` (see `timeDelayGateFrames`). */
export function timeDelayResidueMs(pendingMs: number, frameMs: number): number {
  if (!Number.isFinite(pendingMs)) throw new Error(`invalid timeDelay: ${pendingMs}`);
  if (!(frameMs > 0) || !Number.isFinite(frameMs)) throw new Error(`invalid frame size: ${frameMs}`);
  if (pendingMs <= 0) return pendingMs;
  return pendingMs - Math.ceil(pendingMs / frameMs) * frameMs;
}
















export function terminalPacingDelayMs(frontTeam: 0 | 1 | undefined): number {
  return frontTeam === undefined ? 0 : pacingDelayMs(frontTeam);
}










export function terminalPresentationDelayMs(
  winner: 0 | 1,
  removedLivingCount: number,
  frontTeam: 0 | 1 | undefined,
): number {
  return winner === 0
    ? VICTORY_AWARD_STATE_HOLD_MS +
        removalLogicHoldMs(removedLivingCount) +
        terminalPacingDelayMs(frontTeam)
    : DEFEAT_LOGIC_DELAY_MS;
}






export const BACKGROUND_TEXTURE_RECT_PX = { x: 0, y: 0, w: 1024, h: 768 } as const;
/** Background forced texture rect in points: 1024x768px / CSF=2 = 512x384pt (same citation). */
export const BACKGROUND_SIZE = { w: 512, h: 384 } as const;
/** Background iPhone position, explicit float immediates (battle-node.md §2, disasm-confirmed). */
export const BACKGROUND_POS_COCOS = { x: -16, y: -32 } as const;


export const TURN_ORDER_POS_COCOS = { x: 0, y: 315 } as const;







export function backgroundPosCocos(screenW: number, screenH: number): { x: number; y: number } {
  return { x: (screenW - BACKGROUND_SIZE.w) / 2, y: (screenH - BACKGROUND_SIZE.h) / 2 };
}




export function turnOrderPosCocos(screenH: number): { x: number; y: number } {
  return { x: 0, y: screenH - 5 };
}

export type SceneChildKey =
  | "background"
  | "enemyTeamDisplay"
  | "turnOrderDisplay"
  | "friendlyTeamDisplay"
  | "monsterTurnPanel"
  | "abilityRenderer"
  | "statusText";

export interface SceneChild {
  key: SceneChildKey;
  /** `addChild:z:` z-order (battle-node.md scene table). */
  z: number;
  /** Authored Cocos position when BattleNode itself sets one; `null` for children that lay
   *  themselves out internally (battle-node.md: "not set by BattleNode"). */
  posCocos: { x: number; y: number } | null;

  anchorCocos?: { x: number; y: number };
  /** Forced point-space render size, only where the original forces one (background). */
  sizePt?: { w: number; h: number };
  /** `-[BattleNode update:]`-created (player turns only), not built in `onEnterTransitionDidFinish`. */
  lazy?: boolean;
}

/**
 * BattleNode's own child tree, in the binary's `onEnterTransitionDidFinish` add order (which is
 * also ascending z here — battle-node.md §1). battleNode.ts consumes this for z-ordering + the two
 * explicitly-positioned children (background, turnOrderDisplay); the self-laid-out displays carry
 * `posCocos: null`. `monsterTurnPanel` is included with `lazy: true` because it's the one child the
 * scene creates on demand (`update:`), not at build time — but its z-order (3) is part of the same
 * documented contract.
 */
export function sceneManifest(): SceneChild[] {
  return [
    { key: "background", z: -999, posCocos: { ...BACKGROUND_POS_COCOS }, anchorCocos: { x: 0, y: 0 }, sizePt: { ...BACKGROUND_SIZE } },
    { key: "enemyTeamDisplay", z: 1, posCocos: null },
    { key: "turnOrderDisplay", z: 2, posCocos: { ...TURN_ORDER_POS_COCOS } },
    { key: "friendlyTeamDisplay", z: 3, posCocos: null },
    { key: "monsterTurnPanel", z: 3, posCocos: null, lazy: true },
    { key: "abilityRenderer", z: 10, posCocos: null },
    { key: "statusText", z: 11, posCocos: null },
  ];
}
