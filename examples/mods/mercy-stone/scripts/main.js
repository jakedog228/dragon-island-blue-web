// Mercy Stone — one complete new ITEM in a single external package.
//
// The site has no mercy identifier, no item-registration endpoint, and no presentation branch for
// this stone. The package overlays an ordinary `Items` leaf, teaches the shipped Soul-Stone lookup
// one more element key so every existing consumer (stat accumulator, equip slot, save snapshot,
// card badge, picker, info popup) carries it for free, bakes its two atlas frames at runtime,
// sells itself in the town Shop for silver, and enforces its combat rule at the engine's single
// HP mutation point.
//
// Rule: a monster holding a Mercy Stone can never land a killing blow. Any hit it deals that would
// drop another creature below 1 HP leaves that creature at exactly 1 instead. The stone grants no
// stat bonuses. A spared creature is told so by a blue "Mercy!" floater in the same slot the
// shipped "STUN!" call-out uses.
//
// Bought stones are durable player state, so a save written while this package is selected owns
// stones only this package can resolve — which is exactly what the mod profile entering the save
// fingerprint already binds together.

const ELEMENT = "Mercy";
// Soul stones are addressed as `SoulStones.<Element>SoulStone` / `<Element>SoulStone.png` /
// `Renderable<Element>SoulStoneNameKey` / `Element<Element>.png` throughout the shipped data and
// UI, so one pseudo-element key is the whole identity this package has to introduce.
const ITEM_NAME = `${ELEMENT}SoulStone`;
const ITEM_PATH = `SoulStones.${ITEM_NAME}`;
const NAME_KEY = `Renderable${ITEM_NAME}NameKey`;
const ITEM_FRAME = `${ITEM_NAME}.png`;
const ELEMENT_FRAME = `Element${ELEMENT}.png`;
// Recoloured at runtime from the shipped Life frames — the package ships no art of its own.
const BASE_ITEM_FRAME = "LifeSoulStone.png";
const BASE_ELEMENT_FRAME = "ElementLife.png";
const STONE_TINT = 0xffe9b0;

const DISPLAY_NAME = "Mercy Stone";
const INFO_MESSAGE = "ModMercyStone";
const STOCK_ID = "mod-mercy-stone";
const PRICE_SILVER = 100;
// `WorldTripParty.validateSoulStone` requires a positive integer level. The level only ever feeds
// `soulStoneBonusForStat`, which is 0 for every stat while the enabled-stat set is empty.
const STONE_LEVEL = 1;
// The floor the holder's damage may never break through.
const MERCY_FLOOR = 1;
// The call-out painted over a creature whose life this stone just spared. Branch 4 of
// `+[ParameterEffectBuilder addParameterEffectsForAbilityResult:]` reads an explicit
// `messageColor` beside its `message` (abilityRendererMath.ts's MESSAGE_DEFAULT_COLOR note:
// every real message producer sets the key), so a package-chosen colour is the ordinary shape of
// this effect rather than a deviation. Blue: no shipped floater uses it, and the two that share
// this slot are white ("STUN!") and red ("Miss"/damage).
const MERCY_FLOATER_COLOR = 0x3fa9ff;
const EFFECT_KEY = "ModMercyEffectKey";

const STRINGS = {
  [NAME_KEY]: DISPLAY_NAME,
  [`${INFO_MESSAGE}TitleKey`]: DISPLAY_NAME,
  [EFFECT_KEY]: "Mercy!",
  [`${INFO_MESSAGE}MessageKey`]:
    "The creature holding this stone can never land a killing blow. Any hit it deals that would " +
    "take another creature below 1 HP leaves that creature at exactly 1 HP instead. The stone " +
    "grants no stat bonuses.",
};

const [
  { BattleCore, WorldTripParty },
  { GameData },
  { AssetLibrary, Box, makeTtfLabel, pointSprite, OUTLINE_FADE_ALPHA },
  { ColorMatrixFilter, Container, Rectangle, RenderTexture, Sprite },
  { BattleNode },
  { AbilityRenderer },
  { TargetPicker },
  { PartyEditorFlow },
  { EggHatchFlow },
  { PlayerRuntimeState },
  { StoreFlow },
  { dungeonLootDisplayMetrics },
  { sourcePointsPerPortPoint },
  runtimeSettings,
] = await Promise.all([
  dibMod.modules.load("@dib/engine"),
  dibMod.modules.load("@dib/gamedata/browser"),
  dibMod.modules.load("@dib/renderer"),
  dibMod.modules.load("pixi.js"),
  dibMod.modules.load("web/battle/battleNode.ts"),
  dibMod.modules.load("web/battle/abilityRenderer.ts"),
  dibMod.modules.load("web/battle/targetPicker.ts"),
  dibMod.modules.load("web/world/partyEditorFlow.ts"),
  dibMod.modules.load("web/world/eggHatchFlow.ts"),
  dibMod.modules.load("web/player/playerRuntimeState.ts"),
  dibMod.modules.load("web/player/storeFlow.ts"),
  dibMod.modules.load("web/dungeon/dungeonDisplayMath.ts"),
  dibMod.modules.load("web/displayMode.ts"),
  dibMod.modules.load("web/runtimeSettings.ts"),
]);

