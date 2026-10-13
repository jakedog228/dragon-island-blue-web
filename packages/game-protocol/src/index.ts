import { z } from "zod";
import { SAVE_SLOT_IDS } from "@dib/save-protocol";
export * from "./pvp.js";

export const GAME_PROTOCOL_VERSION = "game-protocol-v1" as const;
export const PRESENTATION_EVENT_VERSION = "presentation-events-v1" as const;
/** Immutable identity of the currently installed Official authority. */
export const OFFICIAL_GAME_SIMULATION_VERSION = "official-game-v27" as const;
/** Historical Official authority retained only for explicit v11 parsing/migration. */
export const OFFICIAL_GAME_V11_SIMULATION_VERSION = "official-game-v11" as const;
/**
 * Historical Official authority retained only for explicit v12 parsing/migration. Its battle wire
 * still carries `backgroundKey`; v13 replaced that with a semantic scene the browser resolves
 * against its own local archive, so this is frozen rather than aliased to the installed version.
 */
export const OFFICIAL_GAME_V12_SIMULATION_VERSION = "official-game-v12" as const;
/** Historical semantic-scene authority retained for explicit parsing and migration. */
export const OFFICIAL_GAME_V13_SIMULATION_VERSION = "official-game-v13" as const;
/** Historical v14 authority retained for explicit parsing and migration. */
export const OFFICIAL_GAME_V14_SIMULATION_VERSION = "official-game-v14" as const;
/** Historical v15 authority retained for explicit parsing and migration. */
export const OFFICIAL_GAME_V15_SIMULATION_VERSION = "official-game-v15" as const;
/** Historical v16 authority retained for explicit parsing and migration. */
export const OFFICIAL_GAME_V16_SIMULATION_VERSION = "official-game-v16" as const;
/** Historical v17 authority retained for explicit parsing and migration. */
export const OFFICIAL_GAME_V17_SIMULATION_VERSION = "official-game-v17" as const;
/** Historical v18 authority retained unchanged for explicit parsing and migration. */
export const OFFICIAL_GAME_V18_SIMULATION_VERSION = "official-game-v18" as const;
/** Historical v19 authority retained unchanged for explicit parsing and migration. */
export const OFFICIAL_GAME_V19_SIMULATION_VERSION = "official-game-v19" as const;
/** Historical v20 authority retained unchanged for explicit parsing and migration. */
export const OFFICIAL_GAME_V20_SIMULATION_VERSION = "official-game-v20" as const;
/** Historical v21 authority retained unchanged for explicit parsing and migration. */
export const OFFICIAL_GAME_V21_SIMULATION_VERSION = "official-game-v21" as const;
/** Historical v22 authority retained unchanged for explicit parsing and migration. */
export const OFFICIAL_GAME_V22_SIMULATION_VERSION = "official-game-v22" as const;
/** Historical authority: source Egg RNG sequence and release arithmetic. */
export const OFFICIAL_GAME_V23_SIMULATION_VERSION = "official-game-v23" as const;
/** Historical authority: archive-neutral fixed encounter identity for reconnect. */
export const OFFICIAL_GAME_V24_SIMULATION_VERSION = "official-game-v24" as const;
/**
 * Historical authority: v24 wire, plus source story rules (Arena/dungeon encounter chats recorded in
 * `dialogsSeen`, zone-change conditions, per-death quest event 0, empty Drop Quests).
 */
export const OFFICIAL_GAME_V25_SIMULATION_VERSION = "official-game-v25" as const;
/** Historical authority: automatic opening silver settlement. */
export const OFFICIAL_GAME_V26_SIMULATION_VERSION = "official-game-v26" as const;
/** Current authority: source Job construction and replay-preserving capture repair. */
export const OFFICIAL_GAME_V27_SIMULATION_VERSION = OFFICIAL_GAME_SIMULATION_VERSION;

/**
 * The wire vocabulary: every command type an envelope is *allowed to name*. Membership here is not
 * a capability claim. A logic pack advertises what it will actually admit through
 * `LogicPackCapabilitiesV1Schema.commandTypes`, and the reducer rejects anything unadvertised with
 * `CAPABILITY_UNSUPPORTED` before it can reach state.
 *
 * A few entries are permanently outside that advertised set. They are listed with their evidence in
 * `RESERVED_GAME_COMMAND_TYPES_V1` below; read that before assuming an unimplemented command is a
 * gap to close.
 */
export const GAME_COMMAND_TYPES_V1 = [
  "slot.create",
  "world.navigate",
  "world.selectCurrentPoi",
  "world.enterTown",
  "world.leaveTown",
  "world.useDirectTownReturn",
  "world.usePortal",
  "world.activateZone",
  "battle.chooseAbility",
  "battle.attemptCapture",
  "battle.delay",
  "battle.retreat",
  "battle.resolveDefeat",
  "battle.summonSpirit",
  "dungeon.selectRoom",
  "dungeon.activateZone",
  "dungeon.travelToWaypoint",
  "dungeon.openTreasure",
  "dungeon.claimCatchReward",
  "party.commitBattingPriority",
  "party.combine",
  "party.evolve",
  "party.healInjury",
  "party.destroyMonster",
  "party.convertToSoulStone",
  "party.insertSoulStone",
  "player.claimTutorialFlag",
  "player.claimDialog",
  "player.dropInventoryItem",
  "player.equipGem",
  "player.unequipGem",
  "player.incrementSkill",
  "player.decrementSkill",
  "store.purchase",
  "collection.claim",
  "arena.startLicenseChallenge",
  "tournament.startBattle",
  "tournament.claimPrize",
  "egg.start",
  "egg.release",
  "egg.resolvePrize",
  "egg.repeat",
  "egg.finish",
  "quest.accept",
  "quest.abandon",
  "quest.claim",
  "quest.dropAll",
  "plot.advance",
] as const;
export const GameCommandTypeV1Schema = z.enum(GAME_COMMAND_TYPES_V1);
export type GameCommandTypeV1 = z.infer<typeof GameCommandTypeV1Schema>;

/** Historical wire vocabulary, retained so old envelopes and receipts can be read. */
export const HISTORICAL_GAME_COMMAND_TYPES_V1 = [
  ...GAME_COMMAND_TYPES_V1,
  "tournament.settlePrize",
] as const;
export const HistoricalGameCommandTypeV1Schema = z.enum(HISTORICAL_GAME_COMMAND_TYPES_V1);
export type HistoricalGameCommandTypeV1 = z.infer<typeof HistoricalGameCommandTypeV1Schema>;

/** Installed v11 capability vocabulary: historical commands only, without future v12 intents. */
export const LEGACY_GAME_COMMAND_TYPES_V1 = [
  "slot.create",
  "world.navigate",
  "world.selectCurrentPoi",
  "world.enterTown",
  "world.leaveTown",
  "world.useDirectTownReturn",
  "world.usePortal",
  "world.activateZone",
  "battle.chooseAbility",
  "battle.attemptCapture",
  "battle.delay",
  "battle.retreat",
  "battle.summonSpirit",
  "dungeon.selectRoom",
  "dungeon.activateZone",
  "dungeon.travelToWaypoint",
  "dungeon.openTreasure",
  "dungeon.claimCatchReward",
  "party.commitBattingPriority",
  "party.combine",
  "party.evolve",
  "party.healInjury",
  "party.destroyMonster",
  "party.convertToSoulStone",
  "party.insertSoulStone",
  "player.claimTutorialFlag",
  "player.claimDialog",
  "player.dropInventoryItem",
  "player.equipGem",
  "player.unequipGem",
  "player.incrementSkill",
  "player.decrementSkill",
  "store.purchase",
  "arena.startLicenseChallenge",
  "tournament.startBattle",
  "tournament.claimPrize",
  "tournament.settlePrize",
  "quest.accept",
  "quest.abandon",
  "quest.claim",
  "quest.dropAll",
  "plot.advance",
] as const;
export const LegacyGameCommandTypeV1Schema = z.enum(LEGACY_GAME_COMMAND_TYPES_V1);
export type LegacyGameCommandTypeV1 = z.infer<typeof LegacyGameCommandTypeV1Schema>;















export const RESERVED_GAME_COMMAND_TYPES_V1: Readonly<Record<string, {
  readonly reason: "unreachable" | "retired";
  readonly note: string;
}>> = Object.freeze({
  "world.enterTown": Object.freeze({
    reason: "unreachable",
    note:
      "Town entry is atomic inside world.navigate: arriving at a POI carrying a town restores the " +
      "party, resets spirits, refreshes the town, advances the world day, and snapshots the town " +
      "location in one reduction (official-game/src/index.ts navigateWorld). There is no separate " +
      "source action that enters an already-reached town.",
  }),
  "quest.abandon": Object.freeze({
    reason: "unreachable",
    note:
      "The source has no per-quest abandon. -[TavernMenuItem dropQuests:] @ 0xe00a8 clears every " +
      "active quest and presents DroppedQuests; the port models exactly that as quest.dropAll " +
      "",
  }),
  "plot.advance": Object.freeze({
    reason: "unreachable",
    note:
      "Plot progression is recorded as a tutorial-flag claim (player.claimTutorialFlag). The " +
      "Official descriptor advertises `plot: false`; there is no separate plot aggregate to " +
      "advance.",
  }),
  "tournament.settlePrize": Object.freeze({
    reason: "retired",
    note:
      "Superseded by the v12 Egg continuation: a Tournament Egg prize is settled through " +
      "egg.start/release/resolvePrize/finish instead of a client-driven settle. Retained only in " +
      "HISTORICAL_GAME_COMMAND_TYPES_V1 so pre-v12 receipts parse.",
  }),
});

const boundedId = z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/);
const dungeonEntityId = z.string().min(1).max(240).regex(/^[A-Za-z0-9._:{} ,+\-]+$/);
const itemId = z.string().min(1).max(240).regex(/^[A-Za-z0-9._:,\-]+$/);
const commandId = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/);
const slotId = z.enum(SAVE_SLOT_IDS);
const nonnegativeInteger = z.number().int().nonnegative().safe();
const positiveInteger = z.number().int().positive().safe();
const element = z.enum(["Life", "Death", "Water", "Fire", "Earth", "Air", "Arcane"]);
const starterElement = z.enum(["Water", "Fire", "Earth", "Air"]);
const captureCardLevel = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const unitRandomDraw = z.number().finite().min(0).lt(1);
const finiteNumber = z.number().finite();

/**
 * Canonical server wire for the Collection claim registry. The ID bound is inherited from the
 * existing `boundedId` command field. There is deliberately no claim-count cap here: authored
 * catalog cardinality is an operator preflight concern, not a gameplay rule or a wire constant.
 */
export const CollectionClaimsV1Schema = z.object({
  schemaVersion: z.literal(1),
  claimedGoalIds: z.array(boundedId).superRefine((goalIds, context) => {
    for (let index = 1; index < goalIds.length; index += 1) {
      if (goalIds[index - 1]! >= goalIds[index]!) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "claimedGoalIds must be sorted strictly and contain no duplicates",
        });
      }
    }
  }),
}).strict();
export type CollectionClaimsV1 = z.infer<typeof CollectionClaimsV1Schema>;

const logicPackCapabilityDomainShape = {
  slot: z.boolean(),
  world: z.boolean(),
  battle: z.boolean(),
  capture: z.boolean(),
  spirit: z.boolean(),
  party: z.boolean(),
  economy: z.boolean(),
  dungeon: z.boolean(),
  quests: z.boolean(),
  plot: z.boolean(),
  tournaments: z.boolean(),
} as const;

/** Current capability allowlist. Deprecated v11 settlement is deliberately absent. */
export const LogicPackCapabilitiesV1Schema = z.object({
  ...logicPackCapabilityDomainShape,
  /**
   * Security-relevant allowlist. Broad domain flags are UI discovery hints; only commands named
   * here may cross the reducer boundary for this installed simulation.
   */
  commandTypes: z.array(GameCommandTypeV1Schema).max(GAME_COMMAND_TYPES_V1.length)
    .refine((values) => new Set(values).size === values.length, "commandTypes must be unique"),
}).strict();
export type LogicPackCapabilitiesV1 = z.infer<typeof LogicPackCapabilitiesV1Schema>;

/**
 * Legacy v11 capability allowlist. This is only for the still-installed v11 descriptor and its
 * reducer/web handshake; it is never a valid current/v12 capability shape.
 */
