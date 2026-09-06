import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Boot configuration for the authoritative game service.
 *
 * Every environment read lives here so a deployment fails fast, once, with the complete list of
 * what is wrong instead of crashing on the first bad value halfway through resource loading.
 *
 * The production entrypoint runs from a bundle in `dist/`, not from `src/`, so nothing in this
 * module may derive a path from `import.meta.dirname`. Development keeps repository-relative
 * defaults for convenience; production requires the operator to state every path explicitly.
 */

export type GameEnvironment = "development" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export interface RateLimitSettings {
  /** Sustained requests per minute allowed once the initial burst is spent. */
  readonly perMinute: number;
  /** Requests admitted instantly from a cold bucket. */
  readonly burst: number;
}

export interface GameServerConfig {
  readonly environment: GameEnvironment;
  readonly port: number;
  readonly bindHost: string;
  readonly hmacSecret: string;
  readonly dataDirectory: string;
  readonly extractedDataDirectory: string;
  readonly startWorld: string;
  readonly startTown: string;
  readonly allowedOrigins: readonly string[];
  readonly bootstrapInviteTokens: readonly string[];
  /** Honour `X-Forwarded-For` only when a trusted reverse proxy terminates the connection. */
  readonly trustProxy: boolean;
  readonly logLevel: LogLevel;
  /**
   * Durable copy of the log stream, in addition to stdout. Unset leaves stdout the only sink, which
   * is fine in development but loses all history on every container recreation in production.
   */
  readonly logFile: string | undefined;
  readonly logFileMaxBytes: number;
  readonly logFileKeep: number;
  readonly shutdownGraceMs: number;
  readonly sessionRateLimit: RateLimitSettings;
  readonly commandRateLimit: RateLimitSettings;
  /** In-app account creation. Disabling it leaves the service invite-only as it was before. */
  readonly registrationEnabled: boolean;
  readonly registrationRateLimit: RateLimitSettings;
  /** Ceiling on durable accounts; open registration without one is unbounded growth. */
  readonly maxAccounts: number;
  /** Throttle for the unauthenticated public scoreboard read. */
  readonly scoreboardRateLimit: RateLimitSettings;
  /** Non-fatal problems worth logging once at startup (for example loose secret-file permissions). */
  readonly warnings: readonly string[];
}

export interface LoadGameServerConfigOptions {
  readonly environment?: NodeJS.ProcessEnv;
  /**
   * Repository root used for development-only path defaults. The production path never consults
   * it, which is what keeps a relocated bundle from inventing a state directory beside itself.
   */
  readonly repositoryRoot?: string;
}

export class ConfigurationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `authoritative game server configuration is invalid:\n` +
      problems.map((problem) => `  - ${problem}`).join("\n"),
    );
    this.name = "ConfigurationError";
  }
}

/** Collects every problem before throwing so one restart surfaces the whole list. */
class ProblemLog {
  private readonly problems: string[] = [];
  private readonly warnings: string[] = [];

