import {
  GAME_PROTOCOL_VERSION,
  type AuthoritativeSlotSummaryV1,
  type GameCommandV1,
  type SlotProjectionV1,
} from "@dib/game-protocol";
import {
  SAVE_SLOT_IDS,
  type SaveSlotId,
  type SaveSlotSummary,
} from "@dib/save-protocol";
import type { PlayerGameStateSnapshot } from "../player/gameState.js";
import { parseDungeonRunSnapshot, type DungeonRunSnapshot } from "@dib/engine/dungeon-runtime";
import type { GemInventoryItem, PlayerInventoryStateV1 } from "@dib/player-domain";
import type { SaveSession, SaveSlotStore } from "../player/saveStore.js";
import { CommandCoordinator } from "./commandCoordinator.js";
import type { GameAuthority } from "./gameAuthorityClient.js";
import type { InstalledSlotProjection } from "./gameAuthorityClient.js";

export interface OfficialSlotSession {
  readonly coordinator: CommandCoordinator;
  readonly projection: InstalledSlotProjection;
  readonly snapshot: PlayerGameStateSnapshot;
}

/**
 * Startup compatibility view over an authoritative slot service.
 *
 * Existing title/save-select presentation reads the ordinary SaveSlotStore surface. In official
 * mode that surface is strictly read-only: autosave callbacks are deliberate no-ops, and the only
 * network mutations are semantic commands sent through CommandCoordinator.
 */
export class OfficialAuthoritySaveStore implements SaveSlotStore {
  private readonly projections = new Map<SaveSlotId, InstalledSlotProjection>();
  private readonly coordinators = new Map<SaveSlotId, CommandCoordinator>();
  private readonly projectionUnsubscribers = new Map<SaveSlotId, () => void>();

  constructor(readonly authority: GameAuthority) {}

  get slots(): readonly SaveSlotSummary[] {
    return this.authority.slots.map(toSaveSummary);
  }

  summary(slotId: SaveSlotId): SaveSlotSummary | undefined {
    const summary = this.authority.slots.find((candidate) => candidate.slotId === slotId);
    return summary === undefined ? undefined : toSaveSummary(summary);
  }

  async loadSlotState(slotId: SaveSlotId): Promise<PlayerGameStateSnapshot | undefined> {
    if (this.summary(slotId) === undefined) return undefined;
    const existing = this.coordinators.get(slotId);
    const projection = existing === undefined
      ? await this.authority.bootstrap(slotId)
      : await existing.resync();
    this.remember(projection);
    return projectionToGameState(projection);
  }

  open(slotId: SaveSlotId): SaveSession {
    return {
      slotId,
      load: async () => {
        const projection = this.projections.get(slotId);
        return projection === undefined ? this.loadSlotState(slotId) : projectionToGameState(projection);
      },
      // Client-authored snapshots never cross the official authority boundary.
      save: async () => {},
      flush: async () => {},
    };
  }

  async ensureSlot(
    slotId: SaveSlotId,
    starterShortType?: string,
  ): Promise<OfficialSlotSession> {
    if (!SAVE_SLOT_IDS.includes(slotId)) throw new Error(`unsupported save slot ${slotId}`);
    let projection = this.projections.get(slotId);
    if (projection === undefined && this.summary(slotId) !== undefined) {
      projection = await this.authority.bootstrap(slotId);
    }
    if (projection === undefined) {
      const result = await this.authority.command(slotId, {
        protocolVersion: GAME_PROTOCOL_VERSION,
        commandId: commandId(),
        expectedRevision: 0,
        command: {
          type: "slot.create",
          starterElement: starterElementFor(starterShortType),
        },
      });
      projection = result.projection;
    }
    this.remember(projection);
    const coordinator = this.requireCoordinator(slotId);

    projection = coordinator.projection;
    this.remember(projection);
    return {
      coordinator,
      projection,
      snapshot: projectionToGameState(projection),
    };
  }

  coordinator(slotId: SaveSlotId): CommandCoordinator {
    return this.requireCoordinator(slotId);
  }