export const HistoricalLogicPackCapabilitiesV1Schema = z.object({
  ...logicPackCapabilityDomainShape,
  commandTypes: z.array(LegacyGameCommandTypeV1Schema)
    .max(LEGACY_GAME_COMMAND_TYPES_V1.length)
    .refine((values) => new Set(values).size === values.length, "commandTypes must be unique"),
}).strict();
export type HistoricalLogicPackCapabilitiesV1 = z.infer<
  typeof HistoricalLogicPackCapabilitiesV1Schema
>;

const logicPackDescriptorBaseShape = {
  logicPackId: z.string().regex(/^logic-v1:[a-f0-9]{64}$/),
  simulationVersion: boundedId,
  trustTier: z.enum(["official", "publisher"]),
} as const;

const currentSimulationVersion = boundedId.refine(
  (value) => value !== "official-game-v11",
  "official-game-v11 requires the historical descriptor schema",
);

/** Broad descriptor parser used by historical storage/session compatibility code. */
export const LogicPackDescriptorV1Schema = z.object({
  ...logicPackDescriptorBaseShape,
  capabilities: z.union([
    LogicPackCapabilitiesV1Schema,
    HistoricalLogicPackCapabilitiesV1Schema,
  ]),
}).strict().superRefine((value, context) => {
  const capabilitySchema = value.simulationVersion === "official-game-v11"
    ? HistoricalLogicPackCapabilitiesV1Schema
    : LogicPackCapabilitiesV1Schema;
  if (!capabilitySchema.safeParse(value.capabilities).success) {
    context.addIssue({
      code: "custom",
      path: ["capabilities", "commandTypes"],
      message: value.simulationVersion === "official-game-v11"
        ? "v11 descriptors cannot advertise future commands"
        : "current descriptors cannot advertise historical-only commands",
    });
  }
});
export type LogicPackDescriptorV1 = z.infer<typeof LogicPackDescriptorV1Schema>;

/** Strict descriptor shape for a current simulation, including future official v12 packs. */
export const CurrentLogicPackDescriptorV1Schema = z.object({
  ...logicPackDescriptorBaseShape,
  simulationVersion: currentSimulationVersion,
  capabilities: LogicPackCapabilitiesV1Schema,
}).strict();
export type CurrentLogicPackDescriptorV1 = z.infer<typeof CurrentLogicPackDescriptorV1Schema>;

/** Strict descriptor shape for the installed historical official v11 simulation. */
export const HistoricalLogicPackDescriptorV1Schema = z.object({
  ...logicPackDescriptorBaseShape,
  simulationVersion: z.literal("official-game-v11"),
  capabilities: HistoricalLogicPackCapabilitiesV1Schema,
}).strict();
export type HistoricalLogicPackDescriptorV1 = z.infer<
  typeof HistoricalLogicPackDescriptorV1Schema
>;

export const ACCOUNT_USERNAME_MIN_LENGTH = 2;
export const ACCOUNT_USERNAME_MAX_LENGTH = 16;

/**
 * Canonical username form: alphanumeric runs joined by single spaces, underscores, or hyphens.
 * The pattern forbids leading, trailing, and repeated separators outright, so a value that passes
 * is already canonical and two accounts can never differ by invisible whitespace alone.
 */
const ACCOUNT_USERNAME_PATTERN = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

/**
 * Shared by the client (before it asks) and the server (before it stores), so a name typed with
 * stray spaces is accepted identically on both sides instead of being rejected by one of them.
 */
export function normalizeAccountUsername(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export const AccountUsernameV1Schema = z.string()
  .min(ACCOUNT_USERNAME_MIN_LENGTH)
  .max(ACCOUNT_USERNAME_MAX_LENGTH)
  .regex(
    ACCOUNT_USERNAME_PATTERN,
    "usernames use letters and digits, optionally separated by single spaces, _ or -",
  );

export const AccountSettingsV1Schema = z.object({
  publicScoreboard: z.boolean(),
}).strict();
export type AccountSettingsV1 = z.infer<typeof AccountSettingsV1Schema>;

export const AccountSummaryV1Schema = z.object({
  username: AccountUsernameV1Schema,
  publicScoreboard: z.boolean(),
  createdAt: z.string().datetime(),
}).strict();
export type AccountSummaryV1 = z.infer<typeof AccountSummaryV1Schema>;

/**
 * Unauthenticated capability probe. Registration is an operator-controlled feature, so the client
 * asks whether it exists rather than assuming it and failing at the point of use.
 */
export const RegistrationInfoV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  enabled: z.boolean(),
  usernameMinLength: positiveInteger,
  usernameMaxLength: positiveInteger,
}).strict();
export type RegistrationInfoV1 = z.infer<typeof RegistrationInfoV1Schema>;

export const CreateAccountRequestV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  username: AccountUsernameV1Schema,
  publicScoreboard: z.boolean(),
}).strict();
export type CreateAccountRequestV1 = z.infer<typeof CreateAccountRequestV1Schema>;

/** The only time a raw login token crosses the wire from the server; it is never stored there. */
export const CreateAccountResponseV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  loginToken: z.string().min(16).max(512),
  playerId: z.string().regex(/^[a-f0-9]{64}$/),
  account: AccountSummaryV1Schema,
}).strict();
export type CreateAccountResponseV1 = z.infer<typeof CreateAccountResponseV1Schema>;

export const UpdateAccountSettingsRequestV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  publicScoreboard: z.boolean(),
}).strict();
export type UpdateAccountSettingsRequestV1 = z.infer<typeof UpdateAccountSettingsRequestV1Schema>;

export const AccountResponseV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  account: AccountSummaryV1Schema,
}).strict();
export type AccountResponseV1 = z.infer<typeof AccountResponseV1Schema>;

/** A rudimentary board is a short board: the server truncates rather than paginating. */
export const SCOREBOARD_MAX_ENTRIES = 50;

/**
 * One public entry, which is one *account* rather than one save slot: a player who keeps three
 * saves is ranked by their best, so experimenting in slot 2 never displaces their own slot 1.
 *
 * The player id is deliberately absent. It is the HMAC-derived identity the whole authorization
 * model is keyed on, and this response is unauthenticated, so publishing it would hand every
 * reader a durable correlation handle for no gain. Clients recognise their own row by username,
 * which the registry already keeps unique case-insensitively.
 */
export const ScoreboardEntryV1Schema = z.object({
  /** Competition ranking: equal scores share a rank and the next rank skips accordingly. */
  rank: positiveInteger,
  username: AccountUsernameV1Schema,
  heroLevel: positiveInteger,
  totalXp: nonnegativeInteger,
}).strict();
export type ScoreboardEntryV1 = z.infer<typeof ScoreboardEntryV1Schema>;

/**
 * Unauthenticated read. `generatedAt` is the moment the board was aggregated, not the moment it was
 * served: the server answers from a short-lived cache, and a client that shows a timestamp must
 * show the one the numbers actually belong to.
 */
export const ScoreboardResponseV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  generatedAt: z.string().datetime(),
  entries: z.array(ScoreboardEntryV1Schema).max(SCOREBOARD_MAX_ENTRIES),
}).strict();
export type ScoreboardResponseV1 = z.infer<typeof ScoreboardResponseV1Schema>;

export const CreateGameSessionRequestV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  loginToken: z.string().min(16).max(512),
  logicPackId: z.string().regex(/^logic-v1:[a-f0-9]{64}$/),
  supportedEventVersions: z.array(z.literal(PRESENTATION_EVENT_VERSION)).min(1).max(4),
  clientBuild: z.string().min(1).max(120).optional(),
}).strict();
export type CreateGameSessionRequestV1 = z.infer<typeof CreateGameSessionRequestV1Schema>;

export const AuthoritativeSlotSummaryV1Schema = z.object({
  slotId,
  revision: positiveInteger,
  updatedAt: z.string().datetime(),
  logicPackId: z.string().regex(/^logic-v1:[a-f0-9]{64}$/),
  simulationVersion: boundedId,
  trustTier: z.literal("official"),
  activeDomain: z.enum(["world", "battle", "dungeon", "town", "none"]),
}).strict();
export type AuthoritativeSlotSummaryV1 = z.infer<typeof AuthoritativeSlotSummaryV1Schema>;

export const CreateGameSessionResponseV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  selectedEventVersion: z.literal(PRESENTATION_EVENT_VERSION),
  token: z.string().min(16).max(2048),
  expiresAt: z.string().datetime(),
  pack: LogicPackDescriptorV1Schema,
  slots: z.array(AuthoritativeSlotSummaryV1Schema).max(3),
  // Absent for operator-issued invites that predate self-registration: those tokens authorize play
  // but own no account record, so the client hides account-scoped settings rather than inventing them.
  account: AccountSummaryV1Schema.optional(),
}).strict();
export type CreateGameSessionResponseV1 = z.infer<typeof CreateGameSessionResponseV1Schema>;

export const ListAuthoritativeSlotsResponseV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  slots: z.array(AuthoritativeSlotSummaryV1Schema).max(3),
}).strict();
export type ListAuthoritativeSlotsResponseV1 = z.infer<typeof ListAuthoritativeSlotsResponseV1Schema>;

export const DeleteAuthoritativeSlotRequestV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  expectedRevision: positiveInteger,
}).strict();
export type DeleteAuthoritativeSlotRequestV1 = z.infer<typeof DeleteAuthoritativeSlotRequestV1Schema>;

const slotCreate = z.object({
  type: z.literal("slot.create"),
  starterElement,
}).strict();
const worldNavigate = z.object({
  type: z.literal("world.navigate"),
  targetPoiId: boundedId,
}).strict();
const worldSelectCurrent = z.object({
  type: z.literal("world.selectCurrentPoi"),
}).strict();
/** Reserved: unreachable by design. See `RESERVED_GAME_COMMAND_TYPES_V1`. */
const worldEnterTown = z.object({
  type: z.literal("world.enterTown"),
  townId: boundedId,
}).strict();
const worldLeaveTown = z.object({ type: z.literal("world.leaveTown") }).strict();
const worldUseTownReturn = z.object({ type: z.literal("world.useDirectTownReturn") }).strict();
const worldUsePortal = z.object({
  type: z.literal("world.usePortal"),
  destinationTownId: boundedId,
}).strict();
const worldActivateZone = z.object({
  type: z.literal("world.activateZone"),
  zoneId: boundedId,
}).strict();

const battleChooseAbility = z.object({
  type: z.literal("battle.chooseAbility"),
  battleId: boundedId,
  actorId: boundedId,
  slot: z.string().regex(/^usable[0-9]+$/).max(24),
  targetIds: z.array(boundedId).max(8),
}).strict();
const battleAttemptCapture = z.object({
  type: z.literal("battle.attemptCapture"),
  battleId: boundedId,
  actorId: boundedId,
  targetId: boundedId,
  cardLevel: captureCardLevel,
}).strict();
const battleDelay = z.object({
  type: z.literal("battle.delay"),
  battleId: boundedId,
  actorId: boundedId,
}).strict();
const battleRetreat = z.object({
  type: z.literal("battle.retreat"),
  battleId: boundedId,
  actorId: boundedId,
}).strict();
const battleResolveDefeat = z.object({
  type: z.literal("battle.resolveDefeat"),
  battleId: boundedId,
  recovery: z.enum(["return", "saveMe"]),
}).strict();
const battleSummonSpirit = z.object({
  type: z.literal("battle.summonSpirit"),
  battleId: boundedId,
  shortType: boundedId,
}).strict();

const dungeonSelectRoom = z.object({
  type: z.literal("dungeon.selectRoom"),
  roomId: dungeonEntityId,
}).strict();
const dungeonActivateZone = z.object({
  type: z.literal("dungeon.activateZone"),
  zoneId: dungeonEntityId,
}).strict();
const dungeonTravelToWaypoint = z.object({
  type: z.literal("dungeon.travelToWaypoint"),
  floor: positiveInteger,
}).strict();
const dungeonOpenTreasure = z.object({
  type: z.literal("dungeon.openTreasure"),
  treasureId: dungeonEntityId,
}).strict();
const dungeonClaimCatchReward = z.object({
  type: z.literal("dungeon.claimCatchReward"),
}).strict();

