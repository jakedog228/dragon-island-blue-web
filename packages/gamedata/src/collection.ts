/**
 * Strict, source-ordered `Collection.plist` loading.
 *
 * Goal arrays and explicit monster arrays retain authored order. Category rules traverse the
 * same Monsterpedia book projection as the native `monstersSortedByIndex` call.
 */

import {
  parseDungeonTreasureData,
  type DungeonResourceSource,
  type DungeonTreasureData,
} from "./dungeon.js";
import type { GameData } from "./gameData.js";

export interface CollectionGoalDefinition {
  readonly collectionType: string;
  readonly key: string;
  readonly monsterTypes: readonly string[];
  readonly treasureData: DungeonTreasureData;
}

export class CollectionDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionDataError";
  }
}

type CollectionMonsterCategory = "Normal" | "Summon" | "Combine" | "Egg" | "Collection";

const COLLECTION_TYPES = new Set(["Base"]);
const CATEGORIES = new Set<CollectionMonsterCategory>([
  "Normal",
  "Summon",
  "Combine",
  "Egg",
  "Collection",
]);
const GOAL_KEYS = new Set([
  "inclusionRuleArguments",
  "inclusionRuleClass",
  "key",
  "monsters",
  "treasureData",
]);

class ImmutableReadonlyMap<K, V> implements ReadonlyMap<K, V> {
  readonly #values: ReadonlyMap<K, V>;

  constructor(entries: Iterable<readonly [K, V]>) {
    this.#values = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  get(key: K): V | undefined {
    return this.#values.get(key);
  }

  has(key: K): boolean {
    return this.#values.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.#values.entries();
  }

  keys(): MapIterator<K> {
    return this.#values.keys();
  }

  values(): MapIterator<V> {
    return this.#values.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
    thisArg?: unknown,
  ): void {
    this.#values.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }
}

const EMPTY_COLLECTION_CATALOG: ReadonlyMap<
  string,
  readonly CollectionGoalDefinition[]
> = new ImmutableReadonlyMap([]);

/** Immutable empty value for packages that do not ship the optional Collection capability. */
export function emptyCollectionCatalog(): ReadonlyMap<
  string,
  readonly CollectionGoalDefinition[]
> {
  return EMPTY_COLLECTION_CATALOG;
}

export function loadCollectionCatalog(
  source: DungeonResourceSource,
  data: GameData,
): ReadonlyMap<string, readonly CollectionGoalDefinition[]> {
  if (!source.has("Collection.plist")) {
    throw new CollectionDataError("required resource is missing: Collection.plist");
  }
  const raw = dictionary(source.plist("Collection.plist"), "Collection.plist");
  const knownMonsters = new Set(data.allMonsters().map(({ shortType }) => shortType));
  const catalog = new Map<string, readonly CollectionGoalDefinition[]>();

  for (const [collectionType, value] of Object.entries(raw)) {
    if (!COLLECTION_TYPES.has(collectionType)) {
      throw new CollectionDataError(
        `Collection.plist contains unsupported collection type ${collectionType}`,
      );
    }
    const goals = array(value, `Collection.plist.${collectionType}`);
    const keys = new Set<string>();
    const parsed = goals.map((goal, index) => {
      const definition = parseGoal(
        goal,
        collectionType,
        `Collection.plist.${collectionType}[${index}]`,
        data,
        knownMonsters,
      );
      if (keys.has(definition.key)) {
        throw new CollectionDataError(
          `Collection.plist.${collectionType} contains duplicate goal key ${definition.key}`,
        );
      }
      keys.add(definition.key);
      return definition;
    });
    catalog.set(collectionType, Object.freeze(parsed));
  }

  return new ImmutableReadonlyMap(catalog);
}

function parseGoal(
  value: unknown,
  collectionType: string,
  path: string,
  data: GameData,
  knownMonsters: ReadonlySet<string>,
): CollectionGoalDefinition {
  const raw = dictionary(value, path);
  exactKeys(raw, GOAL_KEYS, path);
  const key = nonempty(raw.key, `${path}.key`);
  const hasExplicit = Object.hasOwn(raw, "monsters");
  const hasRuleClass = Object.hasOwn(raw, "inclusionRuleClass");
  const hasRuleArguments = Object.hasOwn(raw, "inclusionRuleArguments");
  const hasRule = hasRuleClass || hasRuleArguments;
  if (hasExplicit === hasRule || (hasRule && (!hasRuleClass || !hasRuleArguments))) {
    throw new CollectionDataError(`${path} must use exactly one monster selection form`);
  }

  const monsterTypes = hasExplicit
    ? parseExplicitMonsters(raw.monsters, `${path}.monsters`, knownMonsters)
    : expandCategoryRule(raw, path, data);
  const treasureData = parseDungeonTreasureData(
    raw.treasureData,
    `${path}.treasureData`,
    1,
    data,
  );
  validateRewardMonsterReferences(treasureData, `${path}.treasureData`, knownMonsters);

  return Object.freeze({
    collectionType,
    key,
    monsterTypes: Object.freeze(monsterTypes),
    treasureData,
  });
}

function parseExplicitMonsters(
  value: unknown,
  path: string,
  knownMonsters: ReadonlySet<string>,
): string[] {
  return array(value, path).map((entry, index) => {
    const shortType = nonempty(entry, `${path}[${index}]`);
    if (!knownMonsters.has(shortType)) {
      throw new CollectionDataError(`${path}[${index}] references unknown monster ${shortType}`);
    }
    return shortType;
  });
}

function expandCategoryRule(
  raw: Record<string, unknown>,
  path: string,
  data: GameData,
): string[] {
  const className = nonempty(raw.inclusionRuleClass, `${path}.inclusionRuleClass`);
  if (className !== "CategoryMonsterInclusionRule") {
    throw new CollectionDataError(`${path} has unsupported inclusionRuleClass ${className}`);
  }
  const args = dictionary(raw.inclusionRuleArguments, `${path}.inclusionRuleArguments`);
  exactKeys(args, new Set(["category"]), `${path}.inclusionRuleArguments`);
  const categoryName = nonempty(args.category, `${path}.inclusionRuleArguments.category`);
  if (!CATEGORIES.has(categoryName as CollectionMonsterCategory)) {
    throw new CollectionDataError(`${path} has unsupported category ${categoryName}`);
  }
  const category = categoryName as CollectionMonsterCategory;

  return data.monsterBookOrder().flatMap(({ monster }) => {
    if (monster.category !== category) return [];
    if (category === "Normal" && data.evolveChainOf(monster.shortType)[0] !== monster.shortType) {
      return [];
    }
    return [monster.shortType];
  });
}

function validateRewardMonsterReferences(
  treasureData: DungeonTreasureData,
  path: string,
  knownMonsters: ReadonlySet<string>,
): void {
  for (const [index, item] of treasureData.items.entries()) {
    if (item.kind !== "fixed" || item.data.kind !== "monsterJoin") continue;
    if (!knownMonsters.has(item.data.shortType)) {
      throw new CollectionDataError(
        `${path}.items[${index}] references unknown reward monster ${item.data.shortType}`,
      );
    }
  }
}

function dictionary(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CollectionDataError(`${path} must be a dictionary`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CollectionDataError(`${path} must be a dictionary`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new CollectionDataError(`${path} must be an array`);
  return value;
}

function nonempty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CollectionDataError(`${path} must be a non-empty string`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new CollectionDataError(`${path} contains unsupported key ${key}`);
  }
}
