import type { LicenseDef } from "@dib/gamedata";
import type { GeneratedWorldEncounter } from "./world.js";

export interface LicenseChallengeEncounter {
  readonly encounter: GeneratedWorldEncounter;
  readonly startChatKey?: string;
  readonly winChatKey?: string;
}

/** `BaseLicense.challengeEncounter`: the license's one fixed encounter at its authored challenge
 * level and floor 1. Arena asserts that the populator returns no item rewards.
 *
 * Unlike `buildTournamentEncounter`, this takes no Rng even though the source's
 * `DefaultMonsterPopulator` spends one `arc4random()` on the candidate's `chanceToAppear` roll:
 * the Arena challenge produces no treasure and its battle runs on a freshly seeded stream, so
 * that draw has no observable successor to shift. */
export function buildLicenseChallengeEncounter(
  license: LicenseDef,
): LicenseChallengeEncounter {
  const populator = record(license.monsterPopulator, `${license.type}.monsterPopulator`);
  if (populator["class"] !== "DefaultMonsterPopulator") {
    throw new Error(`${license.type} license requires DefaultMonsterPopulator`);
  }
  const args = record(populator["arguments"], `${license.type}.monsterPopulator.arguments`);
  const fixed = array(args["fixedEncounters"], `${license.type}.fixedEncounters`);
  if (fixed.length !== 1) {
    throw new Error(`${license.type} license must contain exactly one fixed encounter`);
  }
  const candidate = record(fixed[0], `${license.type}.fixedEncounters[0]`);
  if (candidate["treasureData"] !== undefined) {
    throw new Error(`${license.type} Arena challenge must not produce items`);
  }
  const monsters = array(candidate["monsters"], `${license.type}.monsters`).map(
    (value, index) => {
      const monster = record(value, `${license.type}.monsters[${index}]`);
      const type = nonempty(monster["type"], `${license.type}.monsters[${index}].type`);
      const scale = optionalFinite(monster["levelScalor"], 1);
      const level = Math.max(
        1,
        Math.trunc(Math.fround(Math.fround(license.challengeLevel) * Math.fround(scale))),
      );
      return Object.freeze({
        type,
        level,
        ...(monster["extraLivingArguments"] === undefined
          ? {}
          : {
              extraLivingArguments: Object.freeze({
                ...record(
                  monster["extraLivingArguments"],
                  `${license.type}.monsters[${index}].extraLivingArguments`,
                ),
              }),
            }),
      });
    },
  );
  if (monsters.length === 0) throw new Error(`${license.type} Arena challenge has no monsters`);
  const breeder = candidate["breeder"] === undefined
    ? undefined
    : parseBreeder(candidate["breeder"], license.type);
  return Object.freeze({
    encounter: Object.freeze({
      kind: "fixed",
      poiName: `Arena:${license.type}`,
      forced: true,
      tableKey: license.type,
      poiWinsBeforeEncounter: 0,
      challengeLevel: license.challengeLevel,
      monsters: Object.freeze(monsters),
      ...(breeder === undefined ? {} : { breeder }),
    }),
    ...chat(candidate["startEvent"], "startChatKey"),
    ...chat(candidate["winEvent"], "winChatKey"),
  });
}

function parseBreeder(value: unknown, type: string) {
  const breeder = record(value, `${type}.breeder`);
  if (breeder["type"] !== "Normal") throw new Error(`${type} Arena breeder must be Normal`);
  const args = record(breeder["arguments"], `${type}.breeder.arguments`);
  const stats = args["stats"] === undefined
    ? undefined
    : Object.freeze({ ...record(args["stats"], `${type}.breeder.arguments.stats`) });
  return Object.freeze({
    type: "Normal",
    arguments: Object.freeze({
      ...(stats === undefined ? {} : { stats }),
      ...(args["xpBonus"] === undefined
        ? {}
        : { xpBonus: optionalFinite(args["xpBonus"], 0) }),
      ...(args["allowCapture"] === undefined
        ? {}
        : { allowCapture: Boolean(args["allowCapture"]) }),
    }),
  });
}

function chat(
  value: unknown,
  field: "startChatKey" | "winChatKey",
): Partial<Record<"startChatKey" | "winChatKey", string>> {
  if (value === undefined) return {};
  const event = record(value, field);
  if (event["class"] !== "ChatGameFlowEvent") throw new Error(`${field} must be ChatGameFlowEvent`);
  return { [field]: nonempty(event["chatKey"], `${field}.chatKey`) };
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
