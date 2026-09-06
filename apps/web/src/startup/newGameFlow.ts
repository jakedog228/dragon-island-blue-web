import { Container, Graphics, Rectangle, Texture, type Ticker } from "pixi.js";
import { Box, ButtonSprite, makeTtfLabel, pointSprite, type AssetLibrary } from "@dib/renderer";
import type { AudioPlayer } from "../audio.js";
import type { KeyboardShortcutRouter } from "../keyboardShortcuts.js";
import { isAdvanceShortcut } from "../keyboardShortcuts.js";
import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";
import { idiomPairPt, sourcePointsPerPortPoint } from "../displayMode.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { easeExponentialOut } from "../tween.js";
import {
  PLOT_BACKGROUND_TEXTURE_RECT_PX,
  PLOT_SLIDE_MS,
  SOURCE_STARTER_CHOICES,
  pickDragonLayout,
  plotNarrationCanFinish,
  plotPageLayout,
  plotTextScrollDurationMs,
} from "../ui/plotGameFlowMath.js";

export type NewGameFlowPhase = "plot" | "pick-dragon";

export async function runSourceNewGameFlow(opts: {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly strings: LocalizedStrings;
  readonly audio: AudioPlayer;
  readonly ticker: Ticker;
  readonly keyboard: KeyboardShortcutRouter;
  readonly onPhase: (phase: NewGameFlowPhase, detail?: Record<string, unknown>) => void;
}): Promise<string> {
  opts.audio.playMusic(opts.assets.audioUrl("Dungeon2.mp3"), {
    loop: false,
    assetName: "Dungeon2.mp3",
  });
  await showNarratedPlot({
    ...opts,
    imageKey: "plot_start1",
    textKey: "NewGamePlot1Key",
    onState: (detail) => opts.onPhase("plot", detail),
  });
  return showPickDragon(opts);
}

/** Shared source `PlotGameFlowEvent` presentation used by NewGame and WonLicense1..6. */
export async function showNarratedPlot(opts: {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly keyboard: KeyboardShortcutRouter;
  readonly imageKey: string;
  readonly textKey: string;
  readonly onState?: (detail: Record<string, unknown>) => void;
}): Promise<void> {
  const layout = plotPageLayout(DISPLAY_MODE);
  const full = await opts.assets.sprite(opts.imageKey);
  if (
    full.width < PLOT_BACKGROUND_TEXTURE_RECT_PX.w ||
    full.height < PLOT_BACKGROUND_TEXTURE_RECT_PX.h
  ) {
    throw new Error(`${opts.imageKey}.png does not contain the source 1024x768 frame`);
  }
  const root = new Container();
  root.label = "sourceNewGamePlot";
  root.position.y = layout.screen.h;
  root.eventMode = "static";
  root.hitArea = new Rectangle(0, 0, layout.screen.w, layout.screen.h);
  opts.parent.addChild(root);
  const background = pointSprite(new Texture({
    source: full.source,
    frame: new Rectangle(0, 0, 1024, 768),
  }));
  background.position.set(layout.background.x, layout.background.y);
  background.eventMode = "none";
  root.addChild(background);

  const text = localizedString(opts.strings, opts.textKey);
  const label = makeTtfLabel(text, idiomPairPt(18, 22, DISPLAY_MODE), {
    align: "center",
    wordWrapWidth: layout.screen.w * 0.9,
    outlineWidthPt: 2,
    textureScaleMode: "nearest",
  });
  label.anchor.set(0.5);
  label.position.set(layout.screen.w / 2, layout.screen.h + label.height / 2);
  label.eventMode = "none";
  root.addChild(label);
  const blocker = new Graphics()
    .rect(0, 0, layout.screen.w, layout.screen.h)
    .fill({ color: 0, alpha: 0.001 });
  blocker.eventMode = "static";
  blocker.cursor = "pointer";
  root.addChild(blocker);

  let ageMs = 0;
  let scrollComplete = false;
  let finished = false;
  let resolve!: () => void;
  const done = new Promise<void>((doneResolve) => { resolve = doneResolve; });
  const scrollMs = plotTextScrollDurationMs(text.length);
  opts.onState?.({
    image: `${opts.imageKey}.png`,
    textKey: opts.textKey,
    scrollMs,
    characterCount: text.length,
  });
  const tick = (): void => {
    ageMs += opts.ticker.deltaMS;
    const entryRaw = Math.min(1, ageMs / PLOT_SLIDE_MS);
    const entry = easeExponentialOut(entryRaw);
    root.y = layout.screen.h * (1 - entry);
    const scroll = scrollMs === 0 ? 1 : Math.min(1, ageMs / scrollMs);
    label.y = layout.screen.h + label.height / 2 -
      (layout.screen.h + label.height) * scroll;
    if (scroll === 1 && !scrollComplete) {
      // -scrollDone sets allowToFinish and immediately calls ccTouchEnded:nil. NewGame has a
      // chained next event and no continue button, so completion proceeds without another tap.
      scrollComplete = true;
      finish();
    }
  };
  const finish = (): void => {
    if (finished) return;
    finished = true;
    opts.ticker.remove(tick);
    keyboardCleanup();
    root.removeFromParent();
    root.destroy({ children: true });
    resolve();
  };
  blocker.on("pointertap", (event) => {
    event.stopPropagation();
    if (plotNarrationCanFinish(ageMs, scrollComplete)) finish();
  });
  const keyboardCleanup = opts.keyboard.register(({ key }) => {
    if (
      !isAdvanceShortcut(key) ||
      !plotNarrationCanFinish(ageMs, scrollComplete)
    ) return false;
    finish();
    return true;
  });
  opts.ticker.add(tick);
  await done;
}

