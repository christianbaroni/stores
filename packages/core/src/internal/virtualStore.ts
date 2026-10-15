import { createSelection, subscribeSelection, hasSelection } from './selectorSubscription';
import type { StoreApi, WithPersist } from '../store/types';
import { subscribeCascadeState as subscribeStoreCascadeState, SUBSCRIBE_CASCADE_STATE } from './cascadeSubscriptions';
import type {
  BaseStore,
  DeriveGetter,
  InferPersistedState,
  InferStoreState,
  OptionallyPersistedStore,
  SetStateArgs,
  UnsubscribeFn,
} from '../types';
import type { Listener, Selector } from '../types/subscribe';
import { noop } from '../utils/core';
import { derivedStore } from './derivedStore';
import type { InternalSubscribeArgs, InternalUnsubscribeFn, Selection } from './internalSubscriptions';
import { StoreTags, destroyStore } from './storeUtils';

// ============ Types ========================================================== //

type VirtualStoreOptions = {
  debugMode?: boolean;
  lockDependencies?: boolean;
};

type SelectedSubscription<State> = {
  selector: Selector<State, unknown>;
  selection: Selection<unknown>;
  /**
   * The current unsubscribe callback, `undefined` while reconnecting, or the
   * saved `skipAbortFetch` value after cancellation.
   */
  unsubscribe: InternalUnsubscribeFn | boolean | undefined;
};

type StateSubscription<State> = { listener: Listener<State>; unsubscribe: InternalUnsubscribeFn };

// ============ Virtual Store Factory ========================================== //

