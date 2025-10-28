import { ChromeExtensionSyncEngine } from '../../../shared/chromeExtensionSyncEngine';
import { ChromeStorageAdapter } from '../../../shared/chromeStorageAdapter';

/**
 * Creates a synced Chrome storage engine for extension environments.
 * @returns
 * ```ts
 * { engine: ChromeExtensionSyncEngine; storage: ChromeStorageAdapter }
 * ```
 */
export function createSyncedChromeStorage(): {
  storage: ChromeStorageAdapter;
  syncEngine: ChromeExtensionSyncEngine;
} {
  const storage = new ChromeStorageAdapter();
  const syncEngine = new ChromeExtensionSyncEngine({ storage });
  return { storage, syncEngine };
}
