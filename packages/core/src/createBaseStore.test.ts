import { createAsyncStorageMock } from './internal/storage/storageMocks.testUtils';
import { deferred, flushMacrotask } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { StoresError } from './internal/errors';
import { logger } from './internal/logger';
import { AsyncStorageInterface, OptionallyPersistedStore, PersistedStore } from './types';
import { isPlainObject } from './types/utils';

const storage: AsyncStorageInterface & { map: Map<string, string> } = {
  async: true,
  map: new Map<string, string>(),
  clearAll: vi.fn(() => Promise.resolve(storage.map.clear())),
  contains: vi.fn((key: string) => Promise.resolve(storage.map.has(key))),
  delete: vi.fn((key: string) => Promise.resolve(void storage.map.delete(key))),
  get: vi.fn((key: string) => Promise.resolve(storage.map.get(key))),
  getAllKeys: vi.fn(() => Promise.resolve(Array.from(storage.map.keys()))),
  set: vi.fn((key: string, value: string) => Promise.resolve(void storage.map.set(key, value))),
};

type CounterState = { count: number; nested: { value: string; items?: string[] } };
type PersistEnvelope<T> = Readonly<{ state: T; version: number }>;

describe('createBaseStore / persistence + hydration', () => {
  beforeEach(() => {
    storage.map.clear();
    vi.clearAllMocks();
  });

  test('hydrates with custom merge (called with persisted->current) and uses merge result', async () => {
    const storageKey = 'test-merge';
    seedPersisted<CounterState>(storageKey, { count: 5, nested: { value: 'persisted', items: ['a', 'b'] } }, 0);

    const initial: CounterState = { count: 10, nested: { value: 'current', items: [] } };

    function isCounterState(value: unknown): value is CounterState {
      return (
        isPlainObject(value) && 'count' in value && 'nested' in value && typeof value.count === 'number' && isPlainObject(value.nested)
      );
    }

    const merge = vi.fn((persisted: unknown, current: CounterState): CounterState => {
      if (!isCounterState(persisted)) throw new Error('Invalid persisted state');
      const p = persisted;
      return {
        count: current.count + p.count,
        nested: { value: `${current.nested.value}-${p.nested.value}`, items: p.nested.items },
      };
    });

    const store = createBaseStore<CounterState>(() => initial, {
      storage,
      storageKey,
      merge,
    });
    await store.persist.hydrationPromise();

    expect(merge).toHaveBeenCalledTimes(1);
    const [argPersisted, argCurrent] = merge.mock.calls[0];
    expect(argPersisted).toEqual({ count: 5, nested: { value: 'persisted', items: ['a', 'b'] } });
    expect(argCurrent).toEqual(initial);

    // Validate final state
    const after = store.getState();
    expect(after.count).toBe(15);
    expect(after.nested.value).toBe('current-persisted');
    expect(after.nested.items).toEqual(['a', 'b']);
  });

  test('hydrates without custom merge: persisted snapshot is the source of truth', async () => {
    const storageKey = 'test-default-merge';
    seedPersisted<CounterState>(storageKey, { count: 42, nested: { value: 'disk' } }, 0);

    const store = createBaseStore<CounterState>(() => ({ count: 0, nested: { value: 'init' } }), {
      storage,
      storageKey,
    });
    await store.persist.hydrationPromise();

    expect(store.getState()).toEqual({ count: 42, nested: { value: 'disk' } });
  });

  test('clearStorage does not expose the storage adapter return value', () => {
    const storageKey = 'test-clear-storage';
    const store = createBaseStore<CounterState>(() => ({ count: 0, nested: { value: 'init' } }), {
      storage,
      storageKey,
    });

    const result = store.persist.clearStorage();

    expect(result).toBeUndefined();
    expect(storage.delete).toHaveBeenCalledWith(storageKey);
  });

  test('migrate is invoked before merge; merge sees migrated snapshot; version recorded', async () => {
    type V1 = { count: number; version: number };
    type V2 = V1;

    const storageKey = 'test-migrate-then-merge';
    seedPersisted<V1>(storageKey, { count: 3, version: 1 }, 1);

    function isV1(value: unknown): value is V1 {
      return (
        isPlainObject(value) &&
        'count' in value &&
        'version' in value &&
        typeof value.count === 'number' &&
        typeof value.version === 'number'
      );
    }

    const migrate = vi.fn((persisted: unknown, targetVersion: number): V2 => {
      if (!isV1(persisted)) throw new Error('Invalid persisted state');
      const v1 = persisted;
      // Upgrade: bump version, keep count
      return { count: v1.count, version: targetVersion };
    });

    const merge = vi.fn((persisted: unknown, current: V2): V2 => {
      if (!isV1(persisted)) throw new Error('Invalid persisted state');
      const p = persisted;
      return { count: current.count + p.count, version: current.version };
    });

    const store = createBaseStore<V2>(() => ({ count: 10, version: 2 }), {
      storage,
      storageKey,
      version: 2,
      migrate,
      merge,
    });

    await store.persist.hydrationPromise();

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(migrate.mock.invocationCallOrder[0]).toBeLessThan(merge.mock.invocationCallOrder[0]);

    const final = store.getState();
    expect(final).toEqual({ count: 13, version: 2 }); // 10 + 3, version from current
  });

  test('partialize shapes the write-path only (persisted envelope minimal); hydration preserves non-persisted fields from initial', async () => {
    type S = { count: number; temp: string };
    const partialize = vi.fn((s: S) => ({ count: s.count }));

    const storageKey = 'test-partialize';
    const store = createBaseStore<S>(() => ({ count: 0, temp: 'init' }), {
      storage,
      storageKey,
      partialize,
    });

    // Change both fields; only count should be persisted
    await store.setState({ count: 7, temp: 'transient' });
    await flushMacrotask();

    const written = readPersisted<Partial<S>>(storageKey);
    expect(written).toBeDefined();
    expect(written?.state).toEqual({ count: 7 });
    expect(partialize).toHaveBeenCalled();

    // Now simulate a fresh process: reset store state, seed only the persisted part, then rehydrate
    const fresh = createBaseStore<S>(() => ({ count: 0, temp: 'init' }), {
      storage,
      storageKey,
    });
    await fresh.persist.hydrationPromise();

    const after = fresh.getState();
    expect(after.count).toBe(7); // from persisted
    expect(after.temp).toBe('init'); // not in persisted → from initial
  });

  test('invalid JSON throws error during hydration', async () => {
    type S = { value: string };

    const storageKey = 'test-invalid-json';
    storage.map.set(storageKey, '{ this is not json');

    const store = createBaseStore<S>(() => ({ value: 'initial' }), {
      storage,
      storageKey,
    });

    // Hydration should throw due to JSON parse error
    await expect(store.persist.hydrationPromise()).rejects.toThrow();
  });

  test('malformed envelope (missing state/version) falls back to initial and completes hydration', async () => {
    const storageKey = 'test-bad-envelope';
    // Swap out persisted state for an invalid StorageValue
    storage.map.set(storageKey, JSON.stringify({ foo: 'bar' }));

    const store = createBaseStore<{ n: number }>(() => ({ n: 1 }), { storage, storageKey });
    await store.persist.hydrationPromise();

    // Hydration should complete to initial state
    expect(store.getState()).toEqual({ n: 1 });
  });

  test('non-persisted store (no storageKey): no persist surface and no storage writes', async () => {
    type S = { a: number };

    const store = createBaseStore<S>(() => ({ a: 1 }));

    // Lie to the compiler
    assertIsPersisted(store);

    // No persist on the store:
    expect(store.persist).toBeUndefined();
    store.setState({ a: 2 });
    expect(storage.set).not.toHaveBeenCalled();
  });

  test('option invariants: sync=true without a key throws (must inherit storageKey or provide one)', () => {
    // The system enforces clear boundaries and invariants for sync configuration.
    // { sync: true } requires a key (storageKey or an explicit sync key).
    expect(
      () =>
        createBaseStore<{ x: number }>(() => ({ x: 0 }), {
          // @ts-expect-error intentionally invalid (missing key), will throw
          sync: true,
        })
      // Ensure a runtime error is thrown
    ).toThrow(StoresError);
  });
});

