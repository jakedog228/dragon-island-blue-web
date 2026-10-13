import { setOwnedTexture } from "@dib/renderer";
import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import {
  CONTENT_SCALE_FACTOR,
  makeTtfLabel,
  pointSprite,
  type FixedStage,
} from "@dib/renderer";
import { SAVE_SLOT_IDS, type SaveSlotId } from "@dib/save-protocol";
import type { AudioPlayer } from "../audio.js";
import type {
  KeyboardShortcut,
  KeyboardShortcutHandler,
  KeyboardShortcutRouter,
} from "../keyboardShortcuts.js";
import { isAdvanceShortcut } from "../keyboardShortcuts.js";
import { localizedString } from "../localization.js";
import { MARKER_FELT_FAMILY } from "../localFonts.js";
import { Popup, PopupHost } from "../ui/popup.js";
import {
  buildMonsterHatchMessageBlock,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import type { ImportedResourceCatalog } from "../content/archivePackage.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import type { LoadedGame } from "../loadGame.js";
import type { PlayerGameStateSnapshot } from "../player/gameState.js";
import type { SaveSession, SaveSlotStore } from "../player/saveStore.js";
import { tween } from "../tween.js";
import { showOptionsPanel } from "../world/optionsPanel.js";
import type { AccountGateway } from "../authority/accountGateway.js";
import { SourcePopupMenu, type SourcePopupMenuItem } from "./sourcePopupMenu.js";
import { runSourceNewGameFlow } from "./newGameFlow.js";
import {
  PRELOADER_DOT_INTERVAL_MS,
  PRELOADER_PROGRESS_MAX,
  PRELOADER_REVEAL_DELAY_MS,
  SAVE_CONTINUE_DELAY_MS,
  SOURCE_FADE_TRANSITION_MS,
  STARTUP_LAYOUT,
  normalizeCreditSpacePt,
} from "./startupConstants.js";
import { StartupDiagnostics, type StartupDiagnosticState } from "./startupDiagnostics.js";
import {
  nextPreloaderDots,
  sourceLoadPercentage,
  sourceSaveSelectColumns,
  sourceSaveSlotLabel,
  sourceTitleDestination,
  titlePromptTint,
  type SaveSelectAction,
  type StartupSlotRecord,
} from "./startupMath.js";

export interface StartupLoadTask {
  readonly label: string;
  readonly run: () => Promise<void>;
}

export interface StartupSequenceOptions {
  readonly stage: FixedStage;
  readonly game: LoadedGame;
  readonly resources: ImportedResourceCatalog;
  readonly audio: AudioPlayer;
  readonly keyboard: KeyboardShortcutRouter;
  readonly saveStore: SaveSlotStore;
  readonly loadTasks: readonly StartupLoadTask[];
  /** Exact original `Plot.NewGame -> PickDragonGameFlowEvent` surface when its source assets exist. */
  readonly sourceNewGameIntro: boolean;
  readonly diagnostics?: StartupDiagnostics;
  readonly locale?: string;
  /** Drives source-timed actions when a deterministic browser harness has stopped the Pixi ticker. */
  readonly driveDeterministicTime?: (ms: number) => Promise<void>;
  /**
   * Presentation-only renderer rebuilds can resume an already-selected slot after the normal
   * preload and validation pass without showing title/save selection again.
   */
  readonly autoLaunchSlotId?: SaveSlotId;
  /** Presentation rebuild requested from the save picker returns to that picker, not the title. */
  readonly resumeAtSaveSelect?: boolean;
  /** First half ran on the retired gameplay stage; keep this stage covered until it can reveal. */
  readonly startCovered?: boolean;
  readonly onPresentationChange?: () => void | Promise<void>;
  /** Called after the mounted Pixi preloader has rendered, independent of browser RAF timing. */
  readonly onFirstFrame?: () => void;
  /**
   * Hands the caller a disposer for the scenes this sequence owns. The startup screen lives in
   * this function's own `currentScene`/`sceneCleanups` machinery, not in `SceneCoordinator`, so a
   * shell restart has no other way to retire it *before* Pixi tears the application down. Pixi's
   * `Application.destroy` destroys application plugins (including `TickerPlugin`, which calls
   * `Ticker.destroy()` and nulls `_head`) BEFORE it recursively destroys the stage children, so a
   * child destructor that cancels a ticker-backed action -- `SourcePopupMenu.destroy` aborting its
   * 0.5s dim fade -- would reach `Ticker.remove()` after the ticker is dead and throw
   * "Cannot read properties of null (reading 'next')".
   */
  readonly registerDispose?: (dispose: () => void) => void;
  /**
   * Official online account settings edited by the Options popup. The startup shell reaches the
   * *same* panel the in-world menu does, so without this the scoreboard opt-in would exist on one
   * route and silently not on the other.
   */
  readonly account?: AccountGateway;
}

export interface StartupLaunch {
  readonly saveSession: SaveSession;
  readonly restoredSave?: PlayerGameStateSnapshot;
  readonly newGameStarterShortType?: string;
  /** Completes the second half of the source 0.5-second fade after gameplay is ready. */
  readonly finishTransition: () => Promise<void>;
}

type CreditRow =
  | { readonly type: "title" | "entry"; readonly value: string }
  | { readonly type: "space"; readonly value: number };

let SCREEN = STARTUP_LAYOUT.screen;
registerRuntimeSettingsRefresh(() => {
  SCREEN = STARTUP_LAYOUT.screen;
});
const HALF_FADE_MS = SOURCE_FADE_TRANSITION_MS / 2;

/**
 * Source-shaped PreloaderScene → MainMenuNode → PickSaveSlotNode orchestration. Presentation lives
 * in Cocos point space under the same x2 mount used by battle/world; storage-specific behavior is
 * confined to the supplied SaveSlotStore.
 */
export async function runStartupSequence(opts: StartupSequenceOptions): Promise<StartupLaunch> {
  const diagnostics = opts.diagnostics ?? new StartupDiagnostics();
  const pointRoot = new Container();
  pointRoot.label = "startupPointRoot";
  pointRoot.scale.set(CONTENT_SCALE_FACTOR);
  pointRoot.sortableChildren = true;
  pointRoot.eventMode = "static";
  pointRoot.hitArea = new Rectangle(0, 0, SCREEN.w, SCREEN.h);
  opts.stage.root.sortableChildren = true;
  opts.stage.root.addChild(pointRoot);

  const shade = new Graphics().rect(0, 0, opts.stage.width, opts.stage.height).fill(0x000000);
  shade.label = "startupTransitionShade";
  shade.alpha = opts.startCovered === true ? 1 : 0;
  shade.visible = opts.startCovered === true;
  shade.eventMode = "static";
  shade.zIndex = 100_000;
  opts.stage.root.addChild(shade);

  const records = new Map<SaveSlotId, StartupSlotRecord>();
  const sceneCleanups = new WeakMap<Container, Set<() => void>>();
  const scenePresentations = new WeakMap<Container, Set<() => void>>();
  let currentScene: Container | undefined;
  let disposed = false;
  let launchSettled = false;
  let launching = false;
  let newGameFlowRunning = false;
  let titleMusicUnlocked = false;
  let finishUsed = false;
  let resolveLaunch!: (launch: StartupLaunch) => void;
  let rejectLaunch!: (error: unknown) => void;
  const launchPromise = new Promise<StartupLaunch>((resolve, reject) => {
    resolveLaunch = resolve;
    rejectLaunch = reject;
  });

  (globalThis as Record<string, unknown>)["__DIB_STARTUP_DIAGNOSTICS__"] = diagnostics;

  const click = (): void => {
    if (opts.audio.hasSfx("click")) opts.audio.playSfx("click");
  };
  const registerSceneCleanup = (scene: Container, cleanup: () => void): void => {
    let cleanups = sceneCleanups.get(scene);
    if (cleanups === undefined) {
      cleanups = new Set();
      sceneCleanups.set(scene, cleanups);
    }
    cleanups.add(cleanup);
  };
  const registerScenePresentation = (scene: Container, presentation: () => void): void => {
    let presentations = scenePresentations.get(scene);
    if (presentations === undefined) {
      presentations = new Set();
      scenePresentations.set(scene, presentations);
    }
    presentations.add(presentation);
  };
  const presentScene = (scene: Container): void => {
    const presentations = scenePresentations.get(scene);
    if (presentations === undefined) return;
    scenePresentations.delete(scene);
    for (const presentation of presentations) presentation();
  };
  const registerSceneKeyboard = (
    scene: Container,
    handler: KeyboardShortcutHandler,
  ): void => {
    registerSceneCleanup(
      scene,
      opts.keyboard.register((shortcut) => currentScene === scene && handler(shortcut)),
    );
  };
  const destroyScene = (scene: Container): void => {
    scenePresentations.delete(scene);
    const cleanups = sceneCleanups.get(scene);
    if (cleanups !== undefined) {
      sceneCleanups.delete(scene);
      for (const cleanup of cleanups) cleanup();
    }
    scene.removeFromParent();
    scene.destroy({ children: true });
  };
  /**
   * Retire everything this sequence owns while the Pixi ticker is still alive. Idempotent, and
   * safe to call mid-flight: `replaceScene` and `fail` both no-op afterwards, so an async
   * continuation that outlives the restart cannot resurrect a scene or reject the caller's
   * already-abandoned launch promise.
   */
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (currentScene !== undefined) {
      const scene = currentScene;
      currentScene = undefined;
      destroyScene(scene);
    }
    if (!shade.destroyed) {
      shade.eventMode = "none";
      shade.removeFromParent();
      shade.destroy();
    }
    if (!pointRoot.destroyed) {
      pointRoot.removeFromParent();
      pointRoot.destroy({ children: true });
    }
  };
  opts.registerDispose?.(dispose);

  const currentSlots = (): Pick<StartupDiagnosticState, "slots"> | Record<string, never> => {
    const slots = diagnostics.snapshot().slots;
    return slots === undefined ? {} : { slots };
  };
  const replaceScene = (next: Container, deferPresentation = false): void => {
    if (disposed) {
      next.destroy({ children: true });
      return;
    }
    const previous = currentScene;
    currentScene = next;
    pointRoot.addChild(next);
    if (previous !== undefined) destroyScene(previous);
    if (!deferPresentation) presentScene(next);
  };

  const runTimedTween = async (ms: number, onUpdate: (t: number) => void): Promise<void> => {
    const pending = tween(opts.stage.app.ticker, ms, onUpdate);
    if (opts.driveDeterministicTime !== undefined) {
      await Promise.all([pending, opts.driveDeterministicTime(ms)]);
    } else {
      await pending;
    }
  };
  const wait = (ms: number): Promise<void> => runTimedTween(ms, () => {});
  const fadeToBlack = async (): Promise<void> => {
    shade.visible = true;
    shade.alpha = 0;
    await runTimedTween(HALF_FADE_MS, (t) => { shade.alpha = t; });
  };
  const fadeFromBlack = async (): Promise<void> => {
    shade.visible = true;
    shade.alpha = 1;
    await runTimedTween(HALF_FADE_MS, (t) => { shade.alpha = 1 - t; });
    shade.visible = false;
  };
  const transitionTo = async (build: () => Promise<Container>): Promise<void> => {
    await fadeToBlack();
    const next = await build();
    replaceScene(next, true);
    await fadeFromBlack();
    presentScene(next);
  };

  const launchSlot = async (
    slotId: SaveSlotId,
    state: PlayerGameStateSnapshot | undefined,
    newGameStarterShortType?: string,
  ): Promise<void> => {
    if (launching || launchSettled) return;
    launching = true;
    diagnostics.update({ phase: "launching", selectedSlot: slotId });
    await fadeToBlack();
    if (currentScene !== undefined) {
      destroyScene(currentScene);
      currentScene = undefined;
    }
    pointRoot.removeFromParent();
    pointRoot.destroy({ children: true });
    const session = opts.saveStore.open(slotId, state);
    const finishTransition = async (): Promise<void> => {
      if (finishUsed) return;
      finishUsed = true;
      await fadeFromBlack();
      // Pixi does not detach a display object when destroy() is called. Leaving the transparent
      // full-stage transition Graphics in the stage tree preserves its static event boundary and
      // can make it win later pointer hit tests after a long new-game flow.
      shade.eventMode = "none";
      shade.removeFromParent();
      shade.destroy();
      diagnostics.update({ phase: "complete", selectedSlot: slotId });
    };
    launchSettled = true;
    resolveLaunch({
      saveSession: session,
      ...(state === undefined ? {} : { restoredSave: state }),
      ...(newGameStarterShortType === undefined ? {} : { newGameStarterShortType }),
      finishTransition,
    });
  };

  const beginNewGame = async (slotId: SaveSlotId): Promise<void> => {
    if (!opts.sourceNewGameIntro) {
      await launchSlot(slotId, undefined);
      return;
    }
    if (launching || launchSettled || newGameFlowRunning) return;
    newGameFlowRunning = true;
    try {
      const starter = await runSourceNewGameFlow({
        parent: pointRoot,
        assets: opts.game.assets,
        strings: opts.game.strings,
        audio: opts.audio,
        ticker: opts.stage.app.ticker,
        keyboard: opts.keyboard,
        onPhase: (phase, intro) => diagnostics.update({
          phase: phase === "plot" ? "new-game-plot" : "pick-dragon",
          selectedSlot: slotId,
          intro,
        }),
      });
      await launchSlot(slotId, undefined, starter);
    } finally {
      newGameFlowRunning = false;
    }
  };

  const snapshotRecords = (): StartupSlotRecord[] =>
    SAVE_SLOT_IDS.map((slotId) =>
      records.get(slotId) ?? ({ slotId, exists: false, compatible: true }));
  const updateSlotDiagnostics = (): void => {
    diagnostics.patch({
      slots: snapshotRecords().map((record) => ({
        slotId: record.slotId,
        occupied: record.exists && record.compatible,
        compatible: record.compatible,
        label: sourceSaveSlotLabel(record, opts.game.strings, opts.locale),
      })),
    });
  };
  const loadSlotRecord = async (slotId: SaveSlotId): Promise<void> => {
    const summary = opts.saveStore.summary(slotId);
    if (summary === undefined) {
      records.set(slotId, { slotId, exists: false, compatible: true });
      return;
    }
    if (!summary.compatible) {
      records.set(slotId, {
        slotId,
        exists: true,
        compatible: false,
        updatedAt: summary.updatedAt,
      });
      return;
    }
    const state = await opts.saveStore.loadSlotState(slotId);
    if (state === undefined) {
      records.set(slotId, { slotId, exists: false, compatible: true });
      return;
    }
    const refreshed = opts.saveStore.summary(slotId) ?? summary;
    records.set(slotId, {
      slotId,
      exists: true,
      compatible: true,
      updatedAt: refreshed.updatedAt,
      state,
    });
  };

  const buildTitleScene = async (): Promise<Container> => {
    const scene = new Container();
    scene.label = "sourceTitleScene";
    scene.sortableChildren = true;
    scene.addChild(await startupBackground(opts.game, "mainscreenBackground"));









    const versionLabel = makeTtfLabel(
      `Version ${infoVersion(opts.resources)}`,
      STARTUP_LAYOUT.title.versionFont,
      {
        fontFamily: MARKER_FELT_FAMILY,
        bold: false,





        outlineWidthPt: 1,
        textureScaleMode: "nearest",
      },
    );
    versionLabel.label = "sourceTitleVersion";
    versionLabel.anchor.set(1, 1);
    versionLabel.position.set(
      SCREEN.w - STARTUP_LAYOUT.title.versionInset,
      SCREEN.h - STARTUP_LAYOUT.title.versionInset,
    );
    scene.addChild(versionLabel);








    const prompt = makeTtfLabel(
      localizedString(opts.game.strings, "TouchToContinueKey"),
      STARTUP_LAYOUT.title.promptFont,
      { outlineWidthPt: 2, textureScaleMode: "nearest" },
    );
    prompt.label = "sourceTitlePrompt";
    prompt.anchor.set(0.5, 1);
    prompt.position.set(
      SCREEN.w / 2,
      SCREEN.h - STARTUP_LAYOUT.title.bottomInset,
    );
    prompt.zIndex = -1;
    scene.addChild(prompt);

    let pulseElapsed = 0;
    const pulse = (): void => {
      pulseElapsed += opts.stage.app.ticker.deltaMS;
      prompt.tint = titlePromptTint(pulseElapsed);
    };
    opts.stage.app.ticker.add(pulse);
    registerSceneCleanup(scene, () => opts.stage.app.ticker.remove(pulse));

    const touchLayer = new Graphics()
      .rect(0, 0, SCREEN.w, SCREEN.h)
      .fill({ color: 0x000000, alpha: 0.001 });
    touchLayer.label = "sourceTitleTouchLayer";
    touchLayer.eventMode = "static";
    touchLayer.cursor = "pointer";
    touchLayer.zIndex = 10;
    let touchBegan = false;
    const continueFromTitle = (): void => {
      if (launching || launchSettled) return;
      touchBegan = false;
      touchLayer.eventMode = "none";
      opts.audio.unlock();
      titleMusicUnlocked = true;
      // Browser autoplay permits the same user-activation path from a keydown as from a pointer.
      opts.audio.playMusic(opts.game.assets.audioUrl("Opening1.mp3"), {
        loop: true,
        assetName: "Opening1.mp3",
      });
      const destination = sourceTitleDestination(snapshotRecords());
      void (destination.kind === "slot"
        ? beginNewGame(destination.slotId)
        : transitionTo(buildSaveSelectScene)).catch(fail);
    };
    touchLayer.on("pointerdown", () => { touchBegan = true; });
    touchLayer.on("pointerupoutside", () => { touchBegan = false; });
    touchLayer.on("pointercancel", () => { touchBegan = false; });
    touchLayer.on("pointertap", () => {
      if (!touchBegan || launching || launchSettled) return;
      continueFromTitle();
    });
    scene.addChild(touchLayer);
    registerSceneKeyboard(scene, ({ key }: KeyboardShortcut) => {
      if (!isAdvanceShortcut(key)) return false;
      continueFromTitle();
      return true;
    });

    if (titleMusicUnlocked) {
      opts.audio.playMusic(opts.game.assets.audioUrl("Opening1.mp3"), {
        loop: true,
        assetName: "Opening1.mp3",
      });
    }






    registerScenePresentation(scene, () => {
      diagnostics.update({ phase: "title", ...currentSlots(), message: undefined });
    });
    return scene;
  };

  const buildSaveSelectScene = async (): Promise<Container> => {
    const scene = new Container();
    scene.label = "sourceSaveSelectScene";
    scene.sortableChildren = true;
    scene.addChild(await startupBackground(opts.game, "saveSlotBackground"));
    const columns = sourceSaveSelectColumns(
      snapshotRecords(),
      opts.game.strings,
      opts.locale,
      opts.saveStore.deleteSlot !== undefined,
    );
    const itemColumns = columns.map((column) => column.map(
      (action): SourcePopupMenuItem<SaveSelectAction> => ({
        id: action.kind === "slot" ? action.slotId : action.kind,
        label: action.label,
        value: action,
        ...(action.kind === "slot" && !action.enabled ? { enabled: false } : {}),
        ...(action.kind === "options" ? { autoClose: false } : {}),
      }),
    ));
    let activeOptions: Awaited<ReturnType<typeof showOptionsPanel>> | undefined;
    const menu = await SourcePopupMenu.show({
      parent: scene,
      assets: opts.game.assets,
      scale9: opts.game.scale9,
      ticker: opts.stage.app.ticker,
      title: localizedString(opts.game.strings, "PickSaveSlotKey"),
      columns: itemColumns,
      onClick: click,
      onError: fail,
      onInvoke: async (item) => {
        const action = item.value;
        if (action.kind === "slot") {
          const record = records.get(action.slotId);
          if (action.occupied) {
            await wait(SAVE_CONTINUE_DELAY_MS);
            await launchSlot(action.slotId, record?.state);
          } else {
            await beginNewGame(action.slotId);
          }
          return;
        }
        if (action.kind === "erase") {
          replaceScene(await buildEraseSelectScene());
          return;
        }
        if (action.kind === "credits") {
          replaceScene(await buildCreditsScene());
          return;
        }
        if (action.kind === "options") {
          diagnostics.update({ phase: "options", ...currentSlots(), message: undefined });
          // Options replaces the source menu visually while retaining this scene/background as its
          // owner. Keeping PopupMenu rendered underneath made every save-select label collide with
          // the five Options rows even though the upper popup correctly swallowed input.
          menu.visible = false;
          menu.eventMode = "none";
          try {
            activeOptions = await showOptionsPanel({
              parent: scene,
              assets: opts.game.assets,
              scale9: opts.game.scale9,
              strings: opts.game.strings,
              ticker: opts.stage.app.ticker,
              audio: opts.audio,
              onClick: click,
              dimImmediately: true,
              onDismiss: () => {
                activeOptions = undefined;
                if (!menu.destroyed) {
                  menu.visible = true;
                  menu.eventMode = "static";
                }
                diagnostics.update({
                  phase: "save-select",
                  ...currentSlots(),
                  menu: menu.debugState,
                  message: undefined,
                });
              },
              ...(opts.onPresentationChange === undefined
                ? {}
                : { onPresentationChange: opts.onPresentationChange }),
              ...(opts.account === undefined ? {} : { account: opts.account }),
            });
          } catch (error) {
            if (!menu.destroyed) {
              menu.visible = true;
              menu.eventMode = "static";
            }
            throw error;
          }
          return;
        }
        replaceScene(await buildTitleScene());
      },
    });
    registerScenePresentation(scene, () => menu.present());
    updateSlotDiagnostics();
    // Same rule as the title: the picker's slot buttons are behind the transition shade until the
    // fade completes, so the phase that invites a tap is published when the taps can land.
    registerScenePresentation(scene, () => {
      diagnostics.update({
        phase: "save-select",
        ...currentSlots(),
        menu: menu.debugState,
        message: undefined,
      });
    });
    registerSceneKeyboard(scene, ({ key }: KeyboardShortcut) => {
      if (key !== "escape") return false;
      if (activeOptions !== undefined) {
        activeOptions.requestClose();
        return true;
      }
      void transitionTo(buildTitleScene).catch(fail);
      return true;
    });
    return scene;
  };

  const buildEraseSelectScene = async (): Promise<Container> => {
    const scene = new Container();
    scene.label = "sourceEraseSelectScene";
    scene.sortableChildren = true;
    scene.addChild(await startupBackground(opts.game, "saveSlotBackground"));
    const occupied = snapshotRecords()
      .filter((record) => record.exists && record.compatible && record.state !== undefined);
    const items: SourcePopupMenuItem<
      { kind: "slot"; record: StartupSlotRecord } | { kind: "back" }
    >[] = [
      ...occupied.map((record) => ({
        id: `erase-${record.slotId}`,
        label: sourceSaveSlotLabel(record, opts.game.strings, opts.locale),
        value: { kind: "slot" as const, record },
        autoClose: false,
      })),
      {
        id: "back",
        label: localizedString(opts.game.strings, "BackButtonKey"),
        value: { kind: "back" as const },
      },
    ];
    const menu = await SourcePopupMenu.show({
      parent: scene,
      assets: opts.game.assets,
      scale9: opts.game.scale9,
      ticker: opts.stage.app.ticker,
      title: localizedString(opts.game.strings, "PickEraseSaveSlotKey"),
      columns: [items],
      onClick: click,
      onError: fail,
      onInvoke: async (item) => {
        if (item.value.kind === "back") {
          replaceScene(await buildSaveSelectScene());
          return;
        }
        menu.visible = false;
        menu.eventMode = "none";
        try {
          await showEraseConfirmation(scene, item.value.record);
        } catch (error) {
          if (!menu.destroyed) {
            menu.visible = true;
            menu.eventMode = "static";
          }
          throw error;
        }
      },
    });
    registerScenePresentation(scene, () => menu.present());
    diagnostics.update({
      phase: "erase-select",
      ...currentSlots(),
      menu: menu.debugState,
      message: undefined,
    });
    registerSceneKeyboard(scene, ({ key }: KeyboardShortcut) => {
      if (key !== "escape") return false;
      const popupHost = PopupHost.for(scene);
      if (popupHost.dismissTop()) return true;
      void transitionTo(buildSaveSelectScene).catch(fail);
      return true;
    });
    return scene;
  };

  const showEraseConfirmation = async (
    scene: Container,
    record: StartupSlotRecord,
  ): Promise<void> => {
    diagnostics.update({
      phase: "erase-confirm",
      ...currentSlots(),
      selectedSlot: record.slotId,
      message: undefined,
    });
    const sourceMessage = localizedString(
      opts.game.strings,
      "EraseGameAreYouSureMessageKey",
    );







    const message = buildMonsterHatchMessageBlock(sourceMessage);
    message.root.label = "sourceEraseConfirmationMessage";
    let confirmation!: Popup;



    const backToPick = (): void => {
      void buildSaveSelectScene().then(replaceScene).catch(fail);
    };
    confirmation = await showMonsterHatchPopup({
      parent: scene,
      assets: opts.game.assets,
      scale9: opts.game.scale9,
      ticker: opts.stage.app.ticker,
      sfx: { onButtonPress: click },
    }, {
      title: localizedString(opts.game.strings, "EraseGameAreYouSureTitleKey"),
      content: message.root,
      runScaleAction: false,
      dimImmediately: true,
      buttons: [
        {



          label: localizedString(opts.game.strings, "YesButtonKey"),
          closesPopup: false,
          onPress: async () => {
            try {
              const deleteSlot = opts.saveStore.deleteSlot;
              if (deleteSlot === undefined) {
                throw new Error("This save storage does not allow slot deletion.");
              }
              await deleteSlot.call(opts.saveStore, record.slotId);
              records.set(record.slotId, {
                slotId: record.slotId,
                exists: false,
                compatible: true,
              });
              updateSlotDiagnostics();
              confirmation.dismiss();
            } catch (error) {
              // Port-only branch: native `Saving eraseFileAndBackup:` cannot fail, but a browser or
              // remote store can lose the race. Keep the confirmation up and report it.
              const detail = describe(error);
              message.setText(`${sourceMessage}\n${detail}`);
              diagnostics.update({
                phase: "erase-confirm",
                ...currentSlots(),
                selectedSlot: record.slotId,
                message: detail,
              });
            }
          },
        },
        {
          label: localizedString(opts.game.strings, "NoButtonKey"),
          closesPopup: false,
          onPress: () => { confirmation.dismiss(); },
        },
      ],
      onDismiss: backToPick,
    });
  };

  const buildCreditsScene = async (): Promise<Container> => {
    const scene = new Container();
    scene.label = "sourceCreditsScene";
    scene.sortableChildren = true;
    scene.addChild(await startupBackground(opts.game, "mainscreenBackground", 0x646464));
    const rows = parseCredits(opts.resources.plist("Credits.plist"));
    const column = new Container();
    column.label = "sourceCreditsColumn";
    let y = 0;
    for (const row of rows) {
      if (row.type === "space") {
        y += normalizeCreditSpacePt(row.value, DISPLAY_MODE);
        continue;
      }
      // Both source row types pass through NSBundle localization. Entry names render literally
      // because the platform returns the key itself when no localization value exists.
      const text = opts.game.strings[row.value] ?? row.value;
      const label = makeTtfLabel(
        text,
        row.type === "title"
          ? STARTUP_LAYOUT.credits.titleFont
          : STARTUP_LAYOUT.credits.entryFont,
        { outlineWidthPt: 2, textureScaleMode: "nearest" },
      );
      label.anchor.set(0.5, 0);
      label.position.set(SCREEN.w / 2, y);
      column.addChild(label);
      y += label.height;
    }
    column.position.y = SCREEN.h;
    scene.addChild(column);
    const durationMs = rows.length * 1_000;
    const travel = SCREEN.h + y;
    const controller = new AbortController();
    void tween(
      opts.stage.app.ticker,
      durationMs,
      (t) => { column.position.y = SCREEN.h - travel * t; },
      (t) => t,
      controller.signal,
    ).then(() => {
      if (!controller.signal.aborted && currentScene === scene) replaceSceneSyncTitle();
    });
    registerSceneCleanup(scene, () => controller.abort());
    const touch = new Graphics()
      .rect(0, 0, SCREEN.w, SCREEN.h)
      .fill({ color: 0, alpha: 0.001 });
    touch.eventMode = "static";
    touch.cursor = "pointer";
    touch.zIndex = 100;
    touch.on("pointertap", () => {
      controller.abort();
      replaceSceneSyncTitle();
    });
    scene.addChild(touch);
    registerSceneKeyboard(scene, ({ key }: KeyboardShortcut) => {
      if (key !== "escape" && !isAdvanceShortcut(key)) return false;
      controller.abort();
      replaceSceneSyncTitle();
      return true;
    });
    registerScenePresentation(scene, () => {
      diagnostics.update({ phase: "credits", ...currentSlots(), message: undefined });
    });
    return scene;
  };

  const replaceSceneSyncTitle = (): void => {
    void transitionTo(buildTitleScene).catch(fail);
  };

  function fail(error: unknown): void {
    // A disposed sequence has already been abandoned by its owner; its launch promise is never
    // awaited again, so surfacing a late teardown rejection would only add a phantom page error.
    if (disposed) {
      console.warn("startup sequence failed after disposal", error);
      return;
    }
    diagnostics.update({ phase: "error", message: describe(error) });
    if (!launchSettled) {
      launchSettled = true;
      rejectLaunch(error);
    } else {
      console.error("startup sequence failed after launch", error);
      queueMicrotask(() => { throw error; });
    }
  }

  try {
    diagnostics.update({ phase: "preloader" });
    const preloader = await buildPreloaderScene(opts, diagnostics);
    registerSceneCleanup(preloader.scene, preloader.dispose);
    replaceScene(preloader.scene);
    const slotTasks: StartupLoadTask[] = SAVE_SLOT_IDS.map((slotId) => ({
      label: `save preview ${slotId}`,
      run: () => loadSlotRecord(slotId),
    }));
    await preloader.run([...opts.loadTasks, ...slotTasks]);
    updateSlotDiagnostics();
    if (opts.autoLaunchSlotId !== undefined) {
      const record = records.get(opts.autoLaunchSlotId);
      if (record === undefined) {
        throw new Error(`save preview ${opts.autoLaunchSlotId} was not loaded`);
      }
      await launchSlot(opts.autoLaunchSlotId, record.state);
    } else if (opts.resumeAtSaveSelect === true) {
      if (opts.startCovered === true) {
        const next = await buildSaveSelectScene();
        replaceScene(next, true);
        await fadeFromBlack();
        presentScene(next);
      } else {
        await transitionTo(buildSaveSelectScene);
      }
    } else {
      if (opts.startCovered === true) {
        const next = await buildTitleScene();
        replaceScene(next, true);
        await fadeFromBlack();
        presentScene(next);
      } else {
        await transitionTo(buildTitleScene);
      }
    }
  } catch (error) {
    fail(error);
  }

  return launchPromise;
}

