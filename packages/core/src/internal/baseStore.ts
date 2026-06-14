import { createStore } from '../store/createStore';
import { persist } from '../store/persist';
import type { StoreApi, WithPersist } from '../store/types';
import type { NormalizedSyncConfig } from '../sync/types';
import type { BaseStoreOptions, StateCreator, SyncOption } from '../types';
import { getStorageConfig, markStoreCreated } from './config';
import { StoresError } from './errors';
import { createHydrationGate } from './middleware/createHydrationGate';
import { createPersistStorage } from './storage/storageCreators';
import { createSyncedStateCreator } from './sync/syncEnhancer';

// ============ Store Creator ================================================== //

/** @internal */
export function baseStore<S, PersistedState extends Partial<S>, PersistReturn extends void | Promise<void>>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): StoreApi<S> | WithPersist<StoreApi<S>, PersistedState, PersistReturn> {
  markStoreCreated();

  if (!options) return createStore(createState);

  const storageKey = options.storageKey;
  const isPersisted = typeof storageKey === 'string';
  const storage = isPersisted ? (options.storage ?? getStorageConfig().storage) : undefined;

  const normalizedSync = normalizeSyncOption(options.sync, storageKey);
  const syncMiddleware = normalizedSync ? createSyncedStateCreator(createState, normalizedSync, storage?.async ?? false) : undefined;
  const stateCreator = syncMiddleware?.stateCreator ?? createState;

  if (!isPersisted) return createStore(stateCreator);

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

  const store = createStore(
    persist<S, PersistedState, PersistReturn>(finalStateCreator, {
      merge: options.merge,
      migrate: options.migrate,
      name: storageKey,
      onRehydrateStorage,
      storage: storageConfig.persistStorage,
      version: storageConfig.version,
    })
  );

  if (!hydrationGate) return store;

  return Object.assign(store, {
    persist: Object.assign(store.persist, { hydrationPromise: hydrationGate.hydrationPromise }),
  });
}

// ============ Sync Options =================================================== //

function normalizeSyncOption<S extends Record<string, unknown>>(
  syncOption: SyncOption<S> | undefined,
  storageKey: string | undefined
): NormalizedSyncConfig<S> | null {
  if (!syncOption) return null;

  const isObject = typeof syncOption === 'object';
  const key = isObject ? (syncOption.key ?? storageKey) : syncOption === true ? storageKey : syncOption;

  if (!key) throw new StoresError('[createBaseStore]: sync requires a key to be specified either directly or via storageKey');

  return isObject ? { ...syncOption, key } : { key };
}
