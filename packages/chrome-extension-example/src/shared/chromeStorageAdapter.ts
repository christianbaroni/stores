import type { AsyncStorageInterface } from '@stores';

const DEFAULT_NAMESPACE = '@stores/chrome-storage';

export type ChromeStorageAdapterOptions = {
  area?: 'local' | 'session' | 'sync';
  namespace?: string;
};

function getChromeStorageArea(area: 'local' | 'session' | 'sync'): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage[area] ?? null;
}

function getRuntimeError(): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.lastError) return null;
  return new Error(chrome.runtime.lastError.message);
}

export class ChromeStorageAdapter implements AsyncStorageInterface {
  readonly async = true;
  private readonly area: 'local' | 'session' | 'sync';
  private readonly namespace: string;

  constructor(options?: ChromeStorageAdapterOptions) {
    this.area = options?.area ?? 'local';
    this.namespace = options?.namespace ?? DEFAULT_NAMESPACE;
  }

  async clearAll(): Promise<void> {
    const storage = this.ensureStorage();
    if (!storage) return;
    const prefix = this.namespacePrefix();
    const keys = await this.listPrefixedKeys(storage, prefix);
    if (!keys.length) return;
    await this.execute(storage, done => storage.remove(keys, done));
  }

  async contains(key: string): Promise<boolean> {
    const storage = this.ensureStorage();
    if (!storage) return false;
    const storageKey = this.toStorageKey(key);
    const result = await this.getFromStorage(storage, storageKey);
    return Object.prototype.hasOwnProperty.call(result, storageKey);
  }

  async delete(key: string): Promise<void> {
    const storage = this.ensureStorage();
    if (!storage) return;
    const storageKey = this.toStorageKey(key);
    await this.execute(storage, done => storage.remove(storageKey, done));
  }

  async getAllKeys(): Promise<string[]> {
    const storage = this.ensureStorage();
    if (!storage) return [];
    const prefix = this.namespacePrefix();
    const result = await this.getFromStorage(storage, null);
    return Object.keys(result)
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length));
  }

  async getString(key: string): Promise<string | undefined> {
    const storage = this.ensureStorage();
    if (!storage) return undefined;
    const storageKey = this.toStorageKey(key);
    const result = await this.getFromStorage(storage, storageKey);
    const value = result[storageKey];
    return typeof value === 'string' ? value : undefined;
  }

  async set(key: string, value: string): Promise<void> {
    const storage = this.ensureStorage();
    if (!storage) return;
    const storageKey = this.toStorageKey(key);
    await this.execute(storage, done => storage.set({ [storageKey]: value }, done));
  }

  private ensureStorage(): chrome.storage.StorageArea | null {
    return getChromeStorageArea(this.area);
  }

  private namespacePrefix(): string {
    return this.namespace ? `${this.namespace}:` : '';
  }

  private toStorageKey(key: string): string {
    return `${this.namespacePrefix()}${key}`;
  }

  private async listPrefixedKeys(storage: chrome.storage.StorageArea, prefix: string): Promise<string[]> {
    const result = await this.getFromStorage(storage, null);
    return Object.keys(result).filter(key => key.startsWith(prefix));
  }

  private async getFromStorage(storage: chrome.storage.StorageArea, keys: string | string[] | null): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      try {
        storage.get(keys, items => {
          const runtimeError = getRuntimeError();
          if (runtimeError) {
            reject(runtimeError);
            return;
          }
          resolve(items);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async execute(storage: chrome.storage.StorageArea, operation: (done: () => void) => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      try {
        operation(() => {
          const runtimeError = getRuntimeError();
          if (runtimeError) {
            reject(runtimeError);
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }
}