async function showPickDragon(opts: {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly keyboard: KeyboardShortcutRouter;
  readonly onPhase: (phase: NewGameFlowPhase, detail?: Record<string, unknown>) => void;
}): Promise<string> {
  const layout = pickDragonLayout(DISPLAY_MODE);
  const [backgroundFull, backingTexture, ...monsterTextures] = await Promise.all([
    opts.assets.sprite("mainscreenBackground"),
    opts.assets.sprite("pickDragonBacking-hd"),
    ...SOURCE_STARTER_CHOICES.map(({ shortType }) => opts.assets.sprite(`${shortType}-hd`)),
  ]);
  if (
    backgroundFull.width < PLOT_BACKGROUND_TEXTURE_RECT_PX.w ||
    backgroundFull.height < PLOT_BACKGROUND_TEXTURE_RECT_PX.h
  ) {
    throw new Error("mainscreenBackground.png does not contain the source 1024x768 frame");
  }
  const root = new Container();
  root.label = "sourcePickDragon";
  root.eventMode = "static";
  root.hitArea = new Rectangle(0, 0, layout.screen.w, layout.screen.h);
  root.sortableChildren = true;
  opts.parent.addChild(root);
  const background = pointSprite(new Texture({
    source: backgroundFull.source,
    frame: new Rectangle(0, 0, 1024, 768),
  }));
  background.position.set(
    (layout.screen.w - 512) / 2,
    (layout.screen.h - 384) / 2,
  );
  background.zIndex = -100;
  root.addChild(background);

  const cardWidth = backingTexture.width / 2;
  const cardHeight = backingTexture.height / 2;
  const choices = new Box({
    horizontal: true,
    gap: layout.gap,
    positiveAlignDirection: true,
    roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
  });
  choices.label = "starterChoices";
  let resolve!: (shortType: string) => void;
  const selected = new Promise<string>((doneResolve) => { resolve = doneResolve; });
  let selectionMade = false;
  const centers: Array<{ shortType: string; x: number; y: number }> = [];
  SOURCE_STARTER_CHOICES.forEach((choice, index) => {
    const card = new ButtonSprite({
      normalTexture: backingTexture,
      spriteLabel: `starterBacking:${choice.shortType}`,
    });
    card.label = `starter:${choice.shortType}`;
    const monster = pointSprite(monsterTextures[index]!);
    monster.anchor.set(0);
    monster.scale.set(monster.scale.x * 0.5, monster.scale.y * 0.5);
    const element = makeTtfLabel(


      choice.elementName,
      layout.elementFontSize,
      { outline: false, textureScaleMode: "nearest" },
    );
    element.anchor.set(0);
    const descriptionWidth = cardWidth * 0.95;
    const descriptionHeight = cardHeight * 0.35;
    const descriptionLabel = makeTtfLabel(
      localizedString(opts.strings, `${choice.shortType}ChoiceInfoMessageKey`),
      layout.descriptionFontSize,
      {
        align: "center",
        wordWrapWidth: descriptionWidth,
        outline: false,
        textureScaleMode: "nearest",
      },
    );
    descriptionLabel.anchor.set(0.5, 0);
    descriptionLabel.position.set(descriptionWidth / 2, 0);
    const description = new Container();
    description.label = `starterDescription:${choice.shortType}`;
    description.addChild(descriptionLabel);

    const details = new Box({
      horizontal: false,
      // Source packs toward negative Cocos Y; flipping the direction is the exact Y-down
      // equivalent and is the idiom every other port consumer uses (see XpAwardDisplay). This
      // used to pack negative and then negate each packed offset, which only agreed with the
      // source while `packBox` emitted the running offset as the child's FAR edge — negating a
      // far edge happens to produce the near edge. `packBox` now emits the near edge directly
      // (boxLayout.ts header), so the negation would put each row's BOTTOM at the packed offset
      // and overlap the stack; these three rows have different heights, so it would show.
      gap: layout.innerGap,
      positiveAlignDirection: true,
      roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
    });
    details.label = `starterDetails:${choice.shortType}`;
    details.addBoxChild(monster);
    details.addBoxChild(element);
    details.addBoxChild(description, {
      contentSize: { w: descriptionWidth, h: descriptionHeight },
    });
    details.position.set(
      (cardWidth - details.boxContentSize.w) / 2,
      (cardHeight - details.boxContentSize.h) / 2,
    );
    details.eventMode = "none";
    card.addChild(details);
    card.onPress(() => {
      if (selectionMade) return;
      selectionMade = true;
      root.eventMode = "none";
      resolve(choice.shortType);
    });
    choices.addBoxChild(card, { contentSize: { w: cardWidth, h: cardHeight } });
    centers.push({ shortType: choice.shortType, x: 0, y: 0 });
  });
  choices.position.set(
    (layout.screen.w - choices.boxContentSize.w) / 2,
    layout.choiceCenterY - choices.boxContentSize.h / 2,
  );
  centers.forEach((center, index) => {
    const card = choices.children[index]!;
    center.x = choices.x + card.x + cardWidth / 2;
    center.y = choices.y + card.y + cardHeight / 2;
  });
  root.addChild(choices);

  const band = new Graphics()
    .rect(0, 0, layout.screen.w, layout.titleBand.h)
    .fill({ color: 0, alpha: 180 / 255 });
  band.position.set(0, layout.titleBand.y);
  const title = makeTtfLabel(
    localizedString(opts.strings, "PickDragonKey"),
    layout.titleFontSize,
    { outline: false, textureScaleMode: "nearest" },
  );
  title.anchor.set(0.5);
  title.position.set(layout.screen.w / 2, layout.titleBand.y + layout.titleBand.h / 2);
  root.addChild(band, title);
  opts.onPhase("pick-dragon", { choices: centers });

  const keyboardCleanup = opts.keyboard.register(({ key }) => {
    const index = Number.parseInt(key, 10) - 1;
    const choice = SOURCE_STARTER_CHOICES[index];
    if (choice === undefined || selectionMade) return false;
    selectionMade = true;
    resolve(choice.shortType);
    return true;
  });
  const result = await selected;
  keyboardCleanup();
  root.removeFromParent();
  root.destroy({ children: true });
  return result;
}
