import { z } from "zod";
import { SAVE_SLOT_IDS } from "@dib/save-protocol";

export const PVP_PROTOCOL_VERSION = "pvp-protocol-v1" as const;
export const OFFICIAL_PVP_MOD_ID = "dib.official.pvp" as const;
const key = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const team = z.union([z.literal(0), z.literal(1)]);
const boundedNumber = z.number().finite().min(-1_000_000).max(1_000_000);
const statBonuses = z.object({
  MaxHP: boundedNumber.optional(), Attack: boundedNumber.optional(), Defense: boundedNumber.optional(),
  Magic: boundedNumber.optional(), Resist: boundedNumber.optional(), Speed: boundedNumber.optional(),
}).strict();

/** Offline entrants are explicitly untrusted exhibitions; this is never an Official save input. */
export const PvpRosterMemberV1Schema = z.object({
  shortType: key,
  level: z.number().int().min(1).max(100_000),
  boss: z.boolean().optional(),
  flatStatBonuses: statBonuses.optional(),
  playerBuffs: statBonuses.optional(),
  soulStone: z.object({
    element: z.enum(["Air", "Arcane", "Death", "Earth", "Fire", "Life", "Water"]),
    level: z.number().int().min(0).max(100_000),
    sourceType: key.optional(),
  }).strict().optional(),
}).strict();
export const PvpModSelectionV1Schema = z.object({ id: key, version: z.string().min(1).max(60), digest }).strict();
export const PvpClientSetupV1Schema = z.object({
  logicPackId: z.string().regex(/^logic-v1:[a-f0-9]{64}$/),
  /** Ordered package identities. Only operator-reviewed digests determine compatibility. */
  mods: z.array(PvpModSelectionV1Schema).max(64),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  value.mods.forEach((mod, index) => {
    if (ids.has(mod.id)) context.addIssue({ code: "custom", path: ["mods", index, "id"], message: "A mod may only be selected once." });
    ids.add(mod.id);
  });
});
export const PvpEntryV1Schema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("official"), slotId: z.enum(SAVE_SLOT_IDS) }).strict(),
  z.object({ source: z.literal("offline"), party: z.array(PvpRosterMemberV1Schema).min(1).max(32) }).strict(),
]);
export const PvpInviteRequestV1Schema = z.object({
  requestId: z.uuid(), setup: PvpClientSetupV1Schema, entry: PvpEntryV1Schema,
}).strict();
export const PvpJoinRequestV1Schema = PvpInviteRequestV1Schema.extend({
  code: z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{8}$/),
});
const intentScalar = z.union([z.string().max(160), boundedNumber, z.boolean()]);
export const PvpAdapterIntentV1Schema = z.record(key, z.union([intentScalar, z.array(intentScalar).max(128)]))
  .superRefine((input, context) => {
    if (Object.keys(input).length > 16) context.addIssue({ code: "custom", message: "Too many adapter intent fields" });
  });
