import { flushMacrotask, flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';
import { createQueryStore, getQueryKey, parseQueryKey, queryParam } from './createQueryStore';
import { createAsyncStorageMock } from './internal/storage/storageMocks.testUtils';
import { QueryStatuses } from './queryStore/types';
import { time } from './utils/time';

type TestData = string;
type TestParams = { id: number };

describe('createQueryStore', () => {
  // ──────────────────────────────────────────────
  // Initialization
  // ──────────────────────────────────────────────
  describe('Initialization', () => {
    it('should initialize the current query key before activation', () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const store = createQueryStore<TestData, TestParams>({
        enabled: false,
        fetcher,
        params: { id: 1 },
      });

      expect(store.getState().queryKey).toBe(getQueryKey({ id: 1 }));
      expect(store.getState().getData()).toBeNull();
      expect(store.getState().getStatus('isInitialLoad')).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────
  // Successful Fetch
  // ──────────────────────────────────────────────
  describe('Successful Fetch', () => {
    it('should fetch data successfully and update store state', async () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 1 },
      });

      // Initially no data and status is Idle.
      expect(store.getState().getData()).toBeNull();
      expect(store.getState().status).toBe(QueryStatuses.Idle);

      const result = await store.getState().fetch();
      expect(result).toBe('data-1');
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.getState().getData()).toBe('data-1');

      const status = store.getState().getStatus();
      expect(status.isSuccess).toBe(true);
      expect(status.isLoading).toBe(false);
      expect(status.isError).toBe(false);
    });
  });

  // ──────────────────────────────────────────────
  // Error Handling and Retry
  // ──────────────────────────────────────────────
  describe('Error Handling and Retry', () => {
    it('should handle fetch errors and update state with error and retry count', async () => {
      const fetcher = vi.fn(async () => {
        throw new Error('Fetch failed');
      });
      const onError = vi.fn();
      const maxRetries = 2;
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        maxRetries,
        onError,
        params: { id: 1 },
        staleTime: time.minutes(2),
      });

      // Use fake timers because retries are scheduled via setTimeout.
      vi.useFakeTimers();

      const fetchPromise = store.getState().fetch();
      // Fast-forward timers so that any scheduled retry happens.
      vi.runAllTimers();
      const result = await fetchPromise;
      expect(result).toBeNull();

      const fetchPromise2 = store.getState().fetch();
      vi.runAllTimers();
      const result2 = await fetchPromise2;
      expect(result2).toBeNull();

      const fetchPromise3 = store.getState().fetch();
      vi.runAllTimers();
      const result3 = await fetchPromise3;
      expect(result3).toBeNull();

      // onError should have been called (one or more times)
      expect(onError).toHaveBeenCalled();
      // The store status should be Error.
      expect(store.getState().status).toBe(QueryStatuses.Error);

      // Check that the query cache records a retry count equal to maxRetries.
      const state = store.getState();
      const queryKey = state.queryKey;
      const cacheEntry = state.queryCache[queryKey];
      expect(cacheEntry).toBeDefined();
      expect(cacheEntry?.errorInfo?.retryCount).toBe(maxRetries);
      vi.useRealTimers();
    });

    it('should not run a scheduled retry after the store is disabled', async () => {
      vi.useFakeTimers();

      const fetcher = vi.fn(async () => {
        throw new Error('Fetch failed');
      });
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 1 },
        retryDelay: 100,
      });

      const unsubscribe = store.subscribe(() => {
        return;
      });

      try {
        await flushMicrotasks();
        expect(fetcher).toHaveBeenCalledTimes(1);

        store.setState({ enabled: false });
        await vi.advanceTimersByTimeAsync(100);
        await flushMicrotasks();

        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        unsubscribe();
        vi.useRealTimers();
      }
    });
  });

  // ──────────────────────────────────────────────
  // Abort Fetch
  // ──────────────────────────────────────────────
  describe('Abort Fetch', () => {
    it('should abort the active current-path fetch when current params change', async () => {
      const paramsStore = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
        id: 1,
        setId: id => set({ id }),
      }));

      let firstFetchAborted = false;
      const fetcher = vi.fn((params: TestParams, controller: AbortController | null) => {
        if (params.id !== 1) return Promise.resolve(`data-${params.id}`);

        const firstAbortSignal = controller?.signal;
        return new Promise<TestData>((_resolve, reject) => {
          if (firstAbortSignal) {
            firstAbortSignal.addEventListener(
              'abort',
              () => {
                firstFetchAborted = true;
                reject(new Error('[createQueryStore: AbortError] Fetch interrupted'));
              },
              { once: true }
            );
          }
        });
      });

      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: $ => $(paramsStore).id },
      });

      const unsubscribe = store.subscribe(() => {
        return;
      });

      try {
        await Promise.resolve();

        const firstFetchPromise = store.getState().fetch();
        paramsStore.getState().setId(2);
        await flushMacrotask();

        await expect(firstFetchPromise).resolves.toBeNull();
        expect(firstFetchAborted).toBe(true);
        expect(store.getState().queryKey).toBe(getQueryKey({ id: 2 }));
        expect(store.getState().getData()).toBe('data-2');
      } finally {
        unsubscribe();
      }
    });

    it('should not let an aborted fetch clear a same-key replacement fetch', async () => {
      vi.useFakeTimers();

      const fetcher = vi.fn((params: TestParams) => {
        return new Promise<TestData>(resolve => {
          setTimeout(() => resolve(`data-${params.id}`), 100);
        });
      });

      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 1 },
      });

      const unsubscribeFirst = store.subscribe(() => {
        return;
      });
      expect(fetcher).toHaveBeenCalledTimes(1);

      unsubscribeFirst();

      const unsubscribeSecond = store.subscribe(() => {
        return;
      });

      try {
        expect(fetcher).toHaveBeenCalledTimes(2);

        await Promise.resolve();

        const activeFetchPromise = store.getState().fetch(undefined, { updateQueryKey: true });
        expect(fetcher).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(100);
        await activeFetchPromise;
        expect(store.getState().getData()).toBe('data-1');
      } finally {
        unsubscribeSecond();
        vi.useRealTimers();
      }
    });
  });

  // ──────────────────────────────────────────────
  // Skip Store Updates Option
  // ──────────────────────────────────────────────
  describe('Skip Store Updates Option', () => {
    it('should perform fetch without updating store state when skipStoreUpdates is true', async () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 3 },
      });

      const initialState = store.getState();
      const result = await store.getState().fetch({ id: 3 }, { skipStoreUpdates: true });
      expect(result).toBe('data-3');
      // The internal store state should remain unchanged (no cached data and status remains Idle).
      expect(store.getState().getData({ id: 3 })).toBeNull();
      expect(store.getState().status).toBe(QueryStatuses.Idle);
      expect(store.getState()).toEqual(initialState);
    });
  });

  // ──────────────────────────────────────────────
  // Cache and Staleness
  // ──────────────────────────────────────────────
  describe('Cache and Staleness', () => {
    it('should return cached data when not stale', async () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const staleTime = time.minutes(5);
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 4 },
        staleTime,
      });

      // First fetch
      const result1 = await store.getState().fetch();
      expect(result1).toBe('data-4');
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Immediately call fetch again with the same params.
      // Should return cached data without calling fetcher.
      const result2 = await store.getState().fetch();
      expect(result2).toBe('data-4');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should refetch data when stale', async () => {
      vi.useFakeTimers();
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const staleTime = time.seconds(1);
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 5 },
        staleTime,
      });

      // First fetch
      const result1 = await store.getState().fetch();
      expect(result1).toBe('data-5');
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Advance time past the stale threshold.
      vi.advanceTimersByTime(1100);

      // Next fetch should trigger a new fetch because the cached data is stale.
      const result2 = await store.getState().fetch();
      expect(result2).toBe('data-5');
      expect(fetcher).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  // ──────────────────────────────────────────────
  // Manual Fetch with Force Option
  // ──────────────────────────────────────────────
  describe('Manual Fetch with Force Option', () => {
    it('should override cache when force is true', async () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}-${Math.random()}`;
      });
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 6 },
      });

      const result1 = await store.getState().fetch();
      expect(result1).toMatch(/^data-6-/);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Force a fetch even though data is already cached.
      const result2 = await store.getState().fetch(undefined, { force: true });
      expect(result2).toMatch(/^data-6-/);
      expect(fetcher).toHaveBeenCalledTimes(2);

      // The store's cached data should now be updated.
      expect(store.getState().getData()).toBe(result2);
    });
  });

  // ──────────────────────────────────────────────
  // Reset Functionality and Param-Less Query Keys
  // ──────────────────────────────────────────────
  describe('Reset Functionality and Param-Less Query Keys', () => {
    it('should reset store state to initial values', async () => {
      const fetcher = vi.fn(async (params?: { id?: number }) => {
        return `data-${params?.id ?? 0}`;
      });
      const store = createQueryStore<TestData, { id?: number }>({
        fetcher,
        params: {},
      });

      // Manually fetch with no params.
      await store.getState().fetch();
      expect(store.getState().getData()).toBe('data-0');
      expect(store.getState().status).toBe(QueryStatuses.Success);
      expect(store.getState().queryKey).toBe('{}');

      // Call reset and verify that state is cleared.
      store.getState().reset(true);
      expect(store.getState().getData()).toBeNull();
      expect(store.getState().status).toBe(QueryStatuses.Idle);

      // The queryKey should be reset to an empty string.
      expect(store.getState().queryKey).toBe('');
    });
  });

  // ──────────────────────────────────────────────
  // onFetched Callback
  // ──────────────────────────────────────────────
  describe('onFetched Callback', () => {
    it('should call onFetched callback on successful fetch', async () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const onFetched = vi.fn();
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        onFetched,
        params: { id: 8 },
      });

      const result = await store.getState().fetch();
      expect(result).toBe('data-8');
      expect(onFetched).toHaveBeenCalled();
      const callbackArg = onFetched.mock.calls[0][0];
      expect(callbackArg.data).toBe('data-8');
      expect(typeof callbackArg.fetch).toBe('function');
      expect(callbackArg.params).toEqual({ id: 8 });
      expect(typeof callbackArg.set).toBe('function');
    });
  });

  // ──────────────────────────────────────────────
  // setData Option
  // ──────────────────────────────────────────────
  describe('setData Option', () => {
    it('should use custom setData callback to update store state', async () => {
      // Here we define a custom store state type that includes a custom field.
      type CustomState = { customData: TestData | null };
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const store = createQueryStore<TestData, TestParams, CustomState>(
        {
          fetcher,
          setData: ({ data, set }) => {
            set({ customData: data });
          },
          cacheTime: time.days(1),
          params: { id: 9 },
          staleTime: time.minutes(20),
        },
        // Custom state creator to add a custom field.
        () => ({
          customData: null,
        })
      );

      const result = await store.getState().fetch();
      expect(result).toBe('data-9');
      // The custom state field should be updated by the setData callback.
      expect(store.getState().customData).toBe('data-9');
      // Since setData was used, the internal queryCache data should be null.
      const state = store.getState();
      const cacheEntry = state.queryCache[state.queryKey];
      expect(cacheEntry?.data).toBeNull();
      // The lastFetchedAt timestamp however should be defined.
      expect(cacheEntry?.lastFetchedAt).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────
  // Simultaneous Fetch Deduplication
  // ──────────────────────────────────────────────
  describe('Fetch Deduplication', () => {
    it('should return the same data object for concurrent fetch calls with same params', async () => {
      let resolveFn: (value: { data: string }) => void = () => {
        return;
      };
      const fetcher = vi.fn(async () => {
        return new Promise<{ data: string }>(resolve => {
          resolveFn = resolve;
        });
      });
      const store = createQueryStore<{ data: string }, TestParams>({
        fetcher,
        params: { id: 10 },
      });

      const promise1 = store.getState().fetch();
      await Promise.resolve(); // allow state update to propagate
      const promise2 = store.getState().fetch();
      await Promise.resolve();

      // Resolve the underlying promise with an object
      const responseData = { data: 'data-10' };
      resolveFn(responseData);

      // Both promises should resolve to the same object reference
      const result1 = await promise1;
      const result2 = await promise2;
      expect(result1).toBe(result2);
      expect(result1).toBe(responseData);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────
  // Automatic Refetch Scheduling
  // ──────────────────────────────────────────────
  describe('Automatic Refetch Scheduling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    it('should schedule a refetch when data becomes stale', async () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const staleTime = time.seconds(1);
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 11 },
        staleTime,
      });

      await store.getState().fetch();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Simulate a subscription so that the store's auto-refetch logic is active.
      const unsubscribe = store.subscribe(() => {
        return;
      });
      // Advance timers past the stale threshold.
      vi.advanceTimersByTime(1100);
      // Allow any scheduled promise resolution.
      await Promise.resolve();
      expect(fetcher).toHaveBeenCalledTimes(2);
      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Manual Fetch Parameters
  // ──────────────────────────────────────────────
  describe('Manual Fetch Parameters', () => {
    it('should not move the current query key when fetching custom params', async () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 12 },
      });

      await store.getState().fetch();
      const currentQueryKey = store.getState().queryKey;
      expect(currentQueryKey).toBe(getQueryKey({ id: 12 }));
      expect(store.getState().getData()).toBe('data-12');

      const result = await store.getState().fetch({ id: 13 });
      expect(result).toBe('data-13');
      expect(store.getState().queryKey).toBe(currentQueryKey);
      expect(store.getState().getData()).toBe('data-12');
      expect(store.getState().getData({ id: 13 })).toBe('data-13');
    });
  });

  // ──────────────────────────────────────────────
  // Reactive Params Lifecycle
  // ──────────────────────────────────────────────
  describe('Reactive Params Lifecycle', () => {
    it('should resubscribe to reactive enabled state after a resubscription', async () => {
      const enabledStore = createBaseStore<{ enabled: boolean; setEnabled: (value: boolean) => void }>(set => ({
        enabled: true,
        setEnabled: value => set({ enabled: value }),
      }));

      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });

      const store = createQueryStore<TestData, TestParams>({
        enabled: $ => $(enabledStore).enabled,
        fetcher,
        params: { id: 20 },
        staleTime: 0,
      });

      const unsubscribe = store.subscribe(() => {
        return;
      });
      await Promise.resolve();
      fetcher.mockClear();
      unsubscribe();

      enabledStore.getState().setEnabled(false);

      const unsubscribe2 = store.subscribe(() => {
        return;
      });
      await Promise.resolve();
      expect(fetcher).not.toHaveBeenCalled();
      expect(store.getState().enabled).toBe(false);

      enabledStore.getState().setEnabled(true);
      await flushMacrotask();
      expect(fetcher).toHaveBeenCalledTimes(1);
      unsubscribe2();
    });

    it('should track reactive params returned by store method invocations', async () => {
      type SourceState = {
        id: number;
        getId(): number;
        setId: (id: number) => void;
      };

      const paramsStore = createBaseStore<SourceState>(set => ({
        id: 1,
        getId() {
          return this.id;
        },
        setId: id => set({ id }),
      }));

      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });

      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: $ => $(paramsStore).getId() },
        staleTime: 0,
      });

      const unsubscribe = store.subscribe(() => {
        return;
      });

      try {
        await flushMacrotask();
        expect(fetcher).toHaveBeenCalledWith({ id: 1 }, expect.any(AbortController));

        fetcher.mockClear();
        paramsStore.getState().setId(2);
        await flushMacrotask();

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith({ id: 2 }, expect.any(AbortController));
        expect(store.getState().queryKey).toBe(getQueryKey({ id: 2 }));
        expect(store.getState().getData()).toBe('data-2');
      } finally {
        unsubscribe();
      }
    });

    it('should track reactive params that return a proxied source snapshot', async () => {
      type Params = { source: { id: number } };

      const paramsStore = createBaseStore<{ id: number }>(() => ({ id: 1 }));
      const store = createQueryStore<TestData, Params>({
        enabled: false,
        fetcher: async params => `data-${params.source.id}`,
        params: { source: $ => $(paramsStore) },
      });

      paramsStore.setState({ id: 2 });
      await flushMacrotask();

      expect(store.getState().queryKey).toBe(getQueryKey({ source: { id: 2 } }));
    });

    it('should publish cached reactive param updates from multiple query stores in one queued flush', async () => {
      const realQueueMicrotask = globalThis.queueMicrotask;
      let microtaskJob = 0;
      const unsubscribes: Array<() => void> = [];

      globalThis.queueMicrotask = callback => {
        realQueueMicrotask(() => {
          microtaskJob += 1;
          callback();
        });
      };

      try {
        const paramsStore = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
          id: 1,
          setId: id => set({ id }),
        }));

        const fetchCalls: string[] = [];

        function createNamedStore(name: string) {
          return createQueryStore<TestData, TestParams>({
            fetcher: async params => {
              fetchCalls.push(`${name}:${params.id}`);
              return `${name}-data-${params.id}`;
            },
            keepPreviousData: true,
            params: { id: $ => $(paramsStore, state => state.id) },
            staleTime: Infinity,
          });
        }

        const firstStore = createNamedStore('first');
        const secondStore = createNamedStore('second');
        const events: Array<{ job: number; next: TestData | null; prev: TestData | null; store: string }> = [];

        unsubscribes.push(
          firstStore.subscribe(
            state => state.getData(),
            (next, prev) => events.push({ job: microtaskJob, next, prev, store: 'first' })
          ),
          secondStore.subscribe(
            state => state.getData(),
            (next, prev) => events.push({ job: microtaskJob, next, prev, store: 'second' })
          )
        );

        await flushMacrotask();

        await firstStore.getState().fetch({ id: 2 }, { skipStoreUpdates: 'withCache' });
        await secondStore.getState().fetch({ id: 2 }, { skipStoreUpdates: 'withCache' });

        events.length = 0;
        fetchCalls.length = 0;

        paramsStore.getState().setId(2);
        await flushMacrotask();

        expect(fetchCalls).toEqual([]);
        expect(events.map(event => ({ next: event.next, prev: event.prev, store: event.store }))).toEqual([
          { next: 'first-data-2', prev: 'first-data-1', store: 'first' },
          { next: 'second-data-2', prev: 'second-data-1', store: 'second' },
        ]);
        expect(new Set(events.map(event => event.job)).size).toBe(1);
      } finally {
        for (const unsubscribe of unsubscribes) unsubscribe();
        globalThis.queueMicrotask = realQueueMicrotask;
      }
    });

    it('should keep reactive params live without fetching while unsubscribed', async () => {
      const paramsStore = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
        id: 1,
        setId: id => set({ id }),
      }));

      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });

      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: $ => $(paramsStore).id },
        staleTime: 0,
      });

      paramsStore.getState().setId(2);
      await flushMacrotask();

      expect(store.getState().queryKey).toBe(getQueryKey({ id: 2 }));
      expect(fetcher).not.toHaveBeenCalled();

      const unsubscribe = store.subscribe(() => {
        return;
      });

      try {
        await flushMacrotask();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith({ id: 2 }, expect.any(AbortController));
      } finally {
        unsubscribe();
      }
    });

    it('should let reactive params track the query store without activating it', async () => {
      type CustomState = {
        id: number;
        setId: (id: number) => void;
      };

      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });

      const store = createQueryStore<TestData, TestParams, CustomState>(
        {
          fetcher,
          params: { id: ($, store) => $(store).id },
          staleTime: 0,
        },
        set => ({
          id: 1,
          setId: id => set({ id }),
        })
      );

      store.getState().setId(2);
      await flushMacrotask();

      expect(store.getState().queryKey).toBe(getQueryKey({ id: 2 }));
      expect(fetcher).not.toHaveBeenCalled();

      const unsubscribe = store.subscribe(() => {
        return;
      });

      try {
        await flushMacrotask();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith({ id: 2 }, expect.any(AbortController));
      } finally {
        unsubscribe();
      }
    });

    it('should not fetch when reactive enabled becomes true without subscribers', async () => {
      const enabledStore = createBaseStore<{ enabled: boolean; setEnabled: (enabled: boolean) => void }>(set => ({
        enabled: false,
        setEnabled: enabled => set({ enabled }),
      }));

      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });

      const store = createQueryStore<TestData, TestParams>({
        enabled: $ => $(enabledStore).enabled,
        fetcher,
        params: { id: 1 },
        staleTime: 0,
      });

      enabledStore.getState().setEnabled(true);
      await flushMacrotask();

      expect(store.getState().enabled).toBe(true);
      expect(fetcher).not.toHaveBeenCalled();

      const unsubscribe = store.subscribe(() => {
        return;
      });

      try {
        await flushMacrotask();
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        unsubscribe();
      }
    });

    it('should not fetch when reactive staleTime changes without subscribers', async () => {
      const staleTimeStore = createBaseStore<{ staleTime: number; setStaleTime: (staleTime: number) => void }>(set => ({
        staleTime: time.minutes(2),
        setStaleTime: staleTime => set({ staleTime }),
      }));

      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });

      createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 1 },
        staleTime: $ => $(staleTimeStore).staleTime,
      });

      staleTimeStore.getState().setStaleTime(0);
      await flushMacrotask();

      expect(fetcher).not.toHaveBeenCalled();
    });

    it('should publish query keys atomically with derived params', async () => {
      const sourceStore = createBaseStore<{ id: number; setId: (id: number) => void }>(set => ({
        id: 1,
        setId: id => set({ id }),
      }));

      const derivedParamStore = createDerivedStore($ => $(sourceStore).id);
      const store = createQueryStore<TestData, TestParams>({
        enabled: false,
        fetcher: async params => `data-${params.id}`,
        params: { id: $ => $(derivedParamStore) },
      });

      const combinedStore = createDerivedStore($ => ({
        id: $(derivedParamStore),
        queryKey: $(store).queryKey,
      }));
      const childStore = createDerivedStore($ => {
        const { id, queryKey } = $(combinedStore);
        return `${id}:${queryKey}`;
      });

      const values: string[] = [];
      const unsubscribe = childStore.subscribe(
        value => value,
        value => {
          values.push(value);
        }
      );

      try {
        sourceStore.getState().setId(2);
        await flushMacrotask();

        const expectedQueryKey = getQueryKey({ id: 2 });
        expect(values).toEqual([`2:${expectedQueryKey}`]);
        expect(childStore.getState()).toBe(`2:${expectedQueryKey}`);
        expect(store.getState().queryKey).toBe(expectedQueryKey);
      } finally {
        unsubscribe();
        store.getState().reset();
      }
    });

    it('should publish enabled atomically with derived enabled sources', async () => {
      const sourceStore = createBaseStore<{ enabled: boolean; setEnabled: (enabled: boolean) => void }>(set => ({
        enabled: false,
        setEnabled: enabled => set({ enabled }),
      }));

      const derivedEnabledStore = createDerivedStore($ => $(sourceStore).enabled);
      const store = createQueryStore<TestData, TestParams>({
        enabled: $ => $(derivedEnabledStore),
        fetcher: async params => `data-${params.id}`,
        params: { id: 1 },
      });

      const combinedStore = createDerivedStore($ => ({
        enabled: $(derivedEnabledStore),
        queryEnabled: $(store).enabled,
      }));
      const childStore = createDerivedStore($ => {
        const { enabled, queryEnabled } = $(combinedStore);
        return `${enabled}:${queryEnabled}`;
      });

      const values: string[] = [];
      const unsubscribe = childStore.subscribe(
        value => value,
        value => {
          values.push(value);
        }
      );

      try {
        sourceStore.getState().setEnabled(true);
        await flushMacrotask();

        expect(values).toEqual(['true:true']);
        expect(childStore.getState()).toBe('true:true');
        expect(store.getState().enabled).toBe(true);
      } finally {
        unsubscribe();
        store.getState().reset();
      }
    });

    it('should support query params with projected or excluded key values', async () => {
      type LargeParam = { id: string; body: string };
      type Params = { id: number; payload: LargeParam; token: string };

      const payload = { id: 'payload-1', body: 'large-body' };
      const fetcher = vi.fn(async (params: Params) => {
        return `${params.id}:${params.payload.body}:${params.token}`;
      });

      const store = createQueryStore<TestData, Params>({
        fetcher,
        params: {
          id: 1,
          payload: queryParam(payload, { key: value => value.id }),
          token: queryParam('secret-token', { key: false }),
        },
      });

      expect(store.getState().queryKey).toBe(getQueryKey({ id: 1, payload: 'payload-1' }));
      expect(parseQueryKey(store.getState().queryKey)).toEqual({ id: 1, payload: 'payload-1' });

      await store.getState().fetch();

      expect(fetcher).toHaveBeenCalledWith({ id: 1, payload, token: 'secret-token' }, expect.any(AbortController));
      expect(
        store.getState().getData({
          id: 1,
          payload: { id: 'payload-1', body: 'different-body' },
          token: 'different-token',
        })
      ).toBe('1:large-body:secret-token');
    });
  });

  describe('Fetch Triggers and Abort Behavior', () => {
    // ──────────────────────────────────────────────
    // Manual Abort via Reset
    // ──────────────────────────────────────────────
    it('should manually abort an ongoing fetch when reset is called', async () => {
      let abortSignal: AbortSignal | null = null;
      // Create a fetcher that never resolves (simulating a long-running request)
      // and listens for an abort event.
      const fetcher = vi.fn((params: TestParams, controller: AbortController | null) => {
        abortSignal = controller ? controller.signal : null;
        return new Promise<TestData>((_resolve, reject) => {
          if (abortSignal) {
            abortSignal.addEventListener('abort', () => reject(new Error('[createQueryStore: AbortError] Fetch interrupted')), {
              once: true,
            });
          }
        });
      });

      const store = createQueryStore<TestData, TestParams>({ fetcher, params: { id: 14 } });
      const fetchPromise = store.getState().fetch({ id: 14 });
      // Manually call reset to abort any active fetch.
      store.getState().reset(true);
      const result = await fetchPromise;
      expect(result).toBeNull();
    });

    // ──────────────────────────────────────────────
    // Enabled Toggling
    // ──────────────────────────────────────────────
    it('should trigger a fetch when enabled toggles from false to true', async () => {
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      // Start with the store disabled.
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        enabled: false,
        params: { id: 15 },
      });

      // Simulate a subscription so that the store's auto-refetch logic is active.
      const unsubscribe = store.subscribe(() => {
        return;
      });

      // Explicitly set enabled to false.
      store.setState({ enabled: false });
      // Now toggle enabled to true.
      store.setState({ enabled: true });
      // Allow the subscription/side-effect to process.
      await Promise.resolve();
      // Expect that a fetch was automatically triggered.
      expect(fetcher).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    // ──────────────────────────────────────────────
    // Auto-Refetch Cancellation on Unsubscribe
    // ──────────────────────────────────────────────
    it('should cancel scheduled refetch when all subscriptions are removed', async () => {
      vi.useFakeTimers();
      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });
      // Set a very short staleTime so that a refetch is scheduled.
      const staleTime = time.seconds(0.2);
      const store = createQueryStore<TestData, TestParams>({
        fetcher,
        params: { id: 16 },
        staleTime,
      });

      // Create a subscription to activate auto-refetch behavior.
      const unsubscribe = store.subscribe(() => {
        return;
      });

      expect(fetcher).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(time.seconds(0.25));

      expect(fetcher).toHaveBeenCalledTimes(2);

      // Now remove all subscriptions.
      unsubscribe();
      // Advance timers past the staleTime.
      await vi.advanceTimersByTimeAsync(time.seconds(0.5));
      // Allow any scheduled promise to resolve.
      await Promise.resolve();
      // Since there are no subscribers, the scheduled refetch should not occur.
      expect(fetcher).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  // ──────────────────────────────────────────────
  // getQueryKey Utility
  // ──────────────────────────────────────────────
  describe('getQueryKey Utility', () => {
    it('should return a sorted JSON string representation of parameters', () => {
      const params = { b: 2, a: 1 };
      const key = getQueryKey(params);
      // Since getQueryKey sorts keys and then returns the JSON string of the values,
      // the expected output is the JSON string for the object { a: 1, b: 2 }.
      expect(key).toBe(JSON.stringify({ a: 1, b: 2 }));
    });
  });

  // ──────────────────────────────────────────────
  // Async Storage Support
  // ──────────────────────────────────────────────
  describe('Async Storage Support', () => {
    it('should support async storage with Promise<void> return type for setState', async () => {
      const mockAsyncStorage = createAsyncStorageMock();

      const fetcher = vi.fn(async (params: TestParams) => {
        return `data-${params.id}`;
      });

      const store = createQueryStore<TestData, TestParams>(
        {
          fetcher,
          params: { id: 1 },
        },
        {
          storage: mockAsyncStorage,
          storageKey: 'async-query-store',
        }
      );

      // Verify setState returns Promise<void> for async storage.
      const setStateResult = store.setState({ enabled: false });
      expect(setStateResult).toBeInstanceOf(Promise);
      await setStateResult;

      // Verify storage.set was called.
      expect(mockAsyncStorage.set).toHaveBeenCalled();

      // Call setState and verify store state is updated synchronously.
      const setEnabledResult = store.setState({ enabled: true });
      expect(store.getState().enabled).toBe(true);

      // Await persistence.
      await setEnabledResult;

      // Verify there were exactly two storage set calls.
      expect(mockAsyncStorage.set.mock.calls.length).toBe(2);
    });
  });
});
