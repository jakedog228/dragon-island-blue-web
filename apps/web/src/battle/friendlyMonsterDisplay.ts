






















import { Container, Sprite, type Texture, type Ticker } from "pixi.js";
import { pointSprite, makeTtfLabel, makeBitmapLabel, bitmapFontFile, ProgressBar, hpTint, CONTENT_SCALE_FACTOR, rectContainsPoint } from "@dib/renderer";
import { tween } from "../tween.js";
import {
  FRIENDLY_NAME_LABEL_SIZE,
  FRIENDLY_HP_BAR_SCALE,
  FRIENDLY_HP_LABEL_SIZE,
  FRIENDLY_HP_LABEL_BOLD,
  FRIENDLY_CARD_SPRITE_MAX_H,
  FRIENDLY_CARD_SPRITE_W_INSET,
  FRIENDLY_DEATH_SPIN_MS,
  FRIENDLY_DEATH_SPIN_DEGREES,
  shrinkToFitScale,
  friendlyCardChromeLayout,
  contentSizeFromChildUnion,
} from "./displayShared.js";

export interface FriendlyMonsterDisplayOpts {
  name: string;
  /** Standalone `sprites/<Name>-hd.png` field sprite (same `RendererFactory
   *  nodeForRenderable:context:` pattern `EnemyMonsterDisplay.monsterNode` uses). */
  monsterTexture: Texture;


  rendererScale?: number;
  /** `monsterHpBarBack.png` frame (General-hd atlas). */
  hpBackTexture: Texture;
  /** `monsterHpBar.png` frame (General-hd atlas). */
  hpForeTexture: Texture;
  maxHp: number;
  hp: number;
  ticker: Ticker;
  /** `initWithMonster:slotWidth:` (team-displays.md §4): w/5 for a team-row card, w/6 for the
   *  turn-panel acting card — displayShared.ts's FRIENDLY_SLOT_WIDTH/TURN_PANEL_CARD_WIDTH. */
  slotWidth: number;
}

export class FriendlyMonsterDisplay extends Container {
  /** Exposed for `FriendlyTeamDisplay.popForward`'s spotlight clone and for targeting/effects
   *  (mirrors `EnemyMonsterDisplay.monsterNode`'s own exposure rationale). */
  readonly monsterSprite: Sprite;
  /** Raw texture backing `monsterSprite`, kept for `popForward`'s full-size spotlight clone
   *  (this port's own composition — see friendlyTeamDisplay.ts's `popForward`). */
  readonly monsterTexture: Texture;

  /** The card's union-of-children height (varies with the sprite) — callers bottom-anchor the
   *  card with it (the original's contentSizeFromUnionOfChildren box). */
  readonly contentHeight: number;
  /** Width half of the original `contentSizeFromUnionOfChildren...` result. Kept alongside
   *  `contentHeight` so AbilityRenderer can use Cocos contentSize instead of Pixi child bounds. */
  readonly contentWidth: number;

  private readonly hpBar: ProgressBar;
  private readonly ticker: Ticker;
  private readonly maxHp: number;
  private readonly slotWidth: number;
  private readonly hpCenterCocos: { x: number; y: number };
  private readonly namePositionCocos: { x: number; y: number };
  private mainLiving = false;

