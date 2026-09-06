


export class AudioPlayer {
  private ctx: AudioContext | undefined;
  private effectsGain: GainNode | undefined;
  private readonly buffers = new Map<string, AudioBuffer>();


  private readonly pendingBuffers = new Map<string, Promise<AudioBuffer>>();
  private music: HTMLAudioElement | undefined;
  private hidden = false;
  private unlocked = false;
  private retryMusic = false;
  private musicAttempt = 0;
  private musicPlayPending = false;
  private readonly activeEffects = new Set<AudioBufferSourceNode>();
  private removeLifecycle: (() => void) | undefined;
  private musicLock: string | undefined;
  private backgroundRequest: ((trackCount: number, loop: boolean) => void) | undefined;

  /** Read-only effect-channel tally. SFX are WebAudio buffer sources, so a scenario cannot
   *  instrument them from the page the way `battle-end-audio` wraps `window.Audio` for the music
   *  channel — a buffer source carries no name. Recording the logical name here is what lets a
   *  browser proof assert WHICH sound a branch played (e.g. the source's notAllowed.m4a on a
   *  TargetPicker miss) instead of merely asserting that state did not change. Observation only:
   *  nothing reads these back into playback behavior. */
  private readonly sfxCounts = new Map<string, number>();
  private lastSfx: string | null = null;


  private static readonly MUSIC_VOLUME_SCALE = 0.2;

  constructor(private config: { sound: number; music: number }) {}

  get soundLevel(): number {
    return this.config.sound;
  }

  get musicLevel(): number {
    return this.config.music;
  }

  get debugState(): {
    readonly soundLevel: number;
    readonly musicLevel: number;
    readonly musicAssetName: string | null;
    readonly musicPaused: boolean | null;
    readonly contextState: AudioContextState | null;
    readonly hidden: boolean;
    readonly musicNeedsGesture: boolean;
    readonly lastSfx: string | null;
    readonly sfxCounts: Readonly<Record<string, number>>;
  } {
    return {
      soundLevel: this.config.sound,
      musicLevel: this.config.music,
      musicAssetName: this.music?.dataset["assetName"] ?? null,
      musicPaused: this.music?.paused ?? null,
      contextState: this.ctx?.state ?? null,
      hidden: this.hidden,
      musicNeedsGesture: this.retryMusic && !this.hidden,
      lastSfx: this.lastSfx,
      sfxCounts: Object.fromEntries(this.sfxCounts),
    };
  }

  /** OptionsNode's immediate `applySoundSettings` equivalent. */
  setLevels(config: { sound: number; music: number }): void {
    validateLevel("sound", config.sound);
    validateLevel("music", config.music);
    this.config = { ...config };
    if (this.effectsGain) this.effectsGain.gain.value = config.sound;
    if (this.music) this.music.volume = config.music * AudioPlayer.MUSIC_VOLUME_SCALE;
  }

  unlock(): void {
    if (this.hidden) return;
    this.unlocked = true;
    this.ctx ??= new AudioContext();
    this.recoverPlayback();
  }

