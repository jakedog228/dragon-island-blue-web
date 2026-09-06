import type { GameData } from "@dib/gamedata/browser";
import type { StatName } from "@dib/gamedata";
import type { PlayerMonsterInstance } from "@dib/engine";
import {
  buildPlayerChoices,
  jobXpCostOfNextLevel,
  jobXpForLevel,
  monsterStats,
  soulStoneBonusForStat,
  type MonsterStatChildren,
  type PlayerBuffBonuses,
} from "@dib/engine";
import {
  buildAbilityInfoModel,
  buildPassiveAbilityInfoModel,
  type AbilityInfoContext,
  type AbilityInfoModel,
} from "../battle/abilityInfo.js";
import {
  evolveChainInfoRows,
  soulStoneStatRows,
  type LivingInfoAbility,
  type LivingInfoSnapshot,
} from "../battle/infoDisplays.js";
import {
  localizedRenderableName,
  type LocalizedStrings,
} from "../localization.js";

const STAT_ENUM = [
  [1, "Attack"],
  [2, "Magic"],
  [3, "Speed"],
  [4, "Defense"],
  [5, "Resist"],
] as const satisfies readonly (readonly [1 | 2 | 3 | 4 | 5, StatName])[];

export interface PartyLivingCollection {
  highestRegisteredLevel(shortType: string): number;
}

export interface PartyLivingInfoContext {
  readonly gd: GameData;
  readonly strings: LocalizedStrings;
  readonly collection: PartyLivingCollection;
  readonly member: PlayerMonsterInstance;
  /** The member's permanent hero-skill/Gem buff children, read from the party aggregate that owns
   * them (`WorldTripParty.playerBuffsOf`). Callers must pass them: a card that recomputed stats
   * without this term showed a full bar at a MaxHP no heal or battle agreed with. */
  readonly playerBuffs?: PlayerBuffBonuses;
}

function statChildren(context: PartyLivingInfoContext): MonsterStatChildren {
  const stone = context.member.soulStone;
  return {
    ...(stone === undefined
      ? {}
      : {
          soulStone: {
            level: stone.level,
            enabledStats: context.gd.soulStoneByElement(stone.element).enabledStats,
          },
        }),
    ...(context.playerBuffs === undefined ? {} : { playerBuffs: context.playerBuffs }),
  };
}

/**
 * The concrete-party LivingInfoDisplay model shared by selection-style MonsterManagement
 * callers. Egg feed style 2 receives the real bench Monster objects, not template previews.
 */
export function buildPartyLivingInfoSnapshot(
  context: PartyLivingInfoContext,
): LivingInfoSnapshot {
  const { gd, strings, collection, member } = context;
  const monster = gd.monsterByShortType(member.shortType);
  const stone = member.soulStone;
  // One accumulator for every stat the card shows — the same one the party heals to and the
  // battle projects from (`monsterStats` = Living.valueForCachedStat: child order).
  const effective = monsterStats(monster, member.level, statChildren(context));

  const abilities: LivingInfoAbility[] = buildPlayerChoices(gd, member.shortType).map(
    (choice) => ({
      kind: "usable",
      choice: {
        ...choice,
        displayName: localizedRenderableName(strings, [
          choice.displayName,
          choice.abilityPath.split(".").at(-1)!,
        ]),
      },
    }),
  );
  for (const ref of gd.jobAbilitiesOrEmpty(member.shortType)) {
    if (/^usable\d+$/.test(ref.slot)) continue;
    const typeName = ref.type.split(".").at(-1)!;
    const instanceName = ref.arguments["instanceName"];
    abilities.push({
      kind: "passive",
      ref,
      displayName: localizedRenderableName(strings, [
        typeof instanceName === "string" ? instanceName : typeName,
        typeName,
      ]),
    });
  }

  const penalty = gd.jobXpPenalty(member.shortType);
  return {
    name: localizedRenderableName(strings, [member.shortType]),
    monster,
    level: member.level,
    hp: member.currentHp,
    maxHp: effective["MaxHP"],
    xpThisLevel: member.cumulativeXp - jobXpForLevel(member.level, penalty),
    xpCostOfNextLevel: jobXpCostOfNextLevel(member.level, penalty),
    stats: STAT_ENUM.map(([statType, statName]) => ({
      statType,
      value: effective[statName],
    })).filter(({ value }) => value >= 1),
    abilities,
    soulStones: stone === undefined
      ? []
      : [{
          name: localizedRenderableName(strings, [`${stone.element}SoulStone`]),
          stats: soulStoneStatRows(
            stone.level,
            gd.soulStoneByElement(stone.element).enabledStats,
          ),
        }],
    evolveRows: evolveChainInfoRows(
      gd.evolveChainOf(member.shortType),
      (shortType) => collection.highestRegisteredLevel(shortType) > 0,
      (shortType) => gd.monsterByShortType(shortType),
    ),
  };
}

export function buildPartyAbilityInfoModel(
  context: PartyLivingInfoContext,
  ability: LivingInfoAbility,
): AbilityInfoModel {
  const { gd, strings, member } = context;
  const monster = gd.monsterByShortType(member.shortType);
  const stats = monsterStats(monster, member.level, statChildren(context));
  const abilityContext: AbilityInfoContext = {
    level: member.level,
    stats,
    element: monster.element,
  };
  return ability.kind === "usable"
    ? buildAbilityInfoModel(
        gd,
        strings,
        member.shortType,
        ability.choice,
        abilityContext,
      )
    : buildPassiveAbilityInfoModel(
        gd,
        strings,
        ability.ref,
        ability.displayName,
        abilityContext,
      );
}
