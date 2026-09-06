import {
  resolveTownPortalDestination,
  type TownPortalDestination,
} from "@dib/gamedata/browser";

export type WorldBootRoute =
  | { readonly kind: "resumeWorld" }
  | { readonly kind: "resumeTown"; readonly townName: string }
  | { readonly kind: "initial"; readonly fade: false; readonly townName: string };

/**
 * The archive importer deliberately permits a world-only package. That package resumes its
 * authored POI directly; a town-capable package still requires the source town destination and
 * must retain its prior loud failure when that metadata is absent.
 */
export function initialWorldBootRoute(input: {
  readonly hasTownCapability: boolean;
  readonly townName: string | undefined;
  readonly fixturePoiName: string | undefined;
  readonly fixturePoiIsTown: boolean | undefined;
  readonly presentationResumeMode: "town" | "other";
}): WorldBootRoute {
  if (!input.hasTownCapability) return { kind: "resumeWorld" };
  if (input.townName === undefined) {
    throw new Error("Initial world start requires a resolved town destination");
  }
  if (input.fixturePoiName !== undefined && input.fixturePoiIsTown === false) {
    return { kind: "resumeWorld" };
  }
  const townName = input.fixturePoiName ?? input.townName;
  return input.presentationResumeMode === "town"
    ? { kind: "resumeTown", townName }
    : { kind: "initial", fade: false, townName };
}

/** Restored town metadata is meaningful only for content that actually has town capability. */
export function restoredTownMetadata(
  hasTownCapability: boolean,
  lastTownName: string | undefined,
): string | undefined {
  return hasTownCapability ? lastTownName : undefined;
}

/** Production restore validation used before the saved world is allowed to boot. */
export function resolveRestoredTownDestination(
  hasTownCapability: boolean,
  lastTownName: string | undefined,
  destinations: readonly TownPortalDestination[],
): TownPortalDestination | undefined {
  const restoredTownName = restoredTownMetadata(hasTownCapability, lastTownName);
  return restoredTownName === undefined
    ? undefined
    : resolveTownPortalDestination(destinations, restoredTownName);
}
