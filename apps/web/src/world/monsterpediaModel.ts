import type { CombineRecipeDef, GameData, MonsterDef } from "@dib/gamedata/browser";
import { spiritCombatLevel } from "@dib/engine";


export type MonsterpediaCategory = 0 | 1 | 2 | 3 | 4 | 5;

export const MONSTERPEDIA_CATEGORIES: readonly MonsterpediaCategory[] = [0, 1, 2, 3, 4, 5];

export const MONSTERPEDIA_CATEGORY_LOCALIZATION_KEYS: Readonly<Record<MonsterpediaCategory, string>> = {
  0: "MonsterCatNameNormal",
  1: "MonsterCatNameSummon",
  2: "MonsterCatNameCombine",
  3: "MonsterCatNameEgg",
  4: "MonsterCatNameCollection",
  5: "MonsterCatNameLast",
};

export const MONSTERPEDIA_CATEGORY_TAB_FRAMES: Readonly<Record<MonsterpediaCategory, string>> = {
  0: "NormalTabIcon.png",
  1: "SummonTabIcon.png",
  2: "CombineTabIcon.png",
  3: "EggTabIcon.png",
  4: "CollectionTabIcon.png",
  5: "AllTabIcon.png",
};

/** Narrow `NSString stringWithFormat:` subset used by Monsterpedia's shipped format strings. */
export function formatMonsterpediaText(
  template: string,
  ...values: readonly (string | number)[]
): string {
  let valueIndex = 0;
  const formatted = template.replace(/%%|%3d|%d|%@/g, (token) => {
    if (token === "%%") return "%";
    const value = values[valueIndex++];
    if (value === undefined) {
      throw new Error(
        `Monsterpedia format ${JSON.stringify(template)} is missing argument ${valueIndex}`,
      );
    }
    if (token === "%@") return String(value);
    const integer = Math.trunc(Number(value));
    if (!Number.isFinite(integer)) {
      throw new Error(
        `Monsterpedia format ${JSON.stringify(template)} needs an integer for ${token}`,
      );
    }
    const rendered = String(integer);
    return token === "%3d" ? rendered.padStart(3, " ") : rendered;
  });
  if (valueIndex !== values.length) {
    throw new Error(
      `Monsterpedia format ${JSON.stringify(template)} consumed ` +
        `${valueIndex}/${values.length} arguments`,
    );
  }
  return formatted;
}

/** Narrow projection consumed by the renderer; PlayerProfile satisfies this structurally. */
export interface MonsterpediaProfileView {
  /** Source `highestLevelMonsterOfSimpleType:` persistent registration only. */
  highestRegisteredLevel(shortType: string): number;
  hasCombineRecipe(shortType: string): boolean;
  hasTutorialFlag(flag: string): boolean;
  claimTutorialFlag(flag: string): boolean;
  spiritSnapshot(): {
    readonly spirits: readonly {
      readonly shortType: string;
      readonly savedXp: number;
    }[];
  };
}

export interface MonsterpediaMonsterEntry {
  readonly kind: "monster";
  /** Source book group, in root-to-leaf order. */
  readonly chain: readonly MonsterDef[];
  /** MonsterCardNode rendered for this group. */
  readonly monster: MonsterDef;
  /** Global 1-based `Monster.index` projection, never the authored raw sort key. */
  readonly ordinal: number;
  /** `initWithMonster:hidden:` receives `hidden = !known`. */
  readonly known: boolean;
  /** Highest level displayed by the rendered monster's card. */
  readonly highestLevel: number;
}

export interface MonsterpediaRecipeEntry {
  readonly kind: "recipe";
  /** Source book group, in root-to-leaf order. */
  readonly chain: readonly MonsterDef[];
  readonly recipe: CombineRecipeDef;
  /** Category 2 always renders the recipe result/root, even when a later chain member was found. */
  readonly monster: MonsterDef;
  /** Global 1-based `Monster.index` projection, never the authored raw sort key. */
  readonly ordinal: number;
  /** Result visibility is capture-history driven and independent from recipe ownership. */
  readonly known: boolean;
  /** Controls ingredient identity and whether the Make path is available. */
  readonly recipeKnown: boolean;
  readonly highestLevel: number;
}

export type MonsterpediaEntry = MonsterpediaMonsterEntry | MonsterpediaRecipeEntry;

export interface MonsterpediaIngredientVisualState {
  readonly identity: "unknown" | "known";
  readonly tint: "black" | "color";
  readonly pulse: boolean;
}

