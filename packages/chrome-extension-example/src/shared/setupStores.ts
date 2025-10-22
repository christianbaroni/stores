import { configureStores } from '@stores';
import { ChromeExtensionSyncEngine } from './chromeExtensionSyncEngine';
import { ChromeStorageAdapter } from './chromeStorageAdapter';

const STORAGE_NAMESPACE = '@stores/chrome-extension-example';

let configured = false;

export function ensureExtensionStoresConfigured(): void {
  if (configured) return;
  if (typeof chrome === 'undefined' || !chrome.storage) {
    configured = true;
    return;
  }
  const storage = new ChromeStorageAdapter({ namespace: STORAGE_NAMESPACE });
  configureStores({
    async: true,
    storage,
    syncEngine: new ChromeExtensionSyncEngine({ storage }),
  });
  configured = true;
}
