import { batchStoreNotifications } from '#store/batchStoreNotifications';

/**
 * Cascade Scheduler
 *
 * - Coalesces derivations into a single microtask.
 * - Tasks run once at their maximum rank via a ranked dirty queue.
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

// Deferred listener flushes (one stable task per store)
const flushQueue = new Set<Task>();

// Ranked dirty tasks (per cascade)
const taskRank = new Map<Task, Rank>();
const buckets = new Map<Rank, Set<Task>>();

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
  flushQueue.add(task);
}

/**
 * Enqueue (or upgrade) a derive task with the given rank.
 * If the task is already present, its rank is upgraded and it is run later.
 */
export function enqueueDerive(task: Task, rank: Rank): void {
  if (!active) return;

  const r = rank < 0 ? 0 : rank | 0;
  const existing = taskRank.get(task);

  if (existing === undefined) {
    taskRank.set(task, r);
    let set = buckets.get(r);
    if (!set) {
      set = new Set<Task>();
      buckets.set(r, set);
    }
    set.add(task);
    if (r < minRank) minRank = r;
    return;
  }

  // Upgrade rank if needed
  if (r > existing) {
    const oldBucket = buckets.get(existing);
    if (oldBucket) {
      oldBucket.delete(task);
      if (oldBucket.size === 0) {
        buckets.delete(existing);
        if (existing === minRank) {
          // Recompute minRank; small cardinality, cheap
          minRank = Infinity;
          for (const k of buckets.keys()) if (k < minRank) minRank = k;
        }
      }
    }
    taskRank.set(task, r);
    let newBucket = buckets.get(r);
    if (!newBucket) {
      newBucket = new Set<Task>();
      buckets.set(r, newBucket);
    }
    newBucket.add(task);
    if (r < minRank) minRank = r;
  }
}

// ============ Internal Methods =============================================== //

function drainCascade(): void {
  while (taskRank.size > 0 || flushQueue.size > 0) {
    settleDerivations();
    flushDeferredTasks();
  }
}

function settleDerivations(): void {
  // Tasks may enqueue/upgrade other tasks with higher ranks during execution
  while (taskRank.size > 0) {
    const r = minRank;
    const batch = buckets.get(r);
    if (!batch) {
      minRank = Infinity;
      for (const k of buckets.keys()) if (k < minRank) minRank = k;
      continue;
    }

    buckets.delete(r);
    for (const task of batch) taskRank.delete(task);

    activeDeriveRank = r;
    for (const task of batch) task();
    activeDeriveRank = null;

    minRank = Infinity;
    for (const k of buckets.keys()) if (k < minRank) minRank = k;
  }
}

function flushDeferredTasks(): void {
  for (const task of flushQueue) {
    flushQueue.delete(task);
    task();
  }
}

function resetCascade(): void {
  active = false;
  flushing = false;
  activeDeriveRank = null;
  flushQueue.clear();
  taskRank.clear();
  buckets.clear();
  minRank = Infinity;
}
