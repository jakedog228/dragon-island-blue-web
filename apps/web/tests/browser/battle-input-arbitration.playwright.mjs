import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { pinEncounter, STANDARD_BATTLE } from "./fixtures.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

// This fixture intentionally uses localhost, never a potentially stale 127.0.0.1 Vite listener.
const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const parsedUrl = new URL(url);
assert.equal(parsedUrl.protocol, "http:", "battle input fixture requires an http localhost server");
assert.equal(parsedUrl.hostname, "localhost", "battle input fixture rejects non-localhost servers");

const VALIDATION_EMPTY_BROWSER_SKIP = Object.freeze({
  status: "SKIP",
  branch: "post-validation-empty",
  invariant:
    "PlayerChoice exposes no per-ability validateEnemyTarget predicate; production uses the same targetable pool before and after candidate collection",
  proof: "apps/web/tests/battleInput.test.ts: validation removes the midpoint candidate",
});

const ALL_ENEMY_BATTLE = {
  backgroundKey: "ForestCombat",
  blockSaveMe: true,
  // DonPen.usable3 is shipped Offensive.AttackAll (Jobs.json lines 217-298).
  playerTeam: [{ shortType: "DonPen", level: 12 }],
  enemyTeam: [
    { shortType: "Minotaur", level: 12 },
    { shortType: "Spark", level: 12 },
    { shortType: "UnhappyBird", level: 12 },
  ],
};

async function state(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function withPanel(browser, encounter, run) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await pinEncounter(page, encounter);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "start", undefined, { timeout: 30_000 });
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).startup?.phase === "title",
    undefined,
    { timeout: 30_000 },
  );
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    () => {
      const current = JSON.parse(window.render_game_to_text());
      return current.mode === "battle" || current.startup?.phase === "save-select";
    },
    undefined,
    { timeout: 30_000 },
  );
  const startup = await state(page);
  if (startup.startup?.phase === "save-select") {
    await page.waitForTimeout(250);
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `slot-1 must be enabled after title transition: ${JSON.stringify(startup.startup)}`);
    const { toCss } = await stageGeometry(page, box);
    const point = toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }
  await page.waitForFunction(
    () => {
      const current = JSON.parse(window.render_game_to_text());
      return current.presentation?.state === "awaitingPlayerChoice" && current.panelVisible === true;
    },
    undefined,
    { timeout: 30_000 },
  );
  try {
    await run({ page, box, errors });
  } finally {
    await page.close();
  }
}

async function abilityPoint(page, box, predicate) {
  const current = await state(page);
  const ability = current.abilityButtons.find(predicate);
  assert(ability, `ability card was not present: ${JSON.stringify(current.abilityButtons)}`);
  const { toCss } = await stageGeometry(page, box);
  return { ability, point: toCss(ability.center) };
}

