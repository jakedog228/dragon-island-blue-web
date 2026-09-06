import {
  OUTLINE_FADE_ALPHA,
  OUTLINE_FADE_BORDER_PT,
  OUTLINE_FADE_COLOR,
  OUTLINE_PLAIN_ALPHA,
} from "@dib/renderer/outlineBackgroundMath";
import type { DungeonDirection, DungeonFloor, DungeonRoom, DungeonRoomLink } from "@dib/engine/dungeon";
import {
  idiomPairPt,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";

export const DUNGEON_SOURCE_TILE_PT = Object.freeze({ iphone: 60, ipad: 120 });
/** Stage root is x2 in both modes, so both native tiers normalize to one 60-point tile. */
export const DUNGEON_TILE_PT = 60;
export const DUNGEON_HERO_FRAME_MS = 100;
export const DUNGEON_WALK_LEG_MS = 300;
export const DUNGEON_TELEPORT_FADE_MS = 250;
export const DUNGEON_CAMERA_MS = 500;
export const DUNGEON_LAYER_Z = Object.freeze({
  background: -10_000,
  world: 0,
  chrome: 10_000,
});

/**
 * Stage-root z of `dungeonPopupRoot`, the scene root that hosts DungeonNode's modals (Party
 * Editor, Monsterpedia, master menu, dialogs).
 *
 * It must stay above `dungeonPointRoot` (z 0) and BELOW `WORLD_NOTIFICATION_Z_INDEX`, because
 * `registerAutomaticPresentationRoot` routes every popup opened from this container into the
 * director notification layer. When it outranked that layer, the Party Editor's info card mounted
 * behind the editor's opaque MMScreen background and the editor's full-screen hitArea swallowed
 * the card's buttons — leaving the card unusable and `PartyEditorFlow.busy` latched, which killed
 * the reorder arrows and every later card tap while the X and drag-scroll kept working.
 */
export const DUNGEON_POPUP_ROOT_Z_INDEX = 20_000;

export interface DungeonLootDisplayMetrics {
  readonly roundingScale: number;
  readonly mainGap: number;
  readonly pageColumnGap: number;
  readonly rowGap: number;
  readonly iconSide: number;
  readonly titleFontSize: number;
  readonly nameFontSize: number;
  readonly bonusValueFontSize: number;
  readonly bonusCellWidth: number;
  readonly bonusIconSide: number;
  readonly pageFontSize: number;
  readonly takeAllFontSize: number;
  readonly popupTopInset: number;
  readonly infoSpacer: number;
  readonly infoDescriptionFontSize: number;
  readonly infoIconSide: number;
  readonly infoValueFontSize: number;
  readonly infoButtonGap: number;
}

/** Binary-derived `SmallItemDisplay`/`PagedNodeDisplay` phone/iPad geometry. */
export function dungeonLootDisplayMetrics(mode: DisplayMode): DungeonLootDisplayMetrics {
  return Object.freeze({
    roundingScale: sourcePointsPerPortPoint(mode),
    mainGap: idiomPairPt(10, 20, mode),
    pageColumnGap: idiomPairPt(10, 20, mode),
    rowGap: unscaledIdiomPt(5, mode),
    iconSide: idiomPairPt(32, 64, mode),
    titleFontSize: idiomPairPt(18, 36, mode),
    nameFontSize: idiomPairPt(14, 20, mode),
    bonusValueFontSize: idiomPairPt(10, 16, mode),
    bonusCellWidth: idiomPairPt(24, 48, mode),


    bonusIconSide: idiomPairPt(24, 48, mode),
    pageFontSize: idiomPairPt(14, 28, mode),
    takeAllFontSize: idiomPairPt(14, 28, mode),
    popupTopInset: unscaledIdiomPt(10, mode),
    infoSpacer: idiomPairPt(10, 20, mode),
    infoDescriptionFontSize: idiomPairPt(16, 32, mode),
    infoIconSide: idiomPairPt(20, 40, mode),
    infoValueFontSize: idiomPairPt(14, 28, mode),
    infoButtonGap: unscaledIdiomPt(40, mode),
  });
}

export interface DungeonHudLayout {
  readonly menu: { readonly x: number; readonly y: number };
}
export function dungeonHudLayout(viewport: { readonly w: number; readonly h: number }): DungeonHudLayout {
  if (!(viewport.w > 0 && viewport.h > 0)) throw new Error("dungeon HUD viewport must be positive");
  return Object.freeze({
    menu: Object.freeze({ x: viewport.w, y: 0 }),
  });
}

export interface DungeonRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface DungeonTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly bounds: DungeonRect;
  readonly currentRect: DungeonRect;
  readonly focus: Readonly<{ x: number; y: number }>;
}

