import { IS_BROWSER, IS_IOS, IS_TEST } from '@/env';
import { getStorageConfig } from '../config';
import { StoresError } from '../errors';
import { logger } from '../logger';
import type { StorageValue } from './storageTypes';
import type { AsyncPersistStorage, SyncPersistStorage } from '../store/types';
import type { SyncContext } from '../sync/syncEnhancer';
import type { AsyncStorageInterface, BaseStoreOptions, EnforceStorageKey, SyncStorageInterface } from '../types';
import { createAsyncMicrotaskScheduler } from '../utils/createAsyncMicrotaskScheduler';
import { debounce } from '../utils/debounce';
import { defaultDeserializeState, defaultSerializeState, omitStoreMethods } from '../utils/persistUtils';
import { time } from '../utils/time';

type MetadataCapture = {
  fieldSnapshot?: Record<string, number>;
  shouldClear: boolean;
};

type PersistStorageConfig<S, PersistedState extends Partial<S>> =
  | {
      async: false;
      persistStorage: SyncPersistStorage<S, PersistedState>;
      version: number;
    }
  | {
      async: true;
      persistStorage: AsyncPersistStorage<S, PersistedState>;
      version: number;
    };

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
  const persistThrottleMs = (options.sync ? undefined : (options.persistThrottleMs ?? DEFAULT_PERSIST_THROTTLE_MS)) || undefined;
  const version = options.version ?? 0;

  if (parsedStorage.async) {
    return {
      async: true,
      persistStorage: createAsyncPersistStorage(parsedStorage, options, persistThrottleMs, syncContext),
      version,
    };
  }

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
  const enableMapSetHandling = !options.deserializer && !options.serializer && !storage.deserializer && !storage.serializer;
  const injectMetadata =
    typeof options.sync === 'object' && (options.sync.injectStorageMetadata ?? options.sync.engine?.injectStorageMetadata) === true;

  const partialize = options.partialize ?? omitStoreMethods<S, PersistedState>;
  const deserializer = options.deserializer ?? storage.deserializer ?? createDefaultDeserializer<PersistedState>(enableMapSetHandling);
  const serializer = options.serializer ?? storage.serializer ?? createDefaultSerializer<PersistedState>(enableMapSetHandling);

  function persist(name: string, state: S, version: number | undefined): void {
    try {
      if (shouldSkipPersistence(syncContext)) return;

      const persistedValue: StorageValue<PersistedState> = { state: partialize(state), version };
      const metadataCapture = attachMetadata(syncContext, injectMetadata, persistedValue);
      const serializedValue = serializer(persistedValue);

      try {
        storage.set(name, serializedValue);
        clearMetadataSnapshot(syncContext, metadataCapture);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`, error));
      }
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
  persistThrottleMs: number | undefined,
  syncContext?: SyncContext
): AsyncPersistStorage<S, PersistedState> {
  const enableMapSetHandling = !options.deserializer && !options.serializer && !storage.deserializer && !storage.serializer;
  const injectMetadata =
    typeof options.sync === 'object' && (options.sync.injectStorageMetadata ?? options.sync.engine?.injectStorageMetadata) === true;

  const partialize = options.partialize ?? omitStoreMethods<S, PersistedState>;
  const deserializer = options.deserializer ?? storage.deserializer ?? createDefaultDeserializer<PersistedState>(enableMapSetHandling);
  const serializer = options.serializer ?? storage.serializer ?? createDefaultSerializer<PersistedState>(enableMapSetHandling);

  async function persist(name: string, state: S, version: number | undefined): Promise<void> {
    try {
      if (shouldSkipPersistence(syncContext)) return;

      const persistedValue: StorageValue<PersistedState> = { state: partialize(state), version };
      const metadataCapture = attachMetadata(syncContext, injectMetadata, persistedValue);
      const serializedValue = serializer(persistedValue);

      try {
        await storage.set(name, serializedValue);
        clearMetadataSnapshot(syncContext, metadataCapture);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`, error));
      }
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to serialize persisted store data`, error));
    }
  }

  const lazyPersist =
    persistThrottleMs !== undefined
      ? debounce(persist, persistThrottleMs, {
          leading: false,
          maxWait: persistThrottleMs,
          trailing: true,
        })
      : createAsyncMicrotaskScheduler(persist);

  return {
    getItem: async name => {
      const serializedValue = await storage.get(name);
      if (serializedValue === undefined) return null;
      return deserializer(serializedValue);
    },
    setItem: async (name, state, version) => {
      if (syncContext?.getIsApplyingRemote()) return;
      return await lazyPersist(name, state, version);
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

function createDefaultDeserializer<PersistedState extends Partial<unknown>>(
  shouldUseReviver: boolean
): (serializedState: unknown) => StorageValue<PersistedState> {
  return serializedState => {
    if (typeof serializedState !== 'string') {
      throw new StoresError(
        '[createBaseStore]: Received non-string serialized state without a custom deserializer. ' +
          'Provide a deserializer on the store or storage adapter.'
      );
    }
    return defaultDeserializeState<PersistedState>(serializedState, shouldUseReviver);
  };
}

function createDefaultSerializer<PersistedState extends Partial<unknown>>(
  shouldUseReplacer: boolean
): (storageValue: StorageValue<PersistedState>) => string {
  return storageValue => defaultSerializeState<PersistedState>(storageValue, shouldUseReplacer);
}

const SHOULD_CLEAR_FALSE = Object.freeze({ shouldClear: false });

function attachMetadata<PersistedState extends Partial<unknown>>(
  syncContext: SyncContext | undefined,
  injectMetadata: boolean,
  value: StorageValue<PersistedState>
): MetadataCapture {
  if (!injectMetadata || !syncContext) return SHOULD_CLEAR_FALSE;

  const fieldSnapshot = syncContext.getFieldTimestampSnapshot();
  injectSyncMetadata(syncContext, value);

  if (!value.syncMetadata) return { fieldSnapshot, shouldClear: false };

  if (fieldSnapshot && Object.keys(fieldSnapshot).length > 0) {
    value.syncMetadata.fields = fieldSnapshot;
    return { fieldSnapshot, shouldClear: true };
  }

  delete value.syncMetadata.fields;
  return { fieldSnapshot, shouldClear: false };
}

function clearMetadataSnapshot(syncContext: SyncContext | undefined, capture: MetadataCapture): void {
  if (!syncContext || !capture.shouldClear || !capture.fieldSnapshot || !Object.keys(capture.fieldSnapshot).length) return;
  syncContext.clearFieldTimestamps(capture.fieldSnapshot);
}

function injectSyncMetadata<PersistedState extends Partial<unknown>>(syncContext: SyncContext, value: StorageValue<PersistedState>): void {
  const sessionId = syncContext.getSessionId();
  const timestamp = syncContext.getTimestamp();
  if (sessionId !== undefined && timestamp !== undefined) {
    value.syncMetadata = { origin: sessionId, timestamp };
  }
}

function shouldSkipPersistence(syncContext: SyncContext | undefined): boolean {
  if (!syncContext) return false;
  if (syncContext.getIsApplyingRemote()) return true;
  return false;
}