// ---------------------------------------------------------------------------------------------
// 1. Data. An ordinary Items leaf plus its strings, overlaid before the content is fingerprinted.
// ---------------------------------------------------------------------------------------------

dibMod.hooks.on("content:loaded", ({ value: content }) => {
  const items = content.data.items;
  if (items?.SoulStones === undefined) {
    throw new Error("Mercy Stone requires a content archive that ships Items.plist soul stones.");
  }
  return {
    ...content,
    data: {
      ...content.data,
      items: {
        ...items,
        SoulStones: {
          ...items.SoulStones,
          [ITEM_NAME]: {
            class: "SoulStone",
            slot: "Monster",
            // An EMPTY stats dict is the point: `GameData.loadItems` turns it into an empty
            // enabledStats set, so the shipped `level * weight` bonus term is zero for every stat
            // and this stone moves no number on any card, bar, or battle projection.
            stats: {},
            rendererData: { spriteFrame: ITEM_FRAME },
          },
        },
      },
      strings: { ...content.data.strings, ...STRINGS },
    },
  };
});

// `soulStoneByElement` is the single lookup every stone consumer funnels through — stat children,
// the equip path's MaxHP adjustment, both info popups, and the picker's stat rows. Teaching it the
// new key from the overlaid item keeps the data the source of truth and leaves the other call
// sites untouched.
dibMod.intercept(GameData.prototype, "soulStoneByElement", function (next, element) {
  if (element !== ELEMENT) return next(element);
  return { path: ITEM_PATH, element: ELEMENT, enabledStats: this.item(ITEM_PATH).enabledStats };
});

const isMercyStone = (stone) => stone?.element === ELEMENT;

// ---------------------------------------------------------------------------------------------
// 2. Art. Two frames baked from the shipped Life frames into the atlases that already back them.
// ---------------------------------------------------------------------------------------------

let renderer;
dibMod.hooks.on("boot:ready", ({ value: boot }) => {
  renderer = boot.stage.app.renderer;
});

function recolour(source) {
  try {
    const holder = new Container();
    const sprite = new Sprite(source);
    sprite.anchor.set(0, 0);
    holder.addChild(sprite);
    // Drain the element colour, lift it, then push it back toward ivory-gold — a hue no shipped
    // stone uses, so the badge on a party card stays readable at its 16pt draw size.
    const filter = new ColorMatrixFilter();
    filter.desaturate();
    filter.brightness(1.25, true);
    filter.tint(STONE_TINT, true);
    holder.filters = [filter];
    const target = RenderTexture.create({
      width: source.width,
      height: source.height,
      resolution: source.source.resolution,
      antialias: false,
    });
    renderer.render({ container: holder, target, clear: true });
    holder.destroy({ children: true });
    dibMod.onDispose(() => target.destroy(true));
    return target;
  } catch (error) {
    console.warn("Mercy Stone: keeping the base soul-stone art", error);
    return undefined;
  }
}

function bakeFrame(sheet, frameName, baseFrameName) {
  if (sheet.textures[frameName] !== undefined) return;
  const base = sheet.textures[baseFrameName];
  // `AssetLibrary` caches one Spritesheet per atlas and this interception runs on every request
  // for it, so a pre-boot request (the startup preload, before a renderer exists) simply defers
  // the bake to the next one — every consumer asks for the atlas again when it opens.
  if (base === undefined || renderer === undefined) return;
  sheet.textures[frameName] = recolour(base) ?? base;
}

dibMod.intercept(AssetLibrary.prototype, "atlas", async function (next, name) {
  const sheet = await next(name);
  if (name === "InventoryItemFrames-hd") bakeFrame(sheet, ITEM_FRAME, BASE_ITEM_FRAME);
  else if (name === "General-hd") bakeFrame(sheet, ELEMENT_FRAME, BASE_ELEMENT_FRAME);
  return sheet;
});

