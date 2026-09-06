


export interface QuestDataSource {
  has(path: string): boolean;
  plist(path: string): unknown;
}

export type QuestClassName =
  | "DefeatMonstersQuest"
  | "ClearWorldQuest"
  | "MakeSoulstonesQuest"
  | "ClearDungeonQuest"
  | "GetSpiritTotemQuest"
  | "PromoteMonsterQuest"
  | "CombineMonstersQuest"
  | "WinBattleQuest"
  | "ReachDungeonFloorQuest"
  | "CatchMonstersQuest"
  | "VisitTownQuest"
  | "WinBattleListQuest";

export type QuestJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly QuestJsonValue[]
  | Readonly<{ [key: string]: QuestJsonValue }>;

export interface QuestBaseDefinition {
  readonly name: string;
  readonly className: QuestClassName;
  readonly source?: string;
  readonly challengeLevel: number;
  readonly treasureData: Readonly<Record<string, QuestJsonValue>>;
  readonly questKey?: string;
  readonly eraseDataAtTown: boolean;
}

export interface QuantityQuestDefinition extends QuestBaseDefinition {
  readonly className:
    | "DefeatMonstersQuest"
    | "MakeSoulstonesQuest"
    | "GetSpiritTotemQuest"
    | "PromoteMonsterQuest"
    | "CombineMonstersQuest"
    | "WinBattleQuest"
    | "CatchMonstersQuest";
  readonly quantity: number;
  readonly type?: string;
  readonly type1?: string;
  readonly type2?: string;
  readonly monstersLeft?: number;
  readonly allAlive?: boolean;
  readonly difficultyModifier?: number;
}

export interface ClearWorldQuestDefinition extends QuestBaseDefinition {
  readonly className: "ClearWorldQuest";
  readonly percent: number;
  readonly type: string;
}

export interface ClearDungeonQuestDefinition extends QuestBaseDefinition {
  readonly className: "ClearDungeonQuest";
  readonly type: string;
  readonly startFloor: number;
  readonly endFloor: number;
  /** Native omitted default is true. */
  readonly showMonsterCount: boolean;
}

export interface ReachDungeonFloorQuestDefinition extends QuestBaseDefinition {
  readonly className: "ReachDungeonFloorQuest";
  readonly type: string;
  readonly floor: number;
}

export interface VisitTownQuestDefinition extends QuestBaseDefinition {
  readonly className: "VisitTownQuest";
  readonly townName: string;
}

export interface WinBattleListQuestDefinition extends QuestBaseDefinition {
  readonly className: "WinBattleListQuest";
  readonly battleKeys: readonly string[];
}

export type QuestDefinition =
  | QuantityQuestDefinition
  | ClearWorldQuestDefinition
  | ClearDungeonQuestDefinition
  | ReachDungeonFloorQuestDefinition
  | VisitTownQuestDefinition
  | WinBattleListQuestDefinition;

export class QuestDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestDataError";
  }
}

export class QuestCatalog {
  private readonly byName: ReadonlyMap<string, QuestDefinition>;

  constructor(readonly definitions: readonly QuestDefinition[]) {
    const indexed = new Map<string, QuestDefinition>();
    for (const definition of definitions) {
      if (indexed.has(definition.name)) {
        throw new QuestDataError(`Quests.plist contains duplicate quest name ${definition.name}`);
      }
      indexed.set(definition.name, definition);
    }
    this.byName = indexed;
    Object.freeze(this);
  }

  questForName(name: string): QuestDefinition | undefined {
    return this.byName.get(name);
  }

  requireQuest(name: string): QuestDefinition {
    const quest = this.questForName(name);
    if (quest === undefined) throw new QuestDataError(`Quests.plist has no quest named ${name}`);
    return quest;
  }
}

const BASE_KEYS = new Set([
  "name",
  "class",
  "source",
  "challengeLevel",
  "treasureData",
  "questKey",
  "eraseDataAtTown",
]);

