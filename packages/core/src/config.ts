import { IS_BROWSER, IS_DEV } from '@env';
import { StoresLogger, setLogger } from './logger';
import { storesStorage } from './storesStorage';
import { createBrowserSyncEngine } from './sync/browserSyncEngine';
import { createNoopSyncEngine } from './sync/noopSyncEngine';
import { SyncEngine } from './sync/types';
import { AsyncStorageInterface, SyncStorageInterface } from './types';

// ============ Types ========================================================== //

export type StoresConfig = {
  logger: StoresLogger;
  storage: AsyncStorageInterface | SyncStorageInterface;
  syncEngine: SyncEngine;
};

type ConfigWithoutLogger = Omit<StoresConfig, 'logger'>;

// ============ Stores Configuration =========================================== //

let activeConfig: ConfigWithoutLogger | undefined;
let configLocked = false;

export function configureStores(update: Partial<StoresConfig>): void {
  activeConfig ??= createDefaultConfig();
  if (IS_DEV && configLocked) {
    throw new Error(
      '[configureStores]: Configuration cannot be changed after the first store has been created. ' +
        'Call configureStores before creating any stores.'
    );
  }
  if (update.logger) setLogger(update.logger);
  if (update.storage) activeConfig.storage = update.storage;
  if (update.syncEngine) activeConfig.syncEngine = update.syncEngine;
}

export function getStoresConfig(): ConfigWithoutLogger {
  return (activeConfig ??= createDefaultConfig());
}

export function markStoreCreated(): void {
  configLocked = true;
}

function createDefaultConfig(): ConfigWithoutLogger {
  return {
    storage: storesStorage,
    syncEngine: IS_BROWSER ? createBrowserSyncEngine() : createNoopSyncEngine(),
  };
}
