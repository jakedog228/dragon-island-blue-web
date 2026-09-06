/** A category-3 Store mount resolves immediately; its nested promise owns the Store close edge. */
export interface GoldStoreHandoff {
  readonly closed: Promise<void>;
}

export type OpenGoldStoreHandoff = () => Promise<GoldStoreHandoff>;













export async function runInsufficientFundsStoreHandoff(options: {
  readonly openStore: OpenGoldStoreHandoff;
  readonly presentCannotAfford: () => void | Promise<void>;
  readonly resume: () => void | Promise<void>;
}): Promise<void> {
  const store = await options.openStore();
  await options.presentCannotAfford();
  await store.closed;
  await options.resume();
}
