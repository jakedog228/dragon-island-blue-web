import { Container, type Text } from "pixi.js";
import {
  Scale9,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import { menuButton2HitRect, menuButton2HitTest } from "./menuButton2Math.js";

export interface PreparedMenuButton2 {
  readonly node: Container;
  readonly label: Text;
  /** Native authored label box used only by Box/layout composition; never reconstruct input from it. */
  readonly layoutContentSize: { readonly w: number; readonly h: number };
  /** Full visible and interactive Scale9 chrome in node-local coordinates. */
  readonly visibleRect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Alias of `visibleRect`, exposed for parent-owned input dispatchers. */
  readonly hitRect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/** Single project-wide MenuButton2 policy: label-sized layout, full visible-plate input. */
export async function prepareMenuButton2(opts: {
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly label: Text;
  readonly layoutContentSize?: { readonly w: number; readonly h: number };
  /** Scale9 content dimensions, before its configured additive margins. */
  readonly backgroundContentSize?: { readonly w: number; readonly h: number };
  /** Explicit local chrome origin for column-wide PopupMenu backgrounds. */
  readonly backgroundPosition?: { readonly x: number; readonly y: number };
}): Promise<PreparedMenuButton2> {
  const layoutContentSize = opts.layoutContentSize ?? {
    w: opts.label.width,
    h: opts.label.height,
  };
  const background = await Scale9.fromConfig(
    opts.scale9,
    "MenuButton2",
    opts.assets,
    opts.backgroundContentSize ?? layoutContentSize,
  );
  const backgroundPosition = opts.backgroundPosition ?? {
    x: (layoutContentSize.w - background.contentWidth) / 2,
    y: (layoutContentSize.h - background.contentHeight) / 2,
  };
  background.position.set(backgroundPosition.x, backgroundPosition.y);
  background.eventMode = "none";
  opts.label.eventMode = "none";

  const node = new Container();
  node.addChild(background, opts.label);
  const visibleRect = {
    x: backgroundPosition.x,
    y: backgroundPosition.y,
    w: background.contentWidth,
    h: background.contentHeight,
  };
  node.hitArea = {
    contains: (x, y) => menuButton2HitTest(visibleRect, { x, y }),
  };
  return {
    node,
    label: opts.label,
    layoutContentSize,
    visibleRect,
    hitRect: menuButton2HitRect(visibleRect),
  };
}
