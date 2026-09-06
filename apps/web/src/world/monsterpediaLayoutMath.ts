












import {
  idiomPairPt,
  screenPointsForMode,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
  type DisplayMode,
  type SizePt,
} from "../displayMode.js";

export const MONSTERPEDIA_BOOK_TEXTURE_RECT_PX = { x: 0, y: 0, w: 1024, h: 768 } as const;
export const MONSTERPEDIA_BOOK_SIZE_PT = { w: 512, h: 384 } as const;
export const MONSTERPEDIA_CARD_SIZE_PT = { w: 120, h: 150 } as const;
export const MONSTERPEDIA_PAGE_TURN_LOCK_MS = 200;
export const MONSTERPEDIA_EXPANSION_MS = 500;
export const MONSTERPEDIA_HELP_DELAY_MS = 500;
export const MONSTERPEDIA_HELP_FADE_MS = 500;
export const MONSTERPEDIA_EXPANSION_GREY_ALPHA = 200 / 255;

export interface MonsterpediaCardLayout {
  readonly size: SizePt;
  readonly portrait: {
    readonly ordinaryMax: SizePt;
    readonly ordinaryCenter: { readonly x: number; readonly yFromFrameBottom: number };
  };
  readonly name: { readonly x: number; readonly yFromFrameBottom: number; readonly fontPt: number };
  readonly rarityYFromFrameBottom: number;
  readonly highestBadge: { readonly x: number; readonly yFromFrameBottom: number };
  readonly highestLevel: { readonly x: number; readonly yFromFrameBottom: number; readonly fontPt: number };
  readonly element: { readonly x: number; readonly yFromFrameBottom: number };
  readonly evolveChain: { readonly x: number; readonly yFromFrameBottom: number };
  readonly index: { readonly x: number; readonly yFromFrameBottom: number; readonly fontPt: number };
  readonly unknownCenter: { readonly x: number; readonly y: number };
  readonly unknownMaxHeight: number;
  readonly ingredientCenters: readonly [
    {
      readonly x: number;
      readonly y: number;
      readonly anchorX: number;
      readonly anchorY: number;
    },
    {
      readonly x: number;
      readonly y: number;
      readonly anchorX: number;
      readonly anchorY: number;
    },
  ];
  readonly ingredientMax: SizePt;
  readonly combine: { readonly x: number; readonly y: number };
}


export function monsterpediaCardLayout(mode: DisplayMode): MonsterpediaCardLayout {
  const paired = (phone: number, ipadNative = phone * 2) => idiomPairPt(phone, ipadNative, mode);
  return {
    size: { w: paired(120), h: paired(150) },
    portrait: {
      ordinaryMax: { w: paired(103), h: paired(73) },
      ordinaryCenter: { x: paired(60.5), yFromFrameBottom: paired(93.5) },
    },
    name: { x: paired(60), yFromFrameBottom: paired(128), fontPt: paired(12) },
    rarityYFromFrameBottom: paired(42),
    highestBadge: { x: paired(26), yFromFrameBottom: paired(16) },
    highestLevel: { x: paired(26), yFromFrameBottom: paired(19), fontPt: paired(16) },
    element: { x: paired(59), yFromFrameBottom: paired(20) },
    evolveChain: { x: paired(83), yFromFrameBottom: paired(25) },
    index: { x: paired(101), yFromFrameBottom: paired(16), fontPt: paired(16) },
    unknownCenter: {
      x: paired(60.5),
      y: paired(150) - paired(93.5),
    },
    unknownMaxHeight: paired(73),
    ingredientCenters: [
      {
        x: paired(-34),
        y: paired(150) - paired(85),
        anchorX: 0.5,
        anchorY: 1,
      },
      {
        x: paired(-34),
        y: paired(150) - paired(65),
        anchorX: 0.5,
        anchorY: 0,
      },
    ],
    ingredientMax: { w: paired(40), h: paired(50) },
    combine: { x: paired(-26), y: paired(150) - paired(75) },
  };
}

