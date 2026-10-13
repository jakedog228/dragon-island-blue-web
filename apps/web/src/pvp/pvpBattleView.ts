import { resolvePvpClientAdapters, type PvpClientAdapter } from "./pvpAdapters.js";
import { Container, Graphics, Rectangle, type Ticker } from "pixi.js";
import { createRenderableSpriteNode, makeTtfLabel, Scale9, ProgressBar, hpTint, parseScale9Rect, OUTLINE_FADE_ALPHA } from "@dib/renderer";
import { prepareMenuButton2 } from "../ui/menuButton2.js";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
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
  private adapters: readonly PvpClientAdapter[] = [];
  private adapterMenu = false;
  private customAdapter: string | undefined;
  private extensionCleanup: (() => void) | undefined;
  private generation = 0;
  private busy = false;
  private rendering = false;
  private pendingButtons = new WeakMap<Container, typeof this.buttons>();
  private pendingChrome = new WeakMap<Container, Promise<void>[]>();
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
      adapters: this.adapters.map((adapter) => ({ rulesId: adapter.rules.rulesId, state: this.restored?.extensions.get(adapter.rules.rulesId)?.state?.() })),
      adapterMenu: this.adapterMenu,
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
      this.adapters = resolvePvpClientAdapters(match.battle.adapters ?? []);
      const restored = restorePvpBattle(this.game.gd, match.battle as PvpBattleSnapshot, this.adapters.map((adapter) => adapter.rules));
      this.adapterMenu = false; this.customAdapter = undefined;
      this.restored = restored; this.choice = undefined; this.selected = []; this.page = 0;
    }
    this.match = match; this.busy = busy;
    void this.draw(previousEvents).catch(this.failed);
  }
  private text(parent: Container, value: string, x: number, y: number, size = this.layout.font, maxWidth = this.layout.w): void {
    const label = makeTtfLabel(value, size, { outline: true, outlineWidthPt: this.layout.h * 0.005, outlineAlpha: OUTLINE_FADE_ALPHA });
    if (label.width > maxWidth) label.scale.set(maxWidth / label.width);
    label.position.set(x, y); label.eventMode = "none"; parent.addChild(label);
  }
  private button(parent: Container, name: string, action: string, x: number, y: number, w: number, h: number, onClick: () => void, enabled = true): void {
    const box = new Container(); box.label = `pvp:${action}`; box.position.set(x, y);
    const label = makeTtfLabel(name, Math.min(this.layout.font, h * 0.54), { outline: true, outlineWidthPt: this.layout.h * 0.004 });
    if (label.width > w * 0.88) label.scale.set(w * 0.88 / label.width);
    label.position.set((w - label.width) / 2, (h - label.height) / 2);
    const cut = parseScale9Rect(this.game.scale9["MenuButton2"]!.contentRect);
    this.pendingChrome.get(parent)!.push(prepareMenuButton2({ assets: this.game.assets, scale9: this.game.scale9, label,
      backgroundContentSize: { w: Math.max(0, w - cut.x * 2), h: Math.max(0, h - cut.y * 2) }, backgroundPosition: { x: 0, y: 0 },
    }).then(prepared => { box.addChild(prepared.node); box.alpha = enabled ? 1 : 0.5; }));
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
    this.extensionCleanup?.(); this.extensionCleanup = undefined;
    const { session, decision } = restored, l = this.layout;
    const root = new Container(); const buttons: typeof this.buttons = [];
    this.pendingButtons.set(root, buttons);
    const chrome: Promise<void>[] = []; this.pendingChrome.set(root, chrome);
    let mountExtension: (() => () => void) | undefined;
    try {
    // An Arena exhibition uses the existing Arena scenery and shared popup/menu artwork.
    root.addChild(sourceFullscreenSprite(await this.game.assets.sprite("ArenaCombat"), DISPLAY_MODE, "ArenaCombat"));
    const controls = await Scale9.fromConfig(this.game.scale9, "PopupBackgroundCompactDark", this.game.assets);
    controls.setContentSize(l.w, l.h * 0.37); controls.position.set(0, l.h * 0.63); controls.eventMode = "none"; root.addChild(controls);
    const general = await this.game.assets.atlas("General-hd");
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
        card.hitArea = new Rectangle(0, 0, l.cellW * 0.95, l.rowH * 0.81);
        const chosen = this.selected.includes(id), acting = decision.type === "turn" && decision.actorId === id;
        const frame = await Scale9.fromConfig(this.game.scale9, "PopupBackgroundCompactDark", this.game.assets);
        frame.setContentSize(l.cellW * 0.95, l.rowH * 0.81); frame.eventMode = "none"; card.addChild(frame);
        if (chosen || acting) card.addChild(new Graphics().roundRect(0, 0, l.cellW * 0.95, l.rowH * 0.81, l.h * 0.01)
          .stroke({ color: chosen ? 0xffefaa : 0xd7b463, width: l.h * 0.006 }));
        const shortType = session.shortTypeOf(id), monster = this.game.gd.monsterByShortType(shortType);
        const sprite = createRenderableSpriteNode({ texture: await this.game.assets.sprite(`${shortType}-hd`), rendererData: monster.rendererData });
        const bounds = sprite.getLocalBounds();
        const scale = Math.min(l.monsterW / bounds.width, l.monsterH * 0.69 / bounds.height);
        sprite.scale.set(scale); sprite.position.set(l.cellW * 0.475 - (bounds.x + bounds.width / 2) * scale, l.h * 0.029 - bounds.y * scale);
        sprite.eventMode = "none"; card.addChild(sprite);
        const name = localizedRenderableName(this.game.strings, [shortType]);
        this.text(card, `${name} · ${session.levelOf(id)}`, l.w * 0.006, l.h * 0.004, l.font * 0.75, l.cellW * 0.89);
        const hp = session.hpOf(id), maxHp = session.maxHpOf(id), hpY = l.rowH * 0.62;
        const hpBack = general.textures["monsterHpBarBack.png"], hpFore = general.textures["monsterHpBar.png"];
        if (!hpBack || !hpFore) throw new Error("PvP requires the standard monster HP bar frames");
        const bar = new ProgressBar({ backgroundTexture: hpBack, foregroundTexture: hpFore, labelFontFile: null, max: maxHp });
        bar.setRatio(hp / maxHp); bar.setTint(hpTint(hp, maxHp)); bar.update(0); bar.scale.set(l.cellW * 0.88 / bar.contentWidth);
        bar.position.set(l.w * 0.007, hpY); bar.eventMode = "none"; card.addChild(bar);
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
      if (this.adapterMenu) {
        const context = { game: this.game, battle: restored, turn: decision, you: match.you };
        const send = (adapter: PvpClientAdapter, command: string, input: import("@dib/engine").PvpIntent) => {
          if (this.busy || this.rendering || generation !== this.generation || this.match?.revision !== match.revision || this.destroyed) return;
          this.submit({ type: "adapter", actorId: decision.actorId, rulesId: adapter.rules.rulesId, command, input });
        };
        const custom = this.adapters.find((adapter) => adapter.rules.rulesId === this.customAdapter);
        if (custom?.mount && !this.busy) {
          mountExtension = () => custom.mount!({ ...context, root, width: l.w, height: l.h, controlsTop: l.controlsY,
            targets: slots, submit: (command, input) => send(custom, command, input),
            back: () => { if (generation !== this.generation || this.destroyed) return; this.customAdapter = undefined; this.redraw(); } });
        } else {
          const actions = this.adapters.flatMap((adapter) => [
            ...(adapter.controls?.(context) ?? []).map((control) => ({
              id: `${adapter.rules.rulesId}:${control.id}`, label: control.label, disabled: control.disabled,
              run: () => send(adapter, control.command, control.input),
            })),
            ...(adapter.mount ? [{ id: `${adapter.rules.rulesId}:custom`, label: adapter.label ?? "Custom controls", disabled: false,
              run: () => { this.customAdapter = adapter.rules.rulesId; this.redraw(); } }] : []),
          ]);
          this.text(root, actions.length ? "Mod actions" : "No mod actions for this monster", l.margin, l.controlsY - l.h * 0.055, l.font);
          actions.slice(this.page * 4, this.page * 4 + 4).forEach((action, index) => this.button(root, action.label, `adapter:${action.id}`,
            l.margin + (index % 2) * l.w * 0.48, l.controlsY + Math.floor(index / 2) * l.h * 0.095,
            l.w * 0.46, l.buttonH, action.run, !action.disabled));
          if (actions.length > 4) this.button(root, "More actions", "adapter-more", l.w * 0.68, l.h * 0.935, l.w * 0.295, l.h * 0.05,
            () => { this.page = (this.page + 1) % Math.ceil(actions.length / 4); this.redraw(); });
        }
        this.button(root, "Back", "adapter-back", l.margin, l.h * 0.935, l.w * 0.22, l.h * 0.05,
          () => { this.adapterMenu = false; this.customAdapter = undefined; this.page = 0; this.redraw(); });
      } else if (choice) {
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
        if (this.adapters.some((adapter) => adapter.controls || adapter.mount)) this.button(root, "Mod actions", "adapter-menu", l.modButton.x, l.modButton.y, l.modButton.w, l.modButton.h,
          () => { this.adapterMenu = true; this.page = 0; this.redraw(); });
        if (decision.choices.length > 4) this.button(root, "More abilities", "more", l.w * 0.68, l.h * 0.935, l.w * 0.295, l.h * 0.05,
          () => { this.page = (this.page + 1) % Math.ceil(decision.choices.length / 4); this.redraw(); });
      }
    } else this.text(root, "Waiting for your opponent…", l.margin, l.controlsY, l.titleFont);
    await Promise.all(chrome);
    if (this.destroyed || generation !== this.generation) { root.destroy({ children: true }); return; }
    for (const child of this.removeChildren()) child.destroy({ children: true });
    this.feedback = []; this.addChild(root);
    this.buttons = buttons; this.rendering = false;
    this.extensionCleanup = mountExtension?.();
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
  dispose(): void { this.extensionCleanup?.(); this.extensionCleanup = undefined; ++this.generation; this.ticker.remove(this.tick); this.parent?.removeChild(this); this.destroy({ children: true }); }
}
