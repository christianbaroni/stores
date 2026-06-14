import type { StorageValue } from '../storage/storageTypes';
import type { SetStateOverloads } from '../types/setState';
import type { SubscribeOverloads } from '../types/subscribe';

// ============ Store API ====================================================== //

/**
 * Store object contract shared by creators, middleware, and internal store utilities.
 */
export type StoreApi<S> = {
  getInitialState: () => S;
  getState: () => S;
  setState: SetStateOverloads<S>;
  subscribe: SubscribeOverloads<S>;
};

/**
 * Callback that builds store state from the set/get/store API supplied during construction.
 */
export type StateCreator<S, Mutators extends StoreMutators = [], StoreMutatorOutput extends StoreMutators = [], U = S> = ((
  setState: Get<Mutate<StoreApi<S>, Mutators>, 'setState', never>,
  getState: Get<Mutate<StoreApi<S>, Mutators>, 'getState', never>,
  store: Mutate<StoreApi<S>, Mutators>
) => U) & {
  $$storeMutators?: StoreMutatorOutput;
};

// ============ Persistence ==================================================== //

/**
 * Synchronous storage adapter consumed by the persistence wrapper.
 */
export type SyncPersistStorage<State, PersistedState = Partial<State>> = {
  getItem: (name: string) => StorageValue<PersistedState> | null;
  removeItem: (name: string) => void;
  setItem: (name: string, state: State, version: number | undefined) => void;
};

/**
 * Asynchronous storage adapter consumed by the persistence wrapper.
 */
export type AsyncPersistStorage<State, PersistedState = Partial<State>> = {
  getItem: (name: string) => Promise<StorageValue<PersistedState> | null>;
  removeItem: (name: string) => Promise<void>;
  setItem: (name: string, state: State, version: number | undefined) => Promise<void>;
};

/**
 * Accepted storage adapter types for sync or async persistence.
 */
export type PersistStorage<State, PersistedState = Partial<State>> =
  | AsyncPersistStorage<State, PersistedState>
  | SyncPersistStorage<State, PersistedState>;

/**
 * Resolved storage config for persisted stores.
 */
export type PersistStorageConfig<State, PersistedState extends Partial<State>> =
  | { async: false; persistStorage: SyncPersistStorage<State, PersistedState>; version: number }
  | { async: true; persistStorage: AsyncPersistStorage<State, PersistedState>; version: number };

/**
 * Persistence options consumed by the persistence wrapper.
 */
export type PersistOptions<S, PersistedState = Partial<S>> = {
  merge?: (persistedState: PersistedState | undefined, currentState: S) => S;
  migrate?: (persistedState: PersistedState, version: number) => PersistedState | Promise<PersistedState>;
  name: string;
  onRehydrateStorage?: (state: S) => ((state?: S, error?: unknown) => void) | void;
  skipHydration?: boolean;
  storage: PersistStorage<S, PersistedState>;
  version: number;
};

/**
 * Methods attached by the persistence wrapper before async hydration state is added.
 */
export type PersistMethods<S, PersistedState> = {
  clearStorage: () => void;
  getOptions: () => Partial<PersistOptions<S, PersistedState>>;
  hasHydrated: () => boolean;
  onHydrate: (listener: (state: S) => void) => () => void;
  onFinishHydration: (listener: (state: S) => void) => () => void;
  rehydrate: () => Promise<void> | void;
  setOptions: (options: Partial<PersistOptions<S, PersistedState>>) => void;
};

/**
 * Store shape after the persistence wrapper adds persistence methods, write-through `setState`,
 * and async hydration state when applicable.
 */
export type WithPersist<Store, PersistedState, PersistReturn extends void | Promise<void>> =
  Store extends StoreApi<infer S>
    ? Write<
        Store,
        {
          persist: PersistMethods<S, PersistedState> & HydrationPromise<PersistReturn>;
          setState: SetStateOverloads<S, PersistReturn>;
        }
      >
    : Store;

type HydrationPromise<PersistReturn> =
  PersistReturn extends Promise<void>
    ? {
        /** Invoke to get a promise that resolves once hydration completes. */
        hydrationPromise: () => Promise<void>;
      }
    : { hydrationPromise?: undefined };

// ============ Store Mutators ================================================= //

type Get<T, K, Fallback> = K extends keyof T ? T[K] : Fallback;
type Write<T, U> = Omit<T, keyof U> & U;

type PersistMutator<Store, Args> = Args extends [infer PersistedState, infer PersistReturn extends void | Promise<void>]
  ? WithPersist<Store, PersistedState, PersistReturn>
  : Store;

type StoreMutatorIdentifier = keyof StoreMutatorMap<unknown, unknown>;

/**
 * Mapping from store mutator identifiers to the store API shape they add.
 */
export interface StoreMutatorMap<Store, Args> {
  'stores/persist': PersistMutator<Store, Args>;
}

/**
 * Ordered list of store mutators applied to a state creator.
 */
export type StoreMutators = [StoreMutatorIdentifier, unknown][];

/**
 * Applies a list of store mutators to a store API type.
 */
export type Mutate<Store, Mutators> = number extends Mutators['length' & keyof Mutators]
  ? Store
  : Mutators extends []
    ? Store
    : Mutators extends [[infer Identifier, infer Args], ...infer Rest]
      ? Identifier extends StoreMutatorIdentifier
        ? Rest extends StoreMutators
          ? Mutate<StoreMutatorMap<Store, Args>[Identifier], Rest>
          : StoreMutatorMap<Store, Args>[Identifier]
        : Store
      : Store;
