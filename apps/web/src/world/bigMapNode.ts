import { Container, Graphics, Rectangle, Sprite, Texture, type Ticker } from "pixi.js";
import { ButtonSprite, CONTENT_SCALE_FACTOR, pointSprite, type AssetLibrary } from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { screenPointsForMode } from "../displayMode.js";
import { tween } from "../tween.js";
import { worldWalkFrameName } from "./worldDisplayMath.js";
import {
  BIG_MAP_SIZE_PT,
  BIG_MAP_UNVISITED_ALPHA,
  bigMapCellLayout,
  bigMapCurrentWorldLayout,
  bigMapViewportPosition,
} from "./bigMapMath.js";

const MAP_TEXTURE_RECT_PX = { x: 0, y: 0, w: 960, h: 640 };

export interface BigMapNodeOpts {
  assets: AssetLibrary;
  ticker: Ticker;
  currentWorld: string;
  visitedWorlds: ReadonlySet<string>;
  onClick: () => void;
  onClose: () => void;
}

/** `BigMapNode`: shipped map crop, translucent unvisited cells, and current-world hero marker. */
export class BigMapNode extends Container {
  private readonly hiddenWorlds: string[] = [];
  private currentMarkerVisible = false;
  private closeCenter = { x: 0, y: 0 };
  private closing = false;
  private requestCloseAction: (() => void) | undefined;

  private constructor(private readonly currentWorld: string) {
    super();
  }

  static async show(parent: Container, opts: BigMapNodeOpts): Promise<BigMapNode> {
    const [fullMap, heroAtlas, closeTexture] = await Promise.all([
      opts.assets.sprite("bigmap"),
      opts.assets.atlas("HeroWalkFrames-hd"),
      opts.assets.sprite("PopupMenuCloseButton-hd"),
    ]);
    if (fullMap.width < MAP_TEXTURE_RECT_PX.w || fullMap.height < MAP_TEXTURE_RECT_PX.h) {
      throw new Error(
        `bigmap.png is ${fullMap.width}x${fullMap.height}px; source crop requires ` +
          `${MAP_TEXTURE_RECT_PX.w}x${MAP_TEXTURE_RECT_PX.h}px`,
      );
    }
    const node = new BigMapNode(opts.currentWorld);
    node.label = "bigMapNode";
    node.zIndex = 85;
    node.sortableChildren = true;
    const screen = screenPointsForMode(DISPLAY_MODE);
    node.eventMode = "static";
    node.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    for (const event of ["pointerdown", "pointerup", "pointerupoutside", "pointertap", "pointermove"] as const) {
      node.on(event, (e) => e.stopPropagation());
    }
    const shade = new Graphics().rect(0, 0, screen.w, screen.h).fill(0x000000);
    shade.alpha = 0;
    shade.eventMode = "none";
    shade.zIndex = 1;
    node.addChild(shade);
    parent.sortableChildren = true;
    parent.addChild(node);
    await tween(opts.ticker, 500, (t) => { if (!node.destroyed) shade.alpha = t; });
    if (node.destroyed) return node;

    const mapRoot = new Container();
    mapRoot.zIndex = 0;
    const mapPosition = bigMapViewportPosition(DISPLAY_MODE);
    mapRoot.position.set(mapPosition.x, mapPosition.y);
    if (DISPLAY_MODE === "ipad") {
      const borderFill = new Graphics().rect(0, 0, screen.w, screen.h).fill(0x000000);
      borderFill.zIndex = -99;
      node.addChild(borderFill);
    }
    const map = new Sprite(new Texture({
      source: fullMap.source,
      frame: new Rectangle(
        MAP_TEXTURE_RECT_PX.x,
        MAP_TEXTURE_RECT_PX.y,
        MAP_TEXTURE_RECT_PX.w,
        MAP_TEXTURE_RECT_PX.h,
      ),
    }));
    map.width = BIG_MAP_SIZE_PT.w;
    map.height = BIG_MAP_SIZE_PT.h;
    mapRoot.addChild(map);

    for (let column = 1; column <= 4; column += 1) {
      for (let row = 1; row <= 4; row += 1) {
        const world = `World_${column}-${row}`;
        if (opts.visitedWorlds.has(world) || world === opts.currentWorld) continue;
        const cell = bigMapCellLayout(world);
        const mask = new Graphics()
          .rect(cell.mask.x, cell.mask.y, cell.mask.w, cell.mask.h)
          .fill({ color: 0x000000, alpha: BIG_MAP_UNVISITED_ALPHA });
        mapRoot.addChild(mask);
        node.hiddenWorlds.push(world);
      }
    }

    const current = bigMapCurrentWorldLayout(opts.currentWorld);
    if (current !== undefined) {
      const heroTexture = heroAtlas.textures[worldWalkFrameName("front", 1)];
      if (!heroTexture) throw new Error("BigMapNode: HeroWalkFrames-hd missing front idle frame");
      const hero = pointSprite(heroTexture);
      hero.anchor.set(0.5);
      hero.position.set(current.heroCenter.x, current.heroCenter.y);
      mapRoot.addChild(hero);
      node.currentMarkerVisible = true;
    }
    node.addChild(mapRoot);

    const close = new ButtonSprite({ normalTexture: closeTexture, pressSound: opts.onClick });
    close.label = "bigMapClose";
    close.zIndex = 2;
    close.position.set(screen.w - closeTexture.width / CONTENT_SCALE_FACTOR, 0);
    node.closeCenter = {
      x: close.position.x + closeTexture.width / (2 * CONTENT_SCALE_FACTOR),
      y: close.position.y + closeTexture.height / (2 * CONTENT_SCALE_FACTOR),
    };
    node.requestCloseAction = () => { void node.close(shade, opts); };
    close.onPress(node.requestCloseAction);
    node.addChild(close);
    node.addChild(shade);
    await tween(opts.ticker, 500, (t) => { if (!node.destroyed) shade.alpha = 1 - t; });
    return node;
  }

  private async close(shade: Graphics, opts: BigMapNodeOpts): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    // Source starts a 1s FadeIn but invokes fadeOutFinished after a 0.5s delay, interrupting it
    // around half black before content cleanup and the separate 0.5s FadeOut.
    await tween(opts.ticker, 500, (t) => { if (!this.destroyed) shade.alpha = t * 0.5; });
    if (this.destroyed) return;
    for (const child of [...this.children]) {
      if (child !== shade) child.destroy({ children: true });
    }
    this.addChild(shade);
    await tween(opts.ticker, 500, (t) => { if (!this.destroyed) shade.alpha = 0.5 * (1 - t); });
    opts.onClose();
    this.parent?.removeChild(this);
    this.destroy({ children: true });
  }

  /** Web-native equivalent of pressing the source close sprite. */
  requestClose(): void {
    this.requestCloseAction?.();
  }

  get debugState(): Record<string, unknown> {
    return {
      open: !this.destroyed,
      currentWorld: this.currentWorld,
      currentMarkerVisible: this.currentMarkerVisible,
      hiddenWorlds: [...this.hiddenWorlds],
      closeCenter: { ...this.closeCenter },
      closing: this.closing,
    };
  }

  dispose(): void {
    if (this.destroyed) return;
    this.parent?.removeChild(this);
    this.destroy({ children: true });
  }
}
