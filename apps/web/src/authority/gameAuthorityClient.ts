import {
  AccountResponseV1Schema,
  CreateAccountResponseV1Schema,
  CreateGameSessionResponseV1Schema,
  GAME_PROTOCOL_VERSION,
  GameCommandResultV1Schema,
  GameErrorV1Schema,
  ListAuthoritativeSlotsResponseV1Schema,
  OFFICIAL_GAME_SIMULATION_VERSION,
  OFFICIAL_GAME_V12_SIMULATION_VERSION,
  OFFICIAL_GAME_V13_SIMULATION_VERSION,
  OFFICIAL_GAME_V14_SIMULATION_VERSION,
  OFFICIAL_GAME_V15_SIMULATION_VERSION,
  OFFICIAL_GAME_V16_SIMULATION_VERSION,
  OFFICIAL_GAME_V17_SIMULATION_VERSION,
  OFFICIAL_GAME_V18_SIMULATION_VERSION,
  OFFICIAL_GAME_V19_SIMULATION_VERSION,
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
  OFFICIAL_GAME_V21_SIMULATION_VERSION,
  OFFICIAL_GAME_V22_SIMULATION_VERSION,
  OFFICIAL_GAME_V23_SIMULATION_VERSION,
  OFFICIAL_GAME_V24_SIMULATION_VERSION,
  OFFICIAL_GAME_V25_SIMULATION_VERSION,
  OFFICIAL_GAME_V26_SIMULATION_VERSION,
  OFFICIAL_GAME_V27_SIMULATION_VERSION,
  OfficialGameCommandResultV12Schema,
  OfficialGameCommandResultV13Schema,
  OfficialGameCommandResultV14Schema,
  OfficialGameCommandResultV15Schema,
  OfficialGameCommandResultV16Schema,
  OfficialGameCommandResultV17Schema,
  OfficialGameCommandResultV18Schema,
  OfficialGameCommandResultV19Schema,
  OfficialGameCommandResultV20Schema,
  OfficialGameCommandResultV21Schema,
  OfficialGameCommandResultV22Schema,
  OfficialGameCommandResultV23Schema,
  OfficialGameCommandResultV24Schema,
  OfficialGameCommandResultV25Schema,
  OfficialGameCommandResultV26Schema,
  OfficialGameCommandResultV27Schema,
  OfficialGameProjectionV12Schema,
  OfficialGameProjectionV13Schema,
  OfficialGameProjectionV14Schema,
  OfficialGameProjectionV15Schema,
  OfficialGameProjectionV16Schema,
  OfficialGameProjectionV17Schema,
  OfficialGameProjectionV18Schema,
  OfficialGameProjectionV19Schema,
  OfficialGameProjectionV20Schema,
  OfficialGameProjectionV21Schema,
  OfficialGameProjectionV22Schema,
  OfficialGameProjectionV23Schema,
  OfficialGameProjectionV24Schema,
  OfficialGameProjectionV25Schema,
  OfficialGameProjectionV26Schema,
  OfficialGameProjectionV27Schema,
  PRESENTATION_EVENT_VERSION,
  RegistrationInfoV1Schema,
  ScoreboardResponseV1Schema,
  SlotProjectionV1Schema,
  type AccountSummaryV1,
  type AuthoritativeSlotSummaryV1,
  type CreateAccountResponseV1,
  type RegistrationInfoV1,
  type GameCommandEnvelopeV1,
  type GameCommandResultV1,
  type GameErrorCodeV1,
  type LogicPackDescriptorV1,
  type OfficialGameCommandResultV13,
  type OfficialGameCommandResultV14,
  type OfficialGameCommandResultV15,
  type OfficialGameCommandResultV16,
  type OfficialGameCommandResultV17,
  type OfficialGameCommandResultV18,
  type OfficialGameCommandResultV19,
  type OfficialGameCommandResultV20,
  type OfficialGameCommandResultV21,
  type OfficialGameCommandResultV22,
  type OfficialGameCommandResultV23,
  type OfficialGameCommandResultV24,
  type OfficialGameCommandResultV25,
  type OfficialGameCommandResultV26,
  type OfficialGameCommandResultV27,
  type OfficialGameProjectionV13,
  type OfficialGameProjectionV14,
  type OfficialGameProjectionV15,
  type OfficialGameProjectionV16,
  type OfficialGameProjectionV17,
  type OfficialGameProjectionV18,
  type OfficialGameProjectionV19,
  type OfficialGameProjectionV20,
  type OfficialGameProjectionV21,
  type OfficialGameProjectionV22,
  type OfficialGameProjectionV23,
  type OfficialGameProjectionV24,
  type OfficialGameProjectionV25,
  type OfficialGameProjectionV26,
  type OfficialGameProjectionV27,
  type ScoreboardResponseV1,
  type SlotProjectionV1,
} from "@dib/game-protocol";
import type { SaveSlotId } from "@dib/save-protocol";
import { AccountGateway } from "./accountGateway.js";