async function abilityBounds(page, box, point) {
  const bounds = await page.evaluate(({ x, y, canvasX, canvasY }) => {
    const visit = (node) => {
      const current = node.getBounds?.();
      if (
        current &&
        Math.abs(current.x + canvasX + current.width / 2 - x) < 2 &&
        Math.abs(current.y + canvasY + current.height / 2 - y) < 2 &&
        "enabled" in node
      ) {
        return { x: current.x + canvasX, y: current.y + canvasY, width: current.width, height: current.height };
      }
      for (const child of node.children ?? []) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(window.__PIXI_APP__.stage);
  }, { x: point.x, y: point.y, canvasX: box.x, canvasY: box.y });
  assert(bounds, "ability ButtonSprite bounds were not found");
  return bounds;
}

async function nonButtonGestureLane(page, box, delta) {
  const geometry = await stageGeometry(page, box);
  const buttonBounds = await page.evaluate(({ canvasX, canvasY }) => {
    const found = [];
    const visit = (node) => {
      if ("enabled" in node) {
        const bounds = node.getBounds?.();
        if (bounds) {
          found.push({
            x: bounds.x + canvasX,
            y: bounds.y + canvasY,
            width: bounds.width,
            height: bounds.height,
          });
        }
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  }, { canvasX: box.x, canvasY: box.y });
  const { w, h } = geometry.screenPt;
  const centers = [
    { x: w * 0.5, y: h * 0.45 },
    { x: w * 0.5, y: h * 0.3 },
    { x: w * 0.35, y: h * 0.45 },
    { x: w * 0.65, y: h * 0.45 },
    { x: w * 0.5, y: h * 0.6 },
  ];
  for (const center of centers) {
    const startPoint = { x: center.x - delta.x / 2, y: center.y - delta.y / 2 };
    const endPoint = { x: center.x + delta.x / 2, y: center.y + delta.y / 2 };
    const samples = Array.from({ length: 17 }, (_, index) => {
      const t = index / 16;
      return geometry.toCss({
        x: startPoint.x + (endPoint.x - startPoint.x) * t,
        y: startPoint.y + (endPoint.y - startPoint.y) * t,
      });
    });
    const intersectsButton = samples.some((sample) => buttonBounds.some((bounds) =>
      sample.x >= bounds.x && sample.x < bounds.x + bounds.width &&
      sample.y >= bounds.y && sample.y < bounds.y + bounds.height
    ));
    if (!intersectsButton) {
      return { start: samples[0], end: samples[samples.length - 1], center };
    }
  }
  throw new Error(`no gesture-target lane avoids every ButtonSprite: ${JSON.stringify({ delta, buttonBounds })}`);
}

async function expectPicker(page, abilityPath) {
  await page.waitForFunction(
    (path) => {
      const current = JSON.parse(window.render_game_to_text());
      return current.picking === true && current.panelVisible === false && current.activeAbilityPath === null &&
        current.abilityButtons.some((ability) => ability.abilityPath === path);
    },
    abilityPath,
    { timeout: 3_000 },
  );
}

function assertNoSubmission(current, label) {
  assert.equal(current.battleInput.latestPlayerSubmission, null, `${label}: must not submit a player action`);
  assert.equal(current.friendlyPopForwardCount, 0, `${label}: must not start friendly pop-forward`);
  assert.deepEqual(current.friendlyPopForwardLayers, [], `${label}: must not create a spotlight layer`);
}

function assertNoSwipeFeedback(current, label) {
  assert.equal(current.battleInput.latestSwipeTargetFeedback, null, `${label}: must not synthesize swipe feedback`);
  assert.equal(current.battleInput.swipeTargetFeedbackCount, 0, `${label}: feedback count must remain unchanged`);
}

function assertSourceSpotlight(current, label) {
  assert.equal(current.friendlyPopForwardCount, 1, `${label}: must start one friendly pop-forward`);
  assert.equal(current.friendlyPopForwardLayers.length, 1, `${label}: must expose one spotlight layer`);
  assert.equal(current.friendlyPopForwardLayers[0].zIndex, 2, `${label}: spotlight must use BattleNode z=2`);
  assert.equal(
    current.friendlyPopForwardLayers[0].parentIsFriendlyDisplay,
    false,
    `${label}: spotlight must be a direct BattleNode child`,
  );
}

async function runStationaryTap(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const { ability, point } = await abilityPoint(page, box, (entry) => entry.slot === 1);
    await page.mouse.click(point.x, point.y);
    await expectPicker(page, ability.abilityPath);
    const after = await state(page);
    assertNoSubmission(after, "stationary tap");
    assertNoSwipeFeedback(after, "stationary tap");
    assert.deepEqual(errors, []);
  });
}

async function runDragOutAndBack(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const { ability, point } = await abilityPoint(page, box, (entry) => entry.slot === 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 240, point.y - 120, { steps: 1 });
    await page.mouse.move(point.x, point.y, { steps: 1 });
    await page.mouse.up();
    await expectPicker(page, ability.abilityPath);
    const after = await state(page);
    assertNoSubmission(after, "drag out/in tap");
    assertNoSwipeFeedback(after, "drag out/in tap");
    assert.deepEqual(errors, []);
  });
}

async function runReleaseOutside(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const before = await state(page);
    const { point } = await abilityPoint(page, box, (entry) => entry.slot === 1);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 240, point.y - 120, { steps: 1 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await state(page);
    assert.equal(after.panelVisible, true, "release outside must retain the panel");
    assert.equal(after.picking, false, "release outside must not open target picking");
    assert.equal(after.activeAbilityPath, null, "release outside must not activate an ability");
    assert.deepEqual(after.queue, before.queue, "release outside must not mutate queue order");
    assertNoSubmission(after, "release outside");
    assertNoSwipeFeedback(after, "release outside");
    assert.deepEqual(errors, []);
  });
}