async function buildPreloaderScene(
  opts: StartupSequenceOptions,
  diagnostics: StartupDiagnostics,
): Promise<{
  scene: Container;
  run(tasks: readonly StartupLoadTask[]): Promise<void>;
  dispose(): void;
}> {
  const scene = new Container();
  scene.label = "sourcePreloaderScene";
  scene.sortableChildren = true;
  const background = await startupBackground(opts.game, "mainscreenBackground");
  background.visible = false;
  scene.addChild(background);

  const loading = makeTtfLabel(
    localizedString(opts.game.strings, "LoadingKey"),
    STARTUP_LAYOUT.preloader.labelFont,
    {
      outlineWidthPt: STARTUP_LAYOUT.preloader.outlineWidth,
      textureScaleMode: "nearest",
    },
  );
  loading.label = "sourcePreloaderLoadingLabel";
  loading.anchor.set(0.5, 1);
  loading.position.set(SCREEN.w / 2, SCREEN.h - STARTUP_LAYOUT.preloader.bottomInset);
  loading.visible = false;
  scene.addChild(loading);

  const dots = makeTtfLabel("", STARTUP_LAYOUT.preloader.dotsFont, {
    outlineWidthPt: STARTUP_LAYOUT.preloader.outlineWidth,
    textureScaleMode: "nearest",
  });
  dots.label = "sourcePreloaderProgressLabel";
  dots.anchor.set(0, 1);
  dots.position.set(loading.x + loading.width / 2, loading.y);
  dots.visible = false;
  scene.addChild(dots);

  let revealElapsed = 0;
  const reveal = (): void => {
    revealElapsed += opts.stage.app.ticker.deltaMS;
    if (revealElapsed < PRELOADER_REVEAL_DELAY_MS) return;
    background.visible = true;
    loading.visible = true;
    dots.visible = true;
    opts.stage.app.ticker.remove(reveal);
    // The bridge must survive the source preloader's initial hidden interval. Render its
    // replacement before retiring it; a browser RAF poll can miss this scene entirely.
    opts.stage.app.render();
    opts.onFirstFrame?.();
  };
  opts.stage.app.ticker.add(reveal);

  let dotElapsed = 0;
  let dotCount = 0;
  let percentage = 0;
  let switchedToLongLabel = false;
  const updateDots = (): void => {
    dotElapsed += opts.stage.app.ticker.deltaMS;
    while (dotElapsed >= PRELOADER_DOT_INTERVAL_MS) {
      dotElapsed -= PRELOADER_DOT_INTERVAL_MS;
      if (percentage <= 0) {
        const next = nextPreloaderDots(dotCount);
        dotCount = next.dotCount;
        dots.text = next.text;
      } else {
        if (!switchedToLongLabel) {
          switchedToLongLabel = true;
          loading.text = localizedString(
            opts.game.strings,
            "First-Time Loading On 3GS May Take A While",
          );
          dots.anchor.set(0.5, 1);
          dots.position.set(
            SCREEN.w / 2,
            loading.y - loading.height - STARTUP_LAYOUT.preloader.progressGap,
          );
        }
        dots.text = ` ${Math.trunc(percentage)}%`;
      }
      diagnostics.patch({ dots: dots.text });
    }
  };
  opts.stage.app.ticker.add(updateDots);

  return {
    scene,
    dispose: () => {
      opts.stage.app.ticker.remove(reveal);
      opts.stage.app.ticker.remove(updateDots);
    },
    run: async (tasks) => {
      if (tasks.length === 0) throw new Error("startup preloader requires at least one load task");
      const count = tasks.length;
      for (const [index, task] of tasks.entries()) {
        diagnostics.update({
          phase: "preloader",
          task: { index, count, label: task.label, percentage },
          dots: dots.text,
        });
        await task.run();
        const fraction = (index + 1) / count;
        percentage = sourceLoadPercentage(fraction);
        diagnostics.update({
          phase: "preloader",
          task: { index: index + 1, count, label: task.label, percentage },
          dots: dots.text,
        });
      }
      if (percentage !== PRELOADER_PROGRESS_MAX) {
        throw new Error(`startup preloader ended at unexpected percentage ${percentage}`);
      }
    },
  };
}