const CLASS_KEYS: Readonly<Record<QuestClassName, ReadonlySet<string>>> = {
  DefeatMonstersQuest: new Set(["quantity", "type"]),
  ClearWorldQuest: new Set(["percent", "type"]),
  MakeSoulstonesQuest: new Set(["quantity"]),
  ClearDungeonQuest: new Set(["type", "startFloor", "endFloor", "showMonsterCount"]),
  GetSpiritTotemQuest: new Set(["quantity", "type"]),
  PromoteMonsterQuest: new Set(["quantity", "type"]),
  CombineMonstersQuest: new Set(["quantity", "type1", "type2"]),
  WinBattleQuest: new Set(["quantity", "monstersLeft", "allAlive", "difficultyModifier"]),
  ReachDungeonFloorQuest: new Set(["type", "floor"]),
  CatchMonstersQuest: new Set(["quantity", "type"]),
  VisitTownQuest: new Set(["townName"]),
  WinBattleListQuest: new Set(["battleKeys"]),
};

const CLASS_NAMES = new Set<QuestClassName>(
  Object.keys(CLASS_KEYS) as QuestClassName[],
);

export function loadQuestCatalog(source: QuestDataSource): QuestCatalog {
  if (!source.has("Quests.plist")) throw new QuestDataError("required resource is missing: Quests.plist");
  const raw = source.plist("Quests.plist");
  if (!Array.isArray(raw)) throw new QuestDataError("Quests.plist must be an ordered array");
  const definitions = raw.map((value, index) => parseQuest(value, `Quests.plist[${index}]`));
  return new QuestCatalog(Object.freeze(definitions));
}

function parseQuest(value: unknown, label: string): QuestDefinition {
  const raw = dictionary(value, label);
  const name = nonEmptyString(raw["name"], `${label}.name`);
  const classValue = nonEmptyString(raw["class"], `${label}.class`);
  if (!CLASS_NAMES.has(classValue as QuestClassName)) {
    throw new QuestDataError(`${label}.class has unsupported Quest subclass ${classValue}`);
  }
  const className = classValue as QuestClassName;
  exactKeys(raw, new Set([...BASE_KEYS, ...CLASS_KEYS[className]]), label);

  const challengeLevel = Math.max(1, integer(raw["challengeLevel"], `${label}.challengeLevel`));
  const base = {
    name,
    className,
    challengeLevel,
    treasureData: freezeJsonDictionary(raw["treasureData"], `${label}.treasureData`),
    eraseDataAtTown: optionalBoolean(raw["eraseDataAtTown"], false, `${label}.eraseDataAtTown`),
    ...(raw["source"] === undefined
      ? {}
      : { source: nonEmptyString(raw["source"], `${label}.source`) }),
    ...(raw["questKey"] === undefined
      ? {}
      : { questKey: nonEmptyString(raw["questKey"], `${label}.questKey`) }),
  } satisfies QuestBaseDefinition;

  switch (className) {
    case "ClearWorldQuest":
      return Object.freeze({
        ...base,
        className,
        percent: positiveNumber(raw["percent"], `${label}.percent`),
        type: nonEmptyString(raw["type"], `${label}.type`),
      });
    case "ClearDungeonQuest": {
      const startFloor = positiveInteger(raw["startFloor"], `${label}.startFloor`);
      const endFloor = positiveInteger(raw["endFloor"], `${label}.endFloor`);
      if (endFloor < startFloor) throw new QuestDataError(`${label}.endFloor precedes startFloor`);
      return Object.freeze({
        ...base,
        className,
        type: nonEmptyString(raw["type"], `${label}.type`),
        startFloor,
        endFloor,
        showMonsterCount: optionalBoolean(raw["showMonsterCount"], true, `${label}.showMonsterCount`),
      });
    }
    case "ReachDungeonFloorQuest":
      return Object.freeze({
        ...base,
        className,
        type: nonEmptyString(raw["type"], `${label}.type`),
        floor: positiveInteger(raw["floor"], `${label}.floor`),
      });
    case "VisitTownQuest":
      return Object.freeze({
        ...base,
        className,
        townName: nonEmptyString(raw["townName"], `${label}.townName`),
      });
    case "WinBattleListQuest":
      return Object.freeze({
        ...base,
        className,
        battleKeys: stringArray(raw["battleKeys"], `${label}.battleKeys`),
      });
    default:
      return parseQuantityQuest(raw, label, base, className);
  }
}

