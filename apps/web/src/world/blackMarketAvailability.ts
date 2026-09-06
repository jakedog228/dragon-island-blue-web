


export interface BlackMarketAvailability {
  /**
   * Stand-in for the source pair `![Deal isFetching] && [appDelegate newsFullyLoaded]`. The port
   * has no service to fetch from, so the readiness state is a build-time constant rather than a
   * reachability observer.
   */
  readonly serviceReady: boolean;
}

/**
 * The single configuration point. `false` reproduces the source's permanent not-ready branch.
 *
 * Set to `true` for local testing of the screen behind the blocker, or when a future release
 * ships a real destination for this building.
 */
export const BLACK_MARKET_AVAILABILITY: BlackMarketAvailability = Object.freeze({
  serviceReady: false,
});

/** Resolves the configured readiness; anything other than an explicit `true` stays blocked. */
export function blackMarketServiceReady(
  availability: BlackMarketAvailability = BLACK_MARKET_AVAILABILITY,
): boolean {
  return availability.serviceReady === true;
}
