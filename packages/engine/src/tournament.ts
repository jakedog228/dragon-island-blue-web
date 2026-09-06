import type { ItemDef, TournamentDef } from "@dib/gamedata";
import { parseDungeonTreasureData } from "@dib/gamedata/dungeon";
import type { PlayerReward } from "./rewards.js";
import type { Rng } from "./rng.js";
import { generateFixedEncounterRewards, generateQuestRewards } from "./dungeon.js";
import type { GeneratedWorldEncounter } from "./world.js";

export const TOURNAMENT_ROUND_COUNT = 4;
export const TOURNAMENT_COOLDOWN_SECONDS = 86_400;

export type TournamentStatus = 0 | 1 | 2;
/** Terminal disposition of one Tournament battle. Escape is not a defeat: the source
 * `TournamentEncounter combatRetreatFinished:` path returns to town without invoking the
 * tournament progress writer. */
export type TournamentBattleOutcome = "victory" | "defeat" | "retreat";

export interface TournamentProgressSnapshotV1 {
  readonly schemaVersion: 1;
  readonly index: number;
  readonly round: number;
  readonly status: TournamentStatus;
  readonly timeLast?: number;
}

export interface TournamentEncounter {
  readonly encounter: GeneratedWorldEncounter;
  readonly startChatKey?: string;
  readonly rewards: readonly PlayerReward[];
}

/** Source `UserSavedData.properties["tournament"]` state machine. A battle attempt starts a
 * 24-hour clock. Victories advance through four rounds; a loss resets the round but preserves the
 * clock, and the fourth victory exposes the class prize until explicitly claimed. */
export class TournamentProgress {
  private indexValue: number;
  private roundValue: number;
  private statusValue: TournamentStatus;
  private timeLastValue: number | undefined;

  constructor(snapshot: TournamentProgressSnapshotV1 = emptyTournamentProgress()) {
    if (snapshot.schemaVersion !== 1) throw new Error("TournamentProgress: unsupported schema");
    requireNonnegative(snapshot.index, "index");
    requireRound(snapshot.round);
    if (snapshot.status !== 0 && snapshot.status !== 1 && snapshot.status !== 2) {
      throw new Error(`TournamentProgress: invalid status ${snapshot.status}`);
    }
    if ((snapshot.status === 2) !== (snapshot.round === TOURNAMENT_ROUND_COUNT)) {
      throw new Error("TournamentProgress: prize-ready status requires completed fourth round");
    }
    if (snapshot.timeLast !== undefined && !Number.isFinite(snapshot.timeLast)) {
      throw new Error(`TournamentProgress: invalid last battle time ${snapshot.timeLast}`);
    }
    this.indexValue = snapshot.index;
    this.roundValue = snapshot.round;
    this.statusValue = snapshot.status;
    this.timeLastValue = snapshot.timeLast;
  }

  get index(): number { return this.indexValue; }
  get round(): number { return this.roundValue; }
  get status(): TournamentStatus { return this.statusValue; }
  get timeLast(): number | undefined { return this.timeLastValue; }

  timeToNextTournament(nowSeconds: number): number {
    requireTime(nowSeconds);
    if (this.timeLastValue === undefined) return 0;
    return Math.max(0, TOURNAMENT_COOLDOWN_SECONDS - (nowSeconds - this.timeLastValue));
  }

  beginBattle(nowSeconds: number): number {
    if (this.statusValue === 2) {
      throw new Error("TournamentProgress: claim the current prize before starting another battle");
    }
    const remaining = this.timeToNextTournament(nowSeconds);
    if (remaining > 0) return remaining;
    this.timeLastValue = nowSeconds;
    return 0;
  }

  settleBattle(outcome: TournamentBattleOutcome): void {
    if (outcome === "retreat") return;
    if (outcome === "defeat") {
      this.roundValue = 0;
      this.statusValue = 0;
      return;
    }
    this.roundValue += 1;
    this.statusValue = this.roundValue > TOURNAMENT_ROUND_COUNT - 1 ? 2 : 1;
  }

  claimPrize(): number {
    if (this.statusValue !== 2) {
      throw new Error("TournamentProgress: tournament prize is not ready");
    }
    this.indexValue += 1;
    this.roundValue = 0;
    this.statusValue = 0;
    return this.indexValue;
  }

  stateSnapshot(): TournamentProgressSnapshotV1 {
    return Object.freeze({
      schemaVersion: 1,
      index: this.indexValue,
      round: this.roundValue,
      status: this.statusValue,
      ...(this.timeLastValue === undefined ? {} : { timeLast: this.timeLastValue }),
    });
  }
}

export function emptyTournamentProgress(): TournamentProgressSnapshotV1 {
  return Object.freeze({ schemaVersion: 1, index: 0, round: 0, status: 0 });
}

/** `Tournament.encounterForRound:`: select the authored populator at the exact current round,
 * build its one fixed encounter at floor 1, and force the Arena combat background. */
