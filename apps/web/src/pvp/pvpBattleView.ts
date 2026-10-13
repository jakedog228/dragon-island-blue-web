import { Container, Graphics, Rectangle, type Ticker } from "pixi.js";
import { createRenderableSpriteNode, makeTtfLabel } from "@dib/renderer";
import { restorePvpBattle, type PlayerChoice, type PvpAction, type PvpBattleSnapshot, type RestoredPvpBattle } from "@dib/engine";
import type { PvpMatchViewV1 } from "@dib/game-protocol";
import type { LoadedGame } from "../loadGame.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { localizedRenderableName } from "../localization.js";
import { pvpChosenTargets, pvpLayout, pvpTargets } from "./pvpBattleModel.js";

/** A two-human exhibition board. Canonical team IDs stay unchanged; only the camera swaps sides. */
export class PvpBattleView extends Container {
  private match: PvpMatchViewV1 | undefined;
  private restored: RestoredPvpBattle | undefined;
  private choice: PlayerChoice | undefined;
  private selected: string[] = [];
  private page = 0;
  private generation = 0;
  private busy = false;
  private rendering = false;
  private pendingButtons = new WeakMap<Container, typeof this.buttons>();
  private readonly layout = pvpLayout(DISPLAY_MODE);
  private buttons: Array<{ action: string; x: number; y: number; w: number; h: number }> = [];
  private feedback: Array<{ node: Container; age: number; y: number }> = [];
  constructor(private readonly game: LoadedGame, private readonly ticker: Ticker,
    private readonly submit: (action: PvpAction) => void, private readonly menu: () => void,
    private readonly failed: (error: unknown) => void) {
    super(); this.label = "pvp-battle"; this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, this.layout.w, this.layout.h);
    for (const type of ["pointerdown", "pointerup", "pointerupoutside", "pointertap", "pointermove"] as const) this.on(type, (e) => e.stopPropagation());
    ticker.add(this.tick);
  }
  get debugState(): Record<string, unknown> {
    const session = this.restored?.session;
    return { matchId: this.match?.matchId, revision: this.match?.revision, you: this.match?.you,
      turn: this.match?.turn, status: this.match?.status, busy: this.busy, rendering: this.rendering,
      choice: this.choice?.slot, targets: this.selected, buttons: this.buttons,
      monsters: session ? ([0, 1] as const).flatMap((team) => session.targetableIdsOf(team).map((id) => ({ id, team,
        shortType: session.shortTypeOf(id), hp: session.hpOf(id), maxHp: session.maxHpOf(id) }))) : [] };
  }
  update(match: PvpMatchViewV1, busy: boolean): void {
    const changed = match.matchId !== this.match?.matchId || match.revision !== this.match?.revision;
    if (!changed && this.busy === busy) return;
    const previousEvents = changed && match.matchId === this.match?.matchId ? this.restored?.events.length : undefined;
    if (changed) {
      if (!match.battle) throw new Error("PvP match is missing its committed battle.");
      // Wire JSON omits absent optional keys; the protocol parser validated every field.
      const restored = restorePvpBattle(this.game.gd, match.battle as PvpBattleSnapshot);
      this.restored = restored; this.choice = undefined; this.selected = []; this.page = 0;
    }
    this.match = match; this.busy = busy;
    void this.draw(previousEvents).catch(this.failed);
  }
  private text(parent: Container, value: string, x: number, y: number, size = this.layout.font, maxWidth = this.layout.w): void {
    const label = makeTtfLabel(value, size, { outline: false });
    if (label.width > maxWidth) label.scale.set(maxWidth / label.width);
    label.position.set(x, y); label.eventMode = "none"; parent.addChild(label);
  }
  private button(parent: Container, name: string, action: string, x: number, y: number, w: number, h: number, onClick: () => void, enabled = true): void {
    const box = new Container(); box.label = `pvp:${action}`; box.position.set(x, y);
    box.addChild(new Graphics().roundRect(0, 0, w, h, h * 0.16).fill(enabled ? 0x324b60 : 0x28333c).stroke({ color: 0x7894a1, width: h * 0.035 }));
    this.text(box, name, w * 0.05, h * 0.22, this.layout.font, w * 0.9);
    box.eventMode = "static"; box.cursor = enabled ? "pointer" : "default";
    box.hitArea = new Rectangle(0, 0, w, h);
    box.on("pointertap", (e) => { e.stopPropagation(); if (enabled && !this.busy && !this.rendering) onClick(); });
    parent.addChild(box); this.pendingButtons.get(parent)?.push({ action, x, y, w, h });
  }
  private redraw(): void { void this.draw().catch(this.failed); }
  private async draw(previousEvents?: number): Promise<void> {
    const generation = ++this.generation, match = this.match, restored = this.restored;
    if (!match || !restored) return;
    this.rendering = true;
    const { session, decision } = restored, l = this.layout;
    const root = new Container(); const buttons: typeof this.buttons = [];
    this.pendingButtons.set(root, buttons);
    try {
    // No background asset is guessed: this new mode has its own shell chrome.
    root.addChild(new Graphics().rect(0, 0, l.w, l.h).fill(0x13232b));
    const mine = match.turn === match.you && match.status === "active";
    const heading = match.status === "ended" ? (match.winner === "draw" ? "Draw" : match.winner === match.you ? "Victory" : "Defeat")
      : this.busy ? "Connecting…" : mine ? "Your turn" : "Opponent’s turn";
    this.text(root, `PvP · ${heading}`, l.margin, l.h * 0.018, l.titleFont, l.w * 0.7);
    this.button(root, "Match menu", "menu", l.w * 0.765, l.h * 0.012, l.w * 0.21, l.buttonH, this.menu);
    const slots = new Map<string, { x: number; y: number }>();
    for (const [row, team] of [match.you === 0 ? 1 : 0, match.you].entries()) {
      const side = team as 0 | 1, top = l.top + row * l.rowH;
      const player = match.players[side];
      this.text(root, `${side === match.you ? "You" : player?.name ?? "Opponent"} · ${player?.source === "official" ? "Official party" : "Offline party"} · ${session.benchCountOf(side)} reserves`, l.margin, top - l.h * 0.034, l.font * 0.86);
      for (const [column, id] of session.targetableIdsOf(side).entries()) {
        const x = l.margin + column * l.cellW, y = top;
        const card = new Container(); card.label = `pvp:monster:${id}`; card.position.set(x, y);
        const chosen = this.selected.includes(id), acting = decision.type === "turn" && decision.actorId === id;
        card.addChild(new Graphics().roundRect(0, 0, l.cellW * 0.95, l.rowH * 0.81, l.h * 0.01)
          .fill(chosen ? 0x41614f : acting ? 0x394733 : 0x253740)
          .stroke({ color: chosen ? 0xb8e998 : acting ? 0xddc675 : 0x536974, width: l.h * 0.004 }));
        const shortType = session.shortTypeOf(id), monster = this.game.gd.monsterByShortType(shortType);
        const sprite = createRenderableSpriteNode({ texture: await this.game.assets.sprite(`${shortType}-hd`), rendererData: monster.rendererData });
        const bounds = sprite.getLocalBounds();
        const scale = Math.min(l.monsterW / bounds.width, l.monsterH * 0.69 / bounds.height);
        sprite.scale.set(scale); sprite.position.set(l.cellW * 0.475 - (bounds.x + bounds.width / 2) * scale, l.h * 0.029 - bounds.y * scale);
        sprite.eventMode = "none"; card.addChild(sprite);
        const name = localizedRenderableName(this.game.strings, [shortType]);
        this.text(card, `${name} · ${session.levelOf(id)}`, l.w * 0.006, l.h * 0.004, l.font * 0.75, l.cellW * 0.89);
        const hp = session.hpOf(id), maxHp = session.maxHpOf(id), hpY = l.rowH * 0.62;
        card.addChild(new Graphics().rect(l.w * 0.007, hpY, l.cellW * 0.88, l.h * 0.013).fill(0x131b21)
          .rect(l.w * 0.007, hpY, l.cellW * 0.88 * Math.max(0, hp / maxHp), l.h * 0.013).fill(0x7abd8d));
        this.text(card, `${Math.ceil(hp)}/${Math.ceil(maxHp)}${session.statusEffectsOf(id).length ? ` · ${session.statusEffectsOf(id).join(", ")}` : ""}`,
          l.w * 0.007, hpY + l.h * 0.015, l.font * 0.67, l.cellW * 0.88);
        slots.set(id, { x: x + l.cellW / 2, y: y + l.rowH * 0.4 });
        card.eventMode = "static"; card.cursor = this.choice ? "pointer" : "default";
        card.on("pointertap", (e) => { e.stopPropagation(); if (!this.choice || this.busy || this.rendering || decision.type !== "turn") return;
          const requirement = pvpTargets(session, decision.actorId, this.choice);
          const pool = requirement.enemies.includes(id) ? requirement.enemies : requirement.friends;
          const count = requirement.enemies.includes(id) ? requirement.enemyCount : requirement.friendCount;
          if (!pool.includes(id) || count === 0) return;
          if (this.selected.includes(id)) this.selected = this.selected.filter((value) => value !== id);
          else { if (this.selected.filter((value) => pool.includes(value)).length >= count) this.selected = this.selected.filter((value) => !pool.includes(value)); this.selected.push(id); }
          this.redraw();
        }); root.addChild(card);
      }
    }
    const queue = session.queueOrder().slice(0, 5).map((id) => `${session.teamOf(id) === match.you ? "You" : "Rival"}: ${localizedRenderableName(this.game.strings, [session.shortTypeOf(id)])} ${Math.ceil(session.timeDelayOf(id))}`);
    this.text(root, queue.join("  ›  "), l.margin, l.h * 0.592, l.font * 0.78, l.w * 0.95);
    if (match.status === "ended") {
      this.text(root, `Match ended · ${match.endReason ?? "defeat"}. Your campaign is unchanged.`, l.margin, l.controlsY, l.font, l.w * 0.95);
      this.button(root, "Return to lobby", "results", l.w * 0.3, l.h * 0.86, l.w * 0.4, l.buttonH, this.menu);
    } else if (decision.type === "turn" && mine) {
      const choice = this.choice;
      if (choice) {
        const requirement = pvpTargets(session, decision.actorId, choice), targets = pvpChosenTargets(requirement, this.selected);
        this.text(root, `${this.abilityName(choice)} · Choose ${requirement.enemyCount} opponent / ${requirement.friendCount} friendly target(s)`, l.margin, l.controlsY - l.h * 0.048, l.font, l.w * 0.95);
        this.button(root, "Back", "targets-back", l.margin, l.controlsY + l.h * 0.04, l.w * 0.3, l.buttonH, () => { this.choice = undefined; this.selected = []; this.redraw(); });
        this.button(root, "Use ability", "targets-submit", l.w * 0.55, l.controlsY + l.h * 0.04, l.w * 0.425, l.buttonH,
          () => { if (targets) this.submit({ type: "ability", actorId: decision.actorId, slot: choice.slot, targets }); }, targets !== undefined);
      } else {
        this.text(root, `${localizedRenderableName(this.game.strings, [session.shortTypeOf(decision.actorId)])} · Choose an ability`, l.margin, l.controlsY - l.h * 0.055, l.font);
        decision.choices.slice(this.page * 4, this.page * 4 + 4).forEach((ability, index) => {
          this.button(root, `${this.abilityName(ability)} · ${ability.activationLength} TU`, ability.slot,
            l.margin + (index % 2) * l.w * 0.48, l.controlsY + Math.floor(index / 2) * l.h * 0.095,
            l.w * 0.46, l.buttonH, () => {
              if (ability.blockReason) { this.text(root, this.game.strings[ability.blockReason] ?? ability.blockReason, l.margin, l.h * 0.64, l.font, l.w * 0.95); return; }
              const requirement = pvpTargets(session, decision.actorId, ability);
              if (requirement.enemyCount === 0 && requirement.friendCount === 0) this.submit({ type: "ability", actorId: decision.actorId, slot: ability.slot, targets: [] });
              else { this.choice = ability; this.selected = []; this.redraw(); }
            });
        });
        this.button(root, "Delay", "delay", l.margin, l.h * 0.935, l.w * 0.22, l.h * 0.05, () => this.submit({ type: "delay", actorId: decision.actorId }));
        if (decision.choices.length > 4) this.button(root, "More abilities", "more", l.w * 0.68, l.h * 0.935, l.w * 0.295, l.h * 0.05,
          () => { this.page = (this.page + 1) % Math.ceil(decision.choices.length / 4); this.redraw(); });
      }
    } else this.text(root, "Waiting for your opponent…", l.margin, l.controlsY, l.titleFont);
    if (this.destroyed || generation !== this.generation) { root.destroy({ children: true }); return; }
    for (const child of this.removeChildren()) child.destroy({ children: true });
    this.feedback = []; this.addChild(root);
    this.buttons = buttons; this.rendering = false;
    if (previousEvents !== undefined) {
      for (const event of restored.events.slice(previousEvents)) {
        if (event.type !== "damageDealt" && event.type !== "healed") continue;
        const position = slots.get(event.target); if (!position) continue;
        const label = makeTtfLabel(`${event.type === "healed" ? "+" : "−"}${Math.ceil(event.amount)}`, l.titleFont);
        label.position.set(position.x, position.y); label.eventMode = "none"; root.addChild(label);
        this.feedback.push({ node: label, age: 0, y: position.y });
      }
    }
    } catch (error) {
      root.destroy({ children: true });
      if (generation === this.generation) this.rendering = false;
      throw error;
    }
  }
  private abilityName(choice: PlayerChoice): string { return localizedRenderableName(this.game.strings, [choice.displayName, choice.abilityPath.split(".").at(-1)!]); }
  private readonly tick = (ticker: Ticker): void => {
    for (const item of this.feedback) {
      item.age += ticker.deltaMS; item.node.y = item.y - this.layout.h * 0.08 * Math.min(1, item.age / 900);
      item.node.alpha = Math.max(0, 1 - item.age / 1200);
    }
  };
  dispose(): void { ++this.generation; this.ticker.remove(this.tick); this.parent?.removeChild(this); this.destroy({ children: true }); }
}
