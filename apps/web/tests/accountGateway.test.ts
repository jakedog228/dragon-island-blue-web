import { describe, expect, it } from "vitest";
import type { AccountSummaryV1 } from "@dib/game-protocol";
import { AccountGateway, type AccountSettingsClient } from "../src/authority/accountGateway.js";

/**
 * The Options popup writes this setting through a synchronous `select()` callback, so the gateway is
 * what makes a server-owned value editable from a Pixi row: it paints the new value immediately and
 * has to put the old one back — loudly — when the authority refuses.
 */

const account = (publicScoreboard: boolean): AccountSummaryV1 => ({
  username: "Ada",
  publicScoreboard,
  createdAt: "2023-11-14T22:13:20.000Z",
});

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function recordingClient(behaviour: {
  update?: (patch: { readonly publicScoreboard: boolean }) => Promise<AccountSummaryV1>;
  fetch?: () => Promise<AccountSummaryV1>;
} = {}) {
  const writes: boolean[] = [];
  const client: AccountSettingsClient = {
    fetchAccount: behaviour.fetch ?? (async () => account(false)),
    updateAccountSettings: async (patch) => {
      writes.push(patch.publicScoreboard);
      return behaviour.update === undefined ? account(patch.publicScoreboard) : behaviour.update(patch);
    },
  };
  return { client, writes };
}

describe("AccountGateway", () => {
  it("shows the new value before the server answers, then keeps what it confirmed", async () => {
    const { client, writes } = recordingClient();
    const seen: Array<boolean | undefined> = [];
    const gateway = new AccountGateway({ client, initial: account(false) });
    gateway.onChange(() => { seen.push(gateway.current()?.publicScoreboard); });

    const write = gateway.setPublicScoreboard(true);
    // Painted before the request settles: the row must not lag a network round trip behind the tap.
    expect(gateway.current()?.publicScoreboard).toBe(true);
    await write;

    expect(writes).toEqual([true]);
    expect(gateway.current()?.publicScoreboard).toBe(true);
    expect(seen).toEqual([true, true]);
  });

  it("reverts to the last confirmed value and reports the failure", async () => {
    const failure = new Error("the authority said no");
    const { client } = recordingClient({ update: () => Promise.reject(failure) });
    const errors: unknown[] = [];
    const gateway = new AccountGateway({
      client,
      initial: account(false),
      onError: (error) => { errors.push(error); },
    });

    await gateway.setPublicScoreboard(true);

    expect(gateway.current()?.publicScoreboard).toBe(false);
    // Reverting silently would leave the player believing a setting they do not have.
    expect(errors).toEqual([failure]);
  });

  it("serializes concurrent toggles so the server sees the click order", async () => {
    const gates: Array<() => void> = [];
    const { client, writes } = recordingClient({
      update: (patch) =>
        new Promise((resolvePromise) => {
          gates.push(() => { resolvePromise(account(patch.publicScoreboard)); });
        }),
    });
    const gateway = new AccountGateway({ client, initial: account(false) });

    const first = gateway.setPublicScoreboard(true);
    const second = gateway.setPublicScoreboard(false);
    await flush();
    // The second toggle is queued behind the first rather than racing it to the registry.
    expect(writes).toEqual([true]);
    gates[0]?.();
    await first;
    await flush();
    gates[1]?.();
    await second;

    expect(writes).toEqual([true, false]);
    expect(gateway.current()?.publicScoreboard).toBe(false);
  });

  it("skips the round trip when the value already matches", async () => {
    const { client, writes } = recordingClient();
    const gateway = new AccountGateway({ client, initial: account(true) });
    await gateway.setPublicScoreboard(true);
    expect(writes).toEqual([]);
  });

  it("refuses to write when no account is loaded", () => {
    const { client } = recordingClient();
    const gateway = new AccountGateway({ client });
    expect(gateway.current()).toBeUndefined();
    expect(() => gateway.setPublicScoreboard(true)).toThrow(/no account is loaded/);
  });

  it("stops notifying a released listener, however many times it is released", async () => {
    const { client } = recordingClient();
    const gateway = new AccountGateway({ client, initial: account(false) });
    const seen: string[] = [];
    const release = gateway.onChange(() => { seen.push("panel"); });
    gateway.onChange(() => { seen.push("other"); });

    await gateway.setPublicScoreboard(true);
    expect(seen).toEqual(["panel", "other", "panel", "other"]);

    // The gateway outlives any one Options panel, so a panel that closed without releasing would
    // keep its destroyed Pixi rows repainting for the rest of the session.
    release();
    // Every teardown path may call it, and a double release must not disturb the other listener.
    release();
    await gateway.setPublicScoreboard(false);
    expect(seen).toEqual(["panel", "other", "panel", "other", "other", "other"]);
  });

  it("still notifies the survivors when a listener releases itself mid-notification", async () => {
    const { client } = recordingClient();
    const gateway = new AccountGateway({ client, initial: account(false) });
    const seen: string[] = [];
    // A rollback can land while the panel is being dismissed, so the first listener to run may be
    // the one tearing everything down.
    const release: Array<() => void> = [];
    release.push(gateway.onChange(() => {
      seen.push("first");
      release[0]?.();
    }));
    gateway.onChange(() => { seen.push("second"); });

    await gateway.setPublicScoreboard(true);
    expect(seen).toEqual(["first", "second", "second"]);
  });

  it("adopts the account a refresh returns", async () => {
    const { client } = recordingClient({ fetch: async () => account(true) });
    const gateway = new AccountGateway({ client });
    expect(await gateway.refresh()).toEqual(account(true));
    expect(gateway.current()?.publicScoreboard).toBe(true);

    // A later rejected write falls back to what the refresh confirmed, not to "no account".
    const rejecting = new AccountGateway({
      client: {
        fetchAccount: async () => account(true),
        updateAccountSettings: () => Promise.reject(new Error("nope")),
      },
    });
    await rejecting.refresh();
    await rejecting.setPublicScoreboard(false);
    expect(rejecting.current()?.publicScoreboard).toBe(true);
  });
});
