/**
 * Invoke a route handler exactly once while normalizing synchronous throws and asynchronous
 * rejections onto the same recovery path.
 */
export function dispatchTransition(
  invoke: () => void | Promise<void>,
  recover: (error: unknown) => void,
): void {
  let pending: void | Promise<void>;
  try {
    pending = invoke();
  } catch (error) {
    recover(error);
    return;
  }
  void Promise.resolve(pending).catch(recover);
}
