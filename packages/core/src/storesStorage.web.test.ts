import { createStoresStorage } from './storesStorage.web';

function createWebStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('web storage', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  it('enumerates logical keys with the Storage length/key API and only clears its own prefix', () => {
    const localStorage = createWebStorage();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage } });
    const storage = createStoresStorage('test:');
    localStorage.setItem('other:value', 'kept');
    storage.set('first', '1');
    storage.set('second', '2');
    storage.set('', 'empty key');

    expect(storage.getAllKeys()).toEqual(['first', 'second', '']);
    expect(storage.contains('first')).toBe(true);
    storage.clearAll();
    expect(storage.getAllKeys()).toEqual([]);
    expect(localStorage.getItem('other:value')).toBe('kept');
    expect(localStorage.length).toBe(1);
  });

  it('does not claim that a key exists without a storage provider', () => {
    Reflect.deleteProperty(globalThis, 'window');
    expect(createStoresStorage('test:').contains('absent')).toBe(false);
  });
});
