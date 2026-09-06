import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "../src/audio.js";

class FakeDocument extends EventTarget {
  hidden = false;
  visibility(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
class FakeAudio {
  static instances: FakeAudio[] = [];
  dataset: Record<string, string> = {};
  paused = true;
  ended = false;
  currentTime = 12;
  loop = false;
  volume = 1;
  play = vi.fn((): Promise<void> => { this.paused = false; return Promise.resolve(); });
  pause = vi.fn(() => { this.paused = true; });
  constructor(readonly src: string) { FakeAudio.instances.push(this); }
}
function fakeSource() {
  return { buffer: null, connect: vi.fn(), disconnect: vi.fn(),
    start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
}
class FakeContext {
  static instances: FakeContext[] = [];
  state: string = "suspended";
  destination = {};
  sources: Array<ReturnType<typeof fakeSource>> = [];
  resume = vi.fn(async () => { this.state = "running"; });
  suspend = vi.fn(async () => { this.state = "suspended"; });
  close = vi.fn(async () => { this.state = "closed"; });
  decodeAudioData = vi.fn(async () => ({}));
  createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; }
  createBufferSource() {
    const source = fakeSource();
    this.sources.push(source);
    return source;
  }
  constructor() { FakeContext.instances.push(this); }
}
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function setup() {
  FakeAudio.instances = [];
  FakeContext.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("AudioContext", FakeContext);
  const document = new FakeDocument();
  const player = new AudioPlayer({ sound: 0.75, music: 0.5 });
  player.installLifecycle(document as unknown as Document);
  return { player, document };
}

describe("foreground game audio", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not unlock on initial visibility or synthetic input", () => {
    const { document } = setup();
    document.visibility(true);
    document.visibility(false);
    document.dispatchEvent(new Event("pointerup"));
    expect(FakeContext.instances).toHaveLength(0);
  });