// ---------------------------------------------------------------------------------------------
// 3. Ownership. Stones live in the party aggregate's owned pool, exactly like a converted one.
// ---------------------------------------------------------------------------------------------

// TypeScript's `private` is not a JavaScript #private field, so the pool, its token allocator, and
// its validator are all reachable. Minting through the aggregate's own validator keeps a mod-made
// stone under the same fail-loud contract as `convertToSoulStone`'s.
function mintPooledStone(party) {
  const stone = { element: ELEMENT, level: STONE_LEVEL };
  party.validateSoulStone(stone);
  const token = party.allocateStoneToken();
  party.stones.push({ token, stone });
  return token;
}

function dropPooledStone(party, token) {
  const index = party.stones.findIndex((entry) => entry.token === token);
  if (index >= 0) party.stones.splice(index, 1);
}

// `BattleCore`'s constructor refuses a Desoul carrier whose stone has no `sourceType` (the species
// Desoul would revive), and a monster can evolve into a Desoul carrier while wearing this stone.
// Bonding the stone to its holder on equip keeps that guard satisfied on every path; the Desoul
// gate below is what makes the recorded species unreachable.
dibMod.intercept(
  WorldTripParty.prototype,
  "insertSoulStoneByToken",
  function (next, instanceId, token) {
    const entry = this.stones.find((candidate) => candidate.token === token);
    if (isMercyStone(entry?.stone) && entry.stone.sourceType === undefined) {
      entry.stone.sourceType = this.memberOrThrow(instanceId).shortType;
    }
    return next(instanceId, token);
  },
);

const runtimeByProfile = new WeakMap();
for (const factory of ["standalone", "world", "fromStateSnapshot"]) {
  dibMod.intercept(PlayerRuntimeState, factory, function (next, ...args) {
    const runtime = next(...args);
    runtimeByProfile.set(runtime.profile, runtime);
    return runtime;
  });
}

const partyFor = (profile) => runtimeByProfile.get(profile)?.party;

// ---------------------------------------------------------------------------------------------
// 4. Shop. A silver stock in the Items aisle, checked out through the flow's own purchase seam.
// ---------------------------------------------------------------------------------------------

const MERCY_STOCK = Object.freeze({
  id: STOCK_ID,
  // `usable` is the store's generic item shape: the carousel renders `rendererData.spriteFrame`,
  // the name comes from the instance's own `Renderable...NameKey`, and quantity 1..99 is allowed.
  kind: "usable",
  definitionPath: ITEM_PATH,
  instanceName: ITEM_NAME,
  level: STONE_LEVEL,
  currency: "silver",
  unitPrice: PRICE_SILVER,
});

dibMod.intercept(StoreFlow.prototype, "entries", function (next, ...args) {
  const base = next(...args);


  if (this.category !== 1 || partyFor(this.opts.profile) === undefined) return base;
  const afterUsables = base.reduce(
    (at, entry, index) => (entry.kind === "usable" ? index + 1 : at),
    0,
  );
  return [...base.slice(0, afterUsables), MERCY_STOCK, ...base.slice(afterUsables)];
});

function purchaseMercyStones(profile, quantity) {
  const party = partyFor(profile);
  // Unreachable while the stock is gated above; kept as the Store's own refusal shape rather than
  // an unhandled throw through its purchase-error branch.
  if (party === undefined) throw new Error("Store: insufficient silver");
  const spent = PRICE_SILVER * quantity;
  if (profile.snapshot().silver < spent) throw new Error("Store: insufficient silver");
  const tokens = [];
  for (let index = 0; index < quantity; index += 1) tokens.push(mintPooledStone(party));
  // Mint first, debit second: `spendSilver` is what notifies the save checkpoint, and the snapshot
  // it writes must already contain the stones this checkout paid for.
  if (!profile.spendSilver(spent)) {
    for (const token of tokens) dropPooledStone(party, token);
    throw new Error("Store: insufficient silver");
  }
  return Object.freeze({
    stockId: STOCK_ID,
    quantity,
    currency: "silver",
    spent,
    balance: profile.snapshot().silver,
    receivedItems: Object.freeze(tokens.map(() => Object.freeze({
      kind: "usable",
      definitionPath: ITEM_PATH,
      instanceName: ITEM_NAME,
      level: STONE_LEVEL,
    }))),
  });
}

