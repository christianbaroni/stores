import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STORAGE_KEY_PREFIX } from '../../../config';
import { ChromeStorageAdapter, deserializeChromeStorageValue, serializeChromeStorageValue } from '../chromeStorageAdapter';
import { MockChromeStorage, cleanupMockChrome, setupMockChrome } from './mockChromeStorage';

describe('ChromeStorageAdapter', () => {
  let mockStorage: MockChromeStorage;

  beforeEach(() => {
    mockStorage = new MockChromeStorage();
    setupMockChrome(mockStorage);
  });

  afterEach(() => {
    mockStorage.cleanup();
    cleanupMockChrome();
  });

  describe('storageKeyPrefix', () => {
    it('stores keys with prefix', async () => {
      const prefix = '@app:';
      const key = 'myKey';
      const adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: prefix });
      await adapter.set(key, { state: { value: 1 }, version: 1 });

      const rawData = await mockStorage.local.get(null);
      expect(Object.keys(rawData)).toEqual([`${prefix}${key}`]);
    });

    it('uses default prefix when not specified', async () => {
      const key = 'key';
      const adapter = new ChromeStorageAdapter({ area: 'local' });
      await adapter.set(key, { state: {}, version: 1 });

      const rawData = await mockStorage.local.get(null);
      expect(Object.keys(rawData)).toEqual([`${DEFAULT_STORAGE_KEY_PREFIX}${key}`]);
    });

    it('supports custom prefix formats', async () => {
      const adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: 'rainbow.zustand.' });
      await adapter.set('contacts', { state: { list: [] }, version: 1 });

      const rawData = await mockStorage.local.get(null);
      expect(Object.keys(rawData)).toEqual(['rainbow.zustand.contacts']);
      expect(await adapter.get('contacts')).toEqual({ state: { list: [] }, version: 1 });
    });

    it('isolates keys between prefixes', async () => {
      const adapter1 = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@ns1:' });
      const adapter2 = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@ns2:' });

      await adapter1.set('key', { state: { source: 'ns1' }, version: 1 });
      await adapter2.set('key', { state: { source: 'ns2' }, version: 1 });

      expect(await adapter1.get('key')).toEqual({ state: { source: 'ns1' }, version: 1 });
      expect(await adapter2.get('key')).toEqual({ state: { source: 'ns2' }, version: 1 });
    });

    it('getAllKeys returns unprefixed keys', async () => {
      const adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@app:' });
      await adapter.set('first', { state: {}, version: 1 });
      await adapter.set('second', { state: {}, version: 1 });

      const keys = await adapter.getAllKeys();
      expect(keys.sort()).toEqual(['first', 'second']);
    });

    it('getAllKeys excludes keys from other prefixes', async () => {
      const adapter1 = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@ns1:' });
      const adapter2 = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@ns2:' });

      await adapter1.set('a', { state: {}, version: 1 });
      await adapter2.set('b', { state: {}, version: 1 });

      expect(await adapter1.getAllKeys()).toEqual(['a']);
      expect(await adapter2.getAllKeys()).toEqual(['b']);
    });

    it('throws on clearAll with empty storageKeyPrefix to prevent accidental data wipe', async () => {
      const adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '' });

      await expect(adapter.clearAll()).rejects.toThrow('Cannot clear all storage with empty storageKeyPrefix');
    });

    it('allows get/set with empty storageKeyPrefix', async () => {
      const adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '' });

      await adapter.set('directKey', { state: { x: 1 }, version: 1 });
      expect(await adapter.get('directKey')).toEqual({ state: { x: 1 }, version: 1 });

      const rawData = await mockStorage.local.get(null);
      expect(Object.keys(rawData)).toEqual(['directKey']);
    });
  });

  describe('CRUD operations', () => {
    let adapter: ChromeStorageAdapter;

    beforeEach(() => {
      adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@test:' });
    });

    it('set and get round-trip', async () => {
      const value = { state: { name: 'test', count: 42 }, version: 1 };
      await adapter.set('key', value);
      expect(await adapter.get('key')).toEqual(value);
    });

    it('get returns undefined for non-existent key', async () => {
      expect(await adapter.get('nonexistent')).toBeUndefined();
    });

    it('contains returns true for existing key', async () => {
      await adapter.set('exists', { state: {}, version: 1 });
      expect(await adapter.contains('exists')).toBe(true);
    });

    it('contains returns false for non-existent key', async () => {
      expect(await adapter.contains('nonexistent')).toBe(false);
    });

    it('delete removes key', async () => {
      await adapter.set('toDelete', { state: {}, version: 1 });
      expect(await adapter.contains('toDelete')).toBe(true);

      await adapter.delete('toDelete');

      expect(await adapter.contains('toDelete')).toBe(false);
      expect(await adapter.get('toDelete')).toBeUndefined();
    });

    it('clearAll removes only keys with matching prefix', async () => {
      const adapter1 = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@ns1:' });
      const adapter2 = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@ns2:' });

      await adapter1.set('a', { state: {}, version: 1 });
      await adapter1.set('b', { state: {}, version: 1 });
      await adapter2.set('c', { state: {}, version: 1 });

      await adapter1.clearAll();

      expect(await adapter1.getAllKeys()).toEqual([]);
      expect(await adapter2.getAllKeys()).toEqual(['c']);
    });

    it('clearAll is safe when no keys exist', async () => {
      await adapter.clearAll();
      expect(await adapter.getAllKeys()).toEqual([]);
    });
  });

  describe('serialization', () => {
    it('serializes Map to storable format', () => {
      const map = new Map([
        ['a', 1],
        ['b', 2],
      ]);
      const serialized = serializeChromeStorageValue({ state: map, version: 1 });

      expect(serialized).toEqual({
        state: {
          __type: 'Map',
          entries: [
            ['a', 1],
            ['b', 2],
          ],
        },
        version: 1,
        syncMetadata: undefined,
      });
    });

    it('serializes Set to storable format', () => {
      const set = new Set([1, 2, 3]);
      const serialized = serializeChromeStorageValue({ state: set, version: 1 });

      expect(serialized).toEqual({
        state: { __type: 'Set', values: [1, 2, 3] },
        version: 1,
        syncMetadata: undefined,
      });
    });

    it('serializes nested Maps in object state', () => {
      const state = {
        users: new Map([['user1', { name: 'Alice' }]]),
        count: 5,
      };
      const serialized = serializeChromeStorageValue({ state, version: 1 });

      expect(serialized).toEqual({
        state: {
          users: { __type: 'Map', entries: [['user1', { name: 'Alice' }]] },
          count: 5,
        },
        version: 1,
        syncMetadata: undefined,
      });
    });

    it('deserializes Map from stored format', () => {
      const stored = {
        state: {
          __type: 'Map',
          entries: [
            ['a', 1],
            ['b', 2],
          ],
        },
        version: 1,
      };
      const result = deserializeChromeStorageValue<Map<string, number>>(stored);

      expect(result.state).toBeInstanceOf(Map);
      expect(result.state.get('a')).toBe(1);
      expect(result.state.get('b')).toBe(2);
    });

    it('deserializes Set from stored format', () => {
      const stored = {
        state: { __type: 'Set', values: [1, 2, 3] },
        version: 1,
      };
      const result = deserializeChromeStorageValue<Set<number>>(stored);

      expect(result.state).toBeInstanceOf(Set);
      expect(result.state.has(1)).toBe(true);
      expect(result.state.has(2)).toBe(true);
      expect(result.state.has(3)).toBe(true);
    });

    it('deserializes nested Maps in object state', () => {
      const stored = {
        state: {
          users: { __type: 'Map', entries: [['user1', { name: 'Alice' }]] },
          count: 5,
        },
        version: 1,
      };
      const result = deserializeChromeStorageValue<{ users: Map<string, { name: string }>; count: number }>(stored);

      expect(result.state.users).toBeInstanceOf(Map);
      expect(result.state.users.get('user1')).toEqual({ name: 'Alice' });
      expect(result.state.count).toBe(5);
    });

    it('preserves syncMetadata through serialization', () => {
      const value = {
        state: { data: 'test' },
        version: 2,
        syncMetadata: { origin: 'client-1', timestamp: 12345 },
      };
      const serialized = serializeChromeStorageValue(value);
      const deserialized = deserializeChromeStorageValue(serialized);

      expect(deserialized.syncMetadata).toEqual({ origin: 'client-1', timestamp: 12345 });
    });

    it('preserves version through serialization', () => {
      const value = { state: {}, version: 42 };
      const serialized = serializeChromeStorageValue(value);
      const deserialized = deserializeChromeStorageValue(serialized);

      expect(deserialized.version).toBe(42);
    });

    it('throws on deserializing invalid format', () => {
      expect(() => deserializeChromeStorageValue(null)).toThrow('Invalid serialized state format');
      expect(() => deserializeChromeStorageValue('string')).toThrow('Invalid serialized state format');
      expect(() => deserializeChromeStorageValue({ noState: true })).toThrow('Invalid serialized state format');
    });
  });

  describe('validation', () => {
    let adapter: ChromeStorageAdapter;

    beforeEach(() => {
      adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@test:' });
    });

    it('returns undefined for value without state property', async () => {
      await mockStorage.local.set({ '@test:invalid': { notState: 'value' } });
      expect(await adapter.get('invalid')).toBeUndefined();
    });

    it('returns undefined for null value', async () => {
      await mockStorage.local.set({ '@test:null': null });
      expect(await adapter.get('null')).toBeUndefined();
    });

    it('returns undefined for primitive value', async () => {
      await mockStorage.local.set({ '@test:primitive': 'just a string' });
      expect(await adapter.get('primitive')).toBeUndefined();
    });

    it('returns value that has state property', async () => {
      const valid = { state: { data: 'valid' }, version: 1 };
      await mockStorage.local.set({ '@test:valid': valid });
      expect(await adapter.get('valid')).toEqual(valid);
    });
  });

  describe('error handling', () => {
    it('rejects when chrome.runtime.lastError is set', async () => {
      const adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@test:' });

      Object.defineProperty(chrome.runtime, 'lastError', {
        value: { message: 'Storage quota exceeded' },
        configurable: true,
      });

      try {
        await expect(adapter.set('key', { state: {}, version: 1 })).rejects.toThrow('Storage quota exceeded');
      } finally {
        Object.defineProperty(chrome.runtime, 'lastError', {
          value: undefined,
          configurable: true,
        });
      }
    });

    it('returns graceful defaults when chrome global is undefined', async () => {
      const originalChrome = globalThis.chrome;
      Reflect.deleteProperty(globalThis, 'chrome');

      try {
        const adapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@test:' });

        expect(await adapter.get('key')).toBeUndefined();
        expect(await adapter.contains('key')).toBe(false);
        expect(await adapter.getAllKeys()).toEqual([]);

        // These should complete without throwing
        await adapter.set('key', { state: {}, version: 1 });
        await adapter.delete('key');
        await adapter.clearAll();
      } finally {
        Object.assign(globalThis, { chrome: originalChrome });
      }
    });
  });

  describe('storage areas', () => {
    it('uses specified storage area', async () => {
      const localAdapter = new ChromeStorageAdapter({ area: 'local', storageKeyPrefix: '@test:' });
      const sessionAdapter = new ChromeStorageAdapter({ area: 'session', storageKeyPrefix: '@test:' });

      await localAdapter.set('key', { state: { area: 'local' }, version: 1 });
      await sessionAdapter.set('key', { state: { area: 'session' }, version: 1 });

      // Verify data is stored in correct underlying areas
      const localData = await mockStorage.local.get(null);
      const sessionData = await mockStorage.session.get(null);

      expect(localData['@test:key']).toEqual({ state: { area: 'local' }, version: 1 });
      expect(sessionData['@test:key']).toEqual({ state: { area: 'session' }, version: 1 });

      // Verify adapters read from correct areas
      expect(await localAdapter.get('key')).toEqual({ state: { area: 'local' }, version: 1 });
      expect(await sessionAdapter.get('key')).toEqual({ state: { area: 'session' }, version: 1 });
    });

    it('defaults to local area', async () => {
      const adapter = new ChromeStorageAdapter({ storageKeyPrefix: '@test:' });
      expect(adapter.area).toBe('local');

      await adapter.set('key', { state: {}, version: 1 });

      const localData = await mockStorage.local.get(null);
      expect('@test:key' in localData).toBe(true);
    });
  });
});
