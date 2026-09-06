


































import { Container, Sprite, type Ticker, type Texture } from "pixi.js";
import { pointSprite, CONTENT_SCALE_FACTOR, type AssetLibrary, type ParticleAsset } from "@dib/renderer";
import type { StatusEffect } from "@dib/engine";
import { tween, easeElasticOut, shakenOffset } from "../tween.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import {
  applyStatusCountDelta,
  cocosContentFractionToPixiLocalOffset,
  statusDriftOffset,
  statusAnchorFraction,
  statusSpawnIntervalMs,
  statusDriftScaleDurationMs,
  statusFadeDelayMs,
  statusFadeDurationMs,
  paralyzeBoltLayout,
  STATUS_SPAWN_TARGET_SCALE,
  PARALYZE_SHAKE_MS,
  PARALYZE_SHAKE_OFFSET,
  type Point,
} from "./statusOverlayMath.js";
import { PoisonStatusEmitter } from "./poisonStatusEmitter.js";

/** Resolves the two Pixi-side anchor points this subsystem needs per living (battleNode.ts wires
 *  this from `EnemyTeamDisplay`/`FriendlyTeamDisplay`). Both no-op-return for an unknown/removed
 *  id, mirroring this UI's established "stale id is expected, not an error" convention
 *  (`FriendlyTeamDisplay.notifyHp`, `AbilityRenderer`'s `TargetDisplayArea` doc). */
export interface StatusOverlayHost {
  /** `LivingDisplay.statusEffectParent` (§1) — `EnemyMonsterDisplay.monsterNode` /
   *  `FriendlyMonsterDisplay.monsterSprite`. */
  monsterSpriteOf(id: string): Sprite | null;
  /** Inserts `node` as a sibling of `id`'s monster sprite, ordered to paint BEHIND it (this file's
   *  header). Returns false if `id` is unknown (caller should treat like any other stale-id no-op). */
  attachBehindMonster(id: string, node: Container): boolean;
}

interface OverlayHandle {
  /** Instant teardown (see header — the original never fades these). */
  stop(): void;
  /** Poison-only diagnostic: a mounted holder is not proof that it emitted. */
  particleCount?(): number;
}

/**
 * Mounts a holder `Container` as a child of `host` (`monsterNode`/`monsterSprite`) at the given
 * Cocos content-fraction anchor.
 *
 * Units: a Pixi child's `.position` is in its PARENT's local pre-transform units — `host`'s local
 * unit is raw "-hd" pixels (its texture's native size), since `host.scale` (the 1/CSF fold x the
 * monster's own scale) is what converts raw units to on-screen points. The anchor offset is
 * therefore computed in raw px. The holder gets a `CONTENT_SCALE_FACTOR` scale so ITS children are
 * authored in plain points (pointSprite/point positions like every other widget here) — that
 * cancels only the CSF fold, deliberately NOT the monster's own scale: in the original the overlay
 * is a plain Cocos child of the monster node and inherits `rendererData["scale"]` (and any dynamic
 * scale action) for both its offsets and its sprite sizes (this file's header).
 */
function mountOverlayHolder(host: Sprite, fraction: Point): Container {
  const holder = new Container();
  const rawPxOffset = cocosContentFractionToPixiLocalOffset(
    host.width / host.scale.x,
    host.height / host.scale.y,
    { x: host.anchor.x, y: host.anchor.y },
    fraction,
  );
  holder.position.set(rawPxOffset.x, rawPxOffset.y);
  holder.scale.set(CONTENT_SCALE_FACTOR);
  host.addChild(holder);
  return holder;
}

/** `sleepZ-hd.png`/`confusionStatus-hd.png` — SleepEffect/ConfuseEffect (instruction-identical,
 *  status-effects-exact-sleep.md §6): periodic spawn every 0.8s (first on the first tick), each
 *  sprite starting at the holder origin at scale 1, then `CCSpawn(CCMoveBy(2.4s, drift),
 *  CCScaleTo(2.4s, 0.4))` parallel with `CCSequence(CCDelayTime(1.2s), FadeAndRemove(1.2s))`.
 *  Drift = up by exactly 40pt, right by 20*(0.8+0.4*rand) pt (§5 — never left, never down). */
