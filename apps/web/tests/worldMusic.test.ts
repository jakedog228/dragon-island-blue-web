import { AudioPlayer } from "../src/audio.js";
import { touchHleArc4Random } from "@dib/engine";
import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

describe("WorldNode source music selection", () => {
  it("spends one shared arc4random draw for each one-track Field and Town request", () => {
    const rng = touchHleArc4Random();
    const playMusic = vi.fn();
    const audio = new AudioPlayer({ sound: 0, music: 0 });
    audio.playMusic = playMusic;
    const receiver = Object.assign(Object.create(WorldNode.prototype), {
      deps: {
        sourceRng: rng,
        game: { assets: { audioUrl: (name: string) => `audio://${name}` } },
        audio,
      },
    }) as WorldNode;
    const playTownMusic = (WorldNode.prototype as unknown as {
      playTownMusic(this: WorldNode): void;
    }).playTownMusic;

    receiver.playFieldMusic();
    playTownMusic.call(receiver);

    expect(rng.cursor).toBe(2);
    expect(playMusic.mock.calls).toEqual([
      ["audio://Field1.mp3", { loop: true, assetName: "Field1.mp3" }],
      ["audio://Town1.mp3", { loop: true, assetName: "Town1.mp3" }],
    ]);
    audio.lockMusic("Casino");
    receiver.playFieldMusic();
    expect(rng.cursor).toBe(2);
    audio.releaseMusicLock("Casino");
    expect(rng.cursor).toBe(3);
    expect(playMusic).toHaveBeenLastCalledWith("audio://Field1.mp3", {
      loop: true, assetName: "Field1.mp3",
    });
  });
});
