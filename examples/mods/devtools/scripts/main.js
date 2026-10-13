// External full-trust developer controls. The game has no Devtools package ID, menu action,
// settings schema, or feature-specific mod endpoint; this bundle owns all of them.
const MOD_ID = "dev.dragonislandblue.devtools";
const STORAGE_KEY = `${MOD_ID}.settings.v1`;
const LEGACY_NO_DELAY_KEY = "dev.dragonislandblue.no-battle-delays.enabled.v1";
const SPEED_MULTIPLIER = 3;
const FEATURE_KEYS = Object.freeze([
  "noBattleDelays",
  "speedUp",
  "unlockLocations",
  "unlockShop",
  "activateFixedEncounters",
]);
const DEFAULTS = Object.freeze({
  noBattleDelays: false,
  speedUp: false,
  unlockLocations: false,
  unlockShop: false,
  activateFixedEncounters: false,
});

const [
  { BattleNode },
  { WorldMenu },
  { WorldNode },
  { DungeonNode },
  {
    dungeonConnectorTiles,
    dungeonFrameName,
    dungeonRoomTouchRadiusPt,
    dungeonRoomZ,
    nearestMaterializedRoom,
  },
  { StoreFlow },
  { DungeonSession, WorldTrip, selectEncounterTableEntry, fixedEncounterCompletionKey },
  { createWorldTrip },
  { Container, Graphics, Rectangle },
  { makeTtfLabel },
  { showMonsterHatchPopup },
  runtimeSettings,
] = await Promise.all([
  dibMod.modules.load("web/battle/battleNode.ts"),
  dibMod.modules.load("web/world/worldMenu.ts"),
  dibMod.modules.load("web/world/worldNode.ts"),
  dibMod.modules.load("web/dungeon/dungeonNode.ts"),
  dibMod.modules.load("web/dungeon/dungeonDisplayMath.ts"),
  dibMod.modules.load("web/player/storeFlow.ts"),
  dibMod.modules.load("@dib/engine"),
  dibMod.modules.load("web/world/worldDemoState.ts"),
  dibMod.modules.load("pixi.js"),
  dibMod.modules.load("@dib/renderer"),
  dibMod.modules.load("web/ui/monsterHatchPopup.ts"),
  dibMod.modules.load("web/runtimeSettings.ts"),
]);

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      return Object.fromEntries(FEATURE_KEYS.map((key) => [
        key,
        key !== "activateFixedEncounters" && typeof parsed?.[key] === "boolean"
          ? parsed[key] : DEFAULTS[key],
      ]));
    }
    const legacy = localStorage.getItem(LEGACY_NO_DELAY_KEY);
    return {
      ...DEFAULTS,
      ...(legacy === null ? {} : { noBattleDelays: legacy !== "off" }),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = loadSettings();
function saveSettings() {
  try {
    const { activateFixedEncounters, ...persisted } = settings;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Storage-disabled browsers retain the current tab's settings in this module instance.
  }
}
function snapshotSettings() {
  return { ...settings, speedMultiplier: SPEED_MULTIPLIER };
}

const activeWorldNodes = new Set();
const activeDungeonNodes = new Set();
let ticker;
let tickerBaseSpeed = 1;

function applyTickerSpeed() {
  if (ticker !== undefined) ticker.speed = settings.speedUp ? SPEED_MULTIPLIER : tickerBaseSpeed;
}
function refreshUnlockedPresentation() {
  for (const node of [...activeWorldNodes]) node.refreshPoiStates();
  for (const node of [...activeDungeonNodes]) node.renderFloor(false);
}
function setFeature(key, enabled) {
  if (!FEATURE_KEYS.includes(key)) throw new Error(`Unknown Devtools feature ${String(key)}`);
  settings = { ...settings, [key]: enabled === true };
  saveSettings();
  if (key === "speedUp") applyTickerSpeed();
  if (key === "unlockLocations") refreshUnlockedPresentation();
  refreshDevtoolsPanels();
}

dibMod.hooks.on("boot:ready", ({ value }) => {
  ticker = value.stage.app.ticker;
  tickerBaseSpeed = ticker.speed;
  applyTickerSpeed();
});
dibMod.onDispose(() => {
  if (ticker !== undefined) ticker.speed = tickerBaseSpeed;
  for (const node of activeDungeonNodes) unwireRevealedRoomTouch(node);
  activeWorldNodes.clear();
  activeDungeonNodes.clear();
});

// --- Battle timing -------------------------------------------------------------------------

const battleStates = new WeakMap();
function battleState(battle) {
  let state = battleStates.get(battle);
  if (state === undefined) {
    state = { skippedSleeps: 0, skippedTimeDelays: 0, lastSleepMs: null, lastTimeDelayMs: null };
    battleStates.set(battle, state);
  }
  return state;
}
dibMod.intercept(BattleNode.prototype, "sleep", function (next, ms) {
  if (!settings.noBattleDelays) return next(ms);
  const state = battleState(this);
  state.skippedSleeps += 1;
  state.lastSleepMs = ms;
  return Promise.resolve();
});
dibMod.intercept(BattleNode.prototype, "awaitTimeDelay", function (next, ms) {
  if (!settings.noBattleDelays) return next(ms);
  const state = battleState(this);
  state.skippedTimeDelays += 1;
  state.lastTimeDelayMs = ms;
  return Promise.resolve();
});
dibMod.intercept(BattleNode.prototype, "renderGameState", function (next, ...args) {
  const rendered = next(...args);
  return {
    ...rendered,
    codeMods: {
      ...(rendered.codeMods ?? {}),
      devtools: { features: snapshotSettings(), battle: { ...battleState(this) } },
    },
  };
});

// --- World and dungeon visibility -----------------------------------------------------------

// Use the existing public navigation API: older deployed engines do not expose private
// encounter predicates. Build the authored encounter in an isolated trip, then move the live
// trip through its normal navigation method without generating a second encounter.
const worldContexts = new WeakMap();
const buildNavigation = WorldTrip.prototype.navigate;
dibMod.intercept(WorldTrip.prototype, "navigate", function (next, target, levels) {
  if (!settings.activateFixedEncounters) return next(target, levels);
  const context = worldContexts.get(this);
  if (context === undefined) throw new Error("Devtools: active world context is unavailable");
  const poi = context.world.pointsOfInterest.find((point) => point.name === target);
  if (poi === undefined || this.poiState(target) === 3) return next(target, levels);
  const selected = selectEncounterTableEntry(Object.fromEntries(poi.randomPopulators.map((row) =>
    [String(row.tier), { monsterPopulator: row }])), this.poiWins(target));
  const candidate = selected?.entry.monsterPopulator.fixedEncounters[0];
  if (candidate === undefined) return next(target, levels);

  const { uniqueKey, questKey, exactFloor, everyXFloors, ...ungated } = candidate;
  const projectedWorld = {
    ...context.world,
    pointsOfInterest: context.world.pointsOfInterest.map((point) => point !== poi ? point : {
      ...point,
      randomPopulators: point.randomPopulators.map((row) => String(row.tier) !== selected.key ? row : {
        ...row, fixedEncounters: [{ ...ungated, chanceToAppear: 1 }],
      }),
    }),
  };
  const state = context.refreshState;
  const completed = new Set(state.completedThisRefresh);
  completed.delete(target);
  // All maps/sets are detached: begin/navigation on this builder cannot write live completion,
  // quest events, occurrence caches or win counters. Random fixed monsters use the live roster.
  const preview = createWorldTrip(projectedWorld, this.currentPoiName, context.questRewardRng,
    context.game.gd.allMonsters().map((monster) => monster.shortType), {
      ...state,
      completedThisRefresh: completed,
      occurrenceThisRefresh: new Map(state.occurrenceThisRefresh),
      poiWins: new Map(state.poiWins),
      everCompletedPois: new Set(state.everCompletedPois),
      notifiedCompletedPois: new Set(state.notifiedCompletedPois),
    });
  const result = buildNavigation.call(preview, target, levels);
  if (result.kind !== "encounter" || result.encounter.kind !== "fixed") {
    throw new Error(`Devtools: fixed encounter did not build at ${target}`);
  }
  const completionKey = fixedEncounterCompletionKey(candidate, this.poiWins(target) + 1);
  if (target !== this.currentPoiName) {
    const wasCompleted = state.completedThisRefresh.has(target);
    state.completedThisRefresh.add(target);
    try {
      next(target, levels);
    } finally {
      if (!wasCompleted) state.completedThisRefresh.delete(target);
    }
  }
  return { ...result, encounter: {
    ...result.encounter,
    ...(completionKey === undefined ? {} : { completionKey }),
    ...(questKey === undefined ? {} : { questKey }),
  } };
});

dibMod.intercept(WorldTrip.prototype, "poiStates", function (next, ...args) {
  const original = next(...args);
  if (!settings.unlockLocations) return original;
  const unlocked = new Map(original);
  for (const name of unlocked.keys()) unlocked.set(name, name === this.currentPoiName ? 2 : 4);
  return unlocked;
});
dibMod.intercept(WorldNode.prototype, "refreshPoiStates", function (next, ...args) {
  activeWorldNodes.add(this);
  if (this.deps !== undefined) worldContexts.set(this.deps.trip, this.deps);
  return next(...args);
});
dibMod.intercept(WorldNode.prototype, "destroy", function (next, ...args) {
  activeWorldNodes.delete(this);
  if (this.deps !== undefined && worldContexts.get(this.deps.trip) === this.deps) {
    worldContexts.delete(this.deps.trip);
  }
  return next(...args);
});
dibMod.intercept(WorldNode.prototype, "renderGameState", function (next, ...args) {
  const rendered = next(...args);
  return {
    ...rendered,
    codeMods: { ...(rendered.codeMods ?? {}), devtools: { features: snapshotSettings() } },
  };
});

dibMod.intercept(DungeonNode.prototype, "renderFloor", function (next, ...args) {
  activeDungeonNodes.add(this);
  wireRevealedRoomTouch(this);
  const result = next(...args);
  if (!settings.unlockLocations) return result;

  // DungeonSession deliberately returns a deeply frozen floor. Add the omitted renderer shells
  // after the native render pass instead of pretending the durable rooms were explored.
  const rooms = this.deps.session.state.rooms;
  const snapshot = this.deps.session.snapshot();
  const cleared = new Set(snapshot.clearedEncounterIds);
  const collected = new Set(snapshot.collectedTreasureIds);
  const existing = new Set(this.roomLayer.children.map((child) => child.label));
  const presentation = this.deps.definition.presentation;
  for (const connector of dungeonConnectorTiles(rooms)) {
    const label = `dungeonConnector:${connector.key}`;
    if (existing.has(label)) continue;
    const connectorRoot = new Container();
    connectorRoot.label = label;
    connectorRoot.position.set(connector.x, connector.y);
    connectorRoot.zIndex = presentation.style === "forest"
      ? dungeonRoomZ({ y: connector.gridY })
      : 0;
    const tile = this.themeSprite(dungeonFrameName(
      presentation.floorFrameFormat,
      this.floorFrameIndex,
    ));
    tile.label = `dungeonConnectorFloor:${connector.key}`;
    tile.zIndex = 0;
    connectorRoot.addChild(tile);
    if (presentation.floorOverlayFrame !== undefined) {
      const overlay = this.themeSprite(presentation.floorOverlayFrame);
      overlay.label = `dungeonConnectorOverlay:${connector.key}`;
      overlay.zIndex = 1;
      connectorRoot.addChild(overlay);
    }
    this.roomLayer.addChild(connectorRoot);
    existing.add(label);
  }
  for (const room of rooms) {
    const label = `dungeonRoom:${room.id}`;
    if (existing.has(label)) continue;
    this.roomLayer.addChild(this.buildRoom(room, cleared, collected));
    existing.add(label);
  }
  return result;
});
dibMod.intercept(DungeonNode.prototype, "destroy", function (next, ...args) {
  activeDungeonNodes.delete(this);
  unwireRevealedRoomTouch(this);
  return next(...args);
});
dibMod.intercept(DungeonNode.prototype, "renderGameState", function (next, ...args) {
  const rendered = next(...args);
  return {
    ...rendered,
    ...(settings.unlockLocations
      ? { renderedRoomIds: rendered.rooms.map((room) => room.id) }
      : {}),
    codeMods: { ...(rendered.codeMods ?? {}), devtools: { features: snapshotSettings() } },
  };
});


function nearestRevealedRoom(node, point) {
  const floor = node.deps.session.state;
  return nearestMaterializedRoom(
    {
      currentRoomId: floor.currentRoomId,
      rooms: floor.rooms.map((room) => room.explored ? room : { ...room, explored: true }),
    },
    point,
    dungeonRoomTouchRadiusPt(runtimeSettings.DISPLAY_MODE) / node.world.scale.x,
  );
}

// Nodes whose scene-level tap was already claimed by the shipped handler during THIS dispatch.
// Pixi delivers an event to every listener synchronously, and a microtask cannot run until that
// whole dispatch has finished, so clearing the mark in one is exactly "until the next tap".
const claimedTapNodes = new Set();


dibMod.intercept(DungeonNode.prototype, "handleRoomTouch", function (next, roomId, worldPoint) {
  claimedTapNodes.add(this);
  queueMicrotask(() => claimedTapNodes.delete(this));
  if (!settings.unlockLocations) return next(roomId, worldPoint);
  const nearest = nearestRevealedRoom(this, worldPoint);
  return next(nearest?.id ?? roomId, worldPoint);
});

// A tap whose only room in radius is a revealed one never reaches `handleRoomTouch` at all: the
// scene's own listener resolves nothing and returns. This additive listener runs after it in the
// same dispatch and picks up exactly those taps — it never competes for one the shipped handler
// took, and it does not displace any other package's listener.
const wiredDungeonNodes = new WeakMap();
function wireRevealedRoomTouch(node) {
  if (wiredDungeonNodes.has(node)) return;
  const handler = (event) => {
    if (!settings.unlockLocations || node.locked || claimedTapNodes.has(node)) return;
    if (node.pointRoot.destroyed) return;
    const point = event.getLocalPosition(node.world);
    const room = nearestRevealedRoom(node, point);
    if (room === undefined) return;
    void node.handleRoomTouch(room.id, point).catch((error) => {
      console.warn("Devtools: revealed-room travel failed", error);
    });
  };
  node.pointRoot.on("pointertap", handler);
  wiredDungeonNodes.set(node, handler);
}
function unwireRevealedRoomTouch(node) {
  const handler = wiredDungeonNodes.get(node);
  if (handler === undefined) return;
  wiredDungeonNodes.delete(node);
  if (!node.pointRoot.destroyed) node.pointRoot.off("pointertap", handler);
}

// The refusal this lifts guards a room the player cannot see. Arrival itself is what explores a
// room — `enterCurrentRoom`, which `selectMaterializedRoom` calls on every successful move, sets
// `explored` on the destination regardless — so marking the destination first only reorders the
// same write, and a revealed room the player never walks into stays unexplored in the save.
dibMod.intercept(DungeonSession.prototype, "selectMaterializedRoom", function (next, targetRoomId) {
  if (settings.unlockLocations) this.requireRoom(targetRoomId).explored = true;
  return next(targetRoomId);
});

// --- Store pricing -------------------------------------------------------------------------

dibMod.intercept(StoreFlow.prototype, "entries", function (next, ...args) {
  const entries = next(...args);
  if (!settings.unlockShop) return entries;
  return entries.map((stock) => typeof stock.unitPrice === "number"
    ? Object.freeze({ ...stock, unitPrice: 0 })
    : stock);
});

// --- Devtools master-menu button and popup --------------------------------------------------

const panelRefreshers = new Set();
function refreshDevtoolsPanels() {
  for (const refresh of [...panelRefreshers]) refresh();
}

function toggleButton(text, selected, onPress) {
  const width = 42;
  const height = 22;
  const root = new Container();
  root.eventMode = "static";
  root.cursor = "pointer";
  root.hitArea = new Rectangle(0, 0, width, height);
  const background = new Graphics();
  const label = makeTtfLabel(text, 13, { outline: false });
  label.anchor.set(0.5);
  label.position.set(width / 2, height / 2);
  label.eventMode = "none";
  root.addChild(background, label);
  root.on("pointertap", (event) => {
    event?.stopPropagation?.();
    onPress();
  });
  root.setSelected = (value) => {
    background.clear()
      .roundRect(0, 0, width, height, 4)
      .fill({ color: value ? 0x087f8c : 0x20272d, alpha: 0.96 })
      .stroke({ color: value ? 0x8ff6ff : 0x68747c, width: 1 });
    label.style.fill = value ? 0xffffff : 0xaeb8bd;
  };
  root.setSelected(selected);
  return root;
}

async function showDevtools(parent, opts) {
  const content = new Container();
  content.label = "devtoolsContent";
  const rows = [
    ["noBattleDelays", "No Battle Delays", "Off", "On"],
    ["speedUp", "Speed-up", "1x", `${SPEED_MULTIPLIER}x`],
    ["unlockLocations", "Unlock Locations", "Off", "On"],
    ["unlockShop", "Unlock Shop", "Off", "On"],
    ["activateFixedEncounters", "Fixed / Quest Encounters", "Off", "On"],
  ];
  // Mod-authored Cocos-point geometry, shared intentionally by the iPhone and iPad tiers.
  content.addChild(new Graphics().rect(0, 0, 292, rows.length * 29)
    .fill({ color: 0x000000, alpha: 0 }));
  const refreshers = [];
  rows.forEach(([key, title, offText, onText], index) => {
    const y = index * 29;
    const rowLabel = makeTtfLabel(title, 14, { outline: false });
    rowLabel.anchor.set(0, 0.5);
    rowLabel.position.set(0, y + 11);
    const off = toggleButton(offText, false, () => setFeature(key, false));
    const on = toggleButton(onText, false, () => setFeature(key, true));
    off.label = `devtools:${key}:off`;
    on.label = `devtools:${key}:on`;
    off.position.set(194, y);
    on.position.set(244, y);
    const refresh = () => {
      off.setSelected(settings[key] !== true);
      on.setSelected(settings[key] === true);
    };
    refreshers.push(refresh);
    content.addChild(rowLabel, off, on);
  });
  const refresh = () => refreshers.forEach((entry) => entry());
  panelRefreshers.add(refresh);
  refresh();
  try {
    return await showMonsterHatchPopup({
      parent,
      assets: opts.assets,
      scale9: opts.scale9,
      ticker: opts.ticker,
      zIndex: 90,
      sfx: { onButtonPress: opts.onClick },
    }, {
      title: "Devtools",
      content,
      hideOverlays: true,
      runScaleAction: false,
      buttons: [{ label: "Close", onPress: () => undefined }],
      onDismiss: () => panelRefreshers.delete(refresh),
    });
  } catch (error) {
    panelRefreshers.delete(refresh);
    throw error;
  }
}

function devtoolsMenuButton(menu, opts, parent) {
  const points = menu.buttonPoints ?? [];
  const thirdColumn = points.filter((point) => point.column === 2)
    .sort((left, right) => left.row - right.row);
  const last = thirdColumn.at(-1) ?? points.at(-1);
  const previous = thirdColumn.at(-2);
  const step = last !== undefined && previous !== undefined
    ? last.backgroundBounds.y - previous.backgroundBounds.y
    : 40;
  const bounds = last === undefined
    ? { x: 330, y: 230, w: 110, h: 30 }
    : { ...last.backgroundBounds, y: last.backgroundBounds.y + step };
  const button = new Container();
  button.label = "worldMenu:devtools";
  button.position.set(bounds.x, bounds.y);
  button.eventMode = "static";
  button.cursor = "pointer";
  button.hitArea = new Rectangle(0, 0, bounds.w, bounds.h);
  const background = new Graphics()
    .roundRect(0, 0, bounds.w, bounds.h, 5)
    .fill({ color: 0x13333a, alpha: 0.96 })
    .stroke({ color: 0x72e5f2, width: 1.5 });
  const label = makeTtfLabel("Devtools", 16, { fill: 0xbaf8ff, outline: false });
  label.anchor.set(0.5);
  label.position.set(bounds.w / 2, bounds.h / 2);
  label.eventMode = "none";
  button.addChild(background, label);
  button.on("pointertap", (event) => {
    event.stopPropagation();
    opts.onClick();
    menu.close(opts.onClose);
    void showDevtools(parent, opts);
  });
  menu.addChild(button);
  points.push({
    action: "devtools",
    label: "Devtools",
    enabled: true,
    column: 2,
    row: thirdColumn.length,
    center: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 },
    labelBounds: { ...bounds },
    backgroundBounds: { ...bounds },
  });
}

dibMod.intercept(WorldMenu, "show", async function (next, parent, opts) {
  const menu = await next(parent, opts);
  devtoolsMenuButton(menu, opts, parent);
  return menu;
});

dibMod.exports.storageKey = STORAGE_KEY;
dibMod.exports.speedMultiplier = SPEED_MULTIPLIER;
dibMod.exports.settings = snapshotSettings;
dibMod.exports.setFeature = setFeature;
