import { IS_BROWSER, IS_IOS, IS_TEST } from '#env';
import type { StorageValue } from '../../storage/storageTypes';
import type { AsyncPersistStorage, PersistStorageConfig, SyncPersistStorage } from '../../store/types';
import type { AsyncStorageInterface, BaseStoreOptions, EnforceStorageKey, PersistConfig, SyncStorageInterface } from '../../types';
import { createAsyncMicrotaskScheduler } from '../../utils/createAsyncMicrotaskScheduler';
import { debounce } from '../../utils/debounce';
import { time } from '../../utils/time';
import { getStorageConfig } from '../config';
import { StoresError } from '../errors';
import { logger } from '../logger';
import type { SyncContext } from '../sync/syncEnhancer';
import { defaultDeserializeState, defaultSerializeState, omitStoreMethods } from '../utils/persistUtils';

const DEFAULT_PERSIST_THROTTLE_MS = IS_TEST ? 0 : IS_BROWSER ? time.ms(200) : IS_IOS ? time.seconds(3) : time.seconds(5);

/**
 * Creates a persist storage object for the base store.
 */
export function createPersistStorage<S, PersistedState extends Partial<S>, PersistReturn>(
  options: EnforceStorageKey<BaseStoreOptions<S, PersistedState, PersistReturn>>,
  storage: AsyncStorageInterface | SyncStorageInterface | undefined,
  syncContext: SyncContext | undefined
): PersistStorageConfig<S, PersistedState> {
  const parsedStorage = storage ?? options.storage ?? getStorageConfig().storage;
  const version = options.version ?? 0;

  if (parsedStorage.async) {
    return {
      async: true,
      persistStorage: createAsyncPersistStorage(parsedStorage, options, syncContext),
      version,
    };
  }

  const persistThrottleMs = (options.sync ? undefined : (options.persistThrottleMs ?? DEFAULT_PERSIST_THROTTLE_MS)) || undefined;

  return {
    async: false,
    persistStorage: createSyncPersistStorage(parsedStorage, options, persistThrottleMs, syncContext),
    version,
  };
}

/**
 * Creates a synchronous persist storage adapter.
 */
function createSyncPersistStorage<S, PersistedState extends Partial<S>, PersistReturn>(
  storage: SyncStorageInterface,
  options: EnforceStorageKey<BaseStoreOptions<S, PersistedState, PersistReturn>>,
  persistThrottleMs: number | undefined,
  syncContext?: SyncContext
): SyncPersistStorage<S, PersistedState> {
  const { deserializer, injectMetadata, partialize, serializer } = resolvePersistOptions<S, PersistedState, PersistReturn>(
    storage,
    options
  );

  function persist(name: string, state: S, version: number | undefined): void {
    try {
      if (syncContext?.getIsApplyingRemote()) return;

      const persistedValue: StorageValue<PersistedState> = { state: partialize(state), version };
      const fieldSnapshot = attachMetadata(syncContext, injectMetadata, persistedValue);
      const serializedValue = serializer(persistedValue);

      storage.set(name, serializedValue);
      if (fieldSnapshot) syncContext?.clearFieldTimestamps(fieldSnapshot);
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`, error));
    }
  }

  const lazyPersist =
    persistThrottleMs !== undefined
      ? debounce(persist, persistThrottleMs, { leading: false, maxWait: persistThrottleMs, trailing: true })
      : persist;

  return {
    getItem: name => {
      const serializedValue = storage.get(name);
      if (serializedValue === undefined) return null;
      return deserializer(serializedValue);
    },
    setItem: (name, state, version) => {
      if (syncContext?.getIsApplyingRemote()) return;
      lazyPersist(name, state, version);
    },
    removeItem: name => {
      try {
        storage.delete(name);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to delete persisted store data`, error));
      }
    },
  };
}

/**
 * Creates an asynchronous persist storage adapter.
 */
