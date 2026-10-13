import { Container } from "pixi.js";
import type { FixedStage } from "@dib/renderer";
import { buildPlayerChoices, type PvpAction, type PvpBattleSnapshot } from "@dib/engine";
import type { PvpMatchViewV1 } from "@dib/game-protocol";
import type { LoadedGame } from "../loadGame.js";
import type { AudioPlayer } from "../audio.js";
import type { KeyboardShortcutRouter } from "../keyboardShortcuts.js";
import { BattleNode } from "../battle/battleNode.js";
import { combatBackgroundSpriteKey } from "../displayMode.js";
import { PvpPlayback } from "./pvpPlayback.js";

/** PvP owns transport only. The ordinary BattleNode owns every combat visual and interaction. */
export class PvpBattleView extends Container {
  private match: PvpMatchViewV1 | undefined;
  private playback: PvpPlayback | undefined;
  private battle: BattleNode | undefined;
  private busy = false;
  private rendering = false;
  constructor(private readonly game: LoadedGame, private readonly stage: FixedStage,
    private readonly audio: AudioPlayer, private readonly keyboard: KeyboardShortcutRouter,
    private readonly submit: (action: PvpAction) => void, private readonly ended: () => void,
    private readonly failed: (error: unknown) => void) { super(); this.label = "pvp-battle"; }

  requestBack(): void { this.battle?.requestMultiplayerBack(); }
  /** BattleNode mounts as an ordinary scene on stage.root, below the director popup band that hosts
   * this Arena lobby. While a battle is shown, hide that host so it neither covers the battle nor
   * swallows its input; the popups BattleNode routes into the band stay above it. */
  private coverHost(covered: boolean): void { if (this.parent && !this.parent.destroyed) this.parent.visible = !covered; }
  private dropBattle(): void { this.coverHost(false); this.battle?.destroy(); this.battle = undefined; }
  /** Read-only current decision for the demo driver; replay's initial decision is historical. */
  get restored() {
    const restored = this.playback?.restored, state = this.battle?.renderGameState();
    const actorId = state?.activeActorId;
    if (!restored || typeof actorId !== "string" ||
      (state?.presentation as { state: string } | undefined)?.state !== "awaitingPlayerChoice") return restored;
    return { ...restored, decision: { type: "turn" as const, team: restored.session.teamOf(actorId), actorId,
      choices: buildPlayerChoices(this.game.gd, restored.session.shortTypeOf(actorId)) } };
  }
  get debugState(): Record<string, unknown> {
    return { ...this.battle?.renderGameState(), renderer: "BattleNode", matchId: this.match?.matchId,
      revision: this.match?.revision, you: this.match?.you, turn: this.match?.turn, status: this.match?.status,
      busy: this.busy || this.playback?.busy === true, rendering: this.rendering,
      commandCursor: this.playback?.commandCursor,
      adapters: [...(this.playback?.restored.extensions ?? [])].map(([rulesId, extension]) => ({ rulesId, state: extension.state?.() })),
    };
  }
  update(match: PvpMatchViewV1, busy: boolean): void {
    this.busy = busy;
    if (this.match?.matchId !== match.matchId) { this.dropBattle(); this.playback?.dispose(); this.playback = undefined; }
    this.match = match;
    if (this.playback) {
      this.playback.inputBlocked = busy;
      this.playback.update(match);
      if (match.status === "ended" && match.endReason !== "defeat") this.ended();
      return;
    }
    if (match.status === "ended") { this.ended(); return; }
    if (!match.battle || match.status !== "active") return;
    if (match.battle.adapters?.length) throw new Error("Gameplay mods are disabled in PvP.");
    this.playback = new PvpPlayback(this.game.gd, match, [], this.submit,
      () => this.submit({ type: "forfeit" }), this.ended, match.battle.commands.length === 0);
    this.playback.inputBlocked = busy;
    const you = match.you, opponent = you === 0 ? 1 : 0;
    this.rendering = true;
    this.battle = new BattleNode({ stage: this.stage, game: this.game, audio: this.audio, keyboard: this.keyboard,
      multiplayer: this.playback,
      encounter: { backgroundKey: combatBackgroundSpriteKey("ArenaCombat.png"), allowRetreat: false,
        blockCapture: true, blockSaveMe: true,
        playerTeam: (match.battle as PvpBattleSnapshot).teams[you].map(member => ({ ...member })),
        enemyTeam: (match.battle as PvpBattleSnapshot).teams[opponent].map(member => ({ ...member })),
      },
      playerState: { profile: this.playback.profile, collection: { hasCapturedSimpleType: () => true } },
      onReady: () => {
        if (this.destroyed) return;
        this.rendering = false;
        this.coverHost(true);
        this.battle?.setSceneVisible(true);
        this.battle?.notifyEnterTransitionDidFinish();
      },
    });
    void this.battle.start(0).catch(error => { if (!this.destroyed) { this.rendering = false; this.coverHost(false); this.failed(error); } });
  }
  dispose(): void { this.playback?.dispose(); this.dropBattle(); this.destroy({ children: true }); }
}
