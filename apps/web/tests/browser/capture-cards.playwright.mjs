// Browser contract for MonsterTurnPanel capturePressed:/capture:, CaptureAbilityComponent,
// CaptureEffectBuilder, and the temporary PlayerProfile seam.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/capture-cards");
fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

async function runCase(name, cardLevel, profile, targetId = "t1m0:Minotaur", options = {}) {
  const expectedSuccess =
    name === "success" || name === "terminal-success" || name === "half-star";
  const terminal = options.terminal === true;
  const requestedDisplayMode = options.displayMode;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack ?? e}`));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.failure()?.errorText ?? "failed"}: ${request.url()}`);
  });
  page.on("console", (m) => {
    const source = m.location().url;
    if (m.type() === "error" && !m.text().includes("favicon") && !source.includes("favicon.ico")) {
      errors.push(`console${source ? ` (${source})` : ""}: ${m.text()}`);
    }
  });
  await page.addInitScript(({ profileConfig, encounter, displayMode, fidelityLab }) => {
    window.advanceTime = () => Promise.resolve();
    if (displayMode) {
      const key = "dib.portSettings.v1";
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({
        displayMode,
        textResolutionMode: saved.textResolutionMode ?? "modern",
        sound: saved.sound ?? 0.25,
        music: saved.music ?? 0.5,
      }));
    }
    window.__DIB_TEST_PLAYER_PROFILE__ = profileConfig;
    if (encounter) window.__DIB_TEST_ENCOUNTER__ = encounter;
    if (fidelityLab) {
      window.__DIB_FIDELITY_LAB__ = {
        rng: { kind: "touchhle-xorshift32", initialState: 0x12345678 },
        foundationDictionaryOrder: "lexicographic",
      };
    }
    // Capture flows depend on the PlayerCollection seam; pin it rather than inheriting the
    // another fixture's collection override.
    window.__DIB_TEST_ALL_UNLOCKED__ = false;
    window.__DIB_AUDIO_STARTS__ = [];
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      window.__DIB_AUDIO_STARTS__.push(performance.now());
      return originalStart.apply(this, args);
    };
  }, {
    profileConfig: {
      ...profile,
      tutorialFlags: profile.tutorialFlags ?? [
        "Tutorial0",
        "Tutorial1",
        "Tutorial2",
        "flashTownExit",
      ],
    },
    encounter: options.encounter,
    displayMode: requestedDisplayMode,
    fidelityLab: options.assertParticleRngSeparation === true,
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((v) => window.advanceTime(v), ms);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "start", undefined, { timeout: 30_000 });
  // Startup scene construction and image decoding finish on real browser tasks. Give the newly
  // mounted title one deterministic render plus a compositor beat before pointer hit-testing it.
  await page.waitForTimeout(100);
  await advance(16.67);
  await page.waitForTimeout(100);
  const title = await state();
  assert.equal(title.startup?.phase, "title", `capture fixture must begin at the title touch layer: ${JSON.stringify(title.startup)}`);
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox);
  const titleTouch = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "sourceTitleTouchLayer") {
        const bounds = node.getBounds();
        return { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  });
  assert(titleTouch, `source title touch layer missing: ${JSON.stringify(await state())}`);
  await page.screenshot({ path: path.join(outputDir, `${name}-startup-title.png`), timeout: 120_000 });
  // The title touch layer covers the full source screen. Use the canvas's CSS center directly:
  // its Pixi bounds are stage-global pixels, while this viewport may CSS-letterbox/scale them.
  await canvas.click({ position: { x: canvasBox.width / 2, y: canvasBox.height / 2 } });
  for (let i = 0; i < 360; i++) {
    const startup = await state();
    if (startup.mode === "battle" || startup.startup?.phase === "save-select") break;
    await advance(25);
    if (i % 10 === 0) await page.waitForTimeout(2);
  }
  const startup = await state();
  assert(
    startup.mode === "battle" || startup.startup?.phase === "save-select",
    `title did not reach save selection for capture fixture: ${JSON.stringify(startup)}`,
  );
  if (startup.startup?.phase === "save-select") {
    await advance(250);
    const snapshot = startup;
    const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `Slot 1 unavailable: ${JSON.stringify(snapshot.startup)}`);
    const geometry = await stageGeometry(page, canvasBox);
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }
  for (let i = 0; i < 1200 && !(await state()).panelVisible; i++) {
    if ((await state()).presentation?.state === "building") {
      await page.waitForTimeout(10);
    }
    await advance(25);
    if (i % 10 === 0) await page.waitForTimeout(2);
  }
  const ready = await state();
  if (
    ready.mode !== "battle" ||
    ready.presentation?.state !== "awaitingPlayerChoice" ||
    ready.panelVisible !== true
  ) {
    const pixiTree = await page.evaluate(() => {
      const rows = [];
      const visit = (node, depth) => {
        rows.push({
          depth,
          label: node.label ?? "",
          type: node.constructor?.name ?? "",
          children: node.children?.length ?? 0,
          visible: node.visible,
        });
        for (const child of node.children ?? []) visit(child, depth + 1);
      };
      visit(window.__PIXI_APP__.stage, 0);
      return rows;
    });
    console.error("battle build failure", JSON.stringify({
      ready,
      errors,
      failedRequests,
      pixiTree,
    }, null, 2));
  }
  assert.equal(ready.mode, "battle", `startup did not enter battle: ${JSON.stringify(ready)}`);
  assert.equal(
    ready.presentation.state,
    "awaitingPlayerChoice",
    JSON.stringify({ errors, failedRequests }),
  );
  assert.equal(ready.panelVisible, true);

  const readCaptureMounts = () => page.evaluate(() => {
    const mounts = [];
    const visit = (node) => {
      if (node.label === "captureCardHit") {
        const host = node.parent;
        const cards = (host?.children ?? []).filter((child) => child.label === "captureCard");
        const card = cards[0];
        const hostOrigin = host?.toGlobal({ x: 0, y: 0 });
        const hostBounds = host?.getBounds();
        const cardOrigin = card && host?.toGlobal({ x: card.position.x, y: card.position.y });
        const hitOrigin = host?.toGlobal({ x: node.position.x, y: node.position.y });
        mounts.push({
          targetId: node.userObject,
          visualSiblingCount: cards.length,
          sameHost: card?.parent === host && node.parent === host,
          hostOrigin: hostOrigin ? { x: hostOrigin.x, y: hostOrigin.y } : null,
          hostTransform: host ? {
            a: host.worldTransform.a,
            b: host.worldTransform.b,
            c: host.worldTransform.c,
            d: host.worldTransform.d,
          } : null,
          hostBounds: hostBounds ? {
            x: hostBounds.x,
            y: hostBounds.y,
            width: hostBounds.width,
            height: hostBounds.height,
          } : null,
          card: card ? {
            x: card.position.x,
            y: card.position.y,
            globalX: cardOrigin.x,
            globalY: cardOrigin.y,
            scaleX: card.scale.x,
            scaleY: card.scale.y,
            visible: card.visible,
            renderable: card.renderable,
            destroyed: card.destroyed,
          } : null,
          hit: {
            x: node.position.x,
            y: node.position.y,
            globalX: hitOrigin.x,
            globalY: hitOrigin.y,
            scaleX: node.scale.x,
            scaleY: node.scale.y,
            visible: node.visible,
            renderable: node.renderable,
            destroyed: node.destroyed,
          },
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return mounts;
  });
  const assertCaptureHostMap = (mounts, snapshot, expectedIds, description) => {
    const stageScale = {
      x: snapshot.stagePx.w / snapshot.screenPt.w,
      y: snapshot.stagePx.h / snapshot.screenPt.h,
    };
    assert.deepEqual(
      mounts.map((mount) => mount.targetId).sort(),
      [...expectedIds].sort(),
      `${description}: proxy target IDs do not match eligible hosts`,
    );
    const samePoint = (a, b) =>
      Math.abs(a.x - b.x) <= 0.001 && Math.abs(a.y - b.y) <= 0.001;
    const normalizedMounts = mounts.map((mount) => ({
      ...mount,
      hostOriginPt: {
        x: mount.hostOrigin.x / stageScale.x,
        y: mount.hostOrigin.y / stageScale.y,
      },
    }));
    const expectedIdSet = new Set(expectedIds);
    const eligibleEnemies = snapshot.monsters.filter((monster) =>
      monster.team === 1 && expectedIdSet.has(monster.id));
    const diameter = (points) => Math.max(...points.flatMap((a) =>
      points.map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
    const centroid = (points) => ({
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    });
    const hostPoints = normalizedMounts.map((mount) => mount.hostOriginPt);
    const enemyPoints = eligibleEnemies.map((monster) => monster.displayPoint);
    const hostDiameter = diameter(hostPoints);
    assert(hostDiameter > 0, `${description}: capture parent origins cannot establish the FixedStage scale`);
    const sceneScale = diameter(enemyPoints) / hostDiameter;
    const hostCentroid = centroid(hostPoints);
    const enemyCentroid = centroid(enemyPoints);
    const sceneTranslation = {
      x: enemyCentroid.x - hostCentroid.x * sceneScale,
      y: enemyCentroid.y - hostCentroid.y * sceneScale,
    };
    const toScenePoint = (point) => ({
      x: point.x * sceneScale + sceneTranslation.x,
      y: point.y * sceneScale + sceneTranslation.y,
    });
    assert(
      normalizedMounts.every((mount) =>
        eligibleEnemies.some((monster) => samePoint(monster.displayPoint, toScenePoint(mount.hostOriginPt)))),
      `${description}: capture parent origins do not expose one positive uniform FixedStage transform to enemy display nodes`,
    );
    for (const mount of normalizedMounts) {
      const target = snapshot.monsters.find((monster) => monster.id === mount.targetId);
      assert(target && target.team === 1, `${description}: ${mount.targetId} does not identify a live enemy host`);
      const displayPoint = toScenePoint(mount.hostOriginPt);
      assert(
        samePoint(displayPoint, target.displayPoint),
        `${description}: ${mount.targetId} transformed proxy/visual parent origin does not match its enemy display node`,
      );
      const matchingEnemies = eligibleEnemies.filter((monster) =>
        samePoint(monster.displayPoint, displayPoint));
      assert.deepEqual(
        matchingEnemies.map((monster) => monster.id),
        [mount.targetId],
        `${description}: ${mount.targetId} parent origin does not uniquely identify its enemy display node`,
      );
      assert.equal(mount.visualSiblingCount, 1, `${description}: ${mount.targetId} must own one visual card`);
      assert.equal(mount.sameHost, true, `${description}: ${mount.targetId} visual/proxy must share that unique host`);
    }
  };

  if (options.assertMountGeometry === true) {




    const mounts = await readCaptureMounts();
    const expectedPosition = ready.displayMode === "ipad" ? { x: 2, y: -10 } : { x: 4, y: -7 };
    assert.equal(ready.displayMode, requestedDisplayMode, "the requested display mode did not load before battle build");
    assert.deepEqual(
      [...ready.capture.adjacentCardTargetIds].sort(),
      ["t1m0:Minotaur", "t1m1:Spark", "t1m2:UnhappyBird"],
      "every initially capture-eligible enemy must own exactly one adjacent card",
    );
    assert.equal(mounts.length, 3, "one card/proxy pair must mount per eligible enemy host");
    assertCaptureHostMap(mounts, ready, ready.capture.adjacentCardTargetIds, "initial mount");
    for (const mount of mounts) {
      assert(mount.hostOrigin && mount.hostTransform && mount.card, `${mount.targetId} capture mount is detached from its host`);
      for (const node of [mount.card, mount.hit]) {
        assert.deepEqual(
          { x: node.x, y: node.y },
          expectedPosition,
          `${mount.targetId} card/proxy drifted from its recovered ${ready.displayMode} host-local slot`,
        );
        assert.equal(
          Math.abs(node.globalX - (mount.hostOrigin.x + expectedPosition.x * mount.hostTransform.a + expectedPosition.y * mount.hostTransform.c)) < 0.001,
          true,
          `${mount.targetId} global x does not resolve from its own host plus recovered local offset`,
        );
        assert.equal(
          Math.abs(node.globalY - (mount.hostOrigin.y + expectedPosition.x * mount.hostTransform.b + expectedPosition.y * mount.hostTransform.d)) < 0.001,
          true,
          `${mount.targetId} global y does not resolve from its own host plus recovered local offset`,
        );
        assert.equal(node.scaleX, 0.75, `${mount.targetId} capture card/proxy lost the source 0.75 scale`);
        assert.equal(node.scaleY, 0.75, `${mount.targetId} capture card/proxy lost the source 0.75 scale`);
        assert.equal(node.visible, true, `${mount.targetId} settled card/proxy must remain visible before choice`);
        assert.equal(node.renderable, true, `${mount.targetId} settled card/proxy must remain renderable before choice`);
        assert.equal(node.destroyed, false, `${mount.targetId} live card/proxy was already destroyed`);
      }
    }
  }

  const clickNode = async (label, userObject) => {
    const p = await page.evaluate(({ wanted, payload }) => {
      let hit = null;
      const visit = (node) => {
        if (node.label === wanted && (payload === undefined || node.userObject === payload)) hit = node;
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      if (!hit) return null;
      const b = hit.getBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, { wanted: label, payload: userObject });
    assert(p, `missing Pixi node ${label} ${userObject ?? ""}`);
    const appScreen = await page.evaluate(() => ({ w: window.__PIXI_APP__.screen.width, h: window.__PIXI_APP__.screen.height }));
    const scale = Math.min(canvasBox.width / appScreen.w, canvasBox.height / appScreen.h);
    const ox = (canvasBox.width - appScreen.w * scale) / 2;
    const oy = (canvasBox.height - appScreen.h * scale) / 2;
    const css = { x: canvasBox.x + ox + p.x * scale, y: canvasBox.y + oy + p.y * scale };
    await page.mouse.click(css.x, css.y);
    return { p, css, scale, ox, oy };
  };
  const clickText = async (text) => {
    const p = await page.evaluate((wanted) => {
      let hit = null;
      const visit = (node) => {
        if (node.text === wanted) hit = node;
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      if (!hit) return null;
      const b = hit.getBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, text);
    assert(p, `missing text node ${text}`);
    await page.mouse.click(canvasBox.x + p.x, canvasBox.y + p.y);
  };

  const captureClick = await clickNode("captureCardHit", targetId);
  const nodeExists = (label) => page.evaluate((wanted) => {
    let found = false;
    const visit = (node) => {
      if (node.label === wanted) found = true;
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  }, label);
  const nodeExistsWithPayload = (label, userObject) => page.evaluate(({ wanted, payload }) => {
    let found = false;
    const visit = (node) => {
      if (node.label === wanted && node.userObject === payload) found = true;
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  }, { wanted: label, payload: userObject });
  for (let i = 0; i < 120 && !(await nodeExists("captureChooserTitle")); i++) await advance(25);
  const chooser = await state();
  assert.equal(chooser.activePopup, "captureChooser", JSON.stringify({ captureClick, chooser }));
  assert(await nodeExists("captureChooserTitle"), "capture chooser must finish its async asset build");
  assert.deepEqual(chooser.capture.inventory, profile.captureCards ? {
    silver: profile.silver,
    gold: profile.gold,
    captureCards: profile.captureCards,
  } : chooser.capture.inventory);
  await advance(250); // Scale9Popup 0.2s scaleY entrance.

  const chooserGeometry = await page.evaluate(() => {
    const byLabel = (wanted) => {
      let found = null;
      const visit = (node) => {
        if (node.label === wanted) found = node;
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      if (!found) throw new Error(`missing ${wanted}`);
      return found;
    };
    const rect = (node) => {
      const b = node.getLocalBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    const globalRect = (node) => {
      const b = node.getBounds();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    const cards = [1, 2, 3].map((level) => {
      const button = byLabel(`captureCardChoice${level}`);
      const status = byLabel(`captureCardStatus${level}`);
      const cost = byLabel(`captureCardCost${level}`);
      return {
        button: rect(button),
        status: { ...rect(status), x: status.position.x, y: status.position.y },
        cost: { ...rect(cost), x: cost.position.x, y: cost.position.y },
      };
    });
    const silverAmount = byLabel("captureSilver");
    const goldPile = byLabel("captureGoldPile");
    const title = byLabel("captureChooserTitle");
    const row = byLabel("captureChooserCards");
    const balances = byLabel("captureBalances");
    const silverBounds = silverAmount.getLocalBounds();
    return {
      displayMode: JSON.parse(window.render_game_to_text()).displayMode,
      cards,
      row: rect(row),
      order: {
        title: globalRect(title),
        row: globalRect(row),
        balances: globalRect(balances),
      },
      balanceGap: goldPile.position.x - (silverAmount.position.x + silverBounds.width * silverAmount.scale.x),
    };
  });
  const statusSquare = chooserGeometry.displayMode === "ipad" ? 50 : 70;
  const boxGap = chooserGeometry.displayMode === "ipad" ? 2.5 : 5;
  assert.deepEqual(
    { width: chooserGeometry.row.width, height: chooserGeometry.row.height },
    { width: 3 * 80 + 2 * boxGap, height: 100 },
    "chance/cost children must not inflate the three-card row bounds",
  );
  for (const card of chooserGeometry.cards) {
    assert.deepEqual(card.button, { x: 0, y: 0, width: 80, height: 100 });
    assert.equal(card.status.width, statusSquare);
    assert.equal(card.status.height, statusSquare);
    assert.equal(card.status.x, (80 - statusSquare) / 2);
    assert.equal(card.status.y, (100 - statusSquare) / 2);
    assert.equal(100 - (card.cost.y + card.cost.height), 10, "cost row bottom inset");
  }
  assert(chooserGeometry.order.title.y < chooserGeometry.order.row.y, "title must sit above cards");
  assert(chooserGeometry.order.row.y < chooserGeometry.order.balances.y, "balances must sit below cards");
  assert(
    Math.abs(chooserGeometry.balanceGap - 30) <= 1,
    `explicit silver-to-gold group gap: ${chooserGeometry.balanceGap}`,
  );
  await page.screenshot({ path: path.join(outputDir, `${name}-chooser.png`), timeout: 120_000 });

  if (name === "failure") {
    await clickText("Cancel");
    await advance(25);
    assert.equal((await state()).activePopup, null, "Cancel restores the same choose phase");
    assert.equal((await state()).panelVisible, true);
    await clickNode("captureCardHit", targetId);
    for (let i = 0; i < 120 && !(await nodeExists("captureChooserTitle")); i++) await advance(25);
    await advance(250);
  }

  await clickNode(`captureCardChoice${cardLevel}`, cardLevel);
  if (name === "insufficient") {
    for (let i = 0; i < 120 && (await state()).activePopup !== "cannotAfford"; i++) await advance(25);
    const blocked = await state();
    assert.equal(blocked.activePopup, "cannotAfford");
    assert.equal(blocked.defeatRecovery.store?.category, 3, "capture refusal must stack over Store category 3");
    assert.equal(blocked.defeatRecovery.storeOpenCount, 1);
    assert.equal(blocked.defeatRecovery.storeCloseCount, 0);
    assert.deepEqual(blocked.capture.inventory, {
      silver: profile.silver,
      gold: profile.gold,
      captureCards: profile.captureCards,
    });
    assert.equal(blocked.activeAbilityPath, null, "insufficient funds must not queue capture");
    await advance(250);
    await page.screenshot({ path: path.join(outputDir, "insufficient.png"), timeout: 120_000 });
    await clickNode("popupButton:Ok");
    await clickNode("store:close");
    for (let i = 0; i < 120 && (await state()).defeatRecovery.store !== null; i++) await advance(25);
    const resumed = await state();
    assert.equal(resumed.defeatRecovery.storeCloseCount, 1);
    assert.equal(resumed.presentation.state, "awaitingPlayerChoice");
    assert.equal(resumed.panelVisible, true);
    assert.equal(resumed.activeAbilityPath, null);
    assert.equal(errors.length, 0, errors.join("\n"));
    await page.close();
    return { blocked, resumed };
  }
  for (let i = 0; i < 80 && (await state()).activeAbilityPath !== "Utility.Capture"; i++) await advance(25);
  const queued = await state();
  assert.equal(queued.activeAbilityPath, "Utility.Capture");
  assert.equal(queued.activePopup, null);
  for (let i = 0; i < 80 && !(await nodeExists("sourcePointParticles:Cast.plist")); i++) await advance(10);
  assert(await nodeExists("sourcePointParticles:Cast.plist"), "Cast.plist source point emitter");

  if (options.assertParticleRngSeparation === true) {
    const beforeParticles = await state();
    const beforeCursor = beforeParticles.fidelityLab?.rng?.cursor;
    assert.equal(typeof beforeCursor, "number", "capture RNG proof requires the Fidelity Lab stream");
    await advance(100);
    const duringParticles = await state();
    assert.equal(
      duringParticles.fidelityLab?.rng?.cursor,
      beforeCursor,
      "Cast.plist's libc random() draws must not advance the mechanics arc4random cursor",
    );
    assert(
      await nodeExists("sourcePointParticles:Cast.plist"),
      "Cast.plist must remain alive while its RNG channel is sampled",
    );
    await page.screenshot({ path: path.join(outputDir, `${name}-cast-particles.png`), timeout: 120_000 });
  }

  await advance(500);
  for (let i = 0; i < 20 && !(await state()).activeEffectNodes.some((n) => n.label === "captureMonsterCard"); i++) {
    await advance(25);
  }
  if (expectedSuccess) {
    for (let i = 0; i < 20 && !(await state()).turnOrderFalling.some((entry) => entry.id === targetId); i++) {
      await advance(10);
    }
  }
  const impact = await state();
  const cardStart = impact.activeEffectNodes.find((n) => n.label === "captureMonsterCard");
  assert(cardStart, "capture card effect must start at target-phase impact");
  const capturedTuAtImpact = impact.turnOrderFalling.find((entry) => entry.id === targetId);
  if (expectedSuccess) {
    assert(capturedTuAtImpact, "captured target must detach into the TU removal layer at impact");
    assert.equal(capturedTuAtImpact.rotationDeg, 0, "captured TU portrait starts unrotated");
  }
  const audioStartsAtEffect = await page.evaluate(() => window.__DIB_AUDIO_STARTS__.length);
  await page.screenshot({ path: path.join(outputDir, `${name}-effect-start.png`), timeout: 120_000 });

  // At 1.4s the 0.75s flight is complete and the 0.8s shake is still active; neither branch
  // may have started yet. (The async texture load can consume one 25ms polling frame.)
  await advance(1400);
  const afterShake = await state();
  const cardAtTarget = afterShake.activeEffectNodes.find((n) => n.label === "captureMonsterCard");
  assert(cardAtTarget, "card remains through the branch action");
  assert(Math.abs(cardAtTarget.scaleX - 1) < 0.02, `card scale after fly/shake: ${cardAtTarget.scaleX}`);
  if (name === "half-star") {
    const starGeometry = await page.evaluate(() => {
      const full = [];
      const half = [];
      let frame = null;
      const visit = (node) => {
        if (node.label === "captureMonsterCardFullStar") {
          full.push({
            width: node.width,
            height: node.height,
            rowX: node.parent.x,
            rowY: node.parent.y,
            rowWidth: node.parent.width,
            rowHeight: node.parent.height,
          });
        } else if (node.label === "captureMonsterCardHalfStar") {
          half.push({ width: node.width, height: node.height });
        } else if (node.label === "captureMonsterCardFrame") {
          frame = { width: node.width, height: node.height };
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return { full, half, frame };
    });
    assert.equal(starGeometry.full.length, 1, JSON.stringify(starGeometry));
    assert.equal(starGeometry.half.length, 1, JSON.stringify(starGeometry));
    assert(starGeometry.frame, JSON.stringify(starGeometry));
    assert.equal(starGeometry.half[0].width, starGeometry.full[0].width / 2);
    assert.equal(
      starGeometry.half[0].height,
      starGeometry.full[0].height,
      "half star must crop horizontally without compressing its height",
    );
    assert.equal(
      starGeometry.full[0].rowX,
      Math.round((starGeometry.frame.width - starGeometry.full[0].rowWidth) / 2),
      "rarity row must use the source's rounded horizontal centering",
    );
    assert.equal(
      starGeometry.full[0].rowY,
      starGeometry.frame.height - 42 - starGeometry.full[0].rowHeight / 2,
      "rarity row center, rather than its top edge, must sit on the source 42pt line",
    );
  }
  if (expectedSuccess) {
    const heldTu = afterShake.turnOrderFalling.find((entry) => entry.id === targetId);
    assert(heldTu, "captured TU portrait must remain parented during its two-second hold");
    assert.equal(heldTu.x, capturedTuAtImpact.x, "captured TU portrait x must not move during the hold");
    assert.equal(heldTu.y, capturedTuAtImpact.y, "captured TU portrait y must not move during the hold");
    assert.equal(heldTu.rotationDeg, 0, "captured TU portrait must not rotate during the hold");
  }
  await page.screenshot({ path: path.join(outputDir, `${name}-after-shake.png`), timeout: 120_000 });

  if (expectedSuccess) {
    await advance(700); // remaining shake + 0.5s RecursiveFadeChildrenInAction
    const afterCaptureHold = await state();
    const movingTu = afterCaptureHold.turnOrderFalling.find((entry) => entry.id === targetId);
    assert(movingTu, "captured TU portrait must begin its fall after the two-second hold");
    assert(movingTu.rotationDeg > 0, "captured TU portrait must rotate once its hold completes");
    if (terminal) {
      // ~2.10s after the capture resolved. A battle-ending capture drains ONE native `timeDelay`
      // gate before `-[BattleNode update:]` dispatches performAwardLogic: notifyLivingRemoved:'s
      // 0.5s, state 4's 1.0s, and state 1's own post-advance pacing (+1.0s, team-0 front) — 2.5s
      // total. The award must therefore NOT already be covering the still-running capture card,
      // whose success chain runs to 3.05s. (The prior port omitted the pacing and opened at 1.5s,
      // mid-shake — the reported defect.)
      assert.equal(
        afterCaptureHold.presentation?.state,
        "battleEndDelay",
        "a battle-ending capture must still be inside the 2.5s award gate at 2.1s",
      );
      assert.equal(
        afterCaptureHold.activePopup,
        null,
        "the XP award must not open over a capture card that is still animating",
      );
    }
    await page.screenshot({ path: path.join(outputDir, "success-revealed.png"), timeout: 120_000 });
    await advance(800); // remainder of the source's 1.0s success linger
  } else {
    // 1.4s checkpoint leaves 0.15s of shake. Another 0.8s reaches 2.20s total: the failure
    // card's eased 0.5s MoveTo is already offscreen, but the 0.75s Rotate/Scale child is still
    // running and CaptureFail must NOT have played yet. The CallFunc is at exactly 2.30s.
    await advance(800);
    assert(await nodeExists("captureMonsterCard"), "failure card remains until the 2.30s callback");
    assert.equal(
      await page.evaluate(() => window.__DIB_AUDIO_STARTS__.length),
      audioStartsAtEffect,
      "CaptureFail must not play at the shorter offscreen MoveTo endpoint",
    );
    await advance(150);
    assert.equal(await nodeExists("captureMonsterCard"), false, "failure card removes with the sound callback");
    assert.equal(
      await page.evaluate(() => window.__DIB_AUDIO_STARTS__.length),
      audioStartsAtEffect + 1,
      "CaptureFail plays once at the end of the complete 2.30s sequence",
    );
  }
  const done = await state();
  if (expectedSuccess) {
    assert.equal(done.capture.inventory.captureCards[3], 0, "owned gold card consumed");
    assert.equal(done.capture.inventory.gold, profile.gold, "owned card does not spend currency");
    assert.deepEqual(done.capture.pendingCapturedIds, [targetId]);
    assert(!done.monsters.some((m) => m.id === targetId), "captured display removed");
    assert(
      done.turnOrderFalling.some((entry) => entry.id === targetId),
      "captured TU portrait remains for its independent three-second post-hold fall",
    );
    if (terminal) {
      const frozenOrder = queued.displayedQueue.filter((id) => id !== targetId);
      const frozenDelayText = Object.fromEntries(
        queued.turnOrderEntries
          .filter((entry) => entry.id !== targetId)
          .map((entry) => [entry.id, entry.delayText]),
      );
      assert.deepEqual(
        done.displayedQueue,
        frozenOrder,
        "terminal capture must compact the pre-turn TU order without sampling the advanced queue",
      );
      assert.deepEqual(
        Object.fromEntries(done.turnOrderEntries.map((entry) => [entry.id, entry.delayText])),
        frozenDelayText,
        "terminal capture must leave every surviving TU value at its pre-turn text",
      );
      assert.equal(done.turnOrderAnimating, false, "terminal capture removal reflow did not settle");
    }
  } else {
    assert.equal(done.capture.inventory.captureCards[1], 0, "purchased card is used immediately");
    assert.equal(done.capture.inventory.silver, profile.silver - 50, "level-1 card costs 50 silver");
    assert.deepEqual(done.capture.pendingCapturedIds, []);
    const target = done.monsters.find((m) => m.id === targetId);
    assert.equal(target.captureStatus, "alreadyTried");



    assert.deepEqual(
      done.monsters.filter((m) => m.team === 1).map((m) => `${m.id}:${m.captureStatus}`),
      ["t1m0:Minotaur:available", "t1m1:Spark:alreadyTried", "t1m2:UnhappyBird:available"],
      "failed capture must mark only Spark alreadyTried and leave the others available",
    );



    let reopened = done;
    for (let i = 0; i < 400 && !(reopened.panelVisible && reopened.capture.adjacentCardTargetIds.length); i++) {
      await advance(25);
      reopened = await state();
    }
    assert.deepEqual(
      [...reopened.capture.adjacentCardTargetIds].sort(),
      ["t1m0:Minotaur", "t1m2:UnhappyBird"],
      "rebuilt adjacent-card state must mount cards only on status-0 enemies",
    );
    assert.equal(
      await nodeExistsWithPayload("captureCardHit", targetId),
      false,
      "an already-tried target loses its card from the next panel onward",
    );
    assert.equal(
      await nodeExistsWithPayload("captureCardHit", "t1m0:Minotaur"),
      true,
      "untouched enemies regain their adjacent card with the next panel",
    );
    assert.equal(
      await nodeExistsWithPayload("captureCardHit", "t1m2:UnhappyBird"),
      true,
      "failure must not globally remove capture cards from other enemies",
    );
    const rebuiltMounts = await readCaptureMounts();
    assertCaptureHostMap(
      rebuiltMounts,
      reopened,
      ["t1m0:Minotaur", "t1m2:UnhappyBird"],
      "settled failure rebuild",
    );
    await page.screenshot({ path: path.join(outputDir, "failure-done.png"), timeout: 120_000 });
    await page.mouse.click(captureClick.css.x, captureClick.css.y);
    await advance(25);
    assert.equal((await state()).activePopup, null, "failed Spark's old card position must be inert");
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.close();
  return { queued, impact, afterShake, done };
}

try {
  const requestedCase = process.env.DIB_CAPTURE_CASE;
  const run = (name) => requestedCase === undefined || requestedCase === name;
  const mountIphone = run("mount-iphone") ? await runCase("mount-iphone", 1, {
    heroLevel: 12,
    monsterPartyLevels: [12, 12, 12],
    silver: 1000,
    gold: 200,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  }, "t1m1:Spark", { displayMode: "iphone", assertMountGeometry: true }) : null;
  const mountIpad = run("mount-ipad") ? await runCase("mount-ipad", 1, {
    heroLevel: 12,
    monsterPartyLevels: [12, 12, 12],
    silver: 1000,
    gold: 200,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  }, "t1m1:Spark", { displayMode: "ipad", assertMountGeometry: true }) : null;
  const failure = run("failure") ? await runCase("failure", 1, {
    heroLevel: 12,
    monsterPartyLevels: [12, 12, 12],
    silver: 1000,
    gold: 200,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  }, "t1m1:Spark") : null;
  const success = run("success") ? await runCase("success", 3, {
    heroLevel: 12,
    monsterPartyLevels: [12, 12, 12],
    silver: 1000,
    gold: 200,
    captureCards: { 1: 0, 2: 0, 3: 1 },
    highestCapturedLevels: { Minotaur: 12 },
  }, undefined, { assertParticleRngSeparation: true }) : null;
  const terminalSuccess = run("terminal-success") ? await runCase("terminal-success", 3, {
    heroLevel: 50,
    monsterPartyLevels: [50, 50, 50],
    silver: 1000,
    gold: 200,
    captureCards: { 1: 0, 2: 0, 3: 1 },
    highestCapturedLevels: { Minotaur: 1 },
  }, "t1m0:Minotaur", {
    terminal: true,
    encounter: {
      backgroundKey: "ForestCombat",
      playerTeam: [
        { shortType: "FireCub", level: 50 },
        { shortType: "SnowCub", level: 50 },
        { shortType: "Penguin", level: 50 },
      ],
      enemyTeam: [{ shortType: "Minotaur", level: 1 }],
    },
  }) : null;
  const halfStar = run("half-star") ? await runCase("half-star", 3, {
    heroLevel: 50,
    monsterPartyLevels: [50, 50, 50],
    silver: 1000,
    gold: 200,
    captureCards: { 1: 0, 2: 0, 3: 1 },
    highestCapturedLevels: { Bitewing: 1 },
  }, "t1m0:Bitewing", {
    encounter: {
      backgroundKey: "ForestCombat",
      playerTeam: [
        { shortType: "FireCub", level: 50 },
        { shortType: "SnowCub", level: 50 },
        { shortType: "Penguin", level: 50 },
      ],
      enemyTeam: [
        { shortType: "Bitewing", level: 1 },
        { shortType: "GiantTurtle", level: 1 },
      ],
    },
  }) : null;
  const insufficient = run("insufficient") ? await runCase("insufficient", 3, {
    heroLevel: 12,
    monsterPartyLevels: [12, 12, 12],
    silver: 49,
    gold: 99,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  }) : null;
  fs.writeFileSync(
    path.join(outputDir, "state.json"),
    JSON.stringify({ mountIphone, mountIpad, failure, success, terminalSuccess, halfStar, insufficient }, null, 2) + "\n",
  );
  console.log("capture-cards: PASS");
} finally {
  await browser.close();
}
