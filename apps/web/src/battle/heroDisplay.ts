


import { Container, Graphics, Rectangle, Sprite, type Texture } from "pixi.js";
import { pointSprite, type AssetLibrary } from "@dib/renderer";
import type { BattlePlayerProfile } from "../player/battlePlayerState.js";
import {
  HERO_REVEAL_OPACITY,
  HERO_SHADER_INTERVAL_SECONDS,
  HERO_FLASH_SPEED_SECONDS,
  heroFlashOpacitySeconds,
  heroRevealRect,
} from "./heroDisplayMath.js";

export interface HeroDisplayOpts {
  profile: BattlePlayerProfile;
  enabled: boolean;
  onPress?: () => void;
}

export class HeroDisplay extends Container {
  readonly contentWidth: number;
  readonly contentHeight: number;

  private readonly profile: BattlePlayerProfile;
  private readonly heroSprite: Sprite;
  private readonly flashSprite: Sprite;
  private readonly flashSpriteB: Sprite;
  private readonly reveal = new Graphics();
  private enabledValue: boolean;
  private updateAccumSeconds = 0;
  private flashElapsedSeconds = 0;
  private readinessValue = 0;
  private flashingValue = false;

  private constructor(portraitTexture: Texture, frameTexture: Texture, opts: HeroDisplayOpts) {
    super();
    this.profile = opts.profile;
    this.enabledValue = opts.enabled;

    this.heroSprite = pointSprite(portraitTexture);
    this.addChild(this.heroSprite);
    const frame = pointSprite(frameTexture);
    this.contentWidth = frame.width;
    this.contentHeight = frame.height;
    this.heroSprite.position.set(0, frame.height - this.heroSprite.height);

    // FlashingSprite draws an additive copy at `flashOpacity`. FlashForeverAction itself is a
    // 1.5-second triangle; HeroDisplay's 0.3-second scheduler repeatedly restarts its rising limb.
    this.flashSprite = pointSprite(portraitTexture);
    this.flashSprite.position.copyFrom(this.heroSprite.position);
    // Native `setBlendFunc:0x302` is (GL_SRC_ALPHA, GL_ONE). FixedStage installs that ordinary
    // two-factor function behind `add-npm` (Pixi's stock separate-alpha mapping is not exact).
    this.flashSprite.blendMode = "add-npm";
    this.flashSprite.alpha = 0;
    this.addChild(this.flashSprite);
    this.flashSpriteB = pointSprite(portraitTexture);
    this.flashSpriteB.position.copyFrom(this.heroSprite.position);
    this.flashSpriteB.blendMode = "add-npm";
    this.flashSpriteB.alpha = 0;
    this.addChild(this.flashSpriteB);

    // ColorRevealNode is frame-sized and sits above the hero renderer, below heroFrame.
    this.addChild(this.reveal);
    this.addChild(frame);

    // Native HeroDisplay is the targeted/swallowing touch delegate; ccTouchBegan:/Ended: merely
    // hit-test `heroSprite`. Attaching Pixi input to the portrait itself is incorrect because the
    // later-added reveal/frame siblings win hit arbitration and the portrait never sees the tap.
    for (const child of [
      this.heroSprite,
      this.flashSprite,
      this.flashSpriteB,
      this.reveal,
      frame,
    ]) child.eventMode = "none";
    this.hitArea = new Rectangle(
      this.heroSprite.x,
      this.heroSprite.y,
      this.heroSprite.width,
      this.heroSprite.height,
    );
    this.eventMode = opts.enabled ? "static" : "none";
    this.cursor = opts.enabled ? "pointer" : "default";
    this.on("pointertap", (event) => {
      event.stopPropagation();
      if (this.enabledValue) opts.onPress?.();
    });
    this.refreshShader();
  }

  static async create(assets: AssetLibrary, opts: HeroDisplayOpts): Promise<HeroDisplay> {
    const [portraitTexture, frameTexture] = await Promise.all([
      assets.sprite("heroBattlePortrait-hd"),
      assets.sprite("heroFrame-hd"),
    ]);
    return new HeroDisplay(portraitTexture, frameTexture, opts);
  }

  update(dtMs: number): void {
    const dtSeconds = Math.fround(dtMs / 1000);
    // Cocos's action manager steps existing actions before ordinary scheduled selectors. Advance
    // the active flash first; updateShader's 300ms ready branch then starts a fresh action and
    // resets opacity to zero after that frame's action step.
    if (this.flashingValue) {
      this.flashElapsedSeconds = Math.fround(this.flashElapsedSeconds + dtSeconds);
      if (this.flashElapsedSeconds >= HERO_FLASH_SPEED_SECONDS) {
        this.flashElapsedSeconds = Math.fround(this.flashElapsedSeconds - HERO_FLASH_SPEED_SECONDS);
      }
      const opacity = heroFlashOpacitySeconds(this.flashElapsedSeconds);
      this.flashSprite.alpha = opacity;
      this.flashSpriteB.alpha = opacity;
    }
    this.updateAccumSeconds = Math.fround(this.updateAccumSeconds + dtSeconds);
    while (this.updateAccumSeconds >= HERO_SHADER_INTERVAL_SECONDS) {
      this.updateAccumSeconds = Math.fround(this.updateAccumSeconds - HERO_SHADER_INTERVAL_SECONDS);
      this.refreshShader();
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabledValue = enabled;
    this.eventMode = enabled ? "static" : "none";
    this.cursor = enabled ? "pointer" : "default";
  }

  get debugState(): {
    readiness: number;
    coverPercent: number;
    flashing: boolean;
    flashOpacity: number;
    enabled: boolean;
  } {
    return {
      readiness: this.readinessValue,
      coverPercent: 1 - this.readinessValue,
      flashing: this.flashingValue,
      flashOpacity: this.flashSprite.alpha,
      enabled: this.enabledValue,
    };
  }

  /** Center of the native touch target (the portrait, not the ornamental frame), in local points. */
  get hitCenter(): { x: number; y: number } {
    return {
      x: this.heroSprite.x + this.heroSprite.width / 2,
      y: this.heroSprite.y + this.heroSprite.height / 2,
    };
  }

  private refreshShader(): void {
    const state = this.profile.spiritSnapshot();
    this.readinessValue = state.readiness;
    const rect = heroRevealRect(
      state.readiness,
      state.spirits.length > 0,
      this.contentWidth,
      this.contentHeight,
    );
    // Cocos rectangle is y=0..height*percent (bottom-up). Pixi's flipped equivalent covers the
    // bottom `percent`, revealing the portrait from its top edge as readiness rises.
    this.reveal
      .clear()
      .rect(rect.x, rect.y, rect.w, rect.h)
      .fill({ color: 0x000000, alpha: HERO_REVEAL_OPACITY });
    const shouldFlash = state.spirits.length > 0 && state.full;
    if (shouldFlash) {
      // Literal source behavior: updateShader does NOT check for an existing action. Every 0.3s
      // it runs a new FlashForeverAction whose startWithTarget: resets flashOpacity to zero. The
      // newest action is updated last, so it owns the visible opacity until the next restart.
      this.flashingValue = true;
      this.flashElapsedSeconds = 0;
      this.flashSprite.alpha = 0;
      this.flashSpriteB.alpha = 0;
    } else if (this.flashingValue || this.flashSprite.alpha !== 0) {
      this.flashingValue = false;
      this.flashElapsedSeconds = 0;
      this.flashSprite.alpha = 0;
      this.flashSpriteB.alpha = 0;
    }
  }
}
