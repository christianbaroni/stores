import { Mutate, StateCreator as ZustandStateCreator, StoreApi } from 'zustand';
import { PersistOptions } from 'zustand/middleware';
import { UseBoundStoreWithEqualityFn } from 'zustand/traditional';
import { StorageValue } from './storage/storageTypes';
import { SyncConfig } from './sync/types';

// ============ Middleware Helpers ============================================= //

type SubscribeWithSelector = ['zustand/subscribeWithSelector', never];

type HydrationPromise<PersistReturn> =
  PersistReturn extends Promise<void>
    ? {
        /** Invoke to get a promise that resolves once hydration completes. */
        hydrationPromise: () => Promise<void>;
      }
    : { hydrationPromise?: undefined };

type WithPersist<Store, PersistedState, PersistReturn> = Store extends {
  getState: () => infer S;
  setState: {
    (...args: infer SetPartialArgs): infer _;
    (...args: infer SetFullArgs): infer _;
  };
}
  ? {
      setState(...args: SetPartialArgs): PersistReturn;
      setState(...args: SetFullArgs): PersistReturn;
      persist: {
        clearStorage: () => void;
        getOptions: () => Partial<PersistOptions<S, PersistedState>>;
        hasHydrated: () => boolean;
        onHydrate: (listener: (state: S) => void) => () => void;
        onFinishHydration: (listener: (state: S) => void) => () => void;
        rehydrate: () => Promise<void> | void;
        setOptions: (options: Partial<PersistOptions<S, PersistedState, PersistReturn>>) => void;
      } & HydrationPromise<PersistReturn>;
    }
  : never;

// ============ Core Store Types =============================================== //

export type StateCreator<S, U = S> = ZustandStateCreator<S, [SubscribeWithSelector], [SubscribeWithSelector], U>;

export type BaseStore<S, ExtraSubscribeOptions extends boolean = false> = UseBoundStoreWithEqualityFn<
  Mutate<StoreApi<S>, [SubscribeWithSelector]>
> & {
  subscribe: SubscribeOverloads<S, ExtraSubscribeOptions>;
};

export type PersistedStore<S, PersistedState = Partial<S>, PersistReturn = unknown, ExtraSubscribeOptions extends boolean = false> = {
  (): S;
  <U>(selector: (state: S) => U, equalityFn?: (a: U, b: U) => boolean): U;
} & Omit<BaseStore<S, ExtraSubscribeOptions>, 'setState' | 'persist'> &
  WithPersist<BaseStore<S, ExtraSubscribeOptions>, PersistedState, PersistReturn>;

export type Store<S, PersistedState extends Partial<S> = never, PersistReturn = unknown, ExtraSubscribeOptions extends boolean = false> = [
  PersistedState,
] extends [never]
  ? BaseStore<S, ExtraSubscribeOptions>
  : PersistedStore<S, PersistedState, PersistReturn, ExtraSubscribeOptions>;

export type OptionallyPersistedStore<S, PersistedState, PersistReturn = void> = WithAsyncSet<Store<S>, S, PersistedState, PersistReturn> &
  UseStoreCallSignatures<S> & {
    persist?: PersistedStore<S, PersistedState, PersistReturn, false>['persist'];
  };

// ============ Common Utility Types =========================================== //

export type NoInfer<T> = [T][T extends unknown ? 0 : never];
export type Timeout = ReturnType<typeof setTimeout>;

export type Listener<S> = (state: S, prevState: S) => void;
export type Selector<S, Selected> = (state: S) => Selected;
export type EqualityFn<T = unknown> = (a: T, b: T) => boolean;

