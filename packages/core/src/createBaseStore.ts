import { persist, subscribeWithSelector } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';
import { getStoresConfig, markStoreCreated } from './config';
import { StoresError } from './logger';
import { createSyncedStateCreator } from './sync/syncEnhancer';
import { NormalizedSyncConfig } from './sync/types';
import { BaseStoreOptions, OptionallyPersistedStore, Store, StateCreator, SyncOption } from './types';
import { createPersistStorage } from './utils/storageCreators';

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

  const isPersisted = options && 'storageKey' in options;
  const storageKey = isPersisted ? options.storageKey : undefined;
  const normalizedSync = options?.sync ? normalizeSyncOption(options.sync, storageKey) : null;

  const stateCreator = normalizedSync
    ? createSyncedStateCreator(createState, normalizedSync, normalizedSync.engine ?? getStoresConfig().syncEngine)
    : createState;

  if (!isPersisted) {
    return createWithEqualityFn<S>()(subscribeWithSelector(stateCreator), Object.is);
  }

  const { persistStorage, version } = createPersistStorage<S, PersistedState, PersistReturn>(options);

  return createWithEqualityFn<S>()(
    subscribeWithSelector(
      persist(stateCreator, {
        migrate: options.migrate,
        name: options.storageKey,
        onRehydrateStorage: options.onRehydrateStorage,
        storage: persistStorage,
        version,
      })
    ),
    Object.is
  );
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
