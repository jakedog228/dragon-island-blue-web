import {
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
  OFFICIAL_GAME_V21_SIMULATION_VERSION,
  OFFICIAL_GAME_V22_SIMULATION_VERSION,
  OFFICIAL_GAME_V23_SIMULATION_VERSION,
} from "@dib/game-protocol";

/**
 * Reconcile a Tournament Escape or successful Save Me before replacing the BattleNode.
 *
 * Official v19 Escape and v20 Save Me commit the town return and restored player projection in
 * the same terminal decision. The outgoing battle still owns its local, damaged mirrors, so those
 * mirrors must be replaced before the world/town scene is rebuilt. Local play has no authoritative
 * projection to adopt. Keeping the complete sequence here prevents the presentation callback from
 * drifting away from the terminal scene replacement.
 */
export async function runTournamentRetreatReturn(options: {
  readonly authoritative: boolean;
  readonly adoptOfficialProjection: () => void;
  readonly presentRetainedOfficialQuestEvents: () => void;
  readonly showTournamentLostChat: () => Promise<void>;
  readonly startWorld: () => Promise<void>;
}): Promise<void> {
  if (options.authoritative) {
    options.adoptOfficialProjection();
    options.presentRetainedOfficialQuestEvents();
  }
  await options.showTournamentLostChat();
  await options.startWorld();
}

/**
 * Reconnect owns a wider union of active battle projections. Select v20+'s Tournament-only Save Me
 * return before the historical world/dungeon replacement branch, and keep its presentation order
 * independently testable from boot orchestration.
 */
export async function runOfficialTournamentSaveMeReconnect(options: {
  readonly simulationVersion: string;
  readonly battle: unknown;
  readonly teardownCombatMonsters: () => void;
  readonly adoptOfficialProjection: () => void;
  readonly presentRetainedOfficialQuestEvents: () => void;
  readonly showTournamentLostChat: () => Promise<void>;
  readonly startWorld: () => Promise<void>;
}): Promise<boolean> {
  const battle = options.battle;
  const scene = typeof battle === "object" && battle !== null && "scene" in battle
    ? battle.scene
    : undefined;
  const sceneKind = typeof scene === "object" && scene !== null && "kind" in scene
    ? scene.kind
    : undefined;
  if (
    (
      options.simulationVersion !== OFFICIAL_GAME_V20_SIMULATION_VERSION &&
      options.simulationVersion !== OFFICIAL_GAME_V21_SIMULATION_VERSION &&
      options.simulationVersion !== OFFICIAL_GAME_V22_SIMULATION_VERSION &&
      options.simulationVersion !== OFFICIAL_GAME_V23_SIMULATION_VERSION
    ) ||
    sceneKind !== "tournament"
  ) {
    return false;
  }
  options.teardownCombatMonsters();
  await runTournamentRetreatReturn({
    authoritative: true,
    adoptOfficialProjection: options.adoptOfficialProjection,
    presentRetainedOfficialQuestEvents: options.presentRetainedOfficialQuestEvents,
    showTournamentLostChat: options.showTournamentLostChat,
    startWorld: options.startWorld,
  });
  return true;
}
