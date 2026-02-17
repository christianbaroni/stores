import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector';
import { StoreApi } from 'zustand/vanilla';
import { IS_DEV } from '@/env';
import { PathFinder, createPathFinder, getOrCreateProxy } from './derivedStore/deriveProxy';
import { activateCascade, enqueueDerive, getCurrentDeriveRank, isCascadeActive, joinCascade } from './derivedStore/cascadeScheduler';
import {
  BaseStore,
  DebounceOptions,
  DeriveOptions,
  DerivedStore,
  EqualityFn,
  Listener,
  Store,
  Selector,
  SubscribeArgs,
  UnsubscribeFn,
  WithFlushUpdates,
  WithGetSnapshot,
  InferStoreState,
} from './types';
import { identity } from './utils/core';
import { debounce } from './utils/debounce';
import { hasGetSnapshot } from './utils/storeUtils';
import { pluralize } from './utils/stringUtils';

// ============ Store Creator ================================================== //

/**
 * ### `createDerivedStore`
 *
 * Creates a **read-only** store derived from one or more underlying Zustand stores.
 *
 * ---
 * The `deriveFunction` is called whenever its dependencies change, producing a new derived state.
 * Dependencies are automatically tracked through a special `$` helper, which supports:
 *
 * 1) **Selector-based** usage:
 *    ```ts
 *    $ => {
 *      const user = $(useUserStore, s => s.user, shallowEqual);
 *      const theme = $(useSettingsStore, s => s.appearance.theme);
 *      return { user, theme, isAdmin: user?.roles.includes('admin') };
 *    }
 *    ```
 *
 * 2) **Proxy-based** usage (auto-built selectors for nested properties):
 *    ```ts
 *    $ => {
 *      const { user } = $(useUserStore); // Subscribe to `user`
 *      const theme = $(useSettingsStore).appearance.theme; // Subscribe to `theme`
 *      return { isAdmin: user?.roles.includes('admin'), theme, user };
 *    }
 *    ```
 *
 * ---
 * Derived stores automatically unsubscribe from all dependencies when no consumers remain, and
 * resubscribe when new consumers appear. The returned function doubles as:
 *
 * - A **React hook** (`const state = useDerivedStore(selector, equalityFn?)`)
 * - A **store object** with `getState()`, `subscribe()`, and `destroy()`
 *
 * ---
 * You can optionally pass a second parameter (either an equality function or a config object)
 * to enable debouncing, customize the equality function, or set `lockDependencies: true`.
 *
 * (When dependencies are locked, subscriptions created via `$` are established once and are
 * not rebuilt on subsequent re-derives, which can be a performance win for certain workloads.)
 *
 * ---
 * @example
 * ```ts
 * // Create a derived store
 * const useSearchResults = createDerivedStore($ => {
 *   const query = $(useSearchStore).query.trim().toLowerCase();
 *   const items = $(useItemsStore).items;
 *   return findResults(query, items);
 * }, shallowEqual);
 *
 * function SearchResults() {
 *   // Consume the derived state
 *   const results = useSearchResults(); // Or (selector, equalityFn?)
 *   return <ResultsList items={results} />;
 * }
 * ```
 *
 * ---
 * @param deriveFunction - Function that reads from other stores via `$` to produce derived state.
 * @param optionsOrEqualityFn - Either an equality function or a config object (see `DeriveOptions`).
 *
 * @returns A read-only derived store (usable as a hook or standard store object).
 */
export function createDerivedStore<Derived>(
  deriveFunction: ($: DeriveGetter) => Derived,
  optionsOrEqualityFn: DeriveOptions<Derived> = Object.is
): DerivedStore<Derived> {
  return attachStoreHook(derive(deriveFunction, optionsOrEqualityFn));
}

function attachStoreHook<S>(store: WithGetSnapshot<WithFlushUpdates<StoreApi<S>>>): DerivedStore<S> {
  function useDerivedStore(): S;
  function useDerivedStore<T>(selector: (state: S) => T, equalityFn?: EqualityFn<T>): T;
  function useDerivedStore<T>(selector: (state: S) => T = identity, equalityFn: EqualityFn<T> | undefined = undefined): S | T {
    return useSyncExternalStoreWithSelector(store.subscribe, store.getSnapshot, undefined, selector, equalityFn);
  }
  return Object.assign(useDerivedStore, store);
}

// ============ Types ========================================================== //

export type DeriveGetter = {
  <S extends Store<unknown>>(store: S): InferStoreState<S>;
  <S extends Store<unknown>, Selected>(
    store: S,
    selector: Selector<InferStoreState<S>, Selected>,
    equalityFn?: EqualityFn<Selected>
  ): Selected;
};

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
      isDerivedWatcher: boolean;
      listener: Listener<Selected>;
      selector: Selector<DerivedState, Selected>;
    };

