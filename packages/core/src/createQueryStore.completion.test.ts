import { deferred, flushMacrotask } from './async.testUtils';
import { createQueryStore, getQueryKey } from './createQueryStore';
import { createBaseStore } from './createBaseStore';

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
});
