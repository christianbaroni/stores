import { createDerivedStore, DeriveGetter } from './createDerivedStore';
import {
  BaseStore,
  DeriveOptions,
  EqualityFn,
  InferPersistedState,
  InferSetStateReturn,
  InferStoreState,
  OptionallyPersistedStore,
  PersistedStore,
  Selector,
  Store as StoreType,
  SubscribeArgs,
  UnsubscribeFn,
} from './types';
import { destroyStore } from './utils/storeUtils';

type MethodOverrides<Store extends BaseStore<State>, State = InferStoreState<Store>> = Partial<Pick<Store, 'getState' | 'setState'>>;

type PortableSubscription<Store extends BaseStore<State>, State = InferStoreState<Store>> = {
  args: SubscribeArgs<State>;
  unsubscribe: UnsubscribeFn;
};

type VirtualStoreOptions = {
  debugMode?: boolean;
  /**
   * Whether to lock dependencies (see: {@link DeriveOptions}) for the virtual store.
   * @default true
   */
  lockDependencies?: boolean;
};

/**
 * ### `createVirtualStore`
 *
 * Returns a stable store interface backed by different store instances over time.
 * When dependencies change, the derive function runs and creates a new store, then
 * all subscriptions rebind automatically. Only depend on state that should trigger
 * new store creation.
 *
 * ---
 * 💡 **Note:** `lockDependencies` (see: {@link DeriveOptions}) is enabled by default.
 * Ensure that any `$` dependencies in your `createStore` function are called
 * consistently. If they are not, set `lockDependencies` to `false`.
 *
 * ---
 * @param createStore - Derive function that returns a store instance
 * @param overrides - Optional method overrides (e.g., `getState(id?: string)`)
 *
 * @example
 * ```ts
 * const useUserAssetsStore = createVirtualStore($ => {
 *   const address = $(useWalletsStore).accountAddress;
 *   return createUserAssetsStore(address);
 * });
 * ```
 */
export function createVirtualStore<Store extends BaseStore<InferStoreState<Store>>>(
  createStore: ($: DeriveGetter) => Store,
  options?: VirtualStoreOptions
): OptionallyPersistedStore<InferStoreState<Store>, InferPersistedState<Store, InferStoreState<Store>>, InferSetStateReturn<Store>>;

export function createVirtualStore<Store extends BaseStore<InferStoreState<Store>>, Overrides extends MethodOverrides<Store>>(
  createStore: ($: DeriveGetter) => Store,
  overrides: (getStore: () => Store) => Overrides,
  options?: VirtualStoreOptions
): OptionallyPersistedStore<InferStoreState<Store>, InferPersistedState<Store, InferStoreState<Store>>, InferSetStateReturn<Store>> &
  Overrides;

export function createVirtualStore<
  Store extends BaseStore<InferStoreState<Store>>,
  Overrides extends MethodOverrides<Store> = Record<string, never>,
>(
  createStore: ($: DeriveGetter) => Store,
  overridesOrOptions?: VirtualStoreOptions | ((getStore: () => Store) => Overrides),
  options?: VirtualStoreOptions
):
  | StoreType<InferStoreState<Store>, InferPersistedState<Store, InferStoreState<Store>>, false, InferSetStateReturn<Store>>
  | (BaseStore<InferStoreState<Store>, false> & Overrides) {
  type State = InferStoreState<Store>;
  type Subscription = PortableSubscription<Store, State>;

  const hasOverrides = typeof overridesOrOptions === 'function';
  const parsedOverrides = hasOverrides ? overridesOrOptions : undefined;
  const parsedOptions = hasOverrides ? options : overridesOrOptions;

  const subscriptions = new Set<Subscription>();

  function rebindSubscriptions(oldStore: Store, newStore: Store): void {
    for (const sub of subscriptions) {
      // Detach from the old store
      sub.unsubscribe();

      const args = sub.args;

      /* ────────── Listener-only overload ────────── */
      if (args.length === 1) {
        const listener = args[0];
        const prev = oldStore.getState();
        const next = newStore.getState();

        // Re-subscribe to the new store
        const newUnsubscribe = newStore.subscribe(listener);
        sub.unsubscribe = newUnsubscribe;
        // Trigger the listener to handle the store change
        if (!Object.is(next, prev)) listener(next, prev);
        continue;
      }

      /* ────────── Selector overload ────────── */
      const selector = args[0];
      const listener = args[1];

      let options = args[2];
      if (options?.fireImmediately) options = { ...options, fireImmediately: false };
      const equalityFn = options?.equalityFn ?? Object.is;

      const prevSlice = selector(oldStore.getState());
      const nextSlice = selector(newStore.getState());

      // Re-subscribe to the new store
      const newUnsub = newStore.subscribe(...args);
      sub.unsubscribe = newUnsub;
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

  const useCachedStore = createDerivedStore(createStore, {
    debugMode: parsedOptions?.debugMode ?? false,
    equalityFn: areStoresEqualWithRebind,
    keepAlive: true,
    lockDependencies: parsedOptions?.lockDependencies ?? true,
  });

  function portableSubscribe(...args: SubscribeArgs<State>): UnsubscribeFn {
    const unsubscribe = args.length === 1 ? useCachedStore.getState().subscribe(args[0]) : useCachedStore.getState().subscribe(...args);
    const sub: Subscription = {
      args,
      unsubscribe,
    };
    subscriptions.add(sub);
    return () => {
      sub.unsubscribe();
      subscriptions.delete(sub);
    };
  }

  function useVirtualStore(): State;
  function useVirtualStore<T>(selector: Selector<State, T>, equalityFn?: EqualityFn<T>): T;
  function useVirtualStore<T>(selector?: Selector<State, T>, equalityFn?: EqualityFn<T>): State | T {
    const store = useCachedStore();
    return selector ? store(selector, equalityFn) : store();
  }

  const persist = createPersist(() => useCachedStore.getState());
  const setStateProxy = createSetState(useCachedStore.getState);

  const base = Object.assign(
    useVirtualStore,
    {
      _isVirtualStore: true,
      destroy: () => useCachedStore.destroy(),
      getInitialState: () => useCachedStore.getState().getInitialState(),
      getState: () => useCachedStore.getState().getState(),
      persist,
      setState: setStateProxy,
      subscribe: portableSubscribe,
    },
    parsedOverrides ? parsedOverrides(useCachedStore.getState) : undefined
  );

  return base;
}

function createPersist<Store extends OptionallyPersistedStore<State, PersistedState>, PersistedState, State = InferStoreState<Store>>(
  getStore: () => Store
): PersistedStore<State, PersistedState>['persist'] | undefined {
  return getStore().persist;
}

function createSetState<Store extends BaseStore<State>, State = InferStoreState<Store>>(getStore: () => Store): Store['setState'] {
  return function setState(update: Parameters<Store['setState']>[0], replace?: boolean): void | Promise<void> {
    if (!replace) return getStore().setState(update);
    return getStore().setState(update, replace);
  };
}
