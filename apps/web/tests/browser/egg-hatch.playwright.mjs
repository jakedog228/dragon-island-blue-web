// Opt-in Silver/Gold destroy-on-pickup hatch choreography. It uses real pointer input, the
// deterministic port clock, and a caller-selected local content package. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_EGG_DISPLAY_MODE ?? "ipad";
if (displayMode !== "iphone" && displayMode !== "ipad") {
  throw new Error(`DIB_EGG_DISPLAY_MODE must be iphone or ipad; got ${displayMode}`);
}
const requestedKind = process.env.DIB_EGG_KIND;
if (requestedKind !== undefined && requestedKind !== "silver" && requestedKind !== "gold") {
  throw new Error(`DIB_EGG_KIND must be silver or gold; got ${requestedKind}`);
}
const kinds = requestedKind === undefined ? ["silver", "gold"] : [requestedKind];
const repeatPicks = process.env.DIB_EGG_REPEAT_PICKS === undefined
  ? undefined
  : Number(process.env.DIB_EGG_REPEAT_PICKS);
if (repeatPicks !== undefined && (!Number.isSafeInteger(repeatPicks) || repeatPicks < 1)) {
  throw new Error(`DIB_EGG_REPEAT_PICKS must be a positive integer; got ${process.env.DIB_EGG_REPEAT_PICKS}`);
}
if (repeatPicks !== undefined && kinds.some((kind) => kind !== "silver")) {
  throw new Error("Clone Egg browser proof uses the Silver reel; set DIB_EGG_KIND=silver");
}
const outputDir = process.env.DIB_EGG_OUTPUT
  ? path.resolve(process.env.DIB_EGG_OUTPUT)
  : path.resolve(import.meta.dirname, `../../../../output/egg-hatch-${displayMode}`);
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const capture = async (name) => {
    const png = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL("image/png"));
    fs.writeFileSync(path.join(outputDir, name), Buffer.from(png.split(",", 2)[1], "base64"));
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript((requestedDisplayMode) => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: requestedDisplayMode,
      textResolutionMode: "modern",
      sound: 0.25,
      music: 0.5,
    }));
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 0x454747;
    // Feed To's style-2 CFlow proof selects and inspects a side card, so the fixture must own
    // multiple concrete party members. Source new-game startup now correctly creates only its one
    // chosen starter and no longer happens to satisfy this scenario requirement.
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 3,
      battingOrderSize: 3,
      levelRange: [20, 20],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 20,
      monsterPartyLevels: [20, 20, 20],
      silver: 2_000,
      gold: 1_000,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      highestCapturedLevels: {},
    };
  }, displayMode);
  await page.goto(url);
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((delta) => window.advanceTime(delta), ms);
  const waitFor = async (predicate, description, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state();
      if (await predicate(snapshot)) return snapshot;
      await advance(25);
      await page.waitForTimeout(1);
    }
    throw new Error(
      `${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`,
    );
  };
  const boundsForLabel = (label) => page.evaluate((wanted) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && visible(node)) {
        const bounds = node.getBounds();
        return { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, label);
  const hitPathAt = ({ x, y }) => page.evaluate((point) => {
    const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(point.x, point.y);
    const path = [];
    for (let current = hit; current; current = current.parent) path.push(current.label ?? null);
    return path;
  }, { x, y });
  const gemPresentation = () => page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    const glows = [];
    let gems = 0;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "eggHatch:provider:gem") {
        gems += 1;
        const glow = node.children.find((child) => child.label === "eggHatch:provider:gemGlow");
        if (glow !== undefined) {
          const base = node.children.find((child) => child !== glow);
          glows.push({
            alpha: glow.alpha,
            composition: {
              sortableChildren: node.sortableChildren,
              boundsArea: node.boundsArea && {
                x: node.boundsArea.x, y: node.boundsArea.y,
                width: node.boundsArea.width, height: node.boundsArea.height,
              },
              base: {
                width: base?.width, height: base?.height,
                anchor: base && { x: base.anchor.x, y: base.anchor.y },
                position: base && { x: base.position.x, y: base.position.y },
                zIndex: base?.zIndex,
              },
              glow: {
                width: glow.width, height: glow.height,
                anchor: { x: glow.anchor.x, y: glow.anchor.y },
                position: { x: glow.position.x, y: glow.position.y },
                tint: glow.tint, zIndex: glow.zIndex, blendMode: glow.blendMode,
              },
            },
            exactComposition: base !== undefined &&
              node.sortableChildren === true &&
              node.boundsArea?.x === 0 &&
              node.boundsArea?.y === 0 &&
              node.boundsArea?.width === base.width &&
              node.boundsArea?.height === base.height &&
              base.anchor.x === 0.5 && base.anchor.y === 0.5 &&
              glow.anchor.x === 0.5 && glow.anchor.y === 0.5 &&
              base.position.x === base.width / 2 &&
              base.position.y === base.height / 2 &&
              glow.position.x === base.position.x &&
              glow.position.y === base.position.y &&
              glow.width > base.width && glow.height > base.height &&
              glow.tint === 0x3ff1ff &&
              glow.zIndex === -1 && base.zIndex === 0 &&
              glow.blendMode === "normal",
          });
        }
      }
      if (node?.children) stack.push(...node.children);
    }
    return { gems, glows };
  });
  const sourceGemGlowAlpha = (elapsedMs) => {
    const phaseMs = elapsedMs % 2_000;
    const opacity = phaseMs <= 1_000
      ? 255 - 105 * phaseMs / 1_000
      : 150 + 105 * (phaseMs - 1_000) / 1_000;
    return opacity / 255;
  };
  const clickLabel = async (label) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing Pixi node ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    await page.mouse.click(
      canvas.x + bounds.x + bounds.w / 2,
      canvas.y + bounds.y + bounds.h / 2,
    );
  };
  // Row taps are routed by the menu container that owns them (rows are `eventMode: "none"`),
  // so emitting on the row node itself reaches no listener at all.
  const invokeLabel = (label) => tapPixiLabel(page, label);
  const emitManagementPointer = (point, style = 2) => page.evaluate(({ localPoint, style }) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === `monsterManagement:style${style}`) {
        const global = node.toGlobal(localPoint);
        const event = {
          pointerId: 919,
          global,
          getLocalPosition: () => localPoint,
          stopPropagation() {},
        };
        node.emit("pointerdown", event);
        node.emit("pointerup", event);
        return;
      }
      if (node?.children) stack.push(...node.children);
    }
    throw new Error(`missing mounted style-${style} MonsterManagementNode`);
  }, { localPoint: point, style });

  let snapshot = await waitFor(
    (value) => value.startup?.phase === "title",
    "startup title did not become interactive",
  );
  await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) =>
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" ||
      value.mode === "town",
    "startup did not begin the local world session",
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) => value.startup?.phase === "pick-dragon",
      "intro plot did not open the starter picker",
    );
  }
  if (snapshot.startup?.phase === "pick-dragon") {
    await page.keyboard.press("1");
  }
  snapshot = await waitFor((value) => value.mode === "town", "town did not open");
  await advance(1_000);
  snapshot = await state();
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  assert.equal(snapshot.overlay, null, "town entry presentation remained above the egg fixture");
  await advance(12_000);

  await waitFor(
    async () => await page.evaluate(() => typeof window.__DIB_TEST_SHOW_EGG_HATCH__ === "function"),
    "egg hatch browser seam was not installed",
  );

  for (const kind of kinds) {
    let initialSilverGlowAlpha;
    await page.evaluate(({ eggKind, repeatPicks }) => {
      void window.__DIB_TEST_SHOW_EGG_HATCH__(eggKind, repeatPicks);
    }, { eggKind: kind, repeatPicks });
    if (repeatPicks !== undefined) {
      await waitFor(
        async () => await boundsForLabel("popupButton:Ok") !== null,
        "Clone Egg explanation did not open",
      );
      await invokeLabel("popupButton:Ok");
      for (let pick = 0; pick < repeatPicks; pick += 1) {
        await waitFor(
          async () => page.evaluate(() => {
            const stack = [window.__PIXI_APP__.stage];
            while (stack.length > 0) {
              const node = stack.pop();
              if (node?.label === "monsterManagement:style3") {
                return node.debugState.selectCenter ?? null;
              }
              if (node?.children) stack.push(...node.children);
            }
            return null;
          }),
          `Clone Egg picker ${pick + 1} did not mount`,
        );
        const selectCenter = await page.evaluate(() => {
          const stack = [window.__PIXI_APP__.stage];
          while (stack.length > 0) {
            const node = stack.pop();
            if (node?.label === "monsterManagement:style3") {
              return node.debugState.selectCenter;
            }
            if (node?.children) stack.push(...node.children);
          }
          throw new Error("Clone Egg picker disappeared before selection");
        });
        await emitManagementPointer(selectCenter, 3);
      }
    }
    snapshot = await waitFor(
      (value) => value.overlay?.kind === kind && value.overlay?.phase === "rolling",
      `${kind} reel did not mount`,
    );
    await waitFor(
      async () => await boundsForLabel("eggHatch:background") !== null,
      `${kind} reel visuals did not mount`,
    );
    await advance(25);
    snapshot = await state();
    assert.equal(snapshot.overlay.reel.speed, 8);
    assert.equal(snapshot.overlay.reel.friction, 0);
    assert(snapshot.overlay.poolCount > 0);
    assert(
      await page.evaluate(() => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length > 0) {
          const node = stack.pop();
          if (node?.label?.startsWith("eggHatch:previewStars:")) return true;
          if (node?.children) stack.push(...node.children);
        }
        return false;
      }),
      `${kind} preview star rows are missing`,
    );
    const providerFits = await page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      const fits = [];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label?.startsWith("eggHatch:reel:")) {
          const backing = node.children[0];
          const display = node.children[1];
          if (backing && display?.boundsArea) {
            fits.push({
              label: node.label,
              actual: display.scale.x,
              expected: Math.min(1, backing.height * 0.9 / display.boundsArea.height),
            });
          }
        }
        if (node?.children) stack.push(...node.children);
      }
      return fits;
    });
    assert(providerFits.length > 0, `${kind} provider displays are missing`);
    for (const fit of providerFits) {
      assert(
        Math.abs(fit.actual - fit.expected) < 1e-9,
        `${fit.label} uses ${fit.actual}, expected source absolute height fit ${fit.expected}`,
      );
    }
    if (kind === "silver" && repeatPicks === undefined) {
      const presentation = await gemPresentation();
      assert.equal(presentation.gems, 6, "Silver Egg must mount all six source Gem providers");
      assert.equal(presentation.glows.length, 2, "only the two quality-1 Gems may glow");
      assert(
        presentation.glows.every(({ exactComposition }) => exactComposition),
        "Silver Egg glow must be a centered, oversized cyan normal-blend child behind the Gem, " +
          `while provider fit bounds remain the base Gem's size: ${JSON.stringify(presentation)}`,
      );
      const expectedAlpha = sourceGemGlowAlpha(snapshot.overlay.gemGlowElapsedMs);
      assert(
        presentation.glows.every(({ alpha }) => Math.abs(alpha - expectedAlpha) < 1e-9),
        `Silver Egg glows must begin on the source pulse (expected alpha ${expectedAlpha})`,
      );
      // Align to an OBSERVED fixed-60 update before probing a subframe. The reel may already have
      // arbitrary carry from asynchronous mount/asset ticks, so an unconditional 8ms advance can
      // legitimately cross the next boundary even though 8ms itself is below one source frame.
      let alignedToReelFrame = false;
      for (let alignmentMs = 0; alignmentMs < 20; alignmentMs++) {
        const before = snapshot.overlay.reel.elapsedSeconds;
        await advance(1);
        snapshot = await state();
        if (snapshot.overlay.reel.elapsedSeconds !== before) {
          alignedToReelFrame = true;
          break;
        }
      }
      assert(alignedToReelFrame, "Silver reel did not expose a fixed-60 frame boundary");
      const reelElapsedBeforeSubframe = snapshot.overlay.reel.elapsedSeconds;
      const glowElapsedBeforeSubframe = snapshot.overlay.gemGlowElapsedMs;
      await advance(8);
      snapshot = await state();
      assert.equal(
        snapshot.overlay.reel.elapsedSeconds,
        reelElapsedBeforeSubframe,
        "an 8ms subframe must remain below the reel's next fixed-60 update",
      );
      assert(
        Math.abs(snapshot.overlay.gemGlowElapsedMs - glowElapsedBeforeSubframe - 8) < 1e-6,
        "the independent Gem action clock must still consume the raw 8ms subframe",
      );
      const subframePresentation = await gemPresentation();
      const subframeAlpha = sourceGemGlowAlpha(snapshot.overlay.gemGlowElapsedMs);
      assert(
        subframePresentation.glows.every(({ alpha }) => Math.abs(alpha - subframeAlpha) < 1e-9),
        "Silver Egg glow opacity must update between fixed reel frames",
      );
      initialSilverGlowAlpha = subframePresentation.glows[0].alpha;
    }
    await capture(`${kind}-stars-start.png`);

    const reelBounds = await boundsForLabel("eggHatch:background");
    assert(reelBounds, "egg reel background is missing");
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    const x = canvas.x + reelBounds.x + reelBounds.w / 2;
    const y = canvas.y + reelBounds.y + reelBounds.h / 2;

    // One continuous press released before the strict 1.5-second gate must do nothing.
    await page.mouse.move(x, y);
    await page.mouse.down();
    snapshot = await state();
    assert.equal(snapshot.overlay.pressed, true, `${kind} reel did not claim pointer-down`);
    await advance(1_000);
    await capture(`${kind}-stars-falling.png`);
    if (kind === "silver" && repeatPicks === undefined) {
      snapshot = await state();
      const presentation = await gemPresentation();
      const expectedAlpha = sourceGemGlowAlpha(snapshot.overlay.gemGlowElapsedMs);
      assert(
        presentation.glows.every(({ alpha }) => Math.abs(alpha - expectedAlpha) < 1e-9),
        `Silver Egg glows must follow the source 255→150→255 pulse (expected alpha ${expectedAlpha})`,
      );
      assert(
        Math.abs(presentation.glows[0].alpha - initialSilverGlowAlpha) > 0.1,
        "Silver Egg glow must visibly pulse rather than remain at a static opacity",
      );
    }
    await page.mouse.up();
    snapshot = await state();
    assert.equal(snapshot.overlay.pressed, false, `${kind} reel did not release pointer ownership`);
    assert.equal(snapshot.overlay.reel.friction, 0);

    if (kind === "silver" && repeatPicks === undefined) {
      snapshot = await waitFor(
        (value) => value.overlay?.visibleEntries?.some(({ prize, selected }) =>
          selected && prize.kind === "gem" && prize.quality === 1),
        "Silver Egg never brought a two-stat quality-1 Gem through the aiming row",
      );
      assert(
        snapshot.overlay.visibleEntries.some(({ prize, selected }) =>
          selected && prize.kind === "gem" && prize.quality === 1),
        "the centered source aiming row must contain the glowing two-stat Gem",
      );
      const centeredGlow = await boundsForLabel("eggHatch:provider:gemGlow");
      assert(centeredGlow?.w > 0 && centeredGlow.h > 0, "centered two-stat Gem halo is not visible");
      await capture("silver-two-stat-glow-centered.png");
    }

    // The final star starts at 1.3s and its elastic shrink lasts 2.5s.
    await advance(3_000);
    await capture(`${kind}-stars-settled.png`);
    const previewGeometry = await page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      const rows = [];
      const previews = [];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label?.startsWith("eggHatch:preview:")) {
          const bounds = node.getBounds();
          previews.push({
            label: node.label,
            position: { x: node.position.x, y: node.position.y },
            scale: { x: node.scale.x, y: node.scale.y },
            bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
            boundsArea: node.boundsArea === null ? null : {
              x: node.boundsArea.x,
              y: node.boundsArea.y,
              w: node.boundsArea.width,
              h: node.boundsArea.height,
            },
          });
        }
        if (node?.label?.startsWith("eggHatch:previewStars:")) {
          const bounds = node.getBounds();
          rows.push({
            label: node.label,
            position: { x: node.position.x, y: node.position.y },
            pivot: { x: node.pivot.x, y: node.pivot.y },
            scale: { x: node.scale.x, y: node.scale.y },
            boxContentSize: { ...node.boxContentSize },
            parentContentHeight: node.parent?.boundsArea?.height ?? null,
            bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
            children: node.children.map((child) => ({
              position: { x: child.position.x, y: child.position.y },
              scale: { x: child.scale.x, y: child.scale.y },
              width: child.width,
              height: child.height,
            })),
          });
        }
        if (node?.children) stack.push(...node.children);
      }
      return { previews, rows };
    });
    fs.writeFileSync(
      path.join(outputDir, `${kind}-preview-geometry.json`),
      JSON.stringify(previewGeometry, null, 2),
    );
    const sourceRoundingScale = displayMode === "ipad" ? 2 : 1;
    for (const row of previewGeometry.rows) {
      assert.equal(row.pivot.x, 0, `${kind} ${row.label} must not have an X pivot`);
      assert.equal(row.pivot.y, 0, `${kind} ${row.label} must not have a scaled Y pivot`);
      assert.notEqual(
        row.parentContentHeight,
        null,
        `${kind} ${row.label} parent must expose authored renderer bounds`,
      );
      assert.equal(
        row.position.y,
        row.parentContentHeight + row.boxContentSize.h / 2,
        `${kind} ${row.label} must directly convert Cocos y=-boxH/2`,
      );
      let packedX = 0;
      for (let index = 1; index < row.children.length; index += 1) {
        const previous = row.children[index - 1];
        packedX += previous.width + 1;
        const current = row.children[index];
        // Box accumulates every unrounded child width and gap, then applies source roundf to each
        // emitted offset. Do not feed the preceding already-rounded position back into the sum.
        const expectedX = Math.round(packedX * sourceRoundingScale) / sourceRoundingScale;
        assert.equal(
          current.position.x,
          expectedX,
          `${kind} ${row.label} star ${index} must use the shared one-point normalized gap`,
        );
      }
    }
    const ordinaryPreviews = previewGeometry.previews
      .filter(({ position }) => position.x < 200)
      .sort((a, b) => a.position.y - b.position.y);
    assert(ordinaryPreviews.length > 0, `${kind} ordinary preview column is missing`);
    assert.equal(
      ordinaryPreviews[0].position.y,
      65,
      `${kind} first ordinary preview must begin at the source Box's 65pt top line`,
    );
    const sourceScreenHeight = displayMode === "ipad" ? 384 : 320;
    const expectedFirstGlobalY =
      reelBounds.y + 65 * (reelBounds.h / sourceScreenHeight);
    assert(
      Math.abs(ordinaryPreviews[0].bounds.y - expectedFirstGlobalY) < 1e-6,
      `${kind} first ordinary preview global top ${ordinaryPreviews[0].bounds.y} ` +
        `must render on the source 65pt line ${expectedFirstGlobalY}`,
    );
    for (let index = 1; index < ordinaryPreviews.length; index += 1) {
      const previous = ordinaryPreviews[index - 1];
      const current = ordinaryPreviews[index];
      const expectedY =
        Math.round(
          (previous.position.y + previous.boundsArea.h * previous.scale.y + 30) *
            sourceRoundingScale,
        ) / sourceRoundingScale;
      assert.equal(
        current.position.y,
        expectedY,
        `${kind} ordinary preview ${index} must follow the preceding scaled height and 30pt gap`,
      );
    }

    // No movement/slop gate: a later stationary press/release starts the randomized coast.
    await advance(525);
    await page.mouse.down();
    snapshot = await state();
    assert.equal(snapshot.overlay.pressed, true, `${kind} second press was not claimed`);
    await page.mouse.up();
    await advance(25);
    snapshot = await state();
    assert.equal(snapshot.overlay.pressed, false, `${kind} second release kept pointer ownership`);
    assert(
      snapshot.overlay.reel.friction >= 2.6999998092651367 &&
      snapshot.overlay.reel.friction <= 3.299999713897705,
      `release did not start coast: ${JSON.stringify(snapshot.overlay.reel)}`,
    );

    snapshot = await waitFor(
      (value) => value.overlay?.kind === kind && value.overlay?.selected !== null,
      `${kind} reel did not select a provider`,
    );
    fs.writeFileSync(path.join(outputDir, `${kind}-rng-landing.json`),
      JSON.stringify(snapshot.overlay, null, 2));
    assert.deepEqual(snapshot.overlay.selected,
      snapshot.overlay.reelPrizes[snapshot.overlay.reel.centerIndex],
      `${kind} awarded a different provider from the committed reel index`);
    assert(snapshot.overlay.reel.speed < -2);
    assert.equal(
      snapshot.overlay.reel.centerIndex,
      Math.floor(snapshot.overlay.reel.index) % snapshot.overlay.poolCount,
    );

    // Monster prizes first offer Keep/Feed. Gold is all-monster, so use it to prove the style-2
    // feed picker can drag away from index zero, inspect the centered concrete monster, and submit
    // that selected instance. Silver keeps its prize to exercise question-before-bench order.
    await waitFor(
      async () =>
        await boundsForLabel("popupButton:Keep") !== null ||
        await boundsForLabel("popupButton:No") !== null,
      `${kind} prize popup did not become interactive`,
    );
    // `MonsterHatchPopup` enters through the source 0.2s scaleY action. Capture the completed
    // presentation rather than a 25ms-tall transitional strip that makes a healthy popup look
    // horizontally corrupted in the browser artifact.
    await advance(225);
    await capture(`${kind}-prize.png`);
    if (await boundsForLabel("popupButton:Keep")) {
      if (kind === "gold") {
        await invokeLabel("popupButton:Feed To");
        snapshot = await waitFor(
          (value) =>
            value.overlay?.kind === "gold" &&
            value.overlay?.phase === "feed" &&
            value.overlay?.feedPicker?.cards?.length > 1,
          "Gold Feed To picker did not mount its party coverflow",
        );
        const firstId = snapshot.overlay.feedPicker.showingId;
        const firstCard = snapshot.overlay.feedPicker.cards.find((card) => card.id === firstId);
        assert(firstCard, "Feed To centered card is missing");
        const nextCard = snapshot.overlay.feedPicker.cards.find((card) => card.index === 1);
        assert(nextCard?.visible, "Feed To side card is missing");
        // CFlowNode's source touch-end path centers a tapped side card before a later centered-card
        // tap is dispatched for inspection. Dispatch through the mounted Pixi node using its
        // exported local point so this proof is independent of browser CSS letterboxing.
        await emitManagementPointer({ x: nextCard.center.x, y: nextCard.center.y - 20 });
        await advance(16);
        snapshot = await waitFor(
          (value) =>
            value.overlay?.feedPicker?.showingIndex === 1 &&
            Math.abs(value.overlay.feedPicker.selectedIndex - 1) < 0.01,
          "Feed To side-card tap never advanced the source-paced coverflow",
        );
        assert.notEqual(snapshot.overlay.feedPicker.showingId, firstId);
        const inspectedId = snapshot.overlay.feedPicker.showingId;
        const inspectedCard = snapshot.overlay.feedPicker.cards.find((card) => card.id === inspectedId);
        assert(inspectedCard, "Feed To inspected card is missing");
        const inspectedPoint = {
          x: inspectedCard.center.x,
          y: inspectedCard.center.y,
        };
        await emitManagementPointer(inspectedPoint);
        await advance(16);
        await waitFor(
          async () => await boundsForLabel("livingInfoNameLevel") !== null,
          "Feed To centered-card inspection did not open LivingInfoDisplay",
        );
        await invokeLabel("popupButton:Ok");
        await waitFor(
          async () => await boundsForLabel("livingInfoNameLevel") === null,
          "Feed To LivingInfoDisplay did not close back to the picker",
        );
        assert.equal((await state()).overlay.feedPicker.showingId, inspectedId);
        const selectCenter = (await state()).overlay.feedPicker.selectCenter;
        await emitManagementPointer(selectCenter);
        await advance(16);
      } else {
        await invokeLabel("popupButton:Keep");
      }
    }
    await waitFor(
      async () => await boundsForLabel("popupButton:No") !== null,
      `${kind} repeat question did not appear`,
    );
    if (kind === "silver") {
      await advance(250); // settle Popup.show's source ordered-input gate before paid repeat
      await invokeLabel("popupButton:Yes (100 Gold)");
      await waitFor(
        (value) =>
          value.overlay?.kind === "silver" &&
          value.overlay?.phase === "rolling" &&
          value.overlay?.selected === null,
        "paid Silver repeat did not build a fresh interactive reel",
      );
      await waitFor(async () => await boundsForLabel("eggHatch:background") !== null,
        "paid Silver repeat did not finish mounting its reel background");
      const repeatBounds = await boundsForLabel("eggHatch:background");
      assert(repeatBounds, "paid Silver repeat background is missing");
      await waitFor(
        async () => (await hitPathAt({
          x: repeatBounds.x + repeatBounds.w / 2,
          y: repeatBounds.y + repeatBounds.h / 2,
        })).includes("eggHatch:silver"),
        "paid Silver repeat remained covered by the repeat popup",
      );
      const repeatCanvas = await page.locator("canvas").first().boundingBox();
      assert(repeatCanvas, "Pixi canvas is unavailable");
      await page.mouse.move(
        repeatCanvas.x + repeatBounds.x + repeatBounds.w / 2,
        repeatCanvas.y + repeatBounds.y + repeatBounds.h / 2,
      );
      await page.mouse.down();
      assert.equal((await state()).overlay.pressed, true, "paid Silver repeat did not claim pointer-down");
      // Cross the fixed-60 90-frame gate with one full-frame margin. Exactly 1,501ms can still
      // materialize only 89 complete updates after the first ticker-step omission.
      await advance(1_525);
      await page.mouse.up();
      await waitFor(
        (value) => value.overlay?.kind === "silver" && value.overlay?.selected !== null,
        "paid Silver repeat did not stop",
      );
      if (await boundsForLabel("popupButton:Keep")) {
        await invokeLabel("popupButton:Keep");
      }
      await waitFor(
        async () => await boundsForLabel("popupButton:No") !== null,
        "paid Silver repeat question did not appear",
      );
    }
    // Popup.show publishes its labelled children before the source 0.2s pop-in/ordered-input gate
    // completes. The paid-repeat path reaches this line immediately, unlike the asset-heavy first
    // question, so settle the same source gate before invoking No.
    await advance(250);
    await invokeLabel("popupButton:No");
    await waitFor(
      (value) => value.overlay?.kind !== kind,
      `${kind} hatch flow did not close`,
    );
  }

  assert.deepEqual(errors, []);
  console.log("egg-hatch: PASS");
} finally {
  await browser.close();
}
