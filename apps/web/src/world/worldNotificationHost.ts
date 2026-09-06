import {
  Container,
  FillGradient,
  Graphics,
  Rectangle,
  Texture,
  type FederatedPointerEvent,
  type Ticker,
} from "pixi.js";
import {
  CONTENT_SCALE_FACTOR,
  makeTtfLabel,
  pointSprite,
} from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import {
  WORLD_NAME_PLATE_FADE_IN_MS,
  WORLD_NAME_PLATE_FADE_OUT_MS,
  WORLD_NAME_PLATE_HOLD_MS,
  WORLD_NAME_PLATE_SCALE,
  type NamePlatePlacement,
  namePlateLayout,
  worldNamePlateAlpha,
} from "./worldChromeMath.js";
import {
  TOWN_DAY_BANNER_COLOR,
  TOWN_DAY_BANNER_HOLD_MS,
  TOWN_DAY_BANNER_LIFETIME_MS,
  TOWN_DAY_BANNER_SLIDE_MS,
  TOWN_DAY_BANNER_TOP_COLOR,
  townDayBannerLayout,
  townDayBannerTouchActive,
  townDayBannerY,
} from "./townNotificationMath.js";
import { DayNotificationQueue } from "./dayNotificationQueue.js";
import type { GuildQuestNotificationState } from "./guildQuestNotifications.js";
import { PopupHost } from "../ui/popup.js";
import { elapsedCovers } from "../tween.js";
import { WORLD_NOTIFICATION_Z_INDEX } from "./worldDisplayMath.js";

export interface TownDayNotificationState {
  readonly kind?: "town-day";
  readonly day: number;
  readonly title: string;
  readonly message: string;
  readonly image: "sunrise.png";
  visible: boolean;
}







export interface LocalizedMessageNotificationState {
  readonly kind: "localized-message";
  readonly title: string;
  readonly message: string;
  readonly image: "Icon@2x.png";
  visible: boolean;
}

type BannerNotificationState =
  | TownDayNotificationState
  | GuildQuestNotificationState
  | LocalizedMessageNotificationState;

/** The app-icon banners (quest and localized-message) against the sunrise day banner. */
function usesNotificationIcon(notification: BannerNotificationState): boolean {
  return notification.image === "Icon@2x.png";
}

interface DayDismiss {
  elapsedMs: number;
  readonly startY: number;
}

/** Automatic popup layers are later than the default-z plaque but below CCNotifications z=999. */
export const DIRECTOR_AUTOMATIC_POPUP_Z_INDEX = 1;








export class WorldNotificationHost extends Container {
  private static readonly byStageRoot = new WeakMap<Container, WorldNotificationHost>();

  private readonly namePlateRoot = new Container();
  private readonly automaticPopupRoot = new Container();
  private readonly namePlateLabel;
  private readonly namePlateUnscaledSize: { readonly w: number; readonly h: number };
  private readonly dayRoot = new Container();
  private sunriseTexture: Texture;
  private notificationIconTexture: Texture;
  private namePlateElapsedMs: number | undefined;
  private namePlateText = "";
  private namePlatePlacement: NamePlatePlacement = "lower-right";
  private readonly dayQueue = new DayNotificationQueue<BannerNotificationState>();
  private dayElapsedMs: number | undefined;
  private dayDismiss: DayDismiss | undefined;

