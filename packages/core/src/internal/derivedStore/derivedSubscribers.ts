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
 * Manages subscriptions and notifications for a derived store.
 */
export class DerivedSubscribers<State> {
  watcherCount = 0;
  ordinaryWatcherCount = 0;
  cascadeParticipantCount = 0;
  cascadeStateListenerCount = 0;

  private watchers: SingleOrSet<DerivedWatcher<State>>;
  private cascadeStateListeners: SingleOrSet<Listener<State>>;

  add(watcher: DerivedWatcher<State>, isCascadeParticipant: boolean): boolean {
    if (isCascadeParticipant && typeof watcher === 'function') {
      const next = addToSingleOrSet(this.cascadeStateListeners, this.cascadeStateListenerCount, watcher);
      if (next === null) return false;
      this.cascadeStateListeners = next;
      this.cascadeStateListenerCount += 1;
    } else {
      const next = addToSingleOrSet(this.watchers, this.watcherCount, watcher);
      if (next === null) return false;
      this.watchers = next;
      this.watcherCount += 1;
    }

    if (isCascadeParticipant) this.cascadeParticipantCount += 1;
    else this.ordinaryWatcherCount += 1;
    return true;
  }

  delete(watcher: DerivedWatcher<State>, isCascadeParticipant: boolean): boolean {
    if (isCascadeParticipant && typeof watcher === 'function') {
      const next = deleteFromSingleOrSet(this.cascadeStateListeners, this.cascadeStateListenerCount, watcher);
      if (next === null) return false;
      this.cascadeStateListeners = next;
      this.cascadeStateListenerCount -= 1;
    } else {
      const next = deleteFromSingleOrSet(this.watchers, this.watcherCount, watcher);
      if (next === null) return false;
      this.watchers = next;
      this.watcherCount -= 1;
    }

    if (isCascadeParticipant) this.cascadeParticipantCount -= 1;
    else this.ordinaryWatcherCount -= 1;
    return true;
  }

  notifyCascade(state: State, previousState: State): void {
    forEachSingleOrSet(this.cascadeStateListeners, this.cascadeStateListenerCount, notifyListener, state, previousState);
    if (this.cascadeParticipantCount === this.cascadeStateListenerCount) return;
    forEachSingleOrSet(this.watchers, this.watcherCount, notifyCascadeWatcher, state, previousState);
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