export interface DungeonConnectorTile {
  readonly key: string;
  readonly sourceRoomId: string;
  readonly targetRoomId: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly x: number;
  readonly y: number;
}

export function dungeonTileSizePt(mode: DisplayMode): number {
  return DUNGEON_SOURCE_TILE_PT[mode] / (mode === "ipad" ? 2 : 1);
}

/** Native scene selection radius is the source-native 30/60 idiom pair. */
export function dungeonRoomTouchRadiusPt(mode: DisplayMode): number {
  return idiomPairPt(30, 60, mode);
}

/** Cocos bottom-left room origin -> Pixi top-left world rectangle. */
export function dungeonRoomRect(room: Pick<DungeonRoom, "x" | "y" | "width" | "height">): DungeonRect {
  return {
    x: room.x * DUNGEON_TILE_PT,
    y: -(room.y + room.height) * DUNGEON_TILE_PT,
    w: room.width * DUNGEON_TILE_PT,
    h: room.height * DUNGEON_TILE_PT,
  };
}

/** Source z-order recovered from DungeonNode: 9999 - integer room y. */
export function dungeonRoomZ(room: Pick<DungeonRoom, "y">): number {
  return 9999 - room.y;
}

/** Source camera considers only current room plus directly linked rooms. */
export function dungeonVisibleRoomIds(floor: Pick<DungeonFloor, "rooms" | "currentRoomId">): readonly string[] {
  const current = floor.rooms.find((room) => room.id === floor.currentRoomId);
  if (current === undefined) throw new Error(`missing current room ${floor.currentRoomId}`);
  const materialized = new Set(floor.rooms.filter((room) => room.explored).map((room) => room.id));
  return Object.freeze([
    current.id,
    ...current.links.map((link) => link.targetRoomId).filter((id) => materialized.has(id)),
  ]);
}

export function dungeonCameraBounds(floor: Pick<DungeonFloor, "rooms" | "currentRoomId">): DungeonRect {
  const ids = new Set(dungeonVisibleRoomIds(floor));
  const rects = floor.rooms.filter((room) => ids.has(room.id)).map(dungeonRoomRect);
  if (rects.length === 0) throw new Error("dungeon camera has no rooms");
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return Object.freeze({ x: left, y: top, w: right - left, h: bottom - top });
}

