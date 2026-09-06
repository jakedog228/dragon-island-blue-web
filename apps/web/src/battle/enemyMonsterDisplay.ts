























import { Container, Graphics, Rectangle, Sprite, Text, Texture, type Ticker } from "pixi.js";
import { pointSprite, makeTtfLabel, ProgressBar, hpTint } from "@dib/renderer";
import { tween, easeElasticInOut, easeElasticOut, easeExponentialInOut, easeSineInOut, evenlyShakenOffset } from "../tween.js";
import {
  ENEMY_SLOT_WIDTH,
  ENEMY_SLOT_HEIGHT,
  ENEMY_NAME_LABEL_SIZE,
  ENEMY_HP_BAR_SCALE,
  ENEMY_ELEMENT_ICON_GAP,
  IDLE_BOB_LEG_MS,
  IDLE_BOB_AMPLITUDE,
  ENEMY_ABILITY_PULSE_SCALE,
  ENEMY_ABILITY_PULSE_LEG_MS,
  DEATH_SHAKE_MS,
  DEATH_SHAKE_OFFSET,
  DEATH_SPIN_SHRINK_MS,
  DEATH_SPIN_DEGREES,
  DEATH_WIDGET_REMOVE_MS,
  CAPTURE_REMOVE_MS,
  RARITY_STAR_DELAY_MS,
  RARITY_STAR_LIFETIME_MS,
  RARITY_STAR_GAP,
  RARITY_STAR_X_OFFSET,
  RARITY_STAR_BAND_TOP_PIXI_Y,
  RARITY_STAR_SCALE,
  RARITY_STAR_ENTRY_DELAY_BASE_MS,
  RARITY_STAR_ENTRY_DELAY_STEP_MS,
  RARITY_STAR_ENTRY_START_Y_COCOS,
  RARITY_STAR_MOVE_MS,
  RARITY_STAR_SCALE_MS,
} from "./displayShared.js";

const sleep = (ticker: Ticker, ms: number): Promise<void> => (ms <= 0 ? Promise.resolve() : tween(ticker, ms, () => {}));











const ELEMENT_ICON_DIM_DELAY_MS = 6000;
const ELEMENT_ICON_DIM_ALPHA = 100 / 255;

export interface EnemyMonsterDisplayOpts {
  name: string;

  nameColor: number;
  /** Standalone `sprites/<Name>-hd.png` field sprite. */
  monsterTexture: Texture;
  /** `Monsters.json` `rendererData.scale` — the data-driven field-sprite scale the ORIGINAL's
   *  `RendererFactory nodeForRenderable:context:` applies (e.g. WhiteDragonling 0.8, FireCub 0.5).
   *  Defaults to 1 (most monsters carry no rendererData). This replaces a prior shrink-to-110pt
   *  box that distorted relative monster proportions. */
  rendererScale?: number;
  /** `monsterHpBarBack.png` frame (General-hd atlas). */
  hpBackTexture: Texture;
  /** `monsterHpBar.png` frame (General-hd atlas). */
  hpForeTexture: Texture;
  /** `Element<element>.png` frame (General-hd atlas) — the element badge next to the name plate
   *  (team-displays.md §2's element icon, frame-name pattern confirmed against the atlas). */
  elementTexture?: Texture;
  /** Element badge release callback; source returns before ordinary monsterTouched dispatch. */
  onElementTap?: () => void;
  /** Analyze-enabled body taps route through inherited LivingDisplay to LivingInfoDisplay. */
  onAnalyzeTap?: () => void;
  /** Engine-extension input ownership. Returning true claims this press and suppresses the
   * ordinary star/Analyze tap for the same pointer sequence. */
  onBodyPressStart?: () => boolean;
  onBodyPressEnd?: () => void;
  maxHp: number;
  hp: number;
  ticker: Ticker;
  /** `largeRarityStar-hd.png` texture — only rendered if both this and `starCount` are given. */
  starTexture?: Texture;





  starCount?: number;
}