/** The source's independent recipe/history/bench decision matrix. */
export function monsterpediaIngredientVisualState(
  recipeKnown: boolean,
  registered: boolean,
  owned: boolean,
): MonsterpediaIngredientVisualState {
  if (!recipeKnown) return { identity: "unknown", tint: "color", pulse: false };
  return {
    identity: "known",
    tint: registered ? "color" : "black",
    pulse: owned,
  };
}


export function monsterpediaEntriesPerPage(category: MonsterpediaCategory): number {
  return category === 2 ? 4 : 6;
}

export function monsterpediaPageCount(entryCount: number, category: MonsterpediaCategory): number {
  if (!Number.isInteger(entryCount) || entryCount < 0) {
    throw new Error(`monsterpediaPageCount: invalid entry count ${entryCount}`);
  }
  return Math.max(1, Math.ceil(entryCount / monsterpediaEntriesPerPage(category)));
}

export function clampMonsterpediaPage(
  page: number,
  entryCount: number,
  category: MonsterpediaCategory,
): number {
  if (!Number.isFinite(page)) return 0;
  return Math.min(monsterpediaPageCount(entryCount, category) - 1, Math.max(0, Math.trunc(page)));
}

/**
 * `MonsterpediaAllNode buildLabels/changePage:` page-window contract.
 *
 * Forward wraps after the final partial page. The source's backward wrap deliberately lands on
 * the previous full page (`P * (floor(count/P) - 1)`), so left-from-zero skips the final partial
 * page even though that page remains reachable by repeatedly moving right.
 */
export function completeListPageStart(
  currentStart: number,
  entryCount: number,
  pageCapacity: number,
  delta: number,
): number {
  if (!Number.isInteger(entryCount) || entryCount < 0) {
    throw new Error(`completeListPageStart: invalid entry count ${entryCount}`);
  }
  if (!Number.isInteger(pageCapacity) || pageCapacity < 1) {
    throw new Error(`completeListPageStart: invalid page capacity ${pageCapacity}`);
  }
  if (entryCount === 0) return 0;
  const current = Math.min(entryCount - 1, Math.max(0, Math.trunc(currentStart)));
  if (!Number.isFinite(delta) || delta === 0) return current;
  if (delta > 0) {
    const next = current + pageCapacity;
    return next >= entryCount ? 0 : next;
  }
  const previous = current - pageCapacity;
  if (previous >= 0) return previous;
  return Math.max(0, pageCapacity * (Math.floor(entryCount / pageCapacity) - 1));
}

export function monsterpediaCompletionPercent(found: number, total: number): number {
  if (!Number.isInteger(found) || !Number.isInteger(total) || found < 0 || total < 0 || found > total) {
    throw new Error(`monsterpediaCompletionPercent: invalid ${found}/${total}`);
  }
  return total === 0 ? 0 : Math.round((found * 100) / total);
}

export function monsterpediaDisplayLevel(monster: MonsterDef, profile: MonsterpediaProfileView): number {
  if (monster.category !== "Summon") return profile.highestRegisteredLevel(monster.shortType);
  const spirit = profile.spiritSnapshot().spirits.find(
    (candidate) => candidate.shortType === monster.shortType,
  );
  return spirit === undefined ? 0 : spiritCombatLevel(monster, spirit.savedXp);
}

/**
 * Source ownership (`hasMonster:`) is distinct from the level used to render a card. In
 * particular, a tier-0 spirit has a positive combat display level but remains undiscovered.
 */
export function monsterpediaMonsterKnown(
  monster: MonsterDef,
  profile: MonsterpediaProfileView,
): boolean {
  if (monster.category !== "Summon") {
    return profile.highestRegisteredLevel(monster.shortType) > 0;
  }
  return (profile.spiritSnapshot().spirits.find(
    (candidate) => candidate.shortType === monster.shortType,
  )?.savedXp ?? 0) > 0;
}

/**
 * `lookAtMonster:` rechecks the tapped species' own saved state. This deliberately differs from
 * the rendered entry's `hidden:` flag for a descendant-discovered Combine root and for expansion
 * clones whose visibility is forced by their relationship to the selected card.
 */
export function monsterpediaInspectionLevel(
  monster: MonsterDef,
  profile: MonsterpediaProfileView,
): number | undefined {
  return monsterpediaMonsterKnown(monster, profile)
    ? monsterpediaDisplayLevel(monster, profile)
    : undefined;
}

