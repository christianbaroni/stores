import { deferred, flushMacrotask, flushMicrotasks } from './async.testUtils';
import { createQueryStore, getQueryKey } from './createQueryStore';
import { createBaseStore } from './createBaseStore';
import { createAsyncStorageMock, createSyncStorageMock } from './internal/storage/storageMocks.testUtils';
import { logger } from './internal/logger';
import type { SyncEngine } from './sync/types';

function createPendingStorage() {
  const read = deferred<string | undefined>();
  const storage = createAsyncStorageMock();
  storage.get.mockReturnValueOnce(read.promise);
  return { read, storage };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('initial query hydration', () => {
  it.each([false, true])('starts immediately without asynchronous storage, persisted=%s', async persisted => {
    const storage = createSyncStorageMock();
    const fetcher = vi.fn(() => 1);
    const store = createQueryStore({ fetcher, staleTime: Infinity }, persisted ? { storage, storageKey: 'sync-start' } : undefined);

    try {
      const result = store.getState().fetch();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(await result).toBe(1);
    } finally {
      store.getState().reset();
    }
  });

  it.each([false, true])('applies the first query outcome after initial hydration, rejects=%s', async rejects => {
    const { read: hydration, storage } = createPendingStorage();
    const error = new Error('fetch failure');
    const store = createQueryStore(
      {
        fetcher: () => {
          if (rejects) throw error;
          return 'fresh';
        },
        retry: false,
        staleTime: Infinity,
      },
      { storage, storageKey: 'query-result' }
    );

    try {
      let settled = false;
      const fetching = store
        .getState()
        .fetch()
        .finally(() => {
          settled = true;
        });
      await flushMacrotask();
      expect(settled).toBe(false);

      hydration.resolve(undefined);
      expect(await fetching).toBe(rejects ? null : 'fresh');

      await store.persist.hydrationPromise();
      expect(store.getState().status).toBe(rejects ? 'error' : 'success');
      expect(store.getState().error).toBe(rejects ? error : null);
      expect(store.getState().getData()).toBe(rejects ? null : 'fresh');
    } finally {
      hydration.resolve(undefined);
      await store.persist.hydrationPromise();
      store.getState().reset();
    }
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('selects current params after hydration, subscribeBefore=%s, cached=%s', async (subscribeBefore, cached) => {
    const { read, storage } = createPendingStorage();
    const fetcher = vi.fn(({ id }: { id: string }) => `fetched ${id}`);
    const store = createQueryStore({ params: { id: 'a' }, fetcher, staleTime: Infinity }, { storage, storageKey: 'restored-selection' });
    let unsubscribe: (() => void) | undefined;

    try {
      unsubscribe = subscribeBefore ? store.subscribe(() => {}) : undefined;
      expect(fetcher).not.toHaveBeenCalled();

      const lastFetchedAt = Date.now();
      const entry = (data: string) => ({ data, lastFetchedAt, cacheTime: 60000, errorInfo: null });
      read.resolve(
        JSON.stringify({
          version: 0,
          state: {
            queryKey: getQueryKey({ id: 'b' }),
            status: 'success',
            lastFetchedAt,
            queryCache: {
              [getQueryKey({ id: 'b' })]: entry('cached b'),
              ...(cached ? { [getQueryKey({ id: 'a' })]: entry('cached a') } : {}),
            },
          },
        })
      );
      await store.persist.hydrationPromise();
      expect(store.getState().queryKey).toBe(getQueryKey({ id: 'a' }));

      unsubscribe ??= store.subscribe(() => {});
      await flushMacrotask();
      expect(store.getState().queryKey).toBe(getQueryKey({ id: 'a' }));
      expect(store.getState().getData()).toBe(cached ? 'cached a' : 'fetched a');
      expect(fetcher).toHaveBeenCalledTimes(cached ? 0 : 1);
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });

  it('selects the current parameters when they change during hydration', async () => {
    const { read, storage } = createPendingStorage();
    const source = createBaseStore(() => ({ id: 'a' }));
    const store = createQueryStore<string, { id: string }>(
      { params: { id: $ => $(source).id }, fetcher: ({ id }) => id, staleTime: Infinity },
      { storage, storageKey: 'changed-selection' }
    );
    const unsubscribe = store.subscribe(() => {});

    try {
      source.setState({ id: 'b' });
      read.resolve(JSON.stringify({ version: 0, state: { queryKey: getQueryKey({ id: 'c' }) } }));
      await store.persist.hydrationPromise();
      await flushMacrotask();
      expect(store.getState().queryKey).toBe(getQueryKey({ id: 'b' }));
      expect(store.getState().getData()).toBe('b');
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('retains call-time parameters while startup is pending', async () => {
    const { read, storage } = createPendingStorage();
    const source = createBaseStore(() => ({ id: 'a' }));
    const fetcher = vi.fn(({ id }: { id: string }) => id);
    const store = createQueryStore({ params: { id: $ => $(source).id }, fetcher, staleTime: Infinity }, { storage, storageKey: 'params' });

    try {
      const result = store.getState().fetch();
      source.setState({ id: 'b' });
      expect(fetcher).not.toHaveBeenCalled();

      read.resolve(undefined);
      expect(await result).toBe('a');
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['a']);
      expect(store.getState().getData(getQueryKey({ id: 'a' }))).toBe('a');
    } finally {
      store.getState().reset();
    }
  });

  it('fetches when an active query is enabled before async hydration completes', async () => {
    const { read, storage } = createPendingStorage();
    const fetcher = vi.fn(async () => 42);
    const engine: SyncEngine = {
      sessionId: 'local',
      register: () => ({ destroy: () => {}, publish: () => {} }),
    };
    const store = createQueryStore(
      { enabled: false, fetcher, staleTime: Infinity },
      { storage, storageKey: 'enabled-before-hydration', sync: { engine } }
    );
    const unsubscribe = store.subscribe(() => {});
    try {
      const enabled = store.setState({ enabled: true });
      expect(fetcher).not.toHaveBeenCalled();

      read.resolve(undefined);
      await enabled;
      await flushMicrotasks(5);
      expect(store.getState().enabled).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])('rechecks enabled before admission, force=%s', async force => {
    const { read, storage } = createPendingStorage();
    const fetcher = vi.fn(() => 1);
    const store = createQueryStore({ fetcher, staleTime: Infinity }, { storage, storageKey: 'enabled' });

    try {
      const result = store.getState().fetch(undefined, { force });
      store.setState({ enabled: false });
      read.resolve(undefined);
      expect(await result).toBe(force ? 1 : null);
      expect(fetcher).toHaveBeenCalledTimes(force ? 1 : 0);
    } finally {
      store.getState().reset();
    }
  });

  it('shares result data and one callback between startup waiters', async () => {
    const { read, storage } = createPendingStorage();
    const data = { value: 1 };
    const fetcher = vi.fn(() => data);
    const setData = vi.fn();
    const store = createQueryStore({ fetcher, setData, staleTime: Infinity }, { storage, storageKey: 'dedup' });

    try {
      const first = store.getState().fetch();
      await flushMacrotask();
      const second = store.getState().fetch(undefined, { force: true });
      expect(fetcher).not.toHaveBeenCalled();

      read.resolve(undefined);
      const results = await Promise.all([first, second]);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(results[0]).toBe(data);
      expect(results[1]).toBe(data);
      expect(setData).toHaveBeenCalledOnce();
    } finally {
      store.getState().reset();
    }
  });

  it('does not start queries after reset while initial hydration is pending', async () => {
    const { read, storage } = createPendingStorage();
    const fetcher = vi.fn(() => 1);
    const store = createQueryStore<number, Record<string, never>, { total: number }>(
      {
        fetcher,
        setData: ({ data, set }) => set(state => ({ total: state.total + data })),
        staleTime: Infinity,
      },
      () => ({ total: 0 }),
      { storage, storageKey: 'reset-during-hydration' }
    );

    try {
      const result = store.getState().fetch();
      await flushMacrotask();
      store.getState().reset();
      expect(fetcher).not.toHaveBeenCalled();

      read.resolve(undefined);
      await store.persist.hydrationPromise();
      expect(await result).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
      expect(store.getState().total).toBe(0);
      expect(store.getState().status).toBe('idle');
      expect(store.getState().lastFetchedAt).toBeNull();
      expect(Object.keys(store.getState().queryCache)).toHaveLength(0);
    } finally {
      store.getState().reset();
    }
  });

  it('completes result-only reads before hydration without stateful callbacks', async () => {
    const { read, storage } = createPendingStorage();
    const setData = vi.fn();
    const onFetched = vi.fn();
    const store = createQueryStore({ fetcher: () => 1, setData, onFetched, staleTime: Infinity }, { storage, storageKey: 'independent' });

    try {
      expect(await store.getState().fetch(undefined, { skipStoreUpdates: true })).toBe(1);
      expect(setData).not.toHaveBeenCalled();
      expect(onFetched).not.toHaveBeenCalled();

      read.resolve(undefined);
      await store.persist.hydrationPromise();
    } finally {
      store.getState().reset();
    }
  });
});

describe('query publication after hydration', () => {
  it('keeps a hydration listener request loading until it completes', async () => {
    const hydration = deferred<string | undefined>();
    const response = deferred<string>();
    const storage = createAsyncStorageMock();
    storage.get.mockReturnValueOnce(hydration.promise);
    const store = createQueryStore(
      {
        params: { id: 'a' },
        fetcher: ({ id }) => (id === 'a' ? 'fresh a' : response.promise),
        staleTime: Infinity,
      },
      () => ({ hydrated: false }),
      { storage, storageKey: 'request-during-hydration' }
    );
    let replacement: Promise<string | null> | undefined;
    let startedReplacement = false;
    const unsubscribe = store.subscribe(state => {
      if (state.hydrated && !startedReplacement) {
        startedReplacement = true;
        replacement = state.fetch({ id: 'b' }, { force: true, updateQueryKey: true });
      }
    });

    try {
      const fetching = store.getState().fetch();
      await flushMacrotask();
      const key = store.getState().queryKey;
      const timestamp = Date.now();
      hydration.resolve(
        JSON.stringify({
          version: 0,
          state: {
            hydrated: true,
            status: 'loading',
            queryKey: key,
            lastFetchedAt: timestamp,
            queryCache: { [key]: { data: 'old a', cacheTime: 60000, lastFetchedAt: timestamp, errorInfo: null } },
          },
        })
      );
      await store.persist.hydrationPromise();
      await fetching;
      expect(startedReplacement).toBe(true);
      expect(store.getState().status).toBe('loading');

      response.resolve('fresh b');
      await replacement;
      expect(store.getState().getData()).toBe('fresh b');
      expect(store.getState().status).toBe('success');
    } finally {
      hydration.resolve(undefined);
      response.resolve('fresh b');
      await store.persist.hydrationPromise();
      await replacement;
      unsubscribe();
      store.getState().reset();
    }
  });

  it('keeps hydrated cached data when the first forced refresh fails', async () => {
    const { read: hydration, storage } = createPendingStorage();
    const error = new Error('refresh failed');
    const store = createQueryStore(
      {
        fetcher: () => {
          throw error;
        },
        retry: false,
        staleTime: Infinity,
      },
      { storage, storageKey: 'failed-refresh-hydration' }
    );

    try {
      const fetching = store.getState().fetch(undefined, { force: true });
      await flushMacrotask();
      const key = store.getState().queryKey;
      const lastFetchedAt = Date.now();
      hydration.resolve(
        JSON.stringify({
          version: 0,
          state: {
            queryCache: { [key]: { cacheTime: 60000, data: 'cached', lastFetchedAt, errorInfo: null } },
          },
        })
      );
      await store.persist.hydrationPromise();
      await fetching;
      expect(store.getState().getData()).toBe('cached');
      expect(store.getState().getCacheEntry()).toMatchObject({ lastFetchedAt, errorInfo: { error } });
      expect(store.getState().status).toBe('error');
    } finally {
      store.getState().reset();
    }
  });

  it.each([undefined, 'withCache'] as const)('applies functional setData to hydrated state, skip=%s', async skipStoreUpdates => {
    const { read: hydration, storage } = createPendingStorage();
    const store = createQueryStore<number, Record<string, never>, { total: number }>(
      {
        fetcher: () => 1,
        staleTime: Infinity,
        setData: ({ data, set }) => {
          set(state => ({ total: state.total + data }));
          set(state => ({ ...state, total: state.total + data, enabled: false }));
        },
      },
      () => ({ total: 0 }),
      { storage, storageKey: 'functional-data-hydration' }
    );

    try {
      const fetching = store.getState().fetch(undefined, { skipStoreUpdates });
      hydration.resolve(JSON.stringify({ version: 0, state: { total: 100 } }));
      await store.persist.hydrationPromise();
      await fetching;
      expect(store.getState()).toMatchObject({ total: 102, enabled: false });
    } finally {
      store.getState().reset();
    }
  });

  it('composes independent custom updates after hydration', async () => {
    const { read: hydration, storage } = createPendingStorage();
    const store = createQueryStore<number, Record<string, never>, { total: number }>(
      {
        fetcher: () => 1,
        staleTime: Infinity,
        setData: ({ data, set }) => set(state => ({ total: state.total + data })),
      },
      () => ({ total: 0 }),
      { storage, storageKey: 'functional-completions' }
    );

    try {
      const first = store.getState().fetch(undefined, { force: true, skipStoreUpdates: 'withCache' });
      const second = store.getState().fetch(undefined, { force: true, skipStoreUpdates: 'withCache' });
      hydration.resolve(undefined);
      await store.persist.hydrationPromise();
      await Promise.all([first, second]);
      expect(store.getState().total).toBe(2);
    } finally {
      store.getState().reset();
    }
  });

  it('preserves replacement ownership for uncancelled requests admitted after startup', async () => {
    const { read, storage } = createPendingStorage();
    const secondResponse = deferred<string>();
    const store = createQueryStore<string, { id: string }, { values: string[] }>(
      {
        params: { id: 'a' },
        abortInterruptedFetches: false,
        fetcher: ({ id }) => (id === 'a' ? 'a' : secondResponse.promise),
        staleTime: Infinity,
        setData: ({ data, set }) => set(state => ({ values: [...state.values, data] })),
      },
      () => ({ values: [] }),
      { storage, storageKey: 'replace' }
    );

    try {
      const first = store.getState().fetch();
      await flushMacrotask();
      const second = store.getState().fetch({ id: 'b' }, { updateQueryKey: true });
      read.resolve(undefined);
      await first;
      expect(store.getState().status).toBe('loading');
      expect(store.getState().values).toEqual(['a']);

      secondResponse.resolve('b');
      await second;
      expect(store.getState().queryKey).toBe(getQueryKey({ id: 'b' }));
      expect(store.getState().values).toEqual(['a', 'b']);
    } finally {
      store.getState().reset();
    }
  });

  it('keeps hydrated cache selection authoritative after another startup request fails', async () => {
    vi.useFakeTimers();
    const { read: hydration, storage } = createPendingStorage();
    const fetcher = vi.fn(({ id }: { id: string }) => {
      if (id === 'a') throw new Error('a failed');
      return 'c';
    });
    const store = createQueryStore(
      { params: { id: 'c' }, fetcher, staleTime: 1000, retry: 1, retryDelay: 50 },
      { storage, storageKey: 'cached-selection-timer' }
    );
    let selectedCache = false;
    const unsubscribe = store.subscribe(state => {
      if (!selectedCache && state.getData() === 'hydrated c') {
        selectedCache = true;
        void state.fetch();
      }
    });

    try {
      const first = store.getState().fetch();
      await vi.advanceTimersByTimeAsync(0);
      const second = store.getState().fetch({ id: 'a' }, { force: true, updateQueryKey: true });
      await vi.advanceTimersByTimeAsync(0);
      const key = store.getState().queryKey;
      const timestamp = Date.now();
      hydration.resolve(
        JSON.stringify({
          version: 0,
          state: {
            queryKey: key,
            status: 'success',
            error: null,
            lastFetchedAt: timestamp,
            queryCache: { [key]: { cacheTime: 60000, data: 'hydrated c', lastFetchedAt: timestamp, errorInfo: null } },
          },
        })
      );
      await store.persist.hydrationPromise();
      await Promise.all([first, second]);
      expect(selectedCache).toBe(true);

      await vi.advanceTimersByTimeAsync(50);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['a']);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])('starts callbacks after updates already submitted during hydration, throws=%s', async throws => {
    const { read, storage } = createPendingStorage();
    const onError = vi.fn();
    const updater = vi.fn((state: { total: number }) => {
      if (throws) throw new Error('update failed');
      return { total: state.total + 1 };
    });
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const store = createQueryStore<number, Record<string, never>, { total: number; change: () => void }>(
      { fetcher: () => 1, setData: ({ set }) => set(updater), onError, retry: false, staleTime: Infinity },
      set => ({
        total: 0,
        change: () => {
          set({ total: 50 });
        },
      }),
      { storage, storageKey: 'fifo' }
    );

    try {
      const result = store.getState().fetch();
      await flushMacrotask();
      store.getState().change();
      read.resolve(JSON.stringify({ version: 0, state: { total: 100 } }));
      await store.persist.hydrationPromise();
      expect(await result).toBe(throws ? null : 1);
      expect(updater).toHaveBeenCalledOnce();
      expect(store.getState().total).toBe(throws ? 50 : 51);
      expect(onError).toHaveBeenCalledTimes(throws ? 1 : 0);
    } finally {
      store.getState().reset();
    }
  });

  it.each([false, true])('schedules success and retry timers from requests admitted after startup, rejects=%s', async rejects => {
    vi.useFakeTimers();
    const { read, storage } = createPendingStorage();
    const fetcher = vi.fn(() => {
      if (rejects) throw new Error('failed');
      return 1;
    });
    const store = createQueryStore({ fetcher, staleTime: 50, retry: 1, retryDelay: 50 }, { storage, storageKey: 'timers' });
    const unsubscribe = store.subscribe(() => {});

    try {
      const result = store.getState().fetch();
      await vi.advanceTimersByTimeAsync(100);
      expect(fetcher).not.toHaveBeenCalled();

      read.resolve(undefined);
      await result;
      expect(fetcher).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(49);
      expect(fetcher).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });
});

describe('hydration and callback failures', () => {
  it.each([false, true])('rolls back staged updates and reports a setData failure after hydration, throwOnError=%s', async throwOnError => {
    const { read, storage } = createPendingStorage();
    const error = new Error('update failed');
    const updater = vi.fn(() => {
      throw error;
    });
    const onError = vi.fn();
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const store = createQueryStore<number, Record<string, never>, { total: number }>(
      {
        fetcher: () => 1,
        setData: ({ set }) => {
          set({ total: 99 });
          set(updater);
        },
        onError,
        retry: false,
        staleTime: Infinity,
      },
      () => ({ total: 0 }),
      { storage, storageKey: 'throw' }
    );

    try {
      const result = store
        .getState()
        .fetch(undefined, { throwOnError })
        .then(
          value => ({ value }),
          error => ({ error })
        );
      await flushMacrotask();
      expect(updater).not.toHaveBeenCalled();

      read.resolve(JSON.stringify({ version: 0, state: { total: 10 } }));
      await store.persist.hydrationPromise();
      const outcome = await result;
      expect(updater).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledOnce();
      expect(store.getState()).toMatchObject({ status: 'error', total: 10 });
      expect(store.getState().error).toMatchObject({ cause: error });
      expect(outcome).toEqual(throwOnError ? { error: store.getState().error } : { value: null });
    } finally {
      store.getState().reset();
    }
  });

  it('logs a throwing onFetched updater without failing the query', async () => {
    const { read, storage } = createPendingStorage();
    const error = new Error('onFetched failed');
    const updater = vi.fn(() => {
      throw error;
    });
    const onError = vi.fn();
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const store = createQueryStore(
      {
        fetcher: () => 1,
        onFetched: ({ set }) => set(updater),
        onError,
        retry: false,
        staleTime: Infinity,
      },
      { storage, storageKey: 'onFetched' }
    );

    try {
      const result = store.getState().fetch(undefined, { throwOnError: true });
      await flushMacrotask();
      expect(updater).not.toHaveBeenCalled();

      read.resolve(undefined);
      await store.persist.hydrationPromise();
      expect(await result).toBe(1);
      expect(updater).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
      expect(log.mock.calls[0][0]).toMatchObject({ cause: error });
      expect(store.getState().status).toBe('success');
    } finally {
      store.getState().reset();
    }
  });

  it.each([false, true])('fetches fresh data after initial hydration failure, failureBeforeFetch=%s', async failureBeforeFetch => {
    const { read, storage } = createPendingStorage();
    const error = new Error('storage failed');
    const onRehydrate = vi.fn();
    const updater = vi.fn((state: { total: number }) => ({
      total: state.total + 1,
    }));
    const store = createQueryStore<number, Record<string, never>, { total: number }>(
      {
        fetcher: () => 1,
        setData: ({ set }) => set(updater),
        staleTime: Infinity,
      },
      () => ({ total: 0 }),
      {
        storage,
        storageKey: 'storage-error',
        onRehydrateStorage: () => onRehydrate,
      }
    );

    try {
      const hydration = store.persist.hydrationPromise().catch(reason => reason);
      if (failureBeforeFetch) {
        read.reject(error);
        await flushMacrotask();
      }
      const result = store.getState().fetch();
      if (!failureBeforeFetch) read.reject(error);
      expect(await hydration).toBe(error);
      expect(await result).toBe(1);
      expect(updater).toHaveBeenCalledOnce();
      expect(store.getState().total).toBe(1);
      expect(onRehydrate).toHaveBeenCalledWith(undefined, error);
    } finally {
      store.getState().reset();
    }
  });

  it('allows automatic fetching after an initial read rejection', async () => {
    const storage = createAsyncStorageMock();
    const read = deferred<string | undefined>();
    storage.get.mockReturnValueOnce(read.promise);
    const failure = new Error('storage read');
    const fetcher = vi.fn(() => 1);
    const onError = vi.fn();
    const store = createQueryStore({ fetcher, onError, staleTime: Infinity }, { storage, storageKey: 'failed-start' });
    let unsubscribe: (() => void) | undefined;

    try {
      const hydration = store.persist.hydrationPromise().catch(error => error);
      unsubscribe = store.subscribe(() => {});
      read.reject(failure);
      await flushMacrotask();
      expect(await hydration).toBe(failure);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(store.getState()).toMatchObject({ status: 'success', error: null });
      expect(store.getState().getData()).toBe(1);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });
});

describe('completed query initialization', () => {
  it('does not wait for a later manual rehydration', async () => {
    const { read, storage } = createPendingStorage();
    const laterRead = deferred<string | undefined>();
    storage.get.mockReturnValueOnce(laterRead.promise);
    const setData = vi.fn();
    const store = createQueryStore({ fetcher: () => 1, setData, staleTime: Infinity }, { storage, storageKey: 'manual' });

    try {
      read.resolve(undefined);
      await store.persist.hydrationPromise();
      const rehydrating = store.persist.rehydrate();
      expect(store.persist.hasHydrated()).toBe(false);
      expect(await store.getState().fetch()).toBe(1);
      expect(setData).toHaveBeenCalledOnce();
      expect(store.persist.hasHydrated()).toBe(false);

      laterRead.resolve(undefined);
      await rehydrating;
    } finally {
      store.getState().reset();
    }
  });

  it('does not wait for persistence writes after state application', async () => {
    const write = deferred<void>();
    const storage = createAsyncStorageMock();
    storage.set.mockReturnValue(write.promise);
    const store = createQueryStore<number, Record<string, never>, { total: number }>(
      {
        fetcher: () => 1,
        staleTime: Infinity,
        setData: ({ set }) => set({ total: 1 }),
      },
      () => ({ total: 0 }),
      { storage, storageKey: 'slow-write' }
    );

    try {
      await store.persist.hydrationPromise();
      expect(await store.getState().fetch()).toBe(1);
      expect(store.getState().total).toBe(1);

      write.resolve();
    } finally {
      store.getState().reset();
    }
  });
});
