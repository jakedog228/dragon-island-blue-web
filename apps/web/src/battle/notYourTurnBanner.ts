// The "NOT YOUR TURN" banner: `-[BattleNode ccTouchBegan:] @ 0xc4788`.
//
// This is an independent temporary-label mechanism —
// it shares nothing with `sub_652d8`/`sub_64fdc` (damage numbers, Miss, stat mods, `Blocked` — see
// `effect-text.md`) nor with the `notAllowed.m4a` denial-SFX family. The
// whole build/animate/attach sequence is inlined at `0xc48ce`-`0xc49f4`; do not "unify" it with
// `abilityRenderer`'s floater path, which has a different font pair, a rise, a length-derived
// clamped lifetime, and a per-target anchor.
//
// Independently verified (2026-09-06) from the raw armv7 Mach-O rather than HLIL: BN's HLIL for
// `ccTouchBegan:` renders only the `locked` test and two `unimplemented {vcmpe.f32}` lines, hiding
// ~640 bytes of body. A movw/movt + `add rN, pc` PIC scan (this binary materializes `__cfstring`
// addresses that way, NOT via literal pools, so a literal-pool xref under-reports) finds exactly
// one reference to `cfstr_NotYourTurnKey @ 0x25e38c` in the entire binary, at `0xc48b6`. The same
// scan reproduces all four documented `notAllowed.m4a` sites and the single `BlockedKey` site, so
// the method is calibrated.

import { Container, type Ticker, type Text } from "pixi.js";
import { makeTtfLabel } from "@dib/renderer";
import { idiomPairPt, type DisplayMode } from "../displayMode.js";
import { tween } from "../tween.js";

/**
 * Idiom pair from the literal pool at `0xc4a04` (`00 00 f0 41` = 30.0f, iPhone) / `0xc4a08`
 * (`00 00 70 42` = 60.0f, iPad), selected by the standard `[[UIDevice currentDevice]
 * userInterfaceIdiom] == 1` check with a `respondsToSelector:` fallback to 30.0f.
 *
 * NOTE this is a much larger pair than the shared `sub_652d8` helper's 16/24 — "NOT YOUR TURN" is
 * a screen-centred banner, not a floating combat number. Select the pair before the iPad halving,
 * per `idiomPairPt`'s contract.
 */
export function notYourTurnFontSizePt(mode: DisplayMode): number {
  return idiomPairPt(30, 60, mode);
}

/** `CCDelayTime actionWithDuration:1.0f` — fully opaque hold before the fade begins. */
export const NOT_YOUR_TURN_HOLD_MS = 1000;
/** `FadeAndRemoveAction actionWithDuration:1.0f` — fades AND detaches in one action. */
export const NOT_YOUR_TURN_FADE_MS = 1000;
/** Fixed 2.0s total. The `0.3s`-per-character combat-number formula does NOT apply here:
 *  this label is never handed to `sub_64fdc`, so its lifetime is length- and locale-independent. */
export const NOT_YOUR_TURN_LIFETIME_MS = NOT_YOUR_TURN_HOLD_MS + NOT_YOUR_TURN_FADE_MS;

/**
 * `[label outlineBackgroundNodeWithColor:0xff000000 borderWidth:1.0f matchOpacity:YES]` @ `0xc496c`
 * (raw: `r2 = 0xff000000`, `r3 = 0x3f800000`, `sp[0] = 1`; the args are in core registers because
 * this ABI passes floats in the integer/stack slots — `vstr s0,[sp]` at `0xc493c` proves it for
 * the sibling `fontSize:` argument).
 *
 * `0xff000000` is BLACK under the same convention `-[CCNode outlineFadeBackgroundNode] @ 0x52f60`
 * uses. The width is the source's
 * outward RADIUS; `makeTtfLabel` doubles it into a centred canvas stroke, so pass 1 and let the
 * shared primitive own the conversion (see its `outlineWidthPt * 2` comment).
 *
 * `matchOpacity:YES` is what makes the outline fade WITH the glyphs — a Pixi `Text` stroke shares
 * the node alpha, so the fade below reproduces it for free. Do not fade the fill separately.
 */
export const NOT_YOUR_TURN_OUTLINE_RADIUS_PT = 1;

/**
 * WHITE by inheritance, not by assignment. Nothing on this path (`ccTouchBegan:`, `sub_65674`,
 * `sub_656a0`) ever sends `setColor:`/`setOpacity:`, so the label keeps what `-[CCSprite init]
 * @ 0x2a334` stamps into every fresh sprite (`memcpy` from `0x1f5780` = `ff ff ff`, `opacity_ =
 * 0xff`) — cocos2d-iphone's `ccWHITE`. Same reasoning as `Blocked`'s `LABEL_BIRTH_COLOR`; kept as
 * its own constant so editing one can never silently repaint the other.
 */