const partyCommitOrder = z.object({
  type: z.literal("party.commitBattingPriority"),
  activeInstanceIds: z.array(boundedId).min(1).max(256),
}).strict();
const partyCombine = z.object({
  type: z.literal("party.combine"),
  resultTypeId: boundedId,
  firstInstanceId: boundedId,
  secondInstanceId: boundedId,
}).strict();
const partyEvolve = z.object({
  type: z.literal("party.evolve"),
  instanceId: boundedId,
}).strict();
const partyHealInjury = z.object({
  type: z.literal("party.healInjury"),
  instanceId: boundedId,
}).strict();
const partyDestroy = z.object({
  type: z.literal("party.destroyMonster"),
  instanceId: boundedId,
}).strict();
const partyConvertSoulStone = z.object({
  type: z.literal("party.convertToSoulStone"),
  instanceId: boundedId,
}).strict();
const partyInsertSoulStone = z.object({
  type: z.literal("party.insertSoulStone"),
  instanceId: boundedId,
  stoneId: boundedId,
}).strict();
const playerClaimTutorialFlag = z.object({
  type: z.literal("player.claimTutorialFlag"),
  flag: boundedId,
}).strict();
const playerClaimDialog = z.object({
  type: z.literal("player.claimDialog"),
  dialogId: boundedId,
}).strict();
const playerDropInventoryItem = z.object({
  type: z.literal("player.dropInventoryItem"),
  itemId: boundedId,
}).strict();
const playerEquipGem = z.object({
  type: z.literal("player.equipGem"),
  itemId: boundedId,
}).strict();
const playerUnequipGem = z.object({
  type: z.literal("player.unequipGem"),
  itemId: boundedId,
}).strict();
const playerIncrementSkill = z.object({
  type: z.literal("player.incrementSkill"),
  stat: z.enum(["MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist"]),
}).strict();
const playerDecrementSkill = z.object({
  type: z.literal("player.decrementSkill"),
  stat: z.enum(["MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist"]),
}).strict();
const storePurchase = z.object({
  type: z.literal("store.purchase"),
  stockId: boundedId,
  quantity: positiveInteger.max(99),
}).strict();
const collectionClaim = z.object({
  type: z.literal("collection.claim"),
  goalId: boundedId,
}).strict();
const arenaStartLicenseChallenge = z.object({
  type: z.literal("arena.startLicenseChallenge"),
}).strict();
const tournamentStartBattle = z.object({
  type: z.literal("tournament.startBattle"),
}).strict();
const tournamentClaimPrize = z.object({
  type: z.literal("tournament.claimPrize"),
}).strict();
/** Reserved: retired in favour of the v12 Egg continuation, kept only so pre-v12 receipts parse.
 * See `RESERVED_GAME_COMMAND_TYPES_V1`. */
const tournamentSettlePrize = z.object({
  type: z.literal("tournament.settlePrize"),
}).strict();
/**
 * Wire sanity cap on a held-frame count: 60 seconds at the native 1/60 cadence. The simulation has
 * no maximum — the native reel spins for as long as the player holds — so this bounds untrusted
 * input rather than expressing a source rule.
 */
export const EGG_RELEASE_MAX_HELD_FRAMES_V1 = 3_600;

const eggStart = z.object({ type: z.literal("egg.start") }).strict();











const eggRelease = z.object({
  type: z.literal("egg.release"),
  heldFrames: z.number().int().min(1).max(EGG_RELEASE_MAX_HELD_FRAMES_V1).optional(),
}).strict();
const eggResolvePrize = z.object({
  type: z.literal("egg.resolvePrize"),
  resolution: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("keep") }).strict(),
    z.object({
      kind: z.literal("feed"),
      recipientInstanceId: boundedId,
    }).strict(),
  ]),
}).strict();
const eggRepeat = z.object({ type: z.literal("egg.repeat") }).strict();
const eggFinish = z.object({ type: z.literal("egg.finish") }).strict();

const questAccept = z.object({ type: z.literal("quest.accept"), questId: boundedId }).strict();
/** Reserved: unreachable by design; the source drops every quest at once. See
 * `RESERVED_GAME_COMMAND_TYPES_V1`. Use `quest.dropAll`. */
const questAbandon = z.object({ type: z.literal("quest.abandon"), questId: boundedId }).strict();
const questClaim = z.object({ type: z.literal("quest.claim"), questId: boundedId }).strict();
const questDropAll = z.object({ type: z.literal("quest.dropAll") }).strict();
/** Reserved: unreachable by design; plot progress is a tutorial-flag claim. See
 * `RESERVED_GAME_COMMAND_TYPES_V1`. */
const plotAdvance = z.object({
  type: z.literal("plot.advance"),
  eventId: boundedId,
  choiceId: boundedId.optional(),
}).strict();

/**
 * Intent-only command vocabulary. It deliberately has no generic state/diff operation and no
 * fields for chance, price, reward, seed, timestamp, damage, XP, result, or caller-created IDs.
 */
export const GameCommandV1Schema = z.discriminatedUnion("type", [
  slotCreate,
  worldNavigate,
  worldSelectCurrent,
  worldEnterTown,
  worldLeaveTown,
  worldUseTownReturn,
  worldUsePortal,
  worldActivateZone,
  battleChooseAbility,
  battleAttemptCapture,
  battleDelay,
  battleRetreat,
  battleResolveDefeat,
  battleSummonSpirit,
  dungeonSelectRoom,
  dungeonActivateZone,
  dungeonTravelToWaypoint,
  dungeonOpenTreasure,
  dungeonClaimCatchReward,
  partyCommitOrder,
  partyCombine,
  partyEvolve,
  partyHealInjury,
  partyDestroy,
  partyConvertSoulStone,
  partyInsertSoulStone,
  playerClaimTutorialFlag,
  playerClaimDialog,
  playerDropInventoryItem,
  playerEquipGem,
  playerUnequipGem,
  playerIncrementSkill,
  playerDecrementSkill,
  storePurchase,
  collectionClaim,
  arenaStartLicenseChallenge,
  tournamentStartBattle,
  tournamentClaimPrize,
  tournamentSettlePrize,
  eggStart,
  eggRelease,
  eggResolvePrize,
  eggRepeat,
  eggFinish,
  questAccept,
  questAbandon,
  questClaim,
  questDropAll,
  plotAdvance,
]);
/** Parsed historical wire/receipt command, including deprecated settlement intents. */
export const HistoricalGameCommandV1Schema = GameCommandV1Schema;
export type HistoricalGameCommandV1 = z.infer<typeof GameCommandV1Schema>;
/** Stable historical alias used by the installed v11 reducer and receipt consumers. */
export type GameCommandV1 = HistoricalGameCommandV1;

/** Strict current/live command parser. It intentionally excludes v11 settlement. */
export const CurrentGameCommandV1Schema = z.discriminatedUnion("type", [
  slotCreate,
  worldNavigate,
  worldSelectCurrent,
  worldEnterTown,
  worldLeaveTown,
  worldUseTownReturn,
  worldUsePortal,
  worldActivateZone,
  battleChooseAbility,
  battleAttemptCapture,
  battleDelay,
  battleRetreat,
  battleResolveDefeat,
  battleSummonSpirit,
  dungeonSelectRoom,
  dungeonActivateZone,
  dungeonTravelToWaypoint,
  dungeonOpenTreasure,
  dungeonClaimCatchReward,
  partyCommitOrder,
  partyCombine,
  partyEvolve,
  partyHealInjury,
  partyDestroy,
  partyConvertSoulStone,
  partyInsertSoulStone,
  playerClaimTutorialFlag,
  playerClaimDialog,
  playerDropInventoryItem,
  playerEquipGem,
  playerUnequipGem,
  playerIncrementSkill,
  playerDecrementSkill,
  storePurchase,
  collectionClaim,
  arenaStartLicenseChallenge,
  tournamentStartBattle,
  tournamentClaimPrize,
  eggStart,
  eggRelease,
  eggResolvePrize,
  eggRepeat,
  eggFinish,
  questAccept,
  questAbandon,
  questClaim,
  questDropAll,
  plotAdvance,
]);
export type CurrentGameCommandV1 = z.infer<typeof CurrentGameCommandV1Schema>;

/** Historical wire envelope; this broad parser is required for old receipts and HTTP input. */
export const HistoricalGameCommandEnvelopeV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  commandId,
  expectedRevision: nonnegativeInteger,
  expectedDecisionId: boundedId.optional(),
  command: GameCommandV1Schema,
}).strict();
export const GameCommandEnvelopeV1Schema = HistoricalGameCommandEnvelopeV1Schema;
export type HistoricalGameCommandEnvelopeV1 = z.infer<typeof HistoricalGameCommandEnvelopeV1Schema>;
/** Stable historical alias used by the installed v11 reducer and receipt consumers. */
export type GameCommandEnvelopeV1 = HistoricalGameCommandEnvelopeV1;

/** Current/live envelope parser, used only after broad wire parsing at the service boundary. */
export const CurrentGameCommandEnvelopeV1Schema = z.object({
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  commandId,
  expectedRevision: nonnegativeInteger,
  expectedDecisionId: boundedId.optional(),
  command: CurrentGameCommandV1Schema,
}).strict();
export type CurrentGameCommandEnvelopeV1 = z.infer<typeof CurrentGameCommandEnvelopeV1Schema>;

const battleChoice = z.object({
  slot: z.string().regex(/^usable[0-9]+$/).max(24),
  abilityId: boundedId,
  target:
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("self") }).strict(),
      z.object({ kind: z.literal("allEnemies") }).strict(),
      z.object({ kind: z.literal("allFriends") }).strict(),
      z.object({ kind: z.literal("enemies"), count: positiveInteger }).strict(),
      z.object({ kind: z.literal("friends"), count: positiveInteger }).strict(),
      z.object({
        kind: z.literal("mixed"),
        enemyCount: nonnegativeInteger,
        friendlyCount: nonnegativeInteger,
        allEnemies: z.boolean(),
        allFriends: z.boolean(),
      }).strict(),
    ]),
  blockedReasonId: boundedId.optional(),
  tier: nonnegativeInteger.optional(),
  activationLength: nonnegativeInteger,
}).strict();

export const OfficialEggOriginV1Schema = z.enum([
  "store",
  "tournament",
  "battle",
  "quest",
  "dungeonTreasure",
  "dungeonCatch",
  "collection",
]);
export type OfficialEggOriginV1 = z.infer<typeof OfficialEggOriginV1Schema>;

export const OfficialEggContinuationPhaseV1Schema = z.enum([
  "awaiting-spin",
  "spinning",
  "awaiting-prize-resolution",
  "awaiting-repeat-or-finish",
]);
export type OfficialEggContinuationPhaseV1 = z.infer<typeof OfficialEggContinuationPhaseV1Schema>;

const eggKind = z.enum(["silver", "gold"]);
const eggRemainingRepeats = z.union([z.literal(0), z.literal(1)]);
const eggPrizeAmount = positiveInteger;
const eggGemStat = z.enum([
  "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
]);

/** JSON-safe server presentation of one engine `EggHatchPrize`. */
export const OfficialEggPrizeV1Schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("monster"),
    shortType: boundedId,
    level: positiveInteger,
    prizeMonster: z.boolean(),
  }).strict(),
  z.object({ kind: z.literal("gold"), amount: eggPrizeAmount }).strict(),
  z.object({ kind: z.literal("silver"), amount: eggPrizeAmount }).strict(),
  z.object({
    kind: z.literal("gem"),
    level: nonnegativeInteger,
    quality: z.union([z.literal(0), z.literal(1)]),
    slot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    enabledStats: z.array(eggGemStat).max(6),
  }).strict(),
  z.object({ kind: z.literal("recipe"), combineName: boundedId }).strict(),
  z.object({ kind: z.literal("spiritTotem"), shortType: boundedId }).strict(),
  z.object({
    kind: z.literal("item"),
    definitionPath: boundedId,
    level: positiveInteger,
  }).strict(),
]);
export type OfficialEggPrizeV1 = z.infer<typeof OfficialEggPrizeV1Schema>;

/**
 * Legacy compatibility cap. The corrected source construction reaches at most 24 monster
 * providers plus 22 Silver fillers (=46), but v15 receipts may already contain pools generated by
 * the former all-ordinary-loop bug. Keep their persisted continuations readable.
 */
export const OFFICIAL_EGG_POOL_MAX_ENTRIES = 66 as const;

export const SOURCE_EGG_POOL_MAX_ENTRIES = 46 as const;
const officialEggPoolShape = {
  providers: z.array(OfficialEggPrizeV1Schema).min(1).max(OFFICIAL_EGG_POOL_MAX_ENTRIES),
  reel: z.array(OfficialEggPrizeV1Schema).min(1).max(OFFICIAL_EGG_POOL_MAX_ENTRIES),
};

