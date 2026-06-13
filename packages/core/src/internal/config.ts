import { IS_BROWSER, IS_DEV } from '@/env';
import { createStoresStorage } from '@/storage';
import { QueryStoreConfig } from '../queryStore/types';
import { SyncEngine } from '../sync/types';
import { AsyncStorageInterface, SyncStorageInterface } from '../types';
import { NonFunction } from '../types/functions';
import { Prettify } from '../types/objects';
import { Logger, setLogger } from './logger';
import { createBrowserSyncEngine } from './sync/browserSyncEngine';
import { createNoopSyncEngine } from './sync/noopSyncEngine';

// ============ Types ========================================================== //

/**
 * Global configuration for all stores.
 */
export type StoresConfig = {
  /**
   * Custom logger for debug output. Defaults to a no-op logger in production.
   */
  logger: Logger;

  /**
   * Default options used by all query stores.
   */
  queryStoreDefaults: QueryStoreDefaults;

  /**
   * Storage backend for persisted stores. Defaults to `localStorage` in browsers,
   * MMKV in React Native.
   */
  storage: AsyncStorageInterface | SyncStorageInterface;

  /**
   * Prefix for storage keys built by the default storage adapter.
   * Should include a delimiter, e.g., `'myapp:'`.
   * @default 'stores:'
   */
  storageKeyPrefix: string;

  /**
   * Sync engine for cross-client state synchronization. Defaults to cross-tab sync
   * in browsers, no-op in other environments.
   */
  syncEngine: SyncEngine;
};

export type QueryStoreDefaults = Prettify<
  ConfigDefaults<QueryStoreConfig<unknown, Record<string, unknown>>, 'disableCache' | 'enabled' | 'params', 'retryDelay'>
> & {
  /**
   * Minimum stale time for auto-refetching query stores under which to log warnings in development.
   * `false` disables warnings.
   * @default false
   */
  minStaleTime?: number | false;
};

type ConfigDefaults<C, Excluded extends keyof C = never, AllowedFunctions extends keyof C = never> = Omit<
  {
    [K in keyof C as K extends AllowedFunctions ? K : NonFunction<C[K]> extends undefined ? never : K]?: K extends AllowedFunctions
      ? C[K]
      : NonFunction<C[K]>;
  },
  Excluded
>;

type Options = Pick<StoresConfig, 'queryStoreDefaults'>;
type StorageConfig = Pick<StoresConfig, 'storage' | 'syncEngine'>;

// ============ Constants ====================================================== //

/** @internal */
export const DEFAULT_STORAGE_KEY_PREFIX = 'stores:';

// ============ Stores Config ================================================== //

let optionsConfig: Options | undefined;
let storageConfig: StorageConfig | undefined;
let configLocked = false;

/**
 * Configures global defaults for all stores.
 *
 * If used, must be called before creating any stores.
 *
 * @see {@link StoresConfig}
 *
 * @example
 * ```ts
 * configureStores({
 *   logger: { debug: console.debug, error: console.error },
 *   storageKeyPrefix: 'myapp:',
 * });
 * ```
 */
export function configureStores(config: Partial<StoresConfig>): void {
  if (IS_DEV) throwIfLocked();
  if (config.logger) setLogger(config.logger);
  optionsConfig ??= buildOptions(config);
  storageConfig ??= buildStorageConfig(config);
}

// ============ Internal Helpers =============================================== //

/** @internal */
export function getOptions(): Options | undefined {
  if (!optionsConfig) return undefined;
  return optionsConfig;
}

/** @internal */
export function getStorageConfig(): StorageConfig {
  return (storageConfig ??= buildStorageConfig(undefined));
}

/** @internal */
export function markStoreCreated(): void {
  configLocked = true;
}

// ============ Utilities ====================================================== //

function buildOptions(config: Partial<StoresConfig> | undefined): Options | undefined {
  if (!config?.queryStoreDefaults) return undefined;
  return { queryStoreDefaults: config.queryStoreDefaults };
}

function buildStorageConfig(config: Partial<StoresConfig> | undefined): StorageConfig {
  return {
    storage: config?.storage ?? createStoresStorage(config?.storageKeyPrefix ?? DEFAULT_STORAGE_KEY_PREFIX),
    syncEngine: config?.syncEngine ?? (IS_BROWSER ? createBrowserSyncEngine() : createNoopSyncEngine()),
  };
}

function throwIfLocked(): void {
  if (configLocked) {
    throw new Error('[stores]: configureStores() called after first store creation. Call it earlier before creating any stores.');
  }
}
