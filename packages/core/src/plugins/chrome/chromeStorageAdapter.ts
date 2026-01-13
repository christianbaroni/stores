import { DEFAULT_STORAGE_KEY_PREFIX } from '../../config';
import { StorageValue } from '../../storage/storageTypes';
import { AsyncStorageInterface } from '../../types';
import { isPlainObject } from '../../types/utils';
import { isPromiseLike } from '../../utils/promiseUtils';
import { replacer, reviver } from '../../utils/serialization';

const ENABLE_LOGS = false;

export type AreaName = keyof Pick<typeof chrome.storage, 'local' | 'managed' | 'session' | 'sync'>;

export type ChromeStorageAdapterOptions = {
  area?: AreaName;
  storageKeyPrefix?: string;
};

export type ChromeStorageValue<PersistedState = unknown> = StorageValue<PersistedState>;

export class ChromeStorageAdapter implements AsyncStorageInterface {
  readonly area: AreaName;
  readonly storageKeyPrefix: string;

  readonly async = true;
  readonly deserializer = deserializeChromeStorageValue;
  readonly serializer = serializeChromeStorageValue;

  constructor(options?: ChromeStorageAdapterOptions) {
    this.area = options?.area ?? 'local';
    this.storageKeyPrefix = options?.storageKeyPrefix ?? DEFAULT_STORAGE_KEY_PREFIX;
  }

  async clearAll(): Promise<void> {
    const storage = this.ensureStorage();
    if (!storage) return;
    if (!this.storageKeyPrefix) {
      throw new Error('Cannot clear all storage with empty storageKeyPrefix. This would delete all storage entries.');
    }
    const keys = await this.listPrefixedKeys(storage, this.storageKeyPrefix);
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
    const result = await this.getFromStorage(storage, null);
    const prefix = this.storageKeyPrefix;
    if (!prefix) return Object.keys(result);
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

  private toStorageKey(key: string): string {
    return this.storageKeyPrefix ? `${this.storageKeyPrefix}${key}` : key;
  }

  private async listPrefixedKeys(storage: chrome.storage.StorageArea, prefix: string): Promise<string[]> {
    const result = await this.getFromStorage(storage, null);
    return Object.keys(result).filter(key => key.startsWith(prefix));
  }

  private async getFromStorage(storage: chrome.storage.StorageArea, keys: string | string[] | null): Promise<Record<string, unknown>> {
    return this.invokeWithCallbackSupport<Record<string, unknown>>(callback => storage.get(keys, callback));
  }

  private async execute(storage: chrome.storage.StorageArea, operation: (done: () => void) => void | Promise<void>): Promise<void> {
    await this.invokeWithCallbackSupport<void>(operation);
  }

  private async invokeWithCallbackSupport<TResult>(
    operation: (callback: (result: TResult) => void) => void | Promise<TResult>
  ): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      let settled = false;

      const finish = (result: TResult): void => {
        if (settled) return;
        settled = true;
        const runtimeError = getRuntimeError();
        if (runtimeError) {
          reject(runtimeError);
          return;
        }
        resolve(result);
      };

      try {
        const maybePromise = operation(finish);
        if (isPromiseLike(maybePromise)) {
          maybePromise.then(finish).catch(reject);
        }
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
