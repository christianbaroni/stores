import { persist, subscribeWithSelector } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';
import { getStoresConfig, markStoreCreated } from './config';
import { StoresError } from './logger';
import { createHydrationGate } from './middleware/createHydrationGate';
import { createPersistStorage } from './storage/storageCreators';
import { createSyncedStateCreator } from './sync/syncEnhancer';
import { NormalizedSyncConfig } from './sync/types';
import { BaseStoreOptions, OptionallyPersistedStore, Store, StateCreator, SyncOption } from './types';

/**
 * Creates a base store without persistence.
 * @param createState - The state creator function for the base store.
 * @returns A Zustand store with the specified state.
 */
export function createBaseStore<S>(createState: StateCreator<S>): Store<S>;

/**
 * Creates a base store with persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A Zustand store with the specified state and persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends void = void>(
  createState: StateCreator<S>,
  options: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S, PersistedState, false, PersistReturn>;

/**
 * Creates a base store with async persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A Zustand store with the specified state and persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends Promise<void> = Promise<void>>(
  createState: StateCreator<S>,
  options: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S, PersistedState, false, PersistReturn>;

/**
 * Creates a base store with optional persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A Zustand store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends void = void>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): OptionallyPersistedStore<S, PersistedState, PersistReturn>;

/**
 * Creates a base store with optional async persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A Zustand store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends Promise<void> = Promise<void>>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): OptionallyPersistedStore<S, PersistedState, PersistReturn>;

/**
 * Creates a base store with optional persistence and sync.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A Zustand store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S>, PersistReturn>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S> | Store<S, PersistedState, false, PersistReturn> {
  markStoreCreated();
  const isPersisted = options !== undefined && typeof options.storageKey === 'string';
  const storageKey = isPersisted ? options.storageKey : undefined;
  const normalizedSync = options?.sync ? normalizeSyncOption(options.sync, storageKey) : undefined;
  const parsedStorage = isPersisted ? (options.storage ?? getStoresConfig().storage) : undefined;

  const syncMiddleware = normalizedSync ? createSyncedStateCreator(createState, normalizedSync, parsedStorage?.async ?? false) : undefined;
  const stateCreator = syncMiddleware?.stateCreator ?? createState;

  if (!isPersisted) {
    return createWithEqualityFn<S>()(subscribeWithSelector(stateCreator), Object.is);
  }

  const hydrationGate = parsedStorage?.async ? createHydrationGate(stateCreator) : null;
  const storageConfig = createPersistStorage<S, PersistedState, PersistReturn>(options, parsedStorage, syncMiddleware?.syncContext);

  const wrappedOnRehydrateStorage = hydrationGate
    ? hydrationGate.wrapOnRehydrateStorage(
        options.onRehydrateStorage,
        () => syncMiddleware?.syncContext?.onHydrationComplete?.(),
        () => syncMiddleware?.syncContext?.onHydrationFlushEnd?.()
      )
    : options.onRehydrateStorage;

  const finalStateCreator: StateCreator<S> = hydrationGate
    ? (set, get, api) => {
        if (syncMiddleware?.syncContext) syncMiddleware.syncContext.setWithoutPersist = api.setState;
        return hydrationGate.stateCreator(set, get, api);
      }
    : stateCreator;

  const store = createWithEqualityFn<S>()(
    subscribeWithSelector(
      persist(finalStateCreator, {
        ...(options.merge && { merge: options.merge }),
        ...(options.migrate && { migrate: options.migrate }),
        name: options.storageKey,
        onRehydrateStorage: wrappedOnRehydrateStorage,
        storage: storageConfig.persistStorage,
        version: storageConfig.version,
      })
    ),
    Object.is
  );

  if (hydrationGate) {
    return Object.assign(store, {
      persist: Object.assign(store.persist, { hydrationPromise: hydrationGate.hydrationPromise }),
    });
  }

  return store;
}

/**
 * Normalizes `SyncOption` into `NormalizedSyncConfig` with a required key.
 */
export function normalizeSyncOption<S extends Record<string, unknown>>(
  syncOption: SyncOption<S> | undefined,
  storageKey: string | undefined
): NormalizedSyncConfig<S> | null {
  if (!syncOption) return null;

  // -- Case 1: sync: true (inherit from storageKey)
  if (syncOption === true) {
    if (!storageKey) {
      throw new StoresError('[createBaseStore]: sync: true requires a storageKey to inherit the key from');
    }
    return { key: storageKey };
  }

  // -- Case 2: sync: 'sync-key' (string shorthand)
  if (typeof syncOption === 'string') {
    return { key: syncOption };
  }

  // -- Case 3: sync: { ... } (options object)
  const config = syncOption;
  const key = config.key ?? storageKey;

  if (!key) {
    throw new StoresError('[createBaseStore]: sync requires either a key in the config or a storageKey to inherit from');
  }

  return { ...config, key };
}
