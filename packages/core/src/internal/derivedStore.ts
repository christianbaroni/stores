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
import { getOrCreateProxy, stripProxies } from './derivedStore/deriveProxy';
import { PathFinder, createPathFinder } from './derivedStore/pathFinder';
import { hasGetSnapshot } from './storeUtils';

// ============ Types ========================================================== //

/**
 * A `Watcher` is either:
 * - Plain listener (state, prevState)
 * - Selector-based listener
 */
type Watcher<DerivedState, Selected = unknown> =
  | Listener<DerivedState>
  | {
      currentSlice: Selected;
      equalityFn: EqualityFn<Selected>;
      isCascadeParticipant: boolean;
      listener: Listener<Selected>;
      selector: Selector<DerivedState, Selected>;
    };

// ============ Constants ====================================================== //

/**
 * Sentinel value that indicates the store state is uninitialized.
 */
const UNINITIALIZED = Symbol();

const CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS = Object.freeze({ equalityFn: Object.is, isCascadeParticipant: true });

type UninitializedState = typeof UNINITIALIZED;

// ============ Store Creator ================================================== //

/** @internal */
export function derivedStore<DerivedState>(
  deriveFunction: ($: DeriveGetter) => DerivedState,
  optionsOrEqualityFn: DeriveOptions<DerivedState> = Object.is
): WithGetSnapshot<WithFlushUpdates<StoreApi<DerivedState>>> {
  const { debounceOptions, debugMode, equalityFn, keepAlive, lockDependencies } = parseOptions(optionsOrEqualityFn);

  // Active subscriptions *to* the derived store
  const watchers = new Set<Watcher<DerivedState>>();
  if (keepAlive) watchers.add(dummyWatcher);

  // For subscriptions created by `$` within `deriveFunction`
  const unsubscribes = new Set<InternalUnsubscribeFn>();

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
  let cascadeParticipants = 0;
  let enlistedInCascade = false;
  let enqueuedAtRank: number | null = null;
  let prevStateForFlush: DerivedState | UninitializedState = UNINITIALIZED;

  // ========== $ ==========

  function $<S>(store: StoreApi<S>): S;
  function $<S, Selected>(store: StoreApi<S>, selector: Selector<S, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
  function $<S, Selected = S>(store: StoreApi<S>, selector?: Selector<S, Selected>, equalityFn?: EqualityFn<Selected>): Selected | S {
    // -- Direct derivation, no subscription
    if (!shouldRebuildSubscriptions || !watchers.size) {
      return (selector ?? identity)(store.getState());
    }

    // -- Overload #1: $(store).maybe.a.path
    if (!selector) {
      if (!rootProxyCache) rootProxyCache = new WeakMap();
      if (!pathFinder) pathFinder = createPathFinder();
      return getOrCreateProxy(store, rootProxyCache, pathFinder.trackPath);
    }
    // -- Overload #2: $(store, selector, equalityFn?)
    // No proxy, just a direct subscription to the store
    const subscribeOptions = equalityFn ? { equalityFn, isCascadeParticipant: true } : CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS;
    unsubscribes.add(store.subscribe(selector, invalidate, subscribeOptions));
    return selector(hasGetSnapshot(store) ? store.getSnapshot() : store.getState());
  }

  function unsubscribeAll(skipAbortFetch?: boolean): void {
    for (const unsub of unsubscribes) unsub(skipAbortFetch);
    unsubscribes.clear();
  }

  // ========== Derivation ==========

  let didProduceNewState = true;

  function runDerive(): DerivedState {
    if (!invalidated && isInitialized(derivedState)) return derivedState;
    invalidated = false;

    if (shouldRebuildSubscriptions) unsubscribeAll(true);

    const prevState = derivedState;
    const hasPreviousState = isInitialized(prevState);

    isDeriving = true;
    try {
      derivedState = produceNextState($);
    } finally {
      isDeriving = false;
    }

    const shouldLogSubscriptions = debugMode && (!hasPreviousState || (debugMode === 'verbose' && shouldRebuildSubscriptions));

    if (shouldLogSubscriptions) {
      if (!hasPreviousState) console.log('[🌀 Initial Derive Complete 🌀]: Created…');
      else if (debugMode === 'verbose') console.log('[🌀 Rebuilding Subscriptions 🌀]: Created…');
      const subscriptionCount = unsubscribes.size;
      console.log(`[🎯 ${subscriptionCount} ${pluralize('Selector Subscription', subscriptionCount)} 🎯]`);
    }

    if (pathFinder && shouldRebuildSubscriptions) {
      // Create subscriptions for each proxy-generated dependency path
      pathFinder.buildProxySubscriptions((store, selector) => {
        unsubscribes.add(store.subscribe(selector, invalidate, CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS));
      }, shouldLogSubscriptions);

      // Reset proxy tracking state
      rootProxyCache = undefined;
      pathFinder.reset();
      if (lockDependencies) pathFinder = undefined;
    }

    if (didProduceNewState && hasPreviousState) notifyWatchers(derivedState, prevState);
    if (lockDependencies) shouldRebuildSubscriptions = false;

    return derivedState;
  }

  function produceNextState($: DeriveGetter): DerivedState {
    didProduceNewState = true;
    const prevState = derivedState;
    const derived = deriveFunction($);
    const newState = pathFinder ? stripProxies(derived) : derived;

    if (!isInitialized(prevState)) return newState;

    if (equalityFn(prevState, newState)) {
      if (debugMode) console.log('[🥷 Derive Complete 🥷]: No change detected');
      didProduceNewState = false;
      return prevState;
    }
    return newState;
  }

  // ========== Notifications ==========

  function notifyWatchers(newState: DerivedState, prevState: DerivedState): void {
    const mixedWatchers = hasMixedWatchers();
    const hasOrdinaryWatchers = !cascadeParticipants || mixedWatchers;

    // Defer if any of the following are true:
    // - This store has mixed watchers
    // - We're currently inside a derive batch (part of active derivation chain)
    // - A cascade is active and ordinary watchers need batched notification
    const shouldDefer = hasOrdinaryWatchers && (mixedWatchers || getCurrentDeriveRank() !== null || isCascadeActive());

    // Arm early so downstream invalidations see the cascade
    if (mixedWatchers) activateCascade();

    if (debugMode) console.log(`[📻 Derive Complete 📻]: Notifying ${watchers.size} ${pluralize('watcher', watchers.size)}`);

    // -- Phase 1: propagate cascade participant notifications synchronously
    for (const w of watchers) {
      if (typeof w === 'function' || !w.isCascadeParticipant) continue;
      const nextSlice = w.selector(newState);
      if (!w.equalityFn(w.currentSlice, nextSlice)) {
        const prevSlice = w.currentSlice;
        w.currentSlice = nextSlice;
        w.listener(nextSlice, prevSlice);
      }
    }

    // Defer ordinary watcher notifications during a cascade
    if (shouldDefer) {
      if (!isInitialized(prevStateForFlush)) prevStateForFlush = prevState;
      if (!enlistedInCascade) {
        enlistedInCascade = true;
        joinCascade(onCascadeFlush);
      }
      return;
    }

    // -- Phase 2: immediate delivery (no cascade active)
    notifyOrdinaryWatchers(newState, prevState);
  }

  function notifyOrdinaryWatchers(newState: DerivedState, prevState: DerivedState): void {
    for (const w of watchers) {
      if (typeof w === 'function') {
        w(newState, prevState);
      } else if (!w.isCascadeParticipant) {
        const nextSlice = w.selector(newState);
        if (!w.equalityFn(w.currentSlice, nextSlice)) {
          const prevSlice = w.currentSlice;
          w.currentSlice = nextSlice;
          w.listener(nextSlice, prevSlice);
        }
      }
    }
  }

  function hasMixedWatchers(): boolean {
    const hasDummy = watchers.has(dummyWatcher);
    const watcherCount = hasDummy ? watchers.size - 1 : watchers.size;
    return cascadeParticipants > 0 && cascadeParticipants < watcherCount;
  }

  // ========== Cascade Flush ==========

  /**
   * Called by the cascade scheduler after derivations settle.
   * Lazily derives and flushes ordinary watcher notifications.
   */
  function onCascadeFlush(): void {
    // Stores without cascade participants may be invalidated but not yet derived
    // Derive now before flushing to ordinary watchers
    if (watchers.size && invalidated && !cascadeParticipants) runDerive();

    const prevState = prevStateForFlush;
    enlistedInCascade = false;
    prevStateForFlush = UNINITIALIZED;

    if (watchers.size && isInitialized(derivedState) && isInitialized(prevState)) {
      notifyOrdinaryWatchers(derivedState, prevState);
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
    if (!watchers.size) {
      destroy();
      return;
    }
    if (invalidated) runDerive();
  }

  // ========== Lifecycle Helpers ==========

  function handleDestroy(isCascadeParticipant: boolean): void {
    const shouldDefer = isCascadeParticipant || (!!debouncedDerive && invalidated);
    if (!shouldDefer) {
      destroy();
      return;
    }
    queueMicrotask(() => {
      if (!watchers.size) destroy();
    });
  }

  function deriveTask(): void {
    runScheduledDerive();
    enqueuedAtRank = null;
  }

  function invalidate(): void {
    // A dependency settled during this derivation is already reflected in the current output.
    if (isDeriving || invalidated) return;
    invalidated = true;

    if (!debouncedDerive) {
      if (cascadeParticipants) {
        activateCascade();
        const upstream = getCurrentDeriveRank();
        const rank = upstream === null ? 0 : upstream + 1;

        if (enqueuedAtRank !== null && rank <= enqueuedAtRank) {
          return;
        }

        enqueuedAtRank = rank;
        enqueueDerive(deriveTask, rank);
        return;
      }

      // Stores without cascade participants during active cascade: enlist for lazy derive and flush
      if (isCascadeActive()) {
        if (!enlistedInCascade) {
          enlistedInCascade = true;
          joinCascade(onCascadeFlush);
        }
        return;
      }
    }

    // Outside cascades (debounced stores or no active cascade)
    enqueuedAtRank = null;
    scheduleDerive();
  }

  function withDummyWatcher<T>(fn: () => T): T {
    watchers.add(dummyWatcher);
    try {
      return fn();
    } finally {
      watchers.delete(dummyWatcher);
    }
  }

  // ========== Snapshots ==========

  function getSnapshot(): DerivedState {
    if (!isInitialized(derivedState)) {
      // Ensures useSyncExternalStore doesn't trigger redundant derivations
      return watchers.size ? runDerive() : withDummyWatcher(runDerive);
    }
    if (deriveScheduled) runScheduledDerive();
    return derivedState;
  }

  function initializeWatcherSlice<Selected>(selector: Selector<DerivedState, Selected>): Selected {
    return selector(watchers.size ? getState() : withDummyWatcher(getState));
  }

  // ========== Public Methods ==========

  function getState(): DerivedState {
    if (isCascadeActive()) settleCascadeDerivations();

    if (invalidated || !isInitialized(derivedState)) {
      // If there are watchers, build subscriptions, otherwise compute directly
      return watchers.size > 0 ? runDerive() : deriveFunction($);
    }

    return derivedState;
  }

  function subscribe(...args: InternalSubscribeArgs<DerivedState>): InternalUnsubscribeFn {
    // -- Overload #1: single argument (listener)
    if (args.length === 1) {
      const listener = args[0];
      watchers.add(listener);

      if (!isInitialized(derivedState)) getState();

      return () => {
        watchers.delete(listener);
        if (!watchers.size) handleDestroy(false);
      };
    }

    // -- Overload #2: (selector, listener, { equalityFn, fireImmediately, isCascadeParticipant })
    const [selector, listener, options] = args;
    const equalityFn = options?.equalityFn ?? Object.is;
    const isCascadeParticipant = options?.isCascadeParticipant ?? false;
    const currentSlice = initializeWatcherSlice(selector);

    const watcher: Watcher<DerivedState> = {
      currentSlice,
      equalityFn,
      isCascadeParticipant,
      listener,
      selector,
    };

    watchers.add(watcher);
    if (isCascadeParticipant) cascadeParticipants += 1;
    if (options?.fireImmediately) listener(currentSlice, currentSlice);

    return () => {
      watchers.delete(watcher);
      if (isCascadeParticipant) cascadeParticipants -= 1;
      if (!watchers.size) handleDestroy(isCascadeParticipant);
    };
  }

  function flushUpdates(): void {
    if (!watchers.size) return;
    if (debouncedDerive) debouncedDerive.flush();
    else if (invalidated) runDerive();
  }

  function destroy(isInternalCall = true): void {
    if (keepAlive && isInternalCall) return;
    debouncedDerive?.cancel();
    unsubscribeAll();
    watchers.clear();
    cascadeParticipants = 0;
    pathFinder = undefined;
    rootProxyCache = undefined;
    shouldRebuildSubscriptions = true;
    deriveScheduled = false;
    isDeriving = false;
    invalidated = true;
    derivedState = UNINITIALIZED;
    enlistedInCascade = false;
    prevStateForFlush = UNINITIALIZED;
    enqueuedAtRank = null;
  }

  return {
    destroy: () => destroy(false),
    flushUpdates,
    getSnapshot,
    getState,
    subscribe,
    // -- Not applicable to derived stores
    getInitialState: () => {
      throw new Error('[createDerivedStore]: getInitialState() is not available on derived stores.');
    },
    setState: () => {
      throw new Error('[createDerivedStore]: setState() is not available on derived stores.');
    },
  };
}

// ============ Helpers ======================================================== //

function dummyWatcher(): void {
  return;
}

function isInitialized<T>(state: T | typeof UNINITIALIZED): state is T {
  return state !== UNINITIALIZED;
}

function parseOptions<DerivedState>(options: DeriveOptions<DerivedState>): {
  debounceOptions: number | DebounceOptions | undefined;
  debugMode: boolean | 'verbose';
  equalityFn: EqualityFn<DerivedState>;
  keepAlive: boolean;
  lockDependencies: boolean;
} {
  if (typeof options === 'function') {
    return {
      debounceOptions: undefined,
      debugMode: false,
      equalityFn: options,
      keepAlive: false,
      lockDependencies: false,
    };
  }
  return {
    debounceOptions: options.debounce,
    debugMode: (IS_DEV && options.debugMode) ?? false,
    equalityFn: options.equalityFn ?? Object.is,
    keepAlive: options.keepAlive ?? false,
    lockDependencies: options.lockDependencies ?? false,
  };
}
