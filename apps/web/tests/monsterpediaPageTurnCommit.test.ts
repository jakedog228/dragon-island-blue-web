import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
  // Building the curl shader makes Pixi probe fragment precision through a throwaway canvas.
  // Handing it a context-less one keeps it on its default without a GL implementation here.
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ getContext: () => null }) },
  });
});

const { Container } = await import("pixi.js");
type Renderer = import("pixi.js").Renderer;
type Ticker = import("pixi.js").Ticker;
const { runMonsterpediaPageTurn } = await import("../src/world/monsterpediaPageTurn.js");

/**
 * Pixi drives rendering from a ticker listener registered at UPDATE_PRIORITY.LOW, so the frame's
 * draw happens after the animation listeners but still inside the same task. A promise
 * continuation resumes only once that task's microtask checkpoint is reached, i.e. after the
 * draw. This ticker reproduces that order: listeners, then the frame observation, then (via the
 * awaiting caller) microtasks.
 */
class FrameOrderedTicker {
  readonly deltaMS = 1000 / 60;
  private readonly listeners: (() => void)[] = [];
  constructor(private readonly onFrameRendered: () => void) {}
  add(listener: () => void): void {
    this.listeners.push(listener);
  }
  remove(listener: () => void): void {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) this.listeners.splice(index, 1);
  }
  tick(): void {
    for (const listener of [...this.listeners]) listener();
    this.onFrameRendered();
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
}

interface Frame {
  readonly transitionOnScreen: boolean;
  readonly liveScene: string | undefined;
}

function runTurn(backwards: boolean, borrowedGroups = false): { frames: Frame[]; settled: Promise<boolean> } {
  const host = new Container();
  const outgoing = new Container();
  outgoing.label = "sceneRoot";
  const oldPage = new Container();
  oldPage.label = "old";
  outgoing.addChild(oldPage);
  host.addChild(outgoing);

  const newPage = new Container();
  newPage.label = "new";
  const incoming = new Container();
  incoming.addChild(newPage);

  if (borrowedGroups) { outgoing.enableRenderGroup(); incoming.enableRenderGroup(); }
  const outgoingGroup = outgoing.renderGroup, incomingGroup = incoming.renderGroup;
  const frames: Frame[] = [];
  const ticker = new FrameOrderedTicker(() => {
    frames.push({
      transitionOnScreen: host.children.some(
        (child) => child.label === "monsterpediaPageTurn",
      ),
      liveScene: outgoing.visible ? outgoing.children[0]?.label : undefined,
    });
  });

  const settled = runMonsterpediaPageTurn({
    // The composition captures both scenes once up front; nothing else touches the renderer.
    renderer: { render: ({ container }: { container: InstanceType<typeof Container> }) => container.enableRenderGroup() } as unknown as Renderer,
    ticker: ticker as unknown as Ticker,
    host,
    outgoing,
    incoming,
    widthPt: 480,
    heightPt: 320,
    backwards,
    commit: () => {
      outgoing.removeChildren();
      outgoing.addChild(newPage);
    },
    signal: new AbortController().signal,
  });

  expect(outgoing.renderGroup).toBe(outgoingGroup);
  expect(incoming.renderGroup).toBe(incomingGroup);

  // 200ms at 60fps, plus slack for the Cocos interval's dt-free first tick.
  for (let frame = 0; frame < 20 && ticker.listenerCount > 0; frame += 1) ticker.tick();
  return { frames, settled };
}

describe("Monsterpedia page turn scene swap", () => {
  it("preserves existing scene render groups while capturing the page", async () => {
    await expect(runTurn(false, true).settled).resolves.toBe(true);
  });

  it.each([
    ["forwards", false],
    ["backwards", true],
  ])("never renders the outgoing page bare after the curl ends (%s)", async (_name, backwards) => {
    const { frames, settled } = runTurn(backwards);
    await expect(settled).resolves.toBe(true);

    // The bug: the commit landed in a promise continuation, so the frame that removed the
    // transition still held the pre-turn page and flashed it for one frame.
    const flicker = frames.filter(
      (frame) => !frame.transitionOnScreen && frame.liveScene === "old",
    );
    expect(flicker).toEqual([]);
    expect(frames.at(-1)).toEqual({ transitionOnScreen: false, liveScene: "new" });
  });

  it("keeps the outgoing page hidden behind the curl for every animating frame", async () => {
    const { frames, settled } = runTurn(false);
    await expect(settled).resolves.toBe(true);
    const animating = frames.slice(0, -1);
    expect(animating.length).toBeGreaterThan(1);
    expect(animating.every((frame) => frame.transitionOnScreen)).toBe(true);
    expect(animating.every((frame) => frame.liveScene === undefined)).toBe(true);
  });
});