// ============ Core Derive Function =========================================== //

/**
 * Sentinel value that indicates the store state is uninitialized.
 */
const UNINITIALIZED = Symbol();

type UninitializedState = typeof UNINITIALIZED;

/**
 * Powers the internals of `createDerivedStore`.
 *
 * - Intercepts `$` calls in `deriveFunction` to track and subscribe to dependencies.
 * - Recomputes derived state whenever dependencies change (optionally debounced).
 * - Notifies all subscribers in a single pass if the derived state (or their slice) has changed.
 * - Cleans up subscriptions and internal state when no subscribers (watchers) remain.
 */
function derive<DerivedState>(
  deriveFunction: ($: DeriveGetter) => DerivedState,
  optionsOrEqualityFn: DeriveOptions<DerivedState> = Object.is
): WithGetSnapshot<WithFlushUpdates<StoreApi<DerivedState>>> {
  const { debounceOptions, debugMode, equalityFn, keepAlive, lockDependencies } = parseOptions(optionsOrEqualityFn);
  const storeId = getStoreId();

  // Active subscriptions *to* the derived store
  const watchers = new Set<Watcher<DerivedState>>();
  if (keepAlive) watchers.add(dummyWatcher);

  // For subscriptions created by `$` within `deriveFunction`
  const unsubscribes = new Set<UnsubscribeFn<true>>();

  // Lazily built proxy helpers
  let rootProxyCache: WeakMap<StoreApi<unknown>, unknown> | undefined;
  let pathFinder: PathFinder | undefined;

  // Core state
  let derivedState: DerivedState | UninitializedState = UNINITIALIZED;
  let deriveScheduled = false;
  let invalidated = true;
  let shouldRebuildSubscriptions = true;

  // Cascade coordination state
  let derivedWatchers = 0;
  let enlistedInCascade = false;
  let enqueuedAtRank: number | null = null;
  let prevStateForFlush: DerivedState | UninitializedState = UNINITIALIZED;

  // ========== $ ==========

  function $<S>(store: BaseStore<S>): S;
  function $<S, Selected>(store: BaseStore<S>, selector: Selector<S, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
  function $<S, Selected = S>(store: BaseStore<S>, selector?: Selector<S, Selected>, equalityFn?: EqualityFn<Selected>): Selected | S {
    if (!shouldRebuildSubscriptions || !watchers.size) {
      return (selector ?? identity)(hasGetSnapshot(store) ? store.getSnapshot() : store.getState());
    }

    // -- Overload #1: $(store).maybe.a.path
    if (!selector) {
      if (!rootProxyCache) rootProxyCache = new WeakMap();
      if (!pathFinder) pathFinder = createPathFinder();
      return getOrCreateProxy(store, rootProxyCache, pathFinder.trackPath);
    }
    // -- Overload #2: $(store, selector, equalityFn?)
    // No proxy, just a direct subscription to the store
    const unsubscribe = store.subscribe(selector, invalidate, {
      equalityFn: equalityFn ?? Object.is,
      isDerivedStore: true,
    });
    unsubscribes.add(unsubscribe);
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
    derivedState = produceNextState($);

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
        const unsubscribe = store.subscribe(selector, invalidate, { equalityFn: Object.is, isDerivedStore: true });
        unsubscribes.add(unsubscribe);
      }, shouldLogSubscriptions);
      // Reset proxy state for the next derivation
      rootProxyCache = undefined;
      pathFinder = undefined;
    }

    if (didProduceNewState && hasPreviousState) notifyWatchers(derivedState, prevState);
    if (lockDependencies) shouldRebuildSubscriptions = false;

    return derivedState;
  }

  function produceNextState($: DeriveGetter): DerivedState {
    didProduceNewState = true;
    const prevState = derivedState;
    const newState = deriveFunction($);
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
    const hasComponentWatchers = !derivedWatchers || mixedWatchers;

    // Defer if any of the following are true:
    // - This store has mixed watchers
    // - We're currently inside a derive batch (part of active derivation chain)
    // - A cascade is active and we have component watchers (component-only stores need batching)
    const shouldDefer = mixedWatchers || getCurrentDeriveRank() !== null || (isCascadeActive() && hasComponentWatchers);

    // Arm early so downstream invalidations see the cascade
    if (mixedWatchers) activateCascade();

    if (debugMode) console.log(`[📻 Derive Complete 📻]: Notifying ${watchers.size} ${pluralize('watcher', watchers.size)}`);

    // -- Phase 1: propagate derivations synchronously to downstream derived stores
    for (const w of watchers) {
      if (typeof w === 'function' || !w.isDerivedWatcher) continue;
      const nextSlice = w.selector(newState);
      if (!w.equalityFn(w.currentSlice, nextSlice)) {
        const prevSlice = w.currentSlice;
        w.currentSlice = nextSlice;
        w.listener(nextSlice, prevSlice);
      }
    }

    // Defer non-derived notifications during a cascade
    if (shouldDefer) {
      if (!enlistedInCascade) {
        enlistedInCascade = true;
        if (!isInitialized(prevStateForFlush)) prevStateForFlush = prevState;
        joinCascade(storeId, onCascadeFlush);
      }
      return;
    }

    // -- Phase 2: immediate delivery (no cascade active)
    notifyNonDerivedWatchers(newState, prevState);
  }

  function notifyNonDerivedWatchers(newState: DerivedState, prevState: DerivedState): void {
    for (const w of watchers) {
      if (typeof w === 'function') {
        w(newState, prevState);
      } else if (!w.isDerivedWatcher) {
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
    return derivedWatchers > 0 && derivedWatchers < watcherCount;
  }

  // ========== Cascade Flush ==========

  /**
   * Called by the cascade scheduler after derivations settle.
   * Lazily derives and flushes non-derived-store watcher notifications.
   */
  function onCascadeFlush(): void {
    if (!watchers.size) return;

    // Stores without derived watchers may be invalidated but not yet derived
    // Derive now before flushing to components
    if (invalidated && !derivedWatchers) runDerive();
    if (!isInitialized(derivedState)) return;

    const prevState = isInitialized(prevStateForFlush) ? prevStateForFlush : derivedState;
    notifyNonDerivedWatchers(derivedState, prevState);

    enlistedInCascade = false;
    prevStateForFlush = UNINITIALIZED;
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
    if (!watchers.size) return;
    deriveScheduled = false;
    if (!invalidated) return;
    runDerive();
  }

  // ========== Lifecycle Helpers ==========

  function handleDestroy(isDerivedWatcher: boolean): void {
    if (!isDerivedWatcher) {
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
    if (invalidated) return;
    invalidated = true;

    if (!debouncedDerive) {
      if (derivedWatchers) {
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

      // Stores without derived watchers during active cascade: enlist for lazy derive and flush
      if (isCascadeActive()) {
        // Mark as needing derive and enlist for flush
        // The flush will check invalidated flag and derive if needed
        if (!enlistedInCascade) {
          enlistedInCascade = true;
          if (isInitialized(derivedState)) {
            prevStateForFlush = derivedState;
          }
          joinCascade(storeId, onCascadeFlush);
        }
        return;
      }
    }

    // Outside cascades (debounced or component-only stores, no active cascade)
    enqueuedAtRank = null;
    scheduleDerive();
  }

  function getSnapshot(): DerivedState {
    if (!isInitialized(derivedState)) {
      // Ensures useSyncExternalStore doesn't trigger redundant derivations
      watchers.add(dummyWatcher);
      const state = runDerive();
      watchers.delete(dummyWatcher);
      return state;
    }
    if (deriveScheduled) runScheduledDerive();
    return derivedState;
  }

  // ========== Public Methods ==========

  function getState(): DerivedState {
    if (invalidated || !isInitialized(derivedState)) {
      // If there are watchers, we should build subscriptions, otherwise compute directly
      return watchers.size > 0 ? runDerive() : deriveFunction($);
    }
    return derivedState;
  }

  function subscribe(...args: SubscribeArgs<DerivedState>): UnsubscribeFn {
    // -- Overload #1: single argument (listener)
    if (args.length === 1) {
      const listener = args[0];
      watchers.add(listener);

      if (watchers.size === 1 && !isInitialized(derivedState)) {
        getState();
      }

      return () => {
        watchers.delete(listener);
        if (!watchers.size) handleDestroy(false);
      };
    }

    // -- Overload #2: (selector, listener, { equalityFn, fireImmediately, isDerivedStore })
    const [selector, listener, options] = args;
    const equalityFn = options?.equalityFn ?? Object.is;
    const isDerivedWatcher = options?.isDerivedStore ?? false;

    const watcher: Watcher<DerivedState> = {
      currentSlice: undefined,
      equalityFn,
      isDerivedWatcher,
      listener,
      selector,
    };

    watchers.add(watcher);
    watcher.currentSlice = selector(getState());

    if (isDerivedWatcher) derivedWatchers += 1;

    if (options?.fireImmediately) listener(watcher.currentSlice, watcher.currentSlice);

    return () => {
      watchers.delete(watcher);
      if (isDerivedWatcher) derivedWatchers -= 1;
      if (!watchers.size) handleDestroy(isDerivedWatcher);
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
    derivedWatchers = 0;
    pathFinder = undefined;
    rootProxyCache = undefined;
    shouldRebuildSubscriptions = true;
    deriveScheduled = false;
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

let id = 0;

function getStoreId(): string {
  id += 1;
  return String(id);
}

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
