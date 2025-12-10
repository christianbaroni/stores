import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChromeStorageAdapter } from '../chromeStorageAdapter';
import { MockChromeStorage, setupMockChrome, cleanupMockChrome } from './mockChromeStorage';

describe('ChromeStorageAdapter', () => {
  let mockStorage: MockChromeStorage;
  let adapter: ChromeStorageAdapter;

  beforeEach(() => {
    mockStorage = new MockChromeStorage();
    setupMockChrome(mockStorage);
    adapter = new ChromeStorageAdapter({ namespace: '@test', area: 'local' });
  });

  afterEach(async () => {
    await mockStorage.local.clear();
    mockStorage.cleanup();
    cleanupMockChrome();
  });

  describe('Promise-based API (default mock)', () => {
    it('should set and get values', async () => {
      const testValue = { state: { name: 'test' }, version: 1 };
      await adapter.set('myKey', testValue);
      const result = await adapter.get('myKey');
      expect(result).toEqual(testValue);
    });

    it('should check if key exists', async () => {
      expect(await adapter.contains('nonexistent')).toBe(false);
      await adapter.set('exists', { state: { foo: 'bar' }, version: 1 });
      expect(await adapter.contains('exists')).toBe(true);
    });

    it('should delete keys', async () => {
      await adapter.set('toDelete', { state: { foo: 'bar' }, version: 1 });
      expect(await adapter.contains('toDelete')).toBe(true);
      await adapter.delete('toDelete');
      expect(await adapter.contains('toDelete')).toBe(false);
    });

    it('should get all keys', async () => {
      await adapter.set('key1', { state: { a: 1 }, version: 1 });
      await adapter.set('key2', { state: { b: 2 }, version: 1 });
      const keys = await adapter.getAllKeys();
      expect(keys.sort()).toEqual(['key1', 'key2'].sort());
    });

    it('should clear all namespaced keys', async () => {
      await adapter.set('key1', { state: { a: 1 }, version: 1 });
      await adapter.set('key2', { state: { b: 2 }, version: 1 });
      await adapter.clearAll();
      expect(await adapter.getAllKeys()).toEqual([]);
    });
  });

  describe('Callback-based API fallback', () => {
    // Create a callback-only mock storage that doesn't return promises
    function createCallbackOnlyStorage() {
      const data: Record<string, unknown> = {};

      const callbackOnlyStorage = {
        // Returns undefined (not a Promise) - callback-only API
        // When called without callback (for detection), returns undefined synchronously
        get(keys: string | string[] | Record<string, unknown> | null, callback?: (items: Record<string, unknown>) => void): undefined {
          // If no callback, this is the detection call - just return undefined
          if (!callback) return undefined;

          queueMicrotask(() => {
            let result: Record<string, unknown> = {};
            if (keys === null || keys === undefined) {
              result = { ...data };
            } else if (typeof keys === 'string') {
              if (keys in data) result[keys] = data[keys];
            } else if (Array.isArray(keys)) {
              for (const key of keys) {
                if (key in data) result[key] = data[key];
              }
            }
            callback(result);
          });
          return undefined;
        },

        set(items: Record<string, unknown>, callback?: () => void): undefined {
          if (!callback) return undefined;
          queueMicrotask(() => {
            Object.assign(data, items);
            callback();
          });
          return undefined;
        },

        remove(keys: string | string[], callback?: () => void): undefined {
          if (!callback) return undefined;
          queueMicrotask(() => {
            const keysArray = Array.isArray(keys) ? keys : [keys];
            for (const key of keysArray) {
              delete data[key];
            }
            callback();
          });
          return undefined;
        },

        QUOTA_BYTES: 5242880,
      };

      return callbackOnlyStorage;
    }

    it('should work with callback-only storage API', async () => {
      // Override chrome.storage.local with callback-only implementation
      const callbackOnlyLocal = createCallbackOnlyStorage();
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      (globalThis as { chrome: unknown }).chrome = {
        storage: {
          local: callbackOnlyLocal,
          session: callbackOnlyLocal,
          sync: callbackOnlyLocal,
          managed: callbackOnlyLocal,
          onChanged: mockStorage.onChanged,
        },
        runtime: { lastError: undefined },
      };

      // Create a fresh adapter (so it rechecks promise support)
      const callbackAdapter = new ChromeStorageAdapter({ namespace: '@callback-test', area: 'local' });

      const testValue = { state: { name: 'callback-test' }, version: 1 };
      await callbackAdapter.set('callbackKey', testValue);
      const result = await callbackAdapter.get('callbackKey');
      expect(result).toEqual(testValue);
    });

    it('should fallback gracefully when get returns undefined', async () => {
      const callbackOnlyLocal = createCallbackOnlyStorage();
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      (globalThis as { chrome: unknown }).chrome = {
        storage: {
          local: callbackOnlyLocal,
          session: callbackOnlyLocal,
          sync: callbackOnlyLocal,
          managed: callbackOnlyLocal,
          onChanged: mockStorage.onChanged,
        },
        runtime: { lastError: undefined },
      };

      const callbackAdapter = new ChromeStorageAdapter({ namespace: '@fallback-test', area: 'local' });

      // Test contains
      expect(await callbackAdapter.contains('nonexistent')).toBe(false);

      // Test set and contains
      await callbackAdapter.set('exists', { state: { foo: 'bar' }, version: 1 });
      expect(await callbackAdapter.contains('exists')).toBe(true);

      // Test delete
      await callbackAdapter.delete('exists');
      expect(await callbackAdapter.contains('exists')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should return undefined for non-existent keys', async () => {
      const result = await adapter.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return undefined for values without state property', async () => {
      // Directly write an invalid value to storage
      await mockStorage.local.set({ '@test:invalid': { notState: 'value' } });
      const result = await adapter.get('invalid');
      expect(result).toBeUndefined();
    });

    it('should allow get/set with empty namespace but prevent dangerous operations', async () => {
      const noNamespaceAdapter = new ChromeStorageAdapter({ namespace: '', area: 'local' });

      // get/set should still work with empty namespace
      await noNamespaceAdapter.set('directKey', { state: { x: 1 }, version: 1 });
      const result = await noNamespaceAdapter.get('directKey');
      expect(result).toEqual({ state: { x: 1 }, version: 1 });

      // But clearAll should throw to prevent accidental data wipe
      await expect(noNamespaceAdapter.clearAll()).rejects.toThrow(
        'Cannot clear all storage with empty namespace. This would delete all storage entries. Please provide a namespace.'
      );

      // And getAllKeys should throw to prevent namespace isolation violation
      await expect(noNamespaceAdapter.getAllKeys()).rejects.toThrow(
        'Cannot get all keys with empty namespace. This would return all storage entries. Please provide a namespace.'
      );
    });

    it('should isolate keys between different namespaces', async () => {
      const adapter1 = new ChromeStorageAdapter({ namespace: '@ns1', area: 'local' });
      const adapter2 = new ChromeStorageAdapter({ namespace: '@ns2', area: 'local' });

      await adapter1.set('sharedKey', { state: { source: 'ns1' }, version: 1 });
      await adapter2.set('sharedKey', { state: { source: 'ns2' }, version: 1 });

      const result1 = await adapter1.get('sharedKey');
      const result2 = await adapter2.get('sharedKey');

      expect(result1).toEqual({ state: { source: 'ns1' }, version: 1 });
      expect(result2).toEqual({ state: { source: 'ns2' }, version: 1 });
    });
  });
});
