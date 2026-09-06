


import type { RawNode } from "./rawLoad.js";
import { buildRegistry, resolveNode } from "./inherit.js";
import {
  AbilityComponentSchema,
  AbilitySchema,
  BuffSchema,
  ItemLeafSchema,
  JobLeafSchema,
  LicenseLeafSchema,
  MonsterSchema,
  SoulStoneItemSchema,
  StatNameSchema,
  TournamentSchema,
} from "./schemas.js";
import type {
  AbilityComponentDef,
  AbilityDef,
  BuffDef,
  CombineRecipeDef,
  Element,
  ItemDef,
  JobAbilityRef,
  LicenseDef,
  LicenseType,
  MonsterDef,
  SoulStoneDef,
  StatName,
  TournamentDef,
} from "./types.js";


const ELEMENT_ENUM_ORDER: readonly Element[] = ["Life", "Death", "Water", "Fire", "Earth", "Air", "Arcane"];


const STAT_INDEX_ORDER: readonly StatName[] = ["MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist"];
const LICENSE_ORDER: readonly LicenseType[] = [
  "Novice", "Apprentice", "Veteran", "Expert", "Elite", "Master", "Grandmaster",
];

const isDict = (v: unknown): v is RawNode =>
  typeof v === "object" && v !== null && !Array.isArray(v);










