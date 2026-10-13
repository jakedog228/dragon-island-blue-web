import type { FixedStage } from "@dib/renderer";
import type { AudioPlayer } from "../audio.js";
import type { KeyboardShortcutRouter } from "../keyboardShortcuts.js";
import type { Container, Ticker } from "pixi.js";
import { PvpActionV1Schema } from "@dib/game-protocol";
import type { PvpClientSetupV1, PvpEntryV1 } from "@dib/game-protocol";
import type { LoadedGame } from "../loadGame.js";
import { PvpClient, PvpClientError } from "./pvpClient.js";
import { PvpBattleView } from "./pvpBattleView.js";
import { pvpRulesMismatch } from "./pvpBattleModel.js";
import { preparePvpAppearance } from "./pvpAppearance.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { PvpMatchController, type PvpControllerState } from "./pvpMatchController.js";
import { showMonsterHatchPopup, buildMonsterHatchMessageContent } from "../ui/monsterHatchPopup.js";
import { PopupHost, type Popup } from "../ui/popup.js";
import { localizedString } from "../localization.js";
import "./pvp.css";

export interface PvpFlowHandle { readonly debugState: Record<string, unknown>; requestBack(): boolean; dispose(): void }
export interface PvpFlowOptions {
  parent: Container; game: LoadedGame; ticker: Ticker;
  stage: FixedStage; audio: AudioPlayer; keyboard: KeyboardShortcutRouter;
  connect: () => Promise<{ client: PvpClient; setup: PvpClientSetupV1 }>;
  entry: () => PvpEntryV1; onClose: () => void;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}

