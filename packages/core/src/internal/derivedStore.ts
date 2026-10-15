import { IS_DEV } from '#env';
import type { StoreApi } from '../store/types';
import type { DebounceOptions, DeriveGetter, DeriveOptions, EqualityFn, Listener, Selector, WithGetSnapshot } from '../types';
import { BivariantMethod } from '../types/functions';
import { identity, noop } from '../utils/core';
import { debounce } from '../utils/debounce';
import { pluralize } from '../utils/stringUtils';
import {
  activateCascade,
  enqueueDerive,
  getCurrentDeriveRank,
  isCascadeActive,
  joinCascade,
  settleCascadeDerivations,
} from './cascadeScheduler';
import { CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS, SUBSCRIBE_CASCADE_STATE } from './cascadeSubscriptions';
import { DependencySubscriptions } from './derivedStore/dependencySubscriptions';
import { getOrCreateProxy, stripProxies } from './derivedStore/deriveProxy';
import { DerivedSubscribers, type DerivedWatcher } from './derivedStore/derivedSubscribers';
import { PathFinder } from './derivedStore/pathFinder';
import type { InternalSubscribeOptions, InternalUnsubscribeFn } from './internalSubscriptions';
import { connectSelection, notifyInitial } from './selectorSubscription';
import { READ_DEPENDENCY_STATE } from './storeUtils';

// ============ Types ========================================================== //

type MaybeDerivedStore<State> = Pick<StoreApi<State>, 'getState'> & { readonly [READ_DEPENDENCY_STATE]?: () => State };
type UninitializedState = typeof UNINITIALIZED;
type CascadeFlushState<State> = State | UninitializedState | typeof NO_CASCADE_FLUSH;

// ============ Constants ====================================================== //

const enum DerivePhase {
  Idle,
  Computing,
  Attaching,
}

const UNINITIALIZED = Symbol();
const NO_CASCADE_FLUSH = Symbol();

// ============ Store Creator ================================================== //

