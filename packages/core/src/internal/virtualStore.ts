import { derivedStore } from './derivedStore';
import type { PersistedStoreApi, StoreApi } from '../store/types';
import type {
  BaseStore,
  DeriveGetter,
  DeriveOptions,
  EqualityFn,
  InferPersistedState,
  InferStoreState,
  OptionallyPersistedStore,
  SetStateArgs,
  SubscribeArgs,
  UnsubscribeFn,
} from '../types';
import { noop } from '../utils/core';
import { StoreTags, destroyStore } from '../utils/storeUtils';

type DeriveConfig = Exclude<DeriveOptions, EqualityFn<unknown>>;

// ============ Virtual Store Factory ========================================== //

/** @internal */
export function virtualStore<Store extends BaseStore<InferStoreState<Store>>, Overrides extends object = Record<string, never>>(
  createStore: ($: DeriveGetter) => Store,
  overridesOrOptions?: Pick<DeriveConfig, 'debugMode' | 'lockDependencies'> | ((getStore: () => Store) => Overrides),
  options?: Pick<DeriveConfig, 'debugMode' | 'lockDependencies'>
): Omit<StoreApi<InferStoreState<Store>>, 'setState'> & {
  destroy: () => void;
  persist: PersistedStoreApi<InferStoreState<Store>, InferPersistedState<Store>, void | Promise<void>>['persist'];
  setState: Store['setState'];
} & Overrides {
  type State = InferStoreState<Store>;

  const hasOverrides = typeof overridesOrOptions === 'function';
  const parsedOverrides = hasOverrides ? overridesOrOptions : undefined;
  const parsedOptions = hasOverrides ? options : overridesOrOptions;

  const subscriptions = new Set<{ args: SubscribeArgs<State>; unsubscribe: UnsubscribeFn }>();

  function rebindSubscriptions(oldStore: Store, newStore: Store): void {
    for (const sub of subscriptions) {
      // Detach from the old store
      sub.unsubscribe();

      const args = sub.args;

      // -- Overload #1: single argument (listener)
      if (args.length === 1) {
        const listener = args[0];
        const prev = oldStore.getState();
        const next = newStore.getState();

        // Re-subscribe to the new store
        const newUnsubscribe = newStore.subscribe(listener);
        sub.unsubscribe = newUnsubscribe;

        if (!Object.is(next, prev)) listener(next, prev);
        continue;
      }

      // -- Overload #2: (selector, listener, options?)
      const selector = args[0];
      const listener = args[1];

      let options = args[2];
      if (options?.fireImmediately) options = { ...options, fireImmediately: false };

      const prevSlice = selector(oldStore.getState());
      const nextSlice = selector(newStore.getState());

      // Re-subscribe to the new store
      const newUnsub = newStore.subscribe(selector, listener, options);
      sub.unsubscribe = newUnsub;

      const equalityFn = options?.equalityFn ?? Object.is;
      if (!equalityFn(prevSlice, nextSlice)) listener(nextSlice, prevSlice);
    }
  }

  function areStoresEqualWithRebind(previousStore: Store, store: Store): boolean {
    const areStoresEqual = Object.is(previousStore, store);
    if (!areStoresEqual) {
      rebindSubscriptions(previousStore, store);
      destroyStore(previousStore);
    }
    return areStoresEqual;
  }

  const useCachedStore = derivedStore(createStore, {
    debugMode: parsedOptions?.debugMode ?? false,
    equalityFn: areStoresEqualWithRebind,
    keepAlive: true,
    lockDependencies: parsedOptions?.lockDependencies ?? true,
  });

  function portableSubscribe(...args: SubscribeArgs<State>): UnsubscribeFn {
    const unsubscribe =
      args.length === 1 ? useCachedStore.getState().subscribe(args[0]) : useCachedStore.getState().subscribe(args[0], args[1], args[2]);

    const sub = { args, unsubscribe };
    subscriptions.add(sub);

    return () => {
      sub.unsubscribe();
      subscriptions.delete(sub);
    };
  }

  const virtualStore = Object.assign(
    {
      [StoreTags.VirtualStore]: true,
      destroy: useCachedStore.destroy,
      getInitialState: () => useCachedStore.getState().getInitialState(),
      getState: () => useCachedStore.getState().getState(),
      persist: createPersist<State, InferPersistedState<Store>>(useCachedStore.getState),
      setState: createSetState(useCachedStore.getState),
      subscribe: portableSubscribe,
    },
    parsedOverrides?.(useCachedStore.getState)
  );

  return virtualStore;
}

// ============ Helpers ======================================================== //

function createPersist<State, PersistedState extends Partial<State>>(
  getStore: () => OptionallyPersistedStore<State, PersistedState, void | Promise<void>>
): PersistedStoreApi<State, PersistedState, void | Promise<void>>['persist'] {
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