function findLeafPaths(tree: RawNode, leafKey: string): string[] {
  const paths: string[] = [];
  const walk = (node: RawNode, path: string): void => {
    if (path && leafKey in node) paths.push(path);
    for (const [k, v] of Object.entries(node)) {
      if (isDict(v)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(tree, "");
  return paths;
}

function findJobLeafPaths(tree: RawNode): string[] {
  const paths: string[] = [];
  const walk = (node: RawNode, path: string): void => {
    if (path && ("jobAbilities" in node || "parent" in node)) paths.push(path);
    for (const [key, value] of Object.entries(node)) {
      if (isDict(value)) walk(value, path ? `${path}.${key}` : key);
    }
  };
  walk(tree, "");
  return paths;
}

function lastSegment(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? path : path.slice(idx + 1);
}

export interface MonsterBookEntry {
  readonly monster: MonsterDef;
  /** Authored key after the source's increment-until-free collision loop. */
  readonly resolvedSortKey: number;
  /** Contiguous global 1-based `-[Monster index]` value. */
  readonly ordinal: number;
}








export function buildMonsterBookIndex(
  monsters: readonly MonsterDef[],
): readonly MonsterBookEntry[] {
  const occupied = new Set<number>();
  const resolved = monsters.map((monster) => {
    let resolvedSortKey = monster.index;
    while (occupied.has(resolvedSortKey)) resolvedSortKey += 1;
    occupied.add(resolvedSortKey);
    return { monster, resolvedSortKey };
  });
  return resolved
    .sort((left, right) => left.resolvedSortKey - right.resolvedSortKey)
    .map((entry, index) => ({ ...entry, ordinal: index + 1 }));
}

export class GameData {
  private readonly monstersByShortType = new Map<string, MonsterDef>();
  private readonly monstersByIndex = new Map<number, MonsterDef>();
  private readonly monsterList: MonsterDef[] = [];
  private readonly jobAbilitiesByShortType = new Map<string, JobAbilityRef[]>();
  private readonly jobXpPenaltyByShortType = new Map<string, number>();
  /** Populated only when Items.json raw data was provided (see `soulStoneByElement`). */
  private readonly soulStonesByElement = new Map<Element, SoulStoneDef>();
  private readonly itemsByPath = new Map<string, ItemDef>();
  private readonly itemList: ItemDef[] = [];
  private readonly itemsLoaded: boolean;
  private readonly licensesByType = new Map<LicenseType, LicenseDef>();
  private readonly licenseList: LicenseDef[] = [];
  private readonly licensesLoaded: boolean;
  private readonly tournamentList: TournamentDef[] = [];
  private readonly tournamentsLoaded: boolean;
  private readonly combinesByResult = new Map<string, CombineRecipeDef>();
  private readonly combineList: CombineRecipeDef[] = [];
  private readonly combinesLoaded: boolean;



  private readonly recipeWorldNames = new Map<string, string>();
  private readonly totemWorldNames = new Map<string, string>();

  private readonly abilityRegistry: Map<string, RawNode>;
  private readonly abilityComponentRegistry: Map<string, RawNode>;
  private readonly buffRegistry: Map<string, RawNode>;
  private readonly abilityCache = new Map<string, AbilityDef>();
  /** Lazily derived, like `evolveChainsByShortType`: the whole monster list must be loaded first. */
  private monsterBookOrderCache?: readonly MonsterBookEntry[];
  private monsterBookIndexByShortType?: Map<string, number>;
  private readonly abilityComponentCache = new Map<string, AbilityComponentDef>();
  private readonly buffCache = new Map<string, BuffDef>();

  private constructor(
    monstersRaw: RawNode,
    jobsRaw: RawNode,
    abilitiesRaw: RawNode,
    abilityComponentsRaw: RawNode,
    buffsRaw: RawNode,
    itemsRaw: RawNode | undefined,
    combinesRaw: RawNode | undefined,
    licensesRaw: RawNode | undefined,
    tournamentsRaw: unknown,
    thingsInWorldRaw: RawNode | undefined,
  ) {
    this.loadMonsters(monstersRaw);
    this.loadJobs(jobsRaw);
    this.abilityRegistry = buildRegistry(abilitiesRaw);
    this.abilityComponentRegistry = buildRegistry(abilityComponentsRaw);
    this.buffRegistry = buildRegistry(buffsRaw);
    this.itemsLoaded = itemsRaw !== undefined;
    if (itemsRaw !== undefined) {
      this.loadItems(itemsRaw);
      this.loadSoulStones(itemsRaw);
    }
    this.combinesLoaded = combinesRaw !== undefined;
    if (combinesRaw !== undefined) this.loadCombines(combinesRaw);
    this.licensesLoaded = licensesRaw !== undefined;
    if (licensesRaw !== undefined) this.loadLicenses(licensesRaw);
    this.tournamentsLoaded = tournamentsRaw !== undefined;
    if (tournamentsRaw !== undefined) this.loadTournaments(tournamentsRaw);
    if (thingsInWorldRaw !== undefined) this.loadThingsInWorld(thingsInWorldRaw);
  }

  /** Construct from already-fetched/parsed raw JSON objects (browser fetch or Node fs — see
   *  loadNode.ts's `loadGameData` for the filesystem convenience wrapper). `items` (Items.json)
   *  is optional for legacy/synthetic constructions; omitting it makes `soulStoneByElement`
   *  throw rather than silently resolving no stones. */
  static fromRaw(raw: {
    monsters: RawNode;
    jobs: RawNode;
    abilities: RawNode;
    abilityComponents: RawNode;
    buffs: RawNode;
    items?: RawNode;
    combines?: RawNode;
    licenses?: RawNode;
    tournaments?: unknown;
    thingsInWorld?: RawNode;
  }): GameData {
    return new GameData(
      raw.monsters,
      raw.jobs,
      raw.abilities,
      raw.abilityComponents,
      raw.buffs,
      raw.items,
      raw.combines,
      raw.licenses,
      raw.tournaments,
      raw.thingsInWorld,
    );
  }

  /** `ThingsInWorld.plist` is two flat `<name> -> <world short name>` dictionaries. */
  private loadThingsInWorld(raw: RawNode): void {
    for (const [section, target] of [
      ["recipes", this.recipeWorldNames],
      ["totems", this.totemWorldNames],
    ] as const) {
      const entries = (raw as Record<string, unknown>)[section];
      if (entries === undefined) continue;
      if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
        throw new Error(`ThingsInWorld ${section} must be a dictionary`);
      }
      for (const [name, worldName] of Object.entries(entries)) {
        if (typeof worldName !== "string" || worldName.length === 0) {
          throw new Error(`ThingsInWorld ${section}.${name} must be a nonempty world name`);
        }
        target.set(name, worldName);
      }
    }
  }

  private loadTournaments(raw: unknown): void {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("Tournaments data must be a nonempty array");
    }
    const names = new Set<string>();
    for (const [index, value] of raw.entries()) {
      const parsed = TournamentSchema.parse(value);
      if (names.has(parsed.name)) throw new Error(`duplicate tournament name: ${parsed.name}`);
      names.add(parsed.name);
      this.tournamentList.push(Object.freeze({
        index,
        name: parsed.name,
        subtitle: parsed.subtitle,
        challengeLevel: parsed.challengeLevel,
        prizeImage: parsed.prizeImage,
        monsterPopulators: Object.freeze(
          parsed.monsterPopulators.map((entry) => Object.freeze({ ...entry })),
        ),
        treasureData: Object.freeze({ ...parsed.treasureData }),
      }));
    }
    Object.freeze(this.tournamentList);
  }

  private loadItems(itemsRaw: RawNode): void {
    const registry = buildRegistry(itemsRaw);
    const walk = (node: RawNode, path: string): void => {
      if (path !== "" && typeof node["class"] === "string" && typeof node["slot"] === "string") {
        const parsed = ItemLeafSchema.parse(resolveNode(path, registry));
        const unknownStats = Object.keys(parsed.stats ?? {}).filter(
          (stat) => !STAT_INDEX_ORDER.includes(stat as StatName),
        );
        if (unknownStats.length > 0) {
          throw new Error(`item ${path} has unknown stats: ${unknownStats.join(", ")}`);
        }
        const def: ItemDef = Object.freeze({
          path,
          instanceName: lastSegment(path),
          className: parsed.class,
          slot: parsed.slot,
          abilities: Object.freeze([...(parsed.abilities ?? [])]),
          enabledStats: Object.freeze(
            STAT_INDEX_ORDER.filter((stat) => parsed.stats?.[stat] === true),
          ),
          holderBuffs: Object.freeze(
            (parsed.holderBuffs ?? []).map((buff) => Object.freeze({ ...buff })),
          ),
          ...(parsed.level === undefined ? {} : { level: parsed.level }),
          repeats: parsed.repeats ?? false,
          onlyMonsters: parsed.onlyMonsters ?? false,
          ...(parsed.rendererData !== undefined ? { rendererData: parsed.rendererData } : {}),
        });
        if (this.itemsByPath.has(path)) throw new Error(`duplicate item path: ${path}`);
        this.itemsByPath.set(path, def);
        this.itemList.push(def);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (isDict(value)) walk(value, path === "" ? key : `${path}.${key}`);
      }
    };
    walk(itemsRaw, "");
    this.itemList.sort((left, right) => left.path.localeCompare(right.path));
    Object.freeze(this.itemList);
  }

  private loadLicenses(licensesRaw: RawNode): void {
    const actual = Object.keys(licensesRaw).sort();
    const expected = [...LICENSE_ORDER].sort();
    if (actual.join("\0") !== expected.join("\0")) {
      throw new Error(`Licenses data must contain exactly ${LICENSE_ORDER.join(", ")}`);
    }
    for (const [ordinal, type] of LICENSE_ORDER.entries()) {
      const parsed = LicenseLeafSchema.parse(licensesRaw[type]);
      const def: LicenseDef = Object.freeze({
        type,
        ordinal,
        heroLevelRequired: parsed.heroLevelRequired,
        completedQuestsRequired: parsed.completedQuestsRequired,
        challengeLevel: parsed.challengeLevel,
        battingOrderSize: parsed.battingOrderSize,
        gemSlots: parsed.gemSlots,
        monsterPopulator: Object.freeze({ ...parsed.monsterPopulator }),
      });
      this.licensesByType.set(type, def);
      this.licenseList.push(def);
    }
    Object.freeze(this.licenseList);
  }

  private loadMonsters(monstersRaw: RawNode): void {
    const registry = buildRegistry(monstersRaw);
    for (const path of findLeafPaths(monstersRaw, "index")) {
      const resolved = resolveNode(path, registry);
      const parsed = MonsterSchema.parse(resolved);
      const shortType = lastSegment(path);
      const def: MonsterDef = {
        path,
        shortType,
        category: parsed.category,
        element: parsed.element,
        index: parsed.index,
        quality: parsed.quality,
        stars: parsed.stars,
        rootStats: parsed.rootStats,
        unarmedAttackType: parsed.unarmedAttackType,
        ...(parsed.evolveData !== undefined ? { evolveData: parsed.evolveData } : {}),
        eggUnlockQuality: parsed.eggUnlockQuality ?? parsed.quality,
        ...(parsed.summonXpBonus !== undefined ? { summonXpBonus: parsed.summonXpBonus } : {}),
        ...(parsed.rendererData !== undefined ? { rendererData: parsed.rendererData } : {}),
      };
      if (this.monstersByShortType.has(shortType)) {
        throw new Error(`duplicate monster shortType: ${shortType} (${path})`);
      }
      if (this.monstersByIndex.has(def.index)) {
        throw new Error(`duplicate monster index: ${def.index} (${path})`);
      }
      this.monstersByShortType.set(shortType, def);
      this.monstersByIndex.set(def.index, def);
      this.monsterList.push(def);
    }
  }

  private loadJobs(jobsRaw: RawNode): void {
    const registry = buildRegistry(jobsRaw);
    for (const path of findJobLeafPaths(jobsRaw)) {
      const resolved = resolveNode(path, registry);
      const parsed = JobLeafSchema.parse(resolved);
      const shortType = lastSegment(path);
      const refs: JobAbilityRef[] = Object.keys(parsed.jobAbilities)
        .sort()
        .map((slot) => {
          const ref = parsed.jobAbilities[slot]!;
          return { slot, type: ref.type, arguments: ref.arguments ?? {} };
        });
      if (this.jobAbilitiesByShortType.has(shortType)) {
        throw new Error(`duplicate Jobs entry: ${shortType} (${path})`);
      }
      this.jobAbilitiesByShortType.set(shortType, refs);
      this.jobXpPenaltyByShortType.set(shortType, parsed.xpPenalty);
    }
  }




  private loadSoulStones(itemsRaw: RawNode): void {
    const registry = buildRegistry(itemsRaw);
    for (const element of ELEMENT_ENUM_ORDER) {
      const path = `SoulStones.${element}SoulStone`;
      const parsed = SoulStoneItemSchema.parse(resolveNode(path, registry));


      const namedStats = Object.keys(parsed.stats).map((key) => StatNameSchema.parse(key));
      const enabledStats = STAT_INDEX_ORDER.filter(
        (stat) => namedStats.includes(stat) && parsed.stats[stat] === true,
      );
      this.soulStonesByElement.set(element, { path, element, enabledStats });
    }
  }

  /** `Combines.plist` is a flat result -> two ordered ingredient dictionary, not an inherited
   * registry. Validate every cross-reference eagerly so malformed content cannot reach a picker
   * or partially mutate a party. */
  private loadCombines(combinesRaw: RawNode): void {
    for (const [resultShortType, rawIngredients] of Object.entries(combinesRaw)) {
      if (
        !Array.isArray(rawIngredients) ||
        rawIngredients.length !== 2 ||
        rawIngredients.some((ingredient) => typeof ingredient !== "string" || ingredient.length === 0)
      ) {
        throw new Error(`bad combine recipe ${resultShortType}: expected exactly two non-empty simple types`);
      }
      const result = this.monsterByShortType(resultShortType);
      if (result.category !== "Combine") {
        throw new Error(`combine recipe result ${resultShortType} has category ${result.category}, expected Combine`);
      }
      const ingredients = rawIngredients as [string, string];
      this.monsterByShortType(ingredients[0]);
      this.monsterByShortType(ingredients[1]);
      const recipe: CombineRecipeDef = Object.freeze({
        resultShortType,
        ingredients: Object.freeze([ingredients[0], ingredients[1]] as [string, string]),
      });
      this.combinesByResult.set(resultShortType, recipe);
      this.combineList.push(recipe);
    }
    this.combineList.sort(
      (left, right) =>
        this.monsterByShortType(left.resultShortType).index -
        this.monsterByShortType(right.resultShortType).index,
    );
    Object.freeze(this.combineList);
  }

  /** Lazily built `-[MonsterpediaBookData monsterEvolveChainsIncludeOnlyRoot:0]` equivalent —
   *  the ALL-MEMBERS dict (see evolveChainOf). */
  private evolveChainsByShortType: Map<string, readonly string[]> | null = null;











  evolveChainOf(shortType: string): readonly string[] {
    if (this.evolveChainsByShortType === null) {




      const evolvedFrom = new Map<string, string>();
      for (const m of this.monsterList) {
        if (m.evolveData === undefined) continue;
        if (evolvedFrom.has(m.evolveData.newType)) {
          throw new Error(`evolveChainOf: two monsters evolve into ${m.evolveData.newType}`);
        }
        evolvedFrom.set(m.evolveData.newType, m.shortType);
      }
      const chains = new Map<string, readonly string[]>();
      const HOP_CAP = 11; // the native infinite-loop guard's bound
      for (const m of this.monsterList) {
        let root = m.shortType;
        for (let hops = 0; evolvedFrom.has(root); hops++) {
          if (hops >= HOP_CAP) throw new Error(`evolveChainOf: evolve-chain cycle at ${m.shortType}`);
          root = evolvedFrom.get(root)!;
        }
        const chain: string[] = [root];
        for (let cur = this.monstersByShortType.get(root)?.evolveData; cur !== undefined; ) {
          if (chain.length > HOP_CAP) throw new Error(`evolveChainOf: evolve-chain cycle at ${m.shortType}`);
          chain.push(cur.newType);
          cur = this.monstersByShortType.get(cur.newType)?.evolveData;
        }
        chains.set(m.shortType, chain);
      }
      this.evolveChainsByShortType = chains;
    }
    const chain = this.evolveChainsByShortType.get(shortType);
    if (!chain) throw new Error(`unknown monster shortType: ${shortType}`);
    return chain;
  }

  /** {@link evolveChainOf} for callers that legitimately hold identities this archive may not
   *  define — a save's Monsterpedia registration outlives the archive it was written against, and
   *  the source's chain dictionary simply has no entry for such a species. */
  evolveChainOrUndefined(shortType: string): readonly string[] | undefined {
    if (!this.monstersByShortType.has(shortType)) return undefined;
    return this.evolveChainOf(shortType);
  }

  monsterByShortType(shortType: string): MonsterDef {
    // Ambiguity is prevented at load time (loadMonsters throws on duplicate shortType), so
    // "unknown" is the only failure mode reachable here.
    const def = this.monstersByShortType.get(shortType);
    if (!def) throw new Error(`unknown monster shortType: ${shortType}`);
    return def;
  }

  monsterByIndex(index: number): MonsterDef {
    const def = this.monstersByIndex.get(index);
    if (!def) throw new Error(`unknown monster index: ${index}`);
    return def;
  }

  allMonsters(): readonly MonsterDef[] {
    return this.monsterList;
  }

  /** Every monster in `MonsterpediaBookData`'s resolved book order (see `buildMonsterBookIndex`). */
  monsterBookOrder(): readonly MonsterBookEntry[] {
    if (this.monsterBookOrderCache === undefined) {
      this.monsterBookOrderCache = buildMonsterBookIndex(this.monsterList);
      this.monsterBookIndexByShortType = new Map(
        this.monsterBookOrderCache.map(({ monster, ordinal }) => [monster.shortType, ordinal]),
      );
    }
    return this.monsterBookOrderCache;
  }


  monsterBookIndex(shortType: string): number {
    this.monsterBookOrder();
    const ordinal = this.monsterBookIndexByShortType!.get(shortType);
    if (ordinal === undefined) throw new Error(`unknown monster shortType: ${shortType}`);
    return ordinal;
  }

  /** All authored recipes in the same result-index order used by Monsterpedia category 2. */
  allCombineRecipes(): readonly CombineRecipeDef[] {
    if (!this.combinesLoaded) throw new Error("GameData: Combines data was not loaded");
    return this.combineList;
  }




  recipeWorldName(combineName: string): string | undefined {
    return this.recipeWorldNames.get(combineName);
  }


  totemWorldName(shortType: string): string | undefined {
    return this.totemWorldNames.get(shortType);
  }

  combineRecipe(resultShortType: string): CombineRecipeDef {
    if (!this.combinesLoaded) throw new Error("GameData: Combines data was not loaded");
    const recipe = this.combinesByResult.get(resultShortType);
    if (recipe === undefined) throw new Error(`no combine recipe for result: ${resultShortType}`);
    return recipe;
  }

  combineRecipeOrUndefined(resultShortType: string): CombineRecipeDef | undefined {
    if (!this.combinesLoaded) return undefined;
    return this.combinesByResult.get(resultShortType);
  }

  jobAbilities(shortType: string): readonly JobAbilityRef[] {
    const refs = this.jobAbilitiesByShortType.get(shortType);
    if (!refs) throw new Error(`no Jobs entry for shortType: ${shortType}`);
    return refs;
  }

  jobAbilitiesOrEmpty(shortType: string): readonly JobAbilityRef[] {
    return this.jobAbilitiesByShortType.get(shortType) ?? [];
  }

  /** Resolved `Job.xpPenalty`, consumed by the source XP-level curve after a battle. */
  jobXpPenalty(shortType: string): number {
    const value = this.jobXpPenaltyByShortType.get(shortType);
    if (value === undefined) throw new Error(`no Jobs entry for shortType: ${shortType}`);
    return value;
  }



  soulStoneByElement(element: Element): SoulStoneDef {
    if (!this.itemsLoaded) {
      throw new Error("GameData: Items.json was not provided — soul stones unavailable (pass `items` to fromRaw)");
    }
    const def = this.soulStonesByElement.get(element);
    if (!def) throw new Error(`unknown soul stone element: ${element}`);
    return def;
  }

  allItems(): readonly ItemDef[] {
    if (!this.itemsLoaded) throw new Error("GameData: Items data was not loaded");
    return this.itemList;
  }

  item(path: string): ItemDef {
    if (!this.itemsLoaded) throw new Error("GameData: Items data was not loaded");
    const def = this.itemsByPath.get(path);
    if (def === undefined) throw new Error(`unknown item path: ${path}`);
    return def;
  }

  /** Optional lookup for durable inventory written by another trusted Offline content profile. */
  itemOrUndefined(path: string): ItemDef | undefined {
    if (!this.itemsLoaded) return undefined;
    return this.itemsByPath.get(path);
  }

  allLicenses(): readonly LicenseDef[] {
    if (!this.licensesLoaded) throw new Error("GameData: Licenses data was not loaded");
    return this.licenseList;
  }

  license(type: LicenseType): LicenseDef {
    if (!this.licensesLoaded) throw new Error("GameData: Licenses data was not loaded");
    const def = this.licensesByType.get(type);
    if (def === undefined) throw new Error(`unknown license type: ${type}`);
    return def;
  }

  allTournaments(): readonly TournamentDef[] {
    if (!this.tournamentsLoaded) throw new Error("GameData: Tournaments data was not loaded");
    return this.tournamentList;
  }

  tournament(index: number): TournamentDef | undefined {
    if (!this.tournamentsLoaded) throw new Error("GameData: Tournaments data was not loaded");
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new Error(`invalid tournament index: ${index}`);
    }
    return this.tournamentList[index];
  }

  ability(path: string): AbilityDef {
    const cached = this.abilityCache.get(path);
    if (cached) return cached;
    const resolved = resolveNode(path, this.abilityRegistry);
    const parsed = AbilitySchema.parse(resolved);
    const def: AbilityDef = {
      path,
      className: parsed.class,
      components: parsed.components ?? [],
      raw: { ...parsed },
      ...(parsed.activationLength !== undefined ? { activationLength: parsed.activationLength } : {}),
      ...(parsed.targetPicker !== undefined ? { targetPicker: parsed.targetPicker } : {}),
      ...(parsed.aiChance !== undefined ? { aiChance: parsed.aiChance } : {}),
    };
    this.abilityCache.set(path, def);
    return def;
  }

  abilityComponent(path: string): AbilityComponentDef {
    const cached = this.abilityComponentCache.get(path);
    if (cached) return cached;
    const resolved = resolveNode(path, this.abilityComponentRegistry);
    const parsed = AbilityComponentSchema.parse(resolved);
    const def: AbilityComponentDef = {
      path,
      className: parsed.class,
      raw: { ...parsed },
    };
    this.abilityComponentCache.set(path, def);
    return def;
  }

  buff(path: string): BuffDef {
    const cached = this.buffCache.get(path);
    if (cached) return cached;
    const parsed = BuffSchema.parse(resolveNode(path, this.buffRegistry));
    const def: BuffDef = { path, className: parsed.class, raw: { ...parsed } };
    this.buffCache.set(path, def);
    return def;
  }
}
