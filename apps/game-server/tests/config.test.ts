import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ConfigurationError,
  loadDataDirectory,
  loadGameServerConfig,
  loadHmacSecret,
} from "../src/config.js";

/**
 * Configuration is the only layer between an operator's environment and an authoritative service
 * holding the sole copy of player state, so its refusals are load-bearing behaviour, not
 * defensive decoration. Each of these tests pins a refusal that would otherwise degrade silently:
 * a production boot that invents a state directory, an inline secret visible to `docker inspect`,
 * a secret too short to be worth signing with.
 */

const scratchRoots: string[] = [];

function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "dib-config-"));
  scratchRoots.push(directory);
  return directory;
}

afterAll(() => {
  for (const directory of scratchRoots) rmSync(directory, { recursive: true, force: true });
});

const STRONG_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

interface Fixture {
  readonly repositoryRoot: string;
  readonly secretFile: string;
  readonly extractedData: string;
  readonly dataDirectory: string;
}

function fixture(secret = STRONG_SECRET): Fixture {
  const root = scratch();
  const secretFile = join(root, "hmac.txt");
  writeFileSync(secretFile, secret, "utf8");
  // Deliberately NOT created: `extracted/data` only exists once a test asks for it, so the
  // missing-mount case is the default rather than something a test has to arrange.
  const extractedData = join(root, "extracted", "data");
  const dataDirectory = join(root, "state");
  return { repositoryRoot: root, secretFile, extractedData, dataDirectory };
}