function mountPeriodicSpawner(
  ticker: Ticker,
  texture: Texture,
  host: Sprite,
  rand: () => number,
): OverlayHandle {
  const holder = mountOverlayHolder(host, statusAnchorFraction("Sleep"));
  holder.label = "statusOverlay:periodicSpawn";

  let stopped = false;

  const spawnOne = (): void => {
    const sprite = pointSprite(texture);
    sprite.anchor.set(0.5, 0.5);
    const baseScaleX = sprite.scale.x;
    const baseScaleY = sprite.scale.y;
    holder.addChild(sprite);
    const drift = statusDriftOffset(rand);
    void (async () => {
      await Promise.all([
        tween(ticker, statusDriftScaleDurationMs(), (t) => {
          if (sprite.destroyed) return;
          sprite.position.set(drift.x * t, drift.y * t);
          const s = 1 - (1 - STATUS_SPAWN_TARGET_SCALE) * t;
          sprite.scale.set(baseScaleX * s, baseScaleY * s);
        }),
        (async () => {
          await tween(ticker, statusFadeDelayMs(), () => {});
          if (sprite.destroyed) return;
          await tween(ticker, statusFadeDurationMs(), (t) => {
            if (!sprite.destroyed) sprite.alpha = 1 - t;
          });
        })(),
      ]);
      if (!sprite.destroyed) sprite.destroy();
    })();
  };

  void (async () => {
    for (;;) {
      if (stopped || holder.destroyed) return;
      spawnOne();
      await tween(ticker, statusSpawnIntervalMs(), () => {});
    }
  })();

  return {
    stop(): void {
      stopped = true;
      if (!holder.destroyed) holder.destroy({ children: true });
    },
  };
}

/** `paralyzeBolt-hd.png` x3 — ParalyzeEffect (status-effects-exact-paralyze.md): an asymmetric
 *  left/top/right cluster (offsets in the bolt's own point size, rotations -65/0/+45 deg), each
 *  bolt permanently running `CCRepeatForever(EaseElasticOut(period 0.1, Sequence(MoveBy(0.25s,
 *  +(2,4)), MoveBy(0.25s, -(2,4)))))` — deterministic diagonal flick-and-spring-back, both axes
 *  together, identical every cycle (tween.ts's `shakenOffset` models the two-leg sequence). */
function mountParalyze(ticker: Ticker, texture: Texture, host: Sprite): OverlayHandle {
  const holder = mountOverlayHolder(host, statusAnchorFraction("Paralyze"));
  holder.label = "statusOverlay:paralyze";

  let stopped = false;
  const probe = pointSprite(texture);
  const layout = paralyzeBoltLayout(probe.width, probe.height);
  probe.destroy();
  for (const spec of layout) {
    const bolt = pointSprite(texture);
    bolt.anchor.set(0.5, 0.5);
    bolt.position.set(spec.position.x, spec.position.y);
    bolt.rotation = (spec.rotationDeg * Math.PI) / 180;
    holder.addChild(bolt);
    void (async () => {
      while (!stopped && !bolt.destroyed) {
        await tween(ticker, PARALYZE_SHAKE_MS, (t) => {
          if (stopped || bolt.destroyed) return;
          const e = easeElasticOut(t, 0.1);
          bolt.position.set(
            spec.position.x + shakenOffset(e, PARALYZE_SHAKE_OFFSET.x),
            // Cocos MoveBy +y is up; this port's local frames are Y-down.
            spec.position.y - shakenOffset(e, PARALYZE_SHAKE_OFFSET.y),
          );
        });
      }
    })();
  }

  return {
    stop(): void {
      stopped = true;
      if (!holder.destroyed) holder.destroy({ children: true });
    },
  };
}

