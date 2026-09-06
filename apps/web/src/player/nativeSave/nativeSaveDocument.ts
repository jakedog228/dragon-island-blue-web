


import {
  decodeBinaryPlist,
  encodeBinaryPlist,
  type PlistLimits,
  type PlistValue,
} from "./binaryPlist.js";

export const NATIVE_SAVE_ROOT_KEYS: readonly string[] = Object.freeze([
  "goldFound", "goldSpent", "options", "playerData", "poiData",
  "props", "silver", "tutorialFlags", "variables", "waypoints",
]);

export class NativeSaveFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeSaveFormatError";
  }
}

export interface NativeRenderableRecord {
  /** `Renderable.fullName` — the dotted `Monsters.plist`/`Items.plist` key path. */
  readonly name: string;
  readonly creationFile: string;
  readonly creationArguments: ReadonlyMap<string, PlistValue>;
  /** `customSaveData.entitySaveData.properties`: the permanent property bag. */
  readonly properties: ReadonlyMap<string, PlistValue>;
  /** `customSaveData.monsterSaveData`: `injureTime`/`healTime`, empty for non-Monsters. */
  readonly monsterSaveData: ReadonlyMap<string, PlistValue>;

  readonly children: readonly NativeRenderableRecord[];
}

export interface NativePlayerData {
  readonly savedLicenseType: string;
  readonly savedMonsters: readonly NativeRenderableRecord[];
  readonly savedItems: readonly NativeRenderableRecord[];
  readonly savedGemsInLicense: readonly NativeRenderableRecord[];
}

export interface NativeSaveDocument {
  readonly silver: number;
  readonly goldFound: number;
  readonly goldSpent: number;
  readonly options: ReadonlyMap<string, PlistValue>;
  readonly variables: ReadonlyMap<string, PlistValue>;
  readonly tutorialFlags: ReadonlyMap<string, PlistValue>;
  readonly waypoints: ReadonlyMap<string, PlistValue>;
  readonly poiData: ReadonlyMap<string, PlistValue>;
  readonly props: ReadonlyMap<string, PlistValue>;
  readonly player: NativePlayerData;
}

export function decodeNativeSaveDocument(
  bytes: Uint8Array,
  limits?: PlistLimits,
): NativeSaveDocument {
  const root = requireDict(decodeBinaryPlist(bytes, limits), "save file root");
  for (const key of NATIVE_SAVE_ROOT_KEYS) {
    if (!root.has(key)) {
      throw new NativeSaveFormatError(
        `save file is missing the "${key}" section, so it is not a Dragon Island save`,
      );
    }
  }
  const player = requireDict(root.get("playerData")!, "playerData");
  return Object.freeze({
    silver: requireInteger(root.get("silver")!, "silver"),
    goldFound: requireInteger(root.get("goldFound")!, "goldFound"),
    goldSpent: requireInteger(root.get("goldSpent")!, "goldSpent"),
    options: requireDict(root.get("options")!, "options"),
    variables: requireDict(root.get("variables")!, "variables"),
    tutorialFlags: requireDict(root.get("tutorialFlags")!, "tutorialFlags"),
    waypoints: requireDict(root.get("waypoints")!, "waypoints"),
    poiData: requireDict(root.get("poiData")!, "poiData"),
    props: requireDict(root.get("props")!, "props"),
    player: Object.freeze({
      savedLicenseType: requireString(
        player.get("savedLicenseType") ?? { kind: "string", value: "Novice" },
        "savedLicenseType",
      ),
      savedMonsters: readRecords(player.get("savedMonsters"), "savedMonsters"),
      savedItems: readRecords(player.get("savedItems"), "savedItems"),
      savedGemsInLicense: readRecords(player.get("savedGemsInLicense"), "savedGemsInLicense"),
    }),
  });
}

export function encodeNativeSaveDocument(document: NativeSaveDocument): Uint8Array {
  return encodeBinaryPlist(nativeSaveDocumentToPlist(document));
}

