import { PersistStorage, StorageValue, persist, subscribeWithSelector } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';
import { IS_BROWSER, IS_IOS, IS_TEST } from '@env';
import { getStoresConfig } from './config';
import { StoresError, logger } from './logger';
import { createSyncedStateCreator } from './sync/syncEnhancer';
import { NormalizedSyncConfig, SyncConfig } from './sync/types';
import {
  AsyncStorageInterface,
  LazyPersistParams,
  PersistConfig,
  Store,
  StateCreator,
  SyncStorageInterface,
  OptionallyPersistedStore,
} from './types';
import { debounce } from './utils/debounce';
import { defaultDeserializeState, defaultSerializeState, omitStoreMethods } from './utils/persistUtils';
import { time } from './utils/time';

// ============ Store Options ================================================== //

/**
 * Sync option can be:
 * - SyncConfig<S> object with optional key (full control)
 * - string (shorthand for { key: string })
 * - true (only valid with persistence - inherits key from storageKey)
 */
export type SyncOption<S extends Record<string, unknown>> = SyncConfig<S> | string | true;

export type SyncOptions<S> = {
  sync: S extends Record<string, unknown> ? SyncConfig<S> | string : never;
};

export type PersistWithOptionalSync<S, PersistedState extends Partial<S> = Partial<S>> = PersistConfig<S, PersistedState> & {
  sync?: S extends Record<string, unknown> ? SyncOption<S> : never;
};

export type BaseStoreOptions<S, PersistedState extends Partial<S> = Partial<S>> =
  | SyncOptions<S>
  | PersistWithOptionalSync<S, PersistedState>;

/**
 * Creates a base store without persistence or sync.
 * @param createState - The state creator function for the base store.
 * @returns A Zustand store with the specified state.
 */
export function createBaseStore<S>(createState: StateCreator<S>): Store<S>;

/**
 * Creates a base store with persistence and optional sync.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A Zustand store with the specified state and persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>>(
  createState: StateCreator<S>,
  options: BaseStoreOptions<S, PersistedState>
): Store<S, PersistedState>;

/**
 * Creates a base store with optional persistence and sync.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A Zustand store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState>
): OptionallyPersistedStore<S, PersistedState>;

/**
 * Creates a base store with optional persistence and sync.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A Zustand store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState>
): Store<S> | Store<S, PersistedState> {
  const storageKey = options && 'storageKey' in options ? options.storageKey : undefined;
  const normalizedSync = options?.sync ? normalizeSyncOption(options.sync, storageKey) : null;

  const stateCreatorWithSync = normalizedSync
    ? createSyncedStateCreator(createState, normalizedSync, normalizedSync.engine ?? getStoresConfig().syncEngine)
    : createState;

  if (!options || !('storageKey' in options)) {
    return createWithEqualityFn<S>()(subscribeWithSelector(stateCreatorWithSync), Object.is);
  }

  const { persistStorage, version } = createPersistStorage<S, PersistedState>(options);

  return createWithEqualityFn<S>()(
    subscribeWithSelector(
      persist(stateCreatorWithSync, {
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

const DEFAULT_PERSIST_THROTTLE_MS = IS_TEST ? 0 : IS_BROWSER ? time.ms(200) : IS_IOS ? time.seconds(3) : time.seconds(5);

// ============ Persist Storage Creation ======================================= //

interface SyncPersistStorage<S, R = unknown> {
  getItem: (name: string) => StorageValue<S> | null;
  setItem: (name: string, value: StorageValue<S>) => R;
  removeItem: (name: string) => R;
}

/**
 * Creates a synchronous persist storage adapter for Zustand.
 */