/**
 * Every projection shape this client can be handed by an installed simulation. v13 replaced the
 * battle view's `backgroundKey` with a semantic `scene`, so it is not a widening of the historical
 * projection and has to be part of the union rather than assignable to it.
 */
export type InstalledSlotProjection =
  | SlotProjectionV1
  | OfficialGameProjectionV13
  | OfficialGameProjectionV14
  | OfficialGameProjectionV15
  | OfficialGameProjectionV16
  | OfficialGameProjectionV17
  | OfficialGameProjectionV18
  | OfficialGameProjectionV19
  | OfficialGameProjectionV20
  | OfficialGameProjectionV21
  | OfficialGameProjectionV22
  | OfficialGameProjectionV23
  | OfficialGameProjectionV24
  | OfficialGameProjectionV25
  | OfficialGameProjectionV26
  | OfficialGameProjectionV27;
export type InstalledCommandResult =
  | GameCommandResultV1
  | OfficialGameCommandResultV13
  | OfficialGameCommandResultV14
  | OfficialGameCommandResultV15
  | OfficialGameCommandResultV16
  | OfficialGameCommandResultV17
  | OfficialGameCommandResultV18
  | OfficialGameCommandResultV19
  | OfficialGameCommandResultV20
  | OfficialGameCommandResultV21
  | OfficialGameCommandResultV22
  | OfficialGameCommandResultV23
  | OfficialGameCommandResultV24
  | OfficialGameCommandResultV25
  | OfficialGameCommandResultV26
  | OfficialGameCommandResultV27;

/** Browser/server mechanics contract. A different simulation must never be entered with this
 * client: command availability and projection semantics can otherwise fail only after gameplay
 * has already begun, leaving modal flows waiting on commands the running server does not know. */
export const OFFICIAL_CLIENT_SIMULATION_VERSION = OFFICIAL_GAME_SIMULATION_VERSION;
// Transport headroom, not simulation time. Renew on the next authenticated operation rather
// than starting background timers; idle tabs need no network activity.
const SESSION_RENEWAL_MARGIN_MS = 30_000;

export interface GameAuthority {
  setRecoveryPrompt?(prompt: (error: RemoteGameAuthorityError) => Promise<void>): void;
  /** Scoped authenticated PvP transport. Offline clients never receive the Official token. */
  readonly pvpTransport?: (path: string, init: RequestInit) => Promise<Response>;
  readonly trustTier: "official";
  readonly pack: LogicPackDescriptorV1;
  readonly slots: readonly AuthoritativeSlotSummaryV1[];
  /**
   * Present when the session belongs to a self-registered account. Optional because operator-issued
   * invites own no account record, and because in-memory test doubles implement play only.
   */
  readonly account?: AccountGateway | undefined;
  /**
   * Reads the public most-XP board. Present for a real remote session and absent for in-memory
   * doubles, so the `Highscores` menu row lights up only where there is a server to rank against.
   * It is unauthenticated and carries nothing session-specific; it lives here purely because this
   * is what holds the endpoint.
   */
  readonly scoreboard?: (() => Promise<ScoreboardResponseV1>) | undefined;
  bootstrap(slotId: SaveSlotId): Promise<InstalledSlotProjection>;
  command(slotId: SaveSlotId, envelope: GameCommandEnvelopeV1): Promise<InstalledCommandResult>;
  deleteSlot(slotId: SaveSlotId, expectedRevision: number): Promise<void>;
  refreshSlots(): Promise<readonly AuthoritativeSlotSummaryV1[]>;
  close(): Promise<void>;
}