  private constructor(
    private readonly ticker: Ticker,
    namePlateTexture: Texture,
    sunriseTexture: Texture,
    notificationIconTexture: Texture,
  ) {
    super();
    this.label = "worldNotificationHost";
    this.zIndex = WORLD_NOTIFICATION_Z_INDEX;
    this.scale.set(CONTENT_SCALE_FACTOR);
    this.eventMode = "passive";
    this.sortableChildren = true;
    this.sunriseTexture = sunriseTexture;
    this.notificationIconTexture = notificationIconTexture;

    const plate = pointSprite(namePlateTexture);
    this.namePlateUnscaledSize = { w: plate.width, h: plate.height };
    const layout = namePlateLayout(
      DISPLAY_MODE,
      { w: plate.width, h: plate.height },
      "lower-right",
    );
    plate.scale.set(
      plate.scale.x * WORLD_NAME_PLATE_SCALE,
      plate.scale.y * WORLD_NAME_PLATE_SCALE,
    );
    this.namePlateLabel = makeTtfLabel("", layout.fontSize, {
      fill: 0x000000,
      outline: false,
    });
    this.namePlateLabel.anchor.set(0.5);
    this.namePlateLabel.position.set(layout.size.w / 2, layout.size.h / 2);
    this.namePlateRoot.position.set(layout.position.x, layout.position.y);
    this.namePlateRoot.visible = false;
    this.namePlateRoot.eventMode = "none";
    this.namePlateRoot.label = "worldNamePlate";
    this.namePlateRoot.addChild(plate, this.namePlateLabel);
    this.addChild(this.namePlateRoot);

    this.automaticPopupRoot.label = "directorAutomaticPopupLayer";
    this.automaticPopupRoot.zIndex = DIRECTOR_AUTOMATIC_POPUP_Z_INDEX;
    this.automaticPopupRoot.eventMode = "passive";
    this.automaticPopupRoot.sortableChildren = true;
    this.addChild(this.automaticPopupRoot);

    this.dayRoot.label = "townDayNotification";
    this.dayRoot.zIndex = 999;
    this.dayRoot.visible = false;
    this.dayRoot.eventMode = "none";
    this.dayRoot.cursor = "default";
    const swallowAndDismiss = (event: FederatedPointerEvent): void => {
      event.stopPropagation();
      this.beginDayDismiss();
    };
    this.dayRoot.on("pointerdown", swallowAndDismiss);
    this.dayRoot.on("pointerup", (event: FederatedPointerEvent) => event.stopPropagation());
    this.dayRoot.on("pointertap", (event: FederatedPointerEvent) => event.stopPropagation());
    this.addChild(this.dayRoot);

    ticker.add(this.updateFn);
  }

  static for(
    stageRoot: Container,
    ticker: Ticker,
    textures: {
      readonly namePlate: Texture;
      readonly sunrise: Texture;
      readonly notificationIcon: Texture;
    },
  ): WorldNotificationHost {
    const existing = this.byStageRoot.get(stageRoot);
    if (existing !== undefined && !existing.destroyed && existing.parent === stageRoot) {
      if (textures.sunrise !== Texture.EMPTY) existing.sunriseTexture = textures.sunrise;
      if (textures.notificationIcon !== Texture.EMPTY) {
        existing.notificationIconTexture = textures.notificationIcon;
      }
      return existing;
    }
    const host = new WorldNotificationHost(
      ticker,
      textures.namePlate,
      textures.sunrise,
      textures.notificationIcon,
    );
    stageRoot.sortableChildren = true;
    stageRoot.addChild(host);
    PopupHost.registerAutomaticPresentationRoot(host, host.automaticPopupRoot);
    this.byStageRoot.set(stageRoot, host);
    return host;
  }

  /**
   * Routes a scene subtree only when the app already owns a director notification node.
   * Standalone battle fixtures intentionally keep their existing scene-local popup host.
   */
  static registerAutomaticPresentationRootFor(
    stageRoot: Container,
    contentRoot: Container,
  ): boolean {
    const host = this.byStageRoot.get(stageRoot);
    if (host === undefined || host.destroyed || host.parent !== stageRoot) return false;
    host.registerAutomaticPresentationRoot(contentRoot);
    return true;
  }


  registerAutomaticPresentationRoot(contentRoot: Container): void {
    PopupHost.registerAutomaticPresentationRoot(contentRoot, this.automaticPopupRoot);
  }

  showNamePlate(
    text: string,
    label: string,
    placement: NamePlatePlacement = "lower-right",
  ): void {
    const layout = namePlateLayout(DISPLAY_MODE, this.namePlateUnscaledSize, placement);
    this.namePlateText = text;
    this.namePlateLabel.text = text;
    this.namePlateLabel.position.set(layout.size.w / 2, layout.size.h / 2);
    this.namePlateRoot.position.set(layout.position.x, layout.position.y);
    this.namePlateRoot.label = label;
    this.namePlatePlacement = placement;
    this.namePlateElapsedMs = 0;
    this.namePlateRoot.alpha = 0;
    this.namePlateRoot.visible = true;
  }