export const NOT_YOUR_TURN_COLOR = 0xffffff;

/** `NotYourTurn1`..`NotYourTurn6` — the `r5 > 6` loop bound at `0xc481a`/`0xc481c`. */
export const NOT_YOUR_TURN_FLAG_LIMIT = 6;

/**
 * The persistent lifetime budget, `0xc4818`-`0xc4870`:
 *
 * ```
 * d = 1
 * loop: if (d > 6) return                                  ; budget exhausted, never shows again
 *       flag = [NSString stringWithFormat:@"NotYourTurn%d", d]
 *       if ([[UserSavedData sharedInstance] hasTutorialFlag:flag]) { d += 1; goto loop }
 *       [[UserSavedData sharedInstance] setTutorialFlag:flag]      ; claim it, then show
 * ```
 *
 * Each battle can claim at most one slot (the per-battle latch below), so this caps the banner at
 * **six appearances across the whole save's life**. Modelled as flags rather than a counter
 * because that is what the source persists — the loop tolerates gaps, even though this code path
 * is the only reader or writer of these keys.
 */
export function nextNotYourTurnFlag(hasFlag: (key: string) => boolean): string | null {
  for (let index = 1; index <= NOT_YOUR_TURN_FLAG_LIMIT; index += 1) {
    const key = `NotYourTurn${index}`;
    if (!hasFlag(key)) return key;
  }
  return null;
}

/** Opaque through the 1.0s `CCDelayTime`, then linear to 0 across the 1.0s `FadeAndRemoveAction`. */
export function notYourTurnAlphaAt(elapsedMs: number): number {
  if (elapsedMs <= NOT_YOUR_TURN_HOLD_MS) return 1;
  const faded = (elapsedMs - NOT_YOUR_TURN_HOLD_MS) / NOT_YOUR_TURN_FADE_MS;
  return faded >= 1 ? 0 : 1 - faded;
}

export interface NotYourTurnBannerOpts {
  /** The `sub_6522c` target: the running scene, i.e. this port's battle scene container. */
  parent: Container;
  ticker: Ticker;
  /** Localized `NotYourTurnKey` — `[[NSBundle mainBundle] localizedStringForKey:@"NotYourTurnKey"
   *  value:@"" table:nil]` @ `0xc48c2`. */
  text: string;
  /** Current stage size; `sub_656a0` centres against `[[CCDirector sharedDirector] winSize]`. */
  screenW: number;
  screenH: number;
  mode: DisplayMode;
  /** Above every scene child in `sceneManifest()`, below `POPUP_HOST_Z_INDEX`. */
  zIndex: number;
  signal?: AbortSignal;
}

/**
 * Builds, mounts and runs the banner, resolving when it has removed itself.
 *
 * Placement is `sub_65674(label, 1)` -> `sub_656a0(label, 1, 0.5f, 0.5f, CGPointZero)`:
 * `round(winSize * (0.5, 0.5) + (0,0) + contentSize * (0.5 - anchorPoint))`. `CCLabelTTF`'s
 * default `anchorPoint` is `(0.5, 0.5)` and this path never calls `setAnchorPoint:`, so the
 * anchor term is exactly zero and the label lands at the plain screen centre — NOT anchored to a
 * `LivingDisplay`, not offset from any monster, and not row-stacked like a parameter floater.
 *
 * There is deliberately NO `CCMoveBy`: unlike every `sub_652d8` label, this one does not rise.
 */
export async function showNotYourTurnBanner(opts: NotYourTurnBannerOpts): Promise<void> {
  const label: Text = makeTtfLabel(opts.text, notYourTurnFontSizePt(opts.mode), {
    fill: NOT_YOUR_TURN_COLOR,
    outlineWidthPt: NOT_YOUR_TURN_OUTLINE_RADIUS_PT,
  });
  label.label = "notYourTurnBanner";
  label.anchor.set(0.5, 0.5);
  label.position.set(Math.round(opts.screenW * 0.5), Math.round(opts.screenH * 0.5));
  label.zIndex = opts.zIndex;
  // `sub_6522c` adds to the running scene LAST, so the banner paints over the whole BattleNode
  // subtree by ordinary equal-z insertion order. The port's scene sorts by zIndex instead, hence
  // the explicit value above.
  opts.parent.addChild(label);
  try {
    await tween(
      opts.ticker,
      NOT_YOUR_TURN_LIFETIME_MS,
      (t) => {
        label.alpha = notYourTurnAlphaAt(NOT_YOUR_TURN_LIFETIME_MS * t);
      },
      (t) => t,
      opts.signal,
    );
  } finally {
    // `FadeAndRemoveAction` detaches at the fade boundary; an aborted battle teardown destroys the
    // scene (and this child) anyway, so guard against a double destroy rather than leaking.
    if (!label.destroyed) label.destroy();
  }
}