export function derivedStore<DerivedState>(
  deriveFunction: ($: DeriveGetter) => DerivedState,
  optionsOrEqualityFn: DeriveOptions<DerivedState> = Object.is
): WithGetSnapshot<StoreApi<DerivedState>> & { destroy: () => void } {
  let debounceOptions: number | DebounceOptions | undefined;
  let debugMode: boolean | 'verbose' = false;
  let equalityFn: EqualityFn<DerivedState>;
  let keepAlive = false;
  let lockDependencies = false;

  if (typeof optionsOrEqualityFn === 'function') equalityFn = optionsOrEqualityFn;
  else {
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
  let derivePhase = DerivePhase.Idle;
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
      if (!pathFinder) pathFinder = new PathFinder();
      return getOrCreateProxy(store, snapshot, rootProxyCache, pathFinder);
    }

    // -- Overload #2: $(store, selector, equalityFn?)
    // No proxy, just a direct subscription to the store
    const subscribeOptions = equalityFn ? { equalityFn, isCascadeParticipant: true } : CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS;
    dependencies.addSelector(store.subscribe(selector, invalidate, subscribeOptions));
    return selector(readDependencyState(store));
  }

  // ========== Derivation ==========

  function runDerive(): DerivedState {
    invalidated = false;

    if (shouldRebuildSubscriptions) dependencies.beginRebuild(true);
    let newState: DerivedState;
    const prevState = derivedState;
    const hasPreviousState = isInitialized(prevState);

    derivePhase = DerivePhase.Computing;
    try {
      const derived = deriveFunction($);
      newState = pathFinder ? stripProxies(derived) : derived;
    } finally {
      derivePhase = DerivePhase.Idle;
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
      derivePhase = DerivePhase.Attaching;
      try {
        if (
          pathFinder.buildProxySubscriptions(
            (store, selector) => {
              dependencies.addSelector(store.subscribe(selector, invalidate, CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS));
            },
            shouldLogSubscriptions,
            readDependencyState
          )
        )
          invalidated = true;
      } finally {
        derivePhase = DerivePhase.Idle;
      }

      // Reset proxy tracking state
      rootProxyCache = undefined;
      if (lockDependencies) pathFinder = undefined;
      else pathFinder.reset();

      if (invalidated) return getSnapshot();
    }

    if (lockDependencies) shouldRebuildSubscriptions = false;
    if (hasPreviousState && equalityFn(prevState, newState)) {
      if (debugMode) console.log('[🥷 Derive Complete 🥷]: No change detected');
      return prevState;
    }

    derivedState = newState;
    if (hasPreviousState) notifyWatchers(newState, prevState);
    return newState;
  }

  // ========== Notifications ==========

  function notifyWatchers(newState: DerivedState, prevState: DerivedState): void {
    const cascadeParticipantCount = subscribers.cascadeParticipantCount;
    const ordinaryWatcherCount = subscribers.ordinaryWatcherCount;

    if (cascadeParticipantCount && ordinaryWatcherCount) activateCascade();
    const shouldDefer = ordinaryWatcherCount > 0 && isCascadeActive();

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

  function runScheduledDerive(): void {
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
    if (derivePhase !== DerivePhase.Idle) {
      if (derivePhase === DerivePhase.Attaching) invalidated = true;
      return;
    }

    if (!debouncedDerive && subscribers.cascadeParticipantCount) {
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

    if (debouncedDerive) {
      debouncedDerive();
    } else {
      activateCascade();
      if (prevStateForFlush === NO_CASCADE_FLUSH) {
        prevStateForFlush = UNINITIALIZED;
        joinCascade(onCascadeFlush);
      }
    }
  }

  // ========== Snapshots ==========

  function getSnapshot(): DerivedState {
    if (!invalidated && isInitialized(derivedState)) return derivedState;
    if (dependencyConsumerCount) return runDerive();

    dependencyConsumerCount += 1;
    try {
      return runDerive();
    } finally {
      dependencyConsumerCount -= 1;
      if (!dependencyConsumerCount) queueMicrotask(handleDestroy);
    }
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

  function subscribe(
    selectorOrListener: BivariantMethod<{ callback(state: DerivedState, previousState: DerivedState): unknown }>,
    listener?: Listener<unknown>,
    options?: InternalSubscribeOptions<unknown>
  ): InternalUnsubscribeFn {
    const selection = options?.selection;
    const isCascadeParticipant = options?.isCascadeParticipant ?? false;

    let watcher: DerivedWatcher<DerivedState> | undefined;
    dependencyConsumerCount += 1;

    try {
      if (!listener) {
        if (isCascadeParticipant || !isInitialized(derivedState)) getState();
        watcher = selectorOrListener;
      } else if (selection) {
        getState();
        watcher = connectSelection(selection, selectorOrListener, getSnapshot);
      } else {
        const selector: BivariantMethod<{ select(state: DerivedState, previousState?: DerivedState): unknown }> = selectorOrListener;
        const equalityFn = options?.equalityFn ?? Object.is;
        const currentSlice = selector(getState());
        watcher = { currentSlice, equalityFn, isCascadeParticipant, listener, selector };
      }

      if (!subscribers.add(watcher, isCascadeParticipant)) dependencyConsumerCount -= 1;

      if (listener && options?.fireImmediately) {
        if (selection) notifyInitial(selection);
        else if (typeof watcher !== 'function') listener(watcher.currentSlice, watcher.currentSlice);
      }
    } catch (error) {
      if (watcher) subscribers.delete(watcher, isCascadeParticipant);
      dependencyConsumerCount -= 1;
      if (!dependencyConsumerCount) queueMicrotask(handleDestroy);
      throw error;
    }

    return () => {
      const removed = subscribers.delete(watcher, isCascadeParticipant);
      if (!removed) return;

      dependencyConsumerCount -= 1;
      if (!dependencyConsumerCount) handleDestroy(isCascadeParticipant);
    };
  }

  function subscribeCascadeState(listener: Listener<DerivedState>): InternalUnsubscribeFn {
    return subscribe(listener, undefined, CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS);
  }

  function destroy(): void {
    debouncedDerive?.cancel();
    dependencies.clear();
    subscribers.clear();
    dependencyConsumerCount = 0;
    pathFinder = undefined;
    rootProxyCache = undefined;
    shouldRebuildSubscriptions = true;
    derivePhase = DerivePhase.Idle;
    invalidated = true;
    derivedState = UNINITIALIZED;
    prevStateForFlush = NO_CASCADE_FLUSH;
    enqueuedAtRank = null;
  }

  const api = {
    destroy,
    getSnapshot,
    getState,
    subscribe,
    // -- Not applicable to derived stores
    getInitialState: unavailableGetInitialState,
    setState: unavailableSetState,
    [READ_DEPENDENCY_STATE]: getSnapshot,
    [SUBSCRIBE_CASCADE_STATE]: subscribeCascadeState,
  };

  return debounceOptions === undefined
    ? api
    : Object.assign(
        api,
        debouncedDerive
          ? {
              flushUpdates(): void {
                if (dependencyConsumerCount) debouncedDerive.flush();
              },
            }
          : { flushUpdates: noop }
      );
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
