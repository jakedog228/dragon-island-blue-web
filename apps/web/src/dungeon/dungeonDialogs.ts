import {
  Box,
  makeTtfLabel,
  minimumHitRectLocal,
  rectContainsPoint,
  OUTLINE_FADE_ALPHA,
  pointSprite,
} from "@dib/renderer";
import {
  Container,
  Rectangle,
  type FederatedPointerEvent,
  type Sprite,
  type Ticker,
} from "pixi.js";
import type { AudioPlayer } from "../audio.js";
import { localizedString } from "../localization.js";
import { Popup } from "../ui/popup.js";
import {
  buildMonsterHatchMessageContent,
  showMonsterHatchPopup,
  type MonsterHatchPopupEnvironment,
} from "../ui/monsterHatchPopup.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import type { LoadedGame } from "../loadGame.js";
import { prepareMenuButton2 } from "../ui/menuButton2.js";
import type { DungeonRouteDescriptor } from "@dib/engine/dungeon-runtime";
import {
  dungeonWaypointLayout,
  nextWaypointIndex,
  waypointFloorOptions,
} from "./dungeonWaypointMath.js";

let WAYPOINT_LAYOUT = dungeonWaypointLayout(DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  WAYPOINT_LAYOUT = dungeonWaypointLayout(DISPLAY_MODE);
});
const WAYPOINT_DISABLED_TINT = 0xa6a6a6;

export interface WaypointSelectionState {
  readonly floors: readonly number[];
  readonly selectedFloor: number;
}

export interface DungeonDialogContext {
  readonly parent: Container;
  readonly owner: object;
  readonly game: LoadedGame;
  readonly audio: AudioPlayer;
  readonly ticker: Ticker;
  readonly onWaypointSelectionChanged?: (state: WaypointSelectionState | undefined) => void;
  readonly setWaypointKeyboardConfirm?: (confirm: (() => void) | undefined) => void;
}

/** One source-family popup environment for all dungeon dialogs and nested information pages. */
export function dungeonPopupEnvironment(
  context: DungeonDialogContext,
  zIndex = 1000,
): MonsterHatchPopupEnvironment {
  return {
    parent: context.parent,
    assets: context.game.assets,
    scale9: context.game.scale9,
    ticker: context.ticker,
    owner: context.owner,
    zIndex,
    sfx: {
      onButtonPress: () => context.audio.playSfx("click"),
      onButtonBlocked: () => context.audio.playSfx("notAllowed"),
    },
  };
}

/** Standard `MonsterHatchPopup showPopupWithTitle:message:closeButtonName:` message popup. */
export async function showDungeonMessage(
  context: DungeonDialogContext,
  titleKey: string,
  messageKey: string,
): Promise<void> {
  await showChoice(context, {
    title: localizedString(context.game.strings, titleKey),
    message: localizedString(context.game.strings, messageKey),
    choices: [{ label: localizedString(context.game.strings, "OkButtonKey"), value: undefined }],
  });
}

/** `UserSavedData showTutorialForFlag:@"WaypointReached"`; the caller owns flag claiming. */
export function showWaypointReachedTutorial(context: DungeonDialogContext): Promise<void> {
  return showDungeonMessage(
    context,
    "WaypointReachedTitleKey",
    "WaypointReachedMessageKey",
  );
}







export function showNewInfiniteMonsterSlotTutorial(
  context: DungeonDialogContext,
): Promise<void> {
  return showDungeonMessage(
    context,
    "NewInfiniteMonsterSlotTitleKey",
    "NewInfiniteMonsterSlotMessageKey",
  );
}








