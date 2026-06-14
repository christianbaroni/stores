import { flushMicrotasks } from '../async.testUtils';
import type { StorageValue } from '../storage/storageTypes';
import { createStore } from './createStore';
import { persist } from './persist';
import type { AsyncPersistStorage, SyncPersistStorage } from './types';

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value | PromiseLike<Value>) => void;
};

describe('persist', () => {
  it('hydrates synchronously with merged state while preserving the initial state snapshot', () => {
    type State = { count: number; increment: () => void; label: string };
    type PersistedState = { count: number };

    const storage = createSyncStorage<State, PersistedState>({ state: { count: 5 }, version: 0 });
    const postRehydrate = vi.fn();
    const onRehydrateStorage = vi.fn(() => postRehydrate);

    const store = createStore(
      persist<State, PersistedState>(
        set => ({
          count: 0,
          increment: () => set(state => ({ count: state.count + 1 })),
          label: 'initial',
        }),
        {
          name: 'counter',
          onRehydrateStorage,
          storage: storage.storage,
          version: 0,
        }
      )
    );

    const initialState = store.getInitialState();

    expect(store.getState()).toEqual({ count: 5, increment: initialState.increment, label: 'initial' });
    expect(initialState.count).toBe(0);
    expect(onRehydrateStorage).toHaveBeenCalledWith(initialState);
    expect(postRehydrate).toHaveBeenCalledWith(store.getState(), undefined);
    expect(store.persist.hasHydrated()).toBe(true);
  });

  it('persists updates from the api and creator set function', () => {
    type State = { count: number; increment: () => void };

    const storage = createSyncStorage<State, State>();
    const store = createStore(
      persist<State, State>(
        set => ({
          count: 0,
          increment: () => set(state => ({ count: state.count + 1 })),
        }),
        {
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 0,
        }
      )
    );

    store.setState({ count: 1 });
    store.getState().increment();

    const firstWrite = storage.storage.setItem.mock.calls[0];
    const secondWrite = storage.storage.setItem.mock.calls[1];
    if (!firstWrite || !secondWrite) throw new Error('Expected two persisted writes.');

    expect(firstWrite[0]).toBe('counter');
    expect(firstWrite[1].count).toBe(1);
    expect(firstWrite[2]).toBe(0);
    expect(secondWrite[0]).toBe('counter');
    expect(secondWrite[1].count).toBe(2);
    expect(secondWrite[2]).toBe(0);

    store.persist.setOptions({ name: 'renamed' });
    store.persist.clearStorage();

    expect(storage.storage.removeItem).toHaveBeenCalledWith('renamed');
  });

  it('manually rehydrates and honors hydration listener unsubscriptions', () => {
    type State = { count: number };

    const storage = createSyncStorage<State, State>();
    const store = createStore(
      persist<State, State>(() => ({ count: 0 }), {
        name: 'counter',
        skipHydration: true,
        storage: storage.storage,
        version: 0,
      })
    );

    const hydrateOnce = vi.fn();
    const hydrateAlways = vi.fn();
    const finishOnce = vi.fn();
    const finishAlways = vi.fn();

    const unsubscribeHydrate = store.persist.onHydrate(hydrateOnce);
    store.persist.onHydrate(hydrateAlways);
    const unsubscribeFinish = store.persist.onFinishHydration(finishOnce);
    store.persist.onFinishHydration(finishAlways);

    expect(store.persist.hasHydrated()).toBe(false);

    storage.setStoredValue({ state: { count: 1 }, version: 0 });
    store.persist.rehydrate();

    expect(hydrateOnce).toHaveBeenCalledWith({ count: 0 });
    expect(hydrateAlways).toHaveBeenCalledWith({ count: 0 });
    expect(finishOnce).toHaveBeenCalledWith({ count: 1 });
    expect(finishAlways).toHaveBeenCalledWith({ count: 1 });
    expect(store.persist.hasHydrated()).toBe(true);

    unsubscribeHydrate();
    unsubscribeFinish();

    storage.setStoredValue({ state: { count: 2 }, version: 0 });
    store.persist.rehydrate();

    expect(hydrateOnce).toHaveBeenCalledTimes(1);
    expect(hydrateAlways).toHaveBeenCalledWith({ count: 1 });
    expect(finishOnce).toHaveBeenCalledTimes(1);
    expect(finishAlways).toHaveBeenCalledWith({ count: 2 });
  });

  it('migrates versioned state before merging and persists the migrated result', () => {
    type State = { count: number; label: string };
    type PersistedState = { count: number };

    const storage = createSyncStorage<State, PersistedState>({ state: { count: 2 }, version: 1 });
    const migrate = vi.fn((state: PersistedState, version: number): PersistedState => ({ count: state.count + version }));
    const merge = vi.fn(
      (persistedState: PersistedState | undefined, currentState: State): State => ({
        ...currentState,
        count: persistedState?.count ?? currentState.count,
      })
    );

    const store = createStore(
      persist<State, PersistedState>(() => ({ count: 0, label: 'initial' }), {
        merge,
        migrate,
        name: 'counter',
        storage: storage.storage,
        version: 2,
      })
    );

    expect(store.getState()).toEqual({ count: 3, label: 'initial' });
    expect(migrate).toHaveBeenCalledWith({ count: 2 }, 1);
    expect(merge).toHaveBeenCalledWith({ count: 3 }, { count: 0, label: 'initial' });
    expect(storage.storage.setItem).toHaveBeenCalledWith('counter', { count: 3, label: 'initial' }, 2);
  });

  it('reports synchronous hydration errors to the post-rehydration callback', () => {
    type State = { count: number };

    const storage = createSyncStorage<State, State>();
    const error = new Error('getItem failed');
    storage.storage.getItem.mockImplementation(() => {
      throw error;
    });

    const postRehydrate = vi.fn();
    const store = createStore(
      persist<State, State>(() => ({ count: 0 }), {
        name: 'counter',
        onRehydrateStorage: () => postRehydrate,
        storage: storage.storage,
        version: 0,
      })
    );

    expect(store.getState()).toEqual({ count: 0 });
    expect(postRehydrate).toHaveBeenCalledWith(undefined, error);
    expect(store.persist.hasHydrated()).toBe(false);
  });

  it('applies only the latest async rehydrate result', async () => {
    type State = { count: number };

    const storage = createAsyncStorage<State, State>();
    const store = createStore(
      persist<State, State, Promise<void>>(() => ({ count: 0 }), {
        name: 'counter',
        skipHydration: true,
        storage: storage.storage,
        version: 0,
      })
    );
    const finishHydration = vi.fn();
    store.persist.onFinishHydration(finishHydration);

    const firstHydration = store.persist.rehydrate();
    const secondHydration = store.persist.rehydrate();

    storage.resolveRead(0, { state: { count: 1 }, version: 0 });
    await firstHydration;

    expect(store.getState()).toEqual({ count: 0 });
    expect(finishHydration).not.toHaveBeenCalled();

    storage.resolveRead(1, { state: { count: 2 }, version: 0 });
    await secondHydration;

    expect(store.getState()).toEqual({ count: 2 });
    expect(finishHydration).toHaveBeenCalledTimes(1);
    expect(finishHydration).toHaveBeenCalledWith({ count: 2 });
  });

  it('ignores stale async migrations after a newer hydration starts', async () => {
    type State = { count: number };

    const storage = createAsyncStorage<State, State>();
    const migrations: Array<Deferred<State>> = [];
    const migrate = vi.fn((): Promise<State> => {
      const migration = createDeferred<State>();
      migrations.push(migration);
      return migration.promise;
    });

    const store = createStore(
      persist<State, State, Promise<void>>(() => ({ count: 0 }), {
        migrate,
        name: 'counter',
        skipHydration: true,
        storage: storage.storage,
        version: 1,
      })
    );

    const firstHydration = store.persist.rehydrate();
    storage.resolveRead(0, { state: { count: 1 }, version: 0 });
    await flushMicrotasks(2);

    const secondHydration = store.persist.rehydrate();
    storage.resolveRead(1, { state: { count: 2 }, version: 0 });
    await flushMicrotasks(2);

    const firstMigration = migrations[0];
    const secondMigration = migrations[1];
    if (!firstMigration || !secondMigration) throw new Error('Expected both hydrations to reach migration.');

    firstMigration.resolve({ count: 10 });
    await firstHydration;
    expect(store.getState()).toEqual({ count: 0 });

    secondMigration.resolve({ count: 20 });
    await secondHydration;
    expect(store.getState()).toEqual({ count: 20 });
    expect(storage.storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.storage.setItem).toHaveBeenCalledWith('counter', { count: 20 }, 1);
  });
});