export function showPvpFlow(options: PvpFlowOptions): PvpFlowHandle {
  let closed = false, controller: PvpMatchController | undefined, board: PvpBattleView | undefined;
  let state: PvpControllerState | undefined, localError: unknown, menuOpen = true, code = "", battleStarted = false, finishing = false;
  let nativePopup: Popup | undefined, popupPending = false;
  const popupOwner = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renderedKey: string | undefined;
  let background: Container | undefined;
  const previousFocus = document.activeElement;
  const dialog = element("dialog"); dialog.className = "pvp-dialog"; dialog.setAttribute("aria-label", "Multiplayer PvP");
  document.body.append(dialog);
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  const handle: PvpFlowHandle = {
    get debugState() { return { open: !closed, lobby: menuOpen, match: state?.match ?? null, busy: state?.busy ?? (!controller && !localError),
      error: localError instanceof Error ? localError.message : state?.error?.message ?? null, board: board?.debugState ?? null }; },
    requestBack() { if (battleStarted) { if (!finishing && !nativePopup && !popupPending) board?.requestBack(); } else close(); return true; },
    dispose() {
      if (closed) return; closed = true; clearTimeout(timer); controller?.dispose(); board?.dispose(); nativePopup?.dismiss(); dialog.close(); dialog.remove();
      PopupHost.for(options.parent).dismissOwnedBy(popupOwner);
      background?.destroy({ children: true });
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    },
  };
  function close(): void { if (battleStarted && !finishing) return; handle.dispose(); options.onClose(); }
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); handle.requestBack(); });
  function button(text: string, action: () => void, disabled = false): HTMLButtonElement {
    const node = element("button", text); node.type = "button"; node.disabled = disabled; node.addEventListener("click", action); return node;
  }
  async function showNativeMessage(title: string, message: string, done: () => void): Promise<void> {
    if (closed || nativePopup || popupPending) return;
    popupPending = true;
    try {
      const popup = await showMonsterHatchPopup({ parent: options.parent, assets: options.game.assets,
        scale9: options.game.scale9, ticker: options.ticker, owner: popupOwner,
        sfx: { onButtonPress: () => options.audio.playSfx("click"), onButtonBlocked: () => options.audio.playSfx("notAllowed") },
      }, { title, content: buildMonsterHatchMessageContent(message),
        buttons: [{ label: localizedString(options.game.strings, "OkButtonKey"), onPress: () => {} }],
        onDismiss: () => { nativePopup = undefined; if (!closed) done(); },
      });
      if (closed) popup.dismiss(); else nativePopup = popup;
    } finally { popupPending = false; }
  }
  function finish(): void {
    const match = state?.match;
    if (closed || finishing || match?.status !== "ended") return;
    finishing = true; menuOpen = false; dialog.close();
    nativePopup?.dismiss();
    board?.dispose(); board = undefined;
    const title = match.winner === "draw" ? "Draw" : match.winner === match.you ? "Victory" : "Defeat";
    const message = match.endReason === "forfeit" ? (match.winner === match.you ? "Your opponent surrendered." : "You surrendered.")
      : match.endReason === "timeout" ? (match.winner === match.you ? "Your opponent did not finish their turn in time." : "You did not finish your turn in time.")
      : match.winner === "draw" ? "The match ended in a draw." : match.winner === match.you ? "You won the match." : "You lost the match.";
    void showNativeMessage(title, message, close);
  }
  function fail(error: unknown): void {
    if (closed || finishing) return;
    board?.dispose(); board = undefined; localError = error;
    if (battleStarted) {
      menuOpen = false; dialog.close();
      void showNativeMessage("Connection interrupted", error instanceof Error ? error.message : String(error), () => {
        localError = undefined; void controller?.refresh();
      });
    } else { menuOpen = true; render(); }
  }
  async function connect(): Promise<void> {
    localError = undefined; render();
    try {
      if (!background) {
        const prepared = await preparePvpAppearance(options.game.assets, options.game.scale9, DISPLAY_MODE, dialog);
        if (closed) { prepared.destroy({ children: true }); return; }
        background = prepared; options.parent.addChildAt(background, 0);
        // Above the Arena background, below any PvP battle board.
        options.parent.setChildIndex(background, options.parent.children.length - 1);
      }
      const connection = await options.connect(); if (closed) return;
      controller = new PvpMatchController(connection.client, connection.setup, options.entry, (next) => {
        if (closed) return;
        const old = state?.match;
        state = next;
        // A completed historical match must not reopen the match menu on the next Arena visit.
        if (!battleStarted && next.match?.status === "ended" && !old?.battle) { controller?.newMatch(); return; }
        if (next.match?.battle) { battleStarted = true; menuOpen = false; dialog.close(); }
        if (finishing || localError) { render(); return; }
        const mismatch = next.match && pvpRulesMismatch(connection.setup.logicPackId, next.match);
        if (mismatch) { fail(new PvpClientError(mismatch)); return; }
        if (next.error && next.error instanceof PvpClientError && next.error.details.code !== "UNAVAILABLE" && !next.canRetry) {
          // A refused command must release the presentation's pending intent before rehydration.
          board?.dispose(); board = undefined;
          if (battleStarted && !["STALE_DECISION", "MATCH_ENDED"].includes(next.error.details.code)) {
            fail(next.error); return;
          }
        }
        if (next.match?.battle && !next.error) {
          if (!board) {
            board = new PvpBattleView(options.game, options.stage, options.audio, options.keyboard,
              action => { void controller?.submit(PvpActionV1Schema.parse(action)); }, finish, fail);
            options.parent.addChild(board);
          }
          try { board.update(next.match, next.busy || next.canRetry); } catch (error) { fail(error); }
        } else if (next.match?.battle && board) {
          // Retain the scene during a transport outage; no gameplay executes until commitment.
          try { board.update(next.match, true); } catch (error) { fail(error); }
        }
        render();
      });
      await controller.refresh(); poll();
    } catch (error) { fail(error); }
  }
  function poll(): void {
    clearTimeout(timer);
    if (closed) return;
    timer = setTimeout(() => {
      if (!localError && !document.hidden && (state?.match?.status === "waiting" || state?.match?.status === "active")) {
        void (state?.canRetry ? controller?.retry() : controller?.refresh())?.finally(poll);
      } else poll();
    }, 1500);
  }
  function render(): void {
    if (closed) return;
    if (battleStarted || !menuOpen) { dialog.close(); renderedKey = undefined; return; }
    const match = state?.match, busy = state?.busy ?? !controller, error = localError ?? state?.error;
    const key = JSON.stringify({ connected: !!controller, matchId: match?.matchId, revision: match?.revision,
      busy, retry: state?.canRetry, error: error instanceof Error ? error.message : error });
    // Polling an unchanged revision must not replace focused buttons or a selected invite code.
    if (dialog.open && renderedKey === key) return;
    renderedKey = key;
    // Preserve input focus/caret through connection state updates.
    const focused = dialog.querySelector<HTMLInputElement>("input") === document.activeElement;
    const caret = focused ? (document.activeElement as HTMLInputElement).selectionStart : null;
    dialog.replaceChildren();
    const header = element("div"); header.className = "pvp-dialog__header";
    const titles = element("div"), eyebrow = element("p", "Dragon Island Arena"); eyebrow.className = "pvp-dialog__eyebrow";
    titles.append(eyebrow, element("h2", "Multiplayer PvP"));
    header.append(titles, button("Close", close)); dialog.append(header);
    const intro = element("p", match ? "Exhibition match · Your campaign stays unchanged." : "Challenge a friend with your party. Both teams start at full health. Your campaign and rewards stay unchanged.");
    intro.className = "pvp-dialog__intro"; dialog.append(intro);
    if (match?.players.some((player) => player.source === "offline")) {
      const notice = element("p", "Includes a player-controlled Offline party, not a verified Official save.");
      notice.className = "pvp-dialog__notice"; dialog.append(notice);
    }
    if (error) {
      const alert = element("section"); alert.className = "pvp-dialog__error"; alert.setAttribute("role", "alert");
      alert.append(element("strong", error instanceof Error ? error.message : String(error)));
      if (error instanceof PvpClientError) for (const issue of error.details.issues) {
        const entry = element("p", `${issue.modId ? `${issue.modId} · ` : ""}${issue.path}: ${issue.message}`);
        entry.append(element("br"), element("span", issue.suggestion)); alert.append(entry);
      }
      dialog.append(alert);
      dialog.append(button(controller ? "Reconnect" : "Try connecting again", () => {
        localError = undefined; if (controller) { void controller.refresh(); } else { void connect(); }
      }, state?.busy === true));
    }
    if (state?.canRetry) dialog.append(button("Retry pending action", () => { void controller?.retry(); }, busy));
    if (!controller && !error) dialog.append(element("p", "Connecting to PvP…"));
    if (match) {
      for (const note of match.notes) dialog.append(element("p", note));
      if (match.status === "waiting") {
        dialog.append(element("h3", "Invite ready"), element("p", "Send this code to your opponent, then keep this screen open."));
        const invite = element("output", match.code); invite.className = "pvp-dialog__code"; invite.setAttribute("aria-label", "Invite code"); dialog.append(invite);
        const inviteActions = element("div"); inviteActions.className = "pvp-dialog__button-row";
        inviteActions.append(button("Copy code", () => {
          // Clipboard access may be absent on local HTTP hosts; the selectable code still works.
          if (navigator.clipboard) void navigator.clipboard.writeText(match.code!).catch(() => { invite.focus(); });
          else { const range = document.createRange(); range.selectNodeContents(invite); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
        }));
        inviteActions.append(button("Cancel invite", () => { void controller?.cancel(); }, busy || state?.canRetry));
        dialog.append(element("p", `Expires ${new Date(match.expiresAt).toLocaleTimeString()}. You can return here after closing.`), inviteActions);
      } else {
        const result = match.status === "ended" ? match.winner === "draw" ? "Draw" : match.winner === match.you ? "Victory" : "Defeat" : match.status === "expired" ? "Invite expired" : "Invite cancelled";
        const resultTitle = element("h3", result); resultTitle.className = "pvp-dialog__result";
        dialog.append(resultTitle, element("p", match.endReason ? `Match ended: ${match.endReason}.` : "Create a new invite to play."));
        dialog.append(button("New match", () => { board?.dispose(); board = undefined; localError = undefined; controller?.newMatch(); }, busy));
      }
    } else if (controller) {
      const actions = element("div"); actions.className = "pvp-dialog__actions";
      actions.append(button("Create invite", () => { void controller?.invite(); }, busy || state?.canRetry));
      const form = element("form"), label = element("label", "Invite code"), input = element("input");
      input.value = code; input.maxLength = 8; input.autocomplete = "off"; input.spellcheck = false; input.placeholder = "ABCD2345";
      input.setAttribute("aria-label", "Invite code"); input.addEventListener("input", () => { code = input.value; });
      label.append(input); const join = element("button", "Join match"); join.type = "submit"; join.disabled = busy || state?.canRetry === true;
      form.append(label, join); form.addEventListener("submit", (event) => { event.preventDefault();
        if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code.trim().toUpperCase())) { fail(new Error("Enter the complete 8-character invite code.")); return; }
        localError = undefined; void controller?.join(code);
      }); actions.append(form); dialog.append(actions);
      if (focused) { input.focus(); input.setSelectionRange(caret, caret); }
    }
    if (!dialog.open) dialog.showModal();
  }
  render(); void connect(); return handle;
}
