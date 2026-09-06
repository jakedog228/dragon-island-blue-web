// Opt-in Monsterpedia ownership/combination contract. Run only with operator authorization.
// Fidelity sign-off requires clean-room + original archives in both display modes. Chromium is
// always muted, and every run writes to its own evidence directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createFrameCapture } from "./captureFrame.mjs";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_MONSTERPEDIA_DISPLAY_MODE ?? "ipad";
if (displayMode !== "iphone" && displayMode !== "ipad") {
  throw new Error(`DIB_MONSTERPEDIA_DISPLAY_MODE must be iphone or ipad; got ${displayMode}`);
}
const archivePath = process.env.DIB_CONTENT_ARCHIVE ?? "";
const inferredVariant = /CinderHarbor_RuntimeCompatible/i.test(archivePath) ? "clean" : "original";
const variant = process.env.DIB_MONSTERPEDIA_VARIANT ?? inferredVariant;
const fixtures = {
  clean: {
    result: "FurnaceBeetle",
    ingredients: ["Emberling", "Coalimp"],
    firstSuccessor: "Pyrecrest",
    town: "Harbor_Town",
  },
  original: {
    result: "Carnoraptor",
    ingredients: ["Bitewing", "Wolf"],
    firstSuccessor: "FlameWing",
    nextSuccessor: "AngelicBird",
    town: "First_City",
  },
};
const fixture = fixtures[variant];
if (!fixture) throw new Error(`Unknown DIB_MONSTERPEDIA_VARIANT ${JSON.stringify(variant)}`);

