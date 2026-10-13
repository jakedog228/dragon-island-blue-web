import { describe, expect, it, vi } from "vitest";
import { Container, Sprite, Texture, TextureSource, type Ticker } from "pixi.js";
import type { AssetLibrary } from "@dib/renderer";
import { EnemyMonsterDisplay } from "../src/battle/enemyMonsterDisplay.js";
import { EnemyTeamDisplay } from "../src/battle/enemyTeamDisplay.js";
import { refreshRuntimeSettingCaches } from "../src/runtimeSettingsRefresh.js";

const settings = vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest" } });
  return { mode: "iphone" as "iphone" | "ipad" };
});
vi.mock("../src/runtimeSettings.js", () => ({ get DISPLAY_MODE() { return settings.mode; } }));
vi.mock("@dib/renderer", async importOriginal => ({
  ...await importOriginal<typeof import("@dib/renderer")>(),
  // Only font rasterization needs a DOM; exercise real bars, textures and transforms.
  makeTtfLabel: () => new Sprite(new Texture({ source: new TextureSource({ width: 100, height: 15 }) })),
}));

type Internals = { membersBox: Container; displays: Map<string, EnemyMonsterDisplay> };
function fixture(mode: "iphone" | "ipad", count: number) {
  settings.mode = mode;
  refreshRuntimeSettingCaches();
  const team = new EnemyTeamDisplay({ assets: {} as AssetLibrary, ticker: {} as Ticker });
  const internals = team as unknown as Internals;
  internals.membersBox.position.set(113, 20);
  const texture = (w: number, h: number) => new Texture({ source: new TextureSource({ width: w, height: h }) });
  const displays = Array.from({ length: count }, (_, i) => {
    const display = new EnemyMonsterDisplay({ name: `Boss ${i}`, nameColor: 0xffffff,
      monsterTexture: texture(60, 80), hpBackTexture: texture(168, 20), hpForeTexture: texture(160, 16),
      elementTexture: texture(48, 48), maxHp: 200, hp: 200, ticker: {} as Ticker });
    display.position.set(i * 128, 0);
    internals.membersBox.addChild(display);
    internals.displays.set(String(i), display);
    return display;
  });
  return { team, internals, displays };
}

describe.each(["iphone", "ipad"] as const)("standard wide boss bars: %s", mode => {
  const left = mode === "iphone" ? 70 : 80;
  const right = mode === "iphone" ? 480 : 512;
  it("stretches only horizontally across the enemy area and retains native HP easing", () => {
    const { team, displays: [boss], internals } = fixture(mode, 1);
    const native = boss!.healthBarState;
    const childCount = boss!.children.length;
    team.setWideHealthBarIds("boss-mod", ["0"]);
    team.update(16);
    expect(team.wideHealthBarState[0]).toMatchObject({ x: left, w: expect.closeTo(right - left), h: native.h, ratio: 1 });
    expect(boss!.children).toHaveLength(childCount);
    const [, name, badge] = boss!.healthBarNodes;
    expect(badge!.getBounds().minY).toBeGreaterThanOrEqual(0);
    const badgeBox = badge!.getBounds(), nameBox = name!.getBounds();
    expect((badgeBox.minY + badgeBox.maxY) / 2).toBeCloseTo((nameBox.minY + nameBox.maxY) / 2);
    for (const node of boss!.healthBarNodes) {
      expect(node.parent).toBe(boss);
      expect(node.parentRenderLayer).toBe(team.children.at(-1));
    }
    boss!.setHp(100);
    team.update(16);
    expect(team.wideHealthBarState[0]).toMatchObject({ ratio: .5, displayedRatio: .975 });
    for (let i = 0; i < 20; i++) team.update(16);
    expect(team.wideHealthBarState[0]!.displayedRatio).toBe(.5);
    // A reflow must never shift the stretched endpoints into the turn-order column.
    internals.membersBox.x += 35;
    boss!.x -= 12;
    team.update(16);
    expect(team.wideHealthBarState[0]).toMatchObject({ x: left, w: expect.closeTo(right - left) });
    team.setWideHealthBarIds("boss-mod", []);
    expect(boss!.healthBarNodes.every(node => !node.parentRenderLayer)).toBe(true);
    expect(boss!.healthBarState).toMatchObject({ x: native.x, y: native.y, w: native.w, h: native.h });
    team.destroy({ children: true });
  });

  it("composes boss mods in separate rows and leaves ordinary enemy chrome alone", () => {
    const { team, displays } = fixture(mode, 3);
    team.update(16);
    const ordinary = displays[2]!.healthBarState;
    team.setWideHealthBarIds("other-mod", ["0"]);
    team.setWideHealthBarIds("boss-mod", ["1"]);
    team.update(16);
    const bars = team.wideHealthBarState;
    expect(bars.map(bar => bar.id)).toEqual(["0", "1"]);
    for (const bar of bars) { expect(bar.x).toBe(left); expect(bar.x + bar.w).toBeCloseTo(right); }
    expect(bars[0]!.y).toBeGreaterThan(20 + ordinary.y + ordinary.h);
    expect(bars[1]!.y - bars[0]!.y).toBeGreaterThan(bars[0]!.h + 15);
    expect(displays[2]!.healthBarState).toMatchObject(ordinary);
    team.setWideHealthBarIds("other-mod", []);
    expect(team.wideHealthBarState.map(bar => bar.id)).toEqual(["1"]);
    team.destroy({ children: true });
  });

  it("applies opt-in to promoted reserves and drops dead displays", () => {
    const { team, internals, displays } = fixture(mode, 2);
    internals.membersBox.removeChild(displays[1]!);
    team.setWideHealthBarIds("other-mod", ["0", "1"]);
    expect(team.wideHealthBarState.map(bar => bar.id)).toEqual(["0"]);
    internals.displays.delete("0");
    displays[0]!.destroy({ children: true });
    internals.membersBox.addChild(displays[1]!);
    team.update(16);
    expect(team.wideHealthBarState).toHaveLength(1);
    expect(team.wideHealthBarState[0]).toMatchObject({ id: "1", x: left, w: expect.closeTo(right - left) });
    team.destroy({ children: true });
  });
});
