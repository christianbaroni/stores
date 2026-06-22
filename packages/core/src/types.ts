import type { StorageValue } from './storage/storageTypes';
import type { PersistOptions, StateCreator as StoreStateCreator, StoreApi, StoreMutators, WithPersist } from './store/types';
import type { SyncConfig } from './sync/types';
import type { FunctionKeys } from './types/functions';
import type { SetFull, SetPartial, SetStateArgs } from './types/setState';
import type { EqualityFn, Selector, SubscribeOverloads } from './types/subscribe';
import type { UseStoreCallSignatures } from './types/useStoreCallSignatures';

export type { StoreMutators } from './store/types';
export type * from './types/setState';
export type * from './types/subscribe';
export type * from './types/useStoreCallSignatures';

// ============ Store Mutators ================================================= //

export type StoreMutatorsWithSelector<Mutators extends StoreMutators = StoreMutators> = Mutators;

// ============ Core Store Types =============================================== //

export type StateCreator<S, U = S> = StoreStateCreator<S, [], [], U>;

export type UseBoundStoreWithEqualityFn<
  Store extends { getState: () => unknown },
  State = InferStoreState<Store>,
> = UseStoreCallSignatures<State> & Store;

export type BaseStore<S> = UseBoundStoreWithEqualityFn<StoreApi<S>> & {
  subscribe: SubscribeOverloads<S>;
};

export type PersistedStore<
  S,
  PersistedState = Partial<S>,
  PersistReturn extends void | Promise<void> = void | Promise<void>,
> = UseStoreCallSignatures<S> & WithPersist<BaseStore<S>, PersistedState, PersistReturn>;

export type Store<S, PersistedState extends Partial<S> = never, PersistReturn extends void | Promise<void> = void | Promise<void>> = [
  PersistedState,
] extends [never]
  ? BaseStore<S>
  : PersistedStore<S, PersistedState, PersistReturn>;

/**
 * Store returned by creators that accept optional persistence options.
 * `persist` exists only when persistence is configured.
 */
export type OptionallyPersistedStore<S, PersistedState, PersistReturn extends void | Promise<void> = void> = UseStoreCallSignatures<S> &
  Omit<BaseStore<S>, 'setState'> & {
    persist?: PersistedStore<S, PersistedState, PersistReturn>['persist'];
    setState(update: SetPartial<S>, replace?: false): PersistReturn;
    setState(update: SetFull<S>, replace: true): PersistReturn;
  };

// ============ Common Utility Types =========================================== //

export type NoInfer<T> = [T][T extends unknown ? 0 : never];
export type Timeout = ReturnType<typeof setTimeout>;

export type InferStoreState<Store> = Store extends { getState: () => infer T } ? T : never;

/**
 * Action methods returned by `createStoreActions(store)`.
 */
export type StoreActions<Store extends StoreApi<unknown>> = Pick<InferStoreState<Store>, FunctionKeys<InferStoreState<Store>>>;

/**
 * Extracts a store's `setState` return type.
 *  - `void` for non-persisted or synchronous persisted stores.
 *  - `Promise<void>` for async persisted stores.
 */
export type InferSetStateReturn<Store> = Store extends { setState(...args: SetStateArgs<infer S>): infer R } ? R : void;

/**
 * Extracts a store's `PersistedState` type.
 * Returns `never` if the store doesn't use persistence.
 */
export type InferPersistedState<PersistedStore> = PersistedStore extends Store<infer _, infer PersistedState> ? PersistedState : never;

// ============ Dependency Tracking Types ====================================== //

/**
 * Reads store state and records dependencies for tracked computations.
 *  - `$(store, selector, equalityFn?)` depends on the selected state
 *  - `$(store)` depends on accessed state paths
 */
export type DeriveGetter = {
  <Store extends StoreApi<InferStoreState<Store>>>(store: Store): InferStoreState<Store>;
  <Store extends StoreApi<InferStoreState<Store>>, Selected>(
    store: Store,
    selector: Selector<InferStoreState<Store>, Selected>,
    equalityFn?: EqualityFn<Selected>
  ): Selected;
};

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
   * Reads the current snapshot while activating lazy derived stores before subscription.
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
export type SyncStorageInterface<SerializedState = unknown> = {
  readonly async?: false;
  /**
   * Adapter-level deserializer used when a store does not supply its own.
   * Acts as the default before falling back to the framework implementation.
   */
  deserializer?<PersistedState>(serializedState: SerializedState): StorageValue<PersistedState>;
  /**
   * Adapter-level serializer used when a store does not supply its own.
   * Acts as the default before falling back to the framework implementation.
   */
  serializer?<PersistedState>(storageValue: StorageValue<PersistedState>): SerializedState;
  clearAll(): void;
  contains(key: string): boolean;
  delete(key: string): void;
  get(key: string): SerializedState | undefined;
  getAllKeys(): string[];
  set(key: string, value: SerializedState): void;
};

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
  deserializer?<PersistedState>(serializedState: SerializedState): StorageValue<PersistedState>;
  /**
   * Adapter-level serializer used when a store does not supply its own.
   * Acts as the default before falling back to the framework implementation.
   */
  serializer?<PersistedState>(storageValue: StorageValue<PersistedState>): SerializedState;
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
export type PersistConfig<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn = void> = {
  /**
   * A function to convert the serialized value back into the state object.
   * If not provided, the storage adapter's `deserializer` is used before falling back to the default implementation.
   */
  deserializer?: (serializedState: unknown) => StorageValue<PersistedState>;

  /**
   * A function to merge persisted state with current state during hydration.
   * By default, persisted state is shallow-merged into the current state.
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
  partialize?: (state: Readonly<S>) => PersistedState;

  /**
   * The throttle rate for the persist operation in milliseconds.
   * @default iOS: time.seconds(3) | Android: time.seconds(5)
   */
  persistThrottleMs?: PersistReturn extends Promise<unknown> ? undefined : number;

  /**
   * A function to serialize the state and version for storage.
   * If not provided, the storage adapter's `serializer` is used before falling back to the default implementation.
   */
  serializer?: (storageValue: StorageValue<PersistedState>) => string;

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

export type BaseStoreOptions<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn = void> =
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
    });

type SyncWithoutStorageKey<Config> = Config extends { key?: infer Key }
  ? Extract<Key, string> extends never
    ? string
    : Extract<Key, string>
  : string;

type UndefinedPersistKeys<S, PersistedState extends Partial<S>, PersistReturn> = {
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
