import type { StorageValue } from '../storage/storageTypes';

// ============ Updates ======================================================== //

type SetPartial<S> = Partial<S> | ((state: S) => Partial<S>);
type SetFull<S> = S | ((state: S) => S);

// ============ Subscriptions ================================================== //

type Listener<S> = (state: S, prevState: S) => void;
type Selector<S, Selected> = (state: S) => Selected;
type SubscribeOptions<Selected> = {
  equalityFn?: (a: Selected, b: Selected) => boolean;
  fireImmediately?: boolean;
  isDerivedStore?: boolean;
};
type UnsubscribeFn = () => void;

// ============ Store API ====================================================== //

/**
 * Store API used by the local runtime.
 */
export type StoreApi<S> = {
  getInitialState: () => S;
  getState: () => S;
  setState(update: SetPartial<S>, replace?: false): void;
  setState(update: SetFull<S>, replace: true): void;
  subscribe(listener: Listener<S>): UnsubscribeFn;
  subscribe<Selected>(selector: Selector<S, Selected>, listener: Listener<Selected>, options?: SubscribeOptions<Selected>): UnsubscribeFn;
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

export type PersistStorage<State, PersistedState = Partial<State>, PersistReturn = unknown> =
  PersistReturn extends Promise<void>
    ? AsyncPersistStorage<State, PersistedState>
    : PersistReturn extends void
      ? SyncPersistStorage<State, PersistedState>
      : SyncPersistStorage<State, PersistedState> | AsyncPersistStorage<State, PersistedState>;

/**
 * Persistence options consumed by the persistence wrapper.
 */
export type PersistOptions<S, PersistedState = Partial<S>, PersistReturn = unknown> = {
  merge?: (persistedState: PersistedState | undefined, currentState: S) => S;
  migrate?: (persistedState: PersistedState, version: number) => PersistedState | Promise<PersistedState>;
  name: string;
  onRehydrateStorage?: (state: S) => ((state?: S, error?: unknown) => void) | void;
  skipHydration?: boolean;
  storage?: PersistStorage<S, PersistedState, PersistReturn>;
  version?: number;
};

/**
 * Methods attached to persisted stores.
 */
export type StorePersistApi<S, PersistedState = Partial<S>, PersistReturn = unknown> = {
  clearStorage: () => void;
  getOptions: () => Partial<PersistOptions<S, PersistedState>>;
  hasHydrated: () => boolean;
  onHydrate: (listener: (state: S) => void) => () => void;
  onFinishHydration: (listener: (state: S) => void) => () => void;
  rehydrate: () => Promise<void> | void;
  setOptions: (options: Partial<PersistOptions<S, PersistedState, PersistReturn>>) => void;
};

/**
 * Hydration promise API attached to stores backed by asynchronous persistence.
 */
export type HydrationPromise<PersistReturn> =
  PersistReturn extends Promise<void>
    ? {
        /** Invoke to get a promise that resolves once hydration completes. */
        hydrationPromise: () => Promise<void>;
      }
    : { hydrationPromise?: undefined };

// ============ Mutators ======================================================= //

type Get<T, K, Fallback> = K extends keyof T ? T[K] : Fallback;
type MutatorTuple = [StoreMutatorIdentifier, unknown];
type Write<T, U> = Omit<T, keyof U> & U;

type WithPersist<Store, Args> = Args extends [infer PersistedState, infer PersistReturn]
  ? Store extends StoreApi<infer S>
    ? Write<
        Store,
        {
          persist: StorePersistApi<S, PersistedState, PersistReturn>;
          setState(update: SetPartial<S>, replace?: false): PersistReturn;
          setState(update: SetFull<S>, replace: true): PersistReturn;
        }
      >
    : Store
  : Store;

export interface StoreMutators<Store, Args> {
  'stores/persist': WithPersist<Store, Args>;
}

export type StoreMutatorIdentifier = keyof StoreMutators<unknown, unknown>;

export type Mutate<Store, Mutators> = number extends Mutators['length' & keyof Mutators]
  ? Store
  : Mutators extends []
    ? Store
    : Mutators extends [[infer Identifier, infer Args], ...infer Rest]
      ? Identifier extends StoreMutatorIdentifier
        ? Rest extends MutatorTuple[]
          ? Mutate<StoreMutators<Store, Args>[Identifier], Rest>
          : StoreMutators<Store, Args>[Identifier]
        : Store
      : Store;

/** @internal */
export type PersistedStoreApi<S, PersistedState = Partial<S>, PersistReturn = unknown> = Omit<
  Mutate<StoreApi<S>, [['stores/persist', [PersistedState, PersistReturn]]]>,
  'persist'
> & {
  persist: StorePersistApi<S, PersistedState, PersistReturn> & HydrationPromise<PersistReturn>;
};

/**
 * Creates initial state with access to the store API.
 */
export type StateCreator<S, Mutators extends MutatorTuple[] = [], StoreMutatorOutput extends MutatorTuple[] = [], U = S> = ((
  setState: Get<Mutate<StoreApi<S>, Mutators>, 'setState', never>,
  getState: Get<Mutate<StoreApi<S>, Mutators>, 'getState', never>,
  store: Mutate<StoreApi<S>, Mutators>
) => U) & {
  $$storeMutators?: StoreMutatorOutput;
};