  fail(message: string): void {
    this.problems.push(message);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  finish(): readonly string[] {
    if (this.problems.length > 0) throw new ConfigurationError(this.problems);
    return Object.freeze([...this.warnings]);
  }
}

export function loadGameServerConfig(
  options: LoadGameServerConfigOptions = {},
): GameServerConfig {
  const environmentVariables = options.environment ?? process.env;
  const problems = new ProblemLog();
  const read = (name: string): string | undefined => {
    const value = environmentVariables[name];
    return value === undefined || value.trim().length === 0 ? undefined : value.trim();
  };

  const environment = readEnvironment(read("DIB_GAME_ENV"), problems);
  const isProduction = environment === "production";
  const repositoryRoot = options.repositoryRoot;

  const developmentDefault = (relative: string, variableName: string): string | undefined => {
    if (isProduction) {
      problems.fail(`${variableName} is required when DIB_GAME_ENV=production`);
      return undefined;
    }
    if (repositoryRoot === undefined) {
      problems.fail(`${variableName} is required (no repository root is available for a default)`);
      return undefined;
    }
    return resolve(repositoryRoot, relative);
  };

  const port = readPort(read("DIB_GAME_PORT"), problems);
  const bindHost = read("DIB_GAME_BIND_HOST") ?? "127.0.0.1";
  const hmacSecret = readSecret(read, isProduction, repositoryRoot, problems);

  const dataDirectory = read("DIB_GAME_DATA_DIR") !== undefined
    ? resolve(read("DIB_GAME_DATA_DIR") as string)
    : developmentDefault(".dib-game-data", "DIB_GAME_DATA_DIR");
  const extractedDataDirectory = read("DIB_GAME_EXTRACTED_DATA") !== undefined
    ? resolve(read("DIB_GAME_EXTRACTED_DATA") as string)
    : developmentDefault("extracted/data", "DIB_GAME_EXTRACTED_DATA");

  if (extractedDataDirectory !== undefined && !isDirectory(extractedDataDirectory)) {
    problems.fail(
      `DIB_GAME_EXTRACTED_DATA does not point at a directory: ${extractedDataDirectory}. ` +
      `The operator supplies the extracted resource tree at runtime; it is never part of the image.`,
    );
  }

  const logLevel = readLogLevel(read("DIB_GAME_LOG_LEVEL"), problems);
  const logFileSetting = read("DIB_GAME_LOG_FILE");
  const logFile = logFileSetting === undefined ? undefined : resolve(logFileSetting);
  const logFileMaxBytes = readPositiveInteger(
    read("DIB_GAME_LOG_FILE_MAX_BYTES"), "DIB_GAME_LOG_FILE_MAX_BYTES", 32 * 1024 * 1024, problems,
  );
  const logFileKeep = readPositiveInteger(
    read("DIB_GAME_LOG_FILE_KEEP"), "DIB_GAME_LOG_FILE_KEEP", 5, problems,
  );
  const shutdownGraceMs = readPositiveInteger(
    read("DIB_GAME_SHUTDOWN_GRACE_MS"),
    "DIB_GAME_SHUTDOWN_GRACE_MS",
    15_000,
    problems,
  );
  const trustProxy = readBoolean(read("DIB_GAME_TRUST_PROXY"), "DIB_GAME_TRUST_PROXY", false, problems);

  const sessionRateLimit: RateLimitSettings = {
    perMinute: readPositiveInteger(
      read("DIB_GAME_SESSION_RATE_PER_MINUTE"), "DIB_GAME_SESSION_RATE_PER_MINUTE", 20, problems,
    ),
    burst: readPositiveInteger(
      read("DIB_GAME_SESSION_RATE_BURST"), "DIB_GAME_SESSION_RATE_BURST", 10, problems,
    ),
  };
  const commandRateLimit: RateLimitSettings = {
    perMinute: readPositiveInteger(
      read("DIB_GAME_COMMAND_RATE_PER_MINUTE"), "DIB_GAME_COMMAND_RATE_PER_MINUTE", 600, problems,
    ),
    burst: readPositiveInteger(
      read("DIB_GAME_COMMAND_RATE_BURST"), "DIB_GAME_COMMAND_RATE_BURST", 120, problems,
    ),
  };

  // One registration per five minutes per address, which is `perMinute: 0.2` with a single-token
  // bucket: the first attempt is instant, the next one waits out the refill.
  const registrationRateLimit: RateLimitSettings = {
    perMinute: readPositiveNumber(
      read("DIB_GAME_REGISTRATION_RATE_PER_MINUTE"), "DIB_GAME_REGISTRATION_RATE_PER_MINUTE",
      0.2, problems,
    ),
    burst: readPositiveNumber(
      read("DIB_GAME_REGISTRATION_RATE_BURST"), "DIB_GAME_REGISTRATION_RATE_BURST", 1, problems,
    ),
  };
  const registrationEnabled = readBoolean(
    read("DIB_GAME_REGISTRATION_ENABLED"), "DIB_GAME_REGISTRATION_ENABLED", true, problems,
  );
  const maxAccounts = readPositiveInteger(
    read("DIB_GAME_MAX_ACCOUNTS"), "DIB_GAME_MAX_ACCOUNTS", 10_000, problems,
  );

  // Generous next to the other unauthenticated routes: the board is served from a shared cache and
  // reads no request body, so the limiter is here to bound a scraper rather than to ration a scarce
  // operation. A player opening the menu repeatedly must never trip it.
  const scoreboardRateLimit: RateLimitSettings = {
    perMinute: readPositiveNumber(
      read("DIB_GAME_SCOREBOARD_RATE_PER_MINUTE"), "DIB_GAME_SCOREBOARD_RATE_PER_MINUTE",
      60, problems,
    ),
    burst: readPositiveNumber(
      read("DIB_GAME_SCOREBOARD_RATE_BURST"), "DIB_GAME_SCOREBOARD_RATE_BURST", 20, problems,
    ),
  };

  const allowedOrigins = readList(read("DIB_GAME_ALLOWED_ORIGINS"));
  for (const origin of allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      problems.fail(`DIB_GAME_ALLOWED_ORIGINS entry is not an absolute URL: ${origin}`);
      continue;
    }
    if (`${parsed.protocol}//${parsed.host}` !== origin) {
      problems.fail(
        `DIB_GAME_ALLOWED_ORIGINS entry must be a bare scheme://host[:port] origin: ${origin}`,
      );
    }
    if (isProduction && parsed.protocol !== "https:") {
      problems.fail(`DIB_GAME_ALLOWED_ORIGINS entry must use https in production: ${origin}`);
    }
  }

