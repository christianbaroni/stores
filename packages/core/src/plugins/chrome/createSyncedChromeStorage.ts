import { ChromeExtensionSyncEngine } from './chromeExtensionSyncEngine';
import { AreaName, ChromeStorageAdapter } from './chromeStorageAdapter';

/**
 * Creates a synced Chrome storage engine for extension environments.
 * @returns
 * ```ts
 * { engine: ChromeExtensionSyncEngine; storage: ChromeStorageAdapter }
 * ```
 */
export function createSyncedChromeStorage(options?: { area?: AreaName; namespace?: string }): {
  storage: ChromeStorageAdapter;
  syncEngine: ChromeExtensionSyncEngine;
} {
  const storage = new ChromeStorageAdapter(options);
  const syncEngine = new ChromeExtensionSyncEngine({ storage });
  return { storage, syncEngine };
}
