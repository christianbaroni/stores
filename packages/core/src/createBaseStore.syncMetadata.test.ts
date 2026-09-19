import type { Mock } from 'vitest';
import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createQueryStore } from './createQueryStore';
import { createAsyncStorageMock, createSyncStorageMock } from './internal/storage/storageMocks.testUtils';
import * as syncEnhancer from './internal/sync/syncEnhancer';
import { StorageValue } from './storage/storageTypes';
import type { SyncEngine, SyncHandle, SyncUpdate } from './sync/types';
import { AsyncStorageInterface } from './types';

type TestState = {
  a: number;
  b: number;
};

// ============ Tests ========================================================= //

describe('createBaseStore sync and persistence', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])('syncs without a persistence context (engine hydration: %s)', async waitForEngine => {
    const createContext = vi.spyOn(syncEnhancer, 'createSyncContext');
    let completeHydration: (() => void) | undefined;
    const { engine, publish, register } = createSyncEngine(waitForEngine ? callback => (completeHydration = callback) : undefined);
    const store = createBaseStore(() => ({ a: 0, b: 1 }), { sync: { key: 'memory-only', engine } });

    store.setState({ a: 1 });
    if (waitForEngine) {
      expect(publish).not.toHaveBeenCalled();
      expect(completeHydration).toBeDefined();
      completeHydration?.();
    }
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].values).toEqual({ a: 1 });

    const timestamp = publish.mock.calls[0][0].timestamp;
    const apply = register.mock.calls[0][0].apply;
    apply({ replace: false, sessionId: 'remote', timestamp: timestamp + 1, values: { a: 2 } });
    await flushMicrotasks();
    expect(store.getState()).toEqual({ a: 2, b: 1 });

    apply({ replace: true, sessionId: 'remote', timestamp: timestamp + 2, values: { a: 3 } });
    await flushMicrotasks();
    expect(store.getState()).toEqual({ a: 3 });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(createContext).not.toHaveBeenCalled();
  });

  it.each([false, true])('suppresses remote persistence writes with sync storage (metadata: %s)', async injectStorageMetadata => {
    const createContext = vi.spyOn(syncEnhancer, 'createSyncContext');
    const storage = { ...createSyncStorageMock(), async: undefined };
    const { engine, publish, register } = createSyncEngine();
    const store = createBaseStore(() => ({ a: 0, b: 0 }), {
      storage,
      storageKey: 'sync-storage',
      sync: { engine, injectStorageMetadata },
    });

    store.setState({ a: 1 });
    expect(storage.set).toHaveBeenCalledTimes(1);
    const serialized: StorageValue<TestState> = JSON.parse(storage.set.mock.calls[0][1]);
    const timestamp = publish.mock.calls[0][0].timestamp;
    expect(serialized.state).toEqual({ a: 1, b: 0 });
    expect(serialized.syncMetadata).toEqual(injectStorageMetadata ? { origin: 'local', timestamp, fields: { a: timestamp } } : undefined);

    register.mock.calls[0][0].apply({ replace: false, sessionId: 'remote', timestamp: timestamp + 1, values: { a: 2 } });
    await flushMicrotasks();
    expect(store.getState()).toEqual({ a: 2, b: 0 });
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(createContext).toHaveBeenCalledWith(false);
  });

  it.each([false, true])('publishes a queued update once after async hydration (replace: %s)', async replace => {
    const storage = createAsyncStorageMock();
    let resolveStorageRead: ((value: string) => void) | undefined;
    storage.get.mockReturnValueOnce(new Promise(resolve => (resolveStorageRead = resolve)));
    const { engine, publish, register } = createSyncEngine();
    const store = createBaseStore<TestState, Partial<TestState>, Promise<void>>(() => ({ a: 0, b: 0 }), {
      storage,
      storageKey: 'async-storage',
      sync: { engine },
    });
    const states: TestState[] = [];
    const unsubscribe = store.subscribe(state => states.push(state));
    const update = vi.fn((state: TestState) => ({ a: state.a + 1, b: state.b }));
    const localUpdate = replace ? store.setState(update, true) : store.setState(update);
    const timestamp = Date.now() + 10_000;
    const apply = register.mock.calls[0][0].apply;
    apply({ replace: false, sessionId: 'remote', timestamp, values: { b: 6 } });
    apply({ replace: true, sessionId: 'remote', timestamp: timestamp + 1, values: { a: 8 } });

    expect(store.getState()).toEqual({ a: 0, b: 0 });
    expect(storage.set).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();

    if (!resolveStorageRead) throw new Error('Expected storage read to start synchronously.');
    resolveStorageRead(JSON.stringify({ state: { a: 5, b: 5 }, version: 0 }));
    await localUpdate;
    await flushMicrotasks(5);

    expect(states).toEqual([{ a: 5, b: 5 }, { a: 6, b: 5 }, { a: 6, b: 6 }, { a: 8 }]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].values).toEqual({ a: 6 });
    expect(publish.mock.calls[0][0].replace).toBe(replace);
    expect(storage.set).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('accumulates field timestamps across deferred hydration updates', async () => {
    const storageWrites: Array<{ key: string; value: string }> = [];
    const { engine, publish } = createSyncEngine();

    const mockStorage: AsyncStorageInterface = {
      async: true,
      clearAll: async () => {},
      contains: async () => false,
      delete: async () => {},
      getAllKeys: async () => [],
      get: async () => JSON.stringify({ state: { a: 0, b: 0 }, version: 0 }),
      set: async (key: string, value: string) => {
        storageWrites.push({ key, value });
      },
    };

    const store = createBaseStore<TestState, Partial<TestState>, Promise<void>>(() => ({ a: 0, b: 0 }), {
      storage: mockStorage,
      storageKey: 'test-sync-store',
      sync: { engine, injectStorageMetadata: true, key: 'test-sync-store' },
    });

    const hydrationComplete = new Promise<void>(resolve => {
      store.persist?.onFinishHydration(() => resolve());
    });

    const incrementA = store.setState(state => ({ a: state.a + 1 }));
    const incrementB = store.setState(state => ({ b: state.b + 2 }));

    await hydrationComplete;
    await incrementA;
    await incrementB;

    await flushMicrotasks(3);

    expect(storageWrites).not.toHaveLength(0);
    const latestWrite = storageWrites[storageWrites.length - 1];
    const serialized: StorageValue<TestState> = JSON.parse(latestWrite.value);

    expect(serialized.syncMetadata).toBeDefined();
    expect(serialized.syncMetadata?.fields).toEqual(
      expect.objectContaining({
        a: expect.any(Number),
        b: expect.any(Number),
      })
    );
    expect(publish.mock.calls.map(call => call[0].values)).toEqual([{ a: 1 }, { b: 2 }]);

    store.persist?.clearStorage();
  });

  it('waits for async persistence before publishing an update after hydration', async () => {
    const storage = createAsyncStorageMock();
    const { engine, publish } = createSyncEngine();
    const store = createBaseStore<TestState, Partial<TestState>, Promise<void>>(() => ({ a: 0, b: 0 }), {
      storage,
      storageKey: 'hydrated-update',
      sync: { engine },
    });
    await store.persist.hydrationPromise();

    let completeWrite: (() => void) | undefined;
    storage.set.mockReturnValueOnce(new Promise(resolve => (completeWrite = resolve)));
    const update = store.setState({ a: 1 });
    await flushMicrotasks();
    expect(store.getState()).toEqual({ a: 1, b: 0 });
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();

    if (!completeWrite) throw new Error('Expected storage write to start.');
    completeWrite();
    await update;
    await store.setState(state => state);

    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].values).toEqual({ a: 1 });
  });

  it('fetches when an active query is enabled before async hydration completes', async () => {
    const storage = createAsyncStorageMock();
    let resolveStorageRead: ((value: undefined) => void) | undefined;
    storage.get.mockReturnValueOnce(new Promise(resolve => (resolveStorageRead = resolve)));
    const fetcher = vi.fn(async () => 42);
    const { engine } = createSyncEngine();
    const store = createQueryStore(
      { enabled: false, fetcher, staleTime: Infinity },
      { storage, storageKey: 'enabled-before-hydration', sync: { engine } }
    );
    const unsubscribe = store.subscribe(() => {});
    const enabled = store.setState({ enabled: true });
    expect(fetcher).not.toHaveBeenCalled();

    if (!resolveStorageRead) throw new Error('Expected storage read to start.');
    resolveStorageRead(undefined);
    await enabled;
    await flushMicrotasks(5);

    expect(store.getState().enabled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.getState().reset();
  });

  it('skips persistence and publication when a pre-hydration update preserves hydrated state', async () => {
    let resolveStorageRead: ((value: string | undefined) => void) | undefined;
    const storageRead = new Promise<string | undefined>(resolve => {
      resolveStorageRead = resolve;
    });
    const storage = createAsyncStorageMock();
    storage.get.mockReturnValueOnce(storageRead);
    const publish = vi.fn();
    const engine: SyncEngine = {
      sessionId: 'test-session',
      register<T extends Record<string, unknown>>(): SyncHandle<T> {
        return { destroy: () => {}, publish: () => publish() };
      },
    };
    let updaterState: TestState | undefined;
    const store = createBaseStore<TestState, Partial<TestState>, Promise<void>>(() => ({ a: 0, b: 0 }), {
      storage,
      storageKey: 'test-no-op-store',
      sync: { engine, key: 'test-no-op-store' },
    });

    const result = store.setState(state => {
      updaterState = state;
      return state;
    });

    expect(updaterState).toBeUndefined();
    expect(storage.set).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();

    if (!resolveStorageRead) throw new Error('Expected storage read to start synchronously.');
    resolveStorageRead(JSON.stringify({ state: { a: 2, b: 3 }, version: 0 }));
    await result;

    expect(updaterState).toEqual({ a: 2, b: 3 });
    expect(updaterState).toBe(store.getState());
    expect(storage.set).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

function createSyncEngine(onHydrated?: SyncHandle<Record<string, unknown>>['onHydrated']): {
  engine: SyncEngine;
  publish: Mock<(update: SyncUpdate<Record<string, unknown>>) => void>;
  register: Mock<SyncEngine['register']>;
} {
  const publish = vi.fn<(update: SyncUpdate<Record<string, unknown>>) => void>();
  const register = vi.fn<SyncEngine['register']>(() => ({ destroy: () => {}, onHydrated, publish }));
  return { engine: { sessionId: 'local', register }, publish, register };
}