export function nativeSaveDocumentToPlist(document: NativeSaveDocument): PlistValue {
  return pdict({
    tutorialFlags: { kind: "dict", value: document.tutorialFlags },
    props: { kind: "dict", value: document.props },
    options: { kind: "dict", value: document.options },
    waypoints: { kind: "dict", value: document.waypoints },
    poiData: { kind: "dict", value: document.poiData },
    variables: { kind: "dict", value: document.variables },
    goldSpent: pint(document.goldSpent),
    goldFound: pint(document.goldFound),
    silver: pint(document.silver),
    playerData: pdict({
      savedLicenseType: pstr(document.player.savedLicenseType),
      savedMonsters: parray(document.player.savedMonsters.map(recordToPlist)),
      savedItems: parray(document.player.savedItems.map(recordToPlist)),
      savedGemsInLicense: parray(document.player.savedGemsInLicense.map(recordToPlist)),
    }),
  });
}

function recordToPlist(record: NativeRenderableRecord): PlistValue {
  const customSaveData = new Map<string, PlistValue>([
    ["entitySaveData", pdict({ properties: { kind: "dict", value: record.properties } })],
  ]);


  if (record.creationFile === MONSTERS_FILE || record.monsterSaveData.size > 0) {
    customSaveData.set("monsterSaveData", { kind: "dict", value: record.monsterSaveData });
  }
  const entries: Record<string, PlistValue> = {
    name: pstr(record.name),
    creationFile: pstr(record.creationFile),
    customSaveData: { kind: "dict", value: customSaveData },
    additionalChildren: parray(record.children.map(recordToPlist)),
  };
  // `constructSavedDataWithRootParent:` writes the key only for a non-nil `creationArguments`.
  if (record.creationArguments.size > 0) {
    entries["creationArguments"] = { kind: "dict", value: record.creationArguments };
  }
  return pdict(entries);
}

export const MONSTERS_FILE = "Monsters.plist";
export const ITEMS_FILE = "Items.plist";

function readRecords(value: PlistValue | undefined, label: string): readonly NativeRenderableRecord[] {
  if (value === undefined) return Object.freeze([]);
  return Object.freeze(
    requireArray(value, label).map((entry, index) => readRecord(entry, `${label}[${index}]`)),
  );
}

function readRecord(value: PlistValue, label: string): NativeRenderableRecord {
  const record = requireDict(value, label);
  const customSaveData = record.has("customSaveData")
    ? requireDict(record.get("customSaveData")!, `${label}.customSaveData`)
    : EMPTY_MAP;
  const entitySaveData = customSaveData.has("entitySaveData")
    ? requireDict(customSaveData.get("entitySaveData")!, `${label}.customSaveData.entitySaveData`)
    : EMPTY_MAP;
  return Object.freeze({
    name: requireString(
      record.get("name") ?? missing(`${label}.name`),
      `${label}.name`,
    ),
    creationFile: requireString(
      record.get("creationFile") ?? missing(`${label}.creationFile`),
      `${label}.creationFile`,
    ),
    creationArguments: record.has("creationArguments")
      ? requireDict(record.get("creationArguments")!, `${label}.creationArguments`)
      : EMPTY_MAP,
    properties: entitySaveData.has("properties")
      ? requireDict(entitySaveData.get("properties")!, `${label}.entitySaveData.properties`)
      : EMPTY_MAP,
    monsterSaveData: customSaveData.has("monsterSaveData")
      ? requireDict(customSaveData.get("monsterSaveData")!, `${label}.customSaveData.monsterSaveData`)
      : EMPTY_MAP,
    children: readRecords(record.get("additionalChildren"), `${label}.additionalChildren`),
  });
}

const EMPTY_MAP: ReadonlyMap<string, PlistValue> = Object.freeze(new Map<string, PlistValue>());

