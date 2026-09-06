










import {
  Container,
  Graphics,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type Texture,
} from "pixi.js";
import {
  Box,
  makeTtfLabel,
  minimumHitRectLocal,
  nearestMinimumHit,
  OUTLINE_FADE_ALPHA,
  pointSprite,
  ProgressBar,
  rectContainsPoint,
  type AssetLibrary,
} from "@dib/renderer";
import type { PlayerChoice } from "@dib/engine";
import type { JobAbilityRef, MonsterDef } from "@dib/gamedata";
import { LIVING_STAT_NAMES, type LivingInfoSoulStone } from "./soulStoneInfoMath.js";
import { livingInfoScrollHitTest, type LivingInfoScrollLayout } from "./livingInfoScrollMath.js";
import { evolveRowFontPt, type LivingInfoEvolveRow } from "./evolveChainInfoMath.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { idiomPairPt, sourcePointsPerPortPoint, unscaledIdiomPt } from "../displayMode.js";
import { MARKER_FELT_FAMILY } from "../localFonts.js";
import { SCREEN_W } from "./displayShared.js";
import type { AbilityInfoModel } from "./abilityInfo.js";
import {
  buildLocalizedMonsterHatchMessageContent,
} from "../ui/monsterHatchPopup.js";

/** The seven real element names (`Element<Name>Help{Title,Message}Key` families all exist in the
 *  shipped strings table for exactly these). */
export type ElementHelpName = "Life" | "Death" | "Water" | "Fire" | "Earth" | "Air" | "Arcane";



export {
  LIVING_STAT_NAMES,
  soulStoneSmallItemStatRows,
  soulStoneStatRows,
  type LivingInfoSoulStone,
  type SoulStoneInfoStatRow,
} from "./soulStoneInfoMath.js";
// Likewise the evolve-chain row math (gating + font pair) — see evolveChainInfoMath.ts.
export {
  evolveChainInfoRows,
  evolveRowFontPt,
  type LivingInfoEvolveRow,
} from "./evolveChainInfoMath.js";



export function buildElementHelpContent(element: ElementHelpName, strings: LocalizedStrings): Container {
  return buildLocalizedMonsterHatchMessageContent(strings, `Element${element}Help`);
}

export interface LivingInfoStatRow {
  /** Living stat enum index 1..5 (MaxHP(0) is removed by the card itself — see
   *  buildLivingInfoContent's doc). */
  statType: 1 | 2 | 3 | 4 | 5;
  value: number;
}

export interface LivingInfoSnapshot {
  /** Localized display name (`-[Living displayName]` — battleNode resolves it). */
  name: string;
  monster: MonsterDef;
  level: number;
  hp: number;
  maxHp: number;




  xpThisLevel: number;


  xpCostOfNextLevel: number;




  stats: readonly LivingInfoStatRow[];
  /** The full `[living abilities]` set the original's AbilityList renders: every job-ability ref
   *  — the turn panel's usable-combat choices PLUS the passive (non-`usableN`-slot) refs
   *  (Passive.Immunity/Aura/Berserk/Generic/Thorns/SlowProc across the shipped Jobs.json leaves).
   *  A prior revision passed only the usable set, documented as "identical for this slice's
   *  data"; that stopped being true once passive carriers (Shenron etc.) entered the roster.
   *  Soul-stone rows still contribute nothing — no shipped SoulStone entry has an `abilities`
   *  key (soulstones.md §"abilitiesRecursive"), so job refs ARE the whole list. `displayName`
   *  is already localized (`-[Renderable localizedName]` — battleNode resolves it). */
  abilities: readonly LivingInfoAbility[];
  /** `[living childrenOfType:[SoulStone class]]` (soulstone-info-display.md §1) — the LIVE
   *  equipped set (engine `soulStoneOf`; empty again after Desoul consumes the stone). At most
   *  one in this port (RootJob.slots), but the native section fast-enumerates a list. The section
   *  renders in EVERY livingInfoDisplayStyle (no style gate exists — §1) whenever non-empty. */
  soulStones: readonly LivingInfoSoulStone[];
  /** The Monsterpedia evolve-chain rows (evolve-chain-rows.md §3), ALREADY gated per-row on the
   *  player's collection — battleNode runs `evolveChainInfoRows(gd.evolveChainOf(shortType),
   *  collection.hasCapturedSimpleType, ...)` so this builder stays layout-only, exactly like
   *  `stats`/`abilities` arrive precomputed. Empty for every non-evolving monster AND whenever
   *  no next stage is unlocked; the builder then renders NO section at all (deliberately
   *  skipping the original's empty stray Box — §3's "empty-chain gotcha"). */
  evolveRows: readonly LivingInfoEvolveRow[];
}

