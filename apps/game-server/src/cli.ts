import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CommunityHttp } from "./community.js";
import { createCatalogOnlyServer } from "./devCatalog.js";
import { ModCatalog } from "./modCatalog.js";
import { loadOfficialMods } from "./officialMods.js";
import { loadPvpAdapterInstallation } from "./pvpAdapters.js";
import { createInstalledPvpService } from "./pvpRuntime.js";
import { installedPvpMods } from "./pvpSupportedMods.js";
import {
  loadGameData,
  loadCollectionCatalog,
  loadQuestCatalog,
  loadWorldData,
  type WorldResourceSource,
} from "@dib/gamedata";
import { AuthoritativeGameService } from "@dib/game-service";
import { compileExtractedLogicPackIdentityV1 } from "@dib/logic-pack/node";
import {
  GameCommandResultV1Schema,
  OFFICIAL_GAME_V11_SIMULATION_VERSION,
  OFFICIAL_GAME_V12_SIMULATION_VERSION,
  OFFICIAL_GAME_V13_SIMULATION_VERSION,
  OFFICIAL_GAME_V14_SIMULATION_VERSION,
  OFFICIAL_GAME_V15_SIMULATION_VERSION,
  OFFICIAL_GAME_V16_SIMULATION_VERSION,
  OFFICIAL_GAME_V17_SIMULATION_VERSION,
  OFFICIAL_GAME_V18_SIMULATION_VERSION,
  OFFICIAL_GAME_V19_SIMULATION_VERSION,
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
  OFFICIAL_GAME_V21_SIMULATION_VERSION,
  OFFICIAL_GAME_V22_SIMULATION_VERSION,
  OFFICIAL_GAME_V23_SIMULATION_VERSION,
  OFFICIAL_GAME_V24_SIMULATION_VERSION,
  OfficialGameCommandResultV12Schema,
  OfficialGameCommandResultV13Schema,
  OfficialGameCommandResultV14Schema,
  OfficialGameCommandResultV15Schema,
  OfficialGameCommandResultV16Schema,
  OfficialGameCommandResultV17Schema,
  OfficialGameCommandResultV18Schema,
  OfficialGameCommandResultV19Schema,
  OfficialGameCommandResultV20Schema,
  OfficialGameCommandResultV21Schema,
  OfficialGameCommandResultV22Schema,
  OfficialGameCommandResultV23Schema,
  OfficialGameCommandResultV24Schema,
  OfficialGameCommandResultV25Schema,
  OfficialGameProjectionV12Schema,
  OfficialGameProjectionV13Schema,
  OfficialGameProjectionV14Schema,
  OfficialGameProjectionV15Schema,
  OfficialGameProjectionV16Schema,
  OfficialGameProjectionV17Schema,
  OfficialGameProjectionV18Schema,
  OfficialGameProjectionV19Schema,
  OfficialGameProjectionV20Schema,
  OfficialGameProjectionV21Schema,
  OfficialGameProjectionV22Schema,
  OfficialGameProjectionV23Schema,
  OfficialGameProjectionV24Schema,
  OfficialGameProjectionV25Schema,
  SlotProjectionV1Schema,
  type OfficialGameProjectionBodyV25,
} from "@dib/game-protocol";
import {
  OfficialGameV12Reducer,
  OfficialGameV15Reducer,
  OfficialGameV16Reducer,
  OfficialGameV17Reducer,
  OfficialGameV18Reducer,
  OfficialGameV19Reducer,
  OfficialGameV20Reducer,
  OfficialGameV21Reducer,
  OfficialGameV22Reducer,
  OfficialGameV23Reducer,
  OfficialGameV24Reducer,
  OfficialGameV25Reducer,
  createOfficialGameV12LogicPackDescriptor,
  createOfficialGameV15LogicPackDescriptor,
  createOfficialGameV16LogicPackDescriptor,
  createOfficialGameV17LogicPackDescriptor,
  createOfficialGameV18LogicPackDescriptor,
  createOfficialGameV19LogicPackDescriptor,
  createOfficialGameV20LogicPackDescriptor,
  createOfficialGameV21LogicPackDescriptor,
  createOfficialGameV22LogicPackDescriptor,
  createOfficialGameV23LogicPackDescriptor,
  createOfficialGameV24LogicPackDescriptor,
  createOfficialGameV25LogicPackDescriptor,
  createOfficialGameV12Support,
  migrateOfficialGameV11ToV12,
  migrateOfficialGameV12ToV13,
  migrateOfficialGameV13ToV14,
  migrateOfficialGameV14ToV15,
  migrateOfficialGameV15ToV16,
  migrateOfficialGameV16ToV17,
  migrateOfficialGameV17ToV18,
  migrateOfficialGameV18ToV19,
  migrateOfficialGameV19ToV20,
  migrateOfficialGameV20ToV21,
  migrateOfficialGameV21ToV22,
  migrateOfficialGameV22ToV23,
  migrateOfficialGameV23ToV24,
  migrateOfficialGameV24ToV25,
  OfficialGameReducer,
  parseOfficialGameStateV25,
  officialEncounterResources,
  validateOfficialCollectionCatalog,
  validateOfficialGameSupport,
  type OfficialGameStateV25,
} from "@dib/official-game";
import {
  ConfigurationError,
  createGameServer,
  createLogger,
  createRotatingFileSink,
  createScoreboardDirectory,
  FileAuthoritativeSlotStore,
  legacySimulationMigration,
  loadDataDirectory,
  loadGameServerConfig,
  loadHmacSecret,
  SCOREBOARD_CACHE_SECONDS,
  secureUnitRandom,
  startGameServer,
} from "./gameServer.js";
import {
  authorizeLoginToken,
  createAccount,
  generateLoginToken,
  listInvites,
  loginTokenPlayerId,
  readAccount,
  readAuthorizedPlayerIds,
  revokeInvite,
  updateAccountSettings,
} from "./invites.js";
import type { AccountDirectory } from "./gameServer.js";

