import { Mutate, StateCreator as ZustandStateCreator, StoreApi } from 'zustand';
import { PersistOptions, StorageValue } from 'zustand/middleware';
import { UseBoundStoreWithEqualityFn } from 'zustand/traditional';

// ============ Middleware Helpers ============================================= //

type SubscribeWithSelector = ['zustand/subscribeWithSelector', never];
type Persist<PersistedState> = ['zustand/persist', PersistedState];

// ============ Core Store Types =============================================== //

export type StateCreator<S, U = S> = ZustandStateCreator<S, [SubscribeWithSelector], [SubscribeWithSelector], U>;

export type BaseStore<S, ExtraSubscribeOptions extends boolean = false> = UseBoundStoreWithEqualityFn<
  Mutate<StoreApi<S>, [SubscribeWithSelector]>
> & {
  subscribe: SubscribeOverloads<S, ExtraSubscribeOptions>;
};

export type PersistedStore<S, PersistedState = Partial<S>, ExtraSubscribeOptions extends boolean = false> = UseBoundStoreWithEqualityFn<
  Mutate<BaseStore<S, ExtraSubscribeOptions>, [Persist<PersistedState>]>
>;

export type Store<S, PersistedState extends Partial<S> = never, ExtraSubscribeOptions extends boolean = false> = [PersistedState] extends [
  never,
]
  ? BaseStore<S, ExtraSubscribeOptions>
  : PersistedStore<S, PersistedState, ExtraSubscribeOptions>;

export type OptionallyPersistedStore<S, PersistedState> = Store<S> & {
  persist?: PersistedStore<S, PersistedState>['persist'];
};

// ============ Common Utility Types =========================================== //

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

// ============ Set State Types ================================================ //

export type SetPartial<S> = Partial<S> | ((state: S) => Partial<S>);
export type SetFull<S> = S | ((state: S) => S);

export type SetStateReplaceArgs<S, ExtraArgs extends unknown[] = []> = [update: SetFull<S>, replace: true, ...extraArgs: ExtraArgs];
export type SetStatePartialArgs<S, ExtraArgs extends unknown[] = []> = [update: SetPartial<S>, replace?: false, ...extraArgs: ExtraArgs];

export type SetStateArgs<S, ExtraArgs extends unknown[] = []> = SetStatePartialArgs<S, ExtraArgs> | SetStateReplaceArgs<S, ExtraArgs>;
export type SetState<S, ExtraArgs extends unknown[] = []> = (...args: SetStateArgs<S, ExtraArgs>) => void;

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

export type MaybePromise<T> = T | Promise<T>;

/**
 * Synchronous storage interface.
 * Used for localStorage and MMKV implementations.
 */
export interface SyncStorageInterface {
  clearAll(): void;
  contains(key: string): boolean;
  delete(key: string): void;
  getAllKeys(): string[];
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

/**
 * Asynchronous storage interface.
 * Used for Chrome storage and other async storage implementations.
 */
export interface AsyncStorageInterface {
  clearAll(): Promise<void>;
  contains(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
  getString(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Generic storage interface that can be either synchronous or asynchronous.
 * This is the base type used in the config.
 */
export type StorageInterface = SyncStorageInterface | AsyncStorageInterface;

/**
 * Configuration options for creating a persistable store.
 */
export type PersistConfig<S, PersistedState = Partial<S>> = {
  /**
   * A function to convert the serialized string back into the state object.
   * If not provided, the default deserializer is used.
   */
  deserializer?: (serializedState: string) => StorageValue<PersistedState>;

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
  persistThrottleMs?: number;

  /**
   * A function to serialize the state and version into a string for storage.
   * If not provided, the default serializer is used.
   */
  serializer?: (state: StorageValue<PersistedState>['state'], version: StorageValue<PersistedState>['version']) => string;

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

export type LazyPersistParams<S, PersistedState extends Partial<S>> = {
  name: string;
  partialize: NonNullable<PersistConfig<S, PersistedState>['partialize']>;
  serializer: NonNullable<PersistConfig<S, PersistedState>['serializer']>;
  storageKey: string;
  value: StorageValue<S> | StorageValue<PersistedState>;
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
