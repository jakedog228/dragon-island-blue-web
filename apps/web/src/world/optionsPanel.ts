import { Container, type Ticker } from "pixi.js";
import {
  makeTtfLabel,
  minimumHitRectLocal,
  rectContainsPoint,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { AudioPlayer } from "../audio.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { Popup, type PopupButtonSpec } from "../ui/popup.js";
import { showMonsterHatchPopup } from "../ui/monsterHatchPopup.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import {
  loadPortSettings,
  savePortSettings,
  type AudioLevel,
  type PortSettings,
} from "../portSettings.js";
import { optionsLayout } from "./optionsMath.js";
import type { AccountGateway } from "../authority/accountGateway.js";
import {
  activateFullscreenExperience,
  browserFullscreenRuntime,
  fullscreenState,
  shouldOfferFullscreenAction,
} from "../platform/fullscreenShell.js";

const AUDIO_LEVELS: readonly AudioLevel[] = [0, 0.25, 0.5, 0.75, 1];
const SELECTED = 0xffffff;
const UNSELECTED = 0xa6a6a6;

export interface OptionsPanelHandle {
  popup: Popup;
  /** Web-native equivalent of pressing the visible Ok button. */
  requestClose(): void;
  debugState(): Record<string, unknown>;
}

export interface OptionsPanelOpts {
  parent: Container;
  assets: AssetLibrary;
  scale9: Scale9SpritesData;
  strings: LocalizedStrings;
  ticker: Ticker;
  audio: AudioPlayer;
  onClick: () => void;
  onDismiss: () => void;
  /** Source notification stack already has a dimming popup underneath this replacement panel. */
  dimImmediately?: boolean;
  onPresentationChange?: () => void | Promise<void>;
  /**
   * Official online account settings. Present only for a signed-in self-registered account; the
   * scoreboard row is server-owned state, so it is absent offline and for operator-issued invites.
   */
  account?: AccountGateway;
}

interface Choice {
  value: string;
  label: string;
}