function validateEggPoolLengths(
  value: { readonly providers: readonly unknown[]; readonly reel: readonly unknown[] },
  context: z.RefinementCtx,
): void {
  if (value.providers.length !== value.reel.length) {
    context.addIssue({
      code: "custom",
      path: ["reel"],
      message: "Egg providers and reel must contain the same number of entries",
    });
  }
}

/** The committed renderer-facing `EggReelState` fields needed to reproduce landing. */
export const OfficialEggReelStateV1Schema = z.object({
  elapsedSeconds: finiteNumber.nonnegative(),
  index: finiteNumber.nonnegative(),
  speed: finiteNumber,
  friction: finiteNumber.nonnegative(),
  centerIndex: nonnegativeInteger,
  stopped: z.boolean(),
}).strict();
export type OfficialEggReelStateV1 = z.infer<typeof OfficialEggReelStateV1Schema>;

const eggContinuationCommonShape = {
  schemaVersion: z.literal(1),
  decisionId: boundedId,
  continuationId: boundedId,
  kind: eggKind,
  origin: OfficialEggOriginV1Schema,
  remainingRepeats: eggRemainingRepeats,
};

function validateEggOriginPhaseRepeats(
  value: {
    readonly origin: OfficialEggOriginV1;
    readonly remainingRepeats: 0 | 1;
    readonly phase: OfficialEggContinuationPhaseV1;
  },
  context: z.RefinementCtx,
): void {
  if (value.origin === "store" && value.remainingRepeats !== 0) {
    context.addIssue({
      code: "custom",
      path: ["remainingRepeats"],
      message: "Store Eggs cannot have remaining repeats",
    });
  }
  if (
    value.origin !== "store" &&
    value.phase === "awaiting-spin" &&
    value.remainingRepeats !== 1
  ) {
    context.addIssue({
      code: "custom",
      path: ["remainingRepeats"],
      message: "non-Store Eggs must have one remaining repeat while awaiting spin",
    });
  }
}

function validateStoreRemainingRepeats(
  value: { readonly origin: OfficialEggOriginV1; readonly remainingRepeats: 0 | 1 },
  context: z.RefinementCtx,
): void {
  if (value.origin === "store" && value.remainingRepeats !== 0) {
    context.addIssue({
      code: "custom",
      path: ["remainingRepeats"],
      message: "Store Eggs cannot have remaining repeats",
    });
  }
}

/** Strict server-owned state for one source-tagged Egg continuation phase. */
export const OfficialEggAwaitingSpinV1Schema = z.object({
  ...eggContinuationCommonShape,
  phase: z.literal("awaiting-spin"),
}).strict().superRefine(validateEggOriginPhaseRepeats);
export type OfficialEggAwaitingSpinV1 = z.infer<typeof OfficialEggAwaitingSpinV1Schema>;

export const OfficialEggSpinningV1Schema = z.object({
  ...eggContinuationCommonShape,
  phase: z.literal("spinning"),
  ...officialEggPoolShape,
  previewMonsterShortTypes: z.array(boundedId).max(2),
}).strict()
  .superRefine(validateEggPoolLengths)
  .superRefine(validateEggOriginPhaseRepeats);
export type OfficialEggSpinningV1 = z.infer<typeof OfficialEggSpinningV1Schema>;

export const OfficialEggAwaitingPrizeResolutionV1Schema = z.object({
  ...eggContinuationCommonShape,
  phase: z.literal("awaiting-prize-resolution"),
  ...officialEggPoolShape,
  previewMonsterShortTypes: z.array(boundedId).max(2),
  finalReelState: OfficialEggReelStateV1Schema,
  landedPrize: OfficialEggPrizeV1Schema,
}).strict()
  .superRefine(validateEggPoolLengths)
  .superRefine(validateEggOriginPhaseRepeats);
export type OfficialEggAwaitingPrizeResolutionV1 = z.infer<
  typeof OfficialEggAwaitingPrizeResolutionV1Schema
>;

export const OfficialEggAwaitingRepeatOrFinishV1Schema = z.object({
  ...eggContinuationCommonShape,
  phase: z.literal("awaiting-repeat-or-finish"),
  settledPrize: OfficialEggPrizeV1Schema,
  resolution: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("keep") }).strict(),
    z.object({ kind: z.literal("feed"), recipientInstanceId: boundedId }).strict(),
  ]),
}).strict().superRefine(validateEggOriginPhaseRepeats);
export type OfficialEggAwaitingRepeatOrFinishV1 = z.infer<
  typeof OfficialEggAwaitingRepeatOrFinishV1Schema
>;

export const OfficialEggContinuationV1Schema = z.discriminatedUnion("phase", [
  OfficialEggAwaitingSpinV1Schema,
  OfficialEggSpinningV1Schema,
  OfficialEggAwaitingPrizeResolutionV1Schema,
  OfficialEggAwaitingRepeatOrFinishV1Schema,
]);
export type OfficialEggContinuationV1 = z.infer<typeof OfficialEggContinuationV1Schema>;

const defeatDecisionShape = {
  schemaVersion: z.literal(1),
  kind: z.literal("defeat"),
  decisionId: boundedId,
  battleId: boundedId,
  canSaveMe: z.boolean(),
};

/** Server-derived presentation facts for a pending defeat; no outcome or replacement state. */
export const OfficialDefeatDecisionV1Schema = z.object(defeatDecisionShape).strict();
export type OfficialDefeatDecisionV1 = z.infer<typeof OfficialDefeatDecisionV1Schema>;

const eggDecisionCommonShape = {
  decisionId: boundedId,
  continuationId: boundedId,
  kind: eggKind,
  origin: OfficialEggOriginV1Schema,
  remainingRepeats: eggRemainingRepeats,
};

export const EggAwaitingSpinDecisionV1Schema = z.object({
  type: z.literal("egg.awaitingSpin"),
  ...eggDecisionCommonShape,
}).strict().superRefine(validateStoreRemainingRepeats);
export const EggSpinningDecisionV1Schema = z.object({
  type: z.literal("egg.spinning"),
  ...eggDecisionCommonShape,
  ...officialEggPoolShape,
  previewMonsterShortTypes: z.array(boundedId).max(2),
}).strict()
  .superRefine(validateEggPoolLengths)
  .superRefine(validateStoreRemainingRepeats);
export const EggAwaitingPrizeResolutionDecisionV1Schema = z.object({
  type: z.literal("egg.awaitingPrizeResolution"),
  ...eggDecisionCommonShape,
  ...officialEggPoolShape,
  previewMonsterShortTypes: z.array(boundedId).max(2),
  finalReelState: OfficialEggReelStateV1Schema,
  landedPrize: OfficialEggPrizeV1Schema,
}).strict()
  .superRefine(validateEggPoolLengths)
  .superRefine(validateStoreRemainingRepeats);
export const EggAwaitingRepeatOrFinishDecisionV1Schema = z.object({
  type: z.literal("egg.awaitingRepeatOrFinish"),
  ...eggDecisionCommonShape,
  settledPrize: OfficialEggPrizeV1Schema,
  resolution: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("keep") }).strict(),
    z.object({ kind: z.literal("feed"), recipientInstanceId: boundedId }).strict(),
  ]),
}).strict().superRefine(validateStoreRemainingRepeats);

export const EggContinuationDecisionV1Schema = z.discriminatedUnion("type", [
  EggAwaitingSpinDecisionV1Schema,
  EggSpinningDecisionV1Schema,
  EggAwaitingPrizeResolutionDecisionV1Schema,
  EggAwaitingRepeatOrFinishDecisionV1Schema,
]);
export type EggContinuationDecisionV1 = z.infer<typeof EggContinuationDecisionV1Schema>;

export const BattleDefeatDecisionV1Schema = z.object({
  type: z.literal("battle.defeatRecovery"),
  decisionId: boundedId,
  battleId: boundedId,
  canSaveMe: z.boolean(),
}).strict();
export type BattleDefeatDecisionV1 = z.infer<typeof BattleDefeatDecisionV1Schema>;

export const DecisionViewV1Schema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("battle.playerTurn"),
    decisionId: boundedId,
    battleId: boundedId,
    actorId: boundedId,
    choices: z.array(battleChoice).max(24),
    enemyTargetIds: z.array(boundedId).max(16),
    friendlyTargetIds: z.array(boundedId).max(16),
    canDelay: z.boolean(),
    canRetreat: z.boolean(),
    captureTargets: z.array(z.object({
      targetId: boundedId,
      availableCardLevels: z.array(captureCardLevel).max(3),
    }).strict()).max(8),
    summonableSpiritTypes: z.array(boundedId).max(32),
  }).strict(),
  z.object({
    type: z.literal("world.ready"),
    decisionId: boundedId,
    selectablePoiIds: z.array(boundedId).max(64),
  }).strict(),
  z.object({
    type: z.literal("dungeon.ready"),
    decisionId: boundedId,
    selectableRoomIds: z.array(dungeonEntityId).max(128),
    activatableZoneIds: z.array(dungeonEntityId).max(32),
  }).strict(),
  ...EggContinuationDecisionV1Schema.options,
  BattleDefeatDecisionV1Schema,
  z.object({ type: z.literal("none") }).strict(),
]);
export type DecisionViewV1 = z.infer<typeof DecisionViewV1Schema>;

type HistoricalPendingEggV1 = { readonly schemaVersion: 1; readonly kind: "silver" | "gold" };
type ProjectedPendingEggV1 = HistoricalPendingEggV1 | OfficialEggContinuationV1;
type ProjectionDecisionIdentityInput = {
  readonly simulationVersion: string;
  readonly decision: DecisionViewV1;
  readonly pendingEgg?: ProjectedPendingEggV1 | undefined;
  readonly pendingDefeat?: OfficialDefeatDecisionV1 | undefined;
};

function currentEggContinuation(
  pendingEgg: ProjectedPendingEggV1 | undefined,
): OfficialEggContinuationV1 | undefined {
  return pendingEgg !== undefined && "phase" in pendingEgg ? pendingEgg : undefined;
}

function historicalEggMarker(
  pendingEgg: ProjectedPendingEggV1 | undefined,
): HistoricalPendingEggV1 | undefined {
  return pendingEgg !== undefined && !("phase" in pendingEgg) ? pendingEgg : undefined;
}

function validateProjectionContinuationVersion(
  value: ProjectionDecisionIdentityInput,
  context: z.RefinementCtx,
): void {
  const currentEgg = currentEggContinuation(value.pendingEgg);
  const legacyEgg = historicalEggMarker(value.pendingEgg);
  if (value.simulationVersion === "official-game-v11") {
    if (currentEgg !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["pendingEgg"],
        message: "official-game-v11 projections cannot contain a phased Egg continuation",
      });
    }
    if (value.pendingDefeat !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["pendingDefeat"],
        message: "official-game-v11 projections cannot contain pendingDefeat",
      });
    }
  } else if (legacyEgg !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["pendingEgg"],
      message: "current projections cannot contain the historical one-bit Egg marker",
    });
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function eggDecisionForContinuation(
  continuation: OfficialEggContinuationV1,
): EggContinuationDecisionV1 {
  const common = {
    decisionId: continuation.decisionId,
    continuationId: continuation.continuationId,
    kind: continuation.kind,
    origin: continuation.origin,
    remainingRepeats: continuation.remainingRepeats,
  } as const;
  switch (continuation.phase) {
    case "awaiting-spin":
      return { type: "egg.awaitingSpin", ...common };
    case "spinning":
      return {
        type: "egg.spinning",
        ...common,
        providers: continuation.providers,
        reel: continuation.reel,
        previewMonsterShortTypes: continuation.previewMonsterShortTypes,
      };
    case "awaiting-prize-resolution":
      return {
        type: "egg.awaitingPrizeResolution",
        ...common,
        providers: continuation.providers,
        reel: continuation.reel,
        previewMonsterShortTypes: continuation.previewMonsterShortTypes,
        finalReelState: continuation.finalReelState,
        landedPrize: continuation.landedPrize,
      };
    case "awaiting-repeat-or-finish":
      return {
        type: "egg.awaitingRepeatOrFinish",
        ...common,
        settledPrize: continuation.settledPrize,
        resolution: continuation.resolution,
      };
  }
}