/** One AbilityList row: either a usable-combat choice (tap → the full UsableAbility description
 *  pipeline) or a passive job-ability ref (tap → the base-Ability/AuraAbility/BerserkAbility
 *  description path — passives are NOT UsableAbility descendants, targeting-passives.md §A). */
export type LivingInfoAbility =
  | { kind: "usable"; choice: PlayerChoice }
  | { kind: "passive"; ref: JobAbilityRef; displayName: string };

/** Row label = `ability.localizedName` (`AbilityList init` — the `compareByName:` sort key). */
export function livingInfoAbilityName(ability: LivingInfoAbility): string {
  return ability.kind === "usable" ? ability.choice.displayName : ability.displayName;
}

/** Tap wiring for the card's touchable nodes (`LivingInfoDisplay.touchableNodes` +
 *  `BonusStatsCommonDisplay`/`AbilityList`'s own `ccTouchEnded:` dispatch). `targetPicker.ts`
 *  routes each to the matching stacked popup; builders stay layout-only. */
export interface LivingInfoHooks {

  onElementTap?: (() => void) | undefined;


  onStatTap?: ((statType: number) => void) | undefined;
  /** XP bar (case 1 → "XPInfo"). */
  onXpTap?: (() => void) | undefined;

  onAbilityTap?: ((ability: LivingInfoAbility) => void) | undefined;
  /** Soul-stone rows (userObject = the SoulStone itself → `ccTouchEnded:`'s `isKindOfClass:Item`
   *  branch → `[ItemInfoDisplay showPopupForItem:stone livingContext:living]`,
   *  soulstone-info-display.md §2 — livingContext is the OPEN monster, not nil). */
  onSoulStoneTap?: ((stone: LivingInfoSoulStone) => void) | undefined;
  /** The "Soul Stone" section TITLE (userObject NSNumber(9) → `intValue−6` case 3 →
   *  `showPopupForLocalizedMessageName:@"ItemsInfo"` — the generic Items explainer, §2). */
  onSoulStoneTitleTap?: (() => void) | undefined;
}

export interface LivingInfoBuildOptions {
  /** Style-2-only first child of the existing horizontal header Box. The following name/level
   * label uses `gapAfter` as its GapNode transition, so this decorates the header rather than
   * wrapping the entire information card in a second layout container. */
  leadingHeaderAction?: {
    node: Container;
    gapAfter: number;
    onPress?: () => void;
  } | undefined;
  /** Browser cancellation leaves Pixi's hit-tested propagation path, while the source dispatcher
   * still sends `ccTouchCancelled:` to the delegate that claimed the sequence. The canvas bridge
   * restores that claimed-touch delivery and is torn down with the popup content. */
  nativePointerCancelTarget?: HTMLCanvasElement | undefined;
}






const NAME_LEVEL_SIZE = 20;
const ELEMENT_ICON_FIT_H = 30;
const STATS_ROW_GAP = 30;
const HP_LABEL_SIZE = 16;
const ROW_GAP = 10;
const ABILITY_ROW_SIZE = 16;
const STAT_ICON_FIT = 20;
const STAT_VALUE_SIZE = 14;
/** Soul-stone section title AND every row: `data_b5bfc`=18.0 phone / `data_b5c00`=36.0 iPad — a
 *  doubled idiom pair, so 18pt in both of this port's normalized modes (soulstone-info-display.md
 *  §1). Same pair serves the ItemInfoDisplay popup title (`data_b41ac/b41b0`, §3). */
let SOULSTONE_ROW_SIZE = idiomPairPt(18, 36, DISPLAY_MODE);
/** ItemInfoDisplay's explicit title→stats gap spacer: `data_b41b4`=10.0 / `data_b41b8`=20.0 —
 *  doubled pair, 10pt both modes (§3). */
let ITEM_POPUP_TITLE_GAP = idiomPairPt(10, 20, DISPLAY_MODE);
/** Evolve-chain row label: `data_b5bec`=16.0 / `data_b5bf0`=32.0 doubled pair → 16pt both modes
 *  (evolve-chain-rows.md §7; classified in evolveChainInfoMath.evolveRowFontPt). */
let EVOLVE_ROW_SIZE = evolveRowFontPt(DISPLAY_MODE);











let BOX_DEFAULT_GAP = unscaledIdiomPt(5, DISPLAY_MODE);













const XP_BAR_SCALE_Y = 0.7;
const XP_BAR_TINT = 0xffff00;





let UNDERLINE_THICKNESS = unscaledIdiomPt(2, DISPLAY_MODE);
const UNDERLINE_COLOR = 0xffffff;
























let SCROLL_VIEWABLE_W = SCREEN_W * 0.75;
let SCROLL_VIEWABLE_H = idiomPairPt(128, 300, DISPLAY_MODE);



const SCROLLBAR_X_GAP = 10;





