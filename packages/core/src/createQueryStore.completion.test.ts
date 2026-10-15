import { deferred, flushMacrotask } from './async.testUtils';
import { createQueryStore, getQueryKey } from './createQueryStore';
import { createBaseStore } from './createBaseStore';
import { logger } from './internal/logger';
import type { SyncEngine, SyncUpdate } from './sync/types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('query completion ownership', () => {
  it.each([false, true])('preserves a pending replacement when an older request settles, rejects=%s', async rejects => {
    vi.useFakeTimers();

    const source = createBaseStore(() => ({ id: 'a' }));
    const firstResponse = deferred<string>();
    const replacementResponse = deferred<string>();
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'a' ? firstResponse.promise : replacementResponse.promise));
    const onFetched = vi.fn();
    const onError = vi.fn();
    const store = createQueryStore({
      params: { id: $ => $(source).id },
      abortInterruptedFetches: false,
      fetcher,
      onFetched,
      onError,
      staleTime: 50,
      retry: 1,
      retryDelay: 50,
    });
    const unsubscribe = store.subscribe(() => {});
    const firstFetch = store.getState().fetch();

    try {
      source.setState({ id: 'b' });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['a', 'b']);

      const replacementFetch = store.getState().fetch();

      const error = new Error('old request failed');
      if (rejects) firstResponse.reject(error);
      else firstResponse.resolve('old data');
      expect(await firstFetch).toBe(rejects ? null : 'old data');
      expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'b' }), status: 'loading', error: null });
      expect(store.getState().getData({ id: 'a' })).toBe(rejects ? null : 'old data');
      expect(onFetched).toHaveBeenCalledTimes(rejects ? 0 : 1);
      expect(onError).toHaveBeenCalledTimes(rejects ? 1 : 0);

      if (rejects) {
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error, params: { id: 'a' }, willRetry: false }));
        expect(store.getState().getCacheEntry({ id: 'a' })?.errorInfo?.error).toBe(error);
      }

      await vi.advanceTimersByTimeAsync(100);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['a', 'b']);
      expect(store.getState().status).toBe('loading');

      replacementResponse.resolve('new data');
      expect(await replacementFetch).toBe('new data');
      expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'b' }), status: 'success', error: null });
      expect(store.getState().getData()).toBe('new data');
      expect(onFetched).toHaveBeenCalledTimes(rejects ? 1 : 2);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])('keeps the completed replacement selected when an uncancelled older read rejects=%s', async rejects => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cacheTime = 5 * 60 * 1000;
    const source = createBaseStore(() => ({ id: 'a' }));
    const first = deferred<string>();
    const second = deferred<string>();
    const store = createQueryStore<string, { id: string }>({
      abortInterruptedFetches: false,
      cacheTime,
      keepPreviousData: true,
      params: { id: $ => $(source).id },
      fetcher: ({ id }) => (id === 'a' ? first.promise : second.promise),
      retry: false,
      staleTime: Infinity,
    });

    const unsubscribe = store.subscribe(() => {});

    try {
      source.setState({ id: 'b' });
      await flushMacrotask();
      second.resolve('new data');
      await flushMacrotask();
      const completedState = store.getState();
      vi.setSystemTime(Date.now() + cacheTime);

      if (rejects) first.reject(new Error('old request'));
      else first.resolve('old data');
      await flushMacrotask();
      expect(store.getState().getData()).toBe('new data');
      expect(store.getState().queryKey).toBe(completedState.queryKey);
      expect(store.getState().lastFetchedAt).toBe(completedState.lastFetchedAt);
      expect(store.getState().status).toBe('success');
      expect(store.getState().error).toBeNull();
      expect(store.getState().getData({ id: 'a' })).toBe(rejects ? null : 'old data');
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('cancels a scheduled retry when the last subscriber leaves after failure publication', async () => {
    vi.useFakeTimers();

    const error = new Error('request failed');
    const fetcher = vi.fn(() => Promise.reject(error));
    const onError = vi.fn();
    const store = createQueryStore({ fetcher, onError, staleTime: Infinity, retry: 1, retryDelay: 25 });
    const unsubscribe = store.subscribe(() => {});

    try {
      expect(await store.getState().fetch()).toBeNull();
      expect(store.getState()).toMatchObject({ status: 'error', error });
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error, willRetry: true }));
      expect(vi.getTimerCount()).toBe(1);

      unsubscribe();
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(25);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(store.getState()).toMatchObject({ status: 'error', error });
    } finally {
      store.getState().reset();
    }
  });

  it('retains a synchronous failure across immediate unsubscribe', async () => {
    const onError = vi.fn();
    const store = createQueryStore({
      retry: false,
      onError,
      fetcher: () => {
        throw new Error('failed synchronously');
      },
    });
    const unsubscribe = store.subscribe(() => {});

    try {
      unsubscribe();
      await flushMacrotask();
      expect(onError).toHaveBeenCalledOnce();
      expect(store.getState().status).toBe('error');
    } finally {
      store.getState().reset();
    }
  });

  it('does not install a retry after an error listener starts a replacement', async () => {
    vi.useFakeTimers();
    const second = deferred<string>();
    const onError = vi.fn();
    const fetcher = vi.fn(({ id }: { id: string }) => {
      if (id === 'a') throw new Error('a failed');
      return second.promise;
    });
    const store = createQueryStore({
      params: { id: 'a' },
      fetcher,
      staleTime: Infinity,
      retry: 1,
      onError,
      retryDelay: 50,
    });
    const unsubscribe = store.subscribe(state => {
      if (state.status === 'error') {
        void store.getState().fetch({ id: 'b' }, { force: true, updateQueryKey: true });
      }
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['a', 'b']);
      expect(store.getState().status).toBe('loading');
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ willRetry: false }));
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });
});