function monsterEntry(
  monster: MonsterDef,
  ordinal: number,
  chain: readonly MonsterDef[],
  known: boolean,
  profile: MonsterpediaProfileView,
): MonsterpediaMonsterEntry {
  const highestLevel = monsterpediaDisplayLevel(monster, profile);
  return { kind: "monster", chain, monster, ordinal, known, highestLevel };
}


export function buildMonsterpediaCategory(
  data: GameData,
  profile: MonsterpediaProfileView,
  category: MonsterpediaCategory,
): readonly MonsterpediaEntry[] {
  const indexed = data.monsterBookOrder();
  if (category === 5) {
    return indexed.map(({ monster, ordinal }) => {
      return monsterEntry(
        monster,
        ordinal,
        [monster],
        monsterpediaMonsterKnown(monster, profile),
        profile,
      );
    });
  }

  const sourceCategory = category === 1
    ? "Summon"
    : category === 2
      ? "Combine"
      : category === 3
        ? "Egg"
        : category === 4
          ? "Collection"
          : undefined;
  const recipesByResult = new Map(
    category === 2
      ? data.allCombineRecipes().map((recipe) => [recipe.resultShortType, recipe] as const)
      : [],
  );
  const result: MonsterpediaEntry[] = [];

  for (const { monster: candidate } of indexed) {
    const chainNames = data.evolveChainOf(candidate.shortType);
    if (chainNames[0] !== candidate.shortType) continue;
    let chain = chainNames.map((shortType) => data.monsterByShortType(shortType));

    if (category === 0) {
      if (chain.length > 1) {

        if (chain[0]!.category === "Summon") continue;
        while (
          chain.length > 0 &&
          profile.highestRegisteredLevel(chain.at(-1)!.shortType) === 0
        ) {
          chain = chain.slice(0, -1);
        }
        if (chain.length === 0) continue;
      } else if (profile.highestRegisteredLevel(candidate.shortType) === 0) {
        continue;
      }
    } else if (chain[0]!.category !== sourceCategory) {
      continue;
    }

    let displayed = chain[0]!;
    let discoveredLevel = 0;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const level = profile.highestRegisteredLevel(chain[index]!.shortType);
      if (level < 1) continue;
      displayed = chain[index]!;
      discoveredLevel = level;
      break;
    }

    if (category === 2) displayed = chain[0]!;
    if (category === 1) {
      const spirit = profile.spiritSnapshot().spirits.find(
        ({ shortType }) => shortType === displayed.shortType,
      );
      discoveredLevel = spirit?.savedXp ?? 0;
    }

    if (category === 2) {
      const recipe = recipesByResult.get(chain[0]!.shortType);
      if (recipe === undefined) {
        throw new Error(
          `Monsterpedia category 2 root ${chain[0]!.shortType} has no combine recipe`,
        );
      }
      result.push({
        kind: "recipe",
        chain,
        recipe,
        monster: displayed,
        ordinal: data.monsterBookIndex(displayed.shortType),
        known: discoveredLevel > 0,
        recipeKnown: profile.hasCombineRecipe(recipe.resultShortType),
        highestLevel: monsterpediaDisplayLevel(displayed, profile),
      });
    } else {
      result.push(monsterEntry(
        displayed,
        data.monsterBookIndex(displayed.shortType),
        chain,
        discoveredLevel > 0,
        profile,
      ));
    }
  }

  return result;
}

export function monsterpediaFoundCount(entries: readonly MonsterpediaEntry[]): number {
  return entries.reduce((count, entry) => count + (entry.known ? 1 : 0), 0);
}

export interface MonsterpediaPartyIdentity {
  readonly instanceId: string;
  readonly shortType: string;
}

/** Concrete candidates for one ordered recipe slot. Already-picked identities are excluded. */
export function combineIngredientCandidates(
  party: readonly MonsterpediaPartyIdentity[],
  shortType: string,
  pickedIds: ReadonlySet<string>,
): readonly string[] {
  return party
    .filter((monster) => monster.shortType === shortType && !pickedIds.has(monster.instanceId))
    .map((monster) => monster.instanceId);
}

export function canSatisfyCombineRecipe(
  party: readonly MonsterpediaPartyIdentity[],
  recipe: CombineRecipeDef,
): boolean {
  const first = combineIngredientCandidates(party, recipe.ingredients[0], new Set());
  if (first.length === 0) return false;
  if (recipe.ingredients[0] !== recipe.ingredients[1]) {
    return combineIngredientCandidates(party, recipe.ingredients[1], new Set()).length > 0;
  }
  return first.length >= 2;
}
