export type OnlineServerStatus = "checking" | "available" | "unavailable";

/** A missing API (including a static host's HTML fallback) must never block Offline boot. */
export async function probeOnlineServer(): Promise<OnlineServerStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch("/api/game/readiness", {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return "unavailable";
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return "unavailable";
    const readiness = body as Record<string, unknown>;
    return readiness["ready"] === true &&
      Array.isArray(readiness["installedLogicPackIds"]) &&
      readiness["installedLogicPackIds"].length > 0 &&
      readiness["installedLogicPackIds"].every((id: unknown) => typeof id === "string")
      ? "available" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}
