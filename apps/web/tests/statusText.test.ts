import { describe, it, expect, vi } from "vitest";

// pixi.js cannot be imported for real under vitest's Node environment (module-scope browser
// sniffing) — same mocking approach as packages/renderer/tests/buttonSprite.test.ts: a miniature
// scene-graph/event surface. StatusTextDisplay's own file only touches Container/Graphics/Sprite
// directly; @dib/renderer's pointSprite (used for the finish-node sprite) also resolves against
// this same mock since vi.mock("pixi.js", ...) is hoisted project-wide for this test file's module
// graph.
vi.mock("pixi.js", () => {
  const makePoint = (v: number) => ({
    x: v,
    y: v,
    set(a: number, b: number = a) {
      this.x = a;
      this.y = b;
    },
  });
  class Container {
    children: Container[] = [];
    eventMode = "passive";
    cursor = "";
    hitArea: { contains(x: number, y: number): boolean } | null = null;
    position = makePoint(0);
    scale = makePoint(1);
    visible = true;
    destroyed = false;
    private listeners = new Map<string, ((...a: unknown[]) => void)[]>();
    addChild<T extends Container>(c: T): T {
      this.children.push(c);
      return c;
    }
    removeChild<T extends Container>(c: T): T {
      this.children = this.children.filter((x) => x !== c);
      return c;
    }
    on(ev: string, fn: (...a: unknown[]) => void): this {
      const arr = this.listeners.get(ev) ?? [];
      arr.push(fn);
      this.listeners.set(ev, arr);
      return this;
    }
    emit(ev: string, ...args: unknown[]): void {
      for (const fn of this.listeners.get(ev) ?? []) fn(...args);
    }
    getLocalBounds(): { width: number; height: number } {
      return { width: 100, height: 20 };
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class Graphics extends Container {
    rect(): this {
      return this;
    }
    fill(): this {
      return this;
    }
  }
  class Sprite extends Container {
    texture: { width: number; height: number };
    anchor = makePoint(0);
    constructor(texture: { width: number; height: number } = { width: 0, height: 0 }) {
      super();
      this.texture = texture;
    }
    get width(): number {
      return this.texture.width * this.scale.x;
    }
    get height(): number {
      return this.texture.height * this.scale.y;
    }
  }
  class Texture {}
  return { Container, Graphics, Sprite, Texture };
});

import { StatusTextDisplay } from "../src/battle/statusText.js";
import type { Container as PixiContainer, Ticker, Texture } from "pixi.js";

/** Fake Ticker: `add`/`remove` collect step callbacks, `tick(ms)` drives them once with that delta —
 *  the same injectable-clock shape `tween.ts`/`LogDrawer` already consume (`ticker.deltaMS`). */
function fakeTicker(): Ticker & { tick(ms: number): void } {
  const fns: Array<() => void> = [];
  const ticker = {
    deltaMS: 0,
    add(fn: () => void) {
      fns.push(fn);
      return ticker;
    },
    remove(fn: () => void) {
      const i = fns.indexOf(fn);
      if (i >= 0) fns.splice(i, 1);
      return ticker;
    },
    tick(ms: number) {
      ticker.deltaMS = ms;
      for (const fn of [...fns]) fn();
    },
  };
  return ticker as unknown as Ticker & { tick(ms: number): void };
}

function makeDisplay() {
  const ticker = fakeTicker();


  const backgroundPosition = { x: 0, y: 0, set: vi.fn() };
  const background = {
    position: backgroundPosition,
    getLocalBounds: () => ({ x: 0, y: 0, width: 340, height: 110 }),
  } as unknown as PixiContainer;
  const finishTexture = { width: 20, height: 20 } as unknown as Texture;
  const labels: string[] = [];
  const makeLabel = vi.fn((text: string) => {
    labels.push(text);
    const position = {
      x: 0,
      y: 0,
      set(nx: number, ny: number = nx) {
        position.x = nx;
        position.y = ny;
      },
    };
    return {
      position,
      scale: { x: 1, y: 1 },
      getLocalBounds: () => ({ width: 100, height: 20 }),
      destroy: vi.fn(),
    } as unknown as PixiContainer;
  });
  const display = new StatusTextDisplay({ background, finishTexture, makeLabel, ticker });
  return { display, ticker, makeLabel, labels, backgroundPosition };
}

function tap(display: StatusTextDisplay): void {
  (display as unknown as { emit(e: string): void }).emit("pointertap");
}

// Child order: [backdrop, background, finishSprite, ...label?] (see statusText.ts's constructor).
function finishVisible(display: StatusTextDisplay): boolean {
  return (display as unknown as { children: { visible: boolean }[] }).children[2]!.visible;
}

describe("StatusTextDisplay", () => {
  it("starts hidden", () => {
    const { display } = makeDisplay();
    expect(display.visible).toBe(false);
  });

  it("centers the scale9 background by its REAL rendered size, not the 300x70 content box", () => {


    const { backgroundPosition } = makeDisplay();
    expect(backgroundPosition.set).toHaveBeenCalledWith(-170, -55);
  });

  it("scales the backdrop independently: width x1.11, height x1.5 (status-text-geometry.md)", () => {
    const { display } = makeDisplay();
    const backdrop = (display as unknown as { children: { position: { x: number; y: number } }[] }).children[0]!;
    // round(300*1.11)=333, round(70*1.5)=105 -> centered at (-round(333/2), -round(105/2)).
    expect(backdrop.position.x).toBe(-167);
    expect(backdrop.position.y).toBe(-53);
  });

  it("pins the label's top-left to the BOX top-left (-w/2,-h/2), never centering it", () => {
    const { display } = makeDisplay();
    display.push("a wrapped line");
    const label = (display as unknown as { labelNode: { position: { x: number; y: number } } }).labelNode;
    expect(label.position.x).toBe(-150);
    expect(label.position.y).toBe(-35);
  });

  it("claims taps ANYWHERE while visible (ccTouchBegan returns visible, unbounded)", () => {
    const { display } = makeDisplay();
    const hitArea = (display as unknown as { hitArea: { contains(x: number, y: number): boolean } }).hitArea;
    expect(hitArea.contains(99999, -99999)).toBe(true);
  });

  it("push() while idle shows immediately but does NOT raise the finish node", () => {


    const { display, labels } = makeDisplay();
    display.push("FireCub → Ember @ Minotaur");
    expect(display.visible).toBe(true);
    expect(labels).toEqual(["FireCub → Ember @ Minotaur"]);
    expect(finishVisible(display)).toBe(false);
    display.showFinishNode();
    expect(finishVisible(display)).toBe(true);
  });

  it("positions the finish cursor in the BOTTOM-right corner (parentAnchor {1,0} + Y-down flip)", () => {
    const { display } = makeDisplay();
    // finishTexture is 20x20 px -> pointSprite's 1/CSF fold makes it 10x10 pt. Box 300x70,
    // center-origin Pixi-Y-DOWN frame: bottom-right corner is (+150, +35); the top-left-anchored
    // sprite is tucked inside it at (150-10, 35-10). A missing Cocos-Y-up->Pixi-Y-down flip would
    // put y at -35 (TOP-right) — the regression this test pins.
    const finish = (display as unknown as { children: { position: { x: number; y: number } }[] }).children[2]!;
    expect(finish.position.x).toBe(300 / 2 - 10);
    expect(finish.position.y).toBe(70 / 2 - 10);
  });

  it("a tap ACKNOWLEDGES without clearing or hiding (triggerTouchEvent, autoCloseOnFinish 0)", () => {


    const { display } = makeDisplay();
    display.push("line1");
    display.showFinishNode();
    tap(display);
    expect(display.visible).toBe(true);
    expect(finishVisible(display)).toBe(false);
    expect(display.hasText).toBe(true);
    expect(display.buffer.combined).toBe("line1");
  });

  it("clearStatusText() is the only thing that empties and hides the box (Battle state 2)", () => {
    const { display } = makeDisplay();
    display.push("line1");
    tap(display);
    expect(display.hasText).toBe(true); // acknowledged, still not cleared
    display.clearStatusText();
    expect(display.visible).toBe(false);
    expect(display.hasText).toBe(false);
    expect(display.buffer.combined).toBeNull();
  });

  it("a skip-chain accumulates across acknowledgments instead of restarting each time", () => {
    // The scenario this whole model exists for: consecutive status-skipped turns each append a
    // LoosesTurnKey line and each get acknowledged, but none of them reaches Battle state 2, so
    // nothing clears in between and the block grows.
    const { display, labels } = makeDisplay();
    display.push("A looses a turn!");
    tap(display);
    display.push("B looses a turn!");
    tap(display);
    display.push("C looses a turn!");
    expect(labels.at(-1)).toBe("A looses a turn!\nB looses a turn!\nC looses a turn!");
    expect(display.visible).toBe(true);
  });

  it("waitForAcknowledgment holds queue continuation until the block is acknowledged", async () => {
    const { display } = makeDisplay();
    display.push("Run away fail");
    let continued = false;
    let cause: unknown;
    const wait = display.waitForAcknowledgment().then((value) => {
      continued = true;
      cause = value;
    });
    await Promise.resolve();
    expect(continued).toBe(false);
    tap(display);
    await wait;
    expect(continued).toBe(true);
    expect(cause).toBe("manual");
  });

  it("does not buffer a tap completed before the state-1 acknowledgment waiter is armed", async () => {
    const { display } = makeDisplay();
    display.push("FireCub loses its turn!");
    tap(display); // visible ChainedTextLabel swallows it, but no state-1 callback is waiting yet

    let continued = false;
    let cause: unknown;
    const wait = display.waitForAcknowledgment().then((value) => {
      continued = true;
      cause = value;
    });
    await Promise.resolve();
    expect(continued).toBe(false);

    tap(display);
    await wait;
    expect(continued).toBe(true);
    expect(cause).toBe("manual");
  });

  it("waitForAcknowledgment resolves immediately when there is no text (case 1's else branch)", async () => {
    const { display } = makeDisplay();
    let continued = false;
    let cause: unknown;
    await display.waitForAcknowledgment().then((value) => {
      continued = true;
      cause = value;
    });
    expect(continued).toBe(true);
    expect(cause).toBe("none");
  });

  it("every push while visible live-updates the display with the combined backlog (appendStatusText: re-enqueue)", () => {
    const { display, labels } = makeDisplay();
    display.push("line1");
    display.push("line2");
    display.push("line3");
    expect(labels).toEqual(["line1", "line1\nline2", "line1\nline2\nline3"]);
    expect(display.visible).toBe(true);
    tap(display); // acknowledging does not dismiss — see the triggerTouchEvent test above
    expect(display.visible).toBe(true);
  });

  it("a 5th line trims to the last 4 components and re-renders WITH the trailing newline", () => {


    const { display, labels } = makeDisplay();
    for (let i = 1; i <= 5; i++) display.push(`line${i}`);
    expect(labels.at(-1)).toBe("line2\nline3\nline4\nline5\n");
    expect(display.visible).toBe(true);
  });

  it("pushEvents formats BattleEvents through formatEventLines, live-updating per line", () => {
    const { display, labels } = makeDisplay();
    display.pushEvents(
      [
        { type: "abilityUsed", source: "t0m0:FireCub", ability: "Fire.Ember", targets: ["t1m0:Minotaur"] },
        { type: "died", living: "t1m0:Minotaur" },
      ],
      (id) => id.split(":").at(-1) ?? id,
    );
    expect(labels).toEqual([
      "FireCub → Ember @ Minotaur",
      "FireCub → Ember @ Minotaur\nMinotaur fainted",
    ]);
  });

  it("auto-acknowledges after exactly 5.0s of no tap, without dismissing or clearing", async () => {
    const { display, ticker, labels } = makeDisplay();
    display.push("line1");
    display.showFinishNode();
    let acknowledged = false;
    let cause: unknown;
    const wait = display.waitForAcknowledgment().then((value) => {
      acknowledged = true;
      cause = value;
    });
    ticker.tick(4999);
    expect(acknowledged).toBe(false);
    ticker.tick(1); // crosses the 5000ms waitLimit
    await wait;
    expect(acknowledged).toBe(true);
    expect(cause).toBe("wait-limit");
    expect(display.visible).toBe(true);
    expect(display.hasText).toBe(true);
    expect(labels).toEqual(["line1"]);
  });

  it("the waitLimit keeps re-firing every 5s while the box stays visible (update: is gated on visible only)", async () => {


    const { display, ticker } = makeDisplay();
    display.push("line1");
    let acks = 0;
    const arm = () => void display.waitForAcknowledgment().then(() => { acks++; arm(); });
    arm();
    ticker.tick(5000);
    await Promise.resolve();
    expect(acks).toBe(1);
    ticker.tick(5000);
    await Promise.resolve();
    expect(acks).toBe(2);
  });

  it("every push restarts the 5s waitLimit window (addStrings: re-show)", async () => {
    const { display, ticker } = makeDisplay();
    display.push("line1");
    let acknowledged = false;
    const wait = display.waitForAcknowledgment().then(() => {
      acknowledged = true;
    });
    ticker.tick(4000);
    display.push("line2");
    ticker.tick(4999);
    await Promise.resolve();
    expect(acknowledged).toBe(false); // 8999ms total, but only 4999ms since the last push
    ticker.tick(1); // 5000ms since the last push
    await wait;
    expect(acknowledged).toBe(true);
  });

  it("the finish node blinks once per second once RAISED (CCBlink 1.0s/1 blink)", () => {
    const { display, ticker } = makeDisplay();
    display.push("line1");
    display.showFinishNode();
    expect(finishVisible(display)).toBe(true);
    ticker.tick(500);
    expect(finishVisible(display)).toBe(false);
    ticker.tick(500);
    expect(finishVisible(display)).toBe(true);
  });

  it("destroy() detaches from the ticker (no further blink/auto-advance ticks)", () => {
    const { display, ticker } = makeDisplay();
    display.push("line1");
    display.destroy();
    expect(() => ticker.tick(10_000)).not.toThrow();
  });
});

describe("StatusTextDisplay page mode (addStrings: multi-page queue, flow doc §4)", () => {
  it("shows page 1 immediately; each tap advances one page; the box hides on drain", () => {
    const { display, labels } = makeDisplay();
    display.showPages(["Monsters Have Leveled Up!", "Sparkeon is now level 6!", "+3 Attack"]);
    expect(display.visible).toBe(true);
    expect(labels).toEqual(["Monsters Have Leveled Up!"]);
    tap(display);
    expect(labels).toEqual(["Monsters Have Leveled Up!", "Sparkeon is now level 6!"]);
    expect(display.visible).toBe(true);
    tap(display);
    expect(labels.at(-1)).toBe("+3 Attack");
    tap(display);
    expect(display.visible).toBe(false);
    expect(display.pendingPages).toEqual([]);
  });

  it("fires the finish invocation exactly once, only when the LAST page is advanced past", () => {
    const { display } = makeDisplay();
    let finished = 0;
    display.showPages(["a", "b"], () => finished++);
    tap(display);
    expect(finished).toBe(0);
    tap(display);
    expect(finished).toBe(1);

    display.push("line");
    tap(display);
    expect(finished).toBe(1);
  });

  it("each page restarts the 5s waitLimit; auto-advance walks the queue like taps", () => {
    const { display, ticker } = makeDisplay();
    let finished = 0;
    display.showPages(["a", "b"], () => finished++);
    ticker.tick(4999);
    expect(display.visible).toBe(true);
    ticker.tick(1); // page a auto-advances -> page b, fresh window
    expect(display.visible).toBe(true);
    expect(finished).toBe(0);
    ticker.tick(5000); // page b auto-advances -> drain
    expect(display.visible).toBe(false);
    expect(finished).toBe(1);
  });

  it("refuses an empty page list", () => {
    const { display } = makeDisplay();
    expect(() => display.showPages([])).toThrow(/at least one page/);
  });


  it("appends level-up pages AFTER a live combined backlog instead of refusing", () => {
    const { display, labels } = makeDisplay();
    display.push("Sparkeon is asleep!");
    expect(labels.at(-1)).toBe("Sparkeon is asleep!");

    display.showPages(["Monsters Have Leveled Up!", "Sparkeon is now level 6!"]);
    // dialogStrings[0] is still the leftover combat block — the pages queued behind it.
    expect(labels.at(-1)).toBe("Sparkeon is asleep!");
    expect(display.pendingPages).toEqual([
      "Sparkeon is asleep!",
      "Monsters Have Leveled Up!",
      "Sparkeon is now level 6!",
    ]);

    tap(display);
    expect(labels.at(-1)).toBe("Monsters Have Leveled Up!");
    tap(display);
    expect(labels.at(-1)).toBe("Sparkeon is now level 6!");
  });

  it("runs the finish invocation once the backlog-seeded queue drains", () => {
    const { display } = makeDisplay();
    display.push("combat line");
    let finished = 0;
    display.showPages(["only page"], () => finished++);
    tap(display); // pops the seeded backlog
    expect(finished).toBe(0);
    tap(display); // pops the single level-up page -> drain
    expect(finished).toBe(1);
  });

  it("destroy() drops queued pages without firing the finish invocation", () => {
    const { display, ticker } = makeDisplay();
    let finished = 0;
    display.showPages(["a", "b"], () => finished++);
    display.destroy();
    expect(() => ticker.tick(10_000)).not.toThrow();
    expect(finished).toBe(0);
  });
});
