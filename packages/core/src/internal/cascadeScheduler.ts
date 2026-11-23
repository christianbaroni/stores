import { batchStoreNotifications } from '#store/batchStoreNotifications';

/**
 * Cascade Scheduler
 *
 * - Coalesces derivations into a single microtask.
 * - Derivations run in dependency waves before ordinary listeners.
 * - Doesn't retain snapshots or dependency graphs.
 * - Deferred listeners run after all derivations have settled.
 */

// ============ Types ========================================================== //

type Task = () => void;

const enum Phase {
  Idle,
  Pending,
  Flushing,
  Deriving,
}

// ============ State ========================================================== //

let phase = Phase.Idle;
let scheduled = false;

// Deferred listener flushes. A single deferred task needs no queue; callers own
// duplicate suppression through their scheduled/enlisted flags.
let flushTask: Task | undefined;
let flushQueue: Task[] | undefined;
let flushIndex = 0;

const waves: (Set<ScheduledDerivation> | undefined)[] = [];
let depth = 0;

// ============ Public API ===================================================== //

export function isCascadeActive(): boolean {
  return phase !== Phase.Idle;
}

/**
 * Settles pending work before delivering a source change to its listeners.
 */
export function notifyAfterCascade<State>(notify: (previous: State) => void, previous: State): void {
  if (phase === Phase.Idle) return notify(previous);
  if (phase === Phase.Pending) {
    flushCascade();
    notify(previous);
    return;
  }

  const parent = phase;
  phase = Phase.Flushing;
  try {
    drainCascade();
    notify(previous);
  } finally {
    phase = parent;
  }
}

/**
 * Arms the cascade and schedules a single microtask flush.
 */
export function activateCascade(): void {
  if (phase !== Phase.Idle) return;
  phase = Phase.Pending;

  if (scheduled) return;
  scheduled = true;

  queueMicrotask(flushScheduledCascade);
}

/**
 * Settles pending derivations for a public read without delivering listeners
 * or interrupting a derivation that is still propagating its change.
 */
export function settleCascadeDerivations(): void {
  if (phase === Phase.Idle || phase === Phase.Deriving || waves.length <= depth) return;

  let resume: Phase = phase;
  const start = depth;
  phase = Phase.Deriving;

  try {
    for (let level = start; level < waves.length; level++) {
      const wave = waves[level];
      if (!wave) continue;

      depth = level + 1;
      try {
        for (const task of wave) task.run();
      } finally {
        waves[level] = undefined;
      }
    }

    waves.length = start;
  } catch (error) {
    if (resume === Phase.Pending) {
      clearQueues();
      resume = Phase.Idle;
    }
    throw error;
  } finally {
    depth = start;
    phase = resume;
  }
}

/**
 * Enlist a deferred listener flush task.
 */
export function joinCascade(task: Task): void {
  if (phase === Phase.Idle) return;

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
 * Reusable cascade task that a derived store schedules on invalidation
 * and cancels on teardown.
 */
export class ScheduledDerivation {
  private level = -1;

  constructor(readonly run: Task) {}

  schedule(): void {
    activateCascade();

    if (this.level !== depth) {
      const previous = waves[this.level];
      if (this.level > depth && previous?.has(this)) return;
      previous?.delete(this);
      this.level = depth;
    }

    (waves[depth] ??= new Set()).add(this);
  }

  cancel(): void {
    waves[this.level]?.delete(this);
  }
}

// ============ Internal Methods =============================================== //

function flushScheduledCascade(): void {
  scheduled = false;
  if (phase === Phase.Pending) flushCascade();
}

function flushCascade(): void {
  phase = Phase.Flushing;
  try {
    while (hasPendingWork()) batchStoreNotifications(drainCascade);
  } finally {
    clearQueues();
    phase = Phase.Idle;
  }
}

function drainCascade(): void {
  while (hasPendingWork()) {
    settleCascadeDerivations();
    flushDeferredTasks();
  }
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

    while (flushQueue === queue && flushIndex < queue.length) queue[flushIndex++]();

    if (flushQueue === queue) {
      flushQueue = undefined;
      flushIndex = 0;
    }
    return;
  }
}

function clearQueues(): void {
  flushTask = undefined;
  flushQueue = undefined;
  flushIndex = 0;
  waves.length = 0;
}

function hasPendingWork(): boolean {
  return waves.length > depth || !!flushTask || !!flushQueue;
}
