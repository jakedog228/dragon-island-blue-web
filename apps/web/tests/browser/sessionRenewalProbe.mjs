// Isolated transport fault injection: shorten only the browser-visible expiry metadata.
// Tokens, server TTL, committed projections, and commands remain real and unmodified.
import assert from "node:assert/strict";

export async function installSessionRenewalProbe(page, { pvp = false } = {}) {
  let sessions = 0, latestToken;
  const requests = [];
  await page.route("**/api/game/session", async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200, "Session renewal failed");
    const body = await response.json();
    sessions++;
    latestToken = body.token;
    if (sessions === 2) await new Promise(resolve => setTimeout(resolve, 300));
    // PvP polls continuously. Expire the first three sessions, then restore the real lifetime;
    // the probe must exercise renewal without intentionally exhausting login throttling.
    const expiresAt = !pvp || sessions <= 3 ? new Date(Date.now() - 1).toISOString() : body.expiresAt;
    await route.fulfill({ response, json: { ...body, expiresAt } });
  });
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if ((!pathname.startsWith("/api/game/") && !pathname.startsWith("/api/pvp/")) || pathname.endsWith("/session") ||
        !request.headers().authorization) return;
    requests.push({ pathname, sessions, usesLatestToken: request.headers().authorization === `Bearer ${latestToken}`,
      command: pathname.startsWith("/api/game/") && pathname.endsWith("/commands") ? request.postDataJSON().command.type : undefined });
  });
  return () => {
    assert(sessions >= 3, "Expired client metadata did not trigger repeated renewal");
    assert(requests.length > 0 && requests.every(request => request.sessions >= 2 && request.usesLatestToken),
      "Protected requests bypassed proactive renewal");
    assert(requests.some(request => pvp ? request.pathname.startsWith("/api/pvp/") && request.sessions >= 3 : request.command === "world.useDirectTownReturn"),
      "No expected gameplay request exercised renewal");
    return { faultInjection: "browser-visible expiry metadata only; real server tokens and TTL unchanged", sessions, requests };
  };
}