export interface MonsterpediaBookLayout {
  readonly screen: SizePt;
  readonly bookTopLeft: { readonly x: number; readonly y: number };
  readonly tab: {
    readonly categoryTop: (category: number) => number;
    readonly closeTop: number;
    readonly left: (tabWidth: number) => number;
  };
  readonly ordinaryCardTopLeft: readonly { readonly x: number; readonly y: number }[];
  readonly recipeCardTopLeft: readonly { readonly x: number; readonly y: number }[];
  readonly footer: {
    readonly fontPt: number;
    readonly rightInset: number;
    readonly cocosBottom: number;
    readonly gap: number;
  };
}

export function monsterpediaBookLayout(mode: DisplayMode): MonsterpediaBookLayout {
  const screen = screenPointsForMode(mode);
  const ordinaryX = [
    idiomPairPt(20, 50, mode),
    idiomPairPt(150, 310, mode),
    idiomPairPt(280, 570, mode),
  ] as const;
  const ordinaryY = [
    idiomPairPt(10, 30, mode),
    idiomPairPt(165, 370, mode),
  ] as const;
  const recipeX = [
    idiomPairPt(80, 160, mode),
    idiomPairPt(280, 560, mode),
  ] as const;
  const recipeY = ordinaryY;
  const firstCategoryTop = idiomPairPt(196, 428, mode);
  const tabStep = idiomPairPt(40, 80, mode);
  return {
    screen,









    bookTopLeft: {
      x: 0,
      y: screen.h - MONSTERPEDIA_BOOK_SIZE_PT.h,
    },
    tab: {
      categoryTop: (category) => firstCategoryTop - category * tabStep,
      closeTop: idiomPairPt(270, 668, mode),









      left: (tabWidth) => screen.w - tabWidth,
    },
    ordinaryCardTopLeft: ordinaryY.flatMap((y) => ordinaryX.map((x) => ({ x, y }))),
    recipeCardTopLeft: recipeY.flatMap((y) => recipeX.map((x) => ({ x, y }))),
    footer: {
      fontPt: idiomPairPt(13, 26, mode),
      rightInset: idiomPairPt(2, 10, mode),
      cocosBottom: idiomPairPt(48, 140, mode),
      gap: unscaledIdiomPt(5, mode),
    },
  };
}

export interface MonsterpediaCompleteListLayout {
  readonly labelsOrigin: { readonly x: number; readonly y: number };
  readonly cell: SizePt;
  readonly rows: number;
  readonly columns: number;
  readonly visibleLabels: number;
  readonly labelFontPt: number;
  readonly cardTopLeft: { readonly x: number; readonly y: number };
  readonly controlGap: number;
  readonly roundingScale: number;
  readonly controlsLeft: (controlsWidth: number) => number;
  /** Bottom-edge placement for a controls Box after its measured height is known. */
  readonly controlsTop: (controlsHeight: number) => number;
  readonly summary: {
    readonly fontPt: number;
    readonly gapPt: number;
    readonly positionForSize: (size: SizePt) => { readonly x: number; readonly y: number };
  };
}

export function monsterpediaCompleteListLayout(mode: DisplayMode): MonsterpediaCompleteListLayout {
  const screen = screenPointsForMode(mode);
  const edge = idiomPairPt(30, 40, mode);
  const cell = {
    w: idiomPairPt(165, 200, mode),
    h: idiomPairPt(20, 40, mode),
  };
  const rows = Math.trunc(
    (
      screen.h -
      idiomPairPt(30, 60, mode) -
      2 * edge
    ) / cell.h,
  );
  const columns = mode === "ipad" ? 3 : 2;
  const cardRightInset = idiomPairPt(10, 40, mode);
  const controlsBottomInset = idiomPairPt(5, 20, mode);
  const summaryInset = idiomPairPt(10, 40, mode);
  return {
    labelsOrigin: { x: edge, y: edge },
    cell,
    rows,
    columns,
    visibleLabels: rows * columns,
    labelFontPt: idiomPairPt(14, 20, mode),
    cardTopLeft: {
      x: screen.w - cardRightInset - MONSTERPEDIA_CARD_SIZE_PT.w,
      y: screen.h / 2 - MONSTERPEDIA_CARD_SIZE_PT.h / 2,
    },
    controlGap: idiomPairPt(40, 80, mode),
    roundingScale: sourcePointsPerPortPoint(mode),
    controlsLeft: (controlsWidth) => (screen.w - controlsWidth) / 2,
    controlsTop: (controlsHeight) => screen.h - controlsBottomInset - controlsHeight,
    summary: {
      fontPt: idiomPairPt(14, 28, mode),
      gapPt: unscaledIdiomPt(5, mode),
      positionForSize: ({ w, h }) => ({
        x: screen.w - summaryInset - w,
        y: screen.h - summaryInset - h,
      }),
    },
  };
}