function parseQuantityQuest(
  raw: Readonly<Record<string, unknown>>,
  label: string,
  base: QuestBaseDefinition,
  className: QuantityQuestDefinition["className"],
): QuantityQuestDefinition {
  const common = {
    ...base,
    className,
    quantity: positiveInteger(raw["quantity"], `${label}.quantity`),
  };
  switch (className) {
    case "CombineMonstersQuest":
      return Object.freeze({
        ...common,
        type1: nonEmptyString(raw["type1"], `${label}.type1`),
        type2: nonEmptyString(raw["type2"], `${label}.type2`),
      });
    case "WinBattleQuest":
      return Object.freeze({
        ...common,
        ...(raw["monstersLeft"] === undefined
          ? {}
          : { monstersLeft: nonnegativeInteger(raw["monstersLeft"], `${label}.monstersLeft`) }),
        ...(raw["allAlive"] === undefined
          ? {}
          : { allAlive: boolean(raw["allAlive"], `${label}.allAlive`) }),
        ...(raw["difficultyModifier"] === undefined
          ? {}
          : {
              difficultyModifier: nonnegativeInteger(
                raw["difficultyModifier"],
                `${label}.difficultyModifier`,
              ),
            }),
      });
    case "DefeatMonstersQuest":
    case "GetSpiritTotemQuest":
    case "PromoteMonsterQuest":
    case "CatchMonstersQuest":
      return Object.freeze({
        ...common,
        ...(raw["type"] === undefined ? {} : { type: nonEmptyString(raw["type"], `${label}.type`) }),
      });
    case "MakeSoulstonesQuest":
      return Object.freeze(common);
  }
}

function dictionary(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new QuestDataError(`${label} must be a dictionary`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new QuestDataError(`${label} has unsupported key ${key}`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new QuestDataError(`${label} must be a non-empty string`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new QuestDataError(`${label} must be an integer`);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const result = integer(value, label);
  if (result <= 0) throw new QuestDataError(`${label} must be positive`);
  return result;
}

function nonnegativeInteger(value: unknown, label: string): number {
  const result = integer(value, label);
  if (result < 0) throw new QuestDataError(`${label} must be nonnegative`);
  return result;
}

function positiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new QuestDataError(`${label} must be a positive finite number`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new QuestDataError(`${label} must be boolean`);
  return value;
}

function optionalBoolean(value: unknown, fallback: boolean, label: string): boolean {
  return value === undefined ? fallback : boolean(value, label);
}

function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new QuestDataError(`${label} must be a non-empty array`);
  }
  const values = value.map((entry, index) => nonEmptyString(entry, `${label}[${index}]`));
  if (new Set(values).size !== values.length) throw new QuestDataError(`${label} contains duplicates`);
  return Object.freeze(values);
}

function freezeJsonDictionary(
  value: unknown,
  label: string,
): Readonly<Record<string, QuestJsonValue>> {
  const raw = dictionary(value, label);
  return freezeJson(raw, label) as Readonly<Record<string, QuestJsonValue>>;
}

function freezeJson(value: unknown, label: string): QuestJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => freezeJson(entry, `${label}[${index}]`)));
  }
  if (typeof value === "object") {
    const result: Record<string, QuestJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) result[key] = freezeJson(entry, `${label}.${key}`);
    return Object.freeze(result);
  }
  throw new QuestDataError(`${label} contains a non-JSON value`);
}