/**
 * Repository-relative defaults are a development convenience only.
 *
 * The production entrypoint is a single bundled file that may live anywhere, so the root is
 * *discovered* by walking up for the workspace marker rather than assumed to sit a fixed number of
 * levels above this module. Inside a container there is no marker, the result is `undefined`, and
 * the configuration layer then demands every path explicitly instead of inventing one.
 */
function findRepositoryRoot(): string | undefined {
  let directory = import.meta.dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = resolve(directory, "..");
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

const REPOSITORY_ROOT = findRepositoryRoot();
const configOptions = REPOSITORY_ROOT === undefined ? {} : { repositoryRoot: REPOSITORY_ROOT };

async function serve(): Promise<void> {
  const config = loadGameServerConfig(configOptions);
  // stdout always, so `docker logs` and any collector still see the stream live; the file is the
  // copy that outlives the container. Fanning out here keeps `createLogger` unaware of sinks.
  const fileSink = config.logFile === undefined ? undefined : createRotatingFileSink({
    path: config.logFile,
    maxBytes: config.logFileMaxBytes,
    keep: config.logFileKeep,
  });
  const logger = createLogger({
    level: config.logLevel,
    ...(fileSink === undefined ? {} : {
      write: (line: string) => { process.stdout.write(line); fileSink(line); },
    }),
  });
  for (const warning of config.warnings) logger.warn(warning);

  const secret = config.hmacSecret;
  const extractedData = config.extractedDataDirectory;
  const dataDirectory = config.dataDirectory;
  const identity = await compileExtractedLogicPackIdentityV1(extractedData);
  const data = loadGameData(extractedData);
  const worldName = config.startWorld;
  const legacySource: WorldResourceSource = {
    has: (path) => path.endsWith(".plist")
      ? existsSync(resolve(extractedData, `${path.slice(0, -".plist".length)}.json`)) ||
        /-hd\.plist$/.test(path)
      : true,
    plist: (path) => {
      if (!path.endsWith(".plist")) throw new Error(`mechanical plist path expected; got ${path}`);
      return JSON.parse(readFileSync(
        resolve(extractedData, `${path.slice(0, -".plist".length)}.json`),
        "utf8",
      )) as unknown;
    },
  };
  // Keep original dictionaries for historical validation; only current rules retain neutral tuples.
  const mechanicalSource = officialEncounterResources(legacySource);
  const world = loadWorldData(
    mechanicalSource,
    worldName,
    new Set(data.allMonsters().map((monster) => monster.shortType)),
  );
  const worldRegistry = mechanicalSource.plist("Worlds.plist");
  if (worldRegistry === null || typeof worldRegistry !== "object" || Array.isArray(worldRegistry)) {
    throw new Error("Worlds.plist must be an object");
  }
  const worlds = Object.keys(worldRegistry as Record<string, unknown>)
    .sort()
    .map((name) => name === worldName
      ? world
      : loadWorldData(
          mechanicalSource,
          name,
          new Set(data.allMonsters().map((monster) => monster.shortType)),
        ));
  const quests = loadQuestCatalog(mechanicalSource);
  const startTownId = config.startTown;
  const support = validateOfficialGameSupport({
    data,
    world,
    worlds,
    resources: mechanicalSource,
    quests,
    startTownId,
  });
  const collectionCatalog = loadCollectionCatalog(mechanicalSource, data);
  const collectionProof = validateOfficialCollectionCatalog(collectionCatalog, data, support);
  const v12Support = createOfficialGameV12Support({
    support,
    collectionCatalog: collectionProof,
  });
  // The historical delegate descriptors are internal rules identities. Only the current v25
  // `pack` is advertised, persisted, or sent to a player.
  const v12Pack = createOfficialGameV12LogicPackDescriptor(identity.logicPackId, v12Support);
  const v15Pack = createOfficialGameV15LogicPackDescriptor(identity.logicPackId, v12Support);
  const v16Pack = createOfficialGameV16LogicPackDescriptor(identity.logicPackId, v12Support);
  const v17Pack = createOfficialGameV17LogicPackDescriptor(identity.logicPackId, v12Support);
  const v18Pack = createOfficialGameV18LogicPackDescriptor(identity.logicPackId, v12Support);
  const v19Pack = createOfficialGameV19LogicPackDescriptor(identity.logicPackId, v12Support);
  const v20Pack = createOfficialGameV20LogicPackDescriptor(identity.logicPackId, v12Support);
  const v21Pack = createOfficialGameV21LogicPackDescriptor(identity.logicPackId, v12Support);
  const v22Pack = createOfficialGameV22LogicPackDescriptor(identity.logicPackId, v12Support);
  const v23Pack = createOfficialGameV23LogicPackDescriptor(identity.logicPackId, v12Support);
  const v24Pack = createOfficialGameV24LogicPackDescriptor(identity.logicPackId, v12Support);
  const pack = createOfficialGameV25LogicPackDescriptor(identity.logicPackId, v12Support);
  const legacyReducer = new OfficialGameReducer({
    data,
    world,
    worlds,
    resources: mechanicalSource,
    quests,
    startTownId,
    support,
    random: secureUnitRandom,
  });
  const v15Reducer = new OfficialGameV15Reducer(
    new OfficialGameV12Reducer(legacyReducer, v12Support),
    v12Pack,
  );
  const v16Reducer = new OfficialGameV16Reducer(v15Reducer, v15Pack);
  const v17Reducer = new OfficialGameV17Reducer(v16Reducer, v16Pack);
  const v18Reducer = new OfficialGameV18Reducer(v17Reducer, v17Pack);
  const v19Reducer = new OfficialGameV19Reducer(v18Reducer, v18Pack);
  const v20Reducer = new OfficialGameV20Reducer(v19Reducer, v19Pack);
  const v21Reducer = new OfficialGameV21Reducer(v20Reducer, v20Pack);
  const v22Reducer = new OfficialGameV22Reducer(v21Reducer, v21Pack);
  const v23Reducer = new OfficialGameV23Reducer(v22Reducer, v22Pack);
  const v24Reducer = new OfficialGameV24Reducer(v23Reducer, v23Pack);
  const reducer = new OfficialGameV25Reducer(v24Reducer, v24Pack);
  const migrationContext = { dungeonResources: legacySource } as const;
  // v24 -> v25 also repairs provable `dialogsSeen` entries from durable license and fixed-encounter
  // state, so it needs the installed worlds and dungeon resources, never a client input.
  const migrateV24StateToCurrent = (state: unknown) => migrateOfficialGameV24ToV25({
    data, quests, worlds, state, context: migrationContext,
  });
  const migrateV23StateToCurrent = (state: unknown) => migrateV24StateToCurrent(
    migrateOfficialGameV23ToV24({ data, quests, state, context: migrationContext }),
  );
  const migrateV22StateToCurrent = (state: unknown) => migrateV23StateToCurrent(migrateOfficialGameV22ToV23({
    data, quests, state, context: migrationContext,
  }));
  const migrateV21StateToCurrent = (state: unknown) => migrateV22StateToCurrent(
    migrateOfficialGameV21ToV22({ data, quests, state, context: migrationContext }),
  );
  const migrateV20StateToCurrent = (state: unknown) => migrateV21StateToCurrent(
    migrateOfficialGameV20ToV21({ data, quests, state, context: migrationContext }),
  );
  const migrateV19StateToCurrent = (state: unknown) => migrateV20StateToCurrent(
    migrateOfficialGameV19ToV20({ data, quests, state, context: migrationContext }),
  );
  const migrateV18StateToCurrent = (state: unknown) => migrateV19StateToCurrent(
    migrateOfficialGameV18ToV19({ data, quests, state, context: migrationContext }),
  );
  const migrateV17StateToCurrent = (state: unknown) => migrateV18StateToCurrent(
    migrateOfficialGameV17ToV18({ data, quests, state, context: migrationContext }),
  );
  const migrateV16StateToCurrent = (state: unknown) => migrateV17StateToCurrent(
    migrateOfficialGameV16ToV17({ data, quests, state, context: migrationContext }),
  );
  // Bound to its own name rather than constructed inline: the scoreboard reads persisted
  // projections directly, because the service's slot listing deliberately summarises without them.
  const store = new FileAuthoritativeSlotStore<OfficialGameStateV25, OfficialGameProjectionBodyV25>(
    {
      dataDirectory,
      logicPackId: pack.logicPackId,
      simulationVersion: pack.simulationVersion,
      worldId: world.name,
      parseState: (value) => parseOfficialGameStateV25(data, quests, value, {
        dungeonResources: mechanicalSource,
      }),
      parseProjection: (value) => OfficialGameProjectionV25Schema.parse(value),
      parseCommandResult: (value) => OfficialGameCommandResultV25Schema.parse(value),
      validateRecord: (record) => reducer.validatePersistedRecord(record),
      // Immutable source namespaces are retained after each upgrade and the store selects the
      // first source that exists. Keep this literal easy to review chronologically, then consult it
      // newest-first so a stale v11 file can never outrank the player's later v20 state.
      legacyMigrations: [
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V11_SIMULATION_VERSION,
          // Each source declares the shape it was actually written in. The current-namespace
          // parsers above are v25 and reject every earlier projection, so reusing them here would
          // strand the very accounts the migration exists to carry forward.
          parseSourceProjection: (value) => SlotProjectionV1Schema.parse(value),
          parseSourceCommandResult: (value) => GameCommandResultV1Schema.parse(value),
          migrate: ({ state, projection, updatedAt, lastLocationCommand }) => {
            const migratedV13 = migrateOfficialGameV12ToV13({
              data,
              quests,
              state: migrateOfficialGameV11ToV12({
                data,
                quests,
                state,
                projection,
                context: { dungeonResources: legacySource },
              }),
              context: { dungeonResources: legacySource },
            });
            const migratedV14 = migrateOfficialGameV13ToV14({
              data,
              quests,
              state: migratedV13,
              context: { dungeonResources: legacySource },
            });
            const migratedV15 = migrateOfficialGameV14ToV15({
              data,
              quests,
              state: migratedV14,
              updatedAt,
              ...(lastLocationCommand === undefined ? {} : { lastLocationCommand }),
              context: { dungeonResources: legacySource },
            });
            const migratedState = migrateOfficialGameV15ToV16({
              data,
              quests,
              state: migratedV15,
              context: { dungeonResources: legacySource },
            });
            const currentState = migrateV16StateToCurrent(migratedState);
            return {
              state: currentState,
              projection: reducer.projectPersistedState(currentState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV12Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV12Schema.parse(value),
          migrate: ({ state, updatedAt, lastLocationCommand }) => {
            const migratedV13 = migrateOfficialGameV12ToV13({
              data,
              quests,
              state,
              context: { dungeonResources: legacySource },
            });
            const migratedV14 = migrateOfficialGameV13ToV14({
              data,
              quests,
              state: migratedV13,
              context: { dungeonResources: legacySource },
            });
            const migratedV15 = migrateOfficialGameV14ToV15({
              data,
              quests,
              state: migratedV14,
              updatedAt,
              ...(lastLocationCommand === undefined ? {} : { lastLocationCommand }),
              context: { dungeonResources: legacySource },
            });
            const migratedState = migrateOfficialGameV15ToV16({
              data,
              quests,
              state: migratedV15,
              context: { dungeonResources: legacySource },
            });
            const currentState = migrateV16StateToCurrent(migratedState);
            return {
              state: currentState,
              projection: reducer.projectPersistedState(currentState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V13_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV13Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV13Schema.parse(value),
          migrate: ({ state, updatedAt, lastLocationCommand }) => {
            const migratedV14 = migrateOfficialGameV13ToV14({
              data,
              quests,
              state,
              context: { dungeonResources: legacySource },
            });
            const migratedV15 = migrateOfficialGameV14ToV15({
              data,
              quests,
              state: migratedV14,
              updatedAt,
              ...(lastLocationCommand === undefined ? {} : { lastLocationCommand }),
              context: { dungeonResources: legacySource },
            });
            const migratedState = migrateOfficialGameV15ToV16({
              data,
              quests,
              state: migratedV15,
              context: { dungeonResources: legacySource },
            });
            const currentState = migrateV16StateToCurrent(migratedState);
            return {
              state: currentState,
              projection: reducer.projectPersistedState(currentState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V14_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV14Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV14Schema.parse(value),
          migrate: ({ state, updatedAt, lastLocationCommand }) => {
            const migratedV15 = migrateOfficialGameV14ToV15({
              data,
              quests,
              state,
              updatedAt,
              ...(lastLocationCommand === undefined ? {} : { lastLocationCommand }),
              context: { dungeonResources: legacySource },
            });
            const migratedState = migrateOfficialGameV15ToV16({
              data,
              quests,
              state: migratedV15,
              context: { dungeonResources: legacySource },
            });
            const currentState = migrateV16StateToCurrent(migratedState);
            return {
              state: currentState,
              projection: reducer.projectPersistedState(currentState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V15_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV15Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV15Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateOfficialGameV15ToV16({
              data,
              quests,
              state,
              context: { dungeonResources: legacySource },
            });
            const currentState = migrateV16StateToCurrent(migratedState);
            return {
              state: currentState,
              projection: reducer.projectPersistedState(currentState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V16_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV16Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV16Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV16StateToCurrent(state);
            return {
              state: migratedState,
              projection: reducer.projectPersistedState(migratedState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V17_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV17Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV17Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV17StateToCurrent(state);
            return {
              state: migratedState,
              projection: reducer.projectPersistedState(migratedState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V18_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV18Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV18Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV18StateToCurrent(state);
            return {
              state: migratedState,
              projection: reducer.projectPersistedState(migratedState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V19_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV19Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV19Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV19StateToCurrent(state);
            return {
              state: migratedState,
              projection: reducer.projectPersistedState(migratedState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V20_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV20Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV20Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV20StateToCurrent(state);
            return {
              state: migratedState,
              projection: reducer.projectPersistedState(migratedState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V21_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV21Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV21Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV21StateToCurrent(state);
            return {
              state: migratedState,
              projection: reducer.projectPersistedState(migratedState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V22_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV22Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV22Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV22StateToCurrent(state);
            return {
              state: migratedState,
              projection: reducer.projectPersistedState(migratedState),
            };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V23_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV23Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV23Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV23StateToCurrent(state);
            return { state: migratedState, projection: reducer.projectPersistedState(migratedState) };
          },
        }),
        legacySimulationMigration({
          sourceSimulationVersion: OFFICIAL_GAME_V24_SIMULATION_VERSION,
          parseSourceProjection: (value) => OfficialGameProjectionV24Schema.parse(value),
          parseSourceCommandResult: (value) => OfficialGameCommandResultV24Schema.parse(value),
          migrate: ({ state }) => {
            const migratedState = migrateV24StateToCurrent(state);
            return { state: migratedState, projection: reducer.projectPersistedState(migratedState) };
          },
        }),
      ].reverse(),
    },
  );
  const service = new AuthoritativeGameService<OfficialGameStateV25, OfficialGameProjectionBodyV25>({
    pack,
    reducer,
    validateRecord: (record) => reducer.validatePersistedRecord(record),
    store,
  });
  const bootstrapInvited = new Set(
    config.bootstrapInviteTokens.map((token) => loginTokenPlayerId(secret, token)),
  );
  const durableInvited = await readAuthorizedPlayerIds(dataDirectory);
  // The registry is both the authorization list and the account store, so the directory is a thin
  // adapter over the same file the invite subcommands write.
  const accounts: AccountDirectory = {
    create: async ({ username, publicScoreboard }) => createAccount({
      dataDirectory,
      hmacSecret: secret,
      username,
      publicScoreboard,
      maxAccounts: config.maxAccounts,
    }),
    read: async (playerId) => readAccount(dataDirectory, playerId),
    updateSettings: async (playerId, patch) =>
      updateAccountSettings(dataDirectory, playerId, patch),
  };
  // Unlike `isInvited` below, this one *does* cache. A login reloads one small registry; a board
  // read reloads it and then fans out over every public account's saves, from an unauthenticated
  // route, so serving repeats from disk would make the cheapest request the most expensive one.
  const scoreboard = createScoreboardDirectory({
    dataDirectory,
    store,
    cacheTtlMs: SCOREBOARD_CACHE_SECONDS * 1000,
    logger,
  });
  // Fail startup on a malformed shipped package rather than serving a partial Official catalog.
  const officialMods = config.officialModsDirectory ? await loadOfficialMods(config.officialModsDirectory) : [];
  const pvpMods = config.pvpEnabled ? await installedPvpMods(officialMods) : [];
  const pvpInstallation = config.pvpEnabled ? await loadPvpAdapterInstallation(config.pvpAdaptersModule, { data, logicPackId: pack.logicPackId }) : undefined;
  const server = createGameServer({
    ...(config.pvpEnabled ? { pvp: createInstalledPvpService({
      data, logicPackId: pack.logicPackId, dataDirectory,
      supportedMods: pvpMods,
      ...(pvpInstallation ? { installation: pvpInstallation } : {}),
      readOfficialState: async (playerId, slotId) => {
        const record = await store.read(playerId, slotId);
        if (record === undefined) return undefined;
        reducer.validatePersistedRecord(record);
        return record.state;
      },
    }) } : {}),
    // Official mods alone enable public catalog reads; uploads additionally need the author origin.
    ...(config.communityOrigin || officialMods.length > 0 ? { community: new CommunityHttp({
      directory: config.communityDirectory, accountDirectory: dataDirectory,
      hmacSecret: config.hmacSecret, authorOrigin: config.communityOrigin,
      registrationEnabled: config.registrationEnabled, maxAccounts: config.maxAccounts,
      trustProxy: config.trustProxy, official: officialMods,
    }) } : {}),
    hmacSecret: secret,
    services: [service],
    accounts,
    scoreboard,
    registrationEnabled: config.registrationEnabled,
    // Authentication is infrequent and intentionally reloads the small registry. Tokens minted or
    // revoked by a second CLI process therefore affect new logins without restarting the server.
    isInvited: async (candidate) =>
      bootstrapInvited.has(candidate) ||
      (await readAuthorizedPlayerIds(dataDirectory)).has(candidate),
    allowedOrigins: config.allowedOrigins,
    rateLimit: {
      session: config.sessionRateLimit,
      command: config.commandRateLimit,
      registration: config.registrationRateLimit,
      scoreboard: config.scoreboardRateLimit,
    },
    trustProxy: config.trustProxy,
    logger,
  });

  await startGameServer({
    server,
    port: config.port,
    host: config.bindHost,
    logger,
    shutdownGraceMs: config.shutdownGraceMs,
  });

  logger.info("authoritative game API listening", {
    environment: config.environment,
    address: `http://${config.bindHost}:${config.port}`,
    logicPackId: pack.logicPackId,
    simulationVersion: pack.simulationVersion,
    dataDirectory,
    extractedDataDirectory: extractedData,
    worldId: world.name,
    durableInviteCount: durableInvited.size,
    bootstrapInviteCount: bootstrapInvited.size,
    registrationEnabled: config.registrationEnabled,
    registrationRatePerMinute: config.registrationRateLimit.perMinute,
    maxAccounts: config.maxAccounts,
    scoreboardCacheSeconds: SCOREBOARD_CACHE_SECONDS,
    allowedOriginCount: config.allowedOrigins.length,
    trustProxy: config.trustProxy,
  });
}

/**
 * `catalog`: development only. Serves the Official mods from a directory of `.dibmod` files
 * (default `examples/mods/dist/official`, written by `pnpm mods:examples`) without the authoritative API,
 * so Offline development can browse and install mods. Production publishes official mods through
 * `serve` with DIB_OFFICIAL_MODS_DIR instead.
 */
async function serveCatalog(): Promise<void> {
  if (process.env["DIB_GAME_ENV"] === "production") {
    throw new Error("catalog is a development command. Production serves official mods from `serve` with DIB_OFFICIAL_MODS_DIR.");
  }
  const configured = process.env["DIB_OFFICIAL_MODS_DIR"];
  const directory = configured ? resolve(configured)
    : REPOSITORY_ROOT === undefined ? undefined : resolve(REPOSITORY_ROOT, "examples/mods/dist/official");
  if (directory === undefined || !existsSync(directory)) {
    throw new Error(`No official mods directory at ${directory ?? "(unset)"}. Run pnpm mods:examples or set DIB_OFFICIAL_MODS_DIR.`);
  }
  const port = Number(process.env["DIB_GAME_PORT"] ?? "8788");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DIB_GAME_PORT must be a TCP port.");
  const host = process.env["DIB_GAME_BIND_HOST"] ?? "127.0.0.1";
  // Same default location `serve` uses, read-only here: listings published through a local
  // author-portal session still show up, and a missing directory is simply an empty catalog.
  const dataDirectory = process.env["DIB_GAME_DATA_DIR"] ?? resolve(REPOSITORY_ROOT ?? ".", ".dib-game-data");
  const communityDirectory = resolve(process.env["DIB_COMMUNITY_DATA_DIR"] ?? resolve(dataDirectory, "community"));
  // Fail on a malformed package exactly as `serve` does rather than listing a partial catalog.
  const official = await loadOfficialMods(directory);
  const logger = createLogger();
  await startGameServer({ server: createCatalogOnlyServer({ official, communityDirectory }), port, host, logger });
  logger.info("development mod catalog listening (no Online play)", {
    address: `http://${host}:${port}`,
    officialModsDirectory: directory,
    officialModCount: official.length,
  });
}

/**
 * `invite [--username <name>] [label...]`. Supplying a username gives an operator-issued token a
 * full account (and therefore the in-game scoreboard setting); without one it authorizes play only.
 */
async function invite(args: readonly string[]): Promise<void> {
  const usernameIndex = args.indexOf("--username");
  if (usernameIndex !== -1 && args[usernameIndex + 1] === undefined) {
    throw new Error("usage: invite [--username <name>] [label...]");
  }
  const username = usernameIndex === -1 ? undefined : args[usernameIndex + 1];
  const label = args
    .filter((_, index) => usernameIndex === -1 || (index !== usernameIndex && index !== usernameIndex + 1))
    .join(" ") || undefined;
  const token = generateLoginToken();
  const playerId = await authorizeLoginToken({
    dataDirectory: loadDataDirectory(configOptions),
    hmacSecret: loadHmacSecret(configOptions),
    token,
    ...(label === undefined ? {} : { label }),
    ...(username === undefined ? {} : { username, publicScoreboard: false }),
  });
  process.stdout.write(
    `Official online login token issued${label ? ` for "${label}"` : ""}` +
    `${username ? ` as ${JSON.stringify(username)}` : ""}. ` +
    `Share it privately; it is not recoverable.\n\n  ${token}\n\nPlayer id: ${playerId}\n`,
  );
}

async function inviteList(): Promise<void> {
  const invites = await listInvites(loadDataDirectory(configOptions));
  if (invites.length === 0) {
    process.stdout.write("No Official online login tokens have been invited yet.\n");
    return;
  }
  for (const record of invites) {
    const account = record.username === undefined
      ? ""
      : `  ${record.username} (${record.publicScoreboard ? "public" : "private"} scoreboard)`;
    process.stdout.write(
      `${record.issuedAt}  ${record.playerId}${record.label ? `  ${record.label}` : ""}${account}\n`,
    );
  }
}

async function inviteRevoke(playerId: string | undefined): Promise<void> {
  if (playerId === undefined) throw new Error("usage: invite:revoke <player-id>");
  const removed = await revokeInvite(loadDataDirectory(configOptions), playerId);
  process.stdout.write(removed ? `Revoked ${playerId}.\n` : `No invite found for ${playerId}.\n`);
}

const [command, ...rest] = process.argv.slice(2);
const run = async (): Promise<void> => {
  switch (command ?? "serve") {
    case "config:check": {
      // Read and validate only: no listener, registry writes, migrations, or state mutations.
      loadGameServerConfig(configOptions);
      process.stdout.write("Authoritative server configuration is valid.\n");
      return;
    }
    case "serve": return serve();
    case "catalog": return serveCatalog();
    case "invite": return invite(rest);
    case "invite:list": return inviteList();
    case "invite:revoke": return inviteRevoke(rest[0]);
    case "mods:hide":
    case "mods:restore": {
      if (!rest[0]) throw new Error(`usage: ${command} <listing-id>`);
      const config = loadGameServerConfig(configOptions);
      await new ModCatalog(config.communityDirectory).moderate(rest[0], command === "mods:hide");
      process.stdout.write(command === "mods:hide" ? "Listing hidden; author cannot republish.\n" : "Publishing allowed again; listing remains unpublished.\n");
      return;
    }
    case "mods:backup": {
      if (!rest[0]) throw new Error("usage: mods:backup <new-destination-directory>");
      const config = loadGameServerConfig(configOptions);
      await new ModCatalog(config.communityDirectory).backup(rest[0]);
      process.stdout.write("Community snapshot complete. Back up invites.json and the HMAC secret separately.\n");
      return;
    }
    default:
      throw new Error(
        `unknown command "${command}" (expected serve, config:check, catalog, invite, invite:list, invite:revoke, mods:hide, mods:restore, mods:backup)`,
      );
  }
};

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  if (error instanceof ConfigurationError) {
    process.stderr.write("\nSee docs/deployment.md for the full environment reference.\n");
  }
  process.exitCode = 1;
});
