import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createAsyncStorageMock } from './internal/storage/storageMocks.testUtils';
import { StorageValue } from './storage/storageTypes';
import type { SyncEngine, SyncHandle } from './sync/types';
import { AsyncStorageInterface } from './types';

type TestState = {
  a: number;
  b: number;
};

// ============ Tests ========================================================= //

describe('createBaseStore sync metadata', () => {
  it('accumulates field timestamps across deferred hydration updates', async () => {
    const storageWrites: Array<{ key: string; value: string }> = [];

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
      sync: { injectStorageMetadata: true, key: 'test-sync-store' },
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

    store.persist?.clearStorage();
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
