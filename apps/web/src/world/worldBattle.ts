import type { GeneratedWorldEncounter, TeamMemberSetup } from "@dib/engine";
import type { DungeonBreederSpec } from "@dib/gamedata";
import type { BattleTeamMemberSetup, EncounterConfig } from "../battle/encounter.js";

const STAT_NAMES = new Set(["Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed"]);

export interface WorldBattleBuild {
  readonly encounter: EncounterConfig;
  readonly rewardKey?: string;
  readonly rewards: NonNullable<GeneratedWorldEncounter["rewards"]>;
}

export interface WorldBattleSaveMeContext {
  readonly owner: "world" | "tournament" | "arena" | "direct-demo" | "reconnect";
  readonly authority: "local" | "official";
}

/** Base `Encounter.blockSaveMe` is NO. Arena overrides it to YES; direct/demo battles have no
 * durable return owner. A local reconnect remains fail-closed, while an Official reconnect can
 * use the authority's atomic replacement-battle continuation and restart onto that projection. */
export function withWorldBattleSaveMePolicy(
  encounter: EncounterConfig,
  context: WorldBattleSaveMeContext,
): EncounterConfig {
  return {
    ...encounter,
    blockSaveMe:
      context.owner === "arena" ||
      context.owner === "direct-demo" ||
      (context.owner === "reconnect" && context.authority !== "official"),
  };
}

/** App-boundary translation of a generated source WorldEncounter into BattleNode state. */
export function buildWorldBattle(
  generated: GeneratedWorldEncounter,
  backgroundKey: string,
  playerTeam: readonly TeamMemberSetup[],
): WorldBattleBuild {
  if (playerTeam.length === 0) throw new Error("World battle requires an alive player batting prefix");
  const breeder = parseBreeder(generated.breeder);
  const enemyTeam = generated.monsters.map((monster, index) => {
    const setup: BattleTeamMemberSetup = {
      shortType: monster.type,
      level: monster.level,
    };
    applyExtraLivingArguments(setup, monster.extraLivingArguments, generated.poiName, index);
    if (Object.keys(breeder.stats).length !== 0) setup.flatStatBonuses = breeder.stats;
    // Native applies the breeder after constructing both active and reserve members.
    if (breeder.present) setup.capturable = breeder.allowCapture;
    return setup;
  });
  if (enemyTeam.length === 0) {
    throw new Error(`World fixed encounter at ${generated.poiName} has no monsters`);
  }
  return Object.freeze({
    encounter: {
      backgroundKey,
      blockSaveMe: false,
      ...(breeder.xpBonus === undefined ? {} : { breederXpBonus: breeder.xpBonus }),
      ...(generated.questKey === undefined ? {} : { questKey: generated.questKey }),
      ...(generated.completionKey === undefined ? {} : { uniqueKey: generated.completionKey }),
      ...(generated.startEvent === undefined ? {} : { startChat: generated.startEvent.chat }),
      ...(generated.winEvent === undefined ? {} : { winChat: generated.winEvent.chat }),
      playerTeam: playerTeam.map((member) => ({ ...member })),
      enemyTeam,
    },
    ...(generated.battleRewardKey === undefined && generated.questKey === undefined
      ? {}
      : { rewardKey: generated.battleRewardKey ?? generated.questKey }),
    rewards: generated.rewards ?? Object.freeze([]),
  });
}

interface ParsedBreeder {
  readonly present: boolean;
  readonly stats: Partial<Record<"Attack" | "Defense" | "Magic" | "MaxHP" | "Resist" | "Speed", number>>;
  readonly xpBonus?: number;
  readonly allowCapture: boolean;
}

function parseBreeder(breeder: DungeonBreederSpec | undefined): ParsedBreeder {
  if (breeder === undefined) {
    return Object.freeze({ present: false, stats: Object.freeze({}), allowCapture: true });
  }
  if (breeder.type !== "Normal") throw new Error(`Unsupported world breeder ${breeder.type}`);
  const stats: Record<string, number> = {};
  const rawStats = breeder.arguments["stats"];
  if (rawStats !== undefined) {
    if (!isRecord(rawStats)) throw new Error("World breeder.stats must be an object");
    for (const [name, amount] of Object.entries(rawStats)) {
      if (!STAT_NAMES.has(name)) throw new Error(`World breeder has unsupported stat ${name}`);
      if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
        throw new Error(`World breeder.stats.${name} must be a safe integer`);
      }
      // `NormalBreeder.applyToTeam:` only adds authored positive bonuses.
      if (amount > 0) stats[name] = amount;
    }
  }
  const xpBonus = breeder.arguments["xpBonus"];
  if (xpBonus !== undefined && (
    typeof xpBonus !== "number" || !Number.isFinite(xpBonus) || xpBonus < 0
  )) {
    throw new Error("World breeder.xpBonus must be a non-negative number");
  }
  const allowCapture = breeder.arguments["allowCapture"];
  if (allowCapture !== undefined && typeof allowCapture !== "boolean") {
    throw new Error("World breeder.allowCapture must be boolean");
  }
  return Object.freeze({
    present: true,
    stats: Object.freeze(stats),
    // `Breeder._initWithName:dictionary:arguments:` initializes xpBonus to 1.0 before reading
    // the optional override. Keeping it present also preserves the source's `Battle.breeder`
    // music gate independently of whether any enemy has its unrelated `Living.boss` flag.
    xpBonus: xpBonus ?? 1,
    allowCapture: allowCapture ?? false,
  }) as ParsedBreeder;
}

function applyExtraLivingArguments(
  setup: BattleTeamMemberSetup,
  value: Readonly<Record<string, unknown>> | undefined,
  poiName: string,
  index: number,
): void {
  if (value === undefined) return;
  for (const [key, argument] of Object.entries(value)) {
    if (key === "boss") {
      if (typeof argument !== "boolean") throw livingArgumentError(poiName, index, key);
      setup.boss = argument;
    } else if (key === "capturable" || key === "allowCapture") {
      if (typeof argument !== "boolean") throw livingArgumentError(poiName, index, key);
      setup.capturable = argument;
    } else if (key === "displayName") {
      if (typeof argument !== "string" || argument.length === 0) {
        throw livingArgumentError(poiName, index, key);
      }
      setup.displayName = argument;
    } else if (key === "rendererData") {
      if (!isRecord(argument)) throw livingArgumentError(poiName, index, key);
      setup.rendererData = Object.freeze({ ...argument });
    } else {
      throw new Error(`World fixed encounter ${poiName} monster ${index} has unsupported living argument ${key}`);
    }
  }
}

function livingArgumentError(poiName: string, index: number, key: string): Error {
  return new Error(`World fixed encounter ${poiName} monster ${index} has invalid ${key}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
