import { SyncStorageInterface } from './types';

export function createStoresStorage(storageKeyPrefix: string): SyncStorageInterface {
  return {
    clearAll(): void {
      try {
        const localStorage = getLocalStorage();
        if (!localStorage) return;
        const keysToRemove: string[] = [];

        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(storageKeyPrefix)) {
            keysToRemove.push(key);
          }
        }

        for (const key of keysToRemove) localStorage.removeItem(key);
      } catch (error) {
        console.error('Error clearing localStorage:', error);
      }
    },

    contains(key: string): boolean {
      const localStorage = getLocalStorage();
      return localStorage?.getItem(`${storageKeyPrefix}${key}`) !== null;
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
        return localStorage ? Array.from(localStorage.keys()) : [];
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
