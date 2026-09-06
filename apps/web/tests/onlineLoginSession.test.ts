import { describe, expect, it, vi } from "vitest";
import { OnlineLoginSession } from "../src/content/onlineLoginSession.js";

interface TestAuthority {
  readonly name: string;
  close(): Promise<void>;
}

function authority(name: string): TestAuthority & { readonly close: ReturnType<typeof vi.fn> } {
  return {
    name,
    close: vi.fn(async () => {}),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  return { promise, resolve, reject };
}

describe("OnlineLoginSession", () => {
  it("makes a successful authority claimable exactly once for the matching credentials", async () => {
    const signedIn = authority("Ada");
    const session = new OnlineLoginSession(async () => signedIn);

    expect(await session.authenticate("archive-a\0token-a")).toEqual({
      phase: "authenticated",
      key: "archive-a\0token-a",
      authority: signedIn,
    });
    expect(session.claim("archive-a\0token-b")).toBeUndefined();
    expect(session.claim("archive-a\0token-a")).toBe(signedIn);
    expect(session.claim("archive-a\0token-a")).toBeUndefined();
    expect(session.snapshot()).toEqual({ phase: "idle" });
    expect(signedIn.close).not.toHaveBeenCalled();
  });

  it("closes an authenticated authority when credentials are invalidated", async () => {
    const signedIn = authority("Ada");
    const session = new OnlineLoginSession(async () => signedIn);
    await session.authenticate("archive-a\0token-a");

    await session.invalidate();

    expect(session.snapshot()).toEqual({ phase: "idle" });
    expect(signedIn.close).toHaveBeenCalledOnce();
  });

  it("retains an authentication error for inline presentation", async () => {
    const failure = new Error("login token is invalid or revoked");
    const session = new OnlineLoginSession<TestAuthority>(async () => {
      throw failure;
    });

    expect(await session.authenticate("archive-a\0bad-token")).toEqual({
      phase: "error",
      key: "archive-a\0bad-token",
      error: failure,
    });
    expect(session.snapshot()).toEqual({
      phase: "error",
      key: "archive-a\0bad-token",
      error: failure,
    });
  });

  it("closes a stale authority when a newer login finishes first", async () => {
    const firstAttempt = deferred<TestAuthority>();
    const secondAttempt = deferred<TestAuthority>();
    const stale = authority("Stale");
    const current = authority("Current");
    const session = new OnlineLoginSession((key) =>
      key.endsWith("token-a") ? firstAttempt.promise : secondAttempt.promise
    );

    const firstResult = session.authenticate("archive-a\0token-a");
    const secondResult = session.authenticate("archive-a\0token-b");
    secondAttempt.resolve(current);
    await secondResult;
    firstAttempt.resolve(stale);
    await firstResult;

    expect(stale.close).toHaveBeenCalledOnce();
    expect(current.close).not.toHaveBeenCalled();
    expect(session.snapshot()).toEqual({
      phase: "authenticated",
      key: "archive-a\0token-b",
      authority: current,
    });
  });
});