function createSyncStorage<State, PersistedState extends Partial<State>>(initialValue: StorageValue<PersistedState> | null = null) {
  let storedValue = initialValue;

  const storage = {
    getItem: vi.fn((_name: string) => storedValue),
    removeItem: vi.fn((_name: string) => {
      storedValue = null;
    }),
    setItem: vi.fn((_name: string, _state: State, _version: number | undefined) => {}),
  } satisfies SyncPersistStorage<State, PersistedState>;

  return {
    setStoredValue: (value: StorageValue<PersistedState> | null) => {
      storedValue = value;
    },
    storage,
  };
}

function createAsyncStorage<State, PersistedState extends Partial<State>>() {
  const reads: Array<Deferred<StorageValue<PersistedState> | null>> = [];

  const storage = {
    getItem: vi.fn((_name: string) => {
      const read = createDeferred<StorageValue<PersistedState> | null>();
      reads.push(read);
      return read.promise;
    }),
    removeItem: vi.fn(async (_name: string) => {}),
    setItem: vi.fn(async (_name: string, _state: State, _version: number | undefined) => {}),
  } satisfies AsyncPersistStorage<State, PersistedState>;

  return {
    resolveRead: (index: number, value: StorageValue<PersistedState> | null) => {
      const read = reads[index];
      if (!read) throw new Error(`Expected async storage read ${index}.`);
      read.resolve(value);
    },
    storage,
  };
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve: ((value: Value | PromiseLike<Value>) => void) | undefined;

  const promise = new Promise<Value>(resolvePromise => {
    resolve = resolvePromise;
  });

  if (!resolve) throw new Error('Expected Promise executor to run synchronously.');
  return { promise, resolve };
}