  private remember(projection: InstalledSlotProjection): void {
    this.projections.set(projection.slotId, projection);
    const coordinator = this.coordinators.get(projection.slotId);
    if (coordinator !== undefined) return;
    const created = new CommandCoordinator(this.authority, projection.slotId, projection);
    this.coordinators.set(projection.slotId, created);
    this.projectionUnsubscribers.set(
      projection.slotId,
      created.subscribeProjection((current) => {
        this.projections.set(current.slotId, current);
      }),
    );
  }

  private requireCoordinator(slotId: SaveSlotId): CommandCoordinator {
    const coordinator = this.coordinators.get(slotId);
    if (coordinator === undefined) throw new Error(`official slot ${slotId} has not been bootstrapped`);
    return coordinator;
  }
}

export function projectionToGameState(projection: InstalledSlotProjection): PlayerGameStateSnapshot {
  const byId = new Map(projection.player.party.map((monster) => [monster.instanceId, monster]));
  const ordered = [
    ...projection.player.battingOrderIds.map((id) => {
      const monster = byId.get(id);
      if (monster === undefined) throw new Error(`projection batting order references missing ${id}`);
      byId.delete(id);
      return monster;
    }),
    ...projection.player.party.filter((monster) => byId.has(monster.instanceId)),
  ];
  const world = projection.world;
  const quests = projection.quests;
  const projectedInventory = projection.player.inventory;
  const inventory = projectedInventory === undefined
    ? undefined
    : (() => {
        const equippedGems: Partial<Record<0 | 1 | 2 | 3, GemInventoryItem>> = {};
        for (const slot of [0, 1, 2, 3] as const) {
          const gem = projectedInventory.equippedGems[slot];
          if (gem !== undefined) equippedGems[slot] = { ...gem, enabledStats: [...gem.enabledStats] };
        }
        return {
          schemaVersion: 1,
          nextItemSequence: projectedInventory.nextItemSequence,
          looseItems: projectedInventory.looseItems.map((item) =>
            item.kind === "gem"
              ? { ...item, enabledStats: [...item.enabledStats] }
              : { ...item }),
          equippedGems,
        } satisfies PlayerInventoryStateV1;
      })();
  const profile = inventory === undefined
    ? {
        schemaVersion: 4 as const,
        hero: {
          level: projection.player.heroLevel,
          totalHighestLevels: projection.player.heroTotalHighestLevels,
        },
        silver: projection.player.silver,
        gold: projection.player.gold,
        captureCards: projection.player.captureCards,
        highestCapturedLevels: projection.player.highestCapturedLevels,
        learnedCombineRecipes: projection.player.learnedCombineRecipes,
        tutorialFlags: projection.player.tutorialFlags,
        catchQuestsDone: projection.player.catchQuestsDone,
        dungeonWaypoints: projection.player.dungeonWaypoints ?? {},
        dungeonItems: projection.player.items,
        spiritEnergy: projection.player.spirit.energy,
        spiritSavedXp: projection.player.spirit.savedXp,
        spiritsUsedThisTrip: projection.player.spirit.usedThisTrip,
      }
    : {
        schemaVersion: 8 as const,
        hero: {
          level: projection.player.heroLevel,
          totalHighestLevels: projection.player.heroTotalHighestLevels,
        },
        silver: projection.player.silver,
        gold: projection.player.gold,
        inventory,
        licenseType: projection.player.licenseType ?? "Novice",
        skillPoints: projection.player.skillPoints ?? {
          MaxHP: 0, Attack: 0, Magic: 0, Speed: 0, Defense: 0, Resist: 0,
        },
        tournament: projection.player.tournament === undefined
          ? {
              schemaVersion: 1 as const,
              index: 0,
              round: 0,
              status: 0 as const,
            }
          : {
              schemaVersion: 1 as const,
              index: projection.player.tournament.index,
              round: projection.player.tournament.round,
              status: projection.player.tournament.status,
              ...(projection.player.tournament.timeLast === undefined
                ? {}
                : { timeLast: projection.player.tournament.timeLast }),
            },
        highestCapturedLevels: projection.player.highestCapturedLevels,
        learnedCombineRecipes: projection.player.learnedCombineRecipes,
        tutorialFlags: projection.player.tutorialFlags,
        catchQuestsDone: projection.player.catchQuestsDone,
        dungeonWaypoints: projection.player.dungeonWaypoints ?? {},
        // Absent on a projection from an authority that predates the Abyss; 0 is what the source
        // reads back for a property dictionary with no `infiniteHighestLevel` key.
        infiniteDungeonHighestLevel: projection.player.infiniteDungeonHighestLevel ?? 0,
        spiritEnergy: projection.player.spirit.energy,
        spiritSavedXp: projection.player.spirit.savedXp,
        spiritsUsedThisTrip: projection.player.spirit.usedThisTrip,
      };
  const dungeon = officialProjectionDungeonRun(projection);
  // A v11 projection carries no Collection claims at all, and its authority advertises no
  // `collection.claim`; an empty set is what schema 1 already restored for it.
  const claimedCollectionGoalIds = "collectionClaims" in projection
    ? projection.collectionClaims.claimedGoalIds
    : [];
  return {
    schemaVersion: 1,
    player: {
      schemaVersion: 2,
      claimedCollectionGoalIds,
      profile,
      party: {
        kind: "world-trip-party",
        battingOrderSize: projection.player.battingOrderSize,
        monsters: ordered.map((monster) => ({
          instanceId: monster.instanceId,
          shortType: monster.shortType,
          level: monster.level,
          cumulativeXp: monster.cumulativeXp,
          currentHp: monster.hp,
          ...(monster.injuredAt === undefined
            ? {}
            : { injureTime: Date.parse(monster.injuredAt) / 1_000 }),
          ...(monster.injuredUntil === undefined
            ? {}
            : { healTime: Date.parse(monster.injuredUntil) / 1_000 }),
          ...(monster.soulStone === undefined
            ? {}
            : {
                soulStone: {
                  element: monster.soulStone.element,
                  level: monster.soulStone.level,
                  ...(monster.soulStone.sourceTypeId === undefined
                    ? {}
                    : { sourceType: monster.soulStone.sourceTypeId }),
                },
              }),
        })),
        soulStones: projection.player.ownedSoulStones.map((stone) => ({
          element: stone.element,
          level: stone.level,
          ...(stone.sourceTypeId === undefined ? {} : { sourceType: stone.sourceTypeId }),
        })),
      },
    },
    ...(quests === undefined
      ? {}
      : {
          quests: {
            schemaVersion: 1,
            activeQuestNames: quests.activeQuestNames,
            finishedQuestNames: quests.finishedQuestNames,
            progressByQuestName: quests.progressByQuestName,
            dialogsSeen: quests.dialogsSeen,
            completedFixedEncounterKeys: quests.completedFixedEncounterKeys,
            receivedBattleRewardKeys: quests.receivedBattleRewardKeys,
          },
        }),
    ...(world === undefined
      ? {}
      : {
          world: {
            schemaVersion: 1,
            worldName: world.worldId,
            currentPoiName: world.currentPoiId,
            refresh: {
              occurrenceByPoi: world.occurrenceByPoi,
              completedPois: world.completedPoiIds,
            },
            poiWins: world.poiWins,
            dayNumber: world.dayNumber,
            everCompletedPois: world.everCompletedPoiIds,
            lastTownName: world.lastTownId,
          },
        }),
    ...(dungeon === undefined ? {} : { dungeon }),
  };
}

/** Parse the wire projection before handing a dungeon run to the local scene/runtime adapter. */
export function officialProjectionDungeonRun(
  projection: InstalledSlotProjection,
): DungeonRunSnapshot | undefined {
  return projection.dungeon === undefined
    ? undefined
    : parseDungeonRunSnapshot(projection.dungeon.run);
}

function toSaveSummary(summary: AuthoritativeSlotSummaryV1): SaveSlotSummary {
  return {
    slotId: summary.slotId,
    revision: summary.revision,
    updatedAt: summary.updatedAt,
    compatible: true,
  };
}

function starterElementFor(shortType: string | undefined): Extract<
  GameCommandV1,
  { type: "slot.create" }
>["starterElement"] {
  switch (shortType) {
    case undefined:
    case "BlueBabyDragon":
      return "Water";
    case "RedBabyDragon":
      return "Fire";
    case "WhiteBabyDragon":
      return "Air";
    case "GoldBabyDragon":
      return "Earth";
    default:
      throw new Error(`official server does not recognize starter ${shortType}`);
  }
}

function commandId(): string {
  return `cmd_${crypto.randomUUID().replaceAll("-", "")}`;
}