export let ITEM_INFO_GAP_BEFORE_BUTTONS = unscaledIdiomPt(40, DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  SOULSTONE_ROW_SIZE = idiomPairPt(18, 36, DISPLAY_MODE);
  ITEM_POPUP_TITLE_GAP = idiomPairPt(10, 20, DISPLAY_MODE);
  EVOLVE_ROW_SIZE = evolveRowFontPt(DISPLAY_MODE);
  BOX_DEFAULT_GAP = unscaledIdiomPt(5, DISPLAY_MODE);
  UNDERLINE_THICKNESS = unscaledIdiomPt(2, DISPLAY_MODE);
  SCROLL_VIEWABLE_W = SCREEN_W * 0.75;
  SCROLL_VIEWABLE_H = idiomPairPt(128, 300, DISPLAY_MODE);
  ITEM_INFO_GAP_BEFORE_BUTTONS = unscaledIdiomPt(40, DISPLAY_MODE);
});







































export class SourceTouchableGroup {
  private readonly targets: Array<{ node: Container; action: () => void }> = [];

  constructor(private readonly owner: Container) {}

  add(node: Container, action: (() => void) | undefined): void {
    if (!action) return;
    node.eventMode = "none";
    node.cursor = "pointer";
    this.targets.push({ node, action });
  }

