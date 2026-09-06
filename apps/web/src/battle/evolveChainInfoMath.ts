


import type { MonsterDef } from "@dib/gamedata";
import { idiomPairPt, type DisplayMode } from "../displayMode.js";

/** One evolve-chain row the card renders: stage `shortType`'s book-template renderable beside a
 *  single `"Evolves At: <evolveLevel>"` label (EvolvesAtFormatKey; NO monster-name text — the
 *  icon alone conveys identity). `rendererScale` = the stage monster's `rendererData.scale`
 *  (`RendererFactory nodeForRenderable:context:` applies it with NO fit/cap — §3 "no scale/fit
 *  call anywhere in this path"); battleNode fills it like every other renderable snapshot. */
export interface LivingInfoEvolveRow {
  shortType: string;


  evolveLevel: number;
  rendererScale?: number;
}

/** Evolve-chain row label: `data_b5bec` = 16.0 phone / `data_b5bf0` = 32.0 iPad — a doubled
 *  idiom pair (raw f32 decode, evolve-chain-rows.md §7), so 16pt in BOTH of this port's
 *  normalized modes. Distinct from the adjacent soul-stone 18/36 pair. */
export function evolveRowFontPt(mode: DisplayMode): number {
  return idiomPairPt(16, 32, mode);
}

/**
 * The per-row loop of the evolve-chain block (evolve-chain-rows.md §3): for stage `i` of the
 * chain (root→leaf short names, `GameData.evolveChainOf`), a row renders iff the player has
 * already discovered the NEXT stage — `[[UserSavedData sharedInstance]
 * highestLevelMonsterOfSimpleType: chain[i+1]] > 0`, the same query `PlayerCollection
 * .hasCapturedSimpleType` models for the capture-card NEW! overlay. The chain's LAST stage
 * structurally never rows (the native gate arg is nil there → `[nil intValue]` = 0), and a
 * failed gate skips the row entirely (no placeholder). A length-1 chain therefore always
 * yields ZERO rows; the builder must then skip the whole section (the original appends an
 * empty Box — §3's "empty-chain gotcha" — which this port deliberately omits instead of
 * reproducing a zero-size stray node).
 */
export function evolveChainInfoRows(
  chain: readonly string[],
  hasCapturedSimpleType: (shortType: string) => boolean,
  monsterByShortType: (shortType: string) => MonsterDef,
): LivingInfoEvolveRow[] {
  const rows: LivingInfoEvolveRow[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    if (!hasCapturedSimpleType(chain[i + 1]!)) continue;
    const stage = monsterByShortType(chain[i]!);
    if (stage.evolveData === undefined) {
      // Chains are BUILT from evolveData links, so a next-having stage without evolveData is
      // data/argument corruption, not a renderable state.
      throw new Error(`evolveChainInfoRows: ${stage.shortType} has a next stage but no evolveData`);
    }
    rows.push({ shortType: stage.shortType, evolveLevel: stage.evolveData.levelReq });
  }
  return rows;
}
