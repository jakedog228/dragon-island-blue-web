import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ACCOUNT_USERNAME_MAX_LENGTH,
  ACCOUNT_USERNAME_MIN_LENGTH,
  AccountUsernameV1Schema,
  normalizeAccountUsername,
} from "@dib/game-protocol";
import { durableWriteFile } from "./durableWrite.js";
import { withFileLock } from "./fileLock.js";

/**
 * Durable invite registry for authoritative play. Raw login tokens are never stored: the registry
 * contains only the same secret-bound player identifier used by the game service.
 *
 * Self-registered accounts live in the same registry rather than a sibling file: the invite *is*
 * the account, so `readAuthorizedPlayerIds` stays the single source of truth for who may play.
 */
export interface InviteRecord {
  readonly issuedAt: string;
  readonly label?: string;
  readonly username?: string;
  readonly publicScoreboard?: boolean;
}

/** The account view of a record; only records carrying a username have one. */
export interface AccountRecord {
  readonly username: string;
  readonly publicScoreboard: boolean;
  readonly createdAt: string;
}

interface InviteRegistryFile {
  readonly schemaVersion: 1;
  readonly invites: Record<string, InviteRecord>;
}

const INVITES_FILE = "invites.json";
const INVITES_LOCK_FILE = "invites.json.lock";
const PLAYER_ID_PATTERN = /^[a-f0-9]{64}$/;

/** Distinguishes "the caller asked for something impossible" from "the registry is broken". */
export class AccountRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountRequestError";
  }
}

export function loginTokenPlayerId(secret: string | Uint8Array, token: string): string {
  return createHmac("sha256", secret).update(`player\0${token}`).digest("hex");
}

export function generateLoginToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function readAuthorizedPlayerIds(dataDirectory: string): Promise<Set<string>> {
  const registry = await readRegistry(dataDirectory);
  return new Set(Object.keys(registry.invites));
}

export async function listInvites(
  dataDirectory: string,
): Promise<Array<{ playerId: string } & InviteRecord>> {
  const registry = await readRegistry(dataDirectory);
  return Object.entries(registry.invites)
    .map(([playerId, record]) => ({ playerId, ...record }))
    .sort((left, right) =>
      left.issuedAt < right.issuedAt ? -1 : left.issuedAt > right.issuedAt ? 1 : 0
    );
}

export async function authorizeLoginToken(options: {
  readonly dataDirectory: string;
  readonly hmacSecret: string | Uint8Array;
  readonly token: string;
  readonly label?: string;
  readonly username?: string;
  readonly publicScoreboard?: boolean;
  readonly now?: () => number;
}): Promise<string> {
  const playerId = loginTokenPlayerId(options.hmacSecret, options.token);
  const username = options.username === undefined
    ? undefined
    : normalizeAccountUsername(options.username);
  // The operator path never passes through the request schema, so without this check `invite
  // --username` could store a name the registration route would have refused -- and those names
  // are published on the scoreboard.
  if (username !== undefined) assertUsernameWellFormed(username);
  return mutateRegistry(options.dataDirectory, (registry) => {
    if (username !== undefined) assertUsernameAvailable(registry, username, playerId);
    registry.invites[playerId] = {
      issuedAt: new Date((options.now ?? Date.now)()).toISOString(),
      ...(options.label !== undefined && options.label.length > 0 ? { label: options.label } : {}),
      ...(username === undefined
        ? {}
        : { username, publicScoreboard: options.publicScoreboard ?? false }),
    };
    return playerId;
  });
}

/**
 * Mints a login token for a self-registered account. The token is returned once and is not
 * recoverable: only its HMAC-derived player id reaches the registry.
 */
export async function createAccount(options: {
  readonly dataDirectory: string;
  readonly hmacSecret: string | Uint8Array;
  readonly username: string;
  readonly publicScoreboard: boolean;
  readonly maxAccounts: number;
  readonly now?: () => number;
}): Promise<{ loginToken: string; playerId: string; account: AccountRecord }> {
  const username = normalizeAccountUsername(options.username);
  const loginToken = generateLoginToken();
  const playerId = loginTokenPlayerId(options.hmacSecret, loginToken);
  assertUsernameWellFormed(username);
  const account = await mutateRegistry(options.dataDirectory, (registry) => {
    // Accounts, not invites: operator-issued tokens authorize play without owning an account, and
    // counting them would let a handful of invites close registration on everybody else.
    if (countAccounts(registry) >= options.maxAccounts) {
      throw new AccountRequestError("this server has reached its account limit");
    }
    assertUsernameAvailable(registry, username, playerId);
    const created: AccountRecord = {
      username,
      publicScoreboard: options.publicScoreboard,
      createdAt: new Date((options.now ?? Date.now)()).toISOString(),
    };
    registry.invites[playerId] = {
      issuedAt: created.createdAt,
      username: created.username,
      publicScoreboard: created.publicScoreboard,
    };
    return created;
  });
  return { loginToken, playerId, account };
}

export async function readAccount(
  dataDirectory: string,
  playerId: string,
): Promise<AccountRecord | undefined> {
  assertPlayerId(playerId);
  const registry = await readRegistry(dataDirectory);
  return toAccount(registry.invites[playerId]);
}

export async function updateAccountSettings(
  dataDirectory: string,
  playerId: string,
  patch: { readonly publicScoreboard: boolean },
): Promise<AccountRecord> {
  assertPlayerId(playerId);
  return mutateRegistry(dataDirectory, (registry) => {
    const record = registry.invites[playerId];
    const account = toAccount(record);
    if (record === undefined || account === undefined) {
      throw new AccountRequestError("this login token has no account");
    }
    registry.invites[playerId] = { ...record, publicScoreboard: patch.publicScoreboard };
    return { ...account, publicScoreboard: patch.publicScoreboard };
  });
}