  if (isProduction && bindHost === "0.0.0.0" && !trustProxy) {
    problems.warn(
      "DIB_GAME_BIND_HOST=0.0.0.0 with DIB_GAME_TRUST_PROXY unset: rate limiting will key on the " +
      "proxy's address rather than the client's. Set DIB_GAME_TRUST_PROXY=1 when a trusted reverse " +
      "proxy is the only thing that can reach this port.",
    );
  }

  const warnings = problems.finish();
  return Object.freeze({
    environment,
    port,
    bindHost,
    hmacSecret: hmacSecret as string,
    dataDirectory: dataDirectory as string,
    extractedDataDirectory: extractedDataDirectory as string,
    startWorld: read("DIB_GAME_START_WORLD") ?? "World_1-1",
    startTown: read("DIB_GAME_START_TOWN") ?? "First_City",
    allowedOrigins: Object.freeze(allowedOrigins),
    bootstrapInviteTokens: Object.freeze(readList(read("DIB_GAME_INVITE_TOKENS"))),
    trustProxy,
    logLevel,
    logFile,
    logFileMaxBytes,
    logFileKeep,
    shutdownGraceMs,
    sessionRateLimit: Object.freeze(sessionRateLimit),
    commandRateLimit: Object.freeze(commandRateLimit),
    registrationEnabled,
    registrationRateLimit: Object.freeze(registrationRateLimit),
    maxAccounts,
    scoreboardRateLimit: Object.freeze(scoreboardRateLimit),
    warnings,
  });
}

/**
 * Secret resolution for CLI subcommands that only need the HMAC (invite issuance), without paying
 * for full server configuration.
 */
export function loadHmacSecret(options: LoadGameServerConfigOptions = {}): string {
  const environmentVariables = options.environment ?? process.env;
  const problems = new ProblemLog();
  const read = (name: string): string | undefined => {
    const value = environmentVariables[name];
    return value === undefined || value.trim().length === 0 ? undefined : value.trim();
  };
  const secret = readSecret(
    read,
    readEnvironment(read("DIB_GAME_ENV"), problems) === "production",
    options.repositoryRoot,
    problems,
  );
  problems.finish();
  return secret as string;
}

/**
 * State directory resolution for CLI subcommands. Shares the production/development split with
 * {@link loadGameServerConfig} so `invite` and `serve` can never disagree about where the invite
 * registry lives.
 */
export function loadDataDirectory(options: LoadGameServerConfigOptions = {}): string {
  const environmentVariables = options.environment ?? process.env;
  const problems = new ProblemLog();
  const explicit = environmentVariables["DIB_GAME_DATA_DIR"];
  if (explicit !== undefined && explicit.trim().length > 0) return resolve(explicit.trim());
  const isProduction = readEnvironment(environmentVariables["DIB_GAME_ENV"]?.trim(), problems) === "production";
  if (isProduction) problems.fail("DIB_GAME_DATA_DIR is required when DIB_GAME_ENV=production");
  if (options.repositoryRoot === undefined) {
    problems.fail("DIB_GAME_DATA_DIR is required (no repository root is available for a default)");
  }
  problems.finish();
  return resolve(options.repositoryRoot as string, ".dib-game-data");
}