  enqueueDay(notification: TownDayNotificationState): void {
    const active = this.dayQueue.enqueue(notification);
    if (active !== undefined) this.presentDay(active);
  }

  enqueueQuest(notification: GuildQuestNotificationState): void {
    if (this.notificationIconTexture === Texture.EMPTY) {
      throw new Error("Guild quest notification requires the app Icon@2x.png texture");
    }
    const active = this.dayQueue.enqueue(notification);
    if (active !== undefined) this.presentDay(active);
  }

  enqueueLocalizedMessage(notification: LocalizedMessageNotificationState): void {
    if (this.notificationIconTexture === Texture.EMPTY) {
      throw new Error("Localized-message notification requires the app Icon@2x.png texture");
    }
    const active = this.dayQueue.enqueue(notification);
    if (active !== undefined) this.presentDay(active);
  }

  get debugState(): {
    readonly global: boolean;
    readonly namePlate: {
      readonly text: string;
      readonly label: string;
      readonly visible: boolean;
      readonly alpha: number;
      readonly plateScale: number;
      readonly placement: NamePlatePlacement;
      readonly position: { readonly x: number; readonly y: number };
    };
    readonly dayNotification: TownDayNotificationState | undefined;
    readonly questNotification: GuildQuestNotificationState | undefined;
    readonly localizedMessageNotification: LocalizedMessageNotificationState | undefined;
    readonly queuedDayCount: number;
    readonly queuedNotificationCount: number;
  } {
    return {
      global: this.parent !== null,
      namePlate: {
        text: this.namePlateText,
        label: this.namePlateRoot.label,
        visible: this.namePlateRoot.visible,
        alpha: this.namePlateRoot.alpha,
        plateScale: WORLD_NAME_PLATE_SCALE,
        placement: this.namePlatePlacement,
        position: {
          x: this.namePlateRoot.position.x,
          y: this.namePlateRoot.position.y,
        },
      },
      dayNotification: this.dayQueue.current !== undefined &&
          !usesNotificationIcon(this.dayQueue.current)
        ? { ...(this.dayQueue.current as TownDayNotificationState) }
        : undefined,
      questNotification: this.dayQueue.current !== undefined &&
          "questName" in this.dayQueue.current
        ? { ...this.dayQueue.current }
        : undefined,
      localizedMessageNotification: this.dayQueue.current !== undefined &&
          this.dayQueue.current.kind === "localized-message"
        ? { ...this.dayQueue.current }
        : undefined,
      queuedDayCount: this.dayQueue.queuedCount,
      queuedNotificationCount: this.dayQueue.queuedCount,
    };
  }

