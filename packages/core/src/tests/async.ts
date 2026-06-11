/**
 * Waits until a new timer task runs.
 */
export async function flushMacrotask(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Waits for microtasks queued in the current task.
 *
 * @param times - Number of chained microtask waits.
 */
export async function flushMicrotasks(times = 1): Promise<void> {
  if (times === 1) return Promise.resolve();
  let promise = Promise.resolve();
  for (let i = 0; i < times; i++) promise = promise.then(() => Promise.resolve());
  await promise;
}