export async function chooseDungeonWaypoint(
  context: DungeonDialogContext,
  current: DungeonRouteDescriptor,
  destinations: readonly DungeonRouteDescriptor[],
  lastFloor: number,
  /** Fires when the selector is actually on the notification band. The entrance caller uses it to
   *  keep the floor notice the LATER insert, as `onEnterTransitionDidFinish`'s one turn does. */
  onPresented: () => void = () => {},
): Promise<DungeonRouteDescriptor | undefined> {
  const available = waypointFloorOptions(current, destinations, lastFloor);
  if (available.length === 0) {
    throw new Error(
      `WaypointSelection: ${current.typeName}/${current.sourceFile} has no registered floor options`,
    );
  }

  let currentIndex = available.length - 1;
  let selected: DungeonRouteDescriptor | undefined;
  let popup: Popup | undefined;
  let dismissWhenMounted = false;
  let resolveDismissed!: () => void;
  const dismissed = new Promise<void>((resolve) => { resolveDismissed = resolve; });

  const message = buildMonsterHatchMessageContent(
    localizedString(context.game.strings, "WaypointSelectionMessageKey"),
  );
  const incrementer = await buildWaypointIncrementer(
    context,
    available.map((route) => route.floor),
    currentIndex,
    (index) => {
      currentIndex = index;
      context.onWaypointSelectionChanged?.(Object.freeze({
        floors: Object.freeze(available.map((route) => route.floor)),
        selectedFloor: available[currentIndex]!.floor,
      }));
    },
  );
  const goLabel = makeTtfLabel(
    localizedString(context.game.strings, "UseWaypointKey"),
    WAYPOINT_LAYOUT.goFontSize,
    { outline: false },
  );
  const preparedGo = await prepareMenuButton2({
    assets: context.game.assets,
    scale9: context.game.scale9,
    label: goLabel,
  });
  const goButton = preparedGo.node;
  goButton.label = "waypointGoTo";
  goButton.eventMode = "static";
  goButton.cursor = "pointer";
  const selectCurrent = (): void => {
    selected = available[currentIndex]!;
    context.audio.playSfx("click");
    if (popup === undefined) dismissWhenMounted = true;
    else popup.dismiss();
  };
  goButton.on("pointertap", (event: FederatedPointerEvent) => {
    event.stopPropagation();
    selectCurrent();
  });
  context.setWaypointKeyboardConfirm?.(selectCurrent);

  // Native Cocos uses a positive-Y arrow column ordered [down, up], and a negative-Y outer box
  // ordered [message, controls]. Reversing those child positions is the deliberate Y-up -> Y-down
  // conversion; the source gaps and content extents remain unchanged.
  const controls = new Box({
    horizontal: true,
    gap: WAYPOINT_LAYOUT.controlGap,
    positiveAlignDirection: true,
  });
  controls.label = "waypointControls";
  controls.addBoxChild(incrementer, { contentSize: incrementer.boxContentSize });
  controls.addBoxChild(goButton, { contentSize: preparedGo.layoutContentSize });

  const content = new Box({
    horizontal: false,
    gap: WAYPOINT_LAYOUT.outerGap,
    positiveAlignDirection: true,
  });
  content.label = "dungeonWaypointSelection";
  content.addBoxChild(message);
  content.addBoxChild(controls, { contentSize: controls.boxContentSize });

  content.boundsArea = new Rectangle(
    0,
    0,
    content.boxContentSize.w,
    content.boxContentSize.h + WAYPOINT_LAYOUT.contentHeightExtension,
  );

  const floors = Object.freeze(available.map((route) => route.floor));
  context.onWaypointSelectionChanged?.(Object.freeze({
    floors,
    selectedFloor: available[currentIndex]!.floor,
  }));
  popup = await showMonsterHatchPopup(dungeonPopupEnvironment(context), {
    title: localizedString(context.game.strings, "WaypointSelectionTitleKey"),
    content,
    buttons: [{
      label: localizedString(context.game.strings, "DontUseWaypointKey"),
      onPress: () => undefined,
    }],
    onPresent: onPresented,
    onDismiss: () => {
      context.onWaypointSelectionChanged?.(undefined);
      context.setWaypointKeyboardConfirm?.(undefined);
      resolveDismissed();
    },
    runScaleAction: false,
  });
  if (dismissWhenMounted) popup.dismiss();
  try {
    await dismissed;
  } finally {
    context.setWaypointKeyboardConfirm?.(undefined);
  }
  return selected;
}

