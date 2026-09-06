import type { PlayerGameStateSnapshot } from "./gameState.js";

/** Compact, content-safe hero summary rendered on a save-slot card in the content gate. Derived
 * purely from a already-validated {@link PlayerGameStateSnapshot}; carries no archive-specific
 * identifiers beyond names the player themselves progressed. */
export interface SaveSlotPreview {
  readonly heroLevel: number;
  readonly partySize: number;
  readonly partyTopLevel: number;
  readonly worldName?: string;
  readonly currentPoiName?: string;
}

export function summarizeSaveSlot(state: PlayerGameStateSnapshot): SaveSlotPreview {
  const profile = state.player.profile;
  const heroLevel = profile.schemaVersion === 1 ? profile.heroLevel : profile.hero.level;
  const levels = state.player.party.kind === "standalone-levels"
    ? [...state.player.party.levels]
    : state.player.party.monsters.map((monster) => monster.level);
  return {
    heroLevel,
    partySize: levels.length,
    partyTopLevel: levels.length > 0 ? Math.max(...levels) : 0,
    ...(state.world !== undefined
      ? { worldName: state.world.worldName, currentPoiName: state.world.currentPoiName }
      : {}),
  };
}
