import { flushMacrotask, flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createQueryStore } from './createQueryStore';

describe('query completion ownership', () => {
  it.each([false, true])('keeps the replacement pending when the old fetch rejects=%s', async rejects => {
    const source = createBaseStore(() => ({ id: 'a' }));
    const first = deferred<string>();
    const second = deferred<string>();
    const onFetched = vi.fn();
    const onError = vi.fn();
    const retry = vi.fn(() => false);
    const store = createQueryStore<string, { id: string }>({
      params: { id: $ => $(source).id },
      fetcher: ({ id }) => (id === 'a' ? first.promise : second.promise),
      staleTime: Infinity,
      onFetched,
      onError,
      retry,
    });

    const unsubscribe = store.subscribe(() => {});
    const firstRead = store.getState().fetch();

    try {
      if (rejects) first.reject(new Error('old request'));
      else first.resolve('old data');
      await Promise.resolve();
      source.setState({ id: 'b' });
      await flushMacrotask();

      expect(await firstRead).toBe(rejects ? null : 'old data');
      expect(store.getState().getStatus('isLoading')).toBe(true);
      expect(store.getState().getData({ id: 'a' })).toBe(rejects ? null : 'old data');
      expect(store.getState().error).toBeNull();
      expect(onFetched).toHaveBeenCalledTimes(rejects ? 0 : 1);
      expect(onError).toHaveBeenCalledTimes(rejects ? 1 : 0);
      expect(retry).toHaveBeenCalledTimes(rejects ? 1 : 0);

      if (rejects) {
        expect(onError).toHaveBeenCalledWith(expect.objectContaining({ params: { id: 'a' }, willRetry: false }));
        expect(store.getState().getCacheEntry({ id: 'a' })?.errorInfo?.error.message).toBe('old request');
      }

      second.resolve('new data');
      await flushMacrotask();
      expect(store.getState().getData()).toBe('new data');
      expect(onFetched).toHaveBeenCalledTimes(rejects ? 1 : 2);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('preserves completion when interruption is disabled', async () => {
    const source = createBaseStore(() => ({ id: 'a' }));
    const first = deferred<string>();
    const second = deferred<string>();
    const onFetched = vi.fn();
    const store = createQueryStore<string, { id: string }>({
      abortInterruptedFetches: false,
      params: { id: $ => $(source).id },
      fetcher: ({ id }) => (id === 'a' ? first.promise : second.promise),
      staleTime: Infinity,
      onFetched,
    });

    const unsubscribe = store.subscribe(() => {});
    const firstRead = store.getState().fetch();

    try {
      first.resolve('old data');
      await Promise.resolve();
      source.setState({ id: 'b' });
      expect(await firstRead).toBe('old data');
      expect(store.getState().getData({ id: 'a' })).toBe('old data');
      expect(onFetched).toHaveBeenCalledOnce();

      second.resolve('new data');
      await flushMacrotask();
      expect(store.getState().getData()).toBe('new data');
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
      vi.useRealTimers();
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
      expect(state.getCacheEntry()).toBe(keepPreviousData ? selectedEntry : null);
      expect(state.getData()).toBe(keepPreviousData ? 'data-primary' : null);
      expect(state.getCacheEntry({ id: 'unused' })).toBeNull();
      expect(state.getData({ id: 'other' })).toBe('data-other');

      await state.fetch({ id: 'replacement' }, { updateQueryKey: true });
      expect(store.getState().getData()).toBe('data-replacement');
      expect(store.getState().getCacheEntry({ id: 'primary' })).toBeNull();
    } finally {
      store.getState().reset();
      vi.useRealTimers();
    }
  });

  it.each([false, true])('does not schedule an obsolete refetch or retry when rejects=%s', async rejects => {
    vi.useFakeTimers();
    const source = createBaseStore(() => ({ id: 'a' }));
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'a' ? first.promise : second.promise));
    const store = createQueryStore({
      params: { id: $ => $(source).id },
      fetcher,
      staleTime: 50,
      retry: 1,
      retryDelay: 50,
    });

    const unsubscribe = store.subscribe(() => {});

    try {
      if (rejects) first.reject(new Error('old request'));
      else first.resolve('old data');
      await Promise.resolve();
      source.setState({ id: 'b' });
      await flushMicrotasks(6);
      await vi.advanceTimersByTimeAsync(100);

      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['a', 'b']);
      expect(store.getState().getStatus('isLoading')).toBe(true);
    } finally {
      unsubscribe();
      store.getState().reset();
      vi.useRealTimers();
    }
  });

  it('distinguishes a same-key replacement from the completed read', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = createQueryStore({ fetcher, staleTime: Infinity });
    const unsubscribeFirst = store.subscribe(() => {});
    first.resolve('old data');
    await Promise.resolve();
    unsubscribeFirst();
    const unsubscribeSecond = store.subscribe(() => {});

    try {
      await flushMacrotask();
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(store.getState().getData()).toBe('old data');
      expect(store.getState().getStatus('isLoading')).toBe(true);

      second.resolve('new data');
      await flushMacrotask();
      expect(store.getState().getData()).toBe('new data');
      expect(store.getState().getStatus('isLoading')).toBe(false);
    } finally {
      unsubscribeSecond();
      store.getState().reset();
    }
  });

  it.each([true, 'withCache'] as const)('preserves independent reads with skipStoreUpdates=%s', async skipStoreUpdates => {
    const request = deferred<string>();
    const store = createQueryStore({ params: { id: 'a' }, fetcher: () => request.promise, staleTime: Infinity });
    const read = store.getState().fetch({ id: 'b' }, { skipStoreUpdates });

    try {
      request.resolve('parallel data');
      await Promise.resolve();
      store.setState({ enabled: false });
      expect(await read).toBe('parallel data');
      expect(store.getState().getData({ id: 'b' })).toBe(skipStoreUpdates === 'withCache' ? 'parallel data' : null);
    } finally {
      store.getState().reset();
    }
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, resolve, reject };
}
