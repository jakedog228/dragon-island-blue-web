export interface ManagedScene<Kind extends string = string> {
  readonly sceneKind: Kind;
  setSceneVisible(visible: boolean): void;
  renderGameState(): Record<string, unknown>;
  destroy(): void;
}

export interface SceneTransitionContext<Scene extends ManagedScene> {
  readonly outgoing: Scene | undefined;
  readonly incoming: Scene;
  /** Publish the incoming scene as the sole state/render-game-to-text owner. Idempotent. */
  activate(): void;
  /** Hide the outgoing scene without destroying it. The caller becomes responsible for either
   * restoring that exact scene in a later replacement or destroying it. */
  retainOutgoing(): void;
  /** Destroy the outgoing scene at a transition-specific opaque midpoint. Idempotent. */
  retireOutgoing(): void;
}

export interface SceneRouteRequest {
  readonly route: { readonly sceneId: string };
}

export interface SceneReplacementOptions {
  /** A previously retained scene is still caller-owned if its attempted restoration fails. */
  readonly preserveIncomingOnFailure?: boolean;
}

/** Registration point for POI/menu routes that construct additional scene kinds. The coordinator
 * owns lifecycle after construction; this registry keeps route selection out of scene classes. */
export class SceneHandlerRegistry<Request extends SceneRouteRequest> {
  private readonly handlers = new Map<string, (request: Request) => void | Promise<void>>();

  register(sceneId: string, handler: (request: Request) => void | Promise<void>): () => void {
    if (sceneId.length === 0) throw new Error("SceneHandlerRegistry: sceneId must not be empty");
    if (this.handlers.has(sceneId)) {
      throw new Error(`SceneHandlerRegistry: duplicate handler for ${JSON.stringify(sceneId)}`);
    }
    this.handlers.set(sceneId, handler);
    return () => {
      if (this.handlers.get(sceneId) === handler) this.handlers.delete(sceneId);
    };
  }

  async dispatch(request: Request): Promise<void> {
    const handler = this.handlers.get(request.route.sceneId);
    if (handler === undefined) {
      throw new Error(`SceneHandlerRegistry: no handler for ${JSON.stringify(request.route.sceneId)}`);
    }
    await handler(request);
  }
}

/** Small scene lifecycle coordinator, deliberately independent of Pixi and specific scene kinds.
 * Visual choreography stays in callers, while active-scene ownership, transition exclusion, state
 * publication, and exactly-once destruction are centralized here. */
export class SceneCoordinator<
  Scene extends ManagedScene,
  ShellMode extends string,
> {
  private activeScene: Scene | undefined;
  private shellMode: ShellMode;
  private replacing = false;
  private readonly idleWaiters = new Set<() => void>();

  constructor(initialMode: ShellMode) {
    this.shellMode = initialMode;
  }

  get mode(): ShellMode | Scene["sceneKind"] {
    return this.activeScene?.sceneKind ?? this.shellMode;
  }

  get current(): Scene | undefined {
    return this.activeScene;
  }

  get transitionInProgress(): boolean {
    return this.replacing;
  }

  async whenIdle(): Promise<void> {
    while (this.replacing) {
      await new Promise<void>((resolve) => { this.idleWaiters.add(resolve); });
    }
  }

  setShellMode(mode: ShellMode): void {
    if (this.activeScene !== undefined || this.replacing) {
      throw new Error("SceneCoordinator: shell mode may only change without an active scene");
    }
    this.shellMode = mode;
  }

  renderGameState(): Record<string, unknown> | undefined {
    return this.activeScene?.renderGameState();
  }

  async replace(
    incoming: Scene,
    transition: (context: SceneTransitionContext<Scene>) => void | Promise<void> = ({ activate }) => activate(),
    options: SceneReplacementOptions = {},
  ): Promise<void> {
    if (this.replacing) throw new Error("SceneCoordinator: a scene transition is already in progress");
    if (incoming === this.activeScene) throw new Error("SceneCoordinator: cannot replace a scene with itself");

    this.replacing = true;
    const outgoing = this.activeScene;
    let activated = false;
    let retired = false;
    let retained = false;
    const activate = (): void => {
      if (activated) return;
      incoming.setSceneVisible(true);
      this.activeScene = incoming;
      activated = true;
    };
    const retainOutgoing = (): void => {
      if (retired || retained || outgoing === undefined) return;
      outgoing.setSceneVisible(false);
      retained = true;
    };
    const retireOutgoing = (): void => {
      if (retired || outgoing === undefined) return;
      outgoing.destroy();
      if (this.activeScene === outgoing) this.activeScene = undefined;
      retired = true;
    };

    try {
      await transition({ outgoing, incoming, activate, retainOutgoing, retireOutgoing });
      activate();
      if (!retained) retireOutgoing();
    } catch (error) {
      if (!activated && options.preserveIncomingOnFailure !== true) incoming.destroy();
      if (activated && !retained) retireOutgoing();
      if (!activated && retained && outgoing !== undefined) outgoing.setSceneVisible(true);
      throw error;
    } finally {
      this.replacing = false;
      for (const resolve of this.idleWaiters) resolve();
      this.idleWaiters.clear();
    }
  }

  clear(mode: ShellMode): void {
    if (this.replacing) throw new Error("SceneCoordinator: cannot clear during a scene transition");
    this.activeScene?.destroy();
    this.activeScene = undefined;
    this.shellMode = mode;
  }
}
