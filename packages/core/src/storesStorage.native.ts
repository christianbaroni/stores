import type { SyncStorageInterface } from './types';

declare var require: (id: string) => { MMKV: new (options: { id: string }) => SyncStorageInterface };

let storageInstance: SyncStorageInterface;

try {
  const { MMKV } = require('react-native-mmkv');
  storageInstance = new MMKV({ id: 'stores-storage' });
} catch (e) {
  throw new Error(
    `[@stores]: You must install react-native-mmkv for persistence to work in React Native.\n
    See: https://github.com/mrousavy/react-native-mmkv
    ${e instanceof Error ? `\n\nError: ${e.message}` : ''}`
  );
}

function assertMMKV(instance: SyncStorageInterface): asserts instance is SyncStorageInterface {
  if (
    !instance ||
    typeof instance.getString !== 'function' ||
    typeof instance.set !== 'function' ||
    typeof instance.delete !== 'function' ||
    typeof instance.clearAll !== 'function'
  ) {
    throw new Error('[@stores]: Storage instance does not conform to expected interface');
  }
}

assertMMKV(storageInstance);

export const storesStorage: SyncStorageInterface = {
  clearAll(): void {
    storageInstance.clearAll();
  },
  contains(key: string): boolean {
    return storageInstance.contains(key);
  },
  delete(key: string): void {
    storageInstance.delete(key);
  },
  getAllKeys(): string[] {
    return storageInstance.getAllKeys();
  },
  getString(key: string): string | undefined {
    return storageInstance.getString(key);
  },
  set(key: string, value: string): void {
    storageInstance.set(key, value);
  },
};