/** PoisonEffect (status-effects-exact-poison.md): a grouped `CCParticleSystemPoint` from
 *  `PoisonParticles.plist` at the holder origin, drawn BEHIND the monster (Cocos z=-1 — sibling
 *  attachment here, this file's header). Emission is the binary-verified cocos2d model: rate =
 *  maxParticles/particleLifespan (~152/s here — an accumulator emitting several per frame, capped
 *  at maxParticles alive), per-particle life = base + variance*rand(-1,1) clamped >= 0 (the
 *  variance is ~2.6x the base — real lifetimes span ~0..1.18s), NORMAL alpha blending (the plist's
 *  770/771 pair — the prior additive blend was wrong), color/alpha lerped over each particle's OWN
 *  life, spatial values CSF-scaled once at spawn (per-idiom via `poisonSpatialIdiomScale`). */
function mountPoison(
  ticker: Ticker,
  particle: ParticleAsset,
  host: Sprite,
  attach: (node: Container) => boolean,
  particleRandom: () => number,
): OverlayHandle | null {
  const holder = new PoisonStatusEmitter(particle, ticker, DISPLAY_MODE, particleRandom);
  if (!attach(holder)) {
    holder.destroy({ children: true });
    return null;
  }
  // Anchor offset in the HOST's raw-px local frame; converted to the shared parent's frame each
  // sync tick by multiplying with the host's CURRENT scale (so the ability pulse/death shrink move
  // and scale the emitter exactly like the original's child relationship would).
  const rawPxOffset = cocosContentFractionToPixiLocalOffset(
    host.width / host.scale.x,
    host.height / host.scale.y,
    { x: host.anchor.x, y: host.anchor.y },
    statusAnchorFraction("Poison"),
  );
  const syncFn = (): void => {
    if (holder.destroyed || host.destroyed) return;
    const scaledX = rawPxOffset.x * host.scale.x;
    const scaledY = rawPxOffset.y * host.scale.y;
    const cosine = Math.cos(host.rotation);
    const sine = Math.sin(host.rotation);
    holder.position.set(
      host.position.x + scaledX * cosine - scaledY * sine,
      host.position.y + scaledX * sine + scaledY * cosine,
    );
    // Children are authored in points (CSF counter-fold), inheriting the monster's own scale —
    // the sibling equivalent of the original's plain child relationship (this file's header).
    holder.scale.set(host.scale.x * CONTENT_SCALE_FACTOR, host.scale.y * CONTENT_SCALE_FACTOR);
    holder.rotation = host.rotation;
  };
  ticker.add(syncFn);
  syncFn();
  holder.start();

  return {
    stop(): void {
      ticker.remove(syncFn);
      if (!holder.destroyed) holder.destroy({ children: true });
    },
    particleCount: () => holder.particleCount,
  };
}

export interface StatusOverlayControllerOpts {
  assets: AssetLibrary;
  ticker: Ticker;
  host: StatusOverlayHost;
  /** Sleep/Confuse use native's process-global `arc4random()` stream. */
  statusRandom?: () => number;
  /**
   * Poison's `CCParticleSystem.initParticle:` uses the separate libc `random()` stream. This
   * override is a deterministic test seam and must never receive BattleNode's mechanics RNG.
   */
  particleRandom?: () => number;
}

/**
 * Drives the four per-status overlay classes from the transition-counted tracker (§1/§7 item 3).
 * `onBuffAdded`/`onBuffRemoved` are meant to be fed from the SAME battle-event stream
 * `battleNode.ts` already replays per-turn (at presentation/impact time, not engine-resolution
 * time) — see that file's wiring for exactly where.
 */
export class StatusOverlayController {
  private readonly assets: AssetLibrary;
  private readonly ticker: Ticker;






