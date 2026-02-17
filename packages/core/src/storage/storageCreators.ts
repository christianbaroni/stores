import { PersistStorage } from 'zustand/middleware';
import { IS_BROWSER, IS_IOS, IS_TEST } from '@/env';
import { getStoresConfig } from '../config';
import { StoresError, logger } from '../logger';
import { StorageValue } from './storageTypes';
import { SyncContext } from '../sync/syncEnhancer';
import { AsyncStorageInterface, BaseStoreOptions, EnforceStorageKey, SyncStorageInterface } from '../types';
import { createAsyncMicrotaskScheduler } from '../utils/createAsyncMicrotaskScheduler';
import { debounce } from '../utils/debounce';
import { defaultDeserializeState, defaultSerializeState, omitStoreMethods } from '../utils/persistUtils';
import { time } from '../utils/time';

type MetadataCapture = {
  fieldSnapshot?: Record<string, number>;
  shouldClear: boolean;
};

type SyncPersistStorage<S> = {
  getItem: (name: string) => StorageValue<S> | null;
  removeItem: (name: string) => void;
  setItem: (name: string, value: StorageValue<S>) => void;
};

const DEFAULT_PERSIST_THROTTLE_MS = IS_TEST ? 0 : IS_BROWSER ? time.ms(200) : IS_IOS ? time.seconds(3) : time.seconds(5);

/**
 * Creates a persist storage object for the base store.
 */
export function createPersistStorage<S, PersistedState extends Partial<S>, PersistReturn>(
  options: EnforceStorageKey<BaseStoreOptions<S, PersistedState, PersistReturn>>,
  storage: AsyncStorageInterface | SyncStorageInterface | undefined,
  syncContext: SyncContext | undefined
): {
  persistStorage: SyncPersistStorage<PersistedState> | PersistStorage<PersistedState, Promise<void>>;
  version: number;
} {
  const parsedStorage = storage ?? options.storage ?? getStoresConfig().storage;
  const persistThrottleMs = (options.sync ? undefined : (options.persistThrottleMs ?? DEFAULT_PERSIST_THROTTLE_MS)) || undefined;
  const version = options.version ?? 0;

  const persistStorage = parsedStorage.async
    ? createAsyncPersistStorage(parsedStorage, options, persistThrottleMs, syncContext)
    : createSyncPersistStorage(parsedStorage, options, persistThrottleMs, syncContext);

  return { persistStorage, version };
}

/**
 * Creates a synchronous persist storage adapter for Zustand.
 * Behavior unchanged, but shown here in full for completeness.
 */
function createSyncPersistStorage<S, PersistedState extends Partial<S>, PersistReturn>(
  storage: SyncStorageInterface<unknown>,
  options: EnforceStorageKey<BaseStoreOptions<S, PersistedState, PersistReturn>>,
  persistThrottleMs: number | undefined,
  syncContext?: SyncContext
): SyncPersistStorage<PersistedState> {
  const enableMapSetHandling = !options.deserializer && !options.serializer && !storage.deserializer && !storage.serializer;
  const injectMetadata =
    typeof options.sync === 'object' && (options.sync.injectStorageMetadata ?? options.sync.engine?.injectStorageMetadata) === true;

  const partialize = options.partialize ?? omitStoreMethods<S, PersistedState>;
  const deserializer = options.deserializer ?? storage.deserializer ?? createDefaultDeserializer<PersistedState>(enableMapSetHandling);
  const serializer = options.serializer ?? storage.serializer ?? createDefaultSerializer<PersistedState>(enableMapSetHandling);

  function persist(name: string, storageValue: StorageValue<PersistedState>): void {
    try {
      if (shouldSkipPersistence(syncContext)) return;

      assertStateType<S, PersistedState>(storageValue.state);
      storageValue.state = partialize(storageValue.state);
      const metadataCapture = attachMetadata(syncContext, injectMetadata, storageValue);
      const serializedValue = serializer(storageValue);

      try {
        storage.set(name, serializedValue);
        clearMetadataSnapshot(syncContext, metadataCapture);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`), { error });
      }
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`), { error });
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
    setItem: (name, value) => {
      if (syncContext?.getIsApplyingRemote()) return;
      lazyPersist(name, value);
    },
    removeItem: name => {
      try {
        storage.delete(name);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to delete persisted store data`), { error });
      }
    },
  };
}

/**
 * Creates an asynchronous persist storage adapter for Zustand.
 */
export function createAsyncPersistStorage<S, PersistedState extends Partial<S>, PersistReturn>(
  storage: AsyncStorageInterface,
  options: EnforceStorageKey<BaseStoreOptions<S, PersistedState, PersistReturn>>,
  persistThrottleMs: number | undefined,
  syncContext?: SyncContext
): PersistStorage<PersistedState, Promise<void>> {
  const enableMapSetHandling = !options.deserializer && !options.serializer && !storage.deserializer && !storage.serializer;
  const injectMetadata =
    typeof options.sync === 'object' && (options.sync.injectStorageMetadata ?? options.sync.engine?.injectStorageMetadata) === true;

  const partialize = options.partialize ?? omitStoreMethods<S, PersistedState>;
  const deserializer = options.deserializer ?? storage.deserializer ?? createDefaultDeserializer<PersistedState>(enableMapSetHandling);
  const serializer = options.serializer ?? storage.serializer ?? createDefaultSerializer<PersistedState>(enableMapSetHandling);

  async function persist(name: string, storageValue: StorageValue<PersistedState>): Promise<void> {
    try {
      if (shouldSkipPersistence(syncContext)) return;

      assertStateType<S, PersistedState>(storageValue.state);
      storageValue.state = partialize(storageValue.state);
      const metadataCapture = attachMetadata(syncContext, injectMetadata, storageValue);
      const serializedValue = serializer(storageValue);

      try {
        await storage.set(name, serializedValue);
        clearMetadataSnapshot(syncContext, metadataCapture);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`), { error });
      }
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to serialize persisted store data`), { error });
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
    setItem: async (name, value) => {
      if (syncContext?.getIsApplyingRemote()) return;
      return await lazyPersist(name, value);
    },
    removeItem: async name => {
      try {
        await storage.delete(name);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to delete persisted store data`), { error });
      }
    },
  };
}

function assertStateType<S, PersistedState extends Partial<S>>(state: S | PersistedState): asserts state is S {
  return;
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