async function buildWaypointIncrementer(
  context: DungeonDialogContext,
  floors: readonly number[],
  initialIndex: number,
  onIndexChanged: (index: number) => void,
): Promise<Box> {
  if (floors.length === 0) throw new Error("WaypointSelection incrementer requires an option");

  const root = new Box({
    horizontal: true,
    gap: WAYPOINT_LAYOUT.incrementerGap,
    positiveAlignDirection: true,
  });
  root.label = "waypointIncrementer";
  const prefix = localizedString(context.game.strings, "StartAtKey");
  const label = makeTtfLabel(`${prefix}${floors[initialIndex]!}`, WAYPOINT_LAYOUT.labelFontSize, {
    outlineAlpha: OUTLINE_FADE_ALPHA,
  });
  label.label = "waypointFloorLabel";

  if (floors.length === 1) {
    root.addBoxChild(label);
    return root;
  }

  const texture = await context.game.assets.sprite(
    context.game.assets.hasSprite("downArrow-hd") ? "downArrow-hd" : "downArrow",
  );
  const up = waypointArrow(pointSprite(texture), "up", true);
  const down = waypointArrow(pointSprite(texture), "down", false);
  const arrows = new Box({
    horizontal: false,
    gap: WAYPOINT_LAYOUT.arrowGap,
    positiveAlignDirection: true,
  });
  arrows.label = "waypointArrowColumn";
  // Visual top-to-bottom order after converting the source's Cocos Y-up child positions.
  arrows.addBoxChild(up.node, { contentSize: up.size });
  arrows.addBoxChild(down.node, { contentSize: down.size });
  root.addBoxChild(arrows, { contentSize: arrows.boxContentSize });
  root.addBoxChild(label);

  let index = initialIndex;
  let tracking = false;
  const arrowAt = (point: { readonly x: number; readonly y: number }): "up" | "down" | undefined => {
    const localX = point.x - arrows.position.x;
    const localY = point.y - arrows.position.y;
    const inNode = (
      node: Container,
      size: { readonly w: number; readonly h: number },
    ): boolean => rectContainsPoint(
      minimumHitRectLocal(
        { x: node.position.x, y: node.position.y, w: size.w, h: size.h },
        { x: 1, y: 1 },
      ),
      { x: localX, y: localY },
    );
    if (inNode(up.node, up.size)) return "up";
    if (inNode(down.node, down.size)) return "down";
    return undefined;
  };
  root.hitArea = { contains: (x, y) => arrowAt({ x, y }) !== undefined };
  root.eventMode = "static";
  root.cursor = "pointer";

  const update = (): void => {
    label.text = `${prefix}${floors[index]!}`;
    up.sprite.tint = index === floors.length - 1 ? WAYPOINT_DISABLED_TINT : 0xffffff;
    down.sprite.tint = index === 0 ? WAYPOINT_DISABLED_TINT : 0xffffff;
    root.layoutChildren();
    onIndexChanged(index);
  };
  const finish = (event: FederatedPointerEvent): void => {
    if (!tracking) return;
    tracking = false;
    const released = arrowAt(event.getLocalPosition(root));
    if (released !== undefined) index = nextWaypointIndex(index, floors.length, released);
    if (released !== undefined) update();
    event.stopPropagation();
  };
  root.on("pointerdown", (event: FederatedPointerEvent) => {
    if (arrowAt(event.getLocalPosition(root)) === undefined) return;
    tracking = true;
    event.stopPropagation();
  });
  root.on("pointerup", finish);
  root.on("pointerupoutside", finish);
  root.on("pointercancel", () => { tracking = false; });
  update();
  return root;
}

function waypointArrow(
  sprite: Sprite,
  direction: "up" | "down",
  flipY: boolean,
): { readonly node: Container; readonly sprite: Sprite; readonly size: { readonly w: number; readonly h: number } } {
  const size = { w: sprite.width, h: sprite.height };
  const node = new Container();
  node.label = `waypointArrow:${direction}`;
  sprite.anchor.set(0.5);
  sprite.position.set(size.w / 2, size.h / 2);
  if (flipY) sprite.scale.y *= -1;
  sprite.eventMode = "none";
  node.addChild(sprite);
  return { node, sprite, size };
}

interface Choice<T> { readonly label: string; readonly value: T }

async function showChoice<T>(
  context: DungeonDialogContext,
  options: {
    readonly title: string;
    readonly message: string;
    readonly choices: readonly Choice<T>[];
  },
): Promise<T> {
  const content = buildMessageContent(options.message);
  return showPopupAndWait(context, options.title, content, options.choices);
}

function buildMessageContent(message: string): Container {
  const content = buildMonsterHatchMessageContent(message);
  content.label = "dungeonPopupContent";
  return content;
}

async function showPopupAndWait<T>(
  context: DungeonDialogContext,
  title: string,
  content: Container,
  choices: readonly Choice<T>[],
): Promise<T> {
  if (choices.length === 0) throw new Error("dungeon popup requires at least one choice");
  let selected = choices[choices.length - 1]!.value;
  let resolveDismissed!: () => void;
  const dismissed = new Promise<void>((resolve) => { resolveDismissed = resolve; });
  await showMonsterHatchPopup(dungeonPopupEnvironment(context), {
    title,
    content,
    buttons: choices.map((choice) => ({
      label: choice.label,
      onPress: () => { selected = choice.value; },
    })),
    onDismiss: resolveDismissed,
  });
  await dismissed;
  return selected;
}
