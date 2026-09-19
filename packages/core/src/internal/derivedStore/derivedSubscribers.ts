import type { EqualityFn, Listener, Selector } from '../../types';
import { notifyListener } from '../../utils/core';
import { addToSingleOrSet, clearSingleOrSet, deleteFromSingleOrSet, forEachSingleOrSet, type SingleOrSet } from '../../utils/singleOrSet';

// ============ Types ========================================================== //

/** Subscriber stored by a derived store, either for full state or a selected slice. */
export type DerivedWatcher<State, Selected = unknown> = Listener<State> | SelectorWatcher<State, Selected>;

type SelectorWatcher<State, Selected = unknown> = {
  currentSlice: Selected;
  equalityFn: EqualityFn<Selected>;
  isCascadeParticipant: boolean;
  listener: Listener<Selected>;
  selector: Selector<State, Selected>;
};

// ============ Subscriber Registry ============================================ //

/**
 * Owns the compact watcher and cascade-state collections used by one derived store.
 * The instance is retained across unsubscribe and destroy cycles.
 */
export class DerivedSubscribers<State> {
  watcherCount = 0;
  ordinaryWatcherCount = 0;
  cascadeParticipantCount = 0;
  cascadeStateListenerCount = 0;

  private watchers: SingleOrSet<DerivedWatcher<State>>;
  private cascadeStateListeners: SingleOrSet<Listener<State>>;

  addWatcher(watcher: DerivedWatcher<State>): boolean {
    const next = addToSingleOrSet(this.watchers, this.watcherCount, watcher);
    if (next === null) return false;

    this.watchers = next;
    this.watcherCount += 1;
    if (isCascadeWatcher(watcher)) this.cascadeParticipantCount += 1;
    else this.ordinaryWatcherCount += 1;
    return true;
  }

  deleteWatcher(watcher: DerivedWatcher<State>): boolean {
    const next = deleteFromSingleOrSet(this.watchers, this.watcherCount, watcher);
    if (next === null) return false;

    this.watchers = next;
    this.watcherCount -= 1;
    if (isCascadeWatcher(watcher)) this.cascadeParticipantCount -= 1;
    else this.ordinaryWatcherCount -= 1;
    return true;
  }

  addCascadeStateListener(listener: Listener<State>): boolean {
    const next = addToSingleOrSet(this.cascadeStateListeners, this.cascadeStateListenerCount, listener);
    if (next === null) return false;

    this.cascadeStateListeners = next;
    this.cascadeParticipantCount += 1;
    this.cascadeStateListenerCount += 1;
    return true;
  }

  deleteCascadeStateListener(listener: Listener<State>): boolean {
    const next = deleteFromSingleOrSet(this.cascadeStateListeners, this.cascadeStateListenerCount, listener);
    if (next === null) return false;

    this.cascadeStateListeners = next;
    this.cascadeParticipantCount -= 1;
    this.cascadeStateListenerCount -= 1;
    return true;
  }

  notifyCascade(state: State, previousState: State): void {
    forEachSingleOrSet(this.cascadeStateListeners, this.cascadeStateListenerCount, notifyListener, state, previousState);
    if (this.cascadeParticipantCount !== this.cascadeStateListenerCount) {
      forEachSingleOrSet(this.watchers, this.watcherCount, notifyCascadeWatcher, state, previousState);
    }
  }

  notifyOrdinary(state: State, previousState: State): void {
    forEachSingleOrSet(this.watchers, this.watcherCount, notifyOrdinaryWatcher, state, previousState);
  }

  clear(): void {
    this.watchers = clearSingleOrSet(this.watchers, this.watcherCount);
    this.cascadeStateListeners = clearSingleOrSet(this.cascadeStateListeners, this.cascadeStateListenerCount);
    this.watcherCount = 0;
    this.ordinaryWatcherCount = 0;
    this.cascadeParticipantCount = 0;
    this.cascadeStateListenerCount = 0;
  }
}

// ============ Notification Helpers =========================================== //

function notifyCascadeWatcher<State>(watcher: DerivedWatcher<State>, state: State, _previousState: State): void {
  if (typeof watcher === 'function' || !watcher.isCascadeParticipant) return;
  notifySelectorWatcher(watcher, state);
}

function notifyOrdinaryWatcher<State>(watcher: DerivedWatcher<State>, state: State, previousState: State): void {
  if (typeof watcher === 'function') {
    watcher(state, previousState);
    return;
  }
  if (!watcher.isCascadeParticipant) notifySelectorWatcher(watcher, state);
}

function notifySelectorWatcher<State>(watcher: SelectorWatcher<State>, state: State): void {
  const nextSlice = watcher.selector(state);
  if (watcher.equalityFn(watcher.currentSlice, nextSlice)) return;

  const previousSlice = watcher.currentSlice;
  watcher.currentSlice = nextSlice;
  watcher.listener(nextSlice, previousSlice);
}

function isCascadeWatcher<State>(watcher: DerivedWatcher<State>): boolean {
  return typeof watcher !== 'function' && watcher.isCascadeParticipant;
}
