import type { DisplayMode } from "../displayMode.js";
import { roundSourcePoint } from "../displayMode.js";
import { nearestMenuButton2Hit } from "./menuButton2Math.js";

export interface PopupMenuSize {
  w: number;
  h: number;
}

export interface PopupMenuMetrics {
  itemGap: number;
  columnGap: number;
  titleGap: number;
  backgroundMarginX: number;
  backgroundMarginY: number;
}

export interface PopupMenuButtonLayout {
  column: number;
  row: number;
  label: { x: number; y: number; w: number; h: number };
  background: { x: number; y: number; w: number; h: number };
}

export interface PopupMenuGeometry {
  title: { x: number; y: number; w: number; h: number } | null;
  content: { x: number; y: number; w: number; h: number };
  buttons: PopupMenuButtonLayout[][];
}

export interface PopupMenuHorizontalItemLayout {
  content: PopupMenuSize;
  label: { x: number; y: number };
  accessory: { x: number; y: number };
}






export function popupMenuHorizontalItemLayout(
  label: PopupMenuSize,
  accessory: PopupMenuSize,
  side: "left" | "right",
  gap: number,
  mode: DisplayMode,
): PopupMenuHorizontalItemLayout {
  const r = (value: number): number => roundSourcePoint(value, mode);
  const content = {
    w: r(label.w + gap + accessory.w),
    h: r(Math.max(label.h, accessory.h)),
  };
  const labelY = r((content.h - label.h) / 2);
  const accessoryY = r((content.h - accessory.h) / 2);
  if (side === "left") {
    return {
      content,
      label: { x: r(accessory.w + gap), y: labelY },
      accessory: { x: 0, y: accessoryY },
    };
  }
  return {
    content,
    label: { x: 0, y: labelY },
    accessory: { x: r(label.w + gap), y: accessoryY },
  };
}











export function popupMenuButtonAt<T>(
  candidates: readonly {
    readonly value: T;
    readonly layout: PopupMenuButtonLayout;
    readonly enabled: boolean;
  }[],
  point: Readonly<{ x: number; y: number }>,
): T | undefined {
  return nearestMenuButton2Hit(
    candidates
      .filter((candidate) => candidate.enabled)
      .map((candidate) => ({ value: candidate.value, visibleRect: candidate.layout.background })),
    point,
  );
}


export function popupMenuColumns<T>(items: readonly T[], count: number): T[][] {
  if (!Number.isInteger(count) || count <= 0) throw new Error(`PopupMenu column count must be positive, got ${count}`);
  const columns = Array.from({ length: count }, () => [] as T[]);
  items.forEach((item, index) => columns[index % count]!.push(item));
  return columns;
}


export function popupMenuGeometry(
  screen: PopupMenuSize,
  titleSize: PopupMenuSize | null,
  columnItemSizes: readonly (readonly PopupMenuSize[])[],
  metrics: PopupMenuMetrics,
  mode: DisplayMode,
  allowEmptyColumns = false,
): PopupMenuGeometry {
  if (columnItemSizes.length === 0) throw new Error("PopupMenu requires at least one column");
  const r = (value: number): number => roundSourcePoint(value, mode);
  const columns = columnItemSizes.map((items, column) => {
    if (items.length === 0 && !allowEmptyColumns) {
      throw new Error(`PopupMenu column ${column} is empty`);
    }
    const backgroundContentW = items.length === 0 ? 0 : Math.max(...items.map((item) => item.w));
    const backgroundContentH = items.length === 0 ? 0 : Math.max(...items.map((item) => item.h));
    const w = r(backgroundContentW);
    let runningY = 0;
    const rows = items.map((item, row) => {
      const x = r((w - item.w) / 2);
      const y = r(runningY);
      runningY += item.h;
      if (row !== items.length - 1) runningY += metrics.itemGap;
      return { item, x, y };
    });
    return { w, h: r(runningY), backgroundContentW, backgroundContentH, rows };
  });
  let runningX = 0;
  const columnXs = columns.map((column, index) => {
    const x = r(runningX);
    runningX += column.w;
    if (index !== columns.length - 1) runningX += metrics.columnGap;
    return x;
  });
  const columnsW = r(runningX);
  const columnsH = r(Math.max(...columns.map((column) => column.h)));
  const columnYs = columns.map((column) => r((columnsH - column.h) / 2));
  const titleW = titleSize?.w ?? 0;
  const titleH = titleSize?.h ?? 0;
  const titleSlotH = titleSize ? titleH + metrics.titleGap : 0;
  const contentW = r(Math.max(titleW, columnsW));
  const contentH = r(titleSlotH + columnsH);
  const contentX = screen.w / 2 - contentW / 2;
  const contentY = screen.h / 2 - contentH / 2;
  const columnsX = contentX + r((contentW - columnsW) / 2);
  const columnsY = contentY + r(titleSlotH);
  const buttons = columns.map((column, columnIndex) => column.rows.map(({ item, x, y }, row) => {
    const labelX = columnsX + columnXs[columnIndex]! + x;
    const labelY = columnsY + columnYs[columnIndex]! + y;
    const backgroundW = column.backgroundContentW + 2 * metrics.backgroundMarginX;
    const backgroundH = column.backgroundContentH + 2 * metrics.backgroundMarginY;
    return {
      column: columnIndex,
      row,
      label: { x: labelX, y: labelY, w: item.w, h: item.h },
      background: {
        x: labelX + item.w / 2 - backgroundW / 2,
        y: labelY + item.h / 2 - backgroundH / 2,
        w: backgroundW,
        h: backgroundH,
      },
    };
  }));
  return {
    title: titleSize ? {
      x: contentX + r((contentW - titleSize.w) / 2),
      y: contentY,
      w: titleSize.w,
      h: titleSize.h,
    } : null,
    content: { x: contentX, y: contentY, w: contentW, h: contentH },
    buttons,
  };
}


































export const POPUP_MENU_OUTLINE_BORDER_PT = 2;
export const POPUP_MENU_OUTLINE_OPACITY = 128;

export function popupMenuLabelOutline(_outlineWidth: number): { readonly outline: false } {
  return { outline: false };
}