export interface MonsterpediaExpansionLayout {
  readonly closeTopLeft: { readonly x: number; readonly y: number };
  readonly helpFontPt: number;
  readonly helpLabelInset: number;
  readonly selectedTopLeft: { readonly x: number; readonly y: number };
  readonly bottomTop: number;
  readonly bottomColumnX: readonly [number, number, number];
  readonly helpLines: readonly {
    readonly name: "YourHighest" | "MonsterElement" | "MonsterRating" | "MonsterIndex" | "MonsterChain";
    readonly x: number;
    readonly y: number;
    readonly flipX: boolean;
    readonly flipY: boolean;
  }[];
}



export function monsterpediaHelpLabelOffset(
  lineSize: SizePt,
  inset: number,
  flipX: boolean,
  flipY: boolean,
): { readonly x: number; readonly y: number } {
  return {
    x: flipX ? lineSize.w : -lineSize.w,
    y: flipY ? lineSize.h - inset : -lineSize.h,
  };
}

/** World-space extent relative to an expanded help line's authored root after the Pixi
 * negative-scale texture flip is paired with the fixed far-edge anchor. */
export function monsterpediaHelpLineExtent(
  lineSize: SizePt,
  flipX: boolean,
  flipY: boolean,
): { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } {
  return {
    left: flipX ? 0 : -lineSize.w,
    right: flipX ? lineSize.w : 0,
    top: flipY ? 0 : -lineSize.h,
    bottom: flipY ? lineSize.h : 0,
  };
}

/** `setTextureRect:` half-star crop retains the source's full 19px height and left half width. */
export function monsterpediaHalfStarFrame(
  frame: Readonly<{ x: number; y: number; width: number; height: number }>,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  return {
    x: frame.x,
    y: frame.y,
    width: frame.width / 2,
    height: frame.height,
  };
}

export function monsterpediaExpansionLayout(mode: DisplayMode): MonsterpediaExpansionLayout {
  const paired = (phone: number, ipadNative: number) => idiomPairPt(phone, ipadNative, mode);
  return {
    closeTopLeft: { x: paired(20, 40), y: paired(20, 40) },
    helpFontPt: paired(16, 32),
    helpLabelInset: paired(4, 8),
    selectedTopLeft: { x: paired(180, 392), y: paired(5, 20) },
    bottomTop: paired(165, 448),
    bottomColumnX: [
      mode === "ipad" ? 32 : 70 / 3,
      paired(180, 392),
      mode === "ipad" ? 360 : 1010 / 3,
    ],
    helpLines: [
      { name: "YourHighest", x: paired(195, 420), y: paired(135, 268), flipX: false, flipY: false },
      { name: "MonsterElement", x: paired(227, 500), y: paired(140, 298), flipX: false, flipY: true },
      { name: "MonsterRating", x: paired(270, 560), y: paired(110, 218), flipX: true, flipY: false },
      { name: "MonsterIndex", x: paired(292, 616), y: paired(138, 308), flipX: true, flipY: true },
      { name: "MonsterChain", x: paired(274, 576), y: paired(129, 252), flipX: true, flipY: false },
    ],
  };
}
