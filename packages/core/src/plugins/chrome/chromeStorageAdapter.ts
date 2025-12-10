import { AsyncStorageInterface } from '../../types';
import { StorageValue } from '../../storage/storageTypes';
import { replacer, reviver } from '../../utils/serialization';

export const CHROME_STORAGE_NAMESPACE = 'stores/chrome-storage';

export type AreaName = keyof Pick<typeof chrome.storage, 'local' | 'managed' | 'session' | 'sync'>;
export type ChromeStorageAdapterOptions = { area?: AreaName; namespace?: string };
export type ChromeStorageValue<T = unknown> = StorageValue<T>;

export class ChromeStorageAdapter implements AsyncStorageInterface {
  readonly area: 'local' | 'session' | 'sync' | 'managed';
  readonly namespace: string;
  readonly async = true;
  readonly deserializer = deserializeChromeStorageValue;
  readonly serializer = serializeChromeStorageValue;

  private _usePromises: boolean | null = null;

  constructor(options?: ChromeStorageAdapterOptions) {
    this.area = options?.area ?? 'local';
    this.namespace = options?.namespace ?? CHROME_STORAGE_NAMESPACE;
  }

  async clearAll(): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;
    const prefix = this.prefix();
    if (!prefix)
      throw new Error('Cannot clear all storage with empty namespace. This would delete all storage entries. Please provide a namespace.');
    const all = await this.execute(storage, 'get', null);
    const keys = Object.keys(all).filter(k => k.startsWith(prefix));
    if (keys.length) await this.execute(storage, 'remove', keys);
  }

  async contains(key: string): Promise<boolean> {
    const storage = this.getStorage();
    if (!storage) return false;
    const k = this.key(key);
    const result = await this.execute(storage, 'get', k);
    return k in result && result[k] !== undefined;
  }

  async delete(key: string): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;
    await this.execute(storage, 'remove', this.key(key));
  }

  async getAllKeys(): Promise<string[]> {
    const storage = this.getStorage();
    if (!storage) return [];
    const prefix = this.prefix();
    if (!prefix)
      throw new Error('Cannot get all keys with empty namespace. This would return all storage entries. Please provide a namespace.');
    const all = await this.execute(storage, 'get', null);
    return Object.keys(all)
      .filter(k => k.startsWith(prefix))
      .map(k => k.slice(prefix.length));
  }

  async get(key: string): Promise<unknown> {
    const storage = this.getStorage();
    if (!storage) return undefined;
    const k = this.key(key);
    const result = await this.execute(storage, 'get', k);
    const value = result[k];
    return value && typeof value === 'object' && 'state' in value ? value : undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;
    await this.execute(storage, 'set', { [this.key(key)]: value });
  }

  private getStorage(): chrome.storage.StorageArea | null {
    if (typeof chrome === 'undefined' || !chrome.storage) return null;
    return chrome.storage[this.area] ?? null;
  }

  private prefix(): string {
    return this.namespace ? `${this.namespace}:` : '';
  }

  private key(k: string): string {
    return `${this.prefix()}${k}`;
  }

  // Unified execute: tries promise-based first, falls back to callback
  private execute(storage: chrome.storage.StorageArea, method: 'get', keys: string | string[] | null): Promise<Record<string, unknown>>;
  private execute(storage: chrome.storage.StorageArea, method: 'set', items: Record<string, unknown>): Promise<void>;
  private execute(storage: chrome.storage.StorageArea, method: 'remove', keys: string | string[]): Promise<void>;
  private async execute(storage: chrome.storage.StorageArea, method: 'get' | 'set' | 'remove', arg: unknown): Promise<unknown> {
    // Already know we need callbacks
    if (this._usePromises === false) {
      return this.executeCallback(storage, method, arg);
    }

    // Try promise-based
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
    const maybePromise = (storage[method] as (arg: any) => Promise<unknown> | undefined)(arg);

    if (maybePromise instanceof Promise) {
      this._usePromises = true;
      const result = await maybePromise;
      this.checkRuntimeError();
      return result;
    }

    // Callback-only mode
    this._usePromises = false;
    return this.executeCallback(storage, method, arg);
  }

  private executeCallback(storage: chrome.storage.StorageArea, method: 'get' | 'set' | 'remove', arg: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const callback = (result?: unknown) => {
        try {
          this.checkRuntimeError();
          resolve(result);
        } catch (e) {
          reject(e);
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-assertions
      (storage[method] as (arg: any, cb: (r?: unknown) => void) => void)(arg, callback);
    });
  }

  private checkRuntimeError(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.lastError?.message) {
      throw new Error(chrome.runtime.lastError.message);
    }
  }
}

// --- Serialization ---

export function serializeChromeStorageValue<T>(value: StorageValue<T>): unknown {
  return {
    state: transformState(value.state, replacer),
    syncMetadata: value.syncMetadata,
    version: value.version,
  };
}

export function deserializeChromeStorageValue<T>(raw: unknown): StorageValue<T> {
  if (!raw || typeof raw !== 'object' || !('state' in raw)) {
    throw new Error('[ChromeStorageAdapter] Invalid serialized state format');
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const v = raw as StorageValue<unknown>;
  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    state: transformState(v.state, reviver) as T,
    syncMetadata: v.syncMetadata,
    version: v.version,
  };
}

function transformState(value: unknown, fn: (key: string, val: unknown) => unknown): unknown {
  if (value instanceof Map || value instanceof Set) return fn('', value);
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = fn(k, v);
  }
  return result;
}
