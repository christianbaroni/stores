import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createAsyncStorageMock } from './internal/storage/storageMocks.testUtils';
import type { SyncEngine, SyncUpdate } from './sync/types';
import * as core from './utils/core';

type Counter = { count: number };

afterEach(() => vi.restoreAllMocks());

function createEngine() {
  const publish = vi.fn<(update: SyncUpdate<Record<string, unknown>>) => void>();
  const engine: SyncEngine = { sessionId: 'local', register: () => ({ destroy: () => {}, publish }) };
  return { engine, publish };
}

it('does not allocate sync values for unchanged or unsynced-only updates', () => {
  const { engine, publish } = createEngine();
  const store = createBaseStore(() => ({ count: 0, note: '' }), {
    sync: { key: 'allocation-check', engine, fields: ['count'] },
  });
  const allocate = vi.spyOn(core, 'nullObject');
  expect(store.setState(state => state)).toBeUndefined();
  expect(store.setState({ note: 'local' })).toBeUndefined();
  expect(publish).not.toHaveBeenCalled();
  expect(allocate).not.toHaveBeenCalled();

  allocate.mockClear();
  expect(store.setState({ count: 1 })).toBeUndefined();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0].values).toEqual({ count: 1 });
  expect(allocate).toHaveBeenCalledTimes(1);
});

it('retains distinct sync payloads across a shared pending storage write', async () => {
  const storage = createAsyncStorageMock();
  const { engine, publish } = createEngine();
  const store = createBaseStore<Counter, Partial<Counter>, Promise<void>>(() => ({ count: 0 }), {
    storage,
    storageKey: 'concurrent-writes',
    sync: { engine },
  });
  await store.persist.hydrationPromise();

  let completeWrite: (() => void) | undefined;
  storage.set.mockReturnValueOnce(new Promise(resolve => (completeWrite = resolve)));
  const first = store.setState({ count: 1 });
  const second = store.setState({ count: 2 });
  await flushMicrotasks(3);
  expect(storage.set).toHaveBeenCalledTimes(1);
  expect(publish).not.toHaveBeenCalled();

  if (!completeWrite) throw new Error('Expected the batched storage write to start.');
  completeWrite();
  await Promise.all([first, second]);

  expect(store.getState().count).toBe(2);
  expect(publish.mock.calls.map(call => call[0].values)).toEqual([{ count: 1 }, { count: 2 }]);
  expect(publish.mock.calls[0][0].values).not.toBe(publish.mock.calls[1][0].values);
});

it('keeps deferred updater arguments separate and applies each against hydrated state', async () => {
  const storage = createAsyncStorageMock();
  let finishHydration: ((value: string) => void) | undefined;
  storage.get.mockReturnValueOnce(new Promise(resolve => (finishHydration = resolve)));
  const { engine, publish } = createEngine();
  const store = createBaseStore<Counter, Partial<Counter>, Promise<void>>(() => ({ count: 0 }), {
    storage,
    storageKey: 'queued-updates',
    sync: { engine },
  });
  const increment = vi.fn((state: Counter) => ({ count: state.count + 1 }));
  const multiply = vi.fn((state: Counter) => ({ count: state.count * 10 }));
  const first = store.setState(increment);
  const second = store.setState(multiply);
  const unchanged = store.setState(state => state);
  expect(increment).not.toHaveBeenCalled();
  expect(multiply).not.toHaveBeenCalled();

  if (!finishHydration) throw new Error('Expected storage hydration to start.');
  finishHydration(JSON.stringify({ state: { count: 5 }, version: 0 }));
  await Promise.all([first, second, unchanged]);
  await flushMicrotasks(3);

  expect(increment).toHaveBeenCalledTimes(1);
  expect(increment).toHaveBeenCalledWith({ count: 5 });
  expect(multiply).toHaveBeenCalledTimes(1);
  expect(multiply).toHaveBeenCalledWith({ count: 6 });
  expect(store.getState().count).toBe(60);
  expect(publish.mock.calls.map(call => call[0].values)).toEqual([{ count: 6 }, { count: 60 }]);
});
