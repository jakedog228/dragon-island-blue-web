import { Container, type FederatedPointerEvent, type Text } from "pixi.js";
import {
  makeTtfLabel,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import { prepareMenuButton2 } from "./menuButton2.js";
import type {
  PopupMenuButtonLayout,
  PopupMenuGeometry,
  PopupMenuSize,
} from "./popupMenuMath.js";
import {
  popupMenuButtonAt,
  popupMenuHorizontalItemLayout,
  popupMenuLabelOutline,
} from "./popupMenuMath.js";
import type { DisplayMode } from "../displayMode.js";

export interface PopupMenuViewItem<T> {
  readonly value: T;
  readonly label: string;
  readonly enabled: boolean;
}

export interface PopupMenuLabelStyle {
  readonly fontSize: number;
  readonly fill: number;


  readonly outlineWidth: number;
  /** Unused: PopupMenu text is not outlined. Retained so call sites keep compiling. */
  readonly outlineAlpha?: number;
  readonly textureScaleMode?: "nearest" | "linear";
}

export interface BuiltPopupMenuButton<T> {
  readonly item: PopupMenuViewItem<T>;
  readonly node: Container;
  readonly label: Text;
  readonly layout: PopupMenuButtonLayout;
  /** Registers the action with PopupMenu's parent-owned, release-point item dispatcher. */
  readonly onPress?: (handler: (event: FederatedPointerEvent) => void) => void;
}

export interface BuiltPopupMenuView<T> {
  readonly geometry: PopupMenuGeometry;
  readonly titleLabel?: Text;
  readonly buttons: readonly BuiltPopupMenuButton<T>[];
  /** Resolves one source-local release point through the shared menuItems arbitration. */
  readonly invokeAt: (
    point: Readonly<{ x: number; y: number }>,
    event: FederatedPointerEvent,
  ) => boolean;
}

export interface PopupMenuItemAccessory {
  readonly node: Container;
  readonly side: "left" | "right";
  readonly gap: number;
  /** Native icon contentSize. Descendants such as notification digits do not enlarge Box layout. */
  readonly contentSize: PopupMenuSize;
}

/**
 * Shared visual construction for native `PopupMenu.rebuildMenu`.
 *
 * Feature modules still own their source config, geometry validation, modal/dim layer, close
 * control, invocation timing, and action dispatch. This builder only performs the repeated native
 * work: measure unoutlined label boxes, render their configured outline, place title/labels using
 * the supplied PopupMenu geometry, and attach per-column `MenuButton2` plates.
 */
export async function buildPopupMenuView<T>(options: {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly columns: readonly (readonly PopupMenuViewItem<T>[])[];
  readonly title?: { readonly value: string; readonly style: PopupMenuLabelStyle };
  readonly itemStyle: (item: PopupMenuViewItem<T>) => PopupMenuLabelStyle;
  readonly itemAccessory?: (item: PopupMenuViewItem<T>) => PopupMenuItemAccessory | undefined;
  /** Required when `itemAccessory` is supplied so Box rounding occurs in native device points. */
  readonly displayMode?: DisplayMode;
  readonly backgroundMarginX: number;
  readonly backgroundMarginY: number;
  readonly geometry: (
    titleSize: PopupMenuSize | null,
    columnItemSizes: readonly (readonly PopupMenuSize[])[],
  ) => PopupMenuGeometry;
  /** Collection roots may be authored with no rows; every other menu keeps non-empty validation. */
  readonly allowEmptyColumns?: boolean;
  /**
   * Defaults on for ordinary/nonmodal callers. A modal PopupMenu can disable this and route its
   * popup-root pointer sequence into `invokeAt`, matching `ccTouchBegan:`'s full-screen ownership.
   */
  readonly installParentInput?: boolean;
  readonly buttonLabel?: (item: PopupMenuViewItem<T>) => string;
}): Promise<BuiltPopupMenuView<T>> {
  if (
    options.columns.length === 0 ||
    (options.columns.some((column) => column.length === 0) && options.allowEmptyColumns !== true)
  ) {
    throw new Error("PopupMenu view requires one or more non-empty columns");
  }

  const titleEntry = options.title === undefined
    ? undefined
    : createMeasuredLabel(options.title.value, options.title.style);
  const columns = options.columns.map((column) => column.map((item) => {
    const labelEntry = createMeasuredLabel(item.label, options.itemStyle(item));
    const accessory = options.itemAccessory?.(item);
    if (accessory === undefined) {
      return {
        item,
        label: labelEntry.label,
        labelMeasured: labelEntry.measured,
        accessory: undefined,
        itemLayout: undefined,
        measured: labelEntry.measured,
      };
    }
    if (options.displayMode === undefined) {
      throw new Error("PopupMenu item accessories require a displayMode");
    }
    const itemLayout = popupMenuHorizontalItemLayout(
      labelEntry.measured,
      accessory.contentSize,
      accessory.side,
      accessory.gap,
      options.displayMode,
    );
    return {
      item,
      label: labelEntry.label,
      labelMeasured: labelEntry.measured,
      accessory,
      itemLayout,
      measured: itemLayout.content,
    };
  }));
  const geometry = options.geometry(
    titleEntry?.measured ?? null,
    columns.map((column) => column.map((entry) => entry.measured)),
  );
  if (
    geometry.buttons.length !== columns.length ||
    geometry.buttons.some((column, index) => column.length !== columns[index]!.length)
  ) {
    throw new Error("PopupMenu geometry button shape does not match its item columns");
  }

  if (titleEntry !== undefined) {
    if (geometry.title === null) throw new Error("PopupMenu title geometry is missing");
    titleEntry.label.position.set(
      geometry.title.x + geometry.title.w / 2,
      geometry.title.y + geometry.title.h / 2,
    );
    options.parent.addChild(titleEntry.label);
  } else if (geometry.title !== null) {
    throw new Error("PopupMenu geometry unexpectedly contains a title");
  }

  const buttons: BuiltPopupMenuButton<T>[] = [];
  const handlers = new Map<Container, (event: FederatedPointerEvent) => void>();
  for (const [columnIndex, column] of columns.entries()) {
    for (const [row, entry] of column.entries()) {
      const layout = geometry.buttons[columnIndex]?.[row];
      if (layout === undefined) {
        throw new Error(`PopupMenu geometry is missing button ${columnIndex}:${row}`);
      }
      const labelPosition = entry.itemLayout?.label ?? { x: 0, y: 0 };
      entry.label.position.set(
        labelPosition.x + entry.labelMeasured.w / 2,
        labelPosition.y + entry.labelMeasured.h / 2,
      );
      const backgroundContentSize = {
        w: layout.background.w - 2 * options.backgroundMarginX,
        h: layout.background.h - 2 * options.backgroundMarginY,
      };
      if (backgroundContentSize.w < 0 || backgroundContentSize.h < 0) {
        throw new Error(`PopupMenu button ${columnIndex}:${row} has negative background content`);
      }
      const prepared = await prepareMenuButton2({
        assets: options.assets,
        scale9: options.scale9,
        label: entry.label,
        layoutContentSize: { w: layout.label.w, h: layout.label.h },
        backgroundContentSize,
        backgroundPosition: {
          x: layout.background.x - layout.label.x,
          y: layout.background.y - layout.label.y,
        },
      });
      const node = prepared.node;
      node.eventMode = "none";
      node.cursor = entry.item.enabled ? "pointer" : "default";
      if (entry.accessory !== undefined && entry.itemLayout !== undefined) {
        const bounds = entry.accessory.node.getLocalBounds();
        entry.accessory.node.position.set(
          entry.itemLayout.accessory.x - bounds.x,
          entry.itemLayout.accessory.y - bounds.y,
        );
        entry.accessory.node.eventMode = "none";
        node.addChild(entry.accessory.node);
      }
      node.position.set(layout.label.x, layout.label.y);
      if (options.buttonLabel !== undefined) node.label = options.buttonLabel(entry.item);
      options.parent.addChild(node);
      buttons.push({
        item: entry.item,
        node,
        label: entry.label,
        layout,
        onPress: (handler) => handlers.set(node, handler),
      });
    }
  }

  const invokeAt = (
    point: Readonly<{ x: number; y: number }>,
    event: FederatedPointerEvent,
  ): boolean => {
    const button = popupMenuButtonAt(
      buttons.map((candidate) => ({
        value: candidate,
        layout: candidate.layout,
        enabled: candidate.item.enabled,
      })),
      point,
    );
    if (button === undefined) return false;
    event.stopPropagation();
    handlers.get(button.node)?.(event);
    return true;
  };




  if (options.installParentInput !== false) {
    // The parent must still be an explicit event boundary. `Container` defaults to passive input;
    // with every row set to `eventMode = "none"`, a nested PopupMenu content container otherwise
    // never enters Pixi's hit path and none of its source-owned menu items can be selected. Preserve
    // a caller's wider modal hitArea (WorldMenu/SourcePopupMenu use the full screen); only install
    // the exact union of observed full-plate row targets when the caller has not already claimed one.
    options.parent.eventMode = "static";
    if (options.parent.hitArea === null || options.parent.hitArea === undefined) {
      options.parent.hitArea = {
        contains: (x, y) => popupMenuButtonAt(
          buttons.map((candidate) => ({
            value: candidate,
            layout: candidate.layout,
            enabled: candidate.item.enabled,
          })),
          { x, y },
        ) !== undefined,
      };
    }
    options.parent.on("pointertap", (event: FederatedPointerEvent) => {
      invokeAt(event.getLocalPosition(options.parent), event);
    });
  }

  return {
    geometry,
    ...(titleEntry === undefined ? {} : { titleLabel: titleEntry.label }),
    buttons: Object.freeze(buttons),
    invokeAt,
  };
}

function createMeasuredLabel(
  value: string,
  style: PopupMenuLabelStyle,
): { readonly label: Text; readonly measured: PopupMenuSize } {
  const measurement = makeTtfLabel(value, style.fontSize, {
    fill: style.fill,
    outline: false,
  });
  const measured = { w: measurement.width, h: measurement.height };
  measurement.destroy();


  const outline = popupMenuLabelOutline(style.outlineWidth);
  const label = makeTtfLabel(value, style.fontSize, {
    fill: style.fill,
    outline: outline.outline,
    ...(style.textureScaleMode === undefined
      ? {}
      : { textureScaleMode: style.textureScaleMode }),
  });
  label.anchor.set(0.5);
  label.eventMode = "none";
  return { label, measured };
}
