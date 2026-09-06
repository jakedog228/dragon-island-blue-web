import type { BattleSceneV1 } from "@dib/game-protocol";
import type { DungeonDefinition, WorldData } from "@dib/gamedata";


export const ARENA_COMBAT_BACKGROUND_FILE = "ArenaCombat.png";

export interface BattleSceneSources {
  /** Installed world data, by the id the authority named. */
  readonly world: (worldId: string) => WorldData | undefined;
  /** Restored dungeon definition for an in-flight dungeon battle. */
  readonly dungeon: (dungeonId: string) => DungeonDefinition | undefined;
}

/**
 * Resolve the combat background for an authoritative battle entirely from browser-local content.
 *
 * The authority sends only which scene a battle is fought in — a world POI, a dungeon, the Arena —
 * because it has no business holding the name of a shipped resource. This is the same derivation
 * offline play already performs, so both modes pick their background from one place.
 */
/**
 * Resolve a battle view from whichever installed simulation produced it. The client refuses to
 * enter a session whose simulation is not the installed one, so a historical `backgroundKey` view
 * here means that guard was bypassed — a projection the browser must not render rather than one it
 * should quietly accommodate.
 */
export function installedBattleBackgroundFile(
  battle: { readonly scene: BattleSceneV1 } | { readonly backgroundKey: string },
  sources: BattleSceneSources,
): string {
  if (!("scene" in battle)) {
    throw new Error(
      "official battle projection carries a historical background name; " +
      "this client requires a simulation that sends a semantic scene",
    );
  }
  return battleSceneBackgroundFile(battle.scene, sources);
}

export function battleSceneBackgroundFile(
  scene: BattleSceneV1,
  sources: BattleSceneSources,
): string {
  if (scene.kind === "arena" || scene.kind === "tournament") {
    return ARENA_COMBAT_BACKGROUND_FILE;
  }
  if (scene.kind === "dungeon") {
    const definition = sources.dungeon(scene.dungeonId);
    if (definition === undefined) {
      throw new Error(`official battle scene names unavailable dungeon ${scene.dungeonId}`);
    }
    return definition.presentation.combatBackgroundFile;
  }
  const world = sources.world(scene.worldId);
  if (world === undefined) {
    throw new Error(`official battle scene names unavailable world ${scene.worldId}`);
  }
  const poi = world.pointsOfInterest.find((candidate) => candidate.name === scene.poiId);
  if (poi === undefined) {
    throw new Error(
      `official battle scene names POI ${scene.poiId}, which world ${scene.worldId} does not own`,
    );
  }
  return poi.combatBackground ?? world.combatBackground;
}
