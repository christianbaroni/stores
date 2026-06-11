import { createBaseStore } from '../../createBaseStore';
import { StorageValue } from '../../storage/storageTypes';
import { flushMicrotasks } from '../../tests/async';
import { AsyncStorageInterface } from '../../types';

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
});
