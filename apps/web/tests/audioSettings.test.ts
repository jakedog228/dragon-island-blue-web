import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer, sfxIdentity } from "../src/audio.js";

describe("AudioPlayer option levels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats source filenames and preloaded manifest stems as the same SFX identity", () => {
    expect(sfxIdentity("click.m4a")).toBe("click");
    expect(sfxIdentity("notAllowed.M4A")).toBe("notAllowed");
    expect(sfxIdentity("Encounter")).toBe("Encounter");
  });

  it("applies source-discrete levels before browser audio is unlocked", () => {
    const audio = new AudioPlayer({ sound: 0.25, music: 0.5 });
    audio.setLevels({ sound: 0.75, music: 0 });
    expect(audio.soundLevel).toBe(0.75);
    expect(audio.musicLevel).toBe(0);
  });

  it("fails loudly on values the original five-button OptionsNode cannot author", () => {
    const audio = new AudioPlayer({ sound: 0.25, music: 0.5 });
    expect(() => audio.setLevels({ sound: 0.3, music: 0.5 })).toThrow(/must be one of/);
  });

  it("shares concurrent SFX fetch/decode work and treats a completed preload as a no-op", async () => {
    const decoded = {} as AudioBuffer;
    const decodeAudioData = vi.fn(async () => decoded);
    class FakeAudioContext {
      decodeAudioData = decodeAudioData;
    }
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(4));
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer }));
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("fetch", fetchMock);
    const audio = new AudioPlayer({ sound: 1, music: 1 });

    await Promise.all([
      audio.preloadSfx("Encounter.m4a", "blob:first"),
      audio.preloadSfx("Encounter", "blob:first"),
    ]);
    await audio.preloadSfx("Encounter.m4a", "blob:first");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(decodeAudioData).toHaveBeenCalledOnce();
    expect(audio.hasSfx("Encounter.m4a")).toBe(true);
  });

  it("stops and forgets a direct music track", () => {
    class FakeAudio {
      readonly dataset: Record<string, string> = {};
      loop = false;
      volume = 1;
      paused = false;
      constructor(readonly src: string) {}
      play(): Promise<void> {
        this.paused = false;
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    const audio = new AudioPlayer({ sound: 0.25, music: 0.5 });

    audio.playMusic("Casino1.mp3", { loop: true, assetName: "Casino1.mp3" });
    expect(audio.debugState.musicAssetName).toBe("Casino1.mp3");
    audio.stopMusic();
    expect(audio.debugState.musicAssetName).toBeNull();
    expect(audio.debugState.musicPaused).toBeNull();
  });

  it("resumes the remembered category with one RNG draw after Casino, including a prior request", () => {
    const audio = new AudioPlayer({ sound: 0, music: 0 });
    const draws: number[] = [];
    const play = vi.fn((count: number, loop: boolean) => { draws.push(count); });
    audio.requestMusic("Battle", 7, false, play);
    audio.lockMusic("Casino");
    expect(draws).toEqual([7]);
    audio.releaseMusicLock("Other");
    expect(draws).toEqual([7]);
    audio.releaseMusicLock("Casino");
    expect(draws).toEqual([7, 1]);
    expect(play).toHaveBeenLastCalledWith(1, true);
    audio.lockMusic("Casino");
    audio.releaseMusicLock("Casino");
    expect(draws).toEqual([7, 1]);
  });

  it("defers RNG for other categories, retains only the latest, and permits the lock owner", () => {
    const audio = new AudioPlayer({ sound: 0, music: 0 });
    const field = vi.fn();
    const town = vi.fn();
    const casino = vi.fn();
    audio.lockMusic("Casino");
    audio.requestMusic("Field", 1, true, field);
    audio.requestMusic("Town", 1, true, town);
    audio.requestMusic("Casino", 1, true, casino);
    expect(field).not.toHaveBeenCalled();
    expect(town).not.toHaveBeenCalled();
    expect(casino.mock.calls).toEqual([[1, true]]);
    audio.releaseMusicLock("Casino");
    expect(field).not.toHaveBeenCalled();
    expect(town.mock.calls).toEqual([[1, true]]);
    expect(casino).toHaveBeenCalledTimes(1);
  });
});