async function runDisabledButton(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const before = await state(page);
    const { point } = await abilityPoint(page, box, (entry) => entry.slot === 1);
    const disabled = await page.evaluate(({ x, y, canvasX, canvasY }) => {
      const visit = (node) => {
        const bounds = node.getBounds?.();
        if (bounds && Math.abs(bounds.x + canvasX + bounds.width / 2 - x) < 2 && Math.abs(bounds.y + canvasY + bounds.height / 2 - y) < 2) {
          if ("enabled" in node) {
            node.enabled = false;
            return true;
          }
        }
        return node.children?.some(visit) ?? false;
      };
      return visit(window.__PIXI_APP__.stage);
    }, { x: point.x, y: point.y, canvasX: box.x, canvasY: box.y });
    assert.equal(disabled, true, "ability ButtonSprite was not found for disabled arbitration");
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(100);
    const after = await state(page);
    assert.equal(after.panelVisible, true, "disabled child button must not remove the panel");
    assert.equal(after.picking, false, "disabled child button must not open target picking");
    assert.equal(after.activeAbilityPath, null, "disabled child button must not activate an ability");
    assert.deepEqual(after.queue, before.queue, "disabled child button must not mutate queue order");
    assertNoSubmission(after, "disabled child button");
    assertNoSwipeFeedback(after, "disabled child button");
    assert.deepEqual(errors, []);
  });
}

async function runContainedRecognizedGlyph(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const { ability, point } = await abilityPoint(page, box, (entry) => entry.slot === 1);
    const bounds = await abilityBounds(page, box, point);
    // The inner-quarter to inner-three-quarter cardinal stroke remains wholly inside the live
    // ButtonSprite bounds and spans half of the source 75pt card (> the recognizer's 20pt gate).
    // Source ButtonSprite claims and swallows at began, so this is one tap, never tap + swipe.
    const start = { x: bounds.x + bounds.width * 0.25, y: bounds.y + bounds.height * 0.5 };
    const end = { x: bounds.x + bounds.width * 0.75, y: start.y };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 1 });
    await page.mouse.up();
    await expectPicker(page, ability.abilityPath);
    const after = await state(page);
    assertNoSubmission(after, `contained recognized glyph ${ability.abilityPath}`);
    assertNoSwipeFeedback(after, `contained recognized glyph ${ability.abilityPath}`);
    await page.screenshot({ path: "output/final-button-fix-contained-glyph.png" });
    assert.deepEqual(errors, []);
  });
}

async function dispatchTouchPointer(page, type, pointerId, point, buttons) {
  await page.evaluate(({ type, pointerId, point, buttons }) => {
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("battle canvas was not found");
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId,
      pointerType: "touch",
      isPrimary: pointerId === 41,
      clientX: point.x,
      clientY: point.y,
      buttons,
    }));
  }, { type, pointerId, point, buttons });
}

async function runTwoPointerRelease(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const { ability, point } = await abilityPoint(page, box, (entry) => entry.slot === 1);
    await dispatchTouchPointer(page, "pointerdown", 41, point, 1);
    await dispatchTouchPointer(page, "pointerdown", 42, point, 1);
    await dispatchTouchPointer(page, "pointerup", 42, point, 0);
    await page.waitForTimeout(100);
    const afterNonOwner = await state(page);
    assert.equal(afterNonOwner.picking, false, "non-owner release must not open target picking");
    assert.equal(afterNonOwner.panelVisible, true, "non-owner release must retain the claimed panel press");
    assertNoSubmission(afterNonOwner, "non-owner release");
    assertNoSwipeFeedback(afterNonOwner, "non-owner release");

    await dispatchTouchPointer(page, "pointerup", 41, point, 0);
    await expectPicker(page, ability.abilityPath);
    const afterOwner = await state(page);
    assertNoSubmission(afterOwner, "owner release");
    assertNoSwipeFeedback(afterOwner, "owner release");
    await page.screenshot({ path: "output/final-button-fix-two-pointer.png" });
    assert.deepEqual(errors, []);
  });
}

