// Opt-in editable party-management action contract.
//
// Covers the world-menu style-1 editor's nested notification-popup ownership:
//   info -> destructive confirmation -> Cancel -> restored info
//   info -> conversion confirmation -> soul-stone reveal -> editor
//   info -> permanent-destruction confirmation -> Cancel/retry -> editor
// and proves both durable party mutations, stone mint/no-mint behavior, and the last-monster guard.
//
// It then equips the stone minted DURING this session through the toolbox Insert Soul Stone
// control, which is the case that used to throw on a missing item texture and blank the carousel,
// and checks the equipped badge stays inside the source's cardSize/5 shrink-fit box.
//
// Run with an operator-owned compatible archive. Fidelity sign-off requires both display modes:
//   $env:DIB_CONTENT_ARCHIVE="$PWD\Dragon_Island_Blue_1.1.0.ipa"
//   $env:DIB_WEB_URL="http://localhost:5199"
//   $env:DIB_PARTY_DISPLAY_MODE="iphone" # then "ipad"
//   node apps/web/tests/browser/party-editor-actions.playwright.mjs
//
// Source pager/layout-only fixture (11 loose stones => three pages in either tier):
//   $env:DIB_SOUL_STONE_PAGINATION="1"
//   node apps/web/tests/browser/party-editor-actions.playwright.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5199";
const expectedDisplayMode = process.env.DIB_PARTY_DISPLAY_MODE ?? "ipad";
const paginationOnly = process.env.DIB_SOUL_STONE_PAGINATION === "1";
if (expectedDisplayMode !== "iphone" && expectedDisplayMode !== "ipad") {
  throw new Error(
    `DIB_PARTY_DISPLAY_MODE must be "iphone" or "ipad", got ${JSON.stringify(expectedDisplayMode)}`,
  );
}
const outputDir = path.resolve(
  import.meta.dirname,
  `../../../../output/party-editor-actions-browser-${expectedDisplayMode}`,
);
fs.mkdirSync(outputDir, { recursive: true });
for (const name of [
  "01-editor-two-member-party.png",
  "02-firecub-editable-info.png",
  "03-convert-confirm-before-cancel.png",
  "04-info-restored-after-cancel.png",
  "05-fire-soul-stone-reveal-nested.png",
  "06-editor-after-confirmed-convert.png",
  "07-destroy-confirm-before-cancel.png",
  "08-info-restored-after-destroy-cancel.png",
  "09-editor-after-confirmed-destroy.png",
  "10-cannot-convert-last-monster.png",
  "11-info-restored-after-last-monster-guard.png",
  "12-insert-soul-stone-picker.png",
  "13-editor-with-equipped-soul-stone.png",
  "14-world-after-party-editor-actions.png",
  "15-soul-stone-picker-page-1.png",
  "16-soul-stone-picker-page-2-selected.png",
  "17-soul-stone-picker-inserted.png",
  "failure.png",
]) fs.rmSync(path.join(outputDir, name), { force: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.addInitScript(({ displayMode, paginationOnly }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode,
      textResolutionMode: "modern",
      sound: 0.25,
      music: 0.5,
    }));
    // Presence of the provisional function puts the app into deterministic-ticker mode. main.ts
    // replaces it with the real async ticker advancer after FixedStage initialization.
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1"];
    window.__DIB_TEST_WORLD_SEED__ = 20260723;
    // Three pinned ordinary monsters make Convert and Destroy deterministic, then leave exactly
    // one member so the same run reaches CannotDestroyLastGuy without a private mutation hook.
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 3,
      battingOrderSize: 3,
      levelRange: [5, 5],
      members: [
        { shortType: "FireCub", level: 5 },
        { shortType: "SnowCub", level: 5 },
        { shortType: "BatSquirrel", level: 5 },
      ],
      ...(paginationOnly ? {
        soulStones: [
          { element: "Fire", level: 5, sourceType: "FireCub" },
          { element: "Water", level: 6, sourceType: "SnowCub" },
          { element: "Life", level: 7, sourceType: "Fairy" },
          { element: "Air", level: 8, sourceType: "BatSquirrel" },
          { element: "Earth", level: 9, sourceType: "Minotaur" },
          { element: "Death", level: 10, sourceType: "Bones" },
          { element: "Arcane", level: 11, sourceType: "Sphinx" },
          { element: "Fire", level: 12, sourceType: "FireCub" },
          { element: "Water", level: 13, sourceType: "SnowCub" },
          { element: "Life", level: 14, sourceType: "Fairy" },
          { element: "Air", level: 15, sourceType: "BatSquirrel" },
        ],
      } : {}),
    };
  }, { displayMode: expectedDisplayMode, paginationOnly });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  const waitForState = async (predicate, description, iterations = 180) => {
    for (let i = 0; i < iterations; i++) {
      const snapshot = await state();
      if (predicate(snapshot)) {
        // A popup can mount after the preceding render. Give Pixi one short deterministic frame
        // before any getBounds probe, without blindly stepping through an entire transition.
        await advance(25);
        return await state();
      }
      // AssetLibrary fetch/decode continuations need real event-loop time; tight advanceTime loops
      // can otherwise strand a perfectly healthy scene in its async "building" phase.
      await page.waitForTimeout(50);
      await advance(25);
    }
    throw new Error(
      `${description}; browser errors: ${errors.join(" | ") || "none"}; ` +
      `final state: ${JSON.stringify(await state())}`,
    );
  };

  const visibleTexts = () => page.evaluate(() => {
    const values = [];
    const visit = (node, ancestorsVisible) => {
      const visible = ancestorsVisible && node.visible !== false && node.renderable !== false;
      if (visible && typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child, visible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return values;
  });
  const waitForVisibleText = async (needle, description = `"${needle}" did not render`) => {
    for (let i = 0; i < 120; i++) {
      if ((await visibleTexts()).includes(needle)) return;
      await page.waitForTimeout(50);
      await advance(25);
    }
    throw new Error(`${description}; saw: ${(await visibleTexts()).join(" | ")}`);
  };

  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox, "game canvas must have CSS bounds");

  // Pixi getBounds() is already canvas-global, including the fixed-stage mount and letterboxing.
  // Only add the canvas element's CSS-page origin; do not pass these values through stageGeometry.
  const targetForLabel = (label) => page.evaluate((wanted) => {
    const root = window.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    const isVisible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (current.visible === false || current.renderable === false) return false;
      }
      return true;
    };
    const matches = [];
    const visit = (node) => {
      if (node.label === wanted && isVisible(node)) {
        const bounds = node.getBounds();
        // Popup/MenuButton source hit boxes are their authored Text content while the scale9
        // chrome deliberately overhangs. Prefer that visible text child's getBounds() for the
        // click point; using the parent Container's decorative bounds can land outside hitArea.
        const textChild = (node.children ?? []).find(
          (child) => typeof child.text === "string" && isVisible(child),
        );
        const hitBounds = textChild?.getBounds() ?? bounds;
        const hitArea = node.hitArea;
        const authoredHitCenter = hitArea && typeof hitArea.width === "number" && typeof hitArea.height === "number"
          ? node.toGlobal({
              x: (hitArea.x ?? 0) + hitArea.width / 2,
              y: (hitArea.y ?? 0) + hitArea.height / 2,
            })
          : null;
        let interactivePoint = null;
        const authoredOwnerPath = [];
        if (node.eventMode === "static") {
          const boundary = window.__PIXI_APP__?.renderer?.events?.rootBoundary;
          if (authoredHitCenter !== null) {
            const authoredHit = boundary?.hitTest?.(authoredHitCenter.x, authoredHitCenter.y);
            for (let current = authoredHit; current; current = current.parent) {
              authoredOwnerPath.push(current.label ?? null);
              if (current === node) {
                interactivePoint = authoredHitCenter;
                break;
              }
            }
          }
          const fractions = [0.5, 0.25, 0.75, 0.1, 0.9];
          outer:
          for (const fy of fractions) {
            for (const fx of fractions) {
              if (interactivePoint !== null) break outer;
              const candidate = {
                x: hitBounds.x + hitBounds.width * fx,
                y: hitBounds.y + hitBounds.height * fy,
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
        }
        matches.push({
          bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
          hitBounds: {
            x: hitBounds.x,
            y: hitBounds.y,
            w: hitBounds.width,
            h: hitBounds.height,
          },
          authoredHitCenter,
          authoredOwnerPath,
          interactivePoint,
          eventMode: node.eventMode,
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return matches.at(-1) ?? null;
  }, label);
  const stableBoundsForLabel = async (label) => {
    let previous = null;
    for (let i = 0; i < 80; i++) {
      const current = await targetForLabel(label);
      if (
        current !== null &&
        previous !== null &&
        Math.abs(current.bounds.x - previous.bounds.x) < 0.25 &&
        Math.abs(current.bounds.y - previous.bounds.y) < 0.25 &&
        Math.abs(current.bounds.w - previous.bounds.w) < 0.25 &&
        Math.abs(current.bounds.h - previous.bounds.h) < 0.25 &&
        current.hitBounds.w > 0 &&
        current.hitBounds.h > 0
      ) {
        return current;
      }
      previous = current;
      await page.waitForTimeout(25);
      await advance(25);
    }
    throw new Error(
      `visible Pixi target ${label} did not settle; last bounds ${JSON.stringify(previous)}; ` +
      `browser errors: ${errors.join(" | ") || "none"}`,
    );
  };
  const clickLabel = async (label) => {
    const target = await stableBoundsForLabel(label);
    const bounds = target.hitBounds;
    if (target.eventMode === "static" && target.interactivePoint === null) {
      throw new Error(
        `visible Pixi target ${label} has no event-boundary hit point inside its rendered text bounds: ` +
        JSON.stringify(target),
      );
    }
    const center = target.interactivePoint ?? target.authoredHitCenter ?? {
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
      };
    const point = {
      x: canvasBox.x + center.x,
      y: canvasBox.y + center.y,
    };
    if (process.env.DIB_BROWSER_TRACE === "1") {
      const hitPath = await page.evaluate(({ x, y }) => {
        const boundary = window.__PIXI_APP__?.renderer?.events?.rootBoundary;
        const hit = boundary?.hitTest?.(x, y);
        const path = [];
        for (let node = hit; node; node = node.parent) {
          path.push({
            label: node.label || null,
            text: typeof node.text === "string" ? node.text : null,
            eventMode: node.eventMode,
          });
        }
        return path;
      }, {
        x: center.x,
        y: center.y,
      });
      console.log(`click ${label}: ${JSON.stringify({ ...target, point, hitPath })}`);
    }
    await page.mouse.click(point.x, point.y);
  };
  const monsterPopupLayout = () => page.evaluate(() => {
    const root = window.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    const isVisible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (current.visible === false || current.renderable === false) return false;
      }
      return true;
    };
    const find = (label) => {
      const matches = [];
      const visit = (node) => {
        if (node.label === label && isVisible(node)) matches.push(node);
        for (const child of node.children ?? []) visit(child);
      };
      visit(root);
      return matches.at(-1) ?? null;
    };
    const bounds = (node) => {
      const value = node.getBounds();
      return { x: value.x, y: value.y, w: value.width, h: value.height };
    };
    const destroy = find("destroyMonsterAction");
    const name = find("livingInfoNameLevel");
    const destructive = [
      find("destructiveConfirm:demo-party-1"),
      find("destructiveConfirm:demo-party-2"),
    ].find((node) => node !== null) ?? null;
    const renderer = [
      find("renderable:FireCub"),
      find("renderable:SnowCub"),
    ].find((node) => node !== null && node.parent === destructive) ?? null;
    const particles = find("destroyMonsterParticles");
    return {
      header: destroy && name && destroy.parent === name.parent
        ? {
            destroy: {
              x: destroy.position.x,
              y: destroy.position.y,
              w: destroy.width,
              h: destroy.height,
              bounds: bounds(destroy),
            },
            name: {
              x: name.position.x,
              y: name.position.y,
              w: name.width,
              h: name.height,
              bounds: bounds(name),
            },
          }
        : null,
      destructive: destructive && renderer && particles
        ? {
            renderer: {
              x: renderer.position.x,
              y: renderer.position.y,
              w: renderer.width,
              h: renderer.height,
              bounds: bounds(renderer),
            },
            particles: {
              x: particles.position.x,
              y: particles.position.y,
              bounds: bounds(particles),
              // Source-clamped GL-point extents in normalized port points. `renderSize` also
              // carries FixedStage's browser-only letterbox enlargement, so inspect internal size
              // before presentation scaling. Point systems have one batched Mesh child; start is
              // 32pt on BOTH device tiers — never the per-idiom source-point conversion.
              sizes: Array.from({ length: particles.particleCount }, (_, index) =>
                Math.min(64, particles.debugParticleState(index).size) / 2)
                .sort((a, b) => b - a),
            },
          }
        : null,
    };
  });
  const assertHeaderLayout = async () => {
    const layout = await monsterPopupLayout();
    assert(layout.header, "editable info header did not expose trash and name in one row");
    const expectedGap = expectedDisplayMode === "ipad" ? 10 : 20;
    const sourceRoundingScale = expectedDisplayMode === "ipad" ? 2 : 1;
    const expectedNameX =
      Math.round(
        (layout.header.destroy.x + layout.header.destroy.w + expectedGap) *
          sourceRoundingScale,
      ) / sourceRoundingScale;
    assert(
      Math.abs(layout.header.name.x - expectedNameX) < 0.01,
      `trash-to-name packing is wrong after source roundf: ${JSON.stringify(layout.header)}`,
    );
    assert(
      Math.abs(
        layout.header.name.y + layout.header.name.h / 2 -
          (layout.header.destroy.y + layout.header.destroy.h / 2),
      ) < 0.01,
      `trash and name are not vertically centered in the source header: ${JSON.stringify(layout.header)}`,
    );
  };
  const assertDestructiveLayout = async () => {
    // Let the emitter run past its 1/300s interval so there are real particles to measure; the
    // system saturates its 300-particle cap almost immediately.
    for (let i = 0; i < 2; i++) await advance(25);
    const layout = await monsterPopupLayout();
    assert(layout.destructive, "destructive popup did not expose renderer/fire layout");
    const expectedRendererY = expectedDisplayMode === "ipad" ? 102.5 : 105;
    assert(
      Math.abs(layout.destructive.renderer.y - expectedRendererY) < 0.01,
      `monster renderer is not below the 100pt description at source Y ${expectedRendererY}: ` +
        JSON.stringify(layout.destructive),
    );
    assert(
      Math.abs(
        layout.destructive.particles.y -
          (layout.destructive.renderer.y + layout.destructive.renderer.h)
      ) < 0.01 &&
        Math.abs(
          layout.destructive.particles.x -
            (layout.destructive.renderer.x + layout.destructive.renderer.w / 2),
        ) < 0.01,
      `destructive fire is not on the source renderer's horizontal-center/lower-edge origin: ` +
        JSON.stringify(layout.destructive),
    );


    const sizes = layout.destructive.particles.sizes;
    const minimumSize = expectedDisplayMode === "ipad" ? 4.99 : 9.99;
    assert(
      sizes.length > 0,
      `destructive fire emitted no particles to measure: ${JSON.stringify(layout.destructive)}`,
    );
    assert(
      sizes.every((size) => size <= 32.01 && size >= minimumSize),
      `destructive fire particle extent is outside the source idiom's point-size range ` +
        `(${expectedDisplayMode}): ${JSON.stringify(sizes.slice(0, 8))}`,
    );
    // The freshest particle is already aged by one tick and shrinking toward its idiom finish, so bound rather
    // than pin. The regression this guards produced 64.
    assert(
      sizes[0] >= 28 && sizes[0] <= 32.01,
      `largest destructive fire particle is not near the source 64px/CSF = 32pt start size ` +
        `(${expectedDisplayMode}): ${JSON.stringify(sizes.slice(0, 8))}`,
    );
  };
  const screenshot = async (name) => {
    // Popup.show mounts before its source 0.2s scaleY action completes. Settle it in short
    // deterministic bursts so screenshots document the final composition rather than a flattened
    // in-between frame; keep the bursts small enough for popup-stack assertions to observe depth 3.
    for (let i = 0; i < 9; i++) await advance(25);
    await page.screenshot({ path: path.join(outputDir, name), timeout: 120_000 });
  };

  // Start through the current title/save-select shell; a canvas-center click is not guaranteed to
  // land on the source-shaped title control in every letterboxed display tier.
  await waitForState((value) => value.startup?.phase === "title", "title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitForState(
    (value) => value.startup?.phase === "save-select" || value.mode === "world" || value.mode === "town",
    "title did not advance into the world session",
    240,
  );
  if (snapshot.startup?.phase === "save-select") {
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.mode === "world" || value.mode === "town",
      "save selection did not enter the world session",
      240,
    );
  }
  for (let pageIndex = 0; snapshot.mode === "town" && pageIndex < 20; pageIndex++) {
    await advance(550);
    if ((await targetForLabel("guildQuestChat")) === null) break;
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  if (snapshot.mode === "town") {
    await waitForState((value) => value.overlay === null, "initial town chat did not finish");
    await advance(1_100);
    await clickLabel("town:First_City:exit");
  }
  snapshot = await waitForState((value) => value.mode === "world", "world scene did not open", 240);
  snapshot = await waitForState(
    (value) => !value.chrome.heroXp.expanded && !value.chrome.heroXp.moving,
    "world chrome did not settle",
  );
  assert.equal(snapshot.displayMode, expectedDisplayMode);
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    [
      { instanceId: "demo-party-1", shortType: "FireCub" },
      { instanceId: "demo-party-2", shortType: "SnowCub" },
      { instanceId: "demo-party-3", shortType: "BatSquirrel" },
    ],
  );

  // Open MasterMenu -> Monsters through labeled Pixi targets.
  await clickLabel("worldMenuButton");
  await waitForState((value) => value.menu !== null, "MasterMenu did not open");
  await clickLabel("worldMenu:monsters");
  snapshot = await waitForState(
    (value) => value.overlay?.screen === "partyEditor",
    "style-1 party editor did not open",
    240,
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
  assert.equal(snapshot.tutorial, undefined, "Tutorial4 did not return to the party editor");
  assert.equal(snapshot.overlay.style, 1);
  assert.equal(snapshot.overlay.titleVisible, false);
  assert.equal(snapshot.overlay.reserveRowVisible, false);
  assert.deepEqual(snapshot.overlay.members, ["demo-party-1", "demo-party-2", "demo-party-3"]);
  assert.deepEqual(
    snapshot.overlay.activeIds,
    ["demo-party-1", "demo-party-2", "demo-party-3"],
  );
  assert.deepEqual(
    snapshot.overlay.reserveIds,
    [],
    "menu style 1 must not expose town style 0's real reserve collection",
  );
  const sideCard = snapshot.overlay.coverflow.batting[1];
  assert.equal(sideCard.orbitDeg, 75);
  assert(sideCard.backgroundAlpha < 1, "editable side-card backing did not fade");
  assert.equal(sideCard.contentAlpha, 1, "editable backing alpha incorrectly faded card content");
  assert.equal(sideCard.scaleX, 1, "editable CFlow retained the old affine cosine squeeze");
  const leftHeight = sideCard.projectedQuad.bottomLeft.y - sideCard.projectedQuad.topLeft.y;
  const rightHeight = sideCard.projectedQuad.bottomRight.y - sideCard.projectedQuad.topRight.y;
  assert(
    Math.abs(rightHeight - leftHeight) > 1,
    "editable CFlow source camera did not produce unequal near/far card-edge heights",
  );
  if (paginationOnly) {
    assert.equal(snapshot.overlay.ownedSoulStones, 11);
    assert.equal(snapshot.overlay.popups.depth, 0);
    await clickLabel("partyEditorControl:soulStoneButton");
    snapshot = await waitForState(
      (value) =>
        value.overlay?.popups?.depth === 1 &&
        value.overlay.popups.stack[0].contentLabel === "soulStonePicker",
      "source-paged Insert Soul Stone display did not open",
      240,
    );
    await waitForVisibleText("Pg 1/3");

    const pickerLayout = () => page.evaluate(() => {
      const root = window.__PIXI_APP__?.stage;
      if (!root) throw new Error("Pixi stage is unavailable");
      const visible = (node) => {
        for (let current = node; current; current = current.parent) {
          if (current.visible === false || current.renderable === false) return false;
        }
        return true;
      };
      const nodes = [];
      const visit = (node) => {
        if (visible(node)) nodes.push(node);
        for (const child of node.children ?? []) visit(child);
      };
      visit(root);
      const last = (label) => nodes.filter((node) => node.label === label).at(-1) ?? null;
      const rows = nodes.filter(
        (node) => typeof node.label === "string" && node.label.startsWith("stonePickerRow:"),
      ).sort((a, b) => a.y - b.y);
      const previous = last("soulStonePicker:previous");
      const next = last("soulStonePicker:next");
      const drop = last("popupButton:Drop");
      const insert = last("popupButton:Insert");
      const close = last("soulStonePicker:close");
      const title = last("soulStonePicker:title");
      const main = last("soulStonePicker:main");
      const itemColumn = last("soulStonePicker:items");
      const pageLabel = last("soulStonePicker:pageLabel");
      const authored = (node) => node?.boundsArea == null ? null : {
        w: node.boundsArea.width,
        h: node.boundsArea.height,
      };
      return {
        rows: rows.map((node) => {
          const descendants = [...node.children];
          let value = null;
          while (descendants.length > 0) {
            const descendant = descendants.pop();
            if (descendant?.label?.startsWith("stonePickerStat:")) value = descendant;
            if (descendant?.children) descendants.push(...descendant.children);
          }
          return {
            label: node.label,
            y: node.y,
            h: node.boundsArea.height,
            valueVisibleLocalHeight: value?.getLocalBounds().height ?? null,
            valueScaleY: value?.scale.y ?? null,
          };
        }),
        previous: previous && {
          authored: authored(previous),
          eventMode: previous.eventMode,
          tint: previous.children[0]?.tint,
          x: previous.x,
        },
        next: next && {
          authored: authored(next),
          eventMode: next.eventMode,
          tint: next.children[0]?.tint,
          x: next.x,
        },
        drop: drop && { authored: authored(drop), x: drop.x },
        insert: insert && { authored: authored(insert), x: insert.x },
        close: close && {
          w: close.width,
          h: close.height,
          x: close.x,
          y: close.y,
          anchor: { x: close.anchor?.x, y: close.anchor?.y },
        },
        title: title && {
          // makeTtfLabel bakes at CONTENT_SCALE_FACTOR and scales the node back down, so authored
          // points are fontSize * scale, never the raw style value.
          fontSize: title.style?.fontSize,
          scaleY: title.scale?.y,
          text: title.text,
          x: title.x,
          y: title.y,
        },
        main: main && { y: main.y, h: main.boxContentSize.h },
        itemColumn: itemColumn && { y: itemColumn.y, h: itemColumn.boxContentSize.h },
        pageLabel: pageLabel && {
          text: pageLabel.text,
          anchor: { x: pageLabel.anchor?.x, y: pageLabel.anchor?.y },
          x: pageLabel.x,
          y: pageLabel.y,
        },
        selectedAlpha: Math.max(
          0,
          ...nodes
            .filter((node) => typeof node.label === "string" && node.label.startsWith("stonePickerHighlight:"))
            .map((node) => node.alpha),
        ),
      };
    });

    let layout = await pickerLayout();
    assert.equal(layout.rows.length, expectedDisplayMode === "ipad" ? 5 : 4);
    assert.deepEqual(layout.previous.authored, { w: 22, h: 32 });
    assert.deepEqual(layout.next.authored, { w: 22, h: 32 });
    assert.equal(layout.previous.eventMode, "none");
    assert.equal(layout.previous.tint, 0x505050);
    assert.equal(layout.next.eventMode, "static");
    assert.equal(layout.next.tint, 0xffffff);
    assert.deepEqual(layout.drop.authored, { w: 99.5, h: 26 });
    assert.deepEqual(layout.insert.authored, { w: 99.5, h: 26 });
    assert(
      layout.previous.x < layout.drop.x &&
        layout.drop.x < layout.insert.x &&
        layout.insert.x < layout.next.x,
      `pager controls are not in source order: ${JSON.stringify(layout)}`,
    );
    assert.equal(layout.close.w, 30);
    assert.equal(layout.close.h, 29.5);
    assert.deepEqual(layout.close.anchor, { x: 1, y: 0.5 });
    // idiomPairPt(18, 36) normalizes to the SAME 18 port points in either tier; the raw style
    // value is that bake times CONTENT_SCALE_FACTOR.
    assert.equal(layout.title.fontSize * layout.title.scaleY, 18);
    assert.equal(layout.title.text, "Insert Soul Stone");
    {
      const sourceScale = expectedDisplayMode === "ipad" ? 2 : 1;
      const sourceRound = (value) => Math.round(value * sourceScale) / sourceScale;
      const outlineRadius = expectedDisplayMode === "ipad" ? 1 : 2;
      assert.equal(layout.title.y, -outlineRadius);
      // A tier whose half-height needs no rounding produces a signed zero here, which strict
      // equality would reject against a plain 0.
      const expectedMainY = -(sourceRound(layout.main.h / 2) - layout.main.h / 2);
      assert(
        Math.abs(layout.main.y - expectedMainY) < 1e-9,
        `Soul Stone main Box lost its native half-height rebase: ` +
          `${JSON.stringify(layout.main)} (expected y ${expectedMainY})`,
      );
      assert.equal(
        layout.close.y,
        layout.main.y + (expectedDisplayMode === "ipad" ? 5 : 10),
        `Soul Stone close lost the main Box's signed-origin delta: ${JSON.stringify(layout)}`,
      );
      assert.equal(
        layout.itemColumn.y,
        -(sourceRound(layout.itemColumn.h / 2) - layout.itemColumn.h / 2),
        `Soul Stone columns Box lost its nested half-height rebase: ${JSON.stringify(layout.itemColumn)}`,
      );
    }
    assert.deepEqual(layout.pageLabel, {
      text: "Pg 1/3",
      anchor: { x: 0, y: 0.5 },
      x: expectedDisplayMode === "ipad" ? -11 : -12,
      y: layout.main.y,
    });
    {
      const expectedRowHeight = expectedDisplayMode === "ipad" ? 35.5 : 40;
      const expectedPitch = expectedDisplayMode === "ipad" ? 38 : 45;
      const expectedValueHeight = expectedDisplayMode === "ipad" ? 9 : 11.25;
      for (const row of layout.rows) {
        assert.notEqual(row.valueVisibleLocalHeight, null);
        assert.notEqual(row.valueScaleY, null);
        assert.equal(
          row.h,
          expectedRowHeight,
          `Soul Stone row did not use captured native CCLabelTTF height: ${JSON.stringify(row)}`,
        );
        assert(
          row.valueVisibleLocalHeight * row.valueScaleY > expectedValueHeight,
          `Soul Stone visible outline should exceed its source content frame: ${JSON.stringify(row)}`,
        );
      }
      const pitches = layout.rows.slice(1).map((row, index) => row.y - layout.rows[index].y);
      assert.deepEqual(
        pitches,
        layout.rows.slice(1).map(() => expectedPitch),
        `Soul Stone row pitch drifted from native: ${JSON.stringify(layout.rows)}`,
      );
    }
    assert.deepEqual(snapshot.overlay.popups.stack[0].buttons, []);
    await screenshot("15-soul-stone-picker-page-1.png");

    await clickLabel("soulStonePicker:next");
    await waitForVisibleText("Pg 2/3");
    layout = await pickerLayout();
    assert.equal(layout.rows.length, expectedDisplayMode === "ipad" ? 5 : 4);
    assert.equal(layout.previous.eventMode, "static");
    assert.equal(layout.previous.tint, 0xffffff);
    assert.equal(layout.next.eventMode, "static");
    // Compare the fields this assertion actually pins; the label's y is covered by the main-Box
    // signed-origin checks above rather than restated here.
    assert.deepEqual(
      {
        text: layout.pageLabel.text,
        anchor: layout.pageLabel.anchor,
        x: layout.pageLabel.x,
      },
      {
        text: "Pg 2/3",
        anchor: { x: 0, y: 0.5 },
        x: expectedDisplayMode === "ipad" ? -11 : -12,
      },
    );

    // First tap selects and starts the source white 0->100->0 pulse; it must not insert directly.
    await clickLabel("soulStonePicker:items");
    await advance(500);
    layout = await pickerLayout();
    assert(layout.selectedAlpha > 0, "selected Soul Stone row did not pulse white");
    snapshot = await state();
    assert.equal(snapshot.overlay.ownedSoulStones, 11);
    assert.equal(snapshot.overlay.popups.depth, 1);
    await screenshot("16-soul-stone-picker-page-2-selected.png");

    await clickLabel("popupButton:Insert");
    snapshot = await waitForState(
      (value) =>
        value.overlay?.screen === "partyEditor" &&
        value.overlay.popups.depth === 0 &&
        value.overlay.ownedSoulStones === 10,
      "Insert action did not consume the selected page-two stone",
      240,
    );
    assert(snapshot.party[0].soulStone, "selected stone was not equipped on the centered monster");
    assert.deepEqual(errors, [], errors.join(" | "));
    await screenshot("17-soul-stone-picker-inserted.png");
    console.log(
      `party-editor-actions pagination (${expectedDisplayMode}): PASS ` +
        "(4/5-row pages, page label, arrows, Drop/Insert/X geometry, select-then-insert)",
    );
  } else {
  assert.equal(snapshot.overlay.ownedSoulStones, 0);
  assert.equal(snapshot.overlay.popups.depth, 0);
  await screenshot("01-editor-two-member-party.png");

  // Open FireCub's editable information card.
  await clickLabel("editorCard:demo-party-1");
  snapshot = await waitForState(
    (value) => value.overlay?.popups?.depth === 1,
    "FireCub information popup did not open",
    240,
  );
  await waitForVisibleText("Convert To Soul Stone");
  assert.deepEqual(snapshot.overlay.popups.stack[0].buttons, ["Convert To Soul Stone", "Ok"]);
  assert.equal(snapshot.overlay.popups.stack[0].visible, true);
  await assertHeaderLayout();
  await screenshot("02-firecub-editable-info.png");

  // First Convert attempt: the confirmation owns the top of the scene-scoped popup stack and
  // hides, but does not destroy, the editable information parent.
  await clickLabel("popupButton:Convert To Soul Stone");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 2 &&
      value.overlay.popups.stack[1].contentLabel === "destructiveConfirm:demo-party-1",
    "Convert confirmation did not open above the information popup",
    240,
  );
  assert.equal(snapshot.overlay.popups.stack[0].visible, false);
  assert.equal(snapshot.overlay.popups.stack[1].visible, true);
  assert.deepEqual(
    snapshot.overlay.popups.stack[1].buttons,
    ["DESTROY MY MONSTER FOREVER", "Cancel"],
  );
  await waitForVisibleText(
    "If you pull the soul out of a monster, it will destroy that monster. Are you sure? " +
      "Use the Insert Soul Stone button after you do this to use your new Soul Stone.",
  );
  await assertDestructiveLayout();
  await screenshot("03-convert-confirm-before-cancel.png");

  await clickLabel("popupButton:Cancel");
  snapshot = await waitForState(
    (value) => value.overlay?.popups?.depth === 1,
    "Cancel did not restore the information popup",
  );
  assert.equal(snapshot.overlay.popups.stack[0].visible, true);
  assert.deepEqual(snapshot.overlay.popups.stack[0].buttons, ["Convert To Soul Stone", "Ok"]);
  assert.deepEqual(snapshot.overlay.members, ["demo-party-1", "demo-party-2", "demo-party-3"]);
  assert.equal(snapshot.overlay.ownedSoulStones, 0);
  assert.equal(snapshot.party.length, 3);
  await screenshot("04-info-restored-after-cancel.png");

  // Retry and confirm. Conversion happens before the reveal is mounted. While its 0.2s pop-in is
  // running, all three owned popups coexist: hidden info, hidden confirmation, visible reveal.
  await clickLabel("popupButton:Convert To Soul Stone");
  await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 2 &&
      value.overlay.popups.stack[1].contentLabel === "destructiveConfirm:demo-party-1",
    "second Convert confirmation did not open",
    240,
  );
  await clickLabel("popupButton:DESTROY MY MONSTER FOREVER");
  snapshot = await waitForState(
    (value) =>
      value.party?.length === 2 &&
      value.overlay?.ownedSoulStones === 1 &&
      value.overlay?.popups?.depth === 3,
    "confirmed conversion did not mutate the party and mount its nested stone reveal",
    240,
  );
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    [
      { instanceId: "demo-party-2", shortType: "SnowCub" },
      { instanceId: "demo-party-3", shortType: "BatSquirrel" },
    ],
  );
  assert.deepEqual(snapshot.overlay.members, ["demo-party-2", "demo-party-3"]);
  assert.equal(snapshot.overlay.ownedSoulStones, 1);
  assert.deepEqual(
    snapshot.overlay.popups.stack.map(({ visible }) => visible),
    [false, false, true],
  );
  assert.deepEqual(snapshot.overlay.popups.stack[2].buttons, ["Ok"]);
  await waitForVisibleText("Fire Soul Stone", "converted FireCub did not reveal a Fire Soul Stone");
  await screenshot("05-fire-soul-stone-reveal-nested.png");

  // Once the reveal pop-in completes, the spent confirmation and information parent are removed;
  // the reveal remains the sole top-level modal until its own Ok is invoked.
  snapshot = await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 1 &&
      value.overlay.popups.stack[0].buttons.length === 1 &&
      value.overlay.popups.stack[0].buttons[0] === "Ok",
    "spent Convert popup chain did not collapse to the reveal",
  );
  assert.equal(snapshot.overlay.popups.stack[0].visible, true);
  await clickLabel("popupButton:Ok");
  snapshot = await waitForState(
    (value) => value.overlay?.screen === "partyEditor" && value.overlay.popups.depth === 0,
    "soul-stone reveal did not return to the editor",
  );
  assert.deepEqual(snapshot.overlay.members, ["demo-party-2", "demo-party-3"]);
  assert.equal(snapshot.overlay.ownedSoulStones, 1);
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    [
      { instanceId: "demo-party-2", shortType: "SnowCub" },
      { instanceId: "demo-party-3", shortType: "BatSquirrel" },
    ],
  );
  await screenshot("06-editor-after-confirmed-convert.png");

  // Permanent Destroy uses the image action on the information card. Cancel must restore that
  // exact parent; retry removes SnowCub without minting another stone.
  await clickLabel("editorCard:demo-party-2");
  for (let i = 0; i < 60 && (await state()).overlay?.popups?.depth !== 1; i++) await advance(25);
  if ((await state()).overlay?.popups?.depth !== 1) {
    assert.equal((await state()).overlay?.centeredBattingId, "demo-party-2");
    await clickLabel("editorCard:demo-party-2");
  }
  await waitForState(
    (value) => value.overlay?.popups?.depth === 1,
    "SnowCub information popup did not open",
    240,
  );
  await clickLabel("destroyMonsterAction");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 2 &&
      value.overlay.popups.stack[1].contentLabel === "destructiveConfirm:demo-party-2",
    "Destroy confirmation did not open above the information popup",
    240,
  );
  assert.equal(snapshot.overlay.popups.stack[0].visible, false);
  assert.equal(snapshot.overlay.popups.stack[1].visible, true);
  assert.deepEqual(
    snapshot.overlay.popups.stack[1].buttons,
    ["DESTROY MY MONSTER FOREVER", "Cancel"],
  );
  await waitForVisibleText(
    "WARNING WARNING!!! You can destroy a monster to clean up your party order, but once you " +
      "destroy this monster, it will be gone forever. Are you sure?",
  );
  await assertDestructiveLayout();
  assert.equal(snapshot.party.length, 2);
  assert.equal(snapshot.overlay.ownedSoulStones, 1);
  await screenshot("07-destroy-confirm-before-cancel.png");

  await clickLabel("popupButton:Cancel");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 1 &&
      value.overlay.popups.stack[0].buttons.includes("Convert To Soul Stone"),
    "Cancel did not restore the information popup after Destroy",
  );
  assert.equal(snapshot.overlay.popups.stack[0].visible, true);
  assert.deepEqual(snapshot.overlay.members, ["demo-party-2", "demo-party-3"]);
  assert.equal(snapshot.overlay.ownedSoulStones, 1);
  assert.equal(snapshot.party.length, 2);
  await screenshot("08-info-restored-after-destroy-cancel.png");

  await clickLabel("destroyMonsterAction");
  await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 2 &&
      value.overlay.popups.stack[1].contentLabel === "destructiveConfirm:demo-party-2",
    "second Destroy confirmation did not open",
    240,
  );
  await clickLabel("popupButton:DESTROY MY MONSTER FOREVER");
  snapshot = await waitForState(
    (value) =>
      value.party?.length === 1 &&
      value.overlay?.members?.length === 1 &&
      value.overlay?.popups?.depth === 0,
    "confirmed Destroy did not remove SnowCub and close its popup chain",
    240,
  );
  assert.deepEqual(snapshot.overlay.members, ["demo-party-3"]);
  assert.equal(snapshot.overlay.ownedSoulStones, 1, "Destroy must not mint an item");
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    [{ instanceId: "demo-party-3", shortType: "BatSquirrel" }],
  );
  await screenshot("09-editor-after-confirmed-destroy.png");

  // The remaining monster still exposes Convert, but the action-time source guard interposes
  // before any destructive confirmation or mutation and restores the information parent on Ok.
  await clickLabel("editorCard:demo-party-3");
  for (let i = 0; i < 60 && (await state()).overlay?.popups?.depth !== 1; i++) await advance(25);
  if ((await state()).overlay?.popups?.depth !== 1) {
    assert.equal((await state()).overlay?.centeredBattingId, "demo-party-3");
    await clickLabel("editorCard:demo-party-3");
  }
  await waitForState(
    (value) => value.overlay?.popups?.depth === 1,
    "BatSquirrel information popup did not open",
    240,
  );
  await clickLabel("popupButton:Convert To Soul Stone");
  snapshot = await waitForState(
    (value) => value.overlay?.popups?.depth === 2,
    "last-monster guard popup did not open",
    240,
  );
  assert.equal(snapshot.overlay.popups.stack[0].visible, false);
  assert.equal(snapshot.overlay.popups.stack[1].visible, true);
  assert.deepEqual(snapshot.overlay.popups.stack[1].buttons, ["Ok"]);
  await waitForVisibleText("NO YOU DIDN'T!!!");
  await waitForVisibleText("You cannot destroy your last monster. You would be so lonely...");
  assert.equal(snapshot.party.length, 1);
  assert.equal(snapshot.overlay.ownedSoulStones, 1);
  await screenshot("10-cannot-convert-last-monster.png");

  await clickLabel("popupButton:Ok");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.popups?.depth === 1 &&
      value.overlay.popups.stack[0].buttons.includes("Convert To Soul Stone"),
    "closing the last-monster guard did not restore the information popup",
  );
  assert.equal(snapshot.overlay.popups.stack[0].visible, true);
  assert.deepEqual(snapshot.overlay.members, ["demo-party-3"]);
  assert.equal(snapshot.overlay.ownedSoulStones, 1);
  assert.equal(snapshot.party.length, 1);
  await screenshot("11-info-restored-after-last-monster-guard.png");

  await clickLabel("popupButton:Ok");
  await waitForState(
    (value) => value.overlay?.popups?.depth === 0,
    "remaining information popup did not close",
  );

  // Insert Soul Stone must accept a stone MINTED DURING THIS SESSION. The editor opened with an
  // empty pool, so a texture set keyed only from the opening owned/equipped elements would have no
  // Fire Soul Stone frame and would blank the whole card carousel on refresh.
  //
  // Convert/Destroy cleared this party's leading slots, so the CFlow is still showing a nil slot.
  // Wheel the batting row onto the survivor first — the source's insert acts on the CENTERED card.
  const survivorBounds = (await stableBoundsForLabel("editorCard:demo-party-3")).bounds;
  await page.mouse.move(
    canvasBox.x + survivorBounds.x + survivorBounds.w / 2,
    canvasBox.y + survivorBounds.y + survivorBounds.h / 2,
  );
  for (let i = 0; i < 6 && (await state()).overlay?.centeredBattingId !== "demo-party-3"; i++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(25);
    await advance(25);
  }
  snapshot = await waitForState(
    (value) => value.overlay?.centeredBattingId === "demo-party-3",
    "the batting CFlow never centered on the surviving monster",
  );

  await clickLabel("partyEditorControl:soulStoneButton");
  snapshot = await waitForState(
    (value) => value.overlay?.popups?.depth === 1,
    "Insert Soul Stone picker did not open",
    240,
  );
  // The source-paged rewrite replaced the old generic Cancel row with the title-row close X, so
  // this display carries no popup-level button row at all.
  assert.deepEqual(
    snapshot.overlay.popups.stack[0].buttons,
    [],
    "the source-paged Insert Soul Stone display must not carry a generic popup button row",
  );
  assert.equal(snapshot.overlay.popups.stack[0].contentLabel, "soulStonePicker");

  const stonePicker = await page.evaluate(() => {
    const rows = [];
    const labels = [];
    const visit = (node) => {
      if (typeof node.label === "string" && node.label.startsWith("stonePickerRow:")) {
        rows.push(node.label.slice("stonePickerRow:".length));
      }
      if (typeof node.label === "string" && node.label.startsWith("stonePickerStat:")) {
        labels.push(node.label);
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return { token: rows[0] ?? null, labels };
  });
  const stoneToken = stonePicker.token;
  assert(stoneToken, "the owned-stone picker rendered no selectable row");
  assert.deepEqual(
    stonePicker.labels.map((label) => label.split(":").slice(2, 3)[0]),
    ["Attack"],
    "Fire Soul Stone picker row did not show its source SmallItemDisplay Attack stat",
  );
  assert.match(
    stonePicker.labels[0],
    new RegExp(`^stonePickerStat:${stoneToken}:Attack:[1-9][0-9]*$`),
  );
  await screenshot("12-insert-soul-stone-picker.png");
  // PagedNodeDisplay owns row arbitration. One tap selects; the separate natural Insert button
  // performs the provider action. The old direct row insertion bypassed both source steps.
  await clickLabel("soulStonePicker:items");
  snapshot = await state();
  assert.equal(snapshot.overlay.ownedSoulStones, 1);
  assert.equal(snapshot.overlay.popups.depth, 1);
  await clickLabel("popupButton:Insert");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.screen === "partyEditor" &&
      value.overlay.popups.depth === 0 &&
      value.overlay.ownedSoulStones === 0,
    "inserting the minted stone did not consume it and return to the editor",
    240,
  );
  assert.deepEqual(snapshot.overlay.members, ["demo-party-3"]);
  assert.equal(snapshot.party.length, 1);
  assert.equal(snapshot.party[0].soulStone?.element, "Fire");
  // The equipped item renders immediately, without the close/reopen that used to be required.
  const badge = await targetForLabel("managementItemBadge");
  assert(badge, "the equipped Soul Stone badge did not render on the card");


  const cardBounds = (await stableBoundsForLabel("editorCard:demo-party-3")).bounds;
  const limit = Math.max(cardBounds.w, cardBounds.h) / 5 * 1.1;
  assert(
    badge.bounds.w <= limit && badge.bounds.h <= limit,
    `equipped item badge overflows cardSize/5: badge ${JSON.stringify(badge.bounds)} ` +
      `vs card ${JSON.stringify(cardBounds)}`,
  );
  await screenshot("13-editor-with-equipped-soul-stone.png");

  await clickLabel("partyEditorClose");
  snapshot = await waitForState(
    (value) => value.mode === "world" && value.overlay === null,
    "party editor did not close cleanly",
  );
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    [{ instanceId: "demo-party-3", shortType: "BatSquirrel" }],
  );
  assert.deepEqual(errors, [], errors.join(" | "));
  await screenshot("14-world-after-party-editor-actions.png");

  console.log(
    `party-editor-actions (${expectedDisplayMode}): PASS ` +
      "(nested popup restore, Convert/Destroy cancel+confirm, stone/no-stone, last-monster guard, " +
      "mid-session mint -> Insert Soul Stone)",
  );
  }
} catch (error) {
  if (page !== undefined) {
    try {
      await page.screenshot({
        path: path.join(outputDir, "failure.png"),
        timeout: 120_000,
      });
    } catch {
      // Preserve the original assertion/load error.
    }
  }
  throw error;
} finally {
  await browser.close();
}
