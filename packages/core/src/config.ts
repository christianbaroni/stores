import { IS_BROWSER, IS_DEV } from '@env';
import { storesStorage } from '@storesStorage';
import { createBrowserSyncEngine } from './sync/browserSyncEngine';
import { createNoopSyncEngine } from './sync/noopSyncEngine';
import { SyncEngine } from './sync/types';
import { AsyncStorageInterface, SyncStorageInterface } from './types';

// ============ Types ========================================================== //

export type StoresConfig = { syncEngine: SyncEngine } & (
  | {
      async: true;
      storage: AsyncStorageInterface;
    }
  | {
      async: false;
      storage: SyncStorageInterface;
    }
);

export type StoresConfigUpdate =
  | { async?: undefined; storage?: undefined; syncEngine: SyncEngine }
  | {
      async: true;
      storage: AsyncStorageInterface;
      syncEngine?: SyncEngine;
    }
  | {
      async: false;
      storage: SyncStorageInterface;
      syncEngine?: SyncEngine;
    };

// ============ Stores Configuration =========================================== //

let activeConfig: StoresConfig = createDefaultConfig();
let storeCreated = false;

function createDefaultConfig(): StoresConfig {
  return {
    async: false,
    storage: storesStorage,
    syncEngine: IS_BROWSER ? createBrowserSyncEngine() : createNoopSyncEngine(),
  };
}

export function configureStores(update: StoresConfigUpdate): void {
  if (IS_DEV && storeCreated) {
    throw new Error(
      '[configureStores]: Configuration cannot be changed after the first store has been created. ' +
        'Call configureStores before creating any stores.'
    );
  }

  if (update.async !== undefined) activeConfig.async = update.async;
  if (update.storage) activeConfig.storage = update.storage;
  if (update.syncEngine) activeConfig.syncEngine = update.syncEngine;
}

export function getStoresConfig(): StoresConfig {
  return activeConfig;
}

export function markStoreCreated(): void {
  storeCreated = true;
}
