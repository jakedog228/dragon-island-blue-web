import type { WorldArrivalResult } from "@dib/engine";
import type { WorldPointOfInterest } from "@dib/gamedata/browser";

export type WorldPoiRoute =
  | { readonly kind: "navigate" }
  | {
      readonly kind: "collection";
      readonly collectionType: string;
    }
  | {
      readonly kind: "worldExit";
      readonly targetWorld: string;
      readonly targetPoi: string;
    }
  | {
      /** Open scene identifier consumed by the app's scene-factory registry (town/shop/dungeon). */
      readonly kind: "scene";
      readonly sceneId: string;
      /**
       * Native town arrival dispatches synchronously while its independently scheduled marker
       * action is immediately hidden. Other scene types remain free to wait for visible movement.
       */
      readonly arrivalPresentation: "after-marker-movement" | "immediate-hidden-marker";
    }
  | {
      readonly kind: "blocked";
      readonly system: "dungeon" | "customInteraction" | "worldExit";
    };

export interface WorldPoiRoutingPolicy {
  route(point: WorldPointOfInterest): WorldPoiRoute;
}

export type WorldArrivalContinuation =
  | "encounter"
  | "immediateCollection"
  | "immediateScene"
  | "worldExit"
  | "afterMovementScene"
  | "navigate";

/** Arrival outcome is authoritative; route type only selects a continuation when no battle began. */
export function worldArrivalContinuation(
  route: WorldPoiRoute,
  arrival: WorldArrivalResult,
): WorldArrivalContinuation {
  if (route.kind === "blocked") {
    throw new Error(`blocked ${route.system} route cannot receive an arrival result`);
  }
  if (arrival.kind === "encounter") return "encounter";
  if (route.kind === "collection") return "immediateCollection";
  if (route.kind === "worldExit") return "worldExit";
  if (route.kind === "scene") {
    return route.arrivalPresentation === "immediate-hidden-marker"
      ? "immediateScene"
      : "afterMovementScene";
  }
  return "navigate";
}

export interface WorldSceneRequest {
  readonly poi: WorldPointOfInterest;
  readonly route: Extract<WorldPoiRoute, { kind: "scene" }>;
  readonly arrival: WorldArrivalResult;
}

/** Feature switches are supplied by the imported content capability scan. Keeping them outside
 * WorldNode makes dungeon support a pluggable scene registration rather than a renderer branch. */
export interface WorldPoiRoutingFeatures {
  /** Defaults off until the caller has mounted the Collection flow that consumes this route. */
  readonly collections?: boolean;
  readonly dungeons?: boolean;
  /** Defaults on for local/legacy play; official single-world packs disable the route fail-closed. */
  readonly worldExits?: boolean;
}

export function createWorldPoiRoutingPolicy(
  features: WorldPoiRoutingFeatures = {},
): WorldPoiRoutingPolicy {
  return {
    route(point): WorldPoiRoute {
      if (point.zoneChange?.kind === "world") {
        if (!point.zoneChange.targetWorld || !point.zoneChange.targetZoneChange) {
          throw new Error(`World POI routing: incomplete world exit at ${point.name}`);
        }
        return features.worldExits === false
          ? { kind: "blocked", system: "worldExit" }
          : {
              kind: "worldExit",
              targetWorld: point.zoneChange.targetWorld,
              targetPoi: point.zoneChange.targetZoneChange,
            };
      }
      if (point.town !== undefined) {
        return {
          kind: "scene",
          sceneId: "town",
          arrivalPresentation: "immediate-hidden-marker",
        };
      }
      if (point.zoneChange?.kind === "dungeon") {
        if (!point.zoneChange.dungeon || !point.zoneChange.dungeonFile) {
          throw new Error(`World POI routing: incomplete dungeon entrance at ${point.name}`);
        }
        return features.dungeons === true
          ? {
              kind: "scene",
              sceneId: "dungeon",
              arrivalPresentation: "after-marker-movement",
            }
          : { kind: "blocked", system: "dungeon" };
      }
      if (point.demoSkipped.includes("dungeon")) return { kind: "blocked", system: "dungeon" };
      if (point.supportedInteraction?.kind === "monsterCollection") {
        return features.collections === true
          ? {
              kind: "collection",
              collectionType: point.supportedInteraction.collectionType,
            }
          : { kind: "blocked", system: "customInteraction" };
      }
      if (point.demoSkipped.includes("customInteraction")) {
        return { kind: "blocked", system: "customInteraction" };
      }
      return { kind: "navigate" };
    },
  };
}

/** Conservative default retained for archives without a verified dungeon capability. */
export const BASELINE_WORLD_POI_ROUTING: WorldPoiRoutingPolicy = createWorldPoiRoutingPolicy();