function missing(label: string): never {
  throw new NativeSaveFormatError(`save file is missing ${label}`);
}

// ---------------------------------------------------------------------------------------------
// Strict readers. Each names the exact path it failed on so a malformed save reports where.
// ---------------------------------------------------------------------------------------------

export function requireDict(value: PlistValue, label: string): ReadonlyMap<string, PlistValue> {
  if (value.kind !== "dict") {
    throw new NativeSaveFormatError(`${label} must be a dictionary, not a ${value.kind}`);
  }
  return value.value;
}

export function requireArray(value: PlistValue, label: string): readonly PlistValue[] {
  if (value.kind !== "array") {
    throw new NativeSaveFormatError(`${label} must be an array, not a ${value.kind}`);
  }
  return value.value;
}

export function requireString(value: PlistValue, label: string): string {
  if (value.kind !== "string") {
    throw new NativeSaveFormatError(`${label} must be a string, not a ${value.kind}`);
  }
  return value.value;
}

/**
 * Accepts a real that happens to hold an integral value.
 *
 * `-[UserSavedData loadFromFile]` reads `goldFound`/`goldSpent` through `floatValue` and `silver`
 * through `intValue`, so the game itself does not care which numeric encoding a save carries.
 */
export function requireInteger(value: PlistValue, label: string): number {
  const numeric = requireNumber(value, label);
  if (!Number.isSafeInteger(numeric)) {
    throw new NativeSaveFormatError(`${label} must be a whole number; got ${numeric}`);
  }
  return numeric;
}

export function requireNumber(value: PlistValue, label: string): number {
  if (value.kind !== "int" && value.kind !== "real") {
    throw new NativeSaveFormatError(`${label} must be a number, not a ${value.kind}`);
  }
  if (!Number.isFinite(value.value)) {
    throw new NativeSaveFormatError(`${label} must be finite`);
  }
  return value.value;
}

/** Source `boolValue` semantics: any nonzero number or `true` reads as set. */
export function readsAsTrue(value: PlistValue): boolean {
  if (value.kind === "bool") return value.value;
  if (value.kind === "int" || value.kind === "real") return value.value !== 0;
  return false;
}


export function trueKeys(entries: ReadonlyMap<string, PlistValue>): readonly string[] {
  return [...entries]
    .filter(([, value]) => readsAsTrue(value))
    .map(([key]) => key)
    .sort(compareText);
}

export function stringArray(
  value: PlistValue | undefined,
  label: string,
): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  return Object.freeze(
    requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`)),
  );
}

export function integerMap(
  value: PlistValue | undefined,
  label: string,
): ReadonlyMap<string, number> {
  if (value === undefined) return new Map();
  const entries = new Map<string, number>();
  for (const [key, entry] of requireDict(value, label)) {
    entries.set(key, requireInteger(entry, `${label}.${key}`));
  }
  return entries;
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Builders used by the export direction.
// ---------------------------------------------------------------------------------------------

export function pdict(entries: Record<string, PlistValue>): PlistValue {
  return { kind: "dict", value: new Map(Object.entries(entries)) };
}

export function pmap(entries: Iterable<readonly [string, PlistValue]>): PlistValue {
  return { kind: "dict", value: new Map(entries) };
}

export function parray(items: readonly PlistValue[]): PlistValue {
  return { kind: "array", value: items };
}

export function pint(value: number): PlistValue {
  return { kind: "int", value };
}

export function preal(value: number): PlistValue {
  return { kind: "real", value };
}

export function pstr(value: string): PlistValue {
  return { kind: "string", value };
}

export function pbool(value: boolean): PlistValue {
  return { kind: "bool", value };
}

/** `{name: true}` registry, sorted so exports are stable. */
export function pflags(names: Iterable<string>): ReadonlyMap<string, PlistValue> {
  return new Map([...names].sort(compareText).map((name) => [name, pbool(true)] as const));
}
