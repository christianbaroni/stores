import { IS_BROWSER } from '@env';
import { storesStorage } from '@storesStorage';
import { createBrowserSyncEngine } from './sync/browserSyncEngine';
import { createNoopSyncEngine } from './sync/noopSyncEngine';
import type { SyncEngine } from './sync/types';
import type { AsyncStorageInterface, SyncStorageInterface } from './types';

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

export type StoresConfigUpdate = ConfigUpdate | ((current: StoresConfig) => ConfigUpdate);

type ConfigUpdate =
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

function createDefaultConfig(): StoresConfig {
  return {
    async: false,
    storage: storesStorage,
    syncEngine: IS_BROWSER ? createBrowserSyncEngine() : createNoopSyncEngine(),
  };
}

export function configureStores(update: StoresConfigUpdate): void {
  const result = typeof update === 'function' ? update(activeConfig) : update;
  if (!result) return;

  if (result.async !== undefined) activeConfig.async = result.async;
  if (result.storage) activeConfig.storage = result.storage;
  if (result.syncEngine) activeConfig.syncEngine = result.syncEngine;
}

export function getStoresConfig(): StoresConfig {
  return activeConfig;
}
