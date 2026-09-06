// Opt-in Tournament bracket reveal contract. `-[TournamentNode init]` draws the hero and the
// round's chat portrait only for matchups at or before the current round, and covers every later
// matchup with the `MonsterpediaFrames` `questionmark.png` frame it retains the spritesheet for.
// Uses real Pixi input and deterministic source time against a caller-selected content package.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_DISPLAY_MODE === "ipad" ? "ipad" : "iphone";
const outputDir = path.resolve(
  import.meta.dirname,
  `../../../../output/tournament-bracket-${displayMode}`,
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
      tutorialFlags: ["FirstShop", "FirstCharacterDisplay", "Tutorial0", "Tutorial1", "TournamentTutorial"],
    };
  }, { displayMode });
  await page.goto(url);
  await loadLocalContent(page);
  console.log("tournament-bracket: content loaded");

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
    throw new Error(
      `${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`,
    );
  };
  const nodeStateForLabel = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    let match = null;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) {
        const bounds = node.getBounds();
        match = {
          alpha: node.alpha,
          worldAlpha: node.worldAlpha,
          bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return match;
  }, label);
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
  // Row taps are routed by the menu container that owns them (rows are `eventMode: "none"`),
  // so emitting on the row node itself reaches no listener at all.
  const invokeLabel = (label) => tapPixiLabel(page, label);

  let startup = await waitFor(
    (value) => value.startup?.phase === "title",
    "startup title did not become interactive",
  );
  await page.keyboard.press("Enter");
  startup = await waitFor(
    (value) =>
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" ||
      value.mode === "town",
    "startup did not begin the local world session",
  );
  if (startup.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    startup = await waitFor(
      (value) => value.startup?.phase === "pick-dragon",
      "intro plot did not open the starter picker",
    );
  }
  if (startup.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  startup = await waitFor((value) => value.mode === "town", "town did not open");
  // Town entry publishes before its delayed source chat is mounted.
  await advance(1_000);
  startup = await state();
  for (let pageIndex = 0; startup.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await advance(550);
    await clickLabel("guildQuestChat");
    startup = await state();
  }
  // Drain the deterministic day banner so it cannot cover the bracket capture.
  await advance(12_000);
  console.log("tournament-bracket: town ready");

  await page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await waitFor(
    async () => await boundsForLabel("guildQuestChatFinish") !== null,
    "Arena greeting did not open",
  );
  await advance(550);
  await invokeLabel("guildQuestChat");
  await waitFor(
    (value) => value.overlay?.open === true && value.overlay?.buttons,
    "Arena menu did not open",
  );
  console.log("tournament-bracket: arena menu");

  await invokeLabel("arena:tournament");
  const snapshot = await waitFor(
    (value) => value.overlay?.kind === "tournament",
    "Tournament bracket did not open",
  );
  await waitFor(
    async () => await boundsForLabel("sourceBlackSceneFade:arena-tournament") === null,
    "Arena-to-tournament source fade did not finish",
  );
  assert.equal(snapshot.overlay.round, 0, "fixture should start at round 0");
  const primaryButton = snapshot.overlay.buttons.find((button) => button.action === "primary");
  const rewardsButton = snapshot.overlay.buttons.find((button) => button.action === "rewards");
  const backButton = snapshot.overlay.buttons.find((button) => button.action === "back");
  assert(primaryButton && rewardsButton && backButton, `Tournament buttons are incomplete: ${JSON.stringify(snapshot.overlay.buttons)}`);
  assert(primaryButton.center.y < backButton.center.y, "primary must be the upper item in the source's two-row left flow");
  assert(rewardsButton.center.x > primaryButton.center.x, "Rewards must use its independent lower-right custom position");
  assert(rewardsButton.center.y > primaryButton.center.y, "Rewards must sit below primary instead of consuming the middle flow row");

  // Round 0 is the current matchup: both fighters visible, no placeholder.
  assert(await boundsForLabel("tournament:hero:0"), "round 0 hero portrait was not rendered");
  assert(
    await boundsForLabel("tournament:opponent:0"),
    "round 0 opponent portrait was not rendered",
  );
  assert.equal(
    await boundsForLabel("tournament:unknown:0"),
    null,
    "round 0 must not draw the questionmark placeholder",
  );

  // Rounds 1..3 are unreached: placeholder only, neither fighter revealed.
  for (const round of [1, 2, 3]) {
    assert(
      await boundsForLabel(`tournament:unknown:${round}`),
      `round ${round} questionmark placeholder was not rendered`,
    );
    assert.equal(
      await boundsForLabel(`tournament:hero:${round}`),
      null,
      `round ${round} must not reveal the hero before it is reached`,
    );
    assert.equal(
      await boundsForLabel(`tournament:opponent:${round}`),
      null,
      `round ${round} must not reveal its opponent before it is reached`,
    );
  }

  // The bracket's own geometry is the coordinate reference for everything below: the four
  // placeholders sit at known source points (`x = 61 + 84*r`, bottom `y = 163 + 38*r` on the
  // phone), so two of them recover the canvas scale AND the surface origin without depending on
  // letterboxing. `toGamePoints` then converts any measured bound back into source points.
  const unknown1 = await boundsForLabel("tournament:unknown:1");
  const unknown2 = await boundsForLabel("tournament:unknown:2");
  assert(unknown1 && unknown2, "placeholder bounds are unavailable");
  const centerX = (b) => b.x + b.w / 2;
  const bottomY = (b) => b.y + b.h;
  const perPoint = (centerX(unknown2) - centerX(unknown1)) / 84;
  assert(perPoint > 0, "the per-round step did not recover a canvas scale");
  assert(
    Math.abs((bottomY(unknown2) - bottomY(unknown1)) / 38 - perPoint) < 0.02 * perPoint,
    "the horizontal and vertical per-round steps disagree",
  );
  const originX = centerX(unknown1) - perPoint * (61 + 84);
  const originY = bottomY(unknown1) - perPoint * (163 + 38);
  const toGamePoints = (b) => ({
    x: (b.x - originX) / perPoint,
    y: (b.y - originY) / perPoint,
    w: b.w / perPoint,
    h: b.h / perPoint,
  });



  {
    const opponent0 = await boundsForLabel("tournament:opponent:0");
    assert(opponent0, "round 0 opponent bounds are unavailable");
    const lift = bottomY(opponent0) + 38 * perPoint - bottomY(unknown1);
    assert(
      Math.abs(lift - 15 * perPoint) < 1.5 * perPoint,
      `placeholder must sit 15pt above the opponent edge, measured ${lift / perPoint}pt`,
    );
    assert(
      Math.abs(unknown1.h / perPoint - 68 * 0.7) < 2,
      `placeholder must be drawn at the source's bare 0.7, measured ${unknown1.h / perPoint}pt tall`,
    );
  }



  {
    const reward = await boundsForLabel("tournament:reward");
    assert(reward, "the tournament's class prize was not rendered into the final frame");
    const unknown3 = await boundsForLabel("tournament:unknown:3");
    assert(unknown3, "round 3 placeholder bounds are unavailable");
    assert(
      reward.x + reward.w / 2 > unknown3.x + unknown3.w / 2,
      "the class prize must sit right of the last matchup column",
    );
  }

  // No completed rounds yet, so nothing should be pulsing.
  assert.equal(
    await boundsForLabel("tournament:completedGlow:0"),
    null,
    "an unwon round must not carry the completed-round glow",
  );




  const subtitle = await boundsForLabel("tournament:subtitleLabel");
  const classCaption = await boundsForLabel("tournament:classLabel");
  const classLetter = await boundsForLabel("tournament:classLetter");
  assert(subtitle && classCaption && classLetter, "the tournament title group was not rendered");
  assert(
    Math.abs((subtitle.x + subtitle.w) - (classCaption.x + classCaption.w)) < 1,
    "both caption lines must share one right edge",
  );
  assert(
    classLetter.x >= subtitle.x + subtitle.w,
    "the class letter must sit beside the captions, not under them",
  );
  assert(
    Math.abs(classLetter.y - subtitle.y) < 2,
    "the class letter must top-align with the Dragon Island Tournament line",
  );
  assert(
    classCaption.y > subtitle.y && classCaption.y < subtitle.y + subtitle.h,
    "Class must be the SECOND caption line, directly under Dragon Island Tournament",
  );

  // `letterX = (winSize.width - 5 - letter.contentSize.width) - 5`, `captionX = letterX - 5`,
  // `topY = winSize.height - 20`. Pixi's `Text` bounds carry the centred stroke — one 2.0pt
  // `outlineFadeBackgroundNode` borderWidth per side — while a Cocos label's outline is a
  // separate z -1 child that never moves it, so the INK box is what these constants describe.
  // Without `placeTtfLabelInk` the whole corner group drew 2pt in and 2pt down; note that
  // `letterWidth` cancels out of the letter's right edge, so this does not depend on how the
  // host rasterizes Arial-BoldMT.
  {
    const PAD = 2;
    const ink = (bounds) => {
      const box = toGamePoints(bounds);
      return {
        left: box.x + PAD,
        right: box.x + box.w - PAD,
        top: box.y + PAD,
      };
    };
    const letterInk = ink(classLetter);
    const subtitleInk = ink(subtitle);
    assert(
      Math.abs(letterInk.right - (480 - 10)) < 1,
      `class letter ink must end 10pt from the right edge, measured ${letterInk.right}`,
    );
    assert(
      Math.abs(subtitleInk.right - (letterInk.left - 5)) < 1,
      `captions must end 5pt left of the letter, measured ${letterInk.left - subtitleInk.right}pt`,
    );
    for (const [name, box] of [["letter", letterInk], ["subtitle", subtitleInk]]) {
      assert(
        Math.abs(box.top - 20) < 1,
        `${name} ink must start 20pt from the top edge, measured ${box.top}`,
      );
    }
  }

  await capture("tournament-bracket.png");

  // `TournamentPrizeListViewController`: twelve rows newest-first, each with its class letter,
  // subtitle, final-round NPC portrait, rendered prize and — until claimed — a lock.
  await invokeLabel("tournament:rewards");
  const rewards = await waitFor(
    (value) => value.overlay?.prizeList?.open === true,
    "Rewards prize list did not open",
  );
  const list = rewards.overlay.prizeList;
  assert.equal(list.rows.length, 12, "prize list should show every shipped class");
  assert.equal(list.rows[0].name, "S", "newest class must sort first (count - 1 - row)");
  assert.equal(list.rows[11].name, "K", "oldest class must sort last");
  assert(
    list.rows.every((row) => row.locked),
    "an unclaimed run must show every row locked",
  );
  assert(
    list.rows.every((row) => row.prize !== null),
    "every shipped class authors a prize render",
  );
  assert(
    list.rows.every((row) => row.npc !== null),
    "every shipped class authors a final-round chat portrait",
  );
  assert(list.maxScroll > 0, "twelve rows must overflow the table viewport");
  assert(await boundsForLabel("prizeList:title"), "prize list title was not rendered");
  assert(await boundsForLabel("prizeList:close"), "prize list close button was not rendered");
  await capture("tournament-rewards.png");

  // Drag the table to prove the list scrolls, rests inside its clamped bounds, and stays clipped
  // to the table viewport — the mask has to be a separate node from the container it clips, and a
  // regression there silently paints scrolled rows over the title.
  {
    // Neither `getBounds()` result is suitable here: the table includes all masked-off rows, while
    // Pixi reports its Graphics mask at zero bounds once the mask system owns it. Transform the
    // source-sized table hit area itself into renderer coordinates.
    const table = await page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      let table = null;
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "prizeList:table") table = node;
        if (node?.children) stack.push(...node.children);
      }
      if (table === null || table.hitArea === null) return null;
      const topLeft = table.toGlobal({ x: table.hitArea.x, y: table.hitArea.y });
      const bottomRight = table.toGlobal({
        x: table.hitArea.x + table.hitArea.width,
        y: table.hitArea.y + table.hitArea.height,
      });
      return {
        x: topLeft.x,
        y: topLeft.y,
        w: bottomRight.x - topLeft.x,
        h: bottomRight.y - topLeft.y,
      };
    });
    assert(table, "prize list table viewport was not rendered");
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    const clampX = (v) => Math.min(canvas.x + canvas.width - 1, Math.max(canvas.x + 1, v));
    const clampY = (v) => Math.min(canvas.y + canvas.height - 1, Math.max(canvas.y + 1, v));
    const dragX = clampX(canvas.x + table.x + table.w / 2);
    const dragStartY = clampY(canvas.y + table.y + table.h * 0.8);
    const dragEndY = clampY(canvas.y + table.y + table.h * 0.2);
    await page.mouse.move(dragX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragX, dragEndY, { steps: 8 });
    await page.mouse.up();
    await advance(50);
    const scrolled = (await state()).overlay.prizeList;
    assert(scrolled.scrollOffset > 0, "dragging up did not scroll the prize list");
    assert(
      scrolled.scrollOffset <= scrolled.maxScroll,
      "prize list scrolled past its clamped maximum",
    );

    // The content has to travel exactly as far as the pointer did. `event.global` is in renderer
    // screen pixels while the list lays out in points under the letterbox scale times
    // CONTENT_SCALE_FACTOR, so using a raw global delta scrolls two to three times too far — by a
    // factor that changes with the window size, which is why a fixed-offset assertion is not
    // enough here. The transformed table hit area is global, so the ratio converts the drag back
    // to points.
    const expectedOffset = await page.evaluate(({ dragX, dragStartY, dragEndY }) => {
      const stack = [window.__PIXI_APP__.stage];
      let table = null;
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "prizeList:table") table = node;
        if (node?.children) stack.push(...node.children);
      }
      if (table === null) throw new Error("prize list table was not found");
      const mapLocalY = (pageX, pageY) => {
        const global = { x: 0, y: 0 };
        window.__PIXI_APP__.renderer.events.mapPositionToPoint(global, pageX, pageY);
        return table.toLocal(global).y;
      };
      return mapLocalY(dragX, dragStartY) - mapLocalY(dragX, dragEndY);
    }, { dragX, dragStartY, dragEndY });
    assert(
      Math.abs(scrolled.scrollOffset - expectedOffset) <= 2,
      `drag scrolled ${scrolled.scrollOffset}pt for a ${expectedOffset}pt pointer travel; the ` +
        "delta must be measured in the table's point space, not in renderer screen pixels",
    );
    await capture("tournament-rewards-scrolled.png");

    // The indicator is grabbable (UIKit's is not — this is a pointer-port affordance). Dragging
    // the thumb to the bottom of its travel must rest the content at exactly its clamped maximum.
    {
      const thumb = await boundsForLabel("prizeList:scrollIndicator");
      assert(thumb, "prize list scroll indicator was not rendered");
      const thumbX = clampX(canvas.x + thumb.x + thumb.w / 2);
      await page.mouse.move(thumbX, clampY(canvas.y + thumb.y + thumb.h / 2));
      await page.mouse.down();
      await page.mouse.move(thumbX, clampY(canvas.y + table.y + table.h), { steps: 8 });
      await page.mouse.up();
      await advance(50);
      const dragged = (await state()).overlay.prizeList;
      assert.equal(
        Math.round(dragged.scrollOffset),
        Math.round(dragged.maxScroll),
        "dragging the thumb to the bottom did not rest the list at its maximum",
      );
      assert.equal(dragged.dragging, null, "the thumb drag was not released");

      // Dragging it back to the top returns the list to the first row.
      await page.mouse.move(thumbX, clampY(canvas.y + table.y + table.h - 4));
      await page.mouse.down();
      await page.mouse.move(thumbX, clampY(canvas.y + table.y), { steps: 8 });
      await page.mouse.up();
      await advance(50);
      assert.equal(
        Math.round((await state()).overlay.prizeList.scrollOffset),
        0,
        "dragging the thumb back to the top did not return the list to the first row",
      );
    }

    // Wheel support, likewise absent from the touch-only source.
    await page.mouse.move(dragX, clampY(canvas.y + table.y + table.h / 2));
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(25);
    await advance(50);
    const wheeled = (await state()).overlay.prizeList;
    assert(wheeled.scrollOffset > 0, "the wheel did not scroll the prize list");
    assert(
      wheeled.scrollOffset <= wheeled.maxScroll,
      "the wheel scrolled past the clamped maximum",
    );
    await page.mouse.wheel(0, -1_000);
    await page.waitForTimeout(25);
    await advance(50);
    assert.equal(
      (await state()).overlay.prizeList.scrollOffset,
      0,
      "wheeling back up did not return the list to the first row",
    );

    // The rows must be clipped by a mask that is a SEPARATE node from the container holding it —
    // masking the container that also parents its own mask leaves rows unclipped, which paints
    // scrolled content over the title. Assert the wiring directly; a pixel diff here is not
    // frame-stable because reading back a WebGL buffer does not guarantee the last drawn frame.
    const masking = await page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      let rows = null;
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "prizeList:rows") rows = node;
        if (node?.children) stack.push(...node.children);
      }
      if (rows === null) return null;
      const mask = rows.mask;
      return {
        hasMask: mask != null,
        maskLabel: mask?.label ?? null,
        maskIsSelf: mask === rows,
        maskIsChildOfRows: mask != null && mask.parent === rows,
      };
    });
    assert(masking, "prize list rows node was not found");
    assert(masking.hasMask, "prize list rows are not clipped to the table viewport");
    assert.equal(masking.maskLabel, "prizeList:tableMask");
    assert.equal(masking.maskIsSelf, false, "a node cannot clip itself");
    assert.equal(
      masking.maskIsChildOfRows,
      false,
      "the mask must not be parented by the node it clips",
    );
  }

  await invokeLabel("prizeList:close");
  await waitFor(
    (value) => value.overlay?.prizeList === undefined,
    "prize list did not close",
  );

  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(`Tournament bracket reveal contract passed (${outputDir})`);
} finally {
  await browser.close();
}
