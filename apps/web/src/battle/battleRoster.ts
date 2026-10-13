import { battleLivingId } from "@dib/engine";
import type { BattleTeamMemberSetup, EncounterConfig } from "./encounter.js";

export interface BattleRosterEntry {
  readonly id: string;
  readonly team: 0 | 1;
  readonly constructionIndex: number;
  readonly setup: Readonly<BattleTeamMemberSetup>;
  /** Presentation/ownership provenance only: true when this identity was constructed after the
   * battle began (`monsterAdded` or `summonChanged`). This is deliberately NOT native
   * `Monster.summoned`; XP reads that source flag from BattleSession.xpStateOf. */
  readonly createdMidBattle: boolean;
}

/** Construction-time roster shared by engine/view adaptation, plus mid-battle summons.
 *
 * Live team membership remains authoritative in BattleSession. This registry only owns facts that
 * never change once a living exists: stable id, source setup, team, and construction index.
 * Mid-battle constructions (`monsterAdded` and `summonChanged`) are appended via
 * `registerMidBattle` before yielding to their impact delay, so live queue callbacks / ability-info /
 * view-party lookups work for them exactly like initial-roster members. */
export class BattleRoster {
  private readonly rosterEntries: BattleRosterEntry[];
  private readonly byId: Map<string, BattleRosterEntry>;

  constructor(encounter: EncounterConfig, playerTeam: 0 | 1 = 0, constructedLevel?: (id: string) => number) {
    const entries: BattleRosterEntry[] = [];
    const teams: ReadonlyArray<readonly [0 | 1, readonly BattleTeamMemberSetup[]]> = [
      [0, encounter.playerTeam],
      [1, encounter.enemyTeam],
    ];
    for (const [team, members] of teams) {
      members.forEach((setup, constructionIndex) => {
        const id = battleLivingId(team === 0 ? playerTeam : playerTeam === 0 ? 1 : 0, constructionIndex, setup.shortType);
        entries.push({
          id,
          team,
          constructionIndex,
          // Read the constructed living: capture settlement, info and spirit charging must
          // share its Job level. Historical Official replays may retain the old raw level.
          setup: { ...setup, level: constructedLevel?.(id) ?? setup.level },
          createdMidBattle: false,
        });
      });
    }
    this.rosterEntries = entries;
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));
  }

  entries(): readonly BattleRosterEntry[] {
    return this.rosterEntries;
  }

  entryOf(id: string): BattleRosterEntry {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`BattleRoster: unknown living id "${id}"`);
    return entry;
  }


  registerMidBattle(id: string, team: 0 | 1, setup: BattleTeamMemberSetup): void {
    if (this.byId.has(id)) return;
    const m = /^t[01]m(\d+):/.exec(id);
    if (!m) throw new Error(`BattleRoster.registerMidBattle: unexpected living id shape "${id}"`);
    const entry: BattleRosterEntry = {
      id,
      team,
      constructionIndex: Number(m[1]),
      setup: { ...setup },
      createdMidBattle: true,
    };
    this.rosterEntries.push(entry);
    this.byId.set(id, entry);
  }
}