  constructor(opts: FriendlyMonsterDisplayOpts) {
    super();
    this.ticker = opts.ticker;
    this.maxHp = opts.maxHp;
    this.slotWidth = opts.slotWidth;
    this.monsterTexture = opts.monsterTexture;





















    this.monsterSprite = pointSprite(opts.monsterTexture);


    const shrink = shrinkToFitScale(
      this.monsterSprite.width,
      this.monsterSprite.height,
      this.slotWidth - FRIENDLY_CARD_SPRITE_W_INSET,
      FRIENDLY_CARD_SPRITE_MAX_H,
    );
    this.monsterSprite.scale.set(this.monsterSprite.scale.x * shrink, this.monsterSprite.scale.y * shrink);
    const spriteH = this.monsterSprite.height;

    this.hpBar = new ProgressBar({
      backgroundTexture: opts.hpBackTexture,
      foregroundTexture: opts.hpForeTexture,
      labelFontFile: bitmapFontFile(FRIENDLY_HP_LABEL_SIZE, FRIENDLY_HP_LABEL_BOLD),
      makeLabel: (text) => makeBitmapLabel(text, FRIENDLY_HP_LABEL_SIZE, FRIENDLY_HP_LABEL_BOLD),
      max: opts.maxHp,
    });
    this.hpBar.scale.set(FRIENDLY_HP_BAR_SCALE);
    const hpBarUnscaledH = this.hpBar.contentHeight;
    const hpBarW = this.hpBar.contentWidth * FRIENDLY_HP_BAR_SCALE;
    const hpBarH = hpBarUnscaledH * FRIENDLY_HP_BAR_SCALE;

    // Cocos card-local geometry (y-up, origin card bottom-left), straight from the disasm:
    const spriteCenterYCocos = FRIENDLY_CARD_SPRITE_MAX_H / 2; // (90−10)/2 = 40
    const chrome = friendlyCardChromeLayout(this.slotWidth, hpBarUnscaledH);
    const barCenterXCocos = chrome.barCenterX;
    const barCenterYCocos = chrome.barCenterY;
    const nameBottomYCocos = chrome.nameBottomY;
    this.hpCenterCocos = { x: barCenterXCocos, y: barCenterYCocos };
    this.namePositionCocos = { x: chrome.nameX, y: nameBottomYCocos };


    const nameLabel = makeTtfLabel(opts.name, FRIENDLY_NAME_LABEL_SIZE, { outline: true });
    // Mirror contentSizeFromUnionOfChildrenIncludingNegativePositions:0 after all child-local
    // geometry has been established. Positive leading origins remain outside the returned size.
    const size = contentSizeFromChildUnion([
      {
        x: this.slotWidth * 0.5 - this.monsterSprite.width * 0.5,
        y: spriteCenterYCocos - spriteH * 0.5,
        w: this.monsterSprite.width,
        h: spriteH,
      },
      {
        x: barCenterXCocos - hpBarW * 0.5,
        y: barCenterYCocos - hpBarH * 0.5,
        w: hpBarW,
        h: hpBarH,
      },
      { x: chrome.nameX, y: nameBottomYCocos, w: nameLabel.width, h: nameLabel.height },
    ]);
    this.contentWidth = size.w;
    this.contentHeight = size.h;
    const height = this.contentHeight;


    this.hitArea = {
      contains: (x: number, y: number) => rectContainsPoint(
        { x: 0, y: 0, w: this.contentWidth, h: this.contentHeight },
        { x, y },
      ),
    };

    // Pixi (y-down, origin card top-left): y_pixi = contentHeight − y_cocos.
    this.monsterSprite.anchor.set(0.5, 0.5);
    this.monsterSprite.position.set(this.slotWidth / 2, height - spriteCenterYCocos);
    this.addChild(this.monsterSprite);

    // Bar center (round(slotW/2), round(unscaledH/2)) in native Cocos coordinates, then normalize.
    this.hpBar.position.set(
      barCenterXCocos - hpBarW / 2,
      height - barCenterYCocos - hpBarH / 2,
    );
    this.addChild(this.hpBar);
    this.setHp(opts.hp);

    // Name label: CCLabelTTF 12pt (data_9be20), NO per-monster setColor:, outline, z=2 (above
    // the bar — added last here for Pixi paint order); Cocos anchor (0,0) = LEFT-aligned at x=5
    // (raw disasm), bottom edge a bare native 2pt above the bar's unscaled top.
    nameLabel.anchor.set(0, 1);
    nameLabel.position.set(chrome.nameX, height - nameBottomYCocos);
    this.addChild(nameLabel);
  }

  /** Deterministic browser evidence for the source's final card scale/contentSize distinction. */
  get sourceLayoutState(): Record<string, unknown> {
    return {
      monsterCocosScale: this.monsterSprite.scale.x * CONTENT_SCALE_FACTOR,
      monsterTexturePointSize: {
        w: this.monsterTexture.width / CONTENT_SCALE_FACTOR,
        h: this.monsterTexture.height / CONTENT_SCALE_FACTOR,
      },
      fitBox: {
        w: this.slotWidth - FRIENDLY_CARD_SPRITE_W_INSET,
        h: FRIENDLY_CARD_SPRITE_MAX_H,
      },
      monsterSize: { w: this.monsterSprite.width, h: this.monsterSprite.height },
      hpContentSize: { w: this.hpBar.contentWidth, h: this.hpBar.contentHeight },
      hpPosition: { x: this.hpBar.position.x, y: this.hpBar.position.y },
      hpCenterCocos: this.hpCenterCocos,
      namePositionCocos: this.namePositionCocos,
      nodePosition: { x: this.position.x, y: this.position.y },
      contentSize: { w: this.contentWidth, h: this.contentHeight },
    };
  }




  setHp(hp: number): void {
    this.hpBar.setRatio(Math.max(0, hp / this.maxHp));
    this.hpBar.setTint(hpTint(hp, this.maxHp));
  }

  /** One `ProgressBar.update()` tick — see enemyMonsterDisplay.ts's identical `update(dtMs)`
   *  convention note (the ease step is per-call, not scaled by `dt`). */
  update(dtMs: number): void {
    this.hpBar.update(dtMs);
  }




  setMainLiving(value: boolean): void {
    this.mainLiving = value;
  }

  get isMainLiving(): boolean {
    return this.mainLiving;
  }









  async performDeathAnimation(): Promise<void> {
    await Promise.all([
      tween(this.ticker, FRIENDLY_DEATH_SPIN_MS, (t) => {
        this.rotation = t * ((FRIENDLY_DEATH_SPIN_DEGREES * Math.PI) / 180);
      }),
      tween(this.ticker, FRIENDLY_DEATH_SPIN_MS, (t) => {
        const s = 1 - t;
        this.scale.set(s, s);
      }),
    ]);
  }
}