export async function countInvites(dataDirectory: string): Promise<number> {
  return Object.keys((await readRegistry(dataDirectory)).invites).length;
}

export async function revokeInvite(dataDirectory: string, playerId: string): Promise<boolean> {
  assertPlayerId(playerId);
  return mutateRegistry(dataDirectory, (registry) => {
    if (!(playerId in registry.invites)) return false;
    delete registry.invites[playerId];
    return true;
  }, { writeWhen: (removed) => removed });
}

function toAccount(record: InviteRecord | undefined): AccountRecord | undefined {
  if (record === undefined || record.username === undefined) return undefined;
  return {
    username: record.username,
    publicScoreboard: record.publicScoreboard ?? false,
    createdAt: record.issuedAt,
  };
}

function assertPlayerId(playerId: string): void {
  if (!PLAYER_ID_PATTERN.test(playerId)) {
    throw new Error(`invalid player id ${JSON.stringify(playerId)}`);
  }
}

function countAccounts(registry: InviteRegistryFile): number {
  return Object.values(registry.invites).filter((record) => record.username !== undefined).length;
}

/**
 * Applies the wire schema's own username rule to every entry point, so the CLI and the HTTP route
 * cannot disagree about what a valid name is. The message states the rule rather than echoing zod,
 * because it reaches a person who has to fix their input.
 */
function assertUsernameWellFormed(username: string): void {
  if (!AccountUsernameV1Schema.safeParse(username).success) {
    throw new AccountRequestError(
      `usernames are ${ACCOUNT_USERNAME_MIN_LENGTH}–${ACCOUNT_USERNAME_MAX_LENGTH} characters: ` +
      "letters and digits, optionally separated by single spaces, _ or -",
    );
  }
}

/** Names are compared case-insensitively so two accounts cannot differ only by capitalisation. */
function usernameKey(username: string): string {
  return normalizeAccountUsername(username).toLowerCase();
}

function assertUsernameAvailable(
  registry: InviteRegistryFile,
  username: string,
  playerId: string,
): void {
  const wanted = usernameKey(username);
  for (const [existingId, record] of Object.entries(registry.invites)) {
    if (existingId === playerId || record.username === undefined) continue;
    if (usernameKey(record.username) === wanted) {
      throw new AccountRequestError(`the username ${JSON.stringify(username)} is already taken`);
    }
  }
}

/**
 * Every mutator is a read-modify-write of the whole file, and self-registration means several can
 * be in flight at once. Serialising per data directory keeps concurrent registrations from reading
 * the same generation and silently dropping each other's entries.
 *
 * This queue covers one process. It is kept in front of the cross-process lock below because it is
 * far cheaper for the common case -- a server handling concurrent registrations contends with
 * itself, not with the CLI -- and because it keeps this process's own writes in the order they were
 * requested rather than in whatever order they win the lock race.
 */
const writeQueues = new Map<string, Promise<unknown>>();

async function mutateRegistry<T>(
  dataDirectory: string,
  mutate: (registry: InviteRegistryFile) => T,
  options?: { readonly writeWhen?: (result: T) => boolean },
): Promise<T> {
  const key = resolve(dataDirectory);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const next = previous.then(async () =>
    // The read must happen *inside* the lock: reading first would reintroduce exactly the
    // lost-update window the lock exists to close.
    withFileLock(join(key, INVITES_LOCK_FILE), async () => {
      const registry = await readRegistry(dataDirectory);
      const result = mutate(registry);
      if (options?.writeWhen === undefined || options.writeWhen(result)) {
        await writeRegistry(dataDirectory, registry);
      }
      return result;
    }));
  // The queue must advance even when this mutation fails, or one rejected registration would wedge
  // every later write behind a settled-rejected promise.
  writeQueues.set(key, next.then(() => undefined, () => undefined));
  return next;
}

async function readRegistry(dataDirectory: string): Promise<InviteRegistryFile> {
  try {
    const parsed = JSON.parse(
      await readFile(join(resolve(dataDirectory), INVITES_FILE), "utf8"),
    ) as unknown;
    if (
      typeof parsed !== "object" || parsed === null ||
      (parsed as InviteRegistryFile).schemaVersion !== 1 ||
      typeof (parsed as InviteRegistryFile).invites !== "object" ||
      (parsed as InviteRegistryFile).invites === null
    ) {
      throw new Error("invite registry is corrupt");
    }
    const invites: Record<string, InviteRecord> = {};
    for (const [playerId, record] of Object.entries((parsed as InviteRegistryFile).invites)) {
      if (!PLAYER_ID_PATTERN.test(playerId) || typeof record !== "object" || record === null) {
        throw new Error("invite registry is corrupt");
      }
      if (typeof record.issuedAt !== "string") throw new Error("invite registry is corrupt");
      if (record.username !== undefined && typeof record.username !== "string") {
        throw new Error("invite registry is corrupt");
      }
      if (record.publicScoreboard !== undefined && typeof record.publicScoreboard !== "boolean") {
        throw new Error("invite registry is corrupt");
      }
      invites[playerId] = {
        issuedAt: record.issuedAt,
        ...(typeof record.label === "string" ? { label: record.label } : {}),
        ...(record.username === undefined ? {} : { username: record.username }),
        ...(record.publicScoreboard === undefined
          ? {}
          : { publicScoreboard: record.publicScoreboard }),
      };
    }
    return { schemaVersion: 1, invites };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, invites: {} };
    }
    throw error;
  }
}

async function writeRegistry(dataDirectory: string, registry: InviteRegistryFile): Promise<void> {
  const path = join(resolve(dataDirectory), INVITES_FILE);
  await durableWriteFile(path, `${JSON.stringify(registry, null, 2)}\n`);
}