function validateProjectionDecisionIdentity(
  value: ProjectionDecisionIdentityInput,
  context: z.RefinementCtx,
): void {
  const pendingEgg = value.pendingEgg;
  const pendingDefeat = value.pendingDefeat;
  const decision = value.decision;
  const currentEgg = currentEggContinuation(pendingEgg);
  const legacyEgg = historicalEggMarker(pendingEgg);
  const hasEggDecision = decision.type.startsWith("egg.");
  const hasDefeatDecision = decision.type === "battle.defeatRecovery";

  if (currentEgg !== undefined) {
    const expected = eggDecisionForContinuation(currentEgg);
    if (decision.type !== expected.type || stableJson(decision) !== stableJson(expected)) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: "pendingEgg and decision must expose the same server decision",
      });
    }
  } else if (hasEggDecision) {
    context.addIssue({
      code: "custom",
      path: ["decision"],
      message: "an Egg decision requires a current pendingEgg continuation",
    });
  }

  if (pendingDefeat !== undefined) {
    const expected = {
      type: "battle.defeatRecovery" as const,
      decisionId: pendingDefeat.decisionId,
      battleId: pendingDefeat.battleId,
      canSaveMe: pendingDefeat.canSaveMe,
    } satisfies BattleDefeatDecisionV1;
    if (decision.type !== expected.type || stableJson(decision) !== stableJson(expected)) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: "pendingDefeat and decision must expose the same server decision",
      });
    }
  } else if (hasDefeatDecision) {
    context.addIssue({
      code: "custom",
      path: ["decision"],
      message: "a defeat decision requires pendingDefeat",
    });
  }

  if ((currentEgg !== undefined || legacyEgg !== undefined) && pendingDefeat !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["pendingEgg"],
      message: "a projection cannot have both an Egg and defeat continuation",
    });
  }
}

const monsterProjection = z.object({
  instanceId: boundedId,
  shortType: boundedId,
  level: positiveInteger,
  cumulativeXp: nonnegativeInteger,
  hp: nonnegativeInteger,
  maxHp: positiveInteger,
  injuredAt: z.string().datetime().optional(),
  injuredUntil: z.string().datetime().optional(),
  soulStone: z.object({
    element,
    level: positiveInteger,
    sourceTypeId: boundedId.optional(),
  }).strict().optional(),
}).strict();

const battleTeamMember = z.object({
  shortType: boundedId,
  level: positiveInteger,
  currentHp: nonnegativeInteger.optional(),
  capturable: z.boolean().optional(),
  sourceInstanceId: boundedId.optional(),
  boss: z.boolean().optional(),
  flatStatBonuses: z.object({
    MaxHP: z.number().finite().optional(),
    Attack: z.number().finite().optional(),
    Magic: z.number().finite().optional(),
    Speed: z.number().finite().optional(),
    Defense: z.number().finite().optional(),
    Resist: z.number().finite().optional(),
  }).strict().optional(),



  playerBuffs: z.object({
    MaxHP: z.number().finite().optional(),
    Attack: z.number().finite().optional(),
    Magic: z.number().finite().optional(),
    Speed: z.number().finite().optional(),
    Defense: z.number().finite().optional(),
    Resist: z.number().finite().optional(),
  }).strict().optional(),
  soulStone: z.object({
    element,
    level: positiveInteger,
    sourceType: boundedId.optional(),
  }).strict().optional(),
}).strict();

const battleReplayCommand = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ability"),
    actorId: boundedId,
    slot: z.string().regex(/^usable[0-9]+$/).max(24),
    targetIds: z.array(boundedId).max(16),
  }).strict(),
  z.object({
    type: z.literal("capture"),
    actorId: boundedId,
    targetId: boundedId,
    cardLevel: captureCardLevel,
    partyLevel: positiveInteger,
    externalSilverDebit: nonnegativeInteger.optional(),
  }).strict(),
  z.object({ type: z.literal("delay"), actorId: boundedId }).strict(),
  z.object({ type: z.literal("retreat"), actorId: boundedId }).strict(),
  z.object({
    type: z.literal("summonSpirit"),
    actorId: boundedId,
    shortType: boundedId,
    savedXp: positiveInteger,
  }).strict(),
]);

const worldView = z.object({
  worldId: boundedId,
  currentPoiId: boundedId,
  lastTownId: boundedId,
  dayNumber: positiveInteger,
  poiStates: z.record(boundedId, z.union([
    z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  ])),
  selectablePoiIds: z.array(boundedId).max(128),
  occurrenceByPoi: z.record(boundedId, z.boolean()),
  completedPoiIds: z.array(boundedId).max(512),
  poiWins: z.record(boundedId, nonnegativeInteger),
  everCompletedPoiIds: z.array(boundedId).max(512),
  /** Optional only while reading projections persisted before town-waypoint tracking. */
  visitedTownIds: z.array(boundedId).max(512).optional(),
}).strict();

const battleViewCommonShape = {
  battleId: boundedId,
  allowRetreat: z.boolean(),
  /** Present exactly when the authority's battle has a breeder. Breeder's omitted authored
   * `xpBonus` is projected as its native default 1.0; absence means `Battle.breeder == nil`. */
  breederXpBonus: z.number().finite().nonnegative().optional(),
  // Earned batting orders exceed 32 (license + heroLevel/3 + infiniteHighestLevel/10; a campaign
  // reached 40 Offline and Official faulted at 34). Match the party projection's 256 bound.
  teams: z.tuple([
    z.array(battleTeamMember).min(1).max(256),
    z.array(battleTeamMember).min(1).max(256),
  ]),
  options: z.object({
    fightingGroupSize: positiveInteger.optional(),
    blockCapture: z.boolean().optional(),
    silver: nonnegativeInteger.optional(),
    /** Private authority-selected construction rule, carried for exact presentation replay. */
    sourceJobLevels: z.boolean().optional(),
  }).strict(),
  /** Committed prefix only. There is no seed and no source for future draws. */
  randomDraws: z.array(unitRandomDraw).max(100_000),
  commands: z.array(battleReplayCommand).max(10_000),
} as const;

/**
 * Historical v11/v12 battle wire. `backgroundKey` carried a shipped combat-background file name,
 * which made the authority a holder of presentation content it can neither render nor need. It is
 * frozen here so persisted v11/v12 projections keep their exact parser, and replaced in v13.
 */
const battleView = z.object({
  ...battleViewCommonShape,
  backgroundKey: boundedId,
}).strict();

/**
 * Semantic identity of the scene a battle is fought in, derived on the server from the battle's
 * own origin. The browser resolves it to a background against the archive it loaded locally, so no
 * shipped-resource name crosses the wire or lands in a slot.
 */
export const BattleSceneV1Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("world"), worldId: boundedId, poiId: boundedId }).strict(),
  z.object({ kind: z.literal("dungeon"), dungeonId: dungeonEntityId }).strict(),
  z.object({ kind: z.literal("arena") }).strict(),
  z.object({ kind: z.literal("tournament") }).strict(),
]);
export type BattleSceneV1 = z.infer<typeof BattleSceneV1Schema>;

const battleViewV13 = z.object({
  ...battleViewCommonShape,
  scene: BattleSceneV1Schema,
}).strict();

/** Archive-neutral identity of a battle lifecycle chat. Portrait and localized bytes stay local. */
export const BattleLifecycleChatV1Schema = z.object({
  name: boundedId,
  alwaysShow: z.boolean(),
  messageKeys: z.array(boundedId).max(64).readonly(),
}).strict();
export type BattleLifecycleChatV1 = z.infer<typeof BattleLifecycleChatV1Schema>;

export type QuestJsonWireValue =
  | null
  | boolean
  | number
  | string
  | QuestJsonWireValue[]
  | { [key: string]: QuestJsonWireValue };

const questJsonValue: z.ZodType<QuestJsonWireValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string().max(1_024),
  z.array(questJsonValue).max(512),
  z.record(boundedId, questJsonValue),
]));

const questView = z.object({
  activeQuestNames: z.array(boundedId).max(3),
  finishedQuestNames: z.array(boundedId).max(512),
  progressByQuestName: z.record(boundedId, z.record(boundedId, questJsonValue)),
  dialogsSeen: z.array(boundedId).max(2_048),
  completedFixedEncounterKeys: z.array(boundedId).max(2_048),
  receivedBattleRewardKeys: z.array(boundedId).max(2_048),
}).strict();

const dungeonRoute = z.object({
  typeName: boundedId,
  sourceFile: boundedId,
  floor: positiveInteger,
  entryZoneName: boundedId.optional(),
}).strict();
const dungeonFloorSnapshot = z.object({
  schemaVersion: z.literal(1),
  definitionId: dungeonEntityId,
  floor: positiveInteger,
  seed: nonnegativeInteger,
  currentRoomId: dungeonEntityId,
  previousRoomId: dungeonEntityId.optional(),
  exploredRoomIds: z.array(dungeonEntityId).max(512).readonly(),
  clearedEncounterIds: z.array(dungeonEntityId).max(512).readonly(),
  collectedTreasureIds: z.array(dungeonEntityId).max(512).readonly(),
  registeredWaypointFloors: z.array(positiveInteger).max(512).readonly(),
  completedKeys: z.array(boundedId).max(2_048).readonly(),
  catchTypes: z.array(boundedId).max(512).readonly(),
  catchRewardCollected: z.boolean(),
  encounterRosters: z.array(z.object({
    encounterId: dungeonEntityId,
    monsters: z.array(z.object({
      type: boundedId,
      level: positiveInteger,
      extraLivingArguments: z.record(boundedId, questJsonValue).optional(),
    }).strict()).max(64).readonly(),
    terminalFlowId: boundedId.optional(),
    }).strict()).max(512).readonly().optional(),
  generationGateDecisions: z.array(z.object({
    fixedIndex: nonnegativeInteger,
    eligible: z.boolean(),
  }).strict()).max(512).readonly().optional(),
}).strict();
const dungeonCachedFloor = z.object({
  route: dungeonRoute,
  session: dungeonFloorSnapshot,
}).strict();
const dungeonRun = z.object({
  schemaVersion: z.literal(1),
  runSeed: nonnegativeInteger.optional(),
  captureSerial: nonnegativeInteger.optional(),
  terminalFlowSerial: nonnegativeInteger.optional(),
  current: dungeonCachedFloor,
  cachedFloors: z.array(dungeonCachedFloor).min(1).max(512).readonly(),
  registeredWaypoints: z.array(z.object({ route: dungeonRoute }).strict()).max(512).readonly().optional(),
  registeredWaypointFloors: z.array(positiveInteger).max(512).readonly().optional(),
  completedKeys: z.array(boundedId).max(2_048).readonly(),
  catchTypes: z.array(boundedId).max(512).readonly(),
  completedCatchQuestInstances: z.array(boundedId).max(512).readonly().optional(),
  catchRewardCollected: z.boolean(),
}).strict();

const dungeonView = z.object({
  run: dungeonRun,
  worldId: boundedId,
  entrancePoiId: boundedId,
}).strict();

const playerReward = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("silver"), amount: nonnegativeInteger }).strict(),
  z.object({ kind: z.literal("gold"), amount: nonnegativeInteger }).strict(),
  z.object({
    kind: z.literal("gem"),
    level: positiveInteger,
    quality: z.union([z.literal(0), z.literal(1)]),
    slot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    enabledStats: z.array(z.enum([
      "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
    ])).max(6),
  }).strict(),
  z.object({ kind: z.literal("spiritTotem"), shortType: boundedId }).strict(),
  z.object({ kind: z.literal("recipe"), combineName: boundedId }).strict(),
  z.object({ kind: z.literal("egg") }).strict(),
  z.object({ kind: z.literal("monsterEgg") }).strict(),
  z.object({
    kind: z.literal("monsterJoin"),
    shortType: boundedId,
    jobLevel: positiveInteger,
  }).strict(),
]);

const playerStat = z.enum(["MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist"]);
const storeReceivedItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("egg") }).strict(),
  z.object({ kind: z.literal("monsterEgg") }).strict(),
  z.object({
    kind: z.literal("usable"),
    definitionPath: boundedId,
    instanceName: boundedId,
    level: positiveInteger,
  }).strict(),
  z.object({
    kind: z.literal("gem"),
    definitionPath: boundedId,
    level: positiveInteger,
    quality: z.union([z.literal(0), z.literal(1)]),
    slot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    enabledStats: z.array(playerStat).max(6),
  }).strict(),
]);
const inventoryBase = {
  id: boundedId,
  definitionPath: boundedId,
  instanceName: boundedId,
};
const inventoryGem = z.object({
  ...inventoryBase,
  kind: z.literal("gem"),
  level: positiveInteger,
  quality: nonnegativeInteger,
  slot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  enabledStats: z.array(playerStat).max(6),
}).strict();
const inventoryItem = z.discriminatedUnion("kind", [
  z.object({
    ...inventoryBase,
    kind: z.literal("usable"),
    level: positiveInteger,
  }).strict(),
  inventoryGem,
  z.object({
    ...inventoryBase,
    kind: z.literal("egg"),
    onlyMonsters: z.boolean(),
    repeats: z.boolean(),
  }).strict(),
]);

