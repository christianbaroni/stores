import { deferred, flushMacrotask, flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';
import { createQueryStore, getQueryKey } from './createQueryStore';
import { subscribeCascadeState } from './internal/cascadeSubscriptions';
import { createSyncStorageMock } from './internal/storage/storageMocks.testUtils';
import { logger } from './internal/logger';
import type { SyncEngine } from './sync/types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('query initialization', () => {
  it('does not overwrite enabled changes received during initialization', async () => {
    const register = vi.fn<SyncEngine['register']>(() => ({
      destroy: () => {},
      publish: () => {},
      onFirstSubscribe: () => {
        register.mock.calls[0][0].apply({
          replace: false,
          sessionId: 'remote',
          timestamp: Date.now() + 1,
          values: { isSignedIn: false },
        });
      },
    }));
    const authStore = createBaseStore(() => ({ isSignedIn: true }), {
      sync: { key: 'reactive-enabled', engine: { sessionId: 'local', register } },
    });
    const fetcher = vi.fn(async () => 'data');
    const store = createQueryStore<string>({
      enabled: $ => $(authStore, state => state.isSignedIn),
      fetcher,
      staleTime: Infinity,
    });
    expect(store.getState().enabled).toBe(false);

    const unsubscribe = store.subscribe(() => {});

    try {
      await flushMicrotasks();
      expect(store.getState().enabled).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('does not persist enabled again after a dependency enables the query during subscription', () => {
    const register = vi.fn<SyncEngine['register']>(() => ({
      destroy: () => {},
      publish: () => {},
      onFirstSubscribe: () => {
        register.mock.calls[0][0].apply({
          replace: false,
          sessionId: 'remote',
          timestamp: Date.now() + 1,
          values: { isSignedIn: true },
        });
      },
    }));
    const authStore = createBaseStore(() => ({ isSignedIn: false }), {
      sync: { key: 'persisted-enabled', engine: { sessionId: 'local', register } },
    });
    const storage = createSyncStorageMock();
    // Restore the current key to isolate enabled initialization from query-key updates.
    storage.get.mockReturnValue(JSON.stringify({ state: { queryKey: getQueryKey({}) } }));
    const fetcher = vi.fn(async () => 'data');
    const store = createQueryStore<string>(
      { enabled: $ => $(authStore, state => state.isSignedIn), fetcher, staleTime: Infinity },
      { storage, storageKey: 'query', persistThrottleMs: 0 }
    );

    try {
      expect(store.getState().enabled).toBe(true);
      expect(storage.set).toHaveBeenCalledTimes(1);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      store.getState().reset();
    }
  });

  it('enables a dependent query when subscribing restores its parent from cache', async () => {
    const pendingResponse = deferred<string>();
    const parent = createQueryStore({
      params: { id: 'a' },
      fetcher: ({ id }) => (id === 'a' ? 'cached data' : pendingResponse.promise),
      staleTime: Infinity,
    });

    await parent.getState().fetch();
    const pendingFetch = parent.getState().fetch({ id: 'b' }, { updateQueryKey: true });
    expect(parent.getState().status).toBe('loading');

    const fetcher = vi.fn(() => 'child data');
    const child = createQueryStore({
      enabled: $ => $(parent).status === 'success',
      fetcher,
      staleTime: Infinity,
    });
    const unsubscribe = child.subscribe(() => {});

    try {
      expect(parent.getState().status).toBe('success');
      expect(child.getState().enabled).toBe(true);

      await flushMacrotask();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(child.getState().getData()).toBe('child data');
    } finally {
      unsubscribe();
      child.getState().reset();
      parent.getState().reset();
      pendingResponse.resolve('unused result');
      await pendingFetch;
    }
  });

  it('keeps the latest parameters when reading a lazy dependency starts synchronization', async () => {
    const connection = createBaseStore(() => ({ connecting: false }));
    const sourceChoice = createBaseStore(() => false);
    const version = createBaseStore(() => 0);
    const initialSource = createBaseStore(() => ({ value: 7 }));
    const engine: SyncEngine = {
      sessionId: 'local',
      register: () => ({
        destroy: () => {},
        publish: null,
        onFirstSubscribe: () => connection.setState({ connecting: true }),
      }),
    };
    const replacementSource = createBaseStore(() => ({ value: 7 }), { sync: { key: 'replacement', engine } });
    const derived = createDerivedStore($ => $($(sourceChoice) ? replacementSource : initialSource).value);
    const fetcher = vi.fn(({ summary }: { summary: string }) => summary);
    const store = createQueryStore({
      fetcher,
      staleTime: Infinity,
      params: {
        summary: $ => {
          const currentVersion = $(version);
          const connecting = $(connection).connecting;
          return `${currentVersion}:${connecting}:${$(derived)}`;
        },
      },
    });
    const unsubscribe = store.subscribe(() => {});

    try {
      await flushMacrotask();
      expect(fetcher.mock.calls.map(([params]) => params.summary)).toEqual(['0:false:7']);

      // Reading the pending derived value starts sync while the parameter expression is still evaluating.
      sourceChoice.setState(true);
      version.setState(1);
      await flushMacrotask();
      expect(fetcher.mock.calls.map(([params]) => params.summary)).toEqual(['0:false:7', '1:true:7']);
    } finally {
      unsubscribe();
      store.getState().reset();
      derived.destroy();
    }
  });
});

describe('query enablement and cancellation', () => {
  it.each(['raw', 'selected', 'cascade'] as const)('releases %s subscription demand only once', async lane => {
    const response = deferred<string>();
    const fetcher = vi.fn((_params: Record<string, never>, _controller: AbortController | null) => response.promise);
    const store = createQueryStore({ enabled: false, fetcher, staleTime: Infinity });
    const unsubscribe =
      lane === 'cascade'
        ? subscribeCascadeState(store, () => {})
        : lane === 'selected'
          ? store.subscribe(
              state => state.status,
              () => {}
            )
          : store.subscribe(() => {});
    const otherUnsubscribe = store.subscribe(() => {});

    try {
      const pending = store.getState().fetch(undefined, { force: true });
      const controller = fetcher.mock.calls[0][1];

      unsubscribe();
      unsubscribe();
      expect(controller?.signal.aborted).toBe(false);

      otherUnsubscribe();
      expect(controller?.signal.aborted).toBe(true);
      await expect(pending).resolves.toBeNull();
    } finally {
      unsubscribe();
      otherUnsubscribe();
      store.getState().reset();
      response.resolve('unused');
    }
  });

  it.each(['selector', 'immediate listener'])('refunds subscription demand when the %s throws', async phase => {
    const error = new Error('subscription failed');
    const fetcher = vi.fn(() => 'data');
    const store = createQueryStore({ enabled: false, fetcher, staleTime: Infinity });

    try {
      expect(() =>
        store.subscribe(
          state => {
            if (phase === 'selector') throw error;
            return state.status;
          },
          () => {
            throw error;
          },
          { fireImmediately: true }
        )
      ).toThrow(error);

      store.setState({ enabled: true });
      await flushMacrotask();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      store.getState().reset();
    }
  });

  it('handles remote query enablement without counting its internal subscription as demand', async () => {
    const response = deferred<number>();
    const onFirstSubscribe = vi.fn();
    const onLastUnsubscribe = vi.fn();
    const register = vi.fn<SyncEngine['register']>(() => ({
      destroy: () => {},
      publish: () => {},
      onFirstSubscribe,
      onLastUnsubscribe,
    }));
    const engine: SyncEngine = { sessionId: 'local', register };
    const fetcher = vi.fn((_params: Record<string, never>, _controller?: AbortController | null) => response.promise);
    const store = createQueryStore(
      { enabled: false, fetcher, staleTime: Infinity },
      { sync: { key: 'remote-enabled', engine, fields: ['enabled'] } }
    );
    const apply = register.mock.calls[0][0].apply;
    expect(onFirstSubscribe).not.toHaveBeenCalled();

    const unsubscribe = store.subscribe(() => {});

    try {
      expect(onFirstSubscribe).toHaveBeenCalledOnce();

      apply({ replace: false, sessionId: 'remote', timestamp: 1, values: { enabled: true } });
      await flushMicrotasks(5);
      expect(fetcher).toHaveBeenCalledOnce();

      const controller = fetcher.mock.calls[0][1];
      expect(controller?.signal.aborted).toBe(false);

      apply({ replace: false, sessionId: 'remote', timestamp: 2, values: { enabled: false } });
      expect(controller?.signal.aborted).toBe(true);
    } finally {
      unsubscribe();
      store.getState().reset();
    }

    await flushMicrotasks();
    expect(onLastUnsubscribe).toHaveBeenCalledOnce();
  });

  it('preserves cascade batching across consecutive custom state updates', async () => {
    const store = createQueryStore<number, Record<string, never>, { count: number }>({ enabled: false, fetcher: () => 1 }, () => ({
      count: 0,
    }));
    const derived = createDerivedStore($ => $(store).count);
    const values: number[] = [];
    const unsubscribe = derived.subscribe(value => values.push(value));

    try {
      store.setState({ count: 1 });
      store.setState({ count: 2 });
      expect(values).toEqual([]);

      await flushMacrotask();
      expect(values).toEqual([2]);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('settles derived params before fetching on enable when another query task is already queued', async () => {
    const firstSource = createBaseStore(() => ({ id: 0 }));
    const secondSource = createBaseStore(() => ({ id: 0 }));
    const firstDerived = createDerivedStore($ => $(firstSource).id);
    const secondDerived = createDerivedStore($ => $(secondSource).id);
    const first = createQueryStore<number, { id: number }>({
      params: { id: $ => $(firstDerived) },
      fetcher: ({ id }) => id,
      staleTime: Infinity,
    });
    const fetched: number[] = [];
    const second = createQueryStore<number, { id: number }>({
      enabled: $ => $(secondSource).id > 0,
      params: { id: $ => $(secondDerived) },
      fetcher: ({ id }) => {
        fetched.push(id);
        return id;
      },
      staleTime: Infinity,
    });
    const consumer = createDerivedStore($ => $(second).enabled);
    const unsubscribe = consumer.subscribe(() => {});

    try {
      await flushMacrotask();
      firstSource.setState({ id: 1 });
      queueMicrotask(() => secondSource.setState({ id: 1 }));
      await flushMacrotask();
      expect(fetched).toEqual([1]);
    } finally {
      unsubscribe();
      first.getState().reset();
      second.getState().reset();
    }
  });

  it('aborts a replacement started by an abort listener when the store is reset', async () => {
    const onReplacementAbort = vi.fn();
    let calls = 0;
    let replacementFetch: Promise<string | null> | undefined;
    const store = createQueryStore({
      retry: false,
      fetcher: (_params, controller) => {
        calls++;
        if (calls === 1) {
          controller!.signal.addEventListener('abort', () => {
            replacementFetch = store.getState().fetch(undefined, { force: true });
          });
        } else {
          controller!.signal.addEventListener('abort', onReplacementAbort);
        }
        return new Promise<string>(() => {});
      },
    });

    try {
      const first = store.getState().fetch();
      store.setState({ enabled: false });
      await first;
      expect(calls).toBe(2);

      store.getState().reset();
      expect(onReplacementAbort).toHaveBeenCalledOnce();

      await replacementFetch;
    } finally {
      store.getState().reset();
    }
  });

  it('cancels the previous request when a listener reenables the store', async () => {
    const pending = deferred<string>();
    const controllers: AbortController[] = [];
    const store = createQueryStore({
      staleTime: Infinity,
      fetcher: (_params, controller) => {
        if (controller) controllers.push(controller);
        return pending.promise;
      },
    });
    let reenable = true;
    const unsubscribe = store.subscribe(state => {
      if (!state.enabled && reenable) {
        reenable = false;
        store.setState({ enabled: true });
      }
    });

    try {
      store.setState({ enabled: false });
      expect(controllers[0].signal.aborted).toBe(true);

      await flushMacrotask();
      expect(store.getState().enabled).toBe(true);
      expect(controllers).toHaveLength(2);

      const controller = controllers[1];
      expect(controller.signal.aborted).toBe(false);

      store.setState({ enabled: false });
      expect(controller.signal.aborted).toBe(true);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });

  it('keeps a forced manual fetch pending when enabled without subscribers', async () => {
    const pending = deferred<string>();
    const controllers: AbortController[] = [];
    const store = createQueryStore({
      enabled: false,
      staleTime: Infinity,
      fetcher: (_params, controller) => {
        if (controller) controllers.push(controller);
        return pending.promise;
      },
    });

    try {
      const read = store.getState().fetch(undefined, { force: true });
      store.setState({ enabled: true });
      expect(controllers[0].signal.aborted).toBe(false);

      pending.resolve('data');
      expect(await read).toBe('data');
    } finally {
      store.getState().reset();
    }
  });
});

describe('query reset', () => {
  it.each([
    [true, false],
    [true, true],
    ['withCache', false],
    ['withCache', true],
  ] as const)(
    'preserves independent result-only errors across reset, skip=%s, transformError=%s',
    async (skipStoreUpdates, transformError) => {
      const response = deferred<number>();
      const failure = new Error('independent failure');
      vi.spyOn(logger, 'error').mockImplementation(() => {});
      const onError = vi.fn();
      const store = createQueryStore({
        fetcher: () => response.promise,
        staleTime: Infinity,
        disableCache: skipStoreUpdates === 'withCache',
        onError,
        transform: value => {
          if (transformError) throw failure;
          return value;
        },
      });

      try {
        const result = store
          .getState()
          .fetch(undefined, { skipStoreUpdates, throwOnError: true })
          .catch(error => error);
        store.getState().reset(true);
        if (transformError) response.resolve(1);
        else response.reject(failure);
        if (transformError) expect(await result).toMatchObject({ cause: failure });
        else expect(await result).toBe(failure);
        expect(onError).not.toHaveBeenCalled();
        expect(store.getState()).toMatchObject({ status: 'idle', queryCache: {} });
      } finally {
        store.getState().reset();
      }
    }
  );

  it('prevents pending requests from publishing after reset while allowing independent results', async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const independent = deferred<string>();
    const onFetched = vi.fn();
    const transform = vi.fn((data: string) => data);
    const store = createQueryStore<string, { id: string }>({
      params: { id: 'a' },
      staleTime: Infinity,
      abortInterruptedFetches: false,
      onFetched,
      transform,
      fetcher: ({ id }) => {
        if (id === 'a') return a.promise;
        if (id === 'b') return b.promise;
        return independent.promise;
      },
    });

    try {
      const firstFetch = store.getState().fetch();
      const replacementFetch = store.getState().fetch({ id: 'b' }, { updateQueryKey: true });
      const independentFetch = store.getState().fetch({ id: 'independent' }, { skipStoreUpdates: true });
      store.getState().reset();
      const resetState = store.getState();
      a.resolve('a');
      b.resolve('b');
      independent.resolve('independent');
      expect(await Promise.all([firstFetch, replacementFetch, independentFetch])).toEqual([null, null, 'independent']);
      expect(store.getState()).toBe(resetState);
      expect(onFetched).not.toHaveBeenCalled();
      expect(transform).toHaveBeenCalledOnce();
      expect(transform).toHaveBeenCalledWith('independent', { id: 'independent' });
    } finally {
      store.getState().reset();
    }
  });

  it.each([false, true])(
    'does not call the fetcher when a loading-state listener resets the store, abort=%s',
    async abortInterruptedFetches => {
      const fetcher = vi.fn(() => 'obsolete');
      const store = createQueryStore({ fetcher, abortInterruptedFetches, enabled: false, staleTime: Infinity });
      const unsubscribe = store.subscribe(state => {
        if (state.status === 'loading') state.reset(true);
      });

      try {
        expect(await store.getState().fetch(undefined, { force: true })).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
        expect(store.getState()).toMatchObject({ status: 'idle', queryKey: '', queryCache: {} });
      } finally {
        unsubscribe();
        store.getState().reset();
      }
    }
  );

  it('detaches reactive parameters and cancels scheduled work on reset', async () => {
    vi.useFakeTimers();
    const source = createBaseStore(() => ({ id: 'a' }));
    const fetcher = vi.fn(({ id }: { id: string }) => id);
    const store = createQueryStore({ params: { id: $ => $(source).id }, fetcher, staleTime: 60000 });
    let unsubscribe: (() => void) | undefined;

    try {
      await store.getState().fetch();
      unsubscribe = store.subscribe(() => {});
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      store.getState().reset();
      expect(vi.getTimerCount()).toBe(0);

      const resetState = store.getState();
      source.setState({ id: 'b' });
      await vi.runAllTimersAsync();
      expect(store.getState()).toBe(resetState);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      unsubscribe?.();
      store.getState().reset();
    }
  });
});
