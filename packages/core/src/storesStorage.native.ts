import { SyncStorageInterface } from './types';
import { FunctionKeys } from './types/functions';

type MMKVInterface = Omit<FunctionKeys<SyncStorageInterface<string>>, 'get'> & { getString: SyncStorageInterface<string>['get'] };

declare const require: (id: string) => { MMKV: new (options: { id: string }) => MMKVInterface };

let storageInstance: SyncStorageInterface<string> | undefined;

function getStorageInstance(): SyncStorageInterface<string> {
  if (storageInstance) return storageInstance;
  try {
    const { MMKV } = require('react-native-mmkv');
    const mmkv = new MMKV({ id: 'stores-storage' });
    const { getString, ...rest } = mmkv;
    storageInstance = Object.assign(Object.create(null), rest, { get: getString });
  } catch (e) {
    throw new Error(
      '[stores] react-native-mmkv could not be loaded.\n\n' +
        'Persisted stores require a storage backend. Either:\n' +
        '  - Install MMKV (the default): yarn add react-native-mmkv\n' +
        '  - Or provide a custom adapter via configureStores()\n' +
        (e instanceof Error ? `\n${e.message}` : '')
    );
  }
  assertMMKV(storageInstance);
  return storageInstance;
}

export const storesStorage: SyncStorageInterface<string> = {
  clearAll: () => getStorageInstance().clearAll(),
  contains: key => getStorageInstance().contains(key),
  delete: key => getStorageInstance().delete(key),
  getAllKeys: () => getStorageInstance().getAllKeys(),
  get: key => getStorageInstance().get(key),
  set: (key, value) => getStorageInstance().set(key, value),
};

function assertMMKV(
  instance: SyncStorageInterface<unknown> | SyncStorageInterface<string> | undefined
): asserts instance is SyncStorageInterface<unknown> | SyncStorageInterface<string> {
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
