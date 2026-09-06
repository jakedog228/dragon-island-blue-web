// Narrow battle-facing port shared by browser-local and server-authoritative controllers.
import type { CaptureCardLevel, TeamMemberSetup } from "@dib/engine";
import type {
  CaptureInventorySnapshot,
  CaptureCardSpendResult,
  SpiritProfileSnapshot,
} from "./playerProfile.js";
import type { PlayerStatName } from "./inventory.js";
import type { PlayerCollection } from "./playerCollection.js";

export interface BattlePlayerProfile {
  hasTutorialFlag(flag: string): boolean;
  claimTutorialFlag(flag: string): boolean;
  capturePartyLevel(): number;
  highestRegisteredLevel(shortType: string): number;
  snapshot(): CaptureInventorySnapshot;
  spendSilver(amount: number): boolean;
  spendCaptureCard(level: CaptureCardLevel): CaptureCardSpendResult;
  spiritSnapshot(): SpiritProfileSnapshot;
  spiritSavedXp(shortType: string): number;
  chargeSpiritForDealtDamage(sourceLevel: number, targetLevel: number): number;
  chargeSpiritForTakenDamage(targetLevel: number, sourceLevel: number): number;
  useSpirit(shortType: string): { savedXpBefore: number; savedXpAfter: number };
  battleStatBonuses(): Readonly<Partial<Record<PlayerStatName, number>>>;
}

/** The player-owned state a battle is allowed to read or mutate.
 *
 * This composition boundary deliberately keeps persistence out of BattleNode. The current demo
 * uses an in-memory PlayerProfile and fixed PlayerCollection; a future save-backed implementation
 * can provide the same surface without changing battle presentation code. */
export interface BattlePlayerState {
  readonly collection: PlayerCollection;
  readonly profile: BattlePlayerProfile;
}


export function applyPlayerBattleBonuses(
  members: readonly TeamMemberSetup[],
  profile: Pick<BattlePlayerProfile, "battleStatBonuses">,
): TeamMemberSetup[] {
  const heroBonuses = profile.battleStatBonuses();
  return members.map((member) => {
    if (member.playerBuffs !== undefined) {
      throw new Error(
        `applyPlayerBattleBonuses: ${member.shortType} already carries player buffs — a party` +
          " projection owns them and must not be re-bonused",
      );
    }
    const playerBuffs: NonNullable<TeamMemberSetup["playerBuffs"]> = {};
    for (const [stat, bonus] of Object.entries(heroBonuses)) {
      if (bonus === undefined) continue;
      const name = stat as keyof typeof playerBuffs;
      playerBuffs[name] = Math.fround((playerBuffs[name] ?? 0) + bonus);
    }
    return {
      ...member,
      ...(Object.keys(playerBuffs).length === 0 ? {} : { playerBuffs }),
    };
  });
}
