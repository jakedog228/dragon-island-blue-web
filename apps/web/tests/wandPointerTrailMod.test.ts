import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { importCodeModArchive, resolveCodeModProfile } from "@dib/mod-kernel";
import { createFullTrustCodeModRuntime } from "../src/content/codeModRuntime.js";

const workspace = resolve(import.meta.dirname, "../../..");
const modRoot = resolve(workspace, "examples/mods/wand-pointer-trail");

class FakeCanvas extends EventTarget {
  getBoundingClientRect() {
    return { left: 10, top: 20, width: 200, height: 100 };
  }
}

class FakeGraphics {
  label = "";
  eventMode = "auto";
  zIndex = 0;
  destroyed = false;
  activePointerCount = 0;
  particleCount = 0;
  drawCalls = 0;
  readonly circleRadii: number[] = [];
  parent: FakeDisplayStage | undefined;

  clear() { this.drawCalls = 0; this.circleRadii.length = 0; return this; }
  circle(_x: number, _y: number, radius: number) {
    this.drawCalls += 1;
    this.circleRadii.push(radius);
    return this;
  }
  star() { this.drawCalls += 1; return this; }
  roundRect() { this.drawCalls += 1; return this; }
  fill() { return this; }
  stroke() { return this; }
  destroy() {
    this.destroyed = true;
    this.parent?.removeChild(this);
  }
}

class FakeContainer {
  label = "";
  eventMode = "auto";
  cursor = "default";
  hitArea: unknown;
  readonly children: Array<FakeContainer | FakeGraphics> = [];
  readonly position = {
    x: 0,
    y: 0,
    set: (x: number, y: number) => {
      this.position.x = x;
      this.position.y = y;
    },
  };
  private readonly listeners = new Map<string, Array<(event: never) => void>>();

  addChild(...children: Array<FakeContainer | FakeGraphics>) {
    this.children.push(...children);
    return children[0];
  }

  on(name: string, listener: (event: never) => void) {
    const registered = this.listeners.get(name) ?? [];
    registered.push(listener);
    this.listeners.set(name, registered);
    return this;
  }

  emit(name: string, event: unknown) {
    for (const listener of this.listeners.get(name) ?? []) listener(event as never);
  }
}

class FakeLabel extends FakeContainer {
  readonly anchor = { set() {} };
  readonly style = { fill: 0xffffff };
  height = 16;
  width = 0;
  private value: string;

  constructor(text: string) {
    super();
    this.value = text;
    this.width = text.length * 8;
  }

  get text() { return this.value; }
  set text(value: string) {
    this.value = value;
    this.width = value.length * 8;
  }
}

class FakeRectangle {
  constructor(
    readonly x: number,
    readonly y: number,
    readonly width: number,
    readonly height: number,
  ) {}
}

class FakePopup {
  static show(parent: unknown, options: unknown) { return { parent, options }; }
}

class FakeDisplayStage {
  readonly children: FakeGraphics[] = [];

  addChild(child: FakeGraphics) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeGraphics) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parent = undefined;
  }
}

class FakeTicker {
  deltaMS = 0;
  readonly listeners = new Set<(ticker: FakeTicker) => void>();

  add(listener: (ticker: FakeTicker) => void) { this.listeners.add(listener); }
  remove(listener: (ticker: FakeTicker) => void) { this.listeners.delete(listener); }
  tick(deltaMS: number) {
    this.deltaMS = deltaMS;
    for (const listener of [...this.listeners]) listener(this);
  }
}

function pointerEvent(
  type: string,
  values: {
    pointerId: number;
    pointerType: "mouse" | "touch" | "pen";
    clientX: number;
    clientY: number;
    button: number;
    buttons: number;
  },
): Event {
  const event = new Event(type);
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  return event;
}

function fakeBoot() {
  const canvas = new FakeCanvas();
  const displayStage = new FakeDisplayStage();
  const ticker = new FakeTicker();
  return {
    canvas,
    displayStage,
    ticker,
    value: {
      stage: {
        destroyed: false,
        app: {
          canvas,
          screen: { width: 1_000, height: 500 },
          stage: displayStage,
          ticker,
        },
      },
    },
  };
}