export const PvpAdapterIdentityV1Schema = z.object({ rulesId: key, digest }).strict();
export const PvpActionV1Schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ability"), actorId: key, slot: z.string().regex(/^usable[0-9]+$/), targets: z.array(key).max(32) }).strict(),
  z.object({ type: z.literal("delay"), actorId: key }).strict(),
  z.object({ type: z.literal("forfeit") }).strict(),
  z.object({ type: z.literal("adapter"), actorId: key, rulesId: key, command: key, input: PvpAdapterIntentV1Schema }).strict(),
]);
export const PvpCommandV1Schema = z.object({
  commandId: z.uuid(), expectedRevision: z.number().int().nonnegative(),
  decisionId: key, action: PvpActionV1Schema,
}).strict();
export const PvpBattleSnapshotV1Schema = z.object({
  simulationVersion: z.literal("pvp-v1"),
  adapters: z.array(PvpAdapterIdentityV1Schema).min(1).max(64).optional(),
  teams: z.tuple([
    z.array(PvpRosterMemberV1Schema.extend({ capturable: z.literal(false) })).min(1).max(32),
    z.array(PvpRosterMemberV1Schema.extend({ capturable: z.literal(false) })).min(1).max(32),
  ]),
  fightingGroupSize: z.number().int().min(1).max(3),
  randomDraws: z.array(z.number().min(0).lt(1)).max(1_000_000),
  commands: z.array(z.object({ team, action: PvpActionV1Schema }).strict()).max(2001),
}).strict();
export const PvpMatchViewV1Schema = z.object({
  protocolVersion: z.literal(PVP_PROTOCOL_VERSION),
  matchId: z.uuid(),
  logicPackId: z.string().regex(/^logic-v1:[a-f0-9]{64}$/),
  revision: z.number().int().nonnegative(),
  status: z.enum(["waiting", "active", "ended", "cancelled", "expired"]),
  you: team,
  players: z.array(z.object({ name: z.string().min(1).max(60), source: z.enum(["official", "offline"]) }).strict()).min(1).max(2),
  code: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/).optional(),
  expiresAt: z.number().int().nonnegative(),
  profileId: key.optional(),
  notes: z.array(z.string().max(500)).max(16),
  battle: PvpBattleSnapshotV1Schema.optional(),
  decisionId: key.optional(),
  turn: team.optional(),
  winner: z.union([team, z.literal("draw")]).optional(),
  endReason: z.enum(["defeat", "forfeit", "escape", "turn-limit", "timeout"]).optional(),
}).strict();
export const PvpSessionV1Schema = z.object({
  protocolVersion: z.literal(PVP_PROTOCOL_VERSION), token: z.string().min(1).max(4096), expiresAt: z.number().int().nonnegative(),
}).strict();
export const PvpCurrentMatchV1Schema = z.object({ match: PvpMatchViewV1Schema.nullable() }).strict();
export const PvpCompatibilityIssueV1Schema = z.object({
  code: z.enum(["CONTENT_MISMATCH", "MOD_UNSUPPORTED", "MOD_VERSION_MISMATCH", "MOD_ORDER_MISMATCH", "RULE_CONFLICT", "PROFILE_UNAVAILABLE", "PARTY_UNSUPPORTED"]),
  path: z.string().min(1).max(300),
  modId: key.optional(),
  message: z.string().min(1).max(500),
  suggestion: z.string().min(1).max(500),
}).strict();
export const PvpErrorV1Schema = z.object({
  code: z.enum(["INVALID_REQUEST", "NOT_FOUND", "INVITE_EXPIRED", "INVITE_UNAVAILABLE", "SELF_JOIN", "ALREADY_ACTIVE", "NOT_YOUR_TURN", "STALE_DECISION", "COMMAND_CONFLICT", "MATCH_ENDED", "INCOMPATIBLE", "UNAVAILABLE", "UNAUTHORIZED", "RATE_LIMITED"]),
  message: z.string().min(1).max(500),
  issues: z.array(PvpCompatibilityIssueV1Schema).max(128),
}).strict();

export type PvpRosterMemberV1 = z.infer<typeof PvpRosterMemberV1Schema>;
export type PvpModSelectionV1 = z.infer<typeof PvpModSelectionV1Schema>;
export type PvpClientSetupV1 = z.infer<typeof PvpClientSetupV1Schema>;
export type PvpEntryV1 = z.infer<typeof PvpEntryV1Schema>;
export type PvpInviteRequestV1 = z.infer<typeof PvpInviteRequestV1Schema>;
export type PvpJoinRequestV1 = z.infer<typeof PvpJoinRequestV1Schema>;
export type PvpCommandV1 = z.infer<typeof PvpCommandV1Schema>;
export type PvpBattleSnapshotV1 = z.infer<typeof PvpBattleSnapshotV1Schema>;
export type PvpMatchViewV1 = z.infer<typeof PvpMatchViewV1Schema>;
export type PvpCompatibilityIssueV1 = z.infer<typeof PvpCompatibilityIssueV1Schema>;
export type PvpErrorV1 = z.infer<typeof PvpErrorV1Schema>;
export type PvpTeamV1 = z.infer<typeof team>;
