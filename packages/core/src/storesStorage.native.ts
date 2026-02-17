import { SyncStorageInterface } from './types';
import { FunctionKeys } from './types/functions';

type MMKVInterface = Omit<FunctionKeys<SyncStorageInterface<string>>, 'get'> & { getString: SyncStorageInterface<string>['get'] };

/** react-native-mmkv v4+ — exports a createMMKV factory function */
interface MMKVFactory {
  createMMKV(opts: { id: string }): MMKVInterface & { remove(key: string): boolean };
  MMKV?: undefined;
}

/** react-native-mmkv v2/v3 — exports an MMKV class constructor */
interface MMKVClass {
  MMKV: new (opts: { id: string }) => MMKVInterface & { delete(key: string): void };
  createMMKV?: undefined;
}

declare function require(id: 'react-native-mmkv'): MMKVFactory | MMKVClass;

export function createStoresStorage(storageKeyPrefix: string): SyncStorageInterface<string> {
  let mmkvStorage: SyncStorageInterface<string>;

  try {
    const mmkvModule = require('react-native-mmkv');

    if (typeof mmkvModule.createMMKV === 'function') {
      // v4: factory function, .remove() instead of .delete()
      const mmkv = mmkvModule.createMMKV({ id: storageKeyPrefix });
      const { getString, remove, ...rest } = mmkv;
      mmkvStorage = Object.assign(Object.create(null), rest, { get: getString, delete: (key: string) => remove(key) });
    } else {
      // v2/v3: class constructor, .delete()
      const mmkv = new mmkvModule.MMKV({ id: storageKeyPrefix });
      const { getString, ...rest } = mmkv;
      mmkvStorage = Object.assign(Object.create(null), rest, { get: getString });
    }
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

  return {
    clearAll: () => mmkvStorage.clearAll(),
    contains: key => mmkvStorage.contains(key),
    delete: key => mmkvStorage.delete(key),
    get: key => mmkvStorage.get(key),
    getAllKeys: () => mmkvStorage.getAllKeys(),
    set: (key, value) => mmkvStorage.set(key, value),
  };
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
