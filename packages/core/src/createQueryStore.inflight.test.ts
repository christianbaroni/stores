import { deferred, flushMacrotask } from './async.testUtils';
import { createQueryStore, getQueryKey } from './createQueryStore';
import { createBaseStore } from './createBaseStore';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sharing pending queries', () => {
  it.each([false, true])('reuses a pending request when its key is selected again, fails=%s', async fails => {
    const a = deferred<string>();
    const b = deferred<string>();
    const source = createBaseStore(() => ({ id: 'a' }));
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'a' ? a.promise : b.promise));
    const transform = vi.fn((data: string) => data);
    const onFetched = vi.fn();
    const store = createQueryStore({
      params: { id: $ => $(source).id },
      fetcher,
      transform,
      onFetched,
      abortInterruptedFetches: false,
      retry: false,
      staleTime: Infinity,
    });
    const unsubscribe = store.subscribe(() => {});
    const first = store.getState().fetch();

    try {
      source.setState({ id: 'b' });
      await flushMacrotask();
      const middle = store.getState().fetch({ id: 'b' });
      source.setState({ id: 'a' });
      await flushMacrotask();
      const again = store.getState().fetch();
      expect(fetcher.mock.calls.map(([params]) => params.id)).toEqual(['a', 'b']);

      b.resolve('b');
      expect(await middle).toBe('b');
      expect(store.getState().status).toBe('loading');

      const error = new Error('a failed');
      if (fails) a.reject(error);
      else a.resolve('a');
      expect(await first).toBe(fails ? null : 'a');
      expect(await again).toBe(fails ? null : 'a');
      expect(store.getState()).toMatchObject({
        status: fails ? 'error' : 'success',
        error: fails ? error : null,
        queryKey: getQueryKey({ id: 'a' }),
      });
      expect(store.getState().getStatus()).toMatchObject({ isError: fails, isSuccess: !fails });
      expect(store.getState().getData()).toBe(fails ? null : 'a');
      expect(store.getState().getData({ id: 'b' })).toBe('b');
      expect(onFetched).toHaveBeenCalledTimes(fails ? 1 : 2);
      expect(transform).toHaveBeenCalledTimes(fails ? 1 : 2);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])('promotes background success/failure into selected metadata, fails=%s', async fails => {
    const a = deferred<string>();
    const fetcher = vi.fn(() => a.promise);
    const onFetched = vi.fn();
    const onError = vi.fn();
    const store = createQueryStore<string, { id: string }>({
      params: { id: 'b' },
      fetcher,
      onFetched,
      onError,
      retry: false,
      staleTime: Infinity,
    });

    try {
      const background = store.getState().fetch({ id: 'a' });
      const selected = store.getState().fetch({ id: 'a' }, { updateQueryKey: true });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.getState().status).toBe('loading');

      const error = new Error('a failed');
      if (fails) a.reject(error);
      else a.resolve('a');
      expect(await background).toBe(fails ? null : 'a');
      expect(await selected).toBe(fails ? null : 'a');
      expect(store.getState()).toMatchObject({
        queryKey: getQueryKey({ id: 'a' }),
        status: fails ? 'error' : 'success',
        error: fails ? error : null,
      });
      expect(store.getState().getStatus('isError')).toBe(fails);
      expect(onFetched).toHaveBeenCalledTimes(fails ? 0 : 1);
      expect(onError).toHaveBeenCalledTimes(fails ? 1 : 0);
    } finally {
      store.getState().reset();
    }
  });

  it('retries an internally selected background request once', async () => {
    vi.useFakeTimers();
    const source = createBaseStore(() => ({ id: 'b' }));
    const a = deferred<string>();
    let aCalls = 0;
    const onError = vi.fn();
    const fetcher = vi.fn(({ id }: { id: string }) => {
      if (id === 'b') return 'b';
      return ++aCalls === 1 ? a.promise : 'recovered';
    });
    const store = createQueryStore({
      params: { id: $ => $(source).id },
      fetcher,
      onError,
      retry: 1,
      retryDelay: 20,
      staleTime: Infinity,
    });
    const background = store.getState().fetch({ id: 'a' });
    const unsubscribe = store.subscribe(() => {});

    try {
      await vi.advanceTimersByTimeAsync(0);
      source.setState({ id: 'a' });
      await vi.advanceTimersByTimeAsync(0);
      expect(aCalls).toBe(1);

      a.reject(new Error('temporary'));
      expect(await background).toBeNull();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0]).toMatchObject({ willRetry: true, retryCount: 0 });

      await vi.advanceTimersByTimeAsync(20);
      expect(aCalls).toBe(2);
      expect(store.getState().getData()).toBe('recovered');
      expect(store.getState().status).toBe('success');
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([
    [false, true, false],
    [true, false, false],
    [false, true, true],
    [true, false, true],
  ])('honors each joining caller throw policy, first=%s second=%s background=%s', async (firstThrows, secondThrows, background) => {
    const a = deferred<string>();
    const fetcher = vi.fn(() => a.promise);
    const store = createQueryStore<string, { id: string }>({
      params: { id: background ? 'b' : 'a' },
      fetcher,
      retry: false,
      staleTime: Infinity,
    });
    const outcome = (promise: Promise<string | null>) =>
      promise.then(
        value => ({ value }),
        error => ({ error })
      );

    try {
      const first = outcome(store.getState().fetch({ id: 'a' }, { throwOnError: firstThrows }));
      const second = outcome(store.getState().fetch({ id: 'a' }, { throwOnError: secondThrows, updateQueryKey: true }));
      const error = new Error('failure');
      a.reject(error);
      expect(await first).toEqual(firstThrows ? { error } : { value: null });
      expect(await second).toEqual(secondThrows ? { error } : { value: null });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      store.getState().reset();
    }
  });

  it('contains an internal join rejection independently of the original throwing caller', async () => {
    const source = createBaseStore(() => ({ id: 'b' }));
    const a = deferred<string>();
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'a' ? a.promise : 'b'));
    const store = createQueryStore({ params: { id: $ => $(source).id }, fetcher, retry: false, staleTime: Infinity });
    const first = store
      .getState()
      .fetch({ id: 'a' }, { throwOnError: true })
      .then(
        value => ({ value }),
        error => ({ error })
      );
    const unsubscribe = store.subscribe(() => {});

    try {
      await flushMacrotask();
      source.setState({ id: 'a' });
      await flushMacrotask();
      const error = new Error('failure');
      a.reject(error);
      expect(await first).toEqual({ error });

      await flushMacrotask();
      expect(fetcher.mock.calls.filter(([params]) => params.id === 'a')).toHaveLength(1);
      expect(store.getState().error).toBe(error);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('joins an ongoing forced refresh even while its previous cache entry is fresh', async () => {
    const next = deferred<string>();
    let calls = 0;
    const store = createQueryStore({ fetcher: () => (++calls === 1 ? 'old' : next.promise), staleTime: Infinity });

    try {
      expect(await store.getState().fetch()).toBe('old');

      const refresh = store.getState().fetch(undefined, { force: true });
      const joined = store.getState().fetch();
      next.resolve('new');
      expect(await refresh).toBe('new');
      expect(await joined).toBe('new');
      expect(calls).toBe(2);
    } finally {
      store.getState().reset();
    }
  });
});