function makeExtractedData(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function problemsOf(load: () => unknown): readonly string[] {
  try {
    load();
  } catch (error) {
    if (error instanceof ConfigurationError) return error.problems;
    throw error;
  }
  throw new Error("expected configuration to be rejected, but it loaded");
}

describe("loadGameServerConfig", () => {
  it("loads a complete production environment", () => {
    const paths = fixture();
    makeExtractedData(paths.extractedData);
    const config = loadGameServerConfig({
      environment: {
        DIB_GAME_ENV: "production",
        DIB_GAME_PORT: "9001",
        DIB_GAME_BIND_HOST: "0.0.0.0",
        DIB_GAME_TRUST_PROXY: "1",
        DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
        DIB_GAME_DATA_DIR: paths.dataDirectory,
        DIB_GAME_EXTRACTED_DATA: paths.extractedData,
      },
    });

    expect(config.environment).toBe("production");
    expect(config.port).toBe(9001);
    expect(config.bindHost).toBe("0.0.0.0");
    expect(config.trustProxy).toBe(true);
    expect(config.hmacSecret).toBe(STRONG_SECRET);
    expect(config.warnings).toEqual([]);
    // Defaults still apply for anything the operator did not state.
    expect(config.logLevel).toBe("info");
    expect(config.shutdownGraceMs).toBe(15_000);
    expect(config.sessionRateLimit).toEqual({ perMinute: 20, burst: 10 });
    // Self-registration ships open at one account per five minutes; 0.2/min is the only way to
    // say that with a token bucket, so it must survive a config layer that elsewhere wants integers.
    expect(config.registrationEnabled).toBe(true);
    expect(config.registrationRateLimit).toEqual({ perMinute: 0.2, burst: 1 });
    expect(config.maxAccounts).toBe(10_000);
    // Far looser than registration: the board reads no body, is served from a shared cache, and a
    // player reopening the menu must never trip it. The limiter is there to bound a scraper.
    expect(config.scoreboardRateLimit).toEqual({ perMinute: 60, burst: 20 });
  });

  it("accepts fractional and disabled registration overrides", () => {
    const paths = fixture();
    makeExtractedData(paths.extractedData);
    const config = loadGameServerConfig({
      environment: {
        DIB_GAME_ENV: "production",
        DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
        DIB_GAME_DATA_DIR: paths.dataDirectory,
        DIB_GAME_EXTRACTED_DATA: paths.extractedData,
        DIB_GAME_REGISTRATION_ENABLED: "0",
        DIB_GAME_REGISTRATION_RATE_PER_MINUTE: "0.05",
        DIB_GAME_REGISTRATION_RATE_BURST: "2",
        DIB_GAME_MAX_ACCOUNTS: "25",
        DIB_GAME_SCOREBOARD_RATE_PER_MINUTE: "6",
        DIB_GAME_SCOREBOARD_RATE_BURST: "3",
      },
    });
    expect(config.registrationEnabled).toBe(false);
    expect(config.registrationRateLimit).toEqual({ perMinute: 0.05, burst: 2 });
    expect(config.maxAccounts).toBe(25);
    expect(config.scoreboardRateLimit).toEqual({ perMinute: 6, burst: 3 });
  });

  it("refuses a non-positive registration rate rather than opening the floodgate", () => {
    const paths = fixture();
    makeExtractedData(paths.extractedData);
    const problems = problemsOf(() =>
      loadGameServerConfig({
        environment: {
          DIB_GAME_ENV: "production",
          DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
          DIB_GAME_DATA_DIR: paths.dataDirectory,
          DIB_GAME_EXTRACTED_DATA: paths.extractedData,
          DIB_GAME_REGISTRATION_RATE_PER_MINUTE: "0",
          DIB_GAME_MAX_ACCOUNTS: "0",
        },
      }));
    expect(problems.join("\n")).toContain("DIB_GAME_REGISTRATION_RATE_PER_MINUTE");
    expect(problems.join("\n")).toContain("DIB_GAME_MAX_ACCOUNTS");
  });

  it("reports every problem at once rather than failing on the first", () => {
    const problems = problemsOf(() =>
      loadGameServerConfig({
        environment: {
          DIB_GAME_ENV: "staging",
          DIB_GAME_PORT: "not-a-port",
          DIB_GAME_LOG_LEVEL: "chatty",
          DIB_GAME_TRUST_PROXY: "maybe",
        },
      }));

    // One restart should tell the operator everything, not send them round the loop five times.
    expect(problems.length).toBeGreaterThanOrEqual(5);
    expect(problems.join("\n")).toContain("DIB_GAME_ENV");
    expect(problems.join("\n")).toContain("DIB_GAME_PORT");
    expect(problems.join("\n")).toContain("DIB_GAME_LOG_LEVEL");
    expect(problems.join("\n")).toContain("DIB_GAME_TRUST_PROXY");
  });

  describe("the relocated-bundle trap", () => {
    it("refuses to invent paths in production even when a repository root is available", () => {
      const paths = fixture();
      const problems = problemsOf(() =>
        loadGameServerConfig({
          repositoryRoot: paths.repositoryRoot,
          environment: {
            DIB_GAME_ENV: "production",
            DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
          },
        }));

      // The bundle runs from dist/ or from a container; a repo-relative default there points at a
      // directory that is not the deployment's state, and the failure would be silent data loss.
      expect(problems.join("\n")).toContain("DIB_GAME_DATA_DIR is required");
      expect(problems.join("\n")).toContain("DIB_GAME_EXTRACTED_DATA is required");
    });

    it("falls back to repository-relative paths in development", () => {
      const paths = fixture();
      makeExtractedData(join(paths.repositoryRoot, "extracted", "data"));
      const config = loadGameServerConfig({
        repositoryRoot: paths.repositoryRoot,
        environment: {},
      });

      expect(config.environment).toBe("development");
      expect(config.dataDirectory).toBe(join(paths.repositoryRoot, ".dib-game-data"));
      expect(config.hmacSecret).toBe(STRONG_SECRET);
    });

    it("refuses to boot with no repository root and no explicit paths", () => {
      const problems = problemsOf(() => loadGameServerConfig({ environment: {} }));
      expect(problems.join("\n")).toContain("no repository root is available");
    });
  });

  describe("secret handling", () => {
    it("rejects an inline secret in production", () => {
      const paths = fixture();
      makeExtractedData(paths.extractedData);
      const problems = problemsOf(() =>
        loadGameServerConfig({
          environment: {
            DIB_GAME_ENV: "production",
            DIB_GAME_HMAC_SECRET: STRONG_SECRET,
            DIB_GAME_DATA_DIR: paths.dataDirectory,
            DIB_GAME_EXTRACTED_DATA: paths.extractedData,
          },
        }));

      const text = problems.join("\n");
      expect(text).toContain("DIB_GAME_HMAC_SECRET must not be used");
      // The reason has to travel with the refusal, or the operator "fixes" it by unsetting
      // production instead of mounting a file.
      expect(text).toContain("docker inspect");
    });

    it("accepts an inline secret in development", () => {
      const paths = fixture();
      makeExtractedData(paths.extractedData);
      const config = loadGameServerConfig({
        environment: {
          DIB_GAME_HMAC_SECRET: STRONG_SECRET,
          DIB_GAME_DATA_DIR: paths.dataDirectory,
          DIB_GAME_EXTRACTED_DATA: paths.extractedData,
        },
      });
      expect(config.hmacSecret).toBe(STRONG_SECRET);
    });

    it("rejects a secret under 32 bytes", () => {
      const paths = fixture("too-short");
      makeExtractedData(paths.extractedData);
      const problems = problemsOf(() =>
        loadGameServerConfig({
          environment: {
            DIB_GAME_ENV: "production",
            DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
            DIB_GAME_DATA_DIR: paths.dataDirectory,
            DIB_GAME_EXTRACTED_DATA: paths.extractedData,
          },
        }));
      expect(problems.join("\n")).toMatch(/at least 32 bytes; it contains 9/);
    });

    it("names the missing file rather than reporting a generic failure", () => {
      const paths = fixture();
      makeExtractedData(paths.extractedData);
      const missing = join(paths.repositoryRoot, "absent-secret");
      const problems = problemsOf(() =>
        loadGameServerConfig({
          environment: {
            DIB_GAME_ENV: "production",
            DIB_GAME_HMAC_SECRET_FILE: missing,
            DIB_GAME_DATA_DIR: paths.dataDirectory,
            DIB_GAME_EXTRACTED_DATA: paths.extractedData,
          },
        }));
      expect(problems.join("\n")).toContain(missing);
    });
  });

  describe("origins", () => {
    it("requires https origins in production", () => {
      const paths = fixture();
      makeExtractedData(paths.extractedData);
      const problems = problemsOf(() =>
        loadGameServerConfig({
          environment: {
            DIB_GAME_ENV: "production",
            DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
            DIB_GAME_DATA_DIR: paths.dataDirectory,
            DIB_GAME_EXTRACTED_DATA: paths.extractedData,
            DIB_GAME_ALLOWED_ORIGINS: "http://play.example.com",
          },
        }));
      expect(problems.join("\n")).toContain("must use https in production");
    });

    it("rejects an origin carrying a path", () => {
      const paths = fixture();
      makeExtractedData(paths.extractedData);
      const problems = problemsOf(() =>
        loadGameServerConfig({
          environment: {
            DIB_GAME_ENV: "production",
            DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
            DIB_GAME_DATA_DIR: paths.dataDirectory,
            DIB_GAME_EXTRACTED_DATA: paths.extractedData,
            DIB_GAME_ALLOWED_ORIGINS: "https://play.example.com/game",
          },
        }));
      // A path-bearing entry never matches the browser's Origin header, so it would silently
      // allow nothing while looking configured.
      expect(problems.join("\n")).toContain("bare scheme://host");
    });
  });

  it("warns, without failing, when a public bind trusts no proxy", () => {
    const paths = fixture();
    makeExtractedData(paths.extractedData);
    const config = loadGameServerConfig({
      environment: {
        DIB_GAME_ENV: "production",
        DIB_GAME_BIND_HOST: "0.0.0.0",
        DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
        DIB_GAME_DATA_DIR: paths.dataDirectory,
        DIB_GAME_EXTRACTED_DATA: paths.extractedData,
      },
    });
    expect(config.warnings.join("\n")).toContain("DIB_GAME_TRUST_PROXY");
  });

  it("fails when the extracted resource mount is absent", () => {
    const paths = fixture();
    const problems = problemsOf(() =>
      loadGameServerConfig({
        environment: {
          DIB_GAME_ENV: "production",
          DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
          DIB_GAME_DATA_DIR: paths.dataDirectory,
          DIB_GAME_EXTRACTED_DATA: paths.extractedData,
        },
      }));
    // The most common first-deploy mistake is a bind mount typo; it must not look like a code bug.
    expect(problems.join("\n")).toContain("does not point at a directory");
  });
});

describe("CLI helpers", () => {
  it("loadHmacSecret shares the production refusals", () => {
    expect(() => loadHmacSecret({ environment: { DIB_GAME_ENV: "production" } }))
      .toThrow(ConfigurationError);
  });

  it("loadDataDirectory agrees with loadGameServerConfig", () => {
    const paths = fixture();
    makeExtractedData(paths.extractedData);
    const config = loadGameServerConfig({
      environment: {
        DIB_GAME_ENV: "production",
        DIB_GAME_HMAC_SECRET_FILE: paths.secretFile,
        DIB_GAME_DATA_DIR: paths.dataDirectory,
        DIB_GAME_EXTRACTED_DATA: paths.extractedData,
      },
    });
    const viaCli = loadDataDirectory({
      environment: { DIB_GAME_ENV: "production", DIB_GAME_DATA_DIR: paths.dataDirectory },
    });
    // `invite` and `serve` disagreeing about this path means invites are written where the server
    // will never look for them.
    expect(viaCli).toBe(config.dataDirectory);
  });

  it("loadDataDirectory refuses a production default", () => {
    const paths = fixture();
    expect(() => loadDataDirectory({
      repositoryRoot: paths.repositoryRoot,
      environment: { DIB_GAME_ENV: "production" },
    })).toThrow(/DIB_GAME_DATA_DIR is required/);
  });
});