export class EnemyMonsterDisplay extends Container {
  /** Exposed for targeting/effects (EnemyTeamDisplay.nodeOf), and so status-effect placement
   *  (out of this task's scope) has a stable anchor matching `statusEffectParent` returning
   *  `monsterNode` (team-displays.md §2). */
  readonly monsterNode: Sprite;

  private readonly hpBar: ProgressBar;
  private readonly ticker: Ticker;
  private readonly maxHp: number;
  private readonly baseSpriteY: number;
  private readonly starTexture: Texture | undefined;
  private readonly starCount: number;
  private readonly activeStarRows = new Set<Container>();
  private readonly elementIcon: Sprite | undefined;
  private initialActionsStarted = false;
  private readonly analyzeTap: (() => void) | undefined;
  private analyzeEnabled = false;
  private bodyPressClaimed = false;
  private suppressNextBodyTap = false;
  private stopped = false;
  /**
   * Cumulative ability-activation pulses started on this widget (debug / browser choreography).
   * Counts starts so a one-frame LooseTurn window cannot miss a pulse that already finished.
   */
  private abilityPulseStarts = 0;

  get restingMonsterCenterY(): number {
    return this.baseSpriteY;
  }

  constructor(opts: EnemyMonsterDisplayOpts) {
    super();
    this.ticker = opts.ticker;
    this.maxHp = opts.maxHp;
    this.starTexture = opts.starTexture;
    this.starCount = opts.starCount ?? 0;
    this.analyzeTap = opts.onAnalyzeTap;







    this.sortableChildren = true;

    // Pin this widget's packed box to exactly ENEMY_SLOT_WIDTH × ENEMY_SLOT_HEIGHT (data_98c10 +
    // the winSize−90−20 computed height, team-displays.md §2) regardless of the monster sprite's
    // own size — the original explicitly `setContentSize:`s this widget rather than deriving it
    // from children. Pixi Containers have no such property; an invisible (alpha 0, still
    // bounds-contributing) sizing rect stands in for it.
    const sizer = new Graphics().rect(0, 0, ENEMY_SLOT_WIDTH, ENEMY_SLOT_HEIGHT).fill(0xffffff);
    sizer.alpha = 0;
    this.addChild(sizer);












    this.monsterNode = pointSprite(opts.monsterTexture);
    this.monsterNode.anchor.set(0.5, 0.5);
    const dataScale = opts.rendererScale ?? 1;
    const scale = this.monsterNode.scale.x * dataScale;
    this.monsterNode.scale.set(scale, scale);
    // Read the live slot height. A display-mode rebuild refreshes displayShared before creating
    // this widget; a module-load half-height retained the previous idiom's vertical offset.
    this.baseSpriteY = ENEMY_SLOT_HEIGHT / 2;
    this.monsterNode.position.set(ENEMY_SLOT_WIDTH / 2, this.baseSpriteY);
    // `LivingDisplay.touchNode` is overridden by EnemyMonsterDisplay to return `monsterNode`;
    // a completed selection touch dispatches virtual `monsterTouched`, whose ordinary battle
    // (`analyzeEnabled == 0`) branch calls `showStars` immediately.
    this.monsterNode.eventMode = "static";
    this.monsterNode.on("pointerdown", () => {
      this.bodyPressClaimed = opts.onBodyPressStart?.() ?? false;
    });
    this.monsterNode.on("pointerup", () => {
      if (!this.bodyPressClaimed) return;
      this.bodyPressClaimed = false;
      this.suppressNextBodyTap = true;
      opts.onBodyPressEnd?.();
    });
    this.monsterNode.on("pointerupoutside", () => {
      if (!this.bodyPressClaimed) return;
      this.bodyPressClaimed = false;
      this.suppressNextBodyTap = false;
      opts.onBodyPressEnd?.();
    });
    this.monsterNode.on("pointercancel", () => {
      if (!this.bodyPressClaimed) return;
      this.bodyPressClaimed = false;
      this.suppressNextBodyTap = false;
      opts.onBodyPressEnd?.();
    });
    this.monsterNode.on("pointertap", () => {
      if (this.suppressNextBodyTap) {
        this.suppressNextBodyTap = false;
        return;
      }
      this.monsterTouched();
    });
    this.addChild(this.monsterNode);





    this.hpBar = new ProgressBar({
      backgroundTexture: opts.hpBackTexture,
      foregroundTexture: opts.hpForeTexture,
      labelFontFile: null,
      max: opts.maxHp,
    });
    this.hpBar.scale.set(ENEMY_HP_BAR_SCALE);
    const hpBarW = this.hpBar.contentWidth * ENEMY_HP_BAR_SCALE;
    const hpBarH = this.hpBar.contentHeight * ENEMY_HP_BAR_SCALE;
    const hpBarCenterY = hpBarH; // Cocos: 210 − scaledH -> Pixi center y = scaledH
    this.hpBar.position.set(ENEMY_SLOT_WIDTH / 2 - hpBarW / 2, hpBarCenterY - hpBarH / 2);
    this.addChild(this.hpBar);
    this.setHp(opts.hp);





    const hpBarUnscaledH = this.hpBar.contentHeight;


    const nameLabel: Text = makeTtfLabel(opts.name, ENEMY_NAME_LABEL_SIZE, {
      fill: opts.nameColor,
      outline: true,
    });
    nameLabel.anchor.set(0.5, 1);
    nameLabel.position.set(ENEMY_SLOT_WIDTH / 2, hpBarCenterY - hpBarUnscaledH / 2);
    nameLabel.zIndex = 2;
    this.addChild(nameLabel);




    if (opts.elementTexture) {
      const icon = pointSprite(opts.elementTexture);
      icon.anchor.set(0.5, 0);
      icon.position.set(ENEMY_SLOT_WIDTH / 2, hpBarCenterY + hpBarUnscaledH / 2 + ENEMY_ELEMENT_ICON_GAP);
      icon.eventMode = "static";
      icon.cursor = "pointer";
      icon.on("pointertap", () => opts.onElementTap?.());
      this.addChild(icon);
      this.elementIcon = icon;
    }

    // No portrait thumbnail / namePlate.png here — doc-absent for this class, see file header.

  }

