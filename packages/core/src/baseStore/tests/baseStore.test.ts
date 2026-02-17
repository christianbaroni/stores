/**
 * @jest-environment node
 */

import { createBaseStore } from '../../createBaseStore';
import { StoresError } from '../../logger';
import { flushMacrotask } from '../../sync/tests/testUtils';
import { AsyncStorageInterface, OptionallyPersistedStore, PersistedStore } from '../../types';
import { isPlainObject } from '../../types/utils';

const storage: AsyncStorageInterface & { map: Map<string, string> } = {
  async: true,
  map: new Map<string, string>(),
  clearAll: jest.fn(() => Promise.resolve(storage.map.clear())),
  contains: jest.fn((key: string) => Promise.resolve(storage.map.has(key))),
  delete: jest.fn((key: string) => Promise.resolve(void storage.map.delete(key))),
  get: jest.fn((key: string) => Promise.resolve(storage.map.get(key))),
  getAllKeys: jest.fn(() => Promise.resolve(Array.from(storage.map.keys()))),
  set: jest.fn((key: string, value: string) => Promise.resolve(void storage.map.set(key, value))),
};

type CounterState = { count: number; nested: { value: string; items?: string[] } };
type PersistEnvelope<T> = Readonly<{ state: T; version: number }>;

describe('createBaseStore / persistence + hydration', () => {
  beforeEach(() => {
    storage.map.clear();
    jest.clearAllMocks();
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

    const merge = jest.fn((persisted: unknown, current: CounterState): CounterState => {
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
    const [argPersisted, argCurrent] = merge.mock.calls[0]!;
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

    const migrate = jest.fn((persisted: unknown, targetVersion: number): V2 => {
      if (!isV1(persisted)) throw new Error('Invalid persisted state');
      const v1 = persisted;
      // Upgrade: bump version, keep count
      return { count: v1.count, version: targetVersion };
    });

    const merge = jest.fn((persisted: unknown, current: V2): V2 => {
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

    // Call order: migrate then merge
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(migrate.mock.invocationCallOrder[0]).toBeLessThan(merge.mock.invocationCallOrder[0]);

    const final = store.getState();
    expect(final).toEqual({ count: 13, version: 2 }); // 10 + 3, version from current
  });

  test('partialize shapes the write-path only (persisted envelope minimal); hydration preserves non-persisted fields from initial', async () => {
    type S = { count: number; temp: string };
    const partialize = jest.fn((s: S) => ({ count: s.count })); // only persist count

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
    expect(written!.state).toEqual({ count: 7 });
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

function assertIsPersisted<S, PersistedState, PersistReturn>(
  store: OptionallyPersistedStore<S, PersistedState, PersistReturn>
): asserts store is PersistedStore<S, PersistedState, PersistReturn, false> {
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
