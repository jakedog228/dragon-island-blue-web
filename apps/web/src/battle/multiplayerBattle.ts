import type { BattleEvent, BattleSession, PresentationSessionStep, PvpAction } from "@dib/engine";

export interface MultiplayerResolution {
  events: BattleEvent[];
  abilityPath?: string;
  tier?: number;
  slot?: string;
  spiritId?: string;
  terminal?: boolean;
}
/** Server-committed extension of the ordinary encounter, with the same presentation clock. */
export interface MultiplayerBattle {
  readonly busy: boolean;
  readonly you: 0 | 1;
  readonly session: BattleSession;
  readonly resumedStep: PresentationSessionStep | undefined;
  readonly historyEvents: readonly BattleEvent[];
  resolve(step: Extract<PresentationSessionStep, { type: "awaitingPlayer" }>, action?: PvpAction): Promise<MultiplayerResolution>;
  summon(shortType: string): Promise<MultiplayerResolution>;
  forfeit(): void;
  ended(): void;
}