  install(): void {
    if (this.targets.length === 0) return;
    const targetAt = (point: Readonly<{ x: number; y: number }>) => nearestMinimumHit(
      this.targets.map((target) => {
        const bounds = target.node.getLocalBounds();
        const corners = [
          this.owner.toLocal(target.node.toGlobal({ x: bounds.x, y: bounds.y })),
          this.owner.toLocal(target.node.toGlobal({ x: bounds.x + bounds.width, y: bounds.y })),
          this.owner.toLocal(target.node.toGlobal({ x: bounds.x, y: bounds.y + bounds.height })),
          this.owner.toLocal(target.node.toGlobal({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })),
        ];
        const xs = corners.map(({ x }) => x);
        const ys = corners.map(({ y }) => y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return {
          value: target,
          contentRect: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
          ownScale: { x: 1, y: 1 },
        };
      }),
      point,
    );
    // Identity transform at the owner's origin, so the hit-area point Pixi hands us in layer-local
    // space is already the owner-local space `targetAt` measures in.
    const hitLayer = new Container();
    hitLayer.label = "sourceTouchableHitLayer";
    hitLayer.eventMode = "static";
    hitLayer.cursor = "pointer";
    hitLayer.hitArea = { contains: (x, y) => targetAt({ x, y }) !== undefined };









    hitLayer.on("pointertap", (event: FederatedPointerEvent) => {
      const target = targetAt(event.getLocalPosition(this.owner));
      if (!target) return;
      event.stopPropagation();
      target.action();
    });
    this.owner.addChildAt(hitLayer, 0);
  }
}









function buildBonusStatsBlock(
  rows: readonly { statType: number; value: number }[],
  frameOf: (name: string) => Texture,
  onStatTap: ((statType: number) => void) | undefined,
): Container {
  const statsBlock = new Container();
  const touchables = new SourceTouchableGroup(statsBlock);
  const statCells = rows.map((row) => {
    const icon = pointSprite(frameOf(`Stat${LIVING_STAT_NAMES[row.statType]}.png`));


    const fit = STAT_ICON_FIT / Math.max(icon.width, icon.height);
    icon.scale.set(icon.scale.x * fit, icon.scale.y * fit);
    touchables.add(icon, onStatTap && (() => onStatTap(row.statType)));
    const value = makeTtfLabel(String(row.value), STAT_VALUE_SIZE, { outline: false });
    touchables.add(value, onStatTap && (() => onStatTap(row.statType)));
    return { icon, value };
  });
  const statRowH = Math.max(1, ...statCells.map((c) => Math.max(c.icon.height, c.value.height)));
  const iconColW = Math.max(0, ...statCells.map((c) => c.icon.width));
  statCells.forEach((cell, i) => {
    const cellY = i * (statRowH + BOX_DEFAULT_GAP);
    cell.icon.position.set((iconColW - cell.icon.width) / 2, cellY + (statRowH - cell.icon.height) / 2);
    statsBlock.addChild(cell.icon);
    cell.value.position.set(iconColW + BOX_DEFAULT_GAP, cellY + (statRowH - cell.value.height) / 2);
    statsBlock.addChild(cell.value);
  });
  touchables.install();
  return statsBlock;
}

























































export async function buildLivingInfoContent(
  snapshot: LivingInfoSnapshot,
  assets: AssetLibrary,
  strings: LocalizedStrings,
  hooks: LivingInfoHooks = {},
  options: LivingInfoBuildOptions = {},
): Promise<Container> {
  const generalAtlas = await assets.atlas("General-hd");
  const frameOf = (name: string): Texture => {
    const texture = generalAtlas.textures[name];
    if (!texture) throw new Error(`buildLivingInfoContent: General-hd atlas is missing ${name}`);
    return texture;
  };

  const root = new Container();
  const livingTouchables = new SourceTouchableGroup(root);
  let rootY = 0;

  // --- Row 1: "<name> Lv:<level>" + element icon (exact 30pt-height fit, tappable). ---
  const headerRow = new Box({
    horizontal: true,
    positiveAlignDirection: true,
    gap: BOX_DEFAULT_GAP,
    roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
  });
  headerRow.label = "livingInfoHeader";
  const lv = localizedString(strings, "LevelShortKey");
  const nameLabel = makeTtfLabel(`${snapshot.name} ${lv}:${snapshot.level}`, NAME_LEVEL_SIZE, { outline: false });
  nameLabel.label = "livingInfoNameLevel";
  if (options.leadingHeaderAction !== undefined) {
    headerRow.addBoxChild(options.leadingHeaderAction.node);
    headerRow.addBoxChild(nameLabel, { gapBefore: options.leadingHeaderAction.gapAfter });
    livingTouchables.add(options.leadingHeaderAction.node, options.leadingHeaderAction.onPress);
  } else {
    headerRow.addBoxChild(nameLabel);
  }
  const elementIcon = pointSprite(frameOf(`Element${snapshot.monster.element}.png`));
  const iconFit = ELEMENT_ICON_FIT_H / elementIcon.height;
  elementIcon.scale.set(elementIcon.scale.x * iconFit, elementIcon.scale.y * iconFit);
  elementIcon.label = "livingInfoElementIcon"; // browser-harness handle (arbitration scenario)
  livingTouchables.add(elementIcon, hooks.onElementTap);
  headerRow.addBoxChild(elementIcon);
  root.addChild(headerRow);
  rootY += headerRow.boxContentSize.h + BOX_DEFAULT_GAP;

  // --- Row 2: HP string + XP title + empty yellow xp bar (all cited in the class doc). ---
  const hpXpRow = new Container();
  hpXpRow.position.set(0, rootY);
  const hpWord = localizedString(strings, "HPKey");
  const hpLabel = makeTtfLabel(`${hpWord}: ${snapshot.hp}/${snapshot.maxHp}`, HP_LABEL_SIZE, { outline: false });
  hpLabel.label = "livingInfoHpLabel"; // browser-harness handle (arbitration scenario)
  livingTouchables.add(hpLabel, hooks.onStatTap && (() => hooks.onStatTap!(0)));
  hpXpRow.addChild(hpLabel);
  const xpTitle = makeTtfLabel(localizedString(strings, "XPInfoTitleKey"), HP_LABEL_SIZE, { outline: false });
  xpTitle.position.set(hpLabel.width + ROW_GAP, 0);
  hpXpRow.addChild(xpTitle);


  const xpMax = Math.max(1, Math.trunc(snapshot.xpCostOfNextLevel));
  const xpBar = new ProgressBar({
    backgroundTexture: frameOf("monsterHpBarBack.png"),
    foregroundTexture: frameOf("monsterHpBar.png"),
    labelFontFile: null,
    max: xpMax,
  });
  xpBar.setRatio(Math.min(Math.max(0, snapshot.xpThisLevel), xpMax) / xpMax);
  // The popup content is never added to a Ticker, so present the settled fill directly — the
  // source's scheduled bar reaches this exact state on its first `update:` tick (the `first` snap).
  xpBar.snapToTarget();
  xpBar.setTint(XP_BAR_TINT);
  xpBar.scale.set(xpBar.scale.x, xpBar.scale.y * XP_BAR_SCALE_Y);
  const xpBarH = xpBar.getLocalBounds().height * xpBar.scale.y;
  xpBar.position.set(hpLabel.width + ROW_GAP + xpTitle.width + ROW_GAP, (hpLabel.height - xpBarH) / 2);
  livingTouchables.add(xpBar, hooks.onXpTap);
  hpXpRow.addChild(xpBar);
  root.addChild(hpXpRow);
  rootY += hpLabel.height + BOX_DEFAULT_GAP;

  // --- Row 3: the scrolled sections area (a 10pt-gap VERTICAL column of section boxes:
  // stats+abilities first, then — data-gated — the soul-stone box; soulstone-info-display.md §1's
  // array-append order, both inside the ONE ScrollingNode viewport). ---
  const sections = new Container();
  const statsAbilities = new Container();

  // 3a. BonusStatsCommonDisplay: icon column + value column, uniform row heights (shared builder
  // — the same class renders a stone popup's rows, see buildBonusStatsBlock).
  const statsBlock = buildBonusStatsBlock(snapshot.stats, frameOf, hooks.onStatTap);
  statsAbilities.addChild(statsBlock);

  // 3b. AbilityList (vertical Box, no horizontalAlignment override): the "Abilities" header and
  // every ability row are cross-axis CENTERED relative to one another (see the card doc). Build
  // them first, measure the widest, then center each within that column width. The header's 2pt
  // white underline is a SIBLING positioned under the centered header — NOT a child of the Pixi
  // `Text` node (a prior revision parented it to the Text, whose 1/CONTENT_SCALE_FACTOR node scale
  // halved the line and drew it mid-glyph as a strikethrough instead of under the word).
  const abilityColumn = new Container();
  const abilityTouchables = new SourceTouchableGroup(abilityColumn);
  const header = makeTtfLabel(strings["Abilities"] ?? "Abilities", ABILITY_ROW_SIZE, { outline: false });
  const abilityRows = [...snapshot.abilities]
    .sort((a, b) => livingInfoAbilityName(a).localeCompare(livingInfoAbilityName(b)))
    .map((ability) => {
      const rowLabel = makeTtfLabel(livingInfoAbilityName(ability), ABILITY_ROW_SIZE, { outline: false });
      rowLabel.label = "livingInfoAbilityRow"; // browser-harness handle (arbitration scenario)
      abilityTouchables.add(rowLabel, hooks.onAbilityTap && (() => hooks.onAbilityTap!(ability)));
      return rowLabel;
    });
  const abilityColW = Math.max(header.width, ...abilityRows.map((r) => r.width));
  const headerX = (abilityColW - header.width) / 2;
  header.position.set(headerX, 0);
  abilityColumn.addChild(header);
  const underline = new Graphics()
    .rect(headerX, header.height, header.width, UNDERLINE_THICKNESS)
    .fill(UNDERLINE_COLOR);
  abilityColumn.addChild(underline);
  let abilityY = header.height + UNDERLINE_THICKNESS + BOX_DEFAULT_GAP;
  for (const rowLabel of abilityRows) {
    rowLabel.position.set((abilityColW - rowLabel.width) / 2, abilityY);
    abilityColumn.addChild(rowLabel);
    abilityY += rowLabel.height + BOX_DEFAULT_GAP;
  }
  abilityTouchables.install();
  abilityColumn.position.set(statsBlock.width + STATS_ROW_GAP, 0);
  statsAbilities.addChild(abilityColumn);
  sections.addChild(statsAbilities);

  // 3c. Soul-stone section (soulstone-info-display.md §1) — a SIBLING vertical box appended
  // AFTER the stats+abilities box, gated purely on data (`stones.count != 0`; NO style gate).
  // White underlined "Soul Stone" title + one bare-text row per stone (`stone.localizedName`,
  // NO icon, NO level number — the level only ever appears baked into the popup's stat values),
  // all at the same 18pt, cross-axis centered like every vertical Box. The native underline's
  // parentOverride is the sections box rather than the stone box itself — same coordinate frame
  // either way, so this port parents it locally like the AbilityList header's underline.
  const sectionBoxes: Container[] = [statsAbilities];
  if (snapshot.soulStones.length > 0) {
    const stoneBox = new Container();
    const stoneTouchables = new SourceTouchableGroup(stoneBox);
    const stoneTitle = makeTtfLabel(
      localizedString(strings, "SoulStoneTitleKey"),
      SOULSTONE_ROW_SIZE,
      { outline: false },
    );
    stoneTouchables.add(stoneTitle, hooks.onSoulStoneTitleTap);
    const stoneRows = snapshot.soulStones.map((stone) => {
      const rowLabel = makeTtfLabel(stone.name, SOULSTONE_ROW_SIZE, { outline: false });
      stoneTouchables.add(rowLabel, hooks.onSoulStoneTap && (() => hooks.onSoulStoneTap!(stone)));
      return rowLabel;
    });
    const stoneColW = Math.max(stoneTitle.width, ...stoneRows.map((r) => r.width));
    const stoneTitleX = (stoneColW - stoneTitle.width) / 2;
    stoneTitle.position.set(stoneTitleX, 0);
    stoneBox.addChild(stoneTitle);
    stoneBox.addChild(
      new Graphics()
        .rect(stoneTitleX, stoneTitle.height, stoneTitle.width, UNDERLINE_THICKNESS)
        .fill(UNDERLINE_COLOR),
    );
    let stoneY = stoneTitle.height + UNDERLINE_THICKNESS + BOX_DEFAULT_GAP;
    for (const rowLabel of stoneRows) {
      rowLabel.position.set((stoneColW - rowLabel.width) / 2, stoneY);
      stoneBox.addChild(rowLabel);
      stoneY += rowLabel.height + BOX_DEFAULT_GAP;
    }
    stoneTouchables.install();
    sections.addChild(stoneBox);
    sectionBoxes.push(stoneBox);
  }












  if (snapshot.evolveRows.length > 0) {
    const format = localizedString(strings, "EvolvesAtFormatKey");
    const stageTextures = await Promise.all(
      snapshot.evolveRows.map((row) => assets.sprite(`${row.shortType}-hd`)),
    );
    const evolveBox = new Container();
    const rowBoxes = snapshot.evolveRows.map((row, i) => {
      const rowBox = new Container();
      const sprite = pointSprite(stageTextures[i]!);
      const dataScale = row.rendererScale ?? 1;
      sprite.scale.set(sprite.scale.x * dataScale, sprite.scale.y * dataScale);
      // Preserve the binary's exact family string and normal weight; outline stays off because
      // the block has no outlineBackgroundNode call.
      const label = makeTtfLabel(format.replace("%d", String(row.evolveLevel)), EVOLVE_ROW_SIZE, {
        outline: false,
        bold: false,
        fontFamily: MARKER_FELT_FAMILY,
      });
      // Horizontal Box: icon FIRST, label SECOND (§3 children order), default 5pt gap, each
      // cross-axis (vertically) centered on the row line per Box's −h/2 convention.
      const rowH = Math.max(sprite.height, label.height);
      sprite.position.set(0, (rowH - sprite.height) / 2);
      rowBox.addChild(sprite);
      label.position.set(sprite.width + BOX_DEFAULT_GAP, (rowH - label.height) / 2);
      rowBox.addChild(label);
      return rowBox;
    });
    const evolveColW = Math.max(...rowBoxes.map((r) => r.width));
    let evolveY = 0;
    for (const rowBox of rowBoxes) {
      rowBox.position.set((evolveColW - rowBox.width) / 2, evolveY);
      evolveBox.addChild(rowBox);
      evolveY += rowBox.height + BOX_DEFAULT_GAP;
    }
    sections.addChild(evolveBox);
    sectionBoxes.push(evolveBox);
  }

  // Sections column: stack the section boxes with the column's 10pt gap and cross-axis center
  // each within the widest (vertical-Box convention, soulstone-info-display.md §1 "Alignment").
  // One shared pass — a prior revision pairwise-centered exactly two sections inside the
  // soul-stone branch, which stops scaling at three.
  if (sectionBoxes.length > 1) {
    const secBounds = sectionBoxes.map((b) => b.getLocalBounds());
    const sectionColW = Math.max(...secBounds.map((b) => b.width));
    let secY = 0;
    sectionBoxes.forEach((box, i) => {
      const b = secBounds[i]!;
      box.position.set((sectionColW - b.width) / 2 - b.x, secY - b.y);
      secY += b.height + ROW_GAP;
    });
  }




























  const scrollRegion = new Container();
  scrollRegion.position.set(0, rootY);
  const sectionsBounds = sections.getLocalBounds();
  const viewedW = Math.min(sectionsBounds.width, SCROLL_VIEWABLE_W);
  const viewedH = Math.min(sectionsBounds.height, SCROLL_VIEWABLE_H);
  const extentX = Math.max(0, sectionsBounds.width - viewedW);
  const extentY = Math.max(0, sectionsBounds.height - viewedH);
  if (extentX > 0) {
    throw new Error(
      `buildLivingInfoContent: sections width ${sectionsBounds.width} exceeds the ` +
        `${SCROLL_VIEWABLE_W} viewport and ScrollingNode scrolling is vertical-only`,
    );
  }
  scrollRegion.addChild(sections);








  let scrollbarSpriteW = 0;
  let scrollWheelLayer: Container | undefined;
  if (extentY > 0) {
    const mask = new Graphics().rect(0, 0, viewedW, viewedH).fill(0xffffff);
    scrollRegion.addChild(mask);
    sections.mask = mask;

    const track = pointSprite(await assets.sprite("scrollbarTrack-hd"));
    track.label = "livingInfoScrollTrack"; // browser-harness handle (soulstone scenario's scroll jump)
    track.height = viewedH; // native `setScaleY: viewableH / track.contentSize.height`
    track.position.set(viewedW + SCROLLBAR_X_GAP, 0);
    scrollRegion.addChild(track);
    const thumb = pointSprite(await assets.sprite("scrollbar-hd"));
    thumb.label = "livingInfoScrollThumb";
    thumb.position.set(viewedW + SCROLLBAR_X_GAP, 0);
    scrollRegion.addChild(thumb);
    scrollbarSpriteW = thumb.width; // the `scrollbar.png` thumb feeds the source's contentSize term

    const thumbTravel = viewedH - thumb.height; // viewableH − thumb.contentSize.height
    let currentPercent = 0;
    const applyPercent = (percent: number): void => {
      currentPercent = percent;
      sections.y = -percent * extentY;
      thumb.y = percent * thumbTravel;
    };
    const percentAt = (globalX: number, globalY: number): number => {
      const local = scrollRegion.toLocal({ x: globalX, y: globalY });
      return Math.min(1, Math.max(0, local.y / viewedH));
    };
    // `ccTouchBegan:` runs BOTH bar sprites through the shared minimum-hit finalizer before
    // `CGRectContainsPoint` (see livingInfoScrollMath.ts's header for the call chain): a 12pt-wide
    // sprite is tested as a 55pt-wide rect, 21.5pt of invisible padding per side. Pixi tests a
    // `hitArea` in the node's LOCAL space, so the finalized rect is mapped back through the
    // sprite's own `1 / CONTENT_SCALE_FACTOR` scale — and the track's must be built AFTER the
    // `track.height = viewedH` stretch above, which is a scale.y change.
    for (const bar of [track, thumb]) {
      const authored = bar.getLocalBounds();
      const barRect = minimumHitRectLocal(
        { x: authored.x, y: authored.y, w: authored.width, h: authored.height },
        { x: bar.scale.x, y: bar.scale.y },
      );
      bar.hitArea = { contains: (x, y) => rectContainsPoint(barRect, { x, y }) };
    }





    let activePointerId: number | null = null;
    if (options.nativePointerCancelTarget !== undefined) {
      const abort = new AbortController();
      options.nativePointerCancelTarget.addEventListener("pointercancel", (event) => {
        if (activePointerId === event.pointerId) activePointerId = null;
      }, { signal: abort.signal });
      root.once("destroyed", () => abort.abort());
    }
    const scrollLayout = (): LivingInfoScrollLayout => ({
      viewedW,
      viewedH,
      barX: viewedW + SCROLLBAR_X_GAP,
      barW: thumb.width,
      trackH: track.height,
      thumbH: thumb.height,
      thumbY: thumb.y,
    });
    const endDrag = (event: FederatedPointerEvent, finalUpdate: boolean): void => {
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      event.stopPropagation();
      // `ccTouchEnded:` performs one final absolute update (this is what makes a no-move tap on
      // the track jump); `ccTouchCancelled:` only clears the flag.
      if (finalUpdate) applyPercent(percentAt(event.global.x, event.global.y));
      activePointerId = null;
    };
    for (const bar of [track, thumb]) {
      bar.eventMode = "static";
      bar.cursor = "pointer";
      bar.on("pointerdown", (event) => {
        if (activePointerId !== null) return; // `scrolling` already set: reject the second touch
        activePointerId = event.pointerId;
        event.stopPropagation(); // began: claim only, no position change
      });
      bar.on("pointerup", (event) => endDrag(event, true));
      bar.on("pointerupoutside", (event) => endDrag(event, true));
      bar.on("pointercancel", (event) => endDrag(event, false));
      // A claimed sequence is swallowed end to end, so the synthesized tap must not bubble out to
      // the card's `SourceTouchableGroup` router and open a stat/XP popup behind the drag.
      bar.on("pointertap", (event) => event.stopPropagation());
    }
    scrollRegion.eventMode = "static";
    scrollRegion.on("globalpointermove", (event) => {
      // Global moves are delivered to every interactive container regardless of hit testing
      // (`EventBoundary.all`), so the drag survives the finger leaving the bar — as the source's
      // claimed touch does. No `stopPropagation` here: `all()` ignores it.
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      applyPercent(percentAt(event.global.x, event.global.y));
    });














    const applyWheel = (event: FederatedWheelEvent): void => {
      const deltaScreenPx =
        event.deltaMode === 1 // DOM_DELTA_LINE (Firefox) → ~16px/line
          ? event.deltaY * 16
          : event.deltaMode === 2 // DOM_DELTA_PAGE (rare) → ~one viewport
            ? event.deltaY * viewedH
            : event.deltaY; // DOM_DELTA_PIXEL
      // The card renders scaled + letterboxed, so a screen-pixel delta is much larger than a
      // content point; convert through the region's own transform (the same basis the drag's
      // percentAt uses) so one notch moves the content the on-screen distance a page scroll would,
      // instead of overshooting to the bottom in a single click.
      const localDeltaY =
        scrollRegion.toLocal({ x: 0, y: deltaScreenPx }).y - scrollRegion.toLocal({ x: 0, y: 0 }).y;
      applyPercent(Math.min(1, Math.max(0, currentPercent + localDeltaY / extentY)));
    };
    scrollRegion.on("wheel", applyWheel);

    // The desktop scroll wheel has NO analogue in the touch-only source, so it gets a target of its
    // own rather than borrowing the region's: an empty layer over the viewport and both finalized
    // bar rects (the union, because a `hitArea` prunes its whole subtree — a viewport-only rect
    // would clip the bars' right-hand ring and the thumb's 12.5pt endpoint padding back off; the
    // thumb rect is rebuilt per test so it follows the moving thumb). It is installed as the card
    // root's index-0 child below, i.e. hit-tested LAST, so this invented affordance can never
    // outrank a real source target — it only catches notches over viewport gaps that no row ring
    // covers, since anything over a row or bar reaches `applyWheel` by bubbling instead.
    scrollWheelLayer = new Container();
    scrollWheelLayer.label = "livingInfoScrollWheelLayer";
    scrollWheelLayer.eventMode = "static";
    scrollWheelLayer.hitArea = {
      contains: (x, y) => livingInfoScrollHitTest(scrollLayout(), { x, y }),
    };
    scrollWheelLayer.on("wheel", applyWheel);
  }
  root.addChild(scrollRegion);

  // Outer vertical Box cross-axis centering: the three rows are horizontally centered relative to
  // one another (see the card doc). Each was laid out at x=0 above; shift each so its own local
  // bounds are centered within the widest row's width. The scroll region is centered by the
  // source ScrollingNode's contentSize width (viewport + scrollbar gutter, content leading-edge at
  // the sections' own left), NOT its bare child bounds — see the gutter note above.
  const headerB = headerRow.getLocalBounds();
  const hpB = hpXpRow.getLocalBounds();
  const cardRows: { node: Container; x: number; w: number }[] = [
    { node: headerRow, x: headerB.x, w: headerB.width },
    { node: hpXpRow, x: hpB.x, w: hpB.width },
    { node: scrollRegion, x: sectionsBounds.x, w: viewedW + SCROLLBAR_X_GAP + scrollbarSpriteW },
  ];
  const cardInnerW = Math.max(...cardRows.map((r) => r.w));
  for (const r of cardRows) {
    r.node.position.set((cardInnerW - r.w) / 2 - r.x, r.node.position.y);
  }

  livingTouchables.install();
  // AFTER `install()`, so index 0 is now BELOW the outer group's hit layer (children are
  // hit-tested back-to-front). Positioned in the region's final frame — the cross-centering above
  // moved it — because its hit area is expressed in region coordinates.
  if (scrollWheelLayer) {
    scrollWheelLayer.position.copyFrom(scrollRegion.position);
    root.addChildAt(scrollWheelLayer, 0);
  }
  return root;
}
















export async function buildSoulStoneInfoContent(
  stone: LivingInfoSoulStone,
  assets: AssetLibrary,
  hooks: { onStatTap?: ((statType: number) => void) | undefined } = {},
): Promise<Container> {
  const generalAtlas = await assets.atlas("General-hd");
  const frameOf = (name: string): Texture => {
    const texture = generalAtlas.textures[name];
    if (!texture) throw new Error(`buildSoulStoneInfoContent: General-hd atlas is missing ${name}`);
    return texture;
  };
  const root = new Container();


  const title = makeTtfLabel(stone.name, SOULSTONE_ROW_SIZE, { outlineAlpha: OUTLINE_FADE_ALPHA });
  root.addChild(title);
  const statsBlock = buildBonusStatsBlock(stone.stats, frameOf, hooks.onStatTap);
  statsBlock.position.set(0, title.height + ITEM_POPUP_TITLE_GAP);
  root.addChild(statsBlock);
  // Vertical-Box cross-axis centering (same convention as the card's rows).
  const statsBounds = statsBlock.getLocalBounds();
  const innerW = Math.max(title.width, statsBounds.width);
  title.x = (innerW - title.width) / 2;
  statsBlock.x = (innerW - statsBounds.width) / 2 - statsBounds.x;
  return root;
}




export function buildAbilityInfoContent(model: AbilityInfoModel): Container {
  // Native false advances down in Cocos Y-up; Pixi's down axis is positive, so the adapter uses
  // true to preserve the same visual order without overlapping mixed-height wrapped labels.
  const root = new Box({ horizontal: false, positiveAlignDirection: true, gap: unscaledIdiomPt(5, DISPLAY_MODE) });


  const nameLabel = makeTtfLabel(model.name, 18, { outline: false });
  root.addBoxChild(nameLabel);
  if (model.commonDescription !== undefined) {
    root.addBoxChild(makeTtfLabel(model.commonDescription, 16, {
      wordWrapWidth: SCREEN_W * 0.7,
      align: "left",
      outline: false,
    }));
  }
  if (model.extraDescription.length > 0) {
    root.addBoxChild(makeTtfLabel(model.extraDescription, 18, {
      wordWrapWidth: 380,
      align: "center",
      outline: false,
    }));
  }
  return root;
}