export function dungeonCameraTransform(
  floor: Pick<DungeonFloor, "rooms" | "currentRoomId">,
  viewport: { readonly w: number; readonly h: number },
  forcedScale?: number,
): DungeonTransform {
  if (!(viewport.w > 0 && viewport.h > 0)) throw new Error("dungeon camera viewport must be positive");
  if (forcedScale !== undefined && (!(forcedScale > 0) || !Number.isFinite(forcedScale))) {
    throw new Error("forced dungeon camera scale must be positive and finite");
  }
  const currentRoom = floor.rooms.find((room) => room.id === floor.currentRoomId);
  if (currentRoom === undefined) throw new Error(`missing current room ${floor.currentRoomId}`);
  const currentRect = dungeonRoomRect(currentRoom);
  const focus = Object.freeze({
    x: currentRect.x + currentRect.w / 2,
    y: currentRect.y + currentRect.h / 2,
  });
  const bounds = dungeonCameraBounds(floor);
  const halfWidth = Math.max(focus.x - bounds.x, bounds.x + bounds.w - focus.x);
  const halfHeight = Math.max(focus.y - bounds.y, bounds.y + bounds.h - focus.y);
  const fit = Math.min(viewport.w / (2 * halfWidth), viewport.h / (2 * halfHeight));
  const scale = forcedScale ?? Math.min(1, Math.max(0.75, fit));
  return Object.freeze({
    x: viewport.w / 2 - focus.x * scale,
    y: viewport.h / 2 - focus.y * scale,
    scale,
    bounds,
    currentRect,
    focus,
  });
}

/** Source bottom-left grid coordinate of the one-tile room-link connector. */
export function dungeonConnectorGridPosition(
  room: Pick<DungeonRoom, "x" | "y">,
  link: Pick<DungeonRoomLink, "offset">,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: room.x + link.offset.x, y: room.y + link.offset.y });
}

/** Source bottom-left grid tile -> Pixi top-left world position. */
export function dungeonConnectorPixiPosition(
  grid: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: grid.x * DUNGEON_TILE_PT, y: -(grid.y + 1) * DUNGEON_TILE_PT });
}


export function dungeonConnectorTiles(rooms: readonly DungeonRoom[]): readonly DungeonConnectorTile[] {
  const result: DungeonConnectorTile[] = [];
  for (const room of rooms) {
    for (const link of room.links) {
      if (link.offset.x >= 0 && link.offset.y > 0) continue;
      const grid = dungeonConnectorGridPosition(room, link);
      const key = `${room.id}|${link.targetRoomId}|${grid.x}|${grid.y}`;
      const pixi = dungeonConnectorPixiPosition(grid);
      result.push(Object.freeze({
        key,
        sourceRoomId: room.id,
        targetRoomId: link.targetRoomId,
        gridX: grid.x,
        gridY: grid.y,
        x: pixi.x,
        y: pixi.y,
      }));
    }
  }
  return Object.freeze(result);
}


export function dungeonEncounterRoomFitScale(
  content: Readonly<{ w: number; h: number }>,
  mode: DisplayMode,
): number {
  const maximum = idiomPairPt(78, 156, mode);
  if (!(content.w > 0 && content.h > 0 && maximum > 0)) {
    throw new Error("dungeon encounter fit dimensions must be positive");
  }
  return Math.min(1, maximum / content.w, maximum / content.h);
}

/** Final RoomNode encounter position after its common anchor is reset to (0.5, 0.5). */
export function dungeonEncounterRoomPosition(
  room: Readonly<{ width: number; height: number }>,
  ownsItems: boolean,
  waypoint: boolean,
  mode: DisplayMode,
): Readonly<{ x: number; y: number }> {
  if (!(room.width > 0 && room.height > 0)) {
    throw new Error("dungeon encounter room dimensions must be positive");
  }
  return Object.freeze({
    x: room.width * DUNGEON_TILE_PT / 2,
    y: ownsItems || waypoint
      ? idiomPairPt(60, 120, mode)
      : room.height * DUNGEON_TILE_PT / 2,
  });
}

export interface DungeonEncounterOutline {

  readonly radiusPt: number;
  /** ccColor3B handed to the outline's `setColor:`. */
  readonly color: number;
  /** Outline sprite opacity / 255. */
  readonly alpha: number;
  /** Breeder encounters run `CCRepeatForever(CCSequence(CCFadeOut .5, CCFadeIn .5))` on it. */
  readonly pulse: boolean;
}


