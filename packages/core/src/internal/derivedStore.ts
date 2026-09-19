import { IS_DEV } from '#env';
import type { StoreApi } from '../store/types';
import type {
  DebounceOptions,
  DeriveGetter,
  DeriveOptions,
  EqualityFn,
  Listener,
  Selector,
  WithFlushUpdates,
  WithGetSnapshot,
} from '../types';
import type { InternalSubscribeArgs, InternalUnsubscribeFn } from './types/internalSubscribeTypes';
import { identity } from '../utils/core';
import { debounce } from '../utils/debounce';
import { pluralize } from '../utils/stringUtils';
import {
  activateCascade,
  enqueueDerive,
  getCurrentDeriveRank,
  isCascadeActive,
  joinCascade,
  settleCascadeDerivations,
} from '../store/cascadeScheduler';
import { SUBSCRIBE_CASCADE_STATE } from '../store/internalSubscriptions';
import { CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS, DependencySubscriptions } from './derivedStore/dependencySubscriptions';
import { DerivedSubscribers, type DerivedWatcher } from './derivedStore/derivedSubscribers';
import { getOrCreateProxy, stripProxies } from './derivedStore/deriveProxy';
import { createPathFinder, type PathFinder } from './derivedStore/pathFinder';

// ============ Types ========================================================== //

type MaybeDerivedStore<State> = StoreApi<State> & { readonly [READ_DEPENDENCY_STATE]?: () => State };
type UninitializedState = typeof UNINITIALIZED;
type CascadeFlushState<State> = State | UninitializedState | typeof NO_CASCADE_FLUSH;

// ============ Constants ====================================================== //

const UNINITIALIZED = Symbol();
const NO_CASCADE_FLUSH = Symbol();
const READ_DEPENDENCY_STATE = Symbol('stores.derivedStore.readDependencyState');

// ============ Store Creator ================================================== //

