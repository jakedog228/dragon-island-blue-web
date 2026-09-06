import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeLoginToken,
  countInvites,
  createAccount,
  generateLoginToken,
  listInvites,
  loginTokenPlayerId,
  readAccount,
  readAuthorizedPlayerIds,
  revokeInvite,
  updateAccountSettings,
} from "../src/invites.js";

const secret = "test-secret-with-at-least-thirty-two-bytes-long";
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dib-game-invites-"));
  directories.push(directory);
  return directory;
}

describe("authoritative invite registry", () => {
  it("issues, lists, and revokes an invite without storing the raw token", async () => {
    const dataDirectory = await tempDir();
    const token = generateLoginToken();
    const playerId = await authorizeLoginToken({
      dataDirectory,
      hmacSecret: secret,
      token,
      label: "Ada",
      now: () => 1_700_000_000_000,
    });

    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(playerId).toBe(loginTokenPlayerId(secret, token));
    expect(await readAuthorizedPlayerIds(dataDirectory)).toContain(playerId);
    expect(await listInvites(dataDirectory)).toEqual([{
      playerId,
      issuedAt: "2023-11-14T22:13:20.000Z",
      label: "Ada",
    }]);

    expect(await revokeInvite(dataDirectory, playerId)).toBe(true);
    expect(await revokeInvite(dataDirectory, playerId)).toBe(false);
    expect(await readAuthorizedPlayerIds(dataDirectory)).not.toContain(playerId);
  });

  it("fails closed on a malformed registry", async () => {
    const dataDirectory = await tempDir();
    await authorizeLoginToken({
      dataDirectory,
      hmacSecret: secret,
      token: generateLoginToken(),
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dataDirectory, "invites.json"), "{\"schemaVersion\":1,\"invites\":{\"bad\":{}}}");
    await expect(readAuthorizedPlayerIds(dataDirectory)).rejects.toThrow("invite registry is corrupt");
  });
});