export function buildTournamentEncounter(
  tournament: TournamentDef,
  round: number,
  rng: Rng,
): TournamentEncounter {
  if (!Number.isSafeInteger(round) || round < 0 || round >= TOURNAMENT_ROUND_COUNT) {
    throw new Error(`invalid tournament round: ${round}`);
  }
  const populator = record(
    tournament.monsterPopulators[round],
    `${tournament.name}.monsterPopulators[${round}]`,
  );
  if (populator["class"] !== "DefaultMonsterPopulator") {
    throw new Error(`${tournament.name} round ${round} requires DefaultMonsterPopulator`);
  }
  const args = record(populator["arguments"], `${tournament.name}.round${round}.arguments`);
  const fixed = array(args["fixedEncounters"], `${tournament.name}.round${round}.fixedEncounters`);
  if (fixed.length !== 1) {
    throw new Error(`${tournament.name} round ${round} must contain exactly one fixed encounter`);
  }
  const candidate = record(fixed[0], `${tournament.name}.round${round}.fixedEncounters[0]`);


  const chanceToAppear = optionalFinite(candidate["chanceToAppear"], 1);
  if (!rng.chance(chanceToAppear)) {
    throw new Error(
      `${tournament.name} round ${round} fixed encounter failed its chanceToAppear roll`,
    );
  }
  const monsters = array(candidate["monsters"], `${tournament.name}.round${round}.monsters`).map(
    (value, index) => {
      const monster = record(value, `${tournament.name}.round${round}.monsters[${index}]`);
      const type = nonempty(monster["type"], `${tournament.name}.round${round}.monsters[${index}].type`);
      const scale = optionalFinite(monster["levelScalor"], 1);
      return Object.freeze({
        type,
        level: Math.max(1, Math.trunc(Math.fround(
          Math.fround(tournament.challengeLevel) * Math.fround(scale),
        ))),
        ...(monster["extraLivingArguments"] === undefined
          ? {}
          : {
              extraLivingArguments: Object.freeze({
                ...record(
                  monster["extraLivingArguments"],
                  `${tournament.name}.round${round}.monsters[${index}].extraLivingArguments`,
                ),
              }),
            }),
      });
    },
  );
  if (monsters.length === 0) throw new Error(`${tournament.name} round ${round} has no monsters`);
  const breeder = candidate["breeder"] === undefined
    ? undefined
    : parseBreeder(candidate["breeder"], `${tournament.name}.round${round}`);
  const startChatKey = parseStartChat(candidate["startEvent"]);
  const monsterLevelSum = monsters.reduce((sum, monster) => sum + monster.level, 0);
  const rewards = candidate["treasureData"] === undefined
    ? Object.freeze([]) as readonly PlayerReward[]
    : generateFixedEncounterRewards(
        parseDungeonTreasureData(
          candidate["treasureData"],
          `Tournaments.plist[${tournament.index}].monsterPopulators[${round}].treasureData`,
          1,
        ),
        tournament.challengeLevel,
        monsterLevelSum,
        rng,
      );
  return Object.freeze({
    encounter: Object.freeze({
      kind: "fixed",
      poiName: `Tournament:${tournament.index}:${round}`,
      forced: true,
      tableKey: `${tournament.index}:${round}`,
      poiWinsBeforeEncounter: 0,
      challengeLevel: tournament.challengeLevel,
      monsters: Object.freeze(monsters),
      ...(breeder === undefined ? {} : { breeder }),
    }),
    ...(startChatKey === undefined ? {} : { startChatKey }),
    rewards,
  });
}

/** `Tournament.itemRewards`: class treasure uses challenge level, monster-level sum zero, and an
 * explicit default spawn chance of one—the same TreasureData call shape as quest rewards. */
export function generateTournamentPrize(
  tournament: TournamentDef,
  rng: Rng,
  itemCatalog?: Pick<{ item(path: string): ItemDef }, "item">,
): readonly PlayerReward[] {
  return generateQuestRewards(
    parseDungeonTreasureData(
      tournament.treasureData,
      `Tournaments.plist[${tournament.index}].treasureData`,
      1,
      itemCatalog,
    ),
    tournament.challengeLevel,
    rng,
  );
}

function parseBreeder(value: unknown, path: string) {
  const breeder = record(value, `${path}.breeder`);
  if (breeder["type"] !== "Normal") throw new Error(`${path} breeder must be Normal`);
  const args = record(breeder["arguments"], `${path}.breeder.arguments`);
  const stats = args["stats"] === undefined
    ? undefined
    : Object.freeze({ ...record(args["stats"], `${path}.breeder.arguments.stats`) });
  return Object.freeze({
    type: "Normal",
    arguments: Object.freeze({
      ...(stats === undefined ? {} : { stats }),
      ...(args["xpBonus"] === undefined ? {} : { xpBonus: optionalFinite(args["xpBonus"], 0) }),
      ...(args["allowCapture"] === undefined ? {} : { allowCapture: Boolean(args["allowCapture"]) }),
    }),
  });
}

function parseStartChat(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const event = record(value, "tournament.startEvent");
  if (event["class"] !== "ChatGameFlowEvent") {
    throw new Error("tournament startEvent must be ChatGameFlowEvent");
  }
  return nonempty(event["chatKey"], "tournament.startEvent.chatKey");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be a dictionary`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function nonempty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${path} must be nonempty`);
  return value;
}

function optionalFinite(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`expected finite number, got ${String(value)}`);
  }
  return value;
}

function requireNonnegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`TournamentProgress: invalid ${label} ${value}`);
  }
}

function requireRound(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > TOURNAMENT_ROUND_COUNT) {
    throw new Error(`TournamentProgress: invalid round ${value}`);
  }
}

function requireTime(value: number): void {
  if (!Number.isFinite(value)) throw new Error(`TournamentProgress: invalid time ${value}`);
}