// Both Store hosts (town shop, defeat recovery) hand the flow their own checkout callback, so
// wrapping it at the one construction point covers every route without knowing either host.
dibMod.intercept(StoreFlow, "show", function (next, opts) {
  const purchase = opts.purchase;
  return next({
    ...opts,
    purchase: async (stock, quantity) => stock.id === STOCK_ID
      ? purchaseMercyStones(opts.profile, quantity)
      : await purchase(stock, quantity),
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Insert Soul Stone. The picker's stat strip is replaced by a name for a stone with no stats.
// ---------------------------------------------------------------------------------------------

// The shipped row body describes a stone by its positive stat strip, and this stone has none: the
// real builder refuses it (every minted stone has some). Only the SmallItemDisplay body is
// replaced, and only for this element — the paged picker keeps the row wrapper, selection pulse,
// nearest-hit arbitration, page slicing, and the Drop/Insert/Info actions, so a Mercy Stone is an
// ordinary member of the list rather than an appended row outside its model.
dibMod.intercept(
  PartyEditorFlow.prototype,
  "buildStonePickerRowDisplay",
  function (next, opts, entry) {
    if (!isMercyStone(entry.stone)) return next(opts, entry);
    const metrics = dungeonLootDisplayMetrics(runtimeSettings.DISPLAY_MODE);
    const display = new Box({
      horizontal: true,
      gap: metrics.rowGap,
      positiveAlignDirection: true,
      roundingScale: sourcePointsPerPortPoint(runtimeSettings.DISPLAY_MODE),
    });
    const itemSlot = new Container();
    itemSlot.boundsArea = new Rectangle(0, 0, metrics.iconSide, metrics.iconSide);
    const texture = opts.soulStoneTextures.get(ELEMENT);
    if (texture === undefined) throw new Error(`Mercy Stone: picker texture ${ITEM_FRAME} is missing`);
    const icon = pointSprite(texture);
    icon.label = `stonePickerItem:${entry.token}:${ELEMENT}`;
    const fit = metrics.iconSide / Math.max(icon.width, icon.height);
    icon.scale.set(icon.scale.x * fit, icon.scale.y * fit);
    icon.anchor.set(0.5);
    icon.position.set(metrics.iconSide / 2, metrics.iconSide / 2);
    itemSlot.addChild(icon);
    display.addBoxChild(itemSlot, { contentSize: { w: metrics.iconSide, h: metrics.iconSide } });
    // A name where the stat cells would be: the row still has to say which item it is, and this
    // one has no number to show.
    const name = makeTtfLabel(DISPLAY_NAME, metrics.nameFontSize, {
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    name.label = `stonePickerName:${entry.token}`;
    display.addBoxChild(name);
    return display;
  },
);

// The shipped item popup is a title over a stat table, and this stone has no stats. Every caller
// of that popup gets the rule text through its own message-popup helper instead.
for (const [prototype, method, message] of [
  [TargetPicker.prototype, "showSoulStoneInfo", "showMessagePopup"],
  [PartyEditorFlow.prototype, "showSoulStoneInfo", "showMessage"],
  [EggHatchFlow.prototype, "showFeedSoulStoneInfo", "showFeedMessage"],
]) {
  dibMod.intercept(prototype, method, async function (next, stone) {
    if (stone?.name !== DISPLAY_NAME) return await next(stone);
    await this[message](INFO_MESSAGE);
  });
}

// ---------------------------------------------------------------------------------------------
// 6. Combat. One clamp at the engine's single HP mutation point, and one gate on Desoul.
// ---------------------------------------------------------------------------------------------

const battleStates = new WeakMap();
/** The exact `damageDealt` events the clamp below produced, by object identity (see its note). */
const sparedBlowEvents = new WeakSet();
function stateFor(core) {
  let state = battleStates.get(core);
  if (state === undefined) {
    state = { sparedBlows: 0, lastHolderId: null, lastSparedId: null, lastWithheldDamage: 0 };
    battleStates.set(core, state);
  }
  return state;
}

// `applyHpDelta` is the ONLY place a Living's HP moves — ability hits, poison ticks, reflected
// bounces and sacrifices all funnel through it — so clamping the delta here covers every way the
// holder can deal damage, and does it BEFORE the emitted `damageDealt` and the death pipeline. The
// floater the player sees is therefore the damage that was actually dealt.
dibMod.intercept(BattleCore.prototype, "applyHpDelta", function (next, id, delta, sourceId, opts) {
  if (delta >= 0 || id === sourceId) return next(id, delta, sourceId, opts);
  const holder = this.livings.get(sourceId);
  if (!isMercyStone(holder?.soulStone)) return next(id, delta, sourceId, opts);
  const target = this.livings.get(id);
  if (target === undefined || target.hp < MERCY_FLOOR || target.hp + delta >= MERCY_FLOOR) {
    return next(id, delta, sourceId, opts);
  }
  const spared = MERCY_FLOOR - target.hp;
  const state = stateFor(this);
  state.sparedBlows += 1;
  state.lastHolderId = sourceId;
  state.lastSparedId = id;
  state.lastWithheldDamage = spared - delta;
  // A target already at the floor takes a fully-mitigated hit: the engine's own display-only zero
  // (native red "-0") reports it without waking sleep, bouncing a reflect, or crediting a proc.
  const withheld = spared === 0 && opts?.element !== undefined
    ? { ...opts, displayZeroDamage: true }
    : opts;
  // `core.events` IS the live event log (`return this.eventLog`), and every consumer slices it
  // rather than cloning, so the `damageDealt` this clamped hit is about to emit keeps its object
  // identity all the way into `AbilityRenderer.renderResult`'s `events`. Marking that one object
  // is what lets the floater below find the spared blow among a multi-target result without
  // guessing from ids, amounts, or hp values that a second hit in the same phase could match.
  const before = this.events.length;
  const outcome = next(id, spared, sourceId, withheld);
  for (let index = before; index < this.events.length; index += 1) {
    const event = this.events[index];
    if (event.type === "damageDealt" && event.target === id && event.source === sourceId) {
      sparedBlowEvents.add(event);
      break;
    }
  }
  return outcome;
});

// The call-out. `renderResult` is where a phase's own results are painted, and it receives the
// very event objects marked above, so the floater is spawned for exactly the hits the clamp
// touched — including a reflected bounce or a poison tick the holder owns, which reach this same
// renderer through their own events.
//
// Spawning BEFORE `next` reserves a LOWER paint order, which is the slot a reactive dispatch
// occupies natively (abilityRenderer.ts's pre-pass note: `StunProcBuff`'s STUN! sits under the
// ability's own move art because its `handleAbilityResults:` runs inline from the damage
// listener). This stone's clamp is that same shape of reaction, so it paints there too, at row 0
// with the shipped `message` offset — the row the ability's own damage number never occupies.
dibMod.intercept(AbilityRenderer.prototype, "renderResult", async function (next, events, nodes, opts) {
  const floaters = [];
  for (const event of events) {
    if (!sparedBlowEvents.delete(event)) continue;
    const displayArea = nodes.displayAreaOf(event.target);
    if (displayArea === null || displayArea === undefined) continue;
    floaters.push(this.spawnFloater(
      this.localizedString(EFFECT_KEY),
      MERCY_FLOATER_COLOR,
      this.localRectOf(displayArea),
      0,
      "message",
    ));
  }
  // Awaited together with the result rather than detached: the renderer aborts its own tweens
  // when the scene tears down, and a floater that outlives the call it belongs to would report a
  // rejection nobody owns.
  const [rendered] = await Promise.all([next(events, nodes, opts), ...floaters]);
  return rendered;
});

// A Mercy Stone holds no soul, so it cannot be spent as one. Hiding it for the duration of the
// shipped gate returns that gate's own `MonsterHasNoSoulStone` refusal, with no ability-shape
// guesswork here and no other condition in the gate affected.
dibMod.intercept(
  BattleCore.prototype,
  "blockUseReasonFor",
  function (next, casterId, ability, args) {
    const caster = this.livings.get(casterId);
    if (!isMercyStone(caster?.soulStone)) return next(casterId, ability, args);
    const stone = caster.soulStone;
    caster.soulStone = undefined;
    try {
      return next(casterId, ability, args);
    } finally {
      caster.soulStone = stone;
    }
  },
);

dibMod.intercept(BattleNode.prototype, "renderGameState", function (next, ...args) {
  const rendered = next(...args);
  const core = this.session?.core;
  return {
    ...rendered,
    codeMods: {
      ...(rendered.codeMods ?? {}),
      mercyStone: core === undefined ? null : { ...stateFor(core) },
    },
  };
});

dibMod.exports.element = ELEMENT;
dibMod.exports.itemPath = ITEM_PATH;
dibMod.exports.stockId = STOCK_ID;
dibMod.exports.priceSilver = PRICE_SILVER;
dibMod.exports.grantToParty = (profile) => {
  const party = partyFor(profile);
  if (party === undefined) throw new Error("Mercy Stone: this player has no durable party");
  return mintPooledStone(party);
};
