import { PersistStorage, persist, subscribeWithSelector } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';
import { IS_BROWSER, IS_IOS, IS_TEST } from './env';
import { StoresError, logger } from './logger';
import { storesStorage } from './storesStorage';
import { LazyPersistParams, PersistConfig, Store, StateCreator } from './types';
import { debounce } from './utils/debounce';
import { defaultDeserializeState, defaultSerializeState, omitStoreMethods } from './utils/persistUtils';
import { time } from './utils/time';

/**
 * Creates a base store without persistence.
 * @param createState - The state creator function for the base store.
 * @returns A Zustand store with the specified state and optional persistence.
 */
export function createBaseStore<S>(createState: StateCreator<S>): Store<S>;

/**
 * Creates a persisted base store.
 * @param createState - The state creator function for the base store.
 * @param persistConfig - The configuration options for the persistable base store.
 * @returns A Zustand store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>>(
  createState: StateCreator<S>,
  persistConfig: PersistConfig<S, PersistedState>
): Store<S, PersistedState>;

/**
 * Creates a base store with optional persistence functionality.
 * @param createState - The state creator function for the base store.
 * @param persistConfig - The configuration options for the persistable base store.
 * @returns A Zustand store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>>(
  createState: StateCreator<S>,
  persistConfig?: PersistConfig<S, PersistedState>
): Store<S> | Store<S, PersistedState> {
  if (!persistConfig) return createWithEqualityFn<S>()(subscribeWithSelector(createState), Object.is);

  const { persistStorage, version } = createPersistStorage<S, PersistedState>(persistConfig);

  return createWithEqualityFn<S>()(
    subscribeWithSelector(
      persist(createState, {
        migrate: persistConfig.migrate,
        name: persistConfig.storageKey,
        onRehydrateStorage: persistConfig.onRehydrateStorage,
        storage: persistStorage,
        version,
      })
    ),
    Object.is
  );
}

const DEFAULT_PERSIST_THROTTLE_MS = IS_TEST ? 0 : IS_BROWSER ? time.ms(200) : IS_IOS ? time.seconds(3) : time.seconds(5);

/**
 * Creates a persist storage object for the base store.
 * @param config - The configuration options for the persistable base store.
 * @returns An object containing the persist storage and version.
 */
function createPersistStorage<S, PersistedState extends Partial<S>>(config: PersistConfig<S, PersistedState>) {
  const enableMapSetHandling = !config.deserializer && !config.serializer;
  const {
    deserializer = serializedState => defaultDeserializeState<PersistedState>(serializedState, enableMapSetHandling),
    serializer = (state, version) => defaultSerializeState<PersistedState>(state, version, enableMapSetHandling),
    persistThrottleMs = DEFAULT_PERSIST_THROTTLE_MS,
    storageKey,
    version = 0,
  } = config;

  const lazyPersist = debounce(
    function persist(params: LazyPersistParams<S, PersistedState>): void {
      try {
        const key = `${params.storageKey}:${params.name}`;
        const serializedValue = params.serializer(params.partialize(params.value.state as S), params.value.version ?? 0);
        storesStorage.set(key, serializedValue);
      } catch (error) {
        logger.error(new StoresError(`[createBaseStore]: Failed to serialize persisted store data`), { error });
      }
    },
    persistThrottleMs,
    { leading: false, maxWait: persistThrottleMs, trailing: true }
  );

  const persistStorage: PersistStorage<PersistedState> = {
    getItem: (name: string) => {
      const key = `${storageKey}:${name}`;
      const serializedValue = storesStorage.getString(key);
      if (!serializedValue) return null;
      return deserializer(serializedValue);
    },
    setItem: (name, value) => {
      lazyPersist({
        partialize: config.partialize ?? omitStoreMethods<S, PersistedState>,
        serializer,
        storageKey,
        name,
        value,
      });
    },
    removeItem: (name: string) => {
      const key = `${storageKey}:${name}`;
      storesStorage.delete(key);
    },
  };

  return { persistStorage, version };
}