describe('query completion callbacks', () => {
  it.each(['subscriber', 'onFetched'] as const)('selects published background data through %s', async phase => {
    let selected: Promise<string | null> | undefined;
    let selecting = false;
    const fetcher = vi.fn(({ id }: { id: string }) => id);
    const store = createQueryStore<string, { id: string }>({
      params: { id: 'b' },
      fetcher,
      staleTime: Infinity,
      onFetched:
        phase === 'onFetched'
          ? ({ fetch, params }) => {
              if (params.id === 'a' && !selecting) {
                selecting = true;
                selected = fetch(params, { updateQueryKey: true });
              }
            }
          : undefined,
    });
    await store.getState().fetch();
    const unsubscribe =
      phase === 'subscriber'
        ? store.subscribe(state => {
            if (!selecting && state.getData({ id: 'a' }) === 'a') {
              selecting = true;
              selected = state.fetch({ id: 'a' }, { updateQueryKey: true });
            }
          })
        : undefined;

    try {
      expect(await store.getState().fetch({ id: 'a' })).toBe('a');
      expect(await selected).toBe('a');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'a' }), status: 'success', error: null });
      expect(store.getState().getData()).toBe('a');
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });

  it.each([false, true])('keeps forced onFetched replacement and its timer, background=%s', async background => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const replacementResponse = deferred<string>();
    let replacementFetch: Promise<string | null> | undefined;
    let aCalls = 0;
    const fetcher = vi.fn(({ id }: { id: string }) => {
      if (id === 'b') return 'b';
      aCalls++;
      if (aCalls === 1) return 'a1';
      if (aCalls === 2) return replacementResponse.promise;
      return 'a3';
    });
    const store = createQueryStore<string, { id: string }>({
      params: { id: background ? 'b' : 'a' },
      fetcher,
      staleTime: 100,
      onFetched: ({ data, fetch }) => {
        if (data === 'a1') replacementFetch = fetch({ id: 'a' }, { force: true, updateQueryKey: true });
      },
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      if (background) await store.getState().fetch();
      const first = store.getState().fetch({ id: 'a' });
      expect(await first).toBe('a1');
      expect(aCalls).toBe(2);
      expect(store.getState().status).toBe('loading');

      await vi.advanceTimersByTimeAsync(50);
      replacementResponse.resolve('a2');
      expect(await replacementFetch).toBe('a2');
      expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'a' }), status: 'success', lastFetchedAt: 1050 });

      await vi.advanceTimersByTimeAsync(99);
      expect(aCalls).toBe(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(aCalls).toBe(3);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each(['subscriber', 'onError'] as const)('selects a published historical error through %s', async phase => {
    const failure = deferred<string>();
    const error = new Error('refresh failed');
    let aCalls = 0;
    let selecting = false;
    let selected: Promise<string | null> | undefined;
    const fetcher = vi.fn(({ id }: { id: string }) => {
      if (id === 'b') return 'b';
      return ++aCalls === 1 ? 'a0' : failure.promise;
    });
    const store = createQueryStore<string, { id: string }>({
      params: { id: 'a' },
      fetcher,
      staleTime: Infinity,
      abortInterruptedFetches: false,
      retry: false,
      onError:
        phase === 'onError'
          ? () => {
              selecting = true;
              selected = store.getState().fetch({ id: 'a' }, { updateQueryKey: true });
            }
          : undefined,
    });
    await store.getState().fetch();
    const unsubscribe =
      phase === 'subscriber'
        ? store.subscribe(state => {
            if (!selecting && state.getCacheEntry({ id: 'a' })?.errorInfo) {
              selecting = true;
              selected = state.fetch({ id: 'a' }, { updateQueryKey: true });
            }
          })
        : undefined;

    try {
      const refresh = store.getState().fetch({ id: 'a' }, { force: true });
      await store.getState().fetch({ id: 'b' }, { updateQueryKey: true });
      failure.reject(error);
      expect(await refresh).toBeNull();
      expect(await selected).toBe('a0');
      expect(aCalls).toBe(2);
      expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'a' }), status: 'error', error });
      expect(store.getState().getData()).toBe('a0');
      expect(store.getState().getStatus('isError')).toBe(true);
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });

  it('lets onError replace failed work and cancel its scheduled retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const failure = deferred<string>();
    const replacementResponse = deferred<string>();
    let replacement: Promise<string | null> | undefined;
    const fetcher = vi
      .fn<() => string | Promise<string>>()
      .mockReturnValueOnce('seed')
      .mockReturnValueOnce(failure.promise)
      .mockReturnValueOnce(replacementResponse.promise)
      .mockReturnValue('later');
    const store = createQueryStore({
      fetcher,
      staleTime: 100,
      retry: 1,
      retryDelay: 10,
      onError: () => {
        replacement = store.getState().fetch(undefined, { force: true });
      },
    });
    const unsubscribe = store.subscribe(() => undefined);

    try {
      await store.getState().fetch();
      const refresh = store.getState().fetch(undefined, { force: true });
      failure.reject(new Error('failed'));
      expect(await refresh).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(store.getState().status).toBe('loading');

      await vi.advanceTimersByTimeAsync(20);
      expect(fetcher).toHaveBeenCalledTimes(3);

      replacementResponse.resolve('replacement');
      expect(await replacement).toBe('replacement');
      expect(store.getState()).toMatchObject({ status: 'success', lastFetchedAt: 1020, error: null });

      await vi.advanceTimersByTimeAsync(99);
      expect(fetcher).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });
});

