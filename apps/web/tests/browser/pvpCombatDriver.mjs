// Shared real-input choreography for the normal BattleNode mounted by PvP. No handler calls.
export async function nativePvpPoint(page, point) {
  return page.evaluate(point => {
    const app = window.__PIXI_APP__, stack = [app.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node.label === "battlePointRoot" && !node.destroyed) {
        const global = node.toGlobal(point), canvas = app.canvas.getBoundingClientRect();
        return { x: canvas.x + global.x * canvas.width / app.screen.width, y: canvas.y + global.y * canvas.height / app.screen.height };
      }
      if (node.children) stack.push(...node.children);
    }
    throw new Error("Native PvP battle root is missing");
  }, point);
}

/** Fails fast when another layer covers the mounted battle: a tap at the battle's centre must
 * hit-test into the battle, not into whatever sits above it (e.g. the Arena lobby host). */
export async function assertNativePvpOnTop(page, who = "client") {
  const blocker = await page.evaluate(() => {
    const app = window.__PIXI_APP__, stack = [app.stage]; let root;
    while (stack.length && !root) { const node = stack.pop(); if (node.label === "battlePointRoot" && !node.destroyed) root = node; else if (node.children) stack.push(...node.children); }
    if (!root) return "no battlePointRoot";
    const { screenPt } = JSON.parse(window.render_game_to_text()).overlay.pvp.board;
    const global = root.toGlobal({ x: screenPt.w / 2, y: screenPt.h / 2 }), hit = app.renderer.events.rootBoundary.hitTest(global.x, global.y);
    const path = []; for (let node = hit; node; node = node.parent) { if (node === root) return undefined; path.push(node.label || node.constructor.name); }
    return path.join(" < ") || "nothing";
  });
  if (blocker) throw new Error(`${who}: the PvP battle is not the top input layer; a tap at its centre hits ${blocker}`);
}

export function nativePvpReady(state) {
  const board = state.overlay?.pvp?.board;
  return board?.renderer === "BattleNode" && board.presentation?.state === "awaitingPlayerChoice" &&
    !board.busy && !board.rendering && board.panelVisible && board.abilityButtons?.length > 0;
}

/** Existing test labels map to visible native controls, retaining real mouse input. */
export async function nativePvpClick(page, label, press = (x, y) => page.mouse.click(x, y)) {
  // Async panel construction can finish after advanceTime's render. Flush that new display tree
  // before real pointer hit testing, just as the next browser frame does during normal play.
  await page.evaluate(() => window.__PIXI_APP__.render());
  const board = await page.evaluate(() => JSON.parse(window.render_game_to_text()).overlay.pvp.board);
  let point;
  if (label === "pvp:forfeit") point = board.secondaryActions.find(button => button.kind === "retreat")?.center;
  else if (label === "pvp:delay") point = board.secondaryActions.find(button => button.kind === "delay")?.center;
  else if (/^pvp:usable[1-4]$/.test(label)) point = board.abilityButtons.find(button => button.slot === Number(label.at(-1)))?.center;
  else if (label.startsWith("pvp:monster:")) point = board.monsters.find(monster => monster.id === label.slice("pvp:monster:".length))?.targetPoint;
  else if (label === "pvp:targets-submit") throw new Error("Native TargetPicker commits the final target without a confirmation button");
  else return false;
  if (!point) throw new Error(`Missing native control ${label}`);
  const client = await nativePvpPoint(page, point);
  await press(client.x, client.y);
  if (label === "pvp:delay") await confirmNativePvpPopup(page, "confirmSkip", press);
  if (label === "pvp:forfeit") await confirmNativePvpPopup(page, "confirmRetreat", press);
  return true;
}

/** Presses Yes on a native confirmation once it settles, and retries until it closes. */
export async function confirmNativePvpPopup(page, kind, press = (x, y) => page.mouse.click(x, y)) {
  const board = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).overlay.pvp.board);
  const yesPoint = () => page.evaluate(() => {
    const app = window.__PIXI_APP__, stack = [app.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node.label === "popupButton:Yes" && !node.destroyed) {
        const bounds = node.getBounds(), canvas = app.canvas.getBoundingClientRect();
        return { x: canvas.x + (bounds.x + bounds.width / 2) * canvas.width / app.screen.width,
          y: canvas.y + (bounds.y + bounds.height / 2) * canvas.height / app.screen.height };
      }
      if (node.children) stack.push(...node.children);
    }
  });
  let previous;
  for (const end = Date.now() + 15000; Date.now() < end;) {
    const current = await board();
    if (!current || current.busy || (current.activePopup !== kind && previous)) return;
    const yes = await yesPoint();
    // The popup scales in vertically about its centre; a point read mid-animation misses the button.
    if (yes && previous && Math.abs(yes.x - previous.x) < 0.5 && Math.abs(yes.y - previous.y) < 0.5) {
      await press(yes.x, yes.y); previous = undefined;
      for (const settle = Date.now() + 1500; Date.now() < settle;) {
        const after = await board();
        if (!after || after.busy || after.activePopup !== kind) return;
        await page.evaluate(() => window.advanceTime(40));
        await page.waitForTimeout(40);
      }
      continue;
    }
    previous = yes;
    await page.evaluate(() => window.advanceTime(60));
    await page.waitForTimeout(60);
  }
  throw new Error(`${kind} confirmation did not close`);
}

export async function pickNativePvpTargets(page, read, wait, click, requestedIds) {
  const chosen = new Set();
  for (let guard = 0; guard < 32; guard++) {
    await wait(page, state => !state.overlay.pvp.board.picking ||
      state.overlay.pvp.board.targetPickerVisuals.outlines.length > 0, "native picker mounted");
    const board = (await read(page)).overlay.pvp.board;
    if (!board.picking) return;
    const ids = board.targetPickerVisuals.outlines.map(outline => outline.id).filter(id => !chosen.has(id));
    const id = requestedIds ? requestedIds.find(id => ids.includes(id)) : ids[0];
    if (!id) throw new Error("Native target picker has no remaining requested target");
    chosen.add(id); await click(page, `pvp:monster:${id}`);
    await wait(page, state => !state.overlay.pvp.board.picking || state.overlay.pvp.board.targetPickerVisuals.outlines.every(outline => outline.id !== id), "target accepted");
  }
  throw new Error("Native target picker exceeded its target count");
}


// A committed terminal transcript can contain a long automatic status/death tail.
// Give both manual browser clocks enough ticker time within the unchanged wall guard;
// input-ready, modal, loading and unknown phases retain the small observation cadence.
export function pvpClockStepMs(board) {
  const automatic = ["turnLeadIn", "phaseDelay", "impact", "deathResolution", "turnComplete", "abilityQueued", "battleEndDelay", "battleEnded"];
  return board?.status === "ended" && !board.rendering && !board.statusText?.visible &&
    !board.activePopup && !board.picking && automatic.includes(board.presentation?.state) ? 100 : 25;
}
