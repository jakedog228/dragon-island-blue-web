// Opt-in retained-map town contract. Run only with operator authorization; Chromium is muted.
// Fidelity sign-off requires two runs: DIB_TOWN_DISPLAY_MODE=iphone and =ipad. Each mode writes
// to its own default output folder so neither run can masquerade as the other mode's evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const expectedDisplayMode = process.env.DIB_TOWN_DISPLAY_MODE ?? "ipad";
if (expectedDisplayMode !== "iphone" && expectedDisplayMode !== "ipad") {
  throw new Error(
    `DIB_TOWN_DISPLAY_MODE must be "iphone" or "ipad", got ${JSON.stringify(expectedDisplayMode)}`,
  );
}
const outputDir = process.env.DIB_TOWN_OUTPUT
  ? path.resolve(process.env.DIB_TOWN_OUTPUT)
  : path.resolve(
      import.meta.dirname,
      `../../../../output/town-loop-browser-${expectedDisplayMode}`,
    );
fs.mkdirSync(outputDir, { recursive: true });
for (const name of [
  "00-world.png",
  "01-town-entry.png",
  "02-town-reveal-1s.png",
  "02a-town-style0-editor.png",
  "02b-town-remove-all-confirm.png",
  "03-town-partial-zoom.png",
  "03b-town-nameplate.png",
  "04-town-full-zoom.png",
  "05-town-early-exit-start.png",
  "06-town-chrome-hidden-500ms.png",
  "07-world-restored.png",
  "failure.png",
]) fs.rmSync(path.join(outputDir, name), { force: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

const closeTo = (actual, expected, epsilon = 1e-5) =>
  Math.abs(actual - expected) <= epsilon;

function assertTransform(actual, expected, message, epsilon = 1e-5) {
  for (const key of ["x", "y", "scaleX", "scaleY", "pivotX", "pivotY"]) {
    assert(
      closeTo(actual[key], expected[key], epsilon),
      `${message}: ${key} ${actual[key]} != ${expected[key]}`,
    );
  }
}

function assertBounds(actual, expected, message, epsilon = 1e-3) {
  for (const key of ["x", "y", "w", "h"]) {
    assert(
      closeTo(actual[key], expected[key], epsilon),
      `${message}: ${key} ${actual[key]} != ${expected[key]}`,
    );
  }
}

function assertHeroFollowsWorld(actual, baseline, message) {
  assert(actual.heroXp?.effectiveVisible, `${message}: Hero XP is not visible`);
  assert(closeTo(actual.heroXp.effectiveAlpha, 1), `${message}: Hero XP opacity changed`);
  assertTransform(
    actual.heroXp.localTransform,
    baseline.heroXp.localTransform,
    `${message}: Hero XP local transform`,
  );
  const expectedScaleRatio =
    actual.worldSurface.scaleX / baseline.worldSurface.scaleX;
  assert(
    closeTo(
      actual.heroXp.worldTransform.a / baseline.heroXp.worldTransform.a,
      expectedScaleRatio,
      1e-3,
    ),
    `${message}: Hero XP x-scale did not inherit the whole-scene transform`,
  );
  assert(
    closeTo(
      actual.heroXp.worldTransform.d / baseline.heroXp.worldTransform.d,
      expectedScaleRatio,
      1e-3,
    ),
    `${message}: Hero XP y-scale did not inherit the whole-scene transform`,
  );
  assert(
    !closeTo(actual.heroXp.worldTransform.tx, baseline.heroXp.worldTransform.tx, 1e-3) ||
      !closeTo(actual.heroXp.worldTransform.ty, baseline.heroXp.worldTransform.ty, 1e-3),
    `${message}: Hero XP world position did not inherit the whole-scene transform`,
  );
}

function pointInsideBounds(point, bounds, epsilon = 1e-3) {
  return (
    point.x >= bounds.x - epsilon &&
    point.x <= bounds.x + bounds.w + epsilon &&
    point.y >= bounds.y - epsilon &&
    point.y <= bounds.y + bounds.h + epsilon
  );
}

const easeExponentialOut = (t) => t === 1 ? 1 : 1 - 2 ** (-10 * t);

function interpolateTransform(from, to, t) {
  return Object.fromEntries(
    ["x", "y", "scaleX", "scaleY", "pivotX", "pivotY"]
      .map((key) => [key, from[key] + (to[key] - from[key]) * t]),
  );
}

function expectedTownTarget(sceneFocus, screen, zoom) {
  const halfVisible = { x: screen.w / (2 * zoom), y: screen.h / (2 * zoom) };
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const focus = {
    x: clamp(sceneFocus.x, halfVisible.x, screen.w - halfVisible.x),
    y: clamp(sceneFocus.y, halfVisible.y, screen.h - halfVisible.y),
  };
  return {
    x: screen.w / 2 - zoom * focus.x,
    y: screen.h / 2 - zoom * focus.y,
    scaleX: zoom,
    scaleY: zoom,
    pivotX: 0,
    pivotY: 0,
  };
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript((displayMode) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode,
      textResolutionMode: "modern",
      sound: 0.25,
      music: 0.5,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_POI_NAME__ = "First_City";
    window.__DIB_TEST_START_IN_WORLD__ = true;
    window.__DIB_TEST_SKIP_DEMO_EVOLUTION_HISTORY__ = true;
    window.__DIB_TEST_WORLD_POI_WINS__ = { "1-1_Field_1": 1 };
    // Town-entry chat has its own browser contract; this fixture isolates retained-world geometry.
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1"];
    window.__DIB_TEST_TOWN_DIRTY_REFRESH__ = true;
    window.__DIB_TEST_TOWN_DIRTY_REFRESH_POI__ = "1-1_Turtorial_Hut_1";
    window.__DIB_TEST_WORLD_PARTY__ = {
      // Style 0 owns real reserves. Keep this larger than the six fixed batting-order slots so
      // opening the town Monsters building cannot accidentally pass through the style-1 surface.
      // High levels source-skip World_1-1's ordinary encounter while this contract walks out to
      // the field to exercise non-adjacent (teleport-class) town arrival.
      size: 9,
      battingOrderSize: 6,
      levelRange: [100, 100],
      members: [{ currentHp: 1, injureTime: 0, healTime: 1 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 3,
      highestCapturedLevels: {},
      monsterPartyLevels: Array(9).fill(100),
      silver: 1_000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      tutorialFlags: ["Tutorial0", "Tutorial1", "Tutorial2", "Tutorial4", "flashTownExit"],
    };
    const NativeAudio = window.Audio;
    window.__townMusicLog = [];
    window.Audio = function (src) {
      const element = new NativeAudio(src);
      window.__townMusicLog.push(element);
      return element;
    };
    window.__townMusicSnapshot = () => window.__townMusicLog.map((element) => ({
      assetName: element.dataset.assetName,
      loop: element.loop,
      paused: element.paused,
    }));
  }, expectedDisplayMode);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const expectPlayingMusic = async (assetName, label) => {
    const tracks = await page.evaluate(() => window.__townMusicSnapshot());
    const playing = tracks.filter((track) => !track.paused);
    assert.equal(
      playing.length,
      1,
      `${label}: expected one exclusive music track: ${JSON.stringify(tracks)}`,
    );
    assert.equal(playing[0].assetName, assetName, `${label}: wrong music replacement`);
    assert.equal(playing[0].loop, true, `${label}: world/town music must loop`);
  };
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  const geometry = await stageGeometry(page, box);
  assert.equal(
    geometry.displayMode,
    expectedDisplayMode,
    "town scenario did not boot in its explicitly requested display mode",
  );
  const expectedViewportBounds = {
    x: geometry.offsetX,
    y: geometry.offsetY,
    w: geometry.stagePx.w * geometry.scale,
    h: geometry.stagePx.h * geometry.scale,
  };
  const expectedBannerHeight =
    expectedViewportBounds.h * (50 / geometry.screenPt.h);

  const townVisuals = (townName) => page.evaluate((wantedTown) => {
    const stage = globalThis.__PIXI_APP__?.stage;
    if (!stage) throw new Error("Pixi stage is unavailable");

    const nodes = [];
    const visit = (node) => {
      nodes.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(stage);
    const find = (label) => nodes.findLast((node) => node.label === label);
    const prefix = `town:${wantedTown}:`;
    const house = nodes.find((node) => node.label?.startsWith(`${prefix}building:`));
    if (!house?.parent?.parent) throw new Error(`missing rendered town houses for ${wantedTown}`);
    const mapLayer = house.parent.parent;
    const worldSurface = mapLayer.parent;
    const pointRoot = worldSurface?.parent;
    const viewportClip = worldSurface?.mask;
    if (!worldSurface || !pointRoot || !viewportClip) {
      throw new Error(`missing retained world/viewport hierarchy for ${wantedTown}`);
    }
    globalThis.__DIB_TOWN_NODES__ ??= {
      mapLayer,
      worldSurface,
      pointRoot,
      viewportClip,
    };
    const localTransform = (node) => ({
      x: node.position.x,
      y: node.position.y,
      scaleX: node.scale.x,
      scaleY: node.scale.y,
      pivotX: node.pivot.x,
      pivotY: node.pivot.y,
    });
    const transformedLocalBounds = (node) => {
      const local = node.getLocalBounds();
      const corners = [
        node.toGlobal({ x: local.x, y: local.y }),
        node.toGlobal({ x: local.x + local.width, y: local.y }),
        node.toGlobal({ x: local.x, y: local.y + local.height }),
        node.toGlobal({ x: local.x + local.width, y: local.y + local.height }),
      ];
      const left = Math.min(...corners.map((point) => point.x));
      const right = Math.max(...corners.map((point) => point.x));
      const top = Math.min(...corners.map((point) => point.y));
      const bottom = Math.max(...corners.map((point) => point.y));
      return { x: left, y: top, w: right - left, h: bottom - top };
    };
    const serialize = (node) => {
      if (!node) return null;
      const bounds = node.getBounds();
      const hitArea = node.hitArea;
      const rectangularHitArea =
        hitArea &&
        typeof hitArea.width === "number" &&
        typeof hitArea.height === "number";
      const authoredHitCenter =
        rectangularHitArea
          ? node.toGlobal({
              x: (hitArea.x ?? 0) + hitArea.width / 2,
              y: (hitArea.y ?? 0) + hitArea.height / 2,
            })
          : null;
      const authoredHitBounds = rectangularHitArea
        ? transformedLocalBounds({
            getLocalBounds: () => ({
              x: hitArea.x ?? 0,
              y: hitArea.y ?? 0,
              width: hitArea.width,
              height: hitArea.height,
            }),
            toGlobal: (point) => node.toGlobal(point),
          })
        : null;
      const authoredHitArea = rectangularHitArea
        ? {
            x: hitArea.x ?? 0,
            y: hitArea.y ?? 0,
            w: hitArea.width,
            h: hitArea.height,
          }
        : null;
      let interactivePoint = null;
      let centerHitPath = [];
      if (node.eventMode === "static") {
        const boundary = globalThis.__PIXI_APP__?.renderer?.events?.rootBoundary;
        const fractions = [0.5, 0.25, 0.75, 0.1, 0.9];
        outer:
        for (const fy of fractions) {
          for (const fx of fractions) {
            const candidate = rectangularHitArea
              ? node.toGlobal({
                  x: (hitArea.x ?? 0) + hitArea.width * fx,
                  y: (hitArea.y ?? 0) + hitArea.height * fy,
                })
              : {
                  x: bounds.x + bounds.width * fx,
                  y: bounds.y + bounds.height * fy,
                };
            const hit = boundary?.hitTest?.(candidate.x, candidate.y);
            for (let current = hit; current; current = current.parent) {
              if (current === node) {
                interactivePoint = candidate;
                break outer;
              }
            }
          }
        }
        const center = {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
        };
        const centerHit = boundary?.hitTest?.(center.x, center.y);
        for (let current = centerHit; current; current = current.parent) {
          centerHitPath.push({
            label: current.label || null,
            eventMode: current.eventMode,
          });
        }
      }
      let effectiveVisible = true;
      let effectiveAlpha = 1;
      for (let current = node; current; current = current.parent) {
        effectiveVisible &&= current.visible !== false && current.renderable !== false;
        effectiveAlpha *= current.alpha ?? 1;
      }
      return {
        label: node.label,
        visible: node.visible,
        renderable: node.renderable,
        alpha: node.alpha,
        eventMode: node.eventMode,
        cursor: node.cursor,
        effectiveVisible,
        effectiveAlpha,
        bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
        localTransform: localTransform(node),
        worldTransform: {
          a: node.worldTransform.a,
          b: node.worldTransform.b,
          c: node.worldTransform.c,
          d: node.worldTransform.d,
          tx: node.worldTransform.tx,
          ty: node.worldTransform.ty,
        },
        authoredHitCenter,
        authoredHitArea,
        authoredHitBounds,
        interactivePoint,
        centerHitPath,
      };
    };
    const hasAncestor = (node, ancestor) => {
      for (let current = node; current; current = current.parent) {
        if (current === ancestor) return true;
      }
      return false;
    };
    const branchBelow = (node, ancestor) => {
      if (!node || !ancestor) return null;
      let current = node;
      while (current.parent && current.parent !== ancestor) current = current.parent;
      return current.parent === ancestor ? current : null;
    };

    const retained = globalThis.__DIB_TOWN_NODES__;
    const worldMenuNode = find("worldMenuButton");
    const chrome = worldMenuNode?.parent;
    const heroXpNode =
      find("worldHeroXp") ??
      chrome?.children.find((node) => node !== worldMenuNode);
    const markerNode =
      find("worldHeroMarker") ??
      mapLayer.children.find(
        (node) => node.zIndex === 2 && Array.isArray(node.textures),
      );
    const poiFlagNodes = nodes.filter(
      (node) =>
        node.zIndex === 20_000 &&
        node.parent?.parent === mapLayer &&
        !node.label?.endsWith(":menuButton"),
    );
    const dayNotificationNode = find("townDayNotification");
    const townNamePlateNode = find("townNamePlate");
    const notificationNamePlateNode =
      townNamePlateNode ?? find("worldNamePlate");
    const fixedStageRoot = pointRoot.parent;
    const dayNotificationBranch = branchBelow(dayNotificationNode, fixedStageRoot);
    const namePlateBranch = branchBelow(notificationNamePlateNode, fixedStageRoot);
    return {
      retainedIdentity: {
        mapLayer: retained.mapLayer === mapLayer,
        worldSurface: retained.worldSurface === worldSurface,
        pointRoot: retained.pointRoot === pointRoot,
        viewportClip: retained.viewportClip === viewportClip,
      },
      worldSurface: localTransform(worldSurface),
      map: localTransform(mapLayer),
      // Pixi mask Graphics can report mask-space coordinates from getBounds(); explicitly
      // transform its authored local rectangle so this contract measures the visible viewport.
      viewport: {
        ...serialize(viewportClip),
        bounds: transformedLocalBounds(viewportClip),
      },
      sceneMaskIsViewport: worldSurface.mask === viewportClip,
      buildings: nodes
        .filter((node) => node.label?.startsWith(`${prefix}menu:`))
        .map(serialize),
      exit: serialize(find(`${prefix}exit`)),
      townMenu: serialize(find(`${prefix}menuButton`)),
      worldMenu: serialize(worldMenuNode),
      heroXp: serialize(heroXpNode),
      marker: serialize(markerNode),
      poiFlags: poiFlagNodes.map(serialize),
      editorClose: serialize(find("partyEditorClose")),
      editorRemoveAll: serialize(find("partyEditorControl:removeAll")),
      editorSort: serialize(find("partyEditorControl:sort")),
      editorCards: nodes
        .filter((node) => node.label?.startsWith("editorCard:"))
        .map((node) => ({
          ...serialize(node),
          row: node.parent?.label === "editorReservesRow" ? "reserves" : "batting",
        })),
      editorPlaceholders: nodes
        .filter((node) => node.label?.startsWith("editorPlaceholder:"))
        .map((node) => ({
          ...serialize(node),
          row: node.parent?.label === "editorReservesRow" ? "reserves" : "batting",
        })),
      confirmRemoveAll: serialize(find("popupButton:Yes")),
      dayNotification: serialize(dayNotificationNode),
      townNamePlate: serialize(townNamePlateNode),
      notificationNamePlate: serialize(notificationNamePlateNode),
      notificationHierarchy: {
        dayWithinWorldNode: hasAncestor(dayNotificationNode, pointRoot),
        dayWithinWorldSurface: hasAncestor(dayNotificationNode, worldSurface),
        dayWithinFixedStage: hasAncestor(dayNotificationNode, fixedStageRoot),
        nameWithinWorldNode: hasAncestor(notificationNamePlateNode, pointRoot),
        nameWithinWorldSurface: hasAncestor(notificationNamePlateNode, worldSurface),
        nameWithinFixedStage: hasAncestor(notificationNamePlateNode, fixedStageRoot),
        heroWithinWorldSurface: hasAncestor(heroXpNode, worldSurface),
        dayAndNameShareStageBranch:
          dayNotificationBranch !== null &&
          dayNotificationBranch === namePlateBranch,
      },
    };
  }, townName);

  const visibleTexts = () => page.evaluate(() => {
    const values = [];
    const visit = (node, ancestorsVisible) => {
      const visible =
        ancestorsVisible &&
        node.visible !== false &&
        node.renderable !== false &&
        (node.alpha ?? 1) > 0;
      if (visible && typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child, visible);
    };
    visit(globalThis.__PIXI_APP__.stage, true);
    return values;
  });

  const clickStageTarget = async (target) => {
    const bounds = target?.bounds;
    assert(
      bounds && (
        (bounds.w > 0 && bounds.h > 0) ||
        target.authoredHitCenter
      ),
      `invalid rendered target: ${JSON.stringify(target)}`,
    );
    if (target.eventMode === "static") {
      assert(target.interactivePoint, `no Pixi hit point for ${target.label}: ${JSON.stringify(target)}`);
    }
    const center = target.interactivePoint ?? target.authoredHitCenter ?? {
      x: bounds.x + bounds.w / 2,
      y: bounds.y + bounds.h / 2,
    };


    await page.mouse.click(box.x + center.x, box.y + center.y);
  };
  const dragStageTargets = async (from, to) => {
    const center = (target) => ({
      x: box.x + target.bounds.x + target.bounds.w / 2,
      y: box.y + target.bounds.y + target.bounds.h / 2,
    });
    assert(
      from?.bounds?.w > 0 && from?.bounds?.h > 0 &&
        to?.bounds?.w > 0 && to?.bounds?.h > 0,
      `invalid drag targets: ${JSON.stringify({ from, to })}`,
    );
    const start = center(from);
    const destination = center(to);
    // Cross-row transfer is a vertical source gesture. Retain the centered CFlow x-coordinate so
    // the drag cannot also scroll selection while moving between batting and reserve strips.
    const finish = { x: start.x, y: destination.y };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.waitForTimeout(10);
    await page.mouse.move(finish.x, finish.y, { steps: 8 });
    await page.waitForTimeout(10);
    await page.mouse.up();
    await advance(0);
  };

  const clickPoi = async (poiName) => {
    const snapshot = await state();
    const poi = snapshot.pois.find((candidate) => candidate.name === poiName);
    assert(poi, `missing rendered POI ${poiName}`);


    const point = geometry.toCss({ x: poi.position.x + 20, y: poi.position.y });
    await page.mouse.click(point.x, point.y);
    await advance(0);
  };

  const townAggregateGapPoint = (townName) => page.evaluate((wantedTown) => {
    const stage = globalThis.__PIXI_APP__?.stage;
    if (!stage) throw new Error("Pixi stage is unavailable");
    const nodes = [];
    const visit = (node) => {
      nodes.push(node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(stage);
    const prefix = `town:${wantedTown}:building:`;
    const touchableRoots = nodes
      // Only source `touchableBuildings` receive the port's explicit none-mode pointer owner;
      // fake scenery keeps Pixi's default mode and is absent from this aggregate.
      .filter((node) => node.label?.startsWith(prefix) && node.eventMode === "none");
    const globalRectangle = (node) => {
      const local = node.getLocalBounds();
      const corners = [
        node.toGlobal({ x: local.x, y: local.y }),
        node.toGlobal({ x: local.x + local.width, y: local.y }),
        node.toGlobal({ x: local.x, y: local.y + local.height }),
        node.toGlobal({ x: local.x + local.width, y: local.y + local.height }),
      ];
      const x = Math.min(...corners.map((point) => point.x));
      const y = Math.min(...corners.map((point) => point.y));
      return {
        x,
        y,
        w: Math.max(...corners.map((point) => point.x)) - x,
        h: Math.max(...corners.map((point) => point.y)) - y,
      };
    };
    const rectangles = touchableRoots
      .map((root) => root.children[0])
      .filter(Boolean)
      .map(globalRectangle);
    if (rectangles.length < 2) throw new Error(`town ${wantedTown} lacks two touchable houses`);
    const iconRectangles = nodes
      .filter((node) => node.label?.startsWith(`town:${wantedTown}:menu:`))
      .map((root) => root.children[0])
      .filter(Boolean)
      .map(globalRectangle);
    const individualTownRectangles = [...rectangles, ...iconRectangles];
    const poiRoot = touchableRoots[0]?.parent;
    if (!poiRoot) throw new Error(`town ${wantedTown} lacks its POINode root`);
    const ordinaryPoiRectangles = poiRoot.children
      .filter((child) => child.zIndex === -20_000 || child.zIndex === 20_000)
      .map(globalRectangle);
    const union = {
      x: Math.min(...rectangles.map((rect) => rect.x)),
      y: Math.min(...rectangles.map((rect) => rect.y)),
      right: Math.max(...rectangles.map((rect) => rect.x + rect.w)),
      bottom: Math.max(...rectangles.map((rect) => rect.y + rect.h)),
    };
    const inside = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.w &&
      point.y >= rect.y && point.y <= rect.y + rect.h;
    for (let yi = 1; yi < 20; yi++) {
      for (let xi = 1; xi < 20; xi++) {
        const point = {
          x: union.x + (union.right - union.x) * xi / 20,
          y: union.y + (union.bottom - union.y) * yi / 20,
        };
        if (
          !individualTownRectangles.some((rect) => inside(point, rect)) &&
          !ordinaryPoiRectangles.some((rect) => inside(point, rect))
        ) return point;
      }
    }
    throw new Error(`town ${wantedTown} has no aggregate-only building gap`);
  }, townName);

  const clickCurrentTown = async ({ aggregateGap = false } = {}) => {
    const snapshot = await state();
    const current = snapshot.pois.find((poi) => poi.name === snapshot.currentPoi);
    assert(current, `missing rendered current POI ${snapshot.currentPoi}`);
    assert.equal(current.route.kind, "scene");
    assert.equal(current.route.sceneId, "town");
    assert.equal(current.route.arrivalPresentation, "immediate-hidden-marker");
    if (aggregateGap) {
      const point = await townAggregateGapPoint(current.name);
      await page.mouse.click(box.x + point.x, box.y + point.y);
      await advance(0);
    } else {
      await clickPoi(current.name);
    }
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).mode === "town",
      undefined,
      { timeout: 15_000 },
    );
  };

  for (let index = 0; index < 600 && (await state()).startup?.phase !== "title"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  assert.equal((await state()).startup?.phase, "title", "startup title did not become interactive");
  await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const current = await state();
    if (current.startup?.phase === "save-select" || current.mode === "world") break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  if ((await state()).startup?.phase === "save-select") await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const snapshot = await state();
    if (snapshot.mode === "world" && !snapshot.locked && !snapshot.walking) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }

  let snapshot = await state();
  assert.equal(snapshot.mode, "world");
  assert.equal(snapshot.locked, false);
  for (
    let index = 0;
    index < 200 && (snapshot.chrome.heroXp.expanded || snapshot.chrome.heroXp.moving);
    index++
  ) {
    await advance(25);
    snapshot = await state();
  }
  assert.equal(snapshot.chrome.heroXp.expanded, false);
  assert.equal(snapshot.chrome.heroXp.moving, false);
  const townName = snapshot.currentPoi;
  const expectedTownDisplayName = {
    First_City: "Corova",
    Harbor_Town: "Cinder Harbor",
  }[townName];
  assert(
    expectedTownDisplayName,
    `town scenario has no independently reviewed localized-name expectation for ${townName}`,
  );
  const initialParty = snapshot.party.map(({ instanceId, shortType, currentHp }) => ({
    instanceId,
    shortType,
    currentHp,
  }));
  const initialPoiStates = snapshot.poiStates;
  const dirtyRefresh = snapshot.refresh;
  assert.equal(initialParty[0]?.currentHp, 1, "town fixture did not seed damaged HP");
  assert.equal(snapshot.party[0]?.injured, true, "town fixture did not seed an expired injury");
  assert(Object.keys(dirtyRefresh.occurrenceByPoi).length > 0, "town fixture has no dirty occurrence cache");
  assert(dirtyRefresh.completedPois.some((name) => name !== townName), "town fixture has no dirty completion cache");
  const alphaRegressionHut = snapshot.pois.find(
    (poi) => poi.name === "1-1_Turtorial_Hut_1",
  );
  const alphaRegressionField = snapshot.pois.find(
    (poi) => poi.name === "1-1_Field_1",
  );
  if (alphaRegressionHut && alphaRegressionField) {
    assert(
      dirtyRefresh.completedPois.includes(alphaRegressionHut.name),
      "real World_1-1 fixture did not seed the tutorial hut completion",
    );
    assert.equal(alphaRegressionField.stateVisible, true);
    assert(closeTo(alphaRegressionField.stateAlpha, 1));
  }
  const currentTownPoi = snapshot.pois.find((poi) => poi.name === townName);
  assert(currentTownPoi, `missing current town POI ${townName}`);
  const baseline = await townVisuals(townName);
  assert(
    Object.values(baseline.retainedIdentity).every(Boolean),
    `world hierarchy identity was not retained: ${JSON.stringify(baseline.retainedIdentity)}`,
  );
  assert.equal(baseline.sceneMaskIsViewport, true);
  assertBounds(baseline.viewport.bounds, expectedViewportBounds, "baseline world viewport");
  assert.equal(baseline.worldMenu.visible, true);
  assert(closeTo(baseline.worldMenu.alpha, 1));
  assert.equal(baseline.worldMenu.eventMode, "static");
  assert(baseline.heroXp?.effectiveVisible, "baseline Hero XP is not rendered");
  assert(closeTo(baseline.heroXp.effectiveAlpha, 1));
  assert(baseline.marker?.effectiveVisible, "baseline hero marker is not rendered");
  assert(closeTo(baseline.marker.effectiveAlpha, 1));
  const baselineVisiblePoiFlags = baseline.poiFlags.filter(
    (flag) => flag.effectiveVisible && flag.effectiveAlpha > 0,
  );
  const baselineVisiblePoiFlagIndexes = baseline.poiFlags.flatMap(
    (flag, index) => flag.effectiveVisible && flag.effectiveAlpha > 0 ? [index] : [],
  );
  assert(
    baselineVisiblePoiFlags.length > 0,
    `town fixture has no visible POI state flags: ` +
      JSON.stringify({
        pois: snapshot.pois.map(
          ({ name, state, stateVisible, stateAlpha }) => ({
            name,
            state,
            stateVisible,
            stateAlpha,
          }),
        ),
        pixiFlags: baseline.poiFlags.map(
          ({ label, visible, alpha, effectiveVisible, effectiveAlpha }) => ({
            label,
            visible,
            alpha,
            effectiveVisible,
            effectiveAlpha,
          }),
        ),
      }),
  );
  const baselinePoiStateVisibility = snapshot.pois.map(({ name, stateVisible }) => ({
    name,
    stateVisible,
  }));
  const baselineVisiblePoiNames = new Set(
    snapshot.pois.filter((poi) => poi.stateVisible).map((poi) => poi.name),
  );
  assert(
    snapshot.pois
      .filter((poi) => baselineVisiblePoiNames.has(poi.name))
      .every((poi) => closeTo(poi.stateAlpha, 1)),
    "render/debug state did not expose baseline POI flags at alpha 1",
  );
  assert(closeTo(snapshot.chrome.menu.alpha, 1));
  assert(closeTo(snapshot.chrome.heroXp.alpha, 1));
  assert.equal(snapshot.chrome.menu.functional, true);
  assert.equal(snapshot.markerVisible, true);
  assert.equal(snapshot.chrome.heroXp.visible, true);
  await expectPlayingMusic("Field1.mp3", "baseline world");
  await page.screenshot({ path: path.join(outputDir, "00-world.png"), timeout: 120_000 });

  // First visit: pin the immediate entry state, the exact 1.0s unlock/reveal gate, and the
  // retained map's partial and completed 5.0s exponential-out zoom.
  // WorldNode first performs the ordinary exact POINode test. TownPOINode then accepts the
  // aggregate union of its touchable house bounds. Click a proven gap outside every individual
  // house so this entry can pass only through that source town fallback.
  await clickCurrentTown({ aggregateGap: true });
  snapshot = await state();
  let visuals = await townVisuals(townName);
  assert.equal(snapshot.locked, true);
  assert.equal(snapshot.town.name, townName);
  assert(snapshot.town.buildings.length > 0, "town exposes no parsed buildings");
  const monsterBuilding = snapshot.town.buildings.find(
    (building) => building.className === "MonsterManagementMenuItem",
  );
  assert(monsterBuilding, "town fixture has no MonsterManagementMenuItem");
  assert.equal(monsterBuilding.enabled, true, "town Monsters building is not enabled");
  assert.equal(snapshot.town.exitEnabled, true);
  const exactTarget = expectedTownTarget(
    currentTownPoi.position,
    geometry.screenPt,
    snapshot.town.zoom,
  );
  assertTransform(visuals.map, baseline.map, "map moved before the entry tween advanced");
  assertTransform(
    visuals.worldSurface,
    baseline.worldSurface,
    "world surface moved before the entry tween advanced",
  );
  assert(
    Object.values(visuals.retainedIdentity).every(Boolean),
    `town entry replaced retained world hierarchy: ${JSON.stringify(visuals.retainedIdentity)}`,
  );
  assert.equal(visuals.sceneMaskIsViewport, true);
  assertBounds(visuals.viewport.bounds, expectedViewportBounds, "immediate town viewport");
  assert.equal(visuals.worldMenu.visible, true);
  assert(closeTo(visuals.worldMenu.alpha, 1));
  assert(closeTo(snapshot.chrome.menu.alpha, 1));
  assert.equal(snapshot.markerVisible, false);
  assert.equal(snapshot.chrome.heroXp.visible, true);
  assert(closeTo(snapshot.chrome.heroXp.alpha, 1));
  assert(visuals.heroXp?.effectiveVisible, "Hero XP disappeared at town-entry t=0");
  assert(closeTo(visuals.heroXp.effectiveAlpha, 1));
  assertTransform(
    visuals.heroXp.localTransform,
    baseline.heroXp.localTransform,
    "Hero XP changed its scene-local transform at town-entry t=0",
  );
  assert.deepEqual(
    snapshot.pois.map(({ name, stateVisible }) => ({ name, stateVisible })),
    baselinePoiStateVisibility,
    "POI flags disappeared instead of beginning their source 0.5s fade",
  );
  assert.equal(
    visuals.poiFlags.filter((flag) => flag.effectiveVisible).length,
    baselineVisiblePoiFlags.length,
    "visible POI flag set changed before the entry fade advanced",
  );
  assert(
    visuals.poiFlags
      .filter((flag) => flag.effectiveVisible)
      .every((flag) => closeTo(flag.alpha, 1)),
    "POI flags did not begin the entry fade at alpha 1",
  );
  assert(
    snapshot.pois
      .filter((poi) => baselineVisiblePoiNames.has(poi.name))
      .every((poi) => closeTo(poi.stateAlpha, 1)),
    "render/debug POI alpha did not begin the entry fade at 1",
  );
  assert(visuals.buildings.every((building) => building.visible === false));
  assert.equal(visuals.exit.visible, false);
  assert(
    snapshot.town.dayNotification,
    `town entry did not create its day notification; browser errors: ${errors.join(" | ") || "none"}`,
  );
  assert.deepEqual(
    {
      day: snapshot.town.dayNotification.day,
      title: snapshot.town.dayNotification.title,
      message: snapshot.town.dayNotification.message,
      image: snapshot.town.dayNotification.image,
    },
    {
      day: 2,
      title: "Day 2",
      message: "The day is over. Monsters respawn",
      image: "sunrise.png",
    },
    "town entry did not enqueue and persist the source day rollover notification",
  );
  assert.equal(snapshot.town.dayNotification.visible, true);
  assert.deepEqual(
    snapshot.town.dayNotification,
    snapshot.notifications.dayNotification,
    "town and global diagnostics disagree about the presented day notification",
  );
  assert(visuals.dayNotification?.effectiveVisible, "day banner is absent at immediate town entry");
  assert(
    closeTo(
      visuals.dayNotification.bounds.y + visuals.dayNotification.bounds.h,
      expectedViewportBounds.y,
      1,
    ),
    `hidden day banner did not begin immediately above the viewport: ` +
      JSON.stringify(visuals.dayNotification.bounds),
  );
  assert(closeTo(visuals.dayNotification.bounds.h, expectedBannerHeight, 1));
  assert(closeTo(visuals.dayNotification.bounds.w, expectedViewportBounds.w, 1));
  assert.equal(
    snapshot.notifications?.global,
    true,
    "render/debug state does not identify the notification host as stage-global",
  );
  assert.deepEqual(
    {
      dayWithinWorldNode: visuals.notificationHierarchy.dayWithinWorldNode,
      dayWithinWorldSurface: visuals.notificationHierarchy.dayWithinWorldSurface,
      dayWithinFixedStage: visuals.notificationHierarchy.dayWithinFixedStage,
      nameWithinWorldNode: visuals.notificationHierarchy.nameWithinWorldNode,
      nameWithinWorldSurface: visuals.notificationHierarchy.nameWithinWorldSurface,
      nameWithinFixedStage: visuals.notificationHierarchy.nameWithinFixedStage,
      heroWithinWorldSurface: visuals.notificationHierarchy.heroWithinWorldSurface,
      dayAndNameShareStageBranch:
        visuals.notificationHierarchy.dayAndNameShareStageBranch,
    },
    {
      dayWithinWorldNode: false,
      dayWithinWorldSurface: false,
      dayWithinFixedStage: true,
      nameWithinWorldNode: false,
      nameWithinWorldSurface: false,
      nameWithinFixedStage: true,
      heroWithinWorldSurface: true,
      dayAndNameShareStageBranch: true,
    },
    "notification roots are not global FixedStage siblings of the retained WorldNode",
  );
  assert.equal(visuals.townNamePlate, null, "town name plate appeared before the 1.0s gate");
  assert.equal(
    visuals.notificationNamePlate?.label,
    "worldNamePlate",
    "town entry did not retain the existing global world-name plaque until replacement",
  );
  const hiddenMonsterControl = visuals.buildings.find(
    (building) => building.label === `town:${townName}:menu:MonsterManagementMenuItem`,
  );
  assert(hiddenMonsterControl, "missing exact rendered Monsters button label");
  assert.equal(hiddenMonsterControl.eventMode, "none");
  await clickStageTarget(hiddenMonsterControl);
  snapshot = await state();
  assert.equal(snapshot.locked, true, "hidden pre-reveal Monsters click escaped town lockout");
  assert.equal(snapshot.overlay, null, "Monsters opened before the exact 1.0s reveal gate");
  await expectPlayingMusic("Town1.mp3", "town entry");
  await page.screenshot({ path: path.join(outputDir, "01-town-entry.png"), timeout: 120_000 });

  await advance(250);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert(
    closeTo(
      visuals.dayNotification.bounds.y,
      expectedViewportBounds.y - expectedBannerHeight / 2,
      1,
    ),
    `day banner did not descend halfway from above at t=0.25s: ` +
      JSON.stringify(visuals.dayNotification.bounds),
  );
  assert.equal(snapshot.locked, true, "town unlocked during the entry fade at t=0.25s");
  assertTransform(
    visuals.worldSurface,
    interpolateTransform(baseline.worldSurface, exactTarget, easeExponentialOut(250 / 5000)),
    "source exponential-out entry transform at 250ms",
    1e-3,
  );
  assert.equal(visuals.worldMenu.visible, true);
  assert(
    closeTo(visuals.worldMenu.alpha, 0.5, 0.01),
    `retained world menu did not reach alpha 0.5 at t=0.25s: ${visuals.worldMenu.alpha}`,
  );
  assert(closeTo(snapshot.chrome.menu.alpha, 0.5, 0.01));
  const quarterSecondFlags = baselineVisiblePoiFlagIndexes.map(
    (index) => visuals.poiFlags[index],
  );
  assert.equal(
    quarterSecondFlags.filter((flag) => flag.visible).length,
    baselineVisiblePoiFlags.length,
    "a previously visible POI flag disappeared before its 0.5s fade completed",
  );
  assert(
    quarterSecondFlags.every((flag) => closeTo(flag.alpha, 0.5, 0.01)),
    `POI flags did not reach alpha 0.5 at t=0.25s: ` +
      JSON.stringify(quarterSecondFlags.map(({ label, alpha }) => ({ label, alpha }))),
  );
  assert(
    snapshot.pois
      .filter((poi) => baselineVisiblePoiNames.has(poi.name))
      .every((poi) => closeTo(poi.stateAlpha, 0.5, 0.01)),
    "render/debug POI alpha did not reach 0.5 at t=0.25s",
  );
  assert(
    snapshot.pois
      .filter((poi) => !baselineVisiblePoiNames.has(poi.name))
      .every((poi) => closeTo(poi.stateAlpha, 1, 0.01)),
    "town entry faded persistent state-3 sprites that are absent in the native scene",
  );
  assert.equal(snapshot.chrome.heroXp.visible, true);
  assert(closeTo(snapshot.chrome.heroXp.alpha, 1));
  assertHeroFollowsWorld(visuals, baseline, "town-entry t=0.25s");

  await advance(250);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert(
    closeTo(visuals.dayNotification.bounds.y, expectedViewportBounds.y, 1),
    `day banner is not attached to the viewport top at t=0.5s: ` +
      JSON.stringify(visuals.dayNotification.bounds),
  );
  assert(closeTo(visuals.dayNotification.bounds.h, expectedBannerHeight, 1));
  assert(closeTo(visuals.dayNotification.bounds.w, expectedViewportBounds.w, 1));
  assert.equal(snapshot.locked, true, "town unlocked at the 0.5s chrome-fade boundary");
  assertTransform(
    visuals.worldSurface,
    interpolateTransform(baseline.worldSurface, exactTarget, easeExponentialOut(500 / 5000)),
    "source exponential-out entry transform at 500ms",
    1e-3,
  );
  assert.equal(visuals.worldMenu.visible, true);
  assert(
    closeTo(visuals.worldMenu.alpha, 0, 0.01),
    `retained world menu did not finish its 0.5s fade: ${visuals.worldMenu.alpha}`,
  );
  assert(closeTo(snapshot.chrome.menu.alpha, 0, 0.01));
  assert(
    baselineVisiblePoiFlagIndexes.every(
      (index) => closeTo(visuals.poiFlags[index].alpha, 0, 0.01),
    ),
    `POI flags did not finish their 0.5s fade: ` +
      JSON.stringify(
        baselineVisiblePoiFlagIndexes.map((index) => visuals.poiFlags[index].alpha),
      ),
  );
  assert(
    snapshot.pois
      .filter((poi) => baselineVisiblePoiNames.has(poi.name))
      .every((poi) => closeTo(poi.stateAlpha, 0, 0.01)),
    "render/debug POI alpha did not reach 0 at t=0.5s",
  );
  assert(
    snapshot.pois
      .filter((poi) => !baselineVisiblePoiNames.has(poi.name))
      .every((poi) => closeTo(poi.stateAlpha, 1, 0.01)),
    "hidden persistent state sprites did not preserve their field-opacity baseline",
  );
  assert.equal(snapshot.chrome.heroXp.visible, true);
  assert(closeTo(snapshot.chrome.heroXp.alpha, 1));
  assertHeroFollowsWorld(visuals, baseline, "town-entry t=0.5s");

  await advance(499);
  snapshot = await state();
  assert.equal(snapshot.locked, true, "town unlocked before the source 1.0s delay");
  assert.equal(snapshot.party[0].currentHp, 1, "party restored before the source 1.0s delay");
  assert.equal(snapshot.party[0].injured, true, "injury cleared before the source 1.0s delay");














  assert.deepEqual(
    snapshot.refresh.occurrenceByPoi,
    dirtyRefresh.occurrenceByPoi,
    "occurrence cache was refreshed before the source 1.0s delay",
  );
  assert.deepEqual(
    [...snapshot.refresh.completedPois].sort(),
    [...new Set([...dirtyRefresh.completedPois, townName])].sort(),
    "completion cache before the source 1.0s delay is not the pre-arrival set plus this arrival",
  );













  for (const [poiName, initialState] of Object.entries(initialPoiStates)) {
    if (initialState === 3) continue;
    assert.equal(
      snapshot.poiStates[poiName],
      initialState,
      `POI ${poiName} state changed before the source 1.0s town delay: ` +
        `${initialState} -> ${snapshot.poiStates[poiName]} (a premature refreshPOIs drops the ` +
        `seeded dirty completion and makes reachable POIs unavailable)`,
    );
  }
  assert.deepEqual(
    Object.keys(snapshot.poiStates).sort(),
    Object.keys(initialPoiStates).sort(),
    "town arrival added or removed POIs",
  );
  // The manual ticker accumulates float32-ish frame deltas; cross the boundary by 1ms instead of
  // depending on exact binary representation of 1000/60.
  await advance(2);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert.equal(snapshot.locked, false);
  assertTransform(
    visuals.worldSurface,
    interpolateTransform(baseline.worldSurface, exactTarget, easeExponentialOut(1001 / 5000)),
    "source exponential-out entry transform at 1001ms",
    1e-3,
  );
  assertTransform(visuals.map, baseline.map, "map-local transform changed during whole-world entry");
  assert.equal(visuals.worldMenu.visible, true);
  assert(closeTo(visuals.worldMenu.alpha, 0, 0.01));
  assert(closeTo(snapshot.chrome.menu.alpha, 0, 0.01));
  assert(
    baselineVisiblePoiFlagIndexes.every(
      (index) => closeTo(visuals.poiFlags[index].alpha, 0, 0.01),
    ),
  );
  assert.equal(snapshot.chrome.heroXp.visible, true);
  assert(closeTo(snapshot.chrome.heroXp.alpha, 1));
  assertHeroFollowsWorld(visuals, baseline, "town-entry t=1.001s");
  assertBounds(visuals.viewport.bounds, expectedViewportBounds, "town reveal viewport");
  assert(snapshot.party[0].currentHp > 1, "town restore did not heal the seeded party member");
  assert.equal(snapshot.party[0].injured, false, "town restore did not clear the expired injury");
  assert.deepEqual(snapshot.refresh.occurrenceByPoi, {}, "town refresh retained occurrence cache");
  assert(!snapshot.refresh.completedPois.some((name) => name !== townName), "town refresh retained completion cache");
  const restoredPoiStates = snapshot.poiStates;
  const restoredWalkTargets = Object.entries(restoredPoiStates)
    .filter(([, poiState]) => poiState === 4)
    .map(([poiName]) => poiName)
    .sort();
  assert(restoredWalkTargets.length > 0, "town refresh exposed no adjacent walk-arrow destination");
  if (townName === "First_City") {
    assert.deepEqual(
      restoredWalkTargets,
      ["1-1_Forest_1", "1-1_Turtorial_Hut_1"],
      "the one-win town fixture must expose the durable Forest shortcut and Tutorial Hut exit",
    );
    assert.equal(
      restoredPoiStates["1-1_Forest_1"],
      4,
      "the seeded Field 1 win did not expose Corova's durable Forest shortcut",
    );
  }
  const restoredParty = snapshot.party.map(({ instanceId, shortType, currentHp, injured }) => ({
    instanceId,
    shortType,
    currentHp,
    injured,
  }));
  assert(visuals.buildings.length > 0, "town exposes no rendered building controls");



  assert.equal(
    visuals.buildings.length,
    snapshot.town.buildings.filter((building) => building.revealed).length,
    "rendered town control count does not match the town's revealed services",
  );
  assert(
    snapshot.town.buildings.every((building) => !building.revealed || !building.fake),
    "a fake house was rendered as a service",
  );
  assert(visuals.buildings.every((building) => building.visible && closeTo(building.alpha, 0)));
  const monsterControl = visuals.buildings.find(
    (building) => building.label === `town:${townName}:menu:MonsterManagementMenuItem`,
  );
  assert(monsterControl, "missing revealed Monsters button");
  assert.equal(monsterControl.eventMode, "static");
  assert(
    monsterControl.interactivePoint,
    `revealed Monsters button has no exact Pixi hit path: ${JSON.stringify(monsterControl)}`,
  );
  const monsterpediaControl = visuals.buildings.find(
    (building) => building.label === `town:${townName}:menu:MonsterpediaMenuItem`,
  );
  assert(monsterpediaControl, "missing revealed Monsterpedia button");
  assert.equal(monsterpediaControl.eventMode, "static");
  assert(
    monsterpediaControl.interactivePoint,
    `revealed Monsterpedia button has no exact Pixi hit path: ${JSON.stringify(monsterpediaControl)}`,
  );
  for (const definition of snapshot.town.buildings.filter((building) => building.revealed)) {
    const control = visuals.buildings.find(
      (building) => building.label === `town:${townName}:menu:${definition.className}`,
    );
    assert(control, `missing rendered ${definition.className} control`);
    assert.equal(
      control.eventMode,
      definition.enabled ? "static" : "none",
      `${definition.className} pointer mode disagrees with the live town route model`,
    );
  }
  assert.equal(visuals.exit.visible, true);
  assert(closeTo(visuals.exit.alpha, 0));
  assert.equal(visuals.exit.eventMode, "static");
  assert(
    visuals.exit.authoredHitArea.w * snapshot.town.zoom + 0.01 >= 55 &&
      visuals.exit.authoredHitArea.h * snapshot.town.zoom + 0.01 >= 55,
    `leave-town hit rect missed the normalized 55pt source floor: ${JSON.stringify(visuals.exit)}`,
  );
  assert(
    visuals.exit.authoredHitBounds.w > visuals.exit.bounds.w &&
      visuals.exit.authoredHitBounds.h > visuals.exit.bounds.h,
    `leave-town padding ring did not extend beyond its undersized art: ${JSON.stringify(visuals.exit)}`,
  );
  assert.equal(visuals.worldMenu.visible, true);
  assert(visuals.townMenu, "town did not create its source-owned menu button");
  assert.equal(visuals.townMenu.visible, true);
  assert(closeTo(visuals.townMenu.alpha, 0));
  assert.equal(snapshot.town.namePlate.text, expectedTownDisplayName);
  assert.equal(snapshot.town.namePlate.plateScale, 1.3);
  assert.equal(snapshot.town.namePlate.visible, true);
  assert(visuals.townNamePlate?.effectiveVisible, "localized town name plate did not start at 1.0s");
  assert.equal(
    visuals.dayNotification?.eventMode,
    "static",
    "active day banner is not participating in Pixi touch arbitration",
  );
  assert(
    visuals.dayNotification.interactivePoint,
    `active day banner has no authored Pixi hit path: ` +
      JSON.stringify(visuals.dayNotification),
  );
  assert(
    !pointInsideBounds(monsterControl.interactivePoint, visuals.dayNotification.bounds),
    "town fixture's Monsters button does not provide an outside-banner pass-through point",
  );
  await page.screenshot({ path: path.join(outputDir, "02-town-reveal-1s.png"), timeout: 120_000 });

  // The exact same authored Monsters hit path that was rejected under lockout becomes live as
  // soon as showNameplate clears lockout. It lies outside the active top notification, so
  // opening style 0 also proves an outside-banner click passes through without dismissing it.
  // Town instances default editable=true and therefore MUST open source style 0 with a real
  // reserves collection, never the game-menu style 1 editor.
  await clickStageTarget(monsterControl);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).overlay?.style === 0,
    undefined,
    { timeout: 15_000 },
  );
  // PartyEditorFlow mounts after asynchronous asset continuations. Render once without advancing
  // source time so Pixi's world transforms and event boundary see the newly added controls.
  await advance(0);
  snapshot = await state();
  assert.equal(snapshot.mode, "town");
  assert.equal(snapshot.overlay.screen, "partyEditor");
  assert.equal(snapshot.overlay.style, 0);
  assert.equal(snapshot.overlay.activeIds.length, 6);
  assert.equal(snapshot.overlay.reserveIds.length, 3);
  assert.equal(snapshot.overlay.sortOrder, 2, "style-0 must open in source Level sort mode");
  for (let index = 1; index < snapshot.overlay.reserveEntries.length; index++) {
    assert(
      snapshot.overlay.reserveEntries[index - 1].level >=
        snapshot.overlay.reserveEntries[index].level,
      `initial style-0 reserve level sort is not monotonic: ` +
        JSON.stringify(snapshot.overlay.reserveEntries),
    );
  }
  const durablePartyOrderAtEditorOpen = snapshot.party.map((member) => member.instanceId);
  assert.equal(
    new Set([...snapshot.overlay.activeIds, ...snapshot.overlay.reserveIds]).size,
    snapshot.party.length,
    "style-0 active/reserve rows overlap or omit roster members",
  );
  assert.deepEqual(
    [...snapshot.overlay.activeIds, ...snapshot.overlay.reserveIds].sort(),
    snapshot.party.map((member) => member.instanceId).sort(),
    "style-0 rows do not exhaust the live town roster",
  );
  assert.equal(
    snapshot.town.dayNotification.visible,
    true,
    "outside-banner Monsters click incorrectly dismissed the day notification",
  );

  // The notification manager has higher global-stage priority than WorldNode descendants. An
  // inside click dismisses the banner immediately and must be swallowed before it reaches the
  // style-0 editor underneath.
  const editorBeforeBannerDismissal = {
    activeIds: [...snapshot.overlay.activeIds],
    reserveIds: [...snapshot.overlay.reserveIds],
    sortOrder: snapshot.overlay.sortOrder,
    popupDepth: snapshot.overlay.popups.depth,
  };
  visuals = await townVisuals(townName);
  assert(visuals.dayNotification?.effectiveVisible, "day banner vanished before its inside click");
  assert.equal(visuals.dayNotification.eventMode, "static");
  assert(
    visuals.dayNotification.interactivePoint,
    `global day banner lost its Pixi hit path above style 0: ` +
      JSON.stringify(visuals.dayNotification),
  );
  await clickStageTarget(visuals.dayNotification);
  snapshot = await state();
  assert.equal(snapshot.overlay?.style, 0, "inside-banner click escaped into the underlying scene");
  assert.equal(
    snapshot.town.dayNotification.visible,
    true,
    "inside-banner click skipped the source 0.5s dismissal slide",
  );
  visuals = await townVisuals(townName);
  assert.equal(
    visuals.dayNotification.eventMode,
    "none",
    "inside-banner pointerdown did not immediately disable repeat arbitration",
  );
  assert.deepEqual(
    {
      activeIds: snapshot.overlay.activeIds,
      reserveIds: snapshot.overlay.reserveIds,
      sortOrder: snapshot.overlay.sortOrder,
      popupDepth: snapshot.overlay.popups.depth,
    },
    editorBeforeBannerDismissal,
    "inside-banner click was not swallowed before reaching the underlying style-0 editor",
  );
  const dismissStartY = visuals.dayNotification.bounds.y;
  await advance(250);
  visuals = await townVisuals(townName);
  assert(
    visuals.dayNotification.bounds.y < dismissStartY &&
      closeTo(
        visuals.dayNotification.bounds.y,
        expectedViewportBounds.y - expectedBannerHeight / 2,
        1,
      ),
    `early day-banner dismissal did not continue upward from its current position: ` +
      JSON.stringify({ dismissStartY, bounds: visuals.dayNotification.bounds }),
  );
  await advance(249);
  snapshot = await state();
  assert.equal(
    snapshot.town.dayNotification.visible,
    true,
    "early day-banner dismissal completed before its source 0.5s slide",
  );
  await advance(2);
  snapshot = await state();
  assert.equal(
    snapshot.town.dayNotification,
    undefined,
    "inside-banner click did not retire the current notification after its 0.5s dismissal",
  );
  assert.equal(snapshot.notifications.dayNotification, undefined);
  assert.equal(snapshot.overlay?.style, 0);
  assert.deepEqual(
    {
      activeIds: snapshot.overlay.activeIds,
      reserveIds: snapshot.overlay.reserveIds,
      sortOrder: snapshot.overlay.sortOrder,
      popupDepth: snapshot.overlay.popups.depth,
    },
    editorBeforeBannerDismissal,
    "day-banner dismissal animation reached the underlying style-0 editor",
  );

  // The style-0-only vertical gesture moves a live member across the two CFlow rows. Move the
  // centered active card down, then the same card back up; style 1 has no reserve member target
  // and cannot execute either branch.
  const movedId = snapshot.overlay.centeredBattingId;
  const reserveDestinationIndex = snapshot.overlay.centeredReserveVisualIndex;
  assert(movedId, "style-0 editor has no centered batting member");
  assert(Number.isInteger(reserveDestinationIndex), "style-0 editor has no selected reserve boundary");
  assert.equal(
    snapshot.tutorial ?? null,
    null,
    `unexpected tutorial above style 0: ${JSON.stringify({ tutorial: snapshot.tutorial, flags: snapshot.player.tutorialFlags })}`,
  );
  let editorVisuals = await townVisuals(townName);
  const reservePlaceholder = editorVisuals.editorPlaceholders.find(
    (card) => card.label === "editorPlaceholder:reserves" && card.row === "reserves",
  );
  assert(reservePlaceholder?.effectiveVisible, "style-0 reserve row has no leading nil placeholder");
  assert(closeTo(reservePlaceholder.localTransform.x, 0));
  assert(
    editorVisuals.editorCards
      .filter((card) => card.row === "reserves")
      .every((card) => card.localTransform.x > reservePlaceholder.localTransform.x),
    "a real reserve card was laid out before the source leading nil placeholder",
  );
  const activeCard = editorVisuals.editorCards.find(
    (card) => card.label === `editorCard:${movedId}` && card.row === "batting",
  );
  const reserveCard = editorVisuals.editorCards.find(
    (card) => card.label === `editorCard:${snapshot.overlay.reserveIds[0]}` &&
      card.row === "reserves",
  );
  await dragStageTargets(activeCard, reserveCard);
  await page.waitForFunction(
    (instanceId) => {
      const overlay = JSON.parse(window.render_game_to_text()).overlay;
      return (
        overlay?.style === 0 &&
        overlay.activeIds?.length === 5 &&
        overlay.reserveIds?.length === 4 &&
        overlay.reserveIds.includes(instanceId)
      );
    },
    movedId,
    { timeout: 15_000 },
  );
  snapshot = await state();
  assert.equal(
    snapshot.overlay.centeredReserveVisualIndex,
    reserveDestinationIndex,
    "batting-to-reserve drop must restore the source destination selection instead of centering the inserted monster",
  );
  assert.equal(
    snapshot.overlay.reserveIds[reserveDestinationIndex],
    movedId,
    "the moved monster must appear one displayed slot right of the retained reserve selection",
  );
  editorVisuals = await townVisuals(townName);
  const movedReserveCard = editorVisuals.editorCards.find(
    (card) => card.label === `editorCard:${movedId}` && card.row === "reserves",
  );
  // The source preserves the destination selection after inserting into reserves, leaving the
  // moved member one visible slot to its right. Recenter that side card before beginning the next
  // vertical drag; a cross-row drag operates on the CFlow's selected member, not any side card
  // whose art happened to be under the initial pointer.
  await clickStageTarget(movedReserveCard);
  for (let index = 0; index < 80; index += 1) {
    snapshot = await state();
    if (snapshot.overlay.centeredReserveVisualIndex === reserveDestinationIndex + 1) break;
    await advance(25);
  }
  assert.equal(
    snapshot.overlay.centeredReserveVisualIndex,
    reserveDestinationIndex + 1,
    "moved reserve side card did not recenter before the return drag",
  );
  editorVisuals = await townVisuals(townName);
  const centeredMovedReserveCard = editorVisuals.editorCards.find(
    (card) => card.label === `editorCard:${movedId}` && card.row === "reserves",
  );
  const activeDestination = editorVisuals.editorCards.find(
    (card) => card.label === `editorCard:${snapshot.overlay.activeIds[0]}` &&
      card.row === "batting",
  );
  await dragStageTargets(centeredMovedReserveCard, activeDestination);
  await page.waitForFunction(
    (instanceId) => {
      const overlay = JSON.parse(window.render_game_to_text()).overlay;
      return (
        overlay?.style === 0 &&
        overlay.activeIds?.length === 6 &&
        overlay.reserveIds?.length === 3 &&
        overlay.activeIds.includes(instanceId)
      );
    },
    movedId,
    { timeout: 15_000 },
  );
  snapshot = await state();

  // The source sort icon operates only on style 0's retained local reserve collection. Its first
  // cycle from constructor mode Level selects Name; prove the rendered path and local-only order.
  editorVisuals = await townVisuals(townName);
  assert(
    editorVisuals.editorSort?.effectiveVisible &&
      editorVisuals.editorSort.bounds.w > 0 &&
      editorVisuals.editorSort.bounds.h > 0,
    "style-0 reserve sort control was not visibly rendered",
  );
  await clickStageTarget(editorVisuals.editorSort);
  snapshot = await state();
  assert.equal(snapshot.overlay.sortOrder, 0);
  for (let index = 1; index < snapshot.overlay.reserveEntries.length; index++) {
    assert(
      snapshot.overlay.reserveEntries[index - 1].name.localeCompare(
        snapshot.overlay.reserveEntries[index].name,
      ) <= 0,
      `style-0 reserve name sort is not monotonic: ` +
        JSON.stringify(snapshot.overlay.reserveEntries),
    );
  }
  assert.deepEqual(
    snapshot.party.map((member) => member.instanceId),
    durablePartyOrderAtEditorOpen,
    "reserve sorting or staged cross-row edits leaked into durable roster order before close",
  );
  await page.screenshot({
    path: path.join(outputDir, "02a-town-style0-editor.png"),
    timeout: 120_000,
  });

  // Style 0's source-only remove-all control must route through its Yes/No confirmation. Drive
  // both actions through the real labeled Pixi nodes so a debug-only mutation cannot satisfy this
  // contract while the rendered button or popup arbitration is broken.
  visuals = await townVisuals(townName);
  assert(visuals.editorRemoveAll?.effectiveVisible, "style-0 remove-all control is not rendered");
  assert(
    visuals.editorRemoveAll.bounds.w > 0 && visuals.editorRemoveAll.bounds.h > 0,
    `style-0 remove-all control has no visible parent-owned hit geometry: ` +
      JSON.stringify(visuals.editorRemoveAll),
  );
  await clickStageTarget(visuals.editorRemoveAll);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).overlay?.popups?.depth === 1,
    undefined,
    { timeout: 15_000 },
  );
  // Popup.show mounts before its source 0.2s vertical pop-in completes. Advance that animation so
  // the following hit is against a genuinely visible label-sized button, not a scaleY=0 debug node.
  await advance(200);
  snapshot = await state();
  assert.deepEqual(snapshot.overlay.popups.stack[0].buttons, ["Yes", "No"]);
  const confirmationTexts = await visibleTexts();
  assert(
    confirmationTexts.includes("Are You Sure?"),
    `remove-all confirmation title is not visible: ${confirmationTexts.join(" | ")}`,
  );
  assert(
    confirmationTexts.includes(
      "This will remove all monsters from the top row and move then to the bottom.",
    ),
    `remove-all confirmation message is not visible: ${confirmationTexts.join(" | ")}`,
  );
  visuals = await townVisuals(townName);
  assert(
    visuals.confirmRemoveAll?.effectiveVisible,
    "localized popupButton:Yes is not visibly mounted for remove-all",
  );
  assert(
    visuals.confirmRemoveAll.bounds.w > 0 && visuals.confirmRemoveAll.bounds.h > 0,
    `popupButton:Yes has no visible parent-owned hit geometry: ` +
      JSON.stringify(visuals.confirmRemoveAll),
  );
  await page.screenshot({
    path: path.join(outputDir, "02b-town-remove-all-confirm.png"),
    timeout: 120_000,
  });
  await clickStageTarget(visuals.confirmRemoveAll);
  await page.waitForFunction(
    () => {
      const overlay = JSON.parse(window.render_game_to_text()).overlay;
      return (
        overlay?.style === 0 &&
        overlay.popups?.depth === 0 &&
        overlay.activeIds?.length === 0 &&
        overlay.reserveIds?.length === 9
      );
    },
    undefined,
    { timeout: 15_000 },
  );
  snapshot = await state();
  assert.equal(snapshot.mode, "town");
  assert.equal(snapshot.town.name, townName);
  assert.equal(snapshot.party.length, 9, "remove-all destroyed a roster member");
  assert.deepEqual(snapshot.overlay.activeIds, []);
  assert.equal(snapshot.overlay.reserveIds.length, 9);
  assert.deepEqual(
    [...snapshot.overlay.reserveIds].sort(),
    snapshot.party.map((member) => member.instanceId).sort(),
    "remove-all reserves do not contain the complete live roster",
  );
  const managedParty = snapshot.party.map(
    ({ instanceId, shortType, currentHp, injured }) => ({
      instanceId,
      shortType,
      currentHp,
      injured,
    }),
  );
  assert.deepEqual(
    [...managedParty].sort((left, right) => left.instanceId.localeCompare(right.instanceId)),
    [...restoredParty].sort((left, right) => left.instanceId.localeCompare(right.instanceId)),
    "town management changed roster identity or restored monster state",
  );
  assert.deepEqual(
    snapshot.party.map((member) => member.instanceId),
    durablePartyOrderAtEditorOpen,
    "Remove All rewrote durable roster order before the explicit close commit",
  );

  // Popup dismissal is synchronous in the source and port. The remaining 50ms reaches t=1.752s:
  // t=1.001 entry reveal + the proven 0.501s banner dismissal + the 0.2s popup pop-in + 0.05s.
  await advance(50);
  visuals = await townVisuals(townName);
  assert(
    Object.values(visuals.retainedIdentity).every(Boolean),
    `remove-all replaced the retained town hierarchy: ${JSON.stringify(visuals.retainedIdentity)}`,
  );
  assertTransform(
    visuals.worldSurface,
    interpolateTransform(baseline.worldSurface, exactTarget, easeExponentialOut(1752 / 5000)),
    "remove-all disturbed the continuing whole-world entry transform",
    1e-3,
  );
  assertTransform(visuals.map, baseline.map, "remove-all changed the retained map-local transform");

  assert(visuals.editorClose, "style-0 editor has no labeled close control");
  await clickStageTarget(visuals.editorClose);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).overlay === null,
    undefined,
    { timeout: 15_000 },
  );
  assert.equal((await state()).mode, "town", "closing style 0 left the retained town");

  snapshot = await state();
  visuals = await townVisuals(townName);
  assert(visuals.buildings.every((building) => closeTo(building.alpha, 1)));
  assert(closeTo(visuals.exit.alpha, 1));
  assert.equal(snapshot.town.namePlate.text, expectedTownDisplayName);
  assert.equal(snapshot.town.namePlate.visible, true);
  assert(
    closeTo(snapshot.town.namePlate.alpha, 0.752, 0.01),
    `town name plate did not follow its 1.0s fade-in: ${JSON.stringify(snapshot.town.namePlate)}`,
  );
  assert(visuals.townNamePlate?.effectiveVisible);
  const townNameBounds = visuals.townNamePlate.bounds;
  const sourceMarginPt = expectedDisplayMode === "ipad" ? 5 : 10;
  const sourceMarginPx = sourceMarginPt * 2 * geometry.scale;
  assert(
    closeTo(
      townNameBounds.x + townNameBounds.w,
      expectedViewportBounds.x + expectedViewportBounds.w - sourceMarginPx,
      1,
    ),
    `town name plate is not attached to the viewport right edge: ${JSON.stringify(townNameBounds)}`,
  );
  assert(
    closeTo(
      townNameBounds.y + townNameBounds.h,
      expectedViewportBounds.y + expectedViewportBounds.h - sourceMarginPx,
      1,
    ),
    `town name plate is not attached to the viewport bottom edge: ${JSON.stringify(townNameBounds)}`,
  );

  // A route-disabled authored building remains visible and fully inert under Pixi pointer
  // arbitration. Select it from the live model rather than assuming newer destinations are absent.
  const disabledTownBuilding = snapshot.town.buildings.find(
    (building) => building.revealed && !building.enabled,
  );
  assert(disabledTownBuilding, "town fixture exposes no disabled building for pointer arbitration");
  const inertBuilding = visuals.buildings.find(
    (building) =>
      building.label === `town:${townName}:menu:${disabledTownBuilding.className}`,
  );
  assert(inertBuilding, `missing disabled ${disabledTownBuilding.className} control`);
  assert.equal(inertBuilding.eventMode, "none");
  await clickStageTarget(inertBuilding);
  snapshot = await state();
  assert.equal(snapshot.mode, "town");
  assert.equal(snapshot.locked, false);
  assert.equal(snapshot.menu, null);
  assert.equal(snapshot.overlay, null);
  assert.equal(
    snapshot.town.buildings.find(
      (building) => building.className === "MonsterManagementMenuItem",
    )?.enabled,
    true,
  );

  await advance(250);
  visuals = await townVisuals(townName);
  assert(visuals.worldSurface.scaleX > baseline.worldSurface.scaleX);
  assert(visuals.worldSurface.scaleX < snapshot.town.zoom);
  assertTransform(visuals.map, baseline.map, "map-local transform changed during town zoom");
  assert(visuals.buildings.every((building) => closeTo(building.alpha, 1)));
  assert.equal(
    visuals.buildings.find(
      (building) => building.label === `town:${townName}:menu:MonsterManagementMenuItem`,
    )?.eventMode,
    "static",
  );
  assertBounds(
    visuals.townNamePlate.bounds,
    townNameBounds,
    "town name plate moved with the zoomed world instead of the notification viewport",
    0.5,
  );
  await page.screenshot({ path: path.join(outputDir, "03-town-partial-zoom.png"), timeout: 120_000 });

  // The touched day banner completed its early exit at t=1.502s while the independently timed town
  // plate is fully visible. Reach the original t=3.25s visual checkpoint and capture that
  // unobscured interval as direct evidence of the source-owned bottom-right plaque attachment.
  await advance(1248);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert.equal(snapshot.town.dayNotification, undefined);
  assert.equal(snapshot.town.namePlate.visible, true);
  assert(closeTo(snapshot.town.namePlate.alpha, 1));
  assertBounds(
    visuals.townNamePlate.bounds,
    townNameBounds,
    "unobscured town name plate moved away from the notification viewport",
    0.5,
  );
  await page.screenshot({ path: path.join(outputDir, "03b-town-nameplate.png"), timeout: 120_000 });

  // Step beyond the exact 5s tween boundary. Sampling precisely on the boundary can retain the
  // final sub-point interpolation value when the Pixi ticker has a fractional accumulated time.
  await advance(1800);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert.equal(snapshot.mode, "town");
  assert.equal(snapshot.locked, false);
  assertTransform(visuals.worldSurface, exactTarget, "completed whole-world town zoom");
  assertTransform(visuals.map, baseline.map, "completed town zoom changed map-local transform");
  assert(
    Object.values(visuals.retainedIdentity).every(Boolean),
    `completed zoom replaced world hierarchy: ${JSON.stringify(visuals.retainedIdentity)}`,
  );
  assertBounds(visuals.viewport.bounds, expectedViewportBounds, "completed town viewport");
  assert(visuals.buildings.every((building) => building.effectiveVisible));
  assert(visuals.buildings.every((building) => closeTo(building.effectiveAlpha, 1)));
  assert(visuals.buildings.every((building) => building.bounds.w > 0 && building.bounds.h > 0));
  assert(visuals.townMenu?.effectiveVisible, "town menu is not visible after its fade");
  assert(closeTo(visuals.townMenu.effectiveAlpha, 1));
  assert(
    closeTo(visuals.townMenu.bounds.x, expectedViewportBounds.x, 1),
    `town menu is not attached to viewport left: ${JSON.stringify(visuals.townMenu.bounds)}`,
  );
  assert(
    closeTo(visuals.townMenu.bounds.y, expectedViewportBounds.y, 1),
    `town menu is not attached to viewport top: ${JSON.stringify(visuals.townMenu.bounds)}`,
  );
  assert(
    closeTo(visuals.townMenu.bounds.w, baseline.worldMenu.bounds.w, 1) &&
      closeTo(visuals.townMenu.bounds.h, baseline.worldMenu.bounds.h, 1),
    "town menu did not counter-scale back to the source screen-sized button",
  );
  await page.screenshot({ path: path.join(outputDir, "04-town-full-zoom.png"), timeout: 120_000 });

  // Return once to establish a clean second entry. The next visit leaves while its 5.0s entry
  // zoom is still running, exercising the source action-cancellation branch.
  await clickStageTarget(visuals.exit);
  await advance(1001);
  snapshot = await state();
  assert.equal(snapshot.mode, "world");
  assert.equal(snapshot.locked, false);
  assert.equal(snapshot.markerVisible, true);
  assert(closeTo(snapshot.markerAlpha, 0, 0.01));
  assert.equal(snapshot.chrome.heroXp.visible, true);
  assert(closeTo(snapshot.chrome.menu.alpha, 0, 0.01));
  assert.deepEqual(snapshot.poiStates, restoredPoiStates);
  assert(
    snapshot.pois.every((poi) => closeTo(poi.stateAlpha, 1, 0.01)),
    "first town return did not canonicalize every persistent POI sprite to field alpha 1",
  );
  assert(
    snapshot.pois.every((poi) =>
      poi.stateVisible
        ? poi.renderedState === poi.logicalState && poi.renderedTextureKey !== null
        : poi.renderedState === null && poi.renderedTextureKey === null
    ),
    "town return did not rebuild canonical rendered POI identities/materialization",
  );
  if (alphaRegressionField) {
    const fieldAfterTown = snapshot.pois.find((poi) => poi.name === alphaRegressionField.name);
    assert.equal(fieldAfterTown?.stateVisible, false);
    assert(closeTo(fieldAfterTown?.stateAlpha, 1, 0.01));
  }
  const restoredPoiStateVisibility = Object.fromEntries(
    snapshot.pois.map((poi) => [poi.name, poi.stateVisible]),
  );
  let returnedVisuals = await townVisuals(townName);
  assertTransform(returnedVisuals.worldSurface, baseline.worldSurface, "first town return");
  assertTransform(returnedVisuals.map, baseline.map, "first return map-local transform");
  assertBounds(returnedVisuals.viewport.bounds, expectedViewportBounds, "first return viewport");
  assert.equal(returnedVisuals.worldMenu.visible, true);
  assert(
    closeTo(returnedVisuals.worldMenu.alpha, 0, 0.01),
    `retained world menu did not begin return fade at alpha 0: ` +
      returnedVisuals.worldMenu.alpha,
  );
  assert(returnedVisuals.marker?.visible, "hero marker was not restored before its return fade");
  assert(
    closeTo(returnedVisuals.marker.alpha, 0, 0.01),
    `hero marker did not begin return fade at alpha 0: ${returnedVisuals.marker.alpha}`,
  );
  assert(returnedVisuals.heroXp?.effectiveVisible, "Hero XP was not visible on town return");
  await expectPlayingMusic("Field1.mp3", "first town return");

  await advance(250);
  snapshot = await state();
  returnedVisuals = await townVisuals(townName);
  assert(closeTo(snapshot.chrome.menu.alpha, 0.5, 0.02));
  assert(closeTo(snapshot.markerAlpha, 0.5, 0.02));
  assert(
    closeTo(returnedVisuals.worldMenu.alpha, 0.5, 0.02),
    `retained world menu did not reach alpha 0.5 during return: ` +
      returnedVisuals.worldMenu.alpha,
  );
  assert(
    closeTo(returnedVisuals.marker.alpha, 0.5, 0.02),
    `hero marker did not reach alpha 0.5 during return: ${returnedVisuals.marker.alpha}`,
  );

  await advance(250);
  snapshot = await state();
  returnedVisuals = await townVisuals(townName);
  assert(closeTo(snapshot.chrome.menu.alpha, 1, 0.01));
  assert(closeTo(snapshot.markerAlpha, 1, 0.01));
  assert(closeTo(returnedVisuals.worldMenu.alpha, 1, 0.01));
  assert(closeTo(returnedVisuals.marker.alpha, 1, 0.01));

  if (alphaRegressionHut && alphaRegressionField) {
    await clickPoi(alphaRegressionHut.name);
    snapshot = await state();
    assert.equal(snapshot.mode, "world");
    assert.equal(snapshot.currentPoi, alphaRegressionHut.name);
    assert.equal(snapshot.walking, true, "ordinary adjacent navigation lost its movement phase");
    let revealedField = snapshot.pois.find((poi) => poi.name === alphaRegressionField.name);
    assert.equal(revealedField?.state, 4);
    assert.equal(revealedField?.stateVisible, true);
    assert(closeTo(revealedField?.stateAlpha, 1, 0.01));
    await advance(249);
    assert.equal((await state()).walking, true, "ordinary adjacent movement ended before 250ms");
    await advance(2);
    snapshot = await state();
    assert.equal(snapshot.walking, false, "ordinary adjacent movement exceeded its 250ms source duration");

    await clickPoi(alphaRegressionField.name);
    snapshot = await state();
    assert.equal(snapshot.mode, "world");
    assert.equal(snapshot.currentPoi, alphaRegressionField.name);
    assert.equal(snapshot.walking, true);
    const nonAdjacentTown = snapshot.pois.find((poi) => poi.name === townName);
    assert(nonAdjacentTown?.state !== 3, "completed path did not expose the non-adjacent town");
    await advance(249);
    assert.equal((await state()).walking, true, "second ordinary adjacent move ended before 250ms");
    await advance(2);
    snapshot = await state();
    assert.equal(snapshot.walking, false);

    const preTownRenderedProjection = snapshot.pois.map((poi) => ({
      name: poi.name,
      renderedState: poi.renderedState,
      renderedTextureKey: poi.renderedTextureKey,
      stateVisible: poi.stateVisible,
    }));
    const preTownMarkerDirection = snapshot.markerDirection;
    const nonAdjacentTownCssPoint = geometry.toCss({
      x: nonAdjacentTown.position.x + 20,
      y: nonAdjacentTown.position.y,
    });
    const nonAdjacentTownHitPath = await page.evaluate(({ x, y }) => {
      const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(x, y);
      const path = [];
      for (let current = hit; current; current = current.parent) {
        path.push({ label: current.label ?? null, eventMode: current.eventMode });
      }
      return path;
    }, {
      x: nonAdjacentTownCssPoint.x - box.x,
      y: nonAdjacentTownCssPoint.y - box.y,
    });
    await page.mouse.click(nonAdjacentTownCssPoint.x, nonAdjacentTownCssPoint.y);
    await advance(0);
    let postDismissHitPath = nonAdjacentTownHitPath;
    if (nonAdjacentTownHitPath.some(({ label }) => label === "popupCard")) {
      // The just-completed POI occurrence can publish an automatic director notification. Its
      // source popup owns and swallows the first tap; dismissal never forwards that same sequence
      // into the world scene, so activate the town with a fresh tap after the synchronous close.
      postDismissHitPath = await page.evaluate(({ x, y }) => {
        const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(x, y);
        const path = [];
        for (let current = hit; current; current = current.parent) {
          path.push({ label: current.label ?? null, eventMode: current.eventMode });
        }
        return path;
      }, {
        x: nonAdjacentTownCssPoint.x - box.x,
        y: nonAdjacentTownCssPoint.y - box.y,
      });
      assert(
        !postDismissHitPath.some(({ label }) => label === "popupCard"),
        `automatic POI notification did not dismiss synchronously: ` +
          JSON.stringify(postDismissHitPath),
      );
      await page.mouse.click(nonAdjacentTownCssPoint.x, nonAdjacentTownCssPoint.y);
      await advance(0);
    }
    for (let index = 0; index < 200 && (await state()).mode !== "town"; index++) {
      await advance(0);
      await page.waitForTimeout(2);
    }
    snapshot = await state();
    assert.equal(
      snapshot.mode,
      "town",
      `non-adjacent town tap waited for a teleport arrival prelude; hitPath=` +
        `${JSON.stringify(nonAdjacentTownHitPath)}; postDismissHitPath=` +
        `${JSON.stringify(postDismissHitPath)}; state=${JSON.stringify(snapshot)}`,
    );
    assert.equal(snapshot.currentPoi, townName);
    assert.equal(snapshot.locked, true);
    assert.equal(snapshot.walking, false);
    assert.equal(snapshot.markerVisible, false);
    assert.equal(snapshot.markerPlaying, false);
    assert.equal(
      snapshot.markerDirection,
      preTownMarkerDirection,
      "teleport town settlement changed the source last-walk direction",
    );
    assert(closeTo(snapshot.markerAlpha, 1));
    assert.deepEqual(
      snapshot.pois.map((poi) => ({
        name: poi.name,
        renderedState: poi.renderedState,
        renderedTextureKey: poi.renderedTextureKey,
        stateVisible: poi.stateVisible,
      })),
      preTownRenderedProjection,
      "town entry rebuilt the post-arrival POI projection before fading the old field flags",
    );
    assert(
      snapshot.pois.some((poi) => poi.logicalState !== poi.renderedState),
      "different-POI town fixture does not expose logical-versus-rendered projection timing",
    );
    assert.deepEqual(
      snapshot.markerPosition,
      currentTownPoi.mapPosition,
      "hidden marker was not snapped to the logical town destination",
    );
    assert.deepEqual(
      snapshot.sceneTransform,
      {
        position: { x: 0, y: 0 },
        pivot: { x: 0, y: 0 },
        scale: 1,
      },
      "town transform advanced before the same-turn immediate-entry checkpoint",
    );
  } else {
    await clickCurrentTown();
    snapshot = await state();
  }
  assert.equal(
    snapshot.town.dayNotification.day,
    3,
    "second town entry did not persist and increment the source day counter",
  );
  assert.equal(snapshot.town.dayNotification.title, "Day 3");
  await advance(250);
  snapshot = await state();
  assert.equal(snapshot.markerVisible, false);
  assert.equal(snapshot.markerPlaying, false);
  assert(
    closeTo(snapshot.markerAlpha, 1),
    "hidden town marker alpha was mutated by a late teleport tween",
  );
  await advance(751);

  // Remove All creates transient nil batting slots. The source stores no batting-order length, so
  // closing compacts priority and the next editor derives the active prefix from capacity again.
  // Reopen on the retained second visit and prove that canonical projection explicitly.
  visuals = await townVisuals(townName);
  const secondMonsterControl = visuals.buildings.find(
    (building) => building.label === `town:${townName}:menu:MonsterManagementMenuItem`,
  );
  assert.equal(secondMonsterControl?.eventMode, "static");
  await clickStageTarget(secondMonsterControl);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).overlay?.style === 0,
    undefined,
    { timeout: 15_000 },
  );
  await advance(0);
  snapshot = await state();
  assert.deepEqual(
    snapshot.overlay.activeIds,
    snapshot.party.slice(0, 6).map((member) => member.instanceId),
  );
  assert.equal(snapshot.overlay.reserveIds.length, 3);
  assert.deepEqual(
    [...snapshot.overlay.reserveIds].sort(),
    snapshot.party.slice(6).map((member) => member.instanceId).sort(),
    "reopened style-0 reserves disagree with the source-derived batting prefix",
  );
  const reopenedManagedParty = snapshot.party.map(
    ({ instanceId, shortType, currentHp, injured }) => ({
      instanceId,
      shortType,
      currentHp,
      injured,
    }),
  );
  visuals = await townVisuals(townName);
  assert(visuals.editorClose, "reopened style-0 editor has no close control");
  await clickStageTarget(visuals.editorClose);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).overlay === null,
    undefined,
    { timeout: 15_000 },
  );

  await advance(250);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert.equal(snapshot.mode, "town");
  assert.equal(snapshot.locked, false);
  assertTransform(
    visuals.worldSurface,
    interpolateTransform(baseline.worldSurface, exactTarget, easeExponentialOut(1251 / 5000)),
    "second entry transform before early exit",
    1e-3,
  );
  assertTransform(visuals.map, baseline.map, "second entry changed map-local transform");
  assert(
    closeTo(visuals.exit.alpha, 0.502, 0.01),
    `second-entry exit reveal missed its t=1.251s opacity: ${visuals.exit.alpha}`,
  );
  await expectPlayingMusic("Town1.mp3", "second town entry");
  const earlyExitTransform = visuals.worldSurface;
  await clickStageTarget(visuals.exit);
  await advance(0);

  snapshot = await state();
  visuals = await townVisuals(townName);
  assert.equal(snapshot.mode, "town");
  assert.equal(snapshot.locked, true);
  assert(
    closeTo(visuals.exit.alpha, 0.502, 0.01),
    `early-exit touch changed opacity before the departure ticker advanced: ${visuals.exit.alpha}`,
  );
  await page.screenshot({ path: path.join(outputDir, "05-town-early-exit-start.png"), timeout: 120_000 });

  await advance(250);
  visuals = await townVisuals(townName);
  // The source starts an absolute FadeOut(1 -> 0), not a relative fade from the overlapping
  // reveal's current 0.5 opacity. The newer exit action writes last each frame.
  assert(closeTo(visuals.exit.alpha, 0.5));
  assertTransform(
    visuals.worldSurface,
    interpolateTransform(earlyExitTransform, baseline.worldSurface, easeExponentialOut(0.25)),
    "source exponential-out departure transform at 250ms",
    1e-3,
  );
  assertTransform(visuals.map, baseline.map, "departure changed map-local transform");

  await advance(251);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert.equal(snapshot.mode, "town", "map return completed at the 0.5s chrome-fade gate");
  assert.equal(snapshot.locked, true);
  assert.equal(visuals.exit.visible, true);
  assert(closeTo(visuals.exit.alpha, 0));
  assert.equal(visuals.exit.eventMode, "none");
  assert(visuals.buildings.every((building) => building.visible));
  assert(visuals.buildings.every((building) => closeTo(building.alpha, 0)));
  assert(visuals.buildings.every((building) => building.eventMode === "none"));
  assert(visuals.townMenu?.visible);
  assert(closeTo(visuals.townMenu.alpha, 0));
  assert.equal(visuals.townMenu.eventMode, "none");
  assert(visuals.worldSurface.scaleX > baseline.worldSurface.scaleX);
  assertTransform(visuals.map, baseline.map, "hidden-chrome departure changed map-local transform");
  await page.screenshot({
    path: path.join(outputDir, "06-town-chrome-hidden-500ms.png"),
    timeout: 120_000,
  });

  await advance(498);
  assert.equal((await state()).mode, "town", "map return completed before the source 1.0s gate");
  await advance(2);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert.equal(snapshot.mode, "world");
  assert.equal(snapshot.currentPoi, townName);
  assert.equal(snapshot.locked, false);
  assert.equal(snapshot.walking, false);
  assert.equal(snapshot.town, undefined);
  assert.deepEqual(snapshot.poiStates, restoredPoiStates);
  assert(
    snapshot.pois.every((poi) => closeTo(poi.stateAlpha, 1, 0.01)),
    "second town return did not canonicalize hidden and visible POI sprites to alpha 1",
  );
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType, currentHp, injured }) => ({
      instanceId,
      shortType,
      currentHp,
      injured,
    })),
    reopenedManagedParty,
    "source name-sorted reserve order did not survive the retained-map exit cycle",
  );
  assert.equal(snapshot.markerVisible, true);
  assert(closeTo(snapshot.markerAlpha, 0, 0.01));
  assert.equal(snapshot.chrome.heroXp.visible, true);
  assert.deepEqual(
    Object.fromEntries(snapshot.pois.map((poi) => [poi.name, poi.stateVisible])),
    restoredPoiStateVisibility,
  );
  assert.equal(snapshot.chrome.menu.visible, true);
  assert.equal(snapshot.chrome.menu.functional, true);
  assert(closeTo(snapshot.chrome.menu.alpha, 0, 0.01));
  assert.equal(visuals.worldMenu.visible, true);
  assert(
    closeTo(visuals.worldMenu.alpha, 0, 0.01),
    `retained world menu did not begin its 0.5s return fade at alpha 0: ` +
      visuals.worldMenu.alpha,
  );
  assert.equal(visuals.worldMenu.eventMode, "static");
  assert(visuals.marker?.visible, "hero marker was not restored before its 0.5s fade");
  assert(
    closeTo(visuals.marker.alpha, 0, 0.01),
    `hero marker did not begin its 0.5s return fade at alpha 0: ${visuals.marker.alpha}`,
  );
  assert(visuals.heroXp?.effectiveVisible, "Hero XP was not restored with the retained world");
  assert(
    Object.values(visuals.retainedIdentity).every(Boolean),
    `town exit replaced retained hierarchy: ${JSON.stringify(visuals.retainedIdentity)}`,
  );
  assert.equal(visuals.sceneMaskIsViewport, true);
  assertTransform(visuals.worldSurface, baseline.worldSurface, "early town return");
  assertTransform(visuals.map, baseline.map, "early return map-local transform");
  assertBounds(visuals.viewport.bounds, expectedViewportBounds, "restored world viewport");
  assert(visuals.townMenu, "retained town-local menu node was destroyed on world restoration");
  assert(closeTo(visuals.townMenu.effectiveAlpha, 0));
  assert.equal(visuals.townMenu.eventMode, "none");
  await expectPlayingMusic("Field1.mp3", "early town return");

  await advance(250);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert(closeTo(snapshot.chrome.menu.alpha, 0.5, 0.02));
  assert(closeTo(snapshot.markerAlpha, 0.5, 0.02));
  assert(
    closeTo(visuals.worldMenu.alpha, 0.5, 0.02),
    `retained world menu did not reach alpha 0.5 during return: ${visuals.worldMenu.alpha}`,
  );
  assert(
    closeTo(visuals.marker.alpha, 0.5, 0.02),
    `hero marker did not reach alpha 0.5 during return: ${visuals.marker.alpha}`,
  );

  await advance(250);
  snapshot = await state();
  visuals = await townVisuals(townName);
  assert(closeTo(snapshot.chrome.menu.alpha, 1, 0.01));
  assert(closeTo(snapshot.markerAlpha, 1, 0.01));
  assert(closeTo(visuals.worldMenu.alpha, 1, 0.01));
  assert(closeTo(visuals.marker.alpha, 1, 0.01));
  if (alphaRegressionHut && alphaRegressionField) {
    await clickPoi(alphaRegressionHut.name);
    snapshot = await state();
    const revealedField = snapshot.pois.find((poi) => poi.name === alphaRegressionField.name);
    assert.equal(revealedField?.state, 4);
    assert.equal(revealedField?.stateVisible, true);
    assert(closeTo(revealedField?.stateAlpha, 1, 0.01));
    await advance(251);
    assert.equal((await state()).walking, false);
  }
  await page.screenshot({ path: path.join(outputDir, "07-world-restored.png"), timeout: 120_000 });

  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(
    `town-loop(${expectedDisplayMode}): PASS (aggregate town-map hit region, immediate town arrival, POI opacity invariants, top notification arbitration, style 0, restore/refresh, music)`,
  );
} finally {
  await browser.close();
}
