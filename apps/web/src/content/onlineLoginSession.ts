export interface ClosableOnlineAuthority {
  close(): Promise<void>;
}

export type OnlineLoginSnapshot<TAuthority extends ClosableOnlineAuthority> =
  | { readonly phase: "idle" }
  | { readonly phase: "authenticating"; readonly key: string }
  | { readonly phase: "authenticated"; readonly key: string; readonly authority: TAuthority }
  | { readonly phase: "error"; readonly key: string; readonly error: unknown };

/**
 * Owns the short-lived authority created at the content gate. A generation counter prevents an
 * earlier network response from replacing a newer login, while `claim` transfers the live
 * authority into game startup without closing or authenticating it a second time.
 */
export class OnlineLoginSession<TAuthority extends ClosableOnlineAuthority> {
  private generation = 0;
  private state: OnlineLoginSnapshot<TAuthority> = { phase: "idle" };

  constructor(
    private readonly authenticator: (key: string) => Promise<TAuthority>,
  ) {}

  snapshot(): OnlineLoginSnapshot<TAuthority> {
    return this.state;
  }

  async authenticate(key: string): Promise<OnlineLoginSnapshot<TAuthority>> {
    const generation = ++this.generation;
    const previous = this.state.phase === "authenticated" ? this.state.authority : undefined;
    this.state = { phase: "authenticating", key };
    await previous?.close();

    try {
      const authority = await this.authenticator(key);
      if (generation !== this.generation) {
        await authority.close();
        return this.state;
      }
      this.state = { phase: "authenticated", key, authority };
    } catch (error) {
      if (generation === this.generation) {
        this.state = { phase: "error", key, error };
      }
    }
    return this.state;
  }

  async invalidate(): Promise<void> {
    this.generation++;
    const previous = this.state.phase === "authenticated" ? this.state.authority : undefined;
    this.state = { phase: "idle" };
    await previous?.close();
  }

  claim(key: string): TAuthority | undefined {
    if (this.state.phase !== "authenticated" || this.state.key !== key) return undefined;
    const authority = this.state.authority;
    this.generation++;
    this.state = { phase: "idle" };
    return authority;
  }
}
