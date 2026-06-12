import { getStorageConfig, markStoreCreated } from './config';
import { createStoreWithEqualityFn } from './createStoreWithEqualityFn';
import { StoresError } from './errors';
import { createHydrationGate } from './middleware/createHydrationGate';
import { createPersistStorage } from './storage/storageCreators';
import { persist } from './store/persist';
import { createSyncedStateCreator } from './sync/syncEnhancer';
import type { NormalizedSyncConfig } from './sync/types';
import type { BaseStoreOptions, OptionallyPersistedStore, Store, StateCreator, SyncOption } from './types';

/**
 * Creates a base store without persistence.
 * @param createState - The state creator function for the base store.
 * @returns A store with the specified state.
 */
export function createBaseStore<S>(createState: StateCreator<S>): Store<S>;

/**
 * Creates a base store with persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends void = void>(
  createState: StateCreator<S>,
  options: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S, PersistedState, PersistReturn, false>;

/**
 * Creates a base store with async persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends Promise<void> = Promise<void>>(
  createState: StateCreator<S>,
  options: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S, PersistedState, PersistReturn, false>;

/**
 * Creates a base store with optional persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends void = void>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): OptionallyPersistedStore<S, PersistedState, PersistReturn>;

/**
 * Creates a base store with optional async persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends Promise<void> = Promise<void>>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): OptionallyPersistedStore<S, PersistedState, PersistReturn>;

/**
 * Creates a base store with optional persistence and sync.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S>, PersistReturn extends void | Promise<void>>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S> | Store<S, PersistedState, PersistReturn, false> {
  markStoreCreated();

  if (!options) {
    return createStoreWithEqualityFn<S>()(createState, Object.is);
  }

  const storageKey = options.storageKey;
  const isPersisted = typeof storageKey === 'string';
  const storage = isPersisted ? (options.storage ?? getStorageConfig().storage) : undefined;

  const normalizedSync = normalizeSyncOption(options.sync, storageKey);
  const syncMiddleware = normalizedSync ? createSyncedStateCreator(createState, normalizedSync, storage?.async ?? false) : undefined;
  const stateCreator = syncMiddleware?.stateCreator ?? createState;

  if (!isPersisted) {
    return createStoreWithEqualityFn<S>()(stateCreator, Object.is);
  }

  const storageConfig = createPersistStorage<S, PersistedState, PersistReturn>(options, storage, syncMiddleware?.syncContext);
  const hydrationGate = storageConfig.async ? createHydrationGate(stateCreator) : undefined;

  const onRehydrateStorage = hydrationGate
    ? hydrationGate.wrapOnRehydrateStorage(options.onRehydrateStorage, syncMiddleware?.syncContext)
    : options.onRehydrateStorage;

  const finalStateCreator: StateCreator<S> = hydrationGate
    ? (set, get, api) => {
        if (syncMiddleware) syncMiddleware.syncContext.setWithoutPersist = api.setState;
        return hydrationGate.stateCreator(set, get, api);
      }
    : stateCreator;

  const store = createStoreWithEqualityFn<S>()(
    persist<S, PersistedState, PersistReturn>(finalStateCreator, {
      merge: options.merge,
      migrate: options.migrate,
      name: storageKey,
      onRehydrateStorage,
      storage: storageConfig.persistStorage,
      version: storageConfig.version,
    }),
    Object.is
  );

  if (!hydrationGate) return store;

  return Object.assign(store, {
    persist: Object.assign(store.persist, { hydrationPromise: hydrationGate.hydrationPromise }),
  });
}

function normalizeSyncOption<S extends Record<string, unknown>>(
  syncOption: SyncOption<S> | undefined,
  storageKey: string | undefined
): NormalizedSyncConfig<S> | null {
  if (!syncOption) return null;

  const isObject = typeof syncOption === 'object';
  const key = isObject ? syncOption.key : syncOption === true ? storageKey : syncOption;

  if (!key) throw new StoresError('[createBaseStore]: sync requires a key to be specified either directly or via storageKey');

  return isObject ? { ...syncOption, key } : { key };
}