  it("pauses and resumes the same track at the same position without selecting again", async () => {
    const { player, document } = setup();
    player.unlock();
    const select = vi.fn(() => player.playMusic("blob:battle", { loop: true }));
    player.requestMusic("Battle", 7, true, select);
    await settle();
    const music = FakeAudio.instances[0]!;
    document.visibility(true);
    expect(music.paused).toBe(true);
    expect(FakeContext.instances[0]!.state).toBe("suspended");
    document.visibility(false);
    await settle();
    expect(music.play).toHaveBeenCalledTimes(2);
    expect(music.currentTime).toBe(12);
    expect(music.volume).toBe(0.1);
    expect(select).toHaveBeenCalledOnce();
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it("does not restart ended or externally paused tracks", async () => {
    const { player, document } = setup();
    player.unlock();
    player.playMusic("blob:win", { loop: false });
    await settle();
    const music = FakeAudio.instances[0]!;
    music.paused = true;
    music.ended = true;
    document.visibility(true);
    document.visibility(false);
    await settle();
    expect(music.play).toHaveBeenCalledOnce();
    music.ended = false;
    document.visibility(true);
    document.visibility(false);
    expect(music.play).toHaveBeenCalledOnce();
  });

  it("defers hidden replacements and never resurrects a stopped track", async () => {
    const { player, document } = setup();
    player.unlock();
    player.playMusic("blob:old", { loop: true });
    document.visibility(true);
    player.playMusic("blob:new", { loop: true });
    const next = FakeAudio.instances[1]!;
    expect(next.play).not.toHaveBeenCalled();
    document.visibility(false);
    await settle();
    expect(next.play).toHaveBeenCalledOnce();
    document.visibility(true);
    player.stopMusic();
    document.visibility(false);
    await settle();
    expect(next.play).toHaveBeenCalledOnce();
  });

  it("retries autoplay denial on unlock without retrying an obsolete track", async () => {
    const { player } = setup();
    player.unlock();
    player.playMusic("blob:old", { loop: true });
    const old = FakeAudio.instances[0]!;
    old.play.mockClear();
    player.stopMusic();
    // Install a constructor whose first play is denied.
    vi.stubGlobal("Audio", class extends FakeAudio {
      constructor(src: string) {
        super(src);
        this.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
      }
    });
    player.playMusic("blob:blocked", { loop: true });
    await settle();
    expect(player.debugState.musicNeedsGesture).toBe(true);
    player.unlock();
    await settle();
    expect(player.debugState.musicNeedsGesture).toBe(false);
    expect(FakeAudio.instances[1]!.play).toHaveBeenCalledTimes(2);
    expect(old.play).not.toHaveBeenCalled();
  });

  it("drops hidden effects but still rejects missing assets and retains decoded buffers", async () => {
    const { player, document } = setup();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
    player.unlock();
    await player.preloadSfx("click", "blob:click");
    player.playSfx("click");
    const context = FakeContext.instances[0]!;
    document.visibility(true);
    expect(context.sources[0]!.stop).toHaveBeenCalledOnce();
    player.playSfx("click");
    expect(context.sources).toHaveLength(1);
    expect(() => player.playSfx("missing")).toThrow("sfx not preloaded");
    document.visibility(false);
    await settle();
    player.playSfx("click");
    expect(context.sources).toHaveLength(2);
    expect(player.hasSfx("click")).toBe(true);
  });

  it("ignores a hide-induced AbortError even if it arrives after foreground recovery", async () => {
    const { player, document } = setup();
    player.unlock();
    let rejectPlay!: (error: unknown) => void;
    vi.stubGlobal("Audio", class extends FakeAudio {
      constructor(src: string) {
        super(src);
        this.play.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectPlay = reject; }));
      }
    });
    player.playMusic("blob:battle", { loop: true });
    document.visibility(true);
    document.visibility(false);
    rejectPlay(new DOMException("paused", "AbortError"));
    await settle();
    expect(FakeAudio.instances[0]!.play).toHaveBeenCalledTimes(2);
    expect(player.debugState.musicNeedsGesture).toBe(false);
  });

  it("does not let a late autoplay denial resurrect replaced music", async () => {
    const { player } = setup();
    player.unlock();
    let rejectPlay!: (error: unknown) => void;
    vi.stubGlobal("Audio", class extends FakeAudio {
      constructor(src: string) {
        super(src);
        if (src === "blob:old") this.play.mockImplementationOnce(() =>
          new Promise<void>((_, reject) => { rejectPlay = reject; }));
      }
    });
    player.playMusic("blob:old", { loop: true });
    player.playMusic("blob:new", { loop: true });
    rejectPlay(new DOMException("blocked", "NotAllowedError"));
    await settle();
    player.unlock();
    expect(FakeAudio.instances[0]!.play).toHaveBeenCalledOnce();
    expect(FakeAudio.instances[1]!.play).toHaveBeenCalledOnce();
  });

  it("keeps actual media failures loud", async () => {
    const { player } = setup();
    const queued: VoidFunction[] = [];
    vi.stubGlobal("queueMicrotask", (callback: VoidFunction) => queued.push(callback));
    const failure = new DOMException("bad media", "NotSupportedError");
    vi.stubGlobal("Audio", class extends FakeAudio {
      constructor(src: string) { super(src); this.play.mockRejectedValueOnce(failure); }
    });
    player.playMusic("blob:bad", { loop: true });
    await settle();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toThrow(failure);
  });

  it("re-suspends a resume that completes after hiding", async () => {
    const { player, document } = setup();
    player.unlock();
    await settle();
    const context = FakeContext.instances[0]!;
    context.state = "interrupted";
    let finishResume!: () => void;
    context.resume.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishResume = () => { context.state = "running"; resolve(); };
    }));
    player.unlock();
    document.visibility(true);
    await settle();
    finishResume();
    await settle();
    expect(context.state).toBe("suspended");
  });

  it("recovers a suspend that completes after returning", async () => {
    const { player, document } = setup();
    player.unlock();
    await settle();
    const context = FakeContext.instances[0]!;
    let finishSuspend!: () => void;
    context.suspend.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSuspend = () => { context.state = "suspended"; resolve(); };
    }));
    document.visibility(true);
    document.visibility(false);
    finishSuspend();
    await settle();
    expect(context.state).toBe("running");
  });

  it("removes lifecycle listeners on dispose", async () => {
    const { player, document } = setup();
    player.unlock();
    const context = FakeContext.instances[0]!;
    player.dispose();
    document.visibility(true);
    document.visibility(false);
    await settle();
    expect(context.close).toHaveBeenCalledOnce();
    expect(context.suspend).not.toHaveBeenCalled();
    expect(FakeContext.instances).toHaveLength(1);
  });
});