  private readonly hosts: StatusOverlayHost[] = [];
  private readonly statusRandom: () => number;
  private readonly particleRandom: () => number;
  private readonly counts = new Map<string, Map<StatusEffect, number>>();
  /** Per living, per status kind, one handle PER host currently showing that overlay. */
  private readonly active = new Map<string, Map<StatusEffect, Map<StatusOverlayHost, OverlayHandle>>>();
  private readonly textureCache = new Map<string, Promise<Texture>>();
  private particleCache: Promise<ParticleAsset> | undefined;
  private disposed = false;

  constructor(opts: StatusOverlayControllerOpts) {
    this.assets = opts.assets;
    this.ticker = opts.ticker;
    this.hosts.push(opts.host);
    this.statusRandom = opts.statusRandom ?? Math.random;
    this.particleRandom = opts.particleRandom ?? Math.random;
  }







  addHost(host: StatusOverlayHost): () => void {
    if (!this.hosts.includes(host)) {
      this.hosts.push(host);
      for (const [id, perKind] of this.counts) {
        for (const [kind, count] of perKind) {
          if (count > 0) void this.spawnOnHost(id, kind, host);
        }
      }
    }
    return () => this.removeHost(host);
  }

  private removeHost(host: StatusOverlayHost): void {
    const idx = this.hosts.indexOf(host);
    if (idx < 0) return;
    this.hosts.splice(idx, 1);
    for (const perKind of this.active.values()) {
      for (const perHost of perKind.values()) {
        const handle = perHost.get(host);
        if (handle) {
          handle.stop();
          perHost.delete(host);
        }
      }
    }
  }

  onBuffAdded(target: string, statusEffects: readonly StatusEffect[]): void {
    for (const kind of statusEffects) this.applyDelta(target, kind, 1);
  }

  onBuffRemoved(target: string, statusEffects: readonly StatusEffect[]): void {
    for (const kind of statusEffects) this.applyDelta(target, kind, -1);
  }