function assertIsPersisted<S, PersistedState extends Partial<S>, PersistReturn extends void | Promise<void>>(
  store: OptionallyPersistedStore<S, PersistedState, PersistReturn>
): asserts store is PersistedStore<S, PersistedState, PersistReturn> {
  return;
}

/**
 * Seeds persisted state into the mock storage map.
 */
function seedPersisted<T>(key: string, state: T, version = 0): void {
  const envelope: PersistEnvelope<T> = { state, version };
  storage.map.set(key, JSON.stringify(envelope));
}

/**
 * Reads persisted state from the mock storage map.
 */
function readPersisted<T>(key: string): PersistEnvelope<T> | undefined {
  const raw = storage.map.get(key);
  if (!raw) return undefined;
  return JSON.parse(raw);
}

describe('hydration error isolation', () => {
  it.each([false, true])('settles queued updates after their batched persistence attempt, fails=%s', async fails => {
    const read = deferred<string | undefined>();
    const write = deferred<void>();
    const storage = createAsyncStorageMock();
    storage.get.mockReturnValueOnce(read.promise);
    storage.set.mockReturnValueOnce(write.promise);
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const store = createBaseStore<{ value: number; change: (value: number) => void | Promise<void> }>(
      set => ({ value: 0, change: value => set({ value }) }),
      { storage, storageKey: 'queued-persistence' }
    );
    const settled = vi.fn();
    const completion = Promise.all([1, 2, 3].map(value => store.getState().change(value))).then(settled);

    try {
      read.resolve(undefined);
      await store.persist.hydrationPromise();
      await flushMacrotask();

      expect(store.getState().value).toBe(3);
      expect(store.persist.hasHydrated()).toBe(true);
      expect(storage.set.mock.calls).toEqual([['queued-persistence', JSON.stringify({ state: { value: 3 }, version: 0 })]]);
      expect(settled).not.toHaveBeenCalled();

      if (fails) write.reject(new Error('storage unavailable'));
      else write.resolve();

      await completion;
      expect(settled).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledTimes(fails ? 1 : 0);
    } finally {
      write.resolve();
      await completion;
      log.mockRestore();
    }
  });

  it.each([false, true])('keeps the initial hydration outcome after a later failed read, observedEarly=%s', async observedEarly => {
    const storage = createAsyncStorageMock();
    const error = new Error('later read failed');
    storage.get.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
    const store = createBaseStore<{ value: number }>(() => ({ value: 0 }), { storage, storageKey: 'rehydrate' });
    if (observedEarly) await store.persist.hydrationPromise();
    else await flushMacrotask();
    expect(store.persist.hasHydrated()).toBe(true);
    await store.persist.rehydrate();
    await expect(store.persist.hydrationPromise()).resolves.toBeUndefined();
  });

  it('rejects only the failing write and continues hydration and later writes', async () => {
    const read = deferred<string | undefined>();
    const storage = createAsyncStorageMock();
    storage.get.mockReturnValueOnce(read.promise);
    const error = new Error('updater failed');
    const updater = vi.fn(() => {
      throw error;
    });
    const store = createBaseStore<{ total: number; fail: () => void | Promise<void>; increment: () => void | Promise<void> }>(
      set => ({
        total: 0,
        fail: () => set(updater),
        increment: () => set(state => ({ total: state.total + 1 })),
      }),
      { storage, storageKey: 'application-errors' }
    );
    const onFinish = vi.fn();
    store.persist.onFinishHydration(onFinish);
    const writes = Promise.allSettled([store.getState().fail(), store.getState().increment()]);
    read.resolve(JSON.stringify({ version: 0, state: { total: 10 } }));
    await store.persist.hydrationPromise();
    expect(await writes).toEqual([
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: undefined },
    ]);
    expect(updater).toHaveBeenCalledOnce();
    expect(store.getState().total).toBe(11);
    expect(store.persist.hasHydrated()).toBe(true);
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('keeps storage-read failure separate from successful deferred application', async () => {
    const read = deferred<string | undefined>();
    const storage = createAsyncStorageMock();
    storage.get.mockReturnValueOnce(read.promise);
    const error = new Error('storage failed');
    const store = createBaseStore<{ value: number; change: () => void | Promise<void> }>(
      set => ({ value: 0, change: () => set({ value: 1 }) }),
      { storage, storageKey: 'read-error' }
    );
    const change = store.getState().change();
    read.reject(error);
    await change;
    await flushMacrotask();
    expect(store.getState().value).toBe(1);
    await expect(store.persist.hydrationPromise()).rejects.toBe(error);
  });
});
