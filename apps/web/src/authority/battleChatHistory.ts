interface ChatProjection {
  readonly battle?: { readonly battleId: string } | undefined;
  readonly quests?: { readonly dialogsSeen: readonly string[] } | undefined;
}

/** Battle chat eligibility belongs to the state before battle entry commits its seen bits. */
export class BattleChatHistory {
  private previous: ChatProjection;
  private battleId: string | undefined;
  private seen: Set<string>;

  constructor(projection: ChatProjection) {
    this.previous = projection;
    this.battleId = projection.battle?.battleId;
    this.seen = new Set(projection.quests?.dialogsSeen);
  }

  observe(projection: ChatProjection): void {
    const battleId = projection.battle?.battleId;
    if (battleId !== undefined && battleId !== this.battleId) {
      this.battleId = battleId;
      this.seen = new Set(this.previous.quests?.dialogsSeen);
    }
    // Retain eligibility through terminal adoption and tutorial claims until the next battle.
    this.previous = projection;
  }

  request(name: string, alwaysShow: boolean): boolean {
    if (!alwaysShow && this.seen.has(name)) return false;
    this.seen.add(name);
    return true;
  }
}