  /** Constructor-owned source actions are started by EnemyTeamDisplay at the battle transition
   * boundary. The web port may construct textures early, but must not consume their timers while
   * the incoming BattleNode is still hidden. */
  startInitialActions(): void {
    if (this.initialActionsStarted) return;
    this.initialActionsStarted = true;
    if (this.elementIcon) void this.dimElementIcon(this.elementIcon);
    if (this.starTexture && this.starCount > 0) void this.showStarsAfterDelay();
    void this.runIdleBob();
  }



  setHp(hp: number): void {
    this.hpBar.setRatio(Math.max(0, hp / this.maxHp));
    this.hpBar.setTint(hpTint(hp, this.maxHp));
  }

  /** One `ProgressBar.update()` tick (its own per-frame ease step — see progressBar.ts). `dtMs`
   *  is accepted for interface uniformity with other `update(dt)` consumers; ProgressBar's own
   *  step is per-call, not scaled by it (same convention progressBar.ts documents). */
  update(dtMs: number): void {
    this.hpBar.update(dtMs);
  }

  get abilityPulseStartCount(): number {
    return this.abilityPulseStarts;
  }







  async notifyActivatedAbility(): Promise<void> {
    if (this.stopped || this.monsterNode.destroyed) return;
    this.abilityPulseStarts += 1;
    const baseX = this.monsterNode.scale.x;
    const baseY = this.monsterNode.scale.y;
    await tween(this.ticker, ENEMY_ABILITY_PULSE_LEG_MS, (t) => {
      if (this.stopped || this.monsterNode.destroyed) return;
      const multiplier = 1 + (ENEMY_ABILITY_PULSE_SCALE - 1) * t;
      this.monsterNode.scale.set(baseX * multiplier, baseY * multiplier);
    });
    if (this.stopped || this.monsterNode.destroyed) return;
    await tween(this.ticker, ENEMY_ABILITY_PULSE_LEG_MS, (t) => {
      if (this.stopped || this.monsterNode.destroyed) return;
      const multiplier = ENEMY_ABILITY_PULSE_SCALE - (ENEMY_ABILITY_PULSE_SCALE - 1) * t;
      this.monsterNode.scale.set(baseX * multiplier, baseY * multiplier);
    });
  }

