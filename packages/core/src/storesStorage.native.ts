import { SyncStorageInterface } from './types';
import { FunctionKeys } from './types/functions';

type MMKVInterface = Omit<FunctionKeys<SyncStorageInterface<string>>, 'get'> & { getString: SyncStorageInterface<string>['get'] };

declare const require: (id: string) => { MMKV: new (options: { id: string }) => MMKVInterface };

let storageInstance: SyncStorageInterface<string>;

try {
  const { MMKV } = require('react-native-mmkv');
  const mmkv = new MMKV({ id: 'stores-storage' });
  const { getString, ...rest } = mmkv;
  storageInstance = Object.assign(Object.create(null), rest, { get: getString });
} catch (e) {
  throw new Error(
    `[stores]: You must install react-native-mmkv for persistence to work in React Native.\n
    See: https://github.com/mrousavy/react-native-mmkv
    ${e instanceof Error ? `\n\nError: ${e.message}` : ''}`
  );
}

function assertMMKV(instance: SyncStorageInterface<unknown> | SyncStorageInterface<string>): asserts instance is SyncStorageInterface {
  if (
    !instance ||
    typeof instance.get !== 'function' ||
    typeof instance.set !== 'function' ||
    typeof instance.delete !== 'function' ||
    typeof instance.clearAll !== 'function'
  ) {
    throw new Error('[stores]: Storage instance does not conform to expected interface');
  }
}

assertMMKV(storageInstance);

export const storesStorage: SyncStorageInterface<string> = {
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
  get(key: string): string | undefined {
    return storageInstance.get(key);
  },
  set(key: string, value: string): void {
    storageInstance.set(key, value);
  },
};
