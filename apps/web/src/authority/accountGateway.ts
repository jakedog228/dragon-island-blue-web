import type { AccountSummaryV1 } from "@dib/game-protocol";

/** The two authenticated account calls, isolated so the gateway is testable without a server. */
export interface AccountSettingsClient {
  fetchAccount(): Promise<AccountSummaryV1>;
  updateAccountSettings(patch: { readonly publicScoreboard: boolean }): Promise<AccountSummaryV1>;
}

export interface AccountGatewayOptions {
  readonly client: AccountSettingsClient;
  /** Account carried by the session response, so the first render needs no round trip. */
  readonly initial?: AccountSummaryV1;
  /** Surfaced when a write fails and the displayed value is rolled back. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Owns the account settings the in-game Options popup edits.
 *
 * The options rows call a synchronous `select()`, but the setting lives on the server, so writes
 * are applied optimistically and rolled back to the last server-confirmed value if the request
 * fails. A failed write is never swallowed: the row reverts *and* `onError` fires.
 */
export class AccountGateway {
  private account: AccountSummaryV1 | undefined;
  private confirmed: AccountSummaryV1 | undefined;
  private pending: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: AccountGatewayOptions) {
    this.account = options.initial;
    this.confirmed = options.initial;
  }

  /** Undefined for operator-issued tokens that authorize play but own no account record. */
  current(): AccountSummaryV1 | undefined {
    return this.account;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh(): Promise<AccountSummaryV1> {
    const account = await this.options.client.fetchAccount();
    this.confirmed = account;
    this.account = account;
    this.emit();
    return account;
  }

  /**
   * Optimistic write. Concurrent toggles are serialized so the registry sees them in the order the
   * player clicked, and a rejection restores the value the server last confirmed.
   */
  setPublicScoreboard(next: boolean): Promise<void> {
    const current = this.account;
    if (current === undefined) {
      throw new Error("no account is loaded; cannot change scoreboard visibility");
    }
    if (current.publicScoreboard === next) return this.pending;
    this.account = { ...current, publicScoreboard: next };
    this.emit();
    this.pending = this.pending.then(async () => {
      try {
        const account = await this.options.client.updateAccountSettings({ publicScoreboard: next });
        this.confirmed = account;
        this.account = account;
      } catch (error) {
        this.account = this.confirmed;
        this.options.onError?.(error);
      }
      this.emit();
    });
    return this.pending;
  }

  /** Resolves once every queued write has settled; used by tests and by close-time flushes. */
  async settled(): Promise<void> {
    await this.pending;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