  /** Browser-only lifecycle policy; retain source music selection, locks and decoded assets. */
  installLifecycle(document: Document): void {
    if (this.removeLifecycle) return;
    const visibility = (): void => this.setHidden(document.hidden);
    const gesture = (event: Event): void => {
      if (event.isTrusted && this.unlocked) this.recoverPlayback();
    };
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerup", gesture, true);
    document.addEventListener("keydown", gesture, true);
    this.removeLifecycle = () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerup", gesture, true);
      document.removeEventListener("keydown", gesture, true);
    };
    visibility();
  }

  private setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (!hidden) {
      this.recoverPlayback();
      return;
    }
    // Invalidate outstanding play promises before our pause can reject them with AbortError.
    this.musicAttempt++;
    this.retryMusic ||= this.music !== undefined && !this.music.ended &&
      (!this.music.paused || this.musicPlayPending);
    this.musicPlayPending = false;
    this.music?.pause();
    // Do not resume stale combat sounds after the player returns.
    for (const source of this.activeEffects) {
      source.stop();
      source.disconnect();
    }
    this.activeEffects.clear();
    const context = this.ctx;
    if (context && context.state !== "closed") {
      void context.suspend().then(() => {
        if (this.ctx === context && !this.hidden) this.recoverPlayback();
      }).catch((error: unknown) => console.warn("[audio] suspend failed", error));
    }
  }

  private recoverPlayback(): void {
    if (this.hidden || !this.unlocked) return;
    const context = this.ctx;
    if (context && context.state !== "running" && context.state !== "closed") {
      void context.resume().then(() => {
        // A lock can arrive while resume is pending. Never let its completion undo that pause.
        if (this.ctx === context && this.hidden && context.state !== "closed") return context.suspend();
      }).catch((error: unknown) => console.warn("[audio] resume failed; retry on next gesture", error));
    }
    if (this.retryMusic && this.music) this.startMusic(this.music);
  }

  private context(): AudioContext {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }

  /** Master node for the effect channel, gain == `sound` config (the `setEffectsVolume:` analog).
   *  All SFX sources connect here rather than straight to `destination`. */
  private effects(): GainNode {
    if (!this.effectsGain) {
      this.effectsGain = this.context().createGain();
      this.effectsGain.gain.value = this.config.sound;
      this.effectsGain.connect(this.context().destination);
    }
    return this.effectsGain;
  }

  hasSfx(name: string): boolean {
    return this.buffers.has(sfxIdentity(name));
  }

  async preloadSfx(name: string, url: string): Promise<void> {
    // Music-tier tracks must never enter the effect path: playing one via playSfx is exactly how
    // the Win1 jingle used to mix over the still-looping battle track. Failing at preload keeps
    // the misroute loud at boot instead of audible at battle end.
    // Browser-imported URLs are opaque `blob:` identifiers, so retain the logical-name check too.
    if (/\.mp3$/i.test(name) || /\.mp3$/i.test(url)) {
      throw new Error(`music-tier track routed to sfx: ${name} (${url}) — play it via playMusic`);
    }
    const identity = sfxIdentity(name);
    if (this.buffers.has(identity)) return;
    let pending = this.pendingBuffers.get(identity);
    if (pending === undefined) {
      pending = (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`sfx fetch failed: ${res.status} ${url}`);
        return this.context().decodeAudioData(await res.arrayBuffer());
      })();
      this.pendingBuffers.set(identity, pending);
    }
    try {
      this.buffers.set(identity, await pending);
    } finally {
      // Only the request that still owns this identity may clear it. A rejected load can then be
      // retried, while concurrent callers keep sharing the exact same promise until it settles.
      if (this.pendingBuffers.get(identity) === pending) this.pendingBuffers.delete(identity);
    }
  }

  playSfx(name: string): void {
    const buffer = this.buffers.get(sfxIdentity(name));
    if (!buffer) throw new Error(`sfx not preloaded: ${name}`);
    if (this.hidden) return;
    // Tally only what actually reaches the effect channel, so a missing-buffer throw above can
    // never be mistaken for a played sound by a scenario reading debugState.
    const identity = sfxIdentity(name);
    this.lastSfx = identity;
    this.sfxCounts.set(identity, (this.sfxCounts.get(identity) ?? 0) + 1);
    const src = this.context().createBufferSource();
    src.buffer = buffer;
    src.connect(this.effects());
    this.activeEffects.add(src);
    src.onended = () => {
      this.activeEffects.delete(src);
      src.disconnect();
    };
    src.start();
  }

  /** `sub_9169c`: retain the latest category, deferring selection (including its RNG draw) when
   * another category owns the lock. The callback accepts the source's unlock override: 1, true. */
  requestMusic(category: string, trackCount: number, loop: boolean,
    selectAndPlay: (trackCount: number, loop: boolean) => void): void {
    if (this.musicLock !== category) this.backgroundRequest = selectAndPlay;
    if (this.musicLock !== undefined && this.musicLock !== category) return;
    selectAndPlay(trackCount, loop);
  }

  /** `sub_91650`: Casino's selection draw is owned by the egg session, before presentation. */
  lockMusic(category: string): void {
    this.musicLock = category;
  }

  /** `sub_917cc`: only the matching owner may unlock; replay the remembered category using
   * count=1/loop=true, then clear it. This includes a request made BEFORE Casino took the lock. */
  releaseMusicLock(category: string): void {
    if (this.musicLock !== category) return;
    this.musicLock = undefined;
    this.stopMusic();
    const pending = this.backgroundRequest;
    if (pending !== undefined) pending(1, true);
    this.backgroundRequest = undefined;
  }

  /** `-[SimpleAudioEngine playBackgroundMusic:loop:]` analog: playing always supersedes whatever
   *  the channel held, so two music tracks can never mix. The binary calls stopBackgroundMusic
   *  only from the slot-machine music-lock release; every other change is a replacement play. */
  playMusic(url: string, opts: { loop: boolean; assetName?: string }): void {
    this.music?.pause();
    const next = new Audio(url);
    this.music = next;
    if (opts.assetName) next.dataset["assetName"] = opts.assetName;
    next.loop = opts.loop;
    next.volume = this.config.music * AudioPlayer.MUSIC_VOLUME_SCALE;
    this.retryMusic = true;
    if (!this.hidden) this.startMusic(next);
  }

  private startMusic(next: HTMLAudioElement): void {
    const attempt = ++this.musicAttempt;
    this.musicPlayPending = true;
    this.retryMusic = false;
    void next.play().then(() => {
      if (attempt === this.musicAttempt) this.musicPlayPending = false;
    }).catch((error: unknown) => {
      if (attempt === this.musicAttempt) this.musicPlayPending = false;
      // Replacing the exclusive channel pauses its preceding HTMLAudioElement. Chromium rejects
      // that element's still-pending play() promise with AbortError; this is the expected
      // supersession path, not an audio failure. Preserve fail-loud behavior for every other
      // rejection and for an AbortError on the element that still owns the channel.
      if (
        (this.music !== next || attempt !== this.musicAttempt) &&
        error instanceof DOMException &&
        error.name === "AbortError"
      ) return;
      // Autoplay denial is a browser permission state, not corrupt game content. Retry only
      // the current track on a later real gesture, never replay an obsolete scene's request.
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        if (this.music === next && attempt === this.musicAttempt) this.retryMusic = true;
        return;
      }
      queueMicrotask(() => { throw error; });
    });
  }


  stopMusic(): void {
    this.musicAttempt++;
    this.musicPlayPending = false;
    this.retryMusic = false;
    this.music?.pause();
    this.music = undefined;
  }

  /** Releases browser audio owned by one in-memory game session. */
  dispose(): void {
    this.removeLifecycle?.();
    this.removeLifecycle = undefined;
    this.unlocked = false;
    this.musicAttempt++;
    this.musicPlayPending = false;
    this.retryMusic = false;
    this.activeEffects.clear();
    this.musicLock = undefined;
    this.backgroundRequest = undefined;
    this.music?.pause();
    this.music = undefined;
    this.effectsGain?.disconnect();
    this.effectsGain = undefined;
    const context = this.ctx;
    this.ctx = undefined;
    this.buffers.clear();
    this.pendingBuffers.clear();
    if (context !== undefined) void context.close();
  }
}


export function sfxIdentity(name: string): string {
  return name.replace(/\.(m4a|wav)$/i, "");
}

function validateLevel(name: string, value: number): void {
  if (![0, 0.25, 0.5, 0.75, 1].includes(value)) {
    throw new Error(`${name} level must be one of 0, 0.25, 0.5, 0.75, 1; got ${value}`);
  }
}
