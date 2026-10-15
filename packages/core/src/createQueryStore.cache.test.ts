import { deferred, flushMacrotask } from './async.testUtils';
import { createQueryStore, getQueryKey } from './createQueryStore';
import { createBaseStore } from './createBaseStore';
import { createAsyncStorageMock } from './internal/storage/storageMocks.testUtils';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('query cache selection', () => {
  it('schedules automatic refetch using the lastFetchedAt owned by the custom cache entry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fetcher = vi.fn(() => 'data');
    const store = createQueryStore<string>({
      fetcher,
      staleTime: 100,
      setData: ({ data, queryKey, set }) =>
        set(state => ({
          queryCache: { ...state.queryCache, [queryKey]: { data, errorInfo: null, lastFetchedAt: Date.now() - 40, cacheTime: 1000 } },
        })),
    });
    const unsubscribe = store.subscribe(() => {});

    try {
      await store.getState().fetch();
      expect(store.getState().getCacheEntry()?.lastFetchedAt).toBe(960);

      await vi.advanceTimersByTimeAsync(59);
      expect(fetcher).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(store.getState().isStale()).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('prunes expired entries from a custom cache update', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1000);
    const store = createQueryStore<number, Record<string, never>, { total: number }>(
      {
        staleTime: Infinity,
        cacheTime: 100,
        fetcher: () => 1,
        setData: ({ queryKey, set }) => {
          set({
            queryCache: {
              [queryKey]: { data: 1, cacheTime: 100, lastFetchedAt: 1000, errorInfo: null },
              expired: { data: 0, cacheTime: 1, lastFetchedAt: 1, errorInfo: null },
            },
          });
          set({ total: 1 });
        },
      },
      () => ({ total: 0 })
    );

    try {
      await store.getState().fetch();
      expect(store.getState().total).toBe(1);
      expect(store.getState().getCacheEntry('expired')).toBeNull();
      expect(store.getState().getData()).toBe(1);
    } finally {
      store.getState().reset();
    }
  });

  it.each([false, true])('prunes expired entries after a non-primary fetch with keepPreviousData=%s', async keepPreviousData => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cacheTime = 5 * 60 * 1000;
    const store = createQueryStore({
      cacheTime,
      disableAutoRefetching: true,
      keepPreviousData,
      params: { id: 'primary' },
      fetcher: async ({ id }) => `data-${id}`,
      staleTime: Infinity,
    });

    try {
      await store.getState().fetch({ id: 'unused' });
      await store.getState().fetch();
      const completedState = store.getState();
      const selectedEntry = completedState.getCacheEntry();
      vi.setSystemTime(Date.now() + cacheTime);

      await store.getState().fetch({ id: 'other' });
      const state = store.getState();
      expect(state.queryKey).toBe(completedState.queryKey);
      expect(state.lastFetchedAt).toBe(completedState.lastFetchedAt);
      expect(state.status).toBe(completedState.status);
      expect(state.error).toBeNull();
      expect(state.getCacheEntry()).toEqual(keepPreviousData ? selectedEntry : null);
      expect(state.getData()).toBe(keepPreviousData ? 'data-primary' : null);
      expect(state.getCacheEntry({ id: 'unused' })).toBeNull();
      expect(state.getData({ id: 'other' })).toBe('data-other');

      await state.fetch({ id: 'replacement' }, { updateQueryKey: true });
      expect(store.getState().getData()).toBe('data-replacement');
      expect(store.getState().getCacheEntry({ id: 'primary' })).toBeNull();
    } finally {
      store.getState().reset();
    }
  });

  it('reuses fresh cached data without publishing, persisting, or postponing refetch', async () => {
    vi.useFakeTimers();

    const storage = createAsyncStorageMock();
    const fetcher = vi.fn(() => 'cached data');
    const store = createQueryStore({ fetcher, staleTime: 100 }, { storage, storageKey: 'cached-refetch' });
    const listener = vi.fn();
    let unsubscribe: (() => void) | undefined;

    try {
      await store.persist.hydrationPromise();
      unsubscribe = store.subscribe(listener);
      await store.getState().fetch();
      await vi.advanceTimersByTimeAsync(40);

      const state = store.getState();
      listener.mockClear();
      storage.set.mockClear();
      expect(await state.fetch()).toBe('cached data');

      await vi.advanceTimersByTimeAsync(0);
      expect(store.getState()).toBe(state);
      expect(listener).not.toHaveBeenCalled();
      expect(storage.set).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(59);
      expect(fetcher).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });

  it('preserves uncached failure state and scheduled retry when reusing a fresh result', async () => {
    vi.useFakeTimers();
    let shouldFail = false;
    const error = new Error('failure');
    const fetcher = vi.fn(() => {
      if (shouldFail) throw error;
      return 'data';
    });
    const store = createQueryStore({ fetcher, disableCache: true, retry: 1, retryDelay: 25, staleTime: 100 });
    const unsubscribe = store.subscribe(() => {});

    try {
      await vi.advanceTimersByTimeAsync(0);
      shouldFail = true;
      await store.getState().fetch(undefined, { force: true });
      const failed = store.getState();
      await failed.fetch();
      expect(store.getState()).toBe(failed);
      expect(store.getState().error).toBe(error);

      await vi.advanceTimersByTimeAsync(25);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('projects a cached terminal error without retaining the previous selection status', async () => {
    let failing = false;
    const error = new Error('B failure');
    const store = createQueryStore({
      params: { id: 'a' },
      staleTime: Infinity,
      retry: false,
      fetcher: ({ id }) => {
        if (failing && id === 'b') throw error;
        return id;
      },
    });

    try {
      await store.getState().fetch({ id: 'b' }, { updateQueryKey: true });
      failing = true;
      await store.getState().fetch({ id: 'b' }, { force: true });
      await store.getState().fetch({ id: 'a' }, { updateQueryKey: true });
      const entry = store.getState().getCacheEntry({ id: 'b' });
      expect(await store.getState().fetch({ id: 'b' }, { updateQueryKey: true })).toBe('b');
      expect(store.getState().status).toBe('error');
      expect(store.getState().error).toBe(error);
      expect(store.getState().lastFetchedAt).toBe(entry?.lastFetchedAt);
    } finally {
      store.getState().reset();
    }
  });

  it.each([true, 'withCache'] as const)('keeps cached skipStoreUpdates=%s independent even with updateQueryKey', async skipStoreUpdates => {
    const store = createQueryStore({ params: { id: 'a' }, fetcher: ({ id }) => id, staleTime: Infinity });

    try {
      await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
      const state = store.getState();
      expect(await state.fetch({ id: 'b' }, { skipStoreUpdates, updateQueryKey: true })).toBe('b');
      expect(store.getState()).toBe(state);
    } finally {
      store.getState().reset();
    }
  });

  it('keeps a request started by a cache-selection listener in control of scheduling', async () => {
    vi.useFakeTimers();
    const source = createBaseStore(() => ({ id: 'a' }));
    const pending = deferred<string>();
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'b' ? 'cached B' : pending.promise));
    const store = createQueryStore({
      params: { id: $ => $(source).id },
      fetcher,
      staleTime: 100,
      keepPreviousData: true,
    });
    await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
    let switched = false;
    const unsubscribe = store.subscribe(state => {
      if (!switched && state.queryKey === getQueryKey({ id: 'b' })) {
        switched = true;
        void state.fetch({ id: 'c' }, { updateQueryKey: true });
      }
    });

    try {
      source.setState({ id: 'b' });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['b', 'a', 'c']);

      await vi.advanceTimersByTimeAsync(100);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['b', 'a', 'c']);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])('keeps cached B selected after uncancelled A completes with rejects=%s', async rejects => {
    const source = createBaseStore(() => ({ id: 'a' }));
    const first = deferred<string>();
    const store = createQueryStore<string, { id: string }>({
      abortInterruptedFetches: false,
      keepPreviousData: true,
      params: { id: $ => $(source).id },
      fetcher: ({ id }) => (id === 'a' ? first.promise : Promise.resolve('cached B')),
      staleTime: Infinity,
      retry: false,
    });
    await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
    const unsubscribe = store.subscribe(() => {});

    try {
      source.setState({ id: 'b' });
      await flushMacrotask();
      expect(store.getState().getData()).toBe('cached B');

      if (rejects) first.reject(new Error('old A'));
      else first.resolve('old A');
      await flushMacrotask();
      expect(store.getState().queryKey).toBe(getQueryKey({ id: 'b' }));
      expect(store.getState().getData()).toBe('cached B');
      expect(store.getState().error).toBeNull();
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('does not refetch A after B is selected from cache', async () => {
    vi.useFakeTimers();
    const source = createBaseStore(() => ({ id: 'a' }));
    const first = deferred<string>();
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'a' ? first.promise : Promise.resolve('cached B')));
    const store = createQueryStore({
      abortInterruptedFetches: false,
      params: { id: $ => $(source).id },
      fetcher,
      staleTime: 100,
      retry: false,
    });
    await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
    const unsubscribe = store.subscribe(() => {});

    try {
      source.setState({ id: 'b' });
      await vi.advanceTimersByTimeAsync(0);
      first.resolve('old A');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['b', 'a', 'b']);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('retires the previous request when a cache-selection listener throws', async () => {
    const pending = deferred<string>();
    const controllers: AbortController[] = [];
    const error = new Error('selection listener failed');
    const store = createQueryStore({
      params: { id: 'a' },
      staleTime: Infinity,
      fetcher: ({ id }, controller) => {
        if (controller) controllers.push(controller);
        return id === 'a' ? pending.promise : 'cached b';
      },
    });
    await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
    const unsubscribe = store.subscribe(state => {
      if (state.queryKey === getQueryKey({ id: 'b' })) throw error;
    });

    try {
      const first = store.getState().fetch();
      await expect(store.getState().fetch({ id: 'b' }, { updateQueryKey: true })).rejects.toBe(error);
      expect(controllers[0]?.signal.aborted).toBe(true);
      expect(await first).toBeNull();
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });
});

describe('query resubscription', () => {
  it('clears loading when a completed read loses its last subscriber and is later reused', async () => {
    const first = deferred<string>();
    const fetcher = vi.fn(() => first.promise);
    const store = createQueryStore({ fetcher, staleTime: Infinity });
    const unsubscribe = store.subscribe(() => {});
    const read = store.getState().fetch();
    first.resolve('completed data');
    await first.promise;
    unsubscribe();
    expect(await read).toBe('completed data');

    const unsubscribeAgain = store.subscribe(() => {});

    try {
      await flushMacrotask();
      expect(store.getState().getData()).toBe('completed data');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.getState().getStatus('isLoading')).toBe(false);
    } finally {
      unsubscribeAgain();
      store.getState().reset();
    }
  });

  it('keeps a fresh uncached success fresh through immediate resubscription', async () => {
    const response = deferred<string>();
    const fetcher = vi.fn(() => response.promise);
    const store = createQueryStore({ fetcher, disableCache: true, staleTime: Infinity });
    let replaced = false;
    let unsubscribe: () => void = () => undefined;
    unsubscribe = store.subscribe(state => {
      if (state.status === 'success' && !replaced) {
        replaced = true;
        unsubscribe();
        unsubscribe = store.subscribe(() => undefined);
      }
    });

    try {
      const first = store.getState().fetch();
      response.resolve('value');
      expect(await first).toBe('value');

      await flushMacrotask();
      expect(replaced).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.getState().status).toBe('success');
      expect(store.getState().isStale()).toBe(false);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])('keeps cached data selected after resubscription and an older request settles, rejects=%s', async rejects => {
    const source = createBaseStore(() => ({ id: 'a' }));
    const response = deferred<string>();
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'a' ? response.promise : 'cached b'));
    const store = createQueryStore({
      params: { id: $ => $(source).id },
      fetcher,
      abortInterruptedFetches: false,
      staleTime: Infinity,
      retry: false,
    });
    let unsubscribe: (() => void) | undefined;

    try {
      await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
      unsubscribe = store.subscribe(() => {});
      const first = store.getState().fetch();
      unsubscribe();
      unsubscribe = undefined;
      source.setState({ id: 'b' });
      await flushMacrotask();
      unsubscribe = store.subscribe(() => {});
      expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'b' }), status: 'success', error: null });
      expect(store.getState().getData()).toBe('cached b');

      if (rejects) response.reject(new Error('old a'));
      else response.resolve('old a');
      await first;
      expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'b' }), status: 'success', error: null });
      expect(store.getState().getData()).toBe('cached b');
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['b', 'a']);
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });

  it('selects cached data after unsubscribe cancels the previous request', async () => {
    const source = createBaseStore(() => ({ id: 'a' }));
    const response = deferred<string>();
    const store = createQueryStore<string, { id: string }>({
      params: { id: $ => $(source).id },
      fetcher: ({ id }) => (id === 'a' ? response.promise : 'cached b'),
      staleTime: Infinity,
    });
    let unsubscribe: (() => void) | undefined;

    try {
      await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
      unsubscribe = store.subscribe(() => {});
      const first = store.getState().fetch();
      unsubscribe();
      unsubscribe = undefined;
      expect(await first).toBeNull();

      source.setState({ id: 'b' });
      await flushMacrotask();
      unsubscribe = store.subscribe(() => {});
      expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'b' }), status: 'success', error: null });
      expect(store.getState().getData()).toBe('cached b');
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });

  it('preserves the cached key refetch deadline after resubscription and an older completion', async () => {
    vi.useFakeTimers();
    const source = createBaseStore(() => ({ id: 'a' }));
    const response = deferred<string>();
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'a' ? response.promise : 'cached b'));
    const store = createQueryStore({
      params: { id: $ => $(source).id },
      fetcher,
      abortInterruptedFetches: false,
      staleTime: 50,
      retry: false,
    });
    let unsubscribe: (() => void) | undefined;

    try {
      await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
      unsubscribe = store.subscribe(() => {});
      const first = store.getState().fetch();
      unsubscribe();
      unsubscribe = undefined;
      source.setState({ id: 'b' });
      await vi.advanceTimersByTimeAsync(0);
      unsubscribe = store.subscribe(() => {});
      response.resolve('old a');
      await first;
      await vi.advanceTimersByTimeAsync(49);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['b', 'a']);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['b', 'a', 'b']);
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });
});