const slotProjectionShape = {
  slotId,
  revision: positiveInteger,
  /** Server commit time. Optional only for reading projections persisted before this field existed. */
  updatedAt: z.string().datetime().optional(),
  logicPackId: z.string().regex(/^logic-v1:[a-f0-9]{64}$/),
  simulationVersion: boundedId,
  trustTier: z.literal("official"),
  player: z.object({
    heroLevel: positiveInteger,
    heroTotalHighestLevels: positiveInteger,
    silver: nonnegativeInteger,
    gold: nonnegativeInteger,
    captureCards: z.object({
      1: nonnegativeInteger,
      2: nonnegativeInteger,
      3: nonnegativeInteger,
    }).strict(),
    party: z.array(monsterProjection).max(256),
    battingOrderSize: positiveInteger,
    // Capacity grows with license, hero level and Abyss floors; use the existing party wire ceiling.
    battingOrderIds: z.array(boundedId).max(256),
    ownedSoulStones: z.array(z.object({
      stoneId: boundedId,
      element,
      level: positiveInteger,
      sourceTypeId: boundedId.optional(),
    }).strict()).max(256),
    highestCapturedLevels: z.record(boundedId, positiveInteger),
    learnedCombineRecipes: z.array(boundedId).max(512),
    tutorialFlags: z.array(boundedId).max(512),
    catchQuestsDone: z.array(boundedId).max(512),
    /** Optional only while reading projections persisted before authoritative waypoint support. */
    dungeonWaypoints: z.record(boundedId, z.array(positiveInteger).max(512)).optional(),
    /** `props["infiniteHighestLevel"]`: deepest Abyss floor ever entered. Absent on projections
     *  persisted before the Infinite Dungeon was authoritative; 0 there and for a player who has
     *  never entered it, exactly as the missing native property reads. */
    infiniteDungeonHighestLevel: nonnegativeInteger.optional(),
    items: z.record(itemId, positiveInteger),
    /** Optional only while reading projections created before structured player inventory. */
    inventory: z.object({
      schemaVersion: z.literal(1),
      nextItemSequence: positiveInteger,
      looseItems: z.array(inventoryItem).max(2048),
      equippedGems: z.object({
        0: inventoryGem.optional(),
        1: inventoryGem.optional(),
        2: inventoryGem.optional(),
        3: inventoryGem.optional(),
      }).strict(),
    }).strict().optional(),
    licenseType: z.enum([
      "Novice", "Apprentice", "Veteran", "Expert", "Elite", "Master", "Grandmaster",
    ]).optional(),
    skillPoints: z.object({
      MaxHP: nonnegativeInteger,
      Attack: nonnegativeInteger,
      Magic: nonnegativeInteger,
      Speed: nonnegativeInteger,
      Defense: nonnegativeInteger,
      Resist: nonnegativeInteger,
    }).strict().optional(),
    /** Optional only while reading projections created before Tournament progress persistence. */
    tournament: z.object({
      schemaVersion: z.literal(1),
      index: nonnegativeInteger,
      round: nonnegativeInteger.max(4),
      status: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      timeLast: nonnegativeInteger.optional(),
    }).strict().optional(),
    spirit: z.object({
      energy: nonnegativeInteger,
      savedXp: z.record(boundedId, positiveInteger),
      usedThisTrip: z.array(boundedId).max(128),
    }).strict(),
  }).strict(),
  location: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("none") }).strict(),
    z.object({ kind: z.literal("world"), worldId: boundedId, poiId: boundedId }).strict(),
    z.object({ kind: z.literal("town"), worldId: boundedId, townId: boundedId }).strict(),
    z.object({ kind: z.literal("battle"), worldId: boundedId, poiId: boundedId, battleId: boundedId }).strict(),
    z.object({ kind: z.literal("dungeon"), dungeonId: dungeonEntityId, floor: positiveInteger, roomId: dungeonEntityId }).strict(),
  ]),
  decision: DecisionViewV1Schema,
  world: worldView.optional(),
  battle: battleView.optional(),
  dungeon: dungeonView.optional(),
  quests: questView.optional(),
  pendingEgg: z.union([
    // Historical v11 projection shape; retained so old receipts remain parseable.
    z.object({
      schemaVersion: z.literal(1),
      kind: z.enum(["silver", "gold"]),
    }).strict(),
    OfficialEggContinuationV1Schema,
  ]).optional(),
  pendingDefeat: OfficialDefeatDecisionV1Schema.optional(),
} as const;

export const SlotProjectionV1Schema = z.object(slotProjectionShape).strict()
  .superRefine((value, context) => {
    validateProjectionContinuationVersion(value, context);
    validateProjectionDecisionIdentity(value, context);
  });
export type SlotProjectionV1 = z.infer<typeof SlotProjectionV1Schema>;

/**
 * Full strict projection for the additive official v12 aggregate. It reuses the historical
 * projection field definitions but narrows the simulation identity and phased Egg wire, then
 * requires Collection claims as a sibling. SlotProjectionV1Schema above is intentionally not
 * changed so historical v11 projections and receipts retain their exact parser.
 */
const officialGameProjectionV12Shape = {
  ...slotProjectionShape,
  updatedAt: z.string().datetime(),
  simulationVersion: z.literal(OFFICIAL_GAME_V12_SIMULATION_VERSION),
  pendingEgg: OfficialEggContinuationV1Schema.optional(),
  collectionClaims: CollectionClaimsV1Schema,
} as const;

export const OfficialGameProjectionV12Schema = z.object(officialGameProjectionV12Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
  });
export type OfficialGameProjectionV12 = z.infer<typeof OfficialGameProjectionV12Schema>;
export type OfficialGameProjectionBodyV12 = Omit<
  OfficialGameProjectionV12,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;

/**
 * The v13 aggregate is v12 with one substitution: the battle view names its scene semantically
 * instead of naming a shipped background file. Every other field is inherited unchanged, so this
 * is a presentation-boundary revision rather than a new gameplay domain.
 */
const officialGameProjectionV13Shape = {
  ...officialGameProjectionV12Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V13_SIMULATION_VERSION),
  battle: battleViewV13.optional(),
} as const;

export const OfficialGameProjectionV13Schema = z.object(officialGameProjectionV13Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
  });
export type OfficialGameProjectionV13 = z.infer<typeof OfficialGameProjectionV13Schema>;
export type OfficialGameProjectionBodyV13 = Omit<
  OfficialGameProjectionV13,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;

/**
 * v14 keeps v13's archive-neutral presentation wire. Its version boundary is behavioral: Save Me
 * resolves a deferred defeat by replacing the lost battle with a fresh replay of the same encounter.
 */
const officialGameProjectionV14Shape = {
  ...officialGameProjectionV13Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V14_SIMULATION_VERSION),
} as const;

export const OfficialGameProjectionV14Schema = z.object(officialGameProjectionV14Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
  });
export type OfficialGameProjectionV14 = z.infer<typeof OfficialGameProjectionV14Schema>;
export type OfficialGameProjectionBodyV14 = Omit<
  OfficialGameProjectionV14,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;

/**
 * v15 keeps v14's archive-neutral wire. Its version boundary restores the source town-heal
 * transaction on ordinary defeat return.
 */
const officialGameProjectionV15Shape = {
  ...officialGameProjectionV14Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V15_SIMULATION_VERSION),
} as const;

export const OfficialGameProjectionV15Schema = z.object(officialGameProjectionV15Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
  });
export type OfficialGameProjectionV15 = z.infer<typeof OfficialGameProjectionV15Schema>;
export type OfficialGameProjectionBodyV15 = Omit<
  OfficialGameProjectionV15,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;

/**
 * v16 preserves v15 gameplay while projecting the semantic post-win chat needed to finish an
 * active battle after reconnect. The browser resolves its portrait and text against local content.
 */
const battleViewV16 = z.object({
  ...battleViewCommonShape,
  scene: BattleSceneV1Schema,
  winChat: BattleLifecycleChatV1Schema.optional(),
}).strict();
const officialGameProjectionV16Shape = {
  ...officialGameProjectionV15Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V16_SIMULATION_VERSION),
  battle: battleViewV16.optional(),
} as const;

export const OfficialGameProjectionV16Schema = z.object(officialGameProjectionV16Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
  });
export type OfficialGameProjectionV16 = z.infer<typeof OfficialGameProjectionV16Schema>;
export type OfficialGameProjectionBodyV16 = Omit<
  OfficialGameProjectionV16,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;







export const OfficialDungeonBattleReturnV1Schema = z.object({
  schemaVersion: z.literal(1),
  battleId: boundedId,
  outcome: z.enum(["victory", "retreat"]),
  dungeonId: dungeonEntityId,
  floor: positiveInteger,
  roomId: dungeonEntityId,
  catchTypesBeforeBattle: z.array(boundedId).max(512),
}).strict().superRefine((value, context) => {
  const unique = new Set(value.catchTypesBeforeBattle);
  if (unique.size !== value.catchTypesBeforeBattle.length) {
    context.addIssue({
      code: "custom",
      path: ["catchTypesBeforeBattle"],
      message: "dungeon battle return catch baseline must not contain duplicates",
    });
  }
});
export type OfficialDungeonBattleReturnV1 = z.infer<
  typeof OfficialDungeonBattleReturnV1Schema
>;






const officialGameProjectionV17Shape = {
  ...officialGameProjectionV16Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V17_SIMULATION_VERSION),
  dungeonBattleReturn: OfficialDungeonBattleReturnV1Schema.optional(),
} as const;

export const OfficialGameProjectionV17Schema = z.object(officialGameProjectionV17Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
    const handoff = value.dungeonBattleReturn;
    if (handoff === undefined) return;
    if (
      value.location.kind !== "dungeon" ||
      value.dungeon === undefined ||
      value.location.dungeonId !== handoff.dungeonId ||
      value.location.floor !== handoff.floor ||
      value.location.roomId !== handoff.roomId
    ) {
      context.addIssue({
        code: "custom",
        path: ["dungeonBattleReturn"],
        message: "dungeon battle return must identify the projected dungeon location",
      });
    }
  });
export type OfficialGameProjectionV17 = z.infer<typeof OfficialGameProjectionV17Schema>;
export type OfficialGameProjectionBodyV17 = Omit<
  OfficialGameProjectionV17,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;

/**
 * v18 keeps v17's archive-neutral wire and corrects only authority-owned town-origin world-battle
 * lifecycle semantics. A distinct simulation identity keeps every historical outcome immutable.
 */
const officialGameProjectionV18Shape = {
  ...officialGameProjectionV17Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V18_SIMULATION_VERSION),
} as const;

export const OfficialGameProjectionV18Schema = z.object(officialGameProjectionV18Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
    const handoff = value.dungeonBattleReturn;
    if (handoff === undefined) return;
    if (
      value.location.kind !== "dungeon" ||
      value.dungeon === undefined ||
      value.location.dungeonId !== handoff.dungeonId ||
      value.location.floor !== handoff.floor ||
      value.location.roomId !== handoff.roomId
    ) {
      context.addIssue({
        code: "custom",
        path: ["dungeonBattleReturn"],
        message: "dungeon battle return must identify the projected dungeon location",
      });
    }
  });
export type OfficialGameProjectionV18 = z.infer<typeof OfficialGameProjectionV18Schema>;
export type OfficialGameProjectionBodyV18 = Omit<
  OfficialGameProjectionV18,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
>;

/**
 * v19 keeps v18's archive-neutral, shape-preserving wire. Its new immutable identity gates only
 * replay-derived Tournament Escape settlement; v18 remains available for historical records.
 */
const officialGameProjectionV19Shape = {
  ...officialGameProjectionV18Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V19_SIMULATION_VERSION),
} as const;