describe('independent query reads', () => {
  it.each([true, 'withCache'] as const)('preserves independent reads with skipStoreUpdates=%s', async skipStoreUpdates => {
    const request = deferred<string>();
    const store = createQueryStore({ params: { id: 'a' }, fetcher: () => request.promise, staleTime: Infinity });
    const read = store.getState().fetch({ id: 'b' }, { skipStoreUpdates });

    try {
      store.setState({ enabled: false });
      request.resolve('parallel data');
      expect(await read).toBe('parallel data');
      expect(store.getState().getData({ id: 'b' })).toBe(skipStoreUpdates === 'withCache' ? 'parallel data' : null);
    } finally {
      store.getState().reset();
    }
  });

  it.each([true, 'withCache'] as const)('runs same-key skipStoreUpdates=%s independently', async skipStoreUpdates => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = createQueryStore({ fetcher, staleTime: Infinity });

    try {
      const original = store.getState().fetch();
      const independent = store.getState().fetch(undefined, { force: true, skipStoreUpdates });
      expect(fetcher).toHaveBeenCalledTimes(2);

      second.resolve('independent');
      expect(await independent).toBe('independent');
      expect(store.getState().status).toBe('loading');

      first.resolve('original');
      expect(await original).toBe('original');
      expect(store.getState().getData()).toBe('original');
    } finally {
      store.getState().reset();
    }
  });
});

