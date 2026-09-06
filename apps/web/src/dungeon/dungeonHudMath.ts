import type { DungeonDefinition, DungeonMonsterSpec } from "@dib/gamedata/dungeon";
import {
  idiomPairPt,
  roundSourcePoint,
  screenPointsForMode,
  unscaledIdiomPt,
  type DisplayMode,
  type SizePt,
} from "../displayMode.js";

export type DungeonCollectionEligibility = (
  shortType: string,
  extraLivingArguments: DungeonMonsterSpec["extraLivingArguments"],
) => boolean;


export function dungeonCollectionMonsterTypes(
  definition: Pick<DungeonDefinition, "floorPopulations">,
  eligible: DungeonCollectionEligibility = () => true,
): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (
    type: string,
    extraLivingArguments?: DungeonMonsterSpec["extraLivingArguments"],
  ): void => {
    if (
      type === "Any" ||
      type === "Random" ||
      seen.has(type) ||
      !eligible(type, extraLivingArguments)
    ) return;
    seen.add(type);
    result.push(type);
  };
  for (const population of definition.floorPopulations) {
    const populator = population.monsterPopulator;
    if (populator === undefined) continue;
    for (const entry of populator.types) add(entry.type);
    for (const encounter of populator.fixedEncounters) {
      if (encounter.breeder !== undefined) continue;
      for (const monster of encounter.monsters) {
        add(monster.type, monster.extraLivingArguments);
      }
    }
  }
  return Object.freeze(result);
}

export function formatDungeonCaught(template: string, caught: number, total: number): string {
  let index = 0;
  const values = [caught, total];
  const result = template.replace(/%d/g, () => String(values[index++]));
  if (index !== 2) throw new Error(`Dungeon caught format must contain exactly two %d tokens: ${template}`);
  return result;
}


export function formatInfiniteDungeonUnlock(template: string, nextFloor: number): string {
  if (!Number.isSafeInteger(nextFloor) || nextFloor < 1) {
    throw new Error(`Infinite dungeon unlock floor must be a positive integer: ${nextFloor}`);
  }
  let count = 0;
  const result = template.replace(/%d/g, () => { count += 1; return String(nextFloor); });
  if (count !== 1) {
    throw new Error(`Infinite dungeon unlock format must contain exactly one %d token: ${template}`);
  }
  return result;
}


export const INFINITE_DUNGEON_UNLOCK_LABEL_DELAY_MS = 2000;

export const INFINITE_DUNGEON_UNLOCK_LABEL_FADE_MS = 2000;

export const INFINITE_DUNGEON_UNLOCK_LABEL_Z = 10;

export const INFINITE_DUNGEON_UNLOCK_BACKING_Z = -9;

export const INFINITE_DUNGEON_UNLOCK_BACKING_CONFIG = "PopupBackgroundThin";

export interface InfiniteDungeonUnlockLabelFont {
  /** `labelWithString:fontName:fontSize:` size, from the idiom table at `data_cba90`/`data_cba94`. */
  readonly fontSizePt: number;

  readonly outlineWidthPt: number;
}


export function infiniteDungeonUnlockLabelFont(mode: DisplayMode): InfiniteDungeonUnlockLabelFont {
  return Object.freeze({
    fontSizePt: idiomPairPt(16, 32, mode),
    outlineWidthPt: unscaledIdiomPt(2, mode),
  });
}

export interface InfiniteDungeonUnlockLabelLayout extends InfiniteDungeonUnlockLabelFont {

  readonly insetPt: number;

  readonly cocosPosition: { readonly x: number; readonly y: number };
  /** Top-left of the label box in the port's y-down chrome frame. */
  readonly topLeft: { readonly x: number; readonly y: number };

  readonly backingCenter: { readonly x: number; readonly y: number };
}


export function infiniteDungeonUnlockLabelLayout(
  mode: DisplayMode,
  contentSize: SizePt,
): InfiniteDungeonUnlockLabelLayout {
  if (!Number.isFinite(contentSize.w) || contentSize.w < 0
    || !Number.isFinite(contentSize.h) || contentSize.h < 0) {
    throw new Error(
      `Infinite dungeon label content size must be non-negative: ${contentSize.w}x${contentSize.h}`,
    );
  }
  const screen = screenPointsForMode(mode);
  const insetPt = unscaledIdiomPt(10, mode);

  const x = roundSourcePoint(screen.w - insetPt - contentSize.w / 2, mode);
  const y = roundSourcePoint(insetPt + contentSize.h / 2, mode);
  return Object.freeze({
    ...infiniteDungeonUnlockLabelFont(mode),
    insetPt,
    cocosPosition: Object.freeze({ x, y }),
    topLeft: Object.freeze({ x: x - contentSize.w, y: screen.h - y - contentSize.h }),
    backingCenter: Object.freeze({ x: contentSize.w / 2, y: contentSize.h / 2 }),
  });
}


export function formatDungeonLocalizedName(
  localizedName: string,
  floor: number,
  localizedLevel: string,
): string {
  if (localizedName.length === 0) throw new Error("Dungeon localized name must not be empty");
  if (!Number.isSafeInteger(floor) || floor < 1) {
    throw new Error(`Dungeon floor must be a positive integer: ${floor}`);
  }
  if (localizedLevel.length === 0) throw new Error("Dungeon level label must not be empty");
  return `${localizedLevel}:${floor} ${localizedName}`;
}