  /** Number of live transient star boxes, exposed for deterministic interaction scenarios. */
  get activeStarGroupCount(): number {
    return this.activeStarRows.size;
  }

  /** Runtime hit-target center, exported only for deterministic browser choreography. */
  get elementIconGlobalCenter(): { x: number; y: number } | null {
    if (!this.elementIcon) return null;
    const bounds = this.elementIcon.getBounds();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  /** `-[EnemyMonsterDisplay setAnalyzeEnabled:]` state set by EnemyTeamDisplay.allowAnalyze. */
  setAnalyzeEnabled(enabled: boolean): void {
    this.analyzeEnabled = enabled;
  }

  get isAnalyzeEnabled(): boolean {
    return this.analyzeEnabled;
  }



  private monsterTouched(): void {
    if (this.analyzeEnabled) {
      this.analyzeTap?.();
      return;
    }
    this.showStars();
  }









  async performDeathAnimation(captureSuccess: boolean): Promise<void> {
    this.stopped = true; // stop the idle bob loop before it fights the death tweens
    if (this.monsterNode.destroyed) return;
    if (captureSuccess) {

      await sleep(this.ticker, CAPTURE_REMOVE_MS);
      return;
    }
    this.monsterNode.position.set(ENEMY_SLOT_WIDTH / 2, this.baseSpriteY);
    const spriteDeath = (async (): Promise<void> => {
      await this.shake(DEATH_SHAKE_MS, DEATH_SHAKE_OFFSET);


      if (this.monsterNode.destroyed) return;
      const startScale = this.monsterNode.scale.y;
      await Promise.all([
        tween(this.ticker, DEATH_SPIN_SHRINK_MS, (t) => {
          if (this.monsterNode.destroyed) return;
          this.monsterNode.rotation = t * ((DEATH_SPIN_DEGREES * Math.PI) / 180);
        }),
        tween(this.ticker, DEATH_SPIN_SHRINK_MS, (t) => {
          if (this.monsterNode.destroyed) return;
          const s = startScale * (1 - t);
          this.monsterNode.scale.set(s, s);
        }),
      ]);
    })();
    await Promise.all([
      spriteDeath,
      sleep(this.ticker, DEATH_WIDGET_REMOVE_MS),
    ]);
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.stopped = true;
    super.destroy(options);
  }

  /** `CCRepeatForever(CCSequence(EaseSineInOut(MoveBy 2.0s,(0,-20)), EaseSineInOut(MoveBy
   *  2.0s,(0,+20))))` applied to `monsterNode` (displayShared.ts IDLE_BOB_* — Y-flip explained
   *  there). Runs until `stopped` (death animation or destroy). */
  private async runIdleBob(): Promise<void> {
    while (!this.stopped) {
      await tween(
        this.ticker,
        IDLE_BOB_LEG_MS,
        (t) => {
          if (!this.stopped && !this.monsterNode.destroyed) {
            this.monsterNode.position.y = this.baseSpriteY + IDLE_BOB_AMPLITUDE * t;
          }
        },
        easeSineInOut,
      );
      if (this.stopped) return;
      await tween(
        this.ticker,
        IDLE_BOB_LEG_MS,
        (t) => {
          if (!this.stopped && !this.monsterNode.destroyed) {
            this.monsterNode.position.y = this.baseSpriteY + IDLE_BOB_AMPLITUDE * (1 - t);
          }
        },
        easeSineInOut,
      );
    }
  }

  /** Exact `ActionFactory shakeNodeEvenlyActionWithDuration:offset:` sequence; see displayShared. */
  private async shake(ms: number, offset: number): Promise<void> {
    const baseX = ENEMY_SLOT_WIDTH / 2;
    await tween(this.ticker, ms, (t) => {
      if (this.monsterNode.destroyed) return;
      const e = easeElasticOut(t, 0.1);
      this.monsterNode.position.x = baseX + evenlyShakenOffset(e, offset);
    });
    if (this.monsterNode.destroyed) return;
    this.monsterNode.position.x = baseX;
  }


  private async showStarsAfterDelay(): Promise<void> {
    await sleep(this.ticker, RARITY_STAR_DELAY_MS);
    if (this.stopped) return;
    this.showStars();
  }






  private showStars(): void {
    const starTexture = this.starTexture;
    if (this.stopped || !starTexture || this.starCount <= 0) return;
    const fullCount = Math.floor(this.starCount);
    const hasHalf = this.starCount - fullCount >= 0.5;
    const row = new Container();
    const probe = pointSprite(starTexture);
    const starW = probe.width * RARITY_STAR_SCALE;
    const starH = probe.height * RARITY_STAR_SCALE;
    probe.destroy();


    const halfTexture = hasHalf
      ? new Texture({
          source: starTexture.source,
          frame: new Rectangle(
            starTexture.frame.x,
            starTexture.frame.y,
            starTexture.frame.width / 2,
            starTexture.frame.height,
          ),
        })
      : undefined;





    let slotX = 0;
    const total = fullCount + (hasHalf ? 1 : 0);
    for (let i = 0; i < total; i++) {
      const isHalf = hasHalf && i === fullCount;
      const star = pointSprite(isHalf && halfTexture ? halfTexture : starTexture);
      star.anchor.set(0.5, 0.5);
      const naturalScaleX = star.scale.x;
      const naturalScaleY = star.scale.y;
      const restY = starH / 2;


      star.position.set(slotX, restY - RARITY_STAR_ENTRY_START_Y_COCOS);
      row.addChild(star);
      void (async () => {
        await sleep(this.ticker, RARITY_STAR_ENTRY_DELAY_BASE_MS + RARITY_STAR_ENTRY_DELAY_STEP_MS * i);
        if (this.stopped || star.destroyed) return;
        await Promise.all([
          tween(
            this.ticker,
            RARITY_STAR_MOVE_MS,
            (t) => {
              if (!this.stopped && !star.destroyed) {
                star.position.y = restY - RARITY_STAR_ENTRY_START_Y_COCOS * (1 - t);
              }
            },
            easeExponentialInOut,
          ),
          tween(
            this.ticker,
            RARITY_STAR_SCALE_MS,
            (t) => {
              if (this.stopped || star.destroyed) return;
              const s = 1 + (RARITY_STAR_SCALE - 1) * t;
              star.scale.set(naturalScaleX * s, naturalScaleY * s);
            },
            easeElasticInOut,
          ),
        ]);
      })();
      slotX += (isHalf ? starW / 2 : starW) + RARITY_STAR_GAP;
    }
    // Row origin: x = w·0.5 − 35 (data_99104), y = the band-TOP line (Cocos 195 → Pixi 15); the
    // center-anchored stars hang below it (see RARITY_STAR_BAND_TOP_PIXI_Y).
    row.position.set(ENEMY_SLOT_WIDTH * 0.5 - RARITY_STAR_X_OFFSET, RARITY_STAR_BAND_TOP_PIXI_Y);
    this.addChild(row);
    this.activeStarRows.add(row);
    void (async () => {
      await sleep(this.ticker, RARITY_STAR_LIFETIME_MS);
      this.activeStarRows.delete(row);
      if (!row.destroyed) row.destroy({ children: true });
    })();
  }

  /** Element-icon passive dimming: after 6.0s, fade to 100/255 ≈ 39% opacity (team-displays.md
   *  §2 — the delay + target opacity are cited; the fade leg's own duration is not, a short 0.5s
   *  ramp is this port's reading of "fades to"). */
  private async dimElementIcon(icon: Sprite): Promise<void> {
    await sleep(this.ticker, ELEMENT_ICON_DIM_DELAY_MS);
    if (this.stopped) return;
    await tween(this.ticker, 500, (t) => {
      if (!this.stopped && !icon.destroyed) icon.alpha = 1 - t * (1 - ELEMENT_ICON_DIM_ALPHA);
    });
  }
}
