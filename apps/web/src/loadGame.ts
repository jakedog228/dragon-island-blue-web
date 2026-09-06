import {
  CollectionDataError,
  emptyCollectionCatalog,
  GameData,
  loadCollectionCatalog,
  loadSourceTutorialTopics,
  loadWorldData,
  type CollectionGoalDefinition,
  type SourceTutorialTopic,
} from "@dib/gamedata/browser";
import { AssetLibrary, type Scale9SpritesData } from "@dib/renderer";
import type { AnimationsData } from "@dib/renderer/animations";
import type { MeleeAttacksData } from "./battle/abilityRendererMath.js";
import type { LocalizedStrings } from "./localization.js";
import type { ImportedContentPackage } from "./content/archivePackage.js";
import { hasImportedModProfile } from "./content/moddedContent.js";
import type { FullTrustModRuntime } from "./content/codeModRuntime.js";

export interface LoadedGame {
  gd: GameData;
  anims: AnimationsData;
  meleeAttacks: MeleeAttacksData;
  /** `Scale9Sprites.json` config map — consumed by TargetPicker's info popups + the shared popup's
   *  win/defeat popups (Scale9.fromConfig). */
  scale9: Scale9SpritesData;


  strings: LocalizedStrings;
  assets: AssetLibrary;
  /** Exact numbered TutorialMenuItem topics recovered from the selected package's Plot.plist. */
  sourceTutorialTopics: readonly SourceTutorialTopic[];
  /** Strict optional Collection.plist catalog, retained in authored goal order. */
  collectionCatalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>;
  /** True only when the strict all-world scan promoted at least one Collection POI route. */
  readonly hasCollectionRoute: boolean;
  /** Present only for full-trust Offline mod profiles. */
  readonly mods?: FullTrustModRuntime;
}

export function loadGame(content: ImportedContentPackage): LoadedGame {
  const {
    monsters,
    combines,
    jobs,
    abilities,
    abilityComponents,
    buffs,
    items,
    licenses,
    tournaments,
    thingsInWorld,
    anims,
    meleeAttacks,
    scale9,
    strings,
  } = content.data;
  const raw = {
    monsters,
    combines,
    jobs,
    abilities,
    abilityComponents,
    buffs,
    ...(items !== undefined ? { items } : {}),
    ...(licenses !== undefined ? { licenses } : {}),
    ...(tournaments !== undefined ? { tournaments } : {}),
    ...(thingsInWorld !== undefined ? { thingsInWorld } : {}),
  };
  const gd = GameData.fromRaw(raw);
  const knownMonsterTypes = new Set(gd.allMonsters().map(({ shortType }) => shortType));
  const collectionRoutes = content.worldNames.flatMap((worldName) =>
    loadWorldData(content.resources, worldName, knownMonsterTypes).pointsOfInterest.flatMap(
      (point) => point.supportedInteraction?.kind === "monsterCollection"
        ? [{ poiName: point.name, collectionType: point.supportedInteraction.collectionType }]
        : [],
    ));
  if (collectionRoutes.length > 0 && !content.resources.has("Collection.plist")) {
    throw new CollectionDataError(
      `Collection route ${collectionRoutes[0]!.poiName} requires Collection.plist`,
    );
  }
  const collectionCatalog = content.resources.has("Collection.plist")
    ? loadCollectionCatalog(content.resources, gd)
    : emptyCollectionCatalog();
  for (const route of collectionRoutes) {
    if (!collectionCatalog.has(route.collectionType)) {
      throw new CollectionDataError(
        `Collection route ${route.poiName} references missing collection type ${route.collectionType}`,
      );
    }
  }
  return {
    gd,
    anims,
    meleeAttacks,
    scale9: scale9 as Scale9SpritesData,
    strings,
    assets: AssetLibrary.fromManifest(content.manifest, content.urlFor),
    sourceTutorialTopics: loadSourceTutorialTopics(content.resources),
    collectionCatalog,
    hasCollectionRoute: collectionRoutes.length > 0,
    ...(hasImportedModProfile(content) ? { mods: content.mods } : {}),
  };
}
