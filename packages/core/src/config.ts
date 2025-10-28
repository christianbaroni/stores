import { IS_BROWSER, IS_DEV } from '@env';
import { storesStorage } from '@storesStorage';
import { createBrowserSyncEngine } from './sync/browserSyncEngine';
import { createNoopSyncEngine } from './sync/noopSyncEngine';
import { SyncEngine } from './sync/types';
import { AsyncStorageInterface, SyncStorageInterface } from './types';

// ============ Types ========================================================== //

export type StoresConfig = {
  storage: AsyncStorageInterface | SyncStorageInterface;
  syncEngine: SyncEngine;
};

// ============ Stores Configuration =========================================== //

let activeConfig: StoresConfig = createDefaultConfig();
let configLocked = false;

function createDefaultConfig(): StoresConfig {
  return {
    storage: storesStorage,
    syncEngine: IS_BROWSER ? createBrowserSyncEngine() : createNoopSyncEngine(),
  };
}

export function configureStores(update: Partial<StoresConfig>): void {
  if (IS_DEV && configLocked) {
    throw new Error(
      '[configureStores]: Configuration cannot be changed after the first store has been created. ' +
        'Call configureStores before creating any stores.'
    );
  }
  if (update.storage) activeConfig.storage = update.storage;
  if (update.syncEngine) activeConfig.syncEngine = update.syncEngine;
}

export function getStoresConfig(): StoresConfig {
  return activeConfig;
}

export function markStoreCreated(): void {
  configLocked = true;
}
