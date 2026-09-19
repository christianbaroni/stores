import { batchStoreNotifications } from '#store/batchStoreNotifications';

/**
 * Cascade Scheduler
 *
 * - Coalesces derivations into a single microtask.
 * - Derive tasks run by rank; callers own duplicate and stale-rank suppression.
 * - Doesn't retain snapshots or dependency graphs.
 * - Deferred listeners run after all derivations have settled.
 */

// ============ Types ========================================================== //

type Rank = number;
type Task = () => void;

// ============ State ========================================================== //

let active = false;
let flushing = false;
let scheduled = false;

// Deferred listener flushes. A single deferred task needs no queue; callers own
// duplicate suppression through their scheduled/enlisted flags.
let flushTask: Task | undefined;
let flushQueue: Task[] | undefined;
let flushIndex = 0;

// Ranked dirty tasks (per cascade)
const buckets = new Map<Rank, Task[]>();
let taskCount = 0;

// Rank context during the currently executing derive batch
let activeDeriveRank: Rank | null = null;
let minRank = Infinity;

// ============ Public API ===================================================== //

export function isCascadeActive(): boolean {
  return active;
}

/**
 * Rank of the currently running derive batch, or null if not in a batch.
 */
export function getCurrentDeriveRank(): Rank | null {
  return activeDeriveRank;
}

/**
 * Arms the cascade and schedules a single microtask flush.
 */
export function activateCascade(): void {
  if (active) return;
  active = true;

  if (scheduled) return;
  scheduled = true;

  queueMicrotask(() => {
    scheduled = false;
    flushCascade();
  });
}

/**
 * Synchronously drains the active cascade.
 */
export function flushCascade(): void {
  if (!active) return;

  if (flushing) {
    drainCascade();
    return;
  }

  flushing = true;
  try {
    batchStoreNotifications(drainCascade);
  } finally {
    resetCascade();
  }
}

/**
 * Synchronously settles derivations without delivering deferred listeners.
 */
export function settleCascadeDerivations(): void {
  if (!active) return;

  if (flushing) {
    if (activeDeriveRank === null) settleDerivations();
    return;
  }

  flushing = true;
  try {
    settleDerivations();
  } catch (error) {
    resetCascade();
    throw error;
  } finally {
    flushing = false;
    activeDeriveRank = null;
  }
}

/**
 * Enlist a deferred listener flush task.
 */
export function joinCascade(task: Task): void {
  if (!active) return;

  if (flushQueue) {
    flushQueue.push(task);
    return;
  }

  if (!flushTask) {
    flushTask = task;
    return;
  }

  flushQueue = [flushTask, task];
  flushTask = undefined;
}

/**
 * Enqueue a derive task with the given rank.
 * The derived store owns duplicate suppression and stale-rank skips.
 */
export function enqueueDerive(task: Task, rank: Rank): void {
  if (!active) return;

  const r = rank < 0 ? 0 : rank | 0;
  let bucket = buckets.get(r);
  if (!bucket) {
    bucket = [];
    buckets.set(r, bucket);
  }
  bucket.push(task);
  taskCount += 1;
  if (r < minRank) minRank = r;
}

// ============ Internal Methods =============================================== //

function drainCascade(): void {
  while (taskCount > 0 || hasDeferredTasks()) {
    settleDerivations();
    flushDeferredTasks();
  }
}

function settleDerivations(): void {
  // Tasks may enqueue other tasks with higher ranks during execution
  while (taskCount > 0) {
    const r = minRank;
    const batch = buckets.get(r);
    if (!batch) {
      minRank = Infinity;
      for (const k of buckets.keys()) if (k < minRank) minRank = k;
      continue;
    }

    buckets.delete(r);
    taskCount -= batch.length;
    recomputeMinRank();

    activeDeriveRank = r;
    for (let i = 0; i < batch.length; i++) batch[i]();
    activeDeriveRank = null;
  }
}

function recomputeMinRank(): void {
  minRank = Infinity;
  for (const k of buckets.keys()) if (k < minRank) minRank = k;
}

function flushDeferredTasks(): void {
  while (true) {
    const task = flushTask;
    if (task) {
      flushTask = undefined;
      task();
      continue;
    }

    const queue = flushQueue;
    if (!queue) return;

    while (flushIndex < queue.length) queue[flushIndex++]();
    flushQueue = undefined;
    flushIndex = 0;
    return;
  }
}

function resetCascade(): void {
  active = false;
  flushing = false;
  activeDeriveRank = null;
  flushTask = undefined;
  flushQueue = undefined;
  flushIndex = 0;
  buckets.clear();
  taskCount = 0;
  minRank = Infinity;
}

function hasDeferredTasks(): boolean {
  return !!flushTask || !!flushQueue;
}
