import type { SyncStorageInterface } from './types';

// Hoisted mock prevents the real ESM module from loading.
// We mutate mockModule between tests to swap the version-specific API.
const mockModule: Record<string, unknown> = {};
jest.mock('react-native-mmkv', () => mockModule);

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-assertions
const { createStoresStorage } = require('./storesStorage.native') as {
  createStoresStorage: (prefix: string) => SyncStorageInterface<string>;
};

function createBackingStore() {
  return new Map<string, string>();
}

function clearMock() {
  for (const key of Object.keys(mockModule)) delete mockModule[key];
}

// Uses a plain object (not a class) because real MMKV exposes JSI methods as own properties.
function v2() {
  clearMock();
  mockModule.MMKV = function (_opts: { id: string }) {
    const store = createBackingStore();
    return {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      contains: (key: string) => store.has(key),
      delete: (key: string) => store.delete(key),
      getAllKeys: () => Array.from(store.keys()),
      clearAll: () => store.clear(),
    };
  };
}

function v4() {
  clearMock();
  mockModule.createMMKV = (_opts: { id: string }) => {
    const store = createBackingStore();
    return {
      getString: (key: string) => store.get(key),
      set: (key: string, value: string) => store.set(key, value),
      contains: (key: string) => store.has(key),
      remove: (key: string) => store.delete(key),
      getAllKeys: () => Array.from(store.keys()),
      clearAll: () => store.clear(),
    };
  };
}

// Runs the same assertions for each version to verify a consistent SyncStorageInterface.
function runCompatibilitySuite(setup: () => void) {
  let storage: SyncStorageInterface<string>;

  beforeEach(() => {
    setup();
    storage = createStoresStorage('test');
  });

  it('stores and retrieves a value', () => {
    storage.set('k', 'v');
    expect(storage.get('k')).toBe('v');
  });

  it('returns undefined for missing keys', () => {
    expect(storage.get('missing')).toBeUndefined();
  });

  it('contains returns true for existing keys', () => {
    storage.set('k', 'v');
    expect(storage.contains('k')).toBe(true);
    expect(storage.contains('nope')).toBe(false);
  });

  it('delete removes a key', () => {
    storage.set('k', 'v');
    storage.delete('k');
    expect(storage.get('k')).toBeUndefined();
    expect(storage.contains('k')).toBe(false);
  });

  it('getAllKeys returns stored keys', () => {
    storage.set('a', '1');
    storage.set('b', '2');
    expect(storage.getAllKeys().sort()).toEqual(['a', 'b']);
  });

  it('clearAll removes all keys', () => {
    storage.set('a', '1');
    storage.set('b', '2');
    storage.clearAll();
    expect(storage.getAllKeys()).toEqual([]);
  });
}

describe('storesStorage.native', () => {
  describe('v2/v3 (class constructor + .delete)', () => {
    runCompatibilitySuite(v2);
  });

  describe('v4 (createMMKV factory + .remove)', () => {
    runCompatibilitySuite(v4);
  });

  it('throws when react-native-mmkv exports neither API', () => {
    clearMock();
    expect(() => createStoresStorage('test')).toThrow('[stores]');
  });
});
