import type { DungeonResourceSource } from "./dungeon.js";

export const SOURCE_TUTORIAL_KEYS = [
  "Tutorial0",
  "Tutorial1",
  "Tutorial2",
  "Tutorial3",
  "Tutorial4",
  "Tutorial5",
  "Tutorial6",
  "Tutorial7",
  "Tutorial8",
] as const;

export type SourceTutorialKey = (typeof SOURCE_TUTORIAL_KEYS)[number];

export interface SourceTutorialTopic {
  readonly key: SourceTutorialKey;
  readonly titleLocalizationKey: `${SourceTutorialKey}TitleKey`;
  readonly fullTitleLocalizationKey: `${SourceTutorialKey}FullTitle`;
  /** Ordered, non-lossy traversal of the shipped PlotGameFlowEvent `nextEvent` chain. */
  readonly images: readonly string[];
}

/**
 * Reads only the source's numbered tutorial vocabulary from Plot.plist. Independently-authored
 * Plot dictionaries may use other event names; those remain untouched and do not accidentally
 * opt into Dragon Island Blue's fixed TutorialMenuItem contract.
 *
 * Missing numbered topics are an absent optional capability. A numbered topic that is present but
 * malformed is schema drift and fails loudly.
 */
export function loadSourceTutorialTopics(
  source: DungeonResourceSource,
): readonly SourceTutorialTopic[] {
  if (!source.has("Plot.plist")) return Object.freeze([]);
  const raw = source.plist("Plot.plist");
  const plot = requireDictionary(raw, "Plot.plist");
  return Object.freeze(SOURCE_TUTORIAL_KEYS.flatMap((key) => {
    const event = plot[key];
    if (event === undefined) return [];
    return [Object.freeze({
      key,
      titleLocalizationKey: `${key}TitleKey` as const,
      fullTitleLocalizationKey: `${key}FullTitle` as const,
      images: Object.freeze(readContinuePages(event, `Plot.plist.${key}`)),
    })];
  }));
}

export function completeSourceTutorialCatalog(
  topics: readonly SourceTutorialTopic[],
): topics is readonly SourceTutorialTopic[] {
  return topics.length === SOURCE_TUTORIAL_KEYS.length &&
    SOURCE_TUTORIAL_KEYS.every((key, index) => topics[index]?.key === key);
}

export function sourceTutorialTopic(
  topics: readonly SourceTutorialTopic[],
  key: SourceTutorialKey,
): SourceTutorialTopic | undefined {
  return topics.find((topic) => topic.key === key);
}

function readContinuePages(value: unknown, path: string): string[] {
  const images: string[] = [];
  let current: unknown = value;
  let currentPath = path;
  for (let page = 0; current !== undefined; page += 1) {
    if (page >= 32) throw new Error(`${path}: tutorial event chain exceeds 32 pages`);
    const event = requireDictionary(current, currentPath);
    if (event["class"] !== "PlotGameFlowEvent") {
      throw new Error(`${currentPath}.class must be PlotGameFlowEvent`);
    }
    if (event["continueButton"] !== true) {
      throw new Error(`${currentPath}.continueButton must be true`);
    }
    const image = event["image"];
    if (typeof image !== "string" || image.length === 0) {
      throw new Error(`${currentPath}.image must be a non-empty string`);
    }
    images.push(image);
    current = event["nextEvent"];
    currentPath = `${currentPath}.nextEvent`;
  }
  return images;
}

function requireDictionary(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be a dictionary`);
  }
  return value as Record<string, unknown>;
}