export function dungeonEncounterOutline(
  hasBreeder: boolean,
  mode: DisplayMode,
): DungeonEncounterOutline {
  return hasBreeder
    ? Object.freeze({
      radiusPt: unscaledIdiomPt(3, mode),
      color: 0xff0000,
      alpha: OUTLINE_PLAIN_ALPHA,
      pulse: true,
    })
    : Object.freeze({
      radiusPt: unscaledIdiomPt(OUTLINE_FADE_BORDER_PT, mode),
      color: OUTLINE_FADE_COLOR,
      alpha: OUTLINE_FADE_ALPHA,
      pulse: false,
    });
}


export const DUNGEON_BREEDER_PULSE_LEG_MS = 500;
export const DUNGEON_BREEDER_PULSE_CYCLE_MS = DUNGEON_BREEDER_PULSE_LEG_MS * 2;

export interface DungeonBreederPulseState {
  readonly firstTick: boolean;
  /** Native CCActionInterval elapsed time, retained as float32 seconds. */
  readonly elapsedSeconds: number;
  readonly alpha: number;
}

export function initialDungeonBreederPulseState(): DungeonBreederPulseState {
  return Object.freeze({ firstTick: true, elapsedSeconds: 0, alpha: 1 });
}

/**
 * One scheduler step of the shipped
 * `CCRepeatForever(CCSequence(CCFadeOut(.5), CCFadeIn(.5)))`.
 *
 * `CCActionInterval`'s first step publishes update(0) without consuming `dt`. `CCSequence` carries
 * overshoot through the half-cycle in the same update; at the full-cycle boundary
 * `CCRepeatForever` restarts the interval and its first-tick rule discards the cycle overshoot.
 * CCFadeOut/In convert their positive float opacity to the 8-bit GLubyte with truncation.
 */
export function advanceDungeonBreederPulse(
  state: DungeonBreederPulseState,
  deltaMs: number,
): DungeonBreederPulseState {
  if (!(deltaMs >= 0) || !Number.isFinite(deltaMs)) {
    throw new Error(`dungeon breeder pulse delta must be non-negative and finite: ${deltaMs}`);
  }
  if (state.firstTick) {
    return Object.freeze({ firstTick: false, elapsedSeconds: 0, alpha: 1 });
  }
  const elapsedSeconds = Math.fround(
    state.elapsedSeconds + Math.fround(deltaMs / 1_000),
  );
  if (elapsedSeconds >= Math.fround(DUNGEON_BREEDER_PULSE_CYCLE_MS / 1_000)) {
    return Object.freeze({ firstTick: false, elapsedSeconds: 0, alpha: 1 });
  }
  const half = Math.fround(DUNGEON_BREEDER_PULSE_LEG_MS / 1_000);
  const normalized = Math.fround(elapsedSeconds / Math.fround(1));
  const opacity = normalized <= half
    ? Math.fround(255 * Math.fround(1 - Math.fround(normalized / half)))
    : Math.fround(255 * Math.fround(Math.fround(normalized - half) / half));
  return Object.freeze({
    firstTick: false,
    elapsedSeconds,
    alpha: Math.trunc(opacity) / 255,
  });
}

export function dungeonContentCenter(
  bounds: Readonly<{ x: number; y: number; w: number; h: number }>,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
}

/** Scene-level radius arbitration over every materialized RoomNode. */
export function nearestMaterializedRoom(
  floor: Pick<DungeonFloor, "rooms" | "currentRoomId">,
  point: { readonly x: number; readonly y: number },
  radius: number,
): DungeonRoom | undefined {
  let best: { room: DungeonRoom; distanceSquared: number; centerDistanceSquared: number } | undefined;
  for (const room of floor.rooms) {
    if (!room.explored) continue;
    const rect = dungeonRoomRect(room);
    const dx = point.x < rect.x ? rect.x - point.x : point.x > rect.x + rect.w ? point.x - (rect.x + rect.w) : 0;
    const dy = point.y < rect.y ? rect.y - point.y : point.y > rect.y + rect.h ? point.y - (rect.y + rect.h) : 0;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > radius * radius) continue;
    const centerDx = point.x - (rect.x + rect.w / 2);
    const centerDy = point.y - (rect.y + rect.h / 2);
    const centerDistanceSquared = centerDx * centerDx + centerDy * centerDy;
    if (best === undefined || distanceSquared < best.distanceSquared ||
        (distanceSquared === best.distanceSquared && centerDistanceSquared < best.centerDistanceSquared)) {
      best = { room, distanceSquared, centerDistanceSquared };
    }
  }
  return best?.room;
}

