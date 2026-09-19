import { flushMicrotasks } from '../async.testUtils';
import type { StorageValue } from '../storage/storageTypes';
import { createStore } from '../internal/createStore';
import type { SetFull, SetPartial, SetStateArgs } from '../types';
import { persist } from './persist';
import { applySetState } from './stateUpdate';
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
        },
        false
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
    type State = { count: number; increment: () => void; label?: string };

    const storage = createSyncStorage<State, State>();
    const store = createStore(
      persist<State, State>(
        set => ({
          count: 0,
          increment: () => set(state => ({ count: state.count + 1 })),
          label: 'initial',
        }),
        {
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 0,
        },
        false
      )
    );

    store.setState({ count: 1, increment: store.getState().increment }, true);
    store.getState().increment();

    expect(store.getState().label).toBeUndefined();

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

  it('skips persistence when api and creator updates preserve the state reference', () => {
    type State = { count: number; noOp: () => void };

    const storage = createSyncStorage<State, State>();
    const store = createStore(
      persist<State, State>(
        set => ({
          count: 0,
          noOp: () => set(state => state),
        }),
        {
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 0,
        },
        false
      )
    );

    expect(store.setState(state => state)).toBeUndefined();
    expect(store.getState().noOp()).toBeUndefined();
    expect(storage.storage.setItem).not.toHaveBeenCalled();
  });

  it('persists conservatively when the setter does not report state changes', () => {
    type State = { count: number };

    const storage = createSyncStorage<State, State>();
    const store = createStore(() => ({ count: 0 }));
    const rawSet = store.setState;
    const persistedStateCreator = persist<State, State>(
      () => ({ count: 0 }),
      {
        name: 'counter',
        skipHydration: true,
        storage: storage.storage,
        version: 0,
      },
      false
    );

    function ordinarySet(update: SetPartial<State>, replace?: false): void;
    function ordinarySet(update: SetFull<State>, replace: true): void;
    function ordinarySet(...args: SetStateArgs<State>): void {
      applySetState(rawSet, args);
    }

    persistedStateCreator(ordinarySet, store.getState, store);
    store.setState(state => state);

    expect(storage.storage.setItem).toHaveBeenCalledOnce();
    expect(storage.storage.setItem).toHaveBeenCalledWith('counter', store.getState(), 0);
  });

  it('persists when an update creates an equal state with a new reference', () => {
    type State = { count: number };

    const storage = createSyncStorage<State, State>();
    const store = createStore(
      persist<State, State>(
        () => ({ count: 0 }),
        {
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 0,
        },
        false
      )
    );
    const previousState = store.getState();

    store.setState(state => ({ ...state }));

    expect(store.getState()).not.toBe(previousState);
    expect(storage.storage.setItem).toHaveBeenCalledOnce();
    expect(storage.storage.setItem).toHaveBeenCalledWith('counter', store.getState(), 0);
  });

  it('persists the final state after synchronous subscriber updates', () => {
    type State = { count: number };

    const storage = createSyncStorage<State, State>();
    const store = createStore(
      persist<State, State>(
        () => ({ count: 0 }),
        {
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 0,
        },
        false
      )
    );
    store.subscribe(state => {
      if (state.count === 1) store.setState({ count: 2 });
    });

    store.setState({ count: 1 });

    expect(storage.storage.setItem).toHaveBeenCalledTimes(2);
    expect(storage.storage.setItem).toHaveBeenLastCalledWith('counter', store.getState(), 0);
    expect(store.getState()).toEqual({ count: 2 });
  });

  it('returns a stable resolved promise without writing for async no-ops', async () => {
    type State = { count: number };

    const storage = createAsyncStorage<State, State>();
    const write = createDeferred<void>();
    const store = createStore(
      persist<State, State, Promise<void>>(
        () => ({ count: 0 }),
        {
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 0,
        },
        true
      )
    );

    const firstNoOp = store.setState(state => state);
    const secondNoOp = store.setState(state => state);

    expect(firstNoOp).toBeInstanceOf(Promise);
    expect(secondNoOp).toBe(firstNoOp);
    expect(storage.storage.setItem).not.toHaveBeenCalled();

    storage.storage.setItem.mockReturnValueOnce(write.promise);
    const writeResult = store.setState({ count: 1 });
    const noOpAfterWrite = store.setState(state => state);

    expect(writeResult).toBe(write.promise);
    expect(noOpAfterWrite).toBe(firstNoOp);
    expect(storage.storage.setItem).toHaveBeenCalledOnce();

    await noOpAfterWrite;
    write.resolve();
    await writeResult;
  });

  it('manually rehydrates and honors hydration listener unsubscriptions', () => {
    type State = { count: number };

    const storage = createSyncStorage<State, State>();
    const store = createStore(
      persist<State, State>(
        () => ({ count: 0 }),
        {
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 0,
        },
        false
      )
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
      persist<State, PersistedState>(
        () => ({ count: 0, label: 'initial' }),
        {
          merge,
          migrate,
          name: 'counter',
          storage: storage.storage,
          version: 2,
        },
        false
      )
    );

    expect(store.getState()).toEqual({ count: 3, label: 'initial' });
    expect(migrate).toHaveBeenCalledWith({ count: 2 }, 1);
    expect(merge).toHaveBeenCalledWith({ count: 3 }, { count: 0, label: 'initial' });
    expect(storage.storage.setItem).toHaveBeenCalledWith('counter', { count: 3, label: 'initial' }, 2);
  });

  it('persists after migration even when hydration preserves the current reference', () => {
    type State = { count: number };

    const storage = createSyncStorage<State, State>({ state: { count: 1 }, version: 0 });
    const store = createStore(
      persist<State, State>(
        () => ({ count: 0 }),
        {
          merge: (_persistedState, currentState) => currentState,
          migrate: state => state,
          name: 'counter',
          storage: storage.storage,
          version: 1,
        },
        false
      )
    );

    expect(store.getState()).toEqual({ count: 0 });
    expect(storage.storage.setItem).toHaveBeenCalledOnce();
    expect(storage.storage.setItem).toHaveBeenCalledWith('counter', store.getState(), 1);
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
      persist<State, State>(
        () => ({ count: 0 }),
        {
          name: 'counter',
          onRehydrateStorage: () => postRehydrate,
          storage: storage.storage,
          version: 0,
        },
        false
      )
    );

    expect(store.getState()).toEqual({ count: 0 });
    expect(postRehydrate).toHaveBeenCalledWith(undefined, error);
    expect(store.persist.hasHydrated()).toBe(false);
  });

  it('applies only the latest async rehydrate result', async () => {
    type State = { count: number };

    const storage = createAsyncStorage<State, State>();
    const store = createStore(
      persist<State, State, Promise<void>>(
        () => ({ count: 0 }),
        {
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 0,
        },
        true
      )
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
      persist<State, State, Promise<void>>(
        () => ({ count: 0 }),
        {
          migrate,
          name: 'counter',
          skipHydration: true,
          storage: storage.storage,
          version: 1,
        },
        true
      )
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
