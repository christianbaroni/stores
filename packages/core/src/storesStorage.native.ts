import { createMMKV, MMKV } from 'react-native-mmkv';
import { SyncStorageInterface } from './types';
import { FunctionKeys } from './types/functions';

type MMKVInterface = Omit<Pick<SyncStorageInterface<string>, FunctionKeys<SyncStorageInterface<string>>>, 'get' | 'delete'> & {
  getString: SyncStorageInterface<string>['get'];
  delete?: SyncStorageInterface<string>['delete'];
  remove?: SyncStorageInterface<string>['delete'];
};

export function createStoresStorage(storageKeyPrefix: string): SyncStorageInterface<string> {
  let mmkvStorage: SyncStorageInterface<string> | undefined;

  function getMMKVStorage(): SyncStorageInterface<string> {
    if (mmkvStorage) return mmkvStorage;

    try {
      const mmkv = createMMKVInstance(storageKeyPrefix);
      let deleteKey: SyncStorageInterface<string>['delete'] | undefined;

      if (typeof mmkv.delete === 'function') {
        const mmkvDelete = mmkv.delete;
        deleteKey = key => mmkvDelete.call(mmkv, key);
      } else if (typeof mmkv.remove === 'function') {
        const mmkvRemove = mmkv.remove;
        deleteKey = key => mmkvRemove.call(mmkv, key);
      }

      if (typeof deleteKey !== 'function') {
        throw new Error('[stores]: Storage instance does not conform to expected interface');
      }

      const adapter: SyncStorageInterface<string> = {
        clearAll: () => mmkv.clearAll(),
        contains: key => mmkv.contains(key),
        delete: key => deleteKey(key),
        get: key => mmkv.getString(key),
        getAllKeys: () => mmkv.getAllKeys(),
        set: (key, value) => mmkv.set(key, value),
      };
      mmkvStorage = adapter;
    } catch (e) {
      throw new Error(
        '[stores] react-native-mmkv could not be loaded.\n\n' +
          'Persisted stores require a storage backend. Either:\n' +
          '  - Install MMKV (the default): yarn add react-native-mmkv\n' +
          '  - Or provide a custom adapter via configureStores()\n' +
          (e instanceof Error ? `\n${e.message}` : '')
      );
    }

    assertMMKV(mmkvStorage);
    return mmkvStorage;
  }

  return {
    clearAll: () => getMMKVStorage().clearAll(),
    contains: key => getMMKVStorage().contains(key),
    delete: key => getMMKVStorage().delete(key),
    get: key => getMMKVStorage().get(key),
    getAllKeys: () => getMMKVStorage().getAllKeys(),
    set: (key, value) => getMMKVStorage().set(key, value),
  };
}

function createMMKVInstance(storageKeyPrefix: string): MMKVInterface {
  if (typeof createMMKV === 'function') return createMMKV({ id: storageKeyPrefix });
  if (typeof MMKV === 'function') return new MMKV({ id: storageKeyPrefix });
  throw new Error('[stores]: react-native-mmkv module does not export MMKV/createMMKV.');
}

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