async function runOutsideStartCrossHeldButton(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const { ability, point: ownerPoint } = await abilityPoint(page, box, (entry) => entry.slot === 1);
    const bounds = await abilityBounds(page, box, ownerPoint);
    const end = { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.5 };
    const buttonBounds = await page.evaluate(({ canvasX, canvasY }) => {
      const found = [];
      const visit = (node) => {
        if ("enabled" in node) {
          const current = node.getBounds?.();
          if (current) {
            found.push({
              x: current.x + canvasX,
              y: current.y + canvasY,
              width: current.width,
              height: current.height,
            });
          }
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return found;
    }, { canvasX: box.x, canvasY: box.y });
    const start = [10, 20, 40, 60, 80, 100]
      .map((offset) => ({ x: bounds.x - offset, y: end.y }))
      .find((candidate) => buttonBounds.every((current) =>
        candidate.x < current.x || candidate.x >= current.x + current.width ||
        candidate.y < current.y || candidate.y >= current.y + current.height
      ));
    assert(start, `no outside-start point was available left of slot 1: ${JSON.stringify(buttonBounds)}`);

    await dispatchTouchPointer(page, "pointerdown", 41, ownerPoint, 1);
    await dispatchTouchPointer(page, "pointerdown", 42, start, 1);
    await dispatchTouchPointer(page, "pointermove", 42, end, 1);
    await dispatchTouchPointer(page, "pointerup", 42, end, 0);
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).battleInput.swipeTargetFeedbackCount === 1,
      undefined,
      { timeout: 3_000 },
    );
    const afterForeign = await state(page);
    assert.equal(afterForeign.panelVisible, true, "outside-start crossing gesture must retain the panel on empty midpoint");
    assert.equal(afterForeign.picking, false, "outside-start crossing gesture must not invoke the held button");
    assert.equal(afterForeign.battleInput.latestSwipeTargetFeedback, "notAllowed");
    assertNoSubmission(afterForeign, "outside-start crossing gesture");

    await dispatchTouchPointer(page, "pointerup", 41, ownerPoint, 0);
    await expectPicker(page, ability.abilityPath);
    const afterOwner = await state(page);
    assertNoSubmission(afterOwner, "outside-start crossing owner release");
    assert.equal(afterOwner.battleInput.swipeTargetFeedbackCount, 1, "owner release must not replay panel gesture feedback");
    await page.screenshot({ path: "output/final-button-fix-cross-held.png" });
    assert.deepEqual(errors, []);
  });
}

async function runSingleEnemySwipe(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const before = await state(page);
    const ability = before.abilityButtons.find((entry) => entry.slot === 1);
    assert(ability, `slot-1 ability was not present: ${JSON.stringify(before.abilityButtons)}`);
    const enemy = before.monsters.find((entry) => entry.team === 1 && entry.visible);
    assert(enemy, `visible enemy was not present: ${JSON.stringify(before.monsters)}`);
    const { toCss } = await stageGeometry(page, box);
    const start = toCss({ x: enemy.targetPoint.x - 30, y: enemy.targetPoint.y });
    const end = toCss({ x: enemy.targetPoint.x + 30, y: enemy.targetPoint.y });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 1 });
    await page.mouse.up();
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).battleInput.latestPlayerSubmission !== null,
      undefined,
      { timeout: 3_000 },
    );
    const after = await state(page);
    assert.equal(after.panelVisible, false, "valid single-enemy swipe must remove the panel");
    assert.equal(after.picking, false, "valid single-enemy swipe must not open target picking");
    assert.equal(after.activeAbilityPath, ability.abilityPath, "valid swipe must activate its slot ability");
    assert.deepEqual(after.battleInput.latestPlayerSubmission, {
      actorId: before.activeActorId,
      slot: `usable${ability.slot}`,
      abilityPath: ability.abilityPath,
      selectedTargetIds: [enemy.id],
      submittedTargetIds: [enemy.id],
    });
    assertNoSwipeFeedback(after, "valid single-enemy swipe");
    assertSourceSpotlight(after, "valid single-enemy swipe");
    assert.deepEqual(errors, []);
  });
}

