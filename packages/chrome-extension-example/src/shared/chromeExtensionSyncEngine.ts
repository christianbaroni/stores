import type { SyncEngine, SyncHandle, SyncRegistration, SyncUpdate, SyncValues } from '@stores';
import { ChromeStorageAdapter } from './chromeStorageAdapter';

export type ChromeExtensionSyncEngineOptions =
  | {
      area?: 'local' | 'session' | 'sync' | 'managed';
      namespace?: string;
    }
  | { storage: ChromeStorageAdapter };

type SyncStoragePayload = {
  replace: boolean;
  storeKey: string;
  timestamp: number;
  values: Record<string, unknown>;
};

type RegistrationContainer = {
  registration: SyncRegistration<Record<string, unknown>>;
};

function getRuntimeError(): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.lastError) return null;
  return new Error(chrome.runtime.lastError.message);
}

function getStorageArea(area: 'local' | 'session' | 'sync' | 'managed'): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage[area] ?? null;
}

export class ChromeExtensionSyncEngine implements SyncEngine {
  readonly area: 'local' | 'session' | 'sync' | 'managed';
  readonly namespace: string;
  private readonly registrations = new Map<string, RegistrationContainer>();
  private isListening = false;

  constructor(options?: ChromeExtensionSyncEngineOptions) {
    if (options && 'storage' in options) {
      this.area = options.storage.area;
      this.namespace = options.storage.namespace;
    } else {
      this.area = options?.area ?? 'local';
      this.namespace = options?.namespace ?? '@stores/chrome-extension-sync';
    }
    this.attachListener();
  }

  register<T extends Record<string, unknown>>(registration: SyncRegistration<T>): SyncHandle<T> {
    this.attachListener();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    this.registrations.set(registration.key, { registration } as RegistrationContainer);

    return {
      destroy: () => {
        this.registrations.delete(registration.key);
        if (!this.registrations.size) this.detachListener();
      },
      hydrated: () => true,
      onHydrated: callback => {
        callback();
      },
      publish: update => {
        this.publishUpdate(registration.key, update);
      },
    };
  }

  private attachListener(): void {
    if (typeof chrome === 'undefined' || !chrome.storage || this.isListening) return;
    chrome.storage.onChanged.addListener(this.onStorageChanged);
    this.isListening = true;
  }

  private detachListener(): void {
    if (typeof chrome === 'undefined' || !chrome.storage || !this.isListening) return;
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    this.isListening = false;
  }

  private publishUpdate<T extends Record<string, unknown>>(storeKey: string, update: SyncUpdate<T>): void {
    const storage = getStorageArea(this.area);
    if (!storage) return;

    const payload: SyncStoragePayload = {
      replace: update.replace,
      storeKey,
      timestamp: update.timestamp,
      values: { ...update.values },
    };

    storage.set({ [this.toStorageKey(storeKey)]: payload }, () => {
      // Ignore chrome.runtime.lastError to suppress expected storage quota or receiver errors
      void getRuntimeError();
    });
  }

  private onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: 'local' | 'session' | 'sync' | 'managed'
  ): void => {
    if (areaName !== 'local') return;

    const prefix = this.namespacePrefix();
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(prefix)) continue;
      if (!change.newValue) continue;

      const payload = change.newValue;
      if (payload.storeKey && key !== this.toStorageKey(payload.storeKey)) continue;

      const container = this.registrations.get(payload.storeKey);
      if (!container) continue;

      const filteredValues: SyncValues<Record<string, unknown>> = {};
      for (const field of container.registration.fields) {
        if (Object.prototype.hasOwnProperty.call(payload.values, field)) {
          filteredValues[field] = payload.values[field];
        }
      }

      if (!Object.keys(filteredValues).length && !payload.replace) continue;

      container.registration.apply({
        replace: payload.replace,
        timestamp: payload.timestamp,
        values: filteredValues,
      });
    }
  };

  private namespacePrefix(): string {
    return `${this.namespace}:`;
  }

  private toStorageKey(key: string): string {
    return `${this.namespacePrefix()}${key}`;
  }
}