  private presentDay(notification: BannerNotificationState): void {
    this.dayRoot.removeChildren().forEach((child) => child.destroy({ children: true }));
    const layout = townDayBannerLayout(DISPLAY_MODE);
    // `textureSpace: "local"` (Pixi's default) measures `start`/`end` in the shape's own bounds
    // normalized to 0..1, NOT in pixels: the height-valued end point this used to pass squeezed the
    // whole ramp into the top 1/height of the banner, leaving it a flat `TOP_COLOR` slab.
    const gradient = new FillGradient({
      type: "linear",
      textureSpace: "local",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: TOWN_DAY_BANNER_TOP_COLOR },
        { offset: 1, color: TOWN_DAY_BANNER_COLOR },
      ],
    });
    const background = new Graphics()
      .rect(0, 0, layout.width, layout.height)
      .fill(gradient);
    background.eventMode = "none";
    const usesIcon = usesNotificationIcon(notification);
    this.dayRoot.label = "questName" in notification
      ? "guildQuestNotification"
      : usesIcon
        ? "localizedMessageNotification"
        : "townDayNotification";
    const image = pointSprite(usesIcon ? this.notificationIconTexture : this.sunriseTexture);
    image.eventMode = "none";
    image.anchor.set(0.5);
    const imageScale = layout.imageSlot / Math.max(image.width, image.height);
    image.scale.set(image.scale.x * imageScale, image.scale.y * imageScale);
    image.position.set(layout.imageCenter.x, layout.imageCenter.y);

    const title = makeTtfLabel(notification.title, layout.titleFontSize, {
      outline: false,
      bold: false,
    });
    title.eventMode = "none";
    title.anchor.set(0, 0);
    title.position.set(layout.textX, layout.titleY);
    const message = makeTtfLabel(notification.message, layout.messageFontSize, {
      outline: false,
      bold: false,
    });
    message.eventMode = "none";
    message.anchor.set(0, 1);
    message.position.set(layout.textX, layout.messageY);

    this.dayRoot.addChild(background, image, title, message);
    this.dayRoot.hitArea = new Rectangle(0, 0, layout.width, layout.height);
    this.dayRoot.position.set(0, townDayBannerY(0, DISPLAY_MODE));
    this.dayRoot.visible = true;
    this.dayRoot.eventMode = "none";
    notification.visible = true;
    this.dayElapsedMs = 0;
    this.dayDismiss = undefined;
  }

  private beginDayDismiss(): void {
    if (this.dayElapsedMs === undefined || this.dayDismiss !== undefined) return;
    // `ccTouchBegan:` invokes the same hide scheduler as the two-second hold. A Cocos MoveTo
    // samples the node's current position, so an early touch slides out from wherever the banner
    // has reached instead of snapping to the fully-shown endpoint.
    this.dayRoot.eventMode = "none";
    this.dayDismiss = { elapsedMs: 0, startY: this.dayRoot.position.y };
  }

  private finishDay(): void {
    this.dayRoot.visible = false;
    this.dayRoot.eventMode = "none";
    this.dayElapsedMs = undefined;
    this.dayDismiss = undefined;
    const next = this.dayQueue.finishCurrent();
    if (next) this.presentDay(next);
  }

  private readonly updateFn = (): void => {
    const deltaMs = this.ticker.deltaMS;
    if (this.namePlateElapsedMs !== undefined) {
      this.namePlateElapsedMs += deltaMs;
      this.namePlateRoot.alpha = worldNamePlateAlpha(this.namePlateElapsedMs);
      const lifetime =
        WORLD_NAME_PLATE_FADE_IN_MS + WORLD_NAME_PLATE_HOLD_MS + WORLD_NAME_PLATE_FADE_OUT_MS;
      if (elapsedCovers(this.namePlateElapsedMs, lifetime)) {
        this.namePlateRoot.visible = false;
        this.namePlateElapsedMs = undefined;
      }
    }

    if (this.dayElapsedMs === undefined) return;
    this.dayElapsedMs += deltaMs;
    if (this.dayDismiss !== undefined) {
      this.dayDismiss.elapsedMs += deltaMs;
      const t = elapsedCovers(this.dayDismiss.elapsedMs, TOWN_DAY_BANNER_SLIDE_MS)
        ? 1
        : this.dayDismiss.elapsedMs / TOWN_DAY_BANNER_SLIDE_MS;
      const hiddenY = townDayBannerY(TOWN_DAY_BANNER_LIFETIME_MS, DISPLAY_MODE);
      this.dayRoot.position.y =
        this.dayDismiss.startY + (hiddenY - this.dayDismiss.startY) * t;
      if (t >= 1) this.finishDay();
      return;
    }

    this.dayRoot.position.y = townDayBannerY(this.dayElapsedMs, DISPLAY_MODE);
    this.dayRoot.eventMode = townDayBannerTouchActive(this.dayElapsedMs)
      ? "static"
      : "none";
    if (elapsedCovers(this.dayElapsedMs, TOWN_DAY_BANNER_SLIDE_MS + TOWN_DAY_BANNER_HOLD_MS)) {
      this.beginDayDismiss();
    }
  };
}
