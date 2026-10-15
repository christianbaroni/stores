import { noop } from './core';

const RESOLVED_PROMISE = Promise.resolve();

/**
 * Batches calls to an async function in microtasks, using the latest arguments.
 * Executions run sequentially; calls made during execution form the next batch.
 *
 * Calls in a batch share its completion promise. A failed execution rejects
 * that promise without preventing later batches from running.
 */
export function createAsyncMicrotaskScheduler<Args extends [unknown?, unknown?, unknown?]>(
  fn: (...args: Args) => Promise<void>
): (...args: Args) => Promise<void>;

export function createAsyncMicrotaskScheduler<A, B, C>(fn: (a: A, b: B, c: C) => Promise<void>): (a: A, b: B, c: C) => Promise<void> {
  let argA: A;
  let argB: B;
  let argC: C;

  let pending: Promise<void> | null = null;
  let tail = RESOLVED_PROMISE;

  function flush(): Promise<void> {
    pending = null;
    return fn(argA, argB, argC);
  }

  function schedule(a: A, b: B, c: C): Promise<void> {
    argA = a;
    argB = b;
    argC = c;

    if (!pending) {
      pending = tail.then(flush);
      tail = pending.catch(noop);
    }

    return pending;
  }

  return schedule;
}
