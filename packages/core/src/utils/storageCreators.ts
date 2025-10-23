import { AsyncStorageInterface, LazyPersistParams, PersistWithOptionalSync, SyncStorageInterface } from 'src/types';
import { PersistStorage, StorageValue } from 'zustand/middleware';
import { IS_BROWSER, IS_IOS, IS_TEST } from '@env';
import { getStoresConfig } from '../config';
import { logger, StoresError } from '../logger';
import { debounce } from './debounce';
import { defaultDeserializeState, defaultSerializeState, omitStoreMethods } from './persistUtils';
import { time } from './time';

type SyncPersistStorage<S, R = unknown> = {
  getItem: (name: string) => StorageValue<S> | null;
  setItem: (name: string, value: StorageValue<S>) => R;
  removeItem: (name: string) => R;
};

const DEFAULT_PERSIST_THROTTLE_MS = IS_TEST ? 0 : IS_BROWSER ? time.ms(200) : IS_IOS ? time.seconds(3) : time.seconds(5);

/**
 * Creates a persist storage object for the base store.
 */
export function createPersistStorage<S, PersistedState extends Partial<S>, PersistReturn>(
  options: PersistWithOptionalSync<S, PersistedState, PersistReturn>
): {
  persistStorage: SyncPersistStorage<PersistedState> | PersistStorage<PersistedState>;
  version: number;
} {
  const parsedStorage = options.storage ?? getStoresConfig().storage;
  const persistThrottleMs = options.sync ? undefined : DEFAULT_PERSIST_THROTTLE_MS;
  const version = options.version ?? 0;

  const persistStorage = parsedStorage.async
    ? createAsyncPersistStorage(parsedStorage, options, persistThrottleMs)
    : createSyncPersistStorage(parsedStorage, options, persistThrottleMs);

  return { persistStorage, version };
}

/**
 * Creates a synchronous persist storage adapter for Zustand.
 */
function createSyncPersistStorage<S, PersistedState extends Partial<S>, PersistReturn>(
  storage: SyncStorageInterface,
  options: PersistWithOptionalSync<S, PersistedState, PersistReturn>,
  persistThrottleMs: number | undefined
): SyncPersistStorage<PersistedState> {
  const enableMapSetHandling = !options.deserializer && !options.serializer;
  const {
    deserializer = (serializedState: string) => defaultDeserializeState<PersistedState>(serializedState, enableMapSetHandling),
    serializer = (state: PersistedState, version: number | undefined) =>
      defaultSerializeState<PersistedState>(state, version, enableMapSetHandling),
    storageKey,
  } = options;

  function persist(params: LazyPersistParams<S, PersistedState>): void {
    try {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const serializedValue = params.serializer(params.partialize(params.value.state as S), params.value.version ?? 0);
      storage.set(params.name, serializedValue);
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`), { error });
    }
  }

  const lazyPersist = persistThrottleMs
    ? debounce(persist, persistThrottleMs, { leading: false, maxWait: persistThrottleMs, trailing: true })
    : persist;

  return {
    getItem: name => {
      const serializedValue = storage.getString(name);
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
  options: PersistWithOptionalSync<S, PersistedState, PersistReturn>,
  persistThrottleMs: number | undefined
): PersistStorage<PersistedState> {
  const enableMapSetHandling = !options.deserializer && !options.serializer;
  const {
    deserializer = (serializedState: string) => defaultDeserializeState<PersistedState>(serializedState, enableMapSetHandling),
    serializer = (state: PersistedState, version: number | undefined) =>
      defaultSerializeState<PersistedState>(state, version, enableMapSetHandling),
    storageKey,
  } = options;

  async function persist(params: LazyPersistParams<S, PersistedState>): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const serializedValue = params.serializer(params.partialize(params.value.state as S), params.value.version ?? 0);
      await storage.set(params.name, serializedValue).catch(error => {
        logger.error(new StoresError(`[createBaseStore]: Failed to persist store data`), { error });
      });
    } catch (error) {
      logger.error(new StoresError(`[createBaseStore]: Failed to serialize persisted store data`), { error });
    }
  }

  const lazyPersist = persistThrottleMs
    ? debounce(
        async (params: LazyPersistParams<S, PersistedState>) => {
          return await persist(params);
        },
        persistThrottleMs,
        { leading: false, maxWait: persistThrottleMs, trailing: true }
      )
    : async (params: LazyPersistParams<S, PersistedState>) => {
        return await persist(params);
      };

  return {
    getItem: async name => {
      const serializedValue = await storage.getString(name);
      if (!serializedValue) return null;
      return deserializer(serializedValue);
    },
    setItem: async (name, value) => {
      await lazyPersist({
        partialize: options.partialize ?? omitStoreMethods<S, PersistedState>,
        serializer,
        storageKey,
        name,
        value,
      });
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