export class RemoteGameAuthorityError extends Error {
  constructor(
    readonly code: GameErrorCodeV1,
    message: string,
    readonly retryable: boolean,
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = "RemoteGameAuthorityError";
  }
}

export class RemoteGameAuthority implements GameAuthority {
  private recoveryPrompt: ((error: RemoteGameAuthorityError) => Promise<void>) | undefined;

  setRecoveryPrompt(prompt: (error: RemoteGameAuthorityError) => Promise<void>): void {
    this.recoveryPrompt = prompt;
  }
  readonly pvpTransport = async (path: string, init: RequestInit): Promise<Response> => {
    if (!/^\/api\/pvp\/(?:invites|join|matches(?:\/|$))/.test(path)) throw new Error("Invalid PvP route");
    const send = () => {
      const headers = new Headers(init.headers); headers.set("Authorization", `Bearer ${this.token}`);
      return fetch(`${this.endpoint}${path}`, { ...init, headers });
    };
    await this.ensureSessionFresh();
    const response = await send();
    if (response.status !== 401) return response;
    await this.reauthenticate();
    return send();
  };
  readonly trustTier = "official" as const;
  readonly account: AccountGateway | undefined;
  readonly scoreboard = (): Promise<ScoreboardResponseV1> => fetchScoreboard(this.endpoint);
  private slotSummaries: AuthoritativeSlotSummaryV1[];
  private token: string;
  private reauthentication: Promise<void> | undefined;