  /** Seed exact live counters when reconnecting without replaying historical attacks. */
  hydrateCounts(target: string, counts: Readonly<Record<StatusEffect, number>>): void {
    if (this.counts.has(target)) {
      throw new Error(`StatusOverlayController: status counts for ${target} are already initialized`);
    }
    const perKind = new Map<StatusEffect, number>();
    this.counts.set(target, perKind);
    for (const kind of ["Sleep", "Paralyze", "Poison", "Confuse"] as const) {
      const count = counts[kind];
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error(`StatusOverlayController: invalid ${kind} count ${count} for ${target}`);
      }
      perKind.set(kind, count);
      if (count > 0) for (const host of this.hosts) void this.spawnOnHost(target, kind, host);
    }
  }

  /** Retry mounts after a previously absent field/summon card is constructed. */
  refreshHostsFor(target: string): void {
    const perKind = this.counts.get(target);
    if (perKind === undefined) return;
    for (const [kind, count] of perKind) {
      if (count <= 0) continue;
      for (const host of this.hosts) {
        if (this.active.get(target)?.get(kind)?.has(host) !== true) {
          void this.spawnOnHost(target, kind, host);
        }
      }
    }
  }

  /** Deterministic browser-choreography state (battleNode.ts's `renderGameState`). True iff at
   *  least one host currently has that overlay mounted. */
  debugStateOf(id: string): Record<string, boolean> {
    const perLiving = this.active.get(id);
    const shown = (kind: StatusEffect): boolean => (perLiving?.get(kind)?.size ?? 0) > 0;
    return {
      Sleep: shown("Sleep"),
      Paralyze: shown("Paralyze"),
      Poison: shown("Poison"),
      Confuse: shown("Confuse"),
    };
  }

  /** Live Poison particles across every display of this living. The holder becomes active before
   *  the strict first-emission threshold, so this is intentionally separate from `debugStateOf`. */
  debugPoisonParticleCountOf(id: string): number {
    const perHost = this.active.get(id)?.get("Poison");
    if (!perHost) return 0;
    let count = 0;
    for (const handle of perHost.values()) count += handle.particleCount?.() ?? 0;
    return count;
  }

  /** Torn down alongside the rest of BattleNode's scene on rematch/destroy — stops every running
   *  spawn loop so a rebuilt scene never leaks a ticker listener onto a destroyed node. */
  dispose(): void {
    this.disposed = true;
    for (const perKind of this.active.values()) {
      for (const perHost of perKind.values()) {
        for (const handle of perHost.values()) handle.stop();
      }
    }
    this.active.clear();
    this.counts.clear();
  }

  private applyDelta(id: string, kind: StatusEffect, delta: 1 | -1): void {
    const perLiving = this.counts.get(id) ?? new Map<StatusEffect, number>();
    this.counts.set(id, perLiving);
    const current = perLiving.get(kind) ?? 0;
    const { count, transition } = applyStatusCountDelta(current, delta);
    perLiving.set(kind, count);
    if (transition === "show") for (const host of this.hosts) void this.spawnOnHost(id, kind, host);
    else if (transition === "hide") this.despawn(id, kind);
  }

  private async spawnOnHost(id: string, kind: StatusEffect, host: StatusOverlayHost): Promise<void> {
    const sprite = host.monsterSpriteOf(id);
    if (!sprite) return; // this display doesn't show this living -- stale/off-field no-op (header)
    const handle = await this.buildOverlay(id, kind, sprite, host);
    if (!handle) return;
    // The status may have been removed, this host unregistered, or the whole controller disposed
    // while assets were loading -- don't mount something that's already gone.
    if (this.disposed || !this.hosts.includes(host) || (this.counts.get(id)?.get(kind) ?? 0) <= 0) {
      handle.stop();
      return;
    }
    const perLiving = this.active.get(id) ?? new Map<StatusEffect, Map<StatusOverlayHost, OverlayHandle>>();
    this.active.set(id, perLiving);
    const perHost = perLiving.get(kind) ?? new Map<StatusOverlayHost, OverlayHandle>();
    perLiving.set(kind, perHost);
    perHost.get(host)?.stop(); // paranoia: never leak a prior handle for the same (id,kind,host)
    perHost.set(host, handle);
  }

  /** Instant teardown across every host — the original's removal never fades (this file's header). */
  private despawn(id: string, kind: StatusEffect): void {
    const perHost = this.active.get(id)?.get(kind);
    if (!perHost) return;
    for (const handle of perHost.values()) handle.stop();
    this.active.get(id)!.delete(kind);
  }

  private async buildOverlay(
    id: string,
    kind: StatusEffect,
    sprite: Sprite,
    host: StatusOverlayHost,
  ): Promise<OverlayHandle | null> {
    switch (kind) {
      case "Sleep":
        return mountPeriodicSpawner(
          this.ticker,
          await this.loadSprite("sleepZ-hd"),
          sprite,
          this.statusRandom,
        );
      case "Confuse":
        return mountPeriodicSpawner(
          this.ticker,
          await this.loadSprite("confusionStatus-hd"),
          sprite,
          this.statusRandom,
        );
      case "Paralyze":
        return mountParalyze(this.ticker, await this.loadSprite("paralyzeBolt-hd"), sprite);
      case "Poison":
        return mountPoison(
          this.ticker,
          await this.loadPoisonParticles(),
          sprite,
          (node) => host.attachBehindMonster(id, node),
          this.particleRandom,
        );
    }
  }

  private loadSprite(name: string): Promise<Texture> {
    let cached = this.textureCache.get(name);
    if (!cached) {
      cached = this.assets.sprite(name);
      this.textureCache.set(name, cached);
    }
    return cached;
  }

  private loadPoisonParticles(): Promise<ParticleAsset> {
    this.particleCache ??= this.assets.particle("PoisonParticles.plist");
    return this.particleCache;
  }
}
