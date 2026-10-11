import { noop } from './core';

const RESOLVED_PROMISE = Promise.resolve();

/**
 * Creates an async microtask-batched scheduler for a given async function.
 *
 * When the returned scheduler is called multiple times synchronously, only a single
 * microtask execution occurs. All callers receive the same Promise that resolves
 * after the batched execution completes. The function will be invoked with the
 * arguments from the most recent call.
 *
 * Executions run in order. Calls received during an execution are coalesced into
 * the next batch. A failed execution rejects its batch without stopping later batches.
 *
 * This is useful for batching rapid successive async operations (e.g., async storage
 * writes, network requests) to reduce unnecessary work while ensuring:
 * - The latest values are used
 * - All callers can await the completion of the batched operation
 *
 * @param fn - The async function to schedule for microtask execution
 * @returns A scheduler function that returns a Promise resolving after execution
 *
 * @example
 * ```ts
 * const batchedSave = createAsyncMicrotaskScheduler(storage.setItem);
 *
 * await Promise.all([
 *   batchedSave('counter', { count: 1 }, 0),
 *   batchedSave('counter', { count: 2 }, 0),
 *   batchedSave('counter', { count: 3 }, 0),
 * ]);
 * // Writes { count: 3 } once; all three promises resolve together.
 * ```
 */
export function createAsyncMicrotaskScheduler<Args extends [unknown?, unknown?, unknown?]>(
  fn: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void>;

export function createAsyncMicrotaskScheduler<A, B, C>(fn: (a: A, b: B, c: C) => Promise<void>): (a: A, b: B, c: C) => Promise<void> {
  let latestA: A;
  let latestB: B;
  let latestC: C;
  let pending: Promise<void> | null = null;
  let tail = RESOLVED_PROMISE;

  function flush(): Promise<void> {
    pending = null;
    return fn(latestA, latestB, latestC);
  }

  function schedule(a: A, b: B, c: C): Promise<void> {
    latestA = a;
    latestB = b;
    latestC = c;

    if (!pending) {
      pending = tail.then(flush);
      tail = pending.catch(noop);
    }

    return pending;
  }

  return schedule;
}
