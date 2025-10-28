/**
 * Creates an async microtask-batched scheduler for a given async function.
 *
 * When the returned scheduler is called multiple times synchronously, only a single
 * microtask execution occurs. All callers receive the same Promise that resolves
 * after the batched execution completes. The function will be invoked with the
 * arguments from the most recent call.
 *
 * This is useful for batching rapid successive async operations (e.g., async storage
 * writes, network requests) to reduce unnecessary work while ensuring:
 * - The latest values are used
 * - All callers can await the completion of the batched operation
 *
 * @template Args - The argument types of the async function to schedule
 * @param fn - The async function to schedule for microtask execution
 * @returns A scheduler function that returns a Promise resolving after execution
 *
 * @example
 * ```ts
 * const batchedSave = createAsyncMicrotaskScheduler(async (data: string) => {
 *   await storage.write(data);
 *   console.log('Saved:', data);
 * });
 *
 * await Promise.all([
 *   batchedSave('first'),
 *   batchedSave('second'),
 *   batchedSave('third'),
 * ]);
 * // Writes "third" to storage once, all three Promises resolve together
 * // Logs "Saved: third"
 * ```
 */
export function createAsyncMicrotaskScheduler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void> {
  let latestArgs: Args;
  let pending: Promise<void> | null = null;

  function schedule(...args: Args): Promise<void> {
    latestArgs = args;

    if (!pending) {
      pending = new Promise<void>(resolve => {
        queueMicrotask(async () => {
          try {
            await fn(...latestArgs);
          } finally {
            pending = null;
            resolve();
          }
        });
      });
    }

    return pending;
  }

  return schedule;
}
