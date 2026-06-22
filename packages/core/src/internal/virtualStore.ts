import type { StoreApi, WithPersist } from '../store/types';
import type {
  BaseStore,
  DeriveGetter,
  InferPersistedState,
  InferStoreState,
  OptionallyPersistedStore,
  SetStateArgs,
  UnsubscribeFn,
} from '../types';
import { noop } from '../utils/core';
import { activateCascade, flushCascade } from '../store/cascadeScheduler';
import { derivedStore } from './derivedStore';
import type { InternalSubscribeArgs, InternalUnsubscribeFn } from './types/internalSubscribeTypes';
import { StoreTags, destroyStore } from './storeUtils';

type VirtualStoreOptions = {
  debugMode?: boolean;
  lockDependencies?: boolean;
};

// ============ Virtual Store Factory ========================================== //

/** @internal */
export function virtualStore<Store extends BaseStore<InferStoreState<Store>>, Overrides extends object = Record<string, never>>(
  createStore: ($: DeriveGetter) => Store,
  overridesOrOptions?: VirtualStoreOptions | ((getStore: () => Store) => Overrides),
  options?: VirtualStoreOptions
): WithPersist<StoreApi<InferStoreState<Store>>, InferPersistedState<Store>, void | Promise<void>> & { destroy: () => void } & Overrides {
  type State = InferStoreState<Store>;
  type Subscription = { args: InternalSubscribeArgs<State>; unsubscribe: InternalUnsubscribeFn };

  const hasOverrides = typeof overridesOrOptions === 'function';
  const parsedOverrides = hasOverrides ? overridesOrOptions : undefined;
  const parsedOptions = hasOverrides ? options : overridesOrOptions;

  const ordinarySubscriptions = new Set<Subscription>();
  let cascadeSubscriptions: Set<Subscription> | undefined;

  function rebindSubscriptions(oldStore: Store, newStore: Store): void {
    const prevState = oldStore.getState();
    const nextState = newStore.getState();

    if (cascadeSubscriptions) for (const sub of cascadeSubscriptions) rebindCascadeSubscription(sub, newStore, prevState, nextState);
    if (ordinarySubscriptions.size) flushCascade();

    for (const sub of ordinarySubscriptions) rebindSubscription(sub, newStore, prevState, nextState);
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

      // Re-subscribe to the new store
      const newUnsubscribe = newStore.subscribe(listener);
      sub.unsubscribe = newUnsubscribe;

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

    // Re-subscribe to the new store
    const newUnsub = newStore.subscribe(selector, listener, options);
    sub.unsubscribe = newUnsub;

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
    const sub = { args, unsubscribe };

    const isCascadeParticipant = args[2]?.isCascadeParticipant ?? false;
    if (isCascadeParticipant) (cascadeSubscriptions ??= new Set()).add(sub);
    else ordinarySubscriptions.add(sub);

    return () => {
      sub.unsubscribe();
      if (!isCascadeParticipant) ordinarySubscriptions.delete(sub);
      else if (cascadeSubscriptions?.delete(sub) && cascadeSubscriptions.size === 0) cascadeSubscriptions = undefined;
    };
  }

  const virtualStore = Object.assign(
    {
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