it("shows a passive wand trail only during held canvas pointers and cleans up across boots", async () => {
  const manifest = await readFile(resolve(modRoot, "manifest.json"), "utf8");
  const entry = await readFile(resolve(modRoot, "scripts/main.js"), "utf8");
  const pkg = await importCodeModArchive(zipSync({
    "manifest.json": strToU8(manifest),
    "scripts/main.js": strToU8(entry),
  }), "wand-pointer-trail.dibmod");
  const profile = await resolveCodeModProfile([pkg]);
  const fakeWindow = new EventTarget();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  let runtime: Awaited<ReturnType<typeof createFullTrustCodeModRuntime>> | undefined;

  try {
    const modules = new Map<string, unknown>([
      ["pixi.js", {
        Container: FakeContainer,
        Graphics: FakeGraphics,
        Rectangle: FakeRectangle,
      }],
      ["@dib/renderer", { makeTtfLabel: (text: string) => new FakeLabel(text) }],
      ["web/ui/popup.ts", { Popup: FakePopup }],
      ["web/world/optionsMath.ts", {
        optionsLayout: () => ({ fontSize: 16, outlineWidth: 2 }),
      }],
      ["web/runtimeSettings.ts", { DISPLAY_MODE: "iphone" }],
    ]);
    runtime = await createFullTrustCodeModRuntime(profile, {
      modules: {
        list: () => [...modules.keys()],
        has: (id) => modules.has(id),
        load: async (id) => {
          const loaded = modules.get(id);
          if (loaded === undefined) throw new Error(`unexpected module ${id}`);
          return loaded;
        },
      },
    });
    const first = fakeBoot();
    await runtime.runPhase("boot:ready", first.value);
    const exported = runtime.host.require<{ storageKey: string; scaleRange: {
      min: number;
      max: number;
      step: number;
    }; snapshot(): {
      installed: boolean;
      activePointers: number;
      particles: number;
      scale: number;
    } }>("mods.dev.dragonislandblue.wand-pointer-trail");
    const overlay = first.displayStage.children[0];
    if (overlay === undefined) throw new Error("wand trail overlay was not mounted");

    expect(overlay).toMatchObject({
      label: "wandPointerTrail",
      eventMode: "none",
      activePointerCount: 0,
      particleCount: 0,
    });
    expect(exported.snapshot().scale).toBe(1);
    expect(exported.scaleRange).toEqual({ min: 0.5, max: 5, step: 0.05 });
    expect(first.ticker.listeners.size).toBe(1);

    // The shared Popup class gains one actual draggable row whenever it receives Options content.
    const optionsContent = new FakeContainer();
    optionsContent.label = "portOptionsContent";
    for (let index = 0; index < 4; index += 1) {
      const label = new FakeLabel(`Row ${index}:`);
      label.position.set(50, index * 56);
      const controls = new FakeContainer();
      controls.position.set(120, index * 56);
      const choice = new FakeLabel(`${index}`);
      choice.label = `optionsChoice:row${index}:value`;
      controls.addChild(choice);
      optionsContent.addChild(label, controls);
    }
    const popupResult = FakePopup.show(null, {
      content: optionsContent,
      sfx: { onButtonPress: () => undefined },
    });
    expect(popupResult).toBeDefined();
    const slider = optionsContent.children.find((child) =>
      child.label === "optionsChoice:wandTrailScale:slider",
    );
    expect(slider).toBeInstanceOf(FakeContainer);
    if (!(slider instanceof FakeContainer)) throw new Error("Options slider was not added");
    const sliderEvent = {
      pointerId: 41,
      stopPropagation() {},
      getLocalPosition: () => ({ x: 130, y: 0 }),
    };
    slider.emit("pointerdown", sliderEvent);
    slider.emit("pointerup", sliderEvent);
    expect(exported.snapshot().scale).toBe(5);
    expect(stored.get(exported.storageKey)).toBe(JSON.stringify({ scale: 5 }));
    expect((slider.children[2] as FakeLabel).text).toBe("5.00x");

    // Hovering and non-primary mouse presses never emit.
    fakeWindow.dispatchEvent(pointerEvent("pointermove", {
      pointerId: 1, pointerType: "mouse", clientX: 40, clientY: 40, button: -1, buttons: 0,
    }));
    first.canvas.dispatchEvent(pointerEvent("pointerdown", {
      pointerId: 1, pointerType: "mouse", clientX: 40, clientY: 40, button: 2, buttons: 2,
    }));
    first.ticker.tick(16);
    expect(exported.snapshot()).toEqual({
      installed: true, activePointers: 0, particles: 0, scale: 5,
    });

    first.canvas.dispatchEvent(pointerEvent("pointerdown", {
      pointerId: 1, pointerType: "mouse", clientX: 30, clientY: 35, button: 0, buttons: 1,
    }));
    expect(exported.snapshot()).toMatchObject({ activePointers: 1, particles: 55, scale: 5 });
    fakeWindow.dispatchEvent(pointerEvent("pointermove", {
      pointerId: 1, pointerType: "mouse", clientX: 110, clientY: 70, button: -1, buttons: 1,
    }));
    first.ticker.tick(40);
    expect(overlay.activePointerCount).toBe(1);
    expect(overlay.particleCount).toBeGreaterThan(11);
    expect(overlay.drawCalls).toBeGreaterThan(overlay.particleCount);
    expect(overlay.circleRadii.some((radius) => radius >= 16)).toBe(true);

    fakeWindow.dispatchEvent(pointerEvent("pointerup", {
      pointerId: 1, pointerType: "mouse", clientX: 110, clientY: 70, button: 0, buttons: 0,
    }));
    expect(exported.snapshot().activePointers).toBe(0);
    expect(exported.snapshot().particles).toBeGreaterThan(0);
    for (let index = 0; index < 6; index += 1) first.ticker.tick(100);
    expect(exported.snapshot()).toEqual({
      installed: true, activePointers: 0, particles: 0, scale: 5,
    });

    // Touch uses the same held-pointer path, and a later renderer boot replaces every old owner.
    first.canvas.dispatchEvent(pointerEvent("pointerdown", {
      pointerId: 7, pointerType: "touch", clientX: 60, clientY: 55, button: 0, buttons: 1,
    }));
    expect(exported.snapshot().activePointers).toBe(1);
    const second = fakeBoot();
    await runtime.runPhase("boot:ready", second.value);
    expect(overlay.destroyed).toBe(true);
    expect(first.displayStage.children).toHaveLength(0);
    expect(first.ticker.listeners.size).toBe(0);
    expect(second.displayStage.children).toHaveLength(1);
    expect(exported.snapshot()).toEqual({
      installed: true, activePointers: 0, particles: 0, scale: 5,
    });

    // The detached canvas no longer starts effects; the new canvas does.
    first.canvas.dispatchEvent(pointerEvent("pointerdown", {
      pointerId: 8, pointerType: "touch", clientX: 60, clientY: 55, button: 0, buttons: 1,
    }));
    expect(exported.snapshot().activePointers).toBe(0);
    second.canvas.dispatchEvent(pointerEvent("pointerdown", {
      pointerId: 8, pointerType: "pen", clientX: 60, clientY: 55, button: 0, buttons: 1,
    }));
    expect(exported.snapshot().activePointers).toBe(1);

    runtime.dispose();
    expect(exported.snapshot()).toEqual({
      installed: false, activePointers: 0, particles: 0, scale: 5,
    });
    expect(second.displayStage.children).toHaveLength(0);
    expect(second.ticker.listeners.size).toBe(0);
  } finally {
    runtime?.dispose();
    if (previousWindow === undefined) delete (globalThis as Record<string, unknown>)["window"];
    else Object.defineProperty(globalThis, "window", previousWindow);
    if (previousLocalStorage === undefined) {
      delete (globalThis as Record<string, unknown>)["localStorage"];
    } else {
      Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
    }
  }
});