export function dungeonFloorTilePosition(
  room: Pick<DungeonRoom, "height">,
  tileX: number,
  tileY: number,
): { readonly x: number; readonly y: number } {
  return Object.freeze({ x: tileX * DUNGEON_TILE_PT, y: (room.height - 1 - tileY) * DUNGEON_TILE_PT });
}

export function dungeonFrameName(format: string, ...values: readonly number[]): string {
  let index = 0;
  const result = format.replace(/%d/g, () => {
    if (index >= values.length) throw new Error(`not enough values for ${format}`);
    return String(values[index++]);
  });
  if (index !== values.length) throw new Error(`too many values for ${format}`);
  return result;
}

export function dungeonWallFrameName(
  format: string,
  index: number,
  room: Pick<DungeonRoom, "width" | "height">,
): string {
  const placeholders = (format.match(/%d/g) ?? []).length;
  if (placeholders === 1) return dungeonFrameName(format, index);
  if (placeholders === 3) return dungeonFrameName(format, index, room.width, room.height);
  throw new Error(`unsupported dungeon wall format ${format}`);
}

export function dungeonHeroFrameDirection(direction: DungeonDirection): "Front" | "Back" | "Left" | "Right" {
  switch (direction) {
    case "north": return "Back";
    case "east": return "Right";
    case "south": return "Front";
    case "west": return "Left";
  }
}

export function dungeonHeroFrameName(direction: DungeonDirection, frame: number): string {
  if (!Number.isInteger(frame) || frame < 1 || frame > 8) throw new Error("hero frame must be in [1,8]");
  return `herowalk${dungeonHeroFrameDirection(direction)}_${frame}.png`;
}

export function dungeonDoorPosition(
  room: Pick<DungeonRoom, "width" | "height">,
  direction: DungeonDirection,
): { readonly x: number; readonly y: number; readonly rotation: number } {
  const w = room.width * DUNGEON_TILE_PT;
  const h = room.height * DUNGEON_TILE_PT;
  switch (direction) {
    case "north": return Object.freeze({ x: w / 2, y: 0, rotation: 0 });
    case "east": return Object.freeze({ x: w, y: h / 2, rotation: Math.PI / 2 });
    case "south": return Object.freeze({ x: w / 2, y: h, rotation: Math.PI });
    case "west": return Object.freeze({ x: 0, y: h / 2, rotation: -Math.PI / 2 });
  }
}


export const DUNGEON_DOOR_WALL_INSET_PT = 20;

export const DUNGEON_NORTH_DOOR_LIFT_PT = 2;

