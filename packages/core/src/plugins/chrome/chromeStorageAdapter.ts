import { AsyncStorageInterface } from '../../types';
import { StorageValue } from '../../storage/storageTypes';
import { replacer, reviver } from '../../utils/serialization';

export const CHROME_STORAGE_NAMESPACE = 'stores/chrome-storage';
const ENABLE_LOGS = false;

export type AreaName = keyof Pick<typeof chrome.storage, 'local' | 'managed' | 'session' | 'sync'>;

export type ChromeStorageAdapterOptions = {
  area?: AreaName;
  namespace?: string;
};

export type ChromeStorageValue<PersistedState = unknown> = StorageValue<PersistedState>;

export class ChromeStorageAdapter implements AsyncStorageInterface {
  readonly area: 'local' | 'session' | 'sync' | 'managed';
  readonly namespace: string;

  readonly async = true;
  readonly deserializer = deserializeChromeStorageValue;
  readonly serializer = serializeChromeStorageValue;

  constructor(options?: ChromeStorageAdapterOptions) {
    this.area = options?.area ?? 'local';
    this.namespace = options?.namespace ?? CHROME_STORAGE_NAMESPACE;
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

  async get(key: string): Promise<unknown> {
    const storage = this.ensureStorage();
    if (!storage) return undefined;
    const storageKey = this.toStorageKey(key);
    const result = await this.getFromStorage(storage, storageKey);
    const value = result[storageKey];
    if (!isChromeStorageValue(value)) return undefined;
    if (ENABLE_LOGS) console.log(`[ChromeStorageAdapter] get("${key}"): FOUND`, value);
    return value;
  }

  async set(key: string, value: unknown): Promise<void> {
    if (ENABLE_LOGS) console.log('[💾 storage.set 💾] Persisting value for key:', key);
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

function getChromeStorageArea(area: AreaName): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage) return null;
  return chrome.storage[area] ?? null;
}

function getRuntimeError(): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.lastError) return null;
  return new Error(chrome.runtime.lastError.message);
}

export function serializeChromeStorageValue<PersistedState>(storageValue: StorageValue<PersistedState>): unknown {
  return {
    state: applyReplacerToState(storageValue.state),
    syncMetadata: storageValue.syncMetadata,
    version: storageValue.version,
  };
}

export function deserializeChromeStorageValue<PersistedState>(serializedState: unknown): StorageValue<PersistedState> {
  if (!isChromeStorageValue(serializedState)) {
    throw new Error('[ChromeStorageAdapter] Invalid serialized state format');
  }
  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    state: applyReviverToState(serializedState.state) as PersistedState,
    syncMetadata: serializedState.syncMetadata,
    version: serializedState.version,
  };
}

function isChromeStorageValue(value: unknown): value is StorageValue<unknown> {
  if (!value || typeof value !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(value, 'state');
}

function applyReplacerToState(value: unknown, replacerFn = replacer): unknown {
  if (value instanceof Map || value instanceof Set) return replacerFn.call(undefined, '', value);
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = replacerFn.call(value, key, child);
  }
  return result;
}

function applyReviverToState(value: unknown, reviverFn = reviver): unknown {
  const revivedRoot = reviverFn.call(undefined, '', value);
  if (!isPlainObject(revivedRoot)) return revivedRoot;
  const result: Record<string, unknown> = {};
  for (const entry of Object.entries(revivedRoot)) {
    const key = entry[0];
    const child = entry[1];
    result[key] = reviverFn.call(revivedRoot, key, child);
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