  private constructor(
    private readonly endpoint: string,
    token: string,
    private expiresAtMs: number,
    readonly pack: LogicPackDescriptorV1,
    slots: readonly AuthoritativeSlotSummaryV1[],
    private readonly authentication: {
      readonly loginToken: string;
      readonly logicPackId: string;
      readonly clientBuild?: string;
    },
    account: AccountSummaryV1 | undefined,
  ) {
    this.token = token;
    this.slotSummaries = [...slots];
    this.account = account === undefined ? undefined : new AccountGateway({
      client: {
        fetchAccount: async () => AccountResponseV1Schema.parse(
          await this.authorizedJson("/api/game/account", { method: "GET" }),
        ).account,
        updateAccountSettings: async (patch) => AccountResponseV1Schema.parse(
          await this.authorizedJson("/api/game/account/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              protocolVersion: GAME_PROTOCOL_VERSION,
              publicScoreboard: patch.publicScoreboard,
            }),
          }),
        ).account,
      },
      initial: account,
      onError: (error) => {
        console.error("Official online account settings write failed", error);
      },
    });
  }

  static async authenticate(options: {
    endpoint: string;
    loginToken: string;
    logicPackId: string;
    clientBuild?: string;
    expectedSimulationVersion?: string;
  }): Promise<RemoteGameAuthority> {
    const endpoint = options.endpoint.replace(/\/+$/, "");
    const authentication = {
      loginToken: options.loginToken,
      logicPackId: options.logicPackId,
      ...(options.clientBuild === undefined ? {} : { clientBuild: options.clientBuild }),
    };
    const session = await createSession(endpoint, authentication);
    if (
      options.expectedSimulationVersion !== undefined &&
      session.pack.simulationVersion !== options.expectedSimulationVersion
    ) {
      throw new RemoteGameAuthorityError(
        "PACK_UNAVAILABLE",
        `Official online server/client mismatch: the server is running ` +
          `${session.pack.simulationVersion}, but this client requires ` +
          `${options.expectedSimulationVersion}. Start both from the same checkout, restart ` +
          "the game server with `pnpm game:dev`, and reload the web client.",
        false,
      );
    }
    return new RemoteGameAuthority(
      endpoint,
      session.token,
      Date.parse(session.expiresAt),
      session.pack,
      session.slots,
      authentication,
      session.account,
    );
  }

  get slots(): readonly AuthoritativeSlotSummaryV1[] {
    return this.slotSummaries;
  }

  async bootstrap(slotId: SaveSlotId): Promise<InstalledSlotProjection> {
    return this.parseProjection(await this.authorizedJson(
      `/api/game/slots/${slotId}/bootstrap`,
      { method: "GET" },
    ));
  }

  async command(
    slotId: SaveSlotId,
    envelope: GameCommandEnvelopeV1,
  ): Promise<InstalledCommandResult> {
    const result = this.parseCommandResult(await this.authorizedJson(
      `/api/game/slots/${slotId}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      },
    ));
    await this.updateSummaryFrom(result.projection);
    return result;
  }

  async deleteSlot(slotId: SaveSlotId, expectedRevision: number): Promise<void> {
    await this.authorizedJson(`/api/game/slots/${slotId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: GAME_PROTOCOL_VERSION, expectedRevision }),
    });
    this.slotSummaries = this.slotSummaries.filter((summary) => summary.slotId !== slotId);
  }

  async refreshSlots(): Promise<readonly AuthoritativeSlotSummaryV1[]> {
    const response = ListAuthoritativeSlotsResponseV1Schema.parse(
      await this.authorizedJson("/api/game/slots", { method: "GET" }),
    );
    this.slotSummaries = [...response.slots];
    return this.slotSummaries;
  }

  async close(): Promise<void> {
    // Bearer sessions are short-lived and server-expiring. A revocation endpoint can be added when
    // the shared account/session package lands; closing a tab never mutates authoritative state.
  }

  /**
   * Wire parsing is selected by the simulation the session actually installed, exactly as
   * `AuthoritativeGameService` selects it when producing the bytes. `SlotProjectionV1Schema` is
   * strict and deliberately frozen on the historical v11 shape, so parsing a v12 projection with
   * it rejects the required `collectionClaims` sibling as an unrecognized key and fails every
   * bootstrap before the title screen.
   */
  private parseProjection(value: unknown): InstalledSlotProjection {
    if (this.pack.simulationVersion === OFFICIAL_GAME_V22_SIMULATION_VERSION) {
      return OfficialGameProjectionV22Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V23_SIMULATION_VERSION) {
      return OfficialGameProjectionV23Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V24_SIMULATION_VERSION) {
      return OfficialGameProjectionV24Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V25_SIMULATION_VERSION) {
      return OfficialGameProjectionV25Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V27_SIMULATION_VERSION) {
      return OfficialGameProjectionV27Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V26_SIMULATION_VERSION) {
      return OfficialGameProjectionV26Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V21_SIMULATION_VERSION) {
      return OfficialGameProjectionV21Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V20_SIMULATION_VERSION) {
      return OfficialGameProjectionV20Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V19_SIMULATION_VERSION) {
      return OfficialGameProjectionV19Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V18_SIMULATION_VERSION) {
      return OfficialGameProjectionV18Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V17_SIMULATION_VERSION) {
      return OfficialGameProjectionV17Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V16_SIMULATION_VERSION) {
      return OfficialGameProjectionV16Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V15_SIMULATION_VERSION) {
      return OfficialGameProjectionV15Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V14_SIMULATION_VERSION) {
      return OfficialGameProjectionV14Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V13_SIMULATION_VERSION) {
      return OfficialGameProjectionV13Schema.parse(value);
    }
    return this.pack.simulationVersion === OFFICIAL_GAME_V12_SIMULATION_VERSION
      ? OfficialGameProjectionV12Schema.parse(value)
      : SlotProjectionV1Schema.parse(value);
  }

  private parseCommandResult(value: unknown): InstalledCommandResult {
    if (this.pack.simulationVersion === OFFICIAL_GAME_V22_SIMULATION_VERSION) {
      return OfficialGameCommandResultV22Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V23_SIMULATION_VERSION) {
      return OfficialGameCommandResultV23Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V24_SIMULATION_VERSION) {
      return OfficialGameCommandResultV24Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V25_SIMULATION_VERSION) {
      return OfficialGameCommandResultV25Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V27_SIMULATION_VERSION) {
      return OfficialGameCommandResultV27Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V26_SIMULATION_VERSION) {
      return OfficialGameCommandResultV26Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V21_SIMULATION_VERSION) {
      return OfficialGameCommandResultV21Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V20_SIMULATION_VERSION) {
      return OfficialGameCommandResultV20Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V19_SIMULATION_VERSION) {
      return OfficialGameCommandResultV19Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V18_SIMULATION_VERSION) {
      return OfficialGameCommandResultV18Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V17_SIMULATION_VERSION) {
      return OfficialGameCommandResultV17Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V16_SIMULATION_VERSION) {
      return OfficialGameCommandResultV16Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V15_SIMULATION_VERSION) {
      return OfficialGameCommandResultV15Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V14_SIMULATION_VERSION) {
      return OfficialGameCommandResultV14Schema.parse(value);
    }
    if (this.pack.simulationVersion === OFFICIAL_GAME_V13_SIMULATION_VERSION) {
      return OfficialGameCommandResultV13Schema.parse(value);
    }
    return this.pack.simulationVersion === OFFICIAL_GAME_V12_SIMULATION_VERSION
      ? OfficialGameCommandResultV12Schema.parse(value)
      : GameCommandResultV1Schema.parse(value);
  }

  private async authorizedJson(path: string, init: RequestInit): Promise<unknown> {
    for (;;) {
      try {
        try {
          await this.ensureSessionFresh();
          return await this.authorizedJsonOnce(path, init);
        } catch (error) {
          if (!(error instanceof RemoteGameAuthorityError) || error.code !== "SESSION_EXPIRED") throw error;
          await this.reauthenticate();
          return await this.authorizedJsonOnce(path, init);
        }
      } catch (error) {
        if (this.recoveryPrompt === undefined || !(error instanceof RemoteGameAuthorityError) ||
            (!error.retryable && error.code !== "PACK_UNAVAILABLE")) throw error;
        // Preserve the exact serialized intent, including command ID/revision, across arbitrary
        // outage duration. The owning battle/Egg/transition continues only on the committed reply.
        await this.recoveryPrompt(error);
      }
    }
  }

  private async authorizedJsonOnce(path: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    return await requestJson(`${this.endpoint}${path}`, { ...init, headers });
  }

  private async ensureSessionFresh(): Promise<void> {
    if (this.reauthentication !== undefined || Date.now() >= this.expiresAtMs - SESSION_RENEWAL_MARGIN_MS) {
      await this.reauthenticate();
    }
  }

  private async reauthenticate(): Promise<void> {
    if (this.reauthentication === undefined) {
      this.reauthentication = createSession(this.endpoint, this.authentication)
        .then((session) => {
          if (
            session.pack.logicPackId !== this.pack.logicPackId ||
            session.pack.simulationVersion !== this.pack.simulationVersion
          ) {
            throw new RemoteGameAuthorityError(
              "PACK_UNAVAILABLE",
              "the renewed session selected a different authoritative simulation",
              false,
            );
          }
          this.token = session.token;
          this.expiresAtMs = Date.parse(session.expiresAt);
          this.slotSummaries = [...session.slots];
        })
        .finally(() => {
          this.reauthentication = undefined;
        });
    }
    await this.reauthentication;
  }

  private async updateSummaryFrom(projection: InstalledSlotProjection): Promise<void> {
    const activeDomain = projection.location.kind === "town"
      ? "town"
      : projection.location.kind === "world"
        ? "world"
        : projection.location.kind === "battle"
          ? "battle"
          : projection.location.kind === "dungeon"
            ? "dungeon"
            : "none";
    const next: AuthoritativeSlotSummaryV1 = {
      slotId: projection.slotId,
      revision: projection.revision,
      updatedAt: projection.updatedAt ?? new Date().toISOString(),
      logicPackId: projection.logicPackId,
      simulationVersion: projection.simulationVersion,
      trustTier: "official",
      activeDomain,
    };
    this.slotSummaries = [
      ...this.slotSummaries.filter((summary) => summary.slotId !== projection.slotId),
      next,
    ].sort((left, right) => left.slotId.localeCompare(right.slotId));
  }
}

