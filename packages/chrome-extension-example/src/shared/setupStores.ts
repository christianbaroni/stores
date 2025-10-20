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
  configureStores({
    async: true,
    storage: new ChromeStorageAdapter({ namespace: STORAGE_NAMESPACE }),
    syncEngine: new ChromeExtensionSyncEngine({ namespace: STORAGE_NAMESPACE }),
  });
  configured = true;
}