/** Source OptionsNode shell with its two exact audio rows and port-specific display/text rows. */
export async function showOptionsPanel(opts: OptionsPanelOpts): Promise<OptionsPanelHandle> {
  let settings = loadPortSettings();
  const initial = { ...settings };
  const content = new Container();
  content.label = "portOptionsContent";
  const layout = optionsLayout(DISPLAY_MODE);
  const rows: Array<{ name: string; label: ReturnType<typeof makeTtfLabel>; controls: Container }> = [];

  const refreshers: Array<() => void> = [];
  const addRow = (
    name: string,
    labelText: string,
    choices: readonly Choice[],
    selected: () => string,
    select: (value: string) => void,
    gap: number,
    sourceButtonLabels = false,
  ) => {
    const rowLabel = makeTtfLabel(`${labelText}:`, layout.fontSize, {
      outlineWidthPt: layout.outlineWidth,
      outlineAlpha: 0.5,
    });
    rowLabel.anchor.set(0, 0.5);
    const controls = new Container();
    const nodes = choices.map((choice) => {
      const label = makeTtfLabel(choice.label, layout.fontSize, {
        outlineWidthPt: layout.outlineWidth,
        outlineAlpha: 0.5,
      });
      label.label = `optionsChoice:${name}:${choice.value}`;
      label.anchor.set(0.5);
      label.eventMode = "static";
      label.cursor = "pointer";
      const localBounds = label.getLocalBounds();
      const contentRect = {
        x: localBounds.x,
        y: localBounds.y,
        w: localBounds.width,
        h: localBounds.height,
      };
      label.hitArea = {
        contains: (x, y) => rectContainsPoint(
          sourceButtonLabels
            ? minimumHitRectLocal(contentRect, label.scale)
            : contentRect,
          { x, y },
        ),
      };
      label.on("pointertap", () => {
        opts.onClick();
        select(choice.value);
        settings = loadPortSettings();
        refreshers.forEach((refresh) => refresh());
      });
      controls.addChild(label);
      return { choice, label };
    });
    let x = 0;
    for (const { label } of nodes) {
      label.position.set(x + label.width / 2, 0);
      x += label.width + gap;
    }
    const refresh = () => {
      const value = selected();
      nodes.forEach(({ choice, label }) => { label.style.fill = choice.value === value ? SELECTED : UNSELECTED; });
    };
    refreshers.push(refresh);
    rows.push({ name, label: rowLabel, controls });
    content.addChild(rowLabel, controls);
  };

  const persist = (patch: Partial<PortSettings>) => {
    settings = { ...settings, ...patch };
    savePortSettings(settings);
  };
  addRow(
    "music",
    localizedString(opts.strings, "MusicVolumeKey"),
    AUDIO_LEVELS.map((value, index) => ({ value: `${value}`, label: `${index}` })),
    () => `${settings.music}`,
    (value) => {
      persist({ music: Number(value) as AudioLevel });
      opts.audio.setLevels({ sound: settings.sound, music: settings.music });
    },
    layout.numberGap,
    true,
  );
  addRow(
    "sound",
    localizedString(opts.strings, "SoundVolumeKey"),
    AUDIO_LEVELS.map((value, index) => ({ value: `${value}`, label: `${index}` })),
    () => `${settings.sound}`,
    (value) => {
      persist({ sound: Number(value) as AudioLevel });
      opts.audio.setLevels({ sound: settings.sound, music: settings.music });
    },
    layout.numberGap,
    true,
  );
  addRow(
    "display",
    "Display",
    [{ value: "iphone", label: "iPhone" }, { value: "ipad", label: "iPad" }],
    () => settings.displayMode,
    (value) => persist({ displayMode: value as PortSettings["displayMode"] }),
    layout.portChoiceGap,
  );
  addRow(
    "text",
    "Text",
    [{ value: "original", label: "Original" }, { value: "modern", label: "Modern" }],
    () => settings.textResolutionMode,
    (value) => persist({ textResolutionMode: value as PortSettings["textResolutionMode"] }),
    layout.portChoiceGap,
  );
  const account = opts.account;
  if (account !== undefined && account.current() !== undefined) {
    // Server-owned, unlike every row above it: the write is optimistic and the gateway reverts the
    // row if the authority rejects it, so `selected()` always reads the gateway rather than a copy.
    addRow(
      "scoreboard",
      // "Scoreboard:" is ~106pt wide and the label column is only controlX - labelX = 70pt, so the
      // full word prints straight through the first choice. Source geometry stays; the word shrinks.
      "Scores",
      [{ value: "public", label: "Public" }, { value: "private", label: "Private" }],
      () => account.current()?.publicScoreboard === true ? "public" : "private",
      (value) => { void account.setPublicScoreboard(value === "public"); },
      layout.portChoiceGap,
    );
  }

  const rowHeight = Math.max(...rows.map((row) => Math.max(row.label.height, row.controls.height)));
  rows.forEach((row, index) => {
    const y = index * (rowHeight + layout.rowGap);
    row.label.position.set(layout.labelX, y + rowHeight / 2);
    row.controls.position.set(layout.controlX, y + rowHeight / 2);
  });
  const bounds = content.getLocalBounds();
  for (const child of content.children) child.position.set(child.position.x - bounds.x, child.position.y - bounds.y);
  refreshers.forEach((refresh) => refresh());
  // A rejected server write rolls the value back after the tap has already been drawn, so the row
  // repaints from the gateway rather than staying on the value the player never actually got.
  //
  // Both halves matter. The gateway outlives this panel, so a subscription that is never released
  // keeps every closed panel's rows alive for the session; and a rollback can resolve during the
  // dismissal animation, after the labels have been destroyed, so the listener also has to go inert
  // the moment teardown begins rather than only when the unsubscribe happens to run.
  let listening = true;
  const unsubscribeAccount = account?.onChange(() => {
    if (!listening) return;
    refreshers.forEach((refresh) => refresh());
  });
  const releaseAccount = (): void => {
    listening = false;
    unsubscribeAccount?.();
  };

  let presentationChangeRequested = false;
  const applyPresentationChange = (): void => {
    if (
      presentationChangeRequested ||
      (settings.displayMode === initial.displayMode &&
        settings.textResolutionMode === initial.textResolutionMode)
    ) return;
    presentationChangeRequested = true;
    queueMicrotask(() => { void opts.onPresentationChange?.(); });
  };
  const buttons: PopupButtonSpec[] = [];
  if (shouldOfferFullscreenAction(fullscreenState(browserFullscreenRuntime()))) {
    buttons.push({
      label: "Fullscreen",
      closesPopup: false,
      onPress: async () => { await activateFullscreenExperience(); },
    });
  }
  buttons.push({
    label: localizedString(opts.strings, "OkButtonKey"),
    onPress: applyPresentationChange,
  });
  let popup!: Popup;
  try {
    popup = await showMonsterHatchPopup({
      parent: opts.parent,
      assets: opts.assets,
      scale9: opts.scale9,
      ticker: opts.ticker,
      zIndex: 90,
      sfx: { onButtonPress: opts.onClick },
    }, {
      content,
      runScaleAction: false,
      ...(opts.dimImmediately === true ? { dimImmediately: true } : {}),
      buttons,
      onDismiss: () => {
        releaseAccount();
        opts.onDismiss();
        applyPresentationChange();
      },
    });
  } catch (error) {
    // The subscription is taken before the card exists, so a failed mount would otherwise leave a
    // listener on a session-lived gateway with no popup that could ever release it.
    releaseAccount();
    throw error;
  }
  return {
    popup,
    requestClose: () => {
      // Also releases directly rather than relying on `onDismiss`: a caller that dismisses the
      // popup by any other route (scene teardown calls `popup.dismiss()` outright) still runs
      // `onDismiss`, but a panel closed here must stop repainting immediately, not one frame later.
      releaseAccount();
      if (popup.isDismissed) return;
      opts.onClick();
      popup.dismiss();
    },
    debugState: () => ({
      open: !popup.isDismissed,
      settings: { ...settings },
      appliesOnClose: settings.displayMode !== initial.displayMode ||
        settings.textResolutionMode !== initial.textResolutionMode,
      rows: rows.map((row) => ({ name: row.name })),
      fullscreenAction: buttons.some(({ label }) => label === "Fullscreen") ? "shown" : "hidden",
      ...(account?.current() === undefined
        ? {}
        : { scoreboard: account.current()?.publicScoreboard === true ? "public" : "private" }),
    }),
  };
}
