// Opt-in player inventory/Character/Store/Arena choreography. Uses real Pixi pointer input and
// deterministic source time against a caller-selected content package. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_DISPLAY_MODE === "ipad" ? "ipad" : "iphone";
const inventoryHitOnly = process.env.DIB_INVENTORY_HIT_ONLY === "1";
const outputDir = path.resolve(
  import.meta.dirname,
  `../../../../output/player-progression-${displayMode}`,
);
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
  await page.addInitScript(({ displayMode }) => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode,
      textResolutionMode: "modern",
      sound: 0.25,
      music: 0.5,
    }));
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 0x504c4159;
    window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 15;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1", "HaraldDefeated"];
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 20,
      monsterPartyLevels: [20, 20, 20, 20, 20],
      silver: 2_000,
      gold: 1_000,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      highestCapturedLevels: {},
      licenseType: "Apprentice",
      inventory: {
        schemaVersion: 1,
        nextItemSequence: 13,
        looseItems: [
          {
            id: "item-1",
            kind: "gem",
            definitionPath: "Gems.RandomNovice",
            instanceName: "RandomNovice",
            level: 7,
            quality: 0,
            slot: 0,
            enabledStats: ["Resist"],
          },
          {
            id: "item-2",
            kind: "usable",
            definitionPath: "Usables.CardGold",
            instanceName: "CardGold",
            level: 3,
          },
          ...Array.from({ length: 10 }, (_, index) => ({
            id: `item-${index + 3}`,
            kind: "gem",
            definitionPath: "Gems.RandomNovice",
            instanceName: "RandomNovice",
            level: index + 1,
            quality: 0,
            slot: index % 4,
            enabledStats: ["Attack"],
          })),
        ],
        equippedGems: {
          0: {
            id: "item-0",
            kind: "gem",
            definitionPath: "Gems.RandomNovice",
            instanceName: "RandomNovice",
            level: 7,
            quality: 0,
            slot: 0,
            enabledStats: ["Attack"],
          },
        },
      },
      tutorialFlags: ["FirstShop", "FirstCharacterDisplay", "Tutorial0", "Tutorial1"],
    };
  }, { displayMode });
  await page.goto(url);
  await loadLocalContent(page);
  console.log("player-progression: content loaded");

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((delta) => window.advanceTime(delta), ms);
  const waitFor = async (predicate, description, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state();
      if (await predicate(snapshot)) {
        await advance(25);
        return await state();
      }
      await advance(25);
      await page.waitForTimeout(1);
    }
    throw new Error(`${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`);
  };
  const boundsForLabel = (label) => page.evaluate((wanted) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    const matches = [];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && visible(node)) {
        const bounds = node.getBounds();
        matches.push({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
      }
      if (node?.children) stack.push(...node.children);
    }
    return matches.at(-1) ?? null;
  }, label);
  const nodeStateForLabel = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    let match = null;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) {
        const bounds = node.getBounds();
        let effectiveAlpha = 1;
        let effectiveVisible = true;
        let ancestor = node;
        while (ancestor) {
          effectiveAlpha *= ancestor.alpha ?? 1;
          effectiveVisible &&= ancestor.visible !== false;
          ancestor = ancestor.parent;
        }
        match = {
          alpha: node.alpha,
          effectiveAlpha,
          visible: effectiveVisible,
          bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return match;
  }, label);
  const clickLabel = async (label) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    await page.mouse.click(
      canvas.x + bounds.x + bounds.w / 2,
      canvas.y + bounds.y + bounds.h / 2,
    );
  };
  const clickAboveLabel = async (label, pixels = 8) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    const point = { x: bounds.x + bounds.w / 2, y: bounds.y - pixels };
    const hitPath = await page.evaluate(({ x, y }) => {
      const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(x, y);
      const labels = [];
      for (let current = hit; current; current = current.parent) labels.push(current.label ?? null);
      return labels;
    }, point);
    assert(
      hitPath.includes("gemInventoryItems"),
      `Gem row padding point is not owned by the PagedNodeDisplay column: ${JSON.stringify({ point, hitPath })}`,
    );
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    await page.mouse.click(
      canvas.x + point.x,
      canvas.y + point.y,
    );
  };
  // Row taps are routed by the menu that owns them, so emitting on the row node reaches nothing.
  const invokeLabel = (label) => tapPixiLabel(page, label);

  let snapshot;
  await waitFor(
    (value) => value.startup?.phase === "title",
    "startup title did not become interactive",
  );
  console.log("player-progression: title");
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
  console.log("player-progression: town");
  // Town entry publishes before its delayed source chat is mounted.
  await advance(1_000);
  snapshot = await state();
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  assert.equal(snapshot.overlay, null, "town/player progression seams remained covered");
  // CCNotifications is intentionally above automatic presenters. Drain the deterministic day
  // banner before layout captures so it cannot conceal the source top-edge chrome.
  await advance(12_000);
  console.log("player-progression: town ready");
  assert.equal(
    await page.evaluate(() => typeof window.__DIB_TEST_OPEN_INVENTORY__),
    "function",
    "player progression seams were not installed",
  );

  await page.evaluate(() => { void window.__DIB_TEST_OPEN_INVENTORY__(); });
  console.log("player-progression: inventory requested");
  snapshot = await waitFor(
    (value) => value.overlay?.type === 2,
    "general Items inventory did not open",
  );
  assert.equal(snapshot.overlay.entries[0].id, "item-2");
  const inventoryCanvas = await page.locator("canvas").first().boundingBox();
  assert(inventoryCanvas, "inventory canvas was not rendered");
  const inventoryGeometry = await stageGeometry(page, inventoryCanvas);
  {
    const [titleBounds, closeBounds] = await Promise.all([
      boundsForLabel("inventory:title"),
      boundsForLabel("inventory:close"),
    ]);
    assert(titleBounds && closeBounds, "Items title/close chrome was not rendered");
    const centerGapPt = Math.abs(
        titleBounds.y + titleBounds.h / 2 -
          (closeBounds.y + closeBounds.h / 2),
      ) / (2 * inventoryGeometry.scale);
    // iPad's native 36pt title normalizes to 18pt while the bare 10pt close inset normalizes
    // to 5pt, so exact source geometry deliberately does not center these two there.
    assert(
      centerGapPt <= (displayMode === "iphone" ? 4 : 20),
      `Items close chrome was not aligned with the source title row: ${JSON.stringify({ titleBounds, closeBounds, centerGapPt })}`,
    );
  }
  await capture("items.png");
  await page.keyboard.press("Escape");
  await waitFor((value) => value.overlay === null, "Items inventory did not close");

  // Exercise the town-owned touch route itself. TownPOINode accepts both the floating icon and
  // the building sprite; use the house to guard the source `touchableBuildings` branch.
  await clickLabel("town:First_City:building:5");
  snapshot = await waitFor(
    (value) => value.overlay?.config === "HeroManagement",
    "Character management did not open",
  );
  await capture("hero-management.png");
  await invokeLabel("characterManagement:gems");
  snapshot = await waitFor(
    (value) => value.overlay?.child?.type === 0,
    "Gem management child did not open",
  );
  assert(
    snapshot.overlay.child.pageCount >= 3,
    `Gem pagination fixture did not reach the source label gate: ${JSON.stringify(snapshot.overlay.child)}`,
  );
  {
    const pageLayout = await page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      let main = null;
      let label = null;
      let close = null;
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "inventoryMain") main = node;
        if (node?.label === "pagedNodeDisplay:pageNumber") label = node;
        if (node?.label === "inventory:close") close = node;
        if (node?.children) stack.push(...node.children);
      }
      if (main === null || label === null || close === null) return null;
      return {
        sameParent: main.parent === label.parent,
        mainPosition: { x: main.x, y: main.y },
        mainSize: { w: main.boxContentSize.w, h: main.boxContentSize.h },
        anchor: { x: label.anchor.x, y: label.anchor.y },
        position: { x: label.x, y: label.y },
        closePosition: { x: close.x, y: close.y },
        strokeWidth: label.style.stroke?.width ?? 0,
        text: label.text,
      };
    });
    assert(pageLayout, "Gem page-number label/main composition was not mounted");
    assert.equal(pageLayout.sameParent, true, "Gem page number is not a sibling of the main Box");
    assert.deepEqual(pageLayout.anchor, { x: 0, y: 0.5 });
    const sourceScale = displayMode === "ipad" ? 2 : 1;
    const sourceRound = (value) => Math.round(value * sourceScale) / sourceScale;
    const expectedMainY = pageLayout.mainSize.h / 2 - sourceRound(pageLayout.mainSize.h / 2);
    assert.deepEqual(pageLayout.mainPosition, { x: 0, y: expectedMainY });
    const closeInset = displayMode === "ipad" ? 5 : 10;
    assert.deepEqual(pageLayout.closePosition, {
      x: pageLayout.mainSize.w + closeInset,
      y: expectedMainY + closeInset,
    });
    assert.deepEqual(pageLayout.position, {
      x: displayMode === "ipad" ? -11 : -12,
      y: expectedMainY,
    });
    assert.equal(pageLayout.strokeWidth, displayMode === "ipad" ? 4 : 8);
    assert.equal(pageLayout.text, `Pg 1/${snapshot.overlay.child.pageCount}`);
  }
  await clickLabel("inventory:next");
  snapshot = await waitFor(
    (value) => value.overlay?.child?.type === 0 && value.overlay.child.page === 1,
    "Gem page number did not advance with the retained pager",
  );
  await capture("gem-pagination-page-2.png");
  await clickLabel("inventory:previous");
  snapshot = await waitFor(
    (value) => value.overlay?.child?.type === 0 && value.overlay.child.page === 0,
    "Gem pager did not return to the first page",
  );
  {
    const rowLayout = await page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      let column = null;
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "gemInventoryItems") column = node;
        if (node?.children) stack.push(...node.children);
      }
      if (column === null) return null;
      const rows = column.children
        .filter((node) => node?.label?.startsWith("inventoryItem:"))
        .sort((a, b) => a.y - b.y)
        .map((row) => {
          const descendants = [...row.children];
          let value = null;
          while (descendants.length > 0) {
            const node = descendants.pop();
            if (node?.label?.startsWith("inventoryGemBonusValue:")) value = node;
            if (node?.children) descendants.push(...node.children);
          }
          return {
            y: row.y,
            h: row.boxContentSize.h,
            valueVisibleLocalHeight: value?.getLocalBounds().height ?? null,
            valueScaleY: value?.scale.y ?? null,
          };
        });
      return { rows, columnHeight: column.boxContentSize.h };
    });
    assert(rowLayout && rowLayout.rows.length > 1, "Gem row geometry was not mounted");
    const sourceScale = displayMode === "ipad" ? 2 : 1;
    const sourceRound = (value) => Math.round(value * sourceScale) / sourceScale;
    const gap = displayMode === "ipad" ? 2.5 : 5;
    for (const row of rowLayout.rows) {
      assert.notEqual(row.valueVisibleLocalHeight, null);
      assert.notEqual(row.valueScaleY, null);
      // Pixi's 2pt-per-side outline contributes four visible points after the Text's 0.5 scale;
      // native CCLabelTTF contentSize excludes that separate outline child entirely.
      const bareValueHeight = row.valueVisibleLocalHeight * row.valueScaleY - 4;
      assert.equal(row.h, sourceRound(24 + gap + bareValueHeight));
    }
    const pitches = rowLayout.rows.slice(1).map((row, index) => row.y - rowLayout.rows[index].y);
    assert.deepEqual(
      pitches,
      rowLayout.rows.slice(1).map((_row, index) =>
        sourceRound(rowLayout.rows[index].h + gap)),
      `Gem row pitch includes outline padding: ${JSON.stringify(rowLayout)}`,
    );
  }
  {
    const [instruction, titleBounds, closeBounds] = await Promise.all([
      nodeStateForLabel("licenseDisplay:instruction"),
      boundsForLabel("inventory:title"),
      boundsForLabel("inventory:close"),
    ]);
    assert(instruction && instruction.alpha > 0.99, "Gem license guidance did not begin visible");
    assert(titleBounds && closeBounds, "Gem title/close chrome was not rendered");
    const centerGapPt = Math.abs(
        titleBounds.y + titleBounds.h / 2 -
          (closeBounds.y + closeBounds.h / 2),
      ) / (2 * inventoryGeometry.scale);
    assert(
      centerGapPt <= (displayMode === "iphone" ? 4 : 20),
      `Gem close chrome was not aligned with the source title row: ${JSON.stringify({ titleBounds, closeBounds, centerGapPt })}`,
    );
  }
  await capture("gem-instruction.png");
  // PagedNodeDisplay runs each full authored SmallItemDisplay wrapper through the shared 55pt
  // minimum. Probe the unobstructed padding above the first row, outside its painted bounds.
  await clickAboveLabel("inventoryItem:item-1");
  await advance(500);
  {
    const selected = await nodeStateForLabel("inventoryHighlight:item-1");
    assert(
      selected && selected.alpha > 0.15,
      `selected Gem rectangle did not enter its visible flash phase: ${JSON.stringify({
        selected,
        overlay: (await state()).overlay,
      })}`,
    );
  }
  await capture("gem-selected.png");
  await advance(3_500);
  assert.equal(
    (await nodeStateForLabel("licenseDisplay:instruction"))?.alpha,
    0,
    "Gem license guidance did not finish its source 3s hold + 1s fade",
  );
  // Give Pixi one ordinary frame after the intentionally large deterministic jump before
  // reading the canvas back; otherwise Chromium can expose a transient stale Text texture.
  await advance(25);
  await clickLabel("inventoryItem:item-1");
  await waitFor(
    async () => await boundsForLabel("inventoryItemInfo:title") !== null,
    "selected Gem information did not open",
  );
  await advance(250);
  await capture("gem-info.png");
  await clickLabel("popupButton:Ok");
  await waitFor(
    async () => await boundsForLabel("inventoryItemInfo:title") === null,
    "selected Gem information did not close",
  );
  if (inventoryHitOnly) {
    assert.deepEqual(errors, []);
    console.log(`player-progression: PASS (${displayMode}; inventory 55pt padding hit)`);
  } else {
  await clickLabel("popupButton:Add");
  snapshot = await waitFor(
    (value) => value.overlay?.child?.equipped?.includes("item-1"),
    "Gem did not move into the Novice license slot",
  );
  await advance(250);
  assert.equal(
    (await nodeStateForLabel("licenseDisplay:instruction"))?.alpha,
    0,
    "Gem mutation rebuild replayed the one-shot license guidance",
  );
  await capture("gem-equipped.png");
  await clickLabel("inventoryItem:item-0");
  await waitFor(
    async () =>
      await boundsForLabel("popupButton:Add") !== null &&
      await boundsForLabel("popupButton:Remove") === null,
    "displaced Gem did not switch the action back to Add",
  );
  await clickLabel("popupButton:Add");
  await waitFor(
    (value) =>
      value.overlay?.child?.equipped?.includes("item-0") &&
      value.overlay?.child?.entries?.some(({ id }) => id === "item-1"),
    "displaced Gem could not be selected and equipped again",
  );
  await capture("gem-displaced-readded.png");
  await page.keyboard.press("Escape");
  await waitFor(
    (value) => value.overlay?.config === "HeroManagement" && value.overlay?.child === null,
    "Gem child did not return to retained Character management",
  );
  await advance(250);
  await invokeLabel("characterManagement:skills");
  snapshot = await waitFor(
    (value) => value.overlay?.child?.open === true && value.overlay?.child?.stats,
    "Skills child did not open",
  );
  await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    let icon = null;
    let art = null;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "characterSkills:Attack:info") icon = node;
      if (node?.label === "characterSkills:Attack:plusArt") art = node;
      if (node?.children) stack.push(...node.children);
    }
    if (icon === null || art === null || icon.parent !== art.parent) {
      throw new Error("Attack stat icon/plus art are not one source-equivalent composition");
    }
    const scale = (node) => Math.hypot(node.worldTransform.a, node.worldTransform.b);
    if (Math.abs(scale(icon) - scale(art)) > 1e-6) {
      throw new Error("Attack stat icon inherited an extra retina scale");
    }
    if (icon.parent.getChildIndex(icon) >= art.parent.getChildIndex(art)) {
      throw new Error("Attack stat icon is not painted behind the plus art");
    }
  });
  const beforeFree = snapshot.overlay.child.pointsFree;
  await clickLabel("characterSkills:Attack:plus");
  snapshot = await waitFor(
    (value) => value.overlay?.child?.stats?.find(({ stat }) => stat === "Attack")?.invested === 1,
    "Attack skill increment did not persist",
  );
  assert.equal(snapshot.overlay.child.pointsFree, beforeFree - 1);
  await capture("skills.png");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitFor((value) => value.overlay === null, "Character management did not close");

  await page.evaluate(() => { void window.__DIB_TEST_OPEN_STORE__(); });
  snapshot = await waitFor((value) => value.overlay?.category === 0, "Store did not open");
  {
    const adjacent = await nodeStateForLabel("store:card:1");
    assert(
      adjacent && adjacent.visible && adjacent.effectiveAlpha > 0,
      "Store CFlow did not render the adjacent category",
    );
  }
  await clickLabel("store:selection");
  await waitFor((value) => value.overlay?.category === 1, "Items store category did not open");
  {
    const adjacent = await nodeStateForLabel("store:card:1");
    assert(
      adjacent && adjacent.visible && adjacent.effectiveAlpha > 0,
      "Store CFlow did not render adjacent stock",
    );
  }
  await clickLabel("store:buy");
  await waitFor(
    async () => await boundsForLabel("popupButton:Purchase") !== null,
    "Store confirmation did not open",
  );
  await clickLabel("popupButton:Purchase");
  snapshot = await waitFor(
    (value) => value.overlay?.balances?.silver === 1_950,
    "Card purchase did not debit exact Silver price",
  );
  await capture("store-purchased.png");
  await waitFor(
    async () => await boundsForLabel("dungeonLootPage") !== null,
    "Purchased card did not enter New Items",
  );
  await clickLabel("popupButton:Take All");
  await waitFor(
    async () => await boundsForLabel("dungeonLootPage") === null,
    "New Items did not close after Take All",
  );
  await clickLabel("store:close");
  await waitFor((value) => value.overlay?.category === 0, "Store did not return to its category root");
  await clickLabel("store:close");
  await waitFor((value) => value.overlay === null, "Store did not close");

  await page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await waitFor(
    async () => await boundsForLabel("guildQuestChatFinish") !== null,
    "Arena greeting did not open",
  );
  await advance(550);
  await invokeLabel("guildQuestChat");
  snapshot = await waitFor((value) => value.overlay?.open === true && value.overlay?.buttons, "Arena menu did not open");
  assert.equal(snapshot.overlay.currentLicense, "Apprentice");
  assert.equal(snapshot.overlay.qualification.qualifies, true);
  {
    const arenaBackground = await nodeStateForLabel("sourceFullscreen:ArenaCombat");
    assert(arenaBackground, "Arena full-screen background was not rendered");
    assert(
      arenaBackground.bounds.w >= snapshot.stagePx.w &&
      arenaBackground.bounds.h >= snapshot.stagePx.h,
      "Arena background did not cover the complete logical stage",
    );
  }
  await capture("arena-menu.png");
  await invokeLabel("arena:tournament");
  snapshot = await waitFor(
    (value) =>
      value.sceneFade?.route === "arena-tournament" && value.sceneFade.phase === "covering",
    "Arena did not retain the town through the Tournament fade-in",
  );
  assert.equal(snapshot.overlay, null, "Tournament bracket replaced the town before midpoint");
  snapshot = await waitFor(
    (value) =>
      value.overlay?.kind === "tournament" &&
      value.sceneFade?.route === "arena-tournament" &&
      value.sceneFade.phase === "revealing",
    "Tournament bracket did not swap at the opaque midpoint",
  );
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "tournament" && value.sceneFade === undefined,
    "Tournament bracket fade did not finish",
  );
  assert.equal(snapshot.overlay.index, 0);
  assert.equal(snapshot.overlay.round, 0);
  assert.equal(snapshot.overlay.status, 0);
  assert.equal(snapshot.overlay.buttons.find(({ action }) => action === "primary")?.enabled, true);
  {
    const tournamentBackground = await nodeStateForLabel("sourceFullscreen:saveSlotBackground");
    assert(tournamentBackground, "Tournament full-screen background was not rendered");
    assert(
      tournamentBackground.bounds.w >= snapshot.stagePx.w &&
      tournamentBackground.bounds.h >= snapshot.stagePx.h,
      "Tournament background did not cover the complete logical stage",
    );
  }
  await capture("tournament-bracket.png");
  await invokeLabel("tournament:primary");
  await waitFor(
    async () => {
      const shade = await nodeStateForLabel("sourceBlackSceneFade:tournament-battle");
      return shade !== null && shade.effectiveAlpha > 0;
    },
    "Tournament battle did not begin its source black scene fade",
  );
  snapshot = await waitFor(
    async () => await boundsForLabel("guildQuestChatFinish") !== null,
    "Tournament challenger chat did not open",
    15_000,
  );
  assert.equal(snapshot.mode, "battle", "\"Fight!\" appeared before BattleNode became active");
  {
    const [battleScene, dim, ownership] = await Promise.all([
      nodeStateForLabel("battleScene"),
      nodeStateForLabel("guildQuestChatDim"),
      page.evaluate(() => {
        const stack = [window.__PIXI_APP__.stage];
        let chat = null;
        while (stack.length > 0) {
          const node = stack.pop();
          if (node?.label === "guildQuestChat") chat = node;
          if (node?.children) stack.push(...node.children);
        }
        return chat === null ? null : {
          parentLabel: chat.parent?.label ?? null,
          zIndex: chat.zIndex,
        };
      }),
    ]);
    assert(battleScene, "Tournament challenger chat appeared without a built battle scene");
    assert(
      battleScene.bounds.w >= snapshot.stagePx.w &&
      battleScene.bounds.h >= snapshot.stagePx.h,
      "Tournament battle interface did not cover the complete logical stage before the chat",
    );
    assert(dim, "Tournament challenger chat dim was not rendered");
    assert(
      dim.bounds.w >= snapshot.stagePx.w && dim.bounds.h >= snapshot.stagePx.h,
      "Tournament challenger chat used unscaled device-stage geometry",
    );
    assert.deepEqual(
      ownership,
      { parentLabel: "directorAutomaticPopupLayer", zIndex: 20_000 },
      "Tournament challenger chat was not routed through the director-owned automatic popup band",
    );
  }
  await advance(550);
  await invokeLabel("guildQuestChat");
  snapshot = await waitFor(
    (value) => value.mode === "battle" && value.presentation?.state !== "building",
    "Tournament battle did not start",
  );
  assert.equal(snapshot.encounter.backgroundKey, "ArenaCombat");
  assert.equal(snapshot.encounter.allowRetreat, false);
  await capture("tournament-battle.png");

  assert.deepEqual(errors, []);
  console.log("player-progression: PASS");
  }
} catch (error) {
  fs.writeFileSync(
    path.join(outputDir, "failure.txt"),
    error instanceof Error ? error.stack ?? error.message : String(error),
  );
  throw error;
} finally {
  await browser.close();
}