function createSyncPersistStorage<S, PersistedState extends Partial<S>>(
  storage: SyncStorageInterface,
  options: PersistWithOptionalSync<S, PersistedState>,
  persistThrottleMs: number | undefined
): SyncPersistStorage<PersistedState> {
  const enableMapSetHandling = !options.deserializer && !options.serializer;
  const {
    deserializer = serializedState => defaultDeserializeState<PersistedState>(serializedState, enableMapSetHandling),
    serializer = (state, version) => defaultSerializeState<PersistedState>(state, version, enableMapSetHandling),
    storageKey,
  } = options;

  function persist(params: LazyPersistParams<S, PersistedState>): void {
    try {
      const key = `${params.storageKey}:${params.name}`;
      const serializedValue = params.serializer(params.partialize(params.value.state as S), params.value.version ?? 0);
      storage.set(key, serializedValue);
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`), { error });
    }
  }

  const lazyPersist = persistThrottleMs
    ? debounce(persist, persistThrottleMs, { leading: false, maxWait: persistThrottleMs, trailing: true })
    : persist;

  return {
    getItem: (name: string) => {
      const key = `${storageKey}:${name}`;
      const serializedValue = storage.getString(key);
      if (!serializedValue) return null;
      return deserializer(serializedValue);
    },
    setItem: (name, value) => {
      lazyPersist({
        partialize: options.partialize ?? omitStoreMethods<S, PersistedState>,
        serializer,
        storageKey,
        name,
        value,
      });
    },
    removeItem: (name: string) => {
      const key = `${storageKey}:${name}`;
      try {
        storage.delete(key);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to delete persisted store data`), { error });
      }
    },
  };
}

/**
 * Creates an asynchronous persist storage adapter for Zustand.
 */
function createAsyncPersistStorage<S, PersistedState extends Partial<S>>(
  storage: AsyncStorageInterface,
  options: PersistWithOptionalSync<S, PersistedState>,
  persistThrottleMs: number | undefined
): PersistStorage<PersistedState> {
  const enableMapSetHandling = !options.deserializer && !options.serializer;
  const {
    deserializer = serializedState => defaultDeserializeState<PersistedState>(serializedState, enableMapSetHandling),
    serializer = (state, version) => defaultSerializeState<PersistedState>(state, version, enableMapSetHandling),
    storageKey,
  } = options;

  function persist(params: LazyPersistParams<S, PersistedState>): void {
    try {
      const key = `${params.storageKey}:${params.name}`;
      const serializedValue = params.serializer(params.partialize(params.value.state as S), params.value.version ?? 0);
      void storage.set(key, serializedValue).catch(error => {
        logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`), { error });
      });
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to serialize persisted store data`), { error });
    }
  }

  const lazyPersist = persistThrottleMs
    ? debounce(persist, persistThrottleMs, { leading: false, maxWait: persistThrottleMs, trailing: true })
    : persist;

  return {
    getItem: async (name: string) => {
      const key = `${storageKey}:${name}`;
      const serializedValue = await storage.getString(key);
      if (!serializedValue) return null;
      return deserializer(serializedValue);
    },
    setItem: async (name, value) => {
      lazyPersist({
        partialize: options.partialize ?? omitStoreMethods<S, PersistedState>,
        serializer,
        storageKey,
        name,
        value,
      });
    },
    removeItem: async (name: string) => {
      const key = `${storageKey}:${name}`;
      try {
        await storage.delete(key);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to delete persisted store data`), { error });
      }
    },
  };
}

/**
 * Creates a persist storage object for the base store.
 */
function createPersistStorage<S, PersistedState extends Partial<S>>(
  options: PersistWithOptionalSync<S, PersistedState>
): {
  persistStorage: SyncPersistStorage<PersistedState> | PersistStorage<PersistedState>;
  version: number;
} {
  const config = getStoresConfig();
  const persistThrottleMs = options.sync ? undefined : DEFAULT_PERSIST_THROTTLE_MS;
  const version = options.version ?? 0;

  const persistStorage = config.async
    ? createAsyncPersistStorage(config.storage, options, persistThrottleMs)
    : createSyncPersistStorage(config.storage, options, persistThrottleMs);

  return { persistStorage, version };
}

/**
 * Normalizes `SyncOption` into `NormalizedSyncConfig` with a required key.
 */
function normalizeSyncOption<S extends Record<string, unknown>>(
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
