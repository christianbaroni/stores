import { IS_BROWSER, IS_DEV } from '@/env';
import { createStoresStorage } from '@/storage';
import { Logger, setLogger } from './logger';
import { createBrowserSyncEngine } from './sync/browserSyncEngine';
import { createNoopSyncEngine } from './sync/noopSyncEngine';
import { SyncEngine } from './sync/types';
import { AsyncStorageInterface, SyncStorageInterface } from './types';

// ============ Types ========================================================== //

/**
 * Global configuration for all stores.
 */
export type StoresConfig = {
  /** Custom logger for debug output. Defaults to a no-op logger in production. */
  logger: Logger;

  /** Storage backend for persisted stores. Defaults to `localStorage` in browsers, MMKV in React Native. */
  storage: AsyncStorageInterface | SyncStorageInterface;

  /**
   * Prefix for storage keys built by the default storage adapter.
   * Should include a delimiter, e.g., `'myapp:'`.
   * @default 'stores:'
   */
  storageKeyPrefix: string;

  /** Sync engine for cross-client state synchronization. Defaults to cross-tab sync in browsers. */
  syncEngine: SyncEngine;
};

type StorageConfig = Pick<StoresConfig, 'storage' | 'syncEngine'>;

// ============ Constants ====================================================== //

export const DEFAULT_STORAGE_KEY_PREFIX = 'stores:';

// ============ Stores Config ================================================== //

let activeConfig: StorageConfig | undefined;
let configLocked = false;

/**
 * Configures global defaults for all stores. Must be called before creating any stores.
 *
 * @see {@link StoresConfig} for details.
 *
 * @example
 * ```ts
 * configureStores({
 *   logger: { debug: console.debug, error: console.error },
 *   storageKeyPrefix: 'myapp:',
 * });
 * ```
 */
export function configureStores(update: Partial<StoresConfig>): void {
  if (IS_DEV) throwIfLocked();
  if (update.logger) setLogger(update.logger);
  activeConfig ??= buildConfig(update);
}

export function getStoresConfig(): StorageConfig {
  return (activeConfig ??= buildConfig(undefined));
}

export function markStoreCreated(): void {
  configLocked = true;
}

// ============ Utilities ====================================================== //

function buildConfig(update: Partial<StoresConfig> | undefined): StorageConfig {
  return {
    storage: update?.storage ?? createStoresStorage(update?.storageKeyPrefix ?? DEFAULT_STORAGE_KEY_PREFIX),
    syncEngine: update?.syncEngine ?? (IS_BROWSER ? createBrowserSyncEngine() : createNoopSyncEngine()),
  };
}

function throwIfLocked(): void {
  if (configLocked) {
    throw new Error('[stores]: configureStores() called after first store creation. Call it earlier before creating any stores.');
  }
}
