import { unstable_batchedUpdates } from '@/env';

type Rank = number;
type StoreId = string;
type Task = () => void;

/**
 * Global cascade scheduler
 *
 * - Coalesces derivations into a single microtask.
 * - Uses a ranked dirty-queue: tasks run once at their maximum rank.
 * - Delivers component notifications after the graph settles.
 *
 * No retained snapshots, no dependency graphs; two small Sets/Maps per wave.
 */
let active = false;
let scheduled = false;

// Component flushes (per-store, idempotent)
const flushQueue: Map<StoreId, Task> = new Map();

// Ranked dirty tasks (per cascade)
const taskRank = new Map<Task, Rank>();
const buckets = new Map<Rank, Set<Task>>();

// Rank context during the currently executing derive batch
let activeDeriveRank: Rank | null = null;
let minRank = Infinity;

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

    unstable_batchedUpdates(() => {
      // 1) Settle all derivations in ascending-rank waves to a fixed point.
      // Tasks may enqueue/upgrade other tasks with higher ranks during execution.
      while (taskRank.size > 0) {
        // Find the current smallest rank bucket
        const r = minRank;
        const batch = buckets.get(r);
        if (!batch) {
          // If the bucket was emptied via upgrades, recompute minRank.
          minRank = Infinity;
          for (const k of buckets.keys()) if (k < minRank) minRank = k;
          continue;
        }

        buckets.delete(r);
        for (const t of batch) taskRank.delete(t);

        activeDeriveRank = r;
        for (const t of batch) t();
        activeDeriveRank = null;

        // New tasks may exist at higher ranks; loop continues while taskRank.size > 0
        if (buckets.size > 0) {
          // Keep minRank correct for the next iteration
          minRank = Infinity;
          for (const k of buckets.keys()) if (k < minRank) minRank = k;
        } else {
          minRank = Infinity;
        }
      }

      // 2) Deliver all component notifications in the same commit.
      while (flushQueue.size > 0) {
        const tasks = Array.from(flushQueue.values());
        flushQueue.clear();
        for (const run of tasks) run();
      }
    });

    // Reset all cascade state.
    active = false;
    activeDeriveRank = null;
    taskRank.clear();
    buckets.clear();
    minRank = Infinity;
  });
}

/**
 * Enlist one per-store component flush (idempotent per store).
 */
export function joinCascade(storeId: StoreId, task: Task): void {
  if (!active) return;
  flushQueue.set(storeId, task);
}

/**
 * Enqueue (or upgrade) a derive task with the given rank.
 * If the task is already present, we keep the maximum rank (run later).
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

  // Upgrade to a higher rank if needed (run later, once)
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
