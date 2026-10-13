import { validatePvpInstallation, type PvpAdapterInstallation } from "./pvpAdapters.js";
import { join } from "node:path";
import type { GameData } from "@dib/gamedata";
import type { SaveSlotId } from "@dib/save-protocol";
import { projectOfficialPvpParty, type OfficialGameStateV24 } from "@dib/official-game";
import { PvpCompatibilityRegistry, type PvpModSupport } from "./pvpCompatibility.js";
import { FilePvpStore } from "./pvpStore.js";
import { PvpService, PvpServiceError } from "./pvpService.js";

export function createInstalledPvpService(options: {
  data: GameData; logicPackId: string; dataDirectory: string;
  installation?: PvpAdapterInstallation;
  supportedMods?: readonly PvpModSupport[];
  readOfficialState: (playerId: string, slotId: SaveSlotId) => Promise<OfficialGameStateV24 | undefined>;
}): PvpService {
  const installation = options.installation ?? { profiles: [], mods: [] };
  validatePvpInstallation(installation);
  return new PvpService({
    store: new FilePvpStore(join(options.dataDirectory, "pvp")),
    profiles: new Map([["pvp-baseline-v1", options.data], ...installation.profiles.map((profile) => [profile.id, profile.data] as const)]),
    adapters: new Map(installation.profiles.map((profile) => [profile.id, profile.adapters])),
    compatibility: new PvpCompatibilityRegistry([...(options.supportedMods ?? []), ...installation.mods], [
      ...installation.profiles.map(({ id, logicPackId, rules }) => ({ id, logicPackId, rules })),
      { id: "pvp-baseline-v1", logicPackId: options.logicPackId, rules: [] },
    ]),
    officialParty: async () => { throw new Error("Installed PvP requires the atomic entrant projection"); },
    officialEntrant: async (playerId, slotId, logicPackId) => {
      if (logicPackId !== options.logicPackId) throw new PvpServiceError("INCOMPATIBLE", "Your Official slot and PvP server use different rules.");
      const state = await options.readOfficialState(playerId, slotId);
      if (!state) throw new PvpServiceError("NOT_FOUND", "This Official save slot no longer exists.");
      try { return { party: projectOfficialPvpParty(options.data, state), spirits: { energy: state.profile.spiritEnergy, savedXp: state.profile.spiritSavedXp } }; }
      catch (error) { throw new PvpServiceError("INVALID_REQUEST", error instanceof Error ? error.message : "Your Official party cannot enter PvP."); }
    },
  });
}