export const OfficialGameProjectionV19Schema = z.object(officialGameProjectionV19Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
    const handoff = value.dungeonBattleReturn;
    if (handoff === undefined) return;
    if (
      value.location.kind !== "dungeon" ||
      value.dungeon === undefined ||
      value.location.dungeonId !== handoff.dungeonId ||
      value.location.floor !== handoff.floor ||
      value.location.roomId !== handoff.roomId
    ) {
      context.addIssue({
        code: "custom",
        path: ["dungeonBattleReturn"],
        message: "dungeon battle return must identify the projected dungeon location",
      });
    }
  });
export type OfficialGameProjectionV19 = z.infer<typeof OfficialGameProjectionV19Schema>;
export type OfficialGameProjectionBodyV19 = Omit<
  OfficialGameProjectionV19,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & {
  // Type-only brand: v19's body is wire-identical to v18, but this keeps the service's generic
  // projection/result correlation exact. The property is never serialized.
  readonly __officialGameV19: true;
};

/**
 * v20 keeps v19's archive-neutral, shape-preserving wire. Its new immutable identity gates only
 * source-faithful Tournament Save Me settlement; v19 remains available for historical records.
 */
const officialGameProjectionV20Shape = {
  ...officialGameProjectionV19Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V20_SIMULATION_VERSION),
} as const;

export const OfficialGameProjectionV20Schema = z.object(officialGameProjectionV20Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
    const handoff = value.dungeonBattleReturn;
    if (handoff === undefined) return;
    if (
      value.location.kind !== "dungeon" ||
      value.dungeon === undefined ||
      value.location.dungeonId !== handoff.dungeonId ||
      value.location.floor !== handoff.floor ||
      value.location.roomId !== handoff.roomId
    ) {
      context.addIssue({
        code: "custom",
        path: ["dungeonBattleReturn"],
        message: "dungeon battle return must identify the projected dungeon location",
      });
    }
  });
export type OfficialGameProjectionV20 = z.infer<typeof OfficialGameProjectionV20Schema>;
export type OfficialGameProjectionBodyV20 = Omit<
  OfficialGameProjectionV20,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & {
  // Type-only brand: v20's body is wire-identical to v19, but this keeps the service's generic
  // projection/result correlation exact. The property is never serialized.
  readonly __officialGameV20: true;
};

/**
 * v21 keeps v20's archive-neutral, shape-preserving wire. Its new immutable identity admits the
 * replay-derived Arena Escape terminal while retaining the source's live no-navigation bug.
 */
const officialGameProjectionV21Shape = {
  ...officialGameProjectionV20Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V21_SIMULATION_VERSION),
} as const;

export const OfficialGameProjectionV21Schema = z.object(officialGameProjectionV21Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
    const handoff = value.dungeonBattleReturn;
    if (handoff === undefined) return;
    if (
      value.location.kind !== "dungeon" ||
      value.dungeon === undefined ||
      value.location.dungeonId !== handoff.dungeonId ||
      value.location.floor !== handoff.floor ||
      value.location.roomId !== handoff.roomId
    ) {
      context.addIssue({
        code: "custom",
        path: ["dungeonBattleReturn"],
        message: "dungeon battle return must identify the projected dungeon location",
      });
    }
  });
export type OfficialGameProjectionV21 = z.infer<typeof OfficialGameProjectionV21Schema>;
export type OfficialGameProjectionBodyV21 = Omit<
  OfficialGameProjectionV21,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & {
  // Type-only brand: v21's body is wire-identical to v20, but service correlation stays exact.
  readonly __officialGameV21: true;
};





const officialGameProjectionV22Shape = {
  ...officialGameProjectionV21Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V22_SIMULATION_VERSION),
} as const;

export const OfficialGameProjectionV22Schema = z.object(officialGameProjectionV22Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
    const handoff = value.dungeonBattleReturn;
    if (handoff === undefined) return;
    if (
      value.location.kind !== "dungeon" ||
      value.dungeon === undefined ||
      value.location.dungeonId !== handoff.dungeonId ||
      value.location.floor !== handoff.floor ||
      value.location.roomId !== handoff.roomId
    ) {
      context.addIssue({
        code: "custom",
        path: ["dungeonBattleReturn"],
        message: "dungeon battle return must identify the projected dungeon location",
      });
    }
  });
export type OfficialGameProjectionV22 = z.infer<typeof OfficialGameProjectionV22Schema>;
export type OfficialGameProjectionBodyV22 = Omit<
  OfficialGameProjectionV22,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & {
  readonly __officialGameV22: true;
};

/** v23 preserves the strict wire shape and corrects Egg RNG semantics. */
const officialGameProjectionV23Shape = {
  ...officialGameProjectionV22Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V23_SIMULATION_VERSION),
} as const;

export const OfficialGameProjectionV23Schema = z.object(officialGameProjectionV23Shape)
  .strict()
  .superRefine((value, context) => {
    validateProjectionDecisionIdentity(value, context);
    const handoff = value.dungeonBattleReturn;
    if (handoff === undefined) return;
    if (
      value.location.kind !== "dungeon" ||
      value.dungeon === undefined ||
      value.location.dungeonId !== handoff.dungeonId ||
      value.location.floor !== handoff.floor ||
      value.location.roomId !== handoff.roomId
    ) {
      context.addIssue({
        code: "custom",
        path: ["dungeonBattleReturn"],
        message: "dungeon battle return must identify the projected dungeon location",
      });
    }
  });
export type OfficialGameProjectionV23 = z.infer<typeof OfficialGameProjectionV23Schema>;
export type OfficialGameProjectionBodyV23 = Omit<
  OfficialGameProjectionV23,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & {
  readonly __officialGameV23: true;
};

/** Archive-neutral fixed-encounter identity. No renderer or asset reference is admitted. */
export const FixedBattleEncounterV1Schema = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("world"), tableKey: boundedId }).strict(),
    z.object({ kind: z.literal("dungeon"), encounterId: boundedId }).strict(),
  ]),
  members: z.array(z.object({
    type: boundedId,
    level: positiveInteger,
    extraLivingArguments: z.object({
      boss: z.boolean().optional(),
      capturable: z.boolean().optional(),
      allowCapture: z.boolean().optional(),
      displayName: boundedId.optional(),
    }).strict().optional(),
    // Must mirror the enemy team (see the v24 refinement), whose bound is 256: authored
    // encounters field more than 32 (official-fresh-24 faulted entering one in World_4-1).
  }).strict()).min(1).max(256),
}).strict();
export type FixedBattleEncounterV1 = z.infer<typeof FixedBattleEncounterV1Schema>;

/** v24 retains mechanics and adds an exact archive-local encounter restoration boundary. */
const officialGameProjectionV24Shape = {
  ...officialGameProjectionV23Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V24_SIMULATION_VERSION),
  battle: battleViewV16.extend({ fixedEncounter: FixedBattleEncounterV1Schema.nullable() }).optional(),
} as const;
const officialGameProjectionV24Object = z.object(officialGameProjectionV24Shape).strict();
/** v24's cross-field invariants; v25 keeps the identical wire and therefore the identical rules. */
function refineOfficialGameProjectionV24Shape(
  value: Omit<z.infer<typeof officialGameProjectionV24Object>, "simulationVersion"> & {
    readonly simulationVersion: string;
  },
  context: z.RefinementCtx,
): void {
  validateProjectionDecisionIdentity(value, context);
  const handoff = value.dungeonBattleReturn;
  if (handoff !== undefined && (value.location.kind !== "dungeon" ||
    value.dungeon === undefined || value.location.dungeonId !== handoff.dungeonId ||
    value.location.floor !== handoff.floor || value.location.roomId !== handoff.roomId)) {
    context.addIssue({ code: "custom", path: ["dungeonBattleReturn"],
      message: "dungeon battle return must identify the projected dungeon location" });
  }
  const battle = value.battle;
  const fixed = battle?.fixedEncounter;
  if (battle !== undefined && fixed != null &&
    (fixed.source.kind !== battle.scene.kind || fixed.members.length !== battle.teams[1].length ||
     fixed.members.some((member, index) => member.type !== battle.teams[1][index]?.shortType ||
       member.level !== battle.teams[1][index]?.level))) {
    context.addIssue({ code: "custom", path: ["battle", "fixedEncounter"],
      message: "fixed encounter must identify the committed enemy construction roster" });
  }
}
export const OfficialGameProjectionV24Schema = officialGameProjectionV24Object
  .superRefine(refineOfficialGameProjectionV24Shape);
export type OfficialGameProjectionV24 = z.infer<typeof OfficialGameProjectionV24Schema>;
export type OfficialGameProjectionBodyV24 = Omit<OfficialGameProjectionV24,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & { readonly __officialGameV24: true };

/**
 * v25 keeps the v24 wire byte-for-byte; only the simulation identity changes. Its new story
 * rules surface through existing fields (`quests.dialogsSeen`, quest events, typed rejections).
 */
const officialGameProjectionV25Shape = {
  ...officialGameProjectionV24Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V25_SIMULATION_VERSION),
} as const;
export const OfficialGameProjectionV25Schema = z.object(officialGameProjectionV25Shape)
  .strict().superRefine(refineOfficialGameProjectionV24Shape);
export type OfficialGameProjectionV25 = z.infer<typeof OfficialGameProjectionV25Schema>;
export type OfficialGameProjectionBodyV25 = Omit<OfficialGameProjectionV25,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & { readonly __officialGameV25: true };

/** v26 settles silver spent in the automatic battle opening; wire shape is unchanged. */
const officialGameProjectionV26Shape = {
  ...officialGameProjectionV25Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V26_SIMULATION_VERSION),
} as const;
export const OfficialGameProjectionV26Schema = z.object(officialGameProjectionV26Shape)
  .strict().superRefine(refineOfficialGameProjectionV24Shape);
export type OfficialGameProjectionV26 = z.infer<typeof OfficialGameProjectionV26Schema>;
export type OfficialGameProjectionBodyV26 = Omit<OfficialGameProjectionV26,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & { readonly __officialGameV26: true };

/** v27 pins source Job construction in each newly created battle replay. */
const officialGameProjectionV27Shape = {
  ...officialGameProjectionV26Shape,
  simulationVersion: z.literal(OFFICIAL_GAME_V27_SIMULATION_VERSION),
} as const;
export const OfficialGameProjectionV27Schema = z.object(officialGameProjectionV27Shape)
  .strict().superRefine(refineOfficialGameProjectionV24Shape);
export type OfficialGameProjectionV27 = z.infer<typeof OfficialGameProjectionV27Schema>;
export type OfficialGameProjectionBodyV27 = Omit<OfficialGameProjectionV27,
  "slotId" | "revision" | "updatedAt" | "logicPackId" | "simulationVersion" | "trustTier"
> & { readonly __officialGameV27: true };

