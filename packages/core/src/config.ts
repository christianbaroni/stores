import { IS_BROWSER } from '@env';
import { storesStorage } from '@storesStorage';
import { createBrowserSyncEngine } from './sync/browserSyncEngine';
import { createNoopSyncEngine } from './sync/noopSyncEngine';
import type { SyncEngine } from './sync/types';
import type { StorageInterface } from './types';

// ============ Stores Configuration =========================================== //

export type StoresConfig = {
  storage: StorageInterface;
  syncEngine: SyncEngine;
};

export type StoresConfigUpdate = Partial<StoresConfig> | ((current: StoresConfig) => Partial<StoresConfig> | StoresConfig);

function createDefaultConfig(): StoresConfig {
  return {
    storage: storesStorage,
    syncEngine: IS_BROWSER ? createBrowserSyncEngine() : createNoopSyncEngine(),
  };
}

let activeConfig: StoresConfig = createDefaultConfig();

export function configureStores(update: StoresConfigUpdate): void {
  const result = typeof update === 'function' ? update(activeConfig) : update;
  if (!result) return;

  if (result.storage) activeConfig.storage = result.storage;
  if (result.syncEngine) activeConfig.syncEngine = result.syncEngine;
}

export function getStoresConfig(): StoresConfig {
  return activeConfig;
}
