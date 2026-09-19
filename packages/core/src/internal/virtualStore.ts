import type { StoreApi, WithPersist } from '../store/types';
import { hasCascadeStateSubscription, SUBSCRIBE_CASCADE_STATE } from './cascadeSubscriptions';
import type {
  BaseStore,
  DeriveGetter,
  InferPersistedState,
  InferStoreState,
  OptionallyPersistedStore,
  SetStateArgs,
  UnsubscribeFn,
} from '../types';
import type { Listener } from '../types/subscribe';
import { identity, noop } from '../utils/core';
import { activateCascade, flushCascade } from './cascadeScheduler';
import { derivedStore } from './derivedStore';
import type { InternalSubscribeArgs, InternalUnsubscribeFn } from './types/internalSubscribeTypes';
import { StoreTags, destroyStore } from './storeUtils';

type VirtualStoreOptions = {
  debugMode?: boolean;
  lockDependencies?: boolean;
};

const CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS = Object.freeze({ equalityFn: Object.is, isCascadeParticipant: true });

// ============ Virtual Store Factory ========================================== //

export function virtualStore<Store extends BaseStore<InferStoreState<Store>>, Overrides extends object = Record<string, never>>(
  createStore: ($: DeriveGetter) => Store,
  overridesOrOptions?: VirtualStoreOptions | ((getStore: () => Store) => Overrides),
  options?: VirtualStoreOptions
): WithPersist<StoreApi<InferStoreState<Store>>, InferPersistedState<Store>, void | Promise<void>> & { destroy: () => void } & Overrides {
  type State = InferStoreState<Store>;
  type Subscription = { args: InternalSubscribeArgs<State>; unsubscribe: InternalUnsubscribeFn };
  type CascadeStateSubscription = { listener: Listener<State>; unsubscribe: InternalUnsubscribeFn };

  const hasOverrides = typeof overridesOrOptions === 'function';
  const parsedOverrides = hasOverrides ? overridesOrOptions : undefined;
  const parsedOptions = hasOverrides ? options : overridesOrOptions;

  const ordinarySubscriptions = new Set<Subscription>();
  let cascadeSubscriptions: Set<Subscription> | undefined;
  let cascadeStateSubscriptions: Set<CascadeStateSubscription> | undefined;

  function rebindSubscriptions(oldStore: Store, newStore: Store): void {
    const prevState = oldStore.getState();
    const nextState = newStore.getState();

    if (cascadeStateSubscriptions) {
      for (const sub of cascadeStateSubscriptions) rebindCascadeStateSubscription(sub, newStore, prevState, nextState);
    }
    if (cascadeSubscriptions) for (const sub of cascadeSubscriptions) rebindCascadeSubscription(sub, newStore, prevState, nextState);
    if (ordinarySubscriptions.size) flushCascade();

    for (const sub of ordinarySubscriptions) rebindSubscription(sub, newStore, prevState, nextState);
  }

  function rebindCascadeStateSubscription(sub: CascadeStateSubscription, newStore: Store, prevState: State, nextState: State): void {
    sub.unsubscribe();
    sub.unsubscribe = subscribeStoreCascadeState(newStore, sub.listener);
    if (Object.is(nextState, prevState)) return;
    activateCascade();
    sub.listener(nextState, prevState);
  }

  function rebindCascadeSubscription(sub: Subscription, newStore: Store, prevState: State, nextState: State): void {
    if (rebindSubscription(sub, newStore, prevState, nextState)) activateCascade();
  }

  function rebindSubscription(sub: Subscription, newStore: Store, prevState: State, nextState: State): boolean {
    sub.unsubscribe();

    const args = sub.args;

    // -- Overload #1: single argument (listener)
    if (args.length === 1) {
      const listener = args[0];

      sub.unsubscribe = newStore.subscribe(listener);

      const changed = !Object.is(nextState, prevState);
      if (changed) listener(nextState, prevState);
      return changed;
    }

    // -- Overload #2: (selector, listener, options?)
    const selector = args[0];
    const listener = args[1];

    let options = args[2];
    if (options?.fireImmediately) options = { ...options, fireImmediately: false };

    const prevSlice = selector(prevState);
    const nextSlice = selector(nextState);

    sub.unsubscribe = newStore.subscribe(selector, listener, options);

    const equalityFn = options?.equalityFn ?? Object.is;
    if (equalityFn(prevSlice, nextSlice)) return false;
    listener(nextSlice, prevSlice);
    return true;
  }

  function rebindStore(store: Store, previousStore: Store): void {
    rebindSubscriptions(previousStore, store);
    destroyStore(previousStore);
  }

  const useCachedStore = derivedStore(createStore, {
    debugMode: parsedOptions?.debugMode ?? false,
    lockDependencies: parsedOptions?.lockDependencies ?? true,
  });

  let unsubscribeCachedStore: UnsubscribeFn | undefined;

  function getCurrentStore(): Store {
    unsubscribeCachedStore ??= useCachedStore.subscribe(rebindStore);
    return useCachedStore.getState();
  }

  function portableSubscribe(...args: InternalSubscribeArgs<State>): UnsubscribeFn {
    const currentStore = getCurrentStore();
    const unsubscribe = args.length === 1 ? currentStore.subscribe(args[0]) : currentStore.subscribe(args[0], args[1], args[2]);
    const sub: Subscription = { args, unsubscribe };

    const isCascadeParticipant = args[2]?.isCascadeParticipant ?? false;
    if (isCascadeParticipant) (cascadeSubscriptions ??= new Set()).add(sub);
    else ordinarySubscriptions.add(sub);

    return () => {
      sub.unsubscribe();
      if (!isCascadeParticipant) ordinarySubscriptions.delete(sub);
      else if (cascadeSubscriptions?.delete(sub) && cascadeSubscriptions.size === 0) cascadeSubscriptions = undefined;
    };
  }

  function subscribeCascadeState(listener: Listener<State>): InternalUnsubscribeFn {
    const currentStore = getCurrentStore();
    const sub: CascadeStateSubscription = { listener, unsubscribe: subscribeStoreCascadeState(currentStore, listener) };
    (cascadeStateSubscriptions ??= new Set()).add(sub);

    return skipAbortFetch => {
      sub.unsubscribe(skipAbortFetch);
      if (cascadeStateSubscriptions?.delete(sub) && cascadeStateSubscriptions.size === 0) cascadeStateSubscriptions = undefined;
    };
  }

  const virtualStore = Object.assign(
    {
      [SUBSCRIBE_CASCADE_STATE]: subscribeCascadeState,
      [StoreTags.VirtualStore]: true,
      destroy: () => {
        unsubscribeCachedStore?.();
        unsubscribeCachedStore = undefined;
        useCachedStore.destroy();
      },
      getInitialState: () => getCurrentStore().getInitialState(),
      getState: () => getCurrentStore().getState(),
      persist: createPersist<State, InferPersistedState<Store>>(getCurrentStore),
      setState: createSetState(getCurrentStore),
      subscribe: portableSubscribe,
    },
    parsedOverrides?.(getCurrentStore)
  );

  return virtualStore;
}