/**
 * Unauthenticated capability probe. Registration is operator-controlled, so the gate asks whether
 * the affordance exists instead of offering a button that can only fail.
 */
export async function fetchRegistrationInfo(endpoint: string): Promise<RegistrationInfoV1> {
  return RegistrationInfoV1Schema.parse(
    await requestJson(`${endpoint.replace(/\/+$/, "")}/api/game/registration`, { method: "GET" }),
  );
}

/**
 * Reads the public most-XP board. Unauthenticated by design, so it lives beside the registration
 * probe rather than on the session client: a player looking at scores has not necessarily signed in
 * on this device, and the board carries nothing that belongs to a particular login.
 */
export async function fetchScoreboard(endpoint: string): Promise<ScoreboardResponseV1> {
  return ScoreboardResponseV1Schema.parse(
    await requestJson(`${endpoint.replace(/\/+$/, "")}/api/game/scoreboard`, { method: "GET" }),
  );
}

/** Mints a brand-new account. The returned login token is shown once and never recoverable. */
export async function createOnlineAccount(options: {
  endpoint: string;
  username: string;
  publicScoreboard: boolean;
}): Promise<CreateAccountResponseV1> {
  return CreateAccountResponseV1Schema.parse(
    await requestJson(`${options.endpoint.replace(/\/+$/, "")}/api/game/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        username: options.username,
        publicScoreboard: options.publicScoreboard,
      }),
    }),
  );
}

async function createSession(
  endpoint: string,
  authentication: {
    readonly loginToken: string;
    readonly logicPackId: string;
    readonly clientBuild?: string;
  },
) {
  const body = await requestJson(`${endpoint}/api/game/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: GAME_PROTOCOL_VERSION,
      loginToken: authentication.loginToken,
      logicPackId: authentication.logicPackId,
      supportedEventVersions: [PRESENTATION_EVENT_VERSION],
      ...(authentication.clientBuild === undefined
        ? {}
        : { clientBuild: authentication.clientBuild }),
    }),
  });
  return CreateGameSessionResponseV1Schema.parse(body);
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new RemoteGameAuthorityError(
      "INTERNAL",
      "Official online is unavailable. Make sure the authoritative server is running: " +
      "`pnpm game:dev`.",
      true,
    );
  }
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new RemoteGameAuthorityError(
      "INTERNAL",
      response.status >= 500
        ? `Official online is unavailable (HTTP ${response.status}). ` +
          "Make sure the authoritative server is running: `pnpm game:dev`."
        : `authoritative service returned HTTP ${response.status} without JSON`,
      response.status >= 500 || response.ok,
    );
  }
  if (!response.ok) {
    const parsed = GameErrorV1Schema.safeParse(body);
    if (!parsed.success) {
      throw new RemoteGameAuthorityError(
        "INTERNAL",
        `authoritative service returned malformed HTTP ${response.status}`,
        response.status >= 500,
      );
    }
    throw new RemoteGameAuthorityError(
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.retryable,
      parsed.data.error.currentRevision,
    );
  }
  return body;
}
