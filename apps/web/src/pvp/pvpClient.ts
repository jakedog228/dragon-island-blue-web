import {
  PvpCurrentMatchV1Schema, PvpErrorV1Schema, PvpMatchViewV1Schema, PvpSessionV1Schema,
  type PvpCommandV1, type PvpInviteRequestV1, type PvpJoinRequestV1, type PvpMatchViewV1, type PvpErrorV1, type PvpClientSetupV1,
} from "@dib/game-protocol";

export type PvpTransport = (path: string, init: RequestInit) => Promise<Response>;
export class PvpClientError extends Error {
  constructor(readonly details: PvpErrorV1) { super(details.message); this.name = "PvpClientError"; }
}
export interface PvpSessionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const volatileSessions = new Map<string, ReturnType<typeof PvpSessionV1Schema.parse>>();
export function pvpBrowserStorage(): PvpSessionStorage | undefined {
  try { return localStorage; } catch { return undefined; }
}
function parseResponse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new PvpClientError({ code: "UNAVAILABLE", message: "The PvP server returned an incompatible response. Update the client and server together, then reconnect. If a move was pending, retry it after reconnecting.", issues: [] });
}
export class PvpClient {
  constructor(private readonly transport: PvpTransport) {}
  private async request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.transport(path, { method: body === undefined ? "GET" : "POST",
        signal: AbortSignal.timeout(20_000),
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    } catch {
      throw new PvpClientError({ code: "UNAVAILABLE", message: "Connection interrupted. Reconnect to see whether your action was received, or retry the same action.", issues: [] });
    }
    let value: unknown;
    try { value = await response.json(); }
    catch { throw new PvpClientError({ code: "UNAVAILABLE", message: "The PvP server did not return a valid response. Check your connection and try again.", issues: [] }); }
    if (!response.ok) {
      const parsed = PvpErrorV1Schema.safeParse((value as { error?: unknown } | null)?.error);
      throw new PvpClientError(parsed.success ? parsed.data : { code: "UNAVAILABLE", message: "PvP is unavailable on this server. Please try again later.", issues: [] });
    }
    return value;
  }
  async invite(input: PvpInviteRequestV1): Promise<PvpMatchViewV1> { return parseResponse(PvpMatchViewV1Schema, await this.request("/api/pvp/invites", input)); }
  async join(input: PvpJoinRequestV1): Promise<PvpMatchViewV1> { return parseResponse(PvpMatchViewV1Schema, await this.request("/api/pvp/join", input)); }
  async current(setup?: PvpClientSetupV1): Promise<PvpMatchViewV1 | null> { return parseResponse(PvpCurrentMatchV1Schema, await this.request("/api/pvp/matches/current", setup)).match; }
  async read(id: string): Promise<PvpMatchViewV1> { return parseResponse(PvpMatchViewV1Schema, await this.request(`/api/pvp/matches/${encodeURIComponent(id)}`)); }
  async command(id: string, input: PvpCommandV1): Promise<PvpMatchViewV1> { return parseResponse(PvpMatchViewV1Schema, await this.request(`/api/pvp/matches/${encodeURIComponent(id)}/commands`, input)); }
  async cancel(id: string, requestId: string): Promise<PvpMatchViewV1> { return parseResponse(PvpMatchViewV1Schema, await this.request(`/api/pvp/matches/${encodeURIComponent(id)}/cancel`, { requestId })); }

  static async offline(options: { name?: string; endpoint?: string; storage?: PvpSessionStorage; fetch?: typeof fetch } = {}): Promise<PvpClient> {
    const endpoint = options.endpoint?.replace(/\/+$/, "") ?? "";
    const fetcher = options.fetch ?? fetch;
    const storage = options.storage ?? pvpBrowserStorage();
    const key = `dib.pvp.session.v1:${endpoint || "same-origin"}`;
    let session: ReturnType<typeof PvpSessionV1Schema.parse> | undefined;
    try {
      const cached = PvpSessionV1Schema.safeParse(JSON.parse(storage?.getItem(key) ?? "null"));
      if (cached.success && cached.data.expiresAt > Date.now()) session = cached.data;
    } catch { /* missing/blocked storage */ }
    if (!session) {
      const cached = volatileSessions.get(key);
      if (cached && cached.expiresAt > Date.now()) session = cached;
    }
    if (!session) {
      const unsigned = new PvpClient((path, init) => fetcher(`${endpoint}${path}`, init));
      session = parseResponse(PvpSessionV1Schema, await unsigned.request("/api/pvp/session", { name: options.name ?? "Offline player" }));
      try { storage?.setItem(key, JSON.stringify(session)); } catch { /* current client still owns the session */ }
    }
    volatileSessions.set(key, session);
    const token = session.token;
    return new PvpClient((path, init) => {
      const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${token}`);
      return fetcher(`${endpoint}${path}`, { ...init, headers });
    });
  }
}