describe('selection during query notifications', () => {
  it.each([false, true])('keeps a request admitted by a loading listener in control, abort=%s', async abortInterruptedFetches => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi.fn(({ id }: { id: string }) => (id === 'a' ? first.promise : second.promise));
    const store = createQueryStore({ enabled: false, params: { id: 'a' }, fetcher, abortInterruptedFetches, staleTime: Infinity });
    let replacement: Promise<string | null> | undefined;
    const unsubscribe = store.subscribe(state => {
      if (state.status === 'loading' && !replacement) {
        replacement = state.fetch({ id: 'b' }, { force: true, updateQueryKey: true });
      }
    });

    try {
      const original = store.getState().fetch(undefined, { force: true });
      first.resolve('a');
      expect(await original).toBe(abortInterruptedFetches ? null : 'a');
      expect(fetcher.mock.calls.map(([params]) => params.id).sort()).toEqual(abortInterruptedFetches ? ['b'] : ['a', 'b']);
      expect(store.getState().status).toBe('loading');

      second.resolve('b');
      expect(await replacement).toBe('b');
      expect(store.getState().getData()).toBe('b');
      expect(store.getState().status).toBe('success');
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it.each([false, true])(
    'reuses or replaces the previous request when a cache-selection listener selects it again, abort=%s',
    async abortInterruptedFetches => {
      const firstA = deferred<string>();
      const secondA = deferred<string>();
      let aCalls = 0;
      let selectedFetch: Promise<string | null> | undefined;
      let selectedAgain = false;
      const fetcher = vi.fn(({ id }: { id: string }) => {
        if (id === 'b') return 'cached b';
        return ++aCalls === 1 ? firstA.promise : secondA.promise;
      });
      const store = createQueryStore({ params: { id: 'a' }, fetcher, abortInterruptedFetches, staleTime: Infinity });
      await store.getState().fetch({ id: 'b' }, { skipStoreUpdates: 'withCache' });
      const first = store.getState().fetch();
      const unsubscribe = store.subscribe(state => {
        if (selectedAgain || state.status !== 'success' || state.queryKey !== getQueryKey({ id: 'b' })) return;
        selectedAgain = true;
        selectedFetch = state.fetch({ id: 'a' }, { force: true, updateQueryKey: true });
      });

      try {
        expect(await store.getState().fetch({ id: 'b' }, { updateQueryKey: true })).toBe('cached b');
        expect(aCalls).toBe(abortInterruptedFetches ? 2 : 1);

        firstA.resolve('first a');
        secondA.resolve('second a');
        expect(await first).toBe(abortInterruptedFetches ? null : 'first a');
        expect(await selectedFetch).toBe(abortInterruptedFetches ? 'second a' : 'first a');
        expect(store.getState().getData()).toBe(abortInterruptedFetches ? 'second a' : 'first a');
        expect(store.getState()).toMatchObject({ queryKey: getQueryKey({ id: 'a' }), status: 'success', error: null });
      } finally {
        unsubscribe();
        store.getState().reset();
      }
    }
  );

  it('does not reuse a cancelled request', async () => {
    const response = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(response.promise).mockReturnValue('replacement');
    const store = createQueryStore({ fetcher, staleTime: Infinity });

    try {
      const first = store.getState().fetch();
      store.setState({ enabled: false });
      const second = store.getState().fetch(undefined, { force: true });
      expect(await first).toBeNull();
      expect(await second).toBe('replacement');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      store.getState().reset();
    }
  });

  it.each([false, true])('withdraws a request whose loading listener throws, abort=%s', async abortInterruptedFetches => {
    const error = new Error('listener failed');
    const fetcher = vi.fn(() => 'data');
    const store = createQueryStore({ enabled: false, fetcher, abortInterruptedFetches, staleTime: Infinity });
    const unsubscribe = store.subscribe(state => {
      if (state.status === 'loading') throw error;
    });

    try {
      await expect(store.getState().fetch(undefined, { force: true })).rejects.toBe(error);
      expect(fetcher).not.toHaveBeenCalled();

      unsubscribe();
      expect(await store.getState().fetch(undefined, { force: true })).toBe('data');
      expect(fetcher).toHaveBeenCalledOnce();
      expect(store.getState().status).toBe('success');
    } finally {
      store.getState().reset();
    }
  });
});