export type UseStoreCallSignatures<S> = {
  (): S;
  <Selected>(selector: Selector<S, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
};

export type InferStoreState<Store extends StoreApi<unknown>> = Store extends {
  getState: () => infer T;
}
  ? T
  : never;

/**
 * Extracts the return type of setState from a store.
 * Returns `void` for non-persisted or sync-persisted stores.
 * Returns `Promise<void>` for async-persisted stores.
 */
export type InferSetStateReturn<Store> = Store extends { setState(...args: SetStateArgs<infer S>): infer R } ? R : void;

/**
 * Extracts the PersistedState type from a store's persist property.
 * Returns `Partial<State>` if the store doesn't have persistence.
 */
export type InferPersistedState<Store, State> = Store extends { persist: { getOptions: () => infer Options } }
  ? Options extends { name?: string }
    ? Partial<State>
    : Partial<State>
  : Partial<State>;

// ============ Set State Types ================================================ //

export type SetPartial<S> = Partial<S> | ((state: S) => Partial<S>);
export type SetFull<S> = S | ((state: S) => S);

export type SetStateReplaceArgs<S, ExtraArgs extends unknown[] = []> = [update: SetFull<S>, replace: true, ...extraArgs: ExtraArgs];
export type SetStatePartialArgs<S, ExtraArgs extends unknown[] = []> = [update: SetPartial<S>, replace?: false, ...extraArgs: ExtraArgs];

export type SetStateArgs<S, ExtraArgs extends unknown[] = []> = SetStatePartialArgs<S, ExtraArgs> | SetStateReplaceArgs<S, ExtraArgs>;
export type SetState<S, ExtraArgs extends unknown[] = [], PersistReturn extends Promise<void> | void = void> = (
  ...args: SetStateArgs<S, ExtraArgs>
) => PersistReturn;

export type SetStateOverloads<S, PersistReturn extends Promise<void> | void = void> = {
  (update: SetPartial<S>, replace?: false): PersistReturn;
  (update: SetFull<S>, replace: true): PersistReturn;
};

export type WithAsyncSet<Store extends StoreApi<unknown>, S, PersistedState, PersistReturn> = Omit<Store, 'persist' | 'setState'> & {
  persist?: PersistedStore<S, PersistedState, PersistReturn, false>['persist'];
  setState(update: SetPartial<InferStoreState<Store>>, replace?: false): PersistReturn;
  setState(update: SetFull<InferStoreState<Store>>, replace: true): PersistReturn;
};

// ============ Subscribe Types ================================================ //

export type SubscribeOptions<Selected> = {
  equalityFn?: EqualityFn<Selected>;
  fireImmediately?: boolean;
  isDerivedStore?: boolean;
};

export type ListenerArgs<S> = [listener: Listener<S>];
export type SelectorArgs<S, Selected> = [
  selector: Selector<S, Selected>,
  listener: Listener<Selected>,
  options?: SubscribeOptions<Selected>,
];

export type SubscribeOverloads<S, ExtraOptions extends boolean = false> = {
  (listener: Listener<S>): UnsubscribeFn<ExtraOptions>;
  <Selected>(
    selector: Selector<S, Selected>,
    listener: Listener<Selected>,
    options?: SubscribeOptions<Selected>
  ): UnsubscribeFn<ExtraOptions>;
};

export type SubscribeArgs<S, Selected = unknown> = ListenerArgs<S> | SelectorArgs<S, Selected>;
export type UnsubscribeFn<Options extends boolean = false> = Options extends true ? (skipAbortFetch?: boolean) => void : () => void;
export type SubscribeFn<S, Selected = S> = (...args: SubscribeArgs<S, Selected>) => UnsubscribeFn;

// ============ Derived Store Types ============================================ //

export type DerivedStore<S> = WithFlushUpdates<ReadOnlyDerivedStore<BaseStore<S>>>;

export type WithFlushUpdates<Store extends StoreApi<unknown>> = Store & {
  /**
   * Destroy the derived store and its subscriptions.
   *
   * Derived stores automatically clean up internal resources and subscriptions
   * when no subscribers exist. So calling `destroy()` is usually unnecessary,
   * unless `keepAlive: true` is specified and explict teardown is desired.
   */
  destroy: () => void;
  /**
   * Flush all pending updates — only applicable to **debounced** derived stores.
   */
  flushUpdates: () => void;
};

export type WithGetSnapshot<Store extends StoreApi<unknown>> = Store & {
  /**
   * Provided to `useSyncExternalStoreWithSelector` to ensure it activates the derived
   * store when it gets the initial state before subscribing to the store.
   */
  getSnapshot: () => InferStoreState<Store>;
};

type ReadOnlyDerivedStore<Store extends BaseStore<unknown>> = Omit<Store, 'getInitialState' | 'setState'> &
  UseStoreCallSignatures<InferStoreState<Store>> & {
    /**
     * @deprecated **Not applicable to derived stores.** Will throw an error.
     */
    getInitialState: Store['getInitialState'];
    /**
     * @deprecated **Not applicable to derived stores.** Will throw an error.
     */
    setState: Store['setState'];
  };

/**
 * Configuration for creating derived stores. You can pass either:
 *  - A **function** (used as `equalityFn`), or
 *  - An **object** with the fields below
 */
export type DeriveOptions<DerivedState = unknown> =
  | EqualityFn<DerivedState>
  | {
      /**
       * Delay before triggering a re-derive when dependencies change.
       * Accepts a number (ms) or debounce options:
       *
       * `{ delay: number, leading?: boolean, trailing?: boolean, maxWait?: number }`
       * @default 0
       */
      debounce?: number | DebounceOptions;

      /**
       * If `true`, the store will log debug messages to the console.
       *
       * If `'verbose'`, the store will log the subscriptions it creates each time the derive
       * function is run, rather than only the first time.
       * @default false
       */
      debugMode?: boolean | 'verbose';

      /**
       * A custom comparison function for detecting state changes.
       * @default `Object.is`
       */
      equalityFn?: EqualityFn<DerivedState>;

      /**
       * If `true`, the derived store will never destroy itself. Useful in cases where your
       * derived store serves as a permanent cache subscribed to intermittently or not at all.
       * Manual calls to `destroy` *will* destroy the store even when `keepAlive` is `true`.
       *
       * *Use this option carefully.*
       * @default false
       */
      keepAlive?: boolean;

      /**
       * Locks the dependency graph after the first derivation. Subscriptions to
       * underlying stores are established once and reused on subsequent runs, rather
       * than being torn down and rebuilt (the default behavior).
       *
       * This avoids the overhead of regenerating selectors and prevents unnecessary
       * subscription churn. However, it means only the *initially tracked* dependencies
       * will trigger updates — even if your derive function conditionally reads different
       * stores in later runs.
       *
       * **Requirement**: All `$` calls in your derive function must be consistent and
       * top level. Conditional dependency tracking will not work correctly.
       *
       * Safe to enable for most derived stores where dependencies are static.
       *
       * @default false
       */
      lockDependencies?: boolean;
    };

// ============ Persistence Types ============================================== //

export type Deserializer<SerializedState, PersistedState> = (serializedState: SerializedState) => StorageValue<PersistedState>;
export type Serializer<SerializedState> = <PersistedState>(storageValue: StorageValue<PersistedState>) => SerializedState;

/**
 * Synchronous storage interface.
 * Used for localStorage and MMKV implementations.
 */
export interface SyncStorageInterface<SerializedState = unknown> {
  readonly async?: false;
  /**
   * Adapter-level deserializer used when a store does not supply its own.
   * Acts as the default before falling back to the framework implementation.
   */
  readonly deserializer?: <PersistedState>(serializedState: SerializedState) => StorageValue<PersistedState>;
  /**
   * Adapter-level serializer used when a store does not supply its own.
   * Acts as the default before falling back to the framework implementation.
   */
  readonly serializer?: <PersistedState>(storageValue: StorageValue<PersistedState>) => SerializedState;
  clearAll(): void;
  contains(key: string): boolean;
  delete(key: string): void;
  get(key: string): SerializedState | undefined;
  getAllKeys(): string[];
  set(key: string, value: SerializedState): void;
}

/**
 * Asynchronous storage interface.
 * Used for Chrome storage and other async storage implementations.
 */
export type AsyncStorageInterface<SerializedState = unknown> = {
  readonly async: true;
  /**
   * Adapter-level deserializer used when a store does not supply its own.
   * Acts as the default before falling back to the framework implementation.
   */
  readonly deserializer?: <PersistedState>(serializedState: SerializedState) => StorageValue<PersistedState>;
  /**
   * Adapter-level serializer used when a store does not supply its own.
   * Acts as the default before falling back to the framework implementation.
   */
  readonly serializer?: <PersistedState>(storageValue: StorageValue<PersistedState>) => SerializedState;
  clearAll(): Promise<void>;
  contains(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<SerializedState | undefined>;
  getAllKeys(): Promise<string[]>;
  set(key: string, value: SerializedState): Promise<void>;
};

/**
 * Configuration options for creating a persistable store.
 */
export type PersistConfig<S, PersistedState = Partial<S>, PersistReturn = void> = {
  /**
   * A function to convert the serialized value back into the state object.
   * If not provided, the storage adapter's `deserializer` is used before falling back to the default implementation.
   */
  deserializer?: <SerializedState>(serializedState: SerializedState) => StorageValue<PersistedState>;

  /**
   * A function to merge persisted state with current state during hydration.
   * By default, zustand does a shallow merge, but this allows custom logic for deep merging nested objects.
   */
  merge?: PersistOptions<S, PersistedState>['merge'];

  /**
   * A function to perform persisted state migration.
   * This function will be called when persisted state versions mismatch with the one specified here.
   */
  migrate?: PersistOptions<S, PersistedState>['migrate'];

  /**
   * A function returning another (optional) function.
   * The main function will be called before the state rehydration.
   * The returned function will be called after the state rehydration or when an error occurred.
   */
  onRehydrateStorage?: PersistOptions<S, PersistedState>['onRehydrateStorage'];

  /**
   * A function that determines which parts of the state should be persisted.
   * By default, the entire state is persisted.
   */
  partialize?: (state: S) => PersistedState;

  /**
   * The throttle rate for the persist operation in milliseconds.
   * @default iOS: time.seconds(3) | Android: time.seconds(5)
   */
  persistThrottleMs?: PersistReturn extends Promise<unknown> ? undefined : number;

  /**
   * A function to serialize the state and version for storage.
   * If not provided, the storage adapter's `serializer` is used before falling back to the default implementation.
   */
  serializer?: <SerializedState>(storageValue: StorageValue<PersistedState>) => SerializedState;

  /**
   * Custom storage implementation. If async, `setState` will return a Promise that resolves
   * when the state is persisted. If sync, `setState` will return void.
   */
  storage?: PersistReturn extends Promise<unknown> ? AsyncStorageInterface : SyncStorageInterface;

  /**
   * The unique key for the persisted store.
   */
  storageKey: string;

  /**
   * The version of the store's schema.
   * Useful for handling schema changes across app versions.
   * @default 0
   */
  version?: number;
};

export type EnforceStorageKey<Options> = { storageKey: string } extends Options ? Options : never;

// ============ Store Options ================================================== //

export type BaseStoreOptions<S, PersistedState = Partial<S>, PersistReturn = void> =
  | (PersistConfig<S, PersistedState, PersistReturn> & { sync?: S extends Record<string, unknown> ? SyncOption<S> : undefined })
  | ({
      sync: S extends Record<string, unknown> ? SyncWithoutStorageOption<NoInfer<S>> : undefined;
    } & UndefinedPersistKeys<S, PersistedState, PersistReturn>);

/**
 * The `sync` option can be:
 * - `SyncConfig` object
 * - `string` (shorthand for `{ key: string }`)
 * - `true` (inherits key from `storageKey` — only valid with persistence)
 */
export type SyncOption<S extends Record<string, unknown>> = SyncConfig<S> | string | true;

type SyncWithoutStorageOption<S extends Record<string, unknown>> =
  | string
  | (Omit<SyncConfig<S>, 'injectStorageMetadata' | 'key'> & {
      injectStorageMetadata?: never;
      key: SyncWithoutStorageKey<SyncConfig<S>>;
      readonly __syncStateBrand?: (state: S) => S;
    });

type SyncWithoutStorageKey<Config> = Config extends { key?: infer Key }
  ? Extract<Key, string> extends never
    ? string
    : Extract<Key, string>
  : string;

type UndefinedPersistKeys<S, PersistedState, PersistReturn> = {
  [K in keyof PersistConfig<S, PersistedState, PersistReturn>]?: undefined;
};

// ============ Common Store Settings ========================================== //

/**
 * Expanded options for custom debounce behavior.
 */
export type DebounceOptions = {
  /* The number of milliseconds to delay. */
  delay: number;
  /* Specify invoking on the leading edge of the timeout. */
  leading?: boolean;
  /* The maximum time the function is allowed to be delayed before it’s invoked. */
  maxWait?: number;
  /* Specify invoking on the trailing edge of the timeout. */
  trailing?: boolean;
};