export function dungeonRoomLinkDoorPosition(
  room: Pick<DungeonRoom, "width" | "height">,
  link: Pick<DungeonRoomLink, "offset">,
): { readonly x: number; readonly y: number; readonly rotation: number; readonly anchorY: number } {
  const { x, y } = link.offset;


  if (y === room.height) {
    return Object.freeze({
      x: (x + 0.5) * DUNGEON_TILE_PT,
      y: room.height * DUNGEON_TILE_PT - ((room.height - 1) * DUNGEON_TILE_PT + DUNGEON_NORTH_DOOR_LIFT_PT),
      rotation: 0,
      anchorY: 1,
    });
  }
  if (x === -1) {
    return Object.freeze({
      x: (x + 0.5) * DUNGEON_TILE_PT + DUNGEON_DOOR_WALL_INSET_PT,
      y: (room.height - y - 0.5) * DUNGEON_TILE_PT,

      rotation: Math.PI / 2,
      anchorY: 0.5,
    });
  }
  if (x === room.width) {
    return Object.freeze({
      x: (x + 0.5) * DUNGEON_TILE_PT - DUNGEON_DOOR_WALL_INSET_PT,
      y: (room.height - y - 0.5) * DUNGEON_TILE_PT,
      rotation: Math.PI / 2,
      anchorY: 0.5,
    });
  }
  if (y === -1) {
    return Object.freeze({
      x: (x + 0.5) * DUNGEON_TILE_PT,
      y: (room.height - y - 0.5) * DUNGEON_TILE_PT - DUNGEON_DOOR_WALL_INSET_PT,
      // The south branch skips `setRotation:` entirely; the door frame is authored horizontal.
      rotation: 0,
      anchorY: 0.5,
    });
  }
  throw new Error(`dungeon link offset (${x},${y}) is not on the room boundary`);
}


export const DUNGEON_FOREST_SHADOW_OPACITY = 120;

export const DUNGEON_FOREST_SHADOW_TINT = 0x000000;

export const DUNGEON_FOREST_SHADOW_SCALE_Y = 0.8;

export const DUNGEON_FOREST_TREE_SCALE_BASE = 0.75;
export const DUNGEON_FOREST_TREE_SCALE_SPREAD = 0.1;


export function dungeonForestTreeScale(unitRandom: number): number {
  if (!(unitRandom >= 0 && unitRandom < 1)) throw new Error("forest tree scale needs a unit random");
  return DUNGEON_FOREST_TREE_SCALE_BASE + unitRandom * DUNGEON_FOREST_TREE_SCALE_SPREAD;
}

export interface DungeonForestTreePlacement {
  /** Boundary offset this tree occupies, in the same space as `DungeonRoomLink.offset`. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly x: number;
  readonly y: number;
  /** Front row only: dimmed, black, pre-squashed. */
  readonly shadow: boolean;
}

export function dungeonForestTreeKey(offsetX: number, offsetY: number): string {
  return `${offsetX},${offsetY}`;
}


export function dungeonForestTreePlacements(
  room: Pick<DungeonRoom, "width" | "height">,
  mode: DisplayMode,
): readonly DungeonForestTreePlacement[] {
  const height = room.height * DUNGEON_TILE_PT;
  const eastPullIn = unscaledIdiomPt(1, mode);
  const placements: DungeonForestTreePlacement[] = [];
  for (let x = 0; x < room.width; x++) {
    placements.push(Object.freeze({
      offsetX: x, offsetY: room.height,
      x: (x + 0.5) * DUNGEON_TILE_PT, y: 0,
      shadow: false,
    }));
    placements.push(Object.freeze({
      offsetX: x, offsetY: -1,
      x: (x + 0.5) * DUNGEON_TILE_PT, y: height + DUNGEON_TILE_PT / 2,
      shadow: true,
    }));
  }
  for (let y = room.height - 1; y >= 0; y--) {
    placements.push(Object.freeze({
      offsetX: -1, offsetY: y,
      x: 0, y: height - y * DUNGEON_TILE_PT,
      shadow: false,
    }));
    placements.push(Object.freeze({
      offsetX: room.width, offsetY: y,
      x: room.width * DUNGEON_TILE_PT - eastPullIn, y: height - y * DUNGEON_TILE_PT,
      shadow: false,
    }));
  }
  return Object.freeze(placements);
}

/** Live door node as `-[DungeonNode setCurrentRoom:]` reads it back out of `RoomNode.doors`:
 *  room-local Pixi position plus the sprite's own UNROTATED point size. */
export interface DungeonDoorNodeMetrics {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}


export function dungeonDoorWalkTarget(
  door: DungeonDoorNodeMetrics,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: door.x + door.width / 2, y: door.y - door.height / 2 });
}
