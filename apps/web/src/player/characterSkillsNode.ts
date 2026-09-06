import {
  Box,
  makeTtfLabel,
  nearestMinimumHit,
  OUTLINE_FADE_ALPHA,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { PlayerProfile, PlayerStatName } from "@dib/player-domain";
import {
  Container,
  Graphics,
  Rectangle,
  type FederatedPointerEvent,
  type Spritesheet,
  type Ticker,
} from "pixi.js";
import { idiomPairPt, unscaledIdiomPt } from "../displayMode.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { screenPointsForMode } from "../displayMode.js";
import { PopupHost } from "../ui/popup.js";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
import {
  heroXpPercent,
  worldHeroXpBarPosition,
  worldHeroXpFontSize,
  worldHeroXpLabelGap,
} from "../world/worldChromeMath.js";
import {
  buildMonsterHatchMessageBlock,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  CHARACTER_STAT_ORDER,
  characterSkillBonus,
} from "./characterProgressionModel.js";
import { characterSkillsLayout } from "./playerScreenLayoutMath.js";

interface SkillControl {
  readonly node: Container;
  readonly action: () => void;
  readonly contentRect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export interface CharacterSkillsNodeOptions {
  readonly parent: Container;
  readonly owner: object;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly profile: PlayerProfile;
  readonly onClick: () => void;
  readonly onBlocked: () => void;
  readonly onClose: () => void;
  readonly mutate?: (
    action: "increment" | "decrement",
    stat: PlayerStatName,
  ) => void | Promise<void>;
}

/** Source `CharacterSkillsNode`: a full-screen HeroScreen overlay with release-point arbitration. */
export class CharacterSkillsNode extends Container {
  private readonly controls: SkillControl[] = [];
  private armed = false;
  private closed = false;
  private changeMade = false;

  private constructor(private readonly opts: CharacterSkillsNodeOptions) {
    super();
  }

  static async show(opts: CharacterSkillsNodeOptions): Promise<CharacterSkillsNode> {
    const node = new CharacterSkillsNode(opts);
    node.label = "characterSkills";
    node.zIndex = 1000;
    node.eventMode = "static";
    const screen = screenPointsForMode(DISPLAY_MODE);
    node.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    await node.rebuild();
    node.on("pointerdown", (event) => node.pointerBegan(event));
    node.on("pointerup", (event) => { void node.pointerEnded(event); });
    node.on("pointerupoutside", (event) => { void node.pointerEnded(event); });
    const parent = PopupHost.presentationParentFor(opts.parent);
    parent.sortableChildren = true;
    parent.addChild(node);
    return node;
  }

  requestClose(): void {
    this.finish();
  }

  get debugState(): Record<string, unknown> {
    return {
      open: !this.closed,
      pointsFree: this.opts.profile.skillPointsAvailable,
      changeMade: this.changeMade,
      stats: CHARACTER_STAT_ORDER.map((stat) => ({
        stat,
        invested: this.opts.profile.skillValue(stat),
        bonus: Math.round(this.opts.profile.playerStatBonus(stat)),
      })),
    };
  }

  private async rebuild(): Promise<void> {
    this.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.controls.length = 0;
    const screen = screenPointsForMode(DISPLAY_MODE);
    const layout = characterSkillsLayout(DISPLAY_MODE);
    const [backgroundTexture, closeTexture, plusTexture, minusTexture, general] = await Promise.all([
      this.opts.assets.sprite("HeroScreen"),
      this.opts.assets.sprite("PopupMenuCloseButton-hd"),
      this.opts.assets.sprite("plus-hd"),
      this.opts.assets.sprite("minus-hd"),
      this.opts.assets.atlas("General-hd"),
    ]);

    const background = sourceFullscreenSprite(backgroundTexture, DISPLAY_MODE, "HeroScreen");
    background.eventMode = "none";
    this.addChild(background);

    const close = pointSprite(closeTexture);
    close.anchor.set(1, 0);
    close.position.set(screen.w - unscaledIdiomPt(10, DISPLAY_MODE), unscaledIdiomPt(10, DISPLAY_MODE));
    this.addControl(close, () => this.finish(), "characterSkills:close");
    this.addChild(close);





    const free = makeTtfLabel(
      `${localizedString(this.opts.strings, "SkillPointsFreeKey")}: ${this.opts.profile.skillPointsAvailable}`,
      idiomPairPt(16, 30, DISPLAY_MODE),
      { outline: true, outlineAlpha: OUTLINE_FADE_ALPHA },
    );
    free.anchor.set(0, 0);
    free.position.set(
      unscaledIdiomPt(10, DISPLAY_MODE),
      unscaledIdiomPt(10, DISPLAY_MODE),
    );
    this.addControl(free, () => { void this.showNamedMessage("PointsDescription"); }, "characterSkills:pointsFree");
    this.addChild(free);

    for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
      const row = new Box({
        horizontal: true,
        gap: layout.rowGap,
        positiveAlignDirection: true,
      });
      for (const stat of CHARACTER_STAT_ORDER.slice(rowIndex * 3, rowIndex * 3 + 3)) {
        const cell = this.buildStatCell(general, plusTexture, minusTexture, stat);
        row.addBoxChild(cell, { contentSize: cell.boxContentSize });
      }
      const rowX = layout.rowX;
      const cocosY = layout.rowCocosY[rowIndex]!;



      row.position.set(rowX, screen.h - cocosY - row.boxContentSize.h / 2);
      this.addChild(row);
    }

    this.addChild(this.buildHeroXp(general, screen.w));
  }

  private buildHeroXp(general: Spritesheet, screenWidth: number): Container {
    const frameTexture = general.textures["heroXpFrame.png"];
    const barTexture = general.textures["heroXpBar.png"];
    if (frameTexture === undefined || barTexture === undefined) {
      throw new Error("CharacterSkillsNode: General-hd is missing HeroXpNode frames");
    }
    const root = new Container();
    root.label = "characterSkills:heroXp";
    const frame = pointSprite(frameTexture);
    root.position.set(
      (screenWidth - frame.width) / 2,
      unscaledIdiomPt(10, DISPLAY_MODE),
    );
    root.addChild(frame);

    const barPosition = worldHeroXpBarPosition(DISPLAY_MODE);
    const centerY = frame.height - barPosition.y;
    const back = pointSprite(barTexture);
    back.anchor.set(0, 0.5);
    back.position.set(barPosition.x, centerY);
    const fill = pointSprite(barTexture);
    fill.anchor.set(0, 0.5);
    fill.position.copyFrom(back.position);
    fill.tint = 0xff8080;
    const mask = new Graphics();
    const percent = heroXpPercent(
      this.opts.profile.heroLevel,
      this.opts.profile.heroTotalHighestLevels,
    );
    mask.rect(
      barPosition.x,
      centerY - fill.height / 2,
      fill.width * percent,
      fill.height,
    ).fill(0xffffff);
    fill.mask = mask;
    root.addChild(back, fill, mask);

    const level = makeTtfLabel(
      `${localizedString(this.opts.strings, "LevelShortKey")} ${this.opts.profile.heroLevel}`,
      worldHeroXpFontSize(DISPLAY_MODE),
      { outlineAlpha: OUTLINE_FADE_ALPHA },
    );
    level.anchor.set(0, 0.5);
    level.position.set(
      barPosition.x + back.width + worldHeroXpLabelGap(DISPLAY_MODE),
      centerY,
    );
    root.addChild(level);
    return root;
  }

  private buildStatCell(
    general: Spritesheet,
    plusTexture: Parameters<typeof pointSprite>[0],
    minusTexture: Parameters<typeof pointSprite>[0],
    stat: PlayerStatName,
  ): Box {
    const valueFont = idiomPairPt(18, 36, DISPLAY_MODE);
    const layout = characterSkillsLayout(DISPLAY_MODE);
    const smallGap = layout.cellGap;
    const cell = new Box({ gap: smallGap, positiveAlignDirection: true });
    cell.label = `characterSkills:${stat}`;

    const iconTexture = general.textures[`Stat${stat}.png`];
    if (iconTexture === undefined) throw new Error(`CharacterSkillsNode: missing Stat${stat}.png`);
    const icon = pointSprite(iconTexture);
    icon.anchor.set(0.5);
    this.addControl(icon, () => { void this.showNamedMessage(`Stat${stat}Info`); }, `characterSkills:${stat}:info`);

    const labels = new Box({ gap: smallGap, positiveAlignDirection: true });
    const bonus = makeTtfLabel(
      `${localizedString(this.opts.strings, `Stat${stat}InfoTitleKey`)}: ${
        Math.round(characterSkillBonus(this.opts.profile, stat))
      }`,
      valueFont,
      { outline: true },
    );
    const points = makeTtfLabel(
      `${localizedString(this.opts.strings, "PointsKey")}: ${this.opts.profile.skillValue(stat)}`,
      valueFont,
      { outline: true },
    );
    this.addControl(bonus, () => { void this.showNamedMessage(`Stat${stat}Info`); }, `characterSkills:${stat}:value`);
    this.addControl(points, () => { void this.showNamedMessage("PointsDescription"); }, `characterSkills:${stat}:points`);
    labels.addBoxChild(bonus);
    labels.addBoxChild(points);

    const adjust = new Box({
      horizontal: true,
      gap: layout.adjustGap,
      positiveAlignDirection: true,
    });
    const plusArt = pointSprite(plusTexture);
    const plus = new Container();
    plus.boundsArea = new Rectangle(0, 0, plusArt.width, plusArt.height);
    const minus = pointSprite(minusTexture);
    const minusContentSize = {
      w: minus.width / Math.abs(minus.scale.x),
      h: minus.height / Math.abs(minus.scale.y),
    };








    icon.position.set(-0.1 * plusArt.width, 0.5 * plusArt.height);
    plusArt.label = `characterSkills:${stat}:plusArt`;
    plus.addChild(icon, plusArt);
    this.addControl(plus, () => { void this.changeSkill("increment", stat); }, `characterSkills:${stat}:plus`);
    this.addControl(minus, () => { void this.changeSkill("decrement", stat); }, `characterSkills:${stat}:minus`);
    // Source Box measures the plus sprite's own point-space contentSize and ignores the
    // overflowing stat child.
    adjust.addBoxChild(plus, { contentSize: { w: plusArt.width, h: plusArt.height } });
    adjust.addBoxChild(minus, { contentSize: minusContentSize });
    // Both native vertical Boxes advance bottom-to-top. Pixi's point-space Box advances
    // top-to-bottom, so enumerate the visual order in reverse while retaining the same sizes:
    // source `[labels, adjust]` -> Pixi `[adjust, labels]`.
    cell.addBoxChild(adjust, { contentSize: adjust.boxContentSize });
    cell.addBoxChild(labels, { contentSize: labels.boxContentSize });
    return cell;
  }

  private addControl<T extends Container>(node: T, action: () => void, label: string): T {
    node.label = label;
    node.eventMode = "none";
    const bounds = node.getLocalBounds();
    this.controls.push({
      node,
      action,
      contentRect: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
    });
    return node;
  }

  private pointerBegan(event: FederatedPointerEvent): void {
    if (this.closed) return;
    event.stopPropagation();
    this.armed = this.controlAt(event.getLocalPosition(this)) !== undefined;
  }

  private async pointerEnded(event: FederatedPointerEvent): Promise<void> {
    if (this.closed || !this.armed) return;
    event.stopPropagation();
    this.armed = false;
    const control = this.controlAt(event.getLocalPosition(this));
    control?.action();
  }

  private controlAt(point: Readonly<{ x: number; y: number }>): SkillControl | undefined {
    return nearestMinimumHit(
      this.controls.map((control) => {
        const { node, contentRect } = control;
        const corners = [
          this.toLocal(node.toGlobal({ x: contentRect.x, y: contentRect.y })),
          this.toLocal(node.toGlobal({ x: contentRect.x + contentRect.w, y: contentRect.y })),
          this.toLocal(node.toGlobal({ x: contentRect.x, y: contentRect.y + contentRect.h })),
          this.toLocal(node.toGlobal({ x: contentRect.x + contentRect.w, y: contentRect.y + contentRect.h })),
        ];
        const xs = corners.map(({ x }) => x);
        const ys = corners.map(({ y }) => y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return {
          value: control,
          contentRect: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
          ownScale: { x: 1, y: 1 },
        };
      }),
      point,
    );
  }

  private async changeSkill(
    action: "increment" | "decrement",
    stat: PlayerStatName,
  ): Promise<void> {
    const success = action === "increment"
      ? this.opts.profile.skillPointsAvailable > 0
      : this.opts.profile.skillValue(stat) > 0;
    if (!success) {
      this.opts.onBlocked();
      await this.showNamedMessage(
        action === "increment" ? "NotEnoughSkillPoints" : "SkillAlreadyZero",
      );
      return;
    }
    this.opts.onClick();
    if (this.opts.mutate === undefined) {
      if (action === "increment") this.opts.profile.incrementSkill(stat);
      else this.opts.profile.decrementSkill(stat);
    } else {
      await this.opts.mutate(action, stat);
    }
    this.changeMade = true;
    await this.rebuild();
  }

  private async showNamedMessage(name: string): Promise<void> {
    const content = buildMonsterHatchMessageBlock(
      localizedString(this.opts.strings, `${name}MessageKey`),
    ).root;
    await showMonsterHatchPopup({
      parent: this,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      ticker: this.opts.ticker,
      owner: this.opts.owner,
      zIndex: 1100,
      sfx: { onButtonPress: this.opts.onClick, onButtonBlocked: this.opts.onBlocked },
    }, {
      title: localizedString(this.opts.strings, `${name}TitleKey`),
      content,
      buttons: [{
        label: localizedString(this.opts.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
    });
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.opts.onClick();
    this.opts.onClose();
    this.parent?.removeChild(this);
    this.destroy({ children: true });
  }
}