export function createAsyncPersistStorage<S, PersistedState extends Partial<S>, PersistReturn>(
  storage: AsyncStorageInterface,
  options: EnforceStorageKey<BaseStoreOptions<S, PersistedState, PersistReturn>>,
  syncContext?: SyncContext
): AsyncPersistStorage<S, PersistedState> {
  const { deserializer, injectMetadata, partialize, serializer } = resolvePersistOptions<S, PersistedState, PersistReturn>(
    storage,
    options
  );

  async function persist(name: string, state: S, version: number | undefined): Promise<void> {
    try {
      if (syncContext?.getIsApplyingRemote()) return;

      const persistedValue: StorageValue<PersistedState> = { state: partialize(state), version };
      const fieldSnapshot = attachMetadata(syncContext, injectMetadata, persistedValue);
      const serializedValue = serializer(persistedValue);

      try {
        await storage.set(name, serializedValue);
        if (fieldSnapshot) syncContext?.clearFieldTimestamps(fieldSnapshot);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`, error));
      }
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to serialize persisted store data`, error));
    }
  }

  const lazyPersist = createAsyncMicrotaskScheduler(persist);

  return {
    getItem: async name => {
      const serializedValue = await storage.get(name);
      if (serializedValue === undefined) return null;
      return deserializer(serializedValue);
    },
    setItem: (name, state, version) => {
      if (syncContext?.getIsApplyingRemote()) return Promise.resolve();
      return lazyPersist(name, state, version);
    },
    removeItem: async name => {
      try {
        await storage.delete(name);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to delete persisted store data`, error));
      }
    },
  };
}

function deserializePlainState<PersistedState>(serializedState: unknown): StorageValue<PersistedState> {
  return defaultDeserializeState<PersistedState>(serializedState, false);
}

function serializePlainState<PersistedState>(storageValue: StorageValue<PersistedState>): string {
  return defaultSerializeState(storageValue, false);
}

/**
 * Adds sync metadata and returns the field timestamps to clear after a successful write.
 */
function attachMetadata<PersistedState extends Partial<unknown>>(
  syncContext: SyncContext | undefined,
  injectMetadata: boolean,
  value: StorageValue<PersistedState>
): Record<string, number> | undefined {
  if (!injectMetadata || !syncContext) return;

  const sessionId = syncContext.getSessionId();
  const timestamp = syncContext.getTimestamp();
  if (sessionId === undefined || timestamp === undefined) return;

  value.syncMetadata = { origin: sessionId, timestamp };
  const fields = syncContext.getFieldTimestampSnapshot();

  if (fields) {
    value.syncMetadata.fields = fields;
    return fields;
  }
}

function resolvePersistOptions<S, PersistedState extends Partial<S>, PersistReturn>(
  storage: AsyncStorageInterface | SyncStorageInterface,
  options: EnforceStorageKey<BaseStoreOptions<S, PersistedState, PersistReturn>>
): Required<Pick<PersistConfig<S, PersistedState>, 'deserializer' | 'partialize'>> & {
  injectMetadata: boolean;
  serializer: (value: StorageValue<PersistedState>) => unknown;
} {
  const enableMapSetHandling = !options.deserializer && !options.serializer && !storage.deserializer && !storage.serializer;
  const injectMetadata =
    typeof options.sync === 'object' && (options.sync.injectStorageMetadata ?? options.sync.engine?.injectStorageMetadata) === true;

  const deserializer =
    options.deserializer ??
    storage.deserializer ??
    (enableMapSetHandling ? defaultDeserializeState<PersistedState> : deserializePlainState<PersistedState>);

  const serializer =
    options.serializer ??
    storage.serializer ??
    (enableMapSetHandling ? defaultSerializeState<PersistedState> : serializePlainState<PersistedState>);

  const partialize = options.partialize ?? omitStoreMethods<S, PersistedState>;

  return { deserializer, injectMetadata, partialize, serializer };
}