async function startupBackground(game: LoadedGame, key: string, tint?: number): Promise<Sprite> {
  const full = await game.assets.sprite(key);
  const rect = STARTUP_LAYOUT.background.textureRectPx;
  if (full.width < rect.w || full.height < rect.h) {
    throw new Error(`${key} is ${full.width}x${full.height}; source crop requires ${rect.w}x${rect.h}`);
  }
  const texture = new Texture({
    source: full.source,
    frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
  });
  const sprite = pointSprite(texture);
  setOwnedTexture(sprite, sprite.texture);
  sprite.label = `sourceStartupBackground:${key}`;
  sprite.position.set(
    (SCREEN.w - STARTUP_LAYOUT.background.sizePt.w) / 2,
    (SCREEN.h - STARTUP_LAYOUT.background.sizePt.h) / 2,
  );
  if (tint !== undefined) sprite.tint = tint;
  sprite.zIndex = -100;
  return sprite;
}

function infoVersion(resources: ImportedResourceCatalog): string {
  const value = resources.plist("Info.plist");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Info.plist must be a dictionary");
  }
  const record = value as Readonly<Record<string, unknown>>;
  const version = record["CFBundleShortVersionString"] ?? record["CFBundleVersion"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("Info.plist requires CFBundleShortVersionString or CFBundleVersion");
  }
  return version;
}

function parseCredits(value: unknown): CreditRow[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Credits.plist must be a non-empty array");
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`Credits.plist row ${index} is not a dictionary`);
    }
    const record = entry as Record<string, unknown>;
    const type = record["type"];
    const rowValue = record["value"];
    if (
      type === "space" &&
      typeof rowValue === "number" &&
      Number.isFinite(rowValue) &&
      rowValue > 0
    ) {
      return { type, value: rowValue };
    }
    if (
      (type === "title" || type === "entry") &&
      typeof rowValue === "string" &&
      rowValue.length > 0
    ) {
      return { type, value: rowValue };
    }
    throw new Error(`Credits.plist row ${index} has invalid type/value`);
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