function readSecret(
  read: (name: string) => string | undefined,
  isProduction: boolean,
  repositoryRoot: string | undefined,
  problems: ProblemLog,
): string | undefined {
  const inline = read("DIB_GAME_HMAC_SECRET");
  const secretFile = read("DIB_GAME_HMAC_SECRET_FILE");

  if (inline !== undefined && isProduction) {
    problems.fail(
      "DIB_GAME_HMAC_SECRET must not be used when DIB_GAME_ENV=production: an inline secret is " +
      "readable through `docker inspect`, `ps`, and orchestrator APIs. Mount the secret and set " +
      "DIB_GAME_HMAC_SECRET_FILE instead.",
    );
    return undefined;
  }
  if (inline !== undefined) {
    checkSecretStrength(inline, "DIB_GAME_HMAC_SECRET", problems);
    return inline;
  }

  const resolvedPath = secretFile !== undefined
    ? resolve(secretFile)
    : isProduction
      ? undefined
      : repositoryRoot === undefined ? undefined : resolve(repositoryRoot, "hmac.txt");

  if (resolvedPath === undefined) {
    problems.fail(
      "DIB_GAME_HMAC_SECRET_FILE is required: point it at a mounted secret containing at least 32 " +
      "bytes (generate one with `deploy/generate-secret.sh`).",
    );
    return undefined;
  }

  let contents: string;
  try {
    contents = readFileSync(resolvedPath, "utf8").trim();
  } catch (error) {
    problems.fail(
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? `HMAC secret file does not exist: ${resolvedPath}`
        : `HMAC secret file could not be read: ${resolvedPath} (${(error as Error).message})`,
    );
    return undefined;
  }
  if (contents.length === 0) {
    problems.fail(`HMAC secret file is empty: ${resolvedPath}`);
    return undefined;
  }
  checkSecretStrength(contents, `HMAC secret file ${resolvedPath}`, problems);
  checkSecretPermissions(resolvedPath, problems);
  return contents;
}

/**
 * Mirrors the >=32 byte floor the HTTP runtime enforces, but reports it at configuration time so a
 * weak secret is a startup failure rather than a request-time crash.
 */
function checkSecretStrength(secret: string, source: string, problems: ProblemLog): void {
  const bytes = Buffer.byteLength(secret, "utf8");
  if (bytes < 32) {
    problems.fail(`${source} must contain at least 32 bytes; it contains ${bytes}`);
  }
}

function checkSecretPermissions(path: string, problems: ProblemLog): void {
  // Windows does not model POSIX mode bits meaningfully, so the check would be pure noise there.
  if (process.platform === "win32") return;
  try {
    const mode = statSync(path).mode & 0o077;
    if (mode !== 0) {
      problems.warn(
        `HMAC secret file ${path} is readable beyond its owner (mode bits ${mode.toString(8)}). ` +
        `Run \`chmod 600\` on it.`,
      );
    }
  } catch {
    // Already reported by the read above if it matters.
  }
}

function readEnvironment(value: string | undefined, problems: ProblemLog): GameEnvironment {
  if (value === undefined) return "development";
  if (value === "production" || value === "development") return value;
  problems.fail(`DIB_GAME_ENV must be "development" or "production"; got ${JSON.stringify(value)}`);
  return "development";
}

function readPort(value: string | undefined, problems: ProblemLog): number {
  if (value === undefined) return 8788;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    problems.fail(`DIB_GAME_PORT must be an integer between 1 and 65535; got ${JSON.stringify(value)}`);
    return 8788;
  }
  return port;
}

function readLogLevel(value: string | undefined, problems: ProblemLog): LogLevel {
  if (value === undefined) return "info";
  if ((LOG_LEVELS as readonly string[]).includes(value)) return value as LogLevel;
  problems.fail(`DIB_GAME_LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}; got ${JSON.stringify(value)}`);
  return "info";
}

function readPositiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  problems: ProblemLog,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    problems.fail(`${name} must be a positive integer; got ${JSON.stringify(value)}`);
    return fallback;
  }
  return parsed;
}

/** Rates below one per minute are legitimate (registration is throttled to one per five). */
function readPositiveNumber(
  value: string | undefined,
  name: string,
  fallback: number,
  problems: ProblemLog,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    problems.fail(`${name} must be a positive number; got ${JSON.stringify(value)}`);
    return fallback;
  }
  return parsed;
}

function readBoolean(
  value: string | undefined,
  name: string,
  fallback: boolean,
  problems: ProblemLog,
): boolean {
  if (value === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  problems.fail(`${name} must be a boolean (1/0, true/false); got ${JSON.stringify(value)}`);
  return fallback;
}

function readList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