export function virtualStore<Store extends BaseStore<InferStoreState<Store>>, Overrides extends object = Record<string, never>>(
  createStore: ($: DeriveGetter) => Store,
  overridesOrOptions?: VirtualStoreOptions | ((getStore: () => Store) => Overrides),
  options?: VirtualStoreOptions
): WithPersist<StoreApi<InferStoreState<Store>>, InferPersistedState<Store>, void | Promise<void>> & { destroy: () => void } & Overrides {
  type State = InferStoreState<Store>;
  type Subscription = SelectedSubscription<State> | StateSubscription<State>;

  const hasOverrides = typeof overridesOrOptions === 'function';
  const parsedOverrides = hasOverrides ? overridesOrOptions : undefined;
  const parsedOptions = hasOverrides ? options : overridesOrOptions;

  const ordinarySubscriptions = new Set<Subscription>();
  let cascadeSubscriptions: Set<Subscription> | undefined;

  function rebindSubscriptions(subscriptions: Set<Subscription>, store: Store, previousStore: Store, cascade = false): void {
    let previous!: State;
    let readPrevious = false;

    for (const sub of subscriptions) {
      if ('selection' in sub) {
        const previousUnsubscribe = sub.unsubscribe;
        sub.unsubscribe = undefined;

        if (typeof previousUnsubscribe === 'function') previousUnsubscribe();
        if (typeof sub.unsubscribe === 'boolean') continue;

        const selection = sub.selection;
        const unsubscribe = subscribeSelection(store, sub.selector, { selection, isCascadeParticipant: cascade }, true);

        if (typeof sub.unsubscribe === 'boolean') {
          unsubscribe(sub.unsubscribe);
          continue;
        }

        sub.unsubscribe = unsubscribe;
        selection.refresh();
      } else {
        if (!readPrevious) {
          previous = previousStore.getState();
          store.getState();
          readPrevious = true;
        }

        sub.unsubscribe();
        sub.unsubscribe = cascade ? subscribeStoreCascadeState(store, sub.listener) : store.subscribe(sub.listener);
        const current = store.getState();

        if (!Object.is(current, previous)) sub.listener(current, previous);
      }
    }
  }

  function rebindCascadeStore(store: Store, previousStore: Store): void {
    if (cascadeSubscriptions) rebindSubscriptions(cascadeSubscriptions, store, previousStore, true);
  }

  function rebindStore(store: Store, previousStore: Store): void {
    if (ordinarySubscriptions.size) rebindSubscriptions(ordinarySubscriptions, store, previousStore);
    destroyStore(previousStore);
  }

  const useCachedStore = derivedStore(createStore, {
    debugMode: parsedOptions?.debugMode ?? false,
    lockDependencies: parsedOptions?.lockDependencies ?? true,
  });

  let unsubscribeCachedStore: UnsubscribeFn | undefined;
  let unsubscribeCachedCascadeStore: UnsubscribeFn | undefined;

  function getCurrentStore(): Store {
    unsubscribeCachedStore ??= useCachedStore.subscribe(rebindStore);
    return useCachedStore.getState();
  }

  function portableSubscribe(...args: InternalSubscribeArgs<State>): InternalUnsubscribeFn {
    const currentStore = getCurrentStore();

    if (args.length === 1) {
      const sub: StateSubscription<State> = { listener: args[0], unsubscribe: currentStore.subscribe(args[0]) };
      ordinarySubscriptions.add(sub);
      return skipAbortFetch => {
        sub.unsubscribe(skipAbortFetch);
        ordinarySubscriptions.delete(sub);
      };
    }

    const options = args[2];
    const isCascadeParticipant = options?.isCascadeParticipant ?? false;
    const subscribeOptions = hasSelection(options)
      ? options
      : { selection: createSelection(args[1], options), isCascadeParticipant, fireImmediately: options?.fireImmediately };

    const unsubscribe = subscribeSelection(currentStore, args[0], subscribeOptions);
    const sub: SelectedSubscription<State> = { selector: args[0], selection: subscribeOptions.selection, unsubscribe };

    if (isCascadeParticipant) {
      (cascadeSubscriptions ??= new Set()).add(sub);
      unsubscribeCachedCascadeStore ??= subscribeStoreCascadeState(useCachedStore, rebindCascadeStore);
    } else ordinarySubscriptions.add(sub);

    return skipAbortFetch => {
      if (!isCascadeParticipant) ordinarySubscriptions.delete(sub);
      else if (cascadeSubscriptions?.delete(sub) && cascadeSubscriptions.size === 0) cascadeSubscriptions = undefined;

      const unsubscribe = sub.unsubscribe;
      sub.unsubscribe = skipAbortFetch ?? false;
      if (typeof unsubscribe === 'function') unsubscribe(skipAbortFetch);
    };
  }

  function subscribeCascadeState(listener: Listener<State>): InternalUnsubscribeFn {
    const currentStore = getCurrentStore();
    listener = listener.bind(undefined);

    const sub: StateSubscription<State> = { listener, unsubscribe: subscribeStoreCascadeState(currentStore, listener) };
    (cascadeSubscriptions ??= new Set()).add(sub);
    unsubscribeCachedCascadeStore ??= subscribeStoreCascadeState(useCachedStore, rebindCascadeStore);

    return skipAbortFetch => {
      sub.unsubscribe(skipAbortFetch);
      if (cascadeSubscriptions?.delete(sub) && cascadeSubscriptions.size === 0) cascadeSubscriptions = undefined;
    };
  }

  const virtualStore = Object.assign(
    {
      destroy: () => {
        unsubscribeCachedCascadeStore?.();
        unsubscribeCachedCascadeStore = undefined;
        unsubscribeCachedStore?.();
        unsubscribeCachedStore = undefined;
        useCachedStore.destroy();
      },
      getInitialState: () => getCurrentStore().getInitialState(),
      getState: () => getCurrentStore().getState(),
      persist: createPersist<State, InferPersistedState<Store>>(getCurrentStore),
      setState: createSetState(getCurrentStore),
      subscribe: portableSubscribe,
      [SUBSCRIBE_CASCADE_STATE]: subscribeCascadeState,
      [StoreTags.VirtualStore]: true,
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