const eventBase = {
  seq: positiveInteger,
};
export const PresentationEventV1Schema = z.discriminatedUnion("type", [
  z.object({ ...eventBase, type: z.literal("slot.created") }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("world.arrived"),
    worldId: boundedId,
    poiId: boundedId,
    movement: z.enum(["walk", "teleport", "same"]),
    /** Exact draws consumed by this committed arrival; presentation replay only. */
    randomDraws: z.array(unitRandomDraw).max(10_000),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("dungeon.entered"),
    dungeonId: dungeonEntityId,
    floor: positiveInteger,
    roomId: dungeonEntityId,
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("dungeon.zoneActivated"),
    zoneId: dungeonEntityId,
    destination: z.enum(["floor", "dungeon", "world"]),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("dungeon.waypointTravelled"),
    dungeonId: dungeonEntityId,
    floor: positiveInteger,
    roomId: dungeonEntityId,
    restoredFromCache: z.boolean(),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("dungeon.treasureClaimed"),
    treasureId: dungeonEntityId,
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("dungeon.catchRewardClaimed"),
    dungeonId: dungeonEntityId,
  }).strict(),







  z.object({
    ...eventBase,
    type: z.literal("dungeon.infiniteFloorEntered"),
    dungeonId: dungeonEntityId,
    floor: positiveInteger,
    previousHighest: nonnegativeInteger,
  }).strict(),
  z.object({ ...eventBase, type: z.literal("dungeon.exited") }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("tournament.battleStarted"),
    tournamentIndex: nonnegativeInteger,
    round: nonnegativeInteger.max(3),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("tournament.progressed"),
    tournamentIndex: nonnegativeInteger,
    round: nonnegativeInteger.max(4),
    status: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("tournament.prizeClaimed"),
    tournamentIndex: nonnegativeInteger,
  }).strict(),
  z.object({ ...eventBase, type: z.literal("battle.started"), battleId: boundedId }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("battle.replayAdvanced"),
    battleId: boundedId,
    commandCount: positiveInteger,
    committedDrawCount: nonnegativeInteger,
    randomDraws: z.array(unitRandomDraw).max(10_000),
  }).strict(),
  z.object({ ...eventBase, type: z.literal("battle.abilityUsed"), battleId: boundedId, sourceId: boundedId, abilityId: boundedId, targetIds: z.array(boundedId).max(16), tier: nonnegativeInteger.optional() }).strict(),
  z.object({ ...eventBase, type: z.literal("battle.damage"), battleId: boundedId, sourceId: boundedId, targetId: boundedId, amount: nonnegativeInteger, hpAfter: nonnegativeInteger }).strict(),
  z.object({ ...eventBase, type: z.literal("battle.healed"), battleId: boundedId, sourceId: boundedId, targetId: boundedId, amount: nonnegativeInteger, hpAfter: nonnegativeInteger }).strict(),
  z.object({ ...eventBase, type: z.literal("battle.statusAdded"), battleId: boundedId, targetId: boundedId, statusId: boundedId, buffTypeId: boundedId }).strict(),
  z.object({ ...eventBase, type: z.literal("battle.statusRemoved"), battleId: boundedId, targetId: boundedId, statusId: boundedId }).strict(),
  z.object({ ...eventBase, type: z.literal("battle.captureResolved"), battleId: boundedId, targetId: boundedId, success: z.boolean(), cardLevel: captureCardLevel }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("battle.rewardsGranted"),
    battleId: boundedId,
    rewards: z.array(playerReward).max(256),
  }).strict(),
  z.object({ ...eventBase, type: z.literal("battle.ended"), battleId: boundedId, outcome: z.enum(["victory", "defeat", "retreat", "draw"]) }).strict(),
  z.object({ ...eventBase, type: z.literal("player.currencyChanged"), currency: z.enum(["silver", "gold"]), delta: z.number().int().safe(), balance: nonnegativeInteger }).strict(),
  z.object({ ...eventBase, type: z.literal("player.monsterAdded"), instanceId: boundedId, monsterTypeId: boundedId, level: positiveInteger, reason: z.enum(["starter", "capture", "combine", "hatch", "reward"]) }).strict(),
  z.object({ ...eventBase, type: z.literal("player.monsterRemoved"), instanceId: boundedId, reason: z.enum(["combine", "destroy", "soulStone"]) }).strict(),
  z.object({ ...eventBase, type: z.literal("player.xpAwarded"), instanceId: boundedId, amount: nonnegativeInteger, levelBefore: positiveInteger, levelAfter: positiveInteger }).strict(),
  z.object({ ...eventBase, type: z.literal("player.evolved"), instanceId: boundedId, fromTypeId: boundedId, toTypeId: boundedId, level: positiveInteger }).strict(),
  z.object({ ...eventBase, type: z.literal("party.orderCommitted"), activeInstanceIds: z.array(boundedId).min(1).max(256) }).strict(),
  z.object({ ...eventBase, type: z.literal("party.injuryHealed"), instanceId: boundedId, goldCost: nonnegativeInteger }).strict(),
  z.object({ ...eventBase, type: z.literal("party.soulStoneAdded"), stoneId: boundedId, element, level: positiveInteger, sourceTypeId: boundedId.optional() }).strict(),
  z.object({ ...eventBase, type: z.literal("party.soulStoneEquipped"), stoneId: boundedId, instanceId: boundedId }).strict(),
  z.object({ ...eventBase, type: z.literal("player.tutorialFlagClaimed"), flag: boundedId }).strict(),
  z.object({ ...eventBase, type: z.literal("player.dialogClaimed"), dialogId: boundedId }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("store.purchased"),
    stockId: boundedId,
    quantity: positiveInteger,
    currency: z.enum(["silver", "gold"]),
    spent: positiveInteger,
    balance: nonnegativeInteger,
    randomDraws: z.array(unitRandomDraw).max(256),
    receivedItems: z.array(storeReceivedItem).max(99),
  }).strict(),
  z.object({ ...eventBase, type: z.literal("dungeon.roomSelected"), dungeonId: dungeonEntityId, roomId: dungeonEntityId, transition: z.enum(["door-walk", "fade-teleport", "same-room"]) }).strict(),
  z.object({ ...eventBase, type: z.literal("quest.accepted"), questId: boundedId }).strict(),
  z.object({ ...eventBase, type: z.literal("quest.droppedAll") }).strict(),
  z.object({
    ...eventBase,
    type: z.literal("quest.rewardClaimed"),
    questId: boundedId,
    rewards: z.array(playerReward).max(256),
    randomDraws: z.array(unitRandomDraw).max(10_000),
  }).strict(),
  z.object({ ...eventBase, type: z.literal("quest.progressed"), questId: boundedId, current: nonnegativeInteger, required: positiveInteger }).strict(),
  z.object({ ...eventBase, type: z.literal("quest.completed"), questId: boundedId }).strict(),
]);
export type PresentationEventV1 = z.infer<typeof PresentationEventV1Schema>;
export type UnsequencedPresentationEventV1 =
  PresentationEventV1 extends infer E
    ? E extends PresentationEventV1
      ? Omit<E, "seq">
      : never
    : never;

const gameCommandResultShape = {
  protocolVersion: z.literal(GAME_PROTOCOL_VERSION),
  commandId,
  previousRevision: nonnegativeInteger,
  revision: positiveInteger,
  eventCursorStart: nonnegativeInteger,
  eventCursorEnd: nonnegativeInteger,
  events: z.array(PresentationEventV1Schema).max(4096),
  idempotentReplay: z.boolean(),
} as const;

function validateCommandResultCursor(
  value: {
    readonly revision: number;
    readonly previousRevision: number;
    readonly idempotentReplay: boolean;
    readonly events: readonly unknown[];
    readonly eventCursorStart: number;
    readonly eventCursorEnd: number;
  },
  context: z.RefinementCtx,
): void {
  if (value.revision !== value.previousRevision + 1 && !value.idempotentReplay) {
    context.addIssue({ code: "custom", message: "a committed command must advance exactly one revision" });
  }
  const expectedCount = value.eventCursorEnd - value.eventCursorStart + 1;
  if (value.events.length === 0) {
    if (value.eventCursorEnd !== value.eventCursorStart) {
      context.addIssue({ code: "custom", message: "an empty event batch must use an empty cursor interval" });
    }
  } else if (expectedCount !== value.events.length) {
    context.addIssue({ code: "custom", message: "event cursor interval does not match the event batch" });
  }
}

export const GameCommandResultV1Schema = z.object({
  ...gameCommandResultShape,
  projection: SlotProjectionV1Schema,
}).strict().superRefine(validateCommandResultCursor);
export type GameCommandResultV1 = z.infer<typeof GameCommandResultV1Schema>;

/** Full strict result wire for an installed official-game-v12 authority. */
export const OfficialGameCommandResultV12Schema = GameCommandResultV1Schema.safeExtend({
  projection: OfficialGameProjectionV12Schema,
});
export type OfficialGameCommandResultV12 = z.infer<typeof OfficialGameCommandResultV12Schema>;

/**
 * Full strict result wire for an installed official-game-v13 authority. v13's battle view is not a
 * widening of the historical one — it drops `backgroundKey` — so this is built from the shared
 * result shape rather than extended off `GameCommandResultV1Schema`.
 */
export const OfficialGameCommandResultV13Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV13Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV13 = z.infer<typeof OfficialGameCommandResultV13Schema>;

/** Full strict result wire for the historical official-game-v14 authority. */
export const OfficialGameCommandResultV14Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV14Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV14 = z.infer<typeof OfficialGameCommandResultV14Schema>;

/** Full strict result wire for the historical official-game-v15 authority. */
export const OfficialGameCommandResultV15Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV15Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV15 = z.infer<typeof OfficialGameCommandResultV15Schema>;

/** Full strict result wire for the historical official-game-v16 authority. */
export const OfficialGameCommandResultV16Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV16Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV16 = z.infer<typeof OfficialGameCommandResultV16Schema>;

/** Full strict result wire for the historical official-game-v17 authority. */
export const OfficialGameCommandResultV17Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV17Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV17 = z.infer<typeof OfficialGameCommandResultV17Schema>;

/** Full strict result wire for the installed official-game-v18 authority. */
export const OfficialGameCommandResultV18Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV18Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV18 = z.infer<typeof OfficialGameCommandResultV18Schema>;

/** Full strict result wire for the installed official-game-v19 authority. */
export const OfficialGameCommandResultV19Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV19Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV19 = z.infer<typeof OfficialGameCommandResultV19Schema>;

/** Full strict result wire for the historical official-game-v20 authority. */
export const OfficialGameCommandResultV20Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV20Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV20 = z.infer<typeof OfficialGameCommandResultV20Schema>;

/** Full strict result wire for the historical official-game-v21 authority. */
export const OfficialGameCommandResultV21Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV21Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV21 = z.infer<typeof OfficialGameCommandResultV21Schema>;

/** Full strict result wire for the installed official-game-v22 authority. */
export const OfficialGameCommandResultV22Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV22Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV22 = z.infer<typeof OfficialGameCommandResultV22Schema>;

export const OfficialGameCommandResultV23Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV23Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV23 = z.infer<typeof OfficialGameCommandResultV23Schema>;

export const OfficialGameCommandResultV24Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV24Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV24 = z.infer<typeof OfficialGameCommandResultV24Schema>;

export const OfficialGameCommandResultV25Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV25Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV25 = z.infer<typeof OfficialGameCommandResultV25Schema>;
export const OfficialGameCommandResultV26Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV26Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV26 = z.infer<typeof OfficialGameCommandResultV26Schema>;
export const OfficialGameCommandResultV27Schema = z.object({
  ...gameCommandResultShape,
  projection: OfficialGameProjectionV27Schema,
}).strict().superRefine(validateCommandResultCursor);
export type OfficialGameCommandResultV27 = z.infer<typeof OfficialGameCommandResultV27Schema>;

export const GameErrorCodeV1Schema = z.enum([
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "PACK_UNKNOWN",
  "PACK_UNAVAILABLE",
  "CAPABILITY_UNSUPPORTED",
  "SLOT_NOT_FOUND",
  "SLOT_NOT_EMPTY",
  "REVISION_CONFLICT",
  "DECISION_STALE",
  "COMMAND_DUPLICATE_MISMATCH",
  "ACTION_NOT_ALLOWED",
  "ENTITY_NOT_FOUND",
  "INSUFFICIENT_FUNDS",
  "INVALID_TARGET",
  "STATE_CORRUPT",
  "SIMULATION_VERSION_UNAVAILABLE",
  "RATE_LIMITED",
  "INTERNAL",
]);
export type GameErrorCodeV1 = z.infer<typeof GameErrorCodeV1Schema>;

export const GameErrorV1Schema = z.object({
  error: z.object({
    code: GameErrorCodeV1Schema,
    message: z.string().min(1).max(500),
    currentRevision: nonnegativeInteger.optional(),
    retryable: z.boolean(),
    correlationId: boundedId,
  }).strict(),
}).strict();
export type GameErrorV1 = z.infer<typeof GameErrorV1Schema>;

export function parseHistoricalGameCommandEnvelopeV1(
  value: unknown,
): HistoricalGameCommandEnvelopeV1 {
  return HistoricalGameCommandEnvelopeV1Schema.parse(value);
}

export function parseCurrentGameCommandEnvelopeV1(
  value: unknown,
): CurrentGameCommandEnvelopeV1 {
  return CurrentGameCommandEnvelopeV1Schema.parse(value);
}

/** Backward-compatible name for the broad historical wire parser. */
export function parseGameCommandEnvelopeV1(value: unknown): GameCommandEnvelopeV1 {
  return parseHistoricalGameCommandEnvelopeV1(value);
}

export function parseHistoricalGameCommandResultV1(value: unknown): GameCommandResultV1 {
  return GameCommandResultV1Schema.parse(value);
}

export function parseOfficialGameCommandResultV12(value: unknown): OfficialGameCommandResultV12 {
  return OfficialGameCommandResultV12Schema.parse(value);
}

export function parseOfficialGameCommandResultV13(value: unknown): OfficialGameCommandResultV13 {
  return OfficialGameCommandResultV13Schema.parse(value);
}

/** Backward-compatible name for the broad historical receipt parser. */
export function parseGameCommandResultV1(value: unknown): GameCommandResultV1 {
  return parseHistoricalGameCommandResultV1(value);
}