async function runInvalidStroke(browser) {
  await withPanel(browser, STANDARD_BATTLE, async ({ page, box, errors }) => {
    const before = await state(page);
    // Keep the 52:20 battle-point diagonal (not a registered cardinal stroke), but place its full
    // path in the scene-owned gesture target outside every live ButtonSprite.
    const { start, end } = await nonButtonGestureLane(page, box, { x: 52, y: 20 });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // 52:20 does not meet the source 3:1 minor-axis suppression threshold, so no gesture matches.
    await page.mouse.move(end.x, end.y, { steps: 1 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await state(page);
    assert.equal(after.panelVisible, true, "invalid stroke must retain the panel");
    assert.equal(after.picking, false, "invalid stroke must not open target picking");
    assert.equal(after.activeAbilityPath, null, "invalid stroke must not activate an ability");
    assert.deepEqual(after.queue, before.queue, "invalid stroke must not mutate queue order");
    assertNoSubmission(after, "invalid stroke");
    assertNoSwipeFeedback(after, "invalid stroke");
    assert.deepEqual(errors, []);
  });
}

async function runAllEnemySwipe(browser) {
  await withPanel(browser, ALL_ENEMY_BATTLE, async ({ page, box, errors }) => {
    const before = await state(page);
    const enemyIds = before.queue.filter((id) => before.monsters.some((monster) => monster.id === id && monster.team === 1));
    const enemyHpAtStart = before.monsters
      .filter((monster) => monster.team === 1)
      .map((monster) => ({ id: monster.id, hp: monster.hp }));
    const { ability, point } = await abilityPoint(page, box, (entry) => entry.abilityPath === "Offensive.AttackAll");
    const directionBySlot = { 1: { x: 60, y: 0 }, 2: { x: -60, y: 0 }, 3: { x: 0, y: 60 }, 4: { x: 0, y: -60 } };
    const delta = directionBySlot[ability.slot];
    assert(delta, `unexpected swipe slot ${ability.slot}`);
    const { start, end } = await nonButtonGestureLane(page, box, delta);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 1 });
    await page.mouse.up();
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).panelVisible === false, undefined, { timeout: 3_000 });
    await page.waitForFunction(
      ({ enemiesAtStart, actorId, selectedTargetIds }) => {
        const current = JSON.parse(window.render_game_to_text());
        const submission = current.battleInput.latestPlayerSubmission;
        const sameAttackAllSubmission =
          current.activeAbilityPath === "Offensive.AttackAll" &&
          submission?.actorId === actorId &&
          submission.slot === "usable3" &&
          submission.abilityPath === "Offensive.AttackAll" &&
          submission.submittedTargetIds.length === 0 &&
          submission.selectedTargetIds.length === selectedTargetIds.length &&
          submission.selectedTargetIds.every((id, index) => id === selectedTargetIds[index]);
        if (!sameAttackAllSubmission) return false;
        const lethalProgress = ["deathResolution", "battleEndDelay", "battleEnded"].includes(
          current.presentation?.state,
        );
        return enemiesAtStart.every(({ id, hp }) => {
          const monster = current.monsters.find((entry) => entry.id === id);
          // A lethal all-enemy hit removes the display in the same visible death-resolution path.
          // Absence alone is not success: it must correlate with this exact AttackAll submission
          // and the production presentation reaching death resolution or a terminal battle state.
          return monster === undefined ? lethalProgress : monster.hp < hp;
        });
      },
      { enemiesAtStart: enemyHpAtStart, actorId: before.activeActorId, selectedTargetIds: enemyIds },
      { timeout: 5_000 },
    );
    const after = await state(page);
    assert.equal(after.activeAbilityPath, "Offensive.AttackAll");
    assert.equal(after.panelVisible, false, "all-enemy swipe must remove the panel");
    assert.equal(after.picking, false, "all-enemy swipe must not open target picking");
    assert.deepEqual(after.battleInput.latestPlayerSubmission, {
      actorId: before.activeActorId,
      slot: `usable${ability.slot}`,
      abilityPath: "Offensive.AttackAll",
      selectedTargetIds: enemyIds,
      submittedTargetIds: [],
    });
    const lethalProgress = ["deathResolution", "battleEndDelay", "battleEnded"].includes(after.presentation?.state);
    assert(
      enemyHpAtStart.every(({ id, hp }) => {
        const monster = after.monsters.find((entry) => entry.id === id);
        return monster === undefined ? lethalProgress : monster.hp < hp;
      }),
      "all-enemy swipe must reduce each target's HP or correlate removal with lethal battle progression",
    );
    assertNoSwipeFeedback(after, "all-enemy swipe");
    assertSourceSpotlight(after, "all-enemy swipe");
    assert.deepEqual(errors, []);
  });
}

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
try {
  await runStationaryTap(browser);
  await runDragOutAndBack(browser);
  await runReleaseOutside(browser);
  await runDisabledButton(browser);
  await runContainedRecognizedGlyph(browser);
  await runTwoPointerRelease(browser);
  await runOutsideStartCrossHeldButton(browser);
  await runSingleEnemySwipe(browser);
  await runInvalidStroke(browser);
  await runAllEnemySwipe(browser);
  console.log(`battle-input-arbitration: ${VALIDATION_EMPTY_BROWSER_SKIP.status} ${VALIDATION_EMPTY_BROWSER_SKIP.branch}: ${VALIDATION_EMPTY_BROWSER_SKIP.invariant}; unit proof: ${VALIDATION_EMPTY_BROWSER_SKIP.proof}`);
  console.log("battle-input-arbitration: PASS (button ownership, reachable pointer, empty-target, target-id, spotlight, and all-enemy matrix)");
} finally {
  await browser.close();
}
