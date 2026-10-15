import { SyncStorageInterface } from './types';

/**
 * Creates a `localStorage` adapter scoped to a key prefix.
 */
export function createStoresStorage(storageKeyPrefix: string): SyncStorageInterface {
  return {
    clearAll(): void {
      try {
        const localStorage = getLocalStorage();
        if (!localStorage) return;
        for (const key of getPrefixedKeys(localStorage, storageKeyPrefix)) localStorage.removeItem(key);
      } catch (error) {
        console.error('Error clearing localStorage:', error);
      }
    },

    contains(key: string): boolean {
      const localStorage = getLocalStorage();
      return localStorage?.getItem(`${storageKeyPrefix}${key}`) != null;
    },

    delete(key: string): void {
      try {
        const localStorage = getLocalStorage();
        localStorage?.removeItem(`${storageKeyPrefix}${key}`);
      } catch (error) {
        console.error('Error deleting from localStorage:', error);
      }
    },

    getAllKeys(): string[] {
      try {
        const localStorage = getLocalStorage();
        if (!localStorage) return [];
        const keys = getPrefixedKeys(localStorage, storageKeyPrefix);
        for (let i = 0; i < keys.length; i++) keys[i] = keys[i].slice(storageKeyPrefix.length);
        return keys;
      } catch (error) {
        console.error('Error getting keys from localStorage:', error);
        return [];
      }
    },

    get(key: string): string | undefined {
      try {
        const localStorage = getLocalStorage();
        return localStorage ? (localStorage.getItem(`${storageKeyPrefix}${key}`) ?? undefined) : undefined;
      } catch (error) {
        console.error('Error reading from localStorage:', error);
        return undefined;
      }
    },

    set(key: string, value: string): void {
      try {
        const localStorage = getLocalStorage();
        localStorage?.setItem(`${storageKeyPrefix}${key}`, value);
      } catch (error) {
        console.error('Error writing to localStorage:', error);
      }
    },
  };
}

function getLocalStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function getPrefixedKeys(localStorage: Storage, storageKeyPrefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(storageKeyPrefix)) keys.push(key);
  }
  return keys;
}
