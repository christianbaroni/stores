/**
 * Creates a microtask-batched scheduler for a given function.
 *
 * When the returned scheduler is called multiple times synchronously, only a single
 * microtask execution occurs. The function will be invoked with the arguments from
 * the most recent call.
 *
 * This is useful for batching rapid successive calls (e.g., state updates, change
 * handlers) to reduce unnecessary work while ensuring the latest values are used.
 *
 * @template TArgs - The argument types of the function to schedule
 * @param fn - The function to schedule for microtask execution
 * @returns A scheduler function with the same signature as the input function
 *
 * @example
 * ```ts
 * const batchedUpdate = createMicrotaskScheduler((value: number) => {
 *   console.log('Updated:', value);
 * });
 *
 * batchedUpdate(1);
 * batchedUpdate(2);
 * batchedUpdate(3);
 * // Logs "Updated: 3" once in the next microtask
 * ```
 */
export function createMicrotaskScheduler<Args extends unknown[]>(fn: (...args: Args) => void): (...args: Args) => void {
  let isScheduled = false;
  let latestArgs: Args;

  function schedule(...args: Args): void {
    latestArgs = args;
    if (isScheduled) return;
    isScheduled = true;
    queueMicrotask(() => {
      isScheduled = false;
      fn(...latestArgs);
    });
  }

  return schedule;
}