const outputDir = process.env.DIB_MONSTERPEDIA_OUTPUT
  ? path.resolve(process.env.DIB_MONSTERPEDIA_OUTPUT)
  : path.resolve(
      import.meta.dirname,
      `../../../../output/monsterpedia-${variant}-${displayMode}`,
    );
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const captureFrame = await createFrameCapture(page, outputDir);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.addInitScript(({ displayMode: requestedMode, fixture: testFixture }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: requestedMode,
      textResolutionMode: "modern",
      sound: 0.25,
      music: 0.5,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    // A fresh source-capable slot routes through the scrolling new-game plot before the world
    // (`main.ts` source-intro gate). The subject here is Monsterpedia, so opt out of that
    // route rather than drive it -- `intro`/`intro-chat` are the scenarios that assert it.
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    // Skipping the intro alone lands on `initialWorldBootRoute`, which walks a town-capable
    // world straight into First_City and its LeslieIntro1 enter-chat. This file wants the
    // retained OUTDOOR world (it asserts `currentPoi` from the map), so resume there --
    // the same flag pairing `underworld-background-alignment` uses.
    window.__DIB_TEST_START_IN_WORLD__ = true;
    window.__DIB_TEST_ALL_UNLOCKED__ = false;
    // This fixture deliberately distinguishes durable registration from current ownership:
    // Bitewing is both registered and owned, while Wolf is owned but absent from history. The
    // general demo bootstrap normally fabricates history for every configured party member; opt
    // out here so the source ingredient color/pulse matrix is what this scenario actually tests.
    window.__DIB_TEST_SKIP_DEMO_EVOLUTION_HISTORY__ = true;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 7,
      battingOrderSize: 5,
      levelRange: [5, 5],
      members: [
        {
          shortType: testFixture.ingredients[0],
          level: 5,
          xpIntoLevel: 17,
          currentHp: 1,
          soulStone: {
            element: "Fire",
            level: 40,
            sourceType: testFixture.ingredients[0],
          },
        },
        { shortType: testFixture.ingredients[1], level: 5 },
      ],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 3,
      // 22, not 21: `heroLevelForXp` compares STRICTLY (`c06109a`, grounded in savefile2.bak
      // storing hero level 1 at a total of exactly 8 = xpForLevel(2)), so a total landing
      // exactly on a threshold has not reached that level yet. xpForLevel(3) is 21, which now
      // means level 2 and fails PlayerProfile's consistency check; level 3 starts at 22.
      heroTotalHighestLevels: 22,
      monsterPartyLevels: [5, 5, 5, 5, 5, 5, 5],
      silver: 1000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      highestCapturedLevels: {
        [testFixture.ingredients[0]]: 5,
        [testFixture.firstSuccessor]: 1,
      },
      learnedCombineRecipes: [testFixture.result],
      spiritReadiness: 0,
    };
  }, { displayMode, fixture });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const waitForState = async (predicate, description, iterations = 300) => {
    for (let index = 0; index < iterations; index += 1) {
      const snapshot = await state();
      if (predicate(snapshot)) {
        // Async UI can enter debug state on the frame its pop-in begins at scaleY=0. Advance one
        // deterministic frame before probing bounds so the source animation has a nonzero surface.
        await advance(25);
        return await state();
      }
      await advance(25);
      if (index % 4 === 0) await page.waitForTimeout(10);
    }
    throw new Error(
      `${description}; errors=${errors.join(" | ") || "none"}; ` +
        `state=${JSON.stringify(await state())}`,
    );
  };
  const visibleTexts = () => page.evaluate(() => {
    const texts = [];
    const visit = (node, parentVisible, parentAlpha) => {
      const visible = parentVisible && node.visible !== false && node.renderable !== false;
      const alpha = parentAlpha * (node.alpha ?? 1);
      if (visible && alpha > 0.001 && typeof node.text === "string") texts.push(node.text);
      for (const child of node.children ?? []) visit(child, visible, alpha);
    };
    visit(globalThis.__PIXI_APP__.stage, true, 1);
    return texts;
  });

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box, "Pixi canvas is missing");
  const rendererScreen = await page.evaluate(() => ({
    w: globalThis.__PIXI_APP__.renderer.screen.width,
    h: globalThis.__PIXI_APP__.renderer.screen.height,
  }));
  const rendererToCss = {
    x: box.width / rendererScreen.w,
    y: box.height / rendererScreen.h,
  };

  const targetForLabel = (label) => page.evaluate((wanted) => {
    const root = globalThis.__PIXI_APP__?.stage;
    const boundary = globalThis.__PIXI_APP__?.renderer?.events?.rootBoundary;
    if (!root || !boundary) throw new Error("Pixi stage/event boundary is unavailable");
    const candidates = [];
    const visit = (node, parentVisible) => {
      const visible = parentVisible && node.visible !== false && node.renderable !== false;
      if (visible && node.label === wanted) candidates.push(node);
      for (const child of node.children ?? []) visit(child, visible);
    };
    visit(root, true);
    const node = candidates.at(-1);
    if (!node) return null;
    const bounds = node.getBounds();
    // MenuButton2 keeps label-sized layout but registers the complete visible Scale9 plate.
    const hitBounds = bounds;
    const hitArea = node.hitArea;
    const rectangularHitArea =
      hitArea &&
      typeof hitArea.width === "number" &&
      typeof hitArea.height === "number";
    const fractions = [0.5, 0.25, 0.75, 0.1, 0.9];
    for (const fy of fractions) {
      for (const fx of fractions) {
        const point = rectangularHitArea
          ? node.toGlobal({
              x: (hitArea.x ?? 0) + hitArea.width * fx,
              y: (hitArea.y ?? 0) + hitArea.height * fy,
            })
          : {
              x: hitBounds.x + hitBounds.width * fx,
              y: hitBounds.y + hitBounds.height * fy,
            };
        const hit = boundary.hitTest(point.x, point.y);
        for (let current = hit; current; current = current.parent) {
          if (current === node) {
            return {
              x: point.x,
              y: point.y,
              bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
              eventMode: node.eventMode,
              ownedByTargetAncestor: false,
            };
          }
        }
        // PopupMenu/MonsterManagement rows are intentionally inert visuals. Their source-shaped
        // owner is an ancestor that arbitrates one shared item list, so the top hit can be that
        // ancestor without the labelled row appearing in the hit->root path. Accept only an
        // ancestor on THIS node's chain; an unrelated overlay still fails the ownership proof.
        const nodeAncestors = new Set();
        for (let current = node.parent; current; current = current.parent) {
          nodeAncestors.add(current);
        }
        for (let current = hit; current; current = current.parent) {
          const ownsPointer =
            (current.listenerCount?.("pointertap") ?? 0) > 0 ||
            ((current.listenerCount?.("pointerdown") ?? 0) > 0 &&
              (current.listenerCount?.("pointerup") ?? 0) > 0);
          if (nodeAncestors.has(current) && ownsPointer) {
            return {
              x: point.x,
              y: point.y,
              bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
              eventMode: node.eventMode,
              ownedByTargetAncestor: true,
              ownerLabel: current.label ?? null,
            };
          }
        }
      }
    }
    const missedX = hitBounds.x + hitBounds.width / 2;
    const missedY = hitBounds.y + hitBounds.height / 2;
    const missedHit = boundary.hitTest(missedX, missedY);
    const missedLocal = node.toLocal({ x: missedX, y: missedY });
    const hitPath = [];
    for (let current = missedHit; current; current = current.parent) {
      hitPath.push(current.label ?? current.constructor?.name ?? "<unlabeled>");
    }
    const targetPath = [];
    for (let current = node; current; current = current.parent) {
      const currentBounds = current.getBounds();
      targetPath.push({
        label: current.label ?? current.constructor?.name ?? "<unlabeled>",
        eventMode: current.eventMode,
        interactiveChildren: current.interactiveChildren,
        bounds: {
          x: currentBounds.x,
          y: currentBounds.y,
          w: currentBounds.width,
          h: currentBounds.height,
        },
      });
    }
    return {
      x: missedX,
      y: missedY,
      bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
      eventMode: node.eventMode,
      localPoint: missedLocal,
      localBounds: {
        minX: node.bounds?.minX,
        minY: node.bounds?.minY,
        maxX: node.bounds?.maxX,
        maxY: node.bounds?.maxY,
      },
      containsPoint: node.containsPoint?.(missedLocal),
      hitPath,
      targetPath,
      missedHitPath: true,
    };
  }, label);

  const clickLabel = async (label) => {
    const target = await targetForLabel(label);
    assert(target, `missing visible Pixi node ${label}`);
    const parentOwnedManagementControl =
      label === "monsterManagement:select" || label === "monsterManagement:cancel";
    if (parentOwnedManagementControl || target.ownedByTargetAncestor) {
      // The source picker owns one screen-level touch delegate and manually tests its tag-3/tag-4
      // label rectangles. PopupMenu uses the same parent-owned shape for its menuItems list. The
      // child controls are therefore passive/inert in Pixi by design.
      assert(
        target.eventMode === "passive" || target.eventMode === "none",
        `${label} unexpectedly owns an independent Pixi listener`,
      );
    } else {
      assert.equal(target.eventMode, "static", `${label} is not interactive`);
      assert(!target.missedHitPath, `${label} has no Pixi hit path: ${JSON.stringify(target)}`);
    }
    await page.mouse.click(
      box.x + target.x * rendererToCss.x,
      box.y + target.y * rendererToCss.y,
    );
  };
  const closePopup = async () => {
    const snapshot = await state();
    const button = snapshot.overlay?.popups?.stack?.at(-1)?.buttons?.at(-1);
    assert(button, `active Monsterpedia popup has no button: ${JSON.stringify(snapshot.overlay)}`);
    await clickLabel(`popupButton:${button}`);
    await waitForState(
      (value) => value.overlay?.popups?.depth === 0,
      "Monsterpedia popup did not dismiss",
    );
  };
  const finishMonsterpediaOpenFade = async (route, description) => {
    let value = await waitForState(
      (candidate) =>
        candidate.sceneFade?.route === route && candidate.sceneFade.phase === "covering",
      `${description} did not begin its source black fade`,
    );
    assert.equal(value.overlay, null, `${description} replaced the outgoing scene before midpoint`);
    value = await waitForState(
      (candidate) =>
        candidate.overlay?.screen === "monsterpedia" &&
        candidate.sceneFade?.route === route &&
        candidate.sceneFade.phase === "revealing",
      `${description} did not swap at the opaque midpoint`,
    );
    return await waitForState(
      (candidate) => candidate.overlay?.screen === "monsterpedia" && candidate.sceneFade === undefined,
      `${description} did not finish its 0.5-second fade`,
    );
  };
  const closeMonsterpediaThroughFade = async (route, description) => {
    await clickLabel("monsterpediaTab:close");
    let value = await waitForState(
      (candidate) =>
        candidate.overlay?.screen === "monsterpedia" &&
        candidate.sceneFade?.route === route &&
        candidate.sceneFade.phase === "covering",
      `${description} did not retain the book during fade-in`,
    );
    assert.equal(value.overlay.closing, true);
    value = await waitForState(
      (candidate) =>
        candidate.overlay === null &&
        candidate.sceneFade?.route === route &&
        candidate.sceneFade.phase === "revealing",
      `${description} did not remove the book at the opaque midpoint`,
    );
    return await waitForState(
      (candidate) => candidate.overlay === null && candidate.sceneFade === undefined,
      `${description} did not finish its return fade`,
    );
  };
  const openRecipeCard = async () => {
    await clickLabel(`monsterpediaCard:${fixture.result}`);
    const snapshot = await waitForState(
      (value) =>
        value.overlay?.popups?.depth === 1 &&
        value.overlay.popups.stack[0].buttons.includes("Make") &&
        value.overlay.popups.stack[0].buttons.includes("Look"),
      "learned recipe did not open Make/Look",
    );
    const texts = await visibleTexts();
    assert(
      texts.includes("Do you want to make this monster or just look at it?"),
      `Make/Look body is absent: ${JSON.stringify(texts)}`,
    );
    return snapshot;
  };
  const chooseMake = async () => {
    await clickLabel("popupButton:Make");
  };

  // Leave the content gate and settle the retained outdoor world.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let snapshot = await waitForState(
    (value) => value.mode === "world" && !value.locked && !value.walking,
    "world did not settle",
  );
  const geometry = await stageGeometry(page, box);
  assert.equal(geometry.displayMode, displayMode);
  assert.equal(snapshot.currentPoi, fixture.town);
  for (let index = 0; index < 160 && (
    snapshot.chrome.heroXp.expanded || snapshot.chrome.heroXp.moving
  ); index += 1) {
    await advance(25);
    snapshot = await state();
  }

  // Outdoor MasterMenu owns the view-only book.
  await clickLabel("worldMenuButton");
  await waitForState((value) => value.menu?.config === "MasterMenu", "MasterMenu did not open");
  await clickLabel("worldMenu:monsterpedia");
  snapshot = await finishMonsterpediaOpenFade(
    "world-menu-monsterpedia",
    "outdoor Monsterpedia",
  );
  assert.equal(snapshot.overlay.editable, false);
  assert.equal(snapshot.overlay.category, 0);
  snapshot = await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 1 &&
      value.overlay.popups.stack[0].buttons.length === 1,
    "FirstMonsterpedia tutorial did not appear after entry",
  );
  assert(
    (await visibleTexts()).some((text) => text.includes("The Monsterpedia shows all the monsters")),
    "FirstMonsterpedia tutorial body is absent",
  );
  await closePopup();




  await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 0 &&
      !value.overlay.busy &&
      !value.overlay.transitionLocked &&
      value.overlay.stroke?.enabled === true &&
      value.overlay.stroke.activePointerId === null,
    "Monsterpedia did not become interactive after its first-use tutorial",
  );
  const tabGeometry = await page.evaluate(() => {
    const result = [];
    const visit = (node) => {
      if (node.label?.startsWith("monsterpediaTabIcon:")) {
        const tab = node.parent;
        const iconBounds = node.getBounds();
        const tabBounds = tab.getBounds();
        result.push({
          label: node.label,
          iconW: iconBounds.width,
          iconH: iconBounds.height,
          textureW: node.texture.width,
          textureH: node.texture.height,
          iconCenter: {
            x: iconBounds.x + iconBounds.width / 2,
            y: iconBounds.y + iconBounds.height / 2,
          },
          tabCenter: {
            x: tabBounds.x + tabBounds.width / 2,
            y: tabBounds.y + tabBounds.height / 2,
          },
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(globalThis.__PIXI_APP__.stage);
    return result;
  });
  assert.equal(tabGeometry.length, 7, `missing tab icon geometry: ${JSON.stringify(tabGeometry)}`);
  for (const item of tabGeometry) {
    // getBounds() is canvas-global and therefore includes FixedStage's responsive letterbox fit.
    // The old equality only held accidentally at scale=1 (1024x768 for iPad); this scenario's
    // 1280x800 viewport has geometry.scale=800/768. pointSprite's HD fold and the x2 point mount
    // still cancel exactly before that final viewport scale.
    assert(
      Math.abs(item.iconW - item.textureW * geometry.scale) < 0.01,
      `${item.label} width normalized twice: ${JSON.stringify(item)}`,
    );
    assert(
      Math.abs(item.iconH - item.textureH * geometry.scale) < 0.01,
      `${item.label} height normalized twice: ${JSON.stringify(item)}`,
    );
    assert(
      Math.abs(item.iconCenter.x - item.tabCenter.x) < 0.01,
      `${item.label} x is off-center: ${JSON.stringify(item)}`,
    );
    assert(
      Math.abs(item.iconCenter.y - item.tabCenter.y) < 0.01,
      `${item.label} y is off-center: ${JSON.stringify(item)}`,
    );
  }

  // A source-valid short stroke beginning on an interactive card must change exactly one page:
  // the child pointertap must not also open Living Info/expanded chain after recognition. Exercise
  // this on Spirits, whose shipped category is multi-page regardless of the fixture's deliberately
  // sparse capture history. A one-page My Monsters category source-faithfully rolls into Spirits
  // instead of producing page 1, so coupling the arbitration proof to it made the test data decide
  // which navigation branch was under test.
  await clickLabel("monsterpediaTab:1");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.category === 1 &&
      value.overlay.page === 0 &&
      value.overlay.pageCount > 1 &&
      !value.overlay.transitionLocked &&
      !value.overlay.busy &&
      value.overlay.stroke?.enabled === true,
    "Spirits category did not become interactive for card-origin swipe proof",
  );
  const swipeCardType = snapshot.overlay.cards?.[0]?.shortType;
  assert(swipeCardType, `Spirits page has no swipe card: ${JSON.stringify(snapshot.overlay)}`);
  const swipeCard = await targetForLabel(`monsterpediaCard:${swipeCardType}`);
  assert(
    swipeCard,
    `card ${swipeCardType} is unavailable for child-arbitration swipe: ` +
      `overlay=${JSON.stringify((await state()).overlay)} ` +
      `visibleCards=${JSON.stringify(await page.evaluate(() => {
        const labels = [];
        const visit = (node, shown = true) => {
          const visible = shown && node.visible !== false && node.renderable !== false;
          if (visible && node.label?.startsWith("monsterpediaCard:")) labels.push(node.label);
          for (const child of node.children ?? []) visit(child, visible);
        };
        visit(window.__PIXI_APP__.stage);
        return labels;
      }))}`,
  );
  // Author a 60-point source-space stroke. The former ±30 CANVAS-pixel endpoints become only
  // 28.8 points in this iPad/1280x800 fit; three browser samples then sit on float thirds and the
  // source-rounded resampler legitimately spells 6454. Convert points through the x2 mount and
  // live letterbox scale so samples stay well clear of those boundaries.
  const swipeHalfSpanPx = 30 * 2 * geometry.scale;
  const swipeStart = {
    x: box.x + (swipeCard.x + swipeHalfSpanPx) * rendererToCss.x,
    y: box.y + swipeCard.y * rendererToCss.y,
  };
  const swipeEnd = {
    x: box.x + (swipeCard.x - swipeHalfSpanPx) * rendererToCss.x,
    y: swipeStart.y,
  };
  await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    let root;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "monsterpedia:viewOnly") { root = node; break; }
      if (node?.children) stack.push(...node.children);
    }
    if (!root) throw new Error("view-only Monsterpedia root is missing before swipe");
    window.__DIB_MONSTERPEDIA_SWIPE_TRACE__ = [];
    for (const type of ["pointerdown", "globalpointermove", "pointerup", "pointerupoutside", "pointertap"]) {
      root.on(type, (event) => {
        const point = event.getLocalPosition(root);
        window.__DIB_MONSTERPEDIA_SWIPE_TRACE__.push({ type, pointerId: event.pointerId, x: point.x, y: point.y });
      });
    }
  });
  await page.mouse.move(swipeStart.x, swipeStart.y);
  await page.mouse.down();
  const strokeAtDown = (await state()).overlay?.stroke;
  assert.equal(
    strokeAtDown?.activePointerId,
    1,
    `Monsterpedia recognizer did not claim the card-origin pointerdown: ${JSON.stringify(strokeAtDown)}`,
  );
  // Five 12pt intervals visit each third's interior; three 20pt intervals sit on the exact
  // boundaries and source rounding can skip the middle digit (64/46).
  await page.mouse.move(swipeEnd.x, swipeEnd.y, { steps: 5 });
  await page.mouse.up();
  await advance(25);
  const swipeOutcome = await state();
  assert.equal(
    swipeOutcome.overlay?.expanded,
    false,
    `card-origin stroke opened its child instead of paging: ` +
      JSON.stringify({
        stroke: swipeOutcome.overlay?.stroke,
        events: await page.evaluate(() => window.__DIB_MONSTERPEDIA_SWIPE_TRACE__),
      }),
  );
  snapshot = await waitForState(
    (value) =>
      value.overlay?.page === 1 &&
      !value.overlay.transitionLocked &&
      !value.overlay.busy &&
      value.overlay.stroke?.enabled === true,
    "short card-origin swipe did not advance exactly one page",
  );
  assert.equal(snapshot.overlay.expanded, false, "recognized swipe also opened its child card");
  assert.equal(snapshot.overlay.popups.depth, 0, "recognized swipe also opened a child popup");



  const reverseCardType = snapshot.overlay.cards?.[0]?.shortType;
  assert(reverseCardType, `page 1 has no reverse-swipe card: ${JSON.stringify(snapshot.overlay)}`);
  const reverseCard = await targetForLabel(`monsterpediaCard:${reverseCardType}`);
  assert(reverseCard, `page-1 reverse-swipe card ${reverseCardType} is not hittable`);
  const reverseStart = {
    x: box.x + (reverseCard.x - swipeHalfSpanPx) * rendererToCss.x,
    y: box.y + reverseCard.y * rendererToCss.y,
  };
  const reverseEnd = {
    x: box.x + (reverseCard.x + swipeHalfSpanPx) * rendererToCss.x,
    y: reverseStart.y,
  };
  await page.evaluate(() => { window.__DIB_MONSTERPEDIA_SWIPE_TRACE__ = []; });
  await page.mouse.move(reverseStart.x, reverseStart.y);
  await page.mouse.down();
  const reverseStrokeAtDown = (await state()).overlay?.stroke;
  assert.equal(
    reverseStrokeAtDown?.activePointerId,
    1,
    `Monsterpedia recognizer did not claim the reverse pointerdown: ${JSON.stringify(reverseStrokeAtDown)}`,
  );
  await page.mouse.move(reverseEnd.x, reverseEnd.y, { steps: 5 });
  await page.mouse.up();
  await advance(25);
  const reverseOutcome = await state();
  assert.equal(
    reverseOutcome.overlay?.page,
    0,
    `reverse card-origin stroke was not recognized: ` +
      JSON.stringify(await page.evaluate(() => window.__DIB_MONSTERPEDIA_SWIPE_TRACE__)),
  );
  snapshot = await waitForState(
    (value) =>
      value.overlay?.page === 0 &&
      !value.overlay.transitionLocked &&
      !value.overlay.busy &&
      value.overlay.stroke?.enabled === true,
    "reverse short swipe did not restore the original page",
  );
  await clickLabel("monsterpediaTab:0");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.category === 0 &&
      value.overlay.page === 0 &&
      !value.overlay.transitionLocked &&
      !value.overlay.busy &&
      value.overlay.stroke?.enabled === true,
    "My Monsters did not settle after the swipe arbitration proof",
  );
  await captureFrame("00-outdoor-book.png");

  // My Monsters renders the deepest discovered member of each chain. The fixture registers
  // FlameWing/Pyrecrest, so that discovered leaf -- not its Bitewing/Emberling root -- is the
  // page card. Expanding it places the selected leaf on top and its known predecessor below. Card movement
  // and the independent help delay both begin immediately: help stays hidden for 0.5s, then fades
  // for 0.5s. The selected clone is above the successor, the bare leave icon remains 54x50
  // points, and exit takes another 0.5s without rebuilding the retained page.
  const expansionPageSerial = snapshot.overlay.pageBuildSerial;
  await clickLabel(`monsterpediaCard:${fixture.firstSuccessor}`);
  snapshot = await waitForState(
    (value) =>
      value.overlay?.expanded &&
      value.overlay.expandedCards?.length === (fixture.nextSuccessor === undefined ? 2 : 3) &&
      value.overlay.expandedHelpAlphas?.length === 5,
    "known evolution root did not mount its exact clone/help set",
  );
  assert.equal(snapshot.overlay.pageBuildSerial, expansionPageSerial);
  await advance(400);
  snapshot = await state();
  assert(
    snapshot.overlay.expandedHelpAlphas.every((alpha) => Math.abs(alpha) < 0.001),
    `help appeared before the 0.5-second delay: ${snapshot.overlay.expandedHelpAlphas}`,
  );
  await advance(300);
  snapshot = await state();
  assert(
    snapshot.overlay.expandedHelpAlphas.every((alpha) => alpha > 0.25 && alpha < 0.75),
    `help did not partially fade after its independent delay: ` +
      `${snapshot.overlay.expandedHelpAlphas}`,
  );
  await advance(350);
  snapshot = await state();
  assert(
    snapshot.overlay.expandedHelpAlphas.every((alpha) => Math.abs(alpha - 1) < 0.001),
    `help did not finish its 0.5-second fade: ${snapshot.overlay.expandedHelpAlphas}`,
  );
  const selectedExpansionCard = snapshot.overlay.expandedCards.find(
    (card) => card.shortType === fixture.firstSuccessor,
  );
  assert.deepEqual(
    selectedExpansionCard,
    displayMode === "ipad"
      ? { shortType: fixture.firstSuccessor, known: true, x: 196, y: 10, zIndex: 2 }
      : { shortType: fixture.firstSuccessor, known: true, x: 180, y: 5, zIndex: 2 },
  );
  const predecessorExpansionCard = snapshot.overlay.expandedCards.find(
    (card) => card.shortType === fixture.ingredients[0],
  );
  assert.deepEqual(
    predecessorExpansionCard,
    displayMode === "ipad"
      ? {
          shortType: fixture.ingredients[0],
          known: true,
          x: 32,
          y: 224,
          zIndex: 1,
        }
      : {
          shortType: fixture.ingredients[0],
          known: true,
          x: 70 / 3,
          y: 165,
          zIndex: 1,
        },
  );
  if (fixture.nextSuccessor !== undefined) {
    assert.deepEqual(
      snapshot.overlay.expandedCards.find((card) => card.shortType === fixture.nextSuccessor),
      displayMode === "ipad"
        ? {
            shortType: fixture.nextSuccessor,
            known: false,
            x: 360,
            y: 224,
            zIndex: 1,
          }
        : {
            shortType: fixture.nextSuccessor,
            known: false,
            x: 1010 / 3,
            y: 165,
            zIndex: 1,
          },
    );
  }
  const expandedClose = await page.evaluate(() => {
    const root = globalThis.__PIXI_APP__?.stage;
    let close = null;
    const visit = (node) => {
      if (node.label === "monsterpediaExpandedClose") {
        close = {
          x: node.position.x,
          y: node.position.y,
          w: node.width,
          h: node.height,
        };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return close;
  });
  assert.deepEqual(expandedClose, { x: 20, y: 20, w: 54, h: 50 });
  await captureFrame("00b-expanded-chain.png");
  await clickLabel("monsterpediaExpandedClose");
  await advance(550);
  await waitForState(
    (value) => value.overlay?.expanded === false && !value.overlay.transitionLocked,
    "expanded chain did not animate closed without rebuilding",
  );
  assert.equal((await state()).overlay.pageBuildSerial, expansionPageSerial);

  // The leave control exists immediately. Closing during the help delay must fade from each
  // node's current opacity; it must not flash still-hidden help to full opacity on the way out.
  await clickLabel(`monsterpediaCard:${fixture.firstSuccessor}`);
  snapshot = await waitForState(
    (value) =>
      value.overlay?.expandedCards?.length === (fixture.nextSuccessor === undefined ? 2 : 3) &&
      value.overlay?.expandedHelpAlphas?.length === 5,
    "early-exit expansion did not mount",
  );
  await advance(100);
  snapshot = await state();
  assert(snapshot.overlay.expandedHelpAlphas.every((alpha) => Math.abs(alpha) < 0.001));
  await clickLabel("monsterpediaExpandedClose");
  await advance(250);
  snapshot = await state();
  assert(
    snapshot.overlay.expandedHelpAlphas.every((alpha) => Math.abs(alpha) < 0.001),
    `hidden help flashed during early expansion exit: ${snapshot.overlay.expandedHelpAlphas}`,
  );
  await advance(300);
  await waitForState(
    (value) => value.overlay?.expanded === false,
    "early expansion exit did not finish",
  );
  assert.equal((await state()).overlay.pageBuildSerial, expansionPageSerial);

  // Complete List arrows move by the source idiom's full label window. Native Cancel constructs
  // a fresh editable category-0/index-0 book even when Complete List was entered outdoors.
  await clickLabel("monsterpediaTab:5");
  await waitForState(
    (value) => value.overlay?.screen === "monsterpediaAll" && value.overlay.transitionLocked,
    "Complete List transition did not lock input",
  );
  await advance(250);
  snapshot = await waitForState(
    (value) => value.overlay?.screen === "monsterpediaAll" &&
      value.overlay.popups.depth === 1,
    "FirstAllMonsterpedia tutorial did not appear after its page transition",
  );
  assert(
    (await visibleTexts()).some((text) => text.includes("This list shows every monster")),
    "FirstAllMonsterpedia tutorial body is absent",
  );
  await closePopup();
  snapshot = await waitForState(
    (value) => value.overlay?.screen === "monsterpediaAll" && !value.overlay.transitionLocked,
    "Complete List did not unlock",
  );
  assert.equal(snapshot.notifications.namePlate.visible, true);
  assert.equal(snapshot.notifications.namePlate.text, "Complete List");
  assert.equal(snapshot.overlay.completeList.selectedIndex, 0);
  assert.equal(
    await page.evaluate(() => {
      const labels = [];
      const visit = (node) => {
        if (node.label?.startsWith("monsterpediaAll:label:")) labels.push(node);
        for (const child of node.children ?? []) visit(child);
      };
      visit(globalThis.__PIXI_APP__.stage);
      return labels.length > 0 && labels.every((label) => label.hitArea == null);
    }),
    true,
    "Complete List widened a native label-bound touch to the whole grid cell",
  );
  const completeListPageCount = snapshot.overlay.pageCount;
  await clickLabel("monsterpediaAll:next");
  const completeListCapacity = displayMode === "ipad" ? 45 : 22;
  if (completeListPageCount > 1) {
    snapshot = await waitForState(
      (value) =>
        value.overlay?.completeList?.selectedIndex === completeListCapacity &&
        value.overlay?.completeList?.windowStart === completeListCapacity &&
        !value.overlay.busy,
      "Complete List next arrow did not advance one source page window",
    );
    assert.equal(snapshot.overlay.completeList.windowStart, completeListCapacity);
  } else {
    await advance(250);
    snapshot = await state();
    assert.equal(snapshot.overlay.completeList.selectedIndex, 0);
    assert.equal(snapshot.overlay.completeList.windowStart, 0);
    assert.equal(snapshot.overlay.busy, false);
  }
  // The director-owned category plaque legitimately crosses over this bottom-right source stack
  // during its four-second lifetime. Let that independent notification finish before capturing
  // the layout evidence so all three summary lines remain inspectable.
  await advance(4250);
  snapshot = await state();
  assert.equal(snapshot.notifications.namePlate.visible, false);
  await captureFrame("01-complete-list.png");
  const completeSummaryBounds = await page.evaluate(() => {
    let summary;
    let monsterpedia;
    const visit = (node) => {
      if (node.label === "monsterpediaAll:summary") summary = node;
      if (node.label?.startsWith("monsterpedia:")) monsterpedia = node;
      for (const child of node.children ?? []) visit(child);
    };
    visit(globalThis.__PIXI_APP__.stage);
    if (!summary || !monsterpedia) return null;
    const bounds = summary.getBounds();
    const topLeft = monsterpedia.toLocal({ x: bounds.x, y: bounds.y });
    const bottomRight = monsterpedia.toLocal({
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    });
    return { topLeft, bottomRight };
  });
  assert(completeSummaryBounds, "Complete List summary is missing");
  assert(
    completeSummaryBounds.topLeft.x >= 0 &&
      completeSummaryBounds.topLeft.y >= 0 &&
      completeSummaryBounds.bottomRight.x <= snapshot.screenPt.w &&
      completeSummaryBounds.bottomRight.y <= snapshot.screenPt.h,
    `Complete List summary escaped the viewport: ${JSON.stringify(completeSummaryBounds)}`,
  );
  await clickLabel("monsterpediaAll:cancel");
  await waitForState(
    (value) => value.overlay?.category === 0 && value.overlay.transitionLocked,
    "Complete List Cancel did not create category 0",
  );
  await advance(250);
  await waitForState(
    (value) => value.overlay?.category === 0 && !value.overlay.transitionLocked,
    "reset book did not unlock",
  );
  snapshot = await state();
  assert.equal(snapshot.overlay.editable, true);
  assert.equal(snapshot.notifications.namePlate.visible, true);
  assert.equal(snapshot.notifications.namePlate.text, "My Monsters");
  await closeMonsterpediaThroughFade(
    "world-menu-monsterpedia-return",
    "editable reset book",
  );
  await clickLabel("worldMenuButton");
  await waitForState((value) => value.menu?.config === "MasterMenu", "MasterMenu did not reopen");
  await clickLabel("worldMenu:monsterpedia");
  snapshot = await finishMonsterpediaOpenFade(
    "world-menu-monsterpedia",
    "outdoor view-only Monsterpedia reopen",
  );
  assert.equal(snapshot.overlay.editable, false);

  // The source 0.2-second page interval gates every tab while active.
  // Cache the category-1 hit point before starting the turn. During the lock the source-faithful
  // transition replaces the live book and tabs with captured textures, so there is deliberately
  // no labelled tab node to rediscover until the turn commits.
  const lockedTabTarget = await targetForLabel("monsterpediaTab:1");
  assert(lockedTabTarget, "category-1 tab is missing before the page-turn lock");
  await clickLabel("monsterpediaTab:2");
  await waitForState(
    (value) => value.overlay?.category === 2 && value.overlay.transitionLocked,
    "Combine category did not enter its input lock",
  );
  await page.mouse.click(
    box.x + lockedTabTarget.x * rendererToCss.x,
    box.y + lockedTabTarget.y * rendererToCss.y,
  );
  await advance(100);
  assert.equal((await state()).overlay.category, 2, "input escaped the 0.2-second page lock");
  await advance(150);
  snapshot = await waitForState(
    (value) => value.overlay?.category === 2 && !value.overlay.transitionLocked,
    "Combine category did not unlock",
  );
  assert(
    snapshot.overlay.cards.some(
      (card) =>
        card.shortType === fixture.result &&
        card.recipeKnown &&
        !card.known,
    ),
    "learned recipe incorrectly revealed or failed to unlock the result card",
  );
  const recipeDebug = snapshot.overlay.cards.find((card) => card.shortType === fixture.result);
  assert.deepEqual(
    recipeDebug?.ingredientTints,
    [0xffffff, 0x000000],
    `history/current separation did not render color+black ingredients: ${JSON.stringify(recipeDebug)}`,
  );
  assert.equal(
    snapshot.overlay.ingredientAlphas.length,
    2,
    "both currently owned ingredients must pulse independently of history tint",
  );

  // The same learned recipe is visible outdoors, but Make must stop at the town-only guard.
  await openRecipeCard();
  await chooseMake();
  snapshot = await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 1 &&
      value.overlay.popups.stack[0].buttons.length === 1,
    "outdoor Make did not produce its town-only popup",
  );
  assert.equal(snapshot.overlay.editable, false);
  assert(
    (await visibleTexts()).includes("You can only combine monsters in town."),
    "outdoor recipe did not show OnlyMakeMonstersInTown",
  );
  await closePopup();
  await closeMonsterpediaThroughFade(
    "world-menu-monsterpedia-return",
    "outdoor Monsterpedia",
  );

  // Enter the current town, allow global notifications to clear, then use the building-owned book.
  snapshot = await state();
  const currentPoi = snapshot.pois.find((poi) => poi.name === snapshot.currentPoi);
  assert(currentPoi, `missing current POI ${snapshot.currentPoi}`);
  const poiPoint = geometry.toCss(currentPoi.position);
  await page.mouse.click(poiPoint.x, poiPoint.y);
  await waitForState((value) => value.mode === "town", "town did not open");
  await advance(5200);
  snapshot = await state();
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    // GuildQuestChat gates successive pages on its source interval; a burst of taps in the same
    // deterministic frame is intentionally ignored.
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  snapshot = await waitForState(
    (value) => value.mode === "town" && !value.locked && value.overlay?.kind !== "townEnterChat",
    "town controls did not unlock",
  );
  const monsterpediaBuilding = snapshot.town.buildings.find(
    (building) => building.className === "MonsterpediaMenuItem",
  );
  assert(monsterpediaBuilding?.enabled, "town Monsterpedia building is not enabled");
  await clickLabel(`town:${fixture.town}:menu:MonsterpediaMenuItem`);
  snapshot = await finishMonsterpediaOpenFade(
    "town-building-monsterpedia",
    "town Monsterpedia building",
  );
  assert.equal(snapshot.overlay.editable, true);
  await clickLabel("monsterpediaTab:2");
  await advance(250);
  snapshot = await waitForState(
    (value) => value.overlay?.category === 2 && !value.overlay.transitionLocked,
    "town Combine category did not settle",
  );
  const pickerCancelPageSerial = snapshot.overlay.pageBuildSerial;

  const prePickerState = await state();
  const partyBefore = prePickerState.party.map((member) => ({
    instanceId: member.instanceId,
    shortType: member.shortType,
  }));
  const inspectedHpBefore = prePickerState.party[0].currentHp;
  const heroBefore = prePickerState.chrome.heroXp.totalHighestLevels;

  // Cancel from style 2 is a true abort: no ingredient is consumed and the same book returns.
  await openRecipeCard();
  await chooseMake();
  snapshot = await waitForState(
    (value) => value.overlay?.pickerOpen && value.overlay.picker?.style === 2,
    "first concrete ingredient picker did not open",
  );
  assert.equal(snapshot.overlay.picker.showingId, "demo-party-1");
  assert(snapshot.overlay.picker.selectCenter, "style-2 picker has no Select control");
  await clickLabel("managementCard:demo-party-1");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.inspection?.kind === "partyInstance" &&
      value.overlay.inspection.instanceId === "demo-party-1" &&
      value.overlay.popups.depth === 1,
    "picker Living Info discarded the concrete party instance",
  );
  assert.equal(snapshot.overlay.inspection.xpThisLevel, 17);
  // Entering Corova source-heals the party before any building opens. The picker must preserve
  // that live concrete instance value; expecting the pre-town fixture's 1 HP was stale.
  assert.equal(snapshot.overlay.inspection.hp, inspectedHpBefore);
  assert.equal(snapshot.overlay.inspection.soulStoneCount, 1);
  assert(
    snapshot.overlay.inspection.evolveRows.some(
      (row) => row.shortType === fixture.ingredients[0],
    ),
    // Living Info rows name the CURRENT stage and show its evolve level; discovery of the next
    // stage is the gate that reveals that row. Expecting the successor's name inverted the source
    // projection even though the correct Bitewing/Emberling row was on screen.
    `picker Living Info omitted the current-stage row unlocked by its discovered successor: ` +
      `${JSON.stringify(snapshot.overlay.inspection.evolveRows)}`,
  );
  await closePopup();
  await captureFrame("02-ingredient-picker.png");
  await clickLabel("monsterManagement:cancel");
  await advance(250);
  snapshot = await waitForState(
    (value) =>
      value.overlay?.screen === "monsterpedia" &&
      !value.overlay.pickerOpen &&
      !value.overlay.transitionLocked,
    "picker Cancel did not restore the book",
  );
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    partyBefore,
    "picker Cancel mutated the party",
  );
  assert.equal(
    snapshot.overlay.pageBuildSerial,
    pickerCancelPageSerial,
    "picker Cancel rebuilt the retained book",
  );

  // Select both ordered concrete identities. The transaction appends level 1, consumes slot 1
  // then slot 2, registers Monsterpedia/hero XP once, and returns to the same category.
  await openRecipeCard();
  await chooseMake();
  snapshot = await waitForState(
    (value) => value.overlay?.picker?.showingId === "demo-party-1",
    "retry did not reopen ingredient slot 1",
  );
  await clickLabel("monsterManagement:select");
  snapshot = await waitForState(
    (value) => value.overlay?.picker?.showingId === "demo-party-2",
    "slot 1 selection did not advance to slot 2",
  );
  await clickLabel("monsterManagement:select");
  await advance(250);
  snapshot = await waitForState(
    (value) =>
      value.overlay?.screen === "monsterpedia" &&
      value.overlay.category === 2 &&
      !value.overlay.pickerOpen &&
      !value.overlay.busy &&
      !value.overlay.transitionLocked &&
      value.party.some((member) => member.shortType === fixture.result),
    "combination did not return to the live book",
  );
  assert.equal(snapshot.party.length, partyBefore.length - 1);
  assert(!snapshot.party.some((member) => member.instanceId === "demo-party-1"));
  assert(!snapshot.party.some((member) => member.instanceId === "demo-party-2"));
  const created = snapshot.party.filter((member) => member.shortType === fixture.result);
  assert.equal(created.length, 1);
  assert.equal(created[0].level, 1);
  assert.equal(snapshot.chrome.heroXp.totalHighestLevels, heroBefore + 1);
  assert.equal(snapshot.overlay.popups.depth, 0, "source merge invented a success popup");
  const combinedResultCard = snapshot.overlay.cards.find(
    (card) => card.shortType === fixture.result,
  );
  assert(
    snapshot.overlay.cards.some(
      (card) =>
        card.shortType === fixture.result &&
        card.known &&
        card.recipeKnown &&
        card.highestLevel === 1,
    ),
    `result registration did not refresh the recipe card: ` +
      `${JSON.stringify(combinedResultCard)} in ${JSON.stringify(snapshot.overlay.cards)}`,
  );
  await captureFrame("03-combined-book.png");
  await closeMonsterpediaThroughFade(
    "town-building-monsterpedia-return",
    "town Monsterpedia",
  );

  // Town General Menu propagates editable=YES into MonsterManagementMenuItem -> style 0.
  await clickLabel(`town:${fixture.town}:menuButton`);
  snapshot = await waitForState(
    (value) => value.menu?.config === "MasterMenu" && value.menu.editable === true,
    "town editable MasterMenu did not open",
  );
  await clickLabel("worldMenu:monsters");
  snapshot = await waitForState(
    (value) => value.overlay?.screen === "partyEditor",
    "town General Menu Monsters did not open",
  );
  assert.equal(snapshot.overlay.style, 0, "town General Menu failed to propagate editable style 0");
  // The fixture has not claimed the first editable Monster Management tutorial. Let its two
  // source pages finish before closing the retained editor; otherwise the tutorial correctly
  // remains modal above town and the following menu tap is ignored.
  snapshot = await waitForState(
    (value) => value.tutorial?.key === "Tutorial4" && value.tutorial.okReady === true,
    "Tutorial4 did not open above the editable party editor",
  );
  for (let pageIndex = 0; snapshot.tutorial?.key === "Tutorial4" && pageIndex < 3; pageIndex++) {
    snapshot = await waitForState(
      (value) => value.tutorial?.key === "Tutorial4" && value.tutorial.okReady === true,
      "Tutorial4 page did not become dismissible",
    );
    const priorPage = snapshot.tutorial.page;
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.tutorial === undefined || value.tutorial.page !== priorPage,
      "Tutorial4 did not advance",
    );
  }
  assert.equal(snapshot.tutorial, undefined, "Tutorial4 did not return to the retained party editor");
  await clickLabel("partyEditorClose");
  await waitForState((value) => value.overlay === null, "style-0 editor did not close");

  await clickLabel(`town:${fixture.town}:menuButton`);
  await waitForState(
    (value) => value.menu?.config === "MasterMenu" && value.menu.editable === true,
    "town editable MasterMenu did not reopen",
  );
  await clickLabel("worldMenu:monsterpedia");
  snapshot = await finishMonsterpediaOpenFade(
    "town-menu-monsterpedia",
    "town General Menu Monsterpedia",
  );
  assert.equal(snapshot.overlay.editable, true);
  assert(snapshot.party.some((member) => member.shortType === fixture.result));
  await closeMonsterpediaThroughFade(
    "town-menu-monsterpedia-return",
    "town General Menu Monsterpedia",
  );

  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(
    `monsterpedia: PASS (${variant}, ${displayMode}; ownership, lock, Complete List, ` +
      `scene fades, picker cancel/select, atomic combine, live hero/book refresh)`,
  );
} catch (error) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.at(-1);
  if (page) {
    const captureFailure = await createFrameCapture(page, outputDir);
    await captureFailure("failure.png").catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
