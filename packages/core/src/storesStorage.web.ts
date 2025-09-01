import type { StorageInterface } from './types';

const STORAGE_ID = 'stores-storage';

function getLocalStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

export const storesStorage: StorageInterface = {
  clearAll(): void {
    try {
      const localStorage = getLocalStorage();
      if (!localStorage) return;
      const keysToRemove: string[] = [];
      const prefix = `${STORAGE_ID}:`;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
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
    return localStorage?.getItem(`${STORAGE_ID}:${key}`) !== null;
  },

  delete(key: string): void {
    try {
      const localStorage = getLocalStorage();
      localStorage?.removeItem(`${STORAGE_ID}:${key}`);
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

  getString(key: string): string | undefined {
    try {
      const localStorage = getLocalStorage();
      return localStorage ? (localStorage.getItem(`${STORAGE_ID}:${key}`) ?? undefined) : undefined;
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return undefined;
    }
  },

  set(key: string, value: string): void {
    try {
      const localStorage = getLocalStorage();
      localStorage?.setItem(`${STORAGE_ID}:${key}`, value);
    } catch (error) {
      console.error('Error writing to localStorage:', error);
    }
  },
};
