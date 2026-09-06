import type { GameData, LicenseDef } from "@dib/gamedata/browser";
import type {
  LicenseQualification,
  PlayerProfile,
  PlayerStatName,
} from "@dib/player-domain";

export const CHARACTER_STAT_ORDER: readonly PlayerStatName[] = Object.freeze([
  "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
]);

export interface CharacterStatRow {
  readonly stat: PlayerStatName;
  readonly skillValue: number;
  readonly bonus: number;
  readonly canIncrement: boolean;
  readonly canDecrement: boolean;
}


export function characterSkillBonus(profile: PlayerProfile, stat: PlayerStatName): number {
  return profile.skillValue(stat) * (stat === "Defense" || stat === "Resist" ? 1.5 : 1);
}

export function characterStatRows(profile: PlayerProfile): readonly CharacterStatRow[] {
  return CHARACTER_STAT_ORDER.map((stat) => Object.freeze({
    stat,
    skillValue: profile.skillValue(stat),
    bonus: characterSkillBonus(profile, stat),
    canIncrement: profile.skillPointsAvailable > 0,
    canDecrement: profile.skillValue(stat) > 0,
  }));
}

export function nextLicense(
  data: GameData,
  profile: PlayerProfile,
): LicenseDef | undefined {
  return data.allLicenses()[profile.licenseOrdinal + 1];
}

export function characterLicenseQualification(
  data: GameData,
  profile: PlayerProfile,
  completedQuestCount: number,
): LicenseQualification {
  return profile.licenseQualification(
    nextLicense(data, profile),
    completedQuestCount,
  );
}