describe("self-registered accounts", () => {
  it("mints an account whose token authorizes play and whose raw token is never stored", async () => {
    const dataDirectory = await tempDir();
    const created = await createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "  Ada   Lovelace ",
      publicScoreboard: true,
      maxAccounts: 10,
      now: () => 1_700_000_000_000,
    });

    expect(created.playerId).toBe(loginTokenPlayerId(secret, created.loginToken));
    expect(created.account).toEqual({
      username: "Ada Lovelace",
      publicScoreboard: true,
      createdAt: "2023-11-14T22:13:20.000Z",
    });
    expect(await readAuthorizedPlayerIds(dataDirectory)).toContain(created.playerId);
    expect(await readAccount(dataDirectory, created.playerId)).toEqual(created.account);

    const raw = await readFile(join(dataDirectory, "invites.json"), "utf8");
    expect(raw).not.toContain(created.loginToken);
    expect(raw).toContain("Ada Lovelace");
  });

  it("rejects a username that differs only by case or spacing", async () => {
    const dataDirectory = await tempDir();
    await createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "Ada Lovelace",
      publicScoreboard: false,
      maxAccounts: 10,
    });

    await expect(createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "ada   lovelace",
      publicScoreboard: false,
      maxAccounts: 10,
    })).rejects.toThrow(/already taken/);
    expect(await countInvites(dataDirectory)).toBe(1);
  });

  it("refuses to exceed the account cap", async () => {
    const dataDirectory = await tempDir();
    await createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "first",
      publicScoreboard: false,
      maxAccounts: 1,
    });
    await expect(createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "second",
      publicScoreboard: false,
      maxAccounts: 1,
    })).rejects.toThrow(/account limit/);
    expect(await countInvites(dataDirectory)).toBe(1);
  });

  it("counts the cap in accounts, so operator invites cannot close registration", async () => {
    const dataDirectory = await tempDir();
    // Three operator-issued tokens carry no username, so they own no account and the cap of two
    // is still entirely unspent. Counting rows in the registry instead would already be over it.
    for (let index = 0; index < 3; index += 1) {
      await authorizeLoginToken({
        dataDirectory,
        hmacSecret: secret,
        token: generateLoginToken(),
        label: `operator-${index}`,
      });
    }
    await createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "first",
      publicScoreboard: false,
      maxAccounts: 2,
    });
    await createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "second",
      publicScoreboard: false,
      maxAccounts: 2,
    });
    expect(await countInvites(dataDirectory)).toBe(5);

    await expect(createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "third",
      publicScoreboard: false,
      maxAccounts: 2,
    })).rejects.toThrow(/account limit/);
  });

  it("applies the same username rule to the operator path as to registration", async () => {
    const dataDirectory = await tempDir();
    const rejected = ["a", "ab!", "a".repeat(17), "Ada--Lovelace", "-Ada", "Ada_"];
    for (const username of rejected) {
      // The CLI never passes through the request schema, and these names become publicly visible
      // on the scoreboard, so the registry has to hold the line itself.
      await expect(authorizeLoginToken({
        dataDirectory,
        hmacSecret: secret,
        token: generateLoginToken(),
        username,
      })).rejects.toThrow(/usernames are/);
      await expect(createAccount({
        dataDirectory,
        hmacSecret: secret,
        username,
        publicScoreboard: false,
        maxAccounts: 10,
      })).rejects.toThrow(/usernames are/);
    }
    // Nothing durable was written by any of them.
    expect(await countInvites(dataDirectory)).toBe(0);

    // The trailing space is normalized away rather than rejected, on both paths.
    const playerId = await authorizeLoginToken({
      dataDirectory,
      hmacSecret: secret,
      token: generateLoginToken(),
      username: " Ada  Lovelace ",
    });
    expect((await readAccount(dataDirectory, playerId))?.username).toBe("Ada Lovelace");
  });

  it("keeps every entry when two processes write the registry at once", async () => {
    const dataDirectory = await tempDir();
    // A second module instance has its own `writeQueues`, which is exactly what a separately
    // launched `invite` CLI has. Only the on-disk lock is shared, so this is the case the
    // in-process queue alone cannot cover.
    vi.resetModules();
    const other = await import("../src/invites.js");
    expect(other.createAccount).not.toBe(createAccount);

    const created = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) => {
        const create = index % 2 === 0 ? createAccount : other.createAccount;
        return create({
          dataDirectory,
          hmacSecret: secret,
          username: `player-${index}`,
          publicScoreboard: false,
          maxAccounts: 100,
        });
      }),
    );

    expect(await countInvites(dataDirectory)).toBe(10);
    const authorized = await readAuthorizedPlayerIds(dataDirectory);
    for (const account of created) expect(authorized).toContain(account.playerId);
  });

  it("round-trips the scoreboard setting and refuses accountless tokens", async () => {
    const dataDirectory = await tempDir();
    const created = await createAccount({
      dataDirectory,
      hmacSecret: secret,
      username: "Ada",
      publicScoreboard: true,
      maxAccounts: 10,
    });

    const updated = await updateAccountSettings(dataDirectory, created.playerId, {
      publicScoreboard: false,
    });
    expect(updated.publicScoreboard).toBe(false);
    expect(updated.createdAt).toBe(created.account.createdAt);
    expect((await readAccount(dataDirectory, created.playerId))?.publicScoreboard).toBe(false);

    const operatorId = await authorizeLoginToken({
      dataDirectory,
      hmacSecret: secret,
      token: generateLoginToken(),
      label: "operator",
    });
    expect(await readAccount(dataDirectory, operatorId)).toBeUndefined();
    await expect(updateAccountSettings(dataDirectory, operatorId, { publicScoreboard: true }))
      .rejects.toThrow("this login token has no account");
  });

  it("keeps every entry when registrations land concurrently", async () => {
    const dataDirectory = await tempDir();
    const created = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        createAccount({
          dataDirectory,
          hmacSecret: secret,
          username: `player-${index}`,
          publicScoreboard: index % 2 === 0,
          maxAccounts: 100,
        })),
    );

    expect(await countInvites(dataDirectory)).toBe(12);
    const authorized = await readAuthorizedPlayerIds(dataDirectory);
    for (const account of created) expect(authorized).toContain(account.playerId);
  });

  it("lets a concurrent batch race for one username without losing the winner", async () => {
    const dataDirectory = await tempDir();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        createAccount({
          dataDirectory,
          hmacSecret: secret,
          username: "contested",
          publicScoreboard: false,
          maxAccounts: 100,
        })),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await countInvites(dataDirectory)).toBe(1);
  });
});
