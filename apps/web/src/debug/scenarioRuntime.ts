import {
  emptyGuildQuestStateSnapshot,
} from "@dib/engine";
import type { ImportedContentPackage } from "../content/archivePackage.js";
import type { LoadedGame } from "../loadGame.js";
import { PlayerRuntimeState } from "../player/playerRuntimeState.js";
import {
  DEMO_PLAYER_PROFILE_DEFAULTS,
  establishedPlayerTutorialFlags,
} from "../player/demoPlayerProfile.js";
import type { PlayerGameStateSnapshot } from "../player/gameState.js";
import {
  type EncounterConfig,
} from "../battle/encounter.js";
import {
  createRandomDemoParty,
  DEMO_WORLD_CONFIG,
} from "../world/worldDemoState.js";
import { rosterRng } from "../battle/rosterSampler.js";
import { loadQuestCatalog, loadWorldData } from "@dib/gamedata/browser";
import type { GemSlot, PlayerInventoryStateV1 } from "@dib/player-domain";
import type {
  ScenarioConfiguration,
  ScenarioRuntime,
} from "./scenarioMode.js";

export function buildScenarioRuntime(
  game: LoadedGame,
  content: ImportedContentPackage,
  requested: ScenarioConfiguration,
  preparedFixedEncounter?: EncounterConfig,
): { readonly runtime: ScenarioRuntime; readonly state: PlayerGameStateSnapshot } {
  const seed = requested.randomize ? crypto.getRandomValues(new Uint32Array(1))[0]! : requested.seed;
  const configuration = Object.freeze({ ...requested, seed });
  if (configuration.kind === "combat") {
    const fixed = configuration.fixedCombat;
    if (fixed === undefined || preparedFixedEncounter === undefined) {
      throw new Error("Fixed combat Scenario was not prepared before GameData loaded.");
    }
    const encounter = preparedFixedEncounter;
    const resources = fixed.resources;
    const equippedGems = Object.fromEntries(resources.equippedGems.flatMap((gem, slot) =>
      gem === null
        ? []
        : [[slot, {
            kind: "gem" as const,
            id: `item-${slot + 1}`,
            definitionPath: `Gems.ScenarioSlot${slot + 1}`,
            instanceName: `ScenarioSlot${slot + 1}`,
            level: gem.level,
            quality: gem.quality,
            slot: slot as GemSlot,
            enabledStats: [...gem.enabledStats],
          }]] as const,
    ));
    const inventory: PlayerInventoryStateV1 = {
      schemaVersion: 1,
      nextItemSequence: resources.equippedGems.length + 1,
      looseItems: [],
      equippedGems,
    };
    const runtime = PlayerRuntimeState.standalone(
      {
        ...DEMO_PLAYER_PROFILE_DEFAULTS,
        heroLevel: resources.heroLevel,
        silver: resources.silver,
        gold: resources.gold,
        captureCards: { ...resources.captureCards },
        spiritReadiness: resources.spiritReadiness,
        spiritTierLevels: { ...resources.spiritTierLevels },
        inventory,
        skillPoints: { ...resources.skillPoints },
        highestCapturedLevels: Object.fromEntries(
          fixed.playerTeam.map(({ shortType, level }) => [shortType, level]),
        ),
        monsterPartyLevels: encounter.playerTeam.map(({ level }) => level),
      },
      { hasCapturedSimpleType: () => true },
    );
    return {
      runtime: { configuration, encounter },
      state: { schemaVersion: 1, player: runtime.stateSnapshot() },
    };
  }

  if (content.worldNames.length === 0 || !content.hasTownCapability) {
    throw new Error(`${configuration.kind} Scenario requires world and town content.`);
  }
  const worldName = content.worldNames.includes(DEMO_WORLD_CONFIG.worldName)
    ? DEMO_WORLD_CONFIG.worldName
    : content.worldNames[0]!;
  const world = loadWorldData(
    content.resources,
    worldName,
    new Set(game.gd.allMonsters().map(({ shortType }) => shortType)),
  );
  const town = world.pointsOfInterest.find(({ town }) => town !== undefined);
  if (town === undefined) throw new Error(`${worldName} has no town for Scenario mode.`);

  const party = createRandomDemoParty(game.gd, rosterRng(seed), {
    size: 6,
    battingOrderSize: game.gd.license("Novice").battingOrderSize,
    levelRange: configuration.kind === "arena" ? [30, 34] : [18, 22],
  });
  const authoredTownFlags = world.pointsOfInterest.flatMap(({ town }) =>
    (town?.buildings ?? []).flatMap(({ tutorialFlashKey }) =>
      tutorialFlashKey === undefined ? [] : [tutorialFlashKey]));
  const nextLicense = game.gd.allLicenses()[1];
  const heroLevel = configuration.kind === "arena"
    ? Math.max(30, nextLicense?.heroLevelRequired ?? 1)
    : 30;
  const runtime = PlayerRuntimeState.world({
    ...DEMO_PLAYER_PROFILE_DEFAULTS,
    heroLevel,
    silver: 50_000,
    gold: 10_000,
    captureCards: { 1: 20, 2: 20, 3: 20 },
    highestCapturedLevels: Object.fromEntries(
      party.monsters().map(({ shortType, level }) => [shortType, level]),
    ),
    tutorialFlags: establishedPlayerTutorialFlags(authoredTownFlags),
    monsterPartyLevels: party.monsters().map(({ level }) => level),
  }, party);

  const emptyQuests = emptyGuildQuestStateSnapshot();
  if (configuration.kind === "arena" && !content.resources.has("Quests.plist")) {
    throw new Error("Arena Scenario requires Quests.plist to build a qualified transient player.");
  }
  const quests = content.resources.has("Quests.plist")
    ? (() => {
        const catalog = loadQuestCatalog(content.resources);
        const required = configuration.kind === "arena"
          ? nextLicense?.completedQuestsRequired ?? 0
          : 0;
        if (required > catalog.definitions.length) {
          throw new Error(
            `Arena Scenario needs ${required} completed quests, but the package defines only ` +
              `${catalog.definitions.length}.`,
          );
        }
        return {
          ...emptyQuests,
          finishedQuestNames: catalog.definitions.slice(0, required).map(({ name }) => name),
        };
      })()
    : undefined;
  return {
    runtime: {
      configuration,
      worldAction: configuration.kind,
    },
    state: {
      schemaVersion: 1,
      player: runtime.stateSnapshot(),
      ...(quests === undefined ? {} : { quests }),
      world: {
        schemaVersion: 1,
        worldName,
        currentPoiName: town.name,
        refresh: { occurrenceByPoi: {}, completedPois: [] },
        poiWins: {},
        dayNumber: 1,
        everCompletedPois: [],
        lastTownName: town.name,
      },
    },
  };
}
