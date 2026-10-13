// Opt-in source-format Guild/Tavern UI contract. Run only with operator authorization and set
// DIB_CONTENT_ARCHIVE to an original-format archive containing First_City, Menus.Tavern, and the
// shipped quest presentation assets. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const verifyDurability = process.env.DIB_GUILD_DURABILITY === "1";
const claimEggReward = process.env.DIB_GUILD_EGG_CLAIM === "1" || verifyDurability;
assert(
  displayMode === "iphone" || displayMode === "ipad",
  `DIB_DISPLAY_MODE must be iphone or ipad, got ${displayMode}`,
);
const outputDir = path.resolve(
  import.meta.dirname,
  `../../../../output/guild-quest-ui-browser-${displayMode}`,
);
fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  channel: "chromium",
  headless: process.env.DIB_HEADED !== "1",
  args: ["--enable-unsafe-swiftshader", "--mute-audio", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript((mode) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: mode,
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 20260727;
    // This UI-only fixture starts after the staged Leslie rescue. Normal fresh games no longer
    // pre-seed this flag; they earn it through the Field 1 win chat.
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieSaved"];
  }, displayMode);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const durable = () => page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) => key.startsWith("dib-save-v1:") && key.endsWith(":slot-1"));
    if (!entry) throw new Error("Missing durable Offline slot-1");
    return JSON.parse(entry[1]);
  });
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const waitForState = async (predicate, description, iterations = 180) => {
    for (let i = 0; i < iterations; i++) {
      const snapshot = await state();
      if (predicate(snapshot)) {
        await advance(25);
        return await state();
      }
      await page.waitForTimeout(25);
      await advance(25);
    }
    throw new Error(
      `${description}; browser errors: ${errors.join(" | ") || "none"}; ` +
      `final state: ${JSON.stringify(await state())}`,
    );
  };
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  const boundsForLabel = async (label) => page.evaluate((wanted) => {
    const root = globalThis.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const matches = [];
    const visit = (node) => {
      if (node.label === wanted && visible(node)) {
        const bounds = node.getBounds();
        matches.push({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return matches.at(-1) ?? null;
  }, label);
  const clickLabel = async (label) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    await page.mouse.click(
      box.x + bounds.x + bounds.w / 2,
      box.y + bounds.y + bounds.h / 2,
    );
  };
  const activatePixiControl = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && node.visible && node.renderable) {
        const bounds = node.getLocalBounds();
        const local = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const event = { getLocalPosition: () => local, stopPropagation: () => {} };
        node.emit("pointerdown", event);
        node.emit("pointerup", event);
        node.emit("pointertap", event);
        return true;
      }
      stack.push(...(node?.children ?? []));
    }
    return false;
  }, label);
  const layoutForLabel = async (label) => page.evaluate((wanted) => {
    const root = globalThis.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    const matches = [];
    const bounds = (node) => {
      const value = node.getBounds();
      return { x: value.x, y: value.y, w: value.width, h: value.height };
    };
    const visit = (node) => {
      if (node.label === wanted) {
        matches.push({
          bounds: bounds(node),
          position: { x: node.position.x, y: node.position.y },
          scale: { x: node.scale.x, y: node.scale.y },
          hitArea: node.hitArea === null
            ? null
            : {
                x: node.hitArea.x ?? 0,
                y: node.hitArea.y ?? 0,
                w: node.hitArea.width ?? 0,
                h: node.hitArea.height ?? 0,
              },
          children: (node.children ?? []).map((child) => ({
            label: child.label || null,
            bounds: bounds(child),
          })),
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return matches.at(-1) ?? null;
  }, label);
  const assertContained = (inner, outer, description, epsilon = 0.01) => {
    assert(
      inner.x >= outer.x - epsilon &&
        inner.y >= outer.y - epsilon &&
        inner.x + inner.w <= outer.x + outer.w + epsilon &&
        inner.y + inner.h <= outer.y + outer.h + epsilon,
      `${description}: inner=${JSON.stringify(inner)} outer=${JSON.stringify(outer)}`,
    );
  };

  await waitForState(
    (value) => value.startup?.phase === "title",
    "startup title did not become interactive",
  );
  await page.keyboard.press("Enter");
  let createdFresh = false;
  let snapshot = await waitForState(
    (value) =>
      value.startup?.phase === "new-game-plot" ||
      value.mode === "town" ||
      value.mode === "world",
    "startup did not select or create the first slot",
    480,
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    createdFresh = true;
    await advance(2_050);
    await page.keyboard.press("Enter");
    await waitForState(
      (value) => value.startup?.phase === "pick-dragon",
      "intro plot did not open the starter picker",
      480,
    );
    await page.keyboard.press("1");
    snapshot = await waitForState(
      (value) => value.mode === "town" || value.mode === "world",
      "starter selection did not enter the world session",
      480,
    );
  }
  if (createdFresh && snapshot.mode === "town") {
    snapshot = await waitForState(
      (value) => value.overlay?.kind === "townEnterChat",
      "fresh town did not present its introductory chat",
      480,
    );
  }
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  if (snapshot.mode === "town") {
    await waitForState((value) => value.overlay === null, "initial town chat did not finish");
    await advance(8_000);
    await clickLabel("town:First_City:exit");
    snapshot = await waitForState(
      (value) => value.mode === "world" && !value.locked,
      "fresh town did not release the world",
      480,
    );
  }
  assert.equal(snapshot.mode, "world", "world did not become interactive");
  if (snapshot.tutorial?.key === "Tutorial2") {
    snapshot = await waitForState(
      (value) => value.tutorial?.key === "Tutorial2" && value.tutorial.okReady,
      "field movement tutorial did not become dismissible",
      480,
    );
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.mode === "world" && value.tutorial === undefined,
      "field movement tutorial did not close",
      480,
    );
  }

  // The MasterMenu route must be active before any quest is accepted.
  await page.keyboard.press("Escape");
  snapshot = await waitForState(
    (value) => value.menu?.config === "MasterMenu",
    "MasterMenu did not open",
  );
  assert.equal(
    snapshot.menu.buttons.find(({ action }) => action === "quests")?.enabled,
    true,
    "Quests row remained disabled",
  );

  // Use the normal source-facing portal route to enter the post-tutorial demo's First_City.
  await clickLabel("worldMenu:townPortal");
  snapshot = await waitForState(
    (value) => value.mode === "town" && value.town?.name === "First_City" && !value.locked,
    "First_City did not become interactive",
    300,
  );
  if (createdFresh) {
    snapshot = await waitForState(
      (value) => value.overlay?.kind === "townEnterChat",
      "post-tutorial Corova story chat did not appear",
      480,
    );
  }
  if (snapshot.overlay?.kind === "townEnterChat") {
    for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
      await advance(550);
      await clickLabel("guildQuestChat");
      snapshot = await state();
    }
    snapshot = await waitForState(
      (value) => value.mode === "town" && value.overlay === null,
      "post-tutorial Corova story chat did not finish",
      480,
    );
  }
  assert.equal(snapshot.displayMode, displayMode);
  const tavern = snapshot.town.buildings.find(
    ({ className }) => className === "TavernMenuItem",
  );
  assert(tavern, "First_City has no parsed TavernMenuItem");
  assert.equal(tavern.enabled, true, "Guild of Corova remained inactive");

  // Clear the source-timed arrival/day notification before measuring the independently-owned
  // Tavern overlay.
  await advance(8_000);
  assert(
    await activatePixiControl("town:First_City:menu:TavernMenuItem"),
    "Guild of Corova control was not mounted",
  );
  snapshot = await waitForState(
    (value) => value.overlay?.kind === "guildQuests" && value.overlay.tavernOpen,
    "Guild of Corova Tavern did not open",
  );
  assert.equal(snapshot.overlay.mode, "tavern");
  assert(snapshot.overlay.availableCount > 0);
  const sourceAbsentTavernTitleCount = await page.evaluate(() => {
    const stack = [globalThis.__PIXI_APP__?.stage];
    let count = 0;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.text === "Ye Ole Tavern") count += 1;
      stack.push(...(node?.children ?? []));
    }
    return count;
  });
  assert.equal(
    sourceAbsentTavernTitleCount,
    0,
    `${displayMode} Tavern rendered TavernTitleKey even though activate: passes a nil title`,
  );
  const tavernActionBounds = await Promise.all([
    "guildTavern:newQuest",
    "guildTavern:claimReward",
    "guildTavern:dropQuests",
    "guildTavern:myQuests",
  ].map(boundsForLabel));
  assert(tavernActionBounds.every((bounds) => bounds !== null), "Tavern action matrix is incomplete");
  const actionTop = Math.min(...tavernActionBounds.map((bounds) => bounds.y));
  const actionBottom = Math.max(...tavernActionBounds.map((bounds) => bounds.y + bounds.h));
  const sourceScreenCenterY = box.height / 2;
  assert(
    Math.abs((actionTop + actionBottom) / 2 - sourceScreenCenterY) < 0.02,
    `${displayMode} Tavern action matrix retained a source-absent title slot`,
  );
  const tavernBackground = await boundsForLabel("guildTavernBackground");
  assert(tavernBackground, "Guild of Corova background was unavailable");
  assert(
    Math.abs(tavernBackground.w / tavernBackground.h - 4 / 3) < 1e-6,
    `${displayMode} Tavern rendered the full square POT texture instead of the source 1024x768 crop: ` +
      JSON.stringify(tavernBackground),
  );
  const newQuestLayout = await layoutForLabel("guildTavern:newQuest");
  assert(newQuestLayout, "New Quest layout was unavailable");
  const newQuestBackground = newQuestLayout.children[0]?.bounds;
  const availableBadge = newQuestLayout.children.find(
    ({ label }) => label === "guildTavernBadge:available",
  )?.bounds;
  assert(newQuestBackground, "New Quest plate was unavailable");
  assert(availableBadge, "New Quest notification badge was unavailable");
  assertContained(
    availableBadge,
    newQuestBackground,
    `${displayMode} New Quest badge escaped its source MenuButton2 plate`,
  );
  await page.screenshot({
    path: path.join(outputDir, "guild-of-corova.png"),
    timeout: 120_000,
  });

  // Source New Quest immediately starts the first authored town quest, then presents its Chat.
  await clickLabel("guildTavern:newQuest");
  snapshot = await waitForState(
    (value) => value.overlay?.chatOpen &&
      value.overlay.activeQuestNames?.[0] === "MacworldCatch" &&
      value.guildQuests?.notification?.kind === "accepted",
    "New Quest did not start and describe MacworldCatch",
  );
  assert.match(snapshot.guildQuests.notification.title, /^Quest .+ Accepted! \(1\/3 quests\)$/);
  assert.equal(
    snapshot.guildQuests.notification.message,
    "Return to town once you finish the quest.",
  );
  const chatText = await boundsForLabel("guildQuestChatText");
  const chatBackground = await boundsForLabel("guildQuestChatBackground");
  assert(chatText, "quest chat text was unavailable");
  assert(chatBackground, "quest chat background was unavailable");
  assertContained(
    chatText,
    chatBackground,
    `${displayMode} quest chat text escaped Dialogs.Chat`,
  );
  await advance(500);
  await clickLabel("guildQuestChat");
  await waitForState(
    (value) => value.overlay?.kind === "guildQuests" && !value.overlay.chatOpen,
    "quest description Chat did not dismiss",
  );

  // The notification renderer is shared by local quest callbacks and committed Official events.
  // Complete the active capture objective through the deterministic quest-event seam and prove
  // that completion still uses the source progress banner rather than a second completion notice.
  await advance(3_500);
  await page.evaluate(() => {
    window.__DIB_TEST_FIRE_GUILD_QUEST_EVENT__({
      id: 7,
      monsterShortType: "Goblin",
    });
  });
  snapshot = await waitForState(
    (value) =>
      value.guildQuests?.notification?.kind === "progress" &&
      value.guildQuests.notification.questName === "MacworldCatch",
    "quest progress did not enqueue its source notification",
  );
  assert.equal(snapshot.guildQuests.notification.message, "Monsters caught: 1 of 1");
  await advance(550);
  await page.screenshot({
    path: path.join(outputDir, "quest-progress-notification.png"),
    timeout: 120_000,
  });

  if (claimEggReward) {
    // MacworldCatch awards the standard Egg. Claim it while the Tavern remains open and prove
    // Player.hatchEgg's director-notification presentation sits above that live scene interface.
    await clickLabel("guildTavern:claimReward");
    let takeAll = null;
    for (let index = 0; index < 180 && takeAll === null; index += 1) {
      await advance(25);
      await page.waitForTimeout(1);
      takeAll = await boundsForLabel("popupButton:Take All");
    }
    assert(takeAll, "claimed Guild reward did not open the shared loot provider");
    if (verifyDurability) {
      await page.waitForTimeout(100);
      const saved = await durable();
      fs.writeFileSync(path.join(outputDir, "pending-loot-save.json"), JSON.stringify(saved, null, 2));
      assert(saved.state.quests.activeQuestNames.includes("MacworldCatch"), "Offline save consumed the quest before its reward was collected");
      assert(!saved.state.quests.finishedQuestNames.includes("MacworldCatch"));
    }


    await waitForState(
      (value) => value.overlay?.kind === "guildQuests" && value.overlay.chatOpen === true,
      "claiming a Guild reward did not stack TavernQuestFinished over the loot provider",
    );
    const claimLayering = await page.evaluate(() => {
      const find = (wanted) => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length > 0) {
          const node = stack.pop();
          if (node?.label === wanted) return node;
          stack.push(...(node?.children ?? []));
        }
        return null;
      };
      const chat = find("guildQuestChat");
      const host = find("notificationPopupHost");
      return {
        chatVisible: chat?.visible === true,
        siblings: chat?.parent != null && chat.parent === host?.parent,
        chatZ: chat?.zIndex ?? null,
        hostZ: host?.zIndex ?? null,
      };
    });
    assert.equal(claimLayering.chatVisible, true, "TavernQuestFinished chat was not visible");
    assert.equal(
      claimLayering.siblings,
      true,
      `chat and loot popup did not share the notification layer: ${JSON.stringify(claimLayering)}`,
    );
    assert(
      claimLayering.chatZ > claimLayering.hostZ,
      `chat did not draw over the loot popup: ${JSON.stringify(claimLayering)}`,
    );
    assert(
      await boundsForLabel("popupButton:Take All"),
      "loot provider stopped drawing while the Guild spoke",
    );


    await clickLabel("popupButton:Take All");
    snapshot = await state();
    assert.equal(
      snapshot.overlay?.chatOpen,
      true,
      "an early press through the Guild chat closed it",
    );
    assert(
      await boundsForLabel("popupButton:Take All"),
      "an early press leaked through the Guild chat to Take All",
    );

    // Past the fade the same press lands on the chat, which uncovers the reward still waiting.
    await advance(500);
    await clickLabel("popupButton:Take All");
    await waitForState(
      (value) => value.overlay?.kind === "guildQuests" && !value.overlay.chatOpen,
      "TavernQuestFinished chat did not dismiss",
    );
    assert(
      await boundsForLabel("popupButton:Take All"),
      "loot provider did not survive the Guild chat it was presented under",
    );

    await clickLabel("popupButton:Take All");
    snapshot = await waitForState(
      (value) => value.overlay?.kind === "silver" && value.overlay.phase === "rolling",
      "Guild Egg did not become the active notification-layer reel",
      480,
    );
    assert.deepEqual(
      snapshot.guildQuests.completedActiveQuestNames,
      [],
      "Guild completed reward count remained stale while its Egg reel was open",
    );
    const layering = await page.evaluate(() => {
      const find = (wanted) => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length > 0) {
          const node = stack.pop();
          if (node?.label === wanted) return node;
          stack.push(...(node?.children ?? []));
        }
        return null;
      };
      const egg = find("eggHatch:silver");
      const tavern = find("guildTavern");
      const completedBadge = find("guildTavernBadge:completed");
      const ancestors = [];
      for (let node = egg?.parent; node; node = node.parent) ancestors.push(node.label ?? "");
      return {
        eggVisible: egg?.visible === true,
        tavernStillMounted: tavern?.parent !== null,
        completedBadgeVisible: completedBadge?.visible === true,
        ancestors,
      };
    });
    assert.equal(layering.eggVisible, true);
    assert.equal(layering.tavernStillMounted, true);
    assert.equal(layering.completedBadgeVisible, false);
    assert(
      layering.ancestors.includes("directorAutomaticPopupLayer"),
      `Egg did not mount on CCDirector.notificationNode counterpart: ${JSON.stringify(layering)}`,
    );
    assert.deepEqual(errors, [], errors.join(" | "));
    if (verifyDurability) {
      const pending = await durable();
      assert(pending.state.quests.activeQuestNames.includes("MacworldCatch"), "Egg continuation must retain the pre-claim recovery snapshot");
      fs.writeFileSync(path.join(outputDir, "pending-egg-save.json"), JSON.stringify(pending, null, 2));
      await page.screenshot({ path: path.join(outputDir, "pending-egg.png") });
      const reelBounds = await boundsForLabel("eggHatch:silver");
      assert(reelBounds);
      await page.mouse.move(box.x + reelBounds.x + reelBounds.w / 2, box.y + reelBounds.y + reelBounds.h / 2);
      await page.mouse.down();
      await advance(1_600);
      await page.mouse.up();
      for (let i = 0; i < 1000; i++) {
        const saved = await durable();
        if (saved.state.quests.finishedQuestNames.includes("MacworldCatch")) break;
        const label = (await boundsForLabel("popupButton:Keep")) ? "popupButton:Keep"
          : (await boundsForLabel("popupButton:No")) ? "popupButton:No"
          : (await boundsForLabel("popupButton:Ok")) ? "popupButton:Ok" : null;
        await advance(100);
        await page.waitForTimeout(2);
        if (label) { await advance(300); await clickLabel(label); }
      }
      const settled = await durable();
      fs.writeFileSync(path.join(outputDir, "settlement-state.json"), JSON.stringify(await state(), null, 2));
      await page.screenshot({ path: path.join(outputDir, "settlement-state.png") });
      assert(settled.state.quests.finishedQuestNames.includes("MacworldCatch"), "Claim did not persist after the Egg settled");
      assert(!settled.state.quests.activeQuestNames.includes("MacworldCatch"));
      assert.notDeepEqual(settled.state.player, pending.state.player, "Claim persisted without its Egg prize");
      fs.writeFileSync(path.join(outputDir, "settled-egg-save.json"), JSON.stringify(settled, null, 2));
      await page.screenshot({ path: path.join(outputDir, "settled-egg.png") });
      await page.reload({ waitUntil: "domcontentloaded" });
      await loadLocalContent(page);
      await waitForState(s => s.startup?.phase === "title", "reloaded title");
      await advance(500); await page.keyboard.press("Enter");
      await waitForState(s => s.startup?.phase === "save-select", "reloaded save selector");
      await advance(300); await clickLabel("sourcePopupButton:slot-1");
      const resumed = await waitForState(s => s.guildQuests !== undefined, "reloaded quest state", 600);
      assert(resumed.guildQuests.finishedQuestNames.includes("MacworldCatch"));
      const restored = await durable();
      assert.deepEqual(restored.state.player.profile.inventory, settled.state.player.profile.inventory);
      assert.equal(restored.state.player.profile.silver, settled.state.player.profile.silver);
      assert.equal(restored.state.player.profile.gold, settled.state.player.profile.gold);
      assert.deepEqual(errors, []);
      console.log("guild-quest-ui: PASS (Offline pending loot/Egg recovery snapshot, atomic settlement, reload)");
    }
    console.log(`guild-quest-ui: PASS (${displayMode}; live-Tavern Egg layering + immediate badge commit)`);
  } else {
    // My Quests and the world MasterMenu share the same source-shaped list/description flow.
    await clickLabel("guildTavern:myQuests");
  await waitForState(
    (value) => value.overlay?.questListOpen,
    "Tavern My Quests did not open the quest list",
  );
  const questList = await boundsForLabel("guildQuestList");
  const questListBackground = await boundsForLabel("popupBackground");
  assert(questList, "quest-list content was unavailable");
  assert(questListBackground, "QuestDisplay background was unavailable");
  assertContained(
    questList,
    questListBackground,
    `${displayMode} QuestDisplay content escaped its Scale9 frame`,
  );
  const popupCard = await layoutForLabel("popupCard");
  assert(popupCard, "QuestDisplay popup card was unavailable");
  assert.equal(popupCard.scale.y, 1, "QuestDisplay incorrectly ran Scale9Popup's scale-in action");
  const questRow = await layoutForLabel("guildQuestRow:MacworldCatch");
  const backRow = await layoutForLabel("guildQuestBack");
  assert(questRow?.hitArea, "quest row authored content box was unavailable");
  assert(backRow, "Back row layout was unavailable");
  assert.equal(
    backRow.position.y - (questRow.position.y + questRow.hitArea.h),
    20,
    `${displayMode} QuestDisplay item gap drifted from setItemGap:20`,
  );
  await clickLabel("guildQuestRow:MacworldCatch");
  await waitForState(
    (value) => value.overlay?.chatOpen,
    "quest row did not open its description Chat",
  );
  await advance(500);
  await clickLabel("guildQuestChat");
  await waitForState(
    (value) => value.overlay?.kind === "guildQuests" && !value.overlay.chatOpen,
    "quest-list description Chat did not dismiss",
  );
  assert(await activatePixiControl("guildTavern:close"), "Tavern close control was not mounted");
  await waitForState((value) => value.overlay === null, "Tavern did not close");

  assert(await activatePixiControl("town:First_City:exit"), "Town exit control was not mounted");
  await waitForState((value) => value.mode === "world" && !value.locked, "town did not exit", 240);
  await page.keyboard.press("Escape");
  await waitForState((value) => value.menu?.config === "MasterMenu", "MasterMenu did not reopen");
  await clickLabel("worldMenu:quests");
  snapshot = await waitForState(
    (value) => value.overlay?.kind === "guildQuests" && value.overlay.questListOpen,
    "MasterMenu Quests did not open the active quest list",
  );
  assert.deepEqual(snapshot.overlay.activeQuestNames, ["MacworldCatch"]);
  assert.deepEqual(errors, [], errors.join(" | "));
    console.log(
      `guild-quest-ui: PASS (${displayMode}; Corova + contained layouts + New Quest + My Quests + MasterMenu Quests)`,
    );
  }
} finally {
  await browser.close();
}
