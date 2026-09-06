import { describe, expect, it } from "vitest";
import {
  CallFunc,
  CocosActionManager,
  DelayTime,
  Ease,
  MoveTo,
  RotateTo,
  ScaleTo,
  sequence,
  spawn,
  type CocosActionTarget,
} from "../src/battle/cocosActionRunner.js";

function node(): CocosActionTarget & { destroyed: boolean } {
  return { x: 0, y: 0, rotation: 0, scale: { x: 1, y: 1 }, destroyed: false };
}

/** One 16ms frame; the first step of any action reports elapsed 0, exactly as `CCActionInterval`
 *  does, so an N-millisecond action needs ceil(N/16) frames AFTER its opening frame. */
function step(manager: CocosActionManager, frames: number, dtMs = 16): void {
  for (let i = 0; i < frames; i++) manager.update(dtMs);
}

describe("Cocos action runner", () => {
  it("reports the captured start on the opening frame and interpolates from it", () => {
    const manager = new CocosActionManager();
    const target = node();
    target.x = 40;
    manager.runAction(target, new MoveTo(160, 200, 0));

    step(manager, 1);
    expect(target.x).toBe(40); // CCActionInterval's first tick is elapsed 0

    step(manager, 5); // 80ms of 160ms
    expect(target.x).toBeCloseTo(40 + (200 - 40) * 0.5, 5);

    step(manager, 5);
    expect(target.x).toBe(200);
    expect(manager.activeActionCount).toBe(0);
  });

  it("captures the live transform when a LATER action starts, not when it was constructed", () => {
    const manager = new CocosActionManager();
    const target = node();

    manager.runAction(target, new ScaleTo(320, -1, 1));
    step(manager, 11); // 160ms -> scaleX halfway to -1
    expect(target.scale.x).toBeCloseTo(0, 5);

    // A second flip admitted mid-flight. Cocos' `-[CCScaleTo startWithTarget:]` reads the CURRENT
    // scale, so the node must continue from ~0 rather than snapping back toward +1.
    manager.runAction(target, new ScaleTo(320, -1, 1));
    step(manager, 1);
    expect(target.scale.x).toBeCloseTo(0, 2);
    expect(target.scale.x).toBeLessThan(0.2);

    // Both actions keep writing; the later-admitted one is stepped last and owns the final value.
    step(manager, 20);
    expect(target.scale.x).toBeCloseTo(-1, 5);
  });

  it("starts a sequence's next phase from what the previous phase left behind", () => {
    const manager = new CocosActionManager();
    const target = node();
    const seen: number[] = [];

    manager.runAction(
      target,
      sequence([new ScaleTo(160, -1, 1), new CallFunc(() => seen.push(target.scale.x))]),
    );
    step(manager, 12);
    expect(seen).toEqual([-1]);
  });

  it("fires a spawned CCCallFuncO on the spawn's FIRST update, not at the end of its sibling", () => {
    const manager = new CocosActionManager();
    const target = node();
    const firedAtFrame: number[] = [];
    let frame = 0;




    manager.runAction(
      target,
      sequence([
        new ScaleTo(500, -1, 1),
        new MoveTo(500, 12, 80),
        spawn([new ScaleTo(500, 1, 1), new CallFunc(() => firedAtFrame.push(frame))]),
      ]),
    );

    for (; frame < 100; frame++) {
      manager.update(16);
      if (firedAtFrame.length > 0) break;
    }
    // 1000ms of action time is reached on the frame whose elapsed first passes 1000 (the opening
    // frame contributes 0), so the callback lands at ~63 frames, never at the 1500ms end.
    expect(firedAtFrame[0]).toBeGreaterThanOrEqual(62);
    expect(firedAtFrame[0]).toBeLessThanOrEqual(64);
    // Its sibling restore is still running at that moment.
    expect(target.scale.x).toBeLessThan(-0.9);

    step(manager, 40);
    expect(target.scale.x).toBeCloseTo(1, 5);
    expect(manager.activeActionCount).toBe(0);
  });

  it("runs a zero-length delay's sequence inline and applies the eased fall/rotate spawn", () => {
    const manager = new CocosActionManager();
    const target = node();
    let removed = false;

    manager.runAction(
      target,
      sequence([
        new DelayTime(0),
        spawn([
          new Ease(new MoveTo(320, 120, 415), (t) => t * t),
          new Ease(new RotateTo(320, Math.PI / 2), (t) => t),
        ]),
        new CallFunc(() => {
          removed = true;
        }),
      ]),
    );

    step(manager, 11); // halfway
    expect(target.x).toBeCloseTo(120 * 0.25, 5); // eased t^2
    expect(target.rotation).toBeCloseTo(Math.PI / 4, 5); // linear
    expect(removed).toBe(false);

    step(manager, 12);
    expect(target.rotation).toBeCloseTo(Math.PI / 2, 5);
    expect(removed).toBe(true);
    expect(manager.activeActionCount).toBe(0);
  });

  it("stops every action on a destroyed target and stops writing through it", () => {
    const manager = new CocosActionManager();
    const target = node();
    manager.runAction(target, new MoveTo(320, 200, 0));
    step(manager, 5);
    const frozen = target.x;

    target.destroyed = true;
    step(manager, 5);
    expect(target.x).toBe(frozen);
    expect(manager.activeActionCount).toBe(0);
  });

  it("settles each handle exactly once, whether it completed or was stopped", async () => {
    const manager = new CocosActionManager();
    const target = node();
    const completes = manager.runAction(target, new MoveTo(32, 5, 5));
    const cancelled = manager.runAction(target, new MoveTo(32000, 900, 900));

    step(manager, 4);
    expect(completes.settled).toBe(true);
    expect(cancelled.settled).toBe(false);

    manager.stopAllActions();
    expect(cancelled.settled).toBe(true);
    await Promise.all([completes.finished, cancelled.finished]);
  });
});