// ============ Helpers ======================================================== //

function subscribeStoreCascadeState<State>(store: StoreApi<State>, listener: Listener<State>): InternalUnsubscribeFn {
  return hasCascadeStateSubscription(store)
    ? store[SUBSCRIBE_CASCADE_STATE](listener)
    : store.subscribe<State>(identity, listener, CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS);
}

function createPersist<State, PersistedState>(
  getStore: () => OptionallyPersistedStore<State, PersistedState, void | Promise<void>>
): NonNullable<OptionallyPersistedStore<State, PersistedState, void | Promise<void>>['persist']> {
  return {
    clearStorage: () => getStore().persist?.clearStorage(),
    getOptions: () => getStore().persist?.getOptions() ?? {},
    hasHydrated: () => getStore().persist?.hasHydrated() ?? true,
    hydrationPromise: () => getStore().persist?.hydrationPromise?.() ?? Promise.resolve(),
    onFinishHydration: fn => getStore().persist?.onFinishHydration(fn) ?? noop,
    onHydrate: fn => getStore().persist?.onHydrate(fn) ?? noop,
    rehydrate: () => getStore().persist?.rehydrate(),
    setOptions: options => getStore().persist?.setOptions(options),
  };
}

function createSetState<State, Store extends BaseStore<State>>(getStore: () => Store): Store['setState'] {
  return function setState(...args: SetStateArgs<State>): void | Promise<void> {
    if (args[1] === true) return getStore().setState(args[0], true);
    return getStore().setState(args[0]);
  };
}