export function derivedStore<DerivedState>(
  deriveFunction: ($: DeriveGetter) => DerivedState,
  optionsOrEqualityFn: DeriveOptions<DerivedState> = Object.is
): WithGetSnapshot<WithFlushUpdates<StoreApi<DerivedState>>> {
  let debounceOptions: number | DebounceOptions | undefined;
  let debugMode: boolean | 'verbose' = false;
  let equalityFn: EqualityFn<DerivedState>;
  let keepAlive = false;
  let lockDependencies = false;

  if (typeof optionsOrEqualityFn === 'function') {
    equalityFn = optionsOrEqualityFn;
  } else {
    debounceOptions = optionsOrEqualityFn.debounce;
    debugMode = IS_DEV ? (optionsOrEqualityFn.debugMode ?? false) : false;
    equalityFn = optionsOrEqualityFn.equalityFn ?? Object.is;
    keepAlive = optionsOrEqualityFn.keepAlive ?? false;
    lockDependencies = optionsOrEqualityFn.lockDependencies ?? false;
  }

  // Active subscriptions *to* the derived store
  const subscribers = new DerivedSubscribers<DerivedState>();

  // Subscriptions created by `$` within `deriveFunction`
  const dependencies = new DependencySubscriptions(invalidate);

  // Dictates whether dependency subscriptions are built and retained
  let dependencyConsumerCount = keepAlive ? 1 : 0;

  // Proxy tracking
  let rootProxyCache: WeakMap<object, unknown> | undefined;
  let pathFinder: PathFinder | undefined;

  // Core state
  let derivedState: DerivedState | UninitializedState = UNINITIALIZED;
  let deriveScheduled = false;
  let isDeriving = false;
  let invalidated = true;
  let shouldRebuildSubscriptions = true;

  // Cascade coordination state
  let enqueuedAtRank: number | null = null;

  // NO_CASCADE_FLUSH means idle; UNINITIALIZED means enlisted before a previous state exists
  let prevStateForFlush: CascadeFlushState<DerivedState> = NO_CASCADE_FLUSH;

  // ========== $ ==========

  function $<S>(store: StoreApi<S>): S;
  function $<S, Selected>(store: StoreApi<S>, selector: Selector<S, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
  function $<S, Selected = S>(store: StoreApi<S>, selector?: Selector<S, Selected>, equalityFn?: EqualityFn<Selected>): Selected | S {
    // -- Direct derivation, no subscription
    if (!shouldRebuildSubscriptions) return (selector ?? identity)(readDependencyState(store));
    if (!dependencyConsumerCount) return (selector ?? identity)(store.getState());

    // -- Overload #1: $(store).maybe.a.path
    if (!selector) {
      const snapshot = readDependencyState(store);
      if (!snapshot || typeof snapshot !== 'object') {
        dependencies.retainState(store);
        return snapshot;
      }

      if (!rootProxyCache) rootProxyCache = new WeakMap();
      if (!pathFinder) pathFinder = createPathFinder();
      return getOrCreateProxy(store, snapshot, rootProxyCache, pathFinder.trackPath);
    }

    // -- Overload #2: $(store, selector, equalityFn?)
    // No proxy, just a direct subscription to the store
    const subscribeOptions = equalityFn ? { equalityFn, isCascadeParticipant: true } : CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS;
    dependencies.addSelector(store.subscribe(selector, invalidate, subscribeOptions));
    return selector(readDependencyState(store));
  }

  // ========== Derivation ==========

  function runDerive(): DerivedState {
    if (!invalidated && isInitialized(derivedState)) return derivedState;
    invalidated = false;

    if (shouldRebuildSubscriptions) dependencies.beginRebuild(true);
    let didProduceNewState = true;
    const prevState = derivedState;
    const hasPreviousState = isInitialized(prevState);

    isDeriving = true;
    try {
      const derived = deriveFunction($);
      const newState = pathFinder ? stripProxies(derived) : derived;

      if (hasPreviousState && equalityFn(prevState, newState)) {
        if (debugMode) console.log('[🥷 Derive Complete 🥷]: No change detected');
        didProduceNewState = false;
        derivedState = prevState;
      } else {
        derivedState = newState;
      }
    } finally {
      isDeriving = false;
      if (shouldRebuildSubscriptions) dependencies.finishRebuild(true);
    }

    const shouldLogSubscriptions = debugMode && (!hasPreviousState || (debugMode === 'verbose' && shouldRebuildSubscriptions));

    if (shouldLogSubscriptions) {
      if (!hasPreviousState) console.log('[🌀 Initial Derive Complete 🌀]: Created…');
      else if (debugMode === 'verbose') console.log('[🌀 Rebuilding Subscriptions 🌀]: Created…');
      const subscriptionCount = dependencies.size;
      console.log(`[🎯 ${subscriptionCount} ${pluralize('Selector Subscription', subscriptionCount)} 🎯]`);
    }

    if (pathFinder && shouldRebuildSubscriptions) {
      // Create subscriptions for each proxy-generated dependency path
      pathFinder.buildProxySubscriptions((store, selector) => {
        dependencies.addSelector(store.subscribe(selector, invalidate, CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS));
      }, shouldLogSubscriptions);

      // Reset proxy tracking state
      rootProxyCache = undefined;
      if (lockDependencies) pathFinder = undefined;
      else pathFinder.reset();
    }

    if (didProduceNewState && hasPreviousState) notifyWatchers(derivedState, prevState);
    if (lockDependencies) shouldRebuildSubscriptions = false;

    return derivedState;
  }

  // ========== Notifications ==========

  function notifyWatchers(newState: DerivedState, prevState: DerivedState): void {
    const cascadeParticipantCount = subscribers.cascadeParticipantCount;
    const mixedWatchers = cascadeParticipantCount > 0 && subscribers.ordinaryWatcherCount > 0;

    // Defer if any of the following are true:
    // - This store has mixed watchers
    // - We're currently inside a derive batch (part of active derivation chain)
    // - A cascade is active and ordinary watchers need batched notification
    const shouldDefer = subscribers.ordinaryWatcherCount > 0 && (mixedWatchers || getCurrentDeriveRank() !== null || isCascadeActive());

    // Arm early so downstream invalidations see the cascade
    if (mixedWatchers) activateCascade();
    if (debugMode) {
      const notifiableWatcherCount = subscribers.ordinaryWatcherCount + cascadeParticipantCount;
      console.log(`[📻 Derive Complete 📻]: Notifying ${notifiableWatcherCount} ${pluralize('watcher', notifiableWatcherCount)}`);
    }

    if (cascadeParticipantCount) {
      // -- Phase 1: propagate cascade participant notifications synchronously
      subscribers.notifyCascade(newState, prevState);
    }

    if (!subscribers.ordinaryWatcherCount) return;

    // Defer ordinary watcher notifications during a cascade
    if (shouldDefer) {
      if (prevStateForFlush === NO_CASCADE_FLUSH) {
        prevStateForFlush = prevState;
        joinCascade(onCascadeFlush);
      } else if (!isInitialized(prevStateForFlush)) {
        prevStateForFlush = prevState;
      }
      return;
    }

    // -- Phase 2: immediate delivery (no cascade active)
    subscribers.notifyOrdinary(newState, prevState);
  }

  // ========== Cascade Flush ==========

  /**
   * Called by the cascade scheduler after derivations settle.
   * Lazily derives and flushes ordinary watcher notifications.
   */
  function onCascadeFlush(): void {
    // Stores without cascade participants may be invalidated but not yet derived
    // Derive now before flushing to ordinary watchers
    if (dependencyConsumerCount && invalidated && !subscribers.cascadeParticipantCount) runDerive();

    const prevState = prevStateForFlush;
    prevStateForFlush = NO_CASCADE_FLUSH;

    if (subscribers.ordinaryWatcherCount && isInitialized(derivedState) && prevState !== NO_CASCADE_FLUSH && isInitialized(prevState)) {
      subscribers.notifyOrdinary(derivedState, prevState);
    }
  }

  // ========== Debouncing / Scheduling ==========

  const debouncedDerive: ReturnType<typeof debounce> | undefined = debounceOptions
    ? debounce(
        runScheduledDerive,
        typeof debounceOptions === 'number' ? debounceOptions : debounceOptions.delay,
        typeof debounceOptions === 'number' ? { leading: false, maxWait: debounceOptions, trailing: true } : debounceOptions
      )
    : undefined;

  const scheduleDerive =
    debouncedDerive ??
    (() => {
      if (deriveScheduled) return;
      deriveScheduled = true;
      queueMicrotask(runScheduledDerive);
    });

  function runScheduledDerive(): void {
    deriveScheduled = false;
    if (!dependencyConsumerCount) {
      if (!keepAlive) destroy();
      return;
    }
    if (invalidated) runDerive();
  }

  // ========== Lifecycle Helpers ==========

  function handleDestroy(isCascadeParticipant?: boolean): void {
    // The no-argument invocation is the queued final check, avoiding per-teardown closures
    if (isCascadeParticipant !== undefined && (isCascadeParticipant || (!!debouncedDerive && invalidated))) {
      queueMicrotask(handleDestroy);
      return;
    }
    if (!dependencyConsumerCount && !keepAlive) destroy();
  }

  function deriveTask(): void {
    const rank = enqueuedAtRank;
    if (rank !== getCurrentDeriveRank()) return;

    runScheduledDerive();
    if (enqueuedAtRank === rank) enqueuedAtRank = null;
  }

  function invalidate(): void {
    // A dependency settled during this derivation is already reflected in the current output
    if (isDeriving) return;

    if (!debouncedDerive) {
      if (subscribers.cascadeParticipantCount) {
        invalidated = true;
        activateCascade();

        const upstream = getCurrentDeriveRank();
        const rank = upstream === null ? 0 : upstream + 1;
        if (enqueuedAtRank !== null && rank <= enqueuedAtRank) return;

        enqueuedAtRank = rank;
        enqueueDerive(deriveTask, rank);
        return;
      }

      if (invalidated) return;
      invalidated = true;

      // Stores without cascade participants during active cascade: enlist for lazy derive and flush
      if (isCascadeActive()) {
        if (prevStateForFlush === NO_CASCADE_FLUSH) {
          prevStateForFlush = UNINITIALIZED;
          joinCascade(onCascadeFlush);
        }
        return;
      }
    }

    // Outside cascades (debounced stores or no active cascade)
    if (invalidated) return;
    invalidated = true;
    enqueuedAtRank = null;
    scheduleDerive();
  }

  function withDependencyTracking<T>(fn: () => T): T {
    dependencyConsumerCount += 1;
    try {
      return fn();
    } finally {
      dependencyConsumerCount -= 1;
    }
  }

  // ========== Snapshots ==========

  function getSnapshot(): DerivedState {
    if (invalidated || !isInitialized(derivedState)) {
      // Ensures useSyncExternalStore doesn't trigger redundant derivations
      return dependencyConsumerCount ? runDerive() : withDependencyTracking(runDerive);
    }
    if (deriveScheduled && dependencyConsumerCount) runScheduledDerive();
    return derivedState;
  }

  // ========== Public Methods ==========

  function getState(): DerivedState {
    if (isCascadeActive() && getCurrentDeriveRank() === null) settleCascadeDerivations();

    if (invalidated || !isInitialized(derivedState)) {
      // If there are watchers, build subscriptions, otherwise compute directly
      return dependencyConsumerCount ? runDerive() : deriveFunction($);
    }

    return derivedState;
  }

  function subscribe(...args: InternalSubscribeArgs<DerivedState>): InternalUnsubscribeFn {
    // -- Overload #1: single argument (listener)
    if (args.length === 1) {
      const listener = args[0];
      if (subscribers.addWatcher(listener)) dependencyConsumerCount += 1;

      if (!isInitialized(derivedState)) getState();

      return () => {
        if (!subscribers.deleteWatcher(listener)) return;
        dependencyConsumerCount -= 1;
        if (!dependencyConsumerCount) handleDestroy(false);
      };
    }

    // -- Overload #2: (selector, listener, options?)
    const [selector, listener, options] = args;
    const equalityFn = options?.equalityFn ?? Object.is;
    const isCascadeParticipant = options?.isCascadeParticipant ?? false;
    const currentSlice = selector(dependencyConsumerCount ? getState() : withDependencyTracking(getState));

    const watcher: DerivedWatcher<DerivedState> = { currentSlice, equalityFn, isCascadeParticipant, listener, selector };
    subscribers.addWatcher(watcher);
    dependencyConsumerCount += 1;

    if (options?.fireImmediately) listener(currentSlice, currentSlice);

    return () => {
      if (!subscribers.deleteWatcher(watcher)) return;
      dependencyConsumerCount -= 1;
      if (!dependencyConsumerCount) handleDestroy(isCascadeParticipant);
    };
  }

  function subscribeCascadeState(listener: Listener<DerivedState>): InternalUnsubscribeFn {
    if (dependencyConsumerCount) getState();
    else withDependencyTracking(getState);

    if (subscribers.addCascadeStateListener(listener)) dependencyConsumerCount += 1;

    return () => {
      if (!subscribers.deleteCascadeStateListener(listener)) return;
      dependencyConsumerCount -= 1;
      if (!dependencyConsumerCount) handleDestroy(true);
    };
  }

  function flushUpdates(): void {
    if (!dependencyConsumerCount) return;
    if (debouncedDerive) debouncedDerive.flush();
    else if (invalidated) runDerive();
  }

  function destroy(): void {
    debouncedDerive?.cancel();
    dependencies.clear();
    subscribers.clear();
    dependencyConsumerCount = 0;
    pathFinder = undefined;
    rootProxyCache = undefined;
    shouldRebuildSubscriptions = true;
    deriveScheduled = false;
    isDeriving = false;
    invalidated = true;
    derivedState = UNINITIALIZED;
    prevStateForFlush = NO_CASCADE_FLUSH;
    enqueuedAtRank = null;
  }

  function readForDependency(): DerivedState {
    if (invalidated || deriveScheduled || !isInitialized(derivedState)) {
      return dependencyConsumerCount ? runDerive() : withDependencyTracking(runDerive);
    }
    return derivedState;
  }

  const api = {
    [READ_DEPENDENCY_STATE]: readForDependency,
    [SUBSCRIBE_CASCADE_STATE]: subscribeCascadeState,
    destroy,
    flushUpdates,
    getSnapshot,
    getState,
    subscribe,
    // -- Not applicable to derived stores
    getInitialState: unavailableGetInitialState,
    setState: unavailableSetState,
  };

  return api;
}

// ============ Helpers ======================================================== //

function unavailableGetInitialState(): never {
  throw new Error('[createDerivedStore]: getInitialState() is not available on derived stores.');
}

function unavailableSetState(): never {
  throw new Error('[createDerivedStore]: setState() is not available on derived stores.');
}

function readDependencyState<State>(store: MaybeDerivedStore<State>): State {
  const readDependency = store[READ_DEPENDENCY_STATE];
  return readDependency ? readDependency() : store.getState();
}

function isInitialized<T>(state: T | typeof UNINITIALIZED): state is T {
  return state !== UNINITIALIZED;
}