describe('custom query result publication', () => {
  it('does not publish when an uncached independent result submits no update', async () => {
    const setData = vi.fn();
    const listener = vi.fn();
    const store = createQueryStore({ enabled: false, disableCache: true, fetcher: () => null, setData });
    const unsubscribe = store.subscribe(listener);
    const state = store.getState();

    try {
      expect(await state.fetch(undefined, { skipStoreUpdates: 'withCache' })).toBeNull();
      expect(setData).toHaveBeenCalledOnce();
      expect(store.getState()).toBe(state);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])('preserves atomic custom composition and synced publication, fails=%s', async fails => {
    const publish = vi.fn<(update: SyncUpdate<Record<string, unknown>>) => void>();
    const engine: SyncEngine = { sessionId: 'local', register: () => ({ destroy() {}, publish }) };
    const snapshots: Array<{ total: number }> = [];
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const store = createQueryStore<number, Record<string, never>, { total: number; note: string }>(
      {
        enabled: false,
        staleTime: Infinity,
        retry: false,
        fetcher: () => 1,
        setData: ({ set }) => {
          set({ total: 1 });
          set(state => {
            snapshots.push(state);
            return { total: state.total + 1 };
          });
          set(state => {
            snapshots.push(state);
            return { ...state, total: state.total + 1 };
          });
          if (fails) throw new Error('callback failed');
        },
      },
      () => ({ total: 0, note: 'initial' }),
      { sync: { key: 'composition', engine, fields: ['total', 'note'] } }
    );
    const unsubscribe = store.subscribe(() => {});

    try {
      expect(await store.getState().fetch(undefined, { force: true })).toBe(fails ? null : 1);
      expect(snapshots.map(state => state.total)).toEqual([1, 2]);
      expect(store.getState()).toMatchObject({ total: fails ? 0 : 3, note: 'initial', status: fails ? 'error' : 'success' });
      expect(publish.mock.calls.map(([update]) => update.values)).toEqual(fails ? [] : [{ total: 3 }]);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])(
    'publishes custom data atomically before a subscriber starts a replacement, disableCache=%s',
    async disableCache => {
      const replacementResponse = deferred<string>();
      let calls = 0;
      let replacement: Promise<string | null> | undefined;
      let startedReplacement = false;
      const store = createQueryStore<string, Record<string, never>, { values: string[]; count: number }>(
        {
          disableCache,
          staleTime: Infinity,
          fetcher: () => (++calls === 1 ? 'first' : replacementResponse.promise),
          setData: ({ data, set }) => {
            set(state => ({ values: [...state.values, data] }));
            set(state => ({ count: state.values.length }));
          },
        },
        () => ({ values: [], count: 0 })
      );
      const observations: Array<{ count: number; length: number }> = [];
      const unsubscribe = store.subscribe(state => {
        observations.push({ count: state.count, length: state.values.length });
        if (state.count === 1 && state.status === 'success' && !startedReplacement) {
          startedReplacement = true;
          replacement = state.fetch(undefined, { force: true });
        }
      });

      try {
        expect(await store.getState().fetch()).toBe('first');
        expect(calls).toBe(2);
        expect(store.getState()).toMatchObject({ values: ['first'], count: 1, status: 'loading' });

        replacementResponse.resolve('second');
        expect(await replacement).toBe('second');
        expect(store.getState()).toMatchObject({ values: ['first', 'second'], count: 2, status: 'success' });
        expect(store.getState().isStale()).toBe(false);
        expect(observations).toContainEqual({ count: 2, length: 2 });
        expect(observations.every(({ count, length }) => count === length)).toBe(true);
      } finally {
        unsubscribe();
        store.getState().reset();
      }
    }
  );
});
